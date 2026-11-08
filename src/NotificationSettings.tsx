import { useState, type FormEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import type { SmsSnapshot } from "../shared/contracts";
import { smsStatusLabel } from "../shared/notifications";
import { api } from "./api";

export default function NotificationSettings({
  snapshot,
  actor,
  refresh,
}: {
  snapshot: SmsSnapshot;
  actor: string;
  refresh: () => Promise<void>;
}) {
  const [preferences, setPreferences] = useState(snapshot.preferences);
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [fromNumber, setFromNumber] = useState(snapshot.fromNumber);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const dirty =
    JSON.stringify(preferences) !== JSON.stringify(snapshot.preferences) ||
    !!accountSid ||
    !!authToken ||
    fromNumber !== snapshot.fromNumber;
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(
        "/notifications",
        {
          ...preferences,
          actor,
          ...(accountSid.trim() ? { accountSid: accountSid.trim() } : {}),
          ...(authToken.trim() ? { authToken: authToken.trim() } : {}),
          ...(fromNumber.trim() ? { fromNumber: fromNumber.trim() } : {}),
        },
        "PUT",
      );
      setAccountSid("");
      setAuthToken("");
      await refresh();
      setNotice(
        preferences.enabled
          ? "Text alerts enabled for new events."
          : "Settings saved. Automatic texts are paused.",
      );
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/notifications/test", {});
      await refresh();
      setNotice("Test text queued. Delivery status appears below.");
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="settings-card notification-settings"
      aria-label="Text alerts"
    >
      <div className="panel-title-row">
        <h2>
          <MessageSquare size={17} /> Text alerts
        </h2>
        <span className={"tag " + (snapshot.configured ? "sms-ready" : "")}>
          {snapshot.configured
            ? "Sender configured"
            : snapshot.credentialsSaved
              ? "Add sender number"
              : "Connect Twilio"}
        </span>
      </div>
      <p>One text per new posture event or reassessment reminder.</p>
      <div className="notification-columns">
        <form onSubmit={save}>
          <label className="notification-checkbox">
            <input
              type="checkbox"
              checked={preferences.enabled}
              onChange={(e) =>
                setPreferences({ ...preferences, enabled: e.target.checked })
              }
            />
            Send automatic text alerts
          </label>
          <label className="field">
            Recipient phone number
            <input
              type="tel"
              autoComplete="tel"
              placeholder="+15551234567"
              value={preferences.recipient}
              onChange={(e) =>
                setPreferences({ ...preferences, recipient: e.target.value })
              }
            />
          </label>
          <label className="notification-checkbox">
            <input
              type="checkbox"
              checked={preferences.includeDemo}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  includeDemo: e.target.checked,
                })
              }
            />
            Also text simulated events
          </label>
          <details className="sms-connection" open={!snapshot.configured}>
            <summary>Twilio connection</summary>
            <label className="field">
              Account SID
              <input
                autoComplete="off"
                placeholder={
                  snapshot.credentialsSaved ? "Saved locally" : "AC…"
                }
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
              />
            </label>
            <label className="field">
              Auth token
              <input
                type="password"
                autoComplete="new-password"
                placeholder={
                  snapshot.credentialsSaved
                    ? "Saved locally · enter to replace"
                    : "Twilio auth token"
                }
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
              />
            </label>
            <label className="field">
              Twilio sender number
              <input
                type="tel"
                autoComplete="off"
                placeholder="+15551234567"
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
              />
            </label>
            <p className="small muted">
              Credentials stay on this computer.{" "}
              <a
                href="https://console.twilio.com/"
                target="_blank"
                rel="noreferrer"
              >
                Open Twilio
              </a>
            </p>
          </details>
          <div className="row wrap notification-actions">
            <button className="primary" disabled={busy || !actor.trim()}>
              Save text settings
            </button>
            <button
              type="button"
              disabled={
                busy ||
                dirty ||
                !snapshot.configured ||
                !snapshot.preferences.recipient
              }
              onClick={() => void test()}
            >
              <Send size={14} /> Send test text
            </button>
          </div>
          {notice && (
            <p className="notification-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="notification-error" role="alert">
              {error}
            </p>
          )}
        </form>
        <div className="notification-history">
          <h3>Recent texts</h3>
          {snapshot.notifications.length === 0 ? (
            <p className="muted small">No texts yet.</p>
          ) : (
            <ol>
              {snapshot.notifications.slice(0, 8).map((message) => (
                <li key={message.id}>
                  <div className="row between wrap">
                    <span className={"sms-status sms-" + message.status}>
                      {smsStatusLabel[message.status]}
                    </span>
                    <time>
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </time>
                  </div>
                  <p className="sms-body">{message.body}</p>
                  {message.error && (
                    <p className="notification-error">{message.error}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="small muted">
            Accepted means the provider has the message. Delivered requires
            carrier confirmation.
          </p>
        </div>
      </div>
    </section>
  );
}
