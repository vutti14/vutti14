#!/usr/bin/env node
/**
 * audit-live.mjs — วัดหน้าเว็บจริงด้วย Chromium เพื่อเทียบ "ก่อน / หลัง"
 *
 *   node tools/audit-live.mjs                 # วัดสถานะปัจจุบัน
 *   node tools/audit-live.mjs --patch         # วัดโดยแทรก patch/custom.css + custom.js เข้าไปด้วย
 *   node tools/audit-live.mjs --json out.json # เก็บผลเป็นไฟล์
 *
 * ต้องมี playwright:  npm i -g playwright  (Chromium อย่างเดียวพอ)
 *
 * หมายเหตุ: ถ้าอยู่หลัง proxy ที่ Chromium ต่อตรงไม่ได้ ให้ตั้ง USE_CURL=1
 * สคริปต์จะดึงทุก request ผ่าน curl แทน
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, unlink, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.xn--q3ca6cja3bzj.com';
const USE_CURL = process.env.USE_CURL === '1';
const WITH_PATCH = process.argv.includes('--patch');
const jsonIdx = process.argv.indexOf('--json');
const JSON_OUT = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null;

const UA = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  mobile: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const PAGES = [
  ['หน้าแรก', '/'],
  ['หมวดหินแกรนิต', '/category/3/' + encodeURIComponent('หินแกรนิต')],
  ['หน้าสินค้า', '/product/68/flex-mcm-travertine'],
  ['หน้าบทความ', '/article'],
];

let seq = 0;
async function curlFetch(url, ua, method, post, dir) {
  const id = ++seq;
  const bf = join(dir, `b${id}`), hf = join(dir, `h${id}`);
  await new Promise((res) => {
    const a = ['-sSL', '--max-time', '40', '-A', ua, '-D', hf, '-o', bf, '-X', method];
    if (post) a.push('--data-binary', post);
    a.push(url);
    spawn('curl', a).on('close', res);
  });
  let body = Buffer.alloc(0), ct = 'application/octet-stream', status = 200;
  try { body = await readFile(bf); } catch {}
  try {
    const h = await readFile(hf, 'utf8');
    const m = h.split(/\r?\n/).reverse().find((l) => /^content-type:/i.test(l));
    if (m) ct = m.split(':').slice(1).join(':').trim();
    const s = h.split(/\r?\n/).filter((l) => /^HTTP\//.test(l)).pop();
    if (s) status = parseInt(s.split(' ')[1]) || 200;
  } catch {}
  try { await unlink(bf); await unlink(hf); } catch {}
  return { body, ct, status };
}

/** สิ่งที่วัด — ทั้งหมดคือตัวเลขที่ Google ใช้ตัดสินจริง */
function collect() {
  const de = document.documentElement;
  const imgs = [...document.images];
  const tappable = [...document.querySelectorAll('a,button')]
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  return {
    title: document.title,
    titleLen: document.title.length,
    h1: [...document.querySelectorAll('h1')].map((e) => e.innerText.trim()).slice(0, 3),
    h2Count: document.querySelectorAll('h2').length,
    h3Count: document.querySelectorAll('h3').length,
    horizontalOverflowPx: Math.max(0, de.scrollWidth - de.clientWidth),
    imgCount: imgs.length,
    imgNoAlt: imgs.filter((i) => !i.hasAttribute('alt') || i.alt.trim() === '').length,
    imgNotLazy: imgs.filter((i) => i.loading !== 'lazy').length,
    imgRenderedZero: imgs.filter((i) => {
      const r = i.getBoundingClientRect();
      return r.width === 0 && r.height === 0;
    }).length,
    imgOversized: imgs
      .filter((i) => {
        const r = i.getBoundingClientRect();
        return r.width > 0 && i.naturalWidth > r.width * 2.5;
      })
      .map((i) => ({
        src: i.currentSrc.slice(-28),
        natural: i.naturalWidth + 'x' + i.naturalHeight,
        displayed: Math.round(i.getBoundingClientRect().width) + 'px',
      }))
      .slice(0, 6),
    tapTargetsTooSmall: tappable.filter((r) => r.height < 44 || r.width < 44).length,
    tapTargetsTotal: tappable.length,
    jsonLdTypes: [...document.querySelectorAll('script[type="application/ld+json"]')]
      .flatMap((s) => {
        try {
          const j = JSON.parse(s.textContent);
          return (Array.isArray(j) ? j : [j]).map((x) => x['@type']);
        } catch { return ['(parse error)']; }
      }),
    ga4: /G-[A-Z0-9]{6,}/.test(document.documentElement.innerHTML),
    universalAnalytics: /UA-\d+-\d+/.test(document.documentElement.innerHTML),
  };
}

const dir = await mkdtemp(join(tmpdir(), 'audit-'));
const browser = await chromium.launch();
const results = {};

let css = '', js = '';
if (WITH_PATCH) {
  css = await readFile(join(ROOT, 'patch/custom.css'), 'utf8');
  js = await readFile(join(ROOT, 'patch/custom.js'), 'utf8');
}

for (const device of ['desktop', 'mobile']) {
  const viewport = device === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const ctx = await browser.newContext({
    viewport, userAgent: UA[device],
    isMobile: device === 'mobile', hasTouch: device === 'mobile',
  });

  if (USE_CURL) {
    await ctx.route('**/*', async (route) => {
      const req = route.request(), url = req.url();
      if (!/^https?:/.test(url)) return route.continue();
      try {
        const r = await curlFetch(url, UA[device], req.method(), req.postData() || null, dir);
        if (!r.body.length && r.status >= 400) return route.abort();
        return route.fulfill({
          status: r.status, body: r.body,
          headers: { 'content-type': r.ct, 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
        });
      } catch { return route.abort(); }
    });
  }

  for (const [label, path] of PAGES) {
    const page = await ctx.newPage();
    const key = `${device} · ${label}`;
    try {
      await page.goto(BASE + path, { waitUntil: 'load', timeout: 150000 });
      if (WITH_PATCH) {
        await page.addStyleTag({ content: css });
        await page.evaluate((code) => {
          const s = document.createElement('script');
          s.textContent = code;
          document.body.appendChild(s);
        }, js);
      }
      await page.waitForTimeout(8000);
      results[key] = await page.evaluate(collect);
    } catch (e) {
      results[key] = { error: e.message.slice(0, 160) };
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();

console.log(`\n=== ${WITH_PATCH ? 'หลังใส่ patch' : 'สถานะปัจจุบัน'} — www.หินอ่อน.com ===\n`);
for (const [k, v] of Object.entries(results)) {
  if (v.error) { console.log(`${k}: ERROR ${v.error}`); continue; }
  console.log(k);
  console.log(`  title (${v.titleLen} ตัวอักษร): ${v.title.slice(0, 70)}...`);
  console.log(`  h1: ${v.h1.length ? JSON.stringify(v.h1) : '*** ไม่มี ***'}   h2:${v.h2Count} h3:${v.h3Count}`);
  console.log(`  เลื่อนออกด้านข้าง: ${v.horizontalOverflowPx ? '*** ' + v.horizontalOverflowPx + 'px ***' : 'ไม่มี'}`);
  console.log(`  รูป: ${v.imgCount} รูป | ไม่มี alt ${v.imgNoAlt} | ไม่ lazy ${v.imgNotLazy} | render 0x0 ${v.imgRenderedZero}`);
  if (v.imgOversized.length) console.log(`  รูปใหญ่เกิน: ${JSON.stringify(v.imgOversized)}`);
  console.log(`  ปุ่มเล็กเกิน 44px: ${v.tapTargetsTooSmall}/${v.tapTargetsTotal}`);
  console.log(`  schema: ${v.jsonLdTypes.join(', ') || 'ไม่มี'}`);
  console.log(`  GA4: ${v.ga4 ? 'มี' : '*** ไม่มี ***'} | UA เก่า: ${v.universalAnalytics ? 'ยังมีอยู่' : 'ไม่มี'}`);
  console.log('');
}
if (JSON_OUT) { await writeFile(JSON_OUT, JSON.stringify(results, null, 2)); console.log('เขียนผลลง ' + JSON_OUT); }
