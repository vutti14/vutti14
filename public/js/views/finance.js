/** เงินทุนเข้า · เครดิตค้างกับผู้ขาย · ใบกลับรายการ · เงินสดย่อย */
import { api } from '../api.js';
import { el, clear, field, select, baht, thaiDate, table, toast, modal, today } from '../ui.js';
import { state, navigate, reload } from '../app.js';

const TABS = [
  { key: 'funding', label: 'เงินทุนเข้า' },
  { key: 'credits', label: 'เครดิตค้าง' },
  { key: 'reversals', label: 'ใบกลับรายการ' },
  { key: 'petty', label: 'เงินสดย่อย' },
];

export async function render() {
  const root = el('div');
  const tabBar = el('div', { class: 'filters' });
  const box = el('div');
  let active = 'funding';

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
    if (active === 'funding') clear(box).append(await fundingView());
    else if (active === 'credits') clear(box).append(await creditsView());
    else if (active === 'reversals') clear(box).append(await reversalsView());
    else clear(box).append(await pettyView());
  }

  root.append(el('h1', { text: 'การเงิน' }), tabBar, box);
  paintTabs();
  await load();
  return root;
}

// ---------------------------------------------------------------- เงินทุนเข้า
async function fundingView() {
  const d = await api.get('/api/funding');
  const wrap = el('div');
  wrap.append(el('div', { class: 'kpi-grid mb' },
    el('div', { class: 'kpi' }, el('div', { class: 'label', text: 'เงินทุนเข้ารวม' }),
      el('div', { class: 'value', text: baht(d.total_in, 0) })),
    el('div', { class: 'kpi' }, el('div', { class: 'label', text: 'จ่ายออกรวม (สุทธิ)' }),
      el('div', { class: 'value', text: baht(d.total_paid, 0) })),
    el('div', { class: 'kpi' }, el('div', { class: 'label', text: 'ได้คืนจากผู้ขาย' }),
      el('div', { class: 'value', text: baht(d.total_refund, 0) })),
    el('div', { class: `kpi ${d.balance < 0 ? 'red' : 'green'}` },
      el('div', { class: 'label', text: 'คงเหลือคำนวณ' }),
      el('div', { class: 'value', text: baht(d.balance, 0) }))));

  if (state.user.role === 'CEO')
    wrap.append(el('button', { class: 'btn primary block mb', onclick: openForm }, '+ บันทึกเงินทุนเข้า'));

  wrap.append(el('div', { class: 'card' }, table([
    { label: 'เลขที่', key: 'funding_id' },
    { label: 'วันที่', render: (x) => thaiDate(x.funding_date) },
    { label: 'งวด', key: 'period_label' },
    { label: 'บริษัทผู้รับเงิน', key: 'company' },
    { label: 'สถานะทางบัญชี', key: 'accounting_status' },
    { label: 'ที่มาของค่า', key: 'value_source' },
    { label: 'จำนวนเงิน', num: true, render: (x) => baht(x.amount) },
  ], d.funding, { empty: 'ยังไม่มีการบันทึกเงินทุนเข้า' })));
  return wrap;

  function openForm() {
    const date = el('input', { type: 'date', value: today() });
    const amount = el('input', { type: 'number', step: '0.01' });
    const company = el('input', { type: 'text', value: state.settings.company_name || '' });
    const source = el('input', { type: 'text', placeholder: 'แหล่งเงิน เช่น โอนจากบัญชีส่วนตัว' });
    const status = select([
      { value: 'เงินกู้ยืมกรรมการ', label: 'เงินกู้ยืมกรรมการ' },
      { value: 'เพิ่มทุน', label: 'เพิ่มทุน' },
      { value: 'เงินทดรอง', label: 'เงินทดรอง' },
    ]);
    modal({
      title: 'บันทึกเงินทุนเข้า',
      body: el('div', {}, field('วันที่', date), field('จำนวนเงิน', amount),
        field('บริษัทผู้รับเงิน', company), field('แหล่งเงิน', source),
        field('สถานะทางบัญชี', status)),
      actions: [
        { label: 'ยกเลิก' },
        {
          label: 'บันทึก', kind: 'primary',
          onClick: async () => {
            try {
              await api.post('/api/funding', {
                funding_date: date.value, amount: Number(amount.value),
                company: company.value.trim(), source: source.value.trim(),
                accounting_status: status.value,
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

// ---------------------------------------------------------------- เครดิตค้าง
async function creditsView() {
  const d = await api.get('/api/vendor-credits');
  return el('div', {},
    el('div', { class: 'banner warn' },
      `เครดิตค้างรวม ${baht(d.outstanding)} บาท — ระบบจะเด้งเตือน W4 ทุกครั้งที่สร้างใบเบิกกับผู้ขายรายนั้น`),
    el('div', { class: 'card' }, table([
      { label: 'ผู้ขาย', key: 'vendor_name' },
      { label: 'จากใบกลับรายการ', key: 'reversal_id' },
      { label: 'ยอดเครดิต', num: true, render: (x) => baht(x.amount) },
      { label: 'ใช้ไปแล้ว', num: true, render: (x) => baht(x.used_amount) },
      { label: 'คงเหลือ', num: true, render: (x) => baht(x.balance) },
      { label: 'สถานะ', render: (x) => el('span', { class: `pill ${x.status === 'คงเหลือ' ? 'amber' : 'green'}`, text: x.status }) },
    ], d.credits, { empty: 'ยังไม่มีเครดิตค้าง' })));
}

// ---------------------------------------------------------------- ใบกลับรายการ
async function reversalsView() {
  const d = await api.get('/api/reversals');
  return el('div', {},
    el('div', { class: 'banner' },
      `ยอดกลับรายการรวม ${baht(d.total)} บาท · ออกใบกลับรายการได้จากหน้ารายละเอียดใบเบิกที่จ่ายแล้ว`),
    el('div', { class: 'card' }, table([
      { label: 'เลขที่', key: 'reversal_id' },
      {
        label: 'ใบเดิม', render: (x) => el('a', {
          href: '#', onclick: (e) => { e.preventDefault(); navigate(`requests/${x.request_id}`); },
        }, x.request_id),
      },
      { label: 'ผู้ขาย', key: 'vendor_name' },
      { label: 'ประเภท', key: 'reversal_type' },
      { label: 'ปลายทาง', key: 'destination' },
      { label: 'เหตุผล', key: 'reason' },
      { label: 'ยอด', num: true, render: (x) => baht(x.amount) },
    ], d.reversals, { empty: 'ยังไม่มีใบกลับรายการ' })));
}

// ---------------------------------------------------------------- เงินสดย่อย
async function pettyView() {
  const d = await api.get('/api/petty-cash');
  const wrap = el('div');
  wrap.append(el('div', { class: 'banner' },
    `วงเงิน ${baht(d.ceiling, 0)} บาทต่อไซต์ · ต่อรายการไม่เกิน ${baht(d.line_max, 0)} บาท · ต้องเคลียร์บิลก่อนเติมเงิน`));

  if (state.caps.petty_cash)
    wrap.append(el('button', { class: 'btn block mb', onclick: openAccountForm }, '+ เปิดบัญชีเงินสดย่อย'));

  if (!d.accounts.length) {
    wrap.append(el('div', { class: 'empty', text: 'ยังไม่มีบัญชีเงินสดย่อย' }));
    return wrap;
  }

  for (const a of d.accounts) {
    const entriesBox = el('div', { class: 'hidden mt' });
    wrap.append(el('div', { class: 'card' },
      el('div', { class: 'spread' },
        el('div', {},
          el('div', { style: 'font-weight:600', text: `${a.project_name} · ${a.holder_name}` }),
          el('div', { class: 'tiny muted', text: `วงเงิน ${baht(a.ceiling, 0)} บาท` })),
        el('div', { class: 'right' },
          el('div', { class: 'tiny muted', text: 'คงเหลือ' }),
          el('div', { class: 'mono', style: 'font-weight:700', text: baht(a.computed_balance) }))),
      el('div', { class: 'row mt' },
        state.caps.petty_cash
          ? el('button', { class: 'btn sm grow', onclick: () => openEntryForm(a) }, 'บันทึกรายการ') : null,
        el('button', {
          class: 'btn sm ghost grow',
          onclick: async () => {
            if (!entriesBox.classList.contains('hidden')) return entriesBox.classList.add('hidden');
            const { entries } = await api.get(`/api/petty-cash/${a.pc_id}/entries`);
            clear(entriesBox).append(table([
              { label: 'วันที่', render: (x) => thaiDate(x.entry_date) },
              { label: 'ประเภท', key: 'entry_type' },
              { label: 'รายละเอียด', key: 'description' },
              { label: 'ผู้บันทึก', key: 'recorded_by_name' },
              { label: 'จำนวน', num: true, render: (x) => baht(x.amount) },
            ], entries, { empty: 'ยังไม่มีรายการ' }));
            entriesBox.classList.remove('hidden');
          },
        }, 'ดูรายการ')),
      entriesBox));
  }
  return wrap;

  function openAccountForm() {
    const project = select(state.projects.map((p) => ({ value: p.project_id, label: p.project_name })));
    const holder = select(state.users.map((u) => ({ value: u.user_id, label: `${u.display_name} (${u.role})` })));
    const ceiling = el('input', { type: 'number', value: 10000 });
    modal({
      title: 'เปิดบัญชีเงินสดย่อย',
      body: el('div', {}, field('โครงการ', project), field('ผู้ถือเงิน', holder), field('วงเงิน', ceiling)),
      actions: [
        { label: 'ยกเลิก' },
        {
          label: 'สร้าง', kind: 'primary',
          onClick: async () => {
            try {
              await api.post('/api/petty-cash/accounts', {
                project_id: project.value, holder_id: holder.value, ceiling: Number(ceiling.value),
              });
              toast('สร้างแล้ว', 'ok');
              reload();
            } catch (err) { toast(err.message, 'error'); return true; }
          },
        },
      ],
    });
  }

  function openEntryForm(account) {
    const type = select([
      { value: 'ใช้จ่าย', label: 'ใช้จ่าย' },
      { value: 'เคลียร์บิล', label: 'เคลียร์บิล' },
      { value: 'เติมเงิน', label: 'เติมเงิน' },
    ]);
    const amount = el('input', { type: 'number', step: '0.01' });
    const date = el('input', { type: 'date', value: today() });
    const desc = el('input', { type: 'text', placeholder: 'รายละเอียด' });
    modal({
      title: `เงินสดย่อย · ${account.project_name}`,
      body: el('div', {}, field('ประเภท', type), field('จำนวนเงิน', amount),
        field('วันที่', date), field('รายละเอียด', desc)),
      actions: [
        { label: 'ยกเลิก' },
        {
          label: 'บันทึก', kind: 'primary',
          onClick: async () => {
            try {
              await api.post(`/api/petty-cash/${account.pc_id}/entries`, {
                entry_type: type.value, amount: Number(amount.value),
                entry_date: date.value, description: desc.value.trim(),
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
