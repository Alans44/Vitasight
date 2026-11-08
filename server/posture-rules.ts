import type { Detection } from "../shared/contracts.ts";

type Point = { x: number; y: number; confidence: number };
type Sample = {
  at: number;
  seated: boolean;
  headTorso: number;
  /** Mid-shoulder to mid-hip Euclidean gap / box height. */
  shoulderHipGap: number;
  headAnkle: number | null;
  shoulderAnkle: number | null;
  boxH: number;
  boxCy: number;
};

export type PostureMemory = {
  history: Sample[];
  potentialSince: number;
  fallSince: number;
  fallClearSince: number;
  slumpLatched: boolean;
  fallLatched: boolean;
  slumpEpisode: boolean;
  fallEpisode: boolean;
  lastSeen: number;
};

export type PostureFlags = {
  quality: number;
  score: number | null;
  /** Instantaneous head-to-torso ratio this frame (null if unusable). */
  headTorso: number | null;
  seated: boolean;
  potentialSlump: boolean;
  /** Live full-slump this frame (before sticky latch). */
  liveSlump: boolean;
  /** Sticky for overlay once identified. */
  slumpDetected: boolean;
  /** Live fall latch this frame (ed recovery rules). */
  liveFall: boolean;
  /** Sticky for overlay once identified. */
  fallDetected: boolean;
};

const VIS = 0.6;
/** Head at/below shoulder line → potential slump. */
const POTENTIAL_HEAD_TORSO = 0.02;
/** Head into lower half of torso (toward hips) → deeper full-zone. */
const FULL_HEAD_TORSO = 0.45;
/**
 * Mid-shoulder within this fraction of box height of mid-hip → torso collapsed
 * (upper torso in the general area of lower torso).
 */
const TORSO_COLLAPSE = 0.28;
/** Potential → full SLUMP after this hold. */
const POTENTIAL_TO_SLUMP_MS = 3000;
/** Rapid head/shoulder→ankle or box collapse window and thresholds. */
const FALL_WINDOW_MS = 1500;
const FALL_COLLAPSE = 0.35;
const FALL_NEAR_ANKLES = 0.25;
const FALL_CLEAR_GAP = 0.35;
const FALL_CLEAR_MS = 1000;
const FALL_BOX_HEIGHT_COLLAPSE = 0.2;
const FALL_BOX_CENTER_DROP = 0.15;

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const visible = (p?: Point) => (p?.confidence ?? 0) > VIS;
const mid = (a?: Point, b?: Point) =>
  a && b
    ? {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        confidence: Math.min(a.confidence, b.confidence),
      }
    : undefined;

/** Seated when hips are close to knees (folded thighs), with ankle fallback. */
export function isSeated(
  hips: Point,
  knees: Point | undefined,
  ankles: Point | undefined,
  torsoLen: number,
  scale: number,
): boolean {
  if (knees && visible(knees)) {
    const hipKnee = Math.max(0, knees.y - hips.y);
    return hipKnee < Math.max(torsoLen * 0.65, scale * 0.2);
  }
  if (ankles && visible(ankles)) {
    const hipAnkle = Math.max(0, ankles.y - hips.y);
    return hipAnkle < Math.max(torsoLen * 1.1, scale * 0.35);
  }
  return torsoLen < scale * 0.55;
}

export function createPostureMemory(): PostureMemory {
  return {
    history: [],
    potentialSince: 0,
    fallSince: 0,
    fallClearSince: 0,
    slumpLatched: false,
    fallLatched: false,
    slumpEpisode: false,
    fallEpisode: false,
    lastSeen: 0,
  };
}

export function updatePosture(
  memory: PostureMemory,
  detection: Detection,
  ambiguous: boolean,
  now: number,
  detectionQuality = 0.95,
): PostureFlags {
  const points = detection.points as Point[];
  const postureOk =
    visible(points[5]) &&
    visible(points[6]) &&
    visible(points[11]) &&
    visible(points[12]);
  const anklesOk = visible(points[15]) && visible(points[16]);
  const headOk =
    visible(points[0]) || (visible(points[3]) && visible(points[4]));
  const fallOk = postureOk && anklesOk && headOk;
  const postureQuality = postureOk
    ? detectionQuality
    : Math.min(detectionQuality, 0.4);
  const fallQuality = fallOk ? detectionQuality : Math.min(detectionQuality, 0.4);
  const quality = Math.max(postureQuality, fallQuality);

  const scale = Math.max(detection.box[3], 0.1);
  const shoulders = mid(points[5], points[6]);
  const hips = mid(points[11], points[12]);
  const knees = mid(points[13], points[14]);
  const ankles = mid(points[15], points[16]);
  const ears = mid(points[3], points[4]);

  let seated = false;
  let headTorso = 0;
  let shoulderHipGap = 1;
  let headAnkle: number | null = null;
  let shoulderAnkle: number | null = null;
  let head = shoulders;

  if (shoulders && hips) {
    head = visible(points[0])
      ? points[0]
      : ears && visible(ears)
        ? ears
        : shoulders;
    const torsoLen = Math.max(0.001, hips.y - shoulders.y);
    seated = isSeated(hips, knees, ankles, torsoLen, scale);
    headTorso = (head.y - shoulders.y) / torsoLen;
    shoulderHipGap =
      Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y) / scale;
    headAnkle =
      ankles && visible(ankles)
        ? Math.max(0, ankles.y - head.y) / scale
        : null;
    shoulderAnkle =
      ankles && visible(ankles)
        ? Math.max(0, ankles.y - shoulders.y) / scale
        : null;
  }

  const boxH = detection.box[3];
  const boxCy = detection.box[1] + detection.box[3] / 2;
  const sampleOk = postureOk && postureQuality >= 0.6 && !ambiguous;
  const last = memory.history[memory.history.length - 1];
  if (sampleOk || (!ambiguous && boxH > 0.05)) {
    memory.history.push({
      at: now,
      seated: sampleOk ? seated : (last?.seated ?? seated),
      headTorso: sampleOk ? headTorso : (last?.headTorso ?? headTorso),
      shoulderHipGap: sampleOk
        ? shoulderHipGap
        : (last?.shoulderHipGap ?? shoulderHipGap),
      headAnkle: sampleOk ? headAnkle : (last?.headAnkle ?? headAnkle),
      shoulderAnkle: sampleOk
        ? shoulderAnkle
        : (last?.shoulderAnkle ?? shoulderAnkle),
      boxH,
      boxCy,
    });
  }
  memory.history = memory.history.filter((h) => now - h.at <= 35_000);
  memory.lastSeen = now;

  const postureUsable = postureQuality >= 0.6 && !ambiguous && postureOk;
  const fallUsable =
    !ambiguous && ((fallOk && fallQuality >= 0.6) || boxH > 0.05);
  const currentWindow = memory.history.filter((h) => now - h.at <= 500);
  const curHeadTorso =
    currentWindow.length > 0
      ? mean(currentWindow.map((h) => h.headTorso))
      : headTorso;
  const curGap =
    currentWindow.length > 0
      ? mean(currentWindow.map((h) => h.shoulderHipGap))
      : shoulderHipGap;
  const seatedRecent =
    currentWindow.length > 0
      ? currentWindow.filter((h) => h.seated).length >=
        currentWindow.length * 0.6
      : seated;

  const potentialSlump =
    postureUsable &&
    seatedRecent &&
    (curHeadTorso >= POTENTIAL_HEAD_TORSO || curGap <= TORSO_COLLAPSE);
  // Instant upright (even for one frame) breaks the 3s hold so a later
  // slump can open a new review episode after recovery.
  const frameUpright =
    !postureUsable ||
    !seated ||
    (headTorso < POTENTIAL_HEAD_TORSO && shoulderHipGap > TORSO_COLLAPSE);
  if (potentialSlump && !frameUpright) {
    memory.potentialSince = memory.potentialSince || now;
  } else {
    memory.potentialSince = 0;
  }
  const liveSlump =
    !!memory.potentialSince &&
    now - memory.potentialSince >= POTENTIAL_TO_SLUMP_MS;

  const fallWindow = memory.history.filter((h) => now - h.at <= FALL_WINDOW_MS);
  const kpWindow = fallWindow.filter(
    (h) => h.headAnkle !== null || h.shoulderAnkle !== null,
  );
  const curHeadAnkle =
    headAnkle ??
    (kpWindow.length ? kpWindow[kpWindow.length - 1].headAnkle : null);
  const curShoulderAnkle =
    shoulderAnkle ??
    (kpWindow.length ? kpWindow[kpWindow.length - 1].shoulderAnkle : null);
  const refHeadAnkle = kpWindow.length >= 2 ? kpWindow[0].headAnkle : null;
  const refShoulderAnkle =
    kpWindow.length >= 2 ? kpWindow[0].shoulderAnkle : null;
  const headCollapse =
    curHeadAnkle !== null && refHeadAnkle !== null
      ? refHeadAnkle - curHeadAnkle
      : 0;
  const shoulderCollapse =
    curShoulderAnkle !== null && refShoulderAnkle !== null
      ? refShoulderAnkle - curShoulderAnkle
      : 0;
  const keypointFall =
    (curHeadAnkle !== null &&
      headCollapse >= FALL_COLLAPSE &&
      curHeadAnkle <= FALL_NEAR_ANKLES) ||
    (curShoulderAnkle !== null &&
      shoulderCollapse >= FALL_COLLAPSE &&
      curShoulderAnkle <= FALL_NEAR_ANKLES);

  const refBoxH = fallWindow.length >= 2 ? fallWindow[0].boxH : boxH;
  const refBoxCy = fallWindow.length >= 2 ? fallWindow[0].boxCy : boxCy;
  const heightCollapse = refBoxH - boxH;
  const centerDrop = boxCy - refBoxCy;
  const boxFall =
    fallWindow.length >= 2 &&
    heightCollapse >= FALL_BOX_HEIGHT_COLLAPSE &&
    centerDrop >= FALL_BOX_CENTER_DROP;

  const fallCandidate =
    fallUsable && !ambiguous && (keypointFall || boxFall);
  const gaps = [curHeadAnkle, curShoulderAnkle].filter(
    (g): g is number => g !== null,
  );
  const keypointRecovered =
    gaps.length > 0 && gaps.every((g) => g >= FALL_CLEAR_GAP);
  const boxRecovered = heightCollapse < 0.08 && centerDrop < 0.05;
  const recovered = keypointRecovered || boxRecovered;

  if (fallCandidate) {
    memory.fallSince = memory.fallSince || now;
    memory.fallClearSince = 0;
  } else if (memory.fallSince && recovered) {
    memory.fallClearSince = memory.fallClearSince || now;
    if (now - memory.fallClearSince >= FALL_CLEAR_MS) {
      memory.fallSince = 0;
      memory.fallClearSince = 0;
    }
  } else if (memory.fallSince && !recovered) {
    memory.fallClearSince = 0;
  } else if (!memory.fallSince) {
    memory.fallClearSince = 0;
  }
  const liveFall = !!memory.fallSince;

  if (liveSlump) memory.slumpLatched = true;
  if (liveFall) memory.fallLatched = true;

  const score =
    postureUsable && seatedRecent
      ? Math.max(0, Math.min(1, curHeadTorso))
      : postureUsable
        ? 0
        : null;

  return {
    quality,
    score,
    headTorso: postureOk ? headTorso : null,
    seated: sampleOk ? seated : (last?.seated ?? seated),
    potentialSlump: potentialSlump && !liveSlump && !memory.slumpLatched,
    liveSlump,
    slumpDetected: memory.slumpLatched,
    liveFall,
    fallDetected: memory.fallLatched,
  };
}

export const POSTURE_CONSTANTS = {
  POTENTIAL_HEAD_TORSO,
  FULL_HEAD_TORSO,
  TORSO_COLLAPSE,
  POTENTIAL_TO_SLUMP_MS,
  FALL_WINDOW_MS,
  FALL_COLLAPSE,
  FALL_NEAR_ANKLES,
  FALL_BOX_HEIGHT_COLLAPSE,
  FALL_BOX_CENTER_DROP,
} as const;
