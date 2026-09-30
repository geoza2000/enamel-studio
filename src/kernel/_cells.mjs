/**
 * The geometry kernel: constant-distance offsets, and the cells a drawing of
 * wire encloses.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Cloisonné is two operations. **Offset**, because the metal border must be the
 * same width everywhere — scaling a silhouette to ninety percent is not an
 * offset, it leaves a border that is thin where the shape is far from its
 * centre and fat where it is near. And **planar subdivision**, because the unit
 * of colour is a *cell*: a closed region of enamel with wire all the way round
 * it, which you can only know by working out what the wire actually encloses.
 *
 * Both were previously faked. The offset was a bisector with a miter clamp,
 * exact to about a tenth of the badge's radius and then quietly wrong — on the
 * heart it held 8.00 units at inset 8 and delivered 22.2 where 26 was asked
 * for, because the clamp was busy stopping the point of the heart firing off to
 * infinity. Cells were the field clipped to axis-aligned boxes with overlaps
 * and per-cell z-lifts to stop neighbours swallowing each other, which produced
 * two separate rendering bugs in one afternoon.
 *
 * `polygon-clipping` does both properly. Everything here is a thin, documented
 * layer over it in the units the badge definitions already use.
 *
 * ── Format ──────────────────────────────────────────────────────────────────
 *
 * A **ring** is `[[x, y], ...]`, closed implicitly. A **polygon** is
 * `[outerRing, ...holeRings]`. A **multipolygon** is an array of polygons.
 * That is `polygon-clipping`'s own vocabulary, kept rather than translated so
 * there is no second convention to get wrong.
 */
import polygonClipping from 'polygon-clipping';

const TAU = Math.PI * 2;

/** The round cap and round join a stroked line needs at every point. */
const disc = (c, r, segments) =>
  Array.from({ length: segments }, (_, k) => {
    const t = (k / segments) * TAU;
    return [c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r];
  });

/** Signed area; positive is counter-clockwise. */
export function area(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Drop points that repeat, which upset both the clipper and the triangulator. */
export function clean(ring, eps = 1e-4) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > eps) break;
    out.pop();
  }
  return out;
}

/**
 * Douglas–Peucker: drop every point that is within `tol` of the line its
 * neighbours already describe.
 *
 * This is a robustness fix before it is a speed one. A straight edge sampled at
 * forty points becomes forty near-degenerate quads and forty overlapping discs
 * in `stroke` below, and `polygon-clipping`'s sweep line falls over on that —
 * literally, with "Unable to find segment in SweepLine tree". Feeding it the
 * eight points a hexagon actually has makes the problem go away rather than
 * papering over it.
 */
export function simplify(ring, tol = 0.05) {
  if (ring.length < 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = ring[i];
    const b = ring[j];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let best = -1;
    let far = tol;
    for (let k = i + 1; k < j; k++) {
      const q = ring[k];
      let t = l2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
      if (d > far) {
        far = d;
        best = k;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

/** Quantise to a grid, so coincident points are exactly coincident. */
const snapRing = (ring, g) => ring.map((p) => [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g]);

/**
 * `polygon-clipping` is fast and exact until it is neither, and its failure
 * mode is a thrown sweep-line error rather than a wrong answer. Retrying on a
 * coarser grid resolves the near-degenerate case that caused it; a badge is
 * drawn in units of about two hundred, so a hundredth of a unit is far below
 * anything anybody can see.
 */
function robust(op, args) {
  try {
    return op(...args);
  } catch {
    for (const g of [1e-3, 1e-2, 5e-2]) {
      try {
        // Clipping accepts both polygons and multipolygons. Normalize before
        // walking rings; treating a polygon as a multipolygon snaps scalars.
        const multis = args.map(shape => typeof shape[0]?.[0]?.[0] === 'number' ? [shape] : shape);
        return op(...multis.map(multi => multi.map(poly => poly.map(ring => snapRing(ring, g)))));
      } catch {
        /* try the next grid */
      }
    }
    throw new Error('polygon-clipping failed at every tolerance');
  }
}

/**
 * Union a pile of pieces a few at a time, then union the results.
 *
 * Handing `polygon-clipping` a hundred and sixty overlapping quads and discs in
 * one call is what makes it fall over: every piece meets its neighbours at a
 * near-tangent, and one sweep line has to hold all of those crossings at once.
 * Merging in small groups and then merging the groups gives the same answer
 * from a sequence of easy problems instead of one hard one.
 */
function unionMany(pieces, chunk = 16) {
  let level = pieces;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += chunk) {
      const group = level.slice(i, i + chunk);
      next.push(group.length === 1 ? group[0] : robust(polygonClipping.union, group));
    }
    level = next;
  }
  return level[0] ?? [];
}

/**
 * The region swept by a disc of radius `r` running along a ring — the ring
 * "stroked" to a width of `2r`.
 *
 * A quad per edge and a polygon disc per vertex, unioned. This is the honest
 * way to do it: the union is what resolves every self-intersection, every
 * doubled-back corner and every place the shape is tighter than the radius, all
 * of which a bisector offset has to special-case and mostly gets wrong.
 */
export function stroke(input, r, arcSegments = 16, closed = true) {
  // Align near-identical input coordinates before making quads and discs.
  // Otherwise a sampled straight edge can differ by 1e-14 and generate
  // almost-coincident intersections that clipping retries cannot repair.
  const ring = simplify(clean(snapRing(input, 1e-8)), Math.min(0.05, r / 20));
  const pieces = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    // A disc at every vertex, and it is not the optimisation it looks like.
    // Two consecutive quads do not meet on the outside of a turn: they leave a
    // wedge whose apex is the vertex itself, so the gap runs the full half-width
    // down to the centreline. Emitting discs only at real corners left a smooth
    // circle with ninety-six notches cut into its rim, and replacing them with
    // join triangles was worse — on a smooth curve those triangles are very
    // nearly zero-area, and a pile of slivers is exactly what the clipper cannot
    // survive. `unionMany` below is what makes the honest construction cheap.
    pieces.push([disc(a, r, arcSegments)]);

    // An open run stops at its last point. Wrapping unconditionally strokes the
    // segment from the end back to the start as well, which draws every line
    // the editor produces as a closed loop.
    if (!closed && i === n - 1) break;
    const b = ring[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (l <= 1e-9) continue;
    const nx = (-dy / l) * r;
    const ny = (dx / l) * r;
    pieces.push([
      [
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      ],
    ]);
  }
  return unionMany(pieces);
}

/**
 * Shrink a polygon by `d`, measured along the normal at every point.
 *
 * Erosion by a disc, which is the definition of an inward offset: take the
 * shape and remove everything within `d` of its boundary. It is slower than a
 * bisector and it is *right* — the border it leaves measures `d` at a smooth
 * flank, at a cusp and at a point, and where the shape is thinner than `2d` it
 * correctly returns nothing there rather than an inside-out spike.
 */
export function inset(polygon, d, arcSegments = 16) {
  if (d <= 0) return [polygon];
  const walls = [];
  for (const ring of polygon) walls.push(...stroke(ring, d, arcSegments));
  return robust(polygonClipping.difference, [[polygon], ...walls.map((w) => [w])]);
}

/** Grow a polygon by `d`. The same operation, the other way round. */
export function outset(polygon, d, arcSegments = 16) {
  if (d <= 0) return [polygon];
  const walls = [];
  for (const ring of polygon) walls.push(...stroke(ring, d, arcSegments));
  return robust(polygonClipping.union, [[polygon], ...walls.map((w) => [w])]);
}

/** Everything covered by any of them, merged into one outline. */
export function union(...geoms) {
  return robust(polygonClipping.union, geoms);
}

/** `a` with every other shape taken out of it. */
export function subtract(a, ...rest) {
  return robust(polygonClipping.difference, [a, ...rest]);
}

/** Keep only the part of `a` that lies inside `b`. */
export function intersect(a, b) {
  return robust(polygonClipping.intersection, [a, b]);
}

/**
 * The cells a drawing of wire encloses.
 *
 * `field` is the enamel area — usually the badge's outline inset by the border
 * width — and `wires` are the metal runs laid across it. What comes back is one
 * polygon per closed region of colour, largest first, which is exactly the list
 * a colour picker wants and exactly the geometry the enamel layers want.
 *
 * Regions smaller than `minArea` are dropped: a clipper working in floating
 * point leaves slivers where two wires cross at a shallow angle, and a
 * four-square-unit cell is a rendering artefact rather than a design decision.
 */
export function cells(field, wires, minArea = 4) {
  const cut = wires.length
    ? robust(polygonClipping.difference, [[field], ...wires.map((w) => [w])])
    : [field];
  return cut
    .filter((poly) => Math.abs(area(poly[0])) >= minArea)
    .sort((a, b) => Math.abs(area(b[0])) - Math.abs(area(a[0])));
}

/**
 * A polygon as SVG path data.
 *
 * Holes are emitted wound the opposite way to their outer ring, which is what
 * `SVGLoader.createShapes` reads to decide that a subpath is a counter rather
 * than another shape — the same mechanism the numerals already rely on.
 */
export function toPath(polygon, precision = 3) {
  const ring = (r, wantCCW) => {
    const pts = area(r) >= 0 === wantCCW ? r : [...r].reverse();
    return `M${pts.map((p) => `${p[0].toFixed(precision)} ${p[1].toFixed(precision)}`).join('L')}Z`;
  };
  return polygon.map((r, i) => ring(clean(r), i === 0)).join('');
}

/** Every polygon of a multipolygon as one path, for a single extruded layer. */
export function multiToPath(multi, precision = 3) {
  return multi.map((p) => toPath(p, precision)).join('');
}

/** Sample a cubic Bézier chain — the form the badge definitions store shapes in. */
export function samplePath(points, perSegment = 60) {
  const out = [];
  for (let i = 0; i + 3 < points.length; i += 3) {
    const [a, b, c, d] = [points[i], points[i + 1], points[i + 2], points[i + 3]];
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      const u = 1 - t;
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      out.push([
        w[0] * a[0] + w[1] * b[0] + w[2] * c[0] + w[3] * d[0],
        w[0] * a[1] + w[1] * b[1] + w[2] * c[1] + w[3] * d[1],
      ]);
    }
  }
  // Include the endpoint of the last complete cubic. clean removes the
  // duplicated start point for closed outlines, but keeps an open wire's end.
  if (points.length >= 4) out.push(points[Math.floor((points.length - 1) / 3) * 3]);
  return clean(out);
}
