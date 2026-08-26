#!/usr/bin/env python3
"""
สร้างไฟล์ตัวอย่างหน้าเว็บไฟล์เดียว (preview/index.html)

เอา data/seed/*.json มาบีบให้เล็กแล้วฝังลงใน preview/app.template.html
ที่ตำแหน่ง /*__DATA__*/ ผลลัพธ์คือหน้าเดียวจบ เปิดจากมือถือได้โดยไม่ต้องมีเซิร์ฟเวอร์
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEED = ROOT / 'data' / 'seed'
OUT = ROOT / 'preview' / 'index.html'
TPL = ROOT / 'preview' / 'app.template.html'


def load(name):
    return json.loads((SEED / f'{name}.json').read_text('utf-8'))


def r2(x):
    return round(float(x or 0) + 1e-9, 2)


def main():
    users = load('users')
    projects = load('projects')
    buildings = load('buildings')
    codes = load('cost_codes')
    vendors = load('vendors')
    ups = load('user_projects')
    reqs = load('legacy_requests')
    lines = load('legacy_request_lines')

    # ---- ตารางอ้างอิง (บีบเป็น array ตามลำดับคอลัมน์ที่ฝั่งหน้าเว็บรู้จัก)
    U = [[u['user_id'], u['display_name'], u['role'], u['title']]
         for u in users if u['status'] == 'ใช้งาน']
    P = [[p['project_id'], p['project_name'], p['project_type'] or '—']
         for p in projects]
    B = [[b['building_id'], b['project_id'], b['building_name'], b['work_nature'] or '',
          b['status'], r2(b['area_sqm']) if b.get('area_sqm') else 0,
          b.get('floors') or 0, 1 if b['is_building'] == 'Y' else 0]
         for b in buildings]
    C = [[c['cost_code'], c['cost_name'], c['work_group'] or '9 อื่น ๆ',
          1 if c['status'] == 'ใช้ต่อ' else 0]
         for c in codes]
    V = [[v['vendor_id'], v['vendor_name'], v['vendor_type'] or '',
          int(v.get('vat_registered') or 0), r2(v.get('wht_percent')),
          int(v.get('is_own_staff') or 0)]
         for v in vendors]

    access = {}
    for a in ups:
        access.setdefault(a['user_id'], []).append(a['project_id'])

    # ---- ใบเบิกที่นำเข้าย้อนหลัง
    idx = {}
    R = []
    for r in reqs:
        idx[r['request_id']] = len(R)
        R.append([
            r['request_id'], r['request_date'], r['requester_id'], r['project_id'],
            r['building_id'] or '', r['vendor_id'] or '', r['payee_name_raw'] or '',
            r2(r['amount_before_vat']), r2(r['vat_amount']), r2(r['total_amount']),
            r2(r['wht_amount']), r2(r['net_amount']), r['status'], r['note'] or '',
        ])

    L = []
    for l in lines:
        i = idx.get(l['request_id'])
        if i is None:
            continue
        L.append([i, l['cost_code'], l['cost_type'], r2(l['line_amount']), l['description'] or ''])

    data = {'u': U, 'p': P, 'b': B, 'c': C, 'v': V, 'a': access, 'r': R, 'l': L}
    blob = json.dumps(data, ensure_ascii=False, separators=(',', ':'))

    total = sum(x[9] for x in R)
    print(f'ใบเบิก {len(R):,} ใบ · รายการย่อย {len(L):,} บรรทัด · ยอดรวม {total:,.2f} บาท')

    tpl = TPL.read_text('utf-8')
    if '/*__DATA__*/' not in tpl:
        sys.exit('หา /*__DATA__*/ ในเทมเพลตไม่เจอ')
    html = tpl.replace('/*__DATA__*/', blob)
    OUT.write_text(html, 'utf-8')
    print(f'เขียน {OUT.relative_to(ROOT)} — {len(html)/1024:.0f} KB')


if __name__ == '__main__':
    main()
