/**
 * Build a badge in a WebGL canvas. Everything about the *look* lives here.
 *
 * Live previews and browser PNG exports share this renderer. Geometry and
 * materials are described by a recipe; the renderer owns the WebGL resources.
 */
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const rad = THREE.MathUtils.degToRad;

// ── The studio ──────────────────────────────────────────────────────────────
//
// Metal with nothing to reflect is grey plastic, so the badge is lit almost
// entirely by an environment rather than by lamps.
//
// **Everything here is specified as a direction, never as a texel.** The old
// version placed panels by (u, v) and put its key light underneath the badge,
// because `DataTexture.flipY` is `false` and `equirectUv` is
// `v = asin(dir.y)/PI + 0.5` — so row 0 of the array is the *nadir*, not the
// zenith. Writing the room in world directions makes that class of mistake
// impossible: +Y is up, +X is the viewer's right, and **+Z is behind the
// camera**, which is the half of the room a face-on surface actually shows you.
//
// Float data rather than a canvas, so panels can sit far above 1.0 and blow out
// into a highlight the way a real softbox does.

function studio(cfg) {
  const W = cfg.res ?? 512;
  const H = W / 2;
  const data = new Float32Array(W * H * 4);

  // Each panel gets a local frame so it can be a rectangle of a given angular
  // width and height. A rectangle with a soft edge, not a gaussian blob: what
  // reads as a real light source in polished metal is a streak with an *edge*
  // on it, and a gaussian has none.
  const panels = (cfg.panels ?? []).map((p) => {
    const d = new THREE.Vector3().fromArray(p.dir).normalize();
    const upHint = Math.abs(d.y) > 0.999 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(upHint, d).normalize();
    const up = new THREE.Vector3().crossVectors(d, right).normalize();
    const c = new THREE.Color(p.color ?? '#ffffff');
    return {
      d, right, up,
      w: rad((p.size?.[0] ?? 20) / 2),
      h: rad((p.size?.[1] ?? 20) / 2),
      soft: p.soft ?? 0.5,
      i: p.intensity ?? 10,
      r: c.r, g: c.g, b: c.b,
    };
  });

  const bands = (cfg.bands ?? []).map((b) => {
    const c = new THREE.Color(b.color);
    return { at: Math.sin(rad(b.at)), w: Math.sin(rad(b.width ?? 20)), i: b.intensity ?? 1, r: c.r, g: c.g, b: c.b };
  });

  // Each stop carries its own intensity, because a colour written as a hex
  // string can never exceed 1 and a room built only out of hex strings is a
  // room with no windows. That was the first version's real fault: a sky of
  // #2A1B3D is 0.03 in linear light, so the metal had almost nothing to
  // reflect and came out maroon no matter what the panels did.
  const stop = (c, i) => {
    const k = new THREE.Color(c);
    return [k.r * i, k.g * i, k.b * i];
  };
  //
  // Four stops, not three, and the reason is the whole trick. A single shared
  // 'horizon' colour means the two sides of the line meet at the same value, so
  // there is no step there however small you make the transition — which is why
  // an earlier version had a horizon parameter that visibly did nothing. The
  // bright half has to end bright and the dark half has to start dark:
  //
  //   sky ── rise ──> skyLow │ groundHigh <── fall ── ground
  //                          ^ the line
  const sky = stop(cfg.sky ?? '#20161f', cfg.skyI ?? 1);
  const skyLow = stop(cfg.skyLow ?? cfg.sky ?? '#20161f', cfg.skyLowI ?? cfg.skyI ?? 1);
  const groundHigh = stop(cfg.groundHigh ?? cfg.ground ?? '#030304', cfg.groundHighI ?? cfg.groundI ?? 1);
  const ground = stop(cfg.ground ?? '#030304', cfg.groundI ?? 1);
  const hard = cfg.hard ?? 0.04; // how tight the horizon transition is
  // How fast the room reaches full floor below the horizon and full ceiling
  // above it. Both default to the whole hemisphere, which is a soft, even room
  // — and an even room is the enemy: a mirror in it returns an even field and
  // the badge goes back to reading as flat plastic. Pulling these in is how the
  // dark half stays genuinely dark instead of ramping gently to mid-tone.
  const fall = cfg.fall ?? 1;
  const rise = cfg.rise ?? 0.85;

  // Works with e0 > e1 too, which is what lets the floor ramp be written in the
  // direction it is actually read: zero at the horizon, one at the nadir.
  const smooth = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-9)));
    return t * t * (3 - 2 * t);
  };
  const edge = (a, half, soft) => 1 - smooth(half * (1 - soft), half, Math.abs(a));

  const dir = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    // Inverse of equirectUv, so this loop and the shader agree by construction.
    const theta = ((y + 0.5) / H - 0.5) * Math.PI; // asin(dir.y)
    const dy = Math.sin(theta);
    const cr = Math.cos(theta);
    for (let x = 0; x < W; x++) {
      const phi = ((x + 0.5) / W - 0.5) * Math.PI * 2; // atan2(dir.z, dir.x)
      dir.set(cr * Math.cos(phi), dy, cr * Math.sin(phi));

      // Two gradients meeting at a horizon: the ceiling coming down to the
      // line from above, the floor coming up to it from below, and 'hard'
      // deciding how abrupt the meeting is. The abruptness is the point — the
      // bright band a curved surface drags across itself needs an edge to be a
      // band rather than a wash.
      const t = smooth(-hard, hard, dy);
      const lo = smooth(-hard, -fall, dy); // 0 at the line, 1 at the nadir
      const hi = smooth(hard, rise, dy); // 0 at the line, 1 at the zenith
      let r = 0, g = 0, b = 0;
      {
        const lr = groundHigh[0] + (ground[0] - groundHigh[0]) * lo;
        const lg = groundHigh[1] + (ground[1] - groundHigh[1]) * lo;
        const lb = groundHigh[2] + (ground[2] - groundHigh[2]) * lo;
        const hr = skyLow[0] + (sky[0] - skyLow[0]) * hi;
        const hg = skyLow[1] + (sky[1] - skyLow[1]) * hi;
        const hb = skyLow[2] + (sky[2] - skyLow[2]) * hi;
        r = lr + (hr - lr) * t;
        g = lg + (hg - lg) * t;
        b = lb + (hb - lb) * t;
      }

      for (const p of bands) {
        const f = Math.max(0, 1 - Math.abs(dy - p.at) / p.w);
        const s = f * f * (3 - 2 * f) * p.i;
        r += s * p.r; g += s * p.g; b += s * p.b;
      }

      for (const p of panels) {
        const lz = dir.dot(p.d);
        if (lz <= 0.02) continue;
        const au = Math.atan2(dir.dot(p.right), lz);
        const av = Math.atan2(dir.dot(p.up), lz);
        const f = edge(au, p.w, p.soft) * edge(av, p.h, p.soft);
        if (f <= 0) continue;
        r += p.i * f * p.r; g += p.i * f * p.g; b += p.i * f * p.b;
      }

      const o = (y * W + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 1;
    }
  }

  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ── Materials ───────────────────────────────────────────────────────────────

function materialFor(m) {
  const common = {
    color: new THREE.Color(m.color ?? '#ffffff'),
    envMapIntensity: m.env ?? 1,
    transparent: m.opacity !== undefined && m.opacity < 1,
    opacity: m.opacity ?? 1,
    // Translucent metal has to keep writing depth or the far wall of a cut
    // shows through the near one and the badge turns into a tangle of edges.
    // It costs correct blending between two translucent surfaces, which this
    // never has: the locked badge is one shell.
    depthWrite: true,
  };
  // Flat: a colour and nothing else — no lights, no environment, no shading.
  // The unearned badge wants exactly this. Lit grey metal still catches the
  // room and still reads as an *object*, which is the one thing a locked state
  // must not do: it has to read as an absence.
  if (m.type === 'flat') {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(m.color ?? '#888888'),
      transparent: m.opacity !== undefined && m.opacity < 1,
      opacity: m.opacity ?? 1,
    });
  }
  if (m.type === 'enamel') {
    // A saturated body under a glassy coat. The second, sharper highlight the
    // coat puts on top of the diffuse colour is most of what reads as enamel
    // rather than as paint.
    return new THREE.MeshPhysicalMaterial({
      ...common,
      metalness: 0,
      roughness: m.roughness ?? 0.3,
      clearcoat: m.clearcoat ?? 1,
      clearcoatRoughness: m.coat ?? 0.06,
    });
  }
  // Anodised metal. `metalness: 1` with a tinted `color` *is* anodising —
  // the colour lives in the reflectance, not in a diffuse layer — and the
  // iridescence term is the thin oxide film that produces the tint in reality,
  // which is also what gives the rim its hue shift at grazing angles.
  return new THREE.MeshPhysicalMaterial({
    ...common,
    metalness: m.metalness ?? 1,
    roughness: m.roughness ?? 0.08,
    iridescence: m.iridescence ?? 0,
    iridescenceIOR: m.iridescenceIOR ?? 1.5,
    iridescenceThicknessRange: m.film ?? [100, 400],
    anisotropy: m.anisotropy ?? 0,
    anisotropyRotation: rad(m.anisotropyAngle ?? 0),
    clearcoat: m.clearcoat ?? 0,
    clearcoatRoughness: m.coat ?? 0.05,
  });
}

// ── Geometry ────────────────────────────────────────────────────────────────

/** Shapes straight from SVG path data, holes and all. */
function shapesOf(d) {
  const doc = '<svg xmlns="http://www.w3.org/2000/svg"><path d="' + d + '"/></svg>';
  return new SVGLoader().parse(doc).paths.flatMap((p) => SVGLoader.createShapes(p));
}

/**
 * A turned disc: the medallion's body, rim and any raised ring, as one
 * cross-section revolved.
 *
 * A lathe rather than a bevelled extrusion because the profile is the whole
 * design here — where the face crowns, where the groove bites, how fast the
 * rim rolls over — and a lathe lets that be written down as twenty numbers
 * instead of guessed at through three bevel parameters.
 *
 * Profile points are `[radius, height]` with height along the badge's axis,
 * ordered from the front centre outward. `rotateX` afterwards puts that axis
 * on +Z, facing the camera; a rotation cannot invert winding, which a negative
 * scale would.
 *
 * **The reverse() is not cosmetic.** LatheGeometry derives each meridian normal
 * as (dy, -dx) from the step between consecutive points, which only points
 * outward if the profile runs bottom-to-top — increasing height. Written in the
 * natural authoring order, front centre outward and down to the back, every
 * normal on the badge points *inward*, and the disc lights as a concave dish:
 * the bottom of the face reflects the ceiling, the top reflects the floor, and
 * every zone returns the opposite of what it should. It does not look broken,
 * which is the dangerous part — it looks flat and slightly wrong, and it
 * survived four rounds of tuning the studio before a white-above, black-below
 * test room showed the whole badge coming back white.
 */
function latheGeometry(layer) {
  const pts = layer.profile
    .map((p) => new THREE.Vector2(Math.max(p[0], 1e-4), p[1]))
    .reverse();
  let geo = new THREE.LatheGeometry(pts, layer.segments ?? 320, 0, Math.PI * 2);
  geo.rotateX(Math.PI / 2);

  // Reeding: a cosine ripple in the radius over a band of the profile. On a
  // polished rim this is what breaks one long highlight into a row of separate
  // sparks, which is most of what makes a rim look *cut* rather than moulded.
  if (layer.flute) {
    const { count = 60, depth = 0.6, from = -1e9, to = 1e9, phase = 0, fade = 0.25 } = layer.flute;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (z < from || z > to) continue;
      const span = to - from;
      const t = (z - from) / span;
      // Fade the ripple out at both ends of the band so it does not terminate
      // in a step that reads as a modelling error.
      const m = Math.min(1, Math.min(t, 1 - t) / Math.max(fade, 1e-6));
      const r = Math.hypot(x, y);
      if (r < 1e-4) continue;
      const k = 1 + (depth / r) * m * Math.cos(count * Math.atan2(y, x) + phase);
      pos.setXY(i, x * k, y * k);
    }
    pos.needsUpdate = true;
  }

  return toCreasedNormals(geo, rad(layer.crease ?? 35));
}

/**
 * Distance from a point to the nearest outline segment, brute force.
 *
 * Brute force is the right amount of cleverness: this runs once per badge on a
 * few hundred thousand vertices against a few hundred segments, offline, and an
 * acceleration structure would be more code than the whole dome is worth.
 */
function outlineOf(shapes, n, which = 'all') {
  const segs = [];
  const push = (points) => {
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      segs.push(a.x, a.y, b.x - a.x, b.y - a.y);
    }
  };
  // Which edges the crown is measured from. A free-standing wire crowns from
  // both of its sides and comes out a full half-round bead. A rim crowns from
  // the enamel side *only* — measure it from the silhouette as well and the
  // metal dives to nothing at the outer edge, turning a struck plate into a
  // knife-edged pebble.
  for (const s of shapes) {
    if (which !== 'holes') push(s.getPoints(n));
    if (which !== 'outer') for (const h of s.holes) push(h.getPoints(n));
  }
  return Float64Array.from(segs);
}

function distToOutline(segs, px, py) {
  let best = Infinity;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i], ay = segs[i + 1], dx = segs[i + 2], dy = segs[i + 3];
    const len = dx * dx + dy * dy;
    let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * An extruded silhouette — a motif or a numeral — struck proud of the face.
 *
 * The interesting part is `dome`. `ExtrudeGeometry` triangulates its cap from
 * the outline vertices *only*: there is not one vertex in the interior of the
 * face to lift, so crowning it has to start by making some. Hence the
 * tessellation pass, which subdivides until no edge is longer than `tess`, and
 * only then does every interior vertex rise by a parabola in its distance to
 * the outline. Without this a relief motif is a flat-topped cookie cutter and
 * its whole face reflects one single tone.
 */
function reliefGeometry(layer) {
  const shapes = shapesOf(layer.d);
  // The cut. Each path here is a region milled out of the blank, and
  // ExtrudeGeometry bevels a hole outward rather than inward, so every cut comes
  // back with a rounded metal lip standing around it for free. That lip is the
  // whole reason this reads as struck metal and not as a decal: it is the edge
  // border that survives the cut.
  const cuts = layer.holes ?? (layer.holeOf ? [layer.holeOf] : []);
  for (const cut of cuts) {
    const inner = shapesOf(cut);
    for (const s of shapes) {
      for (const h of inner) s.holes.push(new THREE.Path(h.getPoints(240)));
    }
  }

  const bevelSize = layer.bevelSize ?? layer.bevel ?? 1.2;
  let geo = new THREE.ExtrudeGeometry(shapes, {
    depth: layer.depth,
    bevelEnabled: layer.bevel !== 0,
    bevelThickness: layer.bevel ?? 1.2,
    bevelSize,
    bevelSegments: layer.bevelSegments ?? 6,
    curveSegments: layer.curveSegments ?? 64,
  });

  // Both crowning operations below move interior vertices, and an extruded cap
  // has none: ShapeUtils triangulates it from the outline alone. So make some
  // first, or the curve is applied to the rim of a flat polygon and interpolated
  // across the middle — which on a disc this wide is not a dome at all.
  if (layer.dome || layer.bend) {
    geo = new TessellateModifier(layer.tess ?? 4, layer.tessSteps ?? 8).modify(geo);
  }

  if (layer.dome) {
    const pos = geo.attributes.position;
    geo.computeBoundingBox();
    const top = geo.boundingBox.max.z;
    const segs = outlineOf(shapes, 96, layer.domeEdges ?? 'all');
    const reach = layer.domeReach ?? 18;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) < top - 1e-3) continue;
      // The cap sits inside the silhouette by `bevelSize`, so its own edge is
      // that far in from the outline the distance is measured against.
      const d = Math.max(0, distToOutline(segs, pos.getX(i), pos.getY(i)) - bevelSize);
      const t = Math.min(1, d / reach);
      pos.setZ(i, top + layer.dome * (1 - (1 - t) * (1 - t)));
    }
    pos.needsUpdate = true;
  }

  // Step five: curve the medallion. A struck badge is pressed flat and then
  // dished, so every layer — blank, cut face, the colour in the cuts — takes the
  // same quadratic and they stay in register. Give two layers different curves
  // and the colour rises out of its own well at the rim.
  //
  // This is also what makes the flat face reflect anything: a mirror tilted five
  // degrees sees five degrees of room, so without the curve the whole face
  // returns one tone no matter how good the studio is.
  if (layer.bend) {
    const pos = geo.attributes.position;
    const rr = layer.bendR ?? 60;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i, pos.getZ(i) - (layer.bend * (x * x + y * y)) / (rr * rr));
    }
    pos.needsUpdate = true;
  }

  return toCreasedNormals(geo, rad(layer.crease ?? 40));
}

// ── Bloom ───────────────────────────────────────────────────────────────────
//
// The soft halo around a blown highlight, which is most of what separates a
// product render from a screenshot of a mesh.
//
// Hand-rolled rather than EffectComposer + UnrealBloomPass, for one reason:
// **alpha**. This writes a PNG that gets composited over the app's background
// on a phone, so the silhouette has to stay a clean hard edge. Every pass here
// multiplies by the scene's own alpha, so the glow can brighten the badge but
// can never leak outside it — no soft grey halo in the transparent margin.
//
// Rendering the scene into a render target is also what makes the bloom
// correct rather than merely present: three disables tone mapping whenever the
// destination is a render target (WebGLRenderer, near 'toneMapping = NoToneMapping'
// when _currentRenderTarget is set), so the buffer the bright pass reads is
// still linear HDR. Threshold a tone-mapped buffer instead and everything bright
// has already been squashed to nearly the same value, so nothing blooms.

const CLIP_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const quadGeo = new THREE.PlaneGeometry(2, 2);
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function fullscreen(fragmentShader, uniforms) {
  const mesh = new THREE.Mesh(
    quadGeo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: CLIP_VERT,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
  );
  // The quad sits at z = 0 and so does the camera, which puts it exactly on the
  // near plane and gets it culled — a blank frame with no error anywhere.
  mesh.frustumCulled = false;
  return mesh;
}

const BRIGHT_FRAG = [
  'uniform sampler2D tSrc; uniform float threshold;',
  'varying vec2 vUv;',
  'void main(){',
  '  vec4 s = texture2D(tSrc, vUv);',
  '  float l = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));',
  '  float w = max(0.0, l - threshold) / max(l, 1e-4);',
  '  gl_FragColor = vec4(s.rgb * w * s.a, 1.0);',
  '}',
].join('\n');

// The usual five-tap gaussian, offsets placed between texels so the hardware
// bilinear fetch does half the work.
const BLUR_FRAG = [
  'uniform sampler2D tSrc; uniform vec2 dir; uniform vec2 texel; uniform float radius;',
  'varying vec2 vUv;',
  'void main(){',
  '  vec2 o1 = dir * texel * 1.3846153846 * radius;',
  '  vec2 o2 = dir * texel * 3.2307692308 * radius;',
  '  vec3 sum = texture2D(tSrc, vUv).rgb * 0.2270270270;',
  '  sum += (texture2D(tSrc, vUv + o1).rgb + texture2D(tSrc, vUv - o1).rgb) * 0.3162162162;',
  '  sum += (texture2D(tSrc, vUv + o2).rgb + texture2D(tSrc, vUv - o2).rgb) * 0.0702702703;',
  '  gl_FragColor = vec4(sum, 1.0);',
  '}',
].join('\n');

// Tone mapping and the sRGB transfer happen here rather than in the materials,
// because this is the pass that finally reaches the canvas. The two includes
// are three's own chunks, so this stays in step with whatever curve the scene
// asked for.
const COMPOSITE_FRAG = [
  'uniform sampler2D tScene; uniform sampler2D tBloom; uniform float strength;',
  'varying vec2 vUv;',
  // No pars includes here. WebGLProgram already injects both
  // tonemapping_pars_fragment and colorspace_pars_fragment into every fragment
  // prefix (WebGLProgram.js, around the toneMapping function it generates), so
  // including them again is a redefinition and the program fails to link. It
  // fails *quietly*: the page still finishes and still writes a PNG, only a
  // blank one.
  'void main(){',
  '  vec4 s = texture2D(tScene, vUv);',
  '  vec3 b = texture2D(tBloom, vUv).rgb;',
  '  gl_FragColor = vec4(s.rgb + b * strength * s.a, s.a);',
  '  #include <tonemapping_fragment>',
  '  #include <colorspace_fragment>',
  '  gl_FragColor.rgb *= gl_FragColor.a;',
  '}',
].join('\n');


/**
 * Draw `recipe` into `canvas`.
 *
 * Returns the scene's parts along with `draw()` for a live view and
 * `toDataURL()` for a still — the supersample downscale happens there, so an
 * interactive caller never pays for it.
 */
export function mount(canvas, recipe, { size = 512, ssaa = 1 } = {}) {
  // ── Renderer ────────────────────────────────────────────────────────────────

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    // Off on purpose: we supersample instead. MSAA only anti-aliases geometric
    // edges, and on a mirror-polished surface most of the aliasing is *specular*
    // — a highlight thinner than a pixel crawling across a bevel. Only shading
    // the whole frame at a higher rate fixes that.
    antialias: ssaa === 1,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(size * ssaa, size * ssaa, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = {
    neutral: THREE.NeutralToneMapping,
    aces: THREE.ACESFilmicToneMapping,
    agx: THREE.AgXToneMapping,
    cineon: THREE.CineonToneMapping,
    none: THREE.NoToneMapping,
  }[recipe.tone ?? 'agx'];
  renderer.toneMappingExposure = recipe.exposure ?? 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = studio(recipe.studio ?? {});
  scene.environment = pmrem.fromEquirectangular(envTex).texture;
  scene.environmentIntensity = recipe.envIntensity ?? 1;
  scene.environmentRotation = new THREE.Euler(0, rad(recipe.envSpin ?? 0), 0);

  const group = new THREE.Group();

  for (const layer of recipe.layers) {
    const geo = layer.profile ? latheGeometry(layer) : reliefGeometry(layer);
    const mesh = new THREE.Mesh(geo, materialFor(layer.material));
    mesh.position.z = layer.z ?? 0;
    mesh.castShadow = layer.castShadow !== false;
    mesh.receiveShadow = layer.receiveShadow !== false;
    group.add(mesh);
  }

  scene.add(group);

  // ── Lights ──────────────────────────────────────────────────────────────────
  //
  // The environment does nearly all the shading. These exist for one thing the
  // environment cannot do: cast a shadow. Without a contact shadow under the
  // relief, a motif looks pasted onto the face rather than struck out of it,
  // because image-based lighting has no occlusion term at all.

  const L = recipe.lights ?? {};
  const key = new THREE.DirectionalLight(L.keyColor ?? 0xfff1e0, L.key ?? 1.6);
  key.position.fromArray(L.keyAt ?? [-90, 130, 180]);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -140;
  key.shadow.camera.right = 140;
  key.shadow.camera.top = 140;
  key.shadow.camera.bottom = -140;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 900;
  key.shadow.radius = L.shadowBlur ?? 4;
  // Normal bias rather than a constant bias: the receiver here is a nearly flat
  // face almost perpendicular to the light, which is exactly the case a constant
  // bias either fails to fix or fixes by detaching the shadow from its object.
  key.shadow.normalBias = L.shadowBias ?? 1.2;
  scene.add(key);

  const fill = new THREE.DirectionalLight(L.fillColor ?? 0xcfe0ff, L.fill ?? 0.35);
  fill.position.fromArray(L.fillAt ?? [120, -70, 140]);
  scene.add(fill);

  // ── Camera ──────────────────────────────────────────────────────────────────
  //
  // A long lens, nearly face-on: enough perspective that the far side of the rim
  // reads differently from the near side, not so much that the badge looks tipped
  // over. This keeps the front-facing presentation legible at
  // thumbnail size — a strong perspective eats the silhouette.

  const camera = new THREE.PerspectiveCamera(recipe.fov ?? 17, 1, 10, 4000);
  camera.position.set(0, 0, recipe.dist ?? 620);
  camera.lookAt(0, 0, 0);
  group.rotation.x = rad(recipe.tiltX ?? 0);
  group.rotation.y = rad(recipe.tiltY ?? 0);
  group.rotation.z = rad(recipe.roll ?? 0);

  function renderWithBloom(cfg) {
    const W = size * ssaa;
    const half = Math.max(64, W >> 1);
    const opts = { type: THREE.HalfFloatType, depthBuffer: true };
    const rtScene = new THREE.WebGLRenderTarget(W, W, opts);
    const rtA = new THREE.WebGLRenderTarget(half, half, { type: THREE.HalfFloatType, depthBuffer: false });
    const rtB = new THREE.WebGLRenderTarget(half, half, { type: THREE.HalfFloatType, depthBuffer: false });

    renderer.setRenderTarget(rtScene);
    renderer.clear();
    renderer.render(scene, camera);

    const texel = new THREE.Vector2(1 / half, 1 / half);
    const bright = fullscreen(BRIGHT_FRAG, {
      tSrc: { value: rtScene.texture },
      threshold: { value: cfg.threshold ?? 1 },
    });
    renderer.setRenderTarget(rtA);
    renderer.clear();
    renderer.render(bright, quadCam);

    const blur = fullscreen(BLUR_FRAG, {
      tSrc: { value: null },
      dir: { value: new THREE.Vector2() },
      texel: { value: texel },
      radius: { value: 1 },
    });
    // Widening the radius on each pass buys a large soft halo from a few taps.
    let src = rtA;
    let dst = rtB;
    for (let i = 0; i < (cfg.passes ?? 3); i++) {
      for (const d of [[1, 0], [0, 1]]) {
        blur.material.uniforms.tSrc.value = src.texture;
        blur.material.uniforms.dir.value.set(d[0], d[1]);
        blur.material.uniforms.radius.value = (cfg.radius ?? 1) * (1 + i * 1.6);
        renderer.setRenderTarget(dst);
        renderer.clear();
        renderer.render(blur, quadCam);
        const swap = src; src = dst; dst = swap;
      }
    }

    // Bisecting a four-pass chain by eye is otherwise guesswork: 'flat' proves the
    // quad draws at all, 'scene' proves the scene reached its target, 'bright' and
    // 'blur' show what the halo is actually built from.
    if (cfg.debug) {
      const src2 = { flat: null, scene: rtScene, bright: rtA, blur: src }[cfg.debug];
      const frag = cfg.debug === 'flat'
        ? ['varying vec2 vUv;', 'void main(){ gl_FragColor = vec4(vUv.x, vUv.y, 0.5, 1.0); }'].join('\n')
        : ['uniform sampler2D tSrc; varying vec2 vUv;',
           'void main(){ vec4 c = texture2D(tSrc, vUv); gl_FragColor = vec4(c.rgb, 1.0); }'].join('\n');
      const probe = fullscreen(frag, { tSrc: { value: src2 ? src2.texture : null } });
      probe.material.toneMapped = false;
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(probe, quadCam);
      return;
    }

    const composite = fullscreen(COMPOSITE_FRAG, {
      tScene: { value: rtScene.texture },
      tBloom: { value: src.texture },
      strength: { value: cfg.strength ?? 0.5 },
    });
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(composite, quadCam);
  }

  /** Render one frame. Call it again after changing anything in the scene. */
  function draw() {
    // Looking at the room directly, which is the only way to debug one. A studio is
    // five numbers per panel and no amount of staring at a badge tells you which of
    // them is wrong.
    if (recipe.debugEnv) {
      group.visible = false;
      scene.background = envTex;
      scene.backgroundIntensity = recipe.debugEnvExposure ?? 1;
      const wide = new THREE.PerspectiveCamera(recipe.debugEnvFov ?? 100, 1, 1, 100);
      wide.position.set(0, 0, 0);
      // Look at +Z: the half of the room a face-on badge actually shows you.
      wide.lookAt(0, 0, 1);
      renderer.render(scene, wide);
    } else if (recipe.bloom) {
      renderWithBloom(recipe.bloom);
    } else {
      renderer.render(scene, camera);
    }
  }

  draw();

  /** The finished frame as a PNG data URL, supersampled down to `size`. */
  function toDataURL() {
    // Halving steps rather than one big `drawImage`, because a single large
    // downscale samples rather than averages and throws away most of the extra
    // shading we just paid for. Both canvases are premultiplied, so the
    // silhouette edge blends without the dark fringe straight alpha would give.
    let src = canvas;
    let w = size * ssaa;
    while (w > size) {
      const next = Math.max(size, w >> 1);
      const c = document.createElement('canvas');
      c.width = next;
      c.height = next;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, next, next);
      src = c;
      w = next;
    }
    return src.toDataURL('image/png');
  }

  /**
   * Give the GL context back. A browser allows a handful of live contexts and
   * silently drops the oldest past that, so an editor that re-mounts on every
   * edit has to hand each one back or the preview goes black after a dozen
   * changes with nothing in the console.
   */
  function dispose() {
    for (const child of group.children) {
      child.geometry.dispose();
      child.material.dispose();
    }
    scene.environment?.dispose();
    envTex.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  }

  return { renderer, scene, camera, group, envTex, draw, toDataURL, dispose };
}
