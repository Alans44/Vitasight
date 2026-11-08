import { randomUUID } from "node:crypto";
import type {
  Detection,
  Feed,
  Mode,
  ReviewEvent,
  Track,
} from "../shared/contracts.ts";
import { Store } from "./store.ts";

const overlap = (a: Detection["box"], b: Detection["box"]) => {
  const area =
    Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return area / (a[2] * a[3] + b[2] * b[3] - area || 1);
};
export function posture(d: Detection) {
  const p = d.points;
  const quality = Math.min(
    ...[0, 5, 6, 11, 12, 13, 14].map((i) => p[i].confidence),
  );
  if (quality < 0.6) return { score: null, quality };
  const shoulders = (p[5].y + p[6].y) / 2,
    hips = (p[11].y + p[12].y) / 2;
  const torso = hips - shoulders;
  const seated = (p[13].y + p[14].y) / 2 - hips < torso * 0.65;
  return {
    quality,
    score:
      torso > 0.03 && seated
        ? Math.max(0, Math.min(1, (p[0].y - shoulders) / torso))
        : 0,
  };
}
export class Monitor {
  feeds = new Map<string, Feed>();
  constructor(public store: Store) {}
  start(label: string, mode: Mode, now = Date.now()) {
    if (this.feeds.size >= 4)
      throw Error("Stop a source before adding another (maximum four)");
    const feed: Feed = {
      id: randomUUID(),
      session: randomUUID(),
      label,
      mode,
      startedAt: now,
      lastFrame: 0,
      status: "waiting",
      error: "",
      tracks: [],
    };
    this.feeds.set(feed.id, feed);
    return feed;
  }
  require(id: string, session: string) {
    const feed = this.feeds.get(id);
    if (!feed || feed.session !== session)
      throw Error("This source session has ended");
    return feed;
  }
  stop(id: string) {
    this.feeds.delete(id);
  }
  associate(id: string, key: string, patientId: string, now = Date.now()) {
    const feed = this.feeds.get(id),
      track = feed?.tracks.find((t) => t.key === key);
    const person = this.store.patients().find((p) => p.id === patientId);
    if (
      !feed ||
      !track ||
      now - track.lastSeen > 2000 ||
      track.ambiguous ||
      track.quality < 0.6
    )
      throw Error("Wait for a clear, visible track");
    if (!person || person.mode !== feed.mode)
      throw Error("Choose a person from the same live or demo workspace");
    if (
      [...this.feeds.values()].some((f) =>
        f.tracks.some(
          (t) =>
            t.key !== key &&
            t.patientId === patientId &&
            now - t.lastSeen < 5000,
        ),
      )
    )
      throw Error("This person is already associated with a visible track");
    track.patientId = patientId;
    this.store.log(
      "Identity confirmed",
      `${person.name} · ${feed.label} · ${track.label}`,
    );
  }
  ingest(
    id: string,
    session: string,
    detections: Detection[],
    timestamp: number,
    now = Date.now(),
  ) {
    const feed = this.require(id, session);
    if (
      timestamp <= feed.lastFrame ||
      timestamp < feed.startedAt ||
      timestamp < now - 3000 ||
      timestamp > now + 2000
    )
      throw Error("Stale or out-of-order frame");
    if (new Set(detections.map((d) => d.id)).size !== detections.length)
      throw Error("Duplicate tracking identities");
    const settings = this.store.settings();
    for (const d of detections) {
      let t = feed.tracks.find(
        (t) => t.externalId === d.id && now - t.lastSeen < 5000,
      );
      if (!t) {
        t = {
          key: randomUUID(),
          externalId: d.id,
          label: `Person ${feed.tracks.length + 1}`,
          box: d.box,
          points: d.points,
          patientId: null,
          lastSeen: now,
          quality: 0,
          ambiguous: false,
          score: null,
          since: null,
          episode: false,
        };
        feed.tracks.push(t);
      }
      const gap = now - t.lastSeen;
      const ambiguous =
        detections.some(
          (other) => other !== d && overlap(d.box, other.box) > 0.3,
        ) || gap > 1500;
      const measure = posture(d);
      if (ambiguous) t.patientId = null;
      Object.assign(t, {
        box: d.box,
        points: d.points,
        lastSeen: now,
        ambiguous,
        ...measure,
      });
      if (ambiguous || measure.quality < 0.6 || measure.score === null) {
        t.since = null;
        continue;
      }
      if (measure.score < settings.postureThreshold) {
        t.since = null;
        t.episode = false;
        continue;
      }
      t.since ??= now;
      if (now - t.since >= settings.sustainSeconds * 1000 && !t.episode) {
        this.request(
          feed,
          t,
          "posture",
          `Head remained lowered while seated for ${settings.sustainSeconds} seconds. Check the person in view.`,
          now,
          {
            score: measure.score,
            threshold: settings.postureThreshold,
            seconds: settings.sustainSeconds,
          },
        );
        t.episode = true;
      }
    }
    feed.tracks = feed.tracks.filter((t) => now - t.lastSeen < 10_000);
    feed.lastFrame = timestamp;
    feed.status = "watching";
    feed.error = "";
    this.expire(now);
  }
  request(
    feed: Feed,
    t: Track,
    kind: ReviewEvent["kind"],
    reason: string,
    now: number,
    evidence: ReviewEvent["evidence"] = {},
  ) {
    const person = this.store.patients().find((p) => p.id === t.patientId);
    this.store.create({
      id: randomUUID(),
      feedId: feed.id,
      source: feed.label,
      trackKey: t.key,
      person: person?.name || t.label,
      patientId: person?.id || null,
      mode: feed.mode,
      kind,
      status: "open",
      assignedTo: null,
      reason,
      createdAt: now,
      updatedAt: now,
      evidence,
    });
  }
  expire(now = Date.now()) {
    const patients = this.store.patients(),
      settings = this.store.settings();
    for (const feed of this.feeds.values()) {
      if (now - feed.lastFrame > 3000 && feed.status === "watching")
        feed.status = "waiting";
      for (const t of feed.tracks) {
        if (now - t.lastSeen > 2000) t.since = null;
        if (now - t.lastSeen > 5000) t.patientId = null;
        const p = patients.find((p) => p.id === t.patientId);
        if (
          p &&
          !t.ambiguous &&
          t.quality >= 0.6 &&
          now - t.lastSeen < 2000 &&
          settings.overdueMinutes > 0 &&
          now - p.assessedAt > settings.overdueMinutes * 60_000
        )
          this.request(
            feed,
            t,
            "overdue",
            "The configured reassessment interval has elapsed.",
            now,
          );
      }
    }
  }
}
