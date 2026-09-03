/**
 * Webhook ของไลน์ — รับปุ่มอนุมัติ/ไม่อนุมัติ และการผูกบัญชีครั้งแรก (สเปก §8 S2)
 *
 * ทุก request ต้องผ่านการตรวจลายเซ็น x-line-signature ก่อนเสมอ
 * และทุกคำสั่งต้องมาจากบัญชีไลน์ที่ผูกกับผู้ใช้ในระบบแล้วเท่านั้น
 * — กันกรณีส่งต่อการ์ดให้คนอื่นแล้วกดอนุมัติแทนกัน
 */
import { Router } from 'express';
import { db, audit } from '../db.js';
import { can } from '../auth.js';
import { verifySignature, reply, text, isConfigured } from '../line.js';
import { approveOne, rejectOne, fullRequest, getReq } from './requests.js';

const r = Router();

const HELP = [
  'คำสั่งที่ใช้ได้ในห้องนี้',
  '· พิมพ์รหัสผูกบัญชี 6 ตัวจากหน้า “ตั้งค่า → ผูกบัญชีไลน์” เพื่อผูกบัญชีครั้งแรก',
  '· กดปุ่มในการ์ดขออนุมัติเพื่ออนุมัติ',
  '· ไม่อนุมัติ REQ-2609-0042: เหตุผล',
].join('\n');

const userByLineId = (lineUserId) => (lineUserId
  ? db.prepare(`SELECT * FROM users WHERE line_user_id = ? AND status = 'ใช้งาน'`).get(lineUserId)
  : null);

// ---------------------------------------------------------------- ผูกบัญชีด้วยรหัส 6 ตัว
const LINK_CODE_RE = /^[A-Z0-9]{6}$/;

function redeemLinkCode(code, lineUserId) {
  const row = db.prepare(`SELECT * FROM line_link_codes WHERE code = ?
                          AND used_at IS NULL AND expires_at > datetime('now')`).get(code);
  if (!row) return { ok: false, message: 'รหัสนี้ใช้ไม่ได้แล้ว — ขอรหัสใหม่จากหน้าตั้งค่าในเว็บ' };

  const taken = db.prepare('SELECT user_id FROM users WHERE line_user_id = ? AND user_id <> ?')
    .get(lineUserId, row.user_id);
  if (taken) return { ok: false, message: 'บัญชีไลน์นี้ผูกกับผู้ใช้คนอื่นอยู่แล้ว' };

  // unique index กันไว้อีกชั้น เผื่อสองคนไถ่รหัสด้วย id เดียวกันพร้อมกัน
  try {
    db.transaction(() => {
      db.prepare('UPDATE users SET line_user_id = ? WHERE user_id = ?').run(lineUserId, row.user_id);
      db.prepare("UPDATE line_link_codes SET used_at = datetime('now'), used_by = ? WHERE code = ?")
        .run(lineUserId, code);
    })();
  } catch (err) {
    if (!/UNIQUE constraint/i.test(err.message)) throw err;
    return { ok: false, message: 'บัญชีไลน์นี้ผูกกับผู้ใช้คนอื่นอยู่แล้ว' };
  }
  audit({
    table: 'users', recordId: row.user_id, field: 'line_user_id', newValue: lineUserId,
    action: 'ผูกบัญชีไลน์', userId: row.user_id, reason: 'ผูกด้วยรหัสจากหน้าตั้งค่า',
  });
  const u = db.prepare('SELECT display_name FROM users WHERE user_id = ?').get(row.user_id);
  return { ok: true, message: `ผูกบัญชีเรียบร้อย — ${u.display_name}\nต่อจากนี้จะได้รับการ์ดขออนุมัติในห้องนี้` };
}

// ---------------------------------------------------------------- ตัวจัดการเหตุการณ์
function decide(user, requestId, action, reason) {
  if (!can(user, action === 'approve' ? 'request.approve' : 'request.reject'))
    return 'บทบาทของคุณไม่มีสิทธิ์ทำรายการนี้';
  if (!getReq(requestId)) return `ไม่พบใบเบิก ${requestId}`;

  // ใบที่ติดธงต้องเปิดดูในระบบก่อน — ปุ่มในไลน์ยืนยันธงแทนคนไม่ได้ (สเปก §8 S2)
  const out = action === 'approve'
    ? approveOne(user, requestId, { acknowledgeFlags: false })
    : rejectOne(user, requestId, reason);
  if (!out.ok) {
    return out.requires_ack
      ? `${requestId} ติดธงเตือน ${out.flags.length} ข้อ — ต้องเปิดดูในระบบแล้วกดยืนยันทีละใบ`
      : `${requestId} ทำรายการไม่ได้: ${out.error}`;
  }
  const full = fullRequest(requestId);
  const amount = Number(full.total_amount || 0)
    .toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return action === 'approve'
    ? `อนุมัติแล้ว ${requestId} · ${amount} บาท`
    : `ไม่อนุมัติ ${requestId} · ${amount} บาท\nเหตุผล: ${reason}`;
}

/** "ไม่อนุมัติ REQ-2609-0042: ของไม่ตรงสเปก" — รูปแบบที่ปุ่มในการ์ดเติมให้อัตโนมัติ */
const REJECT_RE = /^ไม่อนุมัติ\s+(\S+?)\s*[:：]\s*(.+)$/s;

function handleEvent(ev) {
  const lineUserId = ev?.source?.userId;
  const user = userByLineId(lineUserId);

  if (ev.type === 'follow')
    return [text(`ยินดีต้อนรับสู่ RABBiZBuild\n${HELP}`)];

  if (ev.type === 'message' && ev.message?.type === 'text') {
    const body = String(ev.message.text || '').trim();

    const code = body.toUpperCase().replace(/[\s-]/g, '');
    if (LINK_CODE_RE.test(code) && !REJECT_RE.test(body)) {
      if (!lineUserId) return [text('อ่านบัญชีไลน์ของคุณไม่ได้ ลองใหม่อีกครั้ง')];
      return [text(redeemLinkCode(code, lineUserId).message)];
    }

    if (!user) return [text(`ยังไม่ได้ผูกบัญชี\n${HELP}`)];

    const m = REJECT_RE.exec(body);
    if (m) return [text(decide(user, m[1].trim(), 'reject', m[2].trim()))];

    return [text(HELP)];
  }

  if (ev.type === 'postback') {
    if (!user) return [text(`ยังไม่ได้ผูกบัญชี\n${HELP}`)];
    const p = new URLSearchParams(String(ev.postback?.data || ''));
    const requestId = p.get('request_id');
    const action = p.get('action');
    if (!requestId || !['approve', 'reject'].includes(action)) return [text(HELP)];
    if (action === 'reject')
      return [text(`พิมพ์เหตุผลต่อท้ายข้อความนี้แล้วส่ง:\nไม่อนุมัติ ${requestId}: `)];
    return [text(decide(user, requestId, 'approve'))];
  }

  return [];
}

// ---------------------------------------------------------------- เส้นทาง
/**
 * body ของเส้นทางนี้ต้องเป็น Buffer ดิบ (ตั้งไว้ใน index.js) เพราะลายเซ็นคำนวณจากไบต์ที่ส่งมาจริง
 * ถ้า parse เป็น JSON ก่อนแล้ว stringify ใหม่ ลายเซ็นจะไม่ตรงเมื่อช่องว่างต่างกัน
 */
r.post('/webhook', (req, res) => {
  if (!isConfigured()) return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า LINE channel' });
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!verifySignature(raw, req.headers['x-line-signature']))
    return res.status(401).json({ error: 'ลายเซ็นไม่ถูกต้อง' });

  let payload;
  try { payload = JSON.parse(raw.toString('utf8') || '{}'); }
  catch { return res.status(400).json({ error: 'อ่าน body ไม่ได้' }); }

  // ตอบ 200 ทันทีตามที่ไลน์กำหนด แล้วค่อยทำงานต่อ — ถ้าช้าไลน์จะยิงซ้ำ
  res.json({ ok: true });

  for (const ev of payload.events || []) {
    let messages = [];
    try { messages = handleEvent(ev); }
    catch (err) {
      console.error('จัดการเหตุการณ์จากไลน์ไม่สำเร็จ:', err.message);
      messages = [text('ระบบขัดข้อง ลองใหม่อีกครั้ง หรือเปิดในเว็บ')];
    }
    if (messages.length && ev.replyToken) void reply(ev.replyToken, messages);
  }
});

export default r;
export { handleEvent, redeemLinkCode };
