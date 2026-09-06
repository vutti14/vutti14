/* ระบบทวนอัตโนมัติ (SRS) — ตัดสินใจให้ว่าวันนี้ควรทวนคำไหน เก็บข้อมูลในเครื่อง */
(function () {
  const KEY = 'zhth.v1';
  const DAY = 86400000;

  const DEFAULTS = {
    v: 1,
    cards: {},
    stats: { streak: 0, best: 0, lastDay: null, days: {} },
    settings: {
      newPerDay: 12,
      sessionMin: 30,
      decks: ['core', 'daily', 'mat'],
      rate: 0.85,
      voiceURI: null,
      showThaiPhonetic: true,
      showPinyin: true,
      autoPlay: true,
      micEnabled: true
    }
  };

  let S = null;

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      S = raw ? JSON.parse(raw) : null;
    } catch (e) { S = null; }
    if (!S || S.v !== 1) S = JSON.parse(JSON.stringify(DEFAULTS));
    // เติมค่าตั้งต้นที่อาจหายไปจากเวอร์ชันเก่า
    Object.keys(DEFAULTS.settings).forEach(function (k) {
      if (S.settings[k] === undefined) S.settings[k] = DEFAULTS.settings[k];
    });
    if (!S.stats.days) S.stats.days = {};
    return S;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  }

  function card(id) {
    if (!S.cards[id]) S.cards[id] = { ivl: 0, ease: 2.5, due: 0, reps: 0, lapses: 0, last: 0, spoken: 0 };
    return S.cards[id];
  }

  function isNew(id) { return !S.cards[id] || S.cards[id].reps === 0; }

  /* grade: 0 = ลืม, 1 = จำได้, 2 = ง่าย */
  function grade(id, g) {
    const c = card(id);
    const now = Date.now();
    if (g === 0) {
      c.lapses++;
      c.ease = Math.max(1.3, c.ease - 0.2);
      c.ivl = 0;
      c.due = now + 8 * 60000;           // กลับมาใน 8 นาที (ในรอบเดียวกัน)
    } else if (g === 1) {
      if (c.reps === 0) c.ivl = 1;
      else if (c.ivl <= 1) c.ivl = 3;
      else c.ivl = Math.round(c.ivl * c.ease);
      c.due = now + c.ivl * DAY;
    } else {
      c.ease = Math.min(2.8, c.ease + 0.1);
      c.ivl = c.reps === 0 ? 4 : Math.max(4, Math.round(c.ivl * c.ease * 1.3));
      c.due = now + c.ivl * DAY;
    }
    c.reps++;
    c.last = now;
    bump(g === 0 ? 'again' : 'ok');
    save();
    return c;
  }

  function markSpoken(id, ok) {
    const c = card(id);
    if (ok) c.spoken++;
    bump('spoke');
    save();
  }

  function bump(kind) {
    const d = today();
    if (!S.stats.days[d]) S.stats.days[d] = { rev: 0, again: 0, spoke: 0, newDone: 0, sec: 0 };
    const t = S.stats.days[d];
    if (kind === 'ok') t.rev++;
    else if (kind === 'again') { t.rev++; t.again++; }
    else if (kind === 'spoke') t.spoke++;
    else if (kind === 'new') t.newDone++;
  }

  function touchStreak() {
    const d = today();
    if (S.stats.lastDay === d) return;
    const y = new Date(Date.now() - DAY);
    const ys = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
    S.stats.streak = (S.stats.lastDay === ys) ? S.stats.streak + 1 : 1;
    S.stats.best = Math.max(S.stats.best || 0, S.stats.streak);
    S.stats.lastDay = d;
    save();
  }

  function pool() {
    const on = S.settings.decks;
    return window.DATA.all.filter(function (x) { return on.indexOf(x.deck) >= 0; });
  }

  function dueList() {
    const now = Date.now();
    return pool().filter(function (x) {
      const c = S.cards[x.i];
      return c && c.reps > 0 && c.due <= now;
    }).sort(function (a, b) { return S.cards[a.i].due - S.cards[b.i].due; });
  }

  function newList(limit) {
    const d = today();
    const doneToday = (S.stats.days[d] && S.stats.days[d].newDone) || 0;
    const room = Math.max(0, (limit === undefined ? S.settings.newPerDay : limit) - doneToday);
    if (!room) return [];
    // เรียงจากง่ายไปยาก แล้วเรียงตามลำดับในคลัง เพื่อให้เรียนเป็นหมวดต่อเนื่อง
    return pool().filter(function (x) { return isNew(x.i); })
      .sort(function (a, b) { return (a.l - b.l) || a.i.localeCompare(b.i); })
      .slice(0, room);
  }

  /* สร้างแผนของวันนี้: สลับคำใหม่แทรกกับคำทวน เพื่อไม่ให้ล้าสมอง */
  function buildSession() {
    const rev = dueList().slice(0, 90);
    const nw = newList();
    const out = [];
    let ri = 0, ni = 0;
    while (ri < rev.length || ni < nw.length) {
      for (let k = 0; k < 3 && ri < rev.length; k++) out.push({ item: rev[ri++], mode: 'review' });
      if (ni < nw.length) out.push({ item: nw[ni++], mode: 'new' });
    }
    return out;
  }

  function counts() {
    const p = pool();
    let learned = 0, mature = 0;
    p.forEach(function (x) {
      const c = S.cards[x.i];
      if (c && c.reps > 0) { learned++; if (c.ivl >= 21) mature++; }
    });
    return {
      total: p.length,
      learned: learned,
      mature: mature,
      due: dueList().length,
      newAvail: newList().length,
      todayNewDone: (S.stats.days[today()] && S.stats.days[today()].newDone) || 0
    };
  }

  function noteNewSeen() { bump('new'); save(); }

  function addSeconds(sec) {
    const d = today();
    if (!S.stats.days[d]) S.stats.days[d] = { rev: 0, again: 0, spoke: 0, newDone: 0, sec: 0 };
    S.stats.days[d].sec += sec;
    save();
  }

  function reset() { S = JSON.parse(JSON.stringify(DEFAULTS)); save(); }

  function exportJSON() { return JSON.stringify(S); }
  function importJSON(txt) {
    const o = JSON.parse(txt);
    if (!o || o.v !== 1) throw new Error('ไฟล์ไม่ถูกต้อง');
    S = o; load(); save();
  }

  window.SRS = {
    load: load, save: save, state: function () { return S; },
    settings: function () { return S.settings; },
    grade: grade, markSpoken: markSpoken, card: card, isNew: isNew,
    buildSession: buildSession, counts: counts, dueList: dueList,
    touchStreak: touchStreak, noteNewSeen: noteNewSeen, addSeconds: addSeconds,
    today: today, reset: reset, exportJSON: exportJSON, importJSON: importJSON
  };
})();
