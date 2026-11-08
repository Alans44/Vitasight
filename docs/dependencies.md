# Vitasight dependency notices

The monitoring, optical pulse, and review logic was written for this independent repository. Feature inspiration includes `ompatelmed/ed-physical-ai` and `matnvd/HackPrincetonS26-VITAL`. The dark video-first frontend layout and navigation are adapted from [VITAL](https://github.com/matnvd/HackPrincetonS26-VITAL); its [MIT copyright and permission notice](third-party/VITAL-LICENSE.txt) is retained. No upstream Git history was imported.

Dependencies keep their own licenses. The npm lockfile records installed versions; package distributions contain their license texts.

- React, Express, Vite, Zod, and tsx: MIT.
- TypeScript and Playwright: Apache-2.0.
- Lucide icons: ISC.
- MediaPipe Tasks Vision and the canonical face mesh: Apache-2.0. Face model and mesh download URLs and SHA-256 hashes are recorded in ignored `public/vision/provenance.json`; runtime assets are served locally.
- Node.js includes SQLite; consult the Node.js distribution notices.
- Optional vision stack: Ultralytics, PyTorch, torchvision, OpenCV, NumPy, SciPy, lap, and their dependencies.
- Ultralytics code and YOLO weights: [AGPL-3.0 or commercial licensing](https://www.ultralytics.com/license). A fresh Git history does not remove dependency license obligations. Review the upstream terms before redistribution or proprietary product deployment.

Vision setup records the weight URL and SHA-256 in ignored `.models/provenance.json`. The model weights and third-party Python packages are not committed to this repository. No source-code distribution license has been selected for this new local project.

The pulse pipeline is an independent TypeScript implementation of the POS equations in [Wang et al., Algorithmic Principles of Remote-PPG](https://pure.tue.nl/ws/files/31563684/TBME_00467_2016_R1_preprint.pdf), with bandpass filtering and STFT analysis following the sequence explored by [the requested 2026 conference paper](https://ieeexplore.ieee.org/abstract/document/11714620). The paper's published clinical error metrics do not apply to this implementation. Face tracking uses [Google's Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker).
