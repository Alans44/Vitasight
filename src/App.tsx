import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Bell,
  Camera,
  CheckCheck,
  Download,
  Film,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  Plus,
  Settings2,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { Feed, Settings, Snapshot } from "../shared/contracts";
import { api } from "./api";
import SourceCard, { type Launch } from "./SourceCard";
import EventDetail from "./EventDetail";

export default function App() {
  const [state, setState] = useState<Snapshot | null>(null),
    [tab, setTab] = useState("monitor");
  const [error, setError] = useState(""),
    [online, setOnline] = useState(false),
    [adding, setAdding] = useState(false);
  const [launches, setLaunches] = useState<Record<string, Launch>>({}),
    [selected, setSelected] = useState<string | null>(null);
  const [scope, setScope] = useState("all"),
    [search, setSearch] = useState(""),
    [historyFilter, setHistoryFilter] = useState("all");
  const [actor, setActor] = useState(
    () => localStorage.getItem("reassessment-actor") || "Local user",
  );
  const [sound, setSound] = useState(false),
    [vision, setVision] = useState(false),
    [personForm, setPersonForm] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [cameraId, setCameraId] = useState("");
  const discoverCameras = () =>
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((items) => setDevices(items.filter((d) => d.kind === "videoinput")))
      .catch(() => {});
  useEffect(() => {
    void discoverCameras();
  }, []);
  const file = useRef<HTMLInputElement>(null),
    soundContext = useRef<AudioContext | null>(null),
    seen = useRef<Set<string> | null>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await api<Snapshot>("/state");
      setState(next);
      setOnline(true);
      setSettings((old) => old || next.settings);
    } catch {
      setOnline(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 750);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    let active = true;
    const check = () =>
      api<{ ready: boolean }>("/vision")
        .then((r) => {
          if (active) setVision(r.ready);
        })
        .catch(() => {
          if (active) setVision(false);
        });
    void check();
    const id = setInterval(() => void check(), 8000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);
  useEffect(() => {
    if (!state) return;
    const fresh = state.events.some(
      (e) => e.status === "open" && seen.current && !seen.current.has(e.id),
    );
    seen.current = new Set(state.events.map((e) => e.id));
    if (fresh && sound && soundContext.current) {
      const ctx = soundContext.current,
        osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 620;
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  }, [state, sound]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setPersonForm(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  async function addSource(kind: Launch["kind"], localFile?: File) {
    setAdding(true);
    let stream: MediaStream | undefined;
    try {
      if (kind === "camera") {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: 640,
            height: 360,
            ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
          },
        });
        void discoverCameras();
      }
      if (
        kind === "video" &&
        (!localFile || !localFile.type.startsWith("video/"))
      )
        throw Error("Choose a playable video file");
      const label =
        kind === "demo"
          ? `Scene lab ${(state?.feeds.filter((f) => f.mode === "demo").length || 0) + 1}`
          : kind === "video"
            ? localFile!.name.slice(0, 60)
            : `Camera ${(state?.feeds.length || 0) + 1}`;
      const feed = await api<Feed>("/sources", {
        label,
        mode: kind === "demo" ? "demo" : "live",
      });
      setLaunches((old) => ({
        ...old,
        [feed.id]: { kind, stream, file: localFile },
      }));
      await refresh();
      setTab("monitor");
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setAdding(false);
    }
  }
  async function stop(id: string) {
    try {
      await api(`/sources/${id}/stop`, {});
      setLaunches((old) => {
        old[id]?.stream?.getTracks().forEach((t) => t.stop());
        const copy = { ...old };
        delete copy[id];
        return copy;
      });
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }
  const events = (state?.events || []).filter(
      (e) => scope === "all" || e.mode === scope,
    ),
    queue = events.filter((e) => ["open", "acknowledged"].includes(e.status));
  const feeds = (state?.feeds || []).filter(
    (f) => scope === "all" || f.mode === scope,
  );
  const faults = feeds.reduce(
    (n, f) =>
      n +
      f.tracks.filter(
        (t) => Date.now() - t.lastSeen > 2000 || t.ambiguous || t.quality < 0.6,
      ).length,
    0,
  );
  const detail = state?.events.find((e) => e.id === selected),
    disabled = adding || !online || (state?.feeds.length || 0) >= 4;
  return (
    <div className="app-shell">
      <aside className="rail">
        <a className="brand" href="/" aria-label="Reassessment home">
          <span className="brand-icon">
            <Activity size={22} />
          </span>
          <span>
            reassessment
            <span className="brand-sub">OBSERVE. REVIEW. RESPOND.</span>
          </span>
        </a>
        <div className="rail-caption">WORKSPACE</div>
        <nav>
          {[
            ["monitor", "Monitor", LayoutDashboard],
            ["events", "Event history", ListChecks],
            ["settings", "Configuration", Settings2],
          ].map(([id, label, Icon]) => {
            const Item = Icon as typeof Activity;
            return (
              <button
                key={String(id)}
                className={tab === id ? "nav-item active" : "nav-item"}
                onClick={() => setTab(String(id))}
              >
                <Item size={18} />
                {String(label)}
                {id === "events" && (
                  <span className="nav-count">{state?.events.length || 0}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="rail-bottom">
          <span className="local-pill">
            <span className={"signal " + (online ? "on" : "")} />
            {online ? "Local workspace" : "Connecting…"}
          </span>
          <p>
            Research prototype
            <br />
            Human review remains essential.
          </p>
          <small>v0.1 · Independent build</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <span>/</span>{" "}
            {tab === "monitor"
              ? "Live observation"
              : tab === "events"
                ? "Event history"
                : "Configuration"}
          </span>
          <div className="row">
            <button
              className="icon-button"
              title={sound ? "Mute local alerts" : "Enable local alert sound"}
              aria-label={sound ? "Mute alerts" : "Enable sound"}
              aria-pressed={sound}
              onClick={() => {
                if (!sound) {
                  soundContext.current ??= new AudioContext();
                  void soundContext.current.resume();
                }
                setSound(!sound);
              }}
            >
              {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <span className="operator-badge">
              {actor.slice(0, 2).toUpperCase()}
            </span>
            <span className="operator-name">{actor}</span>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {tab === "monitor"
                  ? "A CLEARER PICTURE"
                  : tab === "events"
                    ? "EVERY RESPONSE, RECORDED"
                    : "MAKE IT YOUR WORKSPACE"}
              </div>
              <h1>
                {tab === "monitor"
                  ? "Keep the next check in sight."
                  : tab === "events"
                    ? "Event history"
                    : "Configuration"}
              </h1>
              <p>
                {tab === "monitor"
                  ? "Observe visible changes. Give every review request a recorded response."
                  : tab === "events"
                    ? "A timeline of observations, decisions, and reassessments."
                    : "Local controls for observation rules and your recorded actions."}
              </p>
            </div>
            {tab !== "settings" && (
              <a className="button secondary" href="/api/export" download>
                <Download size={16} /> Export log
              </a>
            )}
          </div>
          {!online && (
            <div className="banner warning" role="status">
              The local server is unavailable. Displayed observations may be
              stale.
            </div>
          )}
          {tab !== "settings" && (
            <div className="scope-bar">
              <div className="segmented" aria-label="Workspace filter">
                {["all", "live", "demo"].map((x) => (
                  <button
                    key={x}
                    className={scope === x ? "selected" : ""}
                    onClick={() => setScope(x)}
                  >
                    {x === "all"
                      ? "All sources"
                      : x === "live"
                        ? "Live"
                        : "Simulated"}
                  </button>
                ))}
              </div>
              <span className="small muted">
                {vision
                  ? "Local vision engine ready"
                  : "Demo ready · vision service offline"}
              </span>
            </div>
          )}
          {tab === "monitor" && (
            <>
              <div className="stats">
                <div>
                  <span>
                    <Camera size={16} /> Active sources
                  </span>
                  <strong>{feeds.length.toString().padStart(2, "0")}</strong>
                  <small>Up to four independent feeds</small>
                </div>
                <div>
                  <span>
                    <Bell size={16} /> Awaiting review
                  </span>
                  <strong className={queue.length ? "attention" : ""}>
                    {queue.length.toString().padStart(2, "0")}
                  </strong>
                  <small>Open and acknowledged requests</small>
                </div>
                <div>
                  <span>
                    <Users size={16} /> Visibility issues
                  </span>
                  <strong>{faults.toString().padStart(2, "0")}</strong>
                  <small>Separate from review requests</small>
                </div>
              </div>
              <div className="workspace-grid">
                <section>
                  <div className="section-title">
                    <div>
                      <h2>
                        Sources <span>{feeds.length}</span>
                      </h2>
                      <p>Camera feeds and local videos</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setPersonForm(true)}
                    >
                      <Plus size={15} /> Add person
                    </button>
                  </div>
                  {devices.length > 1 && (
                    <label className="camera-select">
                      Camera device
                      <select
                        aria-label="Camera device"
                        value={cameraId}
                        onChange={(e) => setCameraId(e.target.value)}
                      >
                        <option value="">Default camera</option>
                        {devices.map((d, i) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label || `Camera ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="source-tools">
                    <button
                      disabled={disabled || !vision}
                      onClick={() => void addSource("camera")}
                      title={
                        !vision
                          ? "Run npm run vision:setup to enable local vision"
                          : ""
                      }
                    >
                      <Camera size={16} /> Camera
                    </button>
                    <button
                      disabled={disabled || !vision}
                      onClick={() => file.current?.click()}
                    >
                      <Film size={16} /> Local video
                    </button>
                    <button
                      className="demo-button"
                      disabled={disabled}
                      onClick={() => void addSource("demo")}
                    >
                      <FlaskConical size={16} /> Start demo
                    </button>
                    <input
                      ref={file}
                      type="file"
                      accept="video/*"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void addSource("video", f);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {feeds.length === 0 ? (
                    <div className="empty-sources">
                      <div className="empty-graphic">
                        <Camera size={38} />
                        <span className="corner a" />
                        <span className="corner b" />
                      </div>
                      <h3>A quiet workspace, ready to observe.</h3>
                      <p>
                        Start a simulated scene to try the complete review
                        workflow.
                        <br />
                        Connect the local vision engine for a camera or video.
                      </p>
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() => void addSource("demo")}
                      >
                        <FlaskConical size={16} /> Try a simulated scene{" "}
                        <ArrowUpRight size={16} />
                      </button>
                      <small>
                        No credentials. No uploads. Fictional people only.
                      </small>
                    </div>
                  ) : (
                    <div className="sources-grid">
                      {feeds.map((feed) => (
                        <SourceCard
                          key={feed.id}
                          feed={feed}
                          launch={launches[feed.id]}
                          patients={state?.patients || []}
                          threshold={state?.settings.postureThreshold ?? 0.45}
                          refresh={refresh}
                          report={setError}
                          onStop={() => void stop(feed.id)}
                        />
                      ))}
                    </div>
                  )}
                  <div className="privacy-note">
                    <span className="signal on" /> Frames stay on this computer.
                    Only review records are saved.
                  </div>
                </section>
                <aside className="review-panel">
                  <div className="section-title">
                    <div>
                      <h2>
                        Review queue <span>{queue.length}</span>
                      </h2>
                      <p>Visible changes, ready for a check</p>
                    </div>
                    <Bell size={18} />
                  </div>
                  {queue.length === 0 ? (
                    <div className="queue-empty">
                      <CheckCheck size={30} />
                      <h3>No requests waiting</h3>
                      <p>
                        New observations will appear here.
                        <br />
                        An empty queue does not establish that someone is
                        clinically stable.
                      </p>
                    </div>
                  ) : (
                    queue.map((e) => (
                      <button
                        className="event-card"
                        key={e.id}
                        onClick={() => setSelected(e.id)}
                      >
                        <div className="row between">
                          <span className="event-kind">
                            {e.kind === "posture"
                              ? "POSTURE CHANGE"
                              : "REASSESSMENT DUE"}
                          </span>
                          <ArrowUpRight size={16} />
                        </div>
                        <strong>{e.person}</strong>
                        <p>{e.reason}</p>
                        <div className="row between">
                          <small>{e.source}</small>
                          <span
                            className={
                              "tag " + (e.mode === "demo" ? "demo" : "")
                            }
                          >
                            {e.mode === "demo" ? "SIMULATED" : "LIVE"}
                          </span>
                        </div>
                        <footer>
                          <span className={"status " + e.status}>
                            {e.status}
                          </span>
                          <time>
                            {new Date(e.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </footer>
                      </button>
                    ))
                  )}
                </aside>
              </div>
            </>
          )}
          {tab === "events" && (
            <section className="history-panel">
              <div className="history-tools">
                <input
                  type="search"
                  placeholder="Search person, source, or reason…"
                  aria-label="Search events"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  aria-label="Event status"
                  value={historyFilter}
                  onChange={(e) => setHistoryFilter(e.target.value)}
                >
                  {["all", "open", "acknowledged", "resolved", "dismissed"].map(
                    (s) => (
                      <option key={s} value={s}>
                        {s === "all" ? "All statuses" : s}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Person / observation</th>
                      <th>Source</th>
                      <th>Recorded</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {events
                      .filter(
                        (e) =>
                          (historyFilter === "all" ||
                            e.status === historyFilter) &&
                          `${e.person} ${e.source} ${e.reason}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((e) => (
                        <tr key={e.id}>
                          <td>
                            <strong>{e.person}</strong>
                            <small>
                              {e.kind === "posture"
                                ? "Sustained posture change"
                                : "Reassessment interval elapsed"}
                            </small>
                          </td>
                          <td>
                            {e.source}
                            <small>
                              {e.mode === "demo" ? "Simulated" : "Live source"}
                            </small>
                          </td>
                          <td>{new Date(e.createdAt).toLocaleString()}</td>
                          <td>
                            <span className={"status " + e.status}>
                              {e.status}
                            </span>
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => setSelected(e.id)}
                            >
                              Review <ArrowUpRight size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {events.length === 0 && (
                  <p className="table-empty">
                    No events recorded yet. Start a scene in Monitor to try the
                    workflow.
                  </p>
                )}
              </div>
            </section>
          )}
          {tab === "settings" && settings && (
            <div className="settings-grid">
              <section className="settings-card">
                <h2>Your workspace</h2>
                <p>
                  Used in the action history. This label is not an authenticated
                  identity.
                </p>
                <label className="field">
                  Your name or initials
                  <input
                    maxLength={60}
                    value={actor}
                    onChange={(e) => {
                      setActor(e.target.value);
                      localStorage.setItem(
                        "reassessment-actor",
                        e.target.value,
                      );
                    }}
                  />
                </label>
                <div className="service-status">
                  <span className={"signal " + (vision ? "on" : "")} />
                  <div>
                    <strong>
                      {vision
                        ? "Local vision connected"
                        : "Local vision is optional"}
                    </strong>
                    <p>
                      Demo mode is always available. Enable camera and
                      local-video inference with{" "}
                      <code>npm run vision:setup</code>, then restart.
                    </p>
                  </div>
                </div>
              </section>
              <form
                className="settings-card"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api("/settings", { settings, actor }, "PUT");
                    await refresh();
                    setError("Observation rules saved.");
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                <h2>Observation rules</h2>
                <p>
                  Experimental posture rules generate reassessment requests.
                  They do not assign triage or estimate vital signs.
                </p>
                <label className="field">
                  Sustain window (seconds)
                  <input
                    required
                    type="number"
                    min="3"
                    max="30"
                    value={settings.sustainSeconds}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        sustainSeconds: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="field">
                  Seated posture threshold
                  <input
                    required
                    type="number"
                    min="0.15"
                    max="0.9"
                    step="0.05"
                    value={settings.postureThreshold}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        postureThreshold: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="field">
                  Reassessment reminder (minutes; 0 disables)
                  <input
                    required
                    type="number"
                    min="0"
                    max="180"
                    value={settings.overdueMinutes}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        overdueMinutes: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <button className="primary" disabled={!actor.trim()}>
                  Save rules
                </button>
              </form>
            </div>
          )}
          <footer className="page-footer">
            <span>REASSESSMENT</span> Local research workspace · No diagnosis or
            automated triage
          </footer>
        </div>
      </main>
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setError("")}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {detail && state && (
        <EventDetail
          key={detail.id}
          event={detail}
          audit={state.audit}
          actor={actor.trim() || "Local user"}
          onClose={() => setSelected(null)}
          refresh={refresh}
          report={setError}
        />
      )}
      {personForm && (
        <div className="drawer-shade" onClick={() => setPersonForm(false)}>
          <form
            className="person-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="person-title"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                await api("/patients", {
                  name: form.get("name"),
                  context: form.get("context"),
                  priority: Number(form.get("priority")),
                  mode: form.get("mode"),
                });
                setPersonForm(false);
                await refresh();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <div className="row between">
              <h2 id="person-title">Add a person</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close person form"
                onClick={() => setPersonForm(false)}
              >
                <X />
              </button>
            </div>
            <p className="muted">
              Use fictional records for this research workspace.
            </p>
            <label className="field">
              Name or label
              <input autoFocus name="name" required maxLength={60} />
            </label>
            <label className="field">
              Context
              <input name="context" maxLength={200} />
            </label>
            <label className="field">
              Initial nurse priority
              <select name="priority" defaultValue="3">
                {[1, 2, 3, 4, 5].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Workspace
              <select
                name="mode"
                defaultValue={scope === "live" ? "live" : "demo"}
              >
                <option value="demo">Simulated scene</option>
                <option value="live">Live source</option>
              </select>
            </label>
            <button className="primary full">Add person</button>
          </form>
        </div>
      )}
    </div>
  );
}
