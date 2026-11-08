import express from "express";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  actionSchema,
  frameInput,
  modeSchema,
  patientInput,
  poseResponse,
  settingsSchema,
  smsConfigurationSchema,
  type Detection,
} from "../shared/contracts.ts";
import { Monitor } from "./monitor.ts";
import { Store } from "./store.ts";
import { SmsService, type SmsOptions } from "./sms.ts";

export function demoDetections(scene: string): Detection[] {
  return [0, 1].map((n) => {
    const x = 0.12 + n * 0.5,
      shift = scene === "overlap" && n === 1 ? -0.5 : 0;
    const points = Array.from({ length: 17 }, () => ({
      x: x + 0.12 + shift,
      y: 0.2,
      confidence: scene === "occluded" ? 0.2 : 0.95,
    }));
    for (const [i, dx, y] of [
      [
        0,
        0.12,
        n === 0
          ? scene === "posture"
            ? 0.51
            : scene === "slump"
              ? 0.36
              : 0.18
          : 0.18,
      ],
      [5, 0.07, 0.3],
      [6, 0.18, 0.3],
      [7, 0.04, 0.43],
      [8, 0.21, 0.43],
      [9, 0.06, 0.57],
      [10, 0.2, 0.57],
      [11, 0.08, 0.6],
      [12, 0.17, 0.6],
      [13, 0.04, 0.64],
      [14, 0.22, 0.64],
      [15, 0.04, 0.86],
      [16, 0.22, 0.86],
    ])
      points[i] = {
        x: x + dx + shift,
        y,
        confidence: scene === "occluded" ? 0.2 : 0.95,
      };
    if (scene === "fall" && n === 0) {
      for (const [i, px, py] of [
        [0, 0.12, 0.73],
        [1, 0.115, 0.725],
        [2, 0.125, 0.735],
        [3, 0.14, 0.72],
        [4, 0.14, 0.745],
        [5, 0.2, 0.7],
        [6, 0.2, 0.75],
        [7, 0.26, 0.68],
        [8, 0.27, 0.78],
        [9, 0.32, 0.67],
        [10, 0.33, 0.8],
        [11, 0.36, 0.72],
        [12, 0.36, 0.77],
        [13, 0.44, 0.74],
        [14, 0.44, 0.8],
        [15, 0.55, 0.76],
        [16, 0.55, 0.82],
      ])
        points[i] = { x: px, y: py, confidence: 0.95 };
      return { id: String(n + 1), box: [0.08, 0.57, 0.5, 0.29], points };
    }
    return { id: String(n + 1), box: [x + shift, 0.12, 0.27, 0.78], points };
  });
}
type Options = { poseUrl?: string; fetcher?: typeof fetch; sms?: SmsOptions };
export function createApp(store: Store, options: Options = {}) {
  const app = express(),
    monitor = new Monitor(store),
    busy = new Set<string>();
  const sms = new SmsService(store, {
    ...options.sms,
    active: options.sms?.active ?? false,
  });
  const poseUrl =
    options.poseUrl ||
    `http://127.0.0.1:${Number(process.env.POSE_PORT || 8791)}`;
  const fetcher = options.fetcher || fetch;
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const host = req.headers.host;
    if (!host || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
      return res.status(403).json({ error: "Local access only" });
    if (req.headers.origin) {
      try {
        if (
          !["127.0.0.1", "localhost"].includes(
            new URL(req.headers.origin).hostname,
          )
        )
          throw Error();
      } catch {
        return res.status(403).json({ error: "Cross-origin access denied" });
      }
    }
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json"))
      return res.status(415).json({ error: "JSON required" });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "700kb" }));
  app.get("/api/state", (_req, res) => {
    monitor.expire();
    res.json({
      feeds: [...monitor.feeds.values()],
      patients: store.patients(),
      events: store.events(),
      audit: store.audit(),
      settings: store.settings(),
      sms: sms.snapshot(),
      now: Date.now(),
    });
  });
  app.get("/api/vision", async (_req, res) => {
    try {
      const r = await fetcher(`${poseUrl}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      const body = await r.json();
      if (!r.ok || body.engine !== "vitasight-yolo11") throw Error();
      res.json({ ready: true, engine: "YOLO11 Pose + ByteTrack" });
    } catch {
      res.json({ ready: false, engine: "Local vision service is offline" });
    }
  });
  app.post("/api/sources", (req, res) => {
    const input = z
      .object({ label: z.string().trim().min(1).max(60), mode: modeSchema })
      .parse(req.body);
    const feed = monitor.start(input.label, input.mode);
    if (
      input.mode === "demo" &&
      !store.patients().some((p) => p.mode === "demo")
    ) {
      for (const name of ["Alex Morgan", "Jordan Lee"])
        store.savePatient({
          id: randomUUID(),
          name,
          context: "Fictional demonstration record",
          priority: 3,
          mode: "demo",
          assessedAt: Date.now(),
        });
    }
    res.status(201).json(feed);
  });
  app.post("/api/sources/:id/stop", async (req, res) => {
    const feed = monitor.feeds.get(req.params.id);
    monitor.stop(req.params.id);
    if (feed?.mode === "live") {
      try {
        await fetcher(`${poseUrl}/release`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: feed.session }),
          signal: AbortSignal.timeout(1500),
        });
      } catch {}
    }
    res.json({ ok: true });
  });
  app.post("/api/sources/:id/demo", (req, res) => {
    const input = z
      .object({
        session: z.string().uuid(),
        scene: z.enum([
          "resting",
          "posture",
          "slump",
          "fall",
          "occluded",
          "overlap",
        ]),
      })
      .parse(req.body);
    const feed = monitor.require(req.params.id, input.session);
    if (feed.mode !== "demo")
      throw Error("Synthetic observations cannot enter a live source");
    const now = Date.now();
    monitor.ingest(
      feed.id,
      feed.session,
      demoDetections(input.scene),
      now,
      now,
    );
    res.json({ ok: true, feed });
  });
  app.post("/api/sources/:id/frame", async (req, res, next) => {
    const sourceId = req.params.id;
    let acquired = false;
    try {
      const input = frameInput.parse(req.body),
        feed = monitor.require(req.params.id, input.session);
      if (feed.mode !== "live")
        throw Error("Camera frames require a live source");
      if (
        input.timestamp <= feed.lastFrame ||
        input.timestamp < feed.startedAt ||
        Math.abs(input.timestamp - Date.now()) > 3000
      )
        throw Error("Stale frame");
      if (busy.has(feed.id))
        return res
          .status(429)
          .json({ error: "Source busy; discard this frame" });
      busy.add(feed.id);
      acquired = true;
      const r = await fetcher(`${poseUrl}/infer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(5000),
      });
      if (r.status === 429)
        return res
          .status(429)
          .json({ error: "Vision busy; discard this frame" });
      if (!r.ok) throw Error("Local pose inference failed");
      const result = poseResponse.parse(await r.json());
      if (
        result.session !== feed.session ||
        result.timestamp !== input.timestamp
      )
        throw Error("Mismatched pose response");
      monitor.ingest(feed.id, feed.session, result.detections, input.timestamp);
      res.json({ ok: true, feed });
    } catch (error) {
      const feed = monitor.feeds.get(sourceId);
      if (feed && acquired) {
        feed.status = "error";
        feed.error =
          "Vision unavailable. Check the local service; no observations are being inferred.";
      }
      next(error);
    } finally {
      if (acquired) busy.delete(sourceId);
    }
  });
  app.post("/api/patients", (req, res) => {
    const patient = {
      ...patientInput.parse(req.body),
      id: randomUUID(),
      assessedAt: Date.now(),
    };
    store.transaction(() => {
      store.savePatient(patient);
      store.log("Person added", patient.name, "Local user");
    });
    res.status(201).json(patient);
  });
  app.post("/api/sources/:id/associate", (req, res) => {
    const input = z
      .object({ track: z.string().uuid(), patient: z.string().uuid() })
      .parse(req.body);
    monitor.associate(req.params.id, input.track, input.patient);
    res.json({ ok: true });
  });
  app.post("/api/events/:id/action", (req, res) =>
    res.json(store.action(req.params.id, actionSchema.parse(req.body))),
  );
  app.put("/api/settings", (req, res) => {
    const input = z
      .object({
        settings: settingsSchema,
        actor: z.string().trim().min(1).max(60),
      })
      .parse(req.body);
    store.configure(input.settings, input.actor);
    for (const feed of monitor.feeds.values())
      for (const track of feed.tracks) track.since = null;
    res.json({ ok: true });
  });
  app.put("/api/notifications", (req, res) => {
    res.json(sms.configure(smsConfigurationSchema.parse(req.body)));
  });
  app.post("/api/notifications/test", (_req, res) => {
    res.status(202).json(sms.test());
  });
  app.get("/api/export", (_req, res) =>
    res.attachment("vitasight-events.json").json({
      version: 1,
      exportedAt: new Date().toISOString(),
      notice:
        "Local research workspace. Entries retain their live/demo origin; no video is included.",
      patients: store.patients(),
      events: store.events(),
      audit: store.audit(1_000_000),
      notifications: store.smsNotifications(1_000_000),
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Unknown endpoint" }),
  );
  app.use(express.static(resolve("dist")));
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({
        error:
          error instanceof z.ZodError
            ? error.issues.map((i) => i.message).join("; ")
            : error instanceof Error
              ? error.message
              : "Request failed",
      });
    },
  );
  return { app, monitor, sms };
}
