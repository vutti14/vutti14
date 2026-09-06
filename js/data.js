/* รวมคลังคำ + ข้อมูลหมวด */
(function () {
  const ALL = [].concat(window.DECK_CORE, window.DECK_DAILY, window.DECK_MAT);

  const UNITS = {
    'core.num':      { deck: 'core',  name: 'ตัวเลข',                  icon: '123' },
    'core.money':    { deck: 'core',  name: 'ราคาและเงิน',             icon: '¥'   },
    'core.time':     { deck: 'core',  name: 'เวลา',                    icon: '時'  },
    'core.social':   { deck: 'core',  name: 'ทักทาย มารยาท',           icon: '礼'  },
    'core.frame':    { deck: 'core',  name: 'โครงประโยคหลัก',          icon: '句'  },
    'daily.airport': { deck: 'daily', name: 'สนามบิน รถไฟ',           icon: '✈'   },
    'daily.hotel':   { deck: 'daily', name: 'โรงแรม',                  icon: '宿'  },
    'daily.taxi':    { deck: 'daily', name: 'แท็กซี่ DiDi',            icon: '車'  },
    'daily.food':    { deck: 'daily', name: 'ร้านอาหาร',               icon: '食'  },
    'daily.pay':     { deck: 'daily', name: 'จ่ายเงิน',                icon: '付'  },
    'daily.shop':    { deck: 'daily', name: 'ซื้อของทั่วไป',           icon: '買'  },
    'daily.help':    { deck: 'daily', name: 'ถามทาง ขอความช่วยเหลือ',  icon: '助'  },
    'daily.chat':    { deck: 'daily', name: 'คุยเล่น สร้างสัมพันธ์',   icon: '談'  },
    'mat.tile':      { deck: 'mat',   name: 'กระเบื้อง',               icon: '磚'  },
    'mat.sanitary':  { deck: 'mat',   name: 'สุขภัณฑ์',                icon: '洁'  },
    'mat.door':      { deck: 'mat',   name: 'ประตู หน้าต่าง กระจก',    icon: '門'  },
    'mat.floor':     { deck: 'mat',   name: 'พื้น',                    icon: '地'  },
    'mat.paint':     { deck: 'mat',   name: 'สี เคลือบผิว',            icon: '漆'  },
    'mat.light':     { deck: 'mat',   name: 'ไฟ ปลั๊ก',                icon: '燈'  },
    'mat.hardware':  { deck: 'mat',   name: 'ฮาร์ดแวร์ วัสดุพื้นฐาน',  icon: '金'  },
    'mat.kitchen':   { deck: 'mat',   name: 'ครัว เฟอร์นิเจอร์',       icon: '厨'  },
    'mat.spec':      { deck: 'mat',   name: 'สเปก คุณภาพ',             icon: '规'  },
    'mat.deal':      { deck: 'mat',   name: 'ราคา สั่งซื้อ เจรจา',     icon: '价'  },
    'mat.factory':   { deck: 'mat',   name: 'โรงงาน ตรวจของ ขนส่ง',    icon: '厂'  }
  };

  const DECKS = {
    core:  { name: 'ชุดแกน',              sub: 'ตัวเลข ราคา เวลา โครงประโยค — ใช้ได้ทุกที่' },
    daily: { name: 'ชีวิตประจำวันในจีน',   sub: 'เอาตัวรอดและอยู่สบายตอนไปดูงาน' },
    mat:   { name: 'วัสดุก่อสร้าง & ตกแต่ง', sub: 'ศัพท์สายงานคุณ + ภาษาสั่งซื้อ' }
  };

  const TONE = {
    'ā':'a','á':'a','ǎ':'a','à':'a','ē':'e','é':'e','ě':'e','è':'e',
    'ī':'i','í':'i','ǐ':'i','ì':'i','ō':'o','ó':'o','ǒ':'o','ò':'o',
    'ū':'u','ú':'u','ǔ':'u','ù':'u','ǖ':'v','ǘ':'v','ǚ':'v','ǜ':'v','ü':'v','ń':'n','ň':'n'
  };
  function stripTones(s) {
    return String(s).toLowerCase().replace(/[^\x00-\x7f]/g, function (c) { return TONE[c] !== undefined ? TONE[c] : c; });
  }

  ALL.forEach(function (it) {
    const u = UNITS[it.u];
    it.deck = u ? u.deck : 'core';
    it.unitName = u ? u.name : it.u;
    // ดัชนีค้นหา: รวมพินอินทั้งแบบมีวรรณยุกต์ ไม่มีวรรณยุกต์ และแบบติดกัน (jiage)
    const plain = stripTones(it.p);
    it._s = [it.m, it.z, it.p, plain, plain.replace(/[\s']/g, ''), it.t, it.unitName, it.n || ''].join(' ').toLowerCase();
  });

  const BY_ID = {};
  ALL.forEach(function (it) { BY_ID[it.i] = it; });

  window.DATA = {
    all: ALL,
    stripTones: stripTones,
    byId: BY_ID,
    units: UNITS,
    decks: DECKS,
    dialogues: window.DIALOGUES || [],
    byUnit: function (u) { return ALL.filter(function (x) { return x.u === u; }); },
    byDeck: function (d) { return ALL.filter(function (x) { return x.deck === d; }); }
  };
})();
