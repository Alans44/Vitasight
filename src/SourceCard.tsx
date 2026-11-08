import { useEffect, useRef, useState } from "react";
import { Camera, Film, FlaskConical, Square, EyeOff } from "lucide-react";
import type { Feed, Patient } from "../shared/contracts";
import { api } from "./api";
import { usePulse } from "./usePulse";
import TrackingOverlay from "./TrackingOverlay";
import PulsePanel from "./PulsePanel";
import { trackActivityLabel } from "../shared/activity";

export type Launch = {
  kind: "camera" | "video" | "demo";
  stream?: MediaStream;
  file?: File;
};

type OverlaySettings = { bpm: boolean; body: boolean };

function readOverlaySettings(sourceId: string): OverlaySettings {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`vitasight:overlays:${sourceId}`) ||
        localStorage.getItem(`reassessment:overlays:${sourceId}`) ||
        "null",
    );
    return {
      bpm: typeof saved?.bpm === "boolean" ? saved.bpm : true,
      body: typeof saved?.body === "boolean" ? saved.body : true,
    };
  } catch {
    return { bpm: true, body: true };
  }
}

export default function SourceCard({
  feed,
  launch,
  patients,
  threshold,
  refresh,
  onFeed,
  report,
  onStop,
}: {
  feed: Feed;
  launch?: Launch;
  patients: Patient[];
  threshold: number;
  refresh: () => Promise<void>;
  onFeed: (feed: Feed) => void;
  report: (s: string) => void;
  onStop: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    sceneRef = useRef("resting");
  const poseMs = useRef(0);
  const [scene, setScene] = useState("resting"),
    [error, setError] = useState(""),
    [ended, setEnded] = useState(false);
  const [overlays, setOverlays] = useState(() => readOverlaySettings(feed.id));
  const pulse = usePulse(feed, launch, video);
  sceneRef.current = scene;
  useEffect(() => {
    try {
      localStorage.setItem(
        `vitasight:overlays:${feed.id}`,
        JSON.stringify(overlays),
      );
    } catch {}
  }, [feed.id, overlays]);
  useEffect(() => {
    if (!launch) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>,
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
      if (!active) return;
      const start = performance.now();
      let delay = 120;
      try {
        if (
          launch.kind !== "demo" &&
          (!element || element.paused || element.readyState < 2)
        ) {
          delay = 60;
          return;
        }
        let result: { ok: boolean; feed?: Feed } | undefined;
        if (launch.kind === "demo")
          result = await api(`/sources/${feed.id}/demo`, {
            session: feed.session,
            scene: sceneRef.current,
          });
        else if (element && ctx) {
          ctx.drawImage(element, 0, 0, 640, 360);
          result = await api(`/sources/${feed.id}/frame`, {
            session: feed.session,
            timestamp: Date.now(),
            jpeg: canvas.toDataURL("image/jpeg", 0.75),
          });
        }
        if (active) {
          poseMs.current = performance.now() - start;
          if (result?.feed) onFeed(result.feed);
          else void refresh();
          setError("");
        }
      } catch (e) {
        delay = 250;
        if (active && !String(e).includes("busy"))
          setError(String(e).replace(/^Error: /, ""));
      } finally {
        if (active)
          timer = setTimeout(
            () => void tick(),
            Math.max(16, delay - (performance.now() - start)),
          );
      }
    };
    void tick();
    return () => {
      active = false;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [feed.id, feed.session, launch, onFeed, refresh]);
  const now = Date.now(),
    visible = feed.tracks.filter((t) => now - t.lastSeen < 2000);
  const Icon =
    feed.mode === "demo"
      ? FlaskConical
      : launch?.kind === "video"
        ? Film
        : Camera;
  return (
    <article
      className="source-card"
      data-analysis-ms={Math.round(pulse.analysisMs)}
      data-pose-ms={Math.round(poseMs.current)}
    >
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
        {visible.some((track) => track.fallDetected) && (
          <div className="feed-fall-alert">Possible fall detected</div>
        )}
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
            <div className="seat left" />
            <div className="seat right" />
          </div>
        )}
        {launch && overlays.body && (
          <>
            <div className="analysis-sweep" />
            <TrackingOverlay
              tracks={visible}
              faces={pulse.faces}
              topology={pulse.topology}
              patients={patients}
            />
          </>
        )}
        <div className="viewport-bottom">
          <span
            className={
              "signal " +
              (launch && (feed.status === "watching" || pulse.faces.length > 0)
                ? "on"
                : "")
            }
          />
          {!launch
            ? "Preview stopped"
            : ended
              ? "Video ended"
              : feed.status === "watching" || pulse.faces.length > 0
                ? `${Math.max(visible.length, pulse.faces.length)} in view`
                : "Waiting for feed"}
          <div
            className="overlay-controls"
            role="group"
            aria-label={`Overlays for ${feed.label}`}
          >
            <button
              type="button"
              className="overlay-toggle"
              onClick={() =>
                setOverlays((current) => ({ ...current, bpm: !current.bpm }))
              }
              aria-pressed={overlays.bpm}
            >
              <span className="overlay-switch" aria-hidden="true" />
              BPM overlay
            </button>
            <button
              type="button"
              className="overlay-toggle"
              onClick={() =>
                setOverlays((current) => ({ ...current, body: !current.body }))
              }
              aria-pressed={overlays.body}
            >
              <span className="overlay-switch" aria-hidden="true" />
              Body landmarks
            </button>
          </div>
        </div>
        {!launch && (
          <div className="feed-notice">
            Preview ended. Stop and reconnect this source.
          </div>
        )}
      </div>
      {error && (
        <p className="source-error" role="status">
          {error}
        </p>
      )}
      {overlays.bpm && (
        <PulsePanel
          faces={pulse.faces}
          feed={feed}
          patients={patients}
          issue={pulse.issue}
          active={!!launch}
        />
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
            <option value="slump">Slump</option>
            <option value="posture">Deep slump</option>
            <option value="fall">Fall / collapse</option>
            <option value="occluded">Landmarks obscured</option>
            <option value="overlap">People overlap</option>
          </select>
        </div>
      )}
      <div className="track-list">
        {feed.tracks.length === 0 ? (
          <div className="track-empty">
            <EyeOff size={16} /> No body tracks
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
                          : t.fallDetected ||
                              t.slumpDetected ||
                              t.potentialSlump ||
                              (t.score !== null && t.score >= threshold)
                            ? trackActivityLabel(t)
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
