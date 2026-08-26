/**
 * ฝังข้อมูลตั้งต้นลงในหน้าเดโม `demo/index.html`
 *
 * หน้าเดโมเป็นไฟล์เดียวจบ ไม่มีเซิร์ฟเวอร์ ไม่มีฐานข้อมูล — เปิดจากไฟล์ก็ทำงาน
 * มีไว้ให้คนที่ยังไม่ได้ติดตั้งอะไรเลยได้กดดูว่าระบบหน้าตาเป็นอย่างไรและทำงานยังไง
 *
 *   node tools/build_demo.mjs
 *
 * สคริปต์นี้แทนที่เฉพาะก้อน JSON ระหว่าง <script id="seed"> … </script>
 * ส่วน HTML/CSS/JS แก้ตรงไฟล์ demo/index.html ได้ตามปกติ
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const seed = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seed', `${name}.json`), 'utf8'));

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pick = (row, fields) => Object.fromEntries(fields.map((f) => [f, row[f]]));

// ---------------------------------------------------------------- ข้อมูลอ้างอิง
const users = seed('users')
  .filter((u) => u.status === 'ใช้งาน')
  .map((u) => pick(u, ['user_id', 'display_name', 'title', 'role']));

const projects = seed('projects')
  .filter((p) => p.status !== 'เลิกใช้')
  .map((p) => ({ ...pick(p, ['project_id', 'project_name', 'project_type']), group: p.is_group_asset ? 1 : 0 }));

const buildings = seed('buildings').map((b) => ({
  ...pick(b, ['building_id', 'project_id', 'building_name', 'design_code', 'work_nature']),
  area: b.area_sqm || null,
  budget: b.budget || null,
}));

const vendors = seed('vendors').map((v) => ({
  ...pick(v, ['vendor_id', 'vendor_name', 'category', 'entity_type']),
  wht: Number(v.wht_percent || 0),
  staff: v.is_own_staff ? 1 : 0,
}));

/** เฉพาะหมวดงานที่ยังใช้ต่อ — หมวดที่เลิกใช้/ยุบรวมไม่ควรโผล่ใน dropdown (กฎ B8) */
const costCodes = seed('cost_codes')
  .filter((c) => c.status === 'ใช้ต่อ')
  .map((c) => ({ ...pick(c, ['cost_code', 'cost_name', 'work_group']), dtype: c.default_cost_type || null }))
  .sort((a, b) => a.work_group.localeCompare(b.work_group, 'th') || a.cost_name.localeCompare(b.cost_name, 'th'));

const userProjects = seed('user_projects').reduce((acc, r) => {
  (acc[r.user_id] ||= []).push(r.project_id);
  return acc;
}, {});

// ---------------------------------------------------------------- ใบเบิกย้อนหลัง
const linesByRequest = seed('legacy_request_lines').reduce((acc, l) => {
  (acc[l.request_id] ||= []).push([
    l.cost_code, l.cost_type, l.description || '', round2(l.qty), l.unit || '',
    round2(l.unit_price), round2(l.line_amount),
  ]);
  return acc;
}, {});

const requests = seed('legacy_requests').map((r) => ({
  id: r.request_id,
  date: r.request_date,
  by: r.requester_id,
  proj: r.project_id,
  bld: r.building_id,
  ven: r.vendor_id,
  payee: r.payee_name_raw || '',
  vat: r.has_vat,
  before: round2(r.amount_before_vat),
  vatAmt: round2(r.vat_amount),
  amt: round2(r.total_amount),
  net: round2(r.net_amount),
  wht: round2(r.wht_amount),
  status: r.status,
  staff: r.paid_to_staff ? 1 : 0,
  self: r.self_paid ? 1 : 0,
  note: r.note || '',
  lines: linesByRequest[r.request_id] || [],
}));

const bundle = {
  generated_from: 'data/seed/*.json (RABBiZBuild_v9_1.xlsx)',
  users, projects, buildings, vendors, cost_codes: costCodes, user_projects: userProjects, requests,
};

const file = path.join(ROOT, 'demo', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const OPEN = '<script id="seed" type="application/json">';
const CLOSE = '</script>';
const start = html.indexOf(OPEN);
if (start < 0) throw new Error('ไม่พบ <script id="seed"> ใน demo/index.html');
const from = start + OPEN.length;
const to = html.indexOf(CLOSE, from);

const json = JSON.stringify(bundle);
if (json.includes('</script')) throw new Error('ข้อมูลมีสตริงที่ปิดแท็ก script ได้ — ต้อง escape ก่อน');
fs.writeFileSync(file, html.slice(0, from) + json + html.slice(to));

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`ฝังข้อมูลลง demo/index.html แล้ว — ${kb(json.length)}`);
console.log(`  ใบเบิก ${requests.length.toLocaleString('th-TH')} ใบ · รายการย่อย ` +
  `${Object.values(linesByRequest).reduce((s, l) => s + l.length, 0).toLocaleString('th-TH')} บรรทัด`);
console.log(`  โครงการ ${projects.length} · อาคาร ${buildings.length} · ผู้ขาย ${vendors.length} · ` +
  `หมวดงาน ${costCodes.length} · ผู้ใช้ ${users.length}`);
console.log(`  ขนาดไฟล์รวม ${kb(fs.statSync(file).size)}`);
