/* เสียงพูด (TTS) และการฟังเสียงคุณเพื่อให้คะแนน (ASR)
   ทั้งสองอย่างใช้ของที่มีอยู่ในเบราว์เซอร์ ไม่ต้องต่อ API ไม่มีค่าใช้จ่าย */
(function () {
  let voices = [];
  let chosen = null;

  function refresh() {
    try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
    return voices;
  }

  function zhVoices() {
    return refresh().filter(function (v) {
      return /^zh/i.test(v.lang || '') || /chinese|中文|普通话|國語|国语/i.test(v.name || '');
    });
  }

  function pick(uri) {
    const list = zhVoices();
    if (!list.length) { chosen = null; return null; }
    if (uri) {
      const hit = list.filter(function (v) { return v.voiceURI === uri; })[0];
      if (hit) { chosen = hit; return hit; }
    }
    // ชอบ zh-CN (จีนกลางแผ่นดินใหญ่) มากกว่า zh-TW / zh-HK
    const cn = list.filter(function (v) { return /zh[-_]?CN|Hans/i.test(v.lang + ' ' + v.name); });
    chosen = cn[0] || list[0];
    return chosen;
  }

  function ttsReady() { return zhVoices().length > 0; }

  function speak(text, opt) {
    opt = opt || {};
    if (!('speechSynthesis' in window)) return false;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/[（(].*?[)）]/g, ''));
      const v = chosen || pick(opt.voiceURI);
      if (v) u.voice = v;
      u.lang = (v && v.lang) || 'zh-CN';
      u.rate = opt.rate || 0.85;
      u.pitch = 1;
      if (opt.onend) u.onend = opt.onend;
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  function stop() { try { window.speechSynthesis.cancel(); } catch (e) {} }

  /* ---------- การฟังเสียง (ASR) ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  function asrSupported() { return !!SR; }

  let rec = null;
  function listen(cb) {
    if (!SR) { cb({ ok: false, err: 'unsupported' }); return null; }
    try { if (rec) rec.abort(); } catch (e) {}
    rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    rec.continuous = false;
    let done = false;
    rec.onresult = function (ev) {
      done = true;
      const alts = [];
      const r = ev.results[0];
      for (let i = 0; i < r.length; i++) alts.push(r[i].transcript);
      cb({ ok: true, alts: alts, text: alts[0] || '' });
    };
    rec.onerror = function (ev) {
      if (done) return;
      done = true;
      cb({ ok: false, err: ev.error || 'error' });
    };
    rec.onend = function () { if (!done) { done = true; cb({ ok: false, err: 'no-speech' }); } };
    try { rec.start(); } catch (e) { cb({ ok: false, err: 'start-failed' }); }
    return rec;
  }

  function abort() { try { if (rec) rec.abort(); } catch (e) {} }

  /* ---------- ให้คะแนนการออกเสียง ---------- */
  function norm(s) {
    return String(s || '')
      .replace(/[\s　]/g, '')
      .replace(/[，。！？、,.!?；;：:"'“”‘’（）()【】\[\]]/g, '')
      .toLowerCase();
  }

  function lcs(a, b) {
    const n = a.length, m = b.length;
    if (!n || !m) return 0;
    let prev = new Array(m + 1).fill(0), cur = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      }
      const t = prev; prev = cur; cur = t; cur.fill(0);
    }
    return prev[m];
  }

  /* คืนคะแนน 0–100 โดยเทียบกับตัวเลือกที่เครื่องได้ยินทั้งหมด แล้วเอาอันที่ดีที่สุด */
  function score(target, alts) {
    const t = norm(target);
    if (!t) return { score: 0, best: '' };
    let best = 0, bestText = '';
    (alts || []).forEach(function (a) {
      const h = norm(a);
      if (!h) return;
      const common = lcs(t, h);
      const s = Math.round((2 * common / (t.length + h.length)) * 100);
      if (s > best) { best = s; bestText = a; }
    });
    return { score: best, best: bestText };
  }

  function errMessage(code) {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'เบราว์เซอร์ไม่อนุญาตให้ใช้ไมค์ — กดอนุญาตไมโครโฟนในการตั้งค่าเว็บไซต์';
      case 'no-speech':
        return 'ไม่ได้ยินเสียง ลองพูดดังขึ้นและใกล้ไมค์กว่านี้';
      case 'network':
        return 'การฟังเสียงต้องต่ออินเทอร์เน็ต (Chrome ส่งเสียงไปประมวลผลที่เซิร์ฟเวอร์) — ตอนออฟไลน์หรืออยู่ในจีนที่เข้า Google ไม่ได้ ให้ใช้ปุ่ม "ให้คะแนนเอง" แทน';
      case 'unsupported':
        return 'เบราว์เซอร์นี้ไม่รองรับการฟังเสียง — ลองใช้ Chrome (Android) หรือ Safari (iOS 16 ขึ้นไป)';
      case 'aborted':
        return 'ยกเลิกการฟัง';
      default:
        return 'ฟังไม่สำเร็จ ลองใหม่อีกครั้ง';
    }
  }

  window.SPEECH = {
    refresh: refresh, zhVoices: zhVoices, pick: pick, ttsReady: ttsReady,
    speak: speak, stop: stop,
    asrSupported: asrSupported, listen: listen, abort: abort,
    score: score, norm: norm, errMessage: errMessage,
    current: function () { return chosen; }
  };

  if ('speechSynthesis' in window) {
    refresh();
    window.speechSynthesis.onvoiceschanged = function () { refresh(); if (!chosen) pick(); };
  }
})();
