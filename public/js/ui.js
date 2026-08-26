/** ตัวช่วยสร้าง DOM และจัดรูปแบบตัวเลข/วันที่แบบไทย */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(3)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

// ---------------------------------------------------------------- ตัวเลข
export const baht = (n, digits = 2) =>
  (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const bahtShort = (n) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e6) return (v / 1e6).toLocaleString('th-TH', { maximumFractionDigits: 2 }) + ' ล้าน';
  if (abs >= 1e3) return Math.round(v).toLocaleString('th-TH');
  return v.toLocaleString('th-TH', { maximumFractionDigits: 2 });
};

export const pct = (n, digits = 1) =>
  n === null || n === undefined ? '—' : `${(Number(n)).toFixed(digits)}%`;

// ---------------------------------------------------------------- วันที่ (พ.ศ.)
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export function thaiDate(iso, withYear = true) {
  if (!iso) return '—';
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return String(iso);
  const s = `${d.getDate()} ${THAI_MONTHS[d.getMonth()]}`;
  return withYear ? `${s} ${(d.getFullYear() + 543) % 100}` : s;
}

export function thaiMonth(ym) {
  if (!ym) return '—';
  const [y, m] = String(ym).split('-').map(Number);
  return `${THAI_MONTHS[(m || 1) - 1]} ${(y + 543) % 100}`;
}

export function thaiDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${thaiDate(d.toISOString())} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function duration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds} วินาที`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} นาที`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} ชั่วโมง`;
  return `${(seconds / 86400).toFixed(1)} วัน`;
}

export const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- สถานะ
export const STATUS_STYLE = {
  'ร่าง': 'grey', 'รออนุมัติ': 'amber', 'อนุมัติแล้ว': 'blue',
  'จ่ายแล้ว': 'green', 'ปิดรายการ': 'green', 'ไม่อนุมัติ': 'red', 'ยกเลิก': 'red',
};

export const statusPill = (status) =>
  el('span', { class: `pill ${STATUS_STYLE[status] || ''}`, text: status });

/**
 * สีขอบซ้ายของการ์ด (ตามต้นแบบ):
 * เขียว = เดินหน้าปกติ · ไม่มีสี = รอคนอื่น · เหลือง = รอคุณ · แดง = ต้องการอะไรบางอย่างจากคุณ
 */
export function itemTone(r, { forUser = null } = {}) {
  if (r.value_source === 'นำเข้าย้อนหลัง') return 'imported';
  if (['ยกเลิก', 'ไม่อนุมัติ'].includes(r.status)) return 'alert';
  if (r.status === 'จ่ายแล้ว' && r.goods_received === 0) return 'alert';
  if (r.status === 'ร่าง') return forUser && r.requester_id === forUser ? 'warn' : '';
  if (r.flags?.length) return 'warn';
  if (['อนุมัติแล้ว', 'ปิดรายการ'].includes(r.status)) return 'ok';
  return '';
}

// ---------------------------------------------------------------- แจ้งเตือน
let toastTimer;
export function toast(message, kind = '') {
  document.querySelector('.toast')?.remove();
  const node = el('div', { class: `toast ${kind}`, text: message });
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), kind === 'error' ? 5200 : 2800);
}

// ---------------------------------------------------------------- โมดัล
export function modal({ title, body, actions = [], onClose }) {
  const back = el('div', { class: 'modal-back' });
  const box = el('div', { class: 'modal' });
  if (title) box.append(el('h2', { text: title }));
  box.append(body);
  const close = () => { back.remove(); onClose?.(); };
  if (actions.length) {
    box.append(el('div', { class: 'modal-actions' },
      actions.map((a) => el('button', {
        class: `btn ${a.kind || ''}`,
        onclick: async () => { const keep = await a.onClick?.(close); if (!keep) close(); },
      }, a.label))));
  }
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.append(box);
  document.body.append(back);
  return { close, box };
}

export function confirmDialog(title, message, { danger = false, needReason = false } = {}) {
  return new Promise((resolve) => {
    const input = needReason
      ? el('input', { type: 'text', placeholder: 'ระบุเหตุผล (บังคับ)' })
      : null;
    const body = el('div', {}, el('p', { class: 'small', text: message }), input);
    let settled = false;
    modal({
      title,
      body,
      onClose: () => { if (!settled) resolve(null); },
      actions: [
        { label: 'ยกเลิก', onClick: () => { settled = true; resolve(null); } },
        {
          label: 'ยืนยัน',
          kind: danger ? 'danger' : 'primary',
          onClick: () => {
            if (needReason && !input.value.trim()) { toast('ต้องระบุเหตุผลก่อน', 'error'); return true; }
            settled = true;
            resolve(needReason ? input.value.trim() : true);
          },
        },
      ],
    });
    input?.focus();
  });
}

// ---------------------------------------------------------------- ส่วนประกอบสำเร็จรูป
export const card = (...children) => el('div', { class: 'card' }, children);

export const kpi = (label, value, sub, kind = '') =>
  el('div', { class: `kpi ${kind}` },
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: value }),
    sub ? el('div', { class: 'sub', text: sub }) : null);

export const field = (label, control, hint) =>
  el('div', { class: 'field' },
    el('label', { text: label }),
    control,
    hint ? el('div', { class: 'tiny muted', text: hint }) : null);

export function select(options, { value, placeholder, onchange } = {}) {
  const node = el('select', onchange ? { onchange } : {});
  if (placeholder) node.append(el('option', { value: '' }, placeholder));
  for (const o of options) {
    const opt = el('option', { value: o.value }, o.label);
    if (String(o.value) === String(value)) opt.selected = true;
    node.append(opt);
  }
  return node;
}

export function table(columns, rows, { empty = 'ไม่มีข้อมูล' } = {}) {
  if (!rows.length) return el('div', { class: 'empty', text: empty });
  return el('div', { class: 'table-wrap' },
    el('table', {},
      el('thead', {}, el('tr', {}, columns.map((c) =>
        el('th', { class: c.num ? 'num' : '' }, c.label)))),
      el('tbody', {}, rows.map((row) =>
        el('tr', {}, columns.map((c) => {
          const v = c.render ? c.render(row) : row[c.key];
          return el('td', { class: c.num ? 'num' : '' }, v instanceof Node ? v : String(v ?? '—'));
        }))))));
}

/** ตารางเอกสารสามช่องแบบต้นแบบ */
export function docGrid(cells) {
  return el('div', { class: 'docgrid' }, cells.map((c) =>
    el('div', { class: c.state || '', onclick: c.onclick },
      c.label, c.hint ? el('small', { text: c.hint }) : null)));
}

export const flagList = (flags = []) =>
  flags.map((f) => el('div', { class: 'flag' },
    el('b', { text: `${f.code} ` }), f.label, f.detail ? el('div', { class: 'tiny', text: f.detail }) : null));

/** แถบสัดส่วนประเภทต้นทุน */
export function stackBar(parts) {
  const total = parts.reduce((s, p) => s + p.amount, 0) || 1;
  return el('div', {},
    el('div', { class: 'stack' }, parts.map((p) =>
      el('span', { class: `t-${p.cost_type}`, style: `width:${(p.amount / total) * 100}%`,
        title: `${p.cost_type} ${baht(p.amount)}` }))),
    el('div', { class: 'legend' }, parts.map((p) =>
      el('span', {}, el('i', { class: `t-${p.cost_type}` }),
        `${p.cost_type} ${((p.amount / total) * 100).toFixed(1)}%`))));
}

/** กราฟแท่งอย่างง่ายสำหรับเงินออกรายเดือน */
export function barChart(rows, { labelKey = 'ym', valueKey = 'amount' } = {}) {
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
  return el('div', { class: 'chart' }, rows.map((r) =>
    el('div', { class: 'col', title: `${thaiMonth(r[labelKey])} · ${baht(r[valueKey])} บาท` },
      el('div', { class: 'bar', style: `height:${((Number(r[valueKey]) || 0) / max) * 100}%` }),
      el('div', { class: 'cap', text: thaiMonth(r[labelKey]).replace(' ', ' ') }))));
}
