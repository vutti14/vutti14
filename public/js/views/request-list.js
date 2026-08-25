/** รายการใบเบิก + ตัวกรอง — และเป็นทางเข้าหน้ารายละเอียด */
import { api, qs } from '../api.js';
import { el, clear, select, baht, thaiDate, statusPill } from '../ui.js';
import { state, navigate } from '../app.js';
import { renderDetail } from './request-detail.js';

const QUICK = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'ร่าง', label: 'ร่าง' },
  { key: 'รออนุมัติ', label: 'รออนุมัติ' },
  { key: 'อนุมัติแล้ว', label: 'รอจ่าย' },
  { key: 'จ่ายแล้ว', label: 'จ่ายแล้ว' },
  { key: 'ปิดรายการ', label: 'ปิดรายการ' },
];

export async function render({ params }) {
  if (params?.[0]) return renderDetail(params[0]);

  const filters = {
    status: '', project_id: '', building_id: '', vendor_id: '', requester_id: '',
    value_source: '', q: '', from: '', to: '', page: 1, per_page: 50,
  };

  const root = el('div');
  const listBox = el('div', { class: 'list' });
  const summary = el('div', { class: 'spread mb small muted' });
  const quickBar = el('div', { class: 'filters' });

  function paintQuick() {
    clear(quickBar);
    for (const q of QUICK)
      quickBar.append(el('button', {
        class: filters.status === q.key ? 'on' : '',
        onclick: () => { filters.status = q.key; filters.page = 1; paintQuick(); load(); },
      }, q.label));
  }

  const search = el('input', { type: 'search', placeholder: 'ค้นหาเลขที่ใบ / ผู้ขาย / อาคาร' });
  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filters.q = search.value.trim(); filters.page = 1; load(); }, 300);
  });

  const projectSel = select(state.projects.map((p) => ({ value: p.project_id, label: p.project_name })),
    { placeholder: 'ทุกโครงการ', onchange: (e) => { filters.project_id = e.target.value; filters.page = 1; load(); } });

  const sourceSel = select([
    { value: 'ข้อเท็จจริง', label: 'เฉพาะข้อมูลใหม่ในระบบ' },
    { value: 'นำเข้าย้อนหลัง', label: 'เฉพาะข้อมูลนำเข้าย้อนหลัง' },
  ], { placeholder: 'ทุกที่มาของค่า', onchange: (e) => { filters.value_source = e.target.value; filters.page = 1; load(); } });

  const requesterSel = select(state.users.map((u) => ({ value: u.user_id, label: u.display_name })),
    { placeholder: 'ทุกผู้เบิก', onchange: (e) => { filters.requester_id = e.target.value; filters.page = 1; load(); } });

  const moreBtn = el('button', { class: 'btn block mt', onclick: () => { filters.page += 1; load(true); } }, 'โหลดเพิ่ม');

  async function load(append = false) {
    if (!append) clear(listBox).append(el('div', { class: 'loading', text: 'กำลังโหลด…' }));
    try {
      const data = await api.get('/api/requests' + qs(filters));
      if (!append) clear(listBox);
      summary.replaceChildren(
        el('span', { text: `${data.total_count.toLocaleString('th-TH')} ใบ` }),
        el('span', { class: 'mono', text: `${baht(data.total_amount)} บาท` }));
      if (!data.requests.length && !append) {
        listBox.append(el('div', { class: 'empty', text: 'ไม่พบใบเบิกตามเงื่อนไขนี้' }));
      }
      for (const r of data.requests) listBox.append(requestItem(r));
      moreBtn.classList.toggle('hidden', data.requests.length < filters.per_page);
    } catch (err) {
      clear(listBox).append(el('div', { class: 'banner error', text: err.message }));
    }
  }

  root.append(
    el('div', { class: 'card-head' }, el('h1', { text: 'ใบเบิก' })),
    quickBar,
    el('div', { class: 'card tight' },
      search,
      el('div', { class: 'row wrap mt' },
        el('div', { class: 'grow' }, projectSel),
        el('div', { class: 'grow' }, sourceSel),
        el('div', { class: 'grow' }, requesterSel))),
    summary, listBox, moreBtn);

  paintQuick();
  await load();
  return root;
}

function requestItem(r) {
  const imported = r.value_source === 'นำเข้าย้อนหลัง';
  return el('div', {
    class: `item ${imported ? 'imported' : ''}`,
    onclick: () => navigate(`requests/${r.request_id}`),
  },
    el('div', { class: 'line1' },
      el('span', { class: 'id', text: r.request_id }),
      r.flags?.length ? el('span', { title: r.flags.map((f) => f.label).join(' · '), text: '⚠️' }) : null,
      statusPill(r.status),
      el('span', { class: 'amt mono', text: baht(r.total_amount) })),
    el('div', { class: 'line2 truncate' },
      `${thaiDate(r.request_date)} · ${r.requester_name} · ${r.building_name} · ${r.vendor_name || r.note || '—'}`),
    r.confidence && ['C', 'D'].includes(r.confidence)
      ? el('div', { class: `line2 conf-${r.confidence}`, text: 'ข้อมูลนำเข้า ระดับความเชื่อถือ ' + r.confidence })
      : null);
}
