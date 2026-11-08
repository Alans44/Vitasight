import { test } from "node:test";
import assert from "node:assert/strict";
import type { Detection } from "../shared/contracts.ts";
import {
  createPostureMemory,
  isSeated,
  POSTURE_CONSTANTS,
  updatePosture,
} from "../server/posture-rules.ts";
function blank(x = 0.2): Detection {
  const points = Array.from({ length: 17 }, () => ({
    x: x + 0.05,
    y: 0.5,
    confidence: 0.95,
  }));
  return { id: "1", box: [x, 0.05, 0.15, 0.9], points };
}
function seatedPose(x = 0.2): Detection {
  const d = blank(x);
  d.points[0] = { x: x + 0.05, y: 0.18, confidence: 0.95 };
  for (const i of [3, 4])
    d.points[i] = { x: x + 0.05, y: 0.2, confidence: 0.95 };
  for (const i of [5, 6])
    d.points[i] = { x: x + 0.05, y: 0.25, confidence: 0.95 };
  for (const i of [9, 10])
    d.points[i] = { x: x + 0.08, y: 0.4, confidence: 0.95 };
  for (const i of [11, 12])
    d.points[i] = { x: x + 0.05, y: 0.58, confidence: 0.95 };
  for (const i of [13, 14])
    d.points[i] = { x: x + 0.08, y: 0.62, confidence: 0.95 };
  for (const i of [15, 16])
    d.points[i] = { x: x + 0.05, y: 0.72, confidence: 0.95 };
  return d;
}
function potentialSlumpPose(x = 0.2): Detection {
  const d = seatedPose(x);
  d.points[0] = { x: x + 0.05, y: 0.28, confidence: 0.95 };
  for (const i of [3, 4])
    d.points[i] = { x: x + 0.05, y: 0.29, confidence: 0.95 };
  return d;
}
function collapsedTorsoPose(x = 0.2): Detection {
  const d = seatedPose(x);
  for (const i of [5, 6])
    d.points[i] = { x: x + 0.05, y: 0.52, confidence: 0.95 };
  d.points[0] = { x: x + 0.05, y: 0.5, confidence: 0.95 };
  for (const i of [3, 4])
    d.points[i] = { x: x + 0.05, y: 0.51, confidence: 0.95 };
  for (const i of [9, 10])
    d.points[i] = { x: x + 0.08, y: 0.55, confidence: 0.95 };
  return d;
}
function standingPose(x = 0.2): Detection {
  const d = blank(x);
  d.box = [x, 0.05, 0.15, 0.9];
  d.points[0] = { x: x + 0.05, y: 0.12, confidence: 0.95 };
  for (const i of [3, 4])
    d.points[i] = { x: x + 0.05, y: 0.14, confidence: 0.95 };
  for (const i of [5, 6])
    d.points[i] = { x: x + 0.05, y: 0.22, confidence: 0.95 };
  for (const i of [9, 10])
    d.points[i] = { x: x + 0.08, y: 0.4, confidence: 0.95 };
  for (const i of [11, 12])
    d.points[i] = { x: x + 0.05, y: 0.48, confidence: 0.95 };
  for (const i of [13, 14])
    d.points[i] = { x: x + 0.06, y: 0.7, confidence: 0.95 };
  for (const i of [15, 16])
    d.points[i] = { x: x + 0.05, y: 0.9, confidence: 0.95 };
  return d;
}
function fallenPose(x = 0.2): Detection {
  const d = standingPose(x);
  d.points[0] = { x: x + 0.05, y: 0.86, confidence: 0.95 };
  for (const i of [3, 4])
    d.points[i] = { x: x + 0.05, y: 0.87, confidence: 0.95 };
  for (const i of [5, 6])
    d.points[i] = { x: x + 0.05, y: 0.8, confidence: 0.95 };
  for (const i of [11, 12])
    d.points[i] = { x: x + 0.05, y: 0.84, confidence: 0.95 };
  return d;
}
test("isSeated: folded thighs vs standing legs", () => {
  const seated = seatedPose();
  const hips = {
    x: (seated.points[11].x + seated.points[12].x) / 2,
    y: (seated.points[11].y + seated.points[12].y) / 2,
    confidence: 0.95,
  };
  const knees = {
    x: (seated.points[13].x + seated.points[14].x) / 2,
    y: (seated.points[13].y + seated.points[14].y) / 2,
    confidence: 0.95,
  };
  const shoulders = {
    x: (seated.points[5].x + seated.points[6].x) / 2,
    y: (seated.points[5].y + seated.points[6].y) / 2,
    confidence: 0.95,
  };
  const torso = hips.y - shoulders.y;
  assert.equal(isSeated(hips, knees, undefined, torso, 0.9), true);
  const standing = standingPose();
  const sHips = {
    x: (standing.points[11].x + standing.points[12].x) / 2,
    y: (standing.points[11].y + standing.points[12].y) / 2,
    confidence: 0.95,
  };
  const sKnees = {
    x: (standing.points[13].x + standing.points[14].x) / 2,
    y: (standing.points[13].y + standing.points[14].y) / 2,
    confidence: 0.95,
  };
  const sShoulders = {
    x: (standing.points[5].x + standing.points[6].x) / 2,
    y: (standing.points[5].y + standing.points[6].y) / 2,
    confidence: 0.95,
  };
  assert.equal(
    isSeated(sHips, sKnees, undefined, sHips.y - sShoulders.y, 0.9),
    false,
  );
});
test("seated upright reports seated; standing does not", () => {
  const memory = createPostureMemory();
  let seatedFlag = false;
  for (let at = 10000; at < 12000; at += 100) {
    const r = updatePosture(memory, seatedPose(), false, at);
    if (r.seated) seatedFlag = true;
  }
  assert.equal(seatedFlag, true);
  const standMem = createPostureMemory();
  let standingSeated = true;
  for (let at = 10000; at < 12000; at += 100) {
    const r = updatePosture(standMem, standingPose(), false, at);
    standingSeated = r.seated;
  }
  assert.equal(standingSeated, false);
});
test("potential slump escalates to SLUMP after 3s hold", () => {
  const memory = createPostureMemory();
  for (let at = 10000; at < 12000; at += 100)
    updatePosture(memory, seatedPose(), false, at);
  let sawPotential = false;
  for (let at = 12000; at < 14000; at += 100) {
    const r = updatePosture(memory, potentialSlumpPose(), false, at);
    if (r.potentialSlump) sawPotential = true;
    assert.equal(r.liveSlump, false);
    assert.equal(r.slumpDetected, false);
  }
  assert.equal(sawPotential, true);
  let sawFull = false;
  for (let at = 14000; at <= 16000; at += 100) {
    const r = updatePosture(memory, potentialSlumpPose(), false, at);
    if (r.liveSlump) sawFull = true;
  }
  assert.equal(sawFull, true);
  assert.equal(memory.slumpLatched, true);
});
test("upright seated does not trigger torso-collapse potential", () => {
  const memory = createPostureMemory();
  for (let at = 10000; at < 14000; at += 100) {
    const r = updatePosture(memory, seatedPose(), false, at);
    assert.equal(r.potentialSlump, false);
    assert.equal(r.liveSlump, false);
    assert.ok(
      (r.headTorso ?? 0) < POSTURE_CONSTANTS.POTENTIAL_HEAD_TORSO ||
        r.headTorso === null ||
        r.headTorso < 0,
    );
  }
  const scale = 0.9;
  const upright = seatedPose();
  const gap =
    Math.hypot(
      upright.points[5].x - upright.points[11].x,
      upright.points[5].y - upright.points[11].y,
    ) / scale;
  assert.ok(gap > POSTURE_CONSTANTS.TORSO_COLLAPSE);
});
test("torso collapse while seated escalates to SLUMP after 3s", () => {
  const memory = createPostureMemory();
  for (let at = 10000; at < 12000; at += 100)
    updatePosture(memory, seatedPose(), false, at);
  let sawPotential = false;
  for (let at = 12000; at < 14000; at += 100) {
    const r = updatePosture(memory, collapsedTorsoPose(), false, at);
    if (r.potentialSlump) sawPotential = true;
    assert.equal(r.liveSlump, false);
    assert.equal(r.slumpDetected, false);
  }
  assert.equal(sawPotential, true);
  let sawFull = false;
  for (let at = 14000; at <= 16000; at += 100) {
    const r = updatePosture(memory, collapsedTorsoPose(), false, at);
    if (r.liveSlump) sawFull = true;
  }
  assert.equal(sawFull, true);
  assert.equal(memory.slumpLatched, true);
});
test("slump and fall stay sticky on overlay after recovery", () => {
  const memory = createPostureMemory();
  for (let at = 10000; at < 12000; at += 100)
    updatePosture(memory, seatedPose(), false, at);
  for (let at = 12000; at <= 16000; at += 100)
    updatePosture(memory, potentialSlumpPose(), false, at);
  assert.equal(memory.slumpLatched, true);
  const upright = updatePosture(memory, seatedPose(), false, 17000);
  assert.equal(upright.liveSlump, false);
  assert.equal(upright.slumpDetected, true);
  assert.equal(upright.potentialSlump, false);
  const fallMem = createPostureMemory();
  for (let at = 10000; at < 12000; at += 100)
    updatePosture(fallMem, standingPose(), false, at);
  for (let at = 12000; at <= 12500; at += 50)
    updatePosture(fallMem, fallenPose(), false, at);
  assert.equal(fallMem.fallLatched, true);
  let liveCleared = false;
  for (let at = 13000; at <= 15000; at += 100) {
    const recovered = updatePosture(fallMem, standingPose(), false, at);
    assert.equal(recovered.fallDetected, true);
    if (!recovered.liveFall) liveCleared = true;
  }
  assert.equal(liveCleared, true);
});
test("rapid head-to-ankle collapse sets fall; slow drop does not", () => {
  const fast = createPostureMemory();
  for (let at = 10000; at < 12000; at += 100)
    updatePosture(fast, standingPose(), false, at);
  let sawFall = false;
  for (let at = 12000; at <= 12500; at += 50) {
    const r = updatePosture(fast, fallenPose(), false, at);
    if (r.liveFall) sawFall = true;
  }
  assert.equal(sawFall, true);
  const slow = createPostureMemory();
  for (let at = 10000; at < 12000; at += 100)
    updatePosture(slow, standingPose(), false, at);
  for (let step = 0; step <= 40; step++) {
    const at = 12000 + step * 200;
    const pose = standingPose();
    const y = 0.12 + (0.86 - 0.12) * (step / 40);
    pose.points[0].y = y;
    for (const i of [3, 4]) pose.points[i].y = y + 0.01;
    const r = updatePosture(slow, pose, false, at);
    if (step < 35) assert.equal(r.liveFall, false);
  }
});
test("bounding-box collapse sets fall when ankles are unreliable", () => {
  const memory = createPostureMemory();
  for (let at = 10000; at < 12000; at += 100)
    updatePosture(memory, standingPose(), false, at);
  let sawFall = false;
  for (let at = 12000; at <= 13000; at += 50) {
    const onFloor = standingPose();
    onFloor.box = [0.15, 0.55, 0.45, 0.35];
    for (const i of [15, 16]) onFloor.points[i].confidence = 0.1;
    for (const i of [0, 3, 4]) onFloor.points[i].confidence = 0.1;
    const r = updatePosture(memory, onFloor, false, at);
    if (r.liveFall) sawFall = true;
  }
  assert.equal(sawFall, true);
});
