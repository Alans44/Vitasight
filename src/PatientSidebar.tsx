import { useEffect, useId, useState } from "react";
import { Camera, ChevronDown, Plus } from "lucide-react";
import type { Feed, Patient, ReviewEvent, Track } from "../shared/contracts";

type Props = {
  feeds: Feed[];
  patients: Patient[];
  events: ReviewEvent[];
  onReview: (id: string) => void;
  onAddPerson: () => void;
};

function elapsed(since: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function Silhouette() {
  return (
    <span className="patient-thumb" aria-hidden="true">
      <span className="patient-silhouette">
        <span className="silhouette-head" />
        <span className="silhouette-body" />
        <span className="silhouette-arm left" />
        <span className="silhouette-arm right" />
        <span className="silhouette-leg left" />
        <span className="silhouette-leg right" />
      </span>
      <span className="silhouette-baseline" />
    </span>
  );
}

function Timer({
  label,
  since,
  now,
}: {
  label: string;
  since: number;
  now: number;
}) {
  return (
    <span className="patient-timer">
      <span className="patient-timer-label">{label}</span>
      <time
        className="patient-timer-value"
        dateTime={new Date(since).toISOString()}
        title={new Date(since).toLocaleString()}
      >
        {elapsed(since, now)}
      </time>
    </span>
  );
}

function ObservedCard({
  feed,
  track,
  patient,
  now,
}: {
  feed: Feed;
  track: Track;
  patient?: Patient;
  now: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const limited =
    now - track.lastSeen > 2000 || track.ambiguous || track.quality < 0.6;
  const name = patient?.name || track.label;
  const status = limited ? "Visibility limited" : "Observed";
  const reason = limited
    ? track.ambiguous
      ? "Overlapping tracks. Waiting for a clear view."
      : "Waiting for a clearer view."
    : patient?.context || "Tracking active in camera view.";

  return (
    <article
      className={`patient-card observed-card ${limited ? "visibility-limited" : "observed"}`}
    >
      <Silhouette />
      <div className="patient-content">
        <div className="patient-card-head">
          <span className="patient-id">{name}</span>
          <span className="patient-status">
            <span className="patient-status-dot" aria-hidden="true" />
            {status}
          </span>
          <button
            type="button"
            className="patient-details-toggle"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((current) => !current)}
          >
            Details <ChevronDown size={12} aria-hidden="true" />
          </button>
        </div>
        <p className="patient-reason">{reason}</p>
        <div className="patient-tags">
          <span className="patient-tag">{track.label}</span>
          <span className="patient-tag">
            {patient ? `Priority ${patient.priority}` : "Unconfirmed identity"}
          </span>
        </div>
        {expanded && (
          <dl className="patient-details" id={detailsId}>
            <div>
              <dt>Source</dt>
              <dd>{feed.label}</dd>
            </div>
            <div>
              <dt>Track</dt>
              <dd>{track.externalId}</dd>
            </div>
            <div>
              <dt>Visibility</dt>
              <dd>{Math.round(track.quality * 100)}%</dd>
            </div>
            {track.score !== null && (
              <div>
                <dt>Posture score</dt>
                <dd>{track.score.toFixed(2)}</dd>
              </div>
            )}
            <div>
              <dt>Last seen</dt>
              <dd>{new Date(track.lastSeen).toLocaleTimeString()}</dd>
            </div>
          </dl>
        )}
        <div className="patient-card-footer">
          <span className="patient-source">{feed.label}</span>
          <Timer label="Last seen" since={track.lastSeen} now={now} />
        </div>
      </div>
    </article>
  );
}

export default function PatientSidebar({
  feeds,
  patients,
  events,
  onReview,
  onAddPerson,
}: Props) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const observed = feeds.flatMap((feed) =>
    feed.tracks
      .filter(
        (track) =>
          !events.some(
            (event) =>
              (event.feedId === feed.id && event.trackKey === track.key) ||
              (track.patientId !== null && event.patientId === track.patientId),
          ),
      )
      .map((track) => ({ feed, track })),
  );
  const count = new Set([
    ...events.map((event) =>
      event.patientId
        ? `patient:${event.patientId}`
        : `track:${event.feedId}:${event.trackKey}`,
    ),
    ...observed.map(({ feed, track }) =>
      track.patientId
        ? `patient:${track.patientId}`
        : `track:${feed.id}:${track.key}`,
    ),
  ]).size;

  return (
    <aside className="patient-sidebar" aria-label="Patients">
      <div className="patient-sidebar-head">
        <span className="patient-count">
          Patients <span>{count}</span>
        </span>
        <button type="button" className="patient-add" onClick={onAddPerson}>
          <Plus size={13} aria-hidden="true" /> Add person
        </button>
      </div>
      {count === 0 ? (
        <div className="patient-empty">
          <Camera size={38} strokeWidth={1.25} aria-hidden="true" />
          <p>No patients detected yet.</p>
        </div>
      ) : (
        <div className="patient-list">
          {events.map((event) => {
            const patient = patients.find(
              (item) => item.id === event.patientId,
            );
            const acknowledged = event.status === "acknowledged";
            const status = acknowledged ? "Acknowledged" : "Needs review";
            const name = event.person;
            return (
              <button
                type="button"
                className={`event-card patient-card ${acknowledged ? "acknowledged" : "needs-review"}`}
                key={event.id}
                onClick={() => onReview(event.id)}
                aria-label={`Review ${name}, ${status.toLowerCase()}`}
              >
                <Silhouette />
                <span className="patient-content">
                  <span className="patient-card-head">
                    <span className="patient-id">{name}</span>
                    <span className="patient-status">
                      <span className="patient-status-dot" aria-hidden="true" />
                      {status}
                    </span>
                    <span className="patient-details-toggle" aria-hidden="true">
                      Details <ChevronDown size={12} />
                    </span>
                  </span>
                  <span className="patient-reason">{event.reason}</span>
                  <span className="patient-tags">
                    <span className="patient-tag">
                      {event.kind === "posture"
                        ? "Posture change"
                        : event.kind === "fall"
                          ? "Fall / faint"
                          : "Reassessment due"}
                    </span>
                    <span className="patient-tag">
                      {patient
                        ? `Priority ${patient.priority}`
                        : "Unconfirmed identity"}
                    </span>
                  </span>
                  <span className="patient-card-footer">
                    <span className="patient-source">
                      {event.source}
                      <span className="patient-review-action">Open review</span>
                    </span>
                    <Timer label="Waiting" since={event.createdAt} now={now} />
                  </span>
                </span>
              </button>
            );
          })}
          {observed.map(({ feed, track }) => (
            <ObservedCard
              key={`${feed.id}:${track.key}`}
              feed={feed}
              track={track}
              patient={patients.find(
                (patient) => patient.id === track.patientId,
              )}
              now={now}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
