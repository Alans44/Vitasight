export type FacePoint = { x: number; y: number; z?: number };
const REGIONS = [
  [109, 10, 338, 337, 151, 108],
  [50, 101, 205, 187, 123, 116],
  [280, 330, 425, 411, 352, 345],
];
export function faceRegions(points: FacePoint[]) {
  return REGIONS.map((indices) => indices.map((i) => points[i]));
}
function inside(x: number, y: number, points: FacePoint[]) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
}
export function sampleSkin(
  image: ImageData,
  regions: FacePoint[][],
): [number, number, number] | null {
  const total = [0, 0, 0];
  let count = 0;
  for (const polygon of regions) {
    const left = Math.max(
      0,
      Math.floor(Math.min(...polygon.map((p) => p.x)) * image.width),
    );
    const right = Math.min(
      image.width - 1,
      Math.ceil(Math.max(...polygon.map((p) => p.x)) * image.width),
    );
    const top = Math.max(
      0,
      Math.floor(Math.min(...polygon.map((p) => p.y)) * image.height),
    );
    const bottom = Math.min(
      image.height - 1,
      Math.ceil(Math.max(...polygon.map((p) => p.y)) * image.height),
    );
    for (let y = top; y <= bottom; y += 2)
      for (let x = left; x <= right; x += 2) {
        if (!inside(x / image.width, y / image.height, polygon)) continue;
        const offset = (y * image.width + x) * 4,
          r = image.data[offset],
          g = image.data[offset + 1],
          b = image.data[offset + 2];
        if ((r + g + b) / 3 < 12 || Math.max(r, g, b) > 248) continue;
        total[0] += r;
        total[1] += g;
        total[2] += b;
        count++;
      }
  }
  return count >= 24
    ? (total.map((v) => v / count) as [number, number, number])
    : null;
}
