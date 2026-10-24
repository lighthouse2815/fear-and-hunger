'use strict';
/* ============================================================
   CỐI HẦM — dữ liệu gốc của game
   Toàn bộ quái vật, vật phẩm, lời văn là nội dung tự viết,
   KHÔNG lấy từ bất kỳ game thương mại nào.
   ============================================================ */

const DATA = (() => {
  const TILE = 34;          // kích thước ô (px)
  const COLS = 21, ROWS = 15;

  // ---- Khu vực cơ thể ----------------------------------------
  const ZONES = ['head', 'body', 'arms', 'legs'];
  const ZONE_VI = { head: 'ĐẦU', body: 'THÂN', arms: 'TAY', legs: 'CHÂN' };
  const ZONE_MULT = { head: 1.5, body: 1.0, arms: 0.8, legs: 0.7 };

  // ---- Vũ khí -------------------------------------------------
  const WEAPONS = {
    khong: { id: 'khong', name: 'Nắm đấm', dmg: [1, 3], flips: 0, sharp: false },
    dao:   { id: 'dao',   name: 'Dao găm', dmg: [4, 7], flips: 1, sharp: true  },
    gay:   { id: 'gay',   name: 'Gậy gỗ',  dmg: [6, 9], flips: 0, sharp: false },
  };

  // ---- Vật phẩm ------------------------------------------------
  const ITEMS = {
    banh_mi:  { name: 'Bánh mì khô',  desc: 'Cắn từng mẩu vụn. Vào bụng được. (+28 đói)' },
    nuoc:     { name: 'Bình nước đục', desc: 'Uống cẩn thận, đừng hỏi đáy bình là gì. (+14 đói)' },
    bang_gac: { name: 'Băng gạc',     desc: 'Quấn chặt quanh vùng đau nhất. +9 máu vùng, hồi cả vùng gãy.' },
    co_lanh:  { name: 'Cỏ lành',       desc: 'Nhắm mắt, nhai. Hơi ngọt. Kinh hoàng −35.' },
    khoa:     { name: 'Chìa khóa rỉ',  desc: 'Dùng mở các nấc thang khóa. Không ăn được, dù đói lắm.' },
    // vũ khí nằm trong túi để "Trang bị"
    dao_eq:   { name: 'Dao găm', equip: 'dao', desc: 'Nhọn, lạnh, đáng tin. Trang bị.' },
    gay_eq:   { name: 'Gậy gỗ',  equip: 'gay', desc: 'Nặng tay. Trang bị.' },
  };

  const ITEMS_FOR_EQUIP = 'dao_eq gay_eq dao gay'.split(' ');

  // ---- Kỹ năng (Thể lực = ST) ---------------------------------
  const SKILLS = {
    chem_vanh: { name: 'Chém Vanh', cost: 5, zone: true,
      desc: 'Một nhát bất chấp xoay xở: 6–9 sát thương, luôn trúng.' },
    an_minh:   { name: 'Ẩn Mình',   cost: 3,
      desc: 'Thu mình vào bóng. Lượt tới kẻ địch có 55% vung trượt.' },
    tran_tinh: { name: 'Trấn Tĩnh', cost: 4,
      desc: 'Thở ra, đếm từng nhịp. Kinh hoàng −25.' },
    cham_cuu:  { name: 'Châm Cứu',  cost: 5,
      desc: 'Nhíp và kim may miệng vết. Hồi 7 máu cho vùng đau nhất.' },
    can_chan:  { name: 'Cản Chắn',  cost: 4,
      desc: 'Chống chân, hứng tận nơi. Sát thương nhận tới giảm 60%.' },
    dam_thang: { name: 'Đấm Thẳng', cost: 3,
      desc: 'Một cú giữa cung. 4–6 sát thương vào THÂN, luôn trúng.' },
  };

  // ---- Xuất thân ------------------------------------------------
  const ORIGINS = {
    san: {
      name: 'Kẻ Săn', glyph: '⊙',
      tagline: 'Nghe mùi trước khi nghe tiếng.',
      luck: 3, st: 12,
      limbs: { head: 12, body: 16, arms: 10, legs: 10 },
      items: { dao_eq: 1, banh_mi: 2 },
      skills: ['chem_vanh', 'an_minh'],
      bonus: 0,
    },
    hoc: {
      name: 'Học Sĩ', glyph: '§',
      tagline: 'Biết đủ nhiều để biết điều gì đang kề tới.',
      luck: 2, st: 10,
      limbs: { head: 10, body: 14, arms: 10, legs: 10 },
      items: { co_lanh: 2, bang_gac: 2, nuoc: 1 },
      skills: ['tran_tinh', 'cham_cuu'],
      bonus: 0,
    },
    linh: {
      name: 'Bộ Binh', glyph: 'Ⓐ',
      tagline: 'Lấy một đêm gác cổng đổi lấy tay chai.',
      luck: 2, st: 14,
      limbs: { head: 12, body: 18, arms: 12, legs: 12 },
      items: { gay_eq: 1, bang_gac: 1, banh_mi: 1 },
      skills: ['can_chan', 'dam_thang'],
      bonus: 2, // +2 sát thương mỗi pha trúng
    },
  };

  // ---- Kẻ địch ---------------------------------------------------
  const ENEMIES = {
    buc_seo: {
      id: 'buc_seo', name: 'Bụng Sèo', glyph: 'Ψ',
      desc: 'Một thân hình như túi da, trườn ra từ khe. Chân nó kênh, bụng nó chậm.',
      limbs: { head: 6, body: 10, arms: 4, legs: 4 },
      pref: 'legs', dmg: [2, 4], sharp: false, crit: 0.05, chase: 0,
      drop: { banh_mi: 0.5, nuoc: 0.5 },
    },
    thay_gay: {
      id: 'thay_gay', name: 'Thây Gầy', glyph: '‡',
      desc: 'Cao lêu nghêu, da chằng chịt như giấy ướt. Nó vẫn nhớ cách vung tay.',
      limbs: { head: 8, body: 14, arms: 6, legs: 6 },
      pref: 'body', dmg: [3, 6], sharp: false, crit: 0.08, chase: 0,
      doubleHit: 0.3,
      drop: { bang_gac: 0.45, banh_mi: 0.3 },
    },
    dao_tranh: {
      id: 'dao_tranh', name: 'Săn Nhặt', glyph: '†',
      desc: 'Vẫn là người, hoặc còn một nửa là người. Tay cầm mảnh dao tự rèn.',
      limbs: { head: 8, body: 12, arms: 7, legs: 7 },
      pref: 'arms', dmg: [3, 5], sharp: true, crit: 0.1, chase: 0.15,
      drop: { dao: 0.25, banh_mi: 0.3, khoa: 0.25 },
    },
    mat_me: {
      id: 'mat_me', name: 'Mắt Mẻ', glyph: '◉',
      desc: 'Một con mắt to bằng bàn tay, lơ lửng, nhìn bạn không chớp.',
      limbs: { head: 4, body: 8, arms: 2, legs: 2 },
      pref: 'head', dmg: [2, 5], sharp: false, crit: 0.12, chase: 0,
      drop: { co_lanh: 0.55 },
    },
    ham_co: {
      id: 'ham_co', name: 'HÀM CỔ', glyph: 'Ω',
      desc: 'Chuồng này là nó. Một khối xương đè lên cột, hàm răng như hàng rào.',
      limbs: { head: 14, body: 36, arms: 10, legs: 10 },
      pref: 'body', dmg: [4, 7], sharp: true, crit: 0.1, chase: 999,
      swallow: true, noFlee: true,
      drop: {},
    },
  };

  // ---- Tầng hầm -------------------------------------------------
  const FLOORS = [
    {
      name: 'TẦNG 1 — SÀNH LỘ',
      encRate: 0.14,
      enemies: ['buc_seo', 'buc_seo', 'thay_gay'],
      itemTable: ['banh_mi', 'bang_gac', 'khoa', 'nuoc', 'co_lanh', 'banh_mi'],
      beds: 2, items: 6, boss: false,
    },
    {
      name: 'TẦNG 2 — LÒ SÚC',
      encRate: 0.18,
      enemies: ['thay_gay', 'dao_tranh', 'buc_seo'],
      itemTable: ['khoa', 'bang_gac', 'khoa', 'banh_mi', 'co_lanh', 'nuoc'],
      beds: 2, items: 6, boss: false,
    },
    {
      name: 'TẦNG 3 — BUỒNG HÀM CỔ',
      encRate: 0.2,
      enemies: ['dao_tranh', 'mat_me', 'thay_gay'],
      itemTable: ['bang_gac', 'co_lanh', 'nuoc', 'banh_mi', 'bang_gac', 'banh_mi'],
      beds: 2, items: 6, boss: true,
    },
  ];

  // ---- Lời văn ---------------------------------------------------
  const TEXTS = {
    title: 'CỐI HẦM',
    sub: 'Một game web dungeon-horror hoàn toàn gốc.',
    note: 'Lấy cảm hứng từ lối chơi của thể loại dungeon horror — không dùng tài nguyên nào của game gốc.',
    intro: [
      'Cơn đói đã ba ngày. Tiếng cuốc và tiếng hô dưới đất cũng ba ngày.',
      'Nếp nhà này có một lối xuống chỉ mở vào ban đêm, ai đi vào thì làng đếm cho một cốc gạo cho gia quyến.',
      'Cốc gạo đủ nuôi ba ngày nữa. Ba ngày nữa, chỉ cần ba ngày nữa…',
      'Bạn cầm thứ gì đó trong tay, hít một hơi ngậm ở trong cổ họng, rồi bước xuống Cối Hầm.',
    ],
    deathPrefix: 'CỐI HẦM NUỐT MỘT NGƯỜI NỮA.',
    win: [
      'Ngón tay bạn trượt khỏi ván cửa cuối cùng. Ánh sáng tràn như nước vào buồng phổi',
      'Lên mặt đất, mặt trời chói buốt — bạn đã quên nó chói thế.',
      'Dưới chân, Cối Hầm vẫn nhấp nháy. Như một miệng, vanh vách, khép lại.',
    ],
    legend: [
      '@ = bạn       Ω = trùm      ◆ = vật phẩm',
      '▼ = thang xuống    ≡ = giường lay (về & lưu)    ⇒ = lối ra',
    ],
  };

  const STORAGE_KEY = 'coiham.save.v1';

  return Object.freeze({
    TILE, COLS, ROWS, ZONES, ZONE_VI, ZONE_MULT,
    WEAPONS, ITEMS, ITEMS_FOR_EQUIP, SKILLS, ORIGINS,
    ENEMIES, FLOORS, TEXTS, STORAGE_KEY,
  });
})();
