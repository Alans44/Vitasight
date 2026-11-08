import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PulsePresenter,
  scenePresentation,
} from "../src/pulse-presentation.ts";
import type { PulseReading } from "../src/rppg.ts";

const weak: PulseReading = {
  bpm: null,
  status: "acquiring",
  seconds: 0,
  fps: 20,
  strength: 0,
  waveform: [],
  spectrum: [],
  spectrogram: [],
};
const measured = (bpm: number): PulseReading => ({
  ...weak,
  bpm,
  status: "tracking",
  strength: 0.8,
});
test("weak signals receive immediate approximate values without becoming measured readings", () => {
  const presenter = new PulsePresenter(74),
    first = presenter.update(weak, 0),
    next = presenter.update(weak, 200);
  assert.equal(first.origin, "simulated");
  assert.equal(first.rawBpm, null);
  assert.equal(first.strength, 0);
  assert.ok(first.bpm! >= 73 && first.bpm! <= 75);
  assert.ok(Math.abs(first.bpm! - next.bpm!) <= 1);
  assert.ok(first.waveform.length > 0 && first.spectrum.length > 0);
});
test("measured signals are smoothed without forcing high pulse rates into a normal range", () => {
  const presenter = new PulsePresenter();
  const first = presenter.update(measured(158), 0);
  assert.equal(first.bpm, 158);
  assert.equal(first.origin, "measured");
  const changed = presenter.update(measured(90), 100);
  assert.ok(changed.bpm! >= 157);
  assert.equal(changed.rawBpm, 90);
});
test("brief dropouts hold the last signal, then switch to explicitly simulated values", () => {
  const presenter = new PulsePresenter();
  presenter.update(measured(104), 0);
  const held = presenter.update(weak, 2000);
  assert.equal(held.origin, "held");
  assert.equal(held.bpm, 104);
  assert.equal(held.rawBpm, null);
  const simulated = presenter.update(weak, 7000);
  assert.equal(simulated.origin, "simulated");
  assert.ok(Math.abs(simulated.bpm! - 104) <= 1);
  const another = new PulsePresenter(72);
  assert.equal(another.update(weak, 0).bpm, 72);
});

test("displayed BPM varies within two beats while measured and smoothed values stay intact", () => {
  const presenter = new PulsePresenter();
  const liveValues = new Set<number>(),
    sceneValues = new Set<number>();
  for (let time = 0; time <= 12000; time += 400) {
    const live = presenter.update(measured(72), time);
    const scene = scenePresentation(measured(86), time, 1.7);
    assert.equal(live.rawBpm, 72);
    assert.equal(live.bpm, 72);
    assert.ok(Math.abs(live.displayBpm! - 72) <= 2);
    assert.ok(Math.abs(scene.displayBpm! - 86) <= 2);
    liveValues.add(live.displayBpm!);
    sceneValues.add(scene.displayBpm!);
  }
  assert.ok(liveValues.size >= 3);
  assert.ok(sceneValues.size >= 3);
  assert.equal(scenePresentation(weak, 1000).displayBpm, null);
});
