# Verification — November 7, 2026

Verified with Node 24.18.0, npm 11.16.0, Python 3.12, and Chromium through Playwright in WSL.

## Software

- Fourteen automated tests pass. Coverage includes sustained posture rules, complete response workflow, initial priority preservation, deduplication/recovery, uncertain identity, poor landmarks, visibility gaps, detection-order changes, source isolation, simultaneous events, timestamp validation, restart persistence, overdue reminders, HTTP schemas, origin checks, model-response matching, and cancellation during inference.
- TypeScript and the Vite production build pass.
- Prettier formatting check passes.
- CI runs the same software checks and a browser walkthrough. The workflow was authored locally; no GitHub Actions run is claimed.

## Browser

The automated walkthrough creates a simulated source, confirms a fictional patient association, generates a sustained posture event, acknowledges and assigns it, records a reassessment, searches the event history, verifies exported records, and reloads the application to check persistence.

Desktop (1440px) and mobile (390px) layouts were inspected. The browser check verifies no horizontal overflow at 390px, no JavaScript page errors, and no unexpected network requests outside the local application. Acknowledgment/assignment preserve a typed outcome note; closing an event requires an outcome or dismissal reason.

The committed screenshot contains only generated geometry and fictional names. It is not camera evidence. Browser checks use a temporary database and do not alter the user's workspace records.

## Real vision integration

The optional setup script was run in an isolated temporary copy. CPU PyTorch, Ultralytics and the checksum-verified YOLO11 Nano Pose weights installed successfully. The service loaded and warmed up successfully.

- A real inference on a blank frame returned no detections.
- Six frames containing two mirrored copies of Google's public [MediaPipe pose fixture](https://storage.googleapis.com/mediapipe-assets/pose.jpg) each returned two people, 17 keypoints per person, and stable IDs.
- Measured HTTP round trips for that fixture were 481.9 ms for the first frame and approximately 81–115 ms for subsequent frames in this environment. These are fixture-specific measurements, not a capacity promise.
- The application server was then connected to the real Python service. Six consecutive create/infer/release cycles passed, verifying that stopped sources release capacity beyond the four-session limit. Blank frames produced no invented events.

The actual vision installation used a temporary environment. The Desktop repository runs the complete demo immediately after npm installation; run `npm run vision:setup` there to install its optional camera/video dependencies.

## Not established

No real camera permission flow, consenting live-participant study, clinical benchmark, medical sensitivity/specificity, physiological estimation, cross-camera identity recognition, hospital deployment, or external message delivery was validated. The pose fixture is a static engineering test. Multi-feed throughput and seated-posture reliability need testing on the intended machine and footage. The software deliberately has no pulse/breathing model or external messaging integration.
