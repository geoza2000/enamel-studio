import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES } from '../src/kernel/_shapes.mjs';
import { samplePath, area } from '../src/kernel/_cells.mjs';
import { geometry, buildRecipe, cellKey } from '../src/kernel/_recipe.mjs';

// Characterization tests for the extracted, existing geometry kernel.
for (const [shape, { build }] of Object.entries(SHAPES)) {
  test(`${shape}: finite normalized silhouette and earned/unearned recipes`, () => {
    const outline = build(200);
    const points = samplePath(outline, 48);
    assert.ok(points.every(p => p.length === 2 && p.every(Number.isFinite)));
    assert.ok(Math.abs(area(points)) > 1000);
    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    const span = Math.max(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys));
    assert.ok(Math.abs(span - 200) < 1);
    const doc = {shape, outline, strokes: [], cellColors: {}};
    const geo = geometry(doc);
    assert.ok(geo.cells.length >= 1);
    doc.cellColors[cellKey(geo.cells[0])] = '#22AACC';
    const earned = buildRecipe(doc);
    assert.ok(earned.layers.some(layer => layer.role === 'colour' && layer.material.color === '#22AACC'));
    const locked = buildRecipe(doc, {locked: true});
    assert.equal(locked.layers.length, 1);
    assert.equal(locked.layers[0].material.type, 'flat');
    assert.ok(locked.layers[0].material.opacity < 1);
  });
}

test('a wire across a circular blank produces two colourable cells', () => {
  const doc = {outline: SHAPES.circle.build(200), strokes: [
    {points: [[-120,0],[-40,0],[40,0],[120,0]], closed: false},
  ]};
  assert.equal(geometry(doc).cells.length, 2);
});


test('a concentric circular wire survives clipping retries', () => {
  const doc = {outline: SHAPES.circle.build(200), strokes: [
    {points: SHAPES.circle.build(80), closed: true},
  ]};
  assert.equal(geometry(doc).cells.length, 2);
});


test('open wire sampling includes its endpoint and closes the enamel region', () => {
  const points = [[-110,0],[-110+205/3,0],[-110+410/3,0],[95,0]];
  assert.deepEqual(samplePath(points,36).at(-1),[95,0]);
  assert.equal(geometry({outline:SHAPES.circle.build(200),strokes:[{points,closed:false}]}).cells.length,2);
});


test('concentric cells keep independent colors through JSON and rendering', async () => {
  const {createDocument,serializeDocument,parseDocument} = await import('../src/document.mjs');
  const doc = createDocument();
  doc.strokes = [{points:SHAPES.circle.build(90),closed:true}];
  const cells = geometry(doc).cells;
  assert.equal(cells.length,2);
  assert.notEqual(cellKey(cells[0]),cellKey(cells[1]));
  doc.cellColors[cellKey(cells[0])] = '#22AACC';
  doc.cellColors[cellKey(cells[1])] = '#DDAA44';
  const loaded = parseDocument(serializeDocument(doc)).document;
  assert.deepEqual(buildRecipe(loaded).layers.filter(l=>l.role==='colour').map(l=>l.material.color),['#22AACC','#DDAA44']);
});
