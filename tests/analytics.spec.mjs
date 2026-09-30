import { test, expect } from '@playwright/test';

test('withdrawing consent disables analytics in every already-open tab', async ({context,page}) => {
  await context.route('https://www.googletagmanager.com/gtag/js*', route => route.fulfill({contentType:'application/javascript',body:''}));
  await page.goto('/');
  await page.getByRole('button',{name:'Allow analytics',exact:true}).click();
  const other=await context.newPage();
  await other.goto('/');
  await expect.poll(()=>page.evaluate(()=>Object.entries(window).some(([k,v])=>k.startsWith('ga-disable-G-')&&v===false))).toBe(true);
  await other.getByRole('button',{name:'Privacy settings',exact:true}).click();
  await other.getByRole('button',{name:'No thanks',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Object.entries(window).some(([k,v])=>k.startsWith('ga-disable-G-')&&v===true)),{timeout:2000}).toBe(true);
  const updates=await page.evaluate(()=>window.dataLayer.map(a=>Array.from(a)).filter(a=>a[0]==='consent'&&a[1]==='update'));
  expect(updates.at(-1)[2].analytics_storage).toBe('denied');
});

// Test builds supply a non-production identifier; the tag is intercepted here.
test('analytics stays blocked until explicit consent and can be disabled', async ({page}) => {
  const loads=[];
  await page.route('https://www.googletagmanager.com/gtag/js*', async route => {
    loads.push(route.request().url());
    await route.fulfill({contentType:'application/javascript',body:'window.testTagLoaded = true;'});
  });
  await page.goto('/?private-name=never-send#private-design');
  await expect(page.getByRole('region',{name:'Analytics consent'})).toBeVisible();
  expect(loads).toEqual([]);
  await page.getByRole('button',{name:'No thanks',exact:true}).click();
  await page.reload();
  expect(loads).toEqual([]);
  await page.getByRole('button',{name:'Privacy settings',exact:true}).click();
  await page.getByRole('button',{name:'Allow analytics',exact:true}).click();
  await expect.poll(()=>loads.length).toBe(1);
  const queue=await page.evaluate(()=>window.dataLayer.map(args=>Array.from(args)));
  const view=queue.find(args=>args[0]==='event'&&args[1]==='page_view');
  expect(view[2].page_location).not.toContain('private-');
  expect(view[2].page_location).not.toContain('?');
  expect(view[2].page_referrer).toBe('');
  expect(queue.find(args=>args[0]==='config')[2].allow_google_signals).toBe(false);
  await page.getByRole('button',{name:'Privacy settings',exact:true}).click();
  await page.getByRole('button',{name:'No thanks',exact:true}).click();
  expect(await page.evaluate(()=>Object.entries(window).some(([key,value])=>key.startsWith('ga-disable-G-')&&value===true))).toBe(true);
  await page.reload();
  expect(loads).toHaveLength(1);
});
