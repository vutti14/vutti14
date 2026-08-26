/** S5 — Dashboard */
import { api, qs } from '../api.js';
import {
  el, clear, kpi, baht, bahtShort, pct, table, barChart, stackBar, thaiMonth,
  thaiDate, duration, select,
} from '../ui.js';
import { state } from '../app.js';

const TABS = [
  { key: 'project', label: 'รายโครงการ' },
  { key: 'staff', label: 'จ่ายให้ทีมงานเอง' },
  { key: 'building', label: 'รายอาคาร' },
  { key: 'vendor', label: 'รายผู้ขาย' },
  { key: 'requester', label: 'รายผู้เบิก' },
  { key: 'costcode', label: 'รายหมวดงาน' },
  { key: 'sqm', label: 'ต้นทุน/ตร.ม.' },
  { key: 'boq', label: 'BOQ เทียบจริง' },
  { key: 'silent', label: 'อาคารเงียบ' },
  { key: 'duplicate', label: 'รายการซ้ำ' },
  { key: 'approval', label: 'ภาระอนุมัติ' },
  { key: 'adoption', label: 'การใช้ระบบ' },
];

export async function render() {
  const filters = { exclude_non_project: '', project_id: '', value_source: '', group_asset: '', from: '', to: '' };
  const root = el('div');
  const kpiBox = el('div', { class: 'kpi-grid mb' });
  const chartBox = el('div');
  const tabBar = el('div', { class: 'filters' });
  const tabBox = el('div');
  let activeTab = 'project';

  const projectSel = select(state.projects.map((p) => ({ value: p.project_id, label: p.project_name })),
    { placeholder: 'ทุกโครงการ', onchange: (e) => { filters.project_id = e.target.value; loadAll(); } });
  const sourceSel = select([
    { value: 'ข้อเท็จจริง', label: 'เฉพาะข้อมูลใหม่ในระบบ' },
    { value: 'นำเข้าย้อนหลัง', label: 'เฉพาะข้อมูลนำเข้าย้อนหลัง' },
  ], { placeholder: 'ทุกที่มาของค่า', onchange: (e) => { filters.value_source = e.target.value; loadAll(); } });
  const excludeToggle = el('input', { type: 'checkbox' });
  excludeToggle.addEventListener('change', () => {
    filters.exclude_non_project = excludeToggle.checked ? '1' : '';
    loadAll();
  });

  // v9 §29 — แยกทรัพย์สินกลุ่มออกจากงานรับเหมา/ส่วนตัว ก่อนคิดต้นทุนทรัพย์สิน
  const assetSel = select([
    { value: '1', label: 'เฉพาะทรัพย์สินกลุ่ม' },
    { value: '0', label: 'เฉพาะงานอื่น (รับเหมา · ส่วนตัว · หน่วยธุรกิจอื่น)' },
  ], { placeholder: 'ทุกประเภทโครงการ', onchange: (e) => { filters.group_asset = e.target.value; loadAll(); } });

  root.append(
    el('div', { class: 'eyebrow', text: 'ฝั่งรายจ่าย' }),
    el('h1', { text: 'ภาพรวม' }),
    el('div', { class: 'card tight' },
      el('div', { class: 'row wrap' },
        el('div', { class: 'grow' }, projectSel),
        el('div', { class: 'grow' }, assetSel),
        el('div', { class: 'grow' }, sourceSel)),
      el('label', { class: 'row mt', style: 'gap:.4rem' }, excludeToggle,
        el('span', { class: 'tiny', text: 'ไม่รวมค่าใช้จ่ายออฟฟิศและรายการที่ไม่ระบุโครงการ' }))),
    kpiBox, chartBox, tabBar, tabBox);

  async function loadAll() {
    clear(kpiBox).append(el('div', { class: 'loading', text: 'กำลังโหลด…' }));
    const d = await api.get('/api/reports/dashboard' + qs(filters));

    clear(kpiBox).append(
      kpi('เงินออกเดือนนี้', bahtShort(d.kpi.spend_this_month),
        d.kpi.spend_change_pct === null ? 'ยังไม่มีเดือนก่อนให้เทียบ'
          : `${d.kpi.spend_change_pct > 0 ? '▲' : '▼'} ${pct(Math.abs(d.kpi.spend_change_pct))} จากเดือนก่อน (${bahtShort(d.kpi.spend_prev_month)})`),
      kpi('รออนุมัติ', `${d.kpi.pending_count} ใบ`,
        `${bahtShort(d.kpi.pending_amount)} บาท · เวลาอนุมัติเฉลี่ย ${duration(d.kpi.avg_approval_seconds)}`,
        d.kpi.pending_count > 0 ? 'amber' : ''),
      kpi('จ่ายแล้วรอเอกสาร', bahtShort(d.kpi.awaiting_documents_amount),
        `${d.kpi.awaiting_documents_count} ใบ · ภาษีซื้อค้าง ${bahtShort(d.kpi.input_vat_stuck_amount)}`,
        d.kpi.awaiting_documents_amount > 0 ? 'amber' : ''),
      kpi('ของที่จ่ายแล้วยังไม่มา', bahtShort(d.kpi.goods_not_arrived_amount),
        `${d.kpi.goods_not_arrived_count} ใบ`,
        d.kpi.goods_not_arrived_amount > 0 ? 'red' : 'green'));

    clear(chartBox).append(
      el('div', { class: 'card' },
        el('div', { class: 'rule-head', text: 'เงินออกรายเดือน' }),
        d.monthly.length ? barChart(d.monthly) : el('div', { class: 'empty', text: 'ยังไม่มีข้อมูล' })),
      el('div', { class: 'card' },
        el('div', { class: 'rule-head', text: 'สัดส่วนประเภทต้นทุน' }),
        stackBar(d.cost_type_mix),
        el('div', { class: 'mt small' },
          el('div', { class: 'muted tiny mb', text: 'เทียบสัดส่วนอ้างอิงจาก BOQ' }),
          table([
            { label: 'ประเภท', key: 'cost_type' },
            { label: 'จำนวนเงิน', num: true, render: (x) => baht(x.amount) },
            { label: 'สัดส่วนจริง', num: true, render: (x) => pct(x.pct) },
            {
              label: 'อ้างอิง BOQ', num: true,
              render: (x) => d.boq_reference_mix[x.cost_type] !== undefined
                ? pct(d.boq_reference_mix[x.cost_type]) : '—',
            },
          ], d.cost_type_mix))),
      el('div', { class: 'card' },
        el('div', { class: 'rule-head', text: 'ทรัพย์สินกลุ่ม เทียบ งานอื่น' }),
        el('p', { class: 'tiny muted', text: 'v9 พบว่า 4 โครงการไม่ใช่ทรัพย์สินกลุ่ม (บ้านลูกค้า · งานซ่อมให้ลูกค้า · หน่วยธุรกิจอื่น · บ้านของ CEO) — ต้องแยกออกก่อนคิดมูลค่าทรัพย์สินและค่าเสื่อม' }),
        table([
          { label: 'ประเภท', key: 'label' },
          { label: 'จำนวนใบ', num: true, key: 'n' },
          { label: 'จำนวนเงิน', num: true, render: (x) => baht(x.amount) },
        ], d.asset_split),
        d.staff_payments.count > 0
          ? el('div', { class: 'banner warn mt' },
            el('b', { text: 'จ่ายให้ทีมงานของเราเอง' }),
            `${d.staff_payments.count} ใบ · ${baht(d.staff_payments.amount)} บาท` +
            (d.staff_payments.self_count
              ? ` — ในนั้นเป็นการเบิกเองจ่ายตัวเอง ${d.staff_payments.self_count} ใบ ${baht(d.staff_payments.self_amount)} บาท`
              : '') +
            ' · ระบบเดิมมองเป็นทีมช่างภายนอกจึงจัดเป็นค่าแรง ต้องระบุประเภทที่แท้จริงก่อนใช้ตัวเลขค่าแรง')
          : null),
      el('div', { class: 'card' },
        el('div', { class: 'rule-head', text: 'ที่มาของค่าและความเชื่อถือ' }),
        el('p', { class: 'tiny muted', text: 'ระดับ C/D คือการประมาณจากสัดส่วน BOQ ไม่ใช่ข้อเท็จจริง — ห้ามใช้เป็นตัวเลขตัดสินใจโดยไม่ระบุที่มา' }),
        table([
          { label: 'ที่มาของค่า', key: 'value_source' },
          { label: 'จำนวนใบ', num: true, key: 'n' },
          { label: 'จำนวนเงิน', num: true, render: (x) => baht(x.amount) },
        ], d.value_source),
        el('div', { class: 'mt' }, table([
          {
            label: 'ระดับความเชื่อถือ', render: (x) =>
              el('span', { class: `conf-${x.confidence}`, text: x.confidence }),
          },
          { label: 'จำนวนใบ', num: true, key: 'n' },
          { label: 'จำนวนเงิน', num: true, render: (x) => baht(x.amount) },
        ], d.confidence))));

    await loadTab();
  }

  function paintTabs() {
    clear(tabBar);
    for (const t of TABS)
      tabBar.append(el('button', {
        class: activeTab === t.key ? 'on' : '',
        onclick: () => { activeTab = t.key; paintTabs(); loadTab(); },
      }, t.label));
  }

  async function loadTab() {
    clear(tabBox).append(el('div', { class: 'loading', text: 'กำลังโหลด…' }));
    const q = qs(filters);
    let node;
    if (activeTab === 'project') {
      const { rows } = await api.get('/api/reports/by-project' + q);
      node = table([
        { label: 'โครงการ', render: (x) => `${x.project_name} (${x.project_id})` },
        { label: 'ประเภท', key: 'project_type' },
        {
          label: 'ทรัพย์สินกลุ่ม', render: (x) => el('span', {
            class: `pill ${x.is_group_asset ? 'green' : 'red'}`,
            text: x.is_group_asset ? 'ใช่' : 'ไม่ใช่',
          }),
        },
        { label: 'สถานะ', key: 'asset_status' },
        { label: 'ใบ', num: true, key: 'request_count' },
        { label: 'จ่ายจริง', num: true, render: (x) => baht(x.spent) },
      ], rows);
    } else if (activeTab === 'staff') {
      const d2 = await api.get('/api/reports/staff-payments' + q);
      node = el('div', {},
        el('div', { class: 'banner warn' }, el('b', { text: 'ทำไมต้องดูตารางนี้' }), d2.note),
        el('div', { class: 'spread small mb' },
          el('span', { text: `${d2.rows.length} ใบ` }),
          el('span', { class: 'mono', text: `${baht(d2.total)} บาท · เบิกเองจ่ายตัวเอง ${baht(d2.self_paid_total)} บาท` })),
        table([
          { label: 'ใบเบิก', key: 'request_id' },
          { label: 'วันที่', render: (x) => thaiDate(x.request_date) },
          { label: 'ผู้เบิก', key: 'requester_name' },
          { label: 'ผู้รับเงิน', render: (x) => x.staff_name || x.vendor_name || x.payee_name_raw || '—' },
          {
            label: 'เบิกเองจ่ายตัวเอง', render: (x) => x.self_paid
              ? el('span', { class: 'pill red', text: 'ใช่' }) : '—',
          },
          { label: 'ลงเป็น', key: 'cost_types' },
          { label: 'โครงการ', key: 'project_name' },
          { label: 'จำนวนเงิน', num: true, render: (x) => baht(x.total_amount) },
        ], d2.rows, { empty: 'ไม่พบการจ่ายให้ทีมงานของเราเอง' }));
    } else if (activeTab === 'building') {
      const { rows } = await api.get('/api/reports/by-building' + q);
      node = table([
        { label: 'อาคาร', render: (x) => `${x.building_name} · ${x.project_name}` },
        { label: 'แบบ', key: 'design_code' },
        { label: 'ตร.ม.', num: true, render: (x) => (x.area_sqm ? baht(x.area_sqm, 0) : '—') },
        { label: 'จ่ายจริง', num: true, render: (x) => baht(x.spent) },
        { label: 'บาท/ตร.ม.', num: true, render: (x) => (x.cost_per_sqm ? baht(x.cost_per_sqm, 0) : '—') },
        { label: 'งบ', num: true, render: (x) => (x.budget ? baht(x.budget) : '—') },
        { label: 'ใช้ไป', num: true, render: (x) => pct(x.used_pct) },
        { label: 'ระยะเวลา', num: true, render: (x) => (x.duration_days === null ? '—' : `${x.duration_days} วัน`) },
      ], rows);
    } else if (activeTab === 'vendor') {
      const { rows } = await api.get('/api/reports/by-vendor' + q);
      node = table([
        { label: 'ผู้ขาย', key: 'vendor_name' },
        { label: 'ประเภท', key: 'entity_type' },
        { label: 'สถานะเอกสาร', key: 'doc_status' },
        { label: 'ใบ', num: true, key: 'request_count' },
        { label: 'จ่ายจริง', num: true, render: (x) => baht(x.spent) },
        { label: 'หัก ณ ที่จ่าย', num: true, render: (x) => baht(x.wht) },
      ], rows);
    } else if (activeTab === 'requester') {
      const { rows } = await api.get('/api/reports/by-requester' + q);
      node = table([
        { label: 'ผู้เบิก', render: (x) => `${x.display_name} (${x.requester_id})` },
        { label: 'บทบาท', key: 'role' },
        { label: 'ใบ', num: true, key: 'request_count' },
        { label: 'จ่ายจริง', num: true, render: (x) => baht(x.spent) },
        { label: 'อนุมัติเอง (ใบ)', num: true, key: 'self_approved_count' },
        { label: 'อนุมัติเอง (บาท)', num: true, render: (x) => baht(x.self_approved_amount) },
      ], rows);
    } else if (activeTab === 'costcode') {
      const { rows } = await api.get('/api/reports/by-cost-code' + q);
      node = table([
        { label: 'หมวดงาน', render: (x) => `${x.cost_code} · ${x.cost_name || ''}` },
        { label: 'กลุ่มงาน', key: 'work_group' },
        { label: 'ประเภท', key: 'cost_type' },
        { label: 'สถานะรหัส', render: (x) => el('span', { class: `pill ${x.code_status === 'ใช้ต่อ' ? 'green' : 'amber'}`, text: x.code_status || '—' }) },
        { label: 'จำนวนเงิน', num: true, render: (x) => baht(x.amount) },
      ], rows);
    } else if (activeTab === 'sqm') {
      const d = await api.get('/api/reports/cost-per-sqm' + q);
      node = el('div', {},
        el('div', { class: 'banner', text: d.note }),
        ...d.groups.map((g) => el('div', { class: 'card' },
          el('div', { class: 'card-head' },
            el('h3', { text: `${g.design_code} · ${g.design_name || ''}` }),
            el('span', { class: `pill ${g.design_status === 'ยืนยันแล้ว' ? 'green' : 'amber'}`, text: g.design_status || '—' })),
          el('div', { class: 'small muted mb' },
            `เฉลี่ย ${baht(g.avg_cost_per_sqm, 0)} บาท/ตร.ม.` +
            (g.ref_cost_per_sqm ? ` · อ้างอิง ${baht(g.ref_cost_per_sqm, 0)}` : '') +
            (g.spread_pct !== null ? ` · ต่างกันในกลุ่ม ${pct(g.spread_pct)}` : ' · มีอาคารเดียว เทียบไม่ได้')),
          table([
            { label: 'อาคาร', key: 'building_name' },
            { label: 'ตร.ม.', num: true, render: (x) => baht(x.area_sqm, 0) },
            { label: 'จ่ายจริง', num: true, render: (x) => baht(x.spent) },
            { label: 'บาท/ตร.ม.', num: true, render: (x) => baht(x.cost_per_sqm, 0) },
          ], g.buildings))));
    } else if (activeTab === 'boq') {
      const { rows } = await api.get('/api/reports/boq-vs-actual');
      node = table([
        { label: 'อาคาร', render: (x) => `${x.building_name} · ${x.project_name}` },
        { label: 'BOQ', key: 'boq_id' },
        { label: 'งบตาม BOQ', num: true, render: (x) => (x.boq_budget ? baht(x.boq_budget) : '—') },
        { label: 'จ่ายจริง', num: true, render: (x) => baht(x.spent) },
        {
          label: 'ทำไปแล้ว', num: true, render: (x) => x.progress_pct === null ? '—'
            : el('div', {},
              el('div', { class: 'tiny right', text: pct(x.progress_pct) }),
              el('div', { class: 'bar-track' },
                el('div', { class: `bar-fill ${x.progress_pct > 100 ? 'over' : ''}`, style: `width:${Math.min(x.progress_pct, 100)}%` }))),
        },
        { label: 'เหลือต้องจ่าย', num: true, render: (x) => (x.remaining === null ? '—' : baht(x.remaining)) },
      ], rows);
    } else if (activeTab === 'silent') {
      const d = await api.get('/api/reports/silent-buildings?days=45');
      node = el('div', {},
        el('div', { class: 'banner warn', text: `อาคารที่ยังไม่ปิดงานแต่ไม่มีการเบิกมาแล้วเกิน ${d.threshold_days} วัน = เงินค้างกลางทาง` }),
        table([
          { label: 'อาคาร', render: (x) => `${x.building_name} · ${x.project_name}` },
          { label: 'เบิกล่าสุด', render: (x) => thaiDate(x.last_date) },
          { label: 'เงียบมาแล้ว', num: true, render: (x) => `${x.idle_days} วัน` },
          { label: 'จ่ายไปแล้ว', num: true, render: (x) => baht(x.spent) },
        ], d.rows, { empty: 'ไม่มีอาคารที่เงียบเกินเกณฑ์' }));
    } else if (activeTab === 'duplicate') {
      const d = await api.get('/api/reports/duplicates');
      node = el('div', {},
        el('div', { class: 'banner warn' },
          `พบ ${d.group_count} กลุ่มที่น่าสงสัย มูลค่าส่วนเกิน ${baht(d.excess_amount)} บาท — ตรวจที่ระดับอาคาร ไม่ใช่ระดับโครงการ`),
        table([
          { label: 'อาคาร', render: (x) => `${x.building_name} · ${x.project_name}` },
          { label: 'วันที่', render: (x) => thaiDate(x.request_date) },
          { label: 'ยอดต่อใบ', num: true, render: (x) => baht(x.amount) },
          { label: 'จำนวนใบ', num: true, key: 'n' },
          { label: 'เลขที่ใบ', key: 'request_ids' },
        ], d.rows ?? d.groups, { empty: 'ไม่พบรายการซ้ำ' }));
    } else if (activeTab === 'approval') {
      const d = await api.get('/api/reports/approval-load' + q);
      node = el('div', {},
        el('p', { class: 'small muted', text: 'ใช้ดูว่าเวลาอนุมัติหมดไปกับใบเล็กหรือใบใหญ่ — ถ้าใบเล็กกินเวลาส่วนใหญ่ ถึงเวลามอบอำนาจ' }),
        table([
          { label: 'ช่วงยอดเงิน', key: 'bucket' },
          { label: 'จำนวนใบ', num: true, key: 'n' },
          { label: '% ของใบ', num: true, render: (x) => pct(x.count_pct) },
          { label: 'จำนวนเงิน', num: true, render: (x) => baht(x.amount) },
          { label: '% ของเงิน', num: true, render: (x) => pct(x.amount_pct) },
          { label: 'เวลาอนุมัติเฉลี่ย', num: true, render: (x) => duration(x.avg_sec) },
        ], d.buckets),
        el('div', { class: 'banner mt' },
          `ใบที่ผู้อนุมัติเป็นผู้ขอเอง ${d.self_approved.n} ใบ · ${baht(d.self_approved.amount)} บาท`));
    } else {
      const d = await api.get('/api/reports/adoption');
      node = el('div', {},
        el('div', { class: 'banner' },
          `ตัวชี้วัดความสำเร็จตัวเดียว: % ของใบเบิกที่ผ่านระบบ (ไม่ใช่ผ่านไลน์) นับตั้งแต่วันตัดข้อมูล ${thaiDate(d.cutover_date)} · เป้าหมายเดือนแรก ${d.target.month1}% เดือนสาม ${d.target.month3}%`),
        table([
          { label: 'เดือน', render: (x) => thaiMonth(x.ym) },
          { label: 'ผ่านระบบ', num: true, key: 'in_system' },
          { label: 'นำเข้าย้อนหลัง', num: true, key: 'imported' },
          { label: 'รวม', num: true, key: 'total' },
          {
            label: '% ผ่านระบบ', num: true, render: (x) => el('div', {},
              el('div', { class: 'tiny right', text: pct(x.in_system_pct) }),
              el('div', { class: 'bar-track' },
                el('div', { class: 'bar-fill', style: `width:${x.in_system_pct}%` }))),
          },
        ], d.months, { empty: 'ยังไม่มีข้อมูลหลังวันตัดข้อมูล' }));
    }
    clear(tabBox).append(el('div', { class: 'card' }, node));
  }

  paintTabs();
  await loadAll();
  return root;
}
