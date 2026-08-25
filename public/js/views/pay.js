/** S3 — หน้าจ่ายเงิน (การเงิน) · แนบสลิปบังคับ (B7) */
import { api } from '../api.js';
import { el, field, select, baht, toast, modal, today, flagList } from '../ui.js';
import { navigate, reload } from '../app.js';

const BANK_ACCOUNTS = ['กสิกรไทย', 'ไทยพาณิชย์', 'กรุงเทพ', 'กรุงไทย', 'กรุงศรี', 'เงินสด'];

export async function render() {
  const data = await api.get('/api/payments/queue');
  const root = el('div');

  root.append(el('div', { class: 'card tight spread' },
    el('div', {}, el('div', { class: 'muted tiny', text: 'อนุมัติแล้วรอจ่าย' }),
      el('div', { style: 'font-weight:700', text: `${data.queue.length} ใบ` })),
    el('div', { class: 'right' }, el('div', { class: 'muted tiny', text: 'ยอดจ่ายสุทธิรวม' }),
      el('div', { class: 'mono', style: 'font-weight:700', text: `${baht(data.total_amount)} บาท` }))));

  if (!data.queue.length) {
    root.append(el('div', { class: 'empty', text: 'ไม่มีรายการรอจ่าย' }));
    return root;
  }

  root.append(el('div', { class: 'banner' },
    'เคล็ดลับ: ในช่อง "บันทึกช่วยจำ" ของแอปธนาคาร ให้พิมพ์เลขที่ใบเบิก เช่น REQ-2609-0042 แทนคำอธิบายงาน แล้วสลิปจะจับคู่กับใบเบิกได้ตลอดไป'));

  root.append(el('div', { class: 'list' }, data.queue.map((r) => el('div', { class: 'item' },
    el('div', { class: 'line1', onclick: () => navigate(`requests/${r.request_id}`) },
      el('span', { class: 'id', text: r.request_id }),
      r.flags?.length ? el('span', { text: '⚠️' }) : null,
      el('span', { class: 'amt mono', text: baht(r.net_amount) })),
    el('div', { class: 'line2 truncate' },
      `${r.vendor_name || '—'} · ${r.building_name} · อนุมัติโดย ${r.approver_name || '—'}`),
    r.wht_amount > 0
      ? el('div', { class: 'line2', text: `ยอดรวม ${baht(r.total_amount)} − หัก ณ ที่จ่าย ${baht(r.wht_amount)}` })
      : null,
    r.vendor_credit > 0
      ? el('div', { class: 'flag' }, el('b', { text: 'W4 ' }),
        `ผู้ขายรายนี้มีเครดิตค้าง ${baht(r.vendor_credit)} บาท — ควรหักกลบก่อนโอน`)
      : null,
    ...flagList(r.flags || []),
    el('div', { class: 'row mt' },
      el('button', { class: 'btn primary sm grow', onclick: () => openPayForm(r) }, 'บันทึกการจ่าย'))))));

  return root;
}

function openPayForm(r) {
  const payDate = el('input', { type: 'date', value: today() });
  const bank = select(BANK_ACCOUNTS.map((b) => ({ value: b, label: b })), { placeholder: 'เลือกบัญชีที่จ่ายออก' });
  const ref = el('input', { type: 'text', value: r.request_id, placeholder: 'เลขที่รายการโอน' });
  const slip = el('input', { type: 'file', accept: 'image/*,application/pdf', capture: 'environment' });

  modal({
    title: `จ่าย ${r.request_id}`,
    body: el('div', {},
      el('div', { class: 'spread', style: 'font-weight:700' },
        el('span', { text: 'ยอดจ่ายสุทธิ' }),
        el('span', { class: 'mono', text: `${baht(r.net_amount)} บาท` })),
      el('div', { class: 'tiny muted mb', text: `${r.vendor_name || '—'} · ${r.bank_account || 'ยังไม่มีเลขบัญชีในระบบ'}` }),
      field('วันที่จ่าย', payDate),
      field('บัญชีที่จ่ายออก', bank),
      field('เลขที่รายการโอน', ref),
      field('สลิปการโอน (บังคับ)', slip)),
    actions: [
      { label: 'ยกเลิก' },
      {
        label: 'บันทึกการจ่าย', kind: 'primary',
        onClick: async () => {
          if (!slip.files[0]) { toast('ต้องแนบสลิปก่อน (กฎ B7)', 'error'); return true; }
          try {
            const up = await api.upload(`/api/requests/${r.request_id}/attachments`,
              [slip.files[0]], { purpose: 'สลิปการโอน' });
            await api.post('/api/payments', {
              request_id: r.request_id, payment_date: payDate.value,
              bank_account: bank.value, transfer_ref: ref.value.trim(),
              slip_file_id: up.files[0].file_id,
            });
            toast('บันทึกการจ่ายแล้ว', 'ok');
            reload();
          } catch (err) { toast(err.message, 'error'); return true; }
        },
      },
    ],
  });
}
