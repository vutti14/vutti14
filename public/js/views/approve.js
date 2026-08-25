/** S2 — หน้าอนุมัติ (COO) · ใบที่ไม่มีธงเลือกหลายใบกดครั้งเดียวได้ ใบที่มีธงต้องเปิดทีละใบ */
import { api, qs } from '../api.js';
import { el, clear, baht, thaiDate, toast, modal, flagList, confirmDialog } from '../ui.js';
import { state, navigate, reload } from '../app.js';

export async function render() {
  const data = await api.get('/api/requests' + qs({ status: 'รออนุมัติ', per_page: 200 }));
  const root = el('div');
  const picked = new Set();

  const clean = data.requests.filter((r) => !r.flags.length && r.requester_id !== state.user.user_id);
  const flagged = data.requests.filter((r) => r.flags.length || r.requester_id === state.user.user_id);

  const bar = el('div', { class: 'sticky-total hidden' });
  const paintBar = () => {
    const sum = data.requests.filter((r) => picked.has(r.request_id))
      .reduce((s, r) => s + r.total_amount, 0);
    bar.classList.toggle('hidden', picked.size === 0);
    clear(bar).append(
      el('div', { class: 'spread mb' },
        el('span', { text: `เลือก ${picked.size} ใบ` }),
        el('span', { class: 'mono', text: `${baht(sum)} บาท` })),
      el('button', { class: 'btn primary block', onclick: bulkApprove }, 'อนุมัติที่เลือก'));
  };

  async function bulkApprove() {
    try {
      const out = await api.post('/api/requests/bulk-approve', { request_ids: [...picked] });
      toast(`อนุมัติแล้ว ${out.approved.length} ใบ`, 'ok');
      if (out.skipped.length)
        modal({
          title: 'บางใบยังอนุมัติไม่ได้',
          body: el('ul', {}, out.skipped.map((s) => el('li', { class: 'small' }, `${s.id}: ${s.error}`))),
          actions: [{ label: 'ปิด', kind: 'primary' }],
        });
      reload();
    } catch (err) { toast(err.message, 'error'); }
  }

  function row(r, selectable) {
    const box = el('div', { class: 'item', onclick: () => navigate(`requests/${r.request_id}`) });
    const check = selectable
      ? el('input', {
        type: 'checkbox', class: 'pick',
        onclick: (e) => {
          e.stopPropagation();
          if (e.target.checked) picked.add(r.request_id); else picked.delete(r.request_id);
          paintBar();
        },
      })
      : null;
    box.append(
      el('div', { class: 'line1' },
        check,
        el('span', { class: 'id', text: r.request_id }),
        el('span', { class: 'amt mono', text: baht(r.total_amount) })),
      el('div', { class: 'line2 truncate' },
        `${r.requester_name} · ${r.building_name} · ${r.vendor_name || '—'} · ${thaiDate(r.request_date)}`),
      r.requester_id === state.user.user_id
        ? el('div', { class: 'flag' }, el('b', { text: 'W7 ' }), 'ใบของผู้อนุมัติเอง — จะถูกนับแยกในรายงาน')
        : null,
      ...flagList(r.flags));
    if (!selectable)
      box.append(el('div', { class: 'row mt', onclick: (e) => e.stopPropagation() },
        el('button', {
          class: 'btn primary sm grow',
          onclick: async () => {
            const ok = await confirmDialog('อนุมัติใบนี้?',
              'ระบบจะบันทึกว่าคุณเปิดดูและรับทราบธงเตือนแล้ว');
            if (!ok) return;
            try {
              await api.post(`/api/requests/${r.request_id}/approve`, { acknowledge_flags: true });
              toast('อนุมัติแล้ว', 'ok');
              reload();
            } catch (err) { toast(err.message, 'error'); }
          },
        }, 'อนุมัติ'),
        el('button', {
          class: 'btn danger sm grow',
          onclick: async () => {
            const reason = await confirmDialog('ไม่อนุมัติ?', 'ต้องระบุเหตุผล', { needReason: true, danger: true });
            if (!reason) return;
            try {
              await api.post(`/api/requests/${r.request_id}/reject`, { reason });
              toast('บันทึกแล้ว', 'ok');
              reload();
            } catch (err) { toast(err.message, 'error'); }
          },
        }, 'ไม่อนุมัติ')));
    return box;
  }

  root.append(
    el('div', { class: 'card tight spread' },
      el('div', {}, el('div', { class: 'muted tiny', text: 'รออนุมัติ' }),
        el('div', { style: 'font-weight:700', text: `${data.total_count} ใบ` })),
      el('div', { class: 'right' }, el('div', { class: 'muted tiny', text: 'รวมเป็นเงิน' }),
        el('div', { class: 'mono', style: 'font-weight:700', text: `${baht(data.total_amount)} บาท` }))));

  if (!data.requests.length) {
    root.append(el('div', { class: 'empty', text: 'ไม่มีใบรออนุมัติ' }));
    return root;
  }

  if (clean.length) {
    root.append(
      el('h2', { class: 'mt', text: `ไม่มีธงเตือน — เลือกหลายใบพร้อมกันได้ (${clean.length})` }),
      el('div', { class: 'list' }, clean.map((r) => row(r, true))));
  }
  if (flagged.length) {
    root.append(
      el('h2', { class: 'mt', text: `ติดธงเตือน — ต้องกดทีละใบ (${flagged.length})` }),
      el('div', { class: 'list' }, flagged.map((r) => row(r, false))));
  }
  root.append(bar);
  return root;
}
