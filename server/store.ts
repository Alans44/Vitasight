import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Audit,
  Patient,
  ReviewEvent,
  Settings,
  SmsNotification,
  SmsPreferences,
  actionSchema,
} from "../shared/contracts.ts";
import { eventText, smsStatusLabel } from "../shared/notifications.ts";
import type { z } from "zod";

export class Store {
  db: DatabaseSync;
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS patients(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, feed TEXT NOT NULL, track TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS active_event ON events(feed,track,kind) WHERE status IN ('open','acknowledged');
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, at INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sms_settings(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sms_outbox(id TEXT PRIMARY KEY, event TEXT UNIQUE, status TEXT NOT NULL, created INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sms_status ON sms_outbox(status,created);`);
    this.db.prepare("INSERT OR IGNORE INTO settings VALUES(1,?)").run(
      JSON.stringify({
        sustainSeconds: 3,
        postureThreshold: 0.45,
        overdueMinutes: 30,
      }),
    );
    this.db
      .prepare("INSERT OR IGNORE INTO sms_settings VALUES(1,?)")
      .run(
        JSON.stringify({ enabled: false, recipient: "", includeDemo: false }),
      );
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  patients(): Patient[] {
    return this.db
      .prepare("SELECT payload FROM patients")
      .all()
      .map((r) => JSON.parse(String(r.payload)));
  }
  events(): ReviewEvent[] {
    return this.db
      .prepare("SELECT payload FROM events ORDER BY created DESC")
      .all()
      .map((r) => JSON.parse(String(r.payload)));
  }
  audit(limit = 100): Audit[] {
    return this.db
      .prepare("SELECT payload FROM audit ORDER BY at DESC, rowid DESC LIMIT ?")
      .all(limit)
      .map((r) => JSON.parse(String(r.payload)));
  }
  settings(): Settings {
    return JSON.parse(
      String(
        this.db.prepare("SELECT payload FROM settings WHERE id=1").get()!
          .payload,
      ),
    );
  }
  log(
    action: string,
    note: string,
    actor = "System",
    eventId: string | null = null,
    at = Date.now(),
  ) {
    const row: Audit = { id: randomUUID(), at, action, note, actor, eventId };
    this.db
      .prepare("INSERT INTO audit VALUES(?,?,?)")
      .run(row.id, at, JSON.stringify(row));
  }
  savePatient(patient: Patient) {
    this.db
      .prepare(
        "INSERT INTO patients VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(patient.id, JSON.stringify(patient));
  }
  configure(settings: Settings, actor: string) {
    this.transaction(() => {
      this.db
        .prepare("UPDATE settings SET payload=? WHERE id=1")
        .run(JSON.stringify(settings));
      this.log("Rules updated", JSON.stringify(settings), actor);
    });
  }
  create(event: ReviewEvent): boolean {
    return this.transaction(() => {
      const result = this.db
        .prepare("INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?)")
        .run(
          event.id,
          event.feedId,
          event.trackKey,
          event.kind,
          event.status,
          event.createdAt,
          JSON.stringify(event),
        );
      if (result.changes) {
        this.log(
          "Review requested",
          `${event.source} · ${event.person}: ${event.reason}`,
          "System",
          event.id,
          event.createdAt,
        );
        const sms = this.smsPreferences();
        if (
          sms.enabled &&
          sms.recipient &&
          (event.mode === "live" || sms.includeDemo)
        )
          this.queueSms(
            event.id,
            event.mode,
            sms.recipient,
            eventText(event),
            event.createdAt,
          );
      }
      return !!result.changes;
    });
  }
  smsPreferences(): SmsPreferences {
    return JSON.parse(
      String(
        this.db.prepare("SELECT payload FROM sms_settings WHERE id=1").get()!
          .payload,
      ),
    );
  }
  configureSms(preferences: SmsPreferences, actor: string) {
    this.transaction(() => {
      this.db
        .prepare("UPDATE sms_settings SET payload=? WHERE id=1")
        .run(JSON.stringify(preferences));
      for (const message of this.smsWithStatus("pending")) {
        if (
          message.status === "pending" &&
          message.mode !== "test" &&
          (!preferences.enabled ||
            message.recipient !== preferences.recipient ||
            (message.mode === "demo" && !preferences.includeDemo))
        )
          this.updateSms({
            ...message,
            status: "canceled",
            error: "Alert settings changed before sending.",
            updatedAt: Date.now(),
          });
      }
      this.log(
        "Text alerts updated",
        `${preferences.enabled ? "Enabled" : "Paused"}; simulated events ${preferences.includeDemo ? "included" : "excluded"}.`,
        actor,
      );
    });
  }
  smsNotifications(limit = 30): SmsNotification[] {
    return this.db
      .prepare(
        "SELECT payload FROM sms_outbox ORDER BY created DESC, rowid DESC LIMIT ?",
      )
      .all(limit)
      .map((row) => JSON.parse(String(row.payload)));
  }
  smsWithStatus(status: SmsNotification["status"]): SmsNotification[] {
    return this.db
      .prepare("SELECT payload FROM sms_outbox WHERE status=?")
      .all(status)
      .map((row) => JSON.parse(String(row.payload)));
  }
  dueSms(now: number): SmsNotification[] {
    return this.db
      .prepare(
        "SELECT payload FROM sms_outbox WHERE status IN ('queued','sent','unknown') AND json_extract(payload,'$.providerId') IS NOT NULL AND json_extract(payload,'$.nextCheckAt') <= ? ORDER BY created LIMIT 4",
      )
      .all(now)
      .map((row) => JSON.parse(String(row.payload)));
  }
  queueSms(
    eventId: string | null,
    mode: SmsNotification["mode"],
    recipient: string,
    body: string,
    now = Date.now(),
  ) {
    const message: SmsNotification = {
      id: randomUUID(),
      eventId,
      mode,
      recipient,
      body,
      status: "pending",
      providerId: null,
      error: "",
      createdAt: now,
      updatedAt: now,
      nextCheckAt: null,
    };
    this.db
      .prepare("INSERT INTO sms_outbox VALUES(?,?,?,?,?)")
      .run(message.id, eventId, message.status, now, JSON.stringify(message));
    this.log(
      "SMS pending",
      mode === "test"
        ? "Test text queued locally."
        : "Event text queued locally.",
      "System",
      eventId,
      now,
    );
    return message;
  }
  claimSms(now = Date.now()): SmsNotification | null {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT payload FROM sms_outbox WHERE status='pending' ORDER BY created, rowid LIMIT 1",
        )
        .get();
      if (!row) return null;
      const message: SmsNotification = {
        ...JSON.parse(String(row.payload)),
        status: "sending",
        updatedAt: now,
      };
      this.db
        .prepare("UPDATE sms_outbox SET status=?,payload=? WHERE id=?")
        .run(message.status, JSON.stringify(message), message.id);
      return message;
    });
  }
  updateSms(message: SmsNotification) {
    const previous = this.db
      .prepare("SELECT status FROM sms_outbox WHERE id=?")
      .get(message.id);
    this.db
      .prepare("UPDATE sms_outbox SET status=?,payload=? WHERE id=?")
      .run(message.status, JSON.stringify(message), message.id);
    if (previous && previous.status !== message.status)
      this.log(
        smsStatusLabel[message.status],
        message.error ||
          (message.status === "delivered"
            ? "Carrier confirmed delivery."
            : "Text notification status updated."),
        "System",
        message.eventId,
        message.updatedAt,
      );
  }
  action(id: string, input: z.infer<typeof actionSchema>, now = Date.now()) {
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT payload FROM events WHERE id=?")
        .get(id);
      if (!row) throw Error("Review request not found");
      const event: ReviewEvent = JSON.parse(String(row.payload));
      if (["resolved", "dismissed"].includes(event.status))
        throw Error("This request is already closed");
      if (["reassess", "dismiss"].includes(input.action) && !input.note)
        throw Error("Record an outcome or dismissal reason");
      if (input.action === "acknowledge") event.status = "acknowledged";
      if (input.action === "assign") event.assignedTo = input.actor;
      if (input.action === "dismiss") event.status = "dismissed";
      if (input.action === "reassess") {
        event.status = "resolved";
        const person = this.patients().find((p) => p.id === event.patientId);
        if (person) this.savePatient({ ...person, assessedAt: now });
      }
      event.updatedAt = now;
      this.db
        .prepare("UPDATE events SET status=?,payload=? WHERE id=?")
        .run(event.status, JSON.stringify(event), id);
      this.log(input.action, input.note || event.reason, input.actor, id, now);
      return event;
    });
  }
  close() {
    this.db.close();
  }
}
