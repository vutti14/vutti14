-- RABBiZBuild Mini ERP — โครงสร้างฐานข้อมูล (SQLite)
-- อ้างอิงสเปก docs/SPEC_RABBiZBuild_v1.md §5

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================ ตารางอ้างอิง

CREATE TABLE IF NOT EXISTS users (
  user_id        TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  full_name      TEXT DEFAULT '',
  title          TEXT DEFAULT '',
  role           TEXT NOT NULL CHECK (role IN ('CEO','COO','FINANCE','ACCOUNT','PM','SERVICE','VIEWER')),
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  phone          TEXT DEFAULT '',
  line_user_id   TEXT,
  require_2fa    INTEGER NOT NULL DEFAULT 0,
  totp_secret    TEXT,
  totp_enabled   INTEGER NOT NULL DEFAULT 0,
  password_changed INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน','ระงับ')),
  note           TEXT DEFAULT '',
  last_project_id  TEXT,
  last_building_id TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  project_id      TEXT PRIMARY KEY,
  project_name    TEXT NOT NULL,
  nature          TEXT DEFAULT '',
  is_real_project INTEGER NOT NULL DEFAULT 1,
  owner_company   TEXT DEFAULT '',
  budget          REAL,
  pm_user_id      TEXT REFERENCES users(user_id),
  note            TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน','ปิด'))
);

-- PM/SERVICE เห็นเฉพาะโครงการที่ตัวเองรับผิดชอบ (สเปก §3.3)
CREATE TABLE IF NOT EXISTS user_projects (
  user_id    TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS designs (
  design_code      TEXT PRIMARY KEY,
  design_name      TEXT NOT NULL,
  floors           INTEGER,
  std_area_sqm     REAL,
  structure        TEXT DEFAULT '',
  ref_cost_per_sqm REAL,
  status           TEXT NOT NULL DEFAULT 'รอยืนยัน' CHECK (status IN ('ยืนยันแล้ว','รอยืนยัน','เลิกใช้')),
  note             TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS buildings (
  building_id   TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(project_id),
  building_name TEXT NOT NULL,
  design_code   TEXT REFERENCES designs(design_code),
  work_nature   TEXT NOT NULL DEFAULT 'สร้างใหม่' CHECK (work_nature IN ('สร้างใหม่','ต่อเติม','ซ่อมบำรุง')),
  status        TEXT NOT NULL DEFAULT 'กำลังทำ' CHECK (status IN ('กำลังทำ','ปิดจบ')),
  area_sqm      REAL,
  floors        INTEGER,
  is_building   TEXT NOT NULL DEFAULT 'Y' CHECK (is_building IN ('Y','N')),
  budget        REAL,
  value_source  TEXT NOT NULL DEFAULT 'ข้อเท็จจริง',
  note          TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_buildings_project ON buildings(project_id);

-- แกน 1 — หมวดงาน
CREATE TABLE IF NOT EXISTS cost_codes (
  cost_code         TEXT PRIMARY KEY,
  cost_name         TEXT NOT NULL,
  work_group        TEXT DEFAULT '',
  group_order       INTEGER NOT NULL DEFAULT 9,
  status            TEXT NOT NULL DEFAULT 'ใช้ต่อ' CHECK (status IN ('ใช้ต่อ','เลิกใช้','ยุบรวม')),
  merge_into        TEXT,
  default_cost_type TEXT,
  note              TEXT DEFAULT ''
);

-- แกน 2 — ประเภทต้นทุน (คงที่ 4 ค่า + "ไม่ระบุ" สำหรับข้อมูลนำเข้าเท่านั้น)
CREATE TABLE IF NOT EXISTS cost_types (
  cost_type   TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  selectable  INTEGER NOT NULL DEFAULT 1,
  wht_base    INTEGER NOT NULL DEFAULT 0   -- 1 = เข้าฐานคำนวณหัก ณ ที่จ่าย
);

CREATE TABLE IF NOT EXISTS vendors (
  vendor_id      TEXT PRIMARY KEY,
  vendor_name    TEXT NOT NULL,
  vendor_type    TEXT DEFAULT '',
  category       TEXT DEFAULT '',
  phone          TEXT DEFAULT '',
  entity_type    TEXT NOT NULL DEFAULT 'นิติบุคคล' CHECK (entity_type IN ('นิติบุคคล','บุคคลธรรมดา')),
  tax_id         TEXT DEFAULT '',
  bank_account   TEXT DEFAULT '',
  payment_terms  TEXT DEFAULT '',
  vat_registered INTEGER NOT NULL DEFAULT 0,
  wht_percent    REAL NOT NULL DEFAULT 0 CHECK (wht_percent IN (0,1,2,3,5)),
  doc_status     TEXT NOT NULL DEFAULT 'รอตรวจเอกสาร' CHECK (doc_status IN ('รอตรวจเอกสาร','ยืนยันแล้ว','ระงับ')),
  created_by     TEXT REFERENCES users(user_id),
  verified_by    TEXT REFERENCES users(user_id),
  verified_at    TEXT,
  status         TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน','ระงับ')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  item_id       TEXT PRIMARY KEY,
  category      TEXT DEFAULT '',
  item_name     TEXT NOT NULL,
  unit          TEXT DEFAULT '',
  ref_price_min REAL,
  ref_price_max REAL,
  vendor_count  INTEGER DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ใช้งาน'
);

CREATE TABLE IF NOT EXISTS item_prices (
  price_id    TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(item_id),
  vendor_id   TEXT REFERENCES vendors(vendor_id),
  unit_price  REAL NOT NULL,
  unit        TEXT DEFAULT '',
  source_note TEXT DEFAULT '',
  is_cheapest INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_item_prices_item ON item_prices(item_id);

CREATE TABLE IF NOT EXISTS rates (
  rate_id       TEXT PRIMARY KEY,
  cost_type     TEXT NOT NULL,
  rate_name     TEXT NOT NULL,
  unit          TEXT DEFAULT '',
  rate_satoshi  REAL,
  rate_goldy    REAL,
  std_rate      REAL,
  method        TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'รอยืนยัน'
);

CREATE TABLE IF NOT EXISTS building_pairs (
  pair_id            TEXT PRIMARY KEY,
  label_a            TEXT DEFAULT '',
  label_b            TEXT DEFAULT '',
  building_a         TEXT REFERENCES buildings(building_id),
  building_b         TEXT REFERENCES buildings(building_id),
  project_id         TEXT,
  same_amount_count  INTEGER DEFAULT 0,
  status             TEXT DEFAULT '',
  note               TEXT DEFAULT ''
);

-- ============================================================ ตารางรายการ

CREATE TABLE IF NOT EXISTS requests (
  request_id        TEXT PRIMARY KEY,
  legacy_txn_id     TEXT,
  request_date      TEXT NOT NULL,
  requester_id      TEXT NOT NULL REFERENCES users(user_id),
  project_id        TEXT NOT NULL REFERENCES projects(project_id),
  building_id       TEXT NOT NULL REFERENCES buildings(building_id),
  vendor_id         TEXT REFERENCES vendors(vendor_id),
  payee_name_raw    TEXT DEFAULT '',
  has_vat           TEXT NOT NULL DEFAULT 'ไม่มี' CHECK (has_vat IN ('มี','ไม่มี')),
  vat_mode          TEXT NOT NULL DEFAULT 'แยก VAT' CHECK (vat_mode IN ('แยก VAT','รวม VAT แล้ว')),
  amount_before_vat REAL NOT NULL DEFAULT 0,
  vat_amount        REAL NOT NULL DEFAULT 0,
  total_amount      REAL NOT NULL DEFAULT 0,
  wht_amount        REAL NOT NULL DEFAULT 0,
  net_amount        REAL NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'ร่าง'
                      CHECK (status IN ('ร่าง','รออนุมัติ','อนุมัติแล้ว','จ่ายแล้ว','ปิดรายการ','ไม่อนุมัติ','ยกเลิก')),
  legacy_code       TEXT,             -- รหัสอ้างอิงเดิม 10 หลัก (สร้างอัตโนมัติ)
  submitted_at      TEXT,
  approver_id       TEXT REFERENCES users(user_id),
  approved_at       TEXT,
  approval_seconds  INTEGER,
  reject_reason     TEXT,
  cancel_reason     TEXT,
  goods_received    INTEGER NOT NULL DEFAULT 0,
  goods_received_at TEXT,
  goods_received_by TEXT REFERENCES users(user_id),
  closed_at         TEXT,
  is_petty_cash     INTEGER NOT NULL DEFAULT 0,
  flags             TEXT NOT NULL DEFAULT '[]',   -- JSON array ของธงเตือน
  confidence        TEXT,                          -- A/B/C/D (เฉพาะข้อมูลนำเข้า)
  value_source      TEXT NOT NULL DEFAULT 'ข้อเท็จจริง'
                      CHECK (value_source IN ('ข้อเท็จจริง','อนุมาน','นำเข้าย้อนหลัง')),
  note              TEXT DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_req_status  ON requests(status);
CREATE INDEX IF NOT EXISTS idx_req_date    ON requests(request_date);
CREATE INDEX IF NOT EXISTS idx_req_bld     ON requests(building_id);
CREATE INDEX IF NOT EXISTS idx_req_proj    ON requests(project_id);
CREATE INDEX IF NOT EXISTS idx_req_vendor  ON requests(vendor_id);
CREATE INDEX IF NOT EXISTS idx_req_source  ON requests(value_source);

CREATE TABLE IF NOT EXISTS request_lines (
  line_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   TEXT NOT NULL REFERENCES requests(request_id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL DEFAULT 1,
  cost_code    TEXT NOT NULL REFERENCES cost_codes(cost_code),
  cost_type    TEXT NOT NULL REFERENCES cost_types(cost_type),
  item_id      TEXT REFERENCES items(item_id),
  description  TEXT DEFAULT '',
  qty          REAL NOT NULL DEFAULT 1,
  unit         TEXT DEFAULT '',
  unit_price   REAL NOT NULL DEFAULT 0,
  line_amount  REAL NOT NULL DEFAULT 0,
  ref_price    REAL,
  price_diff_pct REAL,
  confidence   TEXT
);
CREATE INDEX IF NOT EXISTS idx_lines_req  ON request_lines(request_id);
CREATE INDEX IF NOT EXISTS idx_lines_code ON request_lines(cost_code);

CREATE TABLE IF NOT EXISTS payments (
  payment_id   TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL UNIQUE REFERENCES requests(request_id),
  payment_date TEXT NOT NULL,
  bank_account TEXT DEFAULT '',
  net_amount   REAL NOT NULL,
  slip_file_id INTEGER REFERENCES attachments(file_id),
  transfer_ref TEXT DEFAULT '',
  paid_by      TEXT NOT NULL REFERENCES users(user_id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  document_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   TEXT NOT NULL REFERENCES requests(request_id) ON DELETE CASCADE,
  doc_type     TEXT NOT NULL,
  received     INTEGER NOT NULL DEFAULT 0,
  received_date TEXT,
  doc_date     TEXT,               -- วันที่บนเอกสาร (ใช้กับภาษี)
  tax_period   TEXT,               -- YYYY-MM คำนวณจาก doc_date
  doc_no       TEXT DEFAULT '',
  amount       REAL,               -- ใช้กับหัก ณ ที่จ่าย
  file_id      INTEGER REFERENCES attachments(file_id),
  recorded_by  TEXT REFERENCES users(user_id),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (request_id, doc_type)
);
CREATE INDEX IF NOT EXISTS idx_doc_req ON documents(request_id);

CREATE TABLE IF NOT EXISTS reversals (
  reversal_id   TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES requests(request_id),
  reversal_type TEXT NOT NULL CHECK (reversal_type IN ('จ่ายเกิน','จ่ายซ้ำ','ของคืน','ของไม่ครบ')),
  amount        REAL NOT NULL,     -- ติดลบเสมอ
  reason        TEXT NOT NULL,
  destination   TEXT NOT NULL CHECK (destination IN ('ได้เงินคืน','หักกลบบิลหน้า')),
  received_date TEXT,
  file_id       INTEGER REFERENCES attachments(file_id),
  created_by    TEXT NOT NULL REFERENCES users(user_id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendor_credits (
  credit_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id    TEXT NOT NULL REFERENCES vendors(vendor_id),
  reversal_id  TEXT REFERENCES reversals(reversal_id),
  amount       REAL NOT NULL,
  used_amount  REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'คงเหลือ' CHECK (status IN ('คงเหลือ','ใช้หมดแล้ว','ยกเลิก')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credit_vendor ON vendor_credits(vendor_id, status);

CREATE TABLE IF NOT EXISTS credit_usage (
  usage_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_id  INTEGER NOT NULL REFERENCES vendor_credits(credit_id),
  request_id TEXT NOT NULL REFERENCES requests(request_id),
  amount     REAL NOT NULL,
  used_by    TEXT NOT NULL REFERENCES users(user_id),
  used_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS funding_in (
  funding_id         TEXT PRIMARY KEY,
  funding_date       TEXT NOT NULL,
  amount             REAL NOT NULL,
  company            TEXT DEFAULT '',
  source             TEXT DEFAULT '',
  accounting_status  TEXT NOT NULL DEFAULT 'เงินกู้ยืมกรรมการ'
                       CHECK (accounting_status IN ('เงินกู้ยืมกรรมการ','เพิ่มทุน','เงินทดรอง')),
  period_label       TEXT DEFAULT '',
  recorded_by        TEXT REFERENCES users(user_id),
  value_source       TEXT NOT NULL DEFAULT 'ข้อเท็จจริง',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS petty_cash_accounts (
  pc_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(project_id),
  holder_id   TEXT NOT NULL REFERENCES users(user_id),
  ceiling     REAL NOT NULL DEFAULT 10000,
  balance     REAL NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'ใช้งาน',
  UNIQUE (project_id, holder_id)
);

CREATE TABLE IF NOT EXISTS petty_cash_lines (
  pc_line_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  pc_id       INTEGER NOT NULL REFERENCES petty_cash_accounts(pc_id),
  entry_date  TEXT NOT NULL,
  entry_type  TEXT NOT NULL CHECK (entry_type IN ('เติมเงิน','ใช้จ่าย','เคลียร์บิล')),
  amount      REAL NOT NULL,
  request_id  TEXT REFERENCES requests(request_id),
  description TEXT DEFAULT '',
  recorded_by TEXT NOT NULL REFERENCES users(user_id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS boq_register (
  boq_id        TEXT PRIMARY KEY,
  title         TEXT DEFAULT '',
  version       TEXT DEFAULT '',
  received_date TEXT DEFAULT '',
  source_file   TEXT DEFAULT '',
  boq_value     REAL,
  author        TEXT DEFAULT '',
  status        TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS boq_buildings (
  boq_id      TEXT NOT NULL REFERENCES boq_register(boq_id),
  building_id TEXT NOT NULL REFERENCES buildings(building_id),
  boq_budget  REAL,
  status      TEXT DEFAULT '',
  note        TEXT DEFAULT '',
  PRIMARY KEY (boq_id, building_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  file_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_name TEXT NOT NULL,
  orig_name   TEXT NOT NULL,
  mime_type   TEXT DEFAULT '',
  size_bytes  INTEGER DEFAULT 0,
  request_id  TEXT REFERENCES requests(request_id) ON DELETE CASCADE,
  purpose     TEXT DEFAULT 'หลักฐานใบเบิก',
  uploaded_by TEXT REFERENCES users(user_id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_att_req ON attachments(request_id);

CREATE TABLE IF NOT EXISTS audit_log (
  log_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id  TEXT NOT NULL,
  field_name TEXT DEFAULT '',
  old_value  TEXT,
  new_value  TEXT,
  action     TEXT NOT NULL DEFAULT 'แก้ไข',
  user_id    TEXT REFERENCES users(user_id),
  reason     TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_rec ON audit_log(table_name, record_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
