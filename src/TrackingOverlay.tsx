import { useId } from "react";
import type { Track, Patient } from "../shared/contracts";
import { trackStatusClass, trackStatusLabel } from "../shared/contracts";
import type { FacePoint, FaceSignal, FaceTemplate } from "./usePulse";

const BONES = [
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
];
const XY = (p: FacePoint) => ({ x: p.x * 1000, y: p.y * 562.5 });
const path = (points: FacePoint[], close = false) =>
  points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${(p.x * 1000).toFixed(2)},${(p.y * 562.5).toFixed(2)}`,
    )
    .join(" ") + (close ? " Z" : "");
const dots = (points: FacePoint[]) =>
  points
    .map((p) => `M${(p.x * 1000).toFixed(2)},${(p.y * 562.5).toFixed(2)}h.05`)
    .join(" ");
const mix = (a: FacePoint, b: FacePoint, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const EYES = [
  [33, 160, 158, 133, 153, 144, 33],
  [362, 385, 387, 263, 373, 380, 362],
];
const LIPS = [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91, 61];

function BodyWire({ track }: { track: Track }) {
  const points = track.points,
    meshLines: string[] = [],
    meshPoints: FacePoint[] = [];
  for (const [a, b] of BONES) {
    if (points[a].confidence < 0.6 || points[b].confidence < 0.6) continue;
    const start = points[a],
      end = points[b],
      dx = (end.x - start.x) * 1000,
      dy = (end.y - start.y) * 562.5,
      length = Math.hypot(dx, dy) || 1;
    const width = Math.min(9, track.box[2] * 35),
      nx = ((-dy / length) * width) / 1000,
      ny = ((dx / length) * width) / 562.5;
    const left: FacePoint[] = [],
      right: FacePoint[] = [];
    for (let i = 0; i <= 5; i++) {
      const center = mix(start, end, i / 5),
        scale = Math.sin((Math.PI * i) / 5) * 0.4 + 0.6;
      const l = { x: center.x + nx * scale, y: center.y + ny * scale },
        r = { x: center.x - nx * scale, y: center.y - ny * scale };
      left.push(l);
      right.push(r);
      meshPoints.push(l, r, center);
      meshLines.push(path([l, r]));
      if (i) meshLines.push(path([left[i - 1], r]), path([right[i - 1], l]));
    }
    meshLines.push(path(left), path(right));
  }
  if ([5, 6, 11, 12].every((i) => points[i].confidence >= 0.6)) {
    const rows = Array.from({ length: 7 }, (_, i) =>
      Array.from({ length: 6 }, (_, j) =>
        mix(
          mix(points[5], points[11], i / 6),
          mix(points[6], points[12], i / 6),
          j / 5,
        ),
      ),
    );
    rows.forEach((row, i) => {
      meshLines.push(path(row));
      meshPoints.push(...row);
      if (i)
        row.forEach((p, j) => {
          meshLines.push(path([rows[i - 1][j], p]));
          if (j) meshLines.push(path([rows[i - 1][j - 1], p]));
        });
    });
  }
  const core = points.filter((p, i) => i >= 5 && p.confidence >= 0.6);
  return (
    <>
      <path className="body-surface" d={meshLines.join(" ")} />
      <path className="body-detail-points" d={dots(meshPoints)} />
      <path
        className="body-bones"
        d={BONES.filter(
          ([a, b]) =>
            points[a].confidence >= 0.6 && points[b].confidence >= 0.6,
        )
          .map(([a, b]) => path([points[a], points[b]]))
          .join(" ")}
      />
      {core.map((p, i) => {
        const xy = XY(p);
        return (
          <g key={i}>
            <circle className="joint-halo" cx={xy.x} cy={xy.y} r="5.4" />
            <circle className="joint-core" cx={xy.x} cy={xy.y} r="2.1" />
          </g>
        );
      })}
      {[5, 6, 7, 8, 11, 12, 15, 16]
        .filter((i) => points[i].confidence >= 0.6)
        .map((i) => (
          <text
            className="node-index"
            key={i}
            x={points[i].x * 1000 + 8}
            y={points[i].y * 562.5 - 7}
          >
            {i.toString().padStart(2, "0")}
          </text>
        ))}
    </>
  );
}

export default function TrackingOverlay({
  tracks,
  faces,
  topology,
  patients,
}: {
  tracks: Track[];
  faces: FaceSignal[];
  topology: FaceTemplate | null;
  patients: Patient[];
}) {
  const gridId = useId();
  return (
    <svg
      className="pose-overlay"
      viewBox="0 0 1000 562.5"
      aria-label="Tracked pose overlay"
    >
      <defs>
        <pattern
          id={gridId}
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>
      <rect
        className="tracking-grid"
        width="1000"
        height="562.5"
        fill={`url(#${gridId})`}
      />
      <path
        className="frame-brackets"
        d="M16 40 V16 H40 M960 16 H984 V40 M984 522 V546 H960 M40 546 H16 V522"
      />
      {tracks.map((track, index) => {
        const [x, y, w, h] = track.box.map(
          (v, i) => v * (i % 2 === 0 ? 1000 : 562.5),
        );
        const name =
          patients.find((p) => p.id === track.patientId)?.name || track.label;
        const status = trackStatusLabel(track);
        const label = `${name} · ${status}`;
        return (
          <g key={track.key} className={trackStatusClass(track)}>
            <rect
              className="track-box"
              x={x}
              y={y}
              width={w}
              height={h}
              rx="3"
            />
            <path
              className="track-brackets"
              d={`M${x} ${y + 17}V${y}H${x + 17} M${x + w - 17} ${y}H${x + w}V${y + 17} M${x + w} ${y + h - 17}V${y + h}H${x + w - 17} M${x + 17} ${y + h}H${x}V${y + h - 17}`}
            />
            <BodyWire track={track} />
            <g transform={`translate(${x},${Math.max(28, y - 10)})`}>
              <rect
                className="track-name-bg"
                x="0"
                y="-19"
                width={Math.min(360, 92 + label.length * 5.2)}
                height="24"
                rx="3"
              />
              <text className="track-name" x="9" y="-3">
                <tspan className="track-id">
                  T{(index + 1).toString().padStart(2, "0")} /{" "}
                </tspan>
                {label}
              </text>
            </g>
          </g>
        );
      })}
      {faces.map((face) => {
        const points = face.landmarks;
        const edges = topology?.edges || [];
        const forehead = XY(points[10]);
        return (
          <g className="face-analysis" key={face.id}>
            <path
              className="face-mesh"
              d={edges
                .filter(([a, b]) => points[a] && points[b])
                .map(([a, b]) => path([points[a], points[b]]))
                .join(" ")}
            />
            <path className="face-points" d={dots(points)} />
            {EYES.map((indices, i) => (
              <path
                key={i}
                className="face-contour"
                d={path(indices.map((n) => points[n]))}
              />
            ))}
            <path
              className="face-contour"
              d={path(LIPS.map((n) => points[n]))}
            />
            {face.regions.map((region, index) => (
              <g key={index}>
                <path className="skin-roi" d={path(region, true)} />
                <circle
                  className="roi-anchor"
                  cx={region[0].x * 1000}
                  cy={region[0].y * 562.5}
                  r="1.5"
                />
              </g>
            ))}
            <path
              className="face-callout"
              d={`M${forehead.x} ${forehead.y - 3}v-12h34`}
            />
            <text
              className="face-label"
              x={forehead.x + 37}
              y={forehead.y - 12}
            >
              ROI · RGB
            </text>
          </g>
        );
      })}
      <text className="overlay-instrument" x="30" y="35">
        RGB / LANDMARK TRACKING
      </text>
      <text className="overlay-instrument" textAnchor="end" x="970" y="35">
        {faces.reduce((n, f) => n + f.landmarks.length, 0)} FACE ·{" "}
        {tracks.reduce(
          (n, t) => n + t.points.filter((p) => p.confidence >= 0.6).length,
          0,
        )}{" "}
        POSE
      </text>
    </svg>
  );
}
