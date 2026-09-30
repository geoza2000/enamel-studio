import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { geometry, cellKey, buildRecipe } from '../src/kernel/_recipe.mjs';
import { parseDocument, serializeDocument } from '../src/document.mjs';

const moduleURL = new URL('../src/presets.mjs', import.meta.url);
const api = existsSync(moduleURL) ? await import(moduleURL) : {};

test('catalogue exposes the four original named preset choices', () => {
  assert.deepEqual(api.PRESETS?.map(p => p.id), ['sunrise', 'prism', 'summit', 'orbit']);
  for (const preset of api.PRESETS) {
    assert.equal(typeof preset.name, 'string');
    assert.ok(preset.description.length > 10);
  }
});

const designs = [
  ['sunrise', 'circle', '#E8B85C'],
  ['prism', 'hexagon', '#F7FBFF'],
  ['summit', 'shield', '#E8B85C'],
  ['orbit', 'squircle', '#F7FBFF'],
];
for (const [id, shape, metal] of designs) {
  test(`${id} creates editable colored geometry that roundtrips and renders earned/locked`, () => {
    assert.equal(typeof api.createPreset, 'function');
    const preset = api.createPreset(id);
    const { document: doc } = preset;
    assert.equal(preset.name, id);
    assert.equal(doc.shape, shape);
    assert.equal(doc.size, 200);
    assert.equal(doc.metal, metal);
    assert.ok(doc.strokes.length >= 2);
    for (const s of doc.strokes) {
      assert.ok(s.points.length >= 4);
      assert.equal((s.points.length - 1) % 3, 0);
      assert.equal(typeof s.closed, 'boolean');
    }
    const geo = geometry(doc);
    assert.ok(geo.cells.length >= 3);
    assert.ok(geo.wires.length > 0);
    assert.deepEqual(Object.keys(doc.cellColors).sort(), geo.cells.map(cellKey).sort());
    assert.ok(new Set(Object.values(doc.cellColors)).size >= 3);
    assert.deepEqual(parseDocument(serializeDocument(doc, preset.name)), preset);
    const earned = buildRecipe(doc);
    assert.deepEqual(earned.layers.filter(l => l.role === 'colour').map(l => l.material.color), geo.cells.map(p => doc.cellColors[cellKey(p)]));
    const locked = buildRecipe(doc, { locked: true });
    assert.equal(locked.layers.length, 1);
    assert.equal(locked.layers[0].material.type, 'flat');
    assert.ok(locked.layers[0].d.length > 0);
    assert.deepEqual(api.createPreset(id), preset);
    const pristine = serializeDocument(doc, preset.name);
    doc.outline[0][0] += 1;
    doc.strokes[0].points[0][0] += 1;
    doc.cellColors[Object.keys(doc.cellColors)[0]] = '#000000';
    assert.deepEqual(api.createPreset(id), parseDocument(pristine));
  });
}

test('stored examples are serializer-produced JSON matching fresh API output', () => {
  for (const { id } of api.PRESETS) {
    const file = new URL(`../public/examples/${id}.json`, import.meta.url);
    assert.ok(existsSync(file), `${id} example must exist`);
    const text = readFileSync(file, 'utf8');
    const preset = api.createPreset(id);
    assert.equal(text.trim(), serializeDocument(preset.document, preset.name));
    assert.deepEqual(parseDocument(text), preset);
  }
});

test('unknown preset identifiers throw rather than silently falling back', () => {
  assert.equal(typeof api.createPreset, 'function');
  for (const id of ['missing', '__proto__', 'constructor', '', null, undefined]) {
    assert.throws(() => api.createPreset(id), /unknown preset/i);
  }
});
