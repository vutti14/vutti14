/**
 * ตรวจตัวสร้าง QR ด้วยการอ่านกลับ — ถอดรหัสตารางที่สร้างขึ้นแล้วเทียบกับข้อความต้นทาง
 * ตัวอ่านในไฟล์นี้เขียนแยกจากตัวสร้าง (ไม่ import ค่าคงที่ร่วมกัน) เพื่อให้จับความผิดพลาดได้จริง
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvg } from '../server/qrcode.js';

// ---------------------------------------------------------------- ตัวอ่าน
const EC_M = {
  1: [[1, 16]], 2: [[1, 28]], 3: [[1, 44]], 4: [[2, 32]], 5: [[2, 43]],
  6: [[4, 27]], 7: [[4, 31]], 8: [[2, 38], [2, 39]], 9: [[3, 36], [2, 37]], 10: [[4, 43], [1, 44]],
};
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** โมดูลที่เป็นลายประจำตำแหน่ง — ไม่ใช่ข้อมูล */
function functionMap(size, version) {
  const f = Array.from({ length: size }, () => new Uint8Array(size));
  const set = (r, c) => { if (r >= 0 && r < size && c >= 0 && c < size) f[r][c] = 1; };
  for (let i = 0; i < size; i++) { set(6, i); set(i, 6); }
  for (const [cr, cc] of [[3, 3], [3, size - 4], [size - 4, 3]])
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) set(cr + dr, cc + dc);
  for (let i = 0; i <= 8; i++) { set(8, i); set(i, 8); }
  for (let i = 0; i < 8; i++) { set(size - 1 - i, 8); set(8, size - 8 + i); }
  const centers = ALIGN[version];
  for (const cr of centers) for (const cc of centers) {
    const corner = (cr === centers[0] && cc === centers[0])
      || (cr === centers[0] && cc === centers.at(-1))
      || (cr === centers.at(-1) && cc === centers[0]);
    if (corner) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(cr + dr, cc + dc);
  }
  if (version >= 7)
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(b, a); set(a, b);
    }
  return f;
}

/** อ่านบิตรูปแบบสำเนาแรกกลับมาเป็นระดับ ECC และหมายเลขมาสก์ */
function readFormat(m) {
  const b = [];
  for (let i = 0; i <= 5; i++) b[i] = m[i][8];
  b[6] = m[7][8]; b[7] = m[8][8]; b[8] = m[8][7];
  for (let i = 9; i < 15; i++) b[i] = m[8][14 - i];
  let bits = 0;
  for (let i = 0; i < 15; i++) bits |= b[i] << i;
  const data = (bits ^ 0x5412) >>> 10;
  return { ecc: (data >> 3) & 3, mask: data & 7 };
}

function decode(modules) {
  const size = modules.length;
  const version = (size - 17) / 4;
  const { ecc, mask } = readFormat(modules);
  assert.equal(ecc, 0b00, 'ต้องเป็น ECC ระดับ M');
  const fixed = functionMap(size, version);

  const stream = [];
  let cur = 0;
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const row = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (fixed[row][col]) continue;
        cur = (cur << 1) | (modules[row][col] ^ (MASKS[mask](row, col) ? 1 : 0));
        if (++n === 8) { stream.push(cur); cur = 0; n = 0; }
      }
  }

  // แยกโค้ดเวิร์ดที่สานไว้กลับเป็นบล็อกข้อมูลตามลำดับเดิม
  const sizes = [];
  for (const [count, len] of EC_M[version]) for (let i = 0; i < count; i++) sizes.push(len);
  const blocks = sizes.map((len) => new Array(len));
  let at = 0;
  for (let i = 0; i < Math.max(...sizes); i++)
    for (let b = 0; b < blocks.length; b++)
      if (i < sizes[b]) blocks[b][i] = stream[at++];
  const words = blocks.flat();

  const bits = words.flatMap((w) => [7, 6, 5, 4, 3, 2, 1, 0].map((k) => (w >> k) & 1));
  const take = (count) => bits.splice(0, count).reduce((acc, b) => (acc << 1) | b, 0);
  assert.equal(take(4), 0b0100, 'ต้องเป็น byte mode');
  const length = take(version < 10 ? 8 : 16);
  return Buffer.from(Array.from({ length }, () => take(8))).toString('utf8');
}

// ---------------------------------------------------------------- ชุดทดสอบ
const SAMPLES = [
  'x',
  'hi',
  'otpauth://totp/RABBiZBuild%3Arabbizgroup001%40gmail.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=RABBiZBuild&period=30&digits=6',
  'https://line.me/R/ti/p/@rabbizbuild',
  'สวัสดี ทดสอบภาษาไทย',
  'https://erp.example.co.th/#/requests/REQ-2609-0042',
];

test('QR ที่สร้างขึ้นอ่านกลับได้ตรงต้นฉบับทุกความยาว', () => {
  for (const text of SAMPLES) assert.equal(decode(qrMatrix(text)), text, text.slice(0, 40));
});

test('QR วางลายประจำตำแหน่งครบสามมุมและเส้นจังหวะถูกต้อง', () => {
  const m = qrMatrix('otpauth://totp/test?secret=ABCDEFGHIJKLMNOP');
  const size = m.length;
  for (const [cr, cc] of [[3, 3], [3, size - 4], [size - 4, 3]]) {
    assert.equal(m[cr][cc], 1, 'ใจกลางตาเป้าต้องทึบ');
    assert.equal(m[cr - 1][cc - 1], 1, 'ก้อนกลาง 3×3 ต้องทึบทั้งก้อน');
    assert.equal(m[cr - 2][cc - 2], 0, 'วงเว้นรอบก้อนกลางต้องโปร่ง');
    assert.equal(m[cr - 3][cc - 3], 1, 'กรอบนอกตาเป้าต้องทึบ');
  }
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0 ? 1 : 0);
    assert.equal(m[i][6], i % 2 === 0 ? 1 : 0);
  }
  assert.equal(m[size - 8][8], 1, 'โมดูลดำถาวรต้องอยู่ครบ');
});

test('QR เลือกเวอร์ชันเล็กที่สุดที่พอ และปฏิเสธข้อความที่ยาวเกิน', () => {
  assert.equal(qrMatrix('x').length, 21, 'ข้อความสั้นต้องได้เวอร์ชัน 1');
  assert.ok(qrMatrix('x'.repeat(150)).length <= 57, 'ต้องไม่ข้ามไปเวอร์ชันใหญ่เกินจำเป็น');
  assert.throws(() => qrMatrix('x'.repeat(400)), /ยาวเกินความจุ/);
});

test('SVG ของ QR ฝังในหน้าได้เลย ไม่มีไฟล์ภายนอกและมีขอบเงียบ', () => {
  const svg = qrSvg('https://erp.example.co.th');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg, /<image|href=|<script/, 'ต้องไม่อ้างอิงไฟล์ภายนอก');
  const size = qrMatrix('https://erp.example.co.th').length;
  assert.match(svg, new RegExp(`viewBox="0 0 ${(size + 8) * 4} ${(size + 8) * 4}"`));
});
