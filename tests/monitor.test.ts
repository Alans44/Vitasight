import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.ts";
import { Monitor } from "../server/monitor.ts";
import { demoDetections } from "../server/app.ts";

function fixture() {
  const store = new Store(":memory:"),
    monitor = new Monitor(store);
  store.configure(
    {
      sustainSeconds: 3,
      postureThreshold: 0.45,
      overdueMinutes: 30,
      detectionSensitivity: "balanced",
    },
    "Fixture",
  );
  let now = 100_000;
  const feed = monitor.start("Room A", "demo", now);
  const patient = {
    id: randomUUID(),
    name: "Example person",
    context: "Fixture",
    priority: 2,
    mode: "demo" as const,
    assessedAt: now,
  };
  store.savePatient(patient);
  const step = (scene = "resting", delta = 500) => {
    now += delta;
    monitor.ingest(feed.id, feed.session, demoDetections(scene), now, now);
  };
  const sustain = () => {
    for (let i = 0; i < 8; i++) step("posture");
  };
  step();
  monitor.associate(feed.id, feed.tracks[0].key, patient.id, now);
  return { store, monitor, feed, patient, step, sustain, time: () => now };
}
test("sustained observation → acknowledgment → assignment → recorded reassessment preserves initial priority", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 6; i++) f.step("posture");
    assert.equal(f.store.events().length, 0);
    f.step("posture");
    const event = f.store.events()[0];
    assert.ok(event);
    assert.equal(event.patientId, f.patient.id);
    f.store.action(
      event.id,
      { action: "acknowledge", actor: "AB", note: "" },
      f.time(),
    );
    assert.equal(f.store.events()[0].status, "acknowledged");
    f.store.action(
      event.id,
      { action: "assign", actor: "AB", note: "" },
      f.time(),
    );
    assert.equal(f.store.events()[0].assignedTo, "AB");
    assert.throws(() =>
      f.store.action(event.id, { action: "reassess", actor: "AB", note: "" }),
    );
    f.store.action(
      event.id,
      {
        action: "reassess",
        actor: "AB",
        note: "Checked in person; follow-up recorded.",
      },
      f.time(),
    );
    assert.equal(f.store.events()[0].status, "resolved");
    assert.equal(f.store.patients()[0].priority, 2);
    assert.equal(f.store.patients()[0].assessedAt, f.time());
    assert.equal(
      f.store.audit().filter((a) => a.eventId === event.id).length,
      4,
    );
    assert.throws(() =>
      f.store.action(event.id, {
        action: "dismiss",
        actor: "AB",
        note: "Closed",
      }),
    );
  } finally {
    f.store.close();
  }
});
test("closing a request does not retrigger the same episode; a recovery permits a new one", () => {
  const f = fixture();
  try {
    f.sustain();
    f.sustain();
    assert.equal(f.store.events().length, 1);
    f.store.action(f.store.events()[0].id, {
      action: "dismiss",
      actor: "AB",
      note: "Normal movement observed.",
    });
    f.sustain();
    assert.equal(f.store.events().length, 1);
    f.step();
    f.sustain();
    assert.equal(f.store.events().length, 2);
  } finally {
    f.store.close();
  }
});
test("overlap removes patient associations and suppresses review requests", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 9; i++) f.step("overlap");
    assert.equal(f.feed.tracks[0].patientId, null);
    assert.equal(f.feed.tracks[0].ambiguous, true);
    assert.throws(() =>
      f.monitor.associate(
        f.feed.id,
        f.feed.tracks[0].key,
        f.patient.id,
        f.time(),
      ),
    );
    assert.equal(f.store.events().length, 0);
  } finally {
    f.store.close();
  }
});
test("unusable landmarks interrupt the sustain window instead of counting as normal or concerning", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 5; i++) f.step("posture");
    f.step("occluded");
    assert.equal(f.feed.tracks[0].score, null);
    assert.equal(f.feed.tracks[0].since, null);
    for (let i = 0; i < 5; i++) f.step("posture");
    assert.equal(f.store.events().length, 0);
    for (let i = 0; i < 2; i++) f.step("posture");
    assert.equal(f.store.events().length, 1);
  } finally {
    f.store.close();
  }
});
test("visibility gaps clear associations and never transfer identity to a new track", () => {
  const f = fixture();
  try {
    f.step("posture", 2500);
    assert.equal(f.feed.tracks[0].patientId, null);
    const old = f.feed.tracks[0].key;
    f.step("resting", 6000);
    const latest = f.feed.tracks.find((t) => t.lastSeen === f.time());
    assert.notEqual(latest!.key, old);
    assert.equal(latest!.patientId, null);
  } finally {
    f.store.close();
  }
});
test("detection order changes retain source-scoped identities", () => {
  const f = fixture();
  try {
    const keys = new Map(f.feed.tracks.map((t) => [t.externalId, t.key]));
    f.monitor.ingest(
      f.feed.id,
      f.feed.session,
      demoDetections("resting").reverse(),
      f.time() + 500,
      f.time() + 500,
    );
    for (const track of f.feed.tracks)
      assert.equal(track.key, keys.get(track.externalId));
    const second = f.monitor.start("Room B", "demo", f.time());
    f.monitor.ingest(
      second.id,
      second.session,
      demoDetections("resting"),
      f.time() + 500,
      f.time() + 500,
    );
    assert.notEqual(second.tracks[0].key, f.feed.tracks[0].key);
  } finally {
    f.store.close();
  }
});
test("two simultaneous sources create two durable requests; no global alert throttle", () => {
  const f = fixture();
  try {
    const other = f.monitor.start("Room B", "demo", f.time());
    for (let i = 0; i < 8; i++) {
      f.step("posture");
      f.monitor.ingest(
        other.id,
        other.session,
        demoDetections("posture"),
        f.time(),
        f.time(),
      );
    }
    assert.equal(f.store.events().length, 2);
  } finally {
    f.store.close();
  }
});
test("live/demo association is isolated and one visible person cannot occupy two tracks", () => {
  const f = fixture();
  try {
    assert.throws(() =>
      f.monitor.associate(
        f.feed.id,
        f.feed.tracks[1].key,
        f.patient.id,
        f.time(),
      ),
    );
    const live = f.monitor.start("Camera", "live", f.time());
    f.monitor.ingest(
      live.id,
      live.session,
      demoDetections("resting"),
      f.time() + 500,
      f.time() + 500,
    );
    assert.throws(() =>
      f.monitor.associate(
        live.id,
        live.tracks[0].key,
        f.patient.id,
        f.time() + 500,
      ),
    );
  } finally {
    f.store.close();
  }
});
test("duplicate, future, old and expired-session observations are rejected", () => {
  const f = fixture();
  try {
    assert.throws(() =>
      f.monitor.ingest(f.feed.id, f.feed.session, [], f.time(), f.time()),
    );
    assert.throws(() =>
      f.monitor.ingest(
        f.feed.id,
        f.feed.session,
        [],
        f.time() + 5000,
        f.time(),
      ),
    );
    assert.throws(() =>
      f.monitor.ingest(
        f.feed.id,
        f.feed.session,
        [],
        f.time() + 500,
        f.time() + 10_000,
      ),
    );
    const d = demoDetections("resting")[0];
    assert.throws(() =>
      f.monitor.ingest(
        f.feed.id,
        f.feed.session,
        [d, d],
        f.time() + 500,
        f.time() + 500,
      ),
    );
    f.monitor.stop(f.feed.id);
    assert.throws(() =>
      f.monitor.ingest(
        f.feed.id,
        f.feed.session,
        [],
        f.time() + 500,
        f.time() + 500,
      ),
    );
  } finally {
    f.store.close();
  }
});
test("restart persists separate patient, event and audit records without resurrecting monitoring", () => {
  const dir = mkdtempSync(join(tmpdir(), "vitasight-")),
    file = join(dir, "db.sqlite");
  const f = fixture();
  let saved: Store | undefined;
  try {
    f.sustain();
    saved = new Store(file);
    saved.savePatient(f.patient);
    saved.create(f.store.events()[0]);
    saved.configure(
      { sustainSeconds: 5, postureThreshold: 0.5, overdueMinutes: 20 },
      "AB",
    );
    saved.close();
    saved = new Store(file);
    assert.equal(saved.events().length, 1);
    assert.equal(saved.patients().length, 1);
    assert.equal(saved.settings().sustainSeconds, 5);
    assert.equal(new Monitor(saved).feeds.size, 0);
    assert.equal(saved.audit().length, 2);
  } finally {
    saved?.close();
    f.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("reassessment resets the overdue reminder while retaining nurse priority", () => {
  const f = fixture();
  try {
    f.store.configure(
      { sustainSeconds: 3, postureThreshold: 0.45, overdueMinutes: 1 },
      "AB",
    );
    f.store.savePatient({ ...f.patient, assessedAt: f.time() - 70_000 });
    f.step();
    const event = f.store.events()[0];
    assert.equal(event.kind, "overdue");
    f.store.action(
      event.id,
      { action: "reassess", actor: "AB", note: "Follow-up completed" },
      f.time(),
    );
    f.step();
    assert.equal(f.store.events().filter((e) => e.status === "open").length, 0);
    assert.equal(f.store.patients()[0].priority, 2);
  } finally {
    f.store.close();
  }
});
test("demo posture scene marks seated and latches SLUMP on the same track after recovery", () => {
  const f = fixture();
  try {
    assert.equal(f.feed.tracks[0].seated, true);
    f.sustain();
    assert.equal(f.feed.tracks[0].slumpDetected, true);
    assert.equal(f.store.events()[0].kind, "slump");
    f.step("resting");
    assert.equal(f.feed.tracks[0].slumpDetected, true);
    assert.equal(f.feed.tracks[0].potentialSlump, false);
  } finally {
    f.store.close();
  }
});
