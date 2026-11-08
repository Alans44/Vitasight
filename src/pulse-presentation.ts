import type { PulseReading } from "./rppg";

export type PulsePresentation = PulseReading & {
  origin: "measured" | "held" | "simulated" | "scene";
  rawBpm: number | null;
  displayBpm: number | null;
};

function animatedBpm(bpm: number | null, now: number, phase = 0) {
  if (bpm === null) return null;
  const drift =
    1.65 * Math.sin(now / 1100 + phase) + 0.35 * Math.sin(now / 2300 + phase);
  return Math.round(bpm + drift);
}

function fallbackGraphs(bpm: number, time: number) {
  const phase = time / 1000;
  return {
    waveform: Array.from(
      { length: 120 },
      (_, i) =>
        Math.sin(((2 * Math.PI * bpm) / 60) * (phase - 6 + i / 20)) +
        0.16 * Math.sin(((4 * Math.PI * bpm) / 60) * (phase - 6 + i / 20)),
    ),
    spectrum: Array.from({ length: 139 }, (_, i) =>
      Math.exp(-0.5 * ((i + 42 - bpm) / 3.5) ** 2),
    ),
  };
}

export class PulsePresenter {
  private lastGood: { bpm: number; at: number } | null = null;
  private value: number | null = null;
  private lastUpdate: number | null = null;
  constructor(private baseline = 74) {}
  update(raw: PulseReading, now: number): PulsePresentation {
    const measured = raw.status === "tracking" && raw.bpm !== null;
    if (measured) this.lastGood = { bpm: raw.bpm!, at: now };
    const held =
      !measured && this.lastGood !== null && now - this.lastGood.at <= 6000;
    const origin = measured ? "measured" : held ? "held" : "simulated";
    const target = measured
      ? raw.bpm!
      : held
        ? this.lastGood!.bpm
        : (this.lastGood?.bpm ?? this.baseline) + 0.7 * Math.sin(now / 9000);
    if (this.value === null) this.value = target;
    else {
      const dt = Math.max(
        0,
        Math.min(1, (now - (this.lastUpdate ?? now)) / 1000),
      );
      const change = (target - this.value) * (1 - Math.exp(-dt / 1.2));
      this.value += Math.max(-8 * dt, Math.min(8 * dt, change));
    }
    this.lastUpdate = now;
    const graphs = measured
      ? { waveform: raw.waveform, spectrum: raw.spectrum }
      : fallbackGraphs(this.value, now);
    return {
      ...raw,
      ...graphs,
      bpm: Math.round(this.value),
      displayBpm: animatedBpm(
        Math.round(this.value),
        now,
        this.baseline * 0.43,
      ),
      rawBpm: raw.bpm,
      origin,
      strength: measured ? raw.strength : 0,
    };
  }
}

export function scenePresentation(
  raw: PulseReading,
  now = 0,
  phase = 0,
): PulsePresentation {
  return {
    ...raw,
    origin: "scene",
    rawBpm: raw.bpm,
    displayBpm: animatedBpm(raw.bpm, now, phase),
  };
}
