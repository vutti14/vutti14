import { Router } from 'express';
import { db, audit, nextDocNo, round2 } from '../db.js';
import { requireAuth, requireCap } from '../auth.js';
import { PETTY_CASH_LINE_MAX, PETTY_CASH_CEILING } from '../rules.js';
import { fullRequest, getReq } from './requests.js';

const r = Router();
r.use(requireAuth);

// ---------------------------------------------------------------- ใบกลับรายการ
/**
 * §5.2 reversals — ยอดติดลบเสมอ · เหตุผลบังคับ · ปลายทาง ได้เงินคืน / หักกลบบิลหน้า
 * ปลายทาง "หักกลบบิลหน้า" จะสร้างเครดิตค้างกับ vendor ซึ่งจะเด้งเตือน W4 ตอนเบิกครั้งหน้า
 */
r.post('/requests/:id/reversals', requireCap('reversal.create'), (req, res) => {
  const cur = getReq(req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  if (!['จ่ายแล้ว', 'ปิดรายการ'].includes(cur.status))
    return res.status(400).json({ error: 'ออกใบกลับรายการได้เฉพาะใบที่จ่ายเงินไปแล้ว' });

  const b = req.body || {};
  const reason = String(b.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'ต้องระบุเหตุผลของใบกลับรายการ' });
  const type = String(b.reversal_type || '');
  if (!['จ่ายเกิน', 'จ่ายซ้ำ', 'ของคืน', 'ของไม่ครบ'].includes(type))
    return res.status(400).json({ error: 'ประเภทใบกลับรายการไม่ถูกต้อง' });
  const destination = String(b.destination || '');
  if (!['ได้เงินคืน', 'หักกลบบิลหน้า'].includes(destination))
    return res.status(400).json({ error: 'ต้องเลือกปลายทาง: ได้เงินคืน หรือ หักกลบบิลหน้า' });

  const gross = Math.abs(Number(b.amount || 0));
  if (!(gross > 0)) return res.status(400).json({ error: 'ยอดกลับรายการต้องมากกว่า 0' });
  const already = db.prepare('SELECT COALESCE(SUM(ABS(amount)),0) AS s FROM reversals WHERE request_id = ?')
    .get(cur.request_id).s;
  if (round2(already + gross) > round2(cur.total_amount) + 0.01)
    return res.status(400).json({
      error: `ยอดกลับรายการรวมเกินยอดใบเดิม (ใบนี้ ${round2(cur.total_amount).toLocaleString('th-TH')} บาท · กลับรายการไปแล้ว ${round2(already).toLocaleString('th-TH')} บาท)`,
    });

  const id = nextDocNo('REV', 'reversals', 'reversal_id', b.received_date || cur.request_date);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO reversals
      (reversal_id, request_id, reversal_type, amount, reason, destination, received_date, file_id, created_by)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, cur.request_id, type, -round2(gross), reason, destination,
        b.received_date || null, b.file_id ? Number(b.file_id) : null, req.user.user_id);
    if (destination === 'หักกลบบิลหน้า' && cur.vendor_id)
      db.prepare('INSERT INTO vendor_credits (vendor_id, reversal_id, amount) VALUES (?,?,?)')
        .run(cur.vendor_id, id, round2(gross));
    audit({
      table: 'requests', recordId: cur.request_id, action: 'ออกใบกลับรายการ',
      newValue: -round2(gross), userId: req.user.user_id, reason: `${type} · ${destination} · ${reason}`,
    });
  });
  tx();
  res.status(201).json({ request: fullRequest(cur.request_id), reversal_id: id });
});

r.get('/reversals', (_req, res) => {
  const rows = db.prepare(`SELECT rv.*, q.project_id, q.building_id, q.total_amount AS original_amount,
      v.vendor_name, b.building_name, u.display_name AS created_by_name
    FROM reversals rv
    JOIN requests q ON q.request_id = rv.request_id
    JOIN buildings b ON b.building_id = q.building_id
    LEFT JOIN vendors v ON v.vendor_id = q.vendor_id
    LEFT JOIN users u ON u.user_id = rv.created_by
    ORDER BY rv.reversal_id DESC`).all();
  res.json({ reversals: rows, total: round2(rows.reduce((s, x) => s + x.amount, 0)) });
});

// ---------------------------------------------------------------- เครดิตค้างกับผู้ขาย
r.get('/vendor-credits', (_req, res) => {
  const rows = db.prepare(`SELECT c.*, v.vendor_name, (c.amount - c.used_amount) AS balance
    FROM vendor_credits c JOIN vendors v ON v.vendor_id = c.vendor_id
    ORDER BY c.status, balance DESC`).all();
  res.json({
    credits: rows,
    outstanding: round2(rows.filter((x) => x.status === 'คงเหลือ').reduce((s, x) => s + x.balance, 0)),
  });
});

/** ใช้เครดิตหักกลบกับใบเบิกใบใหม่ */
r.post('/vendor-credits/:id/use', requireCap('payment.create'), (req, res) => {
  const c = db.prepare('SELECT * FROM vendor_credits WHERE credit_id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'ไม่พบเครดิต' });
  if (c.status !== 'คงเหลือ') return res.status(400).json({ error: 'เครดิตนี้ถูกใช้ไปแล้ว' });
  const cur = getReq(req.body?.request_id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิกปลายทาง' });
  if (cur.vendor_id !== c.vendor_id)
    return res.status(400).json({ error: 'เครดิตนี้เป็นของผู้ขายคนละราย' });

  const balance = round2(c.amount - c.used_amount);
  const use = round2(Math.min(Math.abs(Number(req.body?.amount || balance)), balance));
  if (!(use > 0)) return res.status(400).json({ error: 'ยอดที่ใช้ต้องมากกว่า 0' });

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO credit_usage (credit_id, request_id, amount, used_by) VALUES (?,?,?,?)')
      .run(c.credit_id, cur.request_id, use, req.user.user_id);
    const used = round2(c.used_amount + use);
    db.prepare('UPDATE vendor_credits SET used_amount = ?, status = ? WHERE credit_id = ?')
      .run(used, used >= c.amount - 0.01 ? 'ใช้หมดแล้ว' : 'คงเหลือ', c.credit_id);
    audit({
      table: 'vendor_credits', recordId: c.credit_id, field: 'used_amount',
      oldValue: c.used_amount, newValue: used, action: 'หักกลบกับใบเบิก',
      userId: req.user.user_id, reason: cur.request_id,
    });
  });
  tx();
  res.json({ ok: true, used: use });
});

// ---------------------------------------------------------------- เงินทุนเข้า
r.get('/funding', (_req, res) => {
  const rows = db.prepare(`SELECT f.*, u.display_name AS recorded_by_name FROM funding_in f
    LEFT JOIN users u ON u.user_id = f.recorded_by ORDER BY f.funding_date DESC`).all();
  const paid = db.prepare(`SELECT COALESCE(SUM(net_amount),0) AS s FROM requests
    WHERE status IN ('จ่ายแล้ว','ปิดรายการ')`).get().s;
  const refund = db.prepare('SELECT COALESCE(SUM(ABS(amount)),0) AS s FROM reversals').get().s;
  const inflow = rows.reduce((s, x) => s + x.amount, 0);
  res.json({
    funding: rows,
    total_in: round2(inflow),
    total_paid: round2(paid),
    total_refund: round2(refund),
    balance: round2(inflow + refund - paid),
  });
});

/** §5.2 บันทึก Funding In — CEO เท่านั้น */
r.post('/funding', (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'บันทึกเงินทุนเข้าได้เฉพาะ CEO' });
  const b = req.body || {};
  const amount = round2(Number(b.amount || 0));
  if (!(amount > 0)) return res.status(400).json({ error: 'จำนวนเงินต้องมากกว่า 0' });
  if (!b.company) return res.status(400).json({ error: 'ต้องระบุบริษัทผู้รับเงิน' });
  const date = b.funding_date || new Date().toISOString().slice(0, 10);
  const id = nextDocNo('FIN', 'funding_in', 'funding_id', date);
  db.prepare(`INSERT INTO funding_in
    (funding_id, funding_date, amount, company, source, accounting_status, recorded_by, value_source)
    VALUES (?,?,?,?,?,?,?, 'ข้อเท็จจริง')`)
    .run(id, date, amount, b.company, b.source || '',
      b.accounting_status || 'เงินกู้ยืมกรรมการ', req.user.user_id);
  audit({ table: 'funding_in', recordId: id, action: 'บันทึกเงินทุนเข้า', newValue: amount, userId: req.user.user_id });
  res.status(201).json({ funding: db.prepare('SELECT * FROM funding_in WHERE funding_id = ?').get(id) });
});

// ---------------------------------------------------------------- เงินสดย่อย
r.get('/petty-cash', (_req, res) => {
  const accounts = db.prepare(`SELECT a.*, p.project_name, u.display_name AS holder_name,
      (SELECT COALESCE(SUM(CASE WHEN entry_type = 'เติมเงิน' THEN amount ELSE -amount END), 0)
       FROM petty_cash_lines l WHERE l.pc_id = a.pc_id) AS computed_balance
    FROM petty_cash_accounts a
    JOIN projects p ON p.project_id = a.project_id
    JOIN users u ON u.user_id = a.holder_id
    ORDER BY p.project_name`).all();
  res.json({ accounts, ceiling: PETTY_CASH_CEILING, line_max: PETTY_CASH_LINE_MAX });
});

r.post('/petty-cash/accounts', requireCap('pettycash.manage'), (req, res) => {
  const b = req.body || {};
  if (!b.project_id || !b.holder_id)
    return res.status(400).json({ error: 'ต้องระบุโครงการและผู้ถือเงินสดย่อย' });
  const info = db.prepare(`INSERT OR IGNORE INTO petty_cash_accounts (project_id, holder_id, ceiling)
    VALUES (?,?,?)`).run(b.project_id, b.holder_id, Number(b.ceiling || PETTY_CASH_CEILING));
  res.status(201).json({ pc_id: info.lastInsertRowid });
});

/** §5.2 วงเงิน 10,000/ไซต์ · ต่อรายการไม่เกิน 2,000 · ต้องเคลียร์บิลก่อนเติม */
r.post('/petty-cash/:pcId/entries', requireCap('pettycash.manage'), (req, res) => {
  const acc = db.prepare('SELECT * FROM petty_cash_accounts WHERE pc_id = ?').get(req.params.pcId);
  if (!acc) return res.status(404).json({ error: 'ไม่พบบัญชีเงินสดย่อย' });
  const b = req.body || {};
  const type = String(b.entry_type || '');
  if (!['เติมเงิน', 'ใช้จ่าย', 'เคลียร์บิล'].includes(type))
    return res.status(400).json({ error: 'ประเภทรายการไม่ถูกต้อง' });
  const amount = round2(Math.abs(Number(b.amount || 0)));
  if (!(amount > 0)) return res.status(400).json({ error: 'จำนวนเงินต้องมากกว่า 0' });

  const balance = db.prepare(`SELECT COALESCE(SUM(CASE WHEN entry_type = 'เติมเงิน' THEN amount ELSE -amount END), 0) AS s
    FROM petty_cash_lines WHERE pc_id = ?`).get(acc.pc_id).s;

  if (type === 'ใช้จ่าย') {
    if (amount > PETTY_CASH_LINE_MAX)
      return res.status(400).json({
        error: `เงินสดย่อยต่อรายการต้องไม่เกิน ${PETTY_CASH_LINE_MAX.toLocaleString('th-TH')} บาท`, code: 'B10',
      });
    if (amount > balance)
      return res.status(400).json({ error: `เงินสดย่อยคงเหลือ ${round2(balance).toLocaleString('th-TH')} บาท ไม่พอ` });
  }
  if (type === 'เติมเงิน') {
    const uncleared = db.prepare(`SELECT COUNT(*) AS n FROM petty_cash_lines
      WHERE pc_id = ? AND entry_type = 'ใช้จ่าย'
        AND pc_line_id > COALESCE((SELECT MAX(pc_line_id) FROM petty_cash_lines
                                   WHERE pc_id = ? AND entry_type = 'เคลียร์บิล'), 0)`)
      .get(acc.pc_id, acc.pc_id).n;
    if (uncleared > 0)
      return res.status(400).json({ error: `ยังมีบิลค้างเคลียร์ ${uncleared} รายการ — ต้องเคลียร์บิลก่อนเติมเงิน` });
    if (round2(balance + amount) > acc.ceiling)
      return res.status(400).json({
        error: `เติมแล้วเกินวงเงิน ${round2(acc.ceiling).toLocaleString('th-TH')} บาท (คงเหลือปัจจุบัน ${round2(balance).toLocaleString('th-TH')})`,
      });
  }

  db.prepare(`INSERT INTO petty_cash_lines
    (pc_id, entry_date, entry_type, amount, request_id, description, recorded_by)
    VALUES (?,?,?,?,?,?,?)`)
    .run(acc.pc_id, b.entry_date || new Date().toISOString().slice(0, 10), type, amount,
      b.request_id || null, b.description || '', req.user.user_id);
  const newBalance = round2(balance + (type === 'เติมเงิน' ? amount : -amount));
  db.prepare('UPDATE petty_cash_accounts SET balance = ? WHERE pc_id = ?').run(newBalance, acc.pc_id);
  res.status(201).json({ balance: newBalance });
});

r.get('/petty-cash/:pcId/entries', (req, res) => {
  res.json({
    entries: db.prepare(`SELECT l.*, u.display_name AS recorded_by_name FROM petty_cash_lines l
      LEFT JOIN users u ON u.user_id = l.recorded_by
      WHERE l.pc_id = ? ORDER BY l.pc_line_id DESC`).all(req.params.pcId),
  });
});

export default r;
