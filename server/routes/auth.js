import { Router } from 'express';
import { db, audit } from '../db.js';
import {
  checkPassword, hashPassword, createSession, destroySession, requireAuth,
  newTotpSecret, verifyTotp, totpUri, logLogin,
} from '../auth.js';

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
  res.json({ secret, uri: totpUri(req.user.username, secret),
             hint: 'เพิ่มบัญชีในแอป Authenticator ด้วยการสแกน URI หรือพิมพ์รหัสลับด้วยมือ แล้วยืนยันด้วยรหัส 6 หลัก' });
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

r.post('/line/link', requireAuth, (req, res) => {
  const id = String(req.body?.line_user_id || '').trim();
  if (!id) return res.status(400).json({ error: 'ต้องระบุ LINE user id' });
  db.prepare('UPDATE users SET line_user_id = ? WHERE user_id = ?').run(id, req.user.user_id);
  audit({ table: 'users', recordId: req.user.user_id, field: 'line_user_id',
          newValue: id, action: 'ผูกบัญชีไลน์', userId: req.user.user_id });
  res.json({ ok: true });
});

export default r;
