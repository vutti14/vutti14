/**
 * แจ้งเตือนออกไลน์ตามเหตุการณ์ในวงจรใบเบิก (สเปก §8 S2)
 *
 * ทุกฟังก์ชันในไฟล์นี้ "เงียบ" โดยตั้งใจ — ถ้าไลน์มีปัญหาต้องไม่ทำให้การทำงานในเว็บล้มเหลว
 * ข้อความที่ส่งไม่ออกจะค้างอยู่ใน `line_outbox` ให้ตามเก็บทีหลังได้
 */
import { db } from './db.js';
import { can } from './auth.js';
import { pushToUser, approvalCard, decisionMessage } from './line.js';

const linkedUsers = () =>
  db.prepare(`SELECT * FROM users WHERE status = 'ใช้งาน'
              AND line_user_id IS NOT NULL AND line_user_id <> ''`).all();

const getUser = (id) => (id ? db.prepare('SELECT * FROM users WHERE user_id = ?').get(id) : null);

/** ผู้มีสิทธิ์อนุมัติที่ผูกไลน์แล้ว — ไม่ส่งกลับให้ผู้ขอเอง */
export function approversOnLine(excludeUserId = null) {
  return linkedUsers().filter((u) => can(u, 'request.approve') && u.user_id !== excludeUserId);
}

/** ใบถูกส่งขออนุมัติ → ส่งการ์ดให้ผู้อนุมัติทุกคนที่ผูกไลน์ไว้ */
export function notifySubmitted(request, flags = []) {
  if (!request) return 0;
  let sent = 0;
  for (const approver of approversOnLine(request.requester_id)) {
    try {
      if (pushToUser({
        kind: 'ขออนุมัติ', user: approver, requestId: request.request_id,
        messages: [approvalCard(request, { flags })],
      })) sent++;
    } catch (err) {
      console.error('ส่งการ์ดขออนุมัติเข้าไลน์ไม่สำเร็จ:', err.message);
    }
  }
  return sent;
}

/** ผลการอนุมัติ/ไม่อนุมัติ → แจ้งกลับผู้ขอ */
export function notifyDecision(request, decision, actorUserId, reason = '') {
  if (!request) return 0;
  const requester = getUser(request.requester_id);
  if (!requester?.line_user_id || requester.user_id === actorUserId) return 0;
  const actor = getUser(actorUserId);
  try {
    return pushToUser({
      kind: decision === 'อนุมัติแล้ว' ? 'แจ้งผลอนุมัติ' : 'แจ้งผลไม่อนุมัติ',
      user: requester, requestId: request.request_id,
      messages: [decisionMessage(request, decision, actor?.display_name || 'ระบบ', reason)],
    }) ? 1 : 0;
  } catch (err) {
    console.error('แจ้งผลอนุมัติเข้าไลน์ไม่สำเร็จ:', err.message);
    return 0;
  }
}
