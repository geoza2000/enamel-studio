import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
// Editor tests opt out; analytics.spec.mjs independently covers consent UI.
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('enamel-studio.analytics-consent.v1', 'denied'));
});

async function download(page,label='Download JSON') {
  const waiting=page.waitForEvent('download');
  await page.getByRole('button',{name:label,exact:true}).click();
  const file=await waiting;
  return readFile(await file.path());
}
test('initial 3D rendering does not move the editing canvas',async({page})=>{
  await page.addInitScript(()=>{
    const original=window.setTimeout;
    window.previewTimers=[];
    window.setTimeout=(fn,delay,...args)=>delay===260?(window.previewTimers.push(()=>fn(...args)),0):original(fn,delay,...args);
  });
  await page.goto('/');
  await page.getByRole('button',{name:'2 Lines',exact:true}).click();
  const before=await page.getByLabel('Design canvas').boundingBox();
  await page.evaluate(()=>window.previewTimers.splice(0).forEach(fn=>fn()));
  await page.getByLabel('Earned badge 3D preview').waitFor();
  const after=await page.getByLabel('Design canvas').boundingBox();
  expect(after.y).toBeCloseTo(before.y,0);
});

test('studio links to its public repository and creator',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('link',{name:'GitHub',exact:true})).toHaveAttribute('href','https://github.com/geoza2000/enamel-studio');
  await expect(page.getByRole('link',{name:'@geoza2000 on X',exact:true})).toHaveAttribute('href','https://x.com/geoza2000');
});

for(const name of ['Sunrise','Prism','Summit','Orbit']) {
  test(`${name} preset supports editable JSON roundtrip and PNG export`,async({page})=>{
    await page.goto('/');
    await page.getByRole('button',{name:`Load ${name} preset`,exact:true}).click();
    await expect(page.getByRole('group',{name:'Confirm preset replacement'})).toBeVisible();
    await page.getByRole('button',{name:'Replace with preset',exact:true}).click();
    await expect(page.getByLabel('Design name')).toHaveValue(name.toLowerCase());
    const json=await download(page),doc=JSON.parse(json).document;
    expect(doc.strokes.length).toBeGreaterThan(0);
    expect(new Set(Object.values(doc.cellColors)).size).toBeGreaterThan(1);
    await page.getByLabel('Import JSON').setInputFiles({name:'example.json',mimeType:'application/json',buffer:json});
    await expect(page.getByRole('status')).toContainText('Imported');
    expect(JSON.parse(await download(page))).toEqual(JSON.parse(json));
    for(const state of ['earned','locked']) {
      const bytes=await download(page,`Download ${state} PNG`);
      expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(bytes.readUInt32BE(16)).toBe(1024);
      expect(bytes.length).toBeGreaterThan(10000);
    }
    await expect(page.locator('#render-error')).toBeEmpty();
  });
}
test('preset cancellation preserves work and mobile cards fit',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByLabel('Design name').fill('keep-this');
  const before=await download(page);
  await page.getByRole('button',{name:'Load Sunrise preset',exact:true}).click();
  await page.getByRole('button',{name:'Cancel preset',exact:true}).click();
  expect(await download(page)).toEqual(before);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
