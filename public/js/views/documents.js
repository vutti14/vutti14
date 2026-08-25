/** S4 — ตามเอกสาร (บัญชี) · เรียงตามยอดเงิน ไม่ใช่จำนวนใบ (หลักการข้อ 8) */
import { api, qs } from '../api.js';
import { el, clear, select, baht, thaiDate, table, thaiMonth } from '../ui.js';
import { state, navigate } from '../app.js';

const LEVEL_CLASS = { 'แดง': 'red', 'เหลือง': 'amber', 'เทา': '' };
const AGE_CLASS = { 'แดง': 'red', 'เหลือง': 'amber', 'ปกติ': 'green', 'ไม่มีข้อมูล': '' };

export async function render() {
  const [summary, taxPeriods] = await Promise.all([
    api.get('/api/documents/summary'),
    api.get('/api/documents/tax-periods'),
  ]);

  const root = el('div');
  const listBox = el('div');
  const filters = { bucket: 'any', project_id: '', vendor_id: '', min_age: '' };

  root.append(el('h1', { text: 'เอกสารค้าง' }));

  const bucketBox = el('div', { class: 'list mb' });
  for (const b of summary.buckets) {
    bucketBox.append(el('div', {
      class: 'item',
      onclick: () => { filters.bucket = b.key; paintButtons(); load(); },
      dataset: { bucket: b.key },
    },
      el('div', { class: 'line1' },
        el('span', { class: `pill ${LEVEL_CLASS[b.level] || ''}`, text: b.level === 'แดง' ? '🔴' : b.level === 'เหลือง' ? '🟡' : '⚪' }),
        el('span', { class: 'id', text: b.label }),
        el('span', { class: 'amt mono', text: baht(b.amount) })),
      el('div', { class: 'line2', text: `${b.count.toLocaleString('th-TH')} ใบ` })));
  }
  const paintButtons = () => {
    for (const node of bucketBox.children)
      node.style.borderColor = node.dataset.bucket === filters.bucket ? 'var(--brand)' : '';
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
      class: 'item', onclick: () => navigate(`requests/${r.request_id}`),
    },
      el('div', { class: 'line1' },
        el('span', { class: 'id', text: r.request_id }),
        el('span', { class: `pill ${AGE_CLASS[r.level] || ''}`, text: r.days === null ? 'ยังไม่ระบุวันจ่าย' : `ค้าง ${r.days} วัน` }),
        el('span', { class: 'amt mono', text: baht(r.total_amount) })),
      el('div', { class: 'line2 truncate' },
        `${r.vendor_name || '—'} · ${r.building_name} · จ่าย ${thaiDate(r.payment_date)}`),
      el('div', { class: 'line2' },
        `เอกสารครบ ${r.doc_done}/${r.doc_total}` +
        (r.vat_amount > 0 ? ` · ภาษีซื้อ ${baht(r.vat_amount)}` : '') +
        (r.wht_amount > 0 ? ` · หัก ณ ที่จ่าย ${baht(r.wht_amount)}` : ''))))));
  }

  paintButtons();
  await load();
  return root;
}
