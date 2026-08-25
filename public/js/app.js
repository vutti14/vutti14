import { api, ApiError } from './api.js';
import { el, clear, toast, modal, field, card } from './ui.js';

/** สถานะรวมของแอป — โหลดครั้งเดียวตอนเข้าระบบ แล้วแชร์ให้ทุกหน้าจอ */
export const state = {
  user: null, caps: {}, settings: {},
  projects: [], other_projects: [], pending_access: [],
  buildings: [], designs: [],
  costCodes: [], costCodesAll: [], costTypes: [], vendors: [], items: [], users: [],
};

export const byId = (list, key, id) => list.find((x) => x[key] === id);
export const projectName = (id) => byId(state.projects, 'project_id', id)?.project_name || id;
export const buildingName = (id) => byId(state.buildings, 'building_id', id)?.building_name || id;
export const vendorName = (id) => byId(state.vendors, 'vendor_id', id)?.vendor_name || '—';
export const buildingsOf = (projectId) => state.buildings.filter((b) => b.project_id === projectId);

export async function refreshBootstrap() {
  const data = await api.get('/api/bootstrap');
  state.user = data.user;
  state.caps = data.caps;
  state.settings = data.settings;
  state.projects = data.projects;
  state.other_projects = data.other_projects || [];
  state.pending_access = data.pending_access || [];
  state.buildings = data.buildings;
  state.designs = data.designs;
  state.costCodes = data.cost_codes;
  state.costCodesAll = data.cost_codes_all;
  state.costTypes = data.cost_types;
  state.vendors = data.vendors;
  state.items = data.items;
  state.users = data.users;
}

// ---------------------------------------------------------------- เส้นทางหน้าจอ
const ROUTES = [
  { path: 'my', icon: '📌', label: 'งานของฉัน', load: () => import('./views/my-work.js'), cap: (c) => c.create_request },
  { path: 'new', icon: '➕', label: 'เบิกเงิน', load: () => import('./views/request-form.js'), cap: (c) => c.create_request },
  { path: 'approve', icon: '✅', label: 'อนุมัติ', load: () => import('./views/approve.js'), cap: (c) => c.approve },
  { path: 'pay', icon: '💸', label: 'จ่ายเงิน', load: () => import('./views/pay.js'), cap: (c) => c.pay },
  { path: 'docs', icon: '📄', label: 'เอกสาร', load: () => import('./views/documents.js'), cap: (c) => c.documents },
  { path: 'requests', icon: '📋', label: 'ใบเบิก', load: () => import('./views/request-list.js'), cap: () => true },
  { path: 'dashboard', icon: '📊', label: 'ภาพรวม', load: () => import('./views/dashboard.js'), cap: () => true },
  { path: 'vendors', icon: '🏪', label: 'ผู้ขาย', load: () => import('./views/vendors.js'), cap: () => true },
  { path: 'finance', icon: '🏦', label: 'การเงิน', load: () => import('./views/finance.js'), cap: (c) => c.funding || c.petty_cash || c.reversal },
  { path: 'admin', icon: '⚙️', label: 'ตั้งค่า', load: () => import('./views/admin.js'), cap: (c) => c.admin },
];

/** หน้าแรกต่างกันตามบทบาท: PM เปิดมาที่งานของตัวเอง · ผู้บริหารเปิดมาที่ภาพรวม */
const homeRoute = () =>
  visibleRoutes().find((r) => r.path === (state.caps.create_request && !state.caps.approve ? 'my' : 'dashboard'))
  || visibleRoutes()[0];

export const navigate = (hash) => { window.location.hash = hash.startsWith('#') ? hash : '#/' + hash; };

function visibleRoutes() {
  return ROUTES.filter((r) => r.cap(state.caps));
}

function shell() {
  const app = clear(document.getElementById('app'));
  const topbar = el('div', { class: 'topbar' },
    el('h1', { text: 'RABBiZ Build' }),
    el('span', { class: 'who', text: `${state.user.display_name} · ${state.user.role}` }),
    el('button', { onclick: logout }, 'ออก'));

  const nav = el('nav', { class: 'navbar' }, visibleRoutes().map((r) =>
    el('a', { href: `#/${r.path}`, dataset: { path: r.path } },
      el('span', { class: 'ico', text: r.icon }),
      el('span', { text: r.label }))));

  const main = el('main', { id: 'view' });
  app.append(topbar, nav, main);
  return main;
}

async function render() {
  // ตัด query string ออกก่อนหาเส้นทาง — บางหน้าใช้ #/my?history=1 เก็บสถานะตัวกรอง
  const raw = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0];
  const [path, ...rest] = raw.split('/');
  const route = ROUTES.find((r) => r.path === path) || homeRoute();

  if (!route.cap(state.caps)) {
    const fallback = homeRoute();
    if (fallback && fallback.path !== path) return navigate(fallback.path);
  }

  const main = document.getElementById('view') || shell();
  clear(main).append(el('div', { class: 'loading', text: 'กำลังโหลด…' }));
  for (const a of document.querySelectorAll('.navbar a'))
    a.classList.toggle('active', a.dataset.path === route.path);

  try {
    const mod = await route.load();
    const node = await mod.render({ params: rest, state });
    clear(main).append(node);
    main.scrollIntoView({ block: 'start' });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return start();
    clear(main).append(el('div', { class: 'banner error', text: err.message }));
    console.error(err);
  }
}

export function reload() { render(); }

// ---------------------------------------------------------------- เข้าสู่ระบบ
function loginScreen(message) {
  const app = clear(document.getElementById('app'));
  const username = el('input', { type: 'email', autocomplete: 'username', placeholder: 'อีเมล' });
  const password = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'รหัสผ่าน' });
  const totp = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'รหัส 6 หลักจากแอป Authenticator' });
  const totpField = field('รหัส 2FA', totp);
  totpField.classList.add('hidden');
  const note = el('div', { class: 'banner', text: message || 'เข้าครั้งแรก: รหัสผ่านคือเบอร์โทรของคุณ ระบบจะให้ตั้งรหัสใหม่ทันที' });
  const submit = el('button', { class: 'btn primary block', type: 'submit' }, 'เข้าสู่ระบบ');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const out = await api.post('/api/auth/login', {
          username: username.value.trim(),
          password: password.value,
          totp: totp.value.trim() || undefined,
        });
        if (out.must_change_password) await changePasswordFlow(password.value);
        await refreshBootstrap();
        if (out.must_setup_2fa) await setup2faFlow();
        shell();
        render();
      } catch (err) {
        if (err.payload?.code === 'TOTP_REQUIRED') {
          totpField.classList.remove('hidden');
          totp.focus();
        }
        note.className = 'banner error';
        note.textContent = err.message;
      } finally {
        submit.disabled = false;
      }
    },
  },
    field('อีเมล', username),
    field('รหัสผ่าน', password),
    totpField,
    submit);

  app.append(el('main', { style: 'max-width:420px;margin:8vh auto;padding:0 1rem' },
    el('div', { class: 'eyebrow center', text: 'RABBiZ Build · ฝั่งรายจ่าย' }),
    el('h1', { class: 'center', text: 'ระบบเบิกจ่ายงานก่อสร้าง' }),
    card(note, form)));
  username.focus();
}

function changePasswordFlow(currentPassword) {
  return new Promise((resolve) => {
    const pw1 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'รหัสผ่านใหม่ อย่างน้อย 8 ตัว' });
    const pw2 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'พิมพ์ซ้ำอีกครั้ง' });
    modal({
      title: 'ตั้งรหัสผ่านใหม่',
      body: el('div', {},
        el('p', { class: 'small muted', text: 'ครั้งแรกต้องเปลี่ยนรหัสผ่านก่อน ห้ามใช้เบอร์โทรเป็นรหัสถาวร' }),
        field('รหัสผ่านใหม่', pw1), field('ยืนยันรหัสผ่าน', pw2)),
      actions: [{
        label: 'บันทึก', kind: 'primary',
        onClick: async () => {
          if (pw1.value !== pw2.value) { toast('รหัสผ่านสองช่องไม่ตรงกัน', 'error'); return true; }
          try {
            await api.post('/api/auth/change-password',
              { current_password: currentPassword, new_password: pw1.value });
            toast('เปลี่ยนรหัสผ่านแล้ว', 'ok');
            resolve();
          } catch (err) { toast(err.message, 'error'); return true; }
        },
      }],
    });
    pw1.focus();
  });
}

function setup2faFlow() {
  return new Promise(async (resolve) => {
    let secret;
    try { secret = await api.post('/api/auth/2fa/setup'); }
    catch { return resolve(); }
    const code = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'รหัส 6 หลัก' });
    modal({
      title: 'เปิดใช้ 2FA (บังคับสำหรับบัญชีที่ทำให้เงินออกได้)',
      body: el('div', {},
        el('p', { class: 'small muted', text: 'เพิ่มบัญชีในแอป Authenticator โดยพิมพ์รหัสลับด้านล่าง หรือเปิดลิงก์ otpauth บนมือถือเครื่องเดียวกัน' }),
        el('div', { class: 'card tight mono', style: 'word-break:break-all', text: secret.secret }),
        el('p', {}, el('a', { href: secret.uri, text: 'เปิดในแอป Authenticator' })),
        field('รหัสยืนยัน', code)),
      actions: [
        { label: 'ข้ามไปก่อน', onClick: () => resolve() },
        {
          label: 'เปิดใช้งาน', kind: 'primary',
          onClick: async () => {
            try { await api.post('/api/auth/2fa/enable', { code: code.value.trim() }); toast('เปิด 2FA แล้ว', 'ok'); resolve(); }
            catch (err) { toast(err.message, 'error'); return true; }
          },
        },
      ],
    });
  });
}

async function logout() {
  await api.post('/api/auth/logout').catch(() => {});
  window.location.hash = '';
  start();
}

async function start() {
  try {
    const me = await api.get('/api/auth/me');
    if (me.must_change_password) return loginScreen('ต้องเปลี่ยนรหัสผ่านก่อนใช้งาน — กรุณาเข้าสู่ระบบอีกครั้ง');
    await refreshBootstrap();
    shell();
    render();
  } catch {
    loginScreen();
  }
}

window.addEventListener('hashchange', render);
start();
