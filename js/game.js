'use strict';
/* ============================================================
   CỐI HẦM — lõi chơi: sinh hầm, di chuyển, sương mù, HUD, lưu
   Sinh hầm bằng mê cung + khoét vòng lặp — bản đồ mỗi lần chơi
   một khác. Toàn bộ phần này do dự án tự viết.
   ============================================================ */

const G = (() => {
  const D = DATA;
  const U = window.U;

  const $ = id => document.getElementById(id);

  let S = null;            // trạng thái toàn bộ phần chơi
  const cv = $('cv');

  // ---------- tiện ích trên grid ----------
  function keyOf(x, y) { return x + ',' + y; }

  function inGrid(x, y) { return x >= 0 && y >= 0 && x < D.COLS && y < D.ROWS; }
  function at(x, y) { return S.map.grid[y][x]; }

  // ---------- tạo người chơi ----------
  function makePlayer(originId) {
    const o = D.ORIGINS[originId];
    const p = {
      origin: originId, name: o.name,
      weapon: 'khong',
      hunger: 90, dread: 0, panic: false,
      luck: o.luck, bonus: o.bonus || 0,
      skills: o.skills.slice(),
      items: Object.assign({}, o.items),
      limbs: {},
    };
    for (const z of D.ZONES) p.limbs[z] = { n: D.ZONE_VI[z], hp: o.limbs[z], max: o.limbs[z], sev: false };
    // trang bị vũ khí khởi đầu nếu có trong túi
    for (const [id, cnt] of Object.entries(p.items)) {
      if (cnt > 0 && D.ITEMS[id] && D.ITEMS[id].equip) { p.weapon = D.ITEMS[id].equip; break; }
    }
    return p;
  }

  // ---------- sinh tầng ----------
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = U.rint(0, i); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function genFloor(fi) {
    const w = D.COLS, h = D.ROWS;
    const grid = Array.from({ length: h }, () => Array(w).fill('#'));

    // mê cung lùi dần trên lưới ô lẻ
    const visited = new Set([keyOf(1, 1)]);
    grid[1][1] = '.';
    const stack = [[1, 1]];
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const dirs = shuffle([[2, 0], [-2, 0], [0, 2], [0, -2]]);
      let moved = false;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 1 || ny < 1 || nx > w - 2 || ny > h - 2) continue;
        if (visited.has(keyOf(nx, ny))) continue;
        visited.add(keyOf(nx, ny));
        grid[cy + dy / 2][cx + dx / 2] = '.';
        grid[ny][nx] = '.';
        stack.push([nx, ny]);
        moved = true;
        break;
      }
      if (!moved) stack.pop();
    }

    // khoét vài mắt để có vòng lặp (đi lạc thoải mái hơn)
    for (let tries = 0; tries < 40; tries++) {
      const x = U.rint(2, w - 3), y = U.rint(2, h - 3);
      if (grid[y][x] !== '#') continue;
      const flanked = (grid[y][x - 1] === '.' && grid[y][x + 1] === '.') ||
                      (grid[y - 1] && grid[y + 1] && grid[y - 1][x] === '.' && grid[y + 1][x] === '.');
      if (flanked && U.chance(0.7)) grid[y][x] = '.';
    }

    // BFS khoảng cách từ điểm vào
    const dist = bfs(grid, w, h, 1, 1);
    const cells = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (grid[y][x] === '.' && dist[y][x] < Infinity) cells.push({ x, y, d: dist[y][x] });
    }
    cells.sort((a, b) => a.d - b.d);
    const far = cells[cells.length - 1];

    const f = D.FLOORS[fi];
    const out = { grid, start: { x: 1, y: 1 }, itemSpots: {}, bossCell: null };
    const taken = new Set([keyOf(1, 1)]);

    if (f.boss) {
      grid[far.y][far.x] = 'B';
      out.bossCell = { x: far.x, y: far.y };
      taken.add(keyOf(far.x, far.y));
    } else {
      grid[far.y][far.x] = '>'; // thang xuống
      taken.add(keyOf(far.x, far.y));
    }

    // giường lay
    const bedCells = cells.filter(c => c.d > 3 && !taken.has(keyOf(c.x, c.y)));
    for (let i = 0; i < f.beds && bedCells.length; i++) {
      const c = bedCells.splice(U.rint(0, bedCells.length - 1), 1)[0];
      grid[c.y][c.x] = 'b';
      taken.add(keyOf(c.x, c.y));
    }

    // mảnh vật phẩm
    for (const itemId of f.itemTable.slice(0, f.items)) {
      const pool = cells.filter(c => c.d >= 2 && !taken.has(keyOf(c.x, c.y)));
      if (!pool.length) break;
      const c = pool[U.rint(0, pool.length - 1)];
      out.itemSpots[keyOf(c.x, c.y)] = itemId;
      taken.add(keyOf(c.x, c.y));
    }

    return out;
  }

  function bfs(grid, w, h, sx, sy) {
    const dist = Array.from({ length: h }, () => Array(w).fill(Infinity));
    dist[sy][sx] = 0;
    const q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (grid[ny][nx] === '#' || dist[ny][nx] < Infinity) continue;
        dist[ny][nx] = dist[y][x] + 1;
        q.push([nx, ny]);
      }
    }
    return dist;
  }

  // ---------- vào / ra giữa các tầng ----------
  function newGame(originId) {
    document.getElementById('combatOverlay').classList.add('hidden');
    S = {
      screen: 'dungeon',
      floorIndex: 0,
      map: null,
      seen: new Set(),
      pos: { x: 1, y: 1 },
      bossDead: false,
      exitCell: null,
      player: makePlayer(originId),
      stats: { steps: 0, wins: 0, fled: 0, limbsCut: 0 },
      deathCause: '',
    };
    buildFloor();
    log(`— ${D.FLOORS[0].name} —`, 'sys');
    log('Lồng đèn hỏng từ lúc xuống. Còn hữu ích duy nhất là đôi mắt quen dần với tối.', 'info');
    save();
    refreshHUD();
    render();
  }

  function buildFloor() {
    S.map = genFloor(S.floorIndex);
    S.pos = { ...S.map.start };
    S.seen = new Set();
    S.exitCell = null;
    markSeen();
  }

  function descend() {
    S.floorIndex++;
    buildFloor();
    const f = D.FLOORS[S.floorIndex];
    // xuống tầng: băng bó dơ dính máu tầng trước, nhưng đỡ phần nào
    for (const z of D.ZONES) {
      const l = S.player.limbs[z];
      if (!l.sev) l.hp = Math.min(l.max, l.hp + Math.ceil(l.max * 0.15));
    }
    log(`— ${f.name} —`, 'sys');
    log('Không khí mặn hơn tầng trước. Có gì đó không muốn bạn đi tiếp.', 'info');
    save();
    refreshHUD();
    render();
  }

  // ---------- nhìn thấy ----------
  function markSeen() {
    const r = 2.5;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (Math.sqrt(dx * dx + dy * dy) > r) continue;
      const x = S.pos.x + dx, y = S.pos.y + dy;
      if (inGrid(x, y)) S.seen.add(keyOf(x, y));
    }
  }
  function lit(x, y) {
    const dx = x - S.pos.x, dy = y - S.pos.y;
    return Math.sqrt(dx * dx + dy * dy) <= 2.5;
  }

  // ---------- di chuyển ----------
  function move(dx, dy) {
    if (S.screen !== 'dungeon') return;
    const nx = S.pos.x + dx, ny = S.pos.y + dy;
    if (!inGrid(nx, ny)) return;
    const ch = at(nx, ny);
    if (ch === '#') { return; }

    S.pos = { x: nx, y: ny };
    markSeen();
    S.stats.steps++;
    tickHunger();

    // nhặt mảnh vật phẩm trên sàn
    const ik = keyOf(nx, ny);
    if (S.map.itemSpots[ik]) {
      const id = S.map.itemSpots[ik];
      delete S.map.itemSpots[ik];
      giveItem(id);
      const nm = D.ITEMS[id] ? D.ITEMS[id].name : (D.WEAPONS[id] ? D.WEAPONS[id].name : id);
      log(`Nhặt được: <b>${nm}</b>.`, 'good');
      SND.play('coin');
    }

    if (ch === 'b') {
      log('Một giường lá dựng tạm giữa trùng trùng đá. Nhấn E để nằm.', 'info');
    } else if (ch === '>') {
      tryDescend();
    } else if (ch === 'B') {
      if (!S.bossDead) {
        log('Cả buồng đá rung lên cùng bước chân bạn. HÀM CỔ thức giấc.', 'bad');
        CB.start('ham_co');
        return;
      }
    } else if (ch === 'X') {
      win();
      return;
    } else if (ch === '.' ) {
      const f = D.FLOORS[S.floorIndex];
      if (U.chance(f.encRate)) {
        const eid = U.pick(f.enemies);
        CB.start(eid);
        return;
      }
    }
    refreshHUD();
    render();
  }

  function tickHunger() {
    const p = S.player;
    p.hunger = Math.max(0, p.hunger - 1);
    if (p.hunger <= 20 && p.hunger > 0 && U.chance(0.25)) {
      log('Bụng rỗng ré lên — cơn đói gào trong tai.', 'warn');
    }
    if (p.hunger === 0) {
      S.deathCause = 'Cơn đói bầm ruột bạn từng lớp.';
      const b = p.limbs.body;
      b.hp = Math.max(0, b.hp - 3);
      log('Không còn gì để đốt — cơ thể tự ăn mình. (−3 máu THÂN)', 'bad');
      checkPlayerDeath();
    }
  }

  function tryDescend() {
    const need = S.floorIndex + 1;
    const have = S.player.items.khoa || 0;
    if (have < need) {
      log(`Thang khóa cứng. Cần ${need} chìa khóa — bạn có ${have}.`, 'warn');
      return;
    }
    SND.play('open');
    descend();
  }

  // ---------- tác động (E) ----------
  function interact() {
    if (S.screen !== 'dungeon') return;
    const ch = at(S.pos.x, S.pos.y);
    if (ch === 'b') rest();
    else log('Không có gì để tác động ở đây.', 'info');
  }

  function rest() {
    const p = S.player;
    if (p.hunger < 12) { log('Bụng rỗng không khắc ngủ được. Tìm gì đó mà ăn đã.', 'warn'); return; }
    p.hunger -= 12;
    for (const z of D.ZONES) {
      const l = p.limbs[z];
      if (!l.sev) l.hp = Math.min(l.max, l.hp + Math.ceil(l.max * 0.4));
    }
    p.dread = Math.max(0, p.dread - 15);
    recalcPanic();
    log('Chợp mắt vào một canh gác. Mất 12 độ no, các vết thương khép da một phần. (Đã lưu ván)', 'good');
    SND.play('rest');
    save();
    refreshHUD();
    render();
  }

  // ---------- vật phẩm ----------
  function giveItem(id) {
    const p = S.player;
    p.items[id] = (p.items[id] || 0) + 1;
    refreshHUD();
  }

  function consumeItem(id, inCombat) {
    const p = S.player;
    const cnt = p.items[id] || 0;
    if (cnt <= 0) return false;

    // vũ khí thô ở trong túi (nhặt được từ địch) hoặc bản "trang bị"
    if (D.WEAPONS[id]) { p.weapon = id; p.items[id] = cnt - 1; log(`Cầm lên <b>${D.WEAPONS[id].name}</b>.`, 'good'); after(); return true; }
    const it = D.ITEMS[id];
    if (it && it.equip) { p.weapon = it.equip; p.items[id] = cnt - 1; log(`Trang bị <b>${D.WEAPONS[it.equip].name}</b>.`, 'good'); after(); return true; }
    if (!it) return false;

    if (id === 'khoa') {
      if (inCombat) { log('Chìa khóa không ăn được. Có lẽ sau trận này…', 'warn'); return false; }
      log('Chìa chỉ dùng để mở thang khóa. Còn giờ, cứ giữ lấy.', 'info');
      return false;
    }
    if (id === 'banh_mi') { p.hunger = Math.min(100, p.hunger + 28); log('Ngậm từng mẩu vụn. Vào bụng được. (+28 no)', 'good'); }
    else if (id === 'nuoc') { p.hunger = Math.min(100, p.hunger + 14); log('Nuốt từng ngụm đục, bỏ qua mùi. (+14 no)', 'good'); }
    else if (id === 'bang_gac') {
      const t = worstLimb();
      t.hp = Math.min(t.max, t.hp + 9);
      log(`Quấn${inCombat ? ' vội' : ''} băng quanh ${t.n}. (+9 máu vùng)`, 'good');
    }
    else if (id === 'co_lanh') { p.dread = Math.max(0, p.dread - 35); recalcPanic(); log('Cỏ thơm mùi đất. Máu chảy hạ nhiệt. (Kinh hoàng −35)', 'good'); }
    else { return false; }

    p.items[id] = cnt - 1;
    after();
    return true;

    function after() {
      refreshHUD();
      if (!inCombat) save();
    }
  }

  function worstLimb() {
    let best = null, ratio = 2;
    for (const z of D.ZONES) {
      const l = S.player.limbs[z];
      if (l.sev) continue;
      const r = l.hp / l.max;
      if (r < ratio) { ratio = r; best = l; }
    }
    return best || S.player.limbs.body;
  }

  // ---------- sát thương lên người chơi ----------
  function damageZone(zone, dmg, attacker) {
    const l = S.player.limbs[zone];
    l.hp = Math.max(0, l.hp - dmg);
    S.player.dread = Math.min(100, S.player.dread + 3);
    if (l.hp <= 0) {
      if (zone === 'arms' || zone === 'legs') {
        if (attacker && attacker.sharp && U.chance(0.18)) {
          l.sev = true;
          S.stats.limbsCut++;
          log(`<b>${l.n} của bạn RƠI.</b> Bốn phương trời tối lại một vòng.`, 'bad');
        } else {
          log(`<b>${l.n} GÃY!</b> Cứ nhăn mặt mà dùng dở.`, 'bad');
        }
      }
    }
    refreshHUD();
  }

  function checkPlayerDeath() {
    if (!S || S.screen === 'gameover') return true;
    const p = S.player;
    if (p.limbs.head.hp <= 0) { die(S.deathCause || 'Cái đầu vỡ ra như cái muỗng gốm.'); return true; }
    if (p.limbs.body.hp <= 0) { die(S.deathCause || 'Thân hình không còn chịu được. Cặn bã dưới cùng của Hầm.'); return true; }
    return false;
  }

  function die(cause) {
    S.screen = 'gameover';
    if (S.player) S.lastStats = summarize();
    deleteSave();
    BOOT.showDeath(`${D.TEXTS.deathPrefix}<br><br>${cause}`, S.lastStats);
  }

  function win() {
    S.screen = 'victory';
    S.lastStats = summarize();
    deleteSave();
    BOOT.showWin(D.TEXTS.win.join('<br>'), S.lastStats);
  }

  function summarize() {
    const p = S.player;
    return {
      origin: p.name, floors: S.floorIndex + 1, steps: S.stats.steps,
      wins: S.stats.wins, fled: S.stats.fled, limbsCut: S.stats.limbsCut,
      hunger: p.hunger, dread: p.dread,
    };
  }

  // ---------- sau trận ----------
  function afterCombat(kind, e) {
    const p = S.player;
    let drop = null;
    if (kind === 'win') {
      S.stats.wins++;
      p.dread = Math.min(100, p.dread + 6);
      if (e.id === 'ham_co') { S.bossDead = true; openExit(); }
      for (const [id, pr] of Object.entries(e.drop || {})) {
        if (U.chance(pr)) { drop = id; giveItem(id); break; }
      }
    } else {
      S.stats.fled++;
      p.dread = Math.min(100, p.dread + 12);
    }
    recalcPanic();
    save();
    refreshHUD();
    return drop;
  }

  function openExit() {
    // lối ra mở ngay tại cửa vào (điểm xuất phát) — người chơi phải
    // vượt đường trở về để thoát, giữ đúng tinh thần căng thẳng của thể loại.
    const s = S.map.start;
    S.map.grid[s.y][s.x] = 'X';
    S.exitCell = { ...s };
    log('Một tiếng rắc vọng từ SÀNH LỘ — nắp mui lối vào bật mở từ dưới.', 'info');
    log('Giờ chỉ cần còn sức, và sống đủ lâu để lếch về nơi bạn đi vào.', 'warn');
  }

  // ---------- kinh hoàng ----------
  function recalcPanic() {
    const p = S.player;
    if (p.dread >= 80) p.panic = true;
    else if (p.dread <= 60) p.panic = false;
  }

  // ---------- HUD ----------
  function refreshHUD() {
    if (!S) return;
    $('floorName').textContent = D.FLOORS[S.floorIndex].name +
      (S.bossDead ? ' — LỐI RA ĐÃ MỞ' : '');

    const p = S.player;
    let lhtml = '';
    for (const z of D.ZONES) {
      const l = p.limbs[z];
      const pct = Math.max(0, Math.round((l.hp / l.max) * 100));
      const st = l.sev ? 'CỤT' : (l.hp <= 0 ? 'GÃY' : (l.hp <= l.max * 0.35 ? 'THƯƠNG' : ''));
      lhtml += `<div class="lrow ${l.hp <= 0 ? 'dead' : ''}">
        <span class="lname">${l.n}</span>
        <span class="lbar"><span class="lfill ${z}" style="width:${pct}%"></span></span>
        <span class="lst">${st}</span></div>`;
    }
    $('limbs').innerHTML = `<h3>Cơ thể</h3>${lhtml}`;

    const m = `
      <h3>Sổ tay</h3>
      <div class="mrow"><span>No</span><span class="lbar"><span class="lfill hunger" style="width:${p.hunger}%"></span></span></div>
      <div class="mrow"><span>Kinh hoàng</span><span class="lbar"><span class="lfill dread" style="width:${p.dread}%"></span></span> ${p.panic ? '<b class="panic">KINH HOÀNG</b>' : ''}</div>
      <div class="mrow"><span>Vũ khí</span><span><b>${D.WEAPONS[p.weapon].name}</b></span></div>
      <div class="mrow"><span>Chìa khóa</span><span>${p.items.khoa || 0}</span></div>
      <div class="mrow"><span>Tầng</span><span>${S.floorIndex + 1}/${D.FLOORS.length}</span></div>`;
    $('meters').innerHTML = m;

    const ids = Object.keys(p.items).filter(k => (p.items[k] || 0) > 0);
    let shtml = '<h3>Túi</h3>';
    if (!ids.length) shtml += '<div class="empty">Trống tru tréo.</div>';
    for (const id of ids) {
      const it = D.ITEMS[id];
      const nm = it ? it.name : (D.WEAPONS[id] ? D.WEAPONS[id].name + ' (NHÔ)' : id);
      const isW = (it && it.equip) || !!D.WEAPONS[id];
      const act = isW ? 'Trang bị' : 'Dùng';
      const equipped = (it && it.equip && p.weapon === it.equip) || p.weapon === id;
      shtml += `<div class="irow">
        <span class="iname">${nm} ×${p.items[id]}${equipped ? ' <span class="eq">◀ đang cầm</span>' : ''}</span>
        <button data-act="use" data-id="${id}">${act}</button></div>`;
    }
    $('stash').innerHTML = shtml;

    cv.classList.toggle('panic-cv', p.panic);
  }

  // ---------- nhật ký ----------
  function log(msg, cls) {
    const box = $('log');
    const d = document.createElement('div');
    d.className = 'le ' + (cls || 'info');
    d.innerHTML = msg;
    box.appendChild(d);
    while (box.children.length > 60) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  // ---------- vẽ ----------
  function render() {
    if (!S || !S.map) return;
    const T = D.TILE;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#050408';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.font = `${Math.round(T * 0.62)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let y = 0; y < D.ROWS; y++) {
      for (let x = 0; x < D.COLS; x++) {
        const k = keyOf(x, y);
        if (!S.seen.has(k)) continue;
        const li = lit(x, y);
        const ch = at(x, y);
        const px = x * T, py = y * T;

        if (ch === '#') {
          ctx.fillStyle = li ? '#2b242e' : '#171219';
          ctx.fillRect(px, py, T, T);
          ctx.fillStyle = li ? '#3a3140' : '#1e1922';
          ctx.fillRect(px, py, T, 3);
        } else {
          ctx.fillStyle = li ? '#3f373c' : '#1c171b';
          ctx.fillRect(px + 1, py + 1, T - 2, T - 2);
        }

        if (li && S.map.itemSpots[k]) drawGlyph('◆', px, py, '#d9b34a', T);
        else if (!li && S.map.itemSpots[k] && S.seen.has(k)) drawGlyph('◆', px, py, '#6a5a33', T);

        if (ch === '>' || ch === 'X') drawGlyph(ch === '>' ? '▼' : '⇒', px, py, li ? '#7ec7e0' : '#3d5666', T);
        else if (ch === 'b') drawGlyph('≡', px, py, li ? '#a97bd8' : '#4a3a5e', T);
        else if (ch === 'B' && li && !S.bossDead) drawGlyph('Ω', px, py, '#ff3b3b', T * 1.15);
        else if (ch === 'X') { /* đã vẽ trên */ }
      }
    }

    // người chơi
    drawGlyph('@', S.pos.x * T, S.pos.y * T, '#9fe08f', T * 1.05);
  }

  function drawGlyph(ch, px, py, color, sizePx) {
    const ctx = cv.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = `${Math.round(sizePx * 0.62)}px monospace`;
    ctx.fillText(ch, px + D.TILE / 2, py + D.TILE / 2);
  }

  // ---------- lưu ----------
  function save() {
    if (!S) return;
    try {
      const rows = S.map.grid.map(r => r.join(''));
      const data = {
        v: 1,
        floorIndex: S.floorIndex,
        rows,
        itemSpots: S.map.itemSpots,
        bossCell: S.map.bossCell,
        start: S.map.start,
        seen: Array.from(S.seen),
        pos: S.pos,
        bossDead: S.bossDead,
        exitCell: S.exitCell,
        player: S.player,
        stats: S.stats,
      };
      localStorage.setItem(D.STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* chừng nào cần thì nhắc */ }
  }

  function load() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(D.STORAGE_KEY) || 'null'); } catch (e) { data = null; }
    if (!data || data.v !== 1) return false;
    S = {
      screen: 'dungeon',
      floorIndex: data.floorIndex,
      map: {
        grid: data.rows.map(r => r.split('')),
        itemSpots: data.itemSpots,
        bossCell: data.bossCell,
        start: data.start,
      },
      seen: new Set(data.seen),
      pos: data.pos,
      bossDead: data.bossDead,
      exitCell: data.exitCell,
      player: data.player,
      stats: data.stats,
      deathCause: '',
    };
    refreshHUD();
    render();
    log('— Trở lại giữa chừng — ván đã ghim ở chỗ nghỉ cuối cùng. —', 'sys');
    return true;
  }
  function deleteSave() { try { localStorage.removeItem(D.STORAGE_KEY); } catch (e) {} }
  function hasSave() {
    try { return !!localStorage.getItem(D.STORAGE_KEY); } catch (e) { return false; }
  }

  return {
    get state() { return S; },
    newGame, load, deleteSave, hasSave,
    move, interact, consumeItem, giveItem,
    worstLimb, damageZone, checkPlayerDeath,
    afterCombat, recalcPanic, refreshHUD, render, log,
    summarize, save,
  };
})();
