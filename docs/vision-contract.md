# Vitasight local vision contract

The browser sends frames only through the application server. The Python service binds to `127.0.0.1`; no remote provider is supported. No audio, patient names, reassessment notes or raw recordings are sent to inference.

`GET /health` returns `{ "engine": "vitasight-yolo11", "device": "cpu" }` after loading and warming up the model.

`POST /infer`, with `Content-Type: application/json`:

```json
{
  "session": "session-uuid",
  "timestamp": 1794067200000,
  "jpeg": "data:image/jpeg;base64,..."
}
```

The response repeats session and timestamp, and includes `detections`, with at most six entries. Each detection has an `id`, normalized `[left, top, width, height]` box, and exactly 17 COCO points. Each point has numeric `x`, `y`, and `confidence` fields. IDs are local to a session; they are not patient identities or cross-camera identities.

The application verifies schemas, timestamps and session identity again after the asynchronous inference completes. A stopped source rejects late results. Concurrent requests for one source get HTTP 429. The Python service serializes model calls across sources and keeps separate tracker instances; busy frames get HTTP 429 rather than accumulating in memory.

`POST /release` with `{ "session": "session-uuid" }` retires a stopped stream. Idle sessions also expire after 60 seconds. A gap exceeding five seconds resets its tracker epoch. Sessions cannot exceed four simultaneously retained instances.

The application computes a seated-posture score from head, shoulders, hips and knees. A review request requires usable landmarks, unambiguous tracking and the configured sustained threshold. Ambiguous overlap or a visibility gap clears patient association. Unknown data interrupts the sustain window. Normal observations reset the episode so a later change can produce a new request. Closing a request while the same condition persists does not create an immediate duplicate.

Demo scenes use a separate `/api/sources/:id/demo` route and server-generated geometry. The server refuses demo data on live sources and real frames on demo sources. Demo records and events retain their mode in exports.

## Browser optical pulse

MediaPipe Face Landmarker runs separately in the browser with local model/WASM files. It supplies 478 facial points; the rendered body surface adds interpolated geometry around the 17 pose joints. The simulated scene maps a canonical 468-point face mesh onto its generated pose. Added visual vertices do not change the server's pose schema or posture rules.

Forehead and cheek polygons provide mean RGB values from decoded video frames, sampled at approximately 20 Hz when the machine permits. Face inference, pixel averaging, and spectral analysis run in a browser worker. The main thread transfers one bitmap at a time and skips capture while it is busy. Buffers are isolated per face and source. An eight-second minimum and twenty-second maximum sliding window feeds temporal resampling, 1.6-second POS overlap-add projection, a forward/reverse 0.7–3 Hz Butterworth high-pass/low-pass cascade, and eight-second Hann-window STFT segments with a one-second hop. Only the latest three segments are computed; spectral concentration suppresses poor signals. Oversampled frequency bins do not imply one-BPM measurement accuracy.

Lost faces, capture stalls, pauses, and seeks clear pulse output. Substantial motion and ambiguous body associations clear measured signal buffers. Camera/file signal buffers never receive generated RGB samples. A separate presentation layer smooths valid BPM changes, briefly holds the last usable signal for six seconds as **Smoothed**, then generates approximate values/waveforms as **Simulated** when the face is still visible. Both fallback states show an approximation mark and zero measured signal strength. A new identity gets a fresh presenter. This does not force measured pulse rates into a normal range.

The explicit simulated scene uses generated RGB values through the same signal processor. Measurements, fallback values, and RGB traces remain in browser memory and are not persisted, exported, or used to trigger review events. The capture stream continues when moving between application tabs and closes when the source is stopped. Pose inference uses a 416-pixel model input for lower CPU cost, with unchanged quality gates; returned tracks bypass the state-polling delay.

Every displayed BPM receives a smooth, bounded ±2 BPM visual variation. The approximation mark and tooltip identify this presentation effect. Raw optical BPM, the smoothed center, and the animated display value are separate fields; the added drift does not enter signal processing or review rules.

References: [Ultralytics tracking API](https://docs.ultralytics.com/modes/track/), [Node 24 SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).
