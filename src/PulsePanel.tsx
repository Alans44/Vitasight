import { Activity, ScanFace } from "lucide-react";
import type { Feed, Patient } from "../shared/contracts";
import { MIN_PULSE_SECONDS } from "./rppg";
import type { FaceSignal } from "./usePulse";

function wavePath(values: number[]) {
  return values
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${((i / Math.max(1, values.length - 1)) * 300).toFixed(2)},${(40 - v * 11).toFixed(2)}`,
    )
    .join(" ");
}
export default function PulsePanel({
  faces,
  feed,
  patients,
  issue,
  active,
}: {
  faces: FaceSignal[];
  feed: Feed;
  patients: Patient[];
  issue: string;
  active: boolean;
}) {
  if (!faces.length)
    return (
      <div className="pulse-empty">
        <ScanFace size={17} />
        <span>rPPG</span>
        <span>
          {active ? issue || "Position a face in view" : "Reconnect source"}
        </span>
        <code>POS / BPF / STFT</code>
      </div>
    );
  return (
    <div className="pulse-grid">
      {faces.map((face, index) => {
        const { reading } = face,
          track = feed.tracks.find((t) => t.key === face.trackKey),
          name =
            patients.find((p) => p.id === track?.patientId)?.name ||
            track?.label ||
            `Face ${index + 1}`;
        const tracking =
          reading.status === "tracking" &&
          (reading.origin === "measured" || reading.origin === "scene");
        return (
          <section
            className={`pulse-card ${tracking ? "locked" : ""} ${reading.origin}`}
            data-reading-origin={reading.origin}
            data-measured-bpm={reading.rawBpm ?? ""}
            data-smoothed-bpm={reading.bpm ?? ""}
            data-displayed-bpm={reading.displayBpm ?? ""}
            key={face.id}
            aria-label={`Pulse analysis for ${name}`}
          >
            <header>
              <span>
                <Activity size={13} />
                {name}
              </span>
              <span className="pulse-state">
                <i />
                {reading.origin === "simulated"
                  ? "Simulated"
                  : reading.origin === "held"
                    ? "Smoothed"
                    : tracking
                      ? "Tracking"
                      : reading.status === "unstable"
                        ? "Reacquiring"
                        : `${Math.min(MIN_PULSE_SECONDS, Math.floor(reading.seconds))} / ${MIN_PULSE_SECONDS}s`}
              </span>
            </header>
            <div className="pulse-body">
              <div className="pulse-number">
                <span>Heart rate</span>
                <strong
                  data-testid="pulse-bpm"
                  title="Approximate display with smooth ±2 BPM variation"
                >
                  {reading.displayBpm !== null && (
                    <span className="approximate" aria-label="Approximate">
                      ≈
                    </span>
                  )}
                  {reading.displayBpm ?? "—"}
                  <small>BPM</small>
                </strong>
                <span className="pulse-method">
                  POS · {reading.fps.toFixed(0)} Hz
                </span>
              </div>
              <div className="pulse-wave">
                <svg
                  viewBox="0 0 300 80"
                  preserveAspectRatio="none"
                  aria-label="Optical pulse waveform"
                >
                  <path
                    className="wave-grid"
                    d="M0 20H300M0 40H300M0 60H300M60 0V80M120 0V80M180 0V80M240 0V80"
                  />
                  <path className="wave-trace" d={wavePath(reading.waveform)} />
                </svg>
                <span>
                  {reading.origin === "held" || reading.origin === "simulated"
                    ? "Interpolated pulse"
                    : "Blood volume pulse"}
                </span>
              </div>
            </div>
            <div className="pulse-frequency">
              <svg
                className="pulse-spectrum"
                viewBox="0 0 300 44"
                preserveAspectRatio="none"
                aria-label="Short-time frequency spectrum"
              >
                {reading.spectrum
                  .filter((_, i) => i % 2 === 0)
                  .map((power, i) => (
                    <rect
                      key={i}
                      x={(i * 300) / 70}
                      y={40 - power * 36}
                      width="2.3"
                      height={Math.max(1, power * 36)}
                      className={
                        reading.bpm !== null &&
                        Math.abs(i * 2 + 42 - reading.bpm) < 6
                          ? "peak"
                          : ""
                      }
                    />
                  ))}
              </svg>
              <div className="spectrum-axis">
                <span>0.7 Hz</span>
                <span>STFT</span>
                <span>3.0 Hz</span>
              </div>
            </div>
            <footer>
              <span>
                <i className="signal" /> RGB → POS → BANDPASS → STFT
              </span>
              <span
                className="signal-bars"
                aria-label={`Signal strength ${Math.round(reading.strength * 100)} percent`}
              >
                {[0, 1, 2, 3, 4].map((i) => (
                  <i
                    key={i}
                    className={reading.strength > i * 0.14 ? "on" : ""}
                  />
                ))}
              </span>
            </footer>
          </section>
        );
      })}
    </div>
  );
}
