import { useState } from "react";
import { Film, Upload } from "lucide-react";
import VideoPlaceholder from "./VideoPlaceholder";

const videos = ["Waiting room 01", "Waiting room 02", "Waiting room 03"];
export default function VideoLibrary({
  onChooseVideo,
  disabled,
}: {
  onChooseVideo: () => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState(0);
  return (
    <section className="video-library" aria-label="Video library">
      <aside className="library-list">
        <div className="library-heading">
          <div>
            <h1>Library</h1>
            <span>Local video sources</span>
          </div>
          <Film size={19} />
        </div>
        <button
          className="upload-zone"
          onClick={onChooseVideo}
          disabled={disabled}
        >
          <Upload size={25} />
          <strong>Add a video</strong>
          <span>Choose a local video file</span>
        </button>
        <div className="library-section-label">
          VIDEOS <span>03</span>
        </div>
        {videos.map((title, i) => (
          <button
            className={`library-video ${selected === i ? "selected" : ""}`}
            key={title}
            onClick={() => setSelected(i)}
            aria-pressed={selected === i}
          >
            <span className="library-video-icon">
              <Film size={20} />
            </span>
            <span>
              <strong>{title}</strong>
              <small>Video placeholder</small>
            </span>
            <span className="library-video-duration">—:—</span>
          </button>
        ))}
      </aside>
      <div className="library-preview">
        <div className="library-preview-heading">
          <h2>{videos[selected]}</h2>
          <span className="tag">
            VIDEO {String(selected + 1).padStart(2, "0")}
          </span>
        </div>
        <VideoPlaceholder
          label={videos[selected]}
          number={String(selected + 1).padStart(2, "0")}
          large
        />
        <div className="library-timeline">
          <span>Event timeline</span>
          <span>—</span>
          <div />
          <small>No video loaded</small>
        </div>
      </div>
    </section>
  );
}
