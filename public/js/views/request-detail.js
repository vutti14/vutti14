/** หน้ารายละเอียดใบเบิก — ใช้ร่วมกันทุกบทบาท ปุ่มที่เห็นขึ้นกับสิทธิ์และสถานะ */
import { api } from '../api.js';
import {
  el, field, select, toast, modal, confirmDialog, baht, thaiDate, thaiDateTime,
  duration, statusPill, flagList, table, today, docGrid,
} from '../ui.js';
import { state, navigate, reload, buildingsOf } from '../app.js';

export async function renderDetail(id) {
  const { request: r } = await api.get(`/api/requests/${id}`);
  const root = el('div');
  const isOwner = r.requester_id === state.user.user_id;
  const frozen = ['จ่ายแล้ว', 'ปิดรายการ'].includes(r.status);

  const action = async (fn, okMessage) => {
    try { await fn(); if (okMessage) toast(okMessage, 'ok'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };

  // ------------------------------------------------------------ หัวใบ
  root.append(el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h1', { text: r.request_id }),
      statusPill(r.status)),
    r.value_source === 'นำเข้าย้อนหลัง'
      ? el('div', { class: 'banner warn' },
        `ข้อมูลนำเข้าย้อนหลังจากฐานกลาง v9${r.confidence ? ` · ระดับความเชื่อถือ ${r.confidence}` : ''}` +
        (['C', 'C2', 'D'].includes(r.confidence)
          ? ' — ตัวเลขแยกประเภทต้นทุนเป็นการประมาณ ไม่ใช่ข้อเท็จจริง' : ''))
      : null,
    kv('วันที่ขอ', thaiDate(r.request_date)),
    kv('ผู้ขอ', `${r.requester_name} (${r.requester_id})`),
    kv('โครงการ', `${r.project_name} (${r.project_id})`),
    kv('อาคาร', `${r.building_name}${r.design_code ? ` · แบบ ${r.design_code}` : ''}`),
    kv('ผู้ขาย', r.vendor_name || r.payee_name_raw || '—'),
    kv('รหัสอ้างอิงเดิม', r.legacy_code || '—'),
    r.paid_to_staff
      ? el('div', { class: 'flag' }, el('b', { text: 'W10 ' }),
        r.self_paid ? 'เบิกเองจ่ายตัวเอง — น่าจะเป็นการคืนเงินสำรองจ่าย ต้องระบุประเภทที่แท้จริง'
          : 'จ่ายให้ทีมงานของเราเอง — ไม่ใช่ผู้รับเหมาภายนอก ตรวจว่าควรลงเป็นค่าแรงหรือเงินทดรอง')
      : null,
    r.note ? kv('หมายเหตุ', r.note) : null,
    r.approver_name ? kv('ผู้อนุมัติ', `${r.approver_name} · ${thaiDateTime(r.approved_at)}`) : null,
    r.approval_seconds !== null && r.approval_seconds !== undefined
      ? kv('เวลาที่ใช้อนุมัติ', duration(r.approval_seconds)) : null,
    r.reject_reason ? kv('เหตุผลที่ไม่อนุมัติ', r.reject_reason) : null,
    r.cancel_reason ? kv('เหตุผลที่ยกเลิก', r.cancel_reason) : null));

  if (r.flags?.length)
    root.append(el('div', { class: 'card' },
      el('div', { class: 'rule-head', text: 'ธงเตือน' }), ...flagList(r.flags)));

  // ------------------------------------------------------------ รายการย่อย
  root.append(el('div', { class: 'card' },
    el('div', { class: 'rule-head', text: 'รายการย่อย' }),
    table([
      { label: 'หมวดงาน', render: (l) => `${l.cost_code}` },
      { label: 'ประเภท', render: (l) => el('span', { class: 'pill', text: l.cost_type }) },
      { label: 'รายละเอียด', key: 'description' },
      { label: 'จำนวน', num: true, render: (l) => `${baht(l.qty, 2)} ${l.unit || ''}` },
      { label: 'ราคา/หน่วย', num: true, render: (l) => baht(l.unit_price) },
      { label: 'จำนวนเงิน', num: true, render: (l) => baht(l.line_amount) },
    ], r.lines),
    el('div', { class: 'mt' },
      money('ยอดก่อน VAT', r.amount_before_vat),
      money(`VAT (${r.has_vat}${r.has_vat === 'มี' ? ' · ' + r.vat_mode : ''})`, r.vat_amount),
      money('ยอดรวม', r.total_amount),
      money(`หัก ณ ที่จ่าย${r.wht_percent ? ` ${r.wht_percent}%` : ''}`, -r.wht_amount),
      money('ยอดจ่ายสุทธิ', r.net_amount, true))));

  // ------------------------------------------------------------ การจ่าย
  if (r.payment)
    root.append(el('div', { class: 'card' },
      el('div', { class: 'rule-head', text: 'การจ่ายเงิน' }),
      kv('เลขที่', r.payment.payment_id),
      kv('วันที่จ่าย', thaiDate(r.payment.payment_date)),
      kv('บัญชีที่จ่ายออก', r.payment.bank_account || '—'),
      kv('เลขที่รายการโอน', r.payment.transfer_ref || '—'),
      kv('ผู้บันทึก', r.payment.paid_by_name || '—'),
      r.payment.slip_file_id
        ? el('a', { href: `/api/files/${r.payment.slip_file_id}`, target: '_blank' }, 'ดูสลิป')
        : null));

  // ------------------------------------------------------------ เอกสาร
  if (['จ่ายแล้ว', 'ปิดรายการ'].includes(r.status)) {
    const docBox = el('div', { class: 'card' },
      el('div', { class: 'rule-head', text: 'เอกสารที่ต้องเก็บ' }));
    const done = new Map((r.documents || []).map((d) => [d.doc_type, d]));
    // ภาพรวมสามช่องแบบต้นแบบ กดที่ช่องเพื่อบันทึกได้เลย
    docBox.append(docGrid(r.required_documents.map((need) => {
      const d = done.get(need.doc_type) || {};
      return {
        label: need.doc_type,
        hint: d.received ? thaiDate(d.doc_date) : 'ยังไม่ได้รับ',
        state: d.received ? 'done' : 'late',
        onclick: state.caps.documents ? () => openDocForm(r, need.doc_type, d) : undefined,
      };
    })));
    for (const need of r.required_documents) {
      const d = done.get(need.doc_type) || {};
      docBox.append(el('div', { class: 'doc-row' },
        el('span', { class: `pill ${d.received ? 'green' : 'amber'}`, text: d.received ? 'ครบ' : 'ค้าง' }),
        el('div', { class: 'grow' },
          el('div', { class: 'small', text: need.doc_type }),
          el('div', { class: 'tiny muted', text: d.received
            ? `บนเอกสาร ${thaiDate(d.doc_date)} · รับ ${thaiDate(d.received_date)}${d.doc_no ? ` · เลขที่ ${d.doc_no}` : ''}`
            : need.question })),
        state.caps.documents
          ? el('button', { class: 'btn sm', onclick: () => openDocForm(r, need.doc_type, d) }, d.received ? 'แก้ไข' : 'บันทึก')
          : null));
    }
    if (r.lines.some((l) => l.cost_type === 'ของ'))
      docBox.append(el('div', { class: 'doc-row' },
        el('span', { class: `pill ${r.goods_received ? 'green' : 'amber'}`, text: r.goods_received ? 'ของมาแล้ว' : 'ของยังไม่มา' }),
        el('div', { class: 'grow small', text: r.goods_received ? `ยืนยันเมื่อ ${thaiDate(r.goods_received_at)}` : 'จ่ายไปแล้วได้ของหรือยัง' }),
        state.caps.goods_confirm
          ? el('button', {
            class: 'btn sm',
            onclick: () => action(() => api.post(`/api/requests/${r.request_id}/goods-received`,
              { received: !r.goods_received, date: today() }), 'บันทึกแล้ว'),
          }, r.goods_received ? 'ยกเลิก' : 'ของมาแล้ว')
          : null));
    root.append(docBox);
  }

  // ------------------------------------------------------------ ใบกลับรายการ
  if (r.reversals?.length)
    root.append(el('div', { class: 'card' },
      el('div', { class: 'rule-head', text: 'ใบกลับรายการ' }),
      table([
        { label: 'เลขที่', key: 'reversal_id' },
        { label: 'ประเภท', key: 'reversal_type' },
        { label: 'ยอด', num: true, render: (x) => baht(x.amount) },
        { label: 'ปลายทาง', key: 'destination' },
        { label: 'เหตุผล', key: 'reason' },
      ], r.reversals)));

  // ------------------------------------------------------------ ไฟล์แนบ
  if (r.attachments?.length)
    root.append(el('div', { class: 'card' },
      el('div', { class: 'rule-head', text: 'ไฟล์แนบ' }),
      el('div', { class: 'row wrap' }, r.attachments.map((a) =>
        el('a', { class: 'pill blue', href: `/api/files/${a.file_id}`, target: '_blank' },
          `${a.purpose} · ${a.orig_name}`)))));

  // ------------------------------------------------------------ ปุ่มตามสถานะ
  const actions = el('div', { class: 'row wrap mt' });

  if (r.status === 'ร่าง' && isOwner) {
    actions.append(
      el('button', { class: 'btn', onclick: () => navigate(`new/${r.request_id}`) }, 'แก้ไข'),
      el('button', {
        class: 'btn primary',
        onclick: () => action(() => api.post(`/api/requests/${r.request_id}/submit`), 'ส่งขออนุมัติแล้ว'),
      }, 'ส่งขออนุมัติ'),
      el('button', {
        class: 'btn danger', onclick: async () => {
          if (await confirmDialog('ลบร่างนี้?', 'ลบแล้วกู้คืนไม่ได้'))
            action(() => api.del(`/api/requests/${r.request_id}`).then(() => navigate('requests')), 'ลบแล้ว');
        },
      }, 'ลบร่าง'));
  }

  if (r.status === 'รออนุมัติ') {
    if (isOwner)
      actions.append(el('button', {
        class: 'btn', onclick: async () => {
          const reason = await confirmDialog('ถอนใบนี้?', 'ใบจะกลายเป็นยกเลิก', { needReason: true });
          if (reason) action(() => api.post(`/api/requests/${r.request_id}/withdraw`, { reason }), 'ถอนแล้ว');
        },
      }, 'ถอนใบ'));
    if (state.caps.approve) {
      actions.append(
        el('button', {
          class: 'btn primary', onclick: async () => {
            if (r.flags?.length || r.requester_id === state.user.user_id) {
              const ok = await confirmDialog('อนุมัติทั้งที่ติดธง?',
                'ใบนี้ติดธงเตือน ระบบจะบันทึกว่าอนุมัติโดยรับทราบธงแล้ว');
              if (!ok) return;
            }
            action(() => api.post(`/api/requests/${r.request_id}/approve`, { acknowledge_flags: true }), 'อนุมัติแล้ว');
          },
        }, 'อนุมัติ'),
        el('button', {
          class: 'btn danger', onclick: async () => {
            const reason = await confirmDialog('ไม่อนุมัติใบนี้?', 'ต้องระบุเหตุผล', { needReason: true, danger: true });
            if (reason) action(() => api.post(`/api/requests/${r.request_id}/reject`, { reason }), 'บันทึกแล้ว');
          },
        }, 'ไม่อนุมัติ'));
    }
  }

  if (r.status === 'อนุมัติแล้ว') {
    if (state.caps.pay)
      actions.append(el('button', { class: 'btn primary', onclick: () => navigate('pay') }, 'ไปหน้าจ่ายเงิน'));
    if (state.caps.approve)
      actions.append(el('button', {
        class: 'btn danger', onclick: async () => {
          const reason = await confirmDialog('ยกเลิกใบที่อนุมัติแล้ว?', 'ต้องระบุเหตุผล', { needReason: true, danger: true });
          if (reason) action(() => api.post(`/api/requests/${r.request_id}/cancel`, { reason }), 'ยกเลิกแล้ว');
        },
      }, 'ยกเลิกใบ'));
  }

  if (frozen && state.caps.reversal)
    actions.append(el('button', { class: 'btn', onclick: () => openReversal(r) }, 'ออกใบกลับรายการ'));

  if (['CEO', 'COO', 'ACCOUNT', 'PM', 'SERVICE'].includes(state.user.role))
    actions.append(el('button', { class: 'btn ghost', onclick: () => openMetaEdit(r) }, 'แก้ข้อมูลประกอบ'));

  actions.append(el('button', {
    class: 'btn ghost',
    onclick: async () => {
      const { log } = await api.get(`/api/audit?table=requests&record=${r.request_id}`);
      modal({
        title: 'ประวัติการเปลี่ยนแปลง',
        body: table([
          { label: 'เมื่อ', render: (x) => thaiDateTime(x.created_at) },
          { label: 'โดย', key: 'display_name' },
          { label: 'ทำอะไร', key: 'action' },
          { label: 'ฟิลด์', key: 'field_name' },
          { label: 'จาก', key: 'old_value' },
          { label: 'เป็น', key: 'new_value' },
          { label: 'เหตุผล', key: 'reason' },
        ], log, { empty: 'ยังไม่มีการแก้ไข' }),
        actions: [{ label: 'ปิด' }],
      });
    },
  }, 'ประวัติการแก้ไข'));

  root.append(actions);
  return root;

  // ------------------------------------------------------------ ฟอร์มย่อย
  function openDocForm(req, docType, current) {
    const received = el('input', { type: 'checkbox' });
    received.checked = !!current.received;
    const docDate = el('input', { type: 'date', value: current.doc_date || '' });
    const receivedDate = el('input', { type: 'date', value: current.received_date || today() });
    const docNo = el('input', { type: 'text', value: current.doc_no || '', placeholder: 'เลขที่เอกสาร' });
    const amount = el('input', { type: 'number', step: '0.01', value: current.amount ?? '' });
    const fileInput = el('input', { type: 'file', accept: 'image/*,application/pdf' });
    modal({
      title: docType,
      body: el('div', {},
        el('label', { class: 'row', style: 'gap:.5rem' }, received, el('span', { text: 'ได้รับเอกสารแล้ว' })),
        field('วันที่บนเอกสาร', docDate, 'ใช้กำหนดเดือนภาษี — ไม่ใช่วันที่ได้รับ'),
        field('วันที่ได้รับ', receivedDate),
        field('เลขที่เอกสาร', docNo),
        docType.startsWith('หัก ณ ที่จ่าย') ? field('ยอดที่หัก', amount) : null,
        field('แนบไฟล์', fileInput)),
      actions: [
        { label: 'ยกเลิก' },
        {
          label: 'บันทึก', kind: 'primary',
          onClick: async () => {
            try {
              let fileId = null;
              if (fileInput.files[0]) {
                const up = await api.upload(`/api/requests/${req.request_id}/attachments`,
                  [fileInput.files[0]], { purpose: docType });
                fileId = up.files[0].file_id;
              }
              await api.post(`/api/requests/${req.request_id}/documents`, {
                doc_type: docType, received: received.checked,
                doc_date: docDate.value || null, received_date: receivedDate.value || null,
                doc_no: docNo.value, amount: amount.value ? Number(amount.value) : null,
                file_id: fileId,
              });
              toast('บันทึกเอกสารแล้ว', 'ok');
              reload();
            } catch (err) { toast(err.message, 'error'); return true; }
          },
        },
      ],
    });
  }

  function openReversal(req) {
    const type = select([
      { value: 'จ่ายเกิน', label: 'จ่ายเกิน' }, { value: 'จ่ายซ้ำ', label: 'จ่ายซ้ำ' },
      { value: 'ของคืน', label: 'ของคืน' }, { value: 'ของไม่ครบ', label: 'ของไม่ครบ' },
    ]);
    const amount = el('input', { type: 'number', step: '0.01', placeholder: 'ยอดที่ต้องกลับรายการ' });
    const destination = select([
      { value: 'ได้เงินคืน', label: 'ได้เงินคืนเข้าบัญชี' },
      { value: 'หักกลบบิลหน้า', label: 'หักกลบบิลหน้า (เก็บเป็นเครดิตกับผู้ขาย)' },
    ]);
    const reason = el('textarea', { placeholder: 'เหตุผล (บังคับ)' });
    const receivedDate = el('input', { type: 'date', value: today() });
    modal({
      title: `ใบกลับรายการของ ${req.request_id}`,
      body: el('div', {},
        el('p', { class: 'tiny muted', text: `ยอดใบเดิม ${baht(req.total_amount)} บาท` }),
        field('ประเภท', type), field('ยอด (กรอกเป็นบวก ระบบจะบันทึกติดลบ)', amount),
        field('ปลายทาง', destination), field('วันที่รับคืน', receivedDate),
        field('เหตุผล', reason)),
      actions: [
        { label: 'ยกเลิก' },
        {
          label: 'บันทึก', kind: 'primary',
          onClick: async () => {
            try {
              await api.post(`/api/requests/${req.request_id}/reversals`, {
                reversal_type: type.value, amount: Number(amount.value),
                destination: destination.value, reason: reason.value.trim(),
                received_date: receivedDate.value,
              });
              toast('บันทึกใบกลับรายการแล้ว', 'ok');
              reload();
            } catch (err) { toast(err.message, 'error'); return true; }
          },
        },
      ],
    });
  }

  function openMetaEdit(req) {
    const buildingSel = select(
      buildingsOf(req.project_id).map((b) => ({ value: b.building_id, label: b.building_name })),
      { value: req.building_id });
    const note = el('textarea', {}, req.note || '');
    const reason = el('input', { type: 'text', placeholder: 'เหตุผลในการแก้ (บังคับเมื่อจ่ายแล้ว)' });
    modal({
      title: 'แก้ข้อมูลประกอบ',
      body: el('div', {},
        el('p', { class: 'tiny muted', text: 'ยอดเงินของใบที่จ่ายแล้วแก้ไม่ได้ตลอดกาล แก้ได้เฉพาะอาคารและหมายเหตุ ทุกการแก้จะถูกบันทึกไว้' }),
        field('อาคาร', buildingSel), field('หมายเหตุ', note), field('เหตุผล', reason)),
      actions: [
        { label: 'ยกเลิก' },
        {
          label: 'บันทึก', kind: 'primary',
          onClick: async () => {
            try {
              await api.patch(`/api/requests/${req.request_id}/meta`, {
                building_id: buildingSel.value, note: note.value, reason: reason.value.trim(),
              });
              toast('บันทึกแล้ว', 'ok');
              reload();
            } catch (err) { toast(err.message, 'error'); return true; }
          },
        },
      ],
    });
  }
}

const kv = (label, value) =>
  el('div', { class: 'spread', style: 'padding:.2rem 0' },
    el('span', { class: 'muted small', text: label }),
    el('span', { class: 'small right', text: String(value ?? '—') }));

const money = (label, value, strong = false) =>
  el('div', { class: 'spread', style: strong ? 'font-weight:700' : '' },
    el('span', { class: strong ? '' : 'muted small', text: label }),
    el('span', { class: 'mono', text: `${baht(value)} บาท` }));
