import { chromium } from 'playwright';
const SHOT = process.env.SHOT_DIR;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errs = [];
for (const [name, w, h] of [['wide', 1280, 900], ['phone', 390, 844]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
  p.on('pageerror', e => errs.push(`[${name} pageerror] ` + e.message));
  await p.goto('file:///home/user/vutti14/preview/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${SHOT}/p-${name}-home.png` });
  if (name === 'phone') {
    console.log('home text:', (await p.locator('body').innerText()).slice(0, 400).replace(/\n+/g, ' | '));
    const btns = await p.locator('button').allInnerTexts();
    console.log('buttons:', btns.slice(0, 12).join(' / ').replace(/\n/g, ' '));
    await p.locator('button').first().click();
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${SHOT}/p-phone-after.png` });
    console.log('after click:', (await p.locator('body').innerText()).slice(0, 350).replace(/\n+/g, ' | '));
    console.log('h-scroll:', await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1));
  }
}
console.log(errs.length ? 'ERRORS: ' + errs.join(' ; ') : 'no page errors');
await b.close();
