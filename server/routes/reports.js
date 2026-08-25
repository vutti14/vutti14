import { Router } from 'express';
import { db, round2, getSetting } from '../db.js';
import { requireAuth } from '../auth.js';
import { projectFilter } from './requests.js';

const r = Router();
r.use(requireAuth);

const SPENT = "q.status IN ('จ่ายแล้ว','ปิดรายการ')";
// วันที่ใช้เงินจริง: ใบใหม่ใช้วันจ่าย · ใบนำเข้าย้อนหลังไม่มี payment จึงถอยไปใช้วันที่ขอ
const SPEND_DATE = "COALESCE((SELECT pm.payment_date FROM payments pm WHERE pm.request_id = q.request_id), q.request_date)";
// §9 ตัวเลขเรื่องเอกสาร/ของมาแล้ว นับเฉพาะข้อมูลที่ระบบติดตามเอง ไม่รวมข้อมูลนำเข้าย้อนหลัง
const TRACKED = "q.value_source <> 'นำเข้าย้อนหลัง'";

/** เงื่อนไขจำกัดโครงการตามสิทธิ์ + ตัวกรองร่วมของทุกรายงาน */
function scope(req) {
  const where = [];
  const args = [];
  const allowed = projectFilter(req.user);
  if (allowed) { where.push(`q.project_id IN (${allowed.map(() => '?').join(',')})`); args.push(...allowed); }
  const { from, to, project_id, value_source, exclude_non_project, group_asset } = req.query;
  if (from) { where.push(`${SPEND_DATE} >= ?`); args.push(from); }
  if (to) { where.push(`${SPEND_DATE} <= ?`); args.push(to); }
  if (project_id) { where.push('q.project_id = ?'); args.push(project_id); }
  if (value_source) { where.push('q.value_source = ?'); args.push(value_source); }
  if (exclude_non_project === '1')
    where.push('q.project_id IN (SELECT project_id FROM projects WHERE is_real_project = 1)');
  // v9 §29 — แยกทรัพย์สินกลุ่มออกจากงานรับเหมา/งานส่วนตัว ก่อนคิดต้นทุนทรัพย์สิน
  if (group_asset === '1' || group_asset === '0')
    where.push(`q.project_id IN (SELECT project_id FROM projects WHERE is_group_asset = ${group_asset === '1' ? 1 : 0})`);
  return { clause: where.length ? ' AND ' + where.join(' AND ') : '', args };
}

// ---------------------------------------------------------------- S5 Dashboard
r.get('/dashboard', (req, res) => {
  const { clause, args } = scope(req);
  const today = new Date();
  const thisMonth = today.toISOString().slice(0, 7);
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 7);

  const monthSpend = (ym) => round2(db.prepare(
    `SELECT COALESCE(SUM(q.total_amount),0) AS s FROM requests q
     WHERE ${SPENT} AND substr(${SPEND_DATE},1,7) = ?${clause}`).get(ym, ...args).s);

  const pending = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(q.total_amount),0) AS s FROM requests q
     WHERE q.status = 'รออนุมัติ'${clause}`).get(...args);

  const approvalTime = db.prepare(
    `SELECT AVG(q.approval_seconds) AS avg_sec, COUNT(*) AS n FROM requests q
     WHERE q.approval_seconds IS NOT NULL${clause}`).get(...args);

  const awaitingDocs = db.prepare(
    `SELECT COALESCE(SUM(q.total_amount),0) AS s, COUNT(*) AS n FROM requests q
     WHERE q.status = 'จ่ายแล้ว' AND ${TRACKED}${clause}`).get(...args);

  // ตัวเลขที่ไม่เคยมีใครเห็น: ของที่จ่ายแล้วยังไม่มา
  const goodsNotArrived = db.prepare(
    `SELECT COALESCE(SUM(q.total_amount),0) AS s, COUNT(*) AS n FROM requests q
     WHERE ${SPENT} AND ${TRACKED} AND q.goods_received = 0
       AND EXISTS (SELECT 1 FROM request_lines l WHERE l.request_id = q.request_id AND l.cost_type = 'ของ')
     ${clause}`).get(...args);

  const inputVatStuck = db.prepare(
    `SELECT COALESCE(SUM(q.vat_amount),0) AS s, COUNT(*) AS n FROM requests q
     WHERE ${SPENT} AND ${TRACKED} AND q.has_vat = 'มี'
       AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.request_id = q.request_id
                        AND d.doc_type = 'ใบกำกับภาษี' AND d.received = 1)${clause}`).get(...args);

  // เงินออกรายเดือน 12 เดือนย้อนหลัง
  const monthly = db.prepare(
    `SELECT substr(${SPEND_DATE},1,7) AS ym, COALESCE(SUM(q.total_amount),0) AS amount, COUNT(*) AS n
     FROM requests q WHERE ${SPENT}${clause}
     GROUP BY ym ORDER BY ym DESC LIMIT 12`).all(...args).reverse();

  // แยกตามประเภทต้นทุน เทียบสัดส่วนอ้างอิงจาก BOQ (70.6 / 27.8 / 1.6)
  const byType = db.prepare(
    `SELECT l.cost_type, COALESCE(SUM(l.line_amount),0) AS amount, COUNT(*) AS n
     FROM request_lines l JOIN requests q ON q.request_id = l.request_id
     WHERE ${SPENT}${clause} GROUP BY l.cost_type ORDER BY amount DESC`).all(...args);
  const typeTotal = byType.reduce((s, x) => s + x.amount, 0) || 1;

  // ความเชื่อถือของข้อมูลนำเข้า — ระดับ C ต้องแสดงเป็นสีต่าง (สเปก §9)
  const byConfidence = db.prepare(
    `SELECT COALESCE(q.confidence,'-') AS confidence, COALESCE(SUM(q.total_amount),0) AS amount, COUNT(*) AS n
     FROM requests q WHERE ${SPENT}${clause} GROUP BY confidence ORDER BY confidence`).all(...args);

  const bySource = db.prepare(
    `SELECT q.value_source, COALESCE(SUM(q.total_amount),0) AS amount, COUNT(*) AS n
     FROM requests q WHERE ${SPENT}${clause} GROUP BY q.value_source`).all(...args);

  // v9 §29 — 964,690 บาท (6.4%) ไม่ใช่ทรัพย์สินกลุ่ม ต้องแยกก่อนคิดค่าเสื่อม
  const assetSplit = db.prepare(
    `SELECT p.is_group_asset, COUNT(*) AS n, COALESCE(SUM(q.total_amount),0) AS amount
     FROM requests q JOIN projects p ON p.project_id = q.project_id
     WHERE ${SPENT}${clause} GROUP BY p.is_group_asset`).all(...args);

  // v9 §25 — จ่ายเงินให้ทีมงานของเราเอง
  const staffPay = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(q.total_amount),0) AS amount,
        SUM(q.self_paid) AS self_n,
        COALESCE(SUM(CASE WHEN q.self_paid = 1 THEN q.total_amount ELSE 0 END),0) AS self_amount
     FROM requests q WHERE ${SPENT} AND q.paid_to_staff = 1${clause}`).get(...args);

  const cur = monthSpend(thisMonth);
  const prv = monthSpend(prev);

  res.json({
    kpi: {
      spend_this_month: cur,
      spend_prev_month: prv,
      spend_change_pct: prv > 0 ? round2(((cur - prv) / prv) * 100) : null,
      pending_count: pending.n,
      pending_amount: round2(pending.s),
      avg_approval_seconds: approvalTime.avg_sec ? Math.round(approvalTime.avg_sec) : null,
      approval_sample: approvalTime.n,
      awaiting_documents_amount: round2(awaitingDocs.s),
      awaiting_documents_count: awaitingDocs.n,
      goods_not_arrived_amount: round2(goodsNotArrived.s),
      goods_not_arrived_count: goodsNotArrived.n,
      input_vat_stuck_amount: round2(inputVatStuck.s),
      input_vat_stuck_count: inputVatStuck.n,
    },
    monthly,
    cost_type_mix: byType.map((x) => ({ ...x, amount: round2(x.amount), pct: round2((x.amount / typeTotal) * 100) })),
    boq_reference_mix: { 'ของ': 70.6, 'แรง': 27.8, 'เช่า': 1.6 },
    confidence: byConfidence.map((x) => ({ ...x, amount: round2(x.amount) })),
    value_source: bySource.map((x) => ({ ...x, amount: round2(x.amount) })),
    asset_split: assetSplit.map((x) => ({
      label: x.is_group_asset ? 'ทรัพย์สินกลุ่ม' : 'งานอื่น (รับเหมา · ส่วนตัว · หน่วยธุรกิจอื่น)',
      is_group_asset: !!x.is_group_asset, n: x.n, amount: round2(x.amount),
    })),
    staff_payments: {
      count: staffPay.n, amount: round2(staffPay.amount),
      self_count: staffPay.self_n || 0, self_amount: round2(staffPay.self_amount),
    },
    cutover_date: getSetting('cutover_date'),
  });
});

// ---------------------------------------------------------------- ตารางสรุป
r.get('/by-project', (req, res) => {
  const { clause, args } = scope(req);
  res.json({
    rows: db.prepare(`SELECT q.project_id, p.project_name, p.budget,
        p.project_type, p.asset_status, p.is_group_asset,
        COUNT(*) AS request_count, COALESCE(SUM(q.total_amount),0) AS spent
      FROM requests q JOIN projects p ON p.project_id = q.project_id
      WHERE ${SPENT}${clause}
      GROUP BY q.project_id ORDER BY spent DESC`).all(...args)
      .map((x) => ({ ...x, spent: round2(x.spent), used_pct: x.budget ? round2((x.spent / x.budget) * 100) : null })),
  });
});

r.get('/by-building', (req, res) => {
  const { clause, args } = scope(req);
  const rows = db.prepare(`SELECT q.building_id, b.building_name, b.project_id, p.project_name,
      b.design_code, b.area_sqm, b.budget, b.is_building, b.work_nature, b.status,
      COUNT(*) AS request_count, COALESCE(SUM(q.total_amount),0) AS spent,
      MIN(q.request_date) AS first_date, MAX(q.request_date) AS last_date
    FROM requests q
    JOIN buildings b ON b.building_id = q.building_id
    JOIN projects p ON p.project_id = q.project_id
    WHERE ${SPENT}${clause}
    GROUP BY q.building_id ORDER BY spent DESC`).all(...args);
  res.json({
    rows: rows.map((x) => ({
      ...x,
      spent: round2(x.spent),
      used_pct: x.budget ? round2((x.spent / x.budget) * 100) : null,
      cost_per_sqm: x.area_sqm ? round2(x.spent / x.area_sqm) : null,
      // §5.1 ระยะเวลาคำนวณอัตโนมัติจากวันเบิกใบแรก/ล่าสุด
      duration_days: x.first_date && x.last_date
        ? Math.round((new Date(x.last_date) - new Date(x.first_date)) / 864e5) : null,
    })),
  });
});

r.get('/by-vendor', (req, res) => {
  const { clause, args } = scope(req);
  res.json({
    rows: db.prepare(`SELECT q.vendor_id, COALESCE(v.vendor_name, '(ไม่ระบุผู้ขาย)') AS vendor_name,
        v.entity_type, v.doc_status, COUNT(*) AS request_count,
        COALESCE(SUM(q.total_amount),0) AS spent, COALESCE(SUM(q.wht_amount),0) AS wht
      FROM requests q LEFT JOIN vendors v ON v.vendor_id = q.vendor_id
      WHERE ${SPENT}${clause}
      GROUP BY q.vendor_id ORDER BY spent DESC`).all(...args)
      .map((x) => ({ ...x, spent: round2(x.spent), wht: round2(x.wht) })),
  });
});

r.get('/by-requester', (req, res) => {
  const { clause, args } = scope(req);
  res.json({
    // ยอดใช้จ่ายนับเฉพาะใบที่จ่ายแล้ว · ใบที่อนุมัติเองนับตั้งแต่ผ่านอนุมัติ (สเปก §3.3 ต้องนับแยก)
    rows: db.prepare(`SELECT q.requester_id, u.display_name, u.role,
        SUM(CASE WHEN ${SPENT} THEN 1 ELSE 0 END) AS request_count,
        COALESCE(SUM(CASE WHEN ${SPENT} THEN q.total_amount ELSE 0 END),0) AS spent,
        SUM(CASE WHEN q.approver_id = q.requester_id THEN 1 ELSE 0 END) AS self_approved_count,
        COALESCE(SUM(CASE WHEN q.approver_id = q.requester_id THEN q.total_amount ELSE 0 END),0) AS self_approved_amount
      FROM requests q JOIN users u ON u.user_id = q.requester_id
      WHERE q.status IN ('อนุมัติแล้ว','จ่ายแล้ว','ปิดรายการ')${clause}
      GROUP BY q.requester_id ORDER BY spent DESC`).all(...args)
      .map((x) => ({ ...x, spent: round2(x.spent), self_approved_amount: round2(x.self_approved_amount) })),
  });
});

r.get('/by-cost-code', (req, res) => {
  const { clause, args } = scope(req);
  res.json({
    rows: db.prepare(`SELECT l.cost_code, c.cost_name, c.work_group, c.status AS code_status,
        l.cost_type, COALESCE(SUM(l.line_amount),0) AS amount, COUNT(*) AS line_count
      FROM request_lines l
      JOIN requests q ON q.request_id = l.request_id
      LEFT JOIN cost_codes c ON c.cost_code = l.cost_code
      WHERE ${SPENT}${clause}
      GROUP BY l.cost_code, l.cost_type ORDER BY amount DESC`).all(...args)
      .map((x) => ({ ...x, amount: round2(x.amount) })),
  });
});

/** §2 ข้อ 6 — เทียบต้นทุนต่อ ตร.ม. ได้เฉพาะ design_code เดียวกัน ห้ามเทียบข้ามแบบ */
r.get('/cost-per-sqm', (req, res) => {
  const { clause, args } = scope(req);
  const rows = db.prepare(`SELECT b.design_code, d.design_name, d.ref_cost_per_sqm, d.status AS design_status,
      b.building_id, b.building_name, b.area_sqm, COALESCE(SUM(q.total_amount),0) AS spent
    FROM requests q
    JOIN buildings b ON b.building_id = q.building_id
    LEFT JOIN designs d ON d.design_code = b.design_code
    WHERE ${SPENT} AND b.design_code IS NOT NULL AND b.area_sqm > 0 AND b.is_building = 'Y'${clause}
    GROUP BY b.building_id ORDER BY b.design_code, spent DESC`).all(...args);

  const groups = new Map();
  for (const x of rows) {
    if (!groups.has(x.design_code))
      groups.set(x.design_code, {
        design_code: x.design_code, design_name: x.design_name,
        ref_cost_per_sqm: x.ref_cost_per_sqm, design_status: x.design_status, buildings: [],
      });
    groups.get(x.design_code).buildings.push({
      building_id: x.building_id, building_name: x.building_name, area_sqm: x.area_sqm,
      spent: round2(x.spent), cost_per_sqm: round2(x.spent / x.area_sqm),
    });
  }
  const out = [...groups.values()].map((g) => {
    const vals = g.buildings.map((b) => b.cost_per_sqm);
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const spread = vals.length > 1 ? round2(((Math.max(...vals) - Math.min(...vals)) / Math.min(...vals)) * 100) : null;
    return { ...g, avg_cost_per_sqm: round2(avg), spread_pct: spread, comparable: g.buildings.length > 1 };
  });
  res.json({ groups: out, note: 'เทียบต้นทุนต่อ ตร.ม. ได้เฉพาะภายในแบบเดียวกัน (design_code) เท่านั้น' });
});

/** BOQ vs จ่ายจริง — ทำไปกี่ % เหลือต้องจ่ายอีกเท่าไหร่ */
r.get('/boq-vs-actual', (req, res) => {
  const rows = db.prepare(`SELECT bb.boq_id, br.title AS boq_title, bb.building_id, b.building_name,
      b.project_id, p.project_name, bb.boq_budget, bb.status AS boq_status,
      COALESCE((SELECT SUM(q.total_amount) FROM requests q
        WHERE q.building_id = bb.building_id AND ${SPENT}), 0) AS spent
    FROM boq_buildings bb
    JOIN boq_register br ON br.boq_id = bb.boq_id
    JOIN buildings b ON b.building_id = bb.building_id
    JOIN projects p ON p.project_id = b.project_id
    ORDER BY spent DESC`).all();
  res.json({
    rows: rows.map((x) => ({
      ...x,
      spent: round2(x.spent),
      progress_pct: x.boq_budget ? round2((x.spent / x.boq_budget) * 100) : null,
      remaining: x.boq_budget ? round2(x.boq_budget - x.spent) : null,
    })),
  });
});

/** อาคารที่ "เงียบไปแล้วแต่ยังไม่ปิดงาน" = เงินค้างกลางทาง */
r.get('/silent-buildings', (req, res) => {
  const days = Number(req.query.days || 45);
  const rows = db.prepare(`SELECT b.building_id, b.building_name, b.project_id, p.project_name,
      b.status, b.design_code, b.area_sqm,
      MAX(q.request_date) AS last_date, COALESCE(SUM(q.total_amount),0) AS spent, COUNT(*) AS n
    FROM requests q
    JOIN buildings b ON b.building_id = q.building_id
    JOIN projects p ON p.project_id = b.project_id
    WHERE ${SPENT} AND b.status = 'กำลังทำ' AND b.is_building = 'Y'
    GROUP BY b.building_id
    HAVING julianday('now') - julianday(MAX(q.request_date)) >= ?
    ORDER BY spent DESC`).all(days);
  res.json({
    rows: rows.map((x) => ({
      ...x, spent: round2(x.spent),
      idle_days: Math.floor((Date.now() - new Date(x.last_date)) / 864e5),
    })),
    threshold_days: days,
  });
});

/** §2 ข้อ 9 — ตรวจรายการซ้ำที่ระดับอาคาร ไม่ใช่ระดับโครงการ */
r.get('/duplicates', (req, res) => {
  const rows = db.prepare(`SELECT q.building_id, b.building_name, p.project_name, q.request_date,
      ROUND(q.total_amount, 2) AS amount, COUNT(*) AS n,
      GROUP_CONCAT(q.request_id, ', ') AS request_ids
    FROM requests q
    JOIN buildings b ON b.building_id = q.building_id
    JOIN projects p ON p.project_id = q.project_id
    WHERE q.status NOT IN ('ยกเลิก','ไม่อนุมัติ','ร่าง')
    GROUP BY q.building_id, q.request_date, ROUND(q.total_amount, 2)
    HAVING COUNT(*) > 1
    ORDER BY (COUNT(*) - 1) * q.total_amount DESC`).all();
  res.json({
    groups: rows,
    group_count: rows.length,
    excess_amount: round2(rows.reduce((s, x) => s + x.amount * (x.n - 1), 0)),
  });
});

/** เวลาที่ใช้อนุมัติ — ใช้วัดว่าถึงเวลามอบอำนาจหรือยัง (สเปก §5.2) */
r.get('/approval-load', (req, res) => {
  const { clause, args } = scope(req);
  const buckets = db.prepare(`SELECT
      CASE WHEN q.total_amount < 5000 THEN 'ต่ำกว่า 5,000'
           WHEN q.total_amount < 20000 THEN '5,000–20,000'
           WHEN q.total_amount < 100000 THEN '20,000–100,000'
           ELSE 'เกิน 100,000' END AS bucket,
      COUNT(*) AS n, COALESCE(SUM(q.total_amount),0) AS amount,
      AVG(q.approval_seconds) AS avg_sec
    FROM requests q WHERE ${SPENT}${clause}
    GROUP BY bucket`).all(...args);
  const totalN = buckets.reduce((s, x) => s + x.n, 0) || 1;
  const totalAmt = buckets.reduce((s, x) => s + x.amount, 0) || 1;
  res.json({
    buckets: buckets.map((x) => ({
      ...x, amount: round2(x.amount),
      count_pct: round2((x.n / totalN) * 100),
      amount_pct: round2((x.amount / totalAmt) * 100),
      avg_sec: x.avg_sec ? Math.round(x.avg_sec) : null,
    })),
    self_approved: db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(q.total_amount),0) AS amount
      FROM requests q WHERE q.approver_id IS NOT NULL AND q.approver_id = q.requester_id${clause}`).get(...args),
  });
});

/** v9 §25 — รายการที่จ่ายเงินให้ทีมงานของเราเอง (พบหลังได้ชื่อ-สกุลจริง) */
r.get('/staff-payments', (req, res) => {
  const { clause, args } = scope(req);
  const rows = db.prepare(`SELECT q.request_id, q.request_date, q.total_amount, q.self_paid,
      q.payee_name_raw, q.staff_user_id, su.display_name AS staff_name, su.role AS staff_role,
      u.display_name AS requester_name, p.project_name, b.building_name,
      (SELECT GROUP_CONCAT(DISTINCT l.cost_type) FROM request_lines l WHERE l.request_id = q.request_id) AS cost_types,
      v.vendor_name
    FROM requests q
    JOIN users u ON u.user_id = q.requester_id
    JOIN projects p ON p.project_id = q.project_id
    JOIN buildings b ON b.building_id = q.building_id
    LEFT JOIN users su ON su.user_id = q.staff_user_id
    LEFT JOIN vendors v ON v.vendor_id = q.vendor_id
    WHERE q.paid_to_staff = 1${clause}
    ORDER BY q.total_amount DESC`).all(...args);
  res.json({
    rows,
    total: round2(rows.reduce((s2, x) => s2 + x.total_amount, 0)),
    self_paid_total: round2(rows.filter((x) => x.self_paid).reduce((s2, x) => s2 + x.total_amount, 0)),
    note: 'ระบบเดิมมองชื่อคนไทยเป็นทีมช่างภายนอกจึงจัดเป็นค่าแรง — ต้องระบุประเภทที่แท้จริงก่อนใช้ตัวเลขค่าแรง',
  });
});

/** ตัวชี้วัดความสำเร็จตัวเดียว (สเปก §10): % ใบเบิกที่ผ่านระบบ ไม่ใช่ผ่านไลน์ */
r.get('/adoption', (_req, res) => {
  const cutover = getSetting('cutover_date') || '2026-09-01';
  const rows = db.prepare(`SELECT substr(request_date,1,7) AS ym,
      SUM(CASE WHEN value_source = 'นำเข้าย้อนหลัง' THEN 1 ELSE 0 END) AS imported,
      SUM(CASE WHEN value_source <> 'นำเข้าย้อนหลัง' THEN 1 ELSE 0 END) AS in_system,
      COUNT(*) AS total
    FROM requests WHERE request_date >= ? GROUP BY ym ORDER BY ym`).all(cutover);
  res.json({
    cutover_date: cutover,
    months: rows.map((x) => ({ ...x, in_system_pct: x.total ? round2((x.in_system / x.total) * 100) : 0 })),
    target: { month1: 60, month3: 95 },
  });
});

// ---------------------------------------------------------------- ส่งออก CSV
const EXPORTABLE = {
  requests: `SELECT q.request_id, q.request_date, q.status, q.requester_id, u.display_name AS requester,
      q.project_id, p.project_name, q.building_id, b.building_name, b.design_code,
      q.vendor_id, v.vendor_name, q.has_vat, q.vat_mode, q.amount_before_vat, q.vat_amount,
      q.total_amount, q.wht_amount, q.net_amount, q.goods_received, q.legacy_code,
      q.confidence, q.value_source, q.approver_id, q.approved_at, q.approval_seconds, q.note
    FROM requests q
    JOIN projects p ON p.project_id = q.project_id
    JOIN buildings b ON b.building_id = q.building_id
    LEFT JOIN vendors v ON v.vendor_id = q.vendor_id
    JOIN users u ON u.user_id = q.requester_id
    ORDER BY q.request_date, q.request_id`,
  request_lines: `SELECT l.request_id, q.request_date, q.project_id, q.building_id, l.line_no,
      l.cost_code, c.cost_name, l.cost_type, l.item_id, l.description, l.qty, l.unit,
      l.unit_price, l.line_amount, l.ref_price, l.price_diff_pct, l.confidence
    FROM request_lines l
    JOIN requests q ON q.request_id = l.request_id
    LEFT JOIN cost_codes c ON c.cost_code = l.cost_code
    ORDER BY l.request_id, l.line_no`,
  payments: `SELECT pm.*, q.project_id, q.building_id, v.vendor_name FROM payments pm
    JOIN requests q ON q.request_id = pm.request_id
    LEFT JOIN vendors v ON v.vendor_id = q.vendor_id ORDER BY pm.payment_date`,
  documents: `SELECT d.*, q.project_id, q.building_id, q.total_amount, q.vat_amount
    FROM documents d JOIN requests q ON q.request_id = d.request_id ORDER BY d.request_id`,
  vendors: 'SELECT * FROM vendors ORDER BY vendor_id',
  buildings: 'SELECT * FROM buildings ORDER BY building_id',
  projects: 'SELECT * FROM projects ORDER BY project_id',
  cost_codes: 'SELECT * FROM cost_codes ORDER BY group_order, cost_code',
  items: 'SELECT * FROM items ORDER BY item_id',
  item_prices: 'SELECT * FROM item_prices ORDER BY item_id, unit_price',
  rates: 'SELECT * FROM rates ORDER BY rate_id',
  funding_in: 'SELECT * FROM funding_in ORDER BY funding_date',
  reversals: 'SELECT * FROM reversals ORDER BY reversal_id',
  vendor_credits: 'SELECT * FROM vendor_credits ORDER BY credit_id',
  audit_log: 'SELECT * FROM audit_log ORDER BY log_id',
  employees: 'SELECT * FROM employees ORDER BY emp_id',
  cost_curve: 'SELECT * FROM cost_curve ORDER BY floors, area_sqm',
  building_aliases: 'SELECT * FROM building_aliases ORDER BY building_id',
  rental_units: 'SELECT * FROM rental_units ORDER BY unit_id',
  land_leases: 'SELECT * FROM land_leases ORDER BY location_code',
  location_pl: 'SELECT * FROM location_pl ORDER BY location_code',
};

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

r.get('/export/:table.csv', (req, res) => {
  const sql = EXPORTABLE[req.params.table];
  if (!sql) return res.status(404).json({ error: 'ตารางนี้ส่งออกไม่ได้', available: Object.keys(EXPORTABLE) });
  if (req.params.table === 'audit_log' && req.user.role !== 'CEO')
    return res.status(403).json({ error: 'ส่งออกบันทึกการแก้ไขได้เฉพาะ CEO' });
  const rows = db.prepare(sql).all();
  const cols = rows.length ? Object.keys(rows[0]) : [];
  // BOM เพื่อให้ Excel เปิดภาษาไทยได้ถูกต้อง
  const body = '﻿' + [cols.join(','), ...rows.map((row) => cols.map((c) => csvCell(row[c])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.table}.csv"`);
  res.send(body);
});

r.get('/export', (_req, res) => res.json({ tables: Object.keys(EXPORTABLE) }));

export default r;
