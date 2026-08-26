/**
 * S1 — งานของฉัน
 * หน้าแรกของ PM ตอบคำถามเดียว: "ใบที่ผมส่งไป ตอนนี้อยู่ตรงไหน"
 * ไม่มีกราฟ ไม่มียอดรวมโครงการ มีแค่ (ก) ส่งใบใหม่ (ข) ใบเก่าไปถึงไหนแล้ว
 */
import { api, qs } from '../api.js';
import { el, baht, thaiDate, statusPill, itemTone, field, select, toast, modal } from '../ui.js';
import { state, navigate, reload } from '../app.js';

const NEEDS_ME = {
  'ร่าง': 'ร่างที่ยังไม่ได้ส่ง',
  'ไม่อนุมัติ': 'ถูกตีกลับ — ต้องแก้แล้วส่งใหม่',
};

export async function render() {
  // หน้านี้คืองานที่กำลังเดินอยู่ ไม่ใช่ประวัติ — ข้อมูลนำเข้าย้อนหลังซ่อนไว้จนกว่าจะกดดู
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const includeHistory = params.get('history') === '1';

  const [mine, access] = await Promise.all([
    api.get('/api/requests' + qs({
      requester_id: state.user.user_id, per_page: 60,
      value_source: includeHistory ? '' : 'ข้อเท็จจริง',
    })),
    api.get('/api/project-access').catch(() => ({ requests: [] })),
  ]);

  const root = el('div');
  // PM เห็นชื่อไซต์ของตัวเอง · คนที่เห็นทุกโครงการไม่ต้องอ่านรายชื่อ 17 บรรทัด
  const scope = state.user.sees_all_projects
    ? 'ทุกโครงการ'
    : (state.projects.map((p) => p.project_name).join(' · ') || 'ยังไม่ได้รับสิทธิ์โครงการใด');

  root.append(
    el('div', { class: 'eyebrow truncate', title: scope, text: scope }),
    el('h1', { text: 'งานของฉัน' }));

  // ใบที่ต้องการอะไรบางอย่างจากเจ้าตัว มาก่อนเสมอ
  // ข้อมูลนำเข้าย้อนหลังไม่มีการติดตามเอกสาร จึงไม่นับว่า "ของยังไม่มา" (สเปก §9)
  const tracked = (r) => r.value_source !== 'นำเข้าย้อนหลัง';
  const needsMe = mine.requests.filter((r) =>
    NEEDS_ME[r.status] || (tracked(r) && r.status === 'จ่ายแล้ว' && !r.goods_received));
  const rest = mine.requests.filter((r) => !needsMe.includes(r));

  if (state.caps.create_request)
    root.append(el('button', {
      class: 'btn primary block mb', onclick: () => navigate('new'),
    }, '+ สร้างใบเบิกใหม่'));

  if (!mine.requests.length)
    root.append(el('div', { class: 'empty', text: includeHistory
      ? 'ยังไม่มีใบเบิกของคุณในระบบ' : 'ยังไม่มีใบเบิกใหม่ของคุณ — กดดูประวัติด้านล่างเพื่อเห็นรายการที่นำเข้าย้อนหลัง' }));

  if (needsMe.length) {
    root.append(el('div', { class: 'rule-head', text: `ต้องการคุณ · ${needsMe.length} ใบ` }));
    root.append(el('div', { class: 'list mb' }, needsMe.map((r) => card(r, true))));
  }
  if (rest.length) {
    root.append(el('div', { class: 'rule-head', text: `กำลังเดินอยู่ · ${rest.length} ใบ` }));
    root.append(el('div', { class: 'list' }, rest.map((r) => card(r, false))));
  }

  root.append(el('button', {
    class: 'btn ghost block mt',
    onclick: () => { window.location.hash = includeHistory ? '#/my' : '#/my?history=1'; },
  }, includeHistory ? 'ซ่อนประวัติที่นำเข้าย้อนหลัง' : 'ดูประวัติที่นำเข้าย้อนหลังด้วย'));

  // ปุ่มขอสิทธิ์ชั่วคราว (v9 §21) — วันที่ต้องไปช่วยไซต์อื่น
  if (!state.user.sees_all_projects) {
    const pending = (access.requests || []).filter((a) => a.status === 'รออนุมัติ');
    root.append(el('div', { class: 'card mt' },
      el('div', { class: 'rule-head', text: 'ต้องไปช่วยไซต์อื่น' }),
      el('p', { class: 'small muted', text: 'คุณเบิกได้เฉพาะโครงการที่รับผิดชอบ ถ้าวันนี้ต้องไปช่วยไซต์อื่น ขอสิทธิ์ชั่วคราวได้ที่นี่ COO กดอนุมัติในคลิกเดียว' }),
      ...pending.map((a) => el('div', { class: 'flag' },
        el('b', { text: 'รออนุมัติ ' }), `${a.project_name} — ${a.reason}`)),
      state.other_projects?.length
        ? el('button', { class: 'btn block mt', onclick: openAccessForm }, 'ขอสิทธิ์เข้าโครงการอื่น')
        : el('div', { class: 'tiny muted', text: 'คุณมีสิทธิ์ครบทุกโครงการแล้ว' })));
  }

  return root;

  function card(r, urgent) {
    const tone = itemTone(r, { forUser: state.user.user_id });
    return el('div', {
      class: `item ${urgent ? 'alert' : tone}`,
      onclick: () => navigate(`requests/${r.request_id}`),
    },
      el('div', { class: 'line1' },
        el('span', { class: 'id', text: r.request_id }),
        r.flags?.length ? el('span', { text: '⚑' }) : null,
        el('span', { class: 'amt', text: baht(r.total_amount, 0) })),
      el('div', { class: 'line2 truncate', text: `${r.vendor_name || r.payee_name_raw || '—'} · ${r.note || ''}` }),
      el('div', { class: 'line3 truncate', text: `${r.building_name} · ${r.project_name} · ${thaiDate(r.request_date)}` }),
      el('div', { class: 'mt' }, statusPill(r.status),
        NEEDS_ME[r.status]
          ? el('span', { class: 'pill red', text: NEEDS_ME[r.status] })
          : tracked(r) && r.status === 'จ่ายแล้ว' && !r.goods_received
            ? el('span', { class: 'pill red', text: 'จ่ายแล้ว · ยังไม่ยืนยันว่าของมา' })
            : null));
  }

  function openAccessForm() {
    const project = select(
      (state.other_projects || []).map((p) => ({ value: p.project_id, label: `${p.project_name} (${p.project_id})` })),
      { placeholder: 'เลือกโครงการ' });
    const reason = el('input', { type: 'text', placeholder: 'เช่น ไปช่วยงานเทพื้นที่ V5 สัปดาห์นี้' });
    const days = select([7, 14, 30].map((d) => ({ value: d, label: `${d} วัน` })), { value: 7 });
    modal({
      title: 'ขอสิทธิ์เข้าโครงการชั่วคราว',
      body: el('div', {}, field('โครงการ', project), field('เหตุผล', reason),
        field('ขอสิทธิ์กี่วัน', days)),
      actions: [
        { label: 'ยกเลิก' },
        {
          label: 'ส่งคำขอ', kind: 'primary',
          onClick: async () => {
            try {
              await api.post('/api/project-access', {
                project_id: project.value, reason: reason.value.trim(), days: Number(days.value),
              });
              toast('ส่งคำขอแล้ว รอ COO อนุมัติ', 'ok');
              reload();
            } catch (err) { toast(err.message, 'error'); return true; }
          },
        },
      ],
    });
  }
}
