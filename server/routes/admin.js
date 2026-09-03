import { Router } from 'express';
import { db, audit, getSetting, setSetting } from '../db.js';
import { requireAuth, hashPassword } from '../auth.js';
import { isConfigured as lineConfigured, flushOutbox, OUTBOX_STATUS, appBaseUrl } from '../line.js';

const r = Router();
r.use(requireAuth);
r.use((req, res, next) =>
  req.user.role === 'CEO' ? next() : res.status(403).json({ error: 'หน้านี้เปิดให้เฉพาะ CEO' }));

// ---------------------------------------------------------------- ผู้ใช้
r.get('/users', (_req, res) => {
  res.json({
    users: db.prepare(`SELECT u.user_id, u.display_name, u.full_name, u.title, u.role, u.username,
        u.phone, u.require_2fa, u.totp_enabled, u.password_changed, u.status, u.note,
        u.line_user_id, u.created_at,
        (SELECT GROUP_CONCAT(project_id, ',') FROM user_projects WHERE user_id = u.user_id) AS projects
      FROM users u ORDER BY u.user_id`).all(),
  });
});

r.patch('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  for (const f of ['display_name', 'full_name', 'title', 'role', 'username', 'phone',
    'require_2fa', 'status', 'note']) {
    if (req.body?.[f] === undefined || String(u[f] ?? '') === String(req.body[f] ?? '')) continue;
    db.prepare(`UPDATE users SET ${f} = ? WHERE user_id = ?`).run(req.body[f], u.user_id);
    audit({
      table: 'users', recordId: u.user_id, field: f, oldValue: u[f], newValue: req.body[f],
      userId: req.user.user_id, reason: req.body?.reason || '',
    });
  }
  if (Array.isArray(req.body?.projects)) {
    db.prepare('DELETE FROM user_projects WHERE user_id = ?').run(u.user_id);
    const ins = db.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?,?)');
    for (const p of req.body.projects) ins.run(u.user_id, p);
    audit({
      table: 'user_projects', recordId: u.user_id, field: 'projects',
      newValue: req.body.projects.join(','), userId: req.user.user_id,
    });
  }
  res.json({ ok: true });
});

r.post('/users', (req, res) => {
  const b = req.body || {};
  const id = String(b.user_id || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(id)) return res.status(400).json({ error: 'รหัสผู้ใช้ต้องเป็น A-Z หรือ 0-9 ไม่เกิน 4 ตัว' });
  if (db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(id))
    return res.status(409).json({ error: 'มีรหัสผู้ใช้นี้แล้ว' });
  const phone = String(b.phone || '').trim();
  if (!b.username || !b.display_name) return res.status(400).json({ error: 'ต้องกรอกชื่อเรียกและอีเมล' });
  const initial = phone || `changeme-${id}`;
  db.prepare(`INSERT INTO users
    (user_id, display_name, full_name, title, role, username, password_hash, phone, require_2fa, status, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.display_name, b.full_name || '', b.title || '', b.role || 'VIEWER',
      String(b.username).toLowerCase(), hashPassword(initial), phone,
      ['CEO', 'COO', 'FINANCE'].includes(b.role) ? 1 : 0, 'ใช้งาน', b.note || '');
  audit({ table: 'users', recordId: id, action: 'สร้างผู้ใช้', userId: req.user.user_id });
  res.status(201).json({ user_id: id, initial_password: initial });
});

/** ตั้งรหัสผ่านใหม่ให้ผู้ใช้ — ตั้งค่าเป็นเบอร์โทรและบังคับเปลี่ยนอีกครั้ง */
r.post('/users/:id/reset-password', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  const initial = u.phone || `changeme-${u.user_id}`;
  db.prepare('UPDATE users SET password_hash = ?, password_changed = 0 WHERE user_id = ?')
    .run(hashPassword(initial), u.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.user_id);
  audit({ table: 'users', recordId: u.user_id, action: 'ตั้งรหัสผ่านใหม่', userId: req.user.user_id });
  res.json({ ok: true, initial_password: initial });
});

r.post('/users/:id/reset-2fa', (req, res) => {
  db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE user_id = ?').run(req.params.id);
  audit({ table: 'users', recordId: req.params.id, action: 'ล้างการตั้งค่า 2FA', userId: req.user.user_id });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- ผัง Expense Code
r.patch('/cost-codes/:code', (req, res) => {
  const c = db.prepare('SELECT * FROM cost_codes WHERE cost_code = ?').get(req.params.code);
  if (!c) return res.status(404).json({ error: 'ไม่พบหมวดงาน' });
  for (const f of ['cost_name', 'work_group', 'group_order', 'status', 'merge_into', 'default_cost_type', 'note']) {
    if (req.body?.[f] === undefined || String(c[f] ?? '') === String(req.body[f] ?? '')) continue;
    db.prepare(`UPDATE cost_codes SET ${f} = ? WHERE cost_code = ?`)
      .run(req.body[f] === '' ? null : req.body[f], c.cost_code);
    audit({
      table: 'cost_codes', recordId: c.cost_code, field: f, oldValue: c[f], newValue: req.body[f],
      userId: req.user.user_id, reason: req.body?.reason || '',
    });
  }
  res.json({ cost_code: db.prepare('SELECT * FROM cost_codes WHERE cost_code = ?').get(c.cost_code) });
});

r.post('/cost-codes', (req, res) => {
  const code = String(req.body?.cost_code || '').trim().toUpperCase();
  if (!/^[A-Z]{2,4}$/.test(code)) return res.status(400).json({ error: 'รหัสหมวดงานต้องเป็นตัวอักษรใหญ่ 2–4 ตัว' });
  if (db.prepare('SELECT 1 FROM cost_codes WHERE cost_code = ?').get(code))
    return res.status(409).json({ error: 'มีรหัสนี้แล้ว' });
  db.prepare(`INSERT INTO cost_codes (cost_code, cost_name, work_group, group_order, status, default_cost_type, note)
    VALUES (?,?,?,?, 'ใช้ต่อ', ?, ?)`)
    .run(code, req.body?.cost_name || code, req.body?.work_group || '',
      Number(req.body?.group_order || 9), req.body?.default_cost_type || null, req.body?.note || '');
  audit({ table: 'cost_codes', recordId: code, action: 'เพิ่มหมวดงาน', userId: req.user.user_id });
  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------- ตั้งค่าระบบ
const ALLOWED_SETTINGS = ['flag_W2_enabled', 'cutover_date', 'company_name'];

r.get('/settings', (_req, res) => {
  res.json({ settings: Object.fromEntries(ALLOWED_SETTINGS.map((k) => [k, getSetting(k)])) });
});

r.put('/settings', (req, res) => {
  for (const k of ALLOWED_SETTINGS) {
    if (req.body?.[k] === undefined) continue;
    const old = getSetting(k);
    const val = typeof req.body[k] === 'boolean' ? (req.body[k] ? '1' : '0') : String(req.body[k]);
    if (old === val) continue;
    setSetting(k, val);
    audit({
      table: 'settings', recordId: k, field: 'value', oldValue: old, newValue: val,
      userId: req.user.user_id, reason: req.body?.reason || '',
    });
  }
  res.json({ settings: Object.fromEntries(ALLOWED_SETTINGS.map((k) => [k, getSetting(k)])) });
});

// ---------------------------------------------------------------- ไลน์ (สเปก §8 S2)
/**
 * สถานะการเชื่อมต่อไลน์ + คิวข้อความ
 * ตราบใดที่ยังไม่ได้ตั้ง channel ข้อความจะค้างสถานะ "ยังไม่ได้ตั้งค่า" ให้เห็นว่าใครควรได้รับอะไร
 */
r.get('/line', (_req, res) => {
  const rows = db.prepare(`SELECT o.*, u.display_name FROM line_outbox o
    LEFT JOIN users u ON u.user_id = o.user_id
    ORDER BY o.outbox_id DESC LIMIT 100`).all();
  res.json({
    configured: lineConfigured(),
    webhook_url: `${appBaseUrl()}/api/line/webhook`,
    linked_users: db.prepare(`SELECT user_id, display_name, role FROM users
      WHERE line_user_id IS NOT NULL AND line_user_id <> '' ORDER BY user_id`).all(),
    counts: db.prepare('SELECT status, COUNT(*) AS n FROM line_outbox GROUP BY status').all(),
    outbox: rows.map(({ payload, ...rest }) => rest),
  });
});

/** ส่งข้อความที่ค้างอยู่ทั้งหมดอีกครั้ง — ใช้ตอนเพิ่งผูก channel เสร็จ */
r.post('/line/flush', async (req, res) => {
  if (!lineConfigured()) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า LINE channel' });
  const out = await flushOutbox({ limit: Number(req.body?.limit) || 50 });
  audit({ table: 'line_outbox', recordId: 'flush', action: 'ส่งข้อความค้างเข้าไลน์',
          userId: req.user.user_id, newValue: JSON.stringify(out) });
  res.json({ ...out, statuses: OUTBOX_STATUS });
});

r.get('/health', (_req, res) => {
  const counts = {};
  for (const t of ['users', 'projects', 'buildings', 'cost_codes', 'vendors', 'items',
    'requests', 'request_lines', 'payments', 'documents', 'reversals', 'funding_in', 'audit_log',
    'line_outbox'])
    counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const totals = db.prepare(`SELECT value_source, COUNT(*) AS n, ROUND(SUM(total_amount),2) AS amount
    FROM requests GROUP BY value_source`).all();
  res.json({ counts, totals });
});

export default r;
