/** ตั้งค่าระบบ (CEO) — ผู้ใช้ · ผัง Expense Code · สวิตช์กฎเตือน · ส่งออกข้อมูล */
import { api } from '../api.js';
import { el, clear, field, select, table, toast, modal, confirmDialog, baht } from '../ui.js';
import { state, reload } from '../app.js';

const TABS = [
  { key: 'users', label: 'ผู้ใช้และสิทธิ์' },
  { key: 'codes', label: 'ผัง Expense Code' },
  { key: 'settings', label: 'สวิตช์ระบบ' },
  { key: 'line', label: 'ไลน์' },
  { key: 'reference', label: 'ข้อมูลอ้างอิง v9' },
  { key: 'access', label: 'คำขอสิทธิ์' },
  { key: 'export', label: 'ส่งออกข้อมูล' },
  { key: 'health', label: 'สถานะข้อมูล' },
];

const REFERENCE = [
  { kind: 'cost_curve', label: 'เส้นโค้งต้นทุน', note: 'ใช้ตั้งงบอาคารใหม่จากขนาดและจำนวนชั้น — ห้ามเทียบข้าม design_code' },
  { kind: 'building_aliases', label: 'ชื่อพ้องของอาคาร', note: 'ค้นที่นี่ก่อนสร้างอาคารใหม่เสมอ ไม่งั้นต้นทุนจะแตกเป็นสองก้อน' },
  { kind: 'employees', label: 'ทะเบียนพนักงาน', note: 'ใช้ตรวจว่าเงินที่จ่ายออกไปเป็นการจ่ายให้คนของเราเองหรือไม่' },
  { kind: 'rental_units', label: 'ยูนิตให้เช่า', note: 'ฝั่งรายได้ — ยังไม่เชื่อมกับฝั่งจ่ายใน V1 ตามที่ตกลง' },
  { kind: 'land_leases', label: 'สัญญาเช่าที่ดิน', note: 'ทุกสัญญาระบุรื้อถอนอาคารเมื่อสิ้นสุด มูลค่าคงเหลือเป็นศูนย์' },
  { kind: 'location_pl', label: 'ภาพรวมรายทำเล', note: 'ฝั่งรายได้ — ยังไม่เชื่อมกับฝั่งจ่ายใน V1 ตามที่ตกลง' },
];

const ROLES = ['CEO', 'COO', 'FINANCE', 'ACCOUNT', 'PM', 'SERVICE', 'VIEWER'];

export async function render() {
  const root = el('div');
  const tabBar = el('div', { class: 'filters' });
  const box = el('div');
  let active = 'users';

  function paintTabs() {
    clear(tabBar);
    for (const t of TABS)
      tabBar.append(el('button', {
        class: active === t.key ? 'on' : '',
        onclick: () => { active = t.key; paintTabs(); load(); },
      }, t.label));
  }

  async function load() {
    clear(box).append(el('div', { class: 'loading', text: 'กำลังโหลด…' }));
    const view = {
      users: usersView, codes: codesView, settings: settingsView, line: lineView,
      reference: referenceView, access: accessView, export: exportView, health: healthView,
    }[active];
    clear(box).append(await view());
  }

  root.append(el('h1', { text: 'ตั้งค่าระบบ' }), tabBar, box);
  paintTabs();
  await load();
  return root;
}

// ---------------------------------------------------------------- ผู้ใช้
async function usersView() {
  const { users } = await api.get('/api/admin/users');
  const wrap = el('div');
  wrap.append(el('button', { class: 'btn primary block mb', onclick: openCreate }, '+ เพิ่มผู้ใช้'));
  wrap.append(el('div', { class: 'list' }, users.map((u) => el('div', {
    class: 'item', onclick: () => openEdit(u),
  },
    el('div', { class: 'line1' },
      el('span', { class: 'id', text: `${u.display_name} (${u.user_id})` }),
      el('span', { class: `pill ${u.status === 'ใช้งาน' ? 'green' : 'red'}`, text: u.status }),
      el('span', { class: 'pill blue', text: u.role })),
    el('div', { class: 'line2 truncate', text: u.username }),
    el('div', { class: 'line2 tiny' },
      `${u.password_changed ? 'ตั้งรหัสผ่านเองแล้ว' : 'ยังใช้รหัสผ่านตั้งต้น'}` +
      `${u.require_2fa ? (u.totp_enabled ? ' · เปิด 2FA แล้ว' : ' · ต้องเปิด 2FA') : ''}` +
      `${u.projects ? ` · โครงการ ${u.projects}` : ''}`),
    u.note ? el('div', { class: 'flag', text: u.note }) : null))));
  return wrap;

  function openEdit(u) {
    const display = el('input', { type: 'text', value: u.display_name });
    const username = el('input', { type: 'email', value: u.username });
    const phone = el('input', { type: 'text', value: u.phone || '' });
    const role = select(ROLES.map((r) => ({ value: r, label: r })), { value: u.role });
    const status = select([{ value: 'ใช้งาน', label: 'ใช้งาน' }, { value: 'ระงับ', label: 'ระงับ' }],
      { value: u.status });
    const twofa = el('input', { type: 'checkbox' });
    twofa.checked = !!u.require_2fa;
    const current = new Set((u.projects || '').split(',').filter(Boolean));
    const projectBox = el('div', { class: 'row wrap' });
    for (const p of state.projects) {
      const cb = el('input', { type: 'checkbox', value: p.project_id });
      cb.checked = current.has(p.project_id);
      projectBox.append(el('label', { class: 'row', style: 'gap:.3rem;width:auto;min-width:auto;padding:.3rem .5rem' },
        cb, el('span', { class: 'tiny', text: p.project_id })));
    }

    modal({
      title: `${u.display_name} (${u.user_id})`,
      body: el('div', {},
        field('ชื่อเรียก', display), field('อีเมล (username)', username),
        field('เบอร์โทร', phone), field('บทบาท', role), field('สถานะ', status),
        el('label', { class: 'row mb', style: 'gap:.4rem' }, twofa, el('span', { class: 'small', text: 'บังคับใช้ 2FA' })),
        field('โครงการที่รับผิดชอบ (มีผลกับ PM และช่างซ่อมบำรุง)', projectBox)),
      actions: [
        { label: 'ปิด' },
        {
          label: 'ตั้งรหัสผ่านใหม่',
          onClick: async () => {
            if (!await confirmDialog('ตั้งรหัสผ่านใหม่?', 'รหัสจะกลับไปเป็นเบอร์โทร และผู้ใช้ต้องเปลี่ยนใหม่ทันที')) return true;
            const out = await api.post(`/api/admin/users/${u.user_id}/reset-password`);
            toast(`รหัสผ่านตั้งต้นใหม่: ${out.initial_password}`, 'ok');
            return true;
          },
        },
        {
          label: 'บันทึก', kind: 'primary',
          onClick: async () => {
            try {
              await api.patch(`/api/admin/users/${u.user_id}`, {
                display_name: display.value.trim(), username: username.value.trim().toLowerCase(),
                phone: phone.value.trim(), role: role.value, status: status.value,
                require_2fa: twofa.checked ? 1 : 0,
                projects: [...projectBox.querySelectorAll('input:checked')].map((x) => x.value),
              });
              toast('บันทึกแล้ว', 'ok');
              reload();
            } catch (err) { toast(err.message, 'error'); return true; }
          },
        },
      ],
    });
  }

  function openCreate() {
    const id = el('input', { type: 'text', placeholder: 'รหัสสั้น เช่น P' });
    const display = el('input', { type: 'text' });
    const username = el('input', { type: 'email' });
    const phone = el('input', { type: 'text' });
    const role = select(ROLES.map((r) => ({ value: r, label: r })), { value: 'PM' });
    modal({
      title: 'เพิ่มผู้ใช้',
      body: el('div', {},
        field('รหัสผู้ใช้', id, 'ตัวอักษรใหญ่หรือตัวเลข ไม่เกิน 4 ตัว'),
        field('ชื่อเรียก', display), field('อีเมล', username),
        field('เบอร์โทร', phone, 'ใช้เป็นรหัสผ่านครั้งแรก ระบบบังคับให้เปลี่ยนทันที'),
        field('บทบาท', role)),
      actions: [
        { label: 'ยกเลิก' },
        {
          label: 'สร้าง', kind: 'primary',
          onClick: async () => {
            try {
              const out = await api.post('/api/admin/users', {
                user_id: id.value.trim(), display_name: display.value.trim(),
                username: username.value.trim(), phone: phone.value.trim(), role: role.value,
              });
              toast(`สร้างแล้ว · รหัสผ่านตั้งต้น ${out.initial_password}`, 'ok');
              reload();
            } catch (err) { toast(err.message, 'error'); return true; }
          },
        },
      ],
    });
  }
}

// ---------------------------------------------------------------- Expense Code
async function codesView() {
  const wrap = el('div');
  const counts = state.costCodesAll.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});
  wrap.append(el('div', { class: 'banner' },
    `ใช้ต่อ ${counts['ใช้ต่อ'] || 0} · เลิกใช้ ${counts['เลิกใช้'] || 0} · ยุบรวม ${counts['ยุบรวม'] || 0} — ` +
    'รหัสที่เลิกใช้/ยุบรวมจะไม่ปรากฏใน dropdown แต่ยังอ่านข้อมูลเก่าได้'));
  wrap.append(el('div', { class: 'card' }, table([
    { label: 'รหัส', key: 'cost_code' },
    { label: 'ชื่อ', key: 'cost_name' },
    { label: 'กลุ่มงาน', key: 'work_group' },
    {
      label: 'สถานะ', render: (c) => el('span', {
        class: `pill ${c.status === 'ใช้ต่อ' ? 'green' : c.status === 'ยุบรวม' ? 'amber' : 'red'}`, text: c.status,
      }),
    },
    { label: 'ยุบเข้ารหัส', key: 'merge_into' },
    { label: 'ประเภทตั้งต้น', key: 'default_cost_type' },
    {
      label: '', render: (c) => el('button', { class: 'btn sm', onclick: () => openEdit(c) }, 'แก้ไข'),
    },
  ], state.costCodesAll)));
  return wrap;

  function openEdit(c) {
    const name = el('input', { type: 'text', value: c.cost_name });
    const group = el('input', { type: 'text', value: c.work_group || '' });
    const status = select([
      { value: 'ใช้ต่อ', label: 'ใช้ต่อ' },
      { value: 'เลิกใช้', label: 'เลิกใช้' },
      { value: 'ยุบรวม', label: 'ยุบรวม' },
    ], { value: c.status });
    const merge = select(state.costCodesAll.map((x) => ({ value: x.cost_code, label: x.cost_code })),
      { value: c.merge_into || '', placeholder: 'ไม่ยุบรวม' });
    const reason = el('input', { type: 'text', placeholder: 'เหตุผล (บันทึกลงประวัติ)' });
    modal({
      title: `${c.cost_code} · ${c.cost_name}`,
      body: el('div', {}, field('ชื่อหมวดงาน', name), field('กลุ่มงานตาม BOQ', group),
        field('สถานะ', status), field('ยุบเข้ารหัส', merge), field('เหตุผล', reason)),
      actions: [
        { label: 'ยกเลิก' },
        {
          label: 'บันทึก', kind: 'primary',
          onClick: async () => {
            try {
              await api.patch(`/api/admin/cost-codes/${c.cost_code}`, {
                cost_name: name.value.trim(), work_group: group.value.trim(),
                status: status.value, merge_into: merge.value || '', reason: reason.value.trim(),
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

// ---------------------------------------------------------------- สวิตช์ระบบ
async function settingsView() {
  const { settings } = await api.get('/api/admin/settings');
  const w2 = el('input', { type: 'checkbox' });
  w2.checked = settings.flag_W2_enabled === '1';
  const cutover = el('input', { type: 'date', value: settings.cutover_date || '' });
  const company = el('input', { type: 'text', value: settings.company_name || '' });

  return el('div', { class: 'card' },
    el('label', { class: 'row mb', style: 'gap:.5rem' }, w2,
      el('span', { class: 'small', text: 'เปิดกฎเตือน W2 — ราคาสูงกว่าราคาอ้างอิงเกิน 10%' })),
    el('p', { class: 'tiny muted', text: 'เปิดเมื่อจับคู่วัสดุกับรายการมาตรฐานเสร็จแล้ว (สเปก §12) ไม่งั้นจะเตือนผิดเพราะยังไม่มีราคาอ้างอิงให้เทียบ' }),
    field('วันตัดข้อมูลเข้าผังใหม่', cutover, 'ใช้คำนวณตัวชี้วัด % ใบเบิกที่ผ่านระบบ'),
    field('ชื่อบริษัท', company),
    el('button', {
      class: 'btn primary block mt',
      onclick: async () => {
        try {
          await api.put('/api/admin/settings', {
            flag_W2_enabled: w2.checked, cutover_date: cutover.value, company_name: company.value.trim(),
          });
          toast('บันทึกแล้ว', 'ok');
          reload();
        } catch (err) { toast(err.message, 'error'); }
      },
    }, 'บันทึก'));
}

// ---------------------------------------------------------------- ไลน์ (สเปก §8 S2)
const OUTBOX_PILL = {
  'ส่งแล้ว': 'green',
  'รอส่ง': 'amber',
  'ส่งไม่สำเร็จ': 'red',
  'ยังไม่ได้ตั้งค่า': 'amber',
};

async function lineView() {
  const d = await api.get('/api/admin/line');
  const wrap = el('div');

  wrap.append(el('div', { class: `banner ${d.configured ? '' : 'warn'}` },
    el('b', { text: d.configured ? 'ผูก LINE channel แล้ว' : 'ยังไม่ได้ผูก LINE channel' }),
    d.configured
      ? 'การ์ดขออนุมัติถูกส่งเข้าไลน์ของผู้อนุมัติที่ผูกบัญชีไว้แล้ว'
      : 'ตั้ง LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET และ APP_BASE_URL แล้วรีสตาร์ตเซิร์ฟเวอร์ — '
        + 'ข้อความที่ควรส่งระหว่างนี้ถูกเก็บไว้ในคิวด้านล่างและกดส่งย้อนหลังได้'));

  wrap.append(el('div', { class: 'card' },
    el('div', { class: 'rule-head', text: 'ตั้งค่าที่ฝั่ง LINE Developers' }),
    el('p', { class: 'small', text: 'Webhook URL ที่ต้องกรอกในคอนโซล:' }),
    el('div', { class: 'card tight mono', style: 'word-break:break-all', text: d.webhook_url }),
    el('p', { class: 'tiny muted', text: 'เปิด "Use webhook" และปิด "Auto-reply messages" ไม่งั้นข้อความตอบกลับจะซ้อนกัน' })));

  wrap.append(el('div', { class: 'card' },
    el('div', { class: 'rule-head', text: `ผูกบัญชีไลน์แล้ว ${d.linked_users.length} คน` }),
    table([
      { label: 'รหัส', key: 'user_id' },
      { label: 'ชื่อ', key: 'display_name' },
      { label: 'บทบาท', key: 'role' },
    ], d.linked_users, { empty: 'ยังไม่มีใครผูกบัญชีไลน์ — กดปุ่ม “ไลน์” บนแถบบนเพื่อผูกของตัวเอง' })));

  const flushBtn = el('button', {
    class: 'btn primary',
    disabled: !d.configured,
    onclick: async () => {
      flushBtn.disabled = true;
      try {
        const out = await api.post('/api/admin/line/flush');
        toast(`ส่งสำเร็จ ${out.sent} · ไม่สำเร็จ ${out.failed}`, out.failed ? 'error' : 'ok');
        reload();
      } catch (err) { toast(err.message, 'error'); flushBtn.disabled = false; }
    },
  }, 'ส่งข้อความที่ค้างอีกครั้ง');

  wrap.append(el('div', { class: 'card' },
    el('div', { class: 'rule-head', text: 'คิวข้อความ' }),
    el('div', { class: 'row wrap' }, d.counts.map((c) =>
      el('span', { class: `pill ${OUTBOX_PILL[c.status] || ''}`, text: `${c.status} ${c.n}` }))),
    el('div', { class: 'mt' }, flushBtn),
    el('div', { class: 'mt' }, table([
      { label: 'เรื่อง', key: 'kind' },
      { label: 'ถึง', render: (x) => x.display_name || x.line_user_id || '—' },
      { label: 'ใบเบิก', key: 'request_id' },
      { label: 'สถานะ', render: (x) => el('span', { class: `pill ${OUTBOX_PILL[x.status] || ''}`, text: x.status }) },
      { label: 'เมื่อ', key: 'created_at' },
      { label: 'ข้อผิดพลาด', key: 'error' },
    ], d.outbox, { empty: 'ยังไม่มีข้อความที่ต้องส่ง' }))));

  return wrap;
}

// ---------------------------------------------------------------- ข้อมูลอ้างอิง v9
async function referenceView() {
  const wrap = el('div');
  wrap.append(el('div', { class: 'banner' },
    el('b', { text: 'ตารางที่ v9 เพิ่มเข้ามา' }),
    'ตารางฝั่งรายได้ถูกนำเข้าไว้ครบแต่ตั้งใจยังไม่เชื่อมกับหน้าจอฝั่งจ่ายใน V1 — ' +
    'ช่อง buildings.rental_unit_id เตรียมไว้แล้วสำหรับวันที่พร้อมเชื่อม'));
  for (const ref of REFERENCE) {
    const box = el('div', { class: 'card' },
      el('div', { class: 'rule-head', text: ref.label }),
      el('p', { class: 'tiny muted', text: ref.note }),
      el('div', { class: 'loading', text: 'กำลังโหลด…' }));
    wrap.append(box);
    api.get(`/api/reference/${ref.kind}`).then(({ rows }) => {
      box.lastChild.remove();
      if (!rows.length) return box.append(el('div', { class: 'empty', text: 'ไม่มีข้อมูล' }));
      const cols = Object.keys(rows[0]).map((k) => ({
        label: k, key: k,
        num: typeof rows[0][k] === 'number',
      }));
      box.append(table(cols, rows.slice(0, 100)));
      if (rows.length > 100)
        box.append(el('div', { class: 'tiny muted mt', text: `แสดง 100 จาก ${rows.length} แถว — ส่งออก CSV เพื่อดูทั้งหมด` }));
    }).catch((err) => { box.lastChild.remove(); box.append(el('div', { class: 'banner error', text: err.message })); });
  }
  return wrap;
}

// ---------------------------------------------------------------- คำขอสิทธิ์ชั่วคราว
async function accessView() {
  const { requests } = await api.get('/api/project-access');
  return el('div', {},
    el('div', { class: 'banner' },
      el('b', { text: 'กฎ 3%' }),
      'สิทธิ์ถาวรมาจากประวัติการเบิกจริง — เบิกโครงการไหนเกิน 3% ของยอดตัวเอง = งานประจำ ได้สิทธิ์ถาวร ' +
      'ต่ำกว่านั้นใช้คำขอสิทธิ์ชั่วคราว'),
    el('div', { class: 'card' }, table([
      { label: 'ผู้ขอ', render: (x) => `${x.display_name} (${x.user_id})` },
      { label: 'โครงการ', key: 'project_name' },
      { label: 'เหตุผล', key: 'reason' },
      { label: 'หมดอายุ', key: 'expires_at' },
      {
        label: 'สถานะ', render: (x) => el('span', {
          class: `pill ${x.status === 'อนุมัติแล้ว' ? 'green' : x.status === 'รออนุมัติ' ? 'amber' : 'red'}`,
          text: x.status,
        }),
      },
      { label: 'ตัดสินโดย', key: 'decided_by_name' },
    ], requests, { empty: 'ยังไม่มีคำขอสิทธิ์ชั่วคราว' })));
}

// ---------------------------------------------------------------- ส่งออก
async function exportView() {
  const { tables } = await api.get('/api/reports/export');
  return el('div', { class: 'card' },
    el('p', { class: 'small muted', text: 'ไฟล์ CSV เข้ารหัส UTF-8 พร้อม BOM เปิดใน Excel ได้ทันทีโดยภาษาไทยไม่เพี้ยน — ใช้เป็นทางหนีทีไล่ตามแผนขึ้นระบบ 3 เดือนแรก' }),
    el('div', { class: 'row wrap mt' }, tables.map((t) =>
      el('a', { class: 'btn sm', href: `/api/reports/export/${t}.csv` }, t))));
}

// ---------------------------------------------------------------- สถานะข้อมูล
async function healthView() {
  const d = await api.get('/api/admin/health');
  return el('div', {},
    el('div', { class: 'card' },
      el('div', { class: 'rule-head', text: 'จำนวนแถวในแต่ละตาราง' }),
      table([{ label: 'ตาราง', key: 'name' }, { label: 'จำนวนแถว', num: true, key: 'n' }],
        Object.entries(d.counts).map(([name, n]) => ({ name, n: n.toLocaleString('th-TH') })))),
    el('div', { class: 'card' },
      el('div', { class: 'rule-head', text: 'แยกตามที่มาของค่า' }),
      table([
        { label: 'ที่มาของค่า', key: 'value_source' },
        { label: 'จำนวนใบ', num: true, key: 'n' },
        { label: 'จำนวนเงิน', num: true, render: (x) => baht(x.amount) },
      ], d.totals)));
}
