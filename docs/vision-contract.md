# Local vision contract

The browser sends frames only through the application server. The Python service binds to `127.0.0.1`; no remote provider is supported. No audio, patient names, reassessment notes or raw recordings are sent to inference.

`GET /health` returns `{ "engine": "reassessment-yolo11", "device": "cpu" }` after loading and warming up the model.

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

References: [Ultralytics tracking API](https://docs.ultralytics.com/modes/track/), [Node 24 SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).
