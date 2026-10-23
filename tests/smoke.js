'use strict';
/* ============================================================
   CỐI HẦM — smoke test headless (Node, giả DOM)
   Chạy: node tests/smoke.js (một phần của npm test)
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const J = path.join(__dirname, '..', 'js');

// ---------- giả DOM ----------
const els = {};
function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '',
    children: { length: 0 },
    firstChild: null,
    appendChild() {}, removeChild() {},
    addEventListener() {},
    scrollTop: 0, scrollHeight: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {}, dataset: {}, closest() { return null; },
    getContext: id === 'cv' ? () => ctx : undefined,
    width: 714, height: 510,
  };
}
const ctx = { fillStyle: '#000', font: '', textAlign: '', textBaseline: '', fillRect() {}, fillText() {} };
for (const id of ['cv', 'combatOverlay', 'enemyArt', 'enemyZones', 'combatLog', 'combatMenu',
  'limbs', 'meters', 'stash', 'log', 'floorName', 'cards', 'btnContinue',
  'titleScreen', 'introScreen', 'deathScreen', 'winScreen', 'introText', 'btnDescend',
  'deathStats', 'btnAgain1', 'winText', 'winStats', 'btnAgain2', 'stage', 'dpad']) {
  els[id] = makeEl(id);
}
global.document = {
  getElementById: id => (els[id] || (els[id] = makeEl(id))),
  querySelectorAll: () => [], querySelector: () => null,
  createElement: t => makeEl(t),
  addEventListener() {},
};
global.window = global;
global.addEventListener = () => {}; // main.js gọi DOMContentLoaded khi nạp
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
global.AudioContext = undefined;

// ---------- nạp mã nguồn ----------
for (const f of ['utils.js', 'sound.js', 'data.js', 'combat.js', 'game.js', 'main.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(J, f), 'utf8'), { filename: f });
}

let fails = 0;
function ok(cond, name) { if (cond) console.log('  ✓', name); else { fails++; console.error('  ✗', name); } }
function beefUp() {
  const p = G.state.player;
  p.limbs.head.hp = 500; p.limbs.body.hp = 500;
  p.limbs.arms.hp = 60; p.limbs.legs.hp = 60;
}
function fightOut(maxTurns = 400) {
  let t = 0;
  while (CB.active && G.state.screen === 'combat' && t++ < maxTurns) {
    CB.key(1);
    CB.key(2);
    if (t % 9 === 0) CB.key(4);
  }
}
function backToDungeon() {
  if (G.state.screen === 'gameover') G.newGame('san');
  G.state.screen = 'dungeon';
}

console.log('== Chạy nền ==');
G.newGame('san');
ok(G.state && G.state.screen === 'dungeon', 'vào thế giới được');
ok(Array.isArray(G.state.map.grid) && G.state.map.grid.length === DATA.ROWS, 'grid đúng cỡ');

beefUp();
let guard = 0, stepsBefore = 0, fightsBefore = 0;
while (G.state.screen === 'dungeon' && guard++ < 140) {
  if (guard % 25 === 0) G.state.player.hunger = 80;
  const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]][guard % 4];
  G.move(dir[0], dir[1]);
  if (G.state.screen === 'combat') fightOut();
}
stepsBefore = G.state.stats.steps;
fightsBefore = G.state.stats.wins + G.state.stats.fled;
backToDungeon();
ok(guard > 0 && stepsBefore > 0, `bước chân chạy được và được đếm (${stepsBefore})`);
ok(fightsBefore > 0, `có trận đấu sinh động (thắng/chạy: ${fightsBefore})`);

console.log('== Trận trực tiếp ==');
beefUp(); G.state.player.hunger = 100;
G.state.screen = 'dungeon';
CB.start('buc_seo');
ok(CB.active, 'trận khởi động được');
CB.key(1); CB.key(3);
ok(G.state.screen === 'combat' || G.state.screen === 'gameover', 'đánh xong không văng');
fightOut();
backToDungeon();
ok(!CB.active, 'trận khép được vòng');

console.log('== Lưu / nạp ==');
const posBefore = JSON.stringify(G.state.pos);
G.save();
ok(!!localStorage.getItem(DATA.STORAGE_KEY), 'đã ghi ván vào bộ nhớ');
ok(G.load(), 'nạp ván cũ được');
ok(JSON.stringify(G.state.pos) === posBefore, 'vị trí giữ nguyên sau nạp');

console.log('== Vật phẩm ==');
const p = G.state.player;
p.items.banh_mi = 1; p.hunger = 10;
const ghosts = p.hunger;
G.consumeItem('banh_mi', false);
ok(p.hunger > ghosts, 'bánh mì tăng độ no và vừa khỏi túi');
p.items.bang_gac = 1; p.limbs.arms.sev = false; p.limbs.arms.hp = 0;
G.consumeItem('bang_gac', false);
ok(p.limbs.arms.hp > 0, 'băng gạc cứu tay gãy (chưa severed)');
p.items.khoa = 1;
G.consumeItem('khoa', false);
ok((p.items.khoa || 0) === 1, 'chìa khóa không ăn được');
p.items.gay_eq = 1;
G.consumeItem('gay_eq', false);
ok(p.weapon === 'gay' && !(p.items.gay_eq > 0), 'trang bị gậy đúng và khỏi túi');

console.log('== Kinh hoàng ==');
p.dread = 95; G.recalcPanic();
ok(p.panic === true, 'dread ≥ 80 bật kinh hoàng');
p.dread = 30; G.recalcPanic();
ok(p.panic === false, 'dread thấp tắt kinh hoàng');

console.log(fails ? `\n=== FAIL: ${fails} báo đỏ ===` : '\n=== TẤT CẢ ĐÈN XANH ===');
process.exit(fails ? 1 : 0);
