import type { Track } from "../shared/contracts";
import type { FacePoint } from "./skin";
import type { PulsePresentation } from "./pulse-presentation";
export type { FacePoint } from "./skin";
export type FaceTemplate = {
  landmarks: FacePoint[];
  edges: [number, number][];
};
export type FaceSignal = {
  id: string;
  trackKey?: string;
  landmarks: FacePoint[];
  regions: FacePoint[][];
  reading: PulsePresentation;
};
export type PulseFrame = {
  type: "frame";
  frame: ImageBitmap;
  time: number;
  mediaTime: number;
  tracks: Track[];
};
export type PulseRequest =
  PulseFrame | { type: "init"; origin: string } | { type: "reset" };
export type PulseResponse =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "result"; faces: FaceSignal[]; analysisMs: number };
