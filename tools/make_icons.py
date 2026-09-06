#!/usr/bin/env python3
"""สร้างไอคอน PNG แบบไม่พึ่งไลบรารีภายนอก (ใช้แค่ zlib/struct)
ดีไซน์: พื้นแดงจีน + กรอบคำพูดสีทอง สื่อถึง 'การพูด' ไม่ใช่ 'การเขียน'"""
import zlib, struct, math, os

def write_png(path, w, h, rows):
    raw = b''.join(b'\x00' + bytes(v for px in row for v in px) for row in rows)
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)

def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

def rounded_rect_cov(x, y, x0, y0, x1, y1, r):
    """คืนค่า 1 ถ้าจุดอยู่ในสี่เหลี่ยมมุมมน"""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return 0
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return 1 if (x - cx) ** 2 + (y - cy) ** 2 <= r * r else 0

def render(size, pad_ratio=0.0):
    S = 3  # supersampling
    W = size
    top = (0xB0, 0x28, 0x28)
    bot = (0x4A, 0x0C, 0x0C)
    gold = (0xE8, 0xC1, 0x6A)
    ink = (0x3A, 0x08, 0x08)

    # กรอบคำพูด
    m = W * (0.19 + pad_ratio)
    bx0, by0 = m, W * (0.21 + pad_ratio * 0.6)
    bx1, by1 = W - m, W * (0.66 - pad_ratio * 0.2)
    br = (by1 - by0) * 0.30
    # หางกรอบคำพูด (สามเหลี่ยม)
    tail = [(W * 0.36, by1 - 2), (W * 0.46, by1 - 2), (W * 0.34, W * 0.80)]

    def in_tri(px, py, t):
        (ax, ay), (bx, by), (cx, cy) = t
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if d == 0: return False
        a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
        b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
        c = 1 - a - b
        return a >= 0 and b >= 0 and c >= 0

    # เส้นข้อความ 3 เส้นในกรอบ
    lines = []
    lh = (by1 - by0) * 0.13
    gap = (by1 - by0) * 0.235
    ly = by0 + (by1 - by0) * 0.26
    for k, wf in enumerate((0.70, 0.86, 0.50)):
        lx0 = bx0 + (bx1 - bx0) * 0.14
        lx1 = lx0 + (bx1 - bx0) * 0.72 * wf
        lines.append((lx0, ly, lx1, ly + lh))
        ly += gap

    rows = []
    for py in range(W):
        row = []
        for px in range(W):
            acc = [0, 0, 0, 0]
            for sy in range(S):
                for sx in range(S):
                    x = px + (sx + 0.5) / S
                    y = py + (sy + 0.5) / S
                    # พื้นหลังไล่เฉด (เต็มสี่เหลี่ยม เพื่อให้ระบบ crop เป็นวงกลมได้)
                    t = y / W
                    col = lerp(top, bot, t ** 0.85)
                    a = 255
                    # กรอบคำพูด
                    if rounded_rect_cov(x, y, bx0, by0, bx1, by1, br) or in_tri(x, y, tail):
                        col = gold
                    # เส้นข้อความ
                    for (lx0, ly0, lx1, ly1) in lines:
                        if rounded_rect_cov(x, y, lx0, ly0, lx1, ly1, (ly1 - ly0) / 2):
                            col = ink
                            break
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += a
            n = S * S
            row.append((acc[0] // n, acc[1] // n, acc[2] // n, acc[3] // n))
        rows.append(row)
    return rows

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(here, 'icons')
os.makedirs(out, exist_ok=True)
for size, name, pad in ((192, 'icon-192.png', 0.0), (512, 'icon-512.png', 0.0),
                        (180, 'apple-touch-icon.png', 0.0), (512, 'icon-maskable.png', 0.06)):
    write_png(os.path.join(out, name), size, size, render(size, pad))
    print('wrote', name)
