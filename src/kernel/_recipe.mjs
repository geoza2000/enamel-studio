/**
 * Turn a studio document into a scene recipe.
 *
 * Preview and PNG export derive geometry from the same editable document.
 * The manufacturing model follows an enamel medallion: choose a metal and
 * blank, mill the negative, colour the cells, then curve the surface.
 */
import {
  area,
  cells,
  inset,
  intersect,
  multiToPath,
  samplePath,
  stroke,
  subtract,
  toPath,
  union,
} from './_cells.mjs';

export const DEFAULTS = {
  size: 200, // the blank's width in scene units
  wire: 7, // *the* number: every piece of metal on the badge is this wide
  thickness: 11, // total plate thickness
  cut: 0.65, // how much of the thickness the mill takes out
  // How far up the cut the enamel comes, and it is deliberately not adjustable.
  // Enamel is a thin wash in the bottom of a cell; halfway is what leaves the
  // border standing over it. Anywhere near the metal surface and the border
  // stops existing — the colour reads as printed on rather than held in a well,
  // and the whole reason for milling the negative disappears.
  fill: 0.5,
  dish: 14, // how far the medallion is curved, centre to rim
  metal: '#F7FBFF', // cool silver; blue is its brightest channel
  metalRoughness: 0.4,
  enamelRoughness: 0.52,
  enamel: '#E8306A', // the colour a cell gets before anyone picks one
  exposure: 0.8,
  fov: 15,
  dist: 830,
  tiltX: 0,
  tiltY: 0,
};

/**
 * A plain, achromatic room with a hard horizon.
 *
 * Plain is the point. Bin a real badge by luminance and its blue-to-red ratio
 * holds flat across a tenfold range — the shadows never cool and the highlights
 * never warm — so a tinted panel makes metal read as painted. The two stops
 * either side of the horizon *are* the picture: face-on, a badge reflects the
 * ring of the room around that line and nothing else, and the dish is what
 * carries its top into the bright half and its bottom into the dark one.
 */
export const ROOM = {
  res: 768,
  sky: '#FFFFFF',
  skyI: 1.5,
  skyLow: '#FFFFFF',
  skyLowI: 1.15,
  rise: 0.6,
  groundHigh: '#33333A',
  groundHighI: 1,
  ground: '#101014',
  groundI: 1,
  fall: 0.8,
  hard: 0.1,
  bands: [],
  panels: [
    { dir: [-0.3, 0.5, 1], size: [40, 18], intensity: 2.2, color: '#FFFFFF', soft: 0.5 },
    { dir: [0.45, 0.2, 1], size: [8, 26], intensity: 9, color: '#FFFFFF', soft: 0.35 },
    { dir: [0, 1, 0.2], size: [160, 26], intensity: 1.6, color: '#FFFFFF', soft: 0.5 },
  ],
};

/** A deterministic geometry fingerprint distinguishes even concentric cells. */
export function cellKey(poly) {
  let hash = 14695981039346656037n;
  const coordinates = JSON.stringify(poly.map(ring => ring.map(p => p.map(v => Number(v.toFixed(5))))));
  for (let i = 0; i < coordinates.length; i++) {
    hash ^= BigInt(coordinates.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return `cell-${hash.toString(16).padStart(16, '0')}`;
}

/**
 * Geometry only — the offset field, the stroked wire and the cells between.
 * Split out from the recipe because the 2D editor draws these directly and has
 * no use for materials or a camera.
 */
export function geometry(doc) {
  const d = { ...DEFAULTS, ...doc };
  const outline = samplePath(doc.outline, 48);
  const field = inset([outline], d.wire, 16);
  // `closed` has to survive the whole way here. A run the editor left open is
  // a line with two ends; stroked as a loop it comes back as a closed ribbon,
  // which is not what anybody drew.
  const drawn = (doc.strokes ?? []).flatMap((s) => {
    const ring = samplePath(s.points, 36);
    return ring.length > 1 ? stroke(ring, d.wire / 2, 14, s.closed === true) : [];
  });
  // Clipped to the blank. A run has to be drawn *past* the border to tie into
  // it — stopping short leaves a hairline of enamel and the cell never closes —
  // so the overshoot is deliberate, and trimming it here is what stops it
  // reappearing as a spur sticking out of the badge's silhouette.
  const wires = drawn.length ? intersect(drawn, [outline]) : [];
  const open = field.flatMap((f) => cells(f, wires));
  return { outline, field, wires, cells: open };
}

/**
 * The colours a badge wears when it has not been earned.
 *
 * Flat grey and translucent — deliberately *not* metal. Lit metal still catches
 * the room and still reads as an object with a surface, and the one thing a
 * locked badge must not do is look like a thing you already have. Unlit, it
 * reads as an absence: the shape of what is missing.
 *
 * Not a filter over the finished render, either. Greyscaling the earned badge
 * is what the flat SVGs do and it cannot produce this — it would leave the
 * cells a mid-grey where they need to be gone. So the locked state is built
 * from the same geometry with the plate and the colour dropped.
 */
export const LOCKED = { color: '#8A8A93', opacity: 0.6 };

/**
 * The whole badge, as the recipe `_scene.mjs` consumes.
 *
 * `locked` builds the unearned state: the border and the wire in translucent
 * grey, the plate and every cell omitted so the enamel reads as empty.
 */
export function buildRecipe(doc, { locked = false } = {}) {
  const d = { ...DEFAULTS, ...doc };
  const { outline, field, wires, cells: open } = geometry(doc);

  // Heights derived from one number, so the proportions survive a change of
  // mind about the thickness. Enamel is a thin wash in the bottom of a cell,
  // never a filling of it: bring it level with the metal and the border stops
  // existing, and the colour reads as printed on rather than held in a well.
  const TOP = d.thickness;
  const CUT = d.thickness * d.cut;
  const FLOOR = TOP - CUT;
  const FILL = FLOOR + CUT * d.fill;
  const SINK = Math.max(0.6, d.thickness * 0.09); // burial, so no two faces are coplanar

  const metal = locked
    ? { type: 'flat', ...LOCKED }
    : {
        color: d.metal,
        roughness: d.metalRoughness,
        iridescence: 0,
        clearcoat: 0,
        anisotropy: 0,
        env: 1,
      };
  // Enamel is matte, and that is measured rather than chosen: scan a real badge
  // for a bright, desaturated pixel — a white specular — and there is not one,
  // in any hue. Saturation stays flat all the way up the value ramp.
  const enamel = (color) => ({
    type: 'enamel',
    color,
    roughness: d.enamelRoughness,
    clearcoat: 0,
    coat: 0.4,
    env: 1,
  });
  const curve = { bend: d.dish, bendR: d.size / 2 };

  const layers = [
    // 1 · THE BLANK. Its top face is the floor every cut bottoms out on.
    {
      role: 'blank',
      d: toPath([outline]),
      z: 0,
      depth: FLOOR,
      bevel: 0,
      bevelSize: 0,
      tess: 6,
      ...curve,
      material: metal,
    },
    // 2 · THE CUT. The blank again with the colour field milled out of it,
    // leaving the border. The field is the outline *offset* inward — never
    // scaled — so the border is the same width the whole way round.
    {
      role: 'cut',
      d: toPath([outline]),
      holes: [multiToPath(field)],
      z: FLOOR - SINK,
      depth: TOP - FLOOR + SINK,
      bevel: 0,
      bevelSize: 0,
      tess: 1.6,
      tessSteps: 9,
      crease: 40,
      ...curve,
      material: metal,
    },
  ];

  // 3 · THE COLOUR, one layer per cell. Cells are disjoint by construction, so
  // there is no ordering to get right — which is the whole reason for computing
  // them properly. The approximation this replaced needed a base coat, overlap
  // margins and a per-cell lift to stop a wide cell crowning up through a
  // narrow one and swallowing it.
  for (const poly of open) {
    layers.push({
      role: 'colour',
      d: toPath(poly),
      z: FLOOR - SINK / 2,
      depth: FILL - (FLOOR - SINK / 2),
      bevel: 0,
      bevelSize: 0,
      dome: Math.min(0.4, CUT * 0.06),
      domeReach: Math.sqrt(Math.abs(area(poly[0]))) / 3,
      tess: 3,
      ...curve,
      material: enamel(doc.cellColors?.[cellKey(poly)] ?? d.enamel),
    });
  }

  // 4 · THE WIRE. Not applied to the badge — metal the mill left behind,
  // standing from the floor of the well up flush with the border. Square
  // section: flat top, vertical walls, the same ninety degrees as the outer
  // edge. One layer per run, because SVGLoader decides which contour is a hole
  // by containment and overlapping runs in one path confuse it.
  for (const w of wires) {
    layers.push({
      role: 'island',
      d: toPath(w),
      z: FLOOR - SINK,
      depth: TOP - FLOOR + SINK,
      bevel: 0,
      bevelSize: 0,
      tess: 1.6,
      tessSteps: 9,
      crease: 40,
      ...curve,
      material: metal,
    });
  }

  // The plate would fill in behind the cuts and the colour would fill them; an
  // unearned badge is the metalwork and nothing else.
  //
  // And it is merged into a *single* piece before being drawn. Keeping the
  // border and each run as separate meshes is fine while they are opaque, but
  // translucent they overlap where a run ties into the border and the two
  // stack — one dark blot at every junction, which is the one place the eye
  // goes. One union, one surface, one alpha.
  const shown = locked
    ? [
        {
          role: 'cut',
          d: multiToPath(union(subtract([outline], field), wires)),
          z: FLOOR - SINK,
          depth: TOP - FLOOR + SINK,
          bevel: 0,
          bevelSize: 0,
          tess: 1.6,
          tessSteps: 9,
          crease: 40,
          ...curve,
          material: metal,
        },
      ]
    : layers;

  return {
    tone: 'neutral',
    exposure: d.exposure,
    fov: d.fov,
    dist: d.dist,
    tiltX: d.tiltX,
    tiltY: d.tiltY,
    studio: ROOM,
    lights: { key: 1.4, keyAt: [-90, 130, 200], fill: 0.3, shadowBlur: 5, shadowBias: 1.1 },
    layers: shown,
  };
}
