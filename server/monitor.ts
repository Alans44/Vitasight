import { randomUUID } from "node:crypto";
import type {
  Detection,
  Feed,
  Mode,
  ReviewEvent,
  Track,
} from "../shared/contracts.ts";
import { Store } from "./store.ts";
import {
  createPostureMemory,
  POSTURE_CONSTANTS,
  updatePosture,
  type PostureMemory,
} from "./posture-rules.ts";

const overlap = (a: Detection["box"], b: Detection["box"]) => {
  const area =
    Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return area / (a[2] * a[3] + b[2] * b[3] - area || 1);
};

export class Monitor {
  feeds = new Map<string, Feed>();
  private posture = new Map<string, PostureMemory>();
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
    const feed = this.feeds.get(id);
    if (feed) for (const t of feed.tracks) this.posture.delete(t.key);
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
          seated: false,
          potentialSlump: false,
          slumpDetected: false,
          fallDetected: false,
        };
        feed.tracks.push(t);
        this.posture.set(t.key, createPostureMemory());
      }
      const gap = now - t.lastSeen;
      const ambiguous =
        detections.some(
          (other) => other !== d && overlap(d.box, other.box) > 0.3,
        ) || gap > 1500;
      const memory = this.posture.get(t.key) ?? createPostureMemory();
      this.posture.set(t.key, memory);
      const measure = updatePosture(memory, d, ambiguous, now);
      if (ambiguous) t.patientId = null;
      Object.assign(t, {
        box: d.box,
        points: d.points,
        lastSeen: now,
        ambiguous,
        quality: measure.quality,
        score: measure.score,
        seated: measure.seated,
        potentialSlump: measure.potentialSlump,
        slumpDetected: measure.slumpDetected,
        fallDetected: measure.fallDetected,
      });

      // Clear the review episode when the person is upright this frame even if
      // the short averaging window still looks slumped (enables a new request).
      const uprightNow =
        measure.headTorso === null ||
        measure.headTorso < POSTURE_CONSTANTS.POTENTIAL_HEAD_TORSO ||
        !measure.seated;
      if (!measure.liveSlump && uprightNow) {
        memory.slumpEpisode = false;
        t.since = null;
        t.episode = false;
      } else if (measure.liveSlump) {
        t.since ??= now;
        t.episode = memory.slumpEpisode;
        if (!memory.slumpEpisode) {
          this.request(
            feed,
            t,
            "posture",
            "Potential slump held 3s while seated — reassessment requested.",
            now,
            {
              score: measure.score ?? undefined,
              seconds: 3,
            },
          );
          memory.slumpEpisode = true;
          t.episode = true;
        }
      }

      if (!measure.liveFall) memory.fallEpisode = false;
      else if (!memory.fallEpisode) {
        this.request(
          feed,
          t,
          "fall",
          "Rapid collapse toward the floor — possible fall/faint. Check the person in view.",
          now,
          { score: 0.75, seconds: 1 },
        );
        memory.fallEpisode = true;
      }
    }
    const keep = new Set(
      feed.tracks
        .filter((t) => now - t.lastSeen < 10_000)
        .map((t) => t.key),
    );
    for (const key of this.posture.keys()) {
      if (
        feed.tracks.some((t) => t.key === key) &&
        !keep.has(key)
      )
        this.posture.delete(key);
    }
    feed.tracks = feed.tracks.filter((t) => keep.has(t.key));
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
