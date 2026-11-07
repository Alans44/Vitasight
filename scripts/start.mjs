import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
if (
  spawnSync(npm, ["run", "build"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  }).status !== 0
)
  process.exit(1);
const python =
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python";
const visionReady = existsSync(python) && existsSync(".models/yolo11n-pose.pt");
let vision;
if (visionReady)
  vision = spawn(python, ["vision/service.py"], { stdio: "inherit" });
else
  console.log(
    "Starting demo workspace. Optional camera/video support: npm run vision:setup",
  );
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "server/index.ts"],
  { stdio: "inherit" },
);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.kill();
  vision?.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => {
  vision?.kill();
  process.exit(code || 0);
});
vision?.on("exit", () => {
  if (!stopping)
    console.warn("Vision service stopped; demo mode remains available.");
});
