import { test } from "node:test";
import assert from "node:assert/strict";
import { estimatePulse, PulseBuffer, type RGBSample } from "../src/rppg.ts";

function fixture(bpm: number, jitter = false): RGBSample[] {
  return Array.from({ length: 601 }, (_, i) => {
    const time = (i * 1000) / 30 + (jitter ? 4 * Math.sin(i * 1.7) : 0),
      t = time / 1000;
    const pulse = Math.sin(((2 * Math.PI * bpm) / 60) * t),
      light = 1 + 0.04 * Math.sin(2 * Math.PI * 0.13 * t);
    return {
      time,
      rgb: [
        170 * (1 + 0.0033 * pulse) * light,
        110 * (1 + 0.0077 * pulse) * light,
        85 * (1 + 0.0053 * pulse) * light,
      ],
    };
  });
}
test("POS, bandpass and STFT recover different pulse rates with shared lighting drift", () => {
  for (const bpm of [54, 72, 96, 132, 168]) {
    const result = estimatePulse(fixture(bpm, true));
    assert.equal(result.status, "tracking");
    assert.ok(
      Math.abs(result.bpm! - bpm) <= 2,
      `Expected ${bpm}, got ${result.bpm}`,
    );
    assert.ok(result.waveform.length > 0 && result.spectrogram.length > 0);
  }
});
test("missing, short, undersampled, flat, and interrupted RGB signals do not produce BPM", () => {
  assert.equal(estimatePulse([]).bpm, null);
  assert.equal(estimatePulse(fixture(72).slice(0, 100)).bpm, null);
  assert.equal(
    estimatePulse(fixture(72).filter((_, i) => i % 4 === 0)).bpm,
    null,
  );
  assert.equal(
    estimatePulse(fixture(72).map((s) => ({ ...s, rgb: [150, 110, 90] }))).bpm,
    null,
  );
  assert.equal(
    estimatePulse(fixture(72).filter((s) => s.time < 8000 || s.time > 10000))
      .bpm,
    null,
  );
});

test("a usable eight-second RGB window can produce the first measured reading", () => {
  const result = estimatePulse(
    fixture(72, true).filter((sample) => sample.time <= 8200),
  );
  assert.equal(result.status, "tracking");
  assert.ok(Math.abs(result.bpm! - 72) <= 2);
});
test("buffers reset after missing frames and never combine independent people's signals", () => {
  const a = new PulseBuffer(),
    b = new PulseBuffer();
  fixture(66).forEach((s) => a.push(s));
  fixture(114).forEach((s) => b.push(s));
  assert.ok(Math.abs(a.read().bpm! - 66) <= 2);
  assert.ok(Math.abs(b.read().bpm! - 114) <= 2);
  a.push({ time: 22000, rgb: [150, 110, 90] });
  assert.equal(a.read().bpm, null);
  assert.equal(a.samples.length, 1);
  a.push({ time: 21999, rgb: [150, 110, 90] });
  assert.equal(a.samples.length, 1);
});
