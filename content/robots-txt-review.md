# robots.txt — ตอนนี้บล็อกบอทที่ไม่ควรบล็อกอยู่ 6 ตัว

ไฟล์ปัจจุบัน: `https://www.xn--q3ca6cja3bzj.com/robots.txt`
บล็อกบอทไว้ 23 ตัว ส่วนใหญ่ถูกต้อง แต่มี 6 ตัวที่กำลังทำร้ายธุรกิจอยู่

---

## บล็อกไว้แล้วเสียประโยชน์ — ควรปลด

| บอท | บล็อกแล้วเกิดอะไร | ควรทำ |
|---|---|---|
| **Applebot** | หายจาก **Siri, Spotlight, และ Safari suggestions** ทั้งหมด คนไทยกลุ่มที่ซื้อหินอ่อนหลักหมื่นหลักแสนใช้ iPhone เป็นหลัก คนถาม Siri ว่า "ร้านหินอ่อนใกล้ฉัน" แล้วไม่เจอคุณ | 🔴 **ปลดทันที** |
| **CCBot** (Common Crawl) | Common Crawl เป็นฐานข้อมูลเว็บสาธารณะที่ AI และเครื่องมือค้นหารุ่นใหม่จำนวนมากใช้ บล็อกไว้ = หายจากระบบพวกนั้นทั้งหมด | 🔴 **ปลด** |
| **Meta-ExternalAgent** | บล็อก Meta AI ซึ่งอยู่ใน Facebook, Instagram และ WhatsApp — ช่องทางที่ลูกค้าไทยใช้จริง และคุณมีเพจ Facebook อยู่แล้ว | 🟠 ปลด |
| **Amazonbot** | บล็อก Alexa และระบบค้นหาของ Amazon | 🟡 ปลดก็ได้ ไม่ปลดก็ไม่เสียหายมากในไทย |
| **ia_archiver** (Internet Archive) | ไม่มี Wayback Machine เก็บเว็บคุณไว้เลย **แปลว่าถ้าเว็บพังหรือโดนแฮก คุณไม่มีสำเนาหน้าเก่าให้ดูย้อนหลัง** และเวลามีข้อพิพาทเรื่องราคาหรือข้อความบนเว็บ คุณไม่มีหลักฐานว่าเคยเขียนอะไรไว้ | 🟠 ปลด |
| **Yandex** | บล็อกเสิร์ชเอนจินรัสเซียทั้งตัว ถ้าไม่ได้มีปัญหาโดนสแปมจริง ๆ ไม่มีเหตุผลต้องบล็อก | 🟡 ทบทวน |

## บล็อกไว้ถูกแล้ว — เก็บไว้

`AhrefsBot` `SemrushBot` `MJ12bot` `BLEXBot` `dotbot` `spbot` `SEOkicks-Robot`
`MegaIndex` `WBSearchBot` `SputnikBot` `EasouSpider` `007ac9` `SMTBot` `proximic`
`Scrapy` `Chilkat` `SeznamBot`

พวกนี้คือบอทเก็บข้อมูล SEO ของคู่แข่งกับบอทขูดข้อมูล บล็อกไว้ถูกต้องแล้ว
มันกินแบนด์วิดท์และช่วยให้คู่แข่งส่องกลยุทธ์คุณได้

---

## ไฟล์ที่แนะนำ

```
User-agent: *
Allow: /
Disallow: /api/
Disallow: /cart
Disallow: /checkout
Disallow: /informpayment
Disallow: /search

Sitemap: https://www.xn--q3ca6cja3bzj.com/sitemap.xml

# --- บอทเก็บข้อมูล SEO ของคู่แข่งและบอทขูดข้อมูล ---
User-agent: AhrefsBot
Disallow: /
User-agent: SemrushBot
Disallow: /
User-agent: MJ12bot
Disallow: /
User-agent: BLEXBot
Disallow: /
User-agent: dotbot
Disallow: /
User-agent: spbot
Disallow: /
User-agent: SEOkicks-Robot
Disallow: /
User-agent: MegaIndex
Disallow: /
User-agent: WBSearchBot
Disallow: /
User-agent: SputnikBot
Disallow: /
User-agent: EasouSpider
Disallow: /
User-agent: 007ac9
Disallow: /
User-agent: SMTBot
Disallow: /
User-agent: proximic
Disallow: /
User-agent: Scrapy
Disallow: /
User-agent: Chilkat
Disallow: /
```

**สิ่งที่เปลี่ยน:**
- ปลด `Applebot` `CCBot` `Meta-ExternalAgent` `Amazonbot` `ia_archiver` `Yandex` `SeznamBot`
- เพิ่ม `Disallow` ให้หน้าที่ไม่ควรถูก index: ตะกร้า, ชำระเงิน, แจ้งชำระเงิน, ผลค้นหาภายใน
  หน้าพวกนี้ไม่มีคุณค่าในผลการค้นหาและกินงบ crawl

> **ข้อควรระวัง:** LnwShop อาจไม่ให้แก้ `robots.txt` โดยตรง ต้องถามฝ่ายซัพพอร์ต
> ถ้าแก้ไม่ได้ อย่างน้อยขอให้เขาปลด `Applebot` ให้ — ตัวเดียวนี้เสียหายชัดที่สุด

---

## หมายเหตุเรื่องบอท AI

บอท AI ตัวหลักอย่าง `GPTBot` `ClaudeBot` `PerplexityBot` `Google-Extended`
**ไม่ได้ถูกบล็อกอยู่แล้ว** เพราะไม่มีชื่อในไฟล์ จึงตกอยู่ใต้ `User-agent: *` ที่ `Allow: /`

นี่ถูกต้องแล้วสำหรับธุรกิจแบบนี้ — คนถาม AI ว่า "ซื้อหินอ่อนที่ไหนดี" มากขึ้นเรื่อย ๆ
และคุณอยากให้ตอบชื่อคุณ ไม่ใช่ชื่อคู่แข่ง การบล็อกบอท AI มีเหตุผลสำหรับสำนักข่าว
ที่ขายคอนเทนต์ แต่ไม่มีเหตุผลสำหรับร้านที่อยากให้คนหาเจอ
