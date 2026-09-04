/* ============================================================
   silalang.com (ศิลาเพชร) — JS เสริม
   วางที่: หลังร้าน LnwShop → แต่งร้าน → โค้ดเสริมท้ายหน้า (before </body>)
   ------------------------------------------------------------
   [A] lazy-load รูปที่ยังไม่ถึงตา  -> หน้าแรกโหลดรูป 14.38 MB ตอนนี้ทุกใบโหลดพร้อมกัน
   [B] จัดลำดับความสำคัญรูปแรก (LCP)
   [C] เติม alt จากบริบท           -> 18 จาก 24 รูปในหน้าแรกไม่มี alt ที่ใช้งานได้
   [D] ย่อรูป _raw ที่ใหญ่เกินจำเป็น -> ดูหมายเหตุในบล็อก [D] ก่อนเปิดใช้

   ปลอดภัย: ไม่แตะ DOM ของตะกร้า/ชำระเงิน ไม่เขียนทับฟังก์ชันของ LnwShop
   ============================================================ */
(function () {
  'use strict';

  var LCP_BUDGET = 2;   // จำนวนรูปแรกที่ยอมให้โหลดทันที

  /* ---------- [A][B][C] ---------- */
  function tuneImages() {
    var eager = 0;
    Array.prototype.slice.call(document.images).forEach(function (img) {
      if (img.dataset.spDone) return;
      img.dataset.spDone = '1';

      var r = img.getBoundingClientRect();
      var vh = window.innerHeight || 800;
      var invisible = r.width === 0 && r.height === 0;
      var offscreen = r.top > vh;

      if (invisible || offscreen) {
        if (!img.loading || img.loading === 'auto') img.loading = 'lazy';
        img.decoding = 'async';
      } else if (eager < LCP_BUDGET) {
        img.loading = 'eager';
        img.decoding = 'sync';
        img.setAttribute('fetchpriority', 'high');
        eager++;
      } else {
        img.loading = 'lazy';
        img.decoding = 'async';
      }

      if (!img.hasAttribute('alt') || img.alt.trim() === '') {
        var link = img.closest('a');
        var guess =
          (link && (link.getAttribute('title') || link.textContent)) ||
          (img.closest('[title]') && img.closest('[title]').getAttribute('title')) || '';
        guess = guess.replace(/\s+/g, ' ').trim().slice(0, 100);
        img.setAttribute('alt', guess || '');
      }
    });
  }

  /* ---------- [D] ย่อรูป _raw ที่ใหญ่เกินจำเป็น ----------
     !! อ่านก่อนเปิดใช้ !!
     lnwfile รองรับขนาดสำเร็จรูปแค่บางค่า (50, 300, 600, 1024)
     และ _fit จะใส่ขอบขาวให้เต็มกรอบสี่เหลี่ยมจัตุรัส

     - รูปสินค้าที่เป็นสี่เหลี่ยมจัตุรัสอยู่แล้ว (1040x1040) -> ใช้ได้ดี ไม่มีขอบเพิ่ม
     - รูปโปสเตอร์แนวตั้ง (960x1440) -> จะได้ขอบขาวบนล่าง อย่าใช้กับพวกนี้

     บล็อกนี้จึงย่อเฉพาะรูปที่ "อัตราส่วนใกล้จัตุรัส" เท่านั้น
     ทางที่ดีกว่าคืออัปโหลดไฟล์ใน assets/silalang-optimized/ ทับของเดิม
     ซึ่งลดได้ 81-85% โดยไม่มีขอบขาวและไม่เสียความคมเลย

     >>> ถ้าอัปโหลดไฟล์ใหม่แล้ว ให้ลบบล็อก [D] นี้ทิ้ง <<<                       */
  var SHRINK_RAW = true;   // ตั้ง false เพื่อปิดบล็อกนี้

  function shrinkRawImages() {
    if (!SHRINK_RAW) return;
    Array.prototype.slice.call(document.images).forEach(function (img) {
      if (img.dataset.spShrunk) return;
      var src = img.currentSrc || img.src || '';
      if (src.indexOf('/_raw/') === -1) return;
      if (!img.naturalWidth || !img.naturalHeight) return;

      var ratio = img.naturalWidth / img.naturalHeight;
      if (ratio < 0.92 || ratio > 1.08) return;      // ไม่ใช่จัตุรัส -> ข้าม กันขอบขาว

      var shown = img.getBoundingClientRect().width;
      if (!shown || img.naturalWidth < shown * 2.2) return;   // ไม่ได้ใหญ่เกิน -> ข้าม

      img.dataset.spShrunk = '1';
      img.src = src.replace('/_raw/', '/_fit/1024/1024/');
    });
  }

  function run() {
    try { tuneImages(); } catch (e) {}
    try { shrinkRawImages(); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();

  window.addEventListener('load', function () { setTimeout(run, 500); setTimeout(run, 2500); });

  if (window.MutationObserver) {
    var t;
    new MutationObserver(function () {
      clearTimeout(t);
      t = setTimeout(function () { try { run(); } catch (e) {} }, 300);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
