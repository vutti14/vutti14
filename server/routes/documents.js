import { Router } from 'express';
import { db, audit, round2 } from '../db.js';
import { requireAuth, requireCap } from '../auth.js';
import { docAgeLevel, requiredDocuments } from '../rules.js';
import { fullRequest, getReq, getLines, projectFilter } from './requests.js';

const r = Router();
r.use(requireAuth);

const PAID = "('จ่ายแล้ว','ปิดรายการ')";
// §9 ข้อมูลนำเข้าย้อนหลังไม่มีเอกสาร — เริ่มติดตามเอกสารตั้งแต่วันตัดข้อมูลเท่านั้น
const TRACKED = "q.value_source <> 'นำเข้าย้อนหลัง'";

/** S4 — สรุปเอกสารค้าง เรียงตามยอดเงิน (หลักการข้อ 8: แสดงเป็นยอดเงิน ไม่ใช่จำนวนใบ) */
r.get('/documents/summary', (_req, res) => {
  const vatPending = db.prepare(`SELECT COALESCE(SUM(q.vat_amount),0) AS amount, COUNT(*) AS n
    FROM requests q
    WHERE q.status IN ${PAID} AND ${TRACKED} AND q.has_vat = 'มี'
      AND NOT EXISTS (SELECT 1 FROM documents d
                      WHERE d.request_id = q.request_id AND d.doc_type = 'ใบกำกับภาษี' AND d.received = 1)`).get();

  const goodsPending = db.prepare(`SELECT COALESCE(SUM(q.total_amount),0) AS amount, COUNT(*) AS n
    FROM requests q
    WHERE q.status IN ${PAID} AND ${TRACKED} AND q.goods_received = 0
      AND EXISTS (SELECT 1 FROM request_lines l WHERE l.request_id = q.request_id AND l.cost_type = 'ของ')`).get();

  const whtPending = db.prepare(`SELECT COALESCE(SUM(q.wht_amount),0) AS amount, COUNT(*) AS n
    FROM requests q
    WHERE q.status IN ${PAID} AND ${TRACKED} AND q.wht_amount > 0
      AND NOT EXISTS (SELECT 1 FROM documents d
                      WHERE d.request_id = q.request_id
                        AND d.doc_type = 'หนังสือรับรองหัก ณ ที่จ่าย' AND d.received = 1)`).get();

  const receiptPending = db.prepare(`SELECT COALESCE(SUM(q.total_amount),0) AS amount, COUNT(*) AS n
    FROM requests q
    WHERE q.status = 'จ่ายแล้ว' AND ${TRACKED}
      AND EXISTS (SELECT 1 FROM documents d WHERE d.request_id = q.request_id AND d.received = 0)`).get();

  res.json({
    buckets: [
      { key: 'vat', level: 'แดง', label: 'ภาษีซื้อที่ยังขอคืนไม่ได้', amount: round2(vatPending.amount), count: vatPending.n },
      { key: 'goods', level: 'เหลือง', label: 'ของที่จ่ายแล้วยังไม่มา', amount: round2(goodsPending.amount), count: goodsPending.n },
      { key: 'wht', level: 'เหลือง', label: 'หัก ณ ที่จ่ายยังไม่ออกหนังสือ', amount: round2(whtPending.amount), count: whtPending.n },
      { key: 'any', level: 'เทา', label: 'ใบที่จ่ายแล้วแต่เอกสารยังไม่ครบ', amount: round2(receiptPending.amount), count: receiptPending.n },
    ],
  });
});

/** รายการใบที่เอกสารยังไม่ครบ — กรองตาม vendor / โครงการ / อายุค้าง */
r.get('/documents/pending', (req, res) => {
  const { bucket, vendor_id, project_id, min_age, page = 1, per_page = 100 } = req.query;
  const where = [`q.status IN ${PAID}`, TRACKED];
  const args = [];
  const allowed = projectFilter(req.user);
  if (allowed) { where.push(`q.project_id IN (${allowed.map(() => '?').join(',')})`); args.push(...allowed); }
  if (vendor_id) { where.push('q.vendor_id = ?'); args.push(vendor_id); }
  if (project_id) { where.push('q.project_id = ?'); args.push(project_id); }

  if (bucket === 'vat')
    where.push(`q.has_vat = 'มี' AND NOT EXISTS (SELECT 1 FROM documents d
      WHERE d.request_id = q.request_id AND d.doc_type = 'ใบกำกับภาษี' AND d.received = 1)`);
  else if (bucket === 'goods')
    where.push(`q.goods_received = 0 AND EXISTS (SELECT 1 FROM request_lines l
      WHERE l.request_id = q.request_id AND l.cost_type = 'ของ')`);
  else if (bucket === 'wht')
    where.push(`q.wht_amount > 0 AND NOT EXISTS (SELECT 1 FROM documents d
      WHERE d.request_id = q.request_id AND d.doc_type = 'หนังสือรับรองหัก ณ ที่จ่าย' AND d.received = 1)`);
  else
    where.push(`EXISTS (SELECT 1 FROM documents d WHERE d.request_id = q.request_id AND d.received = 0)`);

  const limit = Math.min(Number(per_page) || 100, 500);
  const rows = db.prepare(`SELECT q.request_id, q.request_date, q.total_amount, q.vat_amount,
      q.wht_amount, q.has_vat, q.goods_received, q.status, q.value_source,
      p.project_name, b.building_name, v.vendor_name, v.vendor_id,
      pm.payment_date,
      (SELECT COUNT(*) FROM documents d WHERE d.request_id = q.request_id) AS doc_total,
      (SELECT COUNT(*) FROM documents d WHERE d.request_id = q.request_id AND d.received = 1) AS doc_done
    FROM requests q
    JOIN projects p ON p.project_id = q.project_id
    JOIN buildings b ON b.building_id = q.building_id
    LEFT JOIN vendors v ON v.vendor_id = q.vendor_id
    LEFT JOIN payments pm ON pm.request_id = q.request_id
    WHERE ${where.join(' AND ')}
    ORDER BY q.total_amount DESC
    LIMIT ? OFFSET ?`).all(...args, limit, (Math.max(Number(page) || 1, 1) - 1) * limit);

  const docsOf = db.prepare(
    'SELECT doc_type, received, doc_date FROM documents WHERE request_id = ? ORDER BY document_id');
  const withAge = rows.map((x) => ({ ...x, ...docAgeLevel(x.payment_date), docs: docsOf.all(x.request_id) }))
    .filter((x) => !min_age || (x.days ?? 0) >= Number(min_age));

  res.json({
    requests: withAge,
    total_amount: round2(withAge.reduce((s, x) => s + x.total_amount, 0)),
    count: withAge.length,
  });
});

/** ติ๊กเอกสารทีละช่อง — เก็บวันที่บนเอกสารแยกจากวันที่ได้รับ (สเปก §7) */
r.post('/requests/:id/documents', requireCap('document.manage'), (req, res) => {
  const cur = getReq(req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  const b = req.body || {};
  const docType = String(b.doc_type || '').trim();
  if (!docType) return res.status(400).json({ error: 'ต้องระบุประเภทเอกสาร' });

  const allowedTypes = requiredDocuments({ header: cur, lines: getLines(cur.request_id) })
    .map((d) => d.doc_type);
  if (!allowedTypes.includes(docType))
    return res.status(400).json({ error: `ใบนี้ไม่ต้องใช้เอกสารประเภท "${docType}"`, allowed: allowedTypes });

  const received = b.received === false ? 0 : 1;
  const docDate = b.doc_date || null;
  // เดือนภาษีคำนวณจากวันที่บนใบกำกับ ไม่ใช่เดือนที่จ่ายเงิน (สเปก §7)
  const taxPeriod = docDate ? String(docDate).slice(0, 7) : null;
  const prev = db.prepare('SELECT * FROM documents WHERE request_id = ? AND doc_type = ?')
    .get(cur.request_id, docType);

  db.prepare(`INSERT INTO documents
      (request_id, doc_type, received, received_date, doc_date, tax_period, doc_no, amount, file_id, recorded_by, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))
    ON CONFLICT(request_id, doc_type) DO UPDATE SET
      received = excluded.received, received_date = excluded.received_date,
      doc_date = excluded.doc_date, tax_period = excluded.tax_period,
      doc_no = excluded.doc_no, amount = excluded.amount,
      file_id = COALESCE(excluded.file_id, documents.file_id),
      recorded_by = excluded.recorded_by, updated_at = datetime('now')`)
    .run(cur.request_id, docType, received,
      received ? (b.received_date || new Date().toISOString().slice(0, 10)) : null,
      docDate, taxPeriod, b.doc_no || '',
      b.amount != null ? round2(Number(b.amount)) : null,
      b.file_id ? Number(b.file_id) : null, req.user.user_id);

  if (b.file_id)
    db.prepare("UPDATE attachments SET request_id = ?, purpose = ? WHERE file_id = ?")
      .run(cur.request_id, docType, Number(b.file_id));

  audit({
    table: 'documents', recordId: `${cur.request_id}/${docType}`, field: 'received',
    oldValue: prev?.received ?? 0, newValue: received, action: 'บันทึกเอกสาร',
    userId: req.user.user_id, reason: docDate ? `วันที่บนเอกสาร ${docDate}` : '',
  });

  autoClose(cur.request_id, req.user.user_id);
  res.json({ request: fullRequest(cur.request_id) });
});

/** §4 "ปิดรายการ" = จ่ายแล้ว + ของมาครบ + เอกสารครบตามประเภท */
function autoClose(requestId, userId) {
  const cur = getReq(requestId);
  if (!cur || cur.status !== 'จ่ายแล้ว') return false;
  const lines = getLines(requestId);
  const needed = requiredDocuments({ header: cur, lines }).map((d) => d.doc_type);
  const done = new Set(db.prepare('SELECT doc_type FROM documents WHERE request_id = ? AND received = 1')
    .all(requestId).map((d) => d.doc_type));
  const needsGoods = lines.some((l) => l.cost_type === 'ของ');
  if (needsGoods && !cur.goods_received) return false;
  if (!needed.every((t) => done.has(t))) return false;
  db.prepare("UPDATE requests SET status = 'ปิดรายการ', closed_at = datetime('now') WHERE request_id = ?")
    .run(requestId);
  audit({
    table: 'requests', recordId: requestId, field: 'status', oldValue: 'จ่ายแล้ว',
    newValue: 'ปิดรายการ', action: 'ปิดรายการอัตโนมัติ (เอกสารครบ)', userId,
  });
  return true;
}

/** ปิดรายการด้วยมือ — ตรวจเงื่อนไขเดียวกัน */
r.post('/requests/:id/close', requireCap('request.close'), (req, res) => {
  const ok = autoClose(req.params.id, req.user.user_id);
  if (!ok) return res.status(400).json({ error: 'ยังปิดรายการไม่ได้ — ต้องจ่ายแล้ว ของมาครบ และเอกสารครบทุกช่อง' });
  res.json({ request: fullRequest(req.params.id) });
});

/** รายงานภาษีซื้อตามเดือนบนใบกำกับ (ไม่ใช่เดือนที่จ่ายเงิน) — ใช้เตรียมยื่น ภ.พ.30 */
r.get('/documents/tax-periods', (_req, res) => {
  const rows = db.prepare(`SELECT d.tax_period,
      COUNT(*) AS n, COALESCE(SUM(q.vat_amount),0) AS input_vat,
      COALESCE(SUM(q.amount_before_vat),0) AS base
    FROM documents d
    JOIN requests q ON q.request_id = d.request_id
    WHERE d.doc_type = 'ใบกำกับภาษี' AND d.received = 1 AND d.tax_period IS NOT NULL
    GROUP BY d.tax_period ORDER BY d.tax_period DESC`).all();
  const mismatched = db.prepare(`SELECT COUNT(*) AS n FROM documents d
    JOIN payments pm ON pm.request_id = d.request_id
    WHERE d.doc_type = 'ใบกำกับภาษี' AND d.received = 1
      AND substr(d.doc_date,1,7) <> substr(pm.payment_date,1,7)`).get().n;
  res.json({ periods: rows, cross_month_count: mismatched });
});

export default r;
