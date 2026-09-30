
import { mount } from './kernel/_scene.mjs';
import { buildRecipe, cellKey, geometry } from './kernel/_recipe.mjs';
import { SHAPES } from './kernel/_shapes.mjs';
import { samplePath } from './kernel/_cells.mjs';

import { createDocument, serializeDocument, parseDocument, downloadName } from './document.mjs';
import { PRESETS, createPreset } from './presets.mjs';
const doc = createDocument();
doc.strokes = doc.strokes.map(s => strokeFrom(s.points, s.closed));
const METALS = {
  silver: { label: 'Silver', hex: '#F7FBFF' },
  gold: { label: 'Gold', hex: '#FFE67C' },
};

const PALETTE = [
  '#DCA44A', '#9D6231', '#EDD2A4', '#F5A524', '#6C3FD4', '#1FA9C4',
  '#2FAF62', '#F26A3D', '#1B1B22', '#F2F3F5', '#7A8296', '#C4145A',
];

let step = 0;
let selectedCell = null;
let geo = { outline: [], field: [], wires: [], cells: [] };
let dragging = null;
let tool = 'pen';
let ghost = null; // the circle being dragged out, before it is committed

const K = 0.5522847498; // circle-to-cubic constant


function circleStroke(c, r) {
  const anchors = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const p = [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
    const t = [-Math.sin(a) * K * r, Math.cos(a) * K * r];
    anchors.push({ p, hIn: [-t[0], -t[1]], hOut: [t[0], t[1]] });
  }
  return { anchors, closed: true };
}

const $ = (id) => document.getElementById(id);
const status = (m) => ($('status').textContent = m);


function chainOf(s) {
  const a = s.anchors;
  if (!a.length) return [];
  if (a.length < 2 && !s.closed) return a.map(anchor => [...anchor.p]);
  const seq = s.closed ? [...a, a[0]] : a;
  const pts = [seq[0].p];
  for (let i = 0; i + 1 < seq.length; i++) {
    const A = seq[i];
    const B = seq[i + 1];
    pts.push(
      [A.p[0] + A.hOut[0], A.p[1] + A.hOut[1]],
      [B.p[0] + B.hIn[0], B.p[1] + B.hIn[1]],
      B.p
    );
  }
  return pts;
}

const resolved = () => ({ ...doc, strokes: doc.strokes.map((s) => ({ points: chainOf(s), closed: s.closed })) });


function strokeFrom(points, closed) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const anchors = [];
  for (let i = 0; i < points.length; i += 3) {
    const p = points[i];
    anchors.push({
      p,
      hIn: i > 0 ? sub(points[i - 1], p) : [0, 0],
      hOut: i + 1 < points.length ? sub(points[i + 1], p) : [0, 0],
    });
  }
  if (closed && anchors.length > 1) {
    const tail = anchors.pop();
    anchors[0].hIn = tail.hIn;
  }
  return { anchors, closed: !!closed };
}

// ── Geometry ────────────────────────────────────────────────────────────────

function recompute() {
  const t = performance.now();
  try {
    geo = geometry(resolved());
    status(`${geo.cells.length} cell${geo.cells.length === 1 ? '' : 's'} · ${Math.round(performance.now() - t)}ms`);
  } catch (e) {
    status(`geometry failed: ${e.message}`);
  }
  paint();
  schedulePreview();
}

// ── The 2D view ─────────────────────────────────────────────────────────────

const edit = $('edit');
const ctx = edit.getContext('2d');
const VIEW = 260; // half-width of the world the canvas shows
const toScreen = ([x, y]) => [
  (x / VIEW) * (edit.width / 2) + edit.width / 2,
  -(y / VIEW) * (edit.height / 2) + edit.height / 2,
];
const toWorld = (sx, sy) => [
  ((sx - edit.width / 2) / (edit.width / 2)) * VIEW,
  -((sy - edit.height / 2) / (edit.height / 2)) * VIEW,
];
const SCALE = edit.width / 2 / VIEW;

function tracePoly(poly) {
  for (const ring of poly) {
    ring.forEach((p, i) => {
      const [x, y] = toScreen(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

function fillMulti(multi, color) {
  ctx.beginPath();
  for (const poly of multi) tracePoly(poly);
  ctx.fillStyle = color;
  ctx.fill('evenodd');
}

function paint() {
  ctx.clearRect(0, 0, edit.width, edit.height);
  if (!geo.outline.length) return;

  // The blank, then the milled field, then the enamel in each cell, then the
  // wire on top — the order the thing is actually made in.
  fillMulti([[geo.outline]], '#c9ced9');
  fillMulti(geo.field, '#2a2a33');
  for (const poly of geo.cells) {
    const key = cellKey(poly);
    fillMulti([poly], doc.cellColors[key] ?? '#3a3a46');
    if (step === 2 && selectedCell === key) {
      ctx.beginPath();
      tracePoly(poly);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  fillMulti(geo.wires.map((w) => w), '#e2e6ee');

  if (step !== 1) return;

  if (ghost && ghost.r > 0) {
    const c = toScreen(ghost.c);
    ctx.strokeStyle = '#dca44a';
    ctx.lineWidth = Math.max(1, doc.wire * SCALE);
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(c[0], c[1], ghost.r * SCALE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Handles, only while drawing. A control point drawn over a finished badge is
  // a distraction; a badge drawn without them is not editable.
  for (const s of doc.strokes) {
    s.anchors.forEach((a, i) => {
      const p = toScreen(a.p);
      // On an open run the first point has nothing arriving and the last has
      // nothing leaving, so those handles do not exist and are not drawn.
      const live = [
        s.closed || i > 0 ? 'hIn' : null,
        s.closed || i < s.anchors.length - 1 ? 'hOut' : null,
      ].filter(Boolean);
      for (const key of live) {
        const h = toScreen([a.p[0] + a[key][0], a.p[1] + a[key][1]]);
        ctx.strokeStyle = 'rgba(220,164,74,.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(h[0], h[1]);
        ctx.stroke();
        ctx.fillStyle = key === 'hOut' ? '#dca44a' : '#f5a524';
        ctx.beginPath();
        ctx.arc(h[0], h[1], 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(p[0] - 4, p[1] - 4, 8, 8);
    });
  }
}

// ── Hit testing ─────────────────────────────────────────────────────────────

function inPolygon(poly, [x, y]) {
  let inside = false;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}


function strokeAt(world) {
  const near = Math.max(doc.wire, 9);
  let best = null;
  for (const s of doc.strokes) {
    const chain = chainOf(s);
    if (!chain.length) continue;
    for (const q of samplePath(chain, 14)) {
      const d = Math.hypot(world[0] - q[0], world[1] - q[1]);
      if (d < near && (!best || d < best.d)) best = { s, d };
    }
  }
  return best?.s ?? null;
}

function grab(world) {
  const near = 9 / SCALE;
  // Anchors win overlaps, including zero-length handles at an endpoint.
  for (const s of doc.strokes) {
    for (const a of s.anchors) {
      if (Math.hypot(world[0] - a.p[0], world[1] - a.p[1]) < near) return { kind: 'anchor', a };
    }
  }
  for (const s of doc.strokes) {
    for (const [i, a] of s.anchors.entries()) {
      const handles = [s.closed || i > 0 ? 'hIn' : null, s.closed || i < s.anchors.length - 1 ? 'hOut' : null].filter(Boolean);
      for (const key of handles) {
        const h = [a.p[0] + a[key][0], a.p[1] + a[key][1]];
        if (Math.hypot(world[0] - h[0], world[1] - h[1]) < near) return { kind: key, a };
      }
    }
  }
  return null;
}

edit.addEventListener('pointerdown', (e) => {
  const r = edit.getBoundingClientRect();
  const world = toWorld(((e.clientX - r.left) / r.width) * edit.width, ((e.clientY - r.top) / r.height) * edit.height);

  if (step === 2) {
    const hit = geo.cells.find((poly) => inPolygon(poly, world));
    selectedCell = hit ? cellKey(hit) : null;
    $('cellinfo').textContent = hit
      ? 'Cell selected. Pick a colour.'
      : 'No cell there. A region only becomes a cell once wire closes it all the way round.';
    paint();
    return;
  }
  if (step !== 1) return;

  // The circle tool takes the whole gesture: press for the centre, drag for the
  // radius, release to commit. It has to come before the handle test below, or
  // starting a circle on top of an existing point would grab that point instead.
  if (tool === 'circle') {
    ghost = { c: world, r: 0 };
    edit.setPointerCapture?.(e.pointerId);
    return;
  }

  if (tool === 'move') {
    const s = strokeAt(world);
    if (!s) {
      status('nothing to move there — grab a line along its length');
      return;
    }
    // The starting positions are copied, and every move is applied to *those*
    // rather than accumulated onto the live ones. Accumulating drifts: a
    // rounding error per pointer event, sixty times a second.
    dragging = { kind: 'stroke', s, from: world, origin: s.anchors.map((a) => [...a.p]) };
    edit.setPointerCapture?.(e.pointerId);
    return;
  }

  const got = grab(world);
  if (got) {
    dragging = got;
    edit.setPointerCapture(e.pointerId);
    return;
  }
  // A new anchor. Its handle starts along the run so a fresh segment is
  // straight, and curves only when somebody asks it to.
  const s = doc.strokes[doc.strokes.length - 1] ?? newStroke();
  const prev = s.anchors[s.anchors.length - 1];
  const h = prev ? [(world[0] - prev.p[0]) / 3, (world[1] - prev.p[1]) / 3] : [18, 0];
  s.anchors.push({ p: world, hIn: [-h[0], -h[1]], hOut: [h[0], h[1]] });
  if (prev && s.anchors.length === 2) {
    prev.hOut = [h[0], h[1]];
    prev.hIn = [-h[0], -h[1]];
  }
  recompute();
});

edit.addEventListener('pointermove', (e) => {
  if (!dragging && !ghost) return;
  const r = edit.getBoundingClientRect();
  const world = toWorld(((e.clientX - r.left) / r.width) * edit.width, ((e.clientY - r.top) / r.height) * edit.height);
  if (ghost) {
    ghost.r = Math.hypot(world[0] - ghost.c[0], world[1] - ghost.c[1]);
    paint();
    return;
  }
  if (dragging.kind === 'stroke') {
    const dx = world[0] - dragging.from[0];
    const dy = world[1] - dragging.from[1];
    dragging.s.anchors.forEach((a, i) => {
      a.p = [dragging.origin[i][0] + dx, dragging.origin[i][1] + dy];
    });
    paint();
    return;
  }
  if (dragging.kind === 'anchor') dragging.a.p = world;
  else dragging.a[dragging.kind] = [world[0] - dragging.a.p[0], world[1] - dragging.a.p[1]];
  paint();
});

edit.addEventListener('pointerup', () => {
  // Cells are recomputed on release, never on every move: the offset behind
  // them is an erosion by a disc and costs tens of milliseconds, which is
  // nothing once but is a stutter sixty times a second.
  if (ghost) {
    const { c, r } = ghost;
    ghost = null;
    // A stray click is a circle of no radius, not a circle. Anything under half
    // the wire width could not be drawn as wire anyway.
    if (r > doc.wire / 2) {
      doc.strokes.push(circleStroke(c, r));
      setTool('pen');
      recompute();
      status(`circle, radius ${r.toFixed(0)}`);
    } else {
      setTool('pen');
      paint();
    }
    return;
  }
  if (dragging) {
    dragging = null;
    recompute();
  }
});


edit.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (step !== 1) return;
  const r = edit.getBoundingClientRect();
  const world = toWorld(
    ((e.clientX - r.left) / r.width) * edit.width,
    ((e.clientY - r.top) / r.height) * edit.height
  );
  const near = 11 / SCALE;
  let best = null;
  for (const s of doc.strokes) {
    s.anchors.forEach((a, i) => {
      const d = Math.hypot(world[0] - a.p[0], world[1] - a.p[1]);
      if (d < near && (!best || d < best.d)) best = { s, i, d };
    });
  }
  if (!best) return;
  best.s.anchors.splice(best.i, 1);
  if (best.s.anchors.length < 2) doc.strokes.splice(doc.strokes.indexOf(best.s), 1);
  recompute();
});

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]') || step !== 1) return;
  if (e.key !== 'Backspace' && e.key !== 'Delete') return;
  e.preventDefault();
  const s = doc.strokes[doc.strokes.length - 1];
  if (!s?.anchors.length) return;
  s.anchors.pop();
  recompute();
});

function newStroke() {
  const s = { anchors: [], closed: false };
  doc.strokes.push(s);
  return s;
}

// ── The 3D preview ──────────────────────────────────────────────────────────

let live = null;
let lockedLive = null;
let pending = null;

function schedulePreview() {
  clearTimeout(pending);
  pending = setTimeout(drawPreview, 260);
}

function drawPreview() {
  const host = $('preview-host');
  const canvas = document.createElement('canvas');
  canvas.id = 'preview';
  canvas.setAttribute('aria-label', 'Earned badge 3D preview');
  canvas.width = 640;
  canvas.height = 640;
  canvas.style.width = '312px';
  canvas.style.height = '312px';
  try {
    const next = mount(canvas, buildRecipe(resolved()), { size: 312, ssaa: 2 });
    live?.dispose();
    live = next;
    host.replaceChildren(canvas);
    orbit(canvas);
    thumbnail(canvas);
    drawLocked();
  } catch (e) {
    $('render-error').textContent = `WebGL preview unavailable: ${e.message}`;
  }
}


function drawLocked() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 320;
  canvas.style.width = '160px';
  canvas.style.height = '160px';
  canvas.id = 'locked';
  canvas.setAttribute('aria-label', 'Locked badge 3D preview');
  try {
    const next = mount(canvas, buildRecipe(resolved(), { locked: true }), { size: 160, ssaa: 2 });
    lockedLive?.dispose();
    lockedLive = next;
    $('locked-host').replaceChildren(canvas);
  } catch (e) {
    $('render-error').textContent = `WebGL locked preview unavailable: ${e.message}`;
  }
}


function orbit(canvas) {
  canvas.style.cursor = 'grab';
  let from = null;
  let base = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!live) return;
    from = [e.clientX, e.clientY];
    base = { x: live.group.rotation.x, y: live.group.rotation.y };
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!from || !live) return;
    live.group.rotation.y = base.y + (e.clientX - from[0]) * 0.009;
    live.group.rotation.x = base.x + (e.clientY - from[1]) * 0.009;
    live.draw();
  });
  const release = () => {
    if (!from || !live) return;
    live.group.rotation.x = base.x;
    live.group.rotation.y = base.y;
    live.draw();
    thumbnail(canvas);
    from = null;
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
}


function thumbnail(from) {
  let src = from;
  let w = from.width;
  while (w > 64) {
    const next = Math.max(64, w >> 1);
    const c = document.createElement('canvas');
    c.width = next;
    c.height = next;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, next, next);
    src = c;
    w = next;
  }
  src.id = 'thumb';
  src.setAttribute('aria-label', 'Badge thumbnail');
  src.style.width = '128px';
  src.style.height = '128px';
  $('thumb-host').replaceChildren(src);
}

// ── Controls ────────────────────────────────────────────────────────────────

const STEPS = ['Blank', 'Lines', 'Colour', 'Form & export'];
$('steps').replaceChildren(
  ...STEPS.map((name, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<b>${i + 1}</b><span>${name}</span>`;
    b.onclick = () => {
      step = i;
      for (const el of document.querySelectorAll('.steps button')) el.removeAttribute('aria-current');
      b.setAttribute('aria-current', 'true');
      for (const s of document.querySelectorAll('section')) s.toggleAttribute('data-on', +s.dataset.step === i);
      paint();
    };
    return b;
  })
);

$('shapes').replaceChildren(
  ...Object.entries(SHAPES).map(([key, def]) => {
    const b = document.createElement('button');
    b.textContent = def.label;
    b.setAttribute('aria-pressed', String(key === doc.shape));
    b.onclick = () => {
      doc.shape = key;
      doc.outline = def.build(doc.size);
      for (const el of $('shapes').children) el.setAttribute('aria-pressed', String(el === b));
      recompute();
    };
    return b;
  })
);

$('metals').replaceChildren(
  ...Object.values(METALS).map((m) => {
    const b = document.createElement('button');
    b.textContent = m.label;
    b.setAttribute('aria-pressed', String(m.hex === doc.metal));
    b.onclick = () => {
      doc.metal = m.hex;
      for (const el of $('metals').children) el.setAttribute('aria-pressed', String(el === b));
      schedulePreview();
    };
    return b;
  })
);

const applyColour = (hex) => {
  if (!selectedCell) {
    $('cellinfo').textContent = 'Select a cell first.';
    return;
  }
  doc.cellColors[selectedCell] = hex;
  paint();
  schedulePreview();
};

$('custom').oninput = (e) => applyColour(e.target.value);

$('swatches').replaceChildren(
  ...PALETTE.map((hex) => {
    const b = document.createElement('button');
    b.style.background = hex;
    b.setAttribute('aria-label', `Colour ${hex}`);
    b.onclick = () => {
      $('custom').value = hex;
      applyColour(hex);
    };
    return b;
  })
);

function slider(id, apply, fmt = (v) => v) {
  const el = $(id);
  const out = $(`v-${id}`);
  el.value = doc[id];
  out.textContent = fmt(doc[id]);
  el.oninput = () => {
    const v = Number(el.value);
    out.textContent = fmt(v);
    apply(v);
  };
}

slider('size', (v) => {
  doc.size = v;
  doc.outline = SHAPES[doc.shape].build(v);
  recompute();
});
slider('wire', (v) => {
  doc.wire = v;
  recompute();
});
slider('thickness', (v) => {
  doc.thickness = v;
  schedulePreview();
});
slider('cut', (v) => {
  doc.cut = v;
  schedulePreview();
}, (v) => `${Math.round(v * 100)}%`);
slider('dish', (v) => {
  doc.dish = v;
  schedulePreview();
});
slider('metalRoughness', (v) => {
  doc.metalRoughness = v;
  schedulePreview();
});

const CURSORS = { pen: 'default', circle: 'crosshair', move: 'move' };

function setTool(next) {
  tool = next;
  for (const id of ['circle', 'move']) $(id).setAttribute('aria-pressed', String(next === id));
  edit.style.cursor = CURSORS[next] ?? 'default';
}

$('newline').onclick = () => {
  setTool('pen');
  newStroke();
  status('new line — click on the blank to lay down points');
};

$('circle').onclick = () => {
  setTool(tool === 'circle' ? 'pen' : 'circle');
  status(tool === 'circle' ? 'circle — click the centre and drag out' : 'back to drawing lines');
};

$('move').onclick = () => {
  setTool(tool === 'move' ? 'pen' : 'move');
  status(tool === 'move' ? 'move — grab a line anywhere along it' : 'back to drawing lines');
};
$('dropline').onclick = () => {
  doc.strokes.pop();
  recompute();
};
$('closed').onchange = (e) => {
  const s = doc.strokes[doc.strokes.length - 1];
  if (s) s.closed = e.target.checked && s.anchors.length > 0;
  e.target.checked = s?.closed ?? false;
  recompute();
};

function syncControls() {
  const FMT = { cut: (v) => `${Math.round(v * 100)}%` };
  for (const id of ['size', 'wire', 'thickness', 'cut', 'dish', 'metalRoughness']) {
    const el = $(id);
    if (!el || doc[id] === undefined) continue;
    el.value = doc[id];
    $(`v-${id}`).textContent = (FMT[id] ?? ((v) => v))(doc[id]);
  }
  for (const b of $('shapes').children) {
    b.setAttribute('aria-pressed', String(SHAPES[doc.shape]?.label === b.textContent));
  }
  for (const b of $('metals').children) {
    b.setAttribute('aria-pressed', String(METALS[b.textContent.toLowerCase()]?.hex === doc.metal));
  }
}


function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('download-json').onclick = () => {
  try {
    const text = serializeDocument(resolved(), $('name').value);
    downloadBlob(new Blob([text], { type: 'application/json' }), downloadName($('name').value, 'json'));
    status('JSON downloaded. Keep this file to edit your design later.');
  } catch (error) { status(`Download failed: ${error.message}`); }
};
let pendingPreset = null;
function loadDocument(next, name) {
  const editable = { ...next, strokes: next.strokes.map(s => strokeFrom(s.points, s.closed)) };
  geometry(next);
  Object.assign(doc, editable);
  pendingPreset = null;
  $('preset-confirm').hidden = true;
  $('name').value = name;
  selectedCell = null;
  dragging = null;
  ghost = null;
  $('closed').checked = doc.strokes.at(-1)?.closed ?? false;
  syncControls();
  recompute();
}
let importGeneration = 0;
const designSnapshot = () => JSON.stringify({doc, name: $('name').value});
$('import-json').onchange = async (event) => {
  const generation = ++importGeneration;
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  const before = designSnapshot();
  try {
    if (file.size >= 256 * 1024) throw new Error('JSON must be smaller than 256 KiB');
    const text = await file.text();
    if (generation !== importGeneration) return;
    if (before !== designSnapshot()) {
      status('Import cancelled because the design changed. Select the file again to replace it.');
      return;
    }
    const imported = parseDocument(text);
    loadDocument(imported.document, imported.name);
    status(`Imported ${imported.name}`);
  } catch (error) {
    if (generation === importGeneration) status(`Import failed: ${error.message}. Current design unchanged.`);
  } finally { if (generation === importGeneration) input.value = ''; }
};
async function downloadPNG(locked) {
  let renderer;
  const button = $(locked ? 'download-locked' : 'download-earned');
  button.disabled = true;
  try {
    const canvas = document.createElement('canvas');
    renderer = mount(canvas, buildRecipe(resolved(), { locked }), { size: 1024, ssaa: 1 });
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png'));
    downloadBlob(blob, downloadName(`${$('name').value}-${locked ? 'locked' : 'earned'}`, 'png'));
    status('Transparent 1024 × 1024 PNG downloaded.');
  } catch (error) {
    $('render-error').textContent = `WebGL PNG export failed: ${error.message}`;
  } finally { renderer?.dispose(); button.disabled = false; }
}
$('presets').replaceChildren(...PRESETS.map(preset => {
  const button = document.createElement('button');
  button.className = 'preset-card';
  button.type = 'button';
  button.setAttribute('aria-label', `Load ${preset.name} preset`);
  const image = document.createElement('img');
  image.src = `./examples/${preset.id}.png`;
  image.alt = '';
  image.width = image.height = 96;
  const title = document.createElement('strong');
  title.textContent = preset.name;
  const description = document.createElement('span');
  description.textContent = preset.description;
  button.append(image, title, description);
  button.onclick = () => {
    pendingPreset = preset;
    $('new-confirm').hidden = true;
    $('preset-message').textContent = `Replace your design with ${preset.name}? Download JSON first to keep your current work.`;
    $('preset-confirm').hidden = false;
    $('cancel-preset').focus();
  };
  return button;
}));
$('cancel-preset').onclick = () => {
  const id = pendingPreset?.id;
  pendingPreset = null;
  $('preset-confirm').hidden = true;
  $('presets').children[PRESETS.findIndex(p => p.id === id)]?.focus();
};
$('apply-preset').onclick = () => {
  if (!pendingPreset) return;
  try {
    const next = createPreset(pendingPreset.id);
    ++importGeneration;
    $('import-json').value = '';
    loadDocument(next.document, next.name);
    setTool('pen');
    $('steps').children[2].click();
    $('steps').children[2].focus();
    status(`Loaded ${next.name}. Select a cell to change its colour.`);
  } catch (error) { status(`Preset failed: ${error.message}`); }
};
$('new-design').onclick = () => { pendingPreset = null; $('preset-confirm').hidden = true; $('new-confirm').hidden = false; $('keep-editing').focus(); };
$('keep-editing').onclick = () => { $('new-confirm').hidden = true; $('new-design').focus(); };
$('discard-design').onclick = () => {
  ++importGeneration;
  $('import-json').value = '';
  loadDocument(createDocument(), 'my-badge');
  setTool('pen');
  $('steps').firstChild.click();
  $('new-confirm').hidden = true;
  status('New design');
};
$('download-earned').onclick = () => downloadPNG(false);
$('download-locked').onclick = () => downloadPNG(true);
$('steps').firstChild.click();
recompute();
