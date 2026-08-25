/**
 * กฎตรวจสอบและกฎอัตโนมัติ — สเปก §6
 *   6.1 กฎบล็อก B1–B10  (ผ่านไม่ได้)
 *   6.2 กฎเตือน  W1–W9  (ผ่านได้แต่ติดธง ต้องกดอนุมัติทีละใบ)
 *   6.3 กฎอัตโนมัติ (VAT · หัก ณ ที่จ่าย · รหัสอ้างอิงเดิม · อายุเอกสาร)
 */
import { db, getSetting, round2 } from './db.js';

export const COST_TYPES_SELECTABLE = ['ของ', 'แรง', 'เช่า', 'โสหุ้ย'];
export const WHT_BASE_TYPES = ['แรง', 'เช่า'];       // §6.3
export const PHOTO_REQUIRED_ABOVE = 5000;            // B6
export const PETTY_CASH_LINE_MAX = 2000;             // B10
export const PETTY_CASH_CEILING = 10000;
export const VAT_RATE = 0.07;

// ---------------------------------------------------------------- กฎอัตโนมัติ

/** คำนวณ VAT / หัก ณ ที่จ่าย / ยอดสุทธิ จากรายการย่อย + ตัวเลือกบนหัวใบ */
export function computeTotals({ lines, hasVat, vatMode, vendor }) {
  const lineSum = round2(lines.reduce((s, l) => s + Number(l.line_amount || 0), 0));
  let before = lineSum, vat = 0, total = lineSum;

  if (hasVat === 'มี') {
    if (vatMode === 'รวม VAT แล้ว') {
      // ผู้กรอกใส่ยอดที่รวม VAT มาแล้ว → ถอด VAT ออก
      total = lineSum;
      before = round2(lineSum / (1 + VAT_RATE));
      vat = round2(total - before);
    } else {
      before = lineSum;
      vat = round2(lineSum * VAT_RATE);
      total = round2(before + vat);
    }
  }

  // หัก ณ ที่จ่าย: %ของ vendor × ยอดบรรทัดที่เป็นค่าแรง/ค่าเช่า (ฐานก่อน VAT)
  const whtPct = Number(vendor?.wht_percent || 0);
  const whtBaseRaw = lines
    .filter((l) => WHT_BASE_TYPES.includes(l.cost_type))
    .reduce((s, l) => s + Number(l.line_amount || 0), 0);
  const whtBase = hasVat === 'มี' && vatMode === 'รวม VAT แล้ว'
    ? round2(whtBaseRaw / (1 + VAT_RATE))
    : round2(whtBaseRaw);
  const wht = round2(whtBase * whtPct / 100);

  return {
    amount_before_vat: before,
    vat_amount: vat,
    total_amount: total,
    wht_base: whtBase,
    wht_amount: wht,
    net_amount: round2(total - wht),
  };
}

/** รหัสอ้างอิงเดิม 10 หลัก — ผู้เบิก(1) + โครงการ(3) + อาคาร(3) + หมวดงาน(3) · §6.3 ห้ามให้คนพิมพ์ */
export function legacyCode({ requesterId, projectId, buildingName, costCode }) {
  const pad = (v, n) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, n).padEnd(n, 'X');
  return pad(requesterId, 1) + pad(projectId, 3) + pad(buildingName, 3) + pad(costCode, 3);
}

/** อายุเอกสารนับจากวันจ่าย — 15 วันเหลือง · 30 วันแดง · §6.3 */
export function docAgeLevel(paymentDate, today = new Date()) {
  if (!paymentDate) return { days: null, level: 'ไม่มีข้อมูล' };
  const days = Math.floor((today - new Date(paymentDate + 'T00:00:00')) / 864e5);
  return { days, level: days >= 30 ? 'แดง' : days >= 15 ? 'เหลือง' : 'ปกติ' };
}

// ---------------------------------------------------------------- กฎบล็อก

/**
 * ตรวจใบเบิกก่อนบันทึก/ส่งขออนุมัติ
 * @returns {{errors: {code, message}[]}}
 */
export function validateRequest({ header, lines, vendor, attachmentCount = 0, forSubmit = true }) {
  const errors = [];
  const add = (code, message) => errors.push({ code, message });

  if (!header.project_id || !header.building_id) add('B3', 'กรุณาเลือกโครงการและอาคาร');
  if (!header.has_vat) add('B4', 'กรุณาเลือกว่ามี VAT หรือไม่');
  if (!header.vendor_id) add('B3', 'กรุณาเลือกผู้ขาย');

  if (!lines.length) add('B5', 'ใบเบิกต้องมีรายการย่อยอย่างน้อย 1 บรรทัด');

  const active = new Set(db.prepare("SELECT cost_code FROM cost_codes WHERE status = 'ใช้ต่อ'")
                           .all().map((r) => r.cost_code));
  lines.forEach((l, i) => {
    const n = i + 1;
    if (!l.cost_code) add('B1', `รายการที่ ${n}: กรุณาเลือกหมวดงาน`);
    else if (!active.has(l.cost_code))
      add('B8', `รายการที่ ${n}: หมวดงาน ${l.cost_code} เลิกใช้แล้ว กรุณาเลือกหมวดงานที่ใช้อยู่`);
    if (!l.cost_type) add('B2', `รายการที่ ${n}: กรุณาเลือกว่าเป็นค่าของ ค่าแรง ค่าเช่า หรือโสหุ้ย`);
    else if (!COST_TYPES_SELECTABLE.includes(l.cost_type))
      add('B2', `รายการที่ ${n}: ประเภทต้นทุน "${l.cost_type}" ใช้กับรายการใหม่ไม่ได้`);
    if (!(Number(l.line_amount) > 0)) add('B5', `รายการที่ ${n}: จำนวนเงินต้องมากกว่า 0`);
    const calc = round2(Number(l.qty || 0) * Number(l.unit_price || 0));
    if (Math.abs(calc - round2(Number(l.line_amount || 0))) > 0.01)
      add('B5', `รายการที่ ${n}: จำนวน × ราคา/หน่วย ไม่เท่ากับจำนวนเงิน`);
  });

  const totals = computeTotals({
    lines, hasVat: header.has_vat, vatMode: header.vat_mode, vendor,
  });
  if (header.total_amount != null &&
      Math.abs(round2(Number(header.total_amount)) - totals.total_amount) > 0.01)
    add('B5', 'ยอดรวมไม่ตรงกับรายการย่อย');

  if (forSubmit && totals.total_amount > PHOTO_REQUIRED_ABOVE && attachmentCount < 1)
    add('B6', `ใบเบิกเกิน ${PHOTO_REQUIRED_ABOVE.toLocaleString('th-TH')} บาท ต้องแนบรูปหรือไฟล์อย่างน้อย 1 ไฟล์`);

  if (header.is_petty_cash) {
    lines.forEach((l, i) => {
      if (Number(l.line_amount) > PETTY_CASH_LINE_MAX)
        add('B10', `รายการที่ ${i + 1}: เงินสดย่อยต่อรายการต้องไม่เกิน ${PETTY_CASH_LINE_MAX.toLocaleString('th-TH')} บาท`);
    });
  }

  return { errors, totals };
}

/** B9 — ห้ามแก้ยอดใบที่จ่ายแล้ว (แก้ได้เฉพาะข้อมูลประกอบ) */
export const FROZEN_STATUSES = ['จ่ายแล้ว', 'ปิดรายการ'];
export const EDITABLE_META_FIELDS = ['building_id', 'note', 'project_id'];

// ---------------------------------------------------------------- กฎเตือน

/**
 * ประเมินธงเตือน W1–W9 สำหรับใบเบิกหนึ่งใบ
 * @returns {{code, label, detail}[]}
 */
export function evaluateFlags({ header, lines, vendor, totals, excludeRequestId = null }) {
  const flags = [];
  const add = (code, label, detail = '') => flags.push({ code, label, detail });
  const total = totals?.total_amount ?? Number(header.total_amount || 0);

  // W1 — vendor รายใหม่ ยังไม่เคยจ่าย
  if (vendor) {
    const paid = db.prepare(
      `SELECT COUNT(*) AS n FROM requests
       WHERE vendor_id = ? AND status IN ('จ่ายแล้ว','ปิดรายการ') AND request_id <> ?`)
      .get(vendor.vendor_id, excludeRequestId || '').n;
    if (paid === 0) {
      const creator = vendor.created_by
        ? db.prepare('SELECT display_name FROM users WHERE user_id = ?').get(vendor.created_by)?.display_name
        : null;
      add('W1', 'ผู้ขายรายใหม่ ยังไม่เคยจ่าย',
          creator ? `สร้างโดย ${creator}` : 'นำเข้าจากฐานข้อมูลเดิม');
    }

    // W3 — vendor ค้างเอกสารเกิน 3 ใบ
    // นับเฉพาะใบที่ระบบติดตามเอกสารจริง (ข้อมูลนำเข้าย้อนหลังไม่มีเอกสาร ตามสเปก §9)
    const pendingDocs = db.prepare(
      `SELECT COUNT(*) AS n FROM requests r
       WHERE r.vendor_id = ? AND r.status = 'จ่ายแล้ว' AND r.request_id <> ?
         AND r.value_source <> 'นำเข้าย้อนหลัง'
         AND EXISTS (SELECT 1 FROM documents d WHERE d.request_id = r.request_id AND d.received = 0)`)
      .get(vendor.vendor_id, excludeRequestId || '').n;
    if (pendingDocs > 3) add('W3', `ผู้ขายรายนี้ค้างเอกสาร ${pendingDocs} ใบ`, 'เกินเกณฑ์ 3 ใบ');

    // W4 — มีเครดิตค้างกับ vendor รายนี้
    const credit = db.prepare(
      `SELECT COALESCE(SUM(amount - used_amount), 0) AS bal FROM vendor_credits
       WHERE vendor_id = ? AND status = 'คงเหลือ'`).get(vendor.vendor_id).bal;
    if (credit > 0.01)
      add('W4', 'มีเครดิตค้างกับผู้ขายรายนี้',
          `คงเหลือ ${credit.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท — ควรหักกลบก่อนจ่ายใหม่`);
  }

  // W2 — ราคาสูงกว่าอ้างอิงเกิน 10% (เปิดใช้เมื่อจับคู่วัสดุเสร็จ · §12)
  if (getSetting('flag_W2_enabled', '0') === '1') {
    for (const l of lines) {
      if (!l.item_id || !(Number(l.unit_price) > 0)) continue;
      const ref = db.prepare('SELECT ref_price_min FROM items WHERE item_id = ?').get(l.item_id)?.ref_price_min;
      if (!ref) continue;
      const diff = (Number(l.unit_price) - ref) / ref;
      if (diff > 0.10)
        add('W2', 'ราคาสูงกว่าราคาอ้างอิงเกิน 10%',
            `${l.description || l.item_id}: ${round2(Number(l.unit_price))} เทียบอ้างอิง ${round2(ref)} (+${(diff * 100).toFixed(1)}%)`);
    }
  }

  // W5 — รายการซ้ำ: วันเดียวกัน + อาคารเดียวกัน + ยอดตรงกันเป๊ะ (ระดับอาคาร · หลักการข้อ 9)
  if (header.building_id && total > 0) {
    const dup = db.prepare(
      `SELECT request_id FROM requests
       WHERE building_id = ? AND request_date = ? AND ABS(total_amount - ?) < 0.01
         AND request_id <> ? AND status NOT IN ('ยกเลิก','ไม่อนุมัติ')`)
      .all(header.building_id, header.request_date, total, excludeRequestId || '');
    if (dup.length) add('W5', 'รายการซ้ำ', `ยอดเท่ากันในอาคารเดียวกันวันเดียวกัน: ${dup.map((d) => d.request_id).join(', ')}`);

    // W6 — ยอดซ้ำภายใน 7 วัน: คนเดียวกัน อาคารเดียวกัน ยอดตรงกัน
    const dup7 = db.prepare(
      `SELECT request_id, request_date FROM requests
       WHERE building_id = ? AND requester_id = ? AND ABS(total_amount - ?) < 0.01
         AND request_id <> ? AND status NOT IN ('ยกเลิก','ไม่อนุมัติ')
         AND request_date <> ?
         AND julianday(?) - julianday(request_date) BETWEEN 0 AND 7`)
      .all(header.building_id, header.requester_id, total, excludeRequestId || '',
           header.request_date, header.request_date);
    if (dup7.length)
      add('W6', 'ยอดซ้ำภายใน 7 วัน',
          dup7.map((d) => `${d.request_id} (${d.request_date})`).join(', '));

    // W8 — เกินงบอาคาร (ถ้าตั้งงบไว้)
    const b = db.prepare('SELECT building_name, budget FROM buildings WHERE building_id = ?').get(header.building_id);
    if (b?.budget > 0) {
      const spent = db.prepare(
        `SELECT COALESCE(SUM(total_amount), 0) AS s FROM requests
         WHERE building_id = ? AND status IN ('อนุมัติแล้ว','จ่ายแล้ว','ปิดรายการ') AND request_id <> ?`)
        .get(header.building_id, excludeRequestId || '').s;
      if (spent + total > b.budget)
        add('W8', 'เกินงบอาคาร',
            `${b.building_name}: ใช้ไป ${round2(spent).toLocaleString('th-TH')} + ใบนี้ ${round2(total).toLocaleString('th-TH')} เกินงบ ${round2(b.budget).toLocaleString('th-TH')} บาท`);
    }
  }

  // W9 — ยอดลงท้าย 000 และเกิน 20,000
  if (total >= 20000 && Math.round(total) % 1000 === 0 && Math.abs(total - Math.round(total)) < 0.01)
    add('W9', 'ยอดเป็นเลขกลมผิดปกติ', `${total.toLocaleString('th-TH')} บาท — เลขกลมมักไม่มีบิลจริงรองรับ`);

  return flags;
}

/** W7 — ใบของผู้อนุมัติเอง (ประเมินตอนกดอนุมัติ) */
export const selfApprovalFlag = (header, approverId) =>
  header.requester_id === approverId
    ? { code: 'W7', label: 'ใบของผู้อนุมัติเอง', detail: 'นับแยกในรายงาน' }
    : null;

// ---------------------------------------------------------------- เอกสารที่ต้องครบ

/**
 * เอกสารที่ใบนี้ต้องมีครบก่อน "ปิดรายการ" (สเปก §7)
 * ค่าของ 3 ช่อง · ค่าแรง/ค่าเช่า 3 ช่อง · ใบกำกับภาษีเฉพาะใบที่มี VAT
 */
export function requiredDocuments({ header, lines }) {
  const types = new Set(lines.map((l) => l.cost_type));
  const req = [];
  const hasGoods = types.has('ของ') || types.has('โสหุ้ย');
  const hasLabour = types.has('แรง') || types.has('เช่า');

  if (hasGoods) {
    req.push({ doc_type: 'ใบส่งของ', owner: 'PM', question: 'จ่ายไปแล้วได้ของหรือยัง' });
    req.push({ doc_type: 'ใบเสร็จรับเงิน', owner: 'ACCOUNT', question: 'ร้านออกใบให้หรือยัง' });
    if (header.has_vat === 'มี')
      req.push({ doc_type: 'ใบกำกับภาษี', owner: 'ACCOUNT', question: 'ขอคืนภาษีซื้อได้หรือยัง' });
  }
  if (hasLabour) {
    req.push({ doc_type: 'ใบสำคัญรับเงิน', owner: 'ACCOUNT', question: 'มีหลักฐานการรับเงินหรือยัง' });
    if (Number(header.wht_amount) > 0) {
      req.push({ doc_type: 'หัก ณ ที่จ่ายแล้ว', owner: 'ACCOUNT', question: 'หักภาษี ณ ที่จ่ายแล้วหรือยัง' });
      req.push({ doc_type: 'หนังสือรับรองหัก ณ ที่จ่าย', owner: 'ACCOUNT', question: 'ออกหนังสือรับรองแล้วหรือยัง' });
    }
  }
  if (!req.length) req.push({ doc_type: 'ใบเสร็จรับเงิน', owner: 'ACCOUNT', question: 'มีหลักฐานการจ่ายหรือยัง' });
  return req;
}
