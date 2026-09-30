// Run after npm run build:hosting with npm run preview -- --port 5188 running.
import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const base=process.env.STUDIO_URL||'http://127.0.0.1:5188';
await mkdir('docs/images',{recursive:true});
await mkdir('public/examples',{recursive:true});
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:1050}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(base);
if(await page.getByRole('button',{name:'No thanks',exact:true}).isVisible())await page.getByRole('button',{name:'No thanks',exact:true}).click();
for(const name of ['Sunrise','Prism','Summit','Orbit']) {
 await page.getByRole('button',{name:'1 Blank',exact:true}).click();
 await page.getByRole('button',{name:`Load ${name} preset`,exact:true}).click();
 await page.getByRole('button',{name:'Replace with preset',exact:true}).click();
 await expect(page.getByLabel('Design name')).toHaveValue(name.toLowerCase());
 const waiting=page.waitForEvent('download');
 await page.getByRole('button',{name:'Download earned PNG',exact:true}).click();
 await (await waiting).saveAs(`public/examples/${name.toLowerCase()}.png`);
}
// Reload after images are generated, then capture the real UI with all thumbnails.
await page.reload();
await page.getByRole('button',{name:'Load Sunrise preset',exact:true}).click();
await page.getByRole('button',{name:'Replace with preset',exact:true}).click();
await page.waitForTimeout(650);
await page.getByRole('button',{name:'1 Blank',exact:true}).click();
await page.screenshot({path:'docs/images/studio-desktop.png',fullPage:true});
await page.getByRole('button',{name:'2 Lines',exact:true}).click();
await page.screenshot({path:'docs/images/studio-lines.png',fullPage:true});
await page.getByRole('button',{name:'1 Blank',exact:true}).click();
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:'docs/images/studio-mobile.png',fullPage:true});
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
if(errors.length||overflow)throw new Error(JSON.stringify({errors,overflow}));
console.log(JSON.stringify({errors,overflow,examples:4,screenshots:3}));
await browser.close();
