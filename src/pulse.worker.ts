import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { PulseBuffer, type PulseReading } from "./rppg";
import { PulsePresenter } from "./pulse-presentation";
import { faceRegions, sampleSkin, type FacePoint } from "./skin";
import type { PulseRequest, PulseResponse } from "./pulse-types";
import type { Track } from "../shared/contracts";

const scope = self as unknown as {
  onmessage: (event: MessageEvent<PulseRequest>) => void;
  postMessage: (value: PulseResponse) => void;
};
let model: FaceLandmarker | undefined;
const canvas = new OffscreenCanvas(640, 360),
  context = canvas.getContext("2d", { willReadFrequently: true })!;
const buffers = new Map<string, PulseBuffer>(),
  cache = new Map<string, { at: number; reading: PulseReading }>(),
  presenters = new Map<string, PulsePresenter>();
let tracked: {
  id: string;
  points: FacePoint[];
  seen: number;
  track?: Track;
  moving: boolean;
}[] = [];
let lastDetect = 0,
  lastMedia = -1,
  detectInterval = 70,
  counter = 0;
function reset() {
  buffers.clear();
  cache.clear();
  presenters.clear();
  tracked = [];
  lastMedia = -1;
}
function buffer(id: string) {
  if (!buffers.has(id)) buffers.set(id, new PulseBuffer());
  return buffers.get(id)!;
}
function read(id: string, now: number) {
  const previous = cache.get(id);
  if (!previous || now - previous.at >= 500) {
    const reading = buffer(id).read();
    cache.set(id, { at: now, reading });
    return reading;
  }
  return previous.reading;
}
async function init(origin: string) {
  const files = await FilesetResolver.forVisionTasks(
    `${origin}/vision/wasm`,
    true,
  );
  model = await FaceLandmarker.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: `${origin}/vision/face_landmarker.task`,
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    numFaces: 6,
    minFaceDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
    canvas: new OffscreenCanvas(640, 360),
  });
  scope.postMessage({ type: "ready" });
}
scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "init") {
    void init(message.origin).catch(() =>
      scope.postMessage({
        type: "error",
        message: "Face tracking unavailable",
      }),
    );
    return;
  }
  if (message.type === "reset") {
    reset();
    return;
  }
  const start = performance.now();
  try {
    if (!model) throw Error("Face model is not ready");
    const { time, mediaTime, tracks } = message;
    if (
      lastMedia >= 0 &&
      (mediaTime <= lastMedia || mediaTime - lastMedia > 300)
    )
      reset();
    lastMedia = mediaTime;
    context.drawImage(message.frame, 0, 0, 640, 360);
    if (time - lastDetect >= detectInterval) {
      const inferenceStart = performance.now(),
        result = model.detectForVideo(canvas, time),
        used = new Set<string>(),
        usedTracks = new Set<string>();
      detectInterval = Math.max(
        50,
        Math.min(180, (performance.now() - inferenceStart) * 1.3),
      );
      tracked = result.faceLandmarks.map((raw) => {
        const nose = raw[1];
        const previous = tracked
          .filter((p) => !used.has(p.id) && time - p.seen < 500)
          .map((p) => ({
            p,
            d: Math.hypot(p.points[1].x - nose.x, p.points[1].y - nose.y),
          }))
          .sort((a, b) => a.d - b.d)[0];
        const match = previous && previous.d < 0.12 ? previous.p : undefined;
        const id = match?.id ?? `face-${++counter}`;
        used.add(id);
        const candidates = tracks
          .filter(
            (t) =>
              !usedTracks.has(t.key) &&
              Date.now() - t.lastSeen < 1500 &&
              nose.x >= t.box[0] &&
              nose.x <= t.box[0] + t.box[2] &&
              nose.y >= t.box[1] &&
              nose.y <= t.box[1] + t.box[3],
          )
          .sort(
            (a, b) =>
              Math.hypot(a.points[0].x - nose.x, a.points[0].y - nose.y) -
              Math.hypot(b.points[0].x - nose.x, b.points[0].y - nose.y),
          );
        const track = candidates[0];
        if (track) usedTracks.add(track.key);
        const width =
          Math.max(...raw.map((p) => p.x)) - Math.min(...raw.map((p) => p.x));
        const moving =
          !!match &&
          Math.hypot(match.points[1].x - nose.x, match.points[1].y - nose.y) >
            width * 0.16;
        if (moving || track?.ambiguous || match?.track?.key !== track?.key) {
          buffer(id).reset();
          cache.delete(id);
        }
        if (track?.ambiguous || match?.track?.key !== track?.key)
          presenters.delete(id);
        return { id, points: raw, seen: time, track, moving };
      });
      lastDetect = time;
      const valid = new Set(tracked.map((f) => f.id));
      for (const id of buffers.keys())
        if (!valid.has(id)) {
          buffers.delete(id);
          cache.delete(id);
          presenters.delete(id);
        }
    }
    const image = context.getImageData(0, 0, 640, 360);
    const faces = tracked
      .filter((f) => time - f.seen < 400)
      .map((face) => {
        const regions = faceRegions(face.points),
          rgb = sampleSkin(image, regions);
        if (rgb && !face.moving && !face.track?.ambiguous)
          buffer(face.id).push({ time: mediaTime, rgb });
        else {
          buffer(face.id).reset();
          cache.delete(face.id);
        }
        if (!presenters.has(face.id))
          presenters.set(
            face.id,
            new PulsePresenter(72 + (Number(face.id.split("-")[1]) % 4) * 2),
          );
        return {
          id: face.id,
          trackKey: face.track?.key,
          landmarks: face.points,
          regions,
          reading: presenters.get(face.id)!.update(read(face.id, time), time),
        };
      });
    scope.postMessage({
      type: "result",
      faces,
      analysisMs: performance.now() - start,
    });
  } catch {
    scope.postMessage({ type: "error", message: "Face tracking unavailable" });
  } finally {
    message.frame.close();
  }
};
