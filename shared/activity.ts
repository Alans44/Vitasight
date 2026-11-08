import type { ReviewEvent, Track } from "./contracts.ts";

export const eventKindLabel: Record<ReviewEvent["kind"], string> = {
  fall: "Possible fall",
  slump: "Slump detected",
  posture: "Posture change",
  overdue: "Reassessment due",
};
export const trackActivityLabel = (track: Track) =>
  track.fallDetected
    ? "Possible fall detected"
    : track.slumpDetected
      ? "Slump detected"
      : track.potentialSlump
        ? "Potential slump"
        : "Observed";
