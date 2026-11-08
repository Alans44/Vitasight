import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { Monitor } from "../server/monitor.ts";
import { createApp, demoDetections } from "../server/app.ts";
import { SmsService } from "../server/sms.ts";
import type { ReviewEvent } from "../shared/contracts.ts";

const credentials = {
  accountSid: "AC" + "1".repeat(32),
  authToken: "2".repeat(32),
  fromNumber: "+15005550006",
};
const providerId = "SM" + "3".repeat(32);
const preferences = {
  trialTemplate: "" as const,
  enabled: true,
  recipient: "+15005550009",
  includeDemo: false,
};
test("trial mode sends the approved template while retaining the full local event description", async () => {
  const store = new Store(":memory:");
  let submitted = "";
  const sms = new SmsService(store, {
    credentials,
    fetcher: async (_url, init) => {
      submitted = new URLSearchParams(String(init?.body)).get("Body")!;
      return Response.json({ sid: providerId, status: "queued" });
    },
  });
  try {
    sms.configure({
      ...preferences,
      trialTemplate: "sms_internal_alerts",
      actor: "Operator",
    });
    store.create(event(Date.now()));
    await sms.tick();
    assert.equal(submitted, "sms_internal_alerts");
    assert.match(store.smsNotifications()[0].body, /Head remained lowered/);
    assert.equal(store.smsNotifications()[0].template, "sms_internal_alerts");
    assert.equal(store.smsNotifications()[0].status, "queued");
  } finally {
    store.close();
  }
});
const event = (now: number, mode: "live" | "demo" = "live"): ReviewEvent => ({
  id: randomUUID(),
  feedId: randomUUID(),
  trackKey: randomUUID(),
  source: "Waiting room 01",
  person: "Person 1",
  patientId: null,
  mode,
  kind: "posture",
  status: "open",
  assignedTo: null,
  reason:
    "Head remained lowered while seated for 3 seconds. Check the person in view.",
  createdAt: now,
  updatedAt: now,
  evidence: { seconds: 3, score: 0.7, threshold: 0.45 },
});

test("a sustained waiting-room observation is logged once, texted once, then carrier-confirmed", async () => {
  const store = new Store(":memory:");
  let now = 100_000;
  const requests: { url: string; init?: RequestInit }[] = [];
  const sms = new SmsService(store, {
    credentials,
    now: () => now,
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({
        sid: providerId,
        status: init?.method === "POST" ? "queued" : "delivered",
        error_code: null,
      });
    },
  });
  try {
    sms.configure({ ...preferences, actor: "Operator" });
    const monitor = new Monitor(store),
      feed = monitor.start("Waiting room 01", "live", now);
    for (let i = 0; i < 12; i++) {
      now += 500;
      monitor.ingest(
        feed.id,
        feed.session,
        demoDetections("posture"),
        now,
        now,
      );
    }
    assert.equal(store.events().length, 1);
    assert.equal(store.smsNotifications().length, 1);
    assert.match(
      store.audit().find((a) => a.action === "Review requested")!.note,
      /Waiting room 01.*(?:Head remained lowered|Potential slump held)/,
    );
    await Promise.all([sms.tick(), sms.tick()]);
    assert.equal(requests.length, 1);
    const sent = new URLSearchParams(String(requests[0].init?.body));
    assert.equal(sent.get("To"), preferences.recipient);
    assert.equal(sent.get("From"), credentials.fromNumber);
    assert.match(sent.get("Body")!, /Vitasight.*Waiting room 01/);
    assert.match(sent.get("Body")!, /3s|3 seconds/);
    assert.equal(store.smsNotifications()[0].status, "queued");
    store.action(
      store.events()[0].id,
      { action: "acknowledge", actor: "Operator", note: "" },
      now,
    );
    await sms.tick();
    assert.equal(requests.length, 1);
    now += 10_001;
    await sms.tick();
    assert.equal(requests.length, 2);
    assert.equal(store.smsNotifications()[0].status, "delivered");
    assert.equal(
      requests.filter((request) => request.init?.method === "POST").length,
      1,
    );
  } finally {
    store.close();
  }
});

test("disabled alerts and excluded demo events never enqueue texts; enabling does not replay history", async () => {
  const store = new Store(":memory:");
  const sms = new SmsService(store, { credentials });
  try {
    store.create(event(Date.now()));
    sms.configure({ ...preferences, actor: "Operator" });
    assert.equal(store.smsNotifications().length, 0);
    store.create(event(Date.now(), "demo"));
    assert.equal(store.smsNotifications().length, 0);
    sms.configure({ ...preferences, includeDemo: true, actor: "Operator" });
    const observed = event(Date.now(), "demo");
    store.create(observed);
    store.create({ ...observed, id: randomUUID() });
    assert.equal(store.smsNotifications().length, 1);
    assert.match(store.smsNotifications()[0].body, /^SIMULATED/);
    sms.configure({ ...preferences, enabled: false, actor: "Operator" });
    assert.equal(store.smsNotifications()[0].status, "canceled");
    store.create(event(Date.now()));
    assert.equal(store.smsNotifications().length, 1);
  } finally {
    store.close();
  }
});

test("SMS rejection is recorded as failed while ambiguous network requests are never resent", async () => {
  for (const failure of ["rejected", "timeout", "server", "malformed"]) {
    const store = new Store(":memory:");
    let calls = 0;
    const sms = new SmsService(store, {
      credentials,
      fetcher: async () => {
        calls++;
        if (failure === "timeout") throw Error("Network lost");
        if (failure === "malformed")
          return Response.json({ result: "unrecognized" });
        return Response.json(
          { code: 20003, message: "Do not expose provider details" },
          { status: failure === "server" ? 503 : 401 },
        );
      },
    });
    try {
      sms.configure({ ...preferences, actor: "Operator" });
      store.create(event(Date.now()));
      await sms.tick();
      await sms.tick();
      assert.equal(calls, 1);
      assert.equal(
        store.smsNotifications()[0].status,
        failure === "rejected" ? "failed" : "unknown",
      );
      assert.doesNotMatch(
        JSON.stringify(sms.snapshot()),
        /Do not expose provider details/,
      );
      assert.doesNotMatch(
        JSON.stringify(sms.snapshot()),
        new RegExp(credentials.authToken),
      );
    } finally {
      store.close();
    }
  }
});

test("pending texts survive restart; interrupted sends become unknown and expired alerts are canceled", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vitasight-sms-"));
  const path = join(directory, "test.sqlite");
  let store = new Store(path),
    now = Date.now(),
    calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({ sid: providerId, status: "sent" });
  };
  try {
    const sms = new SmsService(store, { credentials, fetcher, now: () => now });
    sms.configure({ ...preferences, actor: "Operator" });
    store.create(event(now));
    store.close();
    store = new Store(path);
    await new SmsService(store, {
      credentials,
      fetcher,
      now: () => now,
    }).tick();
    assert.equal(calls, 1);
    assert.equal(store.smsNotifications()[0].status, "sent");
    store.create(event(now));
    const interrupted = store.claimSms(now)!;
    new SmsService(store, { credentials, fetcher, now: () => now });
    assert.equal(
      store.smsNotifications().find((message) => message.id === interrupted.id)!
        .status,
      "unknown",
    );
    store.create(event(now));
    now += 300_001;
    await new SmsService(store, {
      credentials,
      fetcher,
      now: () => now,
    }).tick();
    assert.ok(
      store.smsNotifications().some((message) => message.status === "canceled"),
    );
    assert.equal(
      store.smsNotifications().filter((message) => message.status === "unknown")
        .length,
      1,
    );
  } finally {
    store.close();
    assert.equal(dirname(directory), tmpdir());
    assert.ok(directory.startsWith(join(tmpdir(), "vitasight-sms-")));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("changing recipients cancels unsent event messages and tests have a double-click cooldown", () => {
  const store = new Store(":memory:");
  const sms = new SmsService(store, { credentials });
  try {
    sms.configure({ ...preferences, actor: "Operator" });
    store.create(event(Date.now()));
    sms.configure({
      ...preferences,
      recipient: "+15005550010",
      actor: "Operator",
    });
    assert.equal(store.smsNotifications()[0].status, "canceled");
    const queued = sms.test();
    assert.equal(queued.recipient, "+15005550010");
    assert.throws(() => sms.test(), /30 seconds/);
    assert.equal(store.smsNotifications().length, 2);
  } finally {
    store.close();
  }
});

test("local API validates SMS setup, never exposes credentials, and exports real notification statuses", async () => {
  const store = new Store(":memory:");
  const directory = mkdtempSync(join(tmpdir(), "vitasight-sms-"));
  const credentialsPath = join(directory, "credentials.json");
  const { app, sms } = createApp(store, {
    sms: {
      credentials: {},
      credentialsPath,
      fetcher: async () => Response.json({ sid: providerId, status: "queued" }),
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const configure = (body: unknown) =>
    fetch(url + "/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (await configure({ ...preferences, actor: "Operator" })).status,
      400,
    );
    assert.equal(
      (
        await configure({
          ...preferences,
          ...credentials,
          recipient: "555",
          actor: "Operator",
        })
      ).status,
      400,
    );
    const response = await configure({
      ...preferences,
      ...credentials,
      actor: "Operator",
    });
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.configured, true);
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      new RegExp(credentials.authToken),
    );
    assert.equal(
      JSON.parse(readFileSync(credentialsPath, "utf8")).authToken,
      credentials.authToken,
    );
    const restarted = new SmsService(store, { credentialsPath });
    assert.equal(restarted.snapshot().configured, true);
    const result = await fetch(url + "/notifications/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(result.status, 202);
    await sms.tick();
    const exported = await (await fetch(url + "/export")).json();
    assert.equal(exported.notifications[0].status, "queued");
    assert.doesNotMatch(
      JSON.stringify(exported),
      new RegExp(credentials.authToken),
    );
    const state = await (await fetch(url + "/state")).json();
    assert.equal(state.sms.preferences.recipient, preferences.recipient);
    assert.doesNotMatch(
      JSON.stringify(state),
      new RegExp(credentials.authToken),
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    assert.equal(dirname(directory), tmpdir());
    assert.ok(directory.startsWith(join(tmpdir(), "vitasight-sms-")));
    rmSync(directory, { recursive: true, force: true });
  }
});
