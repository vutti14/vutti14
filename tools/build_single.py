#!/usr/bin/env python3
"""รวมทุกไฟล์เป็น HTML ไฟล์เดียวที่เปิดใช้ได้เลย ไม่ต้องมีไฟล์อื่นประกอบ"""
import re, os, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
read = lambda p: (root / p).read_text(encoding='utf-8')

css = read('css/style.css')

# ---- ธีม: รองรับทั้ง system / ปุ่มเลือกสว่าง / ปุ่มเลือกมืด ----
DARK = """    --bg:#17120f; --surface:#221b17; --surface2:#2c231e; --line:#3a2e27;
    --ink:#f3ece7; --ink2:#c0b0a6; --ink3:#8d7c72;
    --red:#c94b4b; --red-soft:#e07070; --gold:#e2b25a;
    --ok:#4bbd84; --warn:#e0a253; --bad:#e56a6a;
    --shadow:0 1px 3px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.3);
    --hero-grad:linear-gradient(160deg,#7d2020 0%,#3a0d0d 100%);
    color-scheme:dark;"""

old_dark = css[css.index('@media (prefers-color-scheme:dark){\n  :root{'):css.index('*{box-sizing')]
css = css.replace(old_dark,
    '@media (prefers-color-scheme:dark){\n  :root:not([data-theme="light"]){\n' + DARK + '\n  }\n}\n'
    ':root[data-theme="dark"]{\n' + DARK + '\n}\n')

# โทเคนพื้นหลัง hero + color-scheme ของธีมสว่าง
css = css.replace('  --th:"Sarabun"', '  --hero-grad:linear-gradient(160deg,#8c1b1b 0%,#5e1010 100%);\n  color-scheme:light;\n  --th:"Sarabun"')
css = css.replace('  background:linear-gradient(160deg,var(--red) 0%,#5e1010 100%);\n', '  background:var(--hero-grad);\n')
css = css.replace('@media (prefers-color-scheme:dark){.hero{background:linear-gradient(160deg,#7d2020 0%,#3a0d0d 100%)}}\n', '')

# ---- safe-area: กรอบของหน้าเว็บเติมระยะขอบจอให้แล้ว เอาของซ้ำออก ----
css = css.replace('padding:calc(env(safe-area-inset-top,0px) + 20px) 16px 22px', 'padding:20px 16px 22px')
css = css.replace('padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px', 'padding:10px 14px')
css = css.replace('.actions{padding:0 16px calc(env(safe-area-inset-bottom,0px) + 20px)', '.actions{padding:0 16px 20px')
css = css.replace('body.focus .actions{padding-bottom:calc(env(safe-area-inset-bottom,0px) + 16px)', 'body.focus .actions{padding-bottom:16px')
css = css.replace('.topbar{\n  display:flex', '.topbar{\n  top:env(safe-area-inset-top,0px);\n  display:flex')
css = css.replace('position:sticky;top:0;background:var(--bg);z-index:5;', 'position:sticky;background:var(--bg);z-index:5;')

# ---- ความสูง: ใช้ % แทน vh เพื่อให้พอดีกับกรอบที่ถูกเติมระยะขอบ ----
css = css.replace('.screen{display:none;padding-bottom:88px;min-height:100vh}', '.screen{display:none;padding-bottom:88px;min-height:100%}')
css = css.replace('height:100vh;height:100dvh}', 'height:100%}')

# ---- แผงสำรองข้อมูลในหน้า (แทนกล่องป๊อปอัปที่หน้าเว็บฝังใช้ไม่ได้) ----
css += """
#backup-panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:8px}
#bk-text{width:100%;min-height:96px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
  border:1.5px solid var(--line);border-radius:11px;padding:10px;background:var(--surface2);color:var(--ink)}
.bk-row{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}
.bk-row .chip{cursor:pointer}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
"""

# ---- รวมสคริปต์ ----
js = '\n'.join(read(f) for f in
    ['js/data-core.js','js/data-daily.js','js/data-materials.js','js/data-dialogues.js',
     'js/data.js','js/srs.js','js/speech.js','js/app.js'])

# ไม่มี service worker ในหน้าเว็บฝัง
js = js.replace("""  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
""", '')

# แผงสำรองข้อมูลแทน prompt(), ปุ่มล้างแบบกดยืนยันสองครั้งแทน confirm()
js = js.replace(
"""      '<div class="set-row"><div class="sl"><b>สำรองข้อมูล</b><small>คัดลอกความคืบหน้าไว้ ย้ายเครื่องได้</small></div>' +
        '<button class="chip" id="st-export">คัดลอก</button></div>' +
      '<div class="set-row"><div class="sl"><b>กู้คืนข้อมูล</b><small>วางข้อความที่สำรองไว้</small></div>' +
        '<button class="chip" id="st-import">วาง</button></div>' +""",
"""      '<div class="set-row"><div class="sl"><b>สำรอง / กู้คืนข้อมูล</b><small>ย้ายความคืบหน้าไปเครื่องอื่นได้</small></div>' +
        '<button class="chip" id="st-backup">เปิด</button></div>' +
      '<div id="backup-panel" hidden>' +
        '<textarea id="bk-text" spellcheck="false" placeholder="กด “ดึงข้อมูลของผม” เพื่อเอาข้อความสำรองออกมา — หรือวางข้อความที่เคยสำรองไว้ลงช่องนี้แล้วกด “กู้คืน”"></textarea>' +
        '<div class="bk-row">' +
          '<button class="chip" id="bk-fill">ดึงข้อมูลของผม</button>' +
          '<button class="chip" id="bk-copy">คัดลอก</button>' +
          '<button class="chip" id="bk-restore">กู้คืน</button>' +
        '</div></div>' +""")

js = js.replace(
"""    $('#st-export').onclick = function () {
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
    };""",
"""    $('#st-backup').onclick = function () {
      const p = $('#backup-panel');
      p.hidden = !p.hidden;
      this.textContent = p.hidden ? 'เปิด' : 'ปิด';
    };
    $('#bk-fill').onclick = function () { $('#bk-text').value = S.exportJSON(); toast('ดึงข้อมูลออกมาแล้ว — คัดลอกเก็บไว้ได้เลย'); };
    $('#bk-copy').onclick = function () {
      const ta = $('#bk-text');
      if (!ta.value) ta.value = S.exportJSON();
      const done = function () { toast('คัดลอกแล้ว วางเก็บไว้ในโน้ตได้เลย'); };
      try {
        navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); toast('เลือกข้อความให้แล้ว กดคัดลอกเองได้เลย'); });
      } catch (e) { ta.select(); toast('เลือกข้อความให้แล้ว กดคัดลอกเองได้เลย'); }
    };
    $('#bk-restore').onclick = function () {
      const txt = ($('#bk-text').value || '').trim();
      if (!txt) { toast('วางข้อความสำรองลงช่องก่อนนะครับ'); return; }
      try { S.importJSON(txt); toast('กู้คืนเรียบร้อย'); renderSettings(); } catch (e) { toast('ข้อความไม่ถูกต้อง ลองคัดลอกมาใหม่'); }
    };
    let armed = false, armT = null;
    $('#st-reset').onclick = function () {
      if (!armed) {
        armed = true; this.textContent = 'กดอีกครั้งเพื่อยืนยัน';
        const b = this;
        armT = setTimeout(function () { armed = false; b.textContent = 'ล้าง'; }, 4000);
        return;
      }
      clearTimeout(armT); S.reset(); toast('ล้างความคืบหน้าแล้ว'); renderSettings();
    };""")

# ข้อความเรื่องไมค์ ให้ตรงกับบริบทของหน้าเว็บนี้
js = js.replace(
"""      '<div class="info-block"><b>ข้อจำกัดที่ต้องรู้เรื่องไมโครโฟน:</b><br>' +
      'บน Chrome/Android การให้คะแนนการออกเสียง<b>ต้องต่ออินเทอร์เน็ต</b> เพราะเสียงถูกส่งไปประมวลผลที่เซิร์ฟเวอร์ของ Google — ' +
      'ในจีนที่เข้า Google ไม่ได้ ฟีเจอร์นี้จะใช้ไม่ได้ถ้าไม่มี VPN ให้กด "ให้คะแนนเอง" แทน<br>' +
      'บน Safari/iOS ใช้ระบบของ Apple ซึ่งมักใช้งานได้ในจีน — <b>ถ้าคุณใช้ iPhone ให้เปิดแอปนี้ด้วย Safari</b><br>' +
      'ส่วนเสียงอ่าน 🔊 และการเรียนทุกอย่างที่เหลือ ใช้ได้ออฟไลน์ 100%</div>' +""",
"""      '<div class="info-block"><b>เรื่องไมโครโฟน:</b><br>' +
      (SP.asrSupported()
        ? 'เบราว์เซอร์นี้รองรับการให้คะแนนด้วยไมค์ แต่บน Chrome/Android <b>ต้องต่ออินเทอร์เน็ต</b> เพราะเสียงถูกส่งไปประมวลผลที่เซิร์ฟเวอร์ของ Google — ในจีนที่เข้า Google ไม่ได้ ให้กด “ให้คะแนนเอง” แทน<br>บน Safari/iOS ใช้ระบบของ Apple ซึ่งมักใช้งานได้ในจีน'
        : 'หน้านี้เปิดอยู่ในกรอบที่ปิดกั้นไมโครโฟน ปุ่มให้คะแนนด้วยเสียงจึงใช้ไม่ได้ที่นี่ — ทุกโหมดยังเรียนได้ครบ แค่ให้คะแนนตัวเอง<br><b>อยากได้ไมค์ให้ครบ:</b> บันทึกไฟล์ HTML ที่ได้รับลงเครื่อง แล้วเปิดตรงๆ หรือเอาขึ้นเว็บโฮสต์ของคุณเอง') +
      '<br>ส่วนเสียงอ่าน 🔊 และการเรียนทุกอย่างที่เหลือ ใช้ได้ตามปกติ</div>' +""")

# ---- โครงหน้าจอจาก index.html (ตัดแท็กเอกสารออก ตามข้อกำหนดของหน้าเว็บ) ----
html = read('index.html')
body = html[html.index('<div id="app">'):html.index('<script src=')].rstrip()

out = ('<title>说吧 พูดจีนได้</title>\n<style>\n' + css.strip() +
       '\n</style>\n\n' + body + '\n\n<script>\n' + js.strip() + '\n</script>\n')

dest = os.environ.get('SC_OUT', str(root / 'speak-chinese.html'))
pathlib.Path(dest).write_text(out, encoding='utf-8')
print('wrote', dest, len(out), 'bytes')
