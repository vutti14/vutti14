/**
 * ไลน์ — ส่งการ์ดขออนุมัติและรับคำสั่งกลับ (สเปก §8 S2)
 *
 * ตั้งค่าผ่านตัวแปรสภาพแวดล้อม (ไม่เก็บใน repo):
 *   LINE_CHANNEL_ACCESS_TOKEN  ของ Messaging API channel
 *   LINE_CHANNEL_SECRET        ใช้ตรวจลายเซ็น webhook
 *   APP_BASE_URL               URL ที่เปิดจากมือถือได้ เช่น https://erp.example.co.th
 *   LINE_API_BASE              (ไม่บังคับ) ชี้ไปที่อื่นได้ตอนทดสอบ
 *
 * ถ้ายังไม่มี channel ระบบยังทำงานปกติทุกอย่าง — ข้อความจะถูกบันทึกลง `line_outbox`
 * สถานะ "ยังไม่ได้ตั้งค่า" เพื่อให้เห็นว่าใครควรได้รับอะไร และกดส่งย้อนหลังได้เมื่อผูก channel แล้ว
 */
import crypto from 'node:crypto';
import { db } from './db.js';

export const accessToken = () => String(process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
export const channelSecret = () => String(process.env.LINE_CHANNEL_SECRET || '').trim();
export const apiBase = () => String(process.env.LINE_API_BASE || 'https://api.line.me').replace(/\/+$/, '');
export const appBaseUrl = () => String(process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const isConfigured = () => !!(accessToken() && channelSecret());

// ---------------------------------------------------------------- ลายเซ็น webhook
/** ตรวจ x-line-signature — HMAC-SHA256 ของ body ดิบ เข้ารหัส base64 */
export function verifySignature(rawBody, signature) {
  const secret = channelSecret();
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'))
    .digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- คิวข้อความ
const QUEUED = 'รอส่ง';
const SENT = 'ส่งแล้ว';
const FAILED = 'ส่งไม่สำเร็จ';
const UNCONFIGURED = 'ยังไม่ได้ตั้งค่า';
export const OUTBOX_STATUS = { QUEUED, SENT, FAILED, UNCONFIGURED };

function insertOutbox({ kind, userId = null, lineUserId = null, requestId = null, messages }) {
  const status = isConfigured() ? QUEUED : UNCONFIGURED;
  const info = db.prepare(`INSERT INTO line_outbox (kind, user_id, line_user_id, request_id, payload, status)
    VALUES (?,?,?,?,?,?)`)
    .run(kind, userId, lineUserId, requestId, JSON.stringify(messages), status);
  return info.lastInsertRowid;
}

async function callLine(path, body) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LINE ${path} ตอบกลับ ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

/**
 * เข้าคิวแล้วพยายามส่งทันที — ไม่โยนข้อผิดพลาดออกไปให้ผู้ใช้เห็น
 * การส่งไลน์ไม่สำเร็จต้องไม่ทำให้การอนุมัติในเว็บล้มเหลว (สเปก §8: เว็บคือช่องทางหลัก)
 */
export function pushToUser({ kind, user, requestId = null, messages }) {
  if (!user?.line_user_id) return null;
  const id = insertOutbox({
    kind, userId: user.user_id, lineUserId: user.line_user_id, requestId, messages,
  });
  if (isConfigured()) void deliver(id);
  return id;
}

/** ส่งข้อความในคิวหนึ่งรายการ (ใช้ทั้งตอนส่งอัตโนมัติและตอน CEO กดส่งย้อนหลัง) */
export async function deliver(outboxId) {
  const row = db.prepare('SELECT * FROM line_outbox WHERE outbox_id = ?').get(outboxId);
  if (!row) return { ok: false, error: 'ไม่พบข้อความในคิว' };
  if (row.status === SENT) return { ok: true, already: true };
  if (!isConfigured()) {
    db.prepare('UPDATE line_outbox SET status = ?, error = ? WHERE outbox_id = ?')
      .run(UNCONFIGURED, 'ยังไม่ได้ตั้งค่า LINE channel', outboxId);
    return { ok: false, error: 'ยังไม่ได้ตั้งค่า LINE channel' };
  }
  try {
    await callLine('/v2/bot/message/push', { to: row.line_user_id, messages: JSON.parse(row.payload) });
    db.prepare("UPDATE line_outbox SET status = ?, error = '', sent_at = datetime('now') WHERE outbox_id = ?")
      .run(SENT, outboxId);
    return { ok: true };
  } catch (err) {
    db.prepare('UPDATE line_outbox SET status = ?, error = ? WHERE outbox_id = ?')
      .run(FAILED, String(err.message).slice(0, 500), outboxId);
    return { ok: false, error: err.message };
  }
}

/** ส่งทุกใบที่ยังไม่ถึงมือ — เรียกหลังผูก channel เสร็จ */
export async function flushOutbox({ limit = 50 } = {}) {
  const rows = db.prepare(
    `SELECT outbox_id FROM line_outbox WHERE status IN (?,?,?) ORDER BY outbox_id LIMIT ?`)
    .all(QUEUED, FAILED, UNCONFIGURED, limit);
  const out = { sent: 0, failed: 0 };
  for (const { outbox_id: id } of rows) {
    const r = await deliver(id);
    if (r.ok) out.sent++; else out.failed++;
  }
  return out;
}

/** ตอบกลับข้อความที่ผู้ใช้พิมพ์เข้ามา — ใช้ reply token ซึ่งใช้ได้ครั้งเดียวและมีอายุสั้น */
export async function reply(replyToken, messages) {
  if (!isConfigured() || !replyToken) return false;
  try {
    await callLine('/v2/bot/message/reply', { replyToken, messages });
    return true;
  } catch (err) {
    console.error('ตอบกลับไลน์ไม่สำเร็จ:', err.message);
    return false;
  }
}

// ---------------------------------------------------------------- รูปแบบข้อความ
export const text = (t) => ({ type: 'text', text: String(t).slice(0, 4900) });

const INK = '#14213d';
const TAPE = '#e8b33a';
const RUST = '#a63d2f';
const MUTED = '#6b7280';

const baht = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const row = (label, value, color = INK) => ({
  type: 'box', layout: 'baseline', spacing: 'sm',
  contents: [
    { type: 'text', text: label, size: 'sm', color: MUTED, flex: 2 },
    { type: 'text', text: String(value || '—'), size: 'sm', color, flex: 5, wrap: true },
  ],
});

/**
 * การ์ดขออนุมัติ — ตามต้นแบบ: ใบที่ไม่มีธงกดอนุมัติได้จากไลน์เลย
 * ใบที่มีธงไม่มีปุ่มอนุมัติ ต้องเปิดดูในระบบก่อน (สเปก §8 S2)
 */
export function approvalCard(request, { flags = [] } = {}) {
  const flagged = flags.length > 0;
  const url = `${appBaseUrl()}/#/requests/${encodeURIComponent(request.request_id)}`;
  const lineSummary = (request.lines || []).slice(0, 3)
    .map((l) => `${l.description || l.cost_code} ${baht(l.line_amount)}`).join('\n')
    || request.note || '—';

  const footer = flagged
    ? [{
      type: 'button', style: 'primary', color: RUST, height: 'sm',
      action: { type: 'uri', label: 'เปิดดูในระบบ', uri: url },
    }]
    : [
      {
        type: 'button', style: 'primary', color: TAPE, height: 'sm',
        action: { type: 'postback', label: 'อนุมัติ', displayText: `อนุมัติ ${request.request_id}`,
                  data: `action=approve&request_id=${encodeURIComponent(request.request_id)}` },
      },
      {
        type: 'button', style: 'secondary', height: 'sm',
        action: {
          type: 'postback', label: 'ไม่อนุมัติ',
          data: `action=reject&request_id=${encodeURIComponent(request.request_id)}`,
          inputOption: 'openKeyboard',
          fillInText: `ไม่อนุมัติ ${request.request_id}: `,
        },
      },
      { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'ดูรายละเอียด', uri: url } },
    ];

  return {
    type: 'flex',
    altText: `ขออนุมัติ ${request.request_id} · ${baht(request.total_amount)} บาท`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: INK, paddingAll: '12px',
        contents: [
          { type: 'text', text: 'รออนุมัติ', size: 'xs', color: '#ffffffcc' },
          { type: 'text', text: request.request_id, size: 'lg', weight: 'bold', color: '#ffffff' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          {
            type: 'text', text: `${baht(request.total_amount)} บาท`,
            size: 'xxl', weight: 'bold', color: INK,
          },
          { type: 'separator', margin: 'md' },
          row('ผู้ขอ', request.requester_name),
          row('โครงการ', request.project_name),
          row('อาคาร', request.building_name),
          row('ผู้รับเงิน', request.vendor_name || request.payee_name_raw),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: lineSummary, size: 'sm', wrap: true, color: INK },
          ...(flagged
            ? [
              { type: 'separator', margin: 'md' },
              {
                type: 'text', color: RUST, size: 'sm', weight: 'bold', wrap: true,
                text: `ใบนี้ติดธงเตือน ${flags.length} ข้อ — ต้องเปิดดูและกดทีละใบ`,
              },
              ...flags.map((f) => ({
                type: 'text', size: 'xs', color: RUST, wrap: true,
                text: `${f.code} ${f.label}${f.detail ? ` — ${f.detail}` : ''}`,
              })),
            ]
            : []),
        ],
      },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer },
    },
  };
}

/** แจ้งผลกลับให้ผู้ขอ */
export function decisionMessage(request, decision, actorName, reason = '') {
  const url = `${appBaseUrl()}/#/requests/${encodeURIComponent(request.request_id)}`;
  const head = decision === 'อนุมัติแล้ว'
    ? `อนุมัติแล้ว ${request.request_id}`
    : `ไม่อนุมัติ ${request.request_id}`;
  return text([
    head,
    `${baht(request.total_amount)} บาท · ${request.vendor_name || request.payee_name_raw || '—'}`,
    `โดย ${actorName}`,
    reason ? `เหตุผล: ${reason}` : '',
    url,
  ].filter(Boolean).join('\n'));
}
