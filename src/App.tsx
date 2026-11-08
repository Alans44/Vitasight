import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Camera,
  Download,
  Film,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Plus,
  Settings2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { Feed, Settings, Snapshot } from "../shared/contracts";
import { api } from "./api";
import SourceCard, { type Launch } from "./SourceCard";
import EventDetail from "./EventDetail";
import PatientSidebar from "./PatientSidebar";
import VideoPlaceholder from "./VideoPlaceholder";
import VideoLibrary from "./VideoLibrary";
import NotificationSettings from "./NotificationSettings";
import { smsStatusLabel } from "../shared/notifications";

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
    () =>
      localStorage.getItem("vitasight-actor") ||
      localStorage.getItem("reassessment-actor") ||
      "Local user",
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
      setState((old) => ({
        ...next,
        feeds: next.feeds.map((feed) => {
          const current = old?.feeds.find(
            (f) => f.id === feed.id && f.session === feed.session,
          );
          return current && current.lastFrame > feed.lastFrame ? current : feed;
        }),
      }));
      setOnline(true);
      setSettings((old) => old || next.settings);
    } catch {
      setOnline(false);
    }
  }, []);
  const updateFeed = useCallback((feed: Feed) => {
    setState((old) =>
      old
        ? {
            ...old,
            feeds: old.feeds.map((current) =>
              current.id === feed.id &&
              current.session === feed.session &&
              feed.lastFrame >= current.lastFrame
                ? feed
                : current,
            ),
          }
        : old,
    );
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 500);
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
      setScope("all");
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
  const allFeeds = state?.feeds || [];
  const feeds = allFeeds.filter((f) => scope === "all" || f.mode === scope);
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
      <header className="workspace-tabs">
        <nav aria-label="Workspace tabs">
          {[
            ["monitor", "Dashboard", LayoutDashboard],
            ["library", "Library", Film],
            ["live", "Direct Feed", Camera],
          ].map(([id, label, Icon]) => {
            const Item = Icon as typeof Activity;
            return (
              <button
                key={String(id)}
                className={
                  tab === id ? "workspace-tab active" : "workspace-tab"
                }
                aria-label={String(label)}
                aria-current={tab === id ? "page" : undefined}
                onClick={() => {
                  setTab(String(id));
                  if (id === "live") setScope("live");
                  if (id === "monitor") setScope("all");
                }}
              >
                <Item size={15} />
                {String(label)}
              </button>
            );
          })}
        </nav>
        <div className="workspace-actions">
          <span className="app-wordmark">
            <Activity size={18} />
            Vitasight
          </span>
          <span className="workspace-divider" />
          <button
            className={tab === "events" ? "icon-button active" : "icon-button"}
            title="Event history"
            aria-label="Event history"
            onClick={() => setTab("events")}
          >
            <ListChecks size={17} />
          </button>
          <button
            className={
              tab === "settings" ? "icon-button active" : "icon-button"
            }
            title="Configuration"
            aria-label="Configuration"
            onClick={() => setTab("settings")}
          >
            <Settings2 size={17} />
          </button>
          <button
            className="icon-button"
            title={sound ? "Mute alerts" : "Enable sound"}
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
            {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <span
            className="connection-indicator"
            title={online ? "Connected" : "Connecting"}
          >
            <span className={"signal " + (online ? "on" : "")} />
          </span>
        </div>
      </header>
      <main>
        <div className="content">
          {!online && (
            <div className="banner warning" role="status">
              The local server is unavailable. Displayed observations may be
              stale.
            </div>
          )}
          <div
            className={
              "monitor-layout " + (tab === "live" ? "direct-feed" : "")
            }
            hidden={tab !== "monitor" && tab !== "live"}
          >
            <section className="camera-workspace" aria-label="Sources">
              <div className="model-status-row">
                <span className={"model-status " + (vision ? "ready" : "")}>
                  <span className={"signal " + (vision ? "on" : "")} />
                  {vision ? "Local vision active" : "Local vision offline"}
                </span>
                <span>
                  {feeds.length} / 4 sources
                  {faults > 0
                    ? ` · ${faults} visibility ${faults === 1 ? "issue" : "issues"}`
                    : ""}
                </span>
              </div>
              {feeds.length === 0 && (
                <div className="empty-sources">
                  <div className="empty-camera">
                    <Camera size={40} strokeWidth={1} />
                    <span>No active cameras</span>
                  </div>
                  <span className="empty-source-label">CAM 01</span>
                </div>
              )}
              <div
                className={`sources-grid ${feeds.length > 1 ? "multiple" : ""}`}
                hidden={feeds.length === 0}
              >
                {allFeeds.map((feed) => (
                  <div
                    className="source-slot"
                    key={feed.id}
                    hidden={!feeds.some((visible) => visible.id === feed.id)}
                  >
                    <SourceCard
                      feed={feed}
                      launch={launches[feed.id]}
                      patients={state?.patients || []}
                      threshold={state?.settings.postureThreshold ?? 0.45}
                      refresh={refresh}
                      onFeed={updateFeed}
                      report={setError}
                      onStop={() => void stop(feed.id)}
                    />
                  </div>
                ))}
              </div>
              <section
                className="source-control-panel"
                aria-label="Source controls"
              >
                <div className="panel-title-row">
                  <h2>Available cameras</h2>
                  <span>
                    {devices.length}{" "}
                    {devices.length === 1 ? "device" : "devices"}
                  </span>
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
                      {devices.map((device, i) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Camera ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="source-tools">
                  <button
                    disabled={disabled || !vision}
                    onClick={() => void addSource("camera")}
                    title={!vision ? "Local vision is offline" : "Start camera"}
                  >
                    <Camera size={14} />
                    Camera
                  </button>
                  <button
                    disabled={disabled || !vision}
                    onClick={() => file.current?.click()}
                  >
                    <Film size={14} />
                    Video
                  </button>
                  <button
                    className="demo-button"
                    disabled={disabled}
                    onClick={() => void addSource("demo")}
                  >
                    <FlaskConical size={14} />
                    Start demo
                  </button>
                  <button
                    className="text-button add-person"
                    onClick={() => setPersonForm(true)}
                  >
                    <Plus size={14} />
                    Add person
                  </button>
                  <input
                    ref={file}
                    type="file"
                    accept="video/*"
                    hidden
                    onChange={(e) => {
                      const videoFile = e.target.files?.[0];
                      if (videoFile) void addSource("video", videoFile);
                      e.target.value = "";
                    }}
                  />
                </div>
                <div className="source-panel-footer">
                  <div className="segmented" aria-label="Workspace filter">
                    {["all", "live", "demo"].map((scopeValue) => (
                      <button
                        key={scopeValue}
                        className={scope === scopeValue ? "selected" : ""}
                        onClick={() => setScope(scopeValue)}
                      >
                        {scopeValue === "all"
                          ? "All sources"
                          : scopeValue === "live"
                            ? "Live"
                            : "Simulated"}
                      </button>
                    ))}
                  </div>
                  <span className="local-processing">
                    <span className="signal on" />
                    Local processing
                  </span>
                </div>
              </section>
              <section className="dashboard-event-log" aria-label="Event log">
                <div className="panel-title-row">
                  <h2>Event log</h2>
                  <button
                    className="text-button"
                    onClick={() => setTab("settings")}
                  >
                    <MessageSquare size={13} />
                    Text alerts {state?.sms?.preferences.enabled ? "on" : "off"}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setTab("events")}
                  >
                    View all
                    <ArrowUpRight size={13} />
                  </button>
                </div>
                {(state?.audit.length || 0) === 0 ? (
                  <p className="log-empty">No events yet.</p>
                ) : (
                  <div className="log-list">
                    {state?.audit.slice(0, 6).map((entry) => (
                      <div className="log-row" key={entry.id}>
                        <time>
                          {new Date(entry.at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </time>
                        <span className={entry.eventId ? "log-attention" : ""}>
                          {entry.action}
                        </span>
                        <span className="log-note" title={entry.note}>
                          {entry.note}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section
                className="dashboard-video-library"
                aria-label="Video placeholders"
              >
                <div className="panel-title-row">
                  <h2>Video sources</h2>
                  <button
                    className="text-button"
                    onClick={() => setTab("library")}
                  >
                    Library
                    <ArrowUpRight size={13} />
                  </button>
                </div>
                <div className="placeholder-grid">
                  {[1, 2, 3].map((number) => (
                    <VideoPlaceholder
                      key={number}
                      label={`Waiting room ${String(number).padStart(2, "0")}`}
                      number={String(number).padStart(2, "0")}
                    />
                  ))}
                </div>
              </section>
            </section>
            <PatientSidebar
              feeds={feeds}
              patients={state?.patients || []}
              events={queue}
              onReview={setSelected}
              onAddPerson={() => setPersonForm(true)}
            />
          </div>
          {tab === "library" && (
            <VideoLibrary
              onChooseVideo={() => file.current?.click()}
              disabled={disabled || !vision}
            />
          )}
          {(tab === "events" || tab === "settings") && (
            <div className="page-heading-row">
              <div>
                <span className="page-breadcrumb">Vitasight / Workspace</span>
                <h1>{tab === "events" ? "Event history" : "Configuration"}</h1>
              </div>
              {tab === "events" && (
                <a className="button secondary" href="/api/export" download>
                  <Download size={14} />
                  Export log
                </a>
              )}
            </div>
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
                  aria-label="Event origin"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="all">All sources</option>
                  <option value="live">Live</option>
                  <option value="demo">Simulated</option>
                </select>
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
                            {state?.sms?.notifications.find(
                              (message) => message.eventId === e.id,
                            ) && (
                              <small>
                                {
                                  smsStatusLabel[
                                    state.sms.notifications.find(
                                      (message) => message.eventId === e.id,
                                    )!.status
                                  ]
                                }
                              </small>
                            )}
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
                  <p className="table-empty">No events recorded.</p>
                )}
              </div>
            </section>
          )}
          {tab === "settings" && settings && (
            <div className="settings-grid">
              <section className="settings-card">
                <h2>Operator</h2>
                <p>Name shown in recorded actions.</p>
                <label className="field">
                  Name or initials
                  <input
                    maxLength={60}
                    value={actor}
                    onChange={(e) => {
                      setActor(e.target.value);
                      localStorage.setItem("vitasight-actor", e.target.value);
                    }}
                  />
                </label>
                <div className="service-status">
                  <span className={"signal " + (vision ? "on" : "")} />
                  <div>
                    <strong>
                      {vision ? "Vision connected" : "Vision offline"}
                    </strong>
                    {!vision && (
                      <p>
                        Enable camera and video:{" "}
                        <code>npm run vision:setup</code>, then restart.
                      </p>
                    )}
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
                <p>Experimental rules. Human review required.</p>
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
              {state?.sms && (
                <NotificationSettings
                  snapshot={state.sms}
                  actor={actor}
                  refresh={refresh}
                />
              )}
            </div>
          )}
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
          notifications={state.sms?.notifications || []}
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
            <p className="muted">Fictional records only.</p>
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
