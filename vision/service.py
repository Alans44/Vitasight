"""Local, bounded pose inference. Frames and tracker state never leave this process."""
import base64
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ['YOLO_OFFLINE'] = 'true'
os.environ['YOLO_AUTOINSTALL'] = 'false'
os.environ['YOLO_CONFIG_DIR'] = str(ROOT / '.models' / 'config')
import cv2
import numpy as np
import torch
from ultralytics import YOLO, settings

settings.update({'sync': False})
torch.set_num_threads(min(4, os.cpu_count() or 1))
WEIGHTS = ROOT / '.models' / 'yolo11n-pose.pt'
lock = threading.Lock()
sessions = {}
retired = set()

def infer(body):
    sid, timestamp = body.get('session'), body.get('timestamp')
    if not isinstance(sid, str) or len(sid) != 36 or not isinstance(timestamp, (int, float)):
        raise ValueError('Invalid session or timestamp')
    now = time.time()
    for old in list(retired):
        sessions.pop(old, None)
        retired.discard(old)
    for old in list(sessions):
        if now-sessions[old]['used'] > 60:
            del sessions[old]
    if sid not in sessions:
        if len(sessions) >= 4:
            raise ValueError('Session capacity reached; wait for old streams to expire')
        sessions[sid] = {'model': YOLO(str(WEIGHTS)), 'used': now, 'timestamp': 0, 'epoch': 0}
    entry = sessions[sid]
    if timestamp <= entry['timestamp']:
        raise ValueError('Out-of-order frame')
    if timestamp-entry['timestamp'] > 5000:
        entry['model'].predictor = None
        entry['epoch'] += 1
    jpeg = body.get('jpeg', '')
    if not isinstance(jpeg, str) or not jpeg.startswith('data:image/jpeg;base64,'):
        raise ValueError('JPEG data URL required')
    image = cv2.imdecode(np.frombuffer(base64.b64decode(jpeg.split(',', 1)[1], validate=True), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.shape[0] > 720 or image.shape[1] > 1280:
        raise ValueError('Invalid image dimensions')
    result = entry['model'].track(image, persist=True, tracker='bytetrack.yaml', device='cpu', imgsz=640, max_det=6, conf=.3, verbose=False)[0]
    entry['used'], entry['timestamp'] = now, timestamp
    detections = []
    if result.boxes is not None and result.boxes.id is not None and result.keypoints is not None:
        for ident, box, points, confidence in zip(result.boxes.id.int().tolist(), result.boxes.xywhn.tolist(), result.keypoints.xyn.tolist(), result.keypoints.conf.tolist()):
            left = max(0., min(.99, box[0]-box[2]/2))
            top = max(0., min(.99, box[1]-box[3]/2))
            detections.append({'id': f"{entry['epoch']}-{ident}", 'box': [left, top, min(1-left, box[2]), min(1-top, box[3])], 'points': [{'x': point[0], 'y': point[1], 'confidence': score} for point, score in zip(points, confidence)]})
    return {'session': sid, 'timestamp': timestamp, 'detections': detections}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status, value):
        data = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path != '/health':
            return self.reply(404, {'error': 'Not found'})
        self.reply(200, {'engine': 'reassessment-yolo11', 'device': 'cpu'})

    def do_POST(self):
        if self.headers.get('Origin') or self.headers.get('Content-Type') != 'application/json':
            return self.reply(403, {'error': 'Only local application requests are accepted'})
        if self.path == '/release':
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size < 1 or size > 200:
                    raise ValueError('Invalid release request')
                sid = json.loads(self.rfile.read(size)).get('session')
                if not isinstance(sid, str) or len(sid) != 36:
                    raise ValueError('Invalid session')
                retired.add(sid)
                return self.reply(200, {'ok': True})
            except (ValueError, TypeError):
                return self.reply(400, {'error': 'Invalid release request'})
        if self.path != '/infer':
            return self.reply(404, {'error': 'Not found'})
        if not lock.acquire(blocking=False):
            return self.reply(429, {'error': 'Inference busy'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > 600_000:
                return self.reply(413, {'error': 'Frame too large'})
            self.reply(200, infer(json.loads(self.rfile.read(size))))
        except (ValueError, KeyError, TypeError) as error:
            self.reply(400, {'error': str(error)})
        except Exception:
            self.reply(500, {'error': 'Local inference failed'})
        finally:
            lock.release()

if __name__ == '__main__':
    if not WEIGHTS.exists():
        raise RuntimeError('Run npm run vision:setup first')
    warmup = YOLO(str(WEIGHTS))
    warmup.predict(np.zeros((360, 640, 3), dtype=np.uint8), device='cpu', verbose=False)
    del warmup
    port = int(os.environ.get('POSE_PORT', '8791'))
    print(f'Local vision ready: http://127.0.0.1:{port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
