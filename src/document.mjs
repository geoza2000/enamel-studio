import { SHAPES } from './kernel/_shapes.mjs';

export function serializeDocument(document, name = 'my-badge') {
  validateName(name);
  validateDocument(document);
  const text = JSON.stringify({ format: 'enamel-studio', version: 1, name, document });
  boundedText(text);
  return text;
}

const MAX_BYTES = 256 * 1024;
const fail = (message) => { throw new TypeError(`Invalid document: ${message}`); };
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('expected plain object');
  const actual = Reflect.ownKeys(value);
  if (actual.some(key => typeof key !== 'string' || key === '__proto__' || key === 'constructor' || (keys && !keys.includes(key)))) fail('unknown property');
  if (keys && keys.some(key => !Object.hasOwn(value, key))) fail('missing property');
  for (const key of actual) if (!Object.getOwnPropertyDescriptor(value, key).enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) fail('non-JSON property');
}
function validateName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || /[\u0000-\u001f\u007f]/u.test(name)) fail('name must be 1–120 printable characters');
}
function boundedText(text) {
  if (typeof text !== 'string' || text.length >= MAX_BYTES || new TextEncoder().encode(text).length >= MAX_BYTES) fail('JSON must be smaller than 256 KiB');
}

function number(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${label} outside ${min}–${max}`);
}
function color(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('expected six-digit hex color');
}
// These inclusive limits are the editor's supported parameter domain.
const RANGES = { size: [100, 300], wire: [2, 16], thickness: [4, 24], cut: [.2, .9], dish: [0, 40], metalRoughness: [.05, 1] };
function array(value, max) {
  if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) fail('invalid or oversized array');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(k => k !== 'length' && !/^(0|[1-9]\d*)$/.test(String(k)))) fail('unknown array property');
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('non-JSON array');
  }
}
function chain(points, closed, draft = false) {
  array(points, 190); // 64 anchors, with two controls per segment.
  if (!(draft && points.length === 0) && (points.length < 1 || (points.length - 1) % 3 !== 0)) fail('expected cubic chain');
  for (const p of points) {
    array(p, 2);
    if (p.length !== 2) fail('expected x,y point');
    number(p[0], -1000, 1000, 'x');
    number(p[1], -1000, 1000, 'y');
  }
  if (closed && (points.length < 4 || points[0][0] !== points.at(-1)[0] || points[0][1] !== points.at(-1)[1])) fail('closed chain endpoints must match');
  return points.length ? (points.length - 1) / 3 + 1 : 0;
}
function validateDocument(d) {
  record(d, ['shape', 'size', 'wire', 'outline', 'strokes', 'cellColors', 'thickness', 'cut', 'dish', 'metal', 'metalRoughness']);
  if (typeof d.shape !== 'string' || !Object.hasOwn(SHAPES, d.shape)) fail('unknown shape');
  for (const [key, [min, max]] of Object.entries(RANGES)) number(d[key], min, max, key);
  color(d.metal);
  let anchors = chain(d.outline, true);
  // Control hull must stay proportional to the nominal blank, allowing edited outlines.
  const xs = d.outline.map(p => p[0]);
  const ys = d.outline.map(p => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (span < d.size / 4 || span > d.size * 2 || d.outline.some(p => p.some(v => Math.abs(v) > d.size))) fail('outline disproportionate to size');
  array(d.strokes, 32);
  for (const s of d.strokes) {
    record(s, ['points', 'closed']);
    if (typeof s.closed !== 'boolean') fail('closed must be boolean');
    anchors += chain(s.points, s.closed, true);
  }
  if (anchors > 512) fail('total anchor budget exceeded');
  record(d.cellColors);
  if (Object.keys(d.cellColors).length > 1024) fail('too many colors');
  for (const [key, value] of Object.entries(d.cellColors)) {
    const fingerprint = /^cell-[0-9a-f]{16}$/.test(key);
    const coordinate = /^-?(?:0|[1-9]\d{0,2}),-?(?:0|[1-9]\d{0,2})$/.test(key) && key.split(',').every(n => Math.abs(Number(n)) <= 250);
    if (!fingerprint && !coordinate) fail('invalid cell key');
    color(value);
  }
}

export function parseDocument(text) {
  boundedText(text);
  const envelope = JSON.parse(text);
  record(envelope, ['format', 'version', 'name', 'document']);
  if (envelope.format !== 'enamel-studio' || envelope.version !== 1) fail('unsupported format or version');
  const { name, document } = envelope;
  validateName(name);
  validateDocument(document);
  return { name, document };
}

export function downloadName(name, extension) {
  if (typeof name !== 'string' || !['json', 'png'].includes(extension)) fail('invalid download name or extension');
  let base = name.split(/[\\/]/).at(-1).replace(/\.(?:json|png)$/i, '')
    .replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '');
  if (!base || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = 'my-badge';
  return `${base}.${extension}`;
}

export function createDocument() {
  return { shape: 'circle', size: 200, wire: 7, outline: SHAPES.circle.build(200), strokes: [], cellColors: {}, thickness: 11, cut: .65, dish: 14, metal: '#F7FBFF', metalRoughness: .4 };
}
