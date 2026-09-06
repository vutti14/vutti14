/* Service Worker — ทำให้แอปเปิดได้แม้ไม่มีอินเทอร์เน็ต
   เปลี่ยน CACHE เป็นเลขใหม่ทุกครั้งที่แก้ไฟล์ เพื่อให้เครื่องผู้ใช้ดึงเวอร์ชันใหม่ */
const CACHE = 'zhth-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/data-core.js',
  './js/data-daily.js',
  './js/data-materials.js',
  './js/data-dialogues.js',
  './js/data.js',
  './js/srs.js',
  './js/speech.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // เนื้อหาแอป: ใช้ของในเครื่องก่อนเสมอ แล้วค่อยอัปเดตเบื้องหลัง
  e.respondWith(
    caches.match(req).then(function (hit) {
      const net = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
