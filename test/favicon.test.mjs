import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('site declares local SVG, ICO fallback, and touch icons with valid file headers',()=>{
  const html=readFileSync('index.html','utf8');
  assert.match(html,/rel="icon"[^>]*href="\.\/favicon\.svg"/);
  assert.match(html,/rel="icon"[^>]*href="\.\/favicon\.ico"/);
  assert.match(html,/rel="apple-touch-icon"[^>]*href="\.\/touch-icon\.png"/);
  const svg=readFileSync('public/favicon.svg','utf8');
  assert.match(svg,/viewBox="0 0 64 64"/);
  assert.doesNotMatch(svg,/<script|<foreignObject|href=/i);
  const ico=readFileSync('public/favicon.ico');
  assert.equal(ico.subarray(0,6).toString('hex'),'000001000100');
  assert.equal(ico[6],64); assert.equal(ico[7],64);
  assert.equal(ico.subarray(22,30).toString('hex'),'89504e470d0a1a0a');
  const png=readFileSync('public/touch-icon.png');
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),180); assert.equal(png.readUInt32BE(20),180);
});
