import { Router } from 'express';
import { db, audit, getSetting } from '../db.js';
import { requireAuth, requireCap, can, allowedProjectIds, seesAllProjects } from '../auth.js';

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
