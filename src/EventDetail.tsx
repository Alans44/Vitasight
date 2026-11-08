import { useState } from "react";
import { X, Check, UserCheck, ClipboardCheck } from "lucide-react";
import type { Audit, ReviewEvent, SmsNotification } from "../shared/contracts";
import { smsStatusLabel } from "../shared/notifications";
import { api } from "./api";
export default function EventDetail({
  event,
  audit,
  notifications,
  actor,
  onClose,
  refresh,
  report,
}: {
  event: ReviewEvent;
  audit: Audit[];
  notifications: SmsNotification[];
  actor: string;
  onClose: () => void;
  refresh: () => Promise<void>;
  report: (s: string) => void;
}) {
  const [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const closed = ["resolved", "dismissed"].includes(event.status);
  async function act(action: string) {
    setBusy(true);
    try {
      await api(`/events/${event.id}/action`, { action, note, actor });
      if (action === "reassess" || action === "dismiss") setNote("");
      await refresh();
    } catch (e) {
      report(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="drawer-shade" onClick={onClose}>
      <section
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="detail-title">{event.person}</h2>
          </div>
          <button
            autoFocus
            className="icon-button"
            aria-label="Close request"
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="row wrap">
          <span className={"tag " + (event.mode === "demo" ? "demo" : "")}>
            {event.mode === "demo" ? "SIMULATED" : "LIVE SOURCE"}
          </span>
          <span className={"status " + event.status}>{event.status}</span>
        </div>
        <p className="detail-reason">{event.reason}</p>
        {notifications
          .filter((message) => message.eventId === event.id)
          .map((message) => (
            <div key={message.id} className="event-notification">
              <span className={"sms-status sms-" + message.status}>
                {smsStatusLabel[message.status]}
              </span>
              {message.error && (
                <p className="notification-error">{message.error}</p>
              )}
            </div>
          ))}
        <dl className="details">
          <div>
            <dt>Source</dt>
            <dd>{event.source}</dd>
          </div>
          <div>
            <dt>Recorded</dt>
            <dd>{new Date(event.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Assigned to</dt>
            <dd>{event.assignedTo || "Unassigned"}</dd>
          </div>
          <div>
            <dt>Identity</dt>
            <dd>
              {event.patientId
                ? "Confirmed when recorded"
                : "Unconfirmed when recorded"}
            </dd>
          </div>
          {event.evidence.score !== undefined && (
            <div>
              <dt>Posture score / rule</dt>
              <dd>
                {event.evidence.score.toFixed(2)} /{" "}
                {event.evidence.threshold?.toFixed(2)}
              </dd>
            </div>
          )}
        </dl>
        <p className="muted small">
          Posture score reflects geometry, not medical risk.
        </p>
        {!closed && (
          <>
            <div className="action-pair">
              <button
                disabled={busy || event.status === "acknowledged"}
                onClick={() => void act("acknowledge")}
              >
                <Check size={16} /> Acknowledge
              </button>
              <button disabled={busy} onClick={() => void act("assign")}>
                <UserCheck size={16} /> Assign to me
              </button>
            </div>
            <label className="field">
              Outcome or dismissal reason
              <textarea
                rows={4}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Record what was checked and the next step."
                maxLength={500}
              />
            </label>
            <button
              className="primary full"
              disabled={busy || !note.trim()}
              onClick={() => void act("reassess")}
            >
              <ClipboardCheck size={17} /> Record reassessment
            </button>
            <button
              className="text-button full"
              disabled={busy || !note.trim()}
              onClick={() => void act("dismiss")}
            >
              Dismiss with reason
            </button>
            <p className="small muted">Recorded as {actor}.</p>
          </>
        )}
        <h3>Activity</h3>
        <ol className="activity">
          {audit
            .filter((a) => a.eventId === event.id)
            .map((a) => (
              <li key={a.id}>
                <strong>{a.action}</strong>
                <span>{a.note}</span>
                <small>
                  {a.actor} · {new Date(a.at).toLocaleTimeString()}
                </small>
              </li>
            ))}
        </ol>
      </section>
    </div>
  );
}
