import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { createApp, demoDetections } from "../server/app.ts";

async function harness(fetcher?: typeof fetch) {
  const store = new Store(":memory:"),
    { app, monitor } = createApp(store, { fetcher });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const r = await fetch(url + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  return {
    store,
    monitor,
    url,
    call,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      store.close();
    },
  };
}
test("API enforces local origin, JSON, schema bounds and live/simulation isolation", async () => {
  const h = await harness();
  try {
    assert.equal(
      (
        await h.call("/state", undefined, {
          Origin: "https://untrusted.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await h.call(
          "/sources",
          { label: "X", mode: "live" },
          { "Content-Type": "text/plain" },
        )
      ).status,
      415,
    );
    assert.equal(
      (await h.call("/sources", { label: "", mode: "live" })).status,
      400,
    );
    const live = (await h.call("/sources", { label: "Camera", mode: "live" }))
      .data;
    assert.equal(
      (
        await h.call(`/sources/${live.id}/demo`, {
          session: live.session,
          scene: "posture",
        })
      ).status,
      400,
    );
    const demo = (await h.call("/sources", { label: "Demo", mode: "demo" }))
      .data;
    assert.equal(
      (
        await h.call(`/sources/${demo.id}/frame`, {
          session: demo.session,
          timestamp: Date.now(),
          jpeg: "data:image/jpeg;base64,/9j/2Q==",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.call(`/sources/${demo.id}/demo`, {
          session: demo.session,
          scene: "resting",
        })
      ).status,
      200,
    );
    const updated = await h.call(`/sources/${demo.id}/demo`, {
      session: demo.session,
      scene: "resting",
    });
    assert.equal(updated.data.feed.id, demo.id);
    assert.equal(updated.data.feed.tracks.length, 2);
    const exported = await h.call("/export");
    assert.equal(exported.data.patients[0].mode, "demo");
    assert.equal(
      (await h.call("/settings", { sustainSeconds: 0 })).status,
      404,
    );
  } finally {
    await h.close();
  }
});
test("model output is schema-checked and must match the submitted session and frame", async () => {
  let mode = "valid",
    requests = 0;
  const h = await harness(async (_url, init) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    return Response.json({
      session: mode === "wrong-session" ? "old" : body.session,
      timestamp: body.timestamp,
      detections:
        mode === "malformed"
          ? [{ id: "x", points: [] }]
          : demoDetections("resting"),
    });
  });
  try {
    const live = (await h.call("/sources", { label: "Camera", mode: "live" }))
      .data;
    const frame = () => ({
      session: live.session,
      timestamp: Date.now(),
      jpeg: "data:image/jpeg;base64,/9j/2Q==",
    });
    const submitted = frame();
    const response = await h.call(`/sources/${live.id}/frame`, submitted);
    assert.equal(response.status, 200);
    assert.equal(response.data.feed.lastFrame, submitted.timestamp);
    assert.equal(response.data.feed.tracks.length, 2);
    mode = "wrong-session";
    assert.equal(
      (await h.call(`/sources/${live.id}/frame`, frame())).status,
      400,
    );
    mode = "malformed";
    assert.equal(
      (await h.call(`/sources/${live.id}/frame`, frame())).status,
      400,
    );
    assert.equal(requests, 3);
    assert.equal(h.store.events().length, 0);
  } finally {
    await h.close();
  }
});
test("stopping a source during inference rejects late results and concurrent frames are bounded", async () => {
  let release: () => void = () => {},
    started: () => void = () => {};
  const ready = new Promise<void>((r) => {
      started = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  const h = await harness(async (url, init) => {
    if (String(url).endsWith("/release")) return Response.json({ ok: true });
    started();
    await wait;
    const body = JSON.parse(String(init?.body));
    return Response.json({
      session: body.session,
      timestamp: body.timestamp,
      detections: demoDetections("posture"),
    });
  });
  try {
    const live = (await h.call("/sources", { label: "Camera", mode: "live" }))
        .data,
      frame = {
        session: live.session,
        timestamp: Date.now(),
        jpeg: "data:image/jpeg;base64,/9j/2Q==",
      };
    const pending = h.call(`/sources/${live.id}/frame`, frame);
    await ready;
    assert.equal(
      (await h.call(`/sources/${live.id}/frame`, frame)).status,
      429,
    );
    await h.call(`/sources/${live.id}/stop`, {});
    release();
    assert.equal((await pending).status, 400);
    assert.equal(h.monitor.feeds.size, 0);
    assert.equal(h.store.events().length, 0);
  } finally {
    release();
    await h.close();
  }
});
