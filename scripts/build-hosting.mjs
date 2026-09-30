import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const config=JSON.parse(readFileSync(new URL('../deployment.json',import.meta.url),'utf8'));
if(!/^G-[A-Z0-9]+$/.test(config.measurementId)) throw new Error('Invalid Analytics measurement ID');
const result=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--base=./'],{cwd:root,stdio:'inherit',env:{...process.env,VITE_GA_MEASUREMENT_ID:config.measurementId}});
if(result.error) throw result.error;
process.exitCode=result.status??1;
