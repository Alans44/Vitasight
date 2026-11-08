export type RGBSample = { time: number; rgb: [number, number, number] };
export type PulseReading = {
  bpm: number | null;
  status: "acquiring" | "tracking" | "unstable";
  seconds: number;
  fps: number;
  strength: number;
  waveform: number[];
  spectrum: number[];
  spectrogram: number[][];
};

export const MIN_PULSE_SECONDS = 8;
const RATE = 20;
const LOW = 0.7;
const HIGH = 3;
const mean = (a: number[]) =>
  a.reduce((sum, x) => sum + x, 0) / Math.max(1, a.length);
const deviation = (a: number[]) => {
  const center = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - center) ** 2)));
};
const empty = (seconds = 0, fps = 0): PulseReading => ({
  bpm: null,
  status: "acquiring",
  seconds,
  fps,
  strength: 0,
  waveform: [],
  spectrum: [],
  spectrogram: [],
});

export function pos(
  samples: [number, number, number][],
  rate: number,
): number[] {
  const size = Math.round(1.6 * rate),
    result = Array(samples.length).fill(0),
    weights = Array(samples.length).fill(0);
  for (let end = size; end <= samples.length; end++) {
    const start = end - size,
      window = samples.slice(start, end);
    const averages = [0, 1, 2].map((channel) =>
      mean(window.map((p) => p[channel])),
    );
    const normalized = window.map((p) =>
      p.map((v, i) => v / Math.max(1e-9, averages[i])),
    );
    const s1 = normalized.map((p) => p[1] - p[2]),
      s2 = normalized.map((p) => -2 * p[0] + p[1] + p[2]);
    const alpha = deviation(s1) / Math.max(1e-9, deviation(s2));
    const pulse = s1.map((value, i) => value + alpha * s2[i]),
      average = mean(pulse);
    for (let i = 0; i < size; i++) {
      result[start + i] += pulse[i] - average;
      weights[start + i]++;
    }
  }
  return result.map((value, i) => value / Math.max(1, weights[i]));
}

function biquad(
  values: number[],
  rate: number,
  cutoff: number,
  highpass: boolean,
): number[] {
  const w = (2 * Math.PI * cutoff) / rate,
    c = Math.cos(w),
    alpha = Math.sin(w) / Math.SQRT2;
  const a0 = 1 + alpha,
    a1 = (-2 * c) / a0,
    a2 = (1 - alpha) / a0;
  const b0 = (highpass ? (1 + c) / 2 : (1 - c) / 2) / a0,
    b1 = (highpass ? -(1 + c) : 1 - c) / a0,
    b2 = b0;
  let x1 = values[0] || 0,
    x2 = x1,
    y1 = highpass ? 0 : x1,
    y2 = y1;
  return values.map((x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  });
}
export function bandpass(values: number[], rate = RATE): number[] {
  const forward = biquad(biquad(values, rate, LOW, true), rate, HIGH, false);
  return biquad(
    biquad(forward.reverse(), rate, LOW, true),
    rate,
    HIGH,
    false,
  ).reverse();
}

function powerSpectrum(values: number[], rate: number): number[] {
  const center = mean(values),
    tapered = values.map(
      (v, i) =>
        (v - center) *
        (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (values.length - 1))),
    );
  return Array.from({ length: 139 }, (_, bin) => {
    const omega = (2 * Math.PI * ((bin + 42) / 60)) / rate,
      cosine = Math.cos(omega),
      sine = Math.sin(omega);
    let re = 0,
      im = 0,
      c = 1,
      s = 0;
    for (const value of tapered) {
      re += value * c;
      im -= value * s;
      const next = c * cosine - s * sine;
      s = s * cosine + c * sine;
      c = next;
    }
    return re * re + im * im;
  });
}

export function estimatePulse(input: RGBSample[]): PulseReading {
  if (input.length < 2) return empty();
  const samples = input.filter(
    (s) => s.time >= input[input.length - 1].time - 20000,
  );
  const seconds = (samples.at(-1)!.time - samples[0].time) / 1000,
    fps = (samples.length - 1) / Math.max(0.001, seconds);
  const result = empty(seconds, fps);
  if (seconds < MIN_PULSE_SECONDS || fps < 10) return result;
  if (
    samples.some(
      (p, i) =>
        i > 0 &&
        (p.time <= samples[i - 1].time || p.time - samples[i - 1].time > 300),
    )
  )
    return { ...result, status: "unstable" };
  const resampled: [number, number, number][] = [];
  let cursor = 0;
  for (
    let time = samples[0].time;
    time <= samples.at(-1)!.time;
    time += 1000 / RATE
  ) {
    while (cursor < samples.length - 2 && samples[cursor + 1].time < time)
      cursor++;
    const a = samples[cursor],
      b = samples[cursor + 1],
      weight = (time - a.time) / (b.time - a.time);
    resampled.push(
      a.rgb.map((v, i) => v + (b.rgb[i] - v) * weight) as [
        number,
        number,
        number,
      ],
    );
  }
  const pulse = bandpass(pos(resampled, RATE));
  const scale = deviation(pulse);
  result.waveform = pulse
    .slice(-RATE * 6)
    .map((v) => Math.max(-3, Math.min(3, v / Math.max(1e-8, scale))));
  if (scale < 1e-5) return { ...result, status: "unstable" };
  const window = RATE * 8,
    spectra: number[][] = [];
  for (let end = pulse.length - 2 * RATE; end <= pulse.length; end += RATE)
    if (end >= window)
      spectra.push(powerSpectrum(pulse.slice(end - window, end), RATE));
  if (!spectra.length) return result;
  const recent = spectra.slice(-3),
    spectrum = recent[0].map((_, i) => mean(recent.map((s) => s[i])));
  const peak = Math.max(...spectrum),
    index = spectrum.indexOf(peak),
    total = spectrum.reduce((a, b) => a + b, 0);
  const nearby = spectrum
    .slice(Math.max(0, index - 6), index + 7)
    .reduce((a, b) => a + b, 0);
  result.strength = nearby / Math.max(1e-12, total);
  result.spectrum = spectrum.map((x) => x / Math.max(1e-12, peak));
  result.spectrogram = spectra.slice(-12).map((s) => {
    const max = Math.max(...s);
    return s.map((v) => v / Math.max(1e-12, max));
  });
  const median = [...spectrum].sort((a, b) => a - b)[
    Math.floor(spectrum.length / 2)
  ];
  if (
    result.strength < 0.35 ||
    peak < median * 6 ||
    index < 3 ||
    index > spectrum.length - 4
  )
    return { ...result, status: "unstable" };
  result.bpm = index + 42;
  result.status = "tracking";
  return result;
}

export class PulseBuffer {
  samples: RGBSample[] = [];
  push(sample: RGBSample) {
    if (
      !Number.isFinite(sample.time) ||
      sample.rgb.some((v) => !Number.isFinite(v) || v <= 0 || v > 255)
    )
      return;
    const previous = this.samples.at(-1);
    if (previous && sample.time <= previous.time) return;
    if (previous && sample.time - previous.time > 500) this.samples = [];
    this.samples.push(sample);
    while (this.samples.length && this.samples[0].time < sample.time - 20000)
      this.samples.shift();
  }
  reset() {
    this.samples = [];
  }
  read() {
    return estimatePulse(this.samples);
  }
}

export function sceneRGB(
  time: number,
  bpm: number,
  phase = 0,
): [number, number, number] {
  const t = time / 1000,
    pulse =
      Math.sin(((2 * Math.PI * bpm) / 60) * t + phase) +
      0.2 * Math.sin(((4 * Math.PI * bpm) / 60) * t + phase);
  const lighting = 1 + 0.025 * Math.sin(2 * Math.PI * 0.12 * t);
  return [
    154 * (1 + 0.002 * pulse) * lighting,
    114 * (1 + 0.008 * pulse) * lighting,
    86 * (1 + 0.001 * pulse) * lighting,
  ];
}
