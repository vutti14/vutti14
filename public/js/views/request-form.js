/** S1 — สร้าง/แก้ไขใบเบิก (ออกแบบให้กรอกด้วยมือเดียวบนมือถือ · สเปก §8 S1) */
import { api } from '../api.js';
import {
  el, field, select, toast, modal, baht, today, flagList, clear,
} from '../ui.js';
import { state, buildingsOf, navigate } from '../app.js';

const VAT_RATE = 0.07;
const COST_TYPE_BUTTONS = ['ของ', 'แรง', 'เช่า', 'โสหุ้ย'];

export async function render({ params }) {
  const editId = params?.[0] || null;
  let existing = null;
  if (editId) existing = (await api.get(`/api/requests/${editId}`)).request;

  const form = {
    request_date: existing?.request_date || today(),
    project_id: existing?.project_id || state.user.last_project_id || state.projects[0]?.project_id || '',
    building_id: existing?.building_id || state.user.last_building_id || '',
    vendor_id: existing?.vendor_id || '',
    has_vat: existing?.has_vat || 'ไม่มี',
    vat_mode: existing?.vat_mode || 'แยก VAT',
    is_petty_cash: !!existing?.is_petty_cash,
    note: existing?.note || '',
    lines: existing?.lines?.length
      ? existing.lines.map((l) => ({ ...l }))
      : [newLine()],
    attachment_ids: [],
  };
  if (form.building_id && !buildingsOf(form.project_id).some((b) => b.building_id === form.building_id))
    form.building_id = '';

  const root = el('div');
  const totalsBox = el('div', { class: 'sticky-total' });
  const linesBox = el('div');
  const attachBox = el('div', { class: 'row wrap tiny muted' });

  function newLine() {
    return { cost_code: '', cost_type: '', item_id: null, description: '', qty: 1, unit: '', unit_price: 0, line_amount: 0 };
  }

  // ------------------------------------------------------------ หัวใบ
  const buildingSelect = select([], { placeholder: 'เลือกอาคาร' });
  const projectSelect = select(
    state.projects.map((p) => ({ value: p.project_id, label: `${p.project_name} (${p.project_id})` })),
    {
      value: form.project_id,
      placeholder: 'เลือกโครงการ',
      onchange: (e) => { form.project_id = e.target.value; form.building_id = ''; fillBuildings(); },
    });

  function fillBuildings() {
    clear(buildingSelect);
    buildingSelect.append(el('option', { value: '' }, 'เลือกอาคาร'));
    for (const b of buildingsOf(form.project_id)) {
      const opt = el('option', { value: b.building_id },
        `${b.building_name}${b.design_code ? ` · ${b.design_code}` : ''}`);
      if (b.building_id === form.building_id) opt.selected = true;
      buildingSelect.append(opt);
    }
  }
  buildingSelect.addEventListener('change', (e) => { form.building_id = e.target.value; });
  fillBuildings();

  const vendorSelect = select(
    state.vendors.map((v) => ({
      value: v.vendor_id,
      label: `${v.vendor_name}${v.entity_type === 'บุคคลธรรมดา' ? ' · บุคคลธรรมดา' : ''}${v.doc_status === 'รอตรวจเอกสาร' ? ' · รอตรวจเอกสาร' : ''}`,
    })),
    { value: form.vendor_id, placeholder: 'เลือกผู้ขาย', onchange: (e) => { form.vendor_id = e.target.value; recalc(); } });

  const newVendorBtn = el('button', { class: 'btn sm', type: 'button', onclick: openNewVendor }, '+ สร้างผู้ขายใหม่');

  const vatRadios = radioRow('มี VAT?', ['ไม่มี', 'มี'], form.has_vat, (v) => {
    form.has_vat = v;
    vatModeWrap.classList.toggle('hidden', v !== 'มี');
    recalc();
  });
  const vatModeRadios = radioRow('วิธีกรอก VAT', ['แยก VAT', 'รวม VAT แล้ว'], form.vat_mode, (v) => {
    form.vat_mode = v; recalc();
  });
  const vatModeWrap = el('div', {}, vatModeRadios);
  vatModeWrap.classList.toggle('hidden', form.has_vat !== 'มี');

  function radioRow(label, options, current, onPick) {
    const wrap = el('div', { class: 'field' }, el('label', { text: label }));
    const row = el('div', { class: 'radio-row' });
    for (const o of options) {
      const input = el('input', { type: 'radio', name: label, value: o });
      input.checked = o === current;
      const lab = el('label', { class: input.checked ? 'on' : '' }, input, o);
      input.addEventListener('change', () => {
        for (const other of row.children) other.classList.remove('on');
        lab.classList.add('on');
        onPick(o);
      });
      row.append(lab);
    }
    wrap.append(row);
    return wrap;
  }

  // ------------------------------------------------------------ รายการย่อย
  function lineCard(line, index) {
    const amountOut = el('div', { class: 'right', style: 'font-weight:700' });

    const codeSelect = select(
      state.costCodes.map((c) => ({ value: c.cost_code, label: `${c.cost_code} · ${c.cost_name}` })),
      {
        value: line.cost_code, placeholder: 'เลือกหมวดงาน',
        onchange: (e) => {
          line.cost_code = e.target.value;
          const def = state.costCodes.find((c) => c.cost_code === line.cost_code)?.default_cost_type;
          if (def && !line.cost_type) { line.cost_type = def; paintTypes(); }
        },
      });

    const typeRow = el('div', { class: 'segment' });
    const paintTypes = () => {
      clear(typeRow);
      for (const t of COST_TYPE_BUTTONS) {
        typeRow.append(el('button', {
          type: 'button', class: line.cost_type === t ? 'on' : '',
          onclick: () => { line.cost_type = t; paintTypes(); recalc(); },
        }, t));
      }
    };
    paintTypes();

    const itemSelect = select(
      state.items.map((i) => ({ value: i.item_id, label: `${i.item_name} (${i.unit})` })),
      {
        value: line.item_id || '', placeholder: 'ไม่อ้างอิงรายการมาตรฐาน',
        onchange: (e) => {
          line.item_id = e.target.value || null;
          const item = state.items.find((i) => i.item_id === line.item_id);
          if (item) {
            unitInput.value = line.unit = item.unit || '';
            if (!Number(priceInput.value) && item.ref_price_min) {
              priceInput.value = item.ref_price_min;
              line.unit_price = item.ref_price_min;
            }
            descInput.value = line.description = descInput.value || item.item_name;
            refHint.textContent = item.ref_price_min
              ? `ราคาอ้างอิงต่ำสุดในฐาน ${baht(item.ref_price_min)} บาท/${item.unit}` : '';
            recalcLine();
          } else refHint.textContent = '';
        },
      });
    const refHint = el('div', { class: 'tiny muted' });

    const descInput = el('input', { type: 'text', placeholder: 'รายละเอียด เช่น เหล็ก DB12', value: line.description });
    descInput.addEventListener('input', () => { line.description = descInput.value; });

    const qtyInput = el('input', { type: 'number', step: '0.01', inputmode: 'decimal', value: line.qty });
    const unitInput = el('input', { type: 'text', placeholder: 'หน่วย', value: line.unit });
    const priceInput = el('input', { type: 'number', step: '0.01', inputmode: 'decimal', value: line.unit_price || '' });

    function recalcLine() {
      line.qty = Number(qtyInput.value) || 0;
      line.unit = unitInput.value;
      line.unit_price = Number(priceInput.value) || 0;
      line.line_amount = Math.round(line.qty * line.unit_price * 100) / 100;
      amountOut.textContent = `= ${baht(line.line_amount)} บาท`;
      recalc();
    }
    for (const input of [qtyInput, priceInput, unitInput]) input.addEventListener('input', recalcLine);
    recalcLine();

    return el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h3', { text: `รายการที่ ${index + 1}` }),
        form.lines.length > 1
          ? el('button', {
            class: 'btn sm ghost', type: 'button',
            onclick: () => { form.lines.splice(index, 1); paintLines(); },
          }, 'ลบ')
          : null),
      field('หมวดงาน', codeSelect),
      field('ประเภทต้นทุน (บังคับ)', typeRow),
      field('รายการมาตรฐาน', itemSelect, ''),
      refHint,
      field('รายละเอียด', descInput),
      el('div', { class: 'row' },
        el('div', { class: 'grow' }, field('จำนวน', qtyInput)),
        el('div', { class: 'grow' }, field('หน่วย', unitInput)),
        el('div', { class: 'grow' }, field('ราคา/หน่วย', priceInput))),
      amountOut);
  }

  function paintLines() {
    clear(linesBox);
    form.lines.forEach((l, i) => linesBox.append(lineCard(l, i)));
    recalc();
  }

  // ------------------------------------------------------------ ยอดรวม
  function recalc() {
    const vendor = state.vendors.find((v) => v.vendor_id === form.vendor_id);
    const sum = form.lines.reduce((s, l) => s + (Number(l.line_amount) || 0), 0);
    let before = sum, vat = 0, total = sum;
    if (form.has_vat === 'มี') {
      if (form.vat_mode === 'รวม VAT แล้ว') {
        total = sum; before = Math.round((sum / (1 + VAT_RATE)) * 100) / 100; vat = Math.round((total - before) * 100) / 100;
      } else {
        vat = Math.round(sum * VAT_RATE * 100) / 100; total = Math.round((sum + vat) * 100) / 100;
      }
    }
    const whtRaw = form.lines.filter((l) => ['แรง', 'เช่า'].includes(l.cost_type))
      .reduce((s, l) => s + (Number(l.line_amount) || 0), 0);
    const whtBase = form.has_vat === 'มี' && form.vat_mode === 'รวม VAT แล้ว'
      ? whtRaw / (1 + VAT_RATE) : whtRaw;
    const wht = Math.round(whtBase * Number(vendor?.wht_percent || 0)) / 100;

    clear(totalsBox).append(
      row('ยอดก่อน VAT', baht(before)),
      row(`VAT ${form.has_vat === 'มี' ? '7%' : '(ไม่มี)'}`, baht(vat)),
      row(`หัก ณ ที่จ่าย ${vendor?.wht_percent ? vendor.wht_percent + '%' : ''}`, baht(wht)),
      row('ยอดจ่ายสุทธิ', baht(Math.round((total - wht) * 100) / 100), true));
    return { before, vat, total, wht };
  }

  const row = (label, value, strong = false) =>
    el('div', { class: 'spread', style: strong ? 'font-weight:700;font-size:1.05rem' : 'font-size:.85rem' },
      el('span', { class: strong ? '' : 'muted', text: label }),
      el('span', { class: 'mono', text: value + ' บาท' }));

  // ------------------------------------------------------------ ไฟล์แนบ
  const fileInput = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, capture: 'environment' });
  fileInput.addEventListener('change', async () => {
    if (!fileInput.files.length) return;
    try {
      const target = editId ? `/api/requests/${editId}/attachments` : '/api/requests/new/attachments';
      const out = await api.upload(target, [...fileInput.files]);
      for (const f of out.files) {
        form.attachment_ids.push(f.file_id);
        attachBox.append(el('span', { class: 'pill blue', text: f.orig_name }));
      }
      toast(`แนบไฟล์แล้ว ${out.files.length} ไฟล์`, 'ok');
    } catch (err) { toast(err.message, 'error'); }
    fileInput.value = '';
  });

  // ------------------------------------------------------------ บันทึก
  async function save(submit) {
    const payload = {
      ...form,
      submit,
      lines: form.lines.map((l) => ({
        cost_code: l.cost_code, cost_type: l.cost_type, item_id: l.item_id,
        description: l.description, qty: l.qty, unit: l.unit,
        unit_price: l.unit_price, line_amount: l.line_amount,
      })),
    };
    try {
      const out = editId
        ? await api.put(`/api/requests/${editId}`, payload)
        : await api.post('/api/requests', payload);
      const req = out.request;
      if (out.flags?.length) {
        modal({
          title: `บันทึกแล้ว · ${req.request_id}`,
          body: el('div', {},
            el('p', { class: 'small', text: 'ใบนี้ติดธงเตือน ผู้อนุมัติจะต้องเปิดดูและกดอนุมัติทีละใบ' }),
            ...flagList(out.flags)),
          actions: [{ label: 'เข้าใจแล้ว', kind: 'primary', onClick: () => navigate(`requests/${req.request_id}`) }],
        });
      } else {
        toast(submit ? `ส่งขออนุมัติแล้ว ${req.request_id}` : `บันทึกร่างแล้ว ${req.request_id}`, 'ok');
        navigate(`requests/${req.request_id}`);
      }
    } catch (err) {
      const list = err.payload?.errors || [{ message: err.message }];
      modal({
        title: 'ยังบันทึกไม่ได้',
        body: el('ul', {}, list.map((e) => el('li', { class: 'small' }, e.code ? `[${e.code}] ` : '', e.message))),
        actions: [{ label: 'แก้ไข', kind: 'primary' }],
      });
    }
  }

  function openNewVendor() {
    const name = el('input', { type: 'text', placeholder: 'ชื่อร้าน / ชื่อผู้รับเงิน' });
    const phone = el('input', { type: 'text', inputmode: 'tel', placeholder: 'เบอร์โทร' });
    const category = el('input', { type: 'text', placeholder: 'ขายอะไร เช่น เหล็ก คอนกรีต' });
    const entity = select([
      { value: 'นิติบุคคล', label: 'นิติบุคคล (ร้าน/บริษัท)' },
      { value: 'บุคคลธรรมดา', label: 'บุคคลธรรมดา (หัก ณ ที่จ่าย 3%)' },
    ]);
    modal({
      title: 'สร้างผู้ขายใหม่',
      body: el('div', {},
        el('p', { class: 'tiny muted', text: 'สร้างได้ทันที สถานะจะเป็น "รอตรวจเอกสาร" จนกว่าคนอื่นจะยืนยัน' }),
        field('ชื่อผู้ขาย', name), field('ประเภท', entity),
        field('เบอร์โทร', phone), field('หมวดสินค้า/บริการ', category)),
      actions: [
        { label: 'ยกเลิก' },
        {
          label: 'สร้าง', kind: 'primary',
          onClick: async () => {
            try {
              const out = await api.post('/api/vendors', {
                vendor_name: name.value.trim(), entity_type: entity.value,
                phone: phone.value.trim(), category: category.value.trim(),
              });
              state.vendors.push(out.vendor);
              state.vendors.sort((a, b) => a.vendor_name.localeCompare(b.vendor_name, 'th'));
              vendorSelect.append(el('option', { value: out.vendor.vendor_id }, out.vendor.vendor_name));
              vendorSelect.value = out.vendor.vendor_id;
              form.vendor_id = out.vendor.vendor_id;
              recalc();
              toast('สร้างผู้ขายแล้ว', 'ok');
            } catch (err) { toast(err.message, 'error'); return true; }
          },
        },
      ],
    });
    name.focus();
  }

  const noteInput = el('textarea', { placeholder: 'หมายเหตุ (ไม่บังคับ)' }, form.note);
  noteInput.addEventListener('input', () => { form.note = noteInput.value; });

  const dateInput = el('input', { type: 'date', value: form.request_date });
  dateInput.addEventListener('change', () => { form.request_date = dateInput.value; });

  const pettyToggle = el('input', { type: 'checkbox' });
  pettyToggle.checked = form.is_petty_cash;
  pettyToggle.addEventListener('change', () => { form.is_petty_cash = pettyToggle.checked; });

  root.append(
    el('h1', { text: editId ? `แก้ไข ${editId}` : 'สร้างใบเบิก' }),
    el('div', { class: 'card' },
      field('วันที่ขอ', dateInput),
      field('โครงการ', projectSelect),
      field('อาคาร', buildingSelect),
      field('ผู้ขาย', el('div', {}, vendorSelect, el('div', { class: 'mt' }, newVendorBtn))),
      vatRadios, vatModeWrap,
      el('label', { class: 'row', style: 'gap:.5rem;align-items:center' },
        pettyToggle, el('span', { class: 'small', text: 'จ่ายจากเงินสดย่อย (ต่อรายการไม่เกิน 2,000)' }))),
    linesBox,
    el('button', {
      class: 'btn block mb', type: 'button',
      onclick: () => { form.lines.push(newLine()); paintLines(); },
    }, '+ เพิ่มรายการ'),
    el('div', { class: 'card' },
      field('แนบรูป / ไฟล์', fileInput,
        `ใบเกิน ${Number(state.settings.photo_required_above).toLocaleString('th-TH')} บาท ต้องแนบอย่างน้อย 1 ไฟล์`),
      attachBox,
      field('หมายเหตุ', noteInput)),
    totalsBox,
    el('div', { class: 'row mt', style: 'gap:.5rem' },
      el('button', { class: 'btn grow', type: 'button', onclick: () => save(false) }, 'บันทึกร่าง'),
      el('button', { class: 'btn primary grow', type: 'button', onclick: () => save(true) }, 'ส่งขออนุมัติ')));

  if (existing) {
    for (const a of existing.attachments || [])
      attachBox.append(el('span', { class: 'pill blue', text: a.orig_name }));
  }
  paintLines();
  return root;
}
