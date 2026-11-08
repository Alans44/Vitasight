import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleSkin } from "../src/usePulse.ts";

test("RGB sampling averages the selected polygon rather than the surrounding frame", () => {
  const data = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const offset = (y * 64 + x) * 4,
        selected = x >= 16 && x < 48 && y >= 16 && y < 48;
      data.set(selected ? [80, 100, 120, 255] : [220, 180, 140, 255], offset);
    }
  const image = { data, width: 64, height: 64 } as ImageData;
  const region = [
    { x: 0.25, y: 0.25 },
    { x: 0.75, y: 0.25 },
    { x: 0.75, y: 0.75 },
    { x: 0.25, y: 0.75 },
  ];
  assert.deepEqual(sampleSkin(image, [region]), [80, 100, 120]);
  data.fill(255);
  assert.equal(sampleSkin(image, [region]), null);
  data.fill(0);
  assert.equal(sampleSkin(image, [region]), null);
});
