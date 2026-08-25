/** S6 — จัดการผู้ขาย · PM สร้างได้ทันที COO/บัญชียืนยัน (คนสร้างกับคนยืนยันต้องคนละคน) */
import { api } from '../api.js';
import { el, clear, field, select, baht, toast, modal } from '../ui.js';
import { state, reload } from '../app.js';

export async function render() {
  const { vendors } = await api.get('/api/vendors');
  const root = el('div');
  const listBox = el('div', { class: 'list' });
  let filter = '';
  let onlyPending = false;

  const search = el('input', { type: 'search', placeholder: 'ค้นหาชื่อผู้ขาย' });
  search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); paint(); });

  const pendingBtn = el('button', {
    class: '',
    onclick: () => { onlyPending = !onlyPending; pendingBtn.classList.toggle('on', onlyPending); paint(); },
  }, 'เฉพาะที่รอตรวจเอกสาร');

  function paint() {
    clear(listBox);
    const rows = vendors.filter((v) =>
      (!filter || v.vendor_name.toLowerCase().includes(filter) || v.vendor_id.toLowerCase().includes(filter)) &&
      (!onlyPending || v.doc_status === 'รอตรวจเอกสาร'));
    if (!rows.length) return listBox.append(el('div', { class: 'empty', text: 'ไม่พบผู้ขาย' }));
    for (const v of rows) listBox.append(vendorItem(v));
  }

  function vendorItem(v) {
    const canVerify = state.caps.vendor_verify && v.doc_status === 'รอตรวจเอกสาร' &&
      v.created_by !== state.user.user_id;
    return el('div', { class: 'item', onclick: () => openEdit(v) },
      el('div', { class: 'line1' },
        el('span', { class: 'id truncate', text: v.vendor_name }),
        el('span', { class: `pill ${v.doc_status === 'ยืนยันแล้ว' ? 'green' : 'amber'}`, text: v.doc_status }),
        el('span', { class: 'amt mono', text: baht(v.paid_total) })),
      el('div', { class: 'line2 truncate' },
        `${v.vendor_id} · ${v.entity_type}${v.wht_percent ? ` · หัก ${v.wht_percent}%` : ''}` +
        `${v.category ? ` · ${v.category}` : ''}${v.phone ? ` · ${v.phone}` : ''}`),
      v.credit_balance > 0
        ? el('div', { class: 'flag' }, el('b', { text: 'W4 ' }), `มีเครดิตค้าง ${baht(v.credit_balance)} บาท`)
        : null,
      v.created_by_name || v.verified_by_name
        ? el('div', { class: 'line2 tiny' },
          `${v.created_by_name ? `สร้างโดย ${v.created_by_name}` : 'นำเข้าจากฐาน v8'}` +
          `${v.verified_by_name ? ` · ยืนยันโดย ${v.verified_by_name}` : ''}`)
        : null,
      canVerify
        ? el('div', { class: 'row mt', onclick: (e) => e.stopPropagation() },
          el('button', {
            class: 'btn sm primary',
            onclick: async () => {
              try { await api.post(`/api/vendors/${v.vendor_id}/verify`); toast('ยืนยันแล้ว', 'ok'); reload(); }
              catch (err) { toast(err.message, 'error'); }
            },
          }, 'ยืนยันเอกสารผู้ขาย'))
        : null);
  }

  function openEdit(v) {
    const canEdit = state.caps.vendor_create || state.caps.vendor_verify;
    const name = el('input', { type: 'text', value: v.vendor_name });
    const phone = el('input', { type: 'text', value: v.phone || '' });
    const category = el('input', { type: 'text', value: v.category || '' });
    const taxId = el('input', { type: 'text', value: v.tax_id || '', placeholder: 'เลขผู้เสียภาษี 13 หลัก' });
    const bank = el('input', { type: 'text', value: v.bank_account || '', placeholder: 'ธนาคาร / เลขบัญชี' });
    const terms = el('input', { type: 'text', value: v.payment_terms || '', placeholder: 'เช่น เครดิต 30 วัน' });
    const entity = select([
      { value: 'นิติบุคคล', label: 'นิติบุคคล' },
      { value: 'บุคคลธรรมดา', label: 'บุคคลธรรมดา' },
    ], { value: v.entity_type });
    const wht = select([0, 1, 2, 3, 5].map((p) => ({ value: p, label: `${p}%` })), { value: v.wht_percent });
    const vat = el('input', { type: 'checkbox' });
    vat.checked = !!v.vat_registered;

    modal({
      title: `${v.vendor_name} (${v.vendor_id})`,
      body: el('div', {},
        el('div', { class: 'small muted mb' },
          `จ่ายไปแล้ว ${baht(v.paid_total)} บาท · ${v.request_count} ใบ`),
        field('ชื่อผู้ขาย', name),
        field('ประเภทนิติบุคคล', entity),
        field('% หัก ณ ที่จ่าย', wht, 'ใช้กับบรรทัดที่เป็นค่าแรงหรือค่าเช่าเท่านั้น'),
        el('label', { class: 'row mb', style: 'gap:.4rem' }, vat, el('span', { class: 'small', text: 'จดทะเบียน VAT' })),
        field('เบอร์โทร', phone),
        field('หมวดสินค้า/บริการ', category),
        field('เลขผู้เสียภาษี', taxId),
        field('บัญชีธนาคาร', bank),
        field('เงื่อนไขชำระ', terms)),
      actions: canEdit ? [
        { label: 'ปิด' },
        {
          label: 'บันทึก', kind: 'primary',
          onClick: async () => {
            try {
              await api.patch(`/api/vendors/${v.vendor_id}`, {
                vendor_name: name.value.trim(), entity_type: entity.value,
                wht_percent: Number(wht.value), vat_registered: vat.checked,
                phone: phone.value.trim(), category: category.value.trim(),
                tax_id: taxId.value.trim(), bank_account: bank.value.trim(),
                payment_terms: terms.value.trim(),
              });
              toast('บันทึกแล้ว', 'ok');
              reload();
            } catch (err) { toast(err.message, 'error'); return true; }
          },
        },
      ] : [{ label: 'ปิด', kind: 'primary' }],
    });
  }

  function openCreate() {
    const name = el('input', { type: 'text', placeholder: 'ชื่อร้าน / ชื่อผู้รับเงิน' });
    const entity = select([
      { value: 'นิติบุคคล', label: 'นิติบุคคล (ร้าน/บริษัท)' },
      { value: 'บุคคลธรรมดา', label: 'บุคคลธรรมดา (หัก ณ ที่จ่าย 3%)' },
    ]);
    const phone = el('input', { type: 'text', inputmode: 'tel' });
    const category = el('input', { type: 'text' });
    modal({
      title: 'สร้างผู้ขายใหม่',
      body: el('div', {},
        field('ชื่อผู้ขาย', name), field('ประเภท', entity),
        field('เบอร์โทร', phone), field('หมวดสินค้า/บริการ', category)),
      actions: [
        { label: 'ยกเลิก' },
        {
          label: 'สร้าง', kind: 'primary',
          onClick: async () => {
            try {
              await api.post('/api/vendors', {
                vendor_name: name.value.trim(), entity_type: entity.value,
                phone: phone.value.trim(), category: category.value.trim(),
              });
              toast('สร้างผู้ขายแล้ว — สถานะ "รอตรวจเอกสาร"', 'ok');
              reload();
            } catch (err) { toast(err.message, 'error'); return true; }
          },
        },
      ],
    });
    name.focus();
  }

  root.append(
    el('div', { class: 'card-head' },
      el('h1', { class: 'grow', text: 'ผู้ขาย' }),
      state.caps.vendor_create
        ? el('button', { class: 'btn sm primary', onclick: openCreate }, '+ สร้างใหม่') : null),
    el('div', { class: 'card tight' }, search,
      el('div', { class: 'filters mt' }, pendingBtn)),
    el('div', { class: 'banner' },
      'จ่ายเงินให้ผู้ขายที่ยังไม่ยืนยันได้ ถ้า COO อนุมัติใบนั้น แต่ระบบจะขึ้นธง W1 เสมอ'),
    listBox);

  paint();
  return root;
}
