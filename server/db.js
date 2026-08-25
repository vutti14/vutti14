import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DATA_DIR = process.env.RABBIZ_DATA_DIR || path.join(ROOT, 'data');
export const UPLOAD_DIR = process.env.RABBIZ_UPLOAD_DIR || path.join(ROOT, 'uploads');
const DB_FILE = process.env.RABBIZ_DB || path.join(DATA_DIR, 'rabbizbuild.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** สร้างตารางทั้งหมดถ้ายังไม่มี (idempotent) */
export function migrate() {
  db.exec(fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'));
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ' +
             'ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

/** บันทึก audit_log — เรียกทุกครั้งที่แก้ข้อมูลหลังส่งขออนุมัติ (สเปก §4) */
export function audit({ table, recordId, field = '', oldValue = null, newValue = null,
                        action = 'แก้ไข', userId = null, reason = '' }) {
  db.prepare(`INSERT INTO audit_log
    (table_name, record_id, field_name, old_value, new_value, action, user_id, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(table, String(recordId), field,
         oldValue === null ? null : String(oldValue),
         newValue === null ? null : String(newValue),
         action, userId, reason);
}

/** เลขที่เอกสารรูปแบบ PREFIX-YYMM-#### รีเซ็ตทุกเดือน (สเปก §5.2) */
export function nextDocNo(prefix, table, column, dateISO) {
  const d = dateISO ? new Date(dateISO + 'T00:00:00') : new Date();
  const key = `${String(d.getFullYear() % 100).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const like = `${prefix}-${key}-%`;
  const row = db.prepare(
    `SELECT ${column} AS id FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`).get(like);
  const n = row ? parseInt(String(row.id).slice(-4), 10) + 1 : 1;
  return `${prefix}-${key}-${String(n).padStart(4, '0')}`;
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
