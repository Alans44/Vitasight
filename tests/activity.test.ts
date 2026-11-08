import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
import { Monitor } from "../server/monitor.ts";
import { demoDetections } from "../server/app.ts";
import { SmsService } from "../server/sms.ts";
import type { Detection } from "../shared/contracts.ts";

test("a deep seated slump stays separate from a fall alert", () => {
  const f = fixture();
  try {
    f.step("resting");
    for (let i = 0; i < 12; i++) f.step("posture");
    assert.equal(f.store.events().length, 1);
    assert.equal(f.store.events()[0].kind, "slump");
    assert.equal(f.feed.tracks[0].fallDetected, false);
  } finally {
    f.store.close();
  }
});

function fixture(mode: "live" | "demo" = "demo") {
  const store = new Store(":memory:"),
    monitor = new Monitor(store);
  let now = 100_000;
  const feed = monitor.start("Waiting room", mode, now);
  const frame = (detections: Detection[], delta = 120) => {
    now += delta;
    monitor.ingest(feed.id, feed.session, detections, now, now);
  };
  const step = (scene: string, delta = 120) =>
    frame(demoDetections(scene), delta);
  return { store, monitor, feed, frame, step, time: () => now };
}

test("high-sensitivity defaults show potential slump immediately and alert after 0.75 seconds", () => {
  const f = fixture();
  try {
    assert.equal(f.store.settings().detectionSensitivity, "high");
    assert.equal(f.store.settings().sustainSeconds, 0.75);
    f.step("resting");
    f.step("slump");
    assert.equal(f.feed.tracks[0].potentialSlump, true);
    assert.equal(f.feed.tracks[0].slumpDetected, false);
    f.step("slump", 700);
    assert.equal(f.store.events().length, 0);
    f.step("slump", 60);
    assert.equal(f.store.events()[0].kind, "slump");
    assert.equal(f.feed.tracks[0].slumpDetected, true);
    assert.equal(f.feed.tracks[1].slumpDetected, false);
  } finally {
    f.store.close();
  }
});

test("a rapid collapse raises a fall alert before the slump timer and remains deduplicated", () => {
  const f = fixture();
  try {
    f.step("resting");
    f.step("fall");
    const event = f.store.events()[0];
    assert.equal(event.kind, "fall");
    assert.match(event.reason, /Check the person immediately/);
    assert.ok(event.evidence.collapse! >= 0.18);
    assert.equal(f.feed.tracks[0].fallDetected, true);
    for (let i = 0; i < 16; i++) f.step("fall");
    assert.equal(f.store.events().length, 1);
    f.store.action(
      event.id,
      { action: "dismiss", actor: "Tester", note: "Controlled geometry test." },
      f.time(),
    );
    for (let i = 0; i < 16; i++) f.step("fall");
    assert.equal(f.store.events().length, 1);
    f.step("resting");
    f.step("resting", 1100);
    assert.equal(f.feed.tracks[0].fallDetected, true);
    f.step("fall");
    assert.equal(f.store.events().length, 2);
  } finally {
    f.store.close();
  }
});

test("a person already horizontal can raise a fall alert without a prior upright baseline", () => {
  const f = fixture();
  try {
    f.step("fall");
    assert.equal(f.store.events().length, 0);
    f.step("fall", 260);
    assert.equal(f.store.events()[0].kind, "fall");
    assert.ok(f.store.events()[0].evidence.torsoAngle! > 55);
  } finally {
    f.store.close();
  }
});

test("high sensitivity catches smaller collapses that balanced mode does not call a fall", () => {
  for (const sensitivity of ["high", "balanced"] as const) {
    const f = fixture();
    try {
      f.store.configure(
        { ...f.store.settings(), detectionSensitivity: sensitivity },
        "Tester",
      );
      f.step("resting");
      const lowered = demoDetections("resting");
      lowered[0].points[0].y = 0.6;
      f.frame(lowered);
      assert.equal(
        f.store.events().filter((event) => event.kind === "fall").length,
        sensitivity === "high" ? 1 : 0,
      );
    } finally {
      f.store.close();
    }
  }
});

test("occlusion, overlapping people, and visibility gaps do not invent rapid-collapse evidence", () => {
  for (const interruption of ["occlusion", "overlap", "gap"]) {
    const f = fixture();
    try {
      f.step("resting");
      if (interruption === "occlusion") f.step("occluded");
      if (interruption === "overlap") {
        const overlapping = demoDetections("fall");
        overlapping[1].box = [...overlapping[0].box];
        f.frame(overlapping);
        assert.equal(f.store.events().length, 0);
      }
      const lowered = demoDetections("resting");
      lowered[0].points[0].y = 0.6;
      f.frame(lowered, interruption === "gap" ? 2200 : 120);
      f.frame(lowered);
      assert.equal(
        f.store.events().filter((event) => event.kind === "fall").length,
        0,
      );
    } finally {
      f.store.close();
    }
  }
});

test("camera translation, zoom, and ordinary upright motion do not trigger a fall", () => {
  const f = fixture();
  try {
    f.step("resting");
    for (let i = 0; i < 12; i++) {
      const detection = demoDetections("resting")[0];
      const scale = i % 2 ? 0.9 : 1;
      const offset = i % 3 ? 0.02 : 0;
      detection.box = [
        0.5 + (detection.box[0] - 0.5) * scale,
        0.5 + (detection.box[1] - 0.5) * scale + offset,
        detection.box[2] * scale,
        detection.box[3] * scale,
      ];
      detection.points = detection.points.map((point) => ({
        ...point,
        x: 0.5 + (point.x - 0.5) * scale,
        y: 0.5 + (point.y - 0.5) * scale + offset,
      }));
      f.frame([detection]);
    }
    assert.equal(f.store.events().length, 0);
  } finally {
    f.store.close();
  }
});

test("slump uses visible ears and ankle fallback without requiring wrist or knee landmarks", () => {
  const f = fixture();
  try {
    const scene = demoDetections("slump");
    for (const i of [0, 9, 10, 13, 14]) scene[0].points[i].confidence = 0.1;
    scene[0].points[3].y = scene[0].points[4].y = 0.36;
    f.frame(scene);
    f.frame(scene, 800);
    assert.equal(f.store.events()[0].kind, "slump");
  } finally {
    f.store.close();
  }
});

test("fall state stays isolated across sources and follows tracker IDs through detection reordering", () => {
  const f = fixture();
  try {
    f.step("resting");
    const key = f.feed.tracks[0].key;
    const other = f.monitor.start("Another room", "demo", f.time());
    f.monitor.ingest(
      other.id,
      other.session,
      demoDetections("resting"),
      f.time() + 10,
      f.time() + 10,
    );
    f.frame(demoDetections("fall").reverse());
    assert.equal(
      f.feed.tracks.find((track) => track.key === key)!.fallDetected,
      true,
    );
    assert.equal(other.tracks[0].fallDetected, false);
    assert.equal(f.store.events()[0].source, "Waiting room");
  } finally {
    f.store.close();
  }
});

test("a live fall queues one text and preserves the fall explanation and event origin", async () => {
  const f = fixture("live");
  let requests = 0,
    body = "";
  const sms = new SmsService(f.store, {
    credentials: {
      accountSid: "AC" + "1".repeat(32),
      authToken: "2".repeat(32),
      fromNumber: "+15005550006",
    },
    now: f.time,
    fetcher: async (_url, input) => {
      requests++;
      body = new URLSearchParams(String(input?.body)).get("Body")!;
      return Response.json({ sid: "SM" + "3".repeat(32), status: "queued" });
    },
  });
  try {
    sms.configure({
      enabled: true,
      recipient: "+15005550009",
      includeDemo: false,
      trialTemplate: "",
      actor: "Tester",
    });
    f.step("resting");
    f.step("fall");
    await sms.tick();
    for (let i = 0; i < 10; i++) f.step("fall");
    await sms.tick();
    assert.equal(requests, 1);
    assert.match(body, /Possible fall detected/);
    assert.equal(f.store.smsNotifications()[0].mode, "live");
    assert.equal(f.store.smsNotifications()[0].eventId, f.store.events()[0].id);
    assert.ok(
      f.store.audit().some((entry) => entry.action === "Fall detected"),
    );
  } finally {
    f.store.close();
  }
});
