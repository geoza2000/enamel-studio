import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

if(process.argv.length!==2) {
  console.error('Hosting deployment does not accept arguments; project and target are pinned.');
  process.exit(1);
}
const root=fileURLToPath(new URL('../',import.meta.url));
const config=JSON.parse(readFileSync(new URL('../deployment.json',import.meta.url),'utf8'));
const project='enamel-studio-9c5a6';
if(config.projectId!==project||config.site!==project) throw new Error('Unexpected deployment project');
const key=process.env.GOOGLE_APPLICATION_CREDENTIALS||join(homedir(),'.config/enamel-studio/deployer.json');
if(!existsSync(key)) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to your protected deployer key.');
const state=mkdtempSync(join(tmpdir(),'enamel-firebase-'));
const env={...process.env,GOOGLE_APPLICATION_CREDENTIALS:key,XDG_CONFIG_HOME:state};
delete env.FIREBASE_TOKEN;
const cli=join(root,'node_modules/firebase-tools/lib/bin/firebase.js');
function run(args,capture=false) {
  const result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',stdio:capture?'pipe':'inherit'});
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error(capture?`Firebase preflight failed: ${result.stderr}`:`Command failed (${result.status})`);
  return result.stdout;
}
try {
  const listing=JSON.parse(run([cli,'projects:list','--json','--non-interactive'],true));
  if(!listing.result?.some(p=>p.projectId===project)) throw new Error('Deployer cannot discover the intended Firebase project');
  run([join(root,'scripts/build-hosting.mjs')]);
  run([cli,'deploy','--only','hosting','--project',project,'--config',join(root,'firebase.json'),'--non-interactive']);
} finally {rmSync(state,{recursive:true,force:true});}
