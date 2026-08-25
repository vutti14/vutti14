#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
แปลง data/source/RABBiZBuild_v8_FINAL.xlsx -> data/seed/*.json
รันครั้งเดียวก็พอ ผลลัพธ์ commit ไว้ในรีโป (server/seed.js อ่านไฟล์ JSON เหล่านี้)

  python3 tools/xlsx_to_seed.py
"""
import json, os, sys, unicodedata
from datetime import datetime, date
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'source', 'RABBiZBuild_v8_FINAL.xlsx')
OUT = os.path.join(ROOT, 'data', 'seed')
YEAR_CE = 2026  # 2569 พ.ศ.

def s(v):
    if v is None: return ''
    if isinstance(v, (datetime, date)): return v.strftime('%Y-%m-%d')
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    return unicodedata.normalize('NFC', str(v)).strip()

def num(v):
    if v is None or v == '': return None
    try: return round(float(v), 2)
    except (TypeError, ValueError): return None

def sheet(wb, name, header_row=1):
    """คืน list ของ dict โดยใช้แถว header_row (1-based) เป็นชื่อคอลัมน์"""
    ws = wb[name]
    rows = list(ws.iter_rows(values_only=True))
    hdr = [s(c) for c in rows[header_row - 1]]
    out = []
    for r in rows[header_row:]:
        if all(c is None or s(c) == '' for c in r): continue
        out.append({hdr[i]: r[i] for i in range(min(len(hdr), len(r))) if hdr[i]})
    return out

def write(name, data):
    p = os.path.join(OUT, name + '.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f'  {name:<16} {len(data):>5} แถว -> {os.path.relpath(p, ROOT)}')

# ---------------------------------------------------------------- ผู้ใช้
# สเปก §3.1 กำหนด 11 คน ส่วนชีต 05_DIM_PERSON มีอีเมล/เบอร์โทรจริงอยู่ 9 คน
# บทบาทยึดตามสเปก (ชีตเก็บคำเรียกแบบเก่า เช่น "ผู้เบิก / PM")
ROLE_BY_ID = {
    'A': 'CEO', 'K': 'COO', 'S': 'FINANCE', 'N': 'ACCOUNT',
    'M': 'PM', 'F': 'PM', 'O': 'PM', 'B': 'PM',
    'J': 'SERVICE', 'T': 'SERVICE', 'I': 'VIEWER',
}
TITLE_BY_ID = {
    'A': 'CEO', 'K': 'COO', 'S': 'การเงิน', 'N': 'บัญชี',
    'M': 'PM', 'F': 'PM', 'O': 'PM', 'B': 'PM',
    'J': 'ช่างซ่อมบำรุง', 'T': 'ช่างซ่อมบำรุง', 'I': 'ผู้ดูข้อมูล',
}
# คนที่ยังไม่มีในชีต v8 — สร้างไว้แต่ระงับ รอ CEO กรอกอีเมล/เบอร์จริงในหน้าผู้ใช้
EXTRA_USERS = [
    {'user_id': 'T', 'display_name': 'เต้', 'username': 'te.pending@rabbiz.local', 'phone': ''},
    {'user_id': 'I', 'display_name': 'อิม', 'username': 'im.pending@rabbiz.local', 'phone': ''},
]

def build_users(wb):
    out, seen = [], set()
    for r in sheet(wb, '05_DIM_PERSON'):
        uid = s(r.get('person_id'))
        if len(uid) != 1 or uid not in ROLE_BY_ID: continue
        seen.add(uid)
        out.append({
            'user_id': uid,
            'display_name': s(r.get('ชื่อที่ใช้เรียก')),
            'full_name': s(r.get('ชื่อเต็มตามที่พบในไฟล์')),
            'title': TITLE_BY_ID[uid],
            'role': ROLE_BY_ID[uid],
            'username': s(r.get('username (อีเมล)')).lower(),
            'phone': s(r.get('เบอร์โทร (ใช้ติดต่อ)')),
            'require_2fa': 1 if ROLE_BY_ID[uid] in ('CEO', 'COO', 'FINANCE') else 0,
            'status': 'ใช้งาน',
            'note': '',
        })
    for e in EXTRA_USERS:
        if e['user_id'] in seen: continue
        out.append({
            'user_id': e['user_id'], 'display_name': e['display_name'], 'full_name': '',
            'title': TITLE_BY_ID[e['user_id']], 'role': ROLE_BY_ID[e['user_id']],
            'username': e['username'], 'phone': e['phone'],
            'require_2fa': 0, 'status': 'ระงับ',
            'note': 'ยังไม่มีอีเมล/เบอร์โทรในฐาน v8 — CEO ต้องกรอกและเปิดใช้งานก่อน',
        })
    out.sort(key=lambda x: list(ROLE_BY_ID).index(x['user_id']))
    return out

# ---------------------------------------------------------------- โครงการ
def build_projects(wb):
    return [{
        'project_id': s(r.get('project_id')),
        'project_name': s(r.get('project_name')),
        'nature': s(r.get('ลักษณะ')),
        'is_real_project': 0 if s(r.get('ลักษณะ')) == 'ไม่ใช่โครงการ' or s(r.get('project_id')) in ('NA', 'OFF') else 1,
        'note': s(r.get('หมายเหตุ')),
        'status': 'ใช้งาน',
    } for r in sheet(wb, '02_DIM_PROJECT') if len(s(r.get('project_id'))) <= 4 and s(r.get('project_id'))]

# ---------------------------------------------------------------- แบบอาคาร
def build_designs(wb):
    out = []
    for r in sheet(wb, '14_DIM_DESIGN', header_row=4):
        code = s(r.get('design_code'))
        if not code.startswith('D-'): continue
        out.append({
            'design_code': code,
            'design_name': s(r.get('ชื่อแบบ')),
            'floors': int(num(r.get('จำนวนชั้น')) or 0) or None,
            'std_area_sqm': num(r.get('พื้นที่ (ตร.ม.)')),
            'structure': s(r.get('ลักษณะโครงสร้าง')),
            'ref_cost_per_sqm': num(r.get('ต้นทุนอ้างอิง/ตร.ม.')),
            'status': 'ยืนยันแล้ว' if s(r.get('สถานะ')) == 'ยืนยันแล้ว' else 'รอยืนยัน',
            'note': s(r.get('หมายเหตุ')),
        })
    return out

# ---------------------------------------------------------------- อาคาร
WORK_NATURE = ('สร้างใหม่', 'ต่อเติม', 'ซ่อมบำรุง')

def build_buildings(wb):
    out = []
    for r in sheet(wb, '03_DIM_BUILDING'):
        bid = s(r.get('building_id'))
        if not (len(bid) == 4 and bid[0] == 'B' and bid[1:].isdigit()): continue
        raw_nature = s(r.get('work_nature (สร้างใหม่/ต่อเติม/ซ่อมบำรุง)'))
        nature = next((w for w in WORK_NATURE if raw_nature.startswith(w)), 'สร้างใหม่')
        raw_status = s(r.get('status (กำลังทำ/ปิดจบ)'))
        status = 'ปิดจบ' if raw_status.startswith('ปิดจบ') else 'กำลังทำ'
        # ข้อความส่วนเกินใน work_nature (เช่น "สร้างใหม่ — เสร็จราว 60%") ย้ายไปหมายเหตุ
        extra = raw_nature[len(nature):].strip(' —-') if raw_nature.startswith(nature) else raw_nature
        note = ' · '.join(x for x in (s(r.get('หมายเหตุ')), extra) if x)
        out.append({
            'building_id': bid,
            'project_id': s(r.get('project_id')),
            'building_name': s(r.get('building_name')),
            'design_code': s(r.get('design_code (แบบอาคาร)')) or None,
            'work_nature': nature,
            'status': status,
            'area_sqm': num(r.get('area_sqm (กรอกเมื่อเป็นงานสร้างใหม่)')),
            'floors': int(num(r.get('จำนวนชั้น')) or 0) or None,
            'is_building': 'N' if s(r.get('is_building (Y/N)')) == 'N' else 'Y',
            'budget': None,
            'value_source': 'ข้อเท็จจริง' if s(r.get('ที่มาของค่า')).startswith('ข้อเท็จจริง')
                            else 'อนุมาน' if s(r.get('ที่มาของค่า')).startswith('อนุมาน')
                            else 'นำเข้าย้อนหลัง',
            'note': note,
        })
    return out

# ---------------------------------------------------------------- หมวดงาน
GROUPS = {'1 งานโครงสร้าง': 1, '2 งานสถาปัตย์': 2, '3 งานระบบ': 3,
          '4 งานภายนอกโครงการ': 4, '5 งานอื่น/ดำเนินการ': 5}

def build_cost_codes(wb):
    out = []
    for r in sheet(wb, '04_DIM_COSTCODE'):
        code = s(r.get('cost_code'))
        if not (2 <= len(code) <= 4 and code.isupper()): continue
        status = s(r.get('สถานะ v8')) or 'ใช้ต่อ'
        if code == 'NA': status = 'เลิกใช้'   # "ไม่ระบุ" ไม่ใช่หมวดงาน — ห้ามให้เลือกในใบใหม่
        merge = s(r.get('ยุบเข้ารหัส')) or None
        grp = s(r.get('กลุ่มงานตาม BOQ'))
        out.append({
            'cost_code': code,
            'cost_name': s(r.get('cost_name')),
            'work_group': grp if grp != '—' else '',
            'group_order': GROUPS.get(grp, 9),
            'status': status,          # ใช้ต่อ / เลิกใช้ / ยุบรวม
            'merge_into': merge,
            'default_cost_type': {'ของ': 'ของ', 'แรง': 'แรง', 'เช่า': 'เช่า', 'โสหุ้ย': 'โสหุ้ย'}.get(
                s(r.get('แกน 2 ประเภทต้นทุน')), None),
            'note': s(r.get('เหตุผล / วิธีแก้')),
        })
    return out

# ---------------------------------------------------------------- ผู้ขาย
def build_vendors(wb):
    out = []
    for r in sheet(wb, '06_DIM_VENDOR'):
        vid = s(r.get('vendor_id'))
        if not vid.startswith('V'): continue
        vtype = s(r.get('vendor_type'))
        entity = 'บุคคลธรรมดา' if 'บุคคล' in vtype or 'ช่าง' in vtype or 'ผู้รับเหมา' in vtype else 'นิติบุคคล'
        out.append({
            'vendor_id': vid,
            'vendor_name': s(r.get('vendor_name')),
            'vendor_type': vtype,
            'category': s(r.get('หมวดสินค้า/บริการ')),
            'phone': s(r.get('โทรศัพท์')),
            'entity_type': entity,
            'tax_id': '',
            'bank_account': '',
            'payment_terms': '',
            'vat_registered': 0,
            'wht_percent': 3 if entity == 'บุคคลธรรมดา' else 0,
            'doc_status': 'ยืนยันแล้ว' if s(r.get('ยืนยันประเภทแล้ว')) else 'รอตรวจเอกสาร',
            'created_by': None,
            'verified_by': None,
            'status': 'ใช้งาน',
        })
    return out

# ---------------------------------------------------------------- วัสดุ + ราคา
def build_items(wb):
    return [{
        'item_id': s(r.get('item_id')),
        'category': s(r.get('category')),
        'item_name': s(r.get('item_name')),
        'unit': s(r.get('unit')),
        'ref_price_min': num(r.get('ราคาต่ำสุด')),
        'ref_price_max': num(r.get('ราคาสูงสุด')),
        'vendor_count': int(num(r.get('จำนวนร้านที่มีราคา')) or 0),
        'status': 'ใช้งาน',
    } for r in sheet(wb, '07_DIM_ITEM') if s(r.get('item_id')).startswith('I')]

def build_item_prices(wb):
    return [{
        'price_id': s(r.get('price_id')),
        'item_id': s(r.get('item_id')),
        'vendor_id': s(r.get('vendor_id')) or None,
        'unit_price': num(r.get('unit_price')),
        'unit': s(r.get('unit')),
        'source_note': s(r.get('source_note')),
        'is_cheapest': 1 if s(r.get('is_cheapest')) in ('1', 'True') else 0,
    } for r in sheet(wb, '11_FACT_PRICE') if s(r.get('price_id')).startswith('P')]

# ---------------------------------------------------------------- Rate card
def build_rates(wb):
    out, n = [], 0
    for r in sheet(wb, '13_DIM_RATE', header_row=4):
        name = s(r.get('รายการ'))
        if not name: continue
        n += 1
        kind = s(r.get('ประเภท'))
        out.append({
            'rate_id': f'R{n:03d}',
            'cost_type': {'ค่าแรง': 'แรง', 'ค่าวัสดุ': 'ของ', 'ค่าเครื่องจักร': 'เช่า'}.get(kind, 'ของ'),
            'rate_name': name,
            'unit': s(r.get('หน่วย')),
            'rate_satoshi': num(r.get('Satoshi L')),
            'rate_goldy': num(r.get('Goldy')),
            'std_rate': num(r.get('อัตรามาตรฐาน')),
            'method': s(r.get('วิธีได้มา')),
            'status': 'ยืนยันแล้ว' if s(r.get('สถานะ')) == 'ยืนยันแล้ว' else 'รอยืนยัน',
        })
    return out

# ---------------------------------------------------------------- BOQ
def build_boq(wb):
    reg = []
    for r in sheet(wb, '30_BOQ_REGISTER'):
        bid = s(r.get('boq_id'))
        if not bid.startswith('BOQ-'): continue
        reg.append({
            'boq_id': bid,
            'title': s(r.get('building_name')),
            'version': s(r.get('version')),
            'received_date': s(r.get('วันที่รับ BOQ')),
            'source_file': s(r.get('ชื่อไฟล์ต้นทาง')),
            'boq_value': num(r.get('มูลค่า BOQ ต่อ 1 อาคาร (บาท)')),
            'author': s(r.get('ผู้จัดทำ')),
            'status': s(r.get('สถานะ')),
        })
    bld = []
    for r in sheet(wb, '32_BOQ_BUILDING'):
        bid, bldg = s(r.get('boq_id')), s(r.get('building_id'))
        if not bid.startswith('BOQ-') or not bldg.startswith('B'): continue
        bld.append({
            'boq_id': bid,
            'building_id': bldg,
            'boq_budget': num(r.get('งบตาม BOQ (บาท)')),
            'status': s(r.get('สถานะ')),
            'note': s(r.get('หมายเหตุ')),
        })
    return reg, bld

# ---------------------------------------------------------------- คู่อาคาร
def build_pairs(wb):
    out = []
    for r in sheet(wb, '09_DIM_BUILDING_PAIR', header_row=4):
        pid = s(r.get('pair_id'))
        if not pid.startswith('P'): continue
        out.append({
            'pair_id': pid,
            'label_a': s(r.get('อาคาร A')),
            'label_b': s(r.get('อาคาร B')),
            'project_id': s(r.get('โครงการ')),
            'same_amount_count': int(num(r.get('จำนวนครั้งที่จ่ายพร้อมกันยอดเท่ากัน')) or 0),
            'status': s(r.get('สถานะ')),
            'note': s(r.get('ใช้ทำอะไร')),
        })
    return out

# ---------------------------------------------------------------- เงินทุนเข้า
THAI_MONTH = {'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
              'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12}

def build_funding(wb):
    out, n = [], 0
    for r in sheet(wb, '12_FACT_FUNDING_IN'):
        period = s(r.get('period'))
        amount = num(r.get('เงินทุนเข้าโครงการ (Funding In)'))
        if not period or not amount: continue
        mo = next((v for k, v in THAI_MONTH.items() if period.startswith(k)), None)
        if mo is None: continue
        n += 1
        out.append({
            'funding_id': f'FIN-{YEAR_CE % 100}{mo:02d}-{n:04d}',
            'funding_date': f'{YEAR_CE}-{mo:02d}-01',
            'amount': amount,
            'company': 'RABBiZ Group',
            'source': 'นำเข้าย้อนหลังจาก 12_FACT_FUNDING_IN',
            'accounting_status': 'เงินกู้ยืมกรรมการ',
            'period_label': period,
            'value_source': 'นำเข้าย้อนหลัง',
        })
    return out

# ---------------------------------------------------------------- รายการเบิก
def build_txn(wb, valid_buildings, valid_projects, valid_costcodes):
    """1 แถวใน 10_FACT_TXN = 1 ใบเบิกที่ 'จ่ายแล้ว' + รายการย่อยแยกตาม cost_type"""
    extra_buildings, reqs, lines, seq = {}, [], [], {}
    for r in sheet(wb, '10_FACT_TXN'):
        tid = s(r.get('txn_id'))
        if not tid.startswith('T'): continue
        mo = int(num(r.get('month')) or 0); dy = int(num(r.get('day')) or 1)
        if not (1 <= mo <= 12): continue
        dy = min(max(dy, 1), 28 if mo == 2 else 30 if mo in (4, 6, 9, 11) else 31)
        d = f'{YEAR_CE}-{mo:02d}-{dy:02d}'
        proj = s(r.get('project_id')) or 'NA'
        if proj not in valid_projects: proj = 'NA'
        bldg = s(r.get('building_id'))
        if bldg not in valid_buildings:
            # แถวที่ไม่ระบุอาคาร: สร้างอาคารพักไว้โครงการละหนึ่ง เพื่อไม่ให้ยอดรายโครงการเพี้ยน
            bldg = f'BX{proj}'
            extra_buildings.setdefault(bldg, {
                'building_id': bldg, 'project_id': proj, 'building_name': 'ไม่ระบุอาคาร',
                'design_code': None, 'work_nature': 'สร้างใหม่', 'status': 'กำลังทำ',
                'area_sqm': None, 'floors': None, 'is_building': 'N', 'budget': None,
                'value_source': 'นำเข้าย้อนหลัง',
                'note': 'อาคารพักสำหรับรายการนำเข้าที่ไม่มีรหัสอาคาร — ต้องย้ายเข้าอาคารจริง',
            })
        code = s(r.get('cost_code_v8')) or s(r.get('cost_code')) or 'OTH'
        if code not in valid_costcodes: code = 'OTH'
        amount = num(r.get('amount')) or 0.0
        conf = s(r.get('ระดับความเชื่อถือ'))[:1] or 'D'
        key = f'{YEAR_CE % 100}{mo:02d}'
        seq[key] = seq.get(key, 0) + 1
        rid = f'REQ-{key}-{seq[key]:04d}'
        reqs.append({
            'request_id': rid, 'legacy_txn_id': tid, 'request_date': d,
            'requester_id': s(r.get('person_id')) or 'K',
            'project_id': proj, 'building_id': bldg,
            'vendor_id': s(r.get('vendor_id')) or None,
            'payee_name_raw': s(r.get('payee_name_raw')),
            'has_vat': 'ไม่มี', 'vat_mode': 'แยก VAT',
            'amount_before_vat': amount, 'vat_amount': 0.0, 'total_amount': amount,
            'wht_amount': 0.0, 'net_amount': amount,
            'status': 'จ่ายแล้ว', 'confidence': conf, 'value_source': 'นำเข้าย้อนหลัง',
            'note': s(r.get('building_name_raw')),
        })
        splits = [('ของ', num(r.get('cost_type_ของ')) or 0.0),
                  ('แรง', num(r.get('cost_type_แรง')) or 0.0),
                  ('เช่า', num(r.get('cost_type_เช่า')) or 0.0),
                  ('โสหุ้ย', num(r.get('cost_type_โสหุ้ย')) or 0.0)]
        used = round(sum(a for _, a in splits), 2)
        rest = round(amount - used, 2)
        for ct, amt in splits:
            if amt <= 0: continue
            lines.append({'request_id': rid, 'cost_code': code, 'cost_type': ct,
                          'description': s(r.get('building_name_raw')), 'qty': 1, 'unit': '',
                          'unit_price': amt, 'line_amount': amt, 'confidence': conf})
        if abs(rest) >= 0.01 or not any(a > 0 for _, a in splits):
            lines.append({'request_id': rid, 'cost_code': code, 'cost_type': 'ไม่ระบุ',
                          'description': s(r.get('building_name_raw')), 'qty': 1, 'unit': '',
                          'unit_price': rest, 'line_amount': rest, 'confidence': conf})
    return reqs, lines, list(extra_buildings.values())

def main():
    if not os.path.exists(SRC):
        sys.exit(f'ไม่พบไฟล์ต้นทาง: {SRC}')
    os.makedirs(OUT, exist_ok=True)
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    print(f'อ่าน {os.path.relpath(SRC, ROOT)}')

    users = build_users(wb);           write('users', users)
    projects = build_projects(wb);     write('projects', projects)
    designs = build_designs(wb);       write('designs', designs)
    buildings = build_buildings(wb)
    cost_codes = build_cost_codes(wb); write('cost_codes', cost_codes)
    write('vendors', build_vendors(wb))
    write('items', build_items(wb))
    write('item_prices', build_item_prices(wb))
    write('rates', build_rates(wb))
    write('building_pairs', build_pairs(wb))
    write('funding_in', build_funding(wb))
    reg, bqb = build_boq(wb); write('boq_register', reg); write('boq_buildings', bqb)

    reqs, lines, extra = build_txn(
        wb, {b['building_id'] for b in buildings}, {p['project_id'] for p in projects},
        {c['cost_code'] for c in cost_codes})
    write('buildings', buildings + extra)
    write('legacy_requests', reqs)
    write('legacy_request_lines', lines)

    total = round(sum(r['total_amount'] for r in reqs), 2)
    print(f'\nยอดรวมใบเบิกนำเข้า {total:,.2f} บาท จาก {len(reqs):,} ใบ / {len(lines):,} บรรทัด')

if __name__ == '__main__':
    main()
