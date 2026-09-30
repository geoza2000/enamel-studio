/**
 * The silhouettes a badge can be struck from, as cubic Bézier chains.
 *
 * A chain is `[p0, c1, c2, p1, c3, c4, p2, …]` — the form `samplePath` in
 * `_cells.mjs` expects, and the form the editor drags handles on. Straight
 * edges are cubics with their controls at the thirds, so a hexagon and a heart
 * are the same kind of object and the editor needs one code path.
 *
 * Every builder takes the finished **width** and returns a chain that is
 * exactly that wide and centred on the origin, y-up — the badge's own
 * coordinate system. That normalisation is not cosmetic: the formulae naturally
 * want different arguments (a circle wants a radius, a heart wants a width, a
 * hexagon wants a circumradius that is not either), and passing one number to
 * all of them made every blank except the heart come out twice the size asked
 * for.
 */
import { samplePath } from './_cells.mjs';

/** A closed polyline as a cubic chain, controls at the thirds. */
export function poly(points) {
  const out = [points[0]];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    out.push(
      [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3],
      [a[0] + ((b[0] - a[0]) * 2) / 3, a[1] + ((b[1] - a[1]) * 2) / 3],
      b
    );
  }
  return out;
}

const K = 0.5522847498;

/**
 * Scale and centre a chain so its larger dimension is exactly `size`.
 *
 * By the larger, not by the width: a hexagon with vertices top and bottom is
 * taller than it is wide, and normalising on width alone pushes it out of the
 * frame the camera is set up for.
 */
function fit(chain, size) {
  const pts = samplePath(chain, 24);
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const k = size / Math.max(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return chain.map(([x, y]) => [(x - cx) * k, (y - cy) * k]);
}

function raw_circle(r = 100) {
  const k = K * r;
  return [
    [r, 0], [r, k], [k, r], [0, r],
    [-k, r], [-r, k], [-r, 0],
    [-r, -k], [-k, -r], [0, -r],
    [k, -r], [r, -k], [r, 0],
  ];
}

/**
 * Bootstrap Icons `heart-fill` (MIT), which is two cubics and nothing else —
 * https://github.com/twbs/icons, Copyright (c) 2019-2024 The Bootstrap Authors.
 * MIT: the notice is the whole obligation, no attribution screen needed.
 */
function raw_heart(w = 200) {
  const m = w / 16;
  const at = ([x, y]) => [(x - 8) * m, -(y - 7.5) * m];
  return [
    [8, 1.314], [12.438, -3.248], [23.534, 4.735], [8, 15],
    [-7.534, 4.736], [3.562, -3.248], [8, 1.314],
  ].map(at);
}

function raw_hexagon(r = 100) {
  return poly(
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 90);
      return [Math.cos(a) * r, Math.sin(a) * r];
    })
  );
}

/** A rounded square: the shape a lot of counting badges want. */
function raw_squircle(r = 100, round = 0.42) {
  const k = K * r * round;
  const s = r * (1 - round);
  // Four curved corners alternate with four straight cubic segments.
  // Each segment contributes two controls and its endpoint (3n + 1 total).
  return [
    [s, r], [s + k, r], [r, s + k], [r, s],
    [r, s / 3], [r, -s / 3], [r, -s],
    [r, -s - k], [s + k, -r], [s, -r],
    [s / 3, -r], [-s / 3, -r], [-s, -r],
    [-s - k, -r], [-r, -s - k], [-r, -s],
    [-r, -s / 3], [-r, s / 3], [-r, s],
    [-r, s + k], [-s - k, r], [-s, r],
    [-s / 3, r], [s / 3, r], [s, r],
  ];
}

function raw_shield(w = 200) {
  const m = w / 100;
  const at = ([x, y]) => [x * m, y * m];
  return [
    [0, 50], [22, 50], [42, 44], [48, 40],
    [48, 8], [40, -28], [0, -50],
    [-40, -28], [-48, 8], [-48, 40],
    [-42, 44], [-22, 50], [0, 50],
  ].map(at);
}



// Each blank, normalised to the width it is asked for.
export const circle = (w = 200) => fit(raw_circle(100), w);
export const heart = (w = 200) => fit(raw_heart(200), w);
export const hexagon = (w = 200) => fit(raw_hexagon(100), w);
export const squircle = (w = 200) => fit(raw_squircle(100), w);
export const shield = (w = 200) => fit(raw_shield(200), w);

export const SHAPES = {
  heart: { label: 'Heart', build: heart },
  circle: { label: 'Circle', build: circle },
  hexagon: { label: 'Hexagon', build: hexagon },
  squircle: { label: 'Squircle', build: squircle },
  shield: { label: 'Shield', build: shield },
};
