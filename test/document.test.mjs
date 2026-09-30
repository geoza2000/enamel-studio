import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/document.mjs';
import { SHAPES } from '../src/kernel/_shapes.mjs';

const envelope = (document = api.createDocument()) => ({ format: 'enamel-studio', version: 1, name: 'badge', document });

test('rejects non-JSON, oversized UTF-8 input and invalid envelope fields', () => {
  for (const text of [null, '{}', 'export default {}', ' '.repeat(256 * 1024), JSON.stringify({...envelope(), name: 'é'.repeat(140000)}), JSON.stringify({...envelope(), format: 'other'}), JSON.stringify({...envelope(), version: 2}), JSON.stringify({...envelope(), name: ''}), JSON.stringify({...envelope(), extra: true}), JSON.stringify({...envelope(), name: 'x\u0000y'})]) {
    assert.throws(() => api.parseDocument(text));
  }
  for (const prop of ['__proto__', 'constructor']) {
    assert.throws(() => api.parseDocument(JSON.stringify(envelope()).replace('{', `{\"${prop}\":{},`)));
  }
});

test('validates resolved document scalars and rejects every unknown property on import and export', () => {
  const bad = [ ['shape', 'constructor'], ['shape', 'unknown'], ['size', 0], ['size', 1001], ['wire', 0], ['thickness', -1], ['cut', 1], ['dish', 100], ['metalRoughness', 2], ['metal', 'red'], ['metal', '#12345678'], ['size', '200'], ['size', NaN], ['wire', Infinity], ['extra', 1], ['constructor', {}] ];
  for (const [key, value] of bad) {
    const d = {...api.createDocument(), [key]: value};
    assert.throws(() => api.serializeDocument(d), `${key} export`);
    assert.throws(() => api.parseDocument(JSON.stringify(envelope(d))), `${key} import`);
  }
  assert.throws(() => api.serializeDocument({...api.createDocument(), cellColors: {'__proto__': null, constructor: '#ffffff'}}));
  assert.throws(() => api.serializeDocument({...api.createDocument(), cellColors: {'hello': '#ffffff'}}));
  assert.throws(() => api.serializeDocument({...api.createDocument(), cellColors: {'0,0': 'url(x)'}}));
  assert.throws(() => api.serializeDocument(api.createDocument(), ''));
  const getter = api.createDocument();
  Object.defineProperty(getter, 'size', {get() { throw Error('getter must not execute'); }});
  assert.throws(() => api.serializeDocument(getter), /non-JSON/);
});

test('enforces cubic chains, closed endpoints, coordinate bounds and aggregate geometry budgets', () => {
  const chain = n => Array.from({length: 3 * (n - 1) + 1}, (_, i) => [i % 100, 0]);
  const malformed = [
    {strokes: [{points: [[0,0], [1,1]], closed: false}]},
    {strokes: [{points: [[0,0],[1,1],[2,2],[3,3]], closed: true}]},
    {strokes: [{points: [], closed: true}]},
    {strokes: [{points: [[1001,0]], closed: false}]},
    {strokes: [{points: [[0,0,0]], closed: false}]},
    {strokes: [{points: [[0,0]], closed: 'false'}]},
    {strokes: [{points: [], closed: false, constructor: {}}]},
    {strokes: Array.from({length: 33}, () => ({points: [], closed: false}))},
    {strokes: [{points: chain(65), closed: false}]},
    {strokes: Array.from({length: 9}, () => ({points: chain(64), closed: false}))},
    {outline: [[0,0],[1,1],[2,2],[3,3]]},
    {outline: api.createDocument().outline.map(p => p.map(v => v * 5))},
    {outline: api.createDocument().outline.map(p => p.map(v => v / 100))},
  ];
  for (const change of malformed) {
    const d = {...api.createDocument(), ...change};
    assert.throws(() => api.serializeDocument(d));
    assert.throws(() => api.parseDocument(JSON.stringify(envelope(d))));
  }
  const d = api.createDocument();
  d.strokes = [{points: chain(64), closed: false}, {points: [[0,0],[1,2],[3,4],[0,0]], closed: true}];
  assert.deepEqual(api.parseDocument(api.serializeDocument(d)).document, d);
  for (const [shape, {build}] of Object.entries(SHAPES)) {
    const shaped = {...api.createDocument(), shape, outline: build(200)};
    assert.equal((shaped.outline.length - 1) % 3, 0, `${shape} must be a complete cubic chain`);
    assert.deepEqual(api.parseDocument(api.serializeDocument(shaped)).document, shaped);
  }
  const extra = api.createDocument();
  extra.outline[0].constructor = 'bad';
  assert.throws(() => api.serializeDocument(extra));
});

test('download filenames remove traversal, unsafe characters, suffixes and device names', () => {
  assert.equal(api.downloadName('../../My Badge.json', 'json'), 'My-Badge.json');
  assert.equal(api.downloadName('..\\evil\\badge.png', 'png'), 'badge.png');
  assert.equal(api.downloadName('... /', 'json'), 'my-badge.json');
  assert.equal(api.downloadName('CON', 'json'), 'my-badge.json');
  assert.equal(api.downloadName('x<script>\u0000', 'png'), 'x-script.png');
  assert.throws(() => api.downloadName('badge', '../exe'));
  assert.throws(() => api.downloadName({}, 'json'));
});

test('creates independent resolved default documents', () => {
  assert.equal(typeof api.createDocument, 'function');
  const d = api.createDocument();
  assert.deepEqual(d, { shape: 'circle', size: 200, wire: 7, outline: SHAPES.circle.build(200), strokes: [], cellColors: {}, thickness: 11, cut: .65, dish: 14, metal: '#F7FBFF', metalRoughness: .4 });
  d.outline[0][0] = 0;
  assert.equal(api.createDocument().outline[0][0], 100);
});

test('JSON envelope round-trips full precision including draft strokes', () => {
  const d = api.createDocument();
  d.strokes = [{ points: [], closed: false }, { points: [[.123456789012345, -2]], closed: false }];
  d.cellColors = { '-2,3': '#aBcDeF' };
  const text = api.serializeDocument(d, 'My badge');
  assert.deepEqual(JSON.parse(text), { format: 'enamel-studio', version: 1, name: 'My badge', document: d });
  assert.deepEqual(api.parseDocument(text), { name: 'My badge', document: d });
  assert.equal(api.parseDocument(api.serializeDocument(api.createDocument())).name, 'my-badge');
});
