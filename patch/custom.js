/* ============================================================
   หินอ่อน.com — JS เสริม (LnwShop)
   วางที่: ระบบหลังร้าน → แต่งร้าน → โค้ดเสริมท้ายหน้า (before </body>)
   ครอบด้วย <script> ... </script> ถ้าช่องนั้นรับ HTML
   ------------------------------------------------------------
   สิ่งที่ไฟล์นี้ทำ (เรียงตามผลกระทบ):
   [A] หยุดโหลดรูปที่มองไม่เห็น  -> ประหยัด ~4.5 MB ต่อการเข้าหน้าแรก 1 ครั้ง
   [B] บอกเบราว์เซอร์ว่ารูปไหนสำคัญ (LCP) -> หน้าแสดงผลเร็วขึ้น
   [C] เติม alt ให้รูปที่ไม่มี alt        -> ช่วย SEO + คนตาบอด
   [D] ใส่ H1 สำรองในหน้าแรก             -> ใช้ชั่วคราวเท่านั้น (ดูหมายเหตุ)

   ปลอดภัย: ไม่แตะ DOM ของระบบตะกร้า/ชำระเงิน ไม่เขียนทับฟังก์ชันของ LnwShop
   ============================================================ */
(function () {
  'use strict';

  var LCP_BUDGET = 2; // จำนวนรูปแรกที่ยอมให้โหลดทันที (รูปที่เห็นตอนเปิดหน้า)

  /* ---------- [A]+[B]+[C] จัดการรูปภาพ ---------- */
  function tuneImages() {
    var imgs = Array.prototype.slice.call(document.images);
    var eager = 0;

    imgs.forEach(function (img) {
      if (img.dataset.hnDone) return;
      img.dataset.hnDone = '1';

      var r = img.getBoundingClientRect();
      var vh = window.innerHeight || 800;

      // รูปที่ render ขนาด 0x0 = โหลดมาแล้วไม่ได้แสดงเลย (พบ 3 รูป รวม ~4.5 MB)
      var invisible = r.width === 0 && r.height === 0;
      // รูปที่อยู่ต่ำกว่าหน้าจอแรก
      var offscreen = r.top > vh;

      if (invisible || offscreen) {
        if (!img.loading || img.loading === 'auto') img.loading = 'lazy';
        img.decoding = 'async';
      } else if (eager < LCP_BUDGET) {
        // รูปที่เห็นทันที = ผู้ต้องสงสัย LCP ให้โหลดก่อนเพื่อน
        img.loading = 'eager';
        img.decoding = 'sync';
        img.setAttribute('fetchpriority', 'high');
        eager++;
      } else {
        img.loading = 'lazy';
        img.decoding = 'async';
      }

      // [C] เติม alt จากบริบทรอบ ๆ ถ้าไม่มี (พบ 9 จาก 25 รูปในหน้าแรกไม่มี alt)
      if (!img.hasAttribute('alt') || img.alt.trim() === '') {
        var link = img.closest('a');
        var guess =
          (link && (link.getAttribute('title') || link.textContent)) ||
          (img.closest('[title]') && img.closest('[title]').getAttribute('title')) ||
          '';
        guess = guess.replace(/\s+/g, ' ').trim().slice(0, 100);
        // ถ้าเดาไม่ได้ ให้ alt="" (บอก screen reader ว่าเป็นรูปประกอบ) ดีกว่าไม่มี alt เลย
        img.setAttribute('alt', guess || '');
      }
    });
  }

  /* ---------- [D] H1 สำรองสำหรับหน้าแรก ----------
     !! หมายเหตุสำคัญ !!
     นี่คือทางแก้ชั่วคราว วิธีที่ถูกต้องคือวาง <h1> จริงลงใน gadget HTML
     ของหน้าแรก (ดูไฟล์ content/home-hero.html) แล้วลบบล็อกนี้ทิ้ง
     Google ต้อง render JS ก่อนถึงจะเห็น H1 ที่ใส่ด้วยวิธีนี้ ซึ่งช้ากว่าและ
     ไม่การันตี 100%                                                       */
  function ensureH1() {
    var isHome = location.pathname === '/' || location.pathname === '';
    if (!isHome) return;
    if (document.querySelector('h1')) return;

    var host = document.querySelector('.pageUnderwear') || document.querySelector('.pageWrapper');
    if (!host) return;

    var h1 = document.createElement('h1');
    h1.textContent = 'หินอ่อน หินแกรนิต แผ่นหินตัดตามขนาด — SIAM STONE';
    // ให้ดูกลมกลืน ไม่ใช่ซ่อน (ซ่อน H1 = เสี่ยงโดนมองว่า cloaking)
    h1.style.cssText = 'font-size:clamp(20px,4.5vw,30px);line-height:1.35;margin:18px 0 12px;font-weight:700;';
    host.insertBefore(h1, host.firstChild);
  }

  /* ---------- ตัวรัน ---------- */
  function run() {
    try { tuneImages(); } catch (e) {}
    try { ensureH1(); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  // LnwShop ใช้ Vue เติม DOM ทีหลัง จึงต้องรันซ้ำ
  window.addEventListener('load', function () { setTimeout(run, 500); setTimeout(run, 2500); });

  // เผื่อ carousel/แท็บ เติมรูปเพิ่มหลังจากนั้น
  if (window.MutationObserver) {
    var t;
    new MutationObserver(function () {
      clearTimeout(t);
      t = setTimeout(function () { try { tuneImages(); } catch (e) {} }, 300);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
