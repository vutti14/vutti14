import { Router } from 'express';
import { db, audit, getSetting } from '../db.js';
import { requireAuth, requireCap, can, allowedProjectIds, seesAllProjects } from '../auth.js';
import { estimateBudget } from '../rules.js';

const r = Router();
r.use(requireAuth);

/** ข้อมูลตั้งต้นทั้งหมดที่หน้าจอต้องใช้ — ยิงครั้งเดียวตอนเปิดแอป */
r.get('/bootstrap', (req, res) => {
  const allowed = allowedProjectIds(req.user);
  const projects = allowed === null
    ? db.prepare('SELECT * FROM projects ORDER BY is_real_project DESC, project_name').all()
    : db.prepare(`SELECT * FROM projects WHERE project_id IN (${allowed.map(() => '?').join(',') || "''"})
                  ORDER BY is_real_project DESC, project_name`).all(...allowed);
  const projectIds = projects.map((p) => p.project_id);
  const q = projectIds.map(() => '?').join(',') || "''";

  res.json({
    user: {
      user_id: req.user.user_id, display_name: req.user.display_name, role: req.user.role,
      title: req.user.title, sees_all_projects: seesAllProjects(req.user),
      last_project_id: req.user.last_project_id, last_building_id: req.user.last_building_id,
    },
    caps: {
      create_request: can(req.user, 'request.create'),
      approve: can(req.user, 'request.approve'),
      pay: can(req.user, 'payment.create'),
      documents: can(req.user, 'document.manage'),
      vendor_create: can(req.user, 'vendor.create'),
      vendor_verify: can(req.user, 'vendor.verify'),
      goods_confirm: can(req.user, 'goods.confirm'),
      funding: can(req.user, 'funding.read') || req.user.role === 'CEO',
      admin: req.user.role === 'CEO',
      reversal: can(req.user, 'reversal.create'),
      petty_cash: can(req.user, 'pettycash.manage'),
    },
    projects,
    buildings: db.prepare(`SELECT b.*, d.design_name FROM buildings b
        LEFT JOIN designs d ON d.design_code = b.design_code
        WHERE b.project_id IN (${q}) ORDER BY b.project_id, b.building_name`).all(...projectIds),
    designs: db.prepare('SELECT * FROM designs ORDER BY status, design_code').all(),
    // §6.1 B8 — รหัสที่เลิกใช้/ยุบรวมต้องไม่ปรากฏใน dropdown
    cost_codes: db.prepare("SELECT * FROM cost_codes WHERE status = 'ใช้ต่อ' ORDER BY group_order, cost_code").all(),
    cost_codes_all: db.prepare('SELECT * FROM cost_codes ORDER BY group_order, cost_code').all(),
    cost_types: db.prepare('SELECT * FROM cost_types WHERE selectable = 1 ORDER BY sort_order').all(),
    vendors: db.prepare("SELECT * FROM vendors WHERE status = 'ใช้งาน' ORDER BY vendor_name").all(),
    items: db.prepare("SELECT * FROM items WHERE status = 'ใช้งาน' ORDER BY category, item_name").all(),
    users: db.prepare('SELECT user_id, display_name, role, title, status FROM users ORDER BY user_id').all(),
    // โครงการที่ยังไม่มีสิทธิ์ — ใช้กับปุ่มขอสิทธิ์ชั่วคราว (v9 §21)
    other_projects: allowed === null ? [] : db.prepare(
      `SELECT project_id, project_name, project_type FROM projects
       WHERE project_id NOT IN (${projectIds.map(() => '?').join(',') || "''"})
         AND status = 'ใช้งาน' ORDER BY project_name`).all(...projectIds),
    pending_access: db.prepare(
      `SELECT project_id, status FROM project_access_requests
       WHERE user_id = ? AND status = 'รออนุมัติ'`).all(req.user.user_id),
    settings: {
      cutover_date: getSetting('cutover_date'),
      flag_W2_enabled: getSetting('flag_W2_enabled') === '1',
      company_name: getSetting('company_name'),
      photo_required_above: 5000,
      petty_cash_line_max: 2000,
    },
  });
});

// ---------------------------------------------------------------- ผู้ขาย
r.get('/vendors', (req, res) => {
  const rows = db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM requests q WHERE q.vendor_id = v.vendor_id) AS request_count,
      (SELECT COALESCE(SUM(q.total_amount),0) FROM requests q
        WHERE q.vendor_id = v.vendor_id AND q.status IN ('จ่ายแล้ว','ปิดรายการ')) AS paid_total,
      (SELECT COALESCE(SUM(c.amount - c.used_amount),0) FROM vendor_credits c
        WHERE c.vendor_id = v.vendor_id AND c.status = 'คงเหลือ') AS credit_balance,
      cu.display_name AS created_by_name, vu.display_name AS verified_by_name
    FROM vendors v
    LEFT JOIN users cu ON cu.user_id = v.created_by
    LEFT JOIN users vu ON vu.user_id = v.verified_by
    ORDER BY v.vendor_name`).all();
  res.json({ vendors: rows });
});

r.post('/vendors', requireCap('vendor.create'), (req, res) => {
  const b = req.body || {};
  const name = String(b.vendor_name || '').trim();
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ขาย' });
  const dup = db.prepare('SELECT vendor_id FROM vendors WHERE vendor_name = ?').get(name);
  if (dup) return res.status(409).json({ error: `มีผู้ขายชื่อนี้แล้ว (${dup.vendor_id})`, vendor_id: dup.vendor_id });

  const last = db.prepare("SELECT vendor_id FROM vendors WHERE vendor_id LIKE 'V%' ORDER BY vendor_id DESC LIMIT 1").get();
  const id = 'V' + String((last ? parseInt(last.vendor_id.slice(1), 10) : 0) + 1).padStart(3, '0');
  const entity = b.entity_type === 'บุคคลธรรมดา' ? 'บุคคลธรรมดา' : 'นิติบุคคล';
  db.prepare(`INSERT INTO vendors
    (vendor_id, vendor_name, vendor_type, category, phone, entity_type, tax_id, bank_account,
     payment_terms, vat_registered, wht_percent, doc_status, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, 'รอตรวจเอกสาร', ?)`)
    .run(id, name, b.vendor_type || '', b.category || '', b.phone || '', entity,
         b.tax_id || '', b.bank_account || '', b.payment_terms || '',
         b.vat_registered ? 1 : 0,
         b.wht_percent != null ? Number(b.wht_percent) : (entity === 'บุคคลธรรมดา' ? 3 : 0),
         req.user.user_id);
  audit({ table: 'vendors', recordId: id, action: 'สร้าง', userId: req.user.user_id, newValue: name });
  res.status(201).json({ vendor: db.prepare('SELECT * FROM vendors WHERE vendor_id = ?').get(id) });
});

r.patch('/vendors/:id', requireCap('vendor.create'), (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE vendor_id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'ไม่พบผู้ขาย' });
  const fields = ['vendor_name', 'vendor_type', 'category', 'phone', 'entity_type', 'tax_id',
                  'bank_account', 'payment_terms', 'vat_registered', 'wht_percent', 'status'];
  for (const f of fields) {
    if (req.body?.[f] === undefined) continue;
    const val = ['vat_registered'].includes(f) ? (req.body[f] ? 1 : 0) : req.body[f];
    if (String(v[f]) === String(val)) continue;
    db.prepare(`UPDATE vendors SET ${f} = ? WHERE vendor_id = ?`).run(val, v.vendor_id);
    audit({ table: 'vendors', recordId: v.vendor_id, field: f, oldValue: v[f], newValue: val,
            userId: req.user.user_id, reason: req.body?.reason || '' });
  }
  res.json({ vendor: db.prepare('SELECT * FROM vendors WHERE vendor_id = ?').get(v.vendor_id) });
});

/** §3.3 คนสร้าง vendor กับคนยืนยันต้องไม่ใช่คนเดียวกัน */
r.post('/vendors/:id/verify', requireCap('vendor.verify'), (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE vendor_id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'ไม่พบผู้ขาย' });
  if (v.created_by && v.created_by === req.user.user_id)
    return res.status(403).json({ error: 'คนสร้างผู้ขายกับคนยืนยันต้องไม่ใช่คนเดียวกัน' });
  db.prepare("UPDATE vendors SET doc_status = 'ยืนยันแล้ว', verified_by = ?, verified_at = datetime('now') WHERE vendor_id = ?")
    .run(req.user.user_id, v.vendor_id);
  audit({ table: 'vendors', recordId: v.vendor_id, field: 'doc_status', oldValue: v.doc_status,
          newValue: 'ยืนยันแล้ว', action: 'ยืนยันผู้ขาย', userId: req.user.user_id });
  res.json({ vendor: db.prepare('SELECT * FROM vendors WHERE vendor_id = ?').get(v.vendor_id) });
});

// ---------------------------------------------------------------- วัสดุ / ราคา / rate card
r.get('/items', (_req, res) => {
  res.json({
    items: db.prepare('SELECT * FROM items ORDER BY category, item_name').all(),
    prices: db.prepare(`SELECT p.*, v.vendor_name FROM item_prices p
                        LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
                        ORDER BY p.item_id, p.unit_price`).all(),
  });
});

r.get('/rates', (_req, res) => {
  res.json({ rates: db.prepare('SELECT * FROM rates ORDER BY cost_type, rate_name').all() });
});

r.get('/buildings/:id', (req, res) => {
  const b = db.prepare(`SELECT b.*, d.design_name, d.ref_cost_per_sqm, p.project_name
                        FROM buildings b
                        LEFT JOIN designs d ON d.design_code = b.design_code
                        JOIN projects p ON p.project_id = b.project_id
                        WHERE b.building_id = ?`).get(req.params.id);
  if (!b) return res.status(404).json({ error: 'ไม่พบอาคาร' });
  // §5.1 วันเบิกใบแรก/ล่าสุด/ระยะเวลา — คำนวณอัตโนมัติ ไม่ให้คนกรอก
  const d = db.prepare(`SELECT MIN(request_date) AS first_date, MAX(request_date) AS last_date,
                          COUNT(*) AS request_count, COALESCE(SUM(total_amount),0) AS spent
                        FROM requests WHERE building_id = ?
                          AND status IN ('อนุมัติแล้ว','จ่ายแล้ว','ปิดรายการ')`).get(req.params.id);
  const days = d.first_date && d.last_date
    ? Math.round((new Date(d.last_date) - new Date(d.first_date)) / 864e5) : null;
  res.json({ building: { ...b, ...d, duration_days: days,
                         cost_per_sqm: b.area_sqm ? d.spent / b.area_sqm : null } });
});

r.patch('/buildings/:id', (req, res) => {
  if (!['CEO', 'COO', 'PM', 'SERVICE'].includes(req.user.role))
    return res.status(403).json({ error: 'บทบาทของคุณแก้ข้อมูลอาคารไม่ได้' });
  const b = db.prepare('SELECT * FROM buildings WHERE building_id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'ไม่พบอาคาร' });
  for (const f of ['building_name', 'design_code', 'work_nature', 'status', 'area_sqm',
                   'floors', 'is_building', 'budget', 'note']) {
    if (req.body?.[f] === undefined || String(b[f] ?? '') === String(req.body[f] ?? '')) continue;
    db.prepare(`UPDATE buildings SET ${f} = ?, value_source = 'ข้อเท็จจริง' WHERE building_id = ?`)
      .run(req.body[f] === '' ? null : req.body[f], b.building_id);
    audit({ table: 'buildings', recordId: b.building_id, field: f, oldValue: b[f],
            newValue: req.body[f], userId: req.user.user_id, reason: req.body?.reason || '' });
  }
  res.json({ building: db.prepare('SELECT * FROM buildings WHERE building_id = ?').get(b.building_id) });
});

// ---------------------------------------------------------------- สิทธิ์ชั่วคราว (v9 §21)
/**
 * "วันที่ต้องไปช่วยไซต์อื่นจะเบิกไม่ได้" — ถ้าไม่มีปุ่มนี้ คนจะกลับไปเบิกผ่านไลน์
 * COO/CEO กดอนุมัติได้ในคลิกเดียว
 */
r.post('/project-access', (req, res) => {
  const projectId = String(req.body?.project_id || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!projectId || !reason)
    return res.status(400).json({ error: 'ต้องเลือกโครงการและระบุเหตุผล' });
  if (!db.prepare("SELECT 1 FROM projects WHERE project_id = ? AND status = 'ใช้งาน'").get(projectId))
    return res.status(404).json({ error: 'ไม่พบโครงการ' });
  if (allowedProjectIds(req.user) === null ||
      allowedProjectIds(req.user).includes(projectId))
    return res.status(400).json({ error: 'คุณมีสิทธิ์เข้าถึงโครงการนี้อยู่แล้ว' });
  const dup = db.prepare(
    "SELECT access_id FROM project_access_requests WHERE user_id = ? AND project_id = ? AND status = 'รออนุมัติ'")
    .get(req.user.user_id, projectId);
  if (dup) return res.status(409).json({ error: 'คุณขอสิทธิ์โครงการนี้ไว้แล้ว รออนุมัติอยู่' });

  const days = Math.min(Math.max(Number(req.body?.days || 7), 1), 90);
  const info = db.prepare(`INSERT INTO project_access_requests
      (user_id, project_id, reason, expires_at) VALUES (?, ?, ?, date('now', ?))`)
    .run(req.user.user_id, projectId, reason, `+${days} days`);
  audit({ table: 'project_access_requests', recordId: info.lastInsertRowid,
          action: 'ขอสิทธิ์ชั่วคราว', newValue: projectId, userId: req.user.user_id, reason });
  res.status(201).json({ access_id: info.lastInsertRowid, days });
});

r.get('/project-access', (req, res) => {
  const mine = !can(req.user, 'request.approve');
  const rows = db.prepare(`SELECT a.*, u.display_name, u.role, p.project_name,
      d.display_name AS decided_by_name
    FROM project_access_requests a
    JOIN users u ON u.user_id = a.user_id
    JOIN projects p ON p.project_id = a.project_id
    LEFT JOIN users d ON d.user_id = a.decided_by
    ${mine ? 'WHERE a.user_id = ?' : ''}
    ORDER BY CASE a.status WHEN 'รออนุมัติ' THEN 0 ELSE 1 END, a.access_id DESC`)
    .all(...(mine ? [req.user.user_id] : []));
  res.json({ requests: rows });
});

r.post('/project-access/:id/decide', requireCap('request.approve'), (req, res) => {
  const row = db.prepare('SELECT * FROM project_access_requests WHERE access_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบคำขอ' });
  if (row.status !== 'รออนุมัติ') return res.status(400).json({ error: `คำขอนี้ ${row.status} แล้ว` });
  const approve = req.body?.approve !== false;
  db.prepare(`UPDATE project_access_requests
      SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE access_id = ?`)
    .run(approve ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ', req.user.user_id, row.access_id);
  audit({ table: 'project_access_requests', recordId: row.access_id, field: 'status',
          oldValue: 'รออนุมัติ', newValue: approve ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ',
          action: 'ตัดสินคำขอสิทธิ์', userId: req.user.user_id, reason: req.body?.reason || '' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- อาคาร (v9 §15 · §20)
/** ค้นทะเบียนชื่อพ้องก่อนสร้างอาคารใหม่เสมอ ไม่งั้นต้นทุนจะแตกเป็นสองก้อน */
r.get('/building-search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ matches: [] });
  const like = `%${q}%`;
  const matches = db.prepare(`SELECT DISTINCT b.building_id, b.building_name, b.project_id,
      p.project_name, b.design_code, b.area_sqm, b.status,
      (SELECT GROUP_CONCAT(a.alias, ' · ') FROM building_aliases a WHERE a.building_id = b.building_id) AS aliases
    FROM buildings b
    JOIN projects p ON p.project_id = b.project_id
    LEFT JOIN building_aliases a ON a.building_id = b.building_id
    WHERE b.building_name LIKE ? OR a.alias LIKE ? OR b.building_id LIKE ?
    ORDER BY b.project_id, b.building_name LIMIT 20`).all(like, like, like);
  res.json({ matches });
});

/** ประมาณงบก่อสร้างจากเส้นโค้งต้นทุน */
r.get('/cost-curve', (req, res) => {
  const { floors, area_sqm, design_code } = req.query;
  res.json({
    points: db.prepare('SELECT * FROM cost_curve ORDER BY floors, area_sqm').all(),
    estimate: floors && area_sqm
      ? estimateBudget({ floors: Number(floors), areaSqm: Number(area_sqm), designCode: design_code || null })
      : null,
  });
});

r.post('/buildings', (req, res) => {
  if (!['CEO', 'COO', 'PM'].includes(req.user.role))
    return res.status(403).json({ error: 'บทบาทของคุณสร้างอาคารไม่ได้' });
  const b = req.body || {};
  const name = String(b.building_name || '').trim();
  const projectId = String(b.project_id || '').trim();
  if (!name || !projectId) return res.status(400).json({ error: 'ต้องระบุชื่ออาคารและโครงการ' });
  const allowed = allowedProjectIds(req.user);
  if (allowed && !allowed.includes(projectId))
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ในโครงการนี้' });

  // §20 กันอาคารซ้ำ — ต้องยืนยันว่าตรวจชื่อพ้องแล้ว
  const clash = db.prepare(`SELECT b.building_id, b.building_name FROM buildings b
    LEFT JOIN building_aliases a ON a.building_id = b.building_id
    WHERE b.building_name = ? OR a.alias = ? LIMIT 1`).get(name, name);
  if (clash && !b.confirm_not_duplicate)
    return res.status(409).json({
      error: `มีอาคารชื่อนี้อยู่แล้ว (${clash.building_id} · ${clash.building_name}) — ถ้าเป็นคนละหลังจริง ให้ยืนยันอีกครั้ง`,
      existing: clash, code: 'DUPLICATE_BUILDING',
    });

  const last = db.prepare("SELECT building_id FROM buildings WHERE building_id LIKE 'B___' ORDER BY building_id DESC LIMIT 1").get();
  const id = 'B' + String((last ? parseInt(last.building_id.slice(1), 10) : 0) + 1).padStart(3, '0');
  const area = b.area_sqm ? Number(b.area_sqm) : null;
  const floors = b.floors ? Number(b.floors) : null;
  const est = area && floors ? estimateBudget({ floors, areaSqm: area, designCode: b.design_code || null }) : null;

  db.prepare(`INSERT INTO buildings
      (building_id, project_id, building_name, design_code, work_nature, status, area_sqm,
       floors, is_building, budget, value_source, note)
    VALUES (?,?,?,?,?, 'กำลังทำ', ?,?,?,?, 'ข้อเท็จจริง', ?)`)
    .run(id, projectId, name, b.design_code || null,
      ['สร้างใหม่', 'ต่อเติม', 'ซ่อมบำรุง'].includes(b.work_nature) ? b.work_nature : 'สร้างใหม่',
      area, floors, b.is_building === 'N' ? 'N' : 'Y',
      b.budget != null ? Number(b.budget) : (est ? est.estimate : null), b.note || '');
  db.prepare('INSERT OR IGNORE INTO building_aliases (building_id, alias, alias_kind) VALUES (?,?,?)')
    .run(id, name, 'ชื่อที่ใช้หน้างาน');
  audit({ table: 'buildings', recordId: id, action: 'สร้างอาคาร', newValue: name, userId: req.user.user_id });
  res.status(201).json({
    building: db.prepare('SELECT * FROM buildings WHERE building_id = ?').get(id),
    budget_estimate: est,
  });
});

// ---------------------------------------------------------------- ข้อมูลอ้างอิง v9
r.get('/reference/:kind', (req, res) => {
  const kinds = {
    employees: 'SELECT * FROM employees ORDER BY status, emp_id',
    cost_curve: 'SELECT * FROM cost_curve ORDER BY floors, area_sqm',
    rental_units: 'SELECT * FROM rental_units ORDER BY location_code, unit_label',
    lessors: 'SELECT * FROM lessors ORDER BY lessor_id',
    land_leases: 'SELECT * FROM land_leases ORDER BY years_left',
    location_pl: 'SELECT * FROM location_pl ORDER BY margin_year DESC',
    building_aliases: `SELECT a.*, b.building_name, b.project_id FROM building_aliases a
                       JOIN buildings b ON b.building_id = a.building_id ORDER BY a.building_id`,
  };
  const sql = kinds[req.params.kind];
  if (!sql) return res.status(404).json({ error: 'ไม่มีข้อมูลชุดนี้', available: Object.keys(kinds) });
  res.json({ kind: req.params.kind, rows: db.prepare(sql).all() });
});

r.get('/audit', (req, res) => {
  const { table, record, limit = 200 } = req.query;
  const where = [], args = [];
  if (table) { where.push('table_name = ?'); args.push(table); }
  if (record) { where.push('record_id = ?'); args.push(record); }
  const rows = db.prepare(`SELECT a.*, u.display_name FROM audit_log a
    LEFT JOIN users u ON u.user_id = a.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.log_id DESC LIMIT ?`).all(...args, Math.min(Number(limit) || 200, 1000));
  res.json({ log: rows });
});

export default r;
