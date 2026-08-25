/**
 * ทดสอบเส้นทางหลักของระบบตั้งแต่ต้นจนจบ (รันบนฐานข้อมูลชั่วคราว ไม่แตะฐานจริง)
 *   npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rabbiz-test-'));
const PORT = 3999 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ENV = {
  ...process.env,
  RABBIZ_DB: path.join(TMP, 'test.db'),
  RABBIZ_DATA_DIR: path.join(ROOT, 'data'),
  RABBIZ_UPLOAD_DIR: path.join(TMP, 'uploads'),
  PORT: String(PORT),
};

let server;
const cookies = new Map();

async function api(method, url, body, who = 'default') {
  const headers = {};
  if (cookies.has(who)) headers.Cookie = cookies.get(who);
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const setCookie = res.headers.getSetCookie?.() || [];
  const token = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('rabbiz_token='));
  if (token) cookies.set(who, token);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

/** เข้าสู่ระบบแบบรันซ้ำได้: ครั้งแรกใช้เบอร์โทร ครั้งต่อไปใช้รหัสที่ตั้งไว้แล้ว */
async function login(username, password, who) {
  const changed = `Test-${who}-2569`;
  let out = await api('POST', '/api/auth/login', { username, password }, who);
  if (out.status !== 200)
    out = await api('POST', '/api/auth/login', { username, password: changed }, who);
  assert.equal(out.status, 200, `เข้าสู่ระบบ ${username} ไม่สำเร็จ: ${JSON.stringify(out.body)}`);
  if (out.body.must_change_password) {
    const ch = await api('POST', '/api/auth/change-password',
      { current_password: password, new_password: changed }, who);
    assert.equal(ch.status, 200, JSON.stringify(ch.body));
  }
  return out.body;
}

before(async () => {
  const setup = spawnSync(process.execPath, ['server/setup.js', '--reset'],
    { cwd: ROOT, env: ENV, encoding: 'utf8' });
  assert.equal(setup.status, 0, setup.stderr);
  server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: ENV, stdio: 'pipe' });
  server.stderr.on('data', (d) => process.stderr.write(String(d)));
  for (let i = 0; i < 100; i++) {
    try { await fetch(BASE + '/api/auth/me'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});

after(() => {
  server?.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('นำเข้าข้อมูลย้อนหลังครบ 1,449 ใบ 15,153,287.91 บาท', async () => {
  await login('rabbizgroup001@gmail.com', '0924242626', 'ceo');
  const { status, body } = await api('GET', '/api/admin/health', undefined, 'ceo');
  assert.equal(status, 200);
  assert.equal(body.counts.requests, 1449);
  const imported = body.totals.find((t) => t.value_source === 'นำเข้าย้อนหลัง');
  assert.equal(imported.n, 1449);
  assert.equal(imported.amount, 15153287.91);
});

test('v9 — แยกทรัพย์สินกลุ่มออกจากงานอื่นได้ตรงตามชีต 29', async () => {
  const { body } = await api('GET', '/api/reports/dashboard', undefined, 'ceo');
  const asset = body.asset_split.find((x) => x.is_group_asset);
  const other = body.asset_split.find((x) => !x.is_group_asset);
  assert.equal(asset.amount, 14188598.38);
  assert.equal(other.amount, 964689.53);

  const onlyAsset = await api('GET', '/api/reports/by-project?group_asset=1', undefined, 'ceo');
  assert.ok(onlyAsset.body.rows.every((x) => x.is_group_asset === 1));
  assert.ok(onlyAsset.body.rows.some((x) => x.project_type === 'ทรัพย์สินกลุ่ม'));
});

test('v9 — พบการจ่ายเงินให้ทีมงานของเราเอง 53 ใบ', async () => {
  const { body } = await api('GET', '/api/reports/staff-payments', undefined, 'ceo');
  assert.equal(body.rows.length, 53);
  assert.equal(body.total, 165729.51);
  assert.ok(body.rows.some((x) => x.self_paid === 1), 'ต้องมีใบที่เบิกเองจ่ายตัวเอง');
});

test('v9 W10 — เลือกผู้ขายที่เป็นทีมงานของเราเองต้องติดธง', async () => {
  await login('rabbizgroup004@gmail.com', '0964040444', 'coo');
  const vendors = await api('GET', '/api/vendors', undefined, 'coo');
  const staff = vendors.body.vendors.find((v) => v.is_own_staff);
  assert.ok(staff, 'ต้องมีผู้ขายที่ถูกทำเครื่องหมายว่าเป็นทีมงานของเราเอง');
  const res = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B004', vendor_id: staff.vendor_id, has_vat: 'ไม่มี',
    lines: [{ cost_code: 'WAL', cost_type: 'แรง', qty: 1, unit_price: 1500 }],
  }, 'coo');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.flags.some((f) => f.code === 'W10'), JSON.stringify(res.body.flags));
});

test('v9 — สิทธิ์รายโครงการมาจากตาราง user_access ไม่ใช่การเดา', async () => {
  await login('rabbizgroup011@gmail.com', '0934538117', 'pm');
  const { body } = await api('GET', '/api/bootstrap', undefined, 'pm');
  const ids = body.projects.map((p) => p.project_id).sort();
  // แม็ก: ไทยรามัญ · อ่อนนุช · แรปบิทบ็อก · สำนักงาน (ตามชีต 21_DIM_USER_ACCESS)
  assert.deepEqual(ids, ['OFF', 'ONN', 'RBX', 'RMT']);
});

test('v9 — ขอสิทธิ์ชั่วคราวแล้ว COO อนุมัติ ทำให้เบิกโครงการนั้นได้', async () => {
  const before = await api('GET', '/api/bootstrap', undefined, 'pm');
  const target = before.body.other_projects.find((p) => p.project_id === 'RAC');
  assert.ok(target, 'แม็กยังไม่ควรมีสิทธิ์ในราชพฤกษ์');

  const blocked = await api('POST', '/api/requests', {
    project_id: 'RAC', building_id: 'B002', vendor_id: 'V003', has_vat: 'ไม่มี',
    lines: [{ cost_code: 'CON', cost_type: 'ของ', qty: 1, unit_price: 500 }],
  }, 'pm');
  assert.equal(blocked.status, 403);

  const asked = await api('POST', '/api/project-access',
    { project_id: 'RAC', reason: 'ไปช่วยงานเทพื้น V5', days: 7 }, 'pm');
  assert.equal(asked.status, 201, JSON.stringify(asked.body));

  const denied = await api('POST', `/api/project-access/${asked.body.access_id}/decide`,
    { approve: true }, 'pm');
  assert.equal(denied.status, 403, 'PM อนุมัติสิทธิ์ให้ตัวเองไม่ได้');

  const ok = await api('POST', `/api/project-access/${asked.body.access_id}/decide`,
    { approve: true }, 'coo');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  const after = await api('POST', '/api/requests', {
    project_id: 'RAC', building_id: 'B002', vendor_id: 'V003', has_vat: 'ไม่มี',
    lines: [{ cost_code: 'CON', cost_type: 'ของ', qty: 1, unit_price: 500 }],
  }, 'pm');
  assert.equal(after.status, 201, JSON.stringify(after.body));
});

test('v9 — ค้นชื่อพ้องก่อนสร้างอาคาร และตั้งงบจากเส้นโค้งต้นทุน', async () => {
  const found = await api('GET', '/api/building-search?q=R6', undefined, 'coo');
  assert.ok(found.body.matches.some((m) => m.building_id === 'B004'));

  const dup = await api('POST', '/api/buildings',
    { project_id: 'RMT', building_name: 'R6' }, 'coo');
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'DUPLICATE_BUILDING');

  const curve = await api('GET', '/api/cost-curve?floors=1&area_sqm=300&design_code=D-RCH', undefined, 'coo');
  assert.ok(curve.body.estimate.exact_design);
  assert.ok(curve.body.estimate.estimate > 900000 && curve.body.estimate.estimate < 1100000);

  const created = await api('POST', '/api/buildings', {
    project_id: 'RMT', building_name: 'R99 ทดสอบ', floors: 1, area_sqm: 300, design_code: 'D-RCH',
  }, 'coo');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(created.body.building.budget > 0, 'ต้องตั้งงบให้อัตโนมัติจากเส้นโค้งต้นทุน');
});

test('PM เห็นเฉพาะโครงการที่รับผิดชอบ', async () => {
  await login('rabbizgroup011@gmail.com', '0934538117', 'pm');
  const pm = await api('GET', '/api/bootstrap', undefined, 'pm');
  const ceo = await api('GET', '/api/bootstrap', undefined, 'ceo');
  assert.ok(pm.body.projects.length > 0);
  assert.ok(pm.body.projects.length < ceo.body.projects.length,
    'PM ต้องเห็นโครงการน้อยกว่า CEO');
  assert.equal(pm.body.user.sees_all_projects, false);
  assert.equal(ceo.body.user.sees_all_projects, true);
});

test('B8 — หมวดงานที่เลิกใช้ต้องไม่อยู่ใน dropdown และเลือกไม่ได้', async () => {
  const { body } = await api('GET', '/api/bootstrap', undefined, 'pm');
  const codes = body.cost_codes.map((c) => c.cost_code);
  for (const dead of ['LAB', 'MAT', 'COM', 'OTH', 'REN', 'CRN', 'FNL', 'FLL', 'WTL', 'LCO'])
    assert.ok(!codes.includes(dead) || dead === 'OTH', `${dead} ไม่ควรอยู่ใน dropdown`);
  for (const merged of ['PIP', 'WAT', 'GRD', 'EXT', 'COL', 'STL', 'LIT'])
    assert.ok(!codes.includes(merged), `${merged} ถูกยุบรวมแล้ว ไม่ควรอยู่ใน dropdown`);

  const res = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B004', vendor_id: 'V003', has_vat: 'ไม่มี',
    lines: [{ cost_code: 'LAB', cost_type: 'แรง', qty: 1, unit_price: 500 }],
  }, 'pm');
  assert.equal(res.status, 400);
  assert.equal(res.body.errors[0].code, 'B8');
});

test('B1/B2/B3 — หมวดงาน ประเภทต้นทุน โครงการ/อาคาร บังคับกรอก', async () => {
  const noType = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B004', vendor_id: 'V003', has_vat: 'ไม่มี',
    lines: [{ cost_code: 'STE', qty: 1, unit_price: 100 }],
  }, 'pm');
  assert.equal(noType.body.errors[0].code, 'B2');

  const noBuilding = await api('POST', '/api/requests', {
    project_id: 'RMT', vendor_id: 'V003', has_vat: 'ไม่มี',
    lines: [{ cost_code: 'STE', cost_type: 'ของ', qty: 1, unit_price: 100 }],
  }, 'pm');
  assert.equal(noBuilding.body.errors[0].code, 'B3');
});

test('VAT แยก/รวม และหัก ณ ที่จ่ายคำนวณถูกต้อง', async () => {
  // ผู้ขายบุคคลธรรมดา หัก 3% เฉพาะฐานค่าแรง/ค่าเช่า
  const v = await api('POST', '/api/vendors',
    { vendor_name: 'ช่างทดสอบ หัก 3%', entity_type: 'บุคคลธรรมดา' }, 'pm');
  assert.equal(v.status, 201);
  const vendorId = v.body.vendor.vendor_id;
  assert.equal(v.body.vendor.wht_percent, 3);

  const sep = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B004', vendor_id: vendorId,
    has_vat: 'มี', vat_mode: 'แยก VAT',
    lines: [
      { cost_code: 'STE', cost_type: 'ของ', qty: 1, unit_price: 1000 },
      { cost_code: 'STE', cost_type: 'แรง', qty: 1, unit_price: 1000 },
    ],
  }, 'pm');
  assert.equal(sep.status, 201, JSON.stringify(sep.body));
  const s = sep.body.request;
  assert.equal(s.amount_before_vat, 2000);
  assert.equal(s.vat_amount, 140);
  assert.equal(s.total_amount, 2140);
  assert.equal(s.wht_amount, 30);   // 3% ของค่าแรง 1,000 เท่านั้น
  assert.equal(s.net_amount, 2110);

  const inc = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B004', vendor_id: vendorId,
    has_vat: 'มี', vat_mode: 'รวม VAT แล้ว',
    lines: [{ cost_code: 'STE', cost_type: 'แรง', qty: 1, unit_price: 1070 }],
  }, 'pm');
  const i = inc.body.request;
  assert.equal(i.total_amount, 1070);
  assert.equal(i.amount_before_vat, 1000);
  assert.equal(i.vat_amount, 70);
  assert.equal(i.wht_amount, 30);   // ฐานหักคิดจากยอดก่อน VAT
});

test('รหัสอ้างอิงเดิม 10 หลักสร้างอัตโนมัติ', async () => {
  const res = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B004', vendor_id: 'V003', has_vat: 'ไม่มี',
    lines: [{ cost_code: 'ROF', cost_type: 'ของ', qty: 1, unit_price: 900 }],
  }, 'pm');
  assert.equal(res.body.request.legacy_code.length, 10);
  assert.match(res.body.request.legacy_code, /^MRMT/);
});

test('B6 — ใบเกิน 5,000 บาทต้องแนบไฟล์ก่อนส่งขออนุมัติ', async () => {
  const res = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B004', vendor_id: 'V003', has_vat: 'ไม่มี',
    submit: true,
    lines: [{ cost_code: 'STE', cost_type: 'ของ', qty: 1, unit_price: 9000 }],
  }, 'pm');
  assert.equal(res.status, 400);
  assert.equal(res.body.errors[0].code, 'B6');
});

test('W5/W6 — ตรวจรายการซ้ำที่ระดับอาคาร', async () => {
  const payload = {
    project_id: 'RMT', building_id: 'B005', vendor_id: 'V003', has_vat: 'ไม่มี',
    request_date: '2026-09-10',
    lines: [{ cost_code: 'CON', cost_type: 'ของ', qty: 1, unit_price: 4321 }],
  };
  await api('POST', '/api/requests', payload, 'pm');
  const dup = await api('POST', '/api/requests', payload, 'pm');
  const codes = dup.body.flags.map((f) => f.code);
  assert.ok(codes.includes('W5'), `ควรติดธง W5 แต่ได้ ${JSON.stringify(codes)}`);

  const within7 = await api('POST', '/api/requests', { ...payload, request_date: '2026-09-14' }, 'pm');
  assert.ok(within7.body.flags.map((f) => f.code).includes('W6'));

  // อาคารอื่นในโครงการเดียวกัน ยอดเท่ากัน ต้องไม่เตือน (หลักการข้อ 9)
  const otherBuilding = await api('POST', '/api/requests',
    { ...payload, building_id: 'B004' }, 'pm');
  assert.ok(!otherBuilding.body.flags.map((f) => f.code).includes('W5'));
});

test('W9 — ยอดกลมเกิน 20,000 ติดธง', async () => {
  const res = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B013', vendor_id: 'V003', has_vat: 'ไม่มี',
    lines: [{ cost_code: 'FND', cost_type: 'แรง', qty: 1, unit_price: 50000 }],
  }, 'pm');
  assert.ok(res.body.flags.map((f) => f.code).includes('W9'));
});

test('เส้นทางเต็ม: ร่าง → รออนุมัติ → อนุมัติ → จ่าย → เอกสารครบ → ปิดรายการ', async () => {
  await login('rabbizgroup004@gmail.com', '0964040444', 'coo');   // กร COO
  await login('rabbizgroup003@gmail.com', '0625599000', 'fin');   // ตั้ม การเงิน
  await login('rabbizgroup002@gmail.com', '0819595500', 'acc');   // พี่หน่อย บัญชี

  const created = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B018', vendor_id: 'V001',
    has_vat: 'มี', vat_mode: 'แยก VAT', note: 'ทดสอบเส้นทางเต็ม',
    lines: [{ cost_code: 'STE', cost_type: 'ของ', qty: 10, unit_price: 200, unit: 'เส้น', description: 'เหล็ก' }],
  }, 'pm');
  assert.equal(created.status, 201);
  const id = created.body.request.request_id;
  assert.equal(created.body.request.status, 'ร่าง');

  const submitted = await api('POST', `/api/requests/${id}/submit`, {}, 'pm');
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.request.status, 'รออนุมัติ');

  // การเงินอนุมัติไม่ได้
  const wrongRole = await api('POST', `/api/requests/${id}/approve`, {}, 'fin');
  assert.equal(wrongRole.status, 403);

  const approved = await api('POST', `/api/requests/${id}/approve`, { acknowledge_flags: true }, 'coo');
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.request.status, 'อนุมัติแล้ว');
  assert.ok(approved.body.request.approval_seconds !== null);

  // B7 — จ่ายโดยไม่แนบสลิปไม่ได้
  const noSlip = await api('POST', '/api/payments', { request_id: id }, 'fin');
  assert.equal(noSlip.status, 400);
  assert.equal(noSlip.body.code, 'B7');

  const fd = new FormData();
  fd.append('files', new Blob(['slip-image-bytes'], { type: 'image/png' }), 'slip.png');
  fd.append('purpose', 'สลิปการโอน');
  const uploaded = await api('POST', `/api/requests/${id}/attachments`, fd, 'fin');
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const slipId = uploaded.body.files[0].file_id;

  const paid = await api('POST', '/api/payments', {
    request_id: id, payment_date: '2026-09-20', bank_account: 'กสิกร x1234',
    slip_file_id: slipId, transfer_ref: id,
  }, 'fin');
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  assert.equal(paid.body.request.status, 'จ่ายแล้ว');
  assert.equal(paid.body.request.documents.length, 3);   // ใบส่งของ + ใบเสร็จ + ใบกำกับภาษี

  // B9 — ยอดใบที่จ่ายแล้วแก้ไม่ได้
  const frozen = await api('PUT', `/api/requests/${id}`, {
    lines: [{ cost_code: 'STE', cost_type: 'ของ', qty: 10, unit_price: 999 }],
  }, 'pm');
  assert.equal(frozen.status, 403);

  // แก้ข้อมูลประกอบได้ แต่ต้องมีเหตุผลและลง audit_log
  const noReason = await api('PATCH', `/api/requests/${id}/meta`, { note: 'แก้โดยไม่บอกเหตุผล' }, 'acc');
  assert.equal(noReason.status, 400);
  const withReason = await api('PATCH', `/api/requests/${id}/meta`,
    { note: 'ย้ายหมายเหตุ', reason: 'พิมพ์ผิด' }, 'acc');
  assert.equal(withReason.status, 200);
  const log = await api('GET', `/api/audit?table=requests&record=${id}`, undefined, 'ceo');
  assert.ok(log.body.log.some((l) => l.field_name === 'note' && l.reason === 'พิมพ์ผิด'));

  // ปิดรายการต้องครบทั้งของและเอกสาร
  const tooEarly = await api('POST', `/api/requests/${id}/close`, {}, 'acc');
  assert.equal(tooEarly.status, 400);

  await api('POST', `/api/requests/${id}/goods-received`, { received: true, date: '2026-09-22' }, 'pm');
  for (const [docType, docDate] of [['ใบส่งของ', '2026-09-22'], ['ใบเสร็จรับเงิน', '2026-09-25'],
    ['ใบกำกับภาษี', '2026-09-30']]) {
    const d = await api('POST', `/api/requests/${id}/documents`,
      { doc_type: docType, received: true, doc_date: docDate, received_date: '2026-10-05', doc_no: 'X1' }, 'acc');
    assert.equal(d.status, 200, JSON.stringify(d.body));
  }
  const final = await api('GET', `/api/requests/${id}`, undefined, 'acc');
  assert.equal(final.body.request.status, 'ปิดรายการ');
  // เดือนภาษีต้องมาจากวันที่บนใบกำกับ ไม่ใช่วันที่ได้รับ
  const vatDoc = final.body.request.documents.find((d) => d.doc_type === 'ใบกำกับภาษี');
  assert.equal(vatDoc.tax_period, '2026-09');
  assert.equal(vatDoc.received_date, '2026-10-05');
});

test('อนุมัติหลายใบพร้อมกันได้เฉพาะใบที่ไม่มีธง', async () => {
  const clean = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B028', vendor_id: 'V001', has_vat: 'ไม่มี', submit: true,
    lines: [{ cost_code: 'ROF', cost_type: 'ของ', qty: 3, unit_price: 411 }],
  }, 'pm');
  // ใบเกิน 5,000 ต้องแนบไฟล์ก่อน (B6) จึงจะส่งขออนุมัติได้
  const fd = new FormData();
  fd.append('files', new Blob(['photo'], { type: 'image/png' }), 'site.png');
  const att = await api('POST', '/api/requests/new/attachments', fd, 'pm');
  const flagged = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B028', vendor_id: 'V001', has_vat: 'ไม่มี', submit: true,
    attachment_ids: [att.body.files[0].file_id],
    lines: [{ cost_code: 'ROF', cost_type: 'ของ', qty: 1, unit_price: 25000 }],   // W9
  }, 'pm');
  assert.equal(flagged.status, 201, JSON.stringify(flagged.body));
  assert.equal(clean.body.flags.length, 0, JSON.stringify(clean.body.flags));
  assert.ok(flagged.body.flags.length > 0);

  const bulk = await api('POST', '/api/requests/bulk-approve', {
    request_ids: [clean.body.request.request_id, flagged.body.request.request_id],
  }, 'coo');
  assert.deepEqual(bulk.body.approved, [clean.body.request.request_id]);
  assert.equal(bulk.body.skipped[0].requires_ack, true);
});

test('W7 — ใบของผู้อนุมัติเองติดธงและนับแยก', async () => {
  const own = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B004', vendor_id: 'V001', has_vat: 'ไม่มี', submit: true,
    lines: [{ cost_code: 'FLR', cost_type: 'ของ', qty: 1, unit_price: 1234 }],
  }, 'coo');
  const id = own.body.request.request_id;
  const first = await api('POST', `/api/requests/${id}/approve`, {}, 'coo');
  assert.equal(first.status, 409);
  assert.ok(first.body.flags.some((f) => f.code === 'W7'));
  const second = await api('POST', `/api/requests/${id}/approve`, { acknowledge_flags: true }, 'coo');
  assert.equal(second.status, 200);
  const report = await api('GET', '/api/reports/by-requester', undefined, 'ceo');
  assert.ok(report.body.rows.some((x) => x.self_approved_count > 0));
});

test('W4 — ใบกลับรายการสร้างเครดิตค้างและเด้งเตือนครั้งถัดไป', async () => {
  const created = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B005', vendor_id: 'V002', has_vat: 'ไม่มี', submit: true,
    lines: [{ cost_code: 'ROF', cost_type: 'ของ', qty: 1, unit_price: 3500 }],
  }, 'pm');
  const id = created.body.request.request_id;
  await api('POST', `/api/requests/${id}/approve`, { acknowledge_flags: true }, 'coo');
  const fd = new FormData();
  fd.append('files', new Blob(['slip'], { type: 'image/png' }), 'slip2.png');
  const up = await api('POST', `/api/requests/${id}/attachments`, fd, 'fin');
  await api('POST', '/api/payments',
    { request_id: id, slip_file_id: up.body.files[0].file_id, payment_date: '2026-09-21' }, 'fin');

  const rev = await api('POST', `/api/requests/${id}/reversals`, {
    reversal_type: 'ของไม่ครบ', amount: 500, reason: 'ส่งของขาด 2 แผ่น',
    destination: 'หักกลบบิลหน้า',
  }, 'fin');
  assert.equal(rev.status, 201, JSON.stringify(rev.body));

  const credits = await api('GET', '/api/vendor-credits', undefined, 'fin');
  assert.ok(credits.body.outstanding >= 500);

  const next = await api('POST', '/api/requests', {
    project_id: 'RMT', building_id: 'B005', vendor_id: 'V002', has_vat: 'ไม่มี',
    lines: [{ cost_code: 'ROF', cost_type: 'ของ', qty: 1, unit_price: 777 }],
  }, 'pm');
  assert.ok(next.body.flags.some((f) => f.code === 'W4'), JSON.stringify(next.body.flags));
});

test('คนสร้างผู้ขายกับคนยืนยันต้องไม่ใช่คนเดียวกัน', async () => {
  const v = await api('POST', '/api/vendors', { vendor_name: 'ร้านทดสอบยืนยัน' }, 'coo');
  const self = await api('POST', `/api/vendors/${v.body.vendor.vendor_id}/verify`, {}, 'coo');
  assert.equal(self.status, 403);
  const other = await api('POST', `/api/vendors/${v.body.vendor.vendor_id}/verify`, {}, 'acc');
  assert.equal(other.status, 200);
  assert.equal(other.body.vendor.doc_status, 'ยืนยันแล้ว');
});

test('เงินสดย่อย: ต่อรายการไม่เกิน 2,000 และต้องเคลียร์บิลก่อนเติม', async () => {
  const acc = await api('POST', '/api/petty-cash/accounts',
    { project_id: 'RMT', holder_id: 'M', ceiling: 10000 }, 'fin');
  const pcId = acc.body.pc_id;
  const top = await api('POST', `/api/petty-cash/${pcId}/entries`,
    { entry_type: 'เติมเงิน', amount: 10000 }, 'fin');
  assert.equal(top.status, 201);
  const tooBig = await api('POST', `/api/petty-cash/${pcId}/entries`,
    { entry_type: 'ใช้จ่าย', amount: 2500 }, 'fin');
  assert.equal(tooBig.body.code, 'B10');
  await api('POST', `/api/petty-cash/${pcId}/entries`, { entry_type: 'ใช้จ่าย', amount: 1500 }, 'fin');
  const refill = await api('POST', `/api/petty-cash/${pcId}/entries`,
    { entry_type: 'เติมเงิน', amount: 1500 }, 'fin');
  assert.equal(refill.status, 400);
  assert.match(refill.body.error, /เคลียร์บิล/);
});

test('รายงาน: ต้นทุนต่อ ตร.ม. จัดกลุ่มตาม design_code เท่านั้น', async () => {
  const { body } = await api('GET', '/api/reports/cost-per-sqm', undefined, 'ceo');
  assert.ok(body.groups.length > 0);
  for (const g of body.groups)
    for (const b of g.buildings) assert.ok(b.cost_per_sqm > 0);
  const rch = body.groups.find((g) => g.design_code === 'D-RCH');
  assert.ok(rch && rch.buildings.length > 1 && rch.comparable);
});

test('รายงาน: BOQ เทียบจ่ายจริง และอาคารที่เงียบไปแล้ว', async () => {
  const boq = await api('GET', '/api/reports/boq-vs-actual', undefined, 'ceo');
  assert.ok(boq.body.rows.length > 0);
  assert.ok(boq.body.rows.every((x) => x.progress_pct === null || x.progress_pct >= 0));
  const silent = await api('GET', '/api/reports/silent-buildings?days=45', undefined, 'ceo');
  assert.ok(Array.isArray(silent.body.rows));
});

test('ส่งออก CSV กลับเป็น Excel ได้ และ audit_log จำกัดเฉพาะ CEO', async () => {
  const csv = await fetch(BASE + '/api/reports/export/requests.csv', {
    headers: { Cookie: cookies.get('ceo') },
  });
  assert.equal(csv.status, 200);
  const bytes = new Uint8Array(await csv.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF],
    'ต้องมี BOM เพื่อให้ Excel อ่านภาษาไทยได้');
  const text = new TextDecoder('utf-8').decode(bytes);
  assert.ok(text.split('\r\n').length > 1400);

  const denied = await fetch(BASE + '/api/reports/export/audit_log.csv', {
    headers: { Cookie: cookies.get('pm') },
  });
  assert.equal(denied.status, 403);
});

test('PM เข้าถึงใบเบิกนอกโครงการตัวเองไม่ได้', async () => {
  const ceoList = await api('GET', '/api/requests?project_id=BRM&per_page=1', undefined, 'ceo');
  const target = ceoList.body.requests[0];
  assert.ok(target, 'ต้องมีใบเบิกของ BRM ในข้อมูลนำเข้า');
  const pmProjects = (await api('GET', '/api/bootstrap', undefined, 'pm')).body.projects.map((p) => p.project_id);
  if (!pmProjects.includes('BRM')) {
    const denied = await api('GET', `/api/requests/${target.request_id}`, undefined, 'pm');
    assert.equal(denied.status, 403);
  }
});

test('ข้อมูลนำเข้าย้อนหลังกรองแยกออกจากข้อมูลใหม่ได้', async () => {
  const imported = await api('GET', '/api/requests?value_source=นำเข้าย้อนหลัง&per_page=1', undefined, 'ceo');
  const fresh = await api('GET', '/api/requests?value_source=ข้อเท็จจริง&per_page=1', undefined, 'ceo');
  assert.equal(imported.body.total_count, 1449);
  assert.ok(fresh.body.total_count > 0);
  assert.equal(imported.body.total_amount, 15153287.91);
});
