/**
 * ทดสอบการอนุมัติผ่านไลน์ (สเปก §8 S2) — รันเซิร์ฟเวอร์จริงคู่กับ LINE API จำลอง
 * ตัวจำลองรับ push/reply แล้วเก็บไว้ตรวจ จึงทดสอบได้ครบโดยไม่ต้องมี channel จริง
 *   npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rabbiz-line-'));
const PORT = 4600 + (process.pid % 300);
const LINE_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'test-channel-secret';

const COO_LINE_ID = 'Ucoo0000000000000000000000000001';
const STRANGER_LINE_ID = 'Ustranger00000000000000000000002';

let server;
let lineStub;
const pushes = [];
const replies = [];
const cookies = new Map();

// ---------------------------------------------------------------- ตัวช่วย
async function api(method, url, body, who = 'default') {
  const headers = {};
  if (cookies.has(who)) headers.Cookie = cookies.get(who);
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const token = (res.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0]).find((c) => c.startsWith('rabbiz_token='));
  if (token) cookies.set(who, token);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function login(username, password, who) {
  const changed = `Test-${who}-2569`;
  let out = await api('POST', '/api/auth/login', { username, password }, who);
  if (out.status !== 200) out = await api('POST', '/api/auth/login', { username, password: changed }, who);
  assert.equal(out.status, 200, `เข้าสู่ระบบ ${username} ไม่สำเร็จ: ${JSON.stringify(out.body)}`);
  if (out.body.must_change_password)
    assert.equal((await api('POST', '/api/auth/change-password',
      { current_password: password, new_password: changed }, who)).status, 200);
}

/** ยิง webhook พร้อมลายเซ็นที่ถูกต้อง เว้นแต่สั่งให้ปลอม */
async function webhook(events, { signature } = {}) {
  const raw = JSON.stringify({ destination: 'Uoa', events });
  const sig = signature ?? crypto.createHmac('sha256', SECRET).update(raw).digest('base64');
  const res = await fetch(`${BASE}/api/line/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sig },
    body: raw,
  });
  return { status: res.status, body: await res.text() };
}

const textEvent = (userId, text) => ({
  type: 'message', replyToken: 'rt-' + Math.random().toString(36).slice(2),
  source: { type: 'user', userId }, message: { type: 'text', text },
});

const postbackEvent = (userId, data) => ({
  type: 'postback', replyToken: 'rt-' + Math.random().toString(36).slice(2),
  source: { type: 'user', userId }, postback: { data },
});

/** webhook ตอบ 200 ก่อนแล้วค่อยทำงานต่อ — รอจนกว่าเงื่อนไขจะเป็นจริง */
async function eventually(fn, { tries = 60, wait = 50 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { last = await fn(); if (last) return last; } catch (err) { last = err; }
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error(`รอเงื่อนไขไม่สำเร็จ: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

const pushesTo = (lineUserId) => pushes.filter((p) => p.to === lineUserId);

// ---------------------------------------------------------------- ตั้งต้น
before(async () => {
  lineStub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      if (req.url.endsWith('/message/push')) pushes.push(payload);
      if (req.url.endsWith('/message/reply')) replies.push(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((r) => lineStub.listen(LINE_PORT, '127.0.0.1', r));

  const env = {
    ...process.env,
    RABBIZ_DB: path.join(TMP, 'test.db'),
    RABBIZ_DATA_DIR: path.join(ROOT, 'data'),
    RABBIZ_UPLOAD_DIR: path.join(TMP, 'uploads'),
    PORT: String(PORT),
    LINE_CHANNEL_SECRET: SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: 'test-access-token',
    LINE_API_BASE: `http://127.0.0.1:${LINE_PORT}`,
    APP_BASE_URL: 'https://erp.example.co.th',
  };
  const setup = spawnSync(process.execPath, ['server/setup.js', '--reset'],
    { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(setup.status, 0, setup.stderr);
  server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: 'pipe' });
  server.stderr.on('data', (d) => process.stderr.write(String(d)));
  for (let i = 0; i < 100; i++) {
    try { await fetch(BASE + '/api/auth/me'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  await login('rabbizgroup004@gmail.com', '0964040444', 'coo');   // กร COO — ผู้อนุมัติ
  await login('rabbizgroup011@gmail.com', '0934538117', 'pm');    // แม็ก PM — ผู้ขอ
});

after(() => {
  server?.kill();
  lineStub?.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------- ชุดทดสอบ
test('ลายเซ็นไม่ถูกต้องถูกปฏิเสธก่อนแตะข้อมูล', async () => {
  const bad = await webhook([textEvent(COO_LINE_ID, 'ABCDEF')], { signature: 'bm90LWEtcmVhbC1zaWduYXR1cmU=' });
  assert.equal(bad.status, 401);
  const none = await fetch(`${BASE}/api/line/webhook`, { method: 'POST', body: '{}' });
  assert.equal(none.status, 401);
});

test('ผูกบัญชีไลน์ด้วยรหัส 6 ตัวจากหน้าเว็บ', async () => {
  const status = await api('GET', '/api/auth/line/status', undefined, 'coo');
  assert.equal(status.body.linked, false);
  assert.equal(status.body.configured, true);

  const issued = await api('POST', '/api/auth/line/link-code', {}, 'coo');
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.match(issued.body.code, /^[A-Z2-9]{6}$/);

  // รหัสมั่วต้องไม่ผูกให้
  await webhook([textEvent(STRANGER_LINE_ID, 'ZZZZZZ')]);
  await eventually(async () => {
    const r = replies.at(-1);
    return r && JSON.stringify(r.messages).includes('รหัสนี้ใช้ไม่ได้แล้ว');
  });

  await webhook([textEvent(COO_LINE_ID, issued.body.code)]);
  const linked = await eventually(async () => {
    const s = await api('GET', '/api/auth/line/status', undefined, 'coo');
    return s.body.linked ? s.body : null;
  });
  assert.equal(linked.linked, true);

  // รหัสเดิมใช้ซ้ำไม่ได้ — คนอื่นเอารหัสที่ใช้ไปแล้วมาผูกทับไม่ได้
  const beforeReuse = replies.length;
  await webhook([textEvent(STRANGER_LINE_ID, issued.body.code)]);
  await eventually(async () => {
    const r = replies.slice(beforeReuse).at(-1);
    return r && JSON.stringify(r.messages).includes('รหัสนี้ใช้ไม่ได้แล้ว');
  });
  const after2 = await api('GET', '/api/auth/line/status', undefined, 'coo');
  assert.equal(after2.body.linked, true, 'การผูกเดิมต้องไม่ถูกแย่งไป');
});

test('ส่งขออนุมัติแล้วการ์ดเข้าไลน์ของผู้อนุมัติ และกดอนุมัติจากไลน์ได้', async () => {
  const created = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B028', vendor_id: 'V001', has_vat: 'ไม่มี', submit: true,
    lines: [{ cost_code: 'ROF', cost_type: 'ของ', qty: 3, unit_price: 411 }],
  }, 'pm');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.flags.length, 0, 'ใบนี้ต้องไม่มีธง');
  const id = created.body.request.request_id;

  const card = await eventually(async () =>
    pushesTo(COO_LINE_ID).find((p) => JSON.stringify(p.messages).includes(id)));
  const flex = card.messages[0];
  assert.equal(flex.type, 'flex');
  assert.match(flex.altText, new RegExp(id));
  const buttons = JSON.stringify(flex.contents.footer);
  assert.ok(buttons.includes(`action=approve&request_id=${id}`), 'ต้องมีปุ่มอนุมัติ');
  assert.ok(buttons.includes('ไม่อนุมัติ'), 'ต้องมีปุ่มไม่อนุมัติ');
  assert.ok(buttons.includes('https://erp.example.co.th'), 'ปุ่มดูรายละเอียดต้องชี้ไปที่ APP_BASE_URL');

  await webhook([postbackEvent(COO_LINE_ID, `action=approve&request_id=${id}`)]);
  const done = await eventually(async () => {
    const r = await api('GET', `/api/requests/${id}`, undefined, 'coo');
    return r.body.request?.status === 'อนุมัติแล้ว' ? r.body.request : null;
  });
  assert.equal(done.approver_id, 'K');
});

test('ใบที่ติดธงกดอนุมัติจากไลน์ไม่ได้ ต้องเปิดดูในระบบก่อน', async () => {
  const fd = new FormData();
  fd.append('files', new Blob(['photo'], { type: 'image/png' }), 'site.png');
  const att = await api('POST', '/api/requests/new/attachments', fd, 'pm');
  const flagged = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B028', vendor_id: 'V001', has_vat: 'ไม่มี', submit: true,
    attachment_ids: [att.body.files[0].file_id],
    lines: [{ cost_code: 'ROF', cost_type: 'ของ', qty: 1, unit_price: 25000 }],   // W9 ยอดกลม
  }, 'pm');
  assert.ok(flagged.body.flags.length > 0);
  const id = flagged.body.request.request_id;

  const card = await eventually(async () =>
    pushesTo(COO_LINE_ID).find((p) => JSON.stringify(p.messages).includes(id)));
  const footer = JSON.stringify(card.messages[0].contents.footer);
  assert.ok(!footer.includes('action=approve'), 'ใบมีธงต้องไม่มีปุ่มอนุมัติในการ์ด');
  assert.ok(footer.includes('erp.example.co.th'), 'ต้องเหลือแค่ปุ่มเปิดดูในระบบ');

  // ต่อให้ยิง postback ตรง ๆ ระบบก็ต้องไม่อนุมัติให้
  await webhook([postbackEvent(COO_LINE_ID, `action=approve&request_id=${id}`)]);
  await eventually(async () => {
    const r = replies.at(-1);
    return r && JSON.stringify(r.messages).includes('ติดธงเตือน');
  });
  const still = await api('GET', `/api/requests/${id}`, undefined, 'coo');
  assert.equal(still.body.request.status, 'รออนุมัติ');
});

test('ไม่อนุมัติจากไลน์ต้องพิมพ์เหตุผล และเหตุผลถูกบันทึกไว้', async () => {
  const created = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B028', vendor_id: 'V001', has_vat: 'ไม่มี', submit: true,
    lines: [{ cost_code: 'ROF', cost_type: 'ของ', qty: 2, unit_price: 333 }],
  }, 'pm');
  const id = created.body.request.request_id;

  // กดปุ่ม "ไม่อนุมัติ" ยังไม่ตัดสิน — ระบบขอเหตุผลก่อน
  await webhook([postbackEvent(COO_LINE_ID, `action=reject&request_id=${id}`)]);
  await eventually(async () => {
    const r = replies.at(-1);
    return r && JSON.stringify(r.messages).includes(`ไม่อนุมัติ ${id}`);
  });
  const pending = await api('GET', `/api/requests/${id}`, undefined, 'coo');
  assert.equal(pending.body.request.status, 'รออนุมัติ', 'ยังไม่ควรถูกตัดสินก่อนได้เหตุผล');

  await webhook([textEvent(COO_LINE_ID, `ไม่อนุมัติ ${id}: ราคาสูงกว่าที่ตกลงไว้`)]);
  const rejected = await eventually(async () => {
    const r = await api('GET', `/api/requests/${id}`, undefined, 'coo');
    return r.body.request?.status === 'ไม่อนุมัติ' ? r.body.request : null;
  });
  assert.equal(rejected.reject_reason, 'ราคาสูงกว่าที่ตกลงไว้');
});

test('บัญชีไลน์ที่ยังไม่ผูกสั่งอนุมัติไม่ได้ — กันการส่งต่อการ์ดให้คนอื่นกดแทน', async () => {
  const created = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B028', vendor_id: 'V001', has_vat: 'ไม่มี', submit: true,
    lines: [{ cost_code: 'ROF', cost_type: 'ของ', qty: 4, unit_price: 250 }],
  }, 'pm');
  const id = created.body.request.request_id;

  await webhook([postbackEvent(STRANGER_LINE_ID, `action=approve&request_id=${id}`)]);
  await eventually(async () => {
    const r = replies.at(-1);
    return r && JSON.stringify(r.messages).includes('ยังไม่ได้ผูกบัญชี');
  });
  const still = await api('GET', `/api/requests/${id}`, undefined, 'coo');
  assert.equal(still.body.request.status, 'รออนุมัติ');
});

test('ผู้ขอที่ผูกไลน์ไว้ได้รับแจ้งผลกลับ และคิวข้อความบันทึกครบ', async () => {
  const issued = await api('POST', '/api/auth/line/link-code', {}, 'pm');
  const PM_LINE_ID = 'Upm00000000000000000000000000003';
  await webhook([textEvent(PM_LINE_ID, issued.body.code)]);
  await eventually(async () => {
    const s = await api('GET', '/api/auth/line/status', undefined, 'pm');
    return s.body.linked ? s.body : null;
  });

  const created = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B028', vendor_id: 'V001', has_vat: 'ไม่มี', submit: true,
    lines: [{ cost_code: 'ROF', cost_type: 'ของ', qty: 5, unit_price: 120 }],
  }, 'pm');
  const id = created.body.request.request_id;

  await webhook([postbackEvent(COO_LINE_ID, `action=approve&request_id=${id}`)]);
  const told = await eventually(async () =>
    pushesTo(PM_LINE_ID).find((p) => JSON.stringify(p.messages).includes(id)));
  assert.match(told.messages[0].text, new RegExp(`อนุมัติแล้ว ${id}`));

  // ผู้ขอไม่ควรได้การ์ดขออนุมัติของตัวเอง
  assert.ok(!pushesTo(PM_LINE_ID).some((p) => p.messages[0].type === 'flex'),
    'ไม่ควรส่งการ์ดขออนุมัติกลับให้ผู้ขอเอง');

  await login('rabbizgroup001@gmail.com', '0924242626', 'ceo');
  const admin = await api('GET', '/api/admin/line', undefined, 'ceo');
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  assert.equal(admin.body.configured, true);
  assert.equal(admin.body.webhook_url, 'https://erp.example.co.th/api/line/webhook');
  assert.equal(admin.body.linked_users.length, 2);
  assert.ok(admin.body.outbox.every((o) => o.status === 'ส่งแล้ว'),
    `ยังมีข้อความค้าง: ${JSON.stringify(admin.body.counts)}`);
  assert.ok(!('payload' in (admin.body.outbox[0] || {})), 'ไม่ควรส่งเนื้อข้อความทั้งก้อนออกหน้าจอ');
});
