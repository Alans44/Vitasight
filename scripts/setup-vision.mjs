import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
const candidates = process.env.PYTHON
  ? [process.env.PYTHON]
  : ["python3.12", "python3.11", "python3", "python"];
const python = candidates.find(
  (name) =>
    spawnSync(name, [
      "-c",
      "import sys; assert (3,11)<=sys.version_info[:2]<(3,14)",
    ]).status === 0,
);
if (!python)
  throw Error("Python 3.11–3.13 is required. Set PYTHON to its executable.");
const local =
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python";
function run(command, args) {
  const r = spawnSync(command, args, { stdio: "inherit" });
  if (r.status !== 0) throw Error("Vision setup failed");
}
if (!existsSync(local)) run(python, ["-m", "venv", ".venv"]);
run(local, [
  "-m",
  "pip",
  "install",
  "torch==2.9.1",
  "torchvision==0.24.1",
  "--index-url",
  "https://download.pytorch.org/whl/cpu",
]);
run(local, ["-m", "pip", "install", "-r", "vision/requirements.txt"]);
await mkdir(".models", { recursive: true });
const url =
  "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n-pose.pt";
const response = await fetch(url);
if (!response.ok) throw Error(`Model download failed: ${response.status}`);
const data = Buffer.from(await response.arrayBuffer());
const hash = createHash("sha256").update(data).digest("hex");
if (hash !== "869e83fcdffdc7371fa4e34cd8e51c838cc729571d1635e5141e3075e9319dc0")
  throw Error("Model checksum mismatch");
await writeFile(".models/yolo11n-pose.pt", data);
await writeFile(
  ".models/provenance.json",
  JSON.stringify(
    {
      url,
      sha256: hash,
      license: "Ultralytics AGPL-3.0 or commercial license",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Vision installed. Restart npm start to enable camera and video sources.",
);
