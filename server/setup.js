/**
 * ติดตั้งฐานข้อมูล: สร้างตาราง + นำเข้าข้อมูลตั้งต้นจาก data/seed/*.json
 *   node server/setup.js           ← สร้าง/เติมข้อมูลที่ยังไม่มี (ปลอดภัย รันซ้ำได้)
 *   node server/setup.js --reset   ← ลบฐานเดิมทิ้งแล้วสร้างใหม่ทั้งหมด
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, migrate, ROOT, setSetting, getSetting, round2 } from './db.js';
import { hashPassword } from './auth.js';
import { legacyCode } from './rules.js';

const SEED = path.join(ROOT, 'data', 'seed');
const read = (name) => JSON.parse(fs.readFileSync(path.join(SEED, name + '.json'), 'utf8'));
const RESET = process.argv.includes('--reset');

// วันตัดข้อมูลเข้าผังใหม่ (สเปก §10)
const CUTOVER_DATE = '2026-09-01';

function resetDb() {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  db.pragma('foreign_keys = OFF');
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  db.pragma('foreign_keys = ON');
  console.log(`ลบตารางเดิม ${tables.length} ตาราง`);
}

const insert = (table, rows, cols) => {
  if (!rows.length) return 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  const many = db.transaction((list) => {
    let n = 0;
    for (const r of list) n += stmt.run(cols.map((c) => (r[c] === undefined ? null : r[c]))).changes;
    return n;
  });
  return many(rows);
};

function seedCostTypes() {
  const rows = [
    { cost_type: 'ของ', label: 'ค่าของ / ค่าวัสดุ', sort_order: 1, selectable: 1, wht_base: 0 },
    { cost_type: 'แรง', label: 'ค่าแรง', sort_order: 2, selectable: 1, wht_base: 1 },
    { cost_type: 'เช่า', label: 'ค่าเช่า / ค่าเครื่องจักร', sort_order: 3, selectable: 1, wht_base: 1 },
    { cost_type: 'โสหุ้ย', label: 'ค่าโสหุ้ย', sort_order: 4, selectable: 1, wht_base: 0 },
    { cost_type: 'ไม่ระบุ', label: 'ไม่ระบุ (เฉพาะข้อมูลนำเข้าย้อนหลัง)', sort_order: 9, selectable: 0, wht_base: 0 },
  ];
  return insert('cost_types', rows, ['cost_type', 'label', 'sort_order', 'selectable', 'wht_base']);
}

function seedUsers() {
  const users = read('users');
  const temp = [];
  const rows = users.map((u) => {
    // รหัสผ่านครั้งแรก = เบอร์โทร (สเปก §3.2) · บังคับเปลี่ยนทันทีที่ล็อกอินครั้งแรก
    const initial = u.phone || `changeme-${u.user_id}`;
    if (!u.phone) temp.push(`${u.user_id} ${u.display_name} → ${initial} (บัญชีถูกระงับไว้ รอ CEO กรอกอีเมล/เบอร์จริงแล้วเปิดใช้งาน)`);
    return { ...u, password_hash: hashPassword(initial) };
  });
  const n = insert('users', rows, ['user_id', 'display_name', 'full_name', 'title', 'role',
    'username', 'password_hash', 'phone', 'require_2fa', 'status', 'note']);
  if (temp.length) console.log('  รหัสผ่านชั่วคราว (ไม่มีเบอร์โทรในฐาน v8): ' + temp.join(' · '));
  return n;
}

function seedBuildingPairs() {
  const rows = read('building_pairs').map((p) => {
    const pick = (label) => (String(label).match(/B\d{3}/) || [])[0] || null;
    return { ...p, building_a: pick(p.label_a), building_b: pick(p.label_b) };
  });
  return insert('building_pairs', rows, ['pair_id', 'label_a', 'label_b', 'building_a',
    'building_b', 'project_id', 'same_amount_count', 'status', 'note']);
}

/** PM/SERVICE เห็นเฉพาะโครงการที่ตัวเองรับผิดชอบ — เดาจากประวัติการเบิกใน v8 */
function seedUserProjects(legacyReqs) {
  const roles = Object.fromEntries(db.prepare('SELECT user_id, role FROM users').all()
    .map((r) => [r.user_id, r.role]));
  const projects = new Set(db.prepare('SELECT project_id FROM projects').all().map((r) => r.project_id));
  const pairs = new Set();
  for (const r of legacyReqs) {
    if (!['PM', 'SERVICE'].includes(roles[r.requester_id])) continue;
    if (!projects.has(r.project_id)) continue;
    pairs.add(`${r.requester_id}|${r.project_id}`);
  }
  const rows = [...pairs].map((k) => {
    const [user_id, project_id] = k.split('|');
    return { user_id, project_id };
  });
  return insert('user_projects', rows, ['user_id', 'project_id']);
}

function seedLegacyRequests() {
  const reqs = read('legacy_requests');
  const lines = read('legacy_request_lines');
  const bldName = Object.fromEntries(
    db.prepare('SELECT building_id, building_name FROM buildings').all()
      .map((b) => [b.building_id, b.building_name]));
  const byReq = new Map();
  for (const l of lines) {
    if (!byReq.has(l.request_id)) byReq.set(l.request_id, []);
    byReq.get(l.request_id).push(l);
  }
  const reqRows = reqs.map((r) => ({
    ...r,
    legacy_code: legacyCode({
      requesterId: r.requester_id, projectId: r.project_id,
      buildingName: bldName[r.building_id] || r.building_id,
      costCode: (byReq.get(r.request_id) || [{}])[0].cost_code || 'OTH',
    }),
  }));
  const n1 = insert('requests', reqRows, ['request_id', 'legacy_txn_id', 'request_date',
    'requester_id', 'project_id', 'building_id', 'vendor_id', 'payee_name_raw', 'has_vat',
    'vat_mode', 'amount_before_vat', 'vat_amount', 'total_amount', 'wht_amount', 'net_amount',
    'status', 'legacy_code', 'confidence', 'value_source', 'note']);

  const lineRows = [];
  for (const [rid, ls] of byReq) ls.forEach((l, i) => lineRows.push({ ...l, line_no: i + 1 }));
  const n2 = insert('request_lines', lineRows, ['request_id', 'line_no', 'cost_code', 'cost_type',
    'description', 'qty', 'unit', 'unit_price', 'line_amount', 'confidence']);
  return [n1, n2, reqs];
}

function main() {
  if (RESET) resetDb();
  migrate();
  console.log('สร้างตารางเรียบร้อย\n');

  const report = [];
  report.push(['cost_types', seedCostTypes()]);
  report.push(['users', seedUsers()]);
  report.push(['projects', insert('projects', read('projects'),
    ['project_id', 'project_name', 'nature', 'is_real_project', 'note', 'status'])]);
  report.push(['designs', insert('designs', read('designs'),
    ['design_code', 'design_name', 'floors', 'std_area_sqm', 'structure', 'ref_cost_per_sqm', 'status', 'note'])]);
  report.push(['buildings', insert('buildings', read('buildings'),
    ['building_id', 'project_id', 'building_name', 'design_code', 'work_nature', 'status',
     'area_sqm', 'floors', 'is_building', 'budget', 'value_source', 'note'])]);
  report.push(['cost_codes', insert('cost_codes', read('cost_codes'),
    ['cost_code', 'cost_name', 'work_group', 'group_order', 'status', 'merge_into', 'default_cost_type', 'note'])]);
  report.push(['vendors', insert('vendors', read('vendors'),
    ['vendor_id', 'vendor_name', 'vendor_type', 'category', 'phone', 'entity_type', 'tax_id',
     'bank_account', 'payment_terms', 'vat_registered', 'wht_percent', 'doc_status', 'status'])]);
  report.push(['items', insert('items', read('items'),
    ['item_id', 'category', 'item_name', 'unit', 'ref_price_min', 'ref_price_max', 'vendor_count', 'status'])]);
  report.push(['item_prices', insert('item_prices', read('item_prices'),
    ['price_id', 'item_id', 'vendor_id', 'unit_price', 'unit', 'source_note', 'is_cheapest'])]);
  report.push(['rates', insert('rates', read('rates'),
    ['rate_id', 'cost_type', 'rate_name', 'unit', 'rate_satoshi', 'rate_goldy', 'std_rate', 'method', 'status'])]);
  report.push(['building_pairs', seedBuildingPairs()]);
  report.push(['funding_in', insert('funding_in', read('funding_in'),
    ['funding_id', 'funding_date', 'amount', 'company', 'source', 'accounting_status', 'period_label', 'value_source'])]);
  report.push(['boq_register', insert('boq_register', read('boq_register'),
    ['boq_id', 'title', 'version', 'received_date', 'source_file', 'boq_value', 'author', 'status'])]);
  report.push(['boq_buildings', insert('boq_buildings',
    read('boq_buildings').filter((b) => db.prepare('SELECT 1 FROM buildings WHERE building_id = ?').get(b.building_id)),
    ['boq_id', 'building_id', 'boq_budget', 'status', 'note'])]);

  const [nReq, nLine, legacyReqs] = seedLegacyRequests();
  report.push(['requests (นำเข้าย้อนหลัง)', nReq]);
  report.push(['request_lines', nLine]);
  report.push(['user_projects', seedUserProjects(legacyReqs)]);

  // งบตาม BOQ → งบอาคาร (ใช้กับกฎเตือน W8)
  db.prepare(`UPDATE buildings SET budget = (
      SELECT boq_budget FROM boq_buildings WHERE boq_buildings.building_id = buildings.building_id)
    WHERE budget IS NULL AND building_id IN (SELECT building_id FROM boq_buildings WHERE boq_budget > 0)`).run();

  if (getSetting('cutover_date') === null) setSetting('cutover_date', CUTOVER_DATE);
  if (getSetting('flag_W2_enabled') === null) setSetting('flag_W2_enabled', '0'); // §12 ปิดสวิตช์ไว้ก่อน
  if (getSetting('company_name') === null) setSetting('company_name', 'RABBiZ Group');

  console.log('นำเข้าข้อมูล:');
  for (const [name, n] of report) console.log(`  ${name.padEnd(26)} ${String(n).padStart(6)} แถว`);

  const sum = db.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS s FROM requests WHERE value_source = 'นำเข้าย้อนหลัง'").get();
  console.log(`\nใบเบิกนำเข้าย้อนหลัง ${sum.n.toLocaleString('th-TH')} ใบ · ${round2(sum.s).toLocaleString('th-TH')} บาท`);
  console.log(`วันตัดข้อมูล ${getSetting('cutover_date')} · กฎเตือน W2 ${getSetting('flag_W2_enabled') === '1' ? 'เปิด' : 'ปิด'}`);
  console.log('\nรหัสผ่านครั้งแรกของทุกคน = เบอร์โทรศัพท์ · ระบบจะบังคับเปลี่ยนทันทีที่ล็อกอินครั้งแรก');
}

main();
