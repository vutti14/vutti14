import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { db, audit, nextDocNo, round2, UPLOAD_DIR } from '../db.js';
import { requireAuth, requireCap, can, allowedProjectIds } from '../auth.js';
import {
  validateRequest, computeTotals, evaluateFlags, selfApprovalFlag, legacyCode,
  requiredDocuments, FROZEN_STATUSES, EDITABLE_META_FIELDS,
} from '../rules.js';

const r = Router();
r.use(requireAuth);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) =>
      cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).slice(0, 10)),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

// ---------------------------------------------------------------- helpers
const getVendor = (id) => (id ? db.prepare('SELECT * FROM vendors WHERE vendor_id = ?').get(id) : null);
const getLines = (id) => db.prepare('SELECT * FROM request_lines WHERE request_id = ? ORDER BY line_no').all(id);
const getReq = (id) => db.prepare('SELECT * FROM requests WHERE request_id = ?').get(id);

function projectFilter(user) {
  const allowed = allowedProjectIds(user);
  return allowed === null ? null : (allowed.length ? allowed : [' ']);
}

function assertVisible(user, request) {
  const allowed = projectFilter(user);
  if (allowed && !allowed.includes(request.project_id)) {
    const e = new Error('คุณไม่มีสิทธิ์เข้าถึงใบเบิกของโครงการนี้');
    e.status = 403; throw e;
  }
}

/** SERVICE ทำได้เฉพาะงานซ่อมบำรุง (สเปก §3.1) */
function assertServiceScope(user, buildingId) {
  if (user.role !== 'SERVICE') return;
  const b = db.prepare('SELECT work_nature FROM buildings WHERE building_id = ?').get(buildingId);
  if (b?.work_nature !== 'ซ่อมบำรุง') {
    const e = new Error('บทบาทช่างซ่อมบำรุงสร้างใบเบิกได้เฉพาะอาคารที่เป็นงานซ่อมบำรุง');
    e.status = 403; throw e;
  }
}

function attachmentCount(id) {
  return db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE request_id = ? AND purpose = 'หลักฐานใบเบิก'").get(id).n;
}

function normalizeLines(input) {
  return (input || []).map((l, i) => {
    const qty = Number(l.qty ?? 1);
    const price = Number(l.unit_price ?? 0);
    const amount = l.line_amount != null ? round2(Number(l.line_amount)) : round2(qty * price);
    return {
      line_no: i + 1,
      cost_code: String(l.cost_code || '').trim(),
      cost_type: String(l.cost_type || '').trim(),
      item_id: l.item_id || null,
      description: String(l.description || '').trim(),
      qty,
      unit: String(l.unit || '').trim(),
      unit_price: round2(price),
      line_amount: amount,
      ref_price: l.ref_price != null ? Number(l.ref_price) : null,
      price_diff_pct: null,
    };
  });
}

function saveLines(requestId, lines) {
  db.prepare('DELETE FROM request_lines WHERE request_id = ?').run(requestId);
  const stmt = db.prepare(`INSERT INTO request_lines
    (request_id, line_no, cost_code, cost_type, item_id, description, qty, unit,
     unit_price, line_amount, ref_price, price_diff_pct)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const l of lines) {
    let ref = l.ref_price;
    let diff = null;
    if (l.item_id) {
      ref = ref ?? db.prepare('SELECT ref_price_min FROM items WHERE item_id = ?').get(l.item_id)?.ref_price_min ?? null;
      if (ref > 0 && l.unit_price > 0) diff = round2(((l.unit_price - ref) / ref) * 100);
    }
    stmt.run(requestId, l.line_no, l.cost_code, l.cost_type, l.item_id, l.description,
      l.qty, l.unit, l.unit_price, l.line_amount, ref, diff);
  }
}

/** ประกอบใบเบิกฉบับเต็มสำหรับส่งกลับหน้าจอ */
function fullRequest(id) {
  const req = db.prepare(`SELECT q.*, p.project_name, b.building_name, b.design_code, b.work_nature,
      v.vendor_name, v.entity_type, v.wht_percent, v.doc_status AS vendor_doc_status,
      ru.display_name AS requester_name, au.display_name AS approver_name
    FROM requests q
    JOIN projects p ON p.project_id = q.project_id
    JOIN buildings b ON b.building_id = q.building_id
    LEFT JOIN vendors v ON v.vendor_id = q.vendor_id
    JOIN users ru ON ru.user_id = q.requester_id
    LEFT JOIN users au ON au.user_id = q.approver_id
    WHERE q.request_id = ?`).get(id);
  if (!req) return null;
  const lines = getLines(id);
  return {
    ...req,
    flags: JSON.parse(req.flags || '[]'),
    lines,
    documents: db.prepare('SELECT * FROM documents WHERE request_id = ? ORDER BY document_id').all(id),
    required_documents: requiredDocuments({ header: req, lines }),
    payment: db.prepare(`SELECT pm.*, u.display_name AS paid_by_name FROM payments pm
                         LEFT JOIN users u ON u.user_id = pm.paid_by WHERE pm.request_id = ?`).get(id) || null,
    attachments: db.prepare(`SELECT file_id, orig_name, mime_type, size_bytes, purpose, uploaded_at
                             FROM attachments WHERE request_id = ?`).all(id),
    reversals: db.prepare('SELECT * FROM reversals WHERE request_id = ? ORDER BY reversal_id').all(id),
  };
}

// ---------------------------------------------------------------- รายการใบเบิก
r.get('/requests', (req, res) => {
  const { status, project_id, building_id, vendor_id, requester_id, from, to, q,
    value_source, flagged, page = 1, per_page = 50 } = req.query;
  const where = [];
  const args = [];
  const allowed = projectFilter(req.user);
  if (allowed) { where.push(`q.project_id IN (${allowed.map(() => '?').join(',')})`); args.push(...allowed); }
  if (status) {
    const list = String(status).split(',');
    where.push(`q.status IN (${list.map(() => '?').join(',')})`);
    args.push(...list);
  }
  if (project_id) { where.push('q.project_id = ?'); args.push(project_id); }
  if (building_id) { where.push('q.building_id = ?'); args.push(building_id); }
  if (vendor_id) { where.push('q.vendor_id = ?'); args.push(vendor_id); }
  if (requester_id) { where.push('q.requester_id = ?'); args.push(requester_id); }
  if (from) { where.push('q.request_date >= ?'); args.push(from); }
  if (to) { where.push('q.request_date <= ?'); args.push(to); }
  if (value_source) { where.push('q.value_source = ?'); args.push(value_source); }
  if (flagged === '1') where.push("q.flags <> '[]'");
  if (q) {
    where.push('(q.request_id LIKE ? OR q.note LIKE ? OR v.vendor_name LIKE ? OR b.building_name LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Number(per_page) || 50, 500);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const rows = db.prepare(`SELECT q.request_id, q.request_date, q.status, q.total_amount, q.net_amount,
      q.wht_amount, q.flags, q.value_source, q.confidence, q.project_id, q.building_id, q.vendor_id,
      q.requester_id, q.goods_received, q.note,
      p.project_name, b.building_name, v.vendor_name, u.display_name AS requester_name
    FROM requests q
    JOIN projects p ON p.project_id = q.project_id
    JOIN buildings b ON b.building_id = q.building_id
    LEFT JOIN vendors v ON v.vendor_id = q.vendor_id
    JOIN users u ON u.user_id = q.requester_id
    ${w} ORDER BY q.request_date DESC, q.request_id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);

  const agg = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(q.total_amount),0) AS total
    FROM requests q
    JOIN projects p ON p.project_id = q.project_id
    JOIN buildings b ON b.building_id = q.building_id
    LEFT JOIN vendors v ON v.vendor_id = q.vendor_id
    ${w}`).get(...args);

  res.json({
    requests: rows.map((x) => ({ ...x, flags: JSON.parse(x.flags || '[]') })),
    total_count: agg.n,
    total_amount: round2(agg.total),
    page: Number(page) || 1,
    per_page: limit,
  });
});

r.get('/requests/:id', (req, res) => {
  const full = fullRequest(req.params.id);
  if (!full) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  assertVisible(req.user, full);
  res.json({ request: full });
});

// ---------------------------------------------------------------- สร้าง / แก้ไข
function buildAndValidate(header, lines, { forSubmit, excludeRequestId, pendingAttachments = 0 }) {
  const vendor = getVendor(header.vendor_id);
  const { errors, totals } = validateRequest({
    header,
    lines,
    vendor,
    attachmentCount: (excludeRequestId ? attachmentCount(excludeRequestId) : 0) + pendingAttachments,
    forSubmit,
  });
  const flags = errors.length ? [] : evaluateFlags({ header, lines, vendor, totals, excludeRequestId });
  return { vendor, errors, totals, flags };
}

r.post('/requests', requireCap('request.create'), (req, res) => {
  const b = req.body || {};
  const submit = !!b.submit;
  const lines = normalizeLines(b.lines);
  const header = {
    request_date: b.request_date || new Date().toISOString().slice(0, 10),
    requester_id: req.user.user_id,
    project_id: b.project_id,
    building_id: b.building_id,
    vendor_id: b.vendor_id || null,
    has_vat: b.has_vat || 'ไม่มี',
    vat_mode: b.vat_mode || 'แยก VAT',
    is_petty_cash: b.is_petty_cash ? 1 : 0,
    note: b.note || '',
    total_amount: b.total_amount,
  };
  if (header.building_id) {
    const bl = db.prepare('SELECT building_name, project_id FROM buildings WHERE building_id = ?').get(header.building_id);
    if (!bl) return res.status(400).json({ error: 'ไม่พบอาคารที่เลือก' });
    if (bl.project_id !== header.project_id)
      return res.status(400).json({ error: 'อาคารที่เลือกไม่ได้อยู่ในโครงการนี้' });
    assertServiceScope(req.user, header.building_id);
  }
  assertVisible(req.user, header);

  // ไฟล์ที่อัปโหลดไว้ก่อน (ยังไม่ผูกกับใบ) นับเป็นไฟล์แนบของใบนี้ตอนตรวจกฎ B6
  const attachIds = (Array.isArray(b.attachment_ids) ? b.attachment_ids : [])
    .map(Number).filter((n) => Number.isInteger(n));
  const pendingAttachments = attachIds.length
    ? db.prepare(`SELECT COUNT(*) AS n FROM attachments
                  WHERE file_id IN (${attachIds.map(() => '?').join(',')})
                    AND uploaded_by = ? AND request_id IS NULL`).get(...attachIds, req.user.user_id).n
    : 0;

  const { errors, totals, flags } = buildAndValidate(header, lines,
    { forSubmit: submit, excludeRequestId: null, pendingAttachments });
  if (errors.length) return res.status(400).json({ error: errors[0].message, errors });

  const id = nextDocNo('REQ', 'requests', 'request_id', header.request_date);
  const bname = db.prepare('SELECT building_name FROM buildings WHERE building_id = ?')
    .get(header.building_id)?.building_name;
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO requests
      (request_id, request_date, requester_id, project_id, building_id, vendor_id, has_vat, vat_mode,
       amount_before_vat, vat_amount, total_amount, wht_amount, net_amount, status, legacy_code,
       submitted_at, flags, is_petty_cash, value_source, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ข้อเท็จจริง', ?)`)
      .run(id, header.request_date, req.user.user_id, header.project_id, header.building_id,
        header.vendor_id, header.has_vat, header.vat_mode,
        totals.amount_before_vat, totals.vat_amount, totals.total_amount,
        totals.wht_amount, totals.net_amount,
        submit ? 'รออนุมัติ' : 'ร่าง',
        legacyCode({
          requesterId: req.user.user_id, projectId: header.project_id,
          buildingName: bname, costCode: lines[0]?.cost_code,
        }),
        submit ? new Date().toISOString() : null,
        JSON.stringify(flags), header.is_petty_cash, header.note);
    saveLines(id, lines);
    // จำค่าล่าสุดที่ใช้ เป็นค่าตั้งต้นครั้งหน้า (สเปก §8 S1)
    db.prepare('UPDATE users SET last_project_id = ?, last_building_id = ? WHERE user_id = ?')
      .run(header.project_id, header.building_id, req.user.user_id);
    if (attachIds.length)
      db.prepare(`UPDATE attachments SET request_id = ?
                  WHERE file_id IN (${attachIds.map(() => '?').join(',')})
                    AND uploaded_by = ? AND request_id IS NULL`)
        .run(id, ...attachIds, req.user.user_id);
    audit({
      table: 'requests', recordId: id, action: submit ? 'สร้างและส่งขออนุมัติ' : 'สร้างร่าง',
      userId: req.user.user_id, newValue: totals.total_amount,
    });
  });
  tx();
  res.status(201).json({ request: fullRequest(id), flags });
});

r.put('/requests/:id', (req, res) => {
  const cur = getReq(req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  assertVisible(req.user, cur);
  const isOwner = cur.requester_id === req.user.user_id;
  const canEdit = ['ร่าง', 'รออนุมัติ'].includes(cur.status) &&
    (isOwner || can(req.user, 'request.edit.meta'));
  if (!canEdit)
    return res.status(403).json({ error: 'แก้ไขได้เฉพาะใบของตัวเองที่ยังไม่ผ่านการอนุมัติ' });

  const b = req.body || {};
  const submit = !!b.submit;
  const lines = normalizeLines(b.lines ?? getLines(cur.request_id));
  const header = {
    ...cur,
    request_date: b.request_date || cur.request_date,
    project_id: b.project_id || cur.project_id,
    building_id: b.building_id || cur.building_id,
    vendor_id: b.vendor_id !== undefined ? b.vendor_id : cur.vendor_id,
    has_vat: b.has_vat || cur.has_vat,
    vat_mode: b.vat_mode || cur.vat_mode,
    is_petty_cash: b.is_petty_cash != null ? (b.is_petty_cash ? 1 : 0) : cur.is_petty_cash,
    note: b.note != null ? b.note : cur.note,
    total_amount: b.total_amount,
  };
  if (header.building_id !== cur.building_id) assertServiceScope(req.user, header.building_id);

  const { errors, totals, flags } = buildAndValidate(header, lines,
    { forSubmit: submit || cur.status === 'รออนุมัติ', excludeRequestId: cur.request_id });
  if (errors.length) return res.status(400).json({ error: errors[0].message, errors });

  const tx = db.transaction(() => {
    db.prepare(`UPDATE requests SET request_date=?, project_id=?, building_id=?, vendor_id=?,
      has_vat=?, vat_mode=?, amount_before_vat=?, vat_amount=?, total_amount=?, wht_amount=?,
      net_amount=?, is_petty_cash=?, note=?, flags=?, status=?, submitted_at=COALESCE(submitted_at, ?),
      updated_at=datetime('now') WHERE request_id=?`)
      .run(header.request_date, header.project_id, header.building_id, header.vendor_id,
        header.has_vat, header.vat_mode, totals.amount_before_vat, totals.vat_amount,
        totals.total_amount, totals.wht_amount, totals.net_amount, header.is_petty_cash,
        header.note, JSON.stringify(flags),
        submit ? 'รออนุมัติ' : cur.status,
        submit ? new Date().toISOString() : null, cur.request_id);
    saveLines(cur.request_id, lines);
    if (Math.abs(cur.total_amount - totals.total_amount) > 0.01)
      audit({
        table: 'requests', recordId: cur.request_id, field: 'total_amount',
        oldValue: cur.total_amount, newValue: totals.total_amount,
        userId: req.user.user_id, reason: b.reason || '',
      });
    if (submit && cur.status === 'ร่าง')
      audit({ table: 'requests', recordId: cur.request_id, action: 'ส่งขออนุมัติ', userId: req.user.user_id });
  });
  tx();
  res.json({ request: fullRequest(cur.request_id), flags });
});

/** §4 ยอดใบที่จ่ายแล้วแก้ไม่ได้ตลอดกาล — แก้ได้เฉพาะข้อมูลประกอบ และต้องลง audit_log */
r.patch('/requests/:id/meta', (req, res) => {
  const cur = getReq(req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  assertVisible(req.user, cur);
  if (!['CEO', 'COO', 'ACCOUNT', 'PM', 'SERVICE'].includes(req.user.role))
    return res.status(403).json({ error: 'บทบาทของคุณแก้ข้อมูลประกอบไม่ได้' });
  const reason = String(req.body?.reason || '').trim();
  if (FROZEN_STATUSES.includes(cur.status) && !reason)
    return res.status(400).json({ error: 'ต้องระบุเหตุผลในการแก้ข้อมูลของใบที่จ่ายแล้ว' });

  const changed = [];
  for (const f of EDITABLE_META_FIELDS) {
    if (req.body?.[f] === undefined || String(cur[f] ?? '') === String(req.body[f] ?? '')) continue;
    if (f === 'building_id') {
      const bl = db.prepare('SELECT project_id FROM buildings WHERE building_id = ?').get(req.body[f]);
      if (!bl) return res.status(400).json({ error: 'ไม่พบอาคารปลายทาง' });
      if (bl.project_id !== cur.project_id) {
        db.prepare('UPDATE requests SET project_id = ? WHERE request_id = ?').run(bl.project_id, cur.request_id);
        audit({
          table: 'requests', recordId: cur.request_id, field: 'project_id',
          oldValue: cur.project_id, newValue: bl.project_id, userId: req.user.user_id, reason,
        });
      }
    }
    db.prepare(`UPDATE requests SET ${f} = ?, updated_at = datetime('now') WHERE request_id = ?`)
      .run(req.body[f], cur.request_id);
    audit({
      table: 'requests', recordId: cur.request_id, field: f, oldValue: cur[f],
      newValue: req.body[f], userId: req.user.user_id, reason,
    });
    changed.push(f);
  }
  res.json({ request: fullRequest(cur.request_id), changed });
});

r.delete('/requests/:id', (req, res) => {
  const cur = getReq(req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  if (cur.status !== 'ร่าง') return res.status(400).json({ error: 'ลบได้เฉพาะใบที่ยังเป็นร่าง' });
  if (cur.requester_id !== req.user.user_id && req.user.role !== 'CEO')
    return res.status(403).json({ error: 'ลบได้เฉพาะร่างของตัวเอง' });
  db.prepare('DELETE FROM requests WHERE request_id = ?').run(cur.request_id);
  audit({ table: 'requests', recordId: cur.request_id, action: 'ลบร่าง', userId: req.user.user_id });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- วงจรสถานะ
r.post('/requests/:id/submit', (req, res) => {
  const cur = getReq(req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  if (cur.requester_id !== req.user.user_id && !can(req.user, 'request.approve'))
    return res.status(403).json({ error: 'ส่งขออนุมัติได้เฉพาะใบของตัวเอง' });
  if (cur.status !== 'ร่าง') return res.status(400).json({ error: 'ส่งได้เฉพาะใบที่เป็นร่าง' });

  const lines = getLines(cur.request_id);
  const { errors, flags } = buildAndValidate(cur, lines,
    { forSubmit: true, excludeRequestId: cur.request_id });
  if (errors.length) return res.status(400).json({ error: errors[0].message, errors });

  db.prepare("UPDATE requests SET status = 'รออนุมัติ', submitted_at = ?, flags = ? WHERE request_id = ?")
    .run(new Date().toISOString(), JSON.stringify(flags), cur.request_id);
  audit({ table: 'requests', recordId: cur.request_id, action: 'ส่งขออนุมัติ', userId: req.user.user_id });
  res.json({ request: fullRequest(cur.request_id) });
});

r.post('/requests/:id/withdraw', (req, res) => {
  const cur = getReq(req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  if (cur.status !== 'รออนุมัติ') return res.status(400).json({ error: 'ถอนได้เฉพาะใบที่รออนุมัติ' });
  if (cur.requester_id !== req.user.user_id) return res.status(403).json({ error: 'ถอนได้เฉพาะใบของตัวเอง' });
  db.prepare("UPDATE requests SET status = 'ยกเลิก', cancel_reason = ? WHERE request_id = ?")
    .run(String(req.body?.reason || 'ผู้ขอยกเลิกเอง'), cur.request_id);
  audit({
    table: 'requests', recordId: cur.request_id, action: 'ผู้ขอยกเลิก',
    userId: req.user.user_id, reason: req.body?.reason || '',
  });
  res.json({ request: fullRequest(cur.request_id) });
});

function approveOne(user, id, { acknowledgeFlags }) {
  const cur = getReq(id);
  if (!cur) return { id, ok: false, error: 'ไม่พบใบเบิก' };
  if (cur.status !== 'รออนุมัติ') return { id, ok: false, error: `สถานะปัจจุบันคือ ${cur.status}` };

  const lines = getLines(id);
  const vendor = getVendor(cur.vendor_id);
  const totals = computeTotals({ lines, hasVat: cur.has_vat, vatMode: cur.vat_mode, vendor });
  const flags = evaluateFlags({ header: cur, lines, vendor, totals, excludeRequestId: id });
  const self = selfApprovalFlag(cur, user.user_id); // W7
  if (self) flags.push(self);

  // §8 S2 — ใบที่มีธงต้องเปิดดูและกดทีละใบ
  if (flags.length && !acknowledgeFlags)
    return { id, ok: false, error: 'ใบนี้ติดธงเตือน ต้องเปิดดูและยืนยันทีละใบ', flags, requires_ack: true };

  const seconds = cur.submitted_at
    ? Math.max(0, Math.round((Date.now() - new Date(cur.submitted_at)) / 1000)) : null;
  db.prepare(`UPDATE requests SET status = 'อนุมัติแล้ว', approver_id = ?, approved_at = ?,
              approval_seconds = ?, flags = ? WHERE request_id = ?`)
    .run(user.user_id, new Date().toISOString(), seconds, JSON.stringify(flags), id);
  audit({
    table: 'requests', recordId: id, field: 'status', oldValue: 'รออนุมัติ', newValue: 'อนุมัติแล้ว',
    action: 'อนุมัติ', userId: user.user_id, reason: self ? 'ใบของผู้อนุมัติเอง' : '',
  });
  return { id, ok: true, flags };
}

r.post('/requests/bulk-approve', requireCap('request.approve'), (req, res) => {
  const ids = Array.isArray(req.body?.request_ids) ? req.body.request_ids : [];
  if (!ids.length) return res.status(400).json({ error: 'ยังไม่ได้เลือกใบเบิก' });
  const results = ids.map((id) => approveOne(req.user, id, { acknowledgeFlags: false }));
  res.json({
    approved: results.filter((x) => x.ok).map((x) => x.id),
    skipped: results.filter((x) => !x.ok),
  });
});

r.post('/requests/:id/approve', requireCap('request.approve'), (req, res) => {
  const out = approveOne(req.user, req.params.id, { acknowledgeFlags: !!req.body?.acknowledge_flags });
  if (!out.ok) return res.status(out.requires_ack ? 409 : 400).json(out);
  res.json({ request: fullRequest(req.params.id), ...out });
});

r.post('/requests/:id/reject', requireCap('request.reject'), (req, res) => {
  const cur = getReq(req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  if (cur.status !== 'รออนุมัติ') return res.status(400).json({ error: 'ไม่อนุมัติได้เฉพาะใบที่รออนุมัติ' });
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'ต้องระบุเหตุผลที่ไม่อนุมัติ' });
  db.prepare(`UPDATE requests SET status = 'ไม่อนุมัติ', approver_id = ?, approved_at = ?,
              reject_reason = ? WHERE request_id = ?`)
    .run(req.user.user_id, new Date().toISOString(), reason, cur.request_id);
  audit({
    table: 'requests', recordId: cur.request_id, field: 'status', oldValue: cur.status,
    newValue: 'ไม่อนุมัติ', action: 'ไม่อนุมัติ', userId: req.user.user_id, reason,
  });
  res.json({ request: fullRequest(cur.request_id) });
});

/** §4 ยกเลิกใบหลังอนุมัติ — COO (และ CEO) เท่านั้น และต้องยังไม่จ่าย */
r.post('/requests/:id/cancel', requireCap('request.cancel'), (req, res) => {
  const cur = getReq(req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  if (cur.status !== 'อนุมัติแล้ว')
    return res.status(400).json({
      error: 'ยกเลิกได้เฉพาะใบที่อนุมัติแล้วแต่ยังไม่จ่าย — ใบที่จ่ายแล้วต้องออกใบกลับรายการ',
    });
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'ต้องระบุเหตุผลที่ยกเลิก' });
  db.prepare("UPDATE requests SET status = 'ยกเลิก', cancel_reason = ? WHERE request_id = ?")
    .run(reason, cur.request_id);
  audit({
    table: 'requests', recordId: cur.request_id, field: 'status', oldValue: cur.status,
    newValue: 'ยกเลิก', action: 'ยกเลิกหลังอนุมัติ', userId: req.user.user_id, reason,
  });
  res.json({ request: fullRequest(cur.request_id) });
});

/** PM ยืนยันว่าของมาแล้ว (สเปก §7) */
r.post('/requests/:id/goods-received', requireCap('goods.confirm'), (req, res) => {
  const cur = getReq(req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  assertVisible(req.user, cur);
  const received = req.body?.received === false ? 0 : 1;
  db.prepare(`UPDATE requests SET goods_received = ?, goods_received_at = ?, goods_received_by = ?
              WHERE request_id = ?`)
    .run(received, received ? (req.body?.date || new Date().toISOString().slice(0, 10)) : null,
      received ? req.user.user_id : null, cur.request_id);
  audit({
    table: 'requests', recordId: cur.request_id, field: 'goods_received',
    oldValue: cur.goods_received, newValue: received, action: 'ยืนยันของมาแล้ว', userId: req.user.user_id,
  });
  res.json({ request: fullRequest(cur.request_id) });
});

// ---------------------------------------------------------------- ไฟล์แนบ
r.post('/requests/:id/attachments', upload.array('files', 10), (req, res) => {
  const id = req.params.id === 'new' ? null : req.params.id;
  if (id) {
    const cur = getReq(id);
    if (!cur) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
    assertVisible(req.user, cur);
  }
  const purpose = String(req.body?.purpose || 'หลักฐานใบเบิก');
  const stmt = db.prepare(`INSERT INTO attachments
    (stored_name, orig_name, mime_type, size_bytes, request_id, purpose, uploaded_by)
    VALUES (?,?,?,?,?,?,?)`);
  const files = (req.files || []).map((f) => {
    const origName = Buffer.from(f.originalname, 'latin1').toString('utf8');
    const info = stmt.run(f.filename, origName, f.mimetype, f.size, id, purpose, req.user.user_id);
    return { file_id: info.lastInsertRowid, orig_name: origName, size_bytes: f.size };
  });
  res.status(201).json({ files });
});

r.get('/files/:fileId', (req, res) => {
  const f = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(req.params.fileId);
  if (!f) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  if (f.request_id) {
    const cur = getReq(f.request_id);
    if (cur) assertVisible(req.user, cur);
  }
  const p = path.join(UPLOAD_DIR, f.stored_name);
  if (!fs.existsSync(p)) return res.status(410).json({ error: 'ไฟล์หายจากเซิร์ฟเวอร์' });
  res.setHeader('Content-Type', f.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(f.orig_name)}`);
  fs.createReadStream(p).pipe(res);
});

r.delete('/files/:fileId', (req, res) => {
  const f = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(req.params.fileId);
  if (!f) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  if (f.uploaded_by !== req.user.user_id && req.user.role !== 'CEO')
    return res.status(403).json({ error: 'ลบได้เฉพาะไฟล์ที่ตัวเองอัปโหลด' });
  if (f.request_id) {
    const cur = getReq(f.request_id);
    if (cur && FROZEN_STATUSES.includes(cur.status))
      return res.status(400).json({ error: 'ใบที่จ่ายแล้วลบไฟล์แนบไม่ได้' });
  }
  db.prepare('DELETE FROM attachments WHERE file_id = ?').run(f.file_id);
  fs.rmSync(path.join(UPLOAD_DIR, f.stored_name), { force: true });
  audit({ table: 'attachments', recordId: f.file_id, action: 'ลบไฟล์แนบ', userId: req.user.user_id });
  res.json({ ok: true });
});

export { fullRequest, getReq, getLines, projectFilter, assertVisible };
export default r;
