/** S4 — ตามเอกสาร (บัญชี) · เรียงตามยอดเงิน ไม่ใช่จำนวนใบ (หลักการข้อ 8) */
import { api, qs } from '../api.js';
import { el, clear, select, baht, thaiDate, table, thaiMonth, docGrid } from '../ui.js';
import { state, navigate } from '../app.js';

const LEVEL_CLASS = { 'แดง': 'red', 'เหลือง': 'amber', 'เทา': '' };

export async function render() {
  const [summary, taxPeriods] = await Promise.all([
    api.get('/api/documents/summary'),
    api.get('/api/documents/tax-periods'),
  ]);

  const root = el('div');
  const listBox = el('div');
  const filters = { bucket: 'any', project_id: '', vendor_id: '', min_age: '' };

  root.append(
    el('div', { class: 'eyebrow', text: 'เรียงตามยอดเงิน ไม่ใช่จำนวนใบ' }),
    el('h1', { text: 'เอกสารค้าง' }));

  const bucketBox = el('div', { class: 'kpi-grid' });
  for (const b of summary.buckets) {
    bucketBox.append(el('div', {
      class: `kpi ${LEVEL_CLASS[b.level] || ''}`,
      style: 'cursor:pointer',
      onclick: () => { filters.bucket = b.key; paintButtons(); load(); },
      dataset: { bucket: b.key },
    },
      el('div', { class: 'label', text: b.label }),
      el('div', { class: 'value', text: baht(b.amount, 0) }),
      el('div', { class: 'sub', text: `${b.count.toLocaleString('th-TH')} ใบ` })));
  }
  const paintButtons = () => {
    for (const node of bucketBox.children)
      node.style.outline = node.dataset.bucket === filters.bucket ? '2px solid var(--ink)' : '';
  };
  root.append(bucketBox);

  const projectSel = select(state.projects.map((p) => ({ value: p.project_id, label: p.project_name })),
    { placeholder: 'ทุกโครงการ', onchange: (e) => { filters.project_id = e.target.value; load(); } });
  const vendorSel = select(state.vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name })),
    { placeholder: 'ทุกผู้ขาย', onchange: (e) => { filters.vendor_id = e.target.value; load(); } });
  const ageSel = select([
    { value: '15', label: 'ค้างเกิน 15 วัน' },
    { value: '30', label: 'ค้างเกิน 30 วัน' },
  ], { placeholder: 'ทุกอายุค้าง', onchange: (e) => { filters.min_age = e.target.value; load(); } });

  root.append(el('div', { class: 'card tight row wrap' },
    el('div', { class: 'grow' }, projectSel),
    el('div', { class: 'grow' }, vendorSel),
    el('div', { class: 'grow' }, ageSel)));

  root.append(listBox);

  if (taxPeriods.periods.length)
    root.append(el('div', { class: 'card' },
      el('h2', { text: 'ภาษีซื้อตามเดือนบนใบกำกับ' }),
      el('p', { class: 'tiny muted', text: 'ใช้เดือนบนใบกำกับภาษี ไม่ใช่เดือนที่จ่ายเงิน — ตัวเลขนี้คือฐานสำหรับยื่น ภ.พ.30' }),
      table([
        { label: 'เดือนภาษี', render: (x) => thaiMonth(x.tax_period) },
        { label: 'จำนวนใบ', num: true, key: 'n' },
        { label: 'ฐานภาษี', num: true, render: (x) => baht(x.base) },
        { label: 'ภาษีซื้อ', num: true, render: (x) => baht(x.input_vat) },
      ], taxPeriods.periods),
      taxPeriods.cross_month_count > 0
        ? el('div', { class: 'banner warn mt' },
          `มี ${taxPeriods.cross_month_count} ใบที่เดือนบนใบกำกับไม่ตรงกับเดือนที่จ่ายเงิน — ต้องยื่นตามเดือนบนใบกำกับ`)
        : null));

  async function load() {
    clear(listBox).append(el('div', { class: 'loading', text: 'กำลังโหลด…' }));
    const data = await api.get('/api/documents/pending' + qs(filters));
    clear(listBox);
    if (!data.requests.length) {
      listBox.append(el('div', { class: 'empty', text: 'ไม่มีใบค้างเอกสารตามเงื่อนไขนี้' }));
      return;
    }
    listBox.append(el('div', { class: 'spread mb small muted' },
      el('span', { text: `${data.count} ใบ` }),
      el('span', { class: 'mono', text: `${baht(data.total_amount)} บาท` })));
    listBox.append(el('div', { class: 'list' }, data.requests.map((r) => el('div', {
      class: `item ${r.level === 'แดง' ? 'alert' : r.level === 'เหลือง' ? 'warn' : ''}`,
      onclick: () => navigate(`requests/${r.request_id}`),
    },
      el('div', { class: 'line1' },
        el('span', { class: 'id', text: `${r.request_id} · ${r.vendor_name || '—'}` }),
        el('span', { class: 'amt', text: baht(r.total_amount, 0) })),
      el('div', { class: 'line3' },
        `จ่าย ${thaiDate(r.payment_date)} · ${r.days === null ? 'ยังไม่ระบุวันจ่าย' : `ค้าง ${r.days} วัน`} · ${r.building_name}`),
      docGrid((r.docs || []).map((d) => ({
        label: d.doc_type,
        hint: d.received ? thaiDate(d.doc_date) : undefined,
        state: d.received ? 'done' : (r.level === 'แดง' ? 'late' : ''),
      }))),
      el('div', { class: 'line3' },
        `เอกสารครบ ${r.doc_done}/${r.doc_total}` +
        (r.vat_amount > 0 ? ` · ภาษีซื้อ ${baht(r.vat_amount)}` : '') +
        (r.wht_amount > 0 ? ` · หัก ณ ที่จ่าย ${baht(r.wht_amount)}` : ''))))));
  }

  paintButtons();
  await load();
  return root;
}
