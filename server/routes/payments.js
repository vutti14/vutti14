import { Router } from 'express';
import { db, audit, nextDocNo, round2 } from '../db.js';
import { requireAuth, requireCap } from '../auth.js';
import { requiredDocuments } from '../rules.js';
import { fullRequest, getReq, getLines, projectFilter } from './requests.js';

const r = Router();
r.use(requireAuth);

/** S3 — คิวจ่ายเงิน: ใบที่อนุมัติแล้วรอจ่าย */
r.get('/payments/queue', requireCap('payment.read'), (req, res) => {
  const rows = db.prepare(`SELECT q.request_id, q.request_date, q.approved_at, q.total_amount,
      q.wht_amount, q.net_amount, q.flags, q.project_id, q.building_id,
      p.project_name, b.building_name, v.vendor_name, v.bank_account, v.entity_type,
      u.display_name AS requester_name, a.display_name AS approver_name,
      (SELECT COALESCE(SUM(c.amount - c.used_amount), 0) FROM vendor_credits c
        WHERE c.vendor_id = q.vendor_id AND c.status = 'คงเหลือ') AS vendor_credit
    FROM requests q
    JOIN projects p ON p.project_id = q.project_id
    JOIN buildings b ON b.building_id = q.building_id
    LEFT JOIN vendors v ON v.vendor_id = q.vendor_id
    JOIN users u ON u.user_id = q.requester_id
    LEFT JOIN users a ON a.user_id = q.approver_id
    WHERE q.status = 'อนุมัติแล้ว'
    ORDER BY q.approved_at`).all();
  res.json({
    queue: rows.map((x) => ({ ...x, flags: JSON.parse(x.flags || '[]') })),
    total_amount: round2(rows.reduce((s, x) => s + x.net_amount, 0)),
  });
});

/** บันทึกการจ่าย — B7 ต้องแนบสลิปเสมอ · payment 1 ต่อ 1 กับใบเบิก */
r.post('/payments', requireCap('payment.create'), (req, res) => {
  const b = req.body || {};
  const cur = getReq(b.request_id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  if (cur.status !== 'อนุมัติแล้ว')
    return res.status(400).json({ error: `จ่ายได้เฉพาะใบที่อนุมัติแล้ว (สถานะปัจจุบัน: ${cur.status})` });
  if (db.prepare('SELECT 1 FROM payments WHERE request_id = ?').get(cur.request_id))
    return res.status(409).json({ error: 'ใบนี้บันทึกการจ่ายไปแล้ว' });

  const slipId = b.slip_file_id ? Number(b.slip_file_id) : null;
  if (!slipId) return res.status(400).json({ error: 'ต้องแนบสลิปการโอนก่อนบันทึกการจ่าย', code: 'B7' });
  const slip = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(slipId);
  if (!slip) return res.status(400).json({ error: 'ไม่พบไฟล์สลิปที่แนบ' });

  const payDate = b.payment_date || new Date().toISOString().slice(0, 10);
  const id = nextDocNo('PAY', 'payments', 'payment_id', payDate);
  const lines = getLines(cur.request_id);

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO payments
      (payment_id, request_id, payment_date, bank_account, net_amount, slip_file_id, transfer_ref, paid_by)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, cur.request_id, payDate, b.bank_account || '', round2(cur.net_amount),
        slipId, b.transfer_ref || '', req.user.user_id);
    db.prepare(`UPDATE attachments SET request_id = ?, purpose = 'สลิปการโอน' WHERE file_id = ?`)
      .run(cur.request_id, slipId);
    db.prepare("UPDATE requests SET status = 'จ่ายแล้ว' WHERE request_id = ?").run(cur.request_id);

    // เตรียมช่องเอกสารที่ใบนี้ต้องเก็บให้ครบ (สเปก §7)
    const ins = db.prepare(`INSERT OR IGNORE INTO documents (request_id, doc_type, received)
                            VALUES (?, ?, 0)`);
    for (const d of requiredDocuments({ header: cur, lines })) ins.run(cur.request_id, d.doc_type);

    audit({
      table: 'requests', recordId: cur.request_id, field: 'status', oldValue: cur.status,
      newValue: 'จ่ายแล้ว', action: 'บันทึกการจ่าย', userId: req.user.user_id,
      reason: `${id} · ${payDate}`,
    });
  });
  tx();
  res.status(201).json({ request: fullRequest(cur.request_id) });
});

r.get('/payments', requireCap('payment.read'), (req, res) => {
  const { from, to, page = 1, per_page = 100 } = req.query;
  const where = [];
  const args = [];
  const allowed = projectFilter(req.user);
  if (allowed) { where.push(`q.project_id IN (${allowed.map(() => '?').join(',')})`); args.push(...allowed); }
  if (from) { where.push('pm.payment_date >= ?'); args.push(from); }
  if (to) { where.push('pm.payment_date <= ?'); args.push(to); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Number(per_page) || 100, 500);
  const rows = db.prepare(`SELECT pm.*, q.project_id, q.building_id, q.total_amount, q.wht_amount,
      v.vendor_name, u.display_name AS paid_by_name, b.building_name
    FROM payments pm
    JOIN requests q ON q.request_id = pm.request_id
    JOIN buildings b ON b.building_id = q.building_id
    LEFT JOIN vendors v ON v.vendor_id = q.vendor_id
    LEFT JOIN users u ON u.user_id = pm.paid_by
    ${w} ORDER BY pm.payment_date DESC, pm.payment_id DESC
    LIMIT ? OFFSET ?`).all(...args, limit, (Math.max(Number(page) || 1, 1) - 1) * limit);
  res.json({ payments: rows });
});

export default r;
