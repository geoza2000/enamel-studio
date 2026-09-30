import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function jsonDownload(page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  const download = await event;
  return { text: await readFile(await download.path(), 'utf8'), name: download.suggestedFilename() };
}
async function drawLine(page) {
  await page.getByRole('button', { name: '2 Lines', exact: true }).click();
  const box = await page.getByLabel('Design canvas').boundingBox();
  await page.mouse.click(box.x + box.width * .35, box.y + box.height * .5);
  await page.mouse.click(box.x + box.width * .65, box.y + box.height * .5);
}

test('transparent earned and locked PNG downloads contain real 1024px pixels', async ({ page }) => {
  await page.goto('/');
  for (const state of ['earned', 'locked']) {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: `Download ${state} PNG`, exact: true }).click();
    const download = await event;
    const bytes = await readFile(await download.path());
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(1024);
    expect(bytes.readUInt32BE(20)).toBe(1024);
    expect(bytes.length).toBeGreaterThan(10000);
    const pixels = await page.evaluate(async (data) => {
      const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      return { corner: ctx.getImageData(0, 0, 1, 1).data[3], painted: ctx.getImageData(0, 0, 1024, 1024).data.some((v, i) => i % 4 === 3 && v > 0) };
    }, bytes.toString('base64'));
    expect(pixels.corner).toBe(0); expect(pixels.painted).toBe(true);
  }
});

test('editable stroke survives JSON download import download roundtrip', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Enamel Studio' })).toBeVisible();
  await drawLine(page);
  const first = await jsonDownload(page);
  expect(first.name).toBe('my-badge.json');
  expect(JSON.parse(first.text).document.strokes[0].points.length).toBeGreaterThan(3);
  await page.getByLabel('Import JSON').setInputFiles({ name: first.name, mimeType: 'application/json', buffer: Buffer.from(first.text) });
  await expect(page.getByRole('status')).toContainText('Imported');
  expect(JSON.parse((await jsonDownload(page)).text)).toEqual(JSON.parse(first.text));
  await page.getByLabel('Design name').fill('typing');
  await page.getByLabel('Design name').press('Backspace');
  await page.getByLabel('Design name').press('Delete');
  expect(JSON.parse((await jsonDownload(page)).text).document.strokes).toEqual(JSON.parse(first.text).document.strokes);
  await page.getByRole('button', { name: 'Delete line', exact: true }).click();
  expect(JSON.parse((await jsonDownload(page)).text).document.strokes).toEqual([]);
});

test('new design requires in-page confirmation and can be cancelled', async ({ page }) => {
  await page.goto('/'); await drawLine(page);
  const before = await jsonDownload(page);
  await page.getByRole('button', { name: 'New design', exact: true }).click();
  await expect(page.getByText('Discard current design?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  expect((await jsonDownload(page)).text).toBe(before.text);
  await page.getByRole('button', { name: 'New design', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and start new' }).click();
  expect(JSON.parse((await jsonDownload(page)).text).document.strokes).toEqual([]);
});

test('one-anchor draft survives JSON and imported controls reflect closed strokes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '2 Lines', exact: true }).click();
  await page.getByLabel('Design canvas').click({ position: { x: 150, y: 150 } });
  const first = JSON.parse((await jsonDownload(page)).text);
  expect(first.document.strokes[0].points).toHaveLength(1);
  await page.getByLabel('Import JSON').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(first)) });
  await expect(page.getByRole('status')).toContainText('Imported');
  expect(JSON.parse((await jsonDownload(page)).text)).toEqual(first);
  const next = structuredClone(first);
  next.document.strokes = [{ points: [[0,0],[10,0],[10,10],[0,0]], closed: true }];
  next.document.metal = '#FFE67C';
  await page.getByLabel('Import JSON').setInputFiles({ name: 'closed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(next)) });
  await expect(page.getByRole('status')).toContainText('Imported');
  await expect(page.getByLabel('Close the loop')).toBeChecked();
  expect(JSON.parse((await jsonDownload(page)).text)).toEqual(next);
  await page.getByRole('button', { name: '1 Blank', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Gold', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
test('invalid JSON leaves the design unchanged without executing code', async ({ page }) => {
  await page.goto('/'); await drawLine(page);
  const before = await jsonDownload(page);
  await page.getByLabel('Import JSON').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('window.pwned = true;') });
  await expect(page.getByRole('status')).toContainText('Import failed');
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect((await jsonDownload(page)).text).toBe(before.text);
});
test('mobile layout has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByLabel('Design canvas')).toBeVisible();
  await expect(page.getByLabel('Earned badge 3D preview')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const [step, ids] of [['1 Blank', ['size', 'wire']], ['4 Form & export', ['thickness', 'cut', 'dish', 'metalRoughness']]]) {
  for (const id of ids) {
    test(`slider ${id} endpoints remain downloadable documents`, async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: step, exact: true }).click();
      const slider = page.locator(`#${id}`);
      await slider.focus(); await slider.press('End');
      await jsonDownload(page);
      await slider.focus(); await slider.press('Home');
      await jsonDownload(page);
    });
  }
}
test('WebGL unavailability is surfaced without breaking JSON editing', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (type.startsWith('webgl')) return null;
      return original.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('WebGL');
  await drawLine(page);
  expect(JSON.parse((await jsonDownload(page)).text).document.strokes).toHaveLength(1);
});


test('imported open endpoints move instead of dragging invisible handles', async ({page}) => {
  await page.goto('/');
  const project = JSON.parse((await jsonDownload(page)).text);
  project.document.strokes = [{points:[[-30,0],[-10,0],[10,0],[30,0]],closed:false}];
  await page.getByLabel('Import JSON').setInputFiles({name:'line.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.getByRole('status')).toContainText('Imported');
  await page.getByRole('button',{name:'2 Lines',exact:true}).click();
  const box=await page.getByLabel('Design canvas').boundingBox();
  for (const x of [-30,30]) {
    await page.mouse.move(box.x+box.width/2+x*box.width/520,box.y+box.height/2);
    await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+x*box.width/520,box.y+box.height/2-20,{steps:3});
    await page.mouse.up();
  }
  const points=JSON.parse((await jsonDownload(page)).text).document.strokes[0].points;
  expect(points[0][1]).toBeGreaterThan(5);
  expect(points.at(-1)[1]).toBeGreaterThan(5);
});


for (const action of ['new design', 'editing', 'newer import']) {
  test(`a delayed import cannot replace ${action}`, async ({page}) => {
    await page.goto('/');
    const project=JSON.parse((await jsonDownload(page)).text);
    project.name='stale-import';
    await page.evaluate(() => {
      const original=File.prototype.text;
      File.prototype.text=async function() {
        const text=await original.call(this);
        if(this.name==='slow.json') await new Promise(resolve=>window.finishSlowRead=resolve);
        return text;
      };
    });
    await page.getByLabel('Import JSON').setInputFiles({name:'slow.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
    await page.waitForFunction(()=>typeof window.finishSlowRead==='function');
    if(action==='new design') {
      await page.getByRole('button',{name:'New design',exact:true}).click();
      await page.getByRole('button',{name:'Discard and start new'}).click();
    } else if(action==='editing') {
      await page.getByLabel('Design name').fill('edited-design');
    } else {
      project.name='newer-import';
      await page.getByLabel('Import JSON').setInputFiles({name:'fast.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
      await expect(page.getByRole('status')).toContainText('Imported newer-import');
    }
    const expected=await page.getByLabel('Design name').inputValue();
    await page.evaluate(()=>window.finishSlowRead());
    await page.waitForTimeout(100);
    expect(JSON.parse((await jsonDownload(page)).text).name).toBe(expected);
  });
}


for(const shape of ['Heart','Circle','Hexagon','Squircle','Shield']) {
  test(`${shape} supports JSON and real PNG export`,async({page})=>{
    await page.goto('/');
    await page.getByRole('button',{name:shape,exact:true}).click();
    expect(JSON.parse((await jsonDownload(page)).text).document.shape).toBe(shape.toLowerCase());
    const event=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download earned PNG',exact:true}).click();
    const bytes=await readFile(await (await event).path());
    expect(bytes.readUInt32BE(16)).toBe(1024);
    await expect(page.getByRole('alert')).toBeEmpty();
  });
}


test('closing an empty new line cannot break editing or JSON saving',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button',{name:'2 Lines',exact:true}).click();
  await page.getByRole('button',{name:'New line',exact:true}).click();
  await page.getByLabel('Close the loop').click();
  await expect(page.getByLabel('Close the loop')).not.toBeChecked();
  await jsonDownload(page);
  expect(errors).toEqual([]);
});
