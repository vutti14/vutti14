/**
 * ตัวสร้าง QR code — ไม่พึ่งไลบรารีภายนอก (byte mode · ECC ระดับ M · เวอร์ชัน 1–10)
 *
 * มีไว้สองงาน: รูป QR ของ URI `otpauth://` ตอนตั้ง 2FA (ยาวราว 110 ตัวอักษร)
 * และ QR ของลิงก์ผูกบัญชีไลน์ ทั้งคู่สั้นกว่าความจุของเวอร์ชัน 10 (213 ไบต์) มาก
 *
 * เขียนเองแทนการเพิ่ม dependency เพราะโค้ดชุดนี้ตายตัวตามมาตรฐาน ISO/IEC 18004
 * ไม่มีอะไรให้อัปเดตตามเวลา และเลี่ยงการเพิ่มไลบรารีที่ต้องคอยตามแพตช์
 */

// ---------------------------------------------------------------- GF(256)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // พหุนามตั้งต้นตามมาตรฐาน
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** พหุนามตัวสร้างของ Reed–Solomon ดีกรี `degree` (สัมประสิทธิ์เรียงจากดีกรีสูงไปต่ำ) */
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function ecBytes(data, degree) {
  const gen = generatorPoly(degree);
  const buf = new Array(data.length + degree).fill(0);
  for (let i = 0; i < data.length; i++) buf[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const factor = buf[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) buf[i + j] ^= mul(gen[j], factor);
  }
  return buf.slice(data.length);
}

// ---------------------------------------------------------------- ตารางตามมาตรฐาน (ECC ระดับ M)
/** ec = จำนวนไบต์แก้ความผิดพลาดต่อบล็อก · groups = [[จำนวนบล็อก, ไบต์ข้อมูลต่อบล็อก], ...] */
const EC_M = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: { ec: 22, groups: [[2, 38], [2, 39]] },
  9: { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] },
};

const ALIGN_CENTERS = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** บิตเศษท้ายที่ต้องเติมหลังโค้ดเวิร์ดทั้งหมด (เวอร์ชัน 1 = 0 · 2–6 = 7 · 7–13 = 0) */
const REMAINDER_BITS = (version) => (version >= 2 && version <= 6 ? 7 : 0);

const dataCodewords = (version) =>
  EC_M[version].groups.reduce((sum, [count, size]) => sum + count * size, 0);

const MAX_VERSION = 10;

/** ความจุ byte mode: หักหัวข้อมูล 4 บิต + ตัวนับความยาว (8 บิตถ้า < 10, 16 บิตถ้า ≥ 10) */
const byteCapacity = (version) =>
  Math.floor((dataCodewords(version) * 8 - 4 - (version < 10 ? 8 : 16)) / 8);

function pickVersion(byteLength) {
  for (let v = 1; v <= MAX_VERSION; v++) if (byteLength <= byteCapacity(v)) return v;
  throw new Error(`ข้อความยาวเกินความจุ QR ที่รองรับ (${byteCapacity(MAX_VERSION)} ไบต์)`);
}

// ---------------------------------------------------------------- เข้ารหัสข้อมูล
function encodeCodewords(bytes, version) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  const capacityBits = dataCodewords(version) * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0); // terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const words = [];
  for (let i = 0; i < bits.length; i += 8)
    words.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  const PADS = [0xec, 0x11];
  for (let i = 0; words.length < dataCodewords(version); i++) words.push(PADS[i % 2]);
  return words;
}

/** แบ่งเป็นบล็อก คำนวณ EC แล้วสานกลับตามลำดับที่มาตรฐานกำหนด */
function interleave(words, version) {
  const { ec, groups } = EC_M[version];
  const dataBlocks = [];
  let at = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      dataBlocks.push(words.slice(at, at + size));
      at += size;
    }
  }
  const ecBlocks = dataBlocks.map((b) => ecBytes(b, ec));

  const out = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i++)
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  for (let i = 0; i < ec; i++) for (const block of ecBlocks) out.push(block[i]);
  return out;
}

// ---------------------------------------------------------------- โครงตาราง
function blankMatrix(size) {
  return Array.from({ length: size }, () => new Uint8Array(size));
}

function drawFunctionPatterns(modules, fixed, version) {
  const size = modules.length;
  const set = (row, col, dark) => {
    modules[row][col] = dark ? 1 : 0;
    fixed[row][col] = 1;
  };

  // เส้นจังหวะ (timing) แถวและคอลัมน์ที่ 6
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // ตาเป้าสามมุม พร้อมแถบคั่นรอบนอก
  for (const [cr, cc] of [[3, 3], [3, size - 4], [size - 4, 3]]) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = cr + dr;
        const c = cc + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        set(r, c, dist !== 2 && dist !== 4);
      }
    }
  }

  // ตาเป้าย่อย (alignment) — ข้ามตัวที่ทับตาเป้าใหญ่
  const centers = ALIGN_CENTERS[version];
  for (const cr of centers) {
    for (const cc of centers) {
      const corner = (cr === centers[0] && cc === centers[0])
        || (cr === centers[0] && cc === centers.at(-1))
        || (cr === centers.at(-1) && cc === centers[0]);
      if (corner) continue;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++)
          set(cr + dr, cc + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }

  // จองพื้นที่บิตรูปแบบ (format) ไว้ก่อน เขียนค่าจริงหลังเลือกมาสก์
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) set(8, i, false);
    if (i !== 6) set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false);
    set(8, size - 8 + i, false);
  }
  set(size - 8, 8, true); // โมดูลดำถาวร

  if (version >= 7) drawVersionBits(modules, fixed, version);
}

function drawVersionBits(modules, fixed, version) {
  const size = modules.length;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const bit = (bits >>> i) & 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    modules[b][a] = bit; fixed[b][a] = 1;
    modules[a][b] = bit; fixed[a][b] = 1;
  }
}

function drawFormatBits(modules, fixed, mask) {
  const size = modules.length;
  const data = (0b00 << 3) | mask; // ECC ระดับ M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = (((data << 10) | rem) ^ 0x5412) & 0x7fff;
  const set = (row, col, bit) => { modules[row][col] = bit; fixed[row][col] = 1; };
  const bit = (i) => (bits >>> i) & 1;

  // สำเนาแรก: ไล่ลงคอลัมน์ 8 แล้ววกซ้ายตามแถว 8
  for (let i = 0; i <= 5; i++) set(i, 8, bit(i));
  set(7, 8, bit(6));
  set(8, 8, bit(7));
  set(8, 7, bit(8));
  for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i));

  // สำเนาที่สอง: ปลายขวาของแถว 8 แล้วต่อด้วยปลายล่างของคอลัมน์ 8
  for (let i = 0; i < 8; i++) set(8, size - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bit(i));
  set(size - 8, 8, 1);
}

function drawCodewords(modules, fixed, codewords) {
  const size = modules.length;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // ข้ามคอลัมน์เส้นจังหวะ
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (fixed[row][col] || i >= codewords.length * 8) continue;
        modules[row][col] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1;
        i++;
      }
    }
  }
}

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

function applyMask(modules, fixed, mask) {
  const size = modules.length;
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (!fixed[r][c] && MASKS[mask](r, c)) modules[r][c] ^= 1;
}

/** คะแนนโทษ 4 ข้อตามมาตรฐาน — ยิ่งน้อยยิ่งอ่านง่าย */
function penalty(modules) {
  const size = modules.length;
  let score = 0;

  const FINDER = [1, 0, 1, 1, 1, 0, 1];
  const runScan = (get) => {
    for (let a = 0; a < size; a++) {
      let runLength = 1;
      const line = [];
      for (let b = 0; b < size; b++) line.push(get(a, b));
      for (let b = 1; b <= size; b++) {
        if (b < size && line[b] === line[b - 1]) { runLength++; continue; }
        if (runLength >= 5) score += 3 + (runLength - 5);
        runLength = 1;
      }
      // ข้อ 3 — ลาย 1011101 ที่มีช่องว่าง 4 โมดูลประกบข้างใดข้างหนึ่ง
      for (let b = 0; b + 7 <= size; b++) {
        if (!FINDER.every((v, k) => line[b + k] === v)) continue;
        const before = line.slice(Math.max(0, b - 4), b);
        const after = line.slice(b + 7, b + 11);
        if ((before.length === 4 && before.every((v) => v === 0))
          || (after.length === 4 && after.every((v) => v === 0))) score += 40;
      }
    }
  };
  runScan((r, c) => modules[r][c]);
  runScan((c, r) => modules[r][c]);

  for (let r = 0; r + 1 < size; r++)
    for (let c = 0; c + 1 < size; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }

  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += modules[r][c];
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

// ---------------------------------------------------------------- API
/** @returns {Uint8Array[]} ตารางโมดูล — 1 = ดำ */
export function qrMatrix(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  const version = pickVersion(bytes.length);
  const codewords = interleave(encodeCodewords(bytes, version), version);
  for (let i = 0; i < Math.ceil(REMAINDER_BITS(version) / 8); i++) codewords.push(0);

  const size = version * 4 + 17;
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const modules = blankMatrix(size);
    const fixed = blankMatrix(size);
    drawFunctionPatterns(modules, fixed, version);
    drawCodewords(modules, fixed, codewords);
    applyMask(modules, fixed, mask);
    drawFormatBits(modules, fixed, mask);
    const score = penalty(modules);
    if (!best || score < best.score) best = { score, modules };
  }
  return best.modules;
}

/**
 * รูป QR เป็น SVG ก้อนเดียว ไม่มี asset ภายนอก — ฝังใน HTML หรือส่งเป็น image/svg+xml ได้เลย
 * `border` คือขอบเงียบ 4 โมดูลตามมาตรฐาน ถ้าไม่มีขอบนี้กล้องบางรุ่นจะอ่านไม่ออก
 */
export function qrSvg(text, { scale = 4, border = 4, dark = '#14213d', light = '#ffffff' } = {}) {
  const modules = qrMatrix(text);
  const size = modules.length;
  const dim = (size + border * 2) * scale;
  let path = '';
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (modules[r][c])
        path += `M${(c + border) * scale} ${(r + border) * scale}h${scale}v${scale}h-${scale}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" `
    + `width="${dim}" height="${dim}" shape-rendering="crispEdges" role="img">`
    + `<rect width="${dim}" height="${dim}" fill="${light}"/>`
    + `<path d="${path}" fill="${dark}"/></svg>`;
}
