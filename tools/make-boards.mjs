import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const P = Object.fromEntries(JSON.parse(await readFile('crawl/products.json','utf8')).map(p=>[p.id,p]));
const img = {};
for (const id of Object.keys(P)) {
  if (existsSync(`imgsrc/${id}.jpg`)) img[id] = 'data:image/jpeg;base64,' + (await readFile(`imgsrc/${id}.jpg`)).toString('base64');
}
await mkdir('out', {recursive:true});

const CSS = `
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=Noto+Serif+Thai:wght@600;700&display=swap">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:"IBM Plex Sans Thai",sans-serif;background:#fff;color:#14181C;-webkit-font-smoothing:antialiased}
.board{width:1200px;background:#F4F2EE;padding:44px 44px 34px;display:flex;flex-direction:column;gap:26px}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;border-bottom:3px solid #8C1C13;padding-bottom:16px}
.head h1{font-family:"Noto Serif Thai",serif;font-size:40px;font-weight:700;line-height:1.25;letter-spacing:-.01em}
.head .sub{font-size:17px;color:#5A6169;margin-top:8px;line-height:1.5;max-width:760px}
.brand{text-align:right;flex:0 0 auto}
.brand .n{font-family:"Noto Serif Thai",serif;font-size:22px;font-weight:700;color:#8C1C13;letter-spacing:.02em}
.brand .t{font-size:15px;color:#5A6169;margin-top:4px;font-variant-numeric:tabular-nums}
.grid{display:grid;gap:18px}
.c2{grid-template-columns:repeat(2,1fr)} .c3{grid-template-columns:repeat(3,1fr)}
.c4{grid-template-columns:repeat(4,1fr)} .c5{grid-template-columns:repeat(5,1fr)}
.card{background:#fff;border:1px solid #DDD8D0;overflow:hidden;display:flex;flex-direction:column}
.card .im{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:#E9E5DE}
.card .im.tall{aspect-ratio:3/4}
.card .b{padding:13px 14px 15px;display:flex;flex-direction:column;gap:5px;flex:1}
.card .nm{font-size:16px;font-weight:600;line-height:1.35}
.card .de{font-size:13.5px;color:#5A6169;line-height:1.5}
.card .pr{font-size:19px;font-weight:700;color:#8C1C13;font-variant-numeric:tabular-nums;margin-top:auto;padding-top:6px}
.card .pr small{font-size:13px;font-weight:500;color:#5A6169}
.tag{display:inline-block;font-size:12px;font-weight:600;letter-spacing:.04em;padding:3px 9px;border-radius:2px;align-self:flex-start}
.t-th{background:#E2EDE6;color:#2F5F44} .t-im{background:#F6EDDC;color:#8A5E17}
.t-hi{background:#F5E4E1;color:#8C1C13} .t-nu{background:#E8EAED;color:#4C555E}
.foot{display:flex;justify-content:space-between;align-items:center;font-size:14.5px;color:#5A6169;border-top:1px solid #DDD8D0;padding-top:14px}
.foot b{color:#14181C;font-weight:600}
.note{background:#fff;border-left:4px solid #A2701F;padding:14px 18px;font-size:15px;line-height:1.6;color:#3A424A}
/* ── info boards ── */
.rows{display:flex;flex-direction:column;gap:14px}
.row{background:#fff;border:1px solid #DDD8D0;display:grid;grid-template-columns:210px 1fr;align-items:stretch}
.row .im{width:210px;height:150px;object-fit:cover;display:block}
.row .b{padding:16px 20px;display:flex;flex-direction:column;justify-content:center;gap:6px}
.row .nm{font-size:20px;font-weight:600}
.row .de{font-size:15px;color:#4C555E;line-height:1.6}
.row .pr{font-size:18px;font-weight:700;color:#8C1C13;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;background:#fff;font-size:16px}
th,td{border:1px solid #DDD8D0;padding:12px 14px;text-align:left}
thead th{background:#14181C;color:#fff;font-weight:600;font-size:15px}
td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
tbody tr:nth-child(even){background:#FAF9F7}
.do{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.do>div{background:#fff;border:1px solid #DDD8D0;padding:20px 22px}
.do h3{font-size:21px;margin-bottom:12px;font-weight:700}
.do.g h3{color:#2F5F44} .do .bad h3{color:#8C1C13}
.do ul{list-style:none;display:flex;flex-direction:column;gap:9px}
.do li{font-size:15.5px;line-height:1.55;padding-left:24px;position:relative;color:#3A424A}
.do li::before{position:absolute;left:0;font-weight:700}
.ok li::before{content:"✓";color:#2F5F44} .bad li::before{content:"✕";color:#8C1C13}
.sw{display:flex;gap:0;border:1px solid #DDD8D0}
.sw>div{flex:1;position:relative}
.sw img{width:100%;height:280px;object-fit:cover;display:block}
.sw .lb{position:absolute;left:0;bottom:0;right:0;background:rgba(20,24,28,.82);color:#fff;padding:10px 14px}
.sw .lb b{display:block;font-size:18px;font-weight:600}
.sw .lb span{font-size:13.5px;opacity:.85}
.sizes{display:flex;align-items:flex-end;gap:26px;background:#fff;border:1px solid #DDD8D0;padding:28px}
.sz{text-align:center}
.sz .box{border:2px solid #14181C;overflow:hidden;position:relative}
.sz .box img{width:100%;height:100%;object-fit:cover;display:block}
.sz .cap{margin-top:10px;font-size:16px;font-weight:600}
.sz .cap small{display:block;font-size:13.5px;color:#5A6169;font-weight:500;margin-top:2px}
.pat{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.pat .p{background:#fff;border:1px solid #DDD8D0;padding:16px}
.pat .p h3{font-size:18px;margin-bottom:10px}
.pat .p .cv{width:100%;height:200px;display:block}
.pat .p .de{font-size:14px;color:#5A6169;line-height:1.5;margin-top:10px}
</style>`;

function head(title, sub){return `<div class="head"><div><h1>${title}</h1>${sub?`<div class="sub">${sub}</div>`:''}</div>
<div class="brand"><div class="n">SIAM STONE</div><div class="t">หินอ่อน.com<br>065-567-8989</div></div></div>`;}
function foot(t){return `<div class="foot"><div>${t}</div><div><b>หินอ่อน.com</b> · โทร 065-567-8989 · LINE @saimstone456</div></div>`;}
function card(id,{name,desc,price,tag,tall}={}){
  const p=P[id]||{};
  return `<div class="card"><img class="im${tall?' tall':''}" src="${img[id]||''}" alt="">
  <div class="b">${tag?`<span class="tag ${tag[0]}">${tag[1]}</span>`:''}
  <div class="nm">${name||p.name}</div>${desc?`<div class="de">${desc}</div>`:''}
  ${price!==false?`<div class="pr">${price||Number(p.price).toLocaleString()} <small>${price?'':'บาท/ตร.ม.'}</small></div>`:''}</div></div>`;}
function row(id,{name,desc,price}={}){const p=P[id]||{};
  return `<div class="row"><img class="im" src="${img[id]||''}" alt=""><div class="b">
  <div class="nm">${name||p.name}</div><div class="de">${desc||''}</div><div class="pr">${price||''}</div></div></div>`;}

const BOARDS = [];
const B=(file,title,body)=>BOARDS.push({file,title,body});

// 1 หินขาว
B('01-marble-white','หินอ่อนสีขาว เทียบกัน 4 ตัว',
 `${head('หินอ่อนสีขาว เทียบกัน 4 ตัว','ขาวไม่ได้ขาวเหมือนกัน ต่างกันที่ปริมาณลาย สีของเส้นแร่ และราคา — เทียบจากแผ่นจริงในสต๊อก')}
 <div class="grid c4">
 ${card('7',{name:'ไวท์คาราร่า (อิตาลี)',desc:'ขาวนวล ลายเส้นเทาบางและน้อย เรียบร้อยที่สุด',tag:['t-im','นำเข้า']})}
 ${card('5',{name:'ไวท์วอลาคัส (กรีซ)',desc:'ขาวสว่าง เส้นแร่เทาอมม่วงเป็นทาง ลายชัดกว่าคาราร่า',tag:['t-im','นำเข้า']})}
 ${card('62',{name:'ขาวหิมาลัย',desc:'ขาวเนื้อละเอียด ลายน้อยเกือบเรียบ คุ้มค่าที่สุด',price:'1,950',tag:['t-im','นำเข้า']})}
 ${card('2',{name:'ขาวเทาลายเมฆ (ไทย)',desc:'ขาวลายเทาพลิ้วคล้ายเมฆ ราคาย่อมเยาที่สุด',tag:['t-th','หินไทย']})}
 </div>
 <div class="note">ลายยิ่งน้อยยิ่งเหมาะกับพื้นที่กว้าง เพราะต่อแผ่นแล้วดูเป็นเนื้อเดียวกัน ลายยิ่งมากยิ่งเหมาะกับผนังโชว์แผ่นเดียวที่ต้องการให้เป็นจุดสนใจ</div>
 ${foot('ราคาต่อตารางเมตร ยังไม่รวมค่าขนส่งและติดตั้ง · หินธรรมชาติแต่ละแผ่นลายไม่ซ้ำกัน')}`);

// 2 หินดำ
B('02-stone-black','หินสีดำ เทียบกัน 5 ตัว',
 `${head('หินสีดำ เทียบกัน 5 ตัว','หินอ่อนดำสวยกว่า หินแกรนิตดำทนกว่า — เลือกจากงานที่จะใช้ ไม่ใช่จากรูป')}
 <div class="grid c5">
 ${card('10',{name:'แบล็คมาคีน่า',desc:'หินอ่อน ดำสนิท เส้นขาวคม',tag:['t-nu','หินอ่อน']})}
 ${card('6',{name:'ดำพระลาน (ไทย)',desc:'หินอ่อน ดำเทา เส้นขาวเทา',tag:['t-th','หินไทย']})}
 ${card('17',{name:'แกรนิตดำจีน',desc:'ดำสม่ำเสมอ แทบไม่มีลาย',tag:['t-hi','แกรนิต']})}
 ${card('18',{name:'แกรนิตดำอินเดีย G20',desc:'ดำลึกที่สุด เนื้อแน่น',tag:['t-hi','แกรนิต']})}
 ${card('67',{name:'แกรนิตดำเกล็ดทอง',desc:'ดำ ประกายทองทั่วแผ่น',tag:['t-hi','แกรนิต']})}
 </div>
 <div class="note"><b>ท็อปครัวต้องเป็นหินแกรนิตเท่านั้น</b> หินอ่อนดำสวยกว่าแต่ไวต่อกรด โดนน้ำมะนาวหรือน้ำส้มสายชูแล้วผิวจะด้านเป็นรอยถาวร</div>
 ${foot('ราคาต่อตารางเมตร · หินดำผิวขัดมันเห็นรอยนิ้วมือชัดที่สุดในบรรดาหินทุกสี')}`);

// 3 ผิว 3 แบบ
B('03-surface-finish','ผิวหิน 3 แบบ ต่างกันอย่างไร',
 `${head('ผิวหิน 3 แบบ ต่างกันอย่างไร','หินก้อนเดียวกัน แต่แต่งผิวคนละแบบ ใช้งานคนละที่ — นี่คือเรื่องที่ลูกค้าถามมากที่สุด')}
 <div class="sw">
  <div><img src="${img['21']||''}" alt=""><div class="lb"><b>พ่นทราย (Sand Blasted)</b><span>ผิวหยาบ ปรับระดับความขรุขระได้ — พื้น ผนัง ขอบสระ</span></div></div>
  <div><img src="${img['22']||''}" alt=""><div class="lb"><b>พ่นไฟปั่นแปรง (Flamed &amp; Brushed)</b><span>หยาบแต่ไม่บาดเท้า — ทางเดิน ระเบียง รอบสระ</span></div></div>
  <div><img src="${img['66']||''}" alt=""><div class="lb"><b>ขัดมัน (Polished)</b><span>เรียบเงา สวยที่สุด แต่ลื่นเมื่อเปียก — ภายในและผนัง</span></div></div>
 </div>
 <div class="note"><b>กฎง่าย ๆ:</b> พื้นที่เปียกน้ำหรือกลางแจ้ง ห้ามใช้ผิวขัดมัน · เดินเท้าเปล่าให้เลือกพ่นไฟปั่นแปรง · ต้องการฝืดที่สุดให้เลือกพ่นทราย</div>
 ${foot('รูปทั้งหมดถ่ายจากแผ่นจริงในสต๊อก SIAM STONE')}`);

// 4 หินไทย vs นำเข้า
B('04-thai-vs-import','หินอ่อนไทย เทียบ หินอ่อนนำเข้า',
 `${head('หินอ่อนไทย เทียบ หินอ่อนนำเข้า','ต่างกันมากกว่าราคา — ต่างที่ลาย ที่ขนาดแผ่นที่หาได้ และที่ความต่อเนื่องของลายในงานใหญ่')}
 <table><thead><tr><th>หิน</th><th>แหล่ง</th><th>ลักษณะเด่น</th><th style="text-align:right">ราคา (บาท/ตร.ม.)</th></tr></thead><tbody>
 <tr><td>ขาวเทาลายเมฆ CWM</td><td>ไทย</td><td>ขาวลายเทาพลิ้ว ลายเยอะ กลบรอยได้ดี</td><td class="n">1,100</td></tr>
 <tr><td>ชมพูทับกวาง TKM</td><td>ไทย · สระบุรี</td><td>ชมพูอมส้ม สีที่หินนำเข้าไม่มี</td><td class="n">1,100</td></tr>
 <tr><td>ดำพระลาน HPB</td><td>ไทย · สระบุรี</td><td>ดำเทา เส้นขาว ราคาเข้าถึงได้</td><td class="n">1,100</td></tr>
 <tr><td>ขาวหิมาลัย HWM</td><td>นำเข้า</td><td>ขาวเนื้อละเอียด ลายน้อย</td><td class="n">1,950</td></tr>
 <tr><td>เขียวอิตาลี GIM</td><td>นำเข้า · อิตาลี</td><td>เขียวเข้ม เส้นขาวร่างแห</td><td class="n">1,990</td></tr>
 <tr><td>แบล็คมาคีน่า BMM</td><td>นำเข้า</td><td>ดำสนิท เส้นขาวคม</td><td class="n">2,450</td></tr>
 <tr><td>ไวท์คาราร่า WCM</td><td>นำเข้า · อิตาลี</td><td>ขาวนวล ลายน้อย ชื่อที่ลูกค้ารู้จัก</td><td class="n">3,900</td></tr>
 <tr><td>ไวท์วอลาคัส WVM</td><td>นำเข้า · กรีซ</td><td>ขาว เส้นเทาอมม่วง สแลปแผ่นใหญ่</td><td class="n">4,400</td></tr>
 </tbody></table>
 <div class="note">หินไทยราคาต่ำกว่านำเข้า 2–4 เท่า และในงานปูพื้นทั่วไปที่ไม่ได้ดูใกล้ ๆ ความต่างมักไม่คุ้มส่วนต่าง — เลือกนำเข้าเมื่อต้องการลายต่อเนื่องเป็นผืนใหญ่ หรือเมื่อชื่อหินมีผลกับลูกค้าปลายทาง</div>
 ${foot('ราคา ณ ปี 2024 · โทรสอบถามราคาปัจจุบันและราคางานปริมาณมาก')}`);

// 5 ศิลาแลง
B('05-laterite-sizes','ศิลาแลงกำแพงเพชร 4 ขนาด',
 `${head('ศิลาแลงกำแพงเพชร 4 ขนาด','ขนาดใหญ่ขึ้น ราคาต่อก้อนแพงขึ้น แต่ค่าแรงปูถูกลง — เทียบก่อนสั่ง')}
 <div class="grid c4">
 ${card('26',{name:'20 × 40 ซม.',desc:'ก้อนเล็ก เก็บงานโค้งและรายละเอียดได้ดีที่สุด',price:'35 <small>บาท/ก้อน</small>'})}
 ${card('28',{name:'30 × 30 ซม.',desc:'ขนาดยอดนิยม สมดุลระหว่างจำนวนก้อนกับความง่ายในการปู',price:'65 <small>บาท/ก้อน</small>'})}
 ${card('27',{name:'40 × 40 ซม.',desc:'ค่าแรงต่อตารางเมตรถูกที่สุด ร่องน้อย ดูเป็นผืนเดียว',price:'120 <small>บาท/ก้อน</small>'})}
 ${card('29',{name:'50 × 50 ซม.',desc:'สัดส่วนใหญ่สมกับลานโล่ง แต่แพงที่สุดต่อตารางเมตร',price:'350 <small>บาท/ก้อน</small>'})}
 </div>
 <div class="note"><b>คิดต่อตารางเมตรก่อนเลือก:</b> ขนาด 40×40 ซม. ใช้ราว 6.25 ก้อน/ตร.ม. ส่วน 50×50 ซม. ใช้ 4 ก้อน/ตร.ม. — ราคาต่อก้อนที่ต่างกันเกือบ 3 เท่าทำให้ 50×50 แพงกว่าต่อพื้นที่อย่างชัดเจน เลือกเมื่อต้องการสัดส่วนใหญ่จริง ๆ ไม่ใช่เพื่อประหยัด</div>
 ${foot('ศิลาแลงแท้จากบ่อกำแพงเพชร ไม่ย้อมสี · ผิวพรุนไม่ลื่นแม้ตอนฝนตก')}`);

// 6 หญ้าเทียม
B('06-grass-heights','หญ้าเทียม 4 ความสูง เลือกอย่างไร',
 `${head('หญ้าเทียม 4 ความสูง เลือกอย่างไร','ขนยิ่งสูงยิ่งเหมือนหญ้าจริง แต่ยิ่งต้องดูแล — เลือกจากการใช้งาน ไม่ใช่จากรูป')}
 <div class="rows">
 ${row('33',{name:'ขน 2 ซม. (20 มม.)',desc:'ดูแลง่ายที่สุด ไม่ล้มเป็นรอยเท้า — ทางเดิน ระเบียง ดาดฟ้า พื้นที่คนผ่านทุกวัน',price:'260 บาท/ตร.ม.'})}
 ${row('34',{name:'ขน 3 ซม. (30 มม.)',desc:'ขายดีที่สุด สมดุลระหว่างความเหมือนจริงกับการดูแล — สนามหน้าบ้าน สวนหลังบ้าน',price:'300 บาท/ตร.ม.'})}
 ${row('35',{name:'ขน 3.5 ซม. (35 มม.)',desc:'ฟูขึ้นชัดเจนในระดับสายตา — สวนโชว์ มุมถ่ายรูป สนามเด็กเล่น',price:'320 บาท/ตร.ม.'})}
 ${row('36',{name:'ขน 4 ซม. (40 มม.)',desc:'ฟูที่สุด ต้องหวีบ่อยที่สุด เห็นรอยเท้าชัดที่สุด — พื้นที่ชม ไม่ใช่พื้นที่เดิน',price:'340 บาท/ตร.ม.'})}
 </div>
 ${foot('หน้ากว้าง 2 เมตร ตัดตามความยาว ยาวสุด 25 เมตรต่อม้วน · ทนแดดทนฝน')}`);

// 7 ลูกกรง
B('07-balusters','ลูกกรงหินอ่อน 5 แบบ',
 `${head('ลูกกรงหินอ่อน 5 แบบ','กลึงจากหินอ่อนแท้ ไม่ใช่ปูนหล่อหรือไฟเบอร์ — เลือกความสูงจากมาตรฐานราวกันตก ไม่ใช่จากความชอบ')}
 <div class="grid c5">
 ${card('39',{name:'ขาว สูง 60 ซม.',desc:'ราวระเบียงเตี้ย รั้วตกแต่ง',price:'1,400 <small>บาท/ต้น</small>',tall:1})}
 ${card('41',{name:'ขาว สูง 65 ซม.',desc:'ยอดนิยม — รวมราวจับแล้วได้ ~90 ซม.',price:'1,500 <small>บาท/ต้น</small>',tall:1})}
 ${card('40',{name:'ขาว สูง 70 ซม.',desc:'ราวกันตกชั้นบน ดาดฟ้า',price:'1,600 <small>บาท/ต้น</small>',tall:1})}
 ${card('42',{name:'เขียวอิตาลี 65 ซม.',desc:'ราวที่เป็นจุดสนใจ ขับงานทอง',price:'2,000 <small>บาท/ต้น</small>',tall:1})}
 ${card('43',{name:'ส้มฟลอเรนซ์ 65 ซม.',desc:'บ้านโทนครีม อิฐ ไม้ สไตล์ยุโรป',price:'2,000 <small>บาท/ต้น</small>',tall:1})}
 </div>
 <div class="note"><b>ความปลอดภัยที่ต้องรู้:</b> ราวกันตกสำหรับพื้นที่สูงจากพื้นเกิน 1 เมตร มาตรฐานทั่วไปกำหนดความสูงรวม 90–110 ซม. และช่องว่างระหว่างลูกกรงไม่เกิน 9 ซม. เพื่อไม่ให้เด็กลอดได้ — แจ้งความยาวราวมา เราคำนวณจำนวนต้นให้</div>
 ${foot('ราคาต่อต้น · งานราวกันตกจริงควรมีคานคอนกรีตหรือเหล็กเสริมด้านใน')}`);

// 8 เสาโชว์
B('08-pedestals','เสาโชว์หินอ่อน 5 แบบ',
 `${head('เสาโชว์หินอ่อน 5 แบบ','แกะจากหินอ่อนแท้ทั้งต้น — เลือกความสูงจากสัดส่วนของห้อง และสีจากของที่จะวาง')}
 <div class="grid c5">
 ${card('44',{name:'ไวท์คาราร่า 80 ซม.',desc:'ของขนาดกลาง ระดับสายตาคนยืน',price:'12,000 <small>บาท/ต้น</small>',tall:1})}
 ${card('45',{name:'ไวท์คาราร่า 100 ซม.',desc:'ของโชว์ชิ้นสำคัญ ตั้งคู่ขนาบทางเข้า',price:'14,000 <small>บาท/ต้น</small>',tall:1})}
 ${card('48',{name:'เขียวอิตาลี 80 ซม.',desc:'ห้องพระ ขับองค์พระสีทอง',price:'12,000 <small>บาท/ต้น</small>',tall:1})}
 ${card('47',{name:'เขียวอิตาลี 100 ซม.',desc:'องค์พระอยู่ระดับสายตาพอดี',price:'14,000 <small>บาท/ต้น</small>',tall:1})}
 ${card('46',{name:'เขียวอิตาลี 120 ซม.',desc:'พื้นที่ฝ้าสูง ล็อบบี้ โถงบันได',price:'16,000 <small>บาท/ต้น</small>',tall:1})}
 </div>
 <div class="note">ตั้งเป็นคู่ต้องสั่งพร้อมกันจากล็อตเดียวกัน เพราะหินธรรมชาติสีและลายไม่เท่ากันในแต่ละล็อต ตั้งคู่แล้วลายไม่เข้ากันจะเห็นชัดมาก · เสาสูง 120 ซม. ต้องยึดฐานกับพื้นทุกกรณี</div>
 ${foot('ราคาต่อต้น · สอบถามน้ำหนักและวิธีขนส่งก่อนสั่ง')}`);

// 9 หินปูสระ
B('09-pool-stone','หินปูสระว่ายน้ำ 3 แบบ',
 `${head('หินปูสระว่ายน้ำ 3 แบบ','งานสระมีกฎอยู่ 2 ข้อ: ต้องกันลื่น และต้องไม่ร้อนเท้า — ทุกอย่างที่เหลือคือรสนิยม')}
 <div class="grid c3">
 ${card('24',{name:'ขาวเทาลายเมฆ 10×10 ซม.',desc:'แผ่นเล็ก เก็บงานโค้งรอบสระได้ดีที่สุด',price:'1,250 <small>บาท/ตร.ม.</small>'})}
 ${card('54',{name:'บลูแซนด์ 10×10 ซม.',desc:'โทนเทาอมฟ้า ขับสีน้ำในสระให้ใสขึ้น',price:'1,400 <small>บาท/ตร.ม.</small>'})}
 ${card('55',{name:'ขาวเทาลายเมฆ 20×20 ซม.',desc:'แผ่นใหญ่ ร่องยาแนวน้อย ทำความสะอาดง่าย',price:'1,500 <small>บาท/ตร.ม.</small>'})}
 </div>
 <div class="note"><b>เคล็ดลับประหยัด:</b> ใช้แผ่น 20×20 ซม. สำหรับพื้นแนวตรง แล้วใช้ 10×10 ซม. เก็บเฉพาะขอบโค้ง จะประหยัดกว่าใช้ขนาดเดียวทั้งงาน เพราะแผ่นใหญ่ที่ต้องตัดตามโค้งจะเสียเศษเยอะ</div>
 ${foot('ห้ามใช้ผิวขัดมันรอบสระเด็ดขาด · ตรวจระดับคลอรีนให้อยู่ในเกณฑ์ปกติเพื่อไม่ให้กัดผิวหิน')}`);

// 10 FLEX STONE
B('10-flexstone','FLEX STONE แผ่นหินยืดหยุ่น 3 ลาย',
 `${head('FLEX STONE แผ่นหินยืดหยุ่น 3 ลาย','หนา 3–5 มม. ดัดโค้งได้ 20–60 องศา ติดกาวบนผนังได้เลยโดยไม่ต้องเสริมโครงสร้าง')}
 <div class="grid c3">
 ${card('68',{name:'Light Travertine',desc:'ครีมอมเบจ โทนอบอุ่นอ่อน เข้ากับงานไม้และผนังขาว',price:'920 <small>บาท/ตร.ม.</small>'})}
 ${card('74',{name:'Grey Travertine',desc:'เทา ลายเส้นแนวนอนชัด เข้ากับงานโมเดิร์นได้ง่ายที่สุด',price:'920 <small>บาท/ตร.ม.</small>'})}
 ${card('75',{name:'Rusty Red',desc:'แดงอมน้ำตาล ให้ความรู้สึกหินเก่า เหมาะกับคาเฟ่และลอฟต์',price:'920 <small>บาท/ตร.ม.</small>'})}
 </div>
 <div class="note"><b>บอกตรง ๆ:</b> นี่ไม่ใช่หินธรรมชาติ ลายจะซ้ำกันตามแม่พิมพ์ ต่างจากหินจริงที่ไม่ซ้ำเลย — ข้อดีคือน้ำหนักเบามาก จึงใช้ได้กับผนังอาคารสูงและงานรีโนเวทที่โครงสร้างเดิมรับน้ำหนักหินจริงไม่ไหว</div>
 ${foot('ขนาด 1200×600 มม. · สั่ง 100 แผ่นขึ้นไปมีราคาพิเศษ · โทร 062-559-9000')}`);

// 11 หินจิ๊กซอ
B('11-slate-wall','หินจิ๊กซอปูผนัง 3 สี',
 `${head('หินจิ๊กซอปูผนัง 3 สี','แผงหินสำเร็จ เรียงต่อกันได้เลย ผิวหน้าแตกตามธรรมชาติ ให้ผนังมีมิติเวลาแสงตกกระทบ')}
 <div class="grid c3">
 ${card('30',{name:'Milky White',desc:'ขาวนวล ผนังมีมิติแต่ยังสว่าง ไม่ทำให้ห้องแคบ',price:'1,200 <small>บาท/ตร.ม.</small>'})}
 ${card('31',{name:'Slate Stone ดำเทา',desc:'ดำเทา เส้นแนวนอนชัด ขับต้นไม้และไฟส่องได้ดี',price:'1,200 <small>บาท/ตร.ม.</small>'})}
 ${card('32',{name:'Galaxy Black',desc:'ดำเหลือบประกาย มิติมากที่สุด ต้องมีไฟส่องถึงจะเด่น',price:'1,200 <small>บาท/ตร.ม.</small>'})}
 </div>
 <div class="note"><b>วางแผนไฟไปพร้อมกับเลือกหิน:</b> ผนังหินจิ๊กซอจะเห็นมิติก็ต่อเมื่อมีไฟส่องเฉียงจากด้านบนหรือด้านล่าง ถ้าห้องมีแสงกระจายสม่ำเสมออย่างเดียว ผนังจะดูแบนและเสียของ</div>
 ${foot('ผิวหยาบเก็บฝุ่นมากกว่าผนังเรียบ ไม่แนะนำหลังเตาหรือจุดที่ต้องเช็ดบ่อย')}`);

// 12 หินกรวด
B('12-pebbles','หินกรวดแต่งสวน 3 ขนาด',
 `${head('หินกรวดแต่งสวน 3 ขนาด','กรวดหินอ่อนสีขาว คัดขนาด ผิวมนไม่บาดมือ — ขายเป็นกิโลกรัม')}
 <div class="grid c3">
 ${card('49',{name:'ขนาดเล็ก S',desc:'โรยหน้ากระถาง รอบโคนต้นไม้ เก็บงานตามซอก — แต่ปลิวง่าย ต้องมีขอบกั้น',price:'25 <small>บาท/กก.</small>'})}
 ${card('52',{name:'ขนาดกลาง M',desc:'ใช้งานได้หลากหลายที่สุด สวนหิน ทางเดิน ขอบแปลง',price:'28 <small>บาท/กก.</small>'})}
 ${card('53',{name:'ขนาดใหญ่ XL',desc:'สวนหินญี่ปุ่น ริมน้ำ ที่ลมแรง — ไม่ปลิว แต่เดินเท้าเปล่าไม่สบาย',price:'30 <small>บาท/กก.</small>'})}
 </div>
 <div class="note"><b>ต้องปูแผ่นกันวัชพืชรองใต้กรวดตั้งแต่แรก</b> ไม่งั้นหญ้าจะขึ้นแทรกและแก้ทีหลังยากมาก · กรวดขาวที่หม่นจากฝุ่น ล้างด้วยน้ำแรงดันปีละครั้งจะกลับมาขาวเหมือนเดิม</div>
 ${foot('เม็ดใหญ่ครอบคลุมพื้นที่ต่อกิโลกรัมได้น้อยกว่าเม็ดเล็ก — โทรให้เราคำนวณน้ำหนักที่ต้องใช้')}`);

// ── 13 ขนาดแผ่น ──
const tex = img['20']||'';
B('13-slab-sizes','ขนาดแผ่นมาตรฐาน เทียบสัดส่วนจริง',
 `${head('ขนาดแผ่นมาตรฐาน เทียบสัดส่วนจริง','แผ่นใหญ่ = ร่องยาแนวน้อยลง ดูเป็นผืนเดียวกันมากขึ้น ติดตั้งเร็วขึ้น แต่ต้องปรับระดับพื้นให้เรียบกว่า')}
 <div class="sizes">
  <div class="sz"><div class="box" style="width:150px;height:150px"><img src="${tex}"></div>
   <div class="cap">30 × 30 ซม.<small>11.1 แผ่น/ตร.ม.</small></div></div>
  <div class="sz"><div class="box" style="width:150px;height:300px"><img src="${tex}"></div>
   <div class="cap">30 × 60 ซม.<small>5.6 แผ่น/ตร.ม.</small></div></div>
  <div class="sz"><div class="box" style="width:300px;height:300px"><img src="${tex}"></div>
   <div class="cap">60 × 60 ซม.<small>2.8 แผ่น/ตร.ม.</small></div></div>
  <div class="sz" style="flex:1"><div class="box" style="width:100%;height:300px;border-style:dashed"><img src="${tex}" style="opacity:.55"></div>
   <div class="cap">สั่งตัดตามขนาด<small>หน้ากว้างเกิน 60 ซม. คิดราคาสั่งตัด</small></div></div>
 </div>
 <div class="note"><b>วิธีคำนวณ:</b> จำนวนแผ่น = พื้นที่ (ตร.ม.) ÷ พื้นที่ต่อแผ่น แล้ว<b>บวกเผื่อเสีย 5–10%</b> สำหรับการตัดขอบและแผ่นที่แตกระหว่างติดตั้ง งานที่มีมุมเยอะหรือปูลายเฉียงให้เผื่อ 15%</div>
 ${foot('ความหนามาตรฐาน 2 ซม. · ทุกขนาดสั่งตัดตามแบบได้')}`);

// ── 14 ลายปู ──
const patSVG = (kind, t) => {
  const W=340,H=200; let r='';
  if (kind==='running') { const bw=80,bh=40; for(let y=0,i=0;y<H;y+=bh,i++){ const off=(i%2)?-bw/2:0;
    for(let x=off;x<W;x+=bw) r+=`<rect x="${x+2}" y="${y+2}" width="${bw-4}" height="${bh-4}" fill="url(#tx)" stroke="#8C1C13" stroke-width="1.5"/>`;}}
  else if (kind==='stack'){ const bw=68,bh=40; for(let y=0;y<H;y+=bh) for(let x=0;x<W;x+=bw)
    r+=`<rect x="${x+2}" y="${y+2}" width="${bw-4}" height="${bh-4}" fill="url(#tx)" stroke="#8C1C13" stroke-width="1.5"/>`;}
  else { const bw=68,bh=30; for(let y=-40;y<H+40;y+=bh) for(let x=-40;x<W+40;x+=bw*2){
    r+=`<rect x="${x}" y="${y}" width="${bw-3}" height="${bh-3}" fill="url(#tx)" stroke="#8C1C13" stroke-width="1.5" transform="rotate(45 ${x+bw/2} ${y+bh/2})"/>`;
    r+=`<rect x="${x+bw}" y="${y}" width="${bw-3}" height="${bh-3}" fill="url(#tx)" stroke="#8C1C13" stroke-width="1.5" transform="rotate(-45 ${x+bw*1.5} ${y+bh/2})"/>`;}}
  return `<svg class="cv" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${t}">
    <defs><pattern id="tx" patternUnits="userSpaceOnUse" width="${W}" height="${H}">
    <image href="${img['25']||''}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/></pattern></defs>
    <rect width="${W}" height="${H}" fill="#E9E5DE"/><g clip-path="url(#c)">${r}</g>
    <clipPath id="c"><rect width="${W}" height="${H}"/></clipPath></svg>`;
};
B('14-laying-patterns','ลายปู 3 แบบ ที่ใช้บ่อยที่สุด',
 `${head('ลายปู 3 แบบ ที่ใช้บ่อยที่สุด','แผ่นหินแบบเดียวกัน ปูคนละลาย ได้ผลลัพธ์คนละอย่าง และเสียเศษไม่เท่ากัน')}
 <div class="pat">
  <div class="p"><h3>แนวอิฐ (Running Bond)</h3>${patSVG('running','แนวอิฐ')}
   <div class="de">เหลื่อมครึ่งแผ่นทุกแถว ปกปิดความไม่เท่ากันของแผ่นได้ดีที่สุด เสียเศษน้อย เป็นลายที่ปลอดภัยที่สุดถ้าไม่แน่ใจ</div></div>
  <div class="p"><h3>แนวตรง (Stack Bond)</h3>${patSVG('stack','แนวตรง')}
   <div class="de">เรียงตรงทุกแถว ดูโมเดิร์นเรียบร้อย แต่ต้องการแผ่นที่ขนาดเท่ากันเป๊ะและพื้นเรียบจริง ไม่งั้นแนวจะเบี้ยวเห็นชัด</div></div>
  <div class="p"><h3>ก้างปลา (Herringbone)</h3>${patSVG('herring','ก้างปลา')}
   <div class="de">เฉียง 45 องศา สวยและแพงที่สุด เพราะต้องตัดขอบทุกด้าน เสียเศษ 15–20% และค่าแรงสูงกว่าลายอื่นมาก</div></div>
 </div>
 <div class="note"><b>สั่งของเผื่อไม่เท่ากัน:</b> แนวอิฐและแนวตรงเผื่อ 5–10% · ก้างปลาเผื่อ 15–20% — แจ้งลายที่จะปูมาตอนสั่ง เราจะคำนวณเผื่อให้ถูก</div>
 ${foot('ภาพลายใช้พื้นผิวจากหินแกรนิตขาววินเซนต์จริงในสต๊อก')}`);

// ── 15 หินไหนเหมาะห้องไหน ──
B('15-room-guide','หินไหน เหมาะกับห้องไหน',
 `${head('หินไหน เหมาะกับห้องไหน','คำถามที่ลูกค้าถามมากที่สุด — ตอบด้วยตารางเดียวจบ')}
 <table><thead><tr><th>พื้นที่</th><th>แนะนำ</th><th>ผิวที่ควรใช้</th><th>ห้ามใช้</th></tr></thead><tbody>
 <tr><td><b>ท็อปครัว</b></td><td>หินแกรนิตดำจีน / ดำอินเดีย / ขาวไข่มุก</td><td>ขัดมัน</td><td>หินอ่อนทุกชนิด (ไวต่อกรด)</td></tr>
 <tr><td><b>พื้นห้องนั่งเล่น</b></td><td>หินอ่อนขาวหิมาลัย / ขาวเทาลายเมฆ</td><td>ขัดมัน</td><td>—</td></tr>
 <tr><td><b>ผนังโชว์</b></td><td>เขียวอิตาลี / แบล็คมาคีน่า / หินจิ๊กซอ</td><td>ขัดมัน หรือผิวแตก</td><td>—</td></tr>
 <tr><td><b>บันไดภายใน</b></td><td>หินแกรนิตทุกสี</td><td>ขัดมัน (มีร่องกันลื่นที่จมูกบันได)</td><td>หินอ่อนเนื้อนุ่ม</td></tr>
 <tr><td><b>บันไดภายนอก</b></td><td>ขาวไข่มุก / ขาววินเซนต์</td><td>พ่นไฟ หรือพ่นทราย</td><td>ขัดมันทุกชนิด</td></tr>
 <tr><td><b>รอบสระว่ายน้ำ</b></td><td>หินปูสระ 10×10 / 20×20 ซม.</td><td>กันลื่นเท่านั้น</td><td>ขัดมัน · หินสีเข้ม (ร้อนเท้า)</td></tr>
 <tr><td><b>ทางเดิน ลานจอดรถ</b></td><td>Cobble Stone / ศิลาแลง</td><td>พ่นไฟ / ผิวธรรมชาติ</td><td>ขัดมัน</td></tr>
 <tr><td><b>พื้นวัด ศาสนสถาน</b></td><td>ขาวหิมาลัย (ในอาคาร) · ศิลาแลง (ลานกลางแจ้ง)</td><td>ขัดมัน / ผิวธรรมชาติ</td><td>ขัดมันในลานกลางแจ้ง</td></tr>
 <tr><td><b>ห้องพระ</b></td><td>เขียวอิตาลี · แกรนิตดำเกล็ดทอง</td><td>ขัดมัน</td><td>—</td></tr>
 <tr><td><b>ผนังอาคารสูง / รีโนเวท</b></td><td>FLEX STONE (น้ำหนักเบา)</td><td>—</td><td>หินจริงหนา 2 ซม. หากโครงสร้างรับไม่ไหว</td></tr>
 </tbody></table>
 ${foot('ไม่แน่ใจว่าหน้างานคุณเข้าข้อไหน โทรถามได้ ปรึกษาฟรี 065-567-8989')}`);

// ── 16 ดูแลรักษา ──
B('16-marble-care','ดูแลหินอ่อนอย่างไรให้อยู่ได้ 20 ปี',
 `${head('ดูแลหินอ่อนอย่างไรให้อยู่ได้ 20 ปี','หินอ่อนไม่ได้พังเพราะเก่า แต่พังเพราะโดนกรด — เรื่องเดียวที่ต้องจำ')}
 <div class="do g">
  <div class="ok"><h3>ทำได้</h3><ul>
   <li>เช็ดด้วยน้ำสะอาดหรือน้ำยาสำหรับหินธรรมชาติโดยเฉพาะ</li>
   <li>เช็ดคราบที่หกทันที โดยเฉพาะน้ำผลไม้ ไวน์ กาแฟ</li>
   <li>เคลือบน้ำยากันซึมทุก 1–2 ปีสำหรับพื้นที่ใช้งานหนัก</li>
   <li>ใช้ผ้าไมโครไฟเบอร์แห้งเช็ดหินสีเข้มเพื่อลดรอยนิ้วมือ</li>
   <li>วางพรมเช็ดเท้าตรงทางเข้า ลดทรายที่ครูดผิวหิน</li>
   <li>ใช้จานรองแก้วและแผ่นรองหม้อบนเคาน์เตอร์หินอ่อน</li>
  </ul></div>
  <div class="bad"><h3>ห้ามทำ</h3><ul>
   <li>น้ำมะนาว น้ำส้มสายชู น้ำยาล้างห้องน้ำที่มีกรด — กัดผิวเป็นรอยด้านถาวร</li>
   <li>น้ำยาขัดพื้นทั่วไปที่ไม่ได้ระบุว่าใช้กับหินธรรมชาติได้</li>
   <li>ฝอยขัดเหล็กหรือแปรงลวด — ขูดผิวขัดมันเสียถาวร</li>
   <li>ปล่อยน้ำขังบนผิวหินนาน ๆ จะเกิดคราบขาว</li>
   <li>ใช้หินอ่อนทำท็อปครัวที่ผัดทอดจริงทุกวัน</li>
   <li>ลากเฟอร์นิเจอร์บนพื้นหินโดยไม่มีแผ่นรอง</li>
  </ul></div>
 </div>
 <div class="note"><b>ถ้าผิวด้านไปแล้วซ่อมได้:</b> รอยด้านจากกรดขัดเงากลับมาได้ด้วยการขัดผิวใหม่ ต่างจากรอยแตกหรือรอยลึกที่ซ่อมไม่ได้ — โทรปรึกษาก่อนตัดสินใจรื้อ</div>
 ${foot('หินแกรนิตทนกรดกว่าหินอ่อนมาก แต่ก็ควรดูแลตามหลักเดียวกัน')}`);

// ── 17 คำนวณจำนวน ──
B('17-how-to-measure','คำนวณจำนวนหินที่ต้องสั่ง',
 `${head('คำนวณจำนวนหินที่ต้องสั่ง','สั่งขาดแล้วมาเติมทีหลัง ลายกับสีจะไม่ตรงกัน เพราะเป็นคนละล็อต — เผื่อไว้ตั้งแต่แรกดีกว่า')}
 <table><thead><tr><th>ขั้นตอน</th><th>วิธีทำ</th><th>ตัวอย่าง</th></tr></thead><tbody>
 <tr><td><b>1. วัดพื้นที่</b></td><td>กว้าง × ยาว เป็นเมตร แยกเป็นส่วน ๆ ถ้าพื้นที่ไม่เป็นสี่เหลี่ยม</td><td>4 ม. × 5 ม. = 20 ตร.ม.</td></tr>
 <tr><td><b>2. หักส่วนที่ไม่ปู</b></td><td>ลบพื้นที่เสา บ่อ หรือช่องที่ไม่ต้องปูออก</td><td>20 − 1 = 19 ตร.ม.</td></tr>
 <tr><td><b>3. บวกเผื่อเสีย</b></td><td>แนวอิฐ/แนวตรง +10% · ก้างปลา +20% · พื้นที่มุมเยอะ +15%</td><td>19 × 1.10 = 20.9 ตร.ม.</td></tr>
 <tr><td><b>4. แปลงเป็นจำนวนแผ่น</b></td><td>หารด้วยพื้นที่ต่อแผ่น แล้วปัดขึ้น</td><td>20.9 ÷ 0.36 (60×60) ≈ <b>59 แผ่น</b></td></tr>
 <tr><td><b>5. เผื่อสำรอง</b></td><td>เก็บไว้ 2–3 แผ่นสำหรับซ่อมในอนาคต</td><td>สั่ง <b>62 แผ่น</b></td></tr>
 </tbody></table>
 <div class="note"><b>พื้นที่ต่อแผ่น:</b> 30×30 ซม. = 0.09 ตร.ม. · 30×60 ซม. = 0.18 ตร.ม. · 60×60 ซม. = 0.36 ตร.ม.<br>
 <b>ทางลัด:</b> ถ่ายรูปแปลนหรือส่งขนาดมาทาง LINE เราคำนวณให้ฟรี ไม่ต้องคิดเอง</div>
 ${foot('ส่งขนาดมาที่ LINE @saimstone456 หรือโทร 065-567-8989')}`);

// ── 18 ราคาเริ่มต้นทุกหมวด ──
B('18-price-overview','ราคาเริ่มต้นทุกหมวด',
 `${head('ราคาเริ่มต้นทุกหมวด','ดูภาพรวมว่างบเท่าไรได้อะไรบ้าง ก่อนลงลึกทีละตัว')}
 <table><thead><tr><th>หมวด</th><th>สินค้า</th><th style="text-align:right">เริ่มต้น</th><th>หน่วย</th></tr></thead><tbody>
 <tr><td>วัสดุทดแทนหิน</td><td>FLEX STONE แผ่นหินยืดหยุ่น</td><td class="n">920</td><td>บาท/ตร.ม.</td></tr>
 <tr><td>หินแกรนิต</td><td>Cobble Stone ขาวไข่มุก พ่นไฟ</td><td class="n">990</td><td>บาท/ตร.ม.</td></tr>
 <tr><td>หินอ่อนภายในประเทศ</td><td>ขาวเทาลายเมฆ / ชมพูทับกวาง / ดำพระลาน</td><td class="n">1,100</td><td>บาท/ตร.ม.</td></tr>
 <tr><td>หินอ่อนตกแต่ง</td><td>หินจิ๊กซอ Slate Stone ปูผนัง</td><td class="n">1,200</td><td>บาท/ตร.ม.</td></tr>
 <tr><td>หินปูสระว่ายน้ำ</td><td>หินอ่อนขาวเทาลายเมฆ 10×10 ซม.</td><td class="n">1,250</td><td>บาท/ตร.ม.</td></tr>
 <tr><td>หินอ่อนต่างประเทศ</td><td>ขาวหิมาลัย 30×60 ซม.</td><td class="n">1,950</td><td>บาท/ตร.ม.</td></tr>
 <tr><td>หญ้าเทียม</td><td>ขน 2 ซม. หน้ากว้าง 2 เมตร</td><td class="n">260</td><td>บาท/ตร.ม.</td></tr>
 <tr><td>หินตกแต่งสวน</td><td>หินกรวดขาว ขนาดเล็ก</td><td class="n">25</td><td>บาท/กก.</td></tr>
 <tr><td>หินศิลาแลง</td><td>ศิลาแลงกำแพงเพชร 20×40 ซม.</td><td class="n">35</td><td>บาท/ก้อน</td></tr>
 <tr><td>งานกลึงหินอ่อน</td><td>ลูกกรงหินอ่อนขาว สูง 60 ซม.</td><td class="n">1,400</td><td>บาท/ต้น</td></tr>
 <tr><td>งานประกอบหินอ่อน</td><td>เสาโชว์ไวท์คาราร่า สูง 80 ซม.</td><td class="n">12,000</td><td>บาท/ต้น</td></tr>
 <tr><td>หินบล็อกแกะสลัก</td><td>หินอ่อนสโนว์ไวท์ บล็อก</td><td class="n">80,000</td><td>บาท/ลบ.ม.</td></tr>
 </tbody></table>
 ${foot('ราคายังไม่รวมค่าขนส่งและติดตั้ง · งานปริมาณมากมีราคาพิเศษ โทร 065-567-8989')}`);

// ── 19 หินอ่อน vs แกรนิต ──
B('19-marble-vs-granite','หินอ่อน เทียบ หินแกรนิต',
 `${head('หินอ่อน เทียบ หินแกรนิต','สองอย่างนี้ไม่ใช่ของเกรดสูงกับต่ำ แต่คนละงานกันคนละเรื่อง')}
 <div class="grid c2">
 ${card('7',{name:'หินอ่อน',desc:'หินตะกอนที่ผ่านความร้อนและแรงกดจนตกผลึกใหม่ เนื้อนุ่มกว่า ลายพลิ้วเป็นเส้น',price:false})}
 ${card('21',{name:'หินแกรนิต',desc:'หินอัคนีจากแมกมาที่เย็นตัวใต้เปลือกโลก เนื้อแข็งกว่า ลายเป็นจุดผลึกกระจาย',price:false})}
 </div>
 <table><thead><tr><th>หัวข้อ</th><th>หินอ่อน</th><th>หินแกรนิต</th></tr></thead><tbody>
 <tr><td>ความแข็ง</td><td>3–5 (โมส์) นุ่มกว่า</td><td>6–7 (โมส์) แข็งกว่า</td></tr>
 <tr><td>ทนกรด</td><td><b style="color:#8C1C13">ไม่ทน</b> — น้ำมะนาวกัดเป็นรอยด้าน</td><td><b style="color:#2F5F44">ทน</b></td></tr>
 <tr><td>ทนความร้อน</td><td>ปานกลาง</td><td>ดีมาก วางหม้อร้อนได้</td></tr>
 <tr><td>ดูดซึมน้ำ</td><td>สูงกว่า ต้องเคลือบกันซึม</td><td>ต่ำกว่า</td></tr>
 <tr><td>ความสวยของลาย</td><td><b>เด่นกว่า</b> ลายพลิ้วไม่ซ้ำ</td><td>สม่ำเสมอกว่า ลายเป็นจุด</td></tr>
 <tr><td>เหมาะกับ</td><td>ผนัง พื้นห้องนั่งเล่น เคาน์เตอร์ห้องน้ำ งานตกแต่ง</td><td>ท็อปครัว บันได พื้นภายนอก พื้นที่ใช้งานหนัก</td></tr>
 <tr><td>ราคาในร้านนี้</td><td>1,100–4,400 บาท/ตร.ม.</td><td>990–3,700 บาท/ตร.ม.</td></tr>
 </tbody></table>
 <div class="note"><b>สรุปให้จำง่าย:</b> อยากได้ลายสวย เลือกหินอ่อน · อยากได้ของทน เลือกหินแกรนิต · <b>ครัวไทยที่ผัดจริงทอดจริง เลือกหินแกรนิตเสมอ</b></div>
 ${foot('ปรึกษาฟรีก่อนตัดสินใจ โทร 065-567-8989 · LINE @saimstone456')}`);

// ── 20 สินค้าครบทุกหมวด ──
B('20-all-categories','SIAM STONE ครบทุกเรื่องหินในที่เดียว',
 `${head('ครบทุกเรื่องหินในที่เดียว','12 หมวด 55 รายการ ตัดตามขนาด ส่งตรงจากโรงงาน')}
 <div class="grid c4">
 ${card('7',{name:'หินอ่อนนำเข้า',desc:'คาราร่า วอลาคัส ขาวหิมาลัย',price:'เริ่ม 1,950 <small>บาท/ตร.ม.</small>'})}
 ${card('3',{name:'หินอ่อนไทย',desc:'ขาวเทาลายเมฆ ชมพูทับกวาง ดำพระลาน',price:'เริ่ม 1,100 <small>บาท/ตร.ม.</small>'})}
 ${card('17',{name:'หินแกรนิต',desc:'ดำจีน ดำอินเดีย ขาวไข่มุก ขาววินเซนต์',price:'เริ่ม 990 <small>บาท/ตร.ม.</small>'})}
 ${card('28',{name:'หินศิลาแลง',desc:'ศิลาแลงกำแพงเพชร 4 ขนาด',price:'เริ่ม 35 <small>บาท/ก้อน</small>'})}
 ${card('41',{name:'ลูกกรงหินอ่อน',desc:'ราวระเบียง ราวบันได รั้ว',price:'เริ่ม 1,400 <small>บาท/ต้น</small>'})}
 ${card('48',{name:'เสาโชว์หินอ่อน',desc:'80–120 ซม. ขาวคาราร่า เขียวอิตาลี',price:'เริ่ม 12,000 <small>บาท/ต้น</small>'})}
 ${card('31',{name:'หินตกแต่งผนัง',desc:'หินจิ๊กซอ Slate Stone 3 สี',price:'1,200 <small>บาท/ตร.ม.</small>'})}
 ${card('52',{name:'หินตกแต่งสวน',desc:'หินกรวดขาว 3 ขนาด',price:'เริ่ม 25 <small>บาท/กก.</small>'})}
 ${card('34',{name:'หญ้าเทียม',desc:'ขน 2–4 ซม. หน้ากว้าง 2 เมตร',price:'เริ่ม 260 <small>บาท/ตร.ม.</small>'})}
 ${card('24',{name:'หินปูสระว่ายน้ำ',desc:'กันลื่น ไม่ร้อนเท้า',price:'เริ่ม 1,250 <small>บาท/ตร.ม.</small>'})}
 ${card('68',{name:'วัสดุทดแทนหิน',desc:'FLEX STONE น้ำหนักเบา ดัดโค้งได้',price:'920 <small>บาท/ตร.ม.</small>'})}
 ${card('37',{name:'หินบล็อกแกะสลัก',desc:'สโนว์ไวท์ เขียวอินเดีย',price:'เริ่ม 80,000 <small>บาท/ลบ.ม.</small>'})}
 </div>
 ${foot('ทำให้เรื่องหินเป็นเรื่องง่าย · ที่เดียวจบ ครบทุกเรื่องหิน')}`);

// ── render ──
const browser = await chromium.launch();
const page = await (await browser.newContext({deviceScaleFactor:1})).newPage();
let total=0;
for (const b of BOARDS) {
  await page.setViewportSize({width:1200, height:900});
  await page.setContent(`${CSS}<div class="board">${b.body}</div>`, {waitUntil:'load'});
  await page.evaluate(async()=>{ await document.fonts.ready;
    await Promise.all([...document.images].map(i=>i.complete?0:i.decode().catch(()=>{}))); });
  await page.waitForTimeout(400);
  const el = await page.$('.board');
  await el.screenshot({path:`out/${b.file}.jpg`, type:'jpeg', quality:82});
  const {size} = await import('node:fs').then(m=>({size:m.statSync(`out/${b.file}.jpg`).size}));
  total+=size;
  console.log(`${b.file}.jpg  ${Math.round(size/1024)}KB  — ${b.title}`);
}
console.log(`\nรวม ${BOARDS.length} รูป · ${(total/1048576).toFixed(2)} MB`);
await browser.close();
