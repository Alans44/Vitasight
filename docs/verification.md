# Vitasight verification — November 8, 2026

The original baseline below was verified with Node 24.18.0, npm 11.16.0, Python 3.12, and Chromium through Playwright in WSL.

## Frontend updates

Vitasight uses the VITAL-style dark dashboard, horizontal Dashboard/Library/Direct Feed navigation, patient sidebar, and video placeholders. Twenty-three automated tests, TypeScript, the production build, and formatting checks pass. The browser walkthrough verifies the full review workflow and mobile layout. The pulse walkthrough also verifies independent BPM/body toggles, persistent preferences, continued processing while overlays or source views are hidden, navigation to the placeholder Library, and adding a demo from Direct Feed. No JavaScript page errors, horizontal mobile overflow, or unexpected external runtime requests were observed. The real local face and body services were exercised with the controlled portrait fixture. Source comment scans passed; runtime data, models, and local test artifacts remain ignored by Git.

## Optical pulse addition

Verified on Windows with Node 24.5.0 and Playwright Chromium. Twenty-three automated tests pass, including known RGB pulse rates from 54 to 168 BPM with lighting drift and irregular sampling, flat/short/undersampled/interrupted signals, isolated buffers, polygon RGB sampling, an eight-second acquisition window, fallback provenance/smoothing, and bounded display variation. TypeScript and the production build pass. The existing review workflow browser check also passes.

The latency update moves face/pulse processing into a worker, limits capture to one bitmap in flight, returns pose tracks in frame responses, and removes the fixed 500 ms pose-capture interval. On a local 20-second synthetic-signal microbenchmark, median pulse-analysis time fell from 7.84 ms to 4.63 ms across fifty warmed iterations. That timing measures signal processing only, not camera-to-screen latency. Browser checks distinguish initial simulated values from subsequent measured values and exercise pause/navigation behavior.

The new browser check verifies two independent generated signals (72 and 86 BPM), dense facial/body overlay rendering, continuity across navigation, and mobile layout. Google's public portrait test image is modulated with a known 72 BPM color signal and supplied as a controlled browser video stream; the actual local face model and RGB/POS/filter/STFT path recover 72 BPM. The same check also passed with the installed Python body-pose service running concurrently. This demonstrates pipeline wiring on a synthetic optical signal, not a person's measured physiology. No outside runtime requests or JavaScript page errors were observed.

## Original baseline software

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

No real camera permission flow, consenting live-participant study, clinical heart-rate accuracy benchmark, medical sensitivity/specificity, cross-camera identity recognition, hospital deployment, or external message delivery was validated. The pose and modulated portrait fixtures are engineering tests. Multi-feed throughput, live pulse accuracy, and seated-posture reliability need testing on the intended machine and footage. The software has no breathing model or external messaging integration.
