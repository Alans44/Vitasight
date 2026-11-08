import { useEffect, useRef, useState, type RefObject } from "react";
import type { Feed } from "../shared/contracts";
import type { Launch } from "./SourceCard";
import { PulseBuffer, sceneRGB, type PulseReading } from "./rppg";
import { scenePresentation } from "./pulse-presentation";
import { faceRegions } from "./skin";
import type {
  FaceSignal,
  FaceTemplate,
  PulseRequest,
  PulseResponse,
} from "./pulse-types";
export type { FacePoint, FaceSignal, FaceTemplate } from "./pulse-types";
export { sampleSkin } from "./skin";

let templatePromise: Promise<FaceTemplate> | undefined;
function template() {
  return (templatePromise ??= fetch("/vision/face-template.json")
    .then(async (r) => {
      if (!r.ok) throw Error("Face model unavailable");
      return r.json() as Promise<FaceTemplate>;
    })
    .catch((error) => {
      templatePromise = undefined;
      throw error;
    }));
}

export function usePulse(
  feed: Feed,
  launch: Launch | undefined,
  video: RefObject<HTMLVideoElement | null>,
) {
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const [faces, setFaces] = useState<FaceSignal[]>([]),
    [topology, setTopology] = useState<FaceTemplate | null>(null),
    [issue, setIssue] = useState(""),
    [analysisMs, setAnalysisMs] = useState(0);
  useEffect(() => {
    if (!launch) {
      setFaces([]);
      return;
    }
    let active = true,
      animation = 0,
      worker: Worker | undefined,
      stopDemo = () => {};
    const start = async () => {
      try {
        const mesh = await template();
        if (!active) return;
        setTopology(mesh);
        setIssue("");
        if (launch.kind === "demo") {
          const buffers = new Map<string, PulseBuffer>(),
            readings = new Map<string, { at: number; value: PulseReading }>();
          const tick = () => {
            if (!active) return;
            const now = performance.now();
            const next = feedRef.current.tracks
              .filter(
                (t) =>
                  Date.now() - t.lastSeen < 2000 &&
                  t.quality >= 0.6 &&
                  !t.ambiguous,
              )
              .map((track, index) => {
                if (!buffers.has(track.key))
                  buffers.set(track.key, new PulseBuffer());
                const signal = buffers.get(track.key)!,
                  bpm = track.externalId === "1" ? 72 : 86;
                let time = signal.samples.at(-1)?.time ?? now - 20000;
                for (time += 50; time <= now; time += 50)
                  signal.push({ time, rgb: sceneRGB(time, bpm, index) });
                let cached = readings.get(track.key);
                if (!cached || now - cached.at >= 250) {
                  cached = { at: now, value: signal.read() };
                  readings.set(track.key, cached);
                }
                const nose = track.points[0],
                  anchor = mesh.landmarks[1],
                  width = track.box[2] * 0.3,
                  height = width * 2.25;
                const landmarks = mesh.landmarks.map((point) => ({
                  x: nose.x + (point.x - anchor.x) * width,
                  y: nose.y + (point.y - anchor.y) * height,
                  z: point.z,
                }));
                return {
                  id: track.key,
                  trackKey: track.key,
                  landmarks,
                  regions: faceRegions(landmarks),
                  reading: scenePresentation(cached.value, now, index * 1.7),
                };
              });
            const valid = new Set(next.map((f) => f.id));
            for (const id of buffers.keys())
              if (!valid.has(id)) {
                buffers.delete(id);
                readings.delete(id);
              }
            setFaces(next);
          };
          tick();
          const timer = setInterval(tick, 100);
          stopDemo = () => clearInterval(timer);
          return;
        }
        worker = new Worker(new URL("./pulse.worker.ts", import.meta.url), {
          type: "module",
        });
        let ready = false,
          busy = false,
          lastSample = 0,
          lastVideo = -1,
          lastClear = 0,
          epoch = 0,
          pendingEpoch = 0;
        const send = (message: PulseRequest, transfers: Transferable[] = []) =>
          worker?.postMessage(message, transfers);
        const clear = () => {
          epoch++;
          send({ type: "reset" });
          setFaces([]);
        };
        worker.onmessage = (event: MessageEvent<PulseResponse>) => {
          if (!active) return;
          const data = event.data;
          if (data.type === "ready") {
            ready = true;
            return;
          }
          busy = false;
          if (data.type === "result") {
            if (pendingEpoch !== epoch) return;
            setFaces(data.faces);
            setAnalysisMs(data.analysisMs);
            setIssue("");
          } else {
            setIssue(data.message);
            setFaces([]);
          }
        };
        worker.onerror = () => {
          busy = false;
          setIssue("Face tracking unavailable");
        };
        send({ type: "init", origin: location.origin });
        const tick = (now: number) => {
          if (!active) return;
          animation = requestAnimationFrame(tick);
          const element = video.current;
          if (!element || element.paused || element.readyState < 2) {
            if (now - lastClear > 500) {
              clear();
              lastClear = now;
            }
            return;
          }
          if (element.currentTime === lastVideo) {
            if (now - lastSample > 750 && now - lastClear > 500) {
              clear();
              lastClear = now;
            }
            return;
          }
          if (!ready || busy || now - lastSample < 40) return;
          if (
            lastVideo >= 0 &&
            (element.currentTime < lastVideo ||
              element.currentTime - lastVideo > 0.3)
          )
            clear();
          lastVideo = element.currentTime;
          lastSample = now;
          busy = true;
          pendingEpoch = epoch;
          const mediaTime = element.currentTime * 1000;
          void createImageBitmap(element)
            .then((image) => {
              if (!active) {
                image.close();
                return;
              }
              send(
                {
                  type: "frame",
                  frame: image,
                  time: now,
                  mediaTime,
                  tracks: feedRef.current.tracks,
                },
                [image],
              );
            })
            .catch(() => {
              busy = false;
            });
        };
        animation = requestAnimationFrame(tick);
      } catch {
        if (active) setIssue("Face tracking unavailable");
      }
    };
    void start();
    return () => {
      active = false;
      cancelAnimationFrame(animation);
      stopDemo();
      worker?.terminate();
    };
  }, [feed.id, feed.session, launch, video]);
  return { faces, topology, issue, analysisMs };
}
