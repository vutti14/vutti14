import crypto from 'node:crypto';
import { Router } from 'express';
import { db, audit } from '../db.js';
import {
  checkPassword, hashPassword, createSession, destroySession, requireAuth,
  newTotpSecret, verifyTotp, totpUri, logLogin,
} from '../auth.js';
import { qrSvg } from '../qrcode.js';
import { isConfigured as lineConfigured } from '../line.js';

const r = Router();
const publicUser = (u) => ({
  user_id: u.user_id, display_name: u.display_name, title: u.title, role: u.role,
  username: u.username, require_2fa: !!u.require_2fa, totp_enabled: !!u.totp_enabled,
  password_changed: !!u.password_changed,
  last_project_id: u.last_project_id, last_building_id: u.last_building_id,
});

const setCookie = (res, token) =>
  res.cookie
    ? res.cookie('rabbiz_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 14 * 864e5 })
    : res.setHeader('Set-Cookie', `rabbiz_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 86400}`);

r.post('/login', (req, res) => {
  const { username, password, totp } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(String(username || '').trim());
  if (!u || !checkPassword(password, u.password_hash)) {
    if (u) logLogin(u.user_id, false);
    return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  }
  if (u.status !== 'ใช้งาน')
    return res.status(403).json({ error: 'บัญชีนี้ถูกระงับ — ติดต่อ CEO เพื่อเปิดใช้งาน' });

  // บังคับ 2FA สำหรับ CEO / COO / FINANCE (สเปก §3.2)
  if (u.require_2fa && u.totp_enabled) {
    if (!totp) return res.status(401).json({ error: 'กรุณากรอกรหัส 2FA', code: 'TOTP_REQUIRED' });
    if (!verifyTotp(u.totp_secret, totp))
      return res.status(401).json({ error: 'รหัส 2FA ไม่ถูกต้อง', code: 'TOTP_REQUIRED' });
  }

  const token = createSession(u.user_id);
  setCookie(res, token);
  logLogin(u.user_id, true);
  res.json({
    user: publicUser(u), token,
    must_change_password: !u.password_changed,
    must_setup_2fa: !!u.require_2fa && !u.totp_enabled,
  });
});

r.post('/logout', (req, res) => {
  if (req.token) destroySession(req.token);
  res.setHeader('Set-Cookie', 'rabbiz_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

r.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  res.json({
    user: publicUser(req.user),
    must_change_password: !req.user.password_changed,
    must_setup_2fa: !!req.user.require_2fa && !req.user.totp_enabled,
  });
});

r.post('/change-password', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  const { current_password, new_password } = req.body || {};
  if (!checkPassword(current_password, req.user.password_hash))
    return res.status(400).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  const pw = String(new_password || '');
  if (pw.length < 8) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' });
  if (pw === req.user.phone) return res.status(400).json({ error: 'ห้ามใช้เบอร์โทรเป็นรหัสผ่านถาวร' });
  db.prepare('UPDATE users SET password_hash = ?, password_changed = 1 WHERE user_id = ?')
    .run(hashPassword(pw), req.user.user_id);
  audit({ table: 'users', recordId: req.user.user_id, field: 'password_hash',
          action: 'เปลี่ยนรหัสผ่าน', userId: req.user.user_id });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- 2FA
r.post('/2fa/setup', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  const secret = newTotpSecret();
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE user_id = ?')
    .run(secret, req.user.user_id);
  const uri = totpUri(req.user.username, secret);
  res.json({
    secret, uri, qr_svg: qrSvg(uri),
    hint: 'สแกน QR ด้วยแอป Authenticator — หรือพิมพ์รหัสลับด้วยมือถ้าสแกนไม่ได้ แล้วยืนยันด้วยรหัส 6 หลัก',
  });
});

/** รูป QR ของรหัสลับที่กำลังตั้งค่าอยู่ — เผื่อกรณีเปิดหน้าใหม่หรือสั่งพิมพ์ */
r.get('/2fa/qr.svg', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  const row = db.prepare('SELECT totp_secret FROM users WHERE user_id = ?').get(req.user.user_id);
  if (!row?.totp_secret) return res.status(404).json({ error: 'ยังไม่ได้เริ่มตั้งค่า 2FA' });
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(qrSvg(totpUri(req.user.username, row.totp_secret), { scale: 6 }));
});

r.post('/2fa/enable', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  const row = db.prepare('SELECT totp_secret FROM users WHERE user_id = ?').get(req.user.user_id);
  if (!row?.totp_secret) return res.status(400).json({ error: 'ยังไม่ได้เริ่มตั้งค่า 2FA' });
  if (!verifyTotp(row.totp_secret, req.body?.code))
    return res.status(400).json({ error: 'รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง' });
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE user_id = ?').run(req.user.user_id);
  audit({ table: 'users', recordId: req.user.user_id, action: 'เปิดใช้ 2FA', userId: req.user.user_id });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- ไลน์ (สเปก §8 S2)
/**
 * ผูกบัญชีได้ทางเดียว: ขอรหัสที่นี่ แล้วพิมพ์ส่งเข้า OA
 *
 * เคยมี POST /line/link ที่ให้กรอก LINE user id เองตรง ๆ — ถอดออกแล้ว
 * เพราะไม่ได้พิสูจน์ว่าคนกรอกเป็นเจ้าของบัญชีไลน์นั้นจริง ตั้งแต่ line_user_id
 * กลายเป็นกุญแจตัดสินว่าใครสั่งอนุมัติได้ ใครก็ตามที่ล็อกอินได้จะกรอก id ของ COO
 * ทับไว้ก่อน แล้วทำให้ COO ผูกบัญชีตัวเองไม่ได้ตลอดกาล (กดอนุมัติจากไลน์ไม่ได้)
 * รหัสที่ส่งผ่าน OA พิสูจน์ความเป็นเจ้าของให้เอง เพราะ id มาจากฝั่งไลน์ในคำขอที่เซ็นแล้ว
 */
const LINK_CODE_MINUTES = 15;
const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ตัด I O 0 1 ที่อ่านสับสน

/**
 * ขอรหัสผูกบัญชี — ผู้ใช้พิมพ์รหัสนี้ส่งเข้าห้องแชทของ OA
 * ที่ต้องผูกก่อนเพราะสเปก §8 กันการส่งต่อการ์ดแล้วให้คนอื่นกดอนุมัติแทน
 */
r.post('/line/link-code', requireAuth, (req, res) => {
  db.prepare("DELETE FROM line_link_codes WHERE expires_at < datetime('now') OR user_id = ?")
    .run(req.user.user_id);
  const bytes = crypto.randomBytes(6);
  const code = [...bytes].map((b) => LINK_ALPHABET[b % LINK_ALPHABET.length]).join('');
  const expires = new Date(Date.now() + LINK_CODE_MINUTES * 60000).toISOString();
  db.prepare('INSERT INTO line_link_codes (code, user_id, expires_at) VALUES (?,?,?)')
    .run(code, req.user.user_id, expires);
  const oaUrl = String(process.env.LINE_OA_URL || '').trim();
  res.json({
    code,
    expires_at: expires,
    valid_minutes: LINK_CODE_MINUTES,
    oa_url: oaUrl || null,
    oa_qr_svg: oaUrl ? qrSvg(oaUrl, { scale: 6 }) : null,
    configured: lineConfigured(),
  });
});

r.get('/line/status', requireAuth, (req, res) => {
  res.json({
    configured: lineConfigured(),
    linked: !!req.user.line_user_id,
    oa_url: String(process.env.LINE_OA_URL || '').trim() || null,
  });
});

r.delete('/line/link', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET line_user_id = NULL WHERE user_id = ?').run(req.user.user_id);
  audit({ table: 'users', recordId: req.user.user_id, field: 'line_user_id',
          oldValue: req.user.line_user_id, action: 'ยกเลิกการผูกบัญชีไลน์', userId: req.user.user_id });
  res.json({ ok: true });
});

export default r;
