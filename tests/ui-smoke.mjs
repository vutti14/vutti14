/**
 * ทดสอบหน้าจอบนมือถือจำลอง (390x844) — เปิดทุกหน้า จับภาพ และลองสร้างใบเบิกจริง
 *
 *   npm install --no-save playwright
 *   node server/index.js &            ← หรือชี้ BASE ไปที่เซิร์ฟเวอร์ที่รันอยู่
 *   node tests/ui-smoke.mjs
 *
 * ตัวแปรที่ปรับได้: BASE · SHOT_DIR · CHROME_PATH · USER_EMAIL · USER_PW · PM_PASS=0 (ข้ามรอบ PM)
 * ไม่ได้อยู่ใน `npm test` เพราะต้องติดตั้ง playwright เพิ่ม
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const SHOT = process.env.SHOT_DIR || path.join(os.tmpdir(), 'rabbiz-ui-shots');
fs.mkdirSync(SHOT, { recursive: true });

const errors = [];
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
page.on('requestfailed', r => errors.push('[requestfailed] ' + r.url() + ' ' + r.failure()?.errorText));

async function step(name, fn) {
  try { await fn(); console.log('OK  ', name); }
  catch (e) { console.log('FAIL', name, '-', e.message); errors.push(`${name}: ${e.message}`); }
  await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: true });
}

const who = process.env.USER_EMAIL || 'rabbizgroup001@gmail.com';
const pw = process.env.USER_PW || '0924242626';

await step('01-login', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  for (const candidate of [pw, 'TestPass2569!']) {
    await page.fill('input[type=email]', who);
    await page.fill('input[type=password]', candidate);
    await page.click('button[type=submit]');
    try { await page.waitForSelector('.modal, .navbar', { timeout: 5000 }); return; } catch {}
  }
  throw new Error('เข้าสู่ระบบไม่สำเร็จ');
});

// เปลี่ยนรหัสผ่านครั้งแรกถ้ามีโมดัลขึ้น
if (await page.$('.modal')) {
  await step('02-change-password', async () => {
    const inputs = await page.$$('.modal input[type=password]');
    if (inputs.length === 2) {
      await inputs[0].fill('TestPass2569!');
      await inputs[1].fill('TestPass2569!');
      await page.click('.modal-actions .btn.primary');
    }
    await page.waitForTimeout(600);
    // ข้าม 2FA ถ้าขึ้น
    const skip = await page.$('.modal-actions .btn:not(.primary)');
    if (skip && (await page.textContent('.modal h2'))?.includes('2FA')) await skip.click();
    await page.waitForSelector('.navbar', { timeout: 8000 });
  });
}

const routes = ['dashboard', 'new', 'approve', 'pay', 'docs', 'requests', 'vendors', 'finance', 'admin'];
for (const r of routes) {
  await step(`10-${r}`, async () => {
    await page.goto(`${BASE}/#/${r}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const body = await page.textContent('#view');
    if (/กำลังโหลด…$/.test(body.trim())) throw new Error('ค้างที่หน้าโหลด');
    const banner = await page.$('.banner.error');
    if (banner) throw new Error('banner: ' + await banner.textContent());
  });
}

await step('20-request-detail', async () => {
  await page.goto(`${BASE}/#/requests`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.item', { timeout: 8000 });
  await page.click('.item');
  await page.waitForTimeout(900);
  if (!(await page.textContent('#view')).includes('รายการย่อย')) throw new Error('ไม่พบรายการย่อย');
});

await step('30-dashboard-tabs', async () => {
  await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.filters button', { timeout: 8000 });
  const n = (await page.$$('.filters button')).length;
  for (let i = 0; i < n; i++) {
    await page.$$eval('.filters button', (els, idx) => els[idx].click(), i);
    await page.waitForTimeout(500);
    const err = await page.$('#view .banner.error');
    if (err) throw new Error('tab ' + i + ': ' + await err.textContent());
  }
});

// ---------------------------------------------------------------- รอบที่สอง: PM สร้างใบเบิกจริง
if (process.env.PM_PASS !== '0') {
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push('[pm pageerror] ' + e.message));
  p2.on('console', m => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('[pm console] ' + m.text()); });
  const shot = async (n) => p2.screenshot({ path: `${SHOT}/${n}.png`, fullPage: true });

  try {
    await p2.goto(BASE, { waitUntil: 'networkidle' });
    for (const candidate of ['0934538117', 'TestPass2569!']) {
      await p2.fill('input[type=email]', 'rabbizgroup011@gmail.com');
      await p2.fill('input[type=password]', candidate);
      await p2.click('button[type=submit]');
      try { await p2.waitForSelector('.modal, .navbar', { timeout: 5000 }); break; } catch {}
    }
    if (await p2.$('.modal')) {
      const inputs = await p2.$$('.modal input[type=password]');
      if (inputs.length === 2) {
        await inputs[0].fill('TestPass2569!'); await inputs[1].fill('TestPass2569!');
        await p2.click('.modal-actions .btn.primary');
      }
      await p2.waitForTimeout(700);
    }
    await p2.waitForSelector('.navbar', { timeout: 8000 });
    const tabs = await p2.$$eval('.navbar a', els => els.map(e => e.dataset.path));
    console.log('OK   40-pm-nav', tabs.join(','));
    if (tabs.includes('approve') || tabs.includes('admin')) throw new Error('PM ไม่ควรเห็นเมนูอนุมัติ/ตั้งค่า');

    await p2.goto(`${BASE}/#/new`, { waitUntil: 'networkidle' });
    await p2.waitForSelector('.segment button', { timeout: 8000 });
    // ลำดับ select ในหน้า: โครงการ · อาคาร · ผู้ขาย · หมวดงาน · รายการมาตรฐาน
    const pick = async (idx, optIdx = 1) =>
      (await p2.$$('#view select'))[idx].selectOption({ index: optIdx });
    await pick(0); await p2.waitForTimeout(300);
    await pick(1); await pick(2); await pick(3);
    await p2.click('.segment button:first-child');
    const nums = await p2.$$('#view input[type=number]');
    await nums[0].fill('4'); await nums[1].fill('250');
    await nums[1].dispatchEvent('input');
    await p2.waitForTimeout(300);
    await shot('41-pm-form');
    const total = await p2.textContent('.sticky-total');
    if (!total.includes('1,000')) throw new Error('ยอดรวมคำนวณผิด: ' + total.replace(/\s+/g, ' '));
    await p2.click('button:has-text("ส่งขออนุมัติ")');
    await p2.waitForTimeout(1500);
    await shot('42-pm-submitted');
    const view = await p2.textContent('#view');
    const modalText = (await p2.$('.modal')) ? await p2.textContent('.modal') : '';
    if (!/REQ-\d{4}-\d{4}/.test(view + modalText)) throw new Error('ไม่พบเลขที่ใบเบิกหลังส่ง');
    console.log('OK   43-pm-create-request');
  } catch (e) {
    console.log('FAIL 4x-pm-flow -', e.message);
    errors.push('pm-flow: ' + e.message);
    await shot('49-pm-fail');
  }
  await ctx2.close();
}

await browser.close();
console.log('\n--- ' + errors.length + ' ปัญหา ---');
for (const e of [...new Set(errors)]) console.log(e);
process.exit(errors.length ? 1 : 0);
