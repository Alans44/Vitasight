import { useEffect, useRef, useState } from "react";
import { Camera, Film, FlaskConical, Square, EyeOff } from "lucide-react";
import type { Feed, Patient } from "../shared/contracts";
import { api } from "./api";

export type Launch = {
  kind: "camera" | "video" | "demo";
  stream?: MediaStream;
  file?: File;
};
const bones = [
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
];
export default function SourceCard({
  feed,
  launch,
  patients,
  threshold,
  refresh,
  report,
  onStop,
}: {
  feed: Feed;
  launch?: Launch;
  patients: Patient[];
  threshold: number;
  refresh: () => Promise<void>;
  report: (s: string) => void;
  onStop: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    sceneRef = useRef("resting");
  const [scene, setScene] = useState("resting"),
    [error, setError] = useState(""),
    [ended, setEnded] = useState(false);
  const [overlays, setOverlays] = useState(true);
  sceneRef.current = scene;
  useEffect(() => {
    if (!launch) return;
    let active = true,
      busy = false,
      url: string | undefined;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    const element = video.current;
    if (element && launch.kind !== "demo") {
      if (launch.stream) element.srcObject = launch.stream;
      else if (launch.file) {
        url = URL.createObjectURL(launch.file);
        element.src = url;
      }
      element.play().catch(() => setError("Press play to start this video."));
    }
    const tick = async () => {
      if (!active || busy) return;
      if (
        launch.kind !== "demo" &&
        (!element || element.paused || element.readyState < 2)
      )
        return;
      busy = true;
      try {
        if (launch.kind === "demo")
          await api(`/sources/${feed.id}/demo`, {
            session: feed.session,
            scene: sceneRef.current,
          });
        else if (element && ctx) {
          ctx.drawImage(element, 0, 0, 640, 360);
          await api(`/sources/${feed.id}/frame`, {
            session: feed.session,
            timestamp: Date.now(),
            jpeg: canvas.toDataURL("image/jpeg", 0.75),
          });
        }
        if (active) setError("");
      } catch (e) {
        if (active && !String(e).includes("busy"))
          setError(String(e).replace(/^Error: /, ""));
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 500);
    return () => {
      active = false;
      clearInterval(timer);
      launch.stream?.getTracks().forEach((t) => t.stop());
      if (url) URL.revokeObjectURL(url);
    };
  }, [feed.id, feed.session, launch]);
  const now = Date.now(),
    visible = feed.tracks.filter((t) => now - t.lastSeen < 2000);
  const Icon =
    feed.mode === "demo"
      ? FlaskConical
      : launch?.kind === "video"
        ? Film
        : Camera;
  return (
    <article className="source-card">
      <header className="source-head">
        <div className="row">
          <Icon size={17} />
          <strong>{feed.label}</strong>
          <span className={"tag " + (feed.mode === "demo" ? "demo" : "")}>
            {feed.mode === "demo" ? "SIMULATED" : "LOCAL"}
          </span>
        </div>
        <button
          className="icon-button"
          aria-label={`Stop ${feed.label}`}
          title="Stop source"
          onClick={onStop}
        >
          <Square size={15} />
        </button>
      </header>
      <div className="viewport">
        {feed.mode === "live" ? (
          <video
            ref={video}
            muted
            playsInline
            controls={launch?.kind === "video"}
            onEnded={() => setEnded(true)}
            onPlay={() => {
              setEnded(false);
              setError("");
            }}
          />
        ) : (
          <div className="demo-background">
            <span>
              SCENE LAB <span>·</span> FICTIONAL PEOPLE
            </span>
            <div className="seat left" />
            <div className="seat right" />
          </div>
        )}
        {launch && overlays && (
          <svg
            className="pose-overlay"
            viewBox="0 0 1000 562.5"
            aria-label="Tracked pose overlay"
          >
            {visible.map((t) => (
              <g key={t.key} className={t.ambiguous ? "uncertain" : ""}>
                <rect
                  x={t.box[0] * 1000}
                  y={t.box[1] * 562.5}
                  width={t.box[2] * 1000}
                  height={t.box[3] * 562.5}
                  rx="9"
                  className="track-box"
                />
                {bones
                  .filter(
                    ([a, b]) =>
                      t.points[a].confidence >= 0.6 &&
                      t.points[b].confidence >= 0.6,
                  )
                  .map(([a, b]) => (
                    <line
                      key={`${a}-${b}`}
                      x1={t.points[a].x * 1000}
                      y1={t.points[a].y * 562.5}
                      x2={t.points[b].x * 1000}
                      y2={t.points[b].y * 562.5}
                    />
                  ))}
                {t.points.map((p, i) =>
                  p.confidence >= 0.6 ? (
                    <circle
                      key={i}
                      cx={p.x * 1000}
                      cy={p.y * 562.5}
                      r={i === 0 ? 10 : 4}
                    />
                  ) : null,
                )}
                <text x={t.box[0] * 1000 + 8} y={t.box[1] * 562.5 + 22}>
                  {patients.find((p) => p.id === t.patientId)?.name || t.label}
                </text>
              </g>
            ))}
          </svg>
        )}
        <div className="viewport-bottom">
          <span
            className={
              "signal " + (launch && feed.status === "watching" ? "on" : "")
            }
          />
          {!launch
            ? "Preview stopped"
            : ended
              ? "Video ended"
              : feed.status === "watching"
                ? `${visible.length} in view`
                : "Waiting for observations"}
          <button
            className="overlay-toggle"
            onClick={() => setOverlays(!overlays)}
            aria-pressed={overlays}
          >
            {overlays ? "Hide" : "Show"} overlay
          </button>
        </div>
        {!launch && (
          <div className="feed-notice">
            Preview ended after reload. Stop this source and add it again.
          </div>
        )}
      </div>
      {error && (
        <p className="source-error" role="status">
          {error}
        </p>
      )}
      {feed.mode === "demo" && (
        <div className="scene-control">
          <label htmlFor={"scene-" + feed.id}>Scenario</label>
          <select
            id={"scene-" + feed.id}
            value={scene}
            disabled={!launch}
            onChange={(e) => setScene(e.target.value)}
          >
            <option value="resting">Seated upright</option>
            <option value="posture">Sustained posture change</option>
            <option value="occluded">Landmarks obscured</option>
            <option value="overlap">People overlap</option>
          </select>
        </div>
      )}
      <div className="track-list">
        {feed.tracks.length === 0 ? (
          <div className="track-empty">
            <EyeOff size={16} /> No people tracked yet
          </div>
        ) : (
          feed.tracks.map((t) => {
            const unavailable =
              now - t.lastSeen > 2000 || t.quality < 0.6 || t.ambiguous;
            return (
              <div className="track-row" key={t.key}>
                <div>
                  <strong>{t.label}</strong>
                  <small className={unavailable ? "amber" : ""}>
                    {now - t.lastSeen > 2000
                      ? "Not visible"
                      : t.ambiguous
                        ? "Identity uncertain"
                        : t.quality < 0.6
                          ? "Landmarks obscured"
                          : t.score !== null && t.score >= threshold
                            ? "Posture change observed"
                            : t.patientId
                              ? "Association confirmed"
                              : "Confirm identity"}
                  </small>
                </div>
                <select
                  aria-label={`Associate ${t.label} in ${feed.label}`}
                  disabled={!launch || unavailable}
                  value={t.patientId || ""}
                  onChange={async (e) => {
                    try {
                      await api(`/sources/${feed.id}/associate`, {
                        track: t.key,
                        patient: e.target.value,
                      });
                      await refresh();
                    } catch (e) {
                      report(String(e));
                    }
                  }}
                >
                  <option value="" disabled>
                    Associate person…
                  </option>
                  {patients
                    .filter((p) => p.mode === feed.mode)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}
