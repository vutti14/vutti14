import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, audit } from './db.js';

const SESSION_DAYS = 14;

// ---------------------------------------------------------------- รหัสผ่าน
export const hashPassword = (plain) => bcrypt.hashSync(String(plain), 10);
export const checkPassword = (plain, hash) => bcrypt.compareSync(String(plain), String(hash || ''));

// ---------------------------------------------------------------- 2FA (TOTP RFC 6238)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function b32decode(secret) {
  let bits = '';
  for (const ch of secret.toUpperCase().replace(/=+$/, '')) {
    const v = B32.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** ยอมรับโค้ดของช่วงเวลาก่อนหน้า/ถัดไปหนึ่งช่วง เผื่อนาฬิกาคลาดเคลื่อน */
export function verifyTotp(secret, code) {
  if (!secret || !/^\d{6}$/.test(String(code || '').trim())) return false;
  const counter = Math.floor(Date.now() / 30000);
  const given = String(code).trim();
  for (let d = -1; d <= 1; d++) {
    if (crypto.timingSafeEqual(Buffer.from(totpCode(secret, counter + d)), Buffer.from(given))) return true;
  }
  return false;
}

export const totpUri = (username, secret) =>
  `otpauth://totp/${encodeURIComponent('RABBiZBuild:' + username)}?secret=${secret}&issuer=RABBiZBuild&period=30&digits=6`;

// ---------------------------------------------------------------- เซสชัน
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  return token;
}

export const destroySession = (token) => db.prepare('DELETE FROM sessions WHERE token = ?').run(token);

export function userFromToken(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.user_id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now') AND u.status = 'ใช้งาน'`).get(token);
  return row || null;
}

// ---------------------------------------------------------------- สิทธิ์
/**
 * ความสามารถต่อบทบาท (สเปก §3.1 และ §3.3)
 * หมายเหตุ: สเปกไม่ให้ FINANCE/ACCOUNT สร้างใบเบิก แม้ข้อมูลย้อนหลังจะพบว่าตั้ม (S)
 * เคยเบิกเอง 17 รายการ — ถ้าต้องการเปิดสิทธิ์ ให้เพิ่ม 'request.create' ในบทบาท FINANCE
 */
const CAPS = {
  CEO: ['*'],
  COO: ['request.create', 'request.read.all', 'request.approve', 'request.reject',
        'request.cancel', 'request.edit.meta', 'vendor.create', 'vendor.verify',
        'goods.confirm', 'report.read', 'reversal.create'],
  FINANCE: ['request.read.all', 'payment.create', 'payment.read', 'report.read',
            'reversal.create', 'funding.read', 'pettycash.manage'],
  ACCOUNT: ['request.read.all', 'document.manage', 'request.close', 'report.read',
            'vendor.verify', 'reversal.create', 'funding.read'],
  PM: ['request.create', 'request.read.own', 'request.edit.own', 'request.submit',
       'request.withdraw', 'vendor.create', 'goods.confirm', 'report.read.own'],
  SERVICE: ['request.create', 'request.read.own', 'request.edit.own', 'request.submit',
            'request.withdraw', 'vendor.create', 'goods.confirm', 'report.read.own'],
  VIEWER: ['request.read.all', 'report.read'],
};

export function can(user, cap) {
  if (!user) return false;
  const list = CAPS[user.role] || [];
  return list.includes('*') || list.includes(cap);
}

/** เห็นทุกโครงการหรือเฉพาะที่รับผิดชอบ */
export const seesAllProjects = (user) =>
  ['CEO', 'COO', 'FINANCE', 'ACCOUNT', 'VIEWER'].includes(user?.role);

/**
 * สิทธิ์ถาวรจาก 21_DIM_USER_ACCESS (กฎ 3%) + สิทธิ์ชั่วคราวที่ COO อนุมัติและยังไม่หมดอายุ
 * @returns {string[]|null} null = เห็นทุกโครงการ
 */
export function allowedProjectIds(user) {
  if (seesAllProjects(user)) return null;
  const rows = db.prepare(`
    SELECT project_id FROM user_projects WHERE user_id = ?
    UNION
    SELECT project_id FROM project_access_requests
     WHERE user_id = ? AND status = 'อนุมัติแล้ว'
       AND (expires_at IS NULL OR expires_at >= date('now'))`).all(user.user_id, user.user_id);
  return rows.map((r) => r.project_id);
}

// ---------------------------------------------------------------- middleware
export function attachUser(req, _res, next) {
  const token = req.cookies?.rabbiz_token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  req.token = token;
  req.user = userFromToken(token);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'ต้องเข้าสู่ระบบก่อน' });
  if (!req.user.password_changed && !req.path.startsWith('/auth/'))
    return res.status(403).json({ error: 'ต้องเปลี่ยนรหัสผ่านครั้งแรกก่อนใช้งาน', code: 'MUST_CHANGE_PASSWORD' });
  next();
}

export const requireCap = (cap) => (req, res, next) =>
  can(req.user, cap) ? next() : res.status(403).json({ error: 'บทบาทของคุณไม่มีสิทธิ์ทำรายการนี้' });

export function logLogin(userId, ok) {
  audit({ table: 'users', recordId: userId, action: ok ? 'เข้าสู่ระบบ' : 'เข้าสู่ระบบไม่สำเร็จ', userId });
}
