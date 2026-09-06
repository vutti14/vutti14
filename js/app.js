/* ตรรกะหลักของแอป */
(function () {
  'use strict';
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  const D = window.DATA, S = window.SRS, SP = window.SPEECH;

  S.load();
  let stack = ['home'];

  /* ================= navigation ================= */
  const FOCUS = ['study', 'speak', 'listen', 'dialogue'];
  function show(name) {
    $$('.screen').forEach(function (el) { el.classList.remove('active'); });
    document.body.classList.toggle('focus', FOCUS.indexOf(name) >= 0);
    const el = $('#s-' + name);
    if (el) el.classList.add('active');
    $$('#tabbar button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    window.scrollTo(0, 0);
    SP.stop(); SP.abort();
  }
  function go(name) {
    if (stack[stack.length - 1] !== name) stack.push(name);
    render(name); show(name);
  }
  function back() {
    stack.pop();
    const t = stack[stack.length - 1] || 'home';
    render(t); show(t);
  }
  function pushFocus(name) {
    while (stack.length && FOCUS.indexOf(stack[stack.length - 1]) >= 0) stack.pop();
    stack.push(name); show(name);
  }

  function render(name) {
    if (name === 'home') renderHome();
    else if (name === 'browse') renderBrowse();
    else if (name === 'dialogues') renderDialogueList();
    else if (name === 'stats') renderStats();
    else if (name === 'settings') renderSettings();
  }

  document.addEventListener('click', function (e) {
    const b = e.target.closest('[data-back]');
    if (b) { back(); return; }
    const t = e.target.closest('#tabbar button');
    if (t) { stack = [t.dataset.tab]; go(t.dataset.tab); return; }
    const q = e.target.closest('[data-go]');
    if (q) {
      const dest = q.dataset.go;
      if (dest === 'speakdrill') startSpeak();
      else if (dest === 'listen') startListen();
      else go(dest);
    }
  });

  let toastT = null;
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function zhSize(z) { return z.length <= 3 ? 'zh-xl' : (z.length <= 7 ? 'zh-l' : 'zh-m'); }
  function say(text, slow) {
    const st = S.settings();
    SP.speak(text, { rate: slow ? 0.55 : st.rate, voiceURI: st.voiceURI });
  }

  /* ================= หน้าแรก ================= */
  function renderHome() {
    const c = S.counts(), st = S.state();
    $('#streak-n').textContent = st.stats.streak || 0;

    $('#plan-box').innerHTML =
      '<div class="pill"><b>' + c.due + '</b><span>คำที่ถึงคิวทวน</span></div>' +
      '<div class="pill"><b>' + c.newAvail + '</b><span>คำใหม่วันนี้</span></div>' +
      '<div class="pill"><b>' + Math.round(estMin(c)) + '</b><span>นาที (ประมาณ)</span></div>';

    const btn = $('#btn-start');
    if (c.due + c.newAvail === 0) {
      btn.textContent = 'วันนี้เรียนครบแล้ว — ฝึกพูดต่อ';
      btn.onclick = startSpeak;
    } else {
      btn.textContent = 'เริ่มบทเรียนวันนี้';
      btn.onclick = startStudy;
    }

    const warn = $('#tts-warn');
    if (!SP.ttsReady()) {
      warn.hidden = false;
      warn.innerHTML = '⚠️ ยังไม่พบเสียงภาษาจีนในเครื่องนี้ — ไปที่ <b>ตั้งค่า</b> เพื่อดูวิธีเปิดใช้ (ไม่งั้นจะไม่ได้ยินเสียงอ่าน)';
    } else warn.hidden = true;

    const pct = c.total ? Math.round(c.learned / c.total * 100) : 0;
    $('#progress-card').innerHTML =
      '<div class="kv"><span>เรียนไปแล้ว</span><b>' + c.learned + ' / ' + c.total + ' คำ</b></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="kv"><span>จำได้แน่นแล้ว (ทวนห่างเกิน 21 วัน)</span><b>' + c.mature + '</b></div>' +
      '<div class="kv"><span>สถิติต่อเนื่องสูงสุด</span><b>' + (st.stats.best || 0) + ' วัน</b></div>';

    const ul = $('#unit-list');
    let html = '';
    ['core', 'daily', 'mat'].forEach(function (dk) {
      if (S.settings().decks.indexOf(dk) < 0) return;
      const info = D.decks[dk];
      html += '<div class="deck-head">' + esc(info.name) + ' <small>' + esc(info.sub) + '</small></div>';
      Object.keys(D.units).forEach(function (u) {
        if (D.units[u].deck !== dk) return;
        const items = D.byUnit(u);
        const done = items.filter(function (x) { return !S.isNew(x.i); }).length;
        const p = items.length ? Math.round(done / items.length * 100) : 0;
        html += '<button class="unit" data-unit="' + u + '">' +
          '<span class="u-ico">' + esc(D.units[u].icon) + '</span>' +
          '<span class="u-mid"><b>' + esc(D.units[u].name) + '</b>' +
          '<span>' + done + '/' + items.length + ' คำ</span>' +
          '<span class="u-bar"><i style="width:' + p + '%"></i></span></span>' +
          '<span style="color:var(--ink3)">›</span></button>';
      });
    });
    ul.innerHTML = html;
    $$('.unit', ul).forEach(function (b) {
      b.onclick = function () { startStudy(D.byUnit(b.dataset.unit).slice(0, 30).map(function (x) { return { item: x, mode: S.isNew(x.i) ? 'new' : 'review' }; })); };
    });
  }

  function estMin(c) {
    // คำทวนราว 7 วิ/คำ, คำใหม่ราว 22 วิ/คำ
    return (c.due * 7 + c.newAvail * 22) / 60;
  }

  /* ================= โหมดเรียน / ทวน ================= */
  let ST = null;
  function startStudy(custom) {
    const queue = Array.isArray(custom) ? custom : S.buildSession();
    if (!queue.length) { toast('ไม่มีคำที่ต้องเรียนตอนนี้ ลองฝึกพูดแทน'); return; }
    ST = { q: queue, i: 0, revealed: false, total: queue.length, t0: Date.now() };
    S.touchStreak();
    pushFocus('study');
    drawStudy();
  }

  function drawStudy() {
    if (!ST) return;
    if (ST.i >= ST.q.length) return finishStudy();
    const cur = ST.q[ST.i], it = cur.item;
    $('#study-count').textContent = (ST.i + 1) + '/' + ST.total;
    $('#study-prog').style.width = (ST.i / ST.total * 100) + '%';

    const stage = $('#study-stage'), act = $('#study-actions');
    const isNewCard = cur.mode === 'new';
    const set = S.settings();

    if (isNewCard || ST.revealed) {
      stage.innerHTML =
        '<span class="badge ' + (isNewCard ? 'new' : 'rev') + '">' + (isNewCard ? '✨ คำใหม่' : '🔁 ทวน') + '</span>' +
        '<div class="qcard">' +
          '<div class="zh ' + zhSize(it.z) + '">' + esc(it.z) + '</div>' +
          (set.showPinyin ? '<div class="py">' + esc(it.p) + '</div>' : '') +
          (set.showThaiPhonetic ? '<div class="thp">' + esc(it.t) + '</div>' : '') +
          '<div class="mean">' + esc(it.m) + '</div>' +
          '<div class="unit-tag">' + esc(it.unitName) + '</div>' +
          (it.n ? '<div class="note">' + esc(it.n) + '</div>' : '') +
          '<div class="audio-row">' +
            '<button class="abtn" id="a-play">🔊 ฟัง</button>' +
            '<button class="abtn" id="a-slow">🐢 ช้า</button>' +
            (SP.asrSupported() && set.micEnabled ? '<button class="abtn mic" id="a-mic">🎤 พูดตาม</button>' : '') +
          '</div>' +
          '<div id="mic-out"></div>' +
        '</div>';

      if (isNewCard) {
        act.innerHTML = '<button class="btn solid" id="b-next">เข้าใจแล้ว · ต่อไป</button>';
        $('#b-next').onclick = function () { S.noteNewSeen(); S.grade(it.i, 1); next(); };
      } else {
        act.innerHTML =
          '<button class="btn g-again" data-g="0">ลืม<small>ทวนอีก 8 นาที</small></button>' +
          '<button class="btn g-ok" data-g="1">จำได้<small>ทวนตามรอบ</small></button>' +
          '<button class="btn g-easy" data-g="2">ง่ายมาก<small>ทิ้งช่วงยาว</small></button>';
        $$('[data-g]', act).forEach(function (b) {
          b.onclick = function () { S.grade(it.i, +b.dataset.g); next(); };
        });
      }
      if (set.autoPlay) setTimeout(function () { say(it.z); }, 220);
    } else {
      // ด้านหน้า: เห็นความหมายไทย ต้องนึกภาษาจีนให้ออกก่อน
      stage.innerHTML =
        '<span class="badge rev">🔁 ทวน — พูดออกมาก่อนกดเฉลย</span>' +
        '<div class="qcard">' +
          '<div class="mean mean-big">' + esc(it.m) + '</div>' +
          '<div class="unit-tag">' + esc(it.unitName) + '</div>' +
          '<div class="audio-row">' +
            (SP.asrSupported() && set.micEnabled ? '<button class="abtn mic" id="a-mic">🎤 พูดเลย</button>' : '') +
          '</div>' +
          '<div id="mic-out"></div>' +
          '<div class="hint">พูดออกเสียงจริงๆ ก่อนกดเฉลย — การนึกออกเองคือสิ่งที่ทำให้จำได้</div>' +
        '</div>';
      act.innerHTML = '<button class="btn solid" id="b-reveal">เฉลย</button>';
      $('#b-reveal').onclick = function () { ST.revealed = true; drawStudy(); };
    }

    const p = $('#a-play'); if (p) p.onclick = function () { say(it.z); };
    const sl = $('#a-slow'); if (sl) sl.onclick = function () { say(it.z, true); };
    const mc = $('#a-mic'); if (mc) mc.onclick = function () { doMic(it, mc, $('#mic-out'), function () { if (!ST.revealed && !isNewCard) { ST.revealed = true; drawStudy(); } }); };
  }

  function next() { ST.i++; ST.revealed = false; drawStudy(); }

  function finishStudy() {
    const sec = Math.round((Date.now() - ST.t0) / 1000);
    S.addSeconds(sec);
    const n = ST.total;
    ST = null;
    $('#study-prog').style.width = '100%';
    $('#study-stage').innerHTML =
      '<div class="done-wrap"><div class="big-emo">🎉</div>' +
      '<h2>จบรอบแล้ว</h2>' +
      '<p>' + n + ' คำ · ใช้เวลา ' + Math.round(sec / 60) + ' นาที<br>' +
      'พรุ่งนี้ระบบจะเอาคำที่คุณเกือบลืมกลับมาให้อัตโนมัติ</p></div>';
    $('#study-actions').innerHTML =
      '<button class="btn solid" id="b-speak">ฝึกพูดต่อ 🎤</button>' +
      '<button class="btn" data-back>กลับหน้าแรก</button>';
    $('#b-speak').onclick = startSpeak;
  }

  /* ================= ไมค์ ================= */
  function doMic(it, btn, out, onScored) {
    if (!SP.asrSupported()) { out.innerHTML = '<div class="result bad">' + esc(SP.errMessage('unsupported')) + '</div>'; return; }
    SP.stop();
    btn.classList.add('listening');
    btn.textContent = '🎤 กำลังฟัง…';
    out.innerHTML = '';
    SP.listen(function (r) {
      btn.classList.remove('listening');
      btn.textContent = '🎤 พูดอีกครั้ง';
      if (!r.ok) {
        out.innerHTML = '<div class="result mid">' + esc(SP.errMessage(r.err)) + '</div>' +
          '<div class="audio-row"><button class="abtn" id="m-self">✅ ผมพูดถูก (ให้คะแนนเอง)</button></div>';
        const sb = $('#m-self', out);
        if (sb) sb.onclick = function () { S.markSpoken(it.i, true); out.innerHTML = '<div class="result good">บันทึกแล้ว</div>'; if (onScored) onScored(); };
        return;
      }
      const sc = SP.score(it.z, r.alts);
      const cls = sc.score >= 80 ? 'good' : (sc.score >= 55 ? 'mid' : 'bad');
      const msg = sc.score >= 80 ? 'ตรงมาก คนจีนเข้าใจแน่นอน'
                : sc.score >= 55 ? 'ใกล้แล้ว ลองฟังเสียงต้นแบบแล้วพูดตามอีกรอบ'
                : 'ยังห่าง กดฟังแบบช้าแล้วเลียนเสียงทีละพยางค์';
      out.innerHTML = '<div class="result ' + cls + '"><b>' + sc.score + '%</b> — ' + esc(msg) +
        '<span class="heard">เครื่องได้ยิน: ' + esc(sc.best || r.text || '—') + '</span></div>';
      S.markSpoken(it.i, sc.score >= 80);
      if (onScored) onScored();
    });
  }

  /* ================= ฝึกพูดรัว ================= */
  let SPK = null;
  function startSpeak() {
    const set = S.settings();
    let pool = D.all.filter(function (x) { return set.decks.indexOf(x.deck) >= 0 && !S.isNew(x.i); });
    if (pool.length < 6) pool = D.all.filter(function (x) { return set.decks.indexOf(x.deck) >= 0 && x.l <= 2; });
    // ให้น้ำหนักประโยคมากกว่าคำเดี่ยว เพราะเป้าหมายคือพูดได้ ไม่ใช่ท่องศัพท์
    const sents = shuffle(pool.filter(function (x) { return x.k === 's'; }));
    const words = shuffle(pool.filter(function (x) { return x.k === 'w'; }));
    const q = sents.slice(0, 12).concat(words.slice(0, 6));
    if (!q.length) { toast('ยังไม่มีคำให้ฝึก เริ่มบทเรียนก่อนนะครับ'); return; }
    SPK = { q: shuffle(q), i: 0, ok: 0, t0: Date.now() };
    pushFocus('speak');
    drawSpeak();
  }

  function drawSpeak() {
    if (!SPK) return;
    if (SPK.i >= SPK.q.length) {
      const sec = Math.round((Date.now() - SPK.t0) / 1000);
      S.addSeconds(sec);
      $('#speak-prog').style.width = '100%';
      $('#speak-stage').innerHTML = '<div class="done-wrap"><div class="big-emo">🎤</div><h2>ฝึกพูดครบแล้ว</h2>' +
        '<p>ผ่าน ' + SPK.ok + ' จาก ' + SPK.q.length + ' ประโยค</p></div>';
      $('#speak-actions').innerHTML = '<button class="btn solid" id="b-again">ฝึกอีกรอบ</button><button class="btn" data-back>กลับ</button>';
      $('#b-again').onclick = startSpeak;
      SPK = null; return;
    }
    const it = SPK.q[SPK.i];
    $('#speak-count').textContent = (SPK.i + 1) + '/' + SPK.q.length;
    $('#speak-prog').style.width = (SPK.i / SPK.q.length * 100) + '%';
    $('#speak-stage').innerHTML =
      '<span class="badge">🎤 พูดประโยคนี้เป็นภาษาจีน</span>' +
      '<div class="qcard">' +
        '<div class="mean mean-big">' + esc(it.m) + '</div>' +
        '<div class="unit-tag">' + esc(it.unitName) + '</div>' +
        '<div class="audio-row"><button class="abtn mic" id="s-mic">🎤 พูดเลย</button>' +
        '<button class="abtn" id="s-hint">👀 ขอดูคำใบ้</button></div>' +
        '<div id="s-out"></div>' +
      '</div>';
    $('#s-hint').onclick = function () {
      $('#s-out').innerHTML = '<div class="result mid"><span class="heard">' + esc(it.z) + '</span>' +
        esc(it.p) + ' · ' + esc(it.t) + '</div>';
      say(it.z, true);
    };
    $('#s-mic').onclick = function () {
      doMic(it, $('#s-mic'), $('#s-out'), null);
    };
    $('#speak-actions').innerHTML =
      '<button class="btn" id="s-skip">ข้าม</button>' +
      '<button class="btn solid" id="s-next">ถัดไป</button>';
    $('#s-skip').onclick = function () { SPK.i++; drawSpeak(); };
    $('#s-next').onclick = function () {
      const res = $('#s-out .result.good');
      if (res) SPK.ok++;
      SPK.i++; drawSpeak();
    };
  }

  /* ================= ฟังจับใจความ ================= */
  let LS = null;
  function startListen() {
    const set = S.settings();
    let pool = D.all.filter(function (x) { return set.decks.indexOf(x.deck) >= 0 && !S.isNew(x.i); });
    if (pool.length < 8) pool = D.all.filter(function (x) { return set.decks.indexOf(x.deck) >= 0 && x.l <= 2; });
    if (pool.length < 4) { toast('ยังมีคำน้อยเกินไป เริ่มบทเรียนก่อนนะครับ'); return; }
    LS = { q: shuffle(pool).slice(0, 14), i: 0, ok: 0, pool: pool, t0: Date.now() };
    pushFocus('listen');
    drawListen();
  }

  function drawListen() {
    if (!LS) return;
    if (LS.i >= LS.q.length) {
      S.addSeconds(Math.round((Date.now() - LS.t0) / 1000));
      $('#listen-prog').style.width = '100%';
      $('#listen-stage').innerHTML = '<div class="done-wrap"><div class="big-emo">👂</div><h2>จบแบบฝึกฟัง</h2><p>ถูก ' + LS.ok + ' จาก ' + LS.q.length + '</p></div>';
      $('#listen-actions').innerHTML = '<button class="btn solid" id="l-again">อีกรอบ</button><button class="btn" data-back>กลับ</button>';
      $('#l-again').onclick = startListen;
      LS = null; return;
    }
    const it = LS.q[LS.i];
    const wrong = shuffle(LS.pool.filter(function (x) { return x.i !== it.i && x.m !== it.m; })).slice(0, 3);
    const opts = shuffle([it].concat(wrong));
    $('#listen-count').textContent = (LS.i + 1) + '/' + LS.q.length;
    $('#listen-prog').style.width = (LS.i / LS.q.length * 100) + '%';
    $('#listen-stage').innerHTML =
      '<span class="badge">👂 ฟังแล้วเลือกความหมาย</span>' +
      '<div class="qcard"><div class="audio-row">' +
        '<button class="abtn" id="l-play">🔊 ฟังอีกครั้ง</button>' +
        '<button class="abtn" id="l-slow">🐢 ช้า</button></div></div>' +
      '<div class="choices">' + opts.map(function (o, k) {
        return '<button class="choice" data-k="' + k + '">' + esc(o.m) + '</button>';
      }).join('') + '</div>';
    $('#listen-actions').innerHTML = '';
    $('#l-play').onclick = function () { say(it.z); };
    $('#l-slow').onclick = function () { say(it.z, true); };
    setTimeout(function () { say(it.z); }, 260);

    $$('#listen-stage .choice').forEach(function (b) {
      b.onclick = function () {
        const chosen = opts[+b.dataset.k];
        const right = chosen.i === it.i;
        if (right) LS.ok++;
        $$('#listen-stage .choice').forEach(function (x, k) {
          x.onclick = null;
          if (opts[k].i === it.i) x.classList.add('right');
          else if (x === b) x.classList.add('wrong');
        });
        $('#listen-stage .qcard').insertAdjacentHTML('beforeend',
          '<div class="result ' + (right ? 'good' : 'bad') + '"><span class="heard">' + esc(it.z) + '</span>' +
          esc(it.p) + ' · ' + esc(it.t) + '</div>');
        $('#listen-actions').innerHTML = '<button class="btn solid" id="l-next">ถัดไป</button>';
        $('#l-next').onclick = function () { LS.i++; drawListen(); };
      };
    });
  }

  /* ================= บทสนทนา ================= */
  function renderDialogueList() {
    const el = $('#dialogue-list');
    el.innerHTML = '<div class="info-block">เล่นเป็น <b>ตัวคุณเอง</b> — ฟังอีกฝ่ายพูด แล้วพูดตอบกลับเป็นภาษาจีน นี่คือส่วนที่ใกล้ของจริงที่สุดในแอปนี้</div>' +
      D.dialogues.map(function (d) {
        return '<button class="dlg-item" data-d="' + d.id + '"><b>' + esc(d.title) + '</b>' +
          '<span>' + d.lines.length + ' บรรทัด · ระดับ ' + d.lvl + ' · ' + (d.deck === 'mat' ? 'ธุรกิจ' : 'ชีวิตประจำวัน') + '</span></button>';
      }).join('');
    $$('.dlg-item', el).forEach(function (b) {
      b.onclick = function () { openDialogue(b.dataset.d); };
    });
  }

  let DG = null;
  function openDialogue(id) {
    const d = D.dialogues.filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    DG = { d: d, i: 0 };
    $('#dlg-title').textContent = d.title;
    pushFocus('dialogue');
    drawDialogue();
  }

  function drawDialogue() {
    const d = DG.d;
    $('#dlg-body').innerHTML = d.lines.map(function (L, k) {
      const mine = L.w === 'y';
      const hidden = k > DG.i;
      const masked = mine && k === DG.i;
      return '<div class="line ' + (mine ? 'you' : 'them') + (hidden ? ' dim' : '') + '" data-k="' + k + '">' +
        '<span class="who">' + (mine ? '🙋' : '🧑‍🏭') + '</span>' +
        '<span class="bub">' +
          (hidden ? '<span class="z">· · ·</span>' :
            (masked ? '<span class="m" style="color:inherit">' + esc(L.m) + '</span><span class="say">🎤 พูดประโยคนี้เป็นภาษาจีน</span>'
              : '<span class="z">' + esc(L.z) + '</span><span class="py">' + esc(L.p) + '</span>' +
                '<span class="tp">' + esc(L.t) + '</span><span class="m">' + esc(L.m) + '</span>')) +
        '</span></div>';
    }).join('') + '<div id="dlg-out"></div><div class="foot-space"></div>';

    const cur = d.lines[DG.i];
    const act = $('#dlg-actions');
    if (!cur) {
      act.innerHTML = '<button class="btn solid" id="dg-restart">เล่นอีกรอบ</button><button class="btn" data-back>กลับ</button>';
      $('#dg-restart').onclick = function () { DG.i = 0; drawDialogue(); };
      return;
    }
    if (cur.w === 'y') {
      act.innerHTML =
        (SP.asrSupported() && S.settings().micEnabled ? '<button class="btn solid" id="dg-mic">🎤 พูด</button>' : '') +
        '<button class="btn" id="dg-hint">คำใบ้</button>' +
        '<button class="btn" id="dg-skip">ข้าม</button>';
      const m = $('#dg-mic');
      if (m) m.onclick = function () {
        doMic({ i: 'dlg-' + d.id + '-' + DG.i, z: cur.z }, m, $('#dlg-out'), null);
      };
      $('#dg-hint').onclick = function () {
        $('#dlg-out').innerHTML = '<div class="result mid"><span class="heard">' + esc(cur.z) + '</span>' + esc(cur.p) + ' · ' + esc(cur.t) + '</div>';
        say(cur.z, true);
      };
      $('#dg-skip').onclick = function () { DG.i++; drawDialogue(); scrollBottom(); };
    } else {
      act.innerHTML = '<button class="btn" id="dg-replay">🔊 ฟังซ้ำ</button><button class="btn solid" id="dg-go">ต่อไป</button>';
      $('#dg-replay').onclick = function () { say(cur.z); };
      $('#dg-go').onclick = function () { DG.i++; drawDialogue(); scrollBottom(); };
      setTimeout(function () { say(cur.z); }, 260);
    }
    scrollBottom();
  }
  function scrollBottom() {
    setTimeout(function () {
      const box = $('#s-dialogue .pad');
      if (box) box.scrollTop = box.scrollHeight;
    }, 60);
  }

  /* ================= คลังคำ ================= */
  let bFilter = 'all';
  function renderBrowse() {
    const chips = $('#deck-chips');
    const list = [['all', 'ทั้งหมด'], ['core', 'ชุดแกน'], ['daily', 'ชีวิตประจำวัน'], ['mat', 'วัสดุ/ธุรกิจ'], ['s', 'เฉพาะประโยค'], ['star', 'ที่ยังไม่แม่น']];
    chips.innerHTML = list.map(function (c) {
      return '<button class="chip' + (bFilter === c[0] ? ' on' : '') + '" data-f="' + c[0] + '">' + esc(c[1]) + '</button>';
    }).join('');
    $$('.chip', chips).forEach(function (b) {
      b.onclick = function () { bFilter = b.dataset.f; renderBrowse(); };
    });
    drawBrowseList();
  }

  function drawBrowseList() {
    const q = ($('#q').value || '').trim().toLowerCase();
    let items = D.all.slice();
    if (bFilter === 'core' || bFilter === 'daily' || bFilter === 'mat') items = items.filter(function (x) { return x.deck === bFilter; });
    else if (bFilter === 's') items = items.filter(function (x) { return x.k === 's'; });
    else if (bFilter === 'star') items = items.filter(function (x) { const c = S.state().cards[x.i]; return c && c.lapses > 0 && c.ivl < 21; });
    if (q) {
      const nq = D.stripTones(q);
      items = items.filter(function (x) { return x._s.indexOf(nq) >= 0; });
    }
    const el = $('#browse-list');
    if (!items.length) { el.innerHTML = '<div class="empty">ไม่พบคำที่ค้นหา</div>'; return; }
    el.innerHTML = '<div class="empty" style="padding:6px 0 12px">' + items.length + ' รายการ</div>' +
      items.slice(0, 300).map(function (x) {
        return '<div class="row"><div class="rl">' +
          '<div class="rz">' + esc(x.z) + '</div>' +
          '<div class="rp">' + esc(x.p) + '</div>' +
          '<div class="rt">' + esc(x.t) + '</div>' +
          '<div class="rm">' + esc(x.m) + '</div>' +
          (x.n ? '<div class="rn">' + esc(x.n) + '</div>' : '') +
          '</div><button class="rb" data-say="' + esc(x.z) + '">🔊</button></div>';
      }).join('') + '<div class="foot-space"></div>';
    $$('[data-say]', el).forEach(function (b) { b.onclick = function () { say(b.dataset.say); }; });
  }
  $('#q').addEventListener('input', drawBrowseList);

  /* ================= สถิติ ================= */
  function renderStats() {
    const st = S.state(), c = S.counts();
    const days = [];
    for (let k = 27; k >= 0; k--) {
      const d = new Date(Date.now() - k * 86400000);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      days.push(st.stats.days[key] || null);
    }
    const totRev = Object.keys(st.stats.days).reduce(function (a, k) { return a + (st.stats.days[k].rev || 0); }, 0);
    const totSec = Object.keys(st.stats.days).reduce(function (a, k) { return a + (st.stats.days[k].sec || 0); }, 0);
    const totSpoke = Object.keys(st.stats.days).reduce(function (a, k) { return a + (st.stats.days[k].spoke || 0); }, 0);
    const t = st.stats.days[S.today()] || { rev: 0, spoke: 0, sec: 0, newDone: 0 };

    $('#stats-body').innerHTML =
      '<div class="card"><div class="kv"><span>วันนี้</span><b>' + t.rev + ' คำ · ' + Math.round(t.sec / 60) + ' นาที</b></div>' +
      '<div class="kv"><span>คำใหม่วันนี้</span><b>' + t.newDone + '</b></div>' +
      '<div class="kv"><span>ฝึกพูดวันนี้</span><b>' + t.spoke + ' ครั้ง</b></div></div>' +
      '<h3 class="sec-title">28 วันที่ผ่านมา</h3>' +
      '<div class="card"><div class="hm">' + days.map(function (d) {
        const n = d ? d.rev : 0;
        const lv = n === 0 ? '' : n < 15 ? 'l1' : n < 40 ? 'l2' : n < 80 ? 'l3' : 'l4';
        return '<i class="' + lv + '" title="' + n + '"></i>';
      }).join('') + '</div></div>' +
      '<h3 class="sec-title">รวมทั้งหมด</h3>' +
      '<div class="card">' +
      '<div class="kv"><span>ทวนไปแล้ว</span><b>' + totRev + ' ครั้ง</b></div>' +
      '<div class="kv"><span>ฝึกพูด</span><b>' + totSpoke + ' ครั้ง</b></div>' +
      '<div class="kv"><span>เวลาเรียนสะสม</span><b>' + Math.round(totSec / 60) + ' นาที</b></div>' +
      '<div class="kv"><span>คำที่เรียนแล้ว</span><b>' + c.learned + ' / ' + c.total + '</b></div>' +
      '<div class="kv"><span>จำแน่นแล้ว</span><b>' + c.mature + '</b></div></div>' +
      '<div class="foot-space"></div>';
  }

  /* ================= ตั้งค่า ================= */
  function renderSettings() {
    const set = S.settings();
    const voices = SP.zhVoices();
    const el = $('#settings-body');
    el.innerHTML =
      '<div class="set-row"><div class="sl"><b>คำใหม่ต่อวัน</b><small>12 คำ ≈ 30 นาที เมื่อรวมการทวน ถ้ารู้สึกหนักให้ลดลง อย่าฝืน</small></div>' +
        '<input type="number" id="st-new" min="0" max="40" value="' + set.newPerDay + '"></div>' +

      '<div class="set-row"><div class="sl"><b>ความเร็วเสียง</b><small>0.85 คือความเร็วที่ฟังทันแต่ยังเป็นธรรมชาติ</small></div>' +
        '<select id="st-rate">' + [0.6, 0.7, 0.8, 0.85, 0.9, 1.0].map(function (r) {
          return '<option value="' + r + '"' + (Math.abs(r - set.rate) < 0.001 ? ' selected' : '') + '>' + r + '×</option>';
        }).join('') + '</select></div>' +

      '<div class="set-row"><div class="sl"><b>เสียงพูด</b><small>' +
        (voices.length ? 'พบเสียงจีน ' + voices.length + ' เสียงในเครื่องนี้' : 'ยังไม่พบเสียงภาษาจีน — ดูวิธีแก้ด้านล่าง') +
        '</small></div><select id="st-voice"' + (voices.length ? '' : ' disabled') + '>' +
        voices.map(function (v) {
          return '<option value="' + esc(v.voiceURI) + '"' + (set.voiceURI === v.voiceURI ? ' selected' : '') + '>' + esc(v.name) + '</option>';
        }).join('') + '</select></div>' +

      '<div class="set-row"><div class="sl"><b>แสดงพินอิน</b><small>ตัวสะกดสากล ใช้พิมพ์จีนในมือถือได้ด้วย</small></div>' +
        '<button class="sw' + (set.showPinyin ? ' on' : '') + '" data-t="showPinyin"></button></div>' +

      '<div class="set-row"><div class="sl"><b>แสดงคำอ่านไทย</b><small>อ่านง่ายกว่า แต่ถ้าอยากพูดให้ตรงจริงๆ แนะนำให้ปิดหลังผ่านไปสัก 2 เดือน</small></div>' +
        '<button class="sw' + (set.showThaiPhonetic ? ' on' : '') + '" data-t="showThaiPhonetic"></button></div>' +

      '<div class="set-row"><div class="sl"><b>เล่นเสียงอัตโนมัติ</b><small>ได้ยินทุกคำโดยไม่ต้องกด</small></div>' +
        '<button class="sw' + (set.autoPlay ? ' on' : '') + '" data-t="autoPlay"></button></div>' +

      '<div class="set-row"><div class="sl"><b>ใช้ไมโครโฟนให้คะแนน</b><small>' +
        (SP.asrSupported() ? 'เบราว์เซอร์นี้รองรับ' : 'เบราว์เซอร์นี้ไม่รองรับ') + '</small></div>' +
        '<button class="sw' + (set.micEnabled ? ' on' : '') + '" data-t="micEnabled"></button></div>' +

      '<h3 class="sec-title">ชุดที่กำลังเรียน</h3>' +
      ['core', 'daily', 'mat'].map(function (dk) {
        return '<div class="set-row"><div class="sl"><b>' + esc(D.decks[dk].name) + '</b><small>' + esc(D.decks[dk].sub) + '</small></div>' +
          '<button class="sw' + (set.decks.indexOf(dk) >= 0 ? ' on' : '') + '" data-deck="' + dk + '"></button></div>';
      }).join('') +

      '<h3 class="sec-title">เรื่องที่ควรรู้</h3>' +
      '<div class="info-block"><b>คำอ่านไทยในแอปนี้ใช้กติกา:</b><br>' +
      'เสียง 1 = เสียงสามัญ (มา) · เสียง 2 = จัตวา (หมา) · เสียง 3 = เอก (หม่า) · เสียง 4 = โท (ม่า/ม้า)<br>' +
      'คำอ่านไทยเป็นแค่ตัวช่วยตอนเริ่มต้น — ภาษาไทยไม่มีเสียง zh/ch/sh/r และสระ ü จริงๆ ' +
      'เพราะฉะนั้น<b>ให้ยึดเสียงที่ได้ยินจากปุ่ม 🔊 เป็นหลักเสมอ</b> ไม่ใช่ตัวหนังสือไทย</div>' +

      '<div class="info-block"><b>ถ้าไม่ได้ยินเสียงจีน:</b><br>' +
      '<u>iPhone/iPad</u> — ตั้งค่า › การช่วยการเข้าถึง › เนื้อหาที่พูด › เสียง › ภาษาจีน (แมนดาริน จีนแผ่นดินใหญ่) แล้วโหลดเสียงลงเครื่อง<br>' +
      '<u>Android</u> — ตั้งค่า › ระบบ › ภาษาและการป้อนข้อมูล › เอาต์พุตแปลงข้อความเป็นคำพูด › ติดตั้งข้อมูลเสียง › 中文 (จีน) แล้วเลือกดาวน์โหลดเพื่อใช้ออฟไลน์<br>' +
      'เมื่อโหลดเสียงลงเครื่องแล้ว จะพูดได้แม้ไม่มีเน็ต</div>' +

      '<div class="info-block"><b>ข้อจำกัดที่ต้องรู้เรื่องไมโครโฟน:</b><br>' +
      'บน Chrome/Android การให้คะแนนการออกเสียง<b>ต้องต่ออินเทอร์เน็ต</b> เพราะเสียงถูกส่งไปประมวลผลที่เซิร์ฟเวอร์ของ Google — ' +
      'ในจีนที่เข้า Google ไม่ได้ ฟีเจอร์นี้จะใช้ไม่ได้ถ้าไม่มี VPN ให้กด "ให้คะแนนเอง" แทน<br>' +
      'บน Safari/iOS ใช้ระบบของ Apple ซึ่งมักใช้งานได้ในจีน — <b>ถ้าคุณใช้ iPhone ให้เปิดแอปนี้ด้วย Safari</b><br>' +
      'ส่วนเสียงอ่าน 🔊 และการเรียนทุกอย่างที่เหลือ ใช้ได้ออฟไลน์ 100%</div>' +

      '<h3 class="sec-title">ข้อมูลของคุณ</h3>' +
      '<div class="set-row"><div class="sl"><b>สำรองข้อมูล</b><small>คัดลอกความคืบหน้าไว้ ย้ายเครื่องได้</small></div>' +
        '<button class="chip" id="st-export">คัดลอก</button></div>' +
      '<div class="set-row"><div class="sl"><b>กู้คืนข้อมูล</b><small>วางข้อความที่สำรองไว้</small></div>' +
        '<button class="chip" id="st-import">วาง</button></div>' +
      '<div class="set-row"><div class="sl"><b class="danger">ล้างความคืบหน้าทั้งหมด</b><small>เริ่มต้นใหม่ ย้อนกลับไม่ได้</small></div>' +
        '<button class="chip danger" id="st-reset">ล้าง</button></div>' +
      '<div class="foot-space"></div>';

    $('#st-new').onchange = function () { set.newPerDay = Math.max(0, Math.min(40, +this.value || 0)); S.save(); toast('บันทึกแล้ว'); };
    $('#st-rate').onchange = function () { set.rate = +this.value; S.save(); say('你好'); };
    const vs = $('#st-voice');
    if (vs && voices.length) vs.onchange = function () { set.voiceURI = this.value; SP.pick(this.value); S.save(); say('你好，很高兴认识你'); };

    $$('[data-t]', el).forEach(function (b) {
      b.onclick = function () { set[b.dataset.t] = !set[b.dataset.t]; S.save(); renderSettings(); };
    });
    $$('[data-deck]', el).forEach(function (b) {
      b.onclick = function () {
        const dk = b.dataset.deck, k = set.decks.indexOf(dk);
        if (k >= 0) { if (set.decks.length === 1) { toast('ต้องเปิดอย่างน้อยหนึ่งชุด'); return; } set.decks.splice(k, 1); }
        else set.decks.push(dk);
        S.save(); renderSettings();
      };
    });
    $('#st-export').onclick = function () {
      const txt = S.exportJSON();
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('คัดลอกแล้ว วางเก็บไว้ในโน้ตได้เลย'); },
        function () { window.prompt('คัดลอกข้อความนี้เก็บไว้:', txt); });
      else window.prompt('คัดลอกข้อความนี้เก็บไว้:', txt);
    };
    $('#st-import').onclick = function () {
      const txt = window.prompt('วางข้อมูลสำรองที่นี่:');
      if (!txt) return;
      try { S.importJSON(txt); toast('กู้คืนแล้ว'); renderSettings(); } catch (e) { toast('ข้อมูลไม่ถูกต้อง'); }
    };
    $('#st-reset').onclick = function () {
      if (window.confirm('ล้างความคืบหน้าทั้งหมด? ย้อนกลับไม่ได้')) { S.reset(); toast('ล้างแล้ว'); renderSettings(); }
    };
  }

  /* ================= utils ================= */
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ================= boot ================= */
  SP.pick(S.settings().voiceURI);
  renderHome();
  setTimeout(function () { if (SP.zhVoices().length) { SP.pick(S.settings().voiceURI); renderHome(); } }, 900);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
