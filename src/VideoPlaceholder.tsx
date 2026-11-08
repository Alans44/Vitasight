import { Film, Play } from "lucide-react";

export default function VideoPlaceholder({
  label = "Video placeholder",
  number = "01",
  large = false,
}: {
  label?: string;
  number?: string;
  large?: boolean;
}) {
  return (
    <div
      className={`video-placeholder ${large ? "large" : ""}`}
      role="img"
      aria-label={`${label}, no video loaded`}
    >
      <div className="placeholder-top">
        <span>
          <Film size={12} />
          VIDEO {number}
        </span>
        <span className="placeholder-badge">Placeholder</span>
      </div>
      <div className="placeholder-center">
        <span className="placeholder-play">
          <Play size={large ? 26 : 18} strokeWidth={1} />
        </span>
        <span>{label}</span>
      </div>
      <div className="placeholder-bottom">
        <span>00:00</span>
        <span className="placeholder-progress" />
        <span>—:—</span>
      </div>
    </div>
  );
}
