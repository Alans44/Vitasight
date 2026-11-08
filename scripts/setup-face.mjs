import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../public/vision/", import.meta.url);
await mkdir(root, { recursive: true });
await cp(
  new URL("../node_modules/@mediapipe/tasks-vision/wasm/", import.meta.url),
  new URL("wasm/", root),
  { recursive: true },
);
async function asset(name, url, expected) {
  const file = new URL(name, root);
  if (!existsSync(file)) {
    const response = await fetch(url);
    if (!response.ok)
      throw Error(`Face asset download failed: ${response.status}`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
  const sha256 = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  if (sha256 !== expected) throw Error(`Face asset checksum mismatch: ${name}`);
  return { url, sha256 };
}
const model = await asset(
  "face_landmarker.task",
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
);
const canonical = await asset(
  "canonical_face_model.obj",
  "https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj",
  "8bac80443397e113f41a8b565ea72c59390bc031d9defab289dba7bc0c54e618",
);
const lines = (
  await readFile(new URL("canonical_face_model.obj", root), "utf8")
).split("\n");
const vertices = lines
  .filter((line) => line.startsWith("v "))
  .map((line) => line.trim().split(/\s+/).slice(1).map(Number));
if (vertices.length !== 468) throw Error("Unexpected canonical face topology");
const minX = Math.min(...vertices.map((v) => v[0])),
  maxX = Math.max(...vertices.map((v) => v[0]));
const minY = Math.min(...vertices.map((v) => v[1])),
  maxY = Math.max(...vertices.map((v) => v[1]));
const landmarks = vertices.map(([x, y, z]) => ({
  x: (x - minX) / (maxX - minX),
  y: 1 - (y - minY) / (maxY - minY),
  z: z / (maxX - minX),
}));
const edgeSet = new Set();
for (const line of lines.filter((value) => value.startsWith("f "))) {
  const face = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((value) => Number(value.split("/")[0]) - 1);
  for (let i = 0; i < face.length; i++)
    edgeSet.add(
      [face[i], face[(i + 1) % face.length]].sort((a, b) => a - b).join(","),
    );
}
await writeFile(
  new URL("face-template.json", root),
  JSON.stringify({
    landmarks,
    edges: [...edgeSet].map((value) => value.split(",").map(Number)),
  }),
);
await writeFile(
  new URL("provenance.json", root),
  JSON.stringify(
    {
      model,
      canonical,
      license: "MediaPipe Apache-2.0; see upstream model card",
    },
    null,
    2,
  ) + "\n",
);
console.log("Vitasight face landmarks and runtime assets ready.");
