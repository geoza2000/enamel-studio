import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

test('deployment rejects all caller options before auth or build',()=>{
  for(const args of [['--project','other-project'],['-Pother-project'],['--only','functions']]) {
    const result=spawnSync(process.execPath,['scripts/deploy-hosting.mjs',...args],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/does not accept arguments/);
  }
});
test('hosting serves only the built site with exact configured target',()=>{
  const config=JSON.parse(readFileSync('firebase.json','utf8'));
  const target=JSON.parse(readFileSync('deployment.json','utf8'));
  assert.equal(config.hosting.site,target.projectId);
  assert.equal(config.hosting.public,'dist');
  assert.equal(Object.keys(config).length,1);
  assert.match(target.measurementId,/^G-[A-Z0-9]+$/);
});
