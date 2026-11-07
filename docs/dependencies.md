# Dependency notices

Application source was written for this independent repository. Feature inspiration: `ompatelmed/ed-physical-ai` and `matnvd/HackPrincetonS26-VITAL`; their Git histories and application source files were not copied into this project.

Dependencies keep their own licenses. The npm lockfile records installed versions; package distributions contain their license texts.

- React, Express, Vite, Zod, and tsx: MIT.
- TypeScript and Playwright: Apache-2.0.
- Lucide icons: ISC.
- Node.js includes SQLite; consult the Node.js distribution notices.
- Optional vision stack: Ultralytics, PyTorch, torchvision, OpenCV, NumPy, SciPy, lap, and their dependencies.
- Ultralytics code and YOLO weights: [AGPL-3.0 or commercial licensing](https://www.ultralytics.com/license). A fresh Git history does not remove dependency license obligations. Review the upstream terms before redistribution or proprietary product deployment.

Vision setup records the weight URL and SHA-256 in ignored `.models/provenance.json`. The model weights and third-party Python packages are not committed to this repository. No source-code distribution license has been selected for this new local project.
