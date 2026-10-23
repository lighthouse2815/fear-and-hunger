'use strict';
/* ============================================================
   CỐI HẦM — chiến đấu theo lệnh
   Vùng thương tích + ném đồng xu May Mắn + thể lực (ST)
   Toàn bộ cơ chế và lời văn viết riêng cho game này.
   ============================================================ */

const CB = (() => {
  const U = window.U;
  const D = DATA;

  let C = null; // trạng thái trận đang diễn ra

  // ---------- tiện ích ----------
  function flip() { // tung xu: ngửa(true) / sấp(false). Kinh hoàng làm xu hư.
    return Math.random() < (G.state.player.panic ? 0.35 : 0.5);
  }
  function limbOf(side, z) { return side.limbs[z]; }

  function log(msg, cls) {
    C.lines.push({ msg, cls });
    if (C.lines.length > 80) C.lines.shift();
    renderLog();
  }

  // ---------- khởi động trận ----------
  function start(enemyId) {
    const base = D.ENEMIES[enemyId];
    // bản sao sâu, tránh bẩn dữ liệu gốc giữa hai trận
    const e = {
      id: base.id, name: base.name, glyph: base.glyph, desc: base.desc,
      pref: base.pref, dmg: base.dmg.slice(), sharp: !!base.sharp,
      crit: base.crit || 0, chase: base.chase || 0, doubleHit: base.doubleHit || 0,
      swallow: !!base.swallow, noFlee: !!base.noFlee, drop: base.drop,
      limbs: {},
    };
    for (const z of D.ZONES) e.limbs[z] = { hp: base.limbs[z], max: base.limbs[z], sev: false };

    C = {
      e, turn: 0, phase: 'menu',
      st: 1,
      dodge: false,   // Ẩn Mình
      guard: false,   // Cản Chắn
      tele: false,    // trùm đã há mồm, lượt tới sẽ nuốt
      stagger: 0,     // 1 = địch vừa vỡ chân tay, sẽ chùng một lượt
      pendingSkill: null,
      done: false,
      lines: [],
    };
    G.state.screen = 'combat';
    document.getElementById('combatOverlay').classList.remove('hidden');
    log(`Gặp ngay: «${e.name}» — ${e.desc}`, 'bad');
    if (e.noFlee) log('Nó chắn kín lối thoát. Chạy là chuyện không thể.', 'bad');
    log('Chọn cách ứng phó (phím 1–4 hoặc bấm nút).', 'info');
    menu();
  }

  // ---------- hiển thị ----------
  function renderZones() {
    const art = document.getElementById('enemyArt');
    if (art) art.textContent = C.e.glyph;
    const box = document.getElementById('enemyZones');
    let html = `<div class="enemy-name">${C.e.glyph} ${C.e.name}</div>`;
    for (const z of D.ZONES) {
      const l = C.e.limbs[z];
      const pct = Math.max(0, Math.round((l.hp / l.max) * 100));
      const st = l.sev ? 'CỤT' : (l.hp <= 0 ? 'VỠ' : (l.hp <= l.max * 0.35 ? 'THƯƠNG' : ''));
      html += `
        <div class="zrow ${l.hp <= 0 ? 'dead' : ''}">
          <span class="zname">${l.sev ? '✗' : '●'} ${D.ZONE_VI[z]}</span>
          <span class="zbar"><span class="zfill" style="width:${pct}%"></span></span>
          <span class="zst ${l.sev ? 'sev' : ''}">${st}</span>
        </div>`;
    }
    box.innerHTML = html;
  }

  function renderLog() {
    const box = document.getElementById('combatLog');
    box.innerHTML = C.lines.map(l => `<div class="cl ${l.cls || ''}">${l.msg}</div>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  function myWeapon() {
    return D.WEAPONS[G.state.player.weapon || 'khong'];
  }
  function armBroken() { return G.state.player.limbs.arms.hp <= 0; }
  function legBroken() { return G.state.player.limbs.legs.hp <= 0; }

  // ---------- menu ----------
  function menu() {
    C.phase = 'menu';
    renderZones();
    const p = G.state.player;
    const w = myWeapon();
    document.getElementById('combatMenu').innerHTML = `
      <button data-k="attack">1 ⚔ Đánh (${w.name})</button>
      <button data-k="skill">2 ✶ Kỹ năng</button>
      <button data-k="item">3 ▤ Vật phẩm</button>
      <button data-k="flee" ${C.e.noFlee ? 'disabled' : ''}>4 » Chạy</button>
      <div class="stline">Thể lực ${C.st}/12 · Xu may ${p.luck} ${p.panic ? '<span class="panic">KINH HOÀNG</span>' : ''}</div>`;
  }

  function zoneMenu() {
    C.phase = 'zone';
    renderZones();
    document.getElementById('combatMenu').innerHTML = `
      <button data-k="head">1 ĐẦU <small>×1.5 sát thương</small></button>
      <button data-k="body">2 THÂN <small>×1.0</small></button>
      <button data-k="arms">3 TAY <small>×0.8 · làm kẻ địch yếu đi</small></button>
      <button data-k="legs">4 CHÂN <small>×0.7 · giữ chân nó lại</small></button>
      <button data-k="back">« Quay lại</button>`;
  }

  function coinLine(nHeads, nFlips) {
    const out = [];
    for (let i = 0; i < nFlips; i++) out.push(i < nHeads ? 'NGỬA' : 'SẤP');
    return `<span class="coin">${out.join(' · ')}</span>`;
  }

  // ---------- hành động: đánh một vùng ----------
  function doAttack(zone) {
    if (!C || C.done) return;
    C.phase = 'locked';
    const p = G.state.player;
    const w = myWeapon();

    let nFlips = Math.max(1, p.luck + (w.flips || 0));
    if (armBroken()) { nFlips = Math.max(1, nFlips - 1); log('Tay gãy, vung không vững… (−1 xu)', 'warn'); }

    let heads = 0;
    for (let i = 0; i < nFlips; i++) if (flip()) heads++;
    log(`Vung ${w.name} vào ${D.ZONE_VI[zone]} — ${coinLine(heads, nFlips)}`, 'coinline');

    if (heads === 0) {
      log('Tuốt tuốt là sấp. Đòn đi vào khoảng không.', 'bad');
      return endPlayerTurn();
    }

    let total = 0;
    for (let i = 0; i < heads; i++) total += U.rint(w.dmg[0], w.dmg[1]);
    total += (DATA.ORIGINS[p.origin].bonus || 0) * heads;
    const dmg = Math.max(1, Math.round(total * D.ZONE_MULT[zone]));

    const l = limbOf(C.e, zone);
    if (l.hp <= 0) {
      log(`${D.ZONE_VI[zone]} của nó đã cụt/vỡ — đánh vào đó giờ chỉ là đập xương khô.`, 'warn');
      return endPlayerTurn();
    }
    l.hp = Math.max(0, l.hp - dmg);
    log(`Trúng ${D.ZONE_VI[zone]}: −${dmg} máu!`, 'good');
    SND.play('hit');

    if (l.hp <= 0) {
      if (zone === 'head' || zone === 'body') {
        log(`${C.e.name} gục xuống. Mắt đờ ra, gập lại, không nhúc nhích nữa.`, 'good');
        return finish('win');
      }
      if (w.sharp && heads >= Math.ceil(nFlips / 2) && U.chance(0.5)) {
        l.sev = true;
        G.state.stats.limbsCut++;
        log(`Một đường sạch: ${D.ZONE_VI[zone]} của nó RƠI. Vĩnh viễn.`, 'good');
      } else {
        l.hp = 0;
        C.stagger = 1;
        log(`${D.ZONE_VI[zone]} của nó bẹp dí — nó khựng lại một nhịp.`, 'good');
      }
    }
    endPlayerTurn();
  }

  // ---------- kỹ năng ----------
  function showSkills() {
    C.phase = 'skills';
    const p = G.state.player;
    let html = '';
    for (const id of p.skills) {
      const s = D.SKILLS[id];
      html += `<button data-sk="${id}" ${C.st < s.cost ? 'disabled' : ''}>${s.name} (ST ${s.cost}) <small>${s.desc}</small></button>`;
    }
    html += `<button data-k="back">« Quay lại</button>`;
    document.getElementById('combatMenu').innerHTML = html;
  }

  function useSkill(id) {
    const s = D.SKILLS[id];
    if (C.st < s.cost) return;
    if (s.zone) {
      C.pendingSkill = id;
      C.phase = 'zoneSkill';
      renderZones();
      document.getElementById('combatMenu').innerHTML = `
        <div class="stline">Chém Vanh — chọn vùng trút đòn:</div>
        <button data-k="head">1 ĐẦU</button><button data-k="body">2 THÂN</button>
        <button data-k="arms">3 TAY</button><button data-k="legs">4 CHÂN</button>
        <button data-k="back">« Quay lại</button>`;
      return;
    }
    C.st -= s.cost;
    applySkill(id);
  }

  function applySkill(id, zone) {
    const p = G.state.player;
    switch (id) {
      case 'chem_vanh': {
        const l = C.e.limbs[zone];
        if (l.hp <= 0) { log('Không còn gì để chém ở đó nữa.', 'warn'); break; }
        const fin = Math.max(1, Math.round(U.rint(6, 9) * D.ZONE_MULT[zone]));
        l.hp = Math.max(0, l.hp - fin);
        log(`Chém Vanh vào ${D.ZONE_VI[zone]}: −${fin} máu!`, 'good');
        SND.play('hit');
        if (l.hp <= 0) {
          if (zone === 'head' || zone === 'body') { log(`${C.e.name} gục tại chỗ.`, 'good'); return finish('win'); }
          l.sev = true; G.state.stats.limbsCut++;
          log(`Nhát vừa phải: ${D.ZONE_VI[zone]} của nó rời hẳn khỏi thân.`, 'good');
        }
        break;
      }
      case 'an_minh': C.dodge = true; log('Bạn tan vào bóng tối. Lượt tới nó khó trúng.', 'info'); break;
      case 'tran_tinh':
        p.dread = Math.max(0, p.dread - 25); G.recalcPanic(); G.refreshHUD();
        log('Tám nhịp thở. Tim trở lại nhịp của người. (Kinh hoàng −25)', 'good');
        break;
      case 'cham_cuu': {
        const t = G.worstLimb();
        t.hp = Math.min(t.max, t.hp + 7);
        G.refreshHUD();
        log(`Kim chỉ quen tay. ${t.n} đỡ hơn nhiều. (+7 máu vùng)`, 'good');
        break;
      }
      case 'can_chan': C.guard = true; log('Bạn hạ thấp trọng tâm, sẵn sàng hứng đòn tới.', 'info'); break;
      case 'dam_thang': {
        const dmg = U.rint(4, 6);
        const l = C.e.limbs.body;
        l.hp = Math.max(0, l.hp - dmg);
        log(`Đấm Thẳng vào THÂN: −${dmg} máu!`, 'good');
        SND.play('hit');
        if (l.hp <= 0) { log(`${C.e.name} gập người và không gượng dậy nổi nữa.`, 'good'); return finish('win'); }
        break;
      }
    }
    endPlayerTurn();
  }

  // ---------- vật phẩm ----------
  function showItems() {
    C.phase = 'items';
    const p = G.state.player;
    let html = '';
    const ids = Object.keys(p.items).filter(k => (p.items[k] || 0) > 0);
    if (!ids.length) html += `<div class="empty">Túi trống trơn. Chỉ còn hơi thở.</div>`;
    for (const id of ids) {
      const it = D.ITEMS[id];
      const name = it ? it.name : (D.WEAPONS[id] ? D.WEAPONS[id].name : id);
      html += `<button data-it="${id}">${name} ×${p.items[id]}</button>`;
    }
    html += `<button data-k="back">« Quay lại</button>`;
    document.getElementById('combatMenu').innerHTML = html;
  }

  function useItemCombat(id) {
    if (G.consumeItem(id, true)) endPlayerTurn();
    else menu(); // không dùng được (ví dụ chìa khóa), trở lại menu
  }

  // ---------- chạy ----------
  function doFlee() {
    if (C.e.noFlee) { log('Không có lối nào để chạy cả.', 'bad'); return; }
    let bonus = 0;
    if (C.e.limbs.legs.hp <= 0) { bonus += 0.2; log(`Chân ${C.e.name} đã mủn — dễ thoát hơn.`, 'info'); }
    if (legBroken()) { bonus -= 0.25; log('Cẳng chân bể — đủ biết kết cục.', 'warn'); }
    const chance = 0.5 + 0.07 * G.state.player.luck + bonus - 0.15 - C.e.chase;
    if (U.chance(chance)) {
      log('Bạn quăng bóng tối ra sau lưng và lao lên thang. Trúng thoát!', 'good');
      finish('flee');
    } else {
      log('Cửa ngõ thắt lại — bạn chưa chạy được.', 'bad');
      enemyTurn();
    }
  }

  // ---------- lượt địch ----------
  function endPlayerTurn() {
    if (!C || C.done) return;
    renderZones();
    G.refreshHUD();
    C.turn++;
    if (C.stagger === 1) {
      C.stagger = 0;
      log(`${C.e.name} còn đang lấn cấn phần vừa vỡ — lượt của nó trôi qua.`, 'info');
      menu();
      return;
    }
    enemyTurn();
  }

  function enemyTurn() {
    const e = C.e, p = G.state.player;

    // trùm đang há mồm: thực hiện NUỐT
    if (e.swallow && C.tele) {
      C.tele = false;
      let heads = 0;
      const nFlips = Math.max(2, p.luck);
      for (let i = 0; i < nFlips; i++) if (flip()) heads++;
      if (heads >= 2) {
        log(`Hàm nó quét qua chỗ trống bạn vừa né — ${coinLine(heads, nFlips)} — THOÁT!`, 'good');
      } else {
        const dmg = U.rint(10, 14);
        G.damageZone('head', dmg, e);
        log(`NUỐT! Hàm nó khóa trúng cổ bạn: −${dmg} máu ĐẦU. Bạn nghe xương rắc…`, 'bad');
        if (G.checkPlayerDeath()) return;
      }
      return again();
    }

    if (e.swallow && C.turn % 4 === 3) {
      C.tele = true;
      log('HÀM CỔ há rộng đến tận ruột — lượt sau nó sẽ NUỐT. Chống đỡ hoặc chuẩn bị né!', 'bad');
      return again();
    }

    const shots = Math.random() < e.doubleHit ? 2 : 1;
    for (let i = 0; i < shots; i++) {
      if (!C || C.done || G.state.screen !== 'combat') break;
      if (i > 0) log('Nó xoay người, đánh hai nhịp liên hoàn!', 'bad');
      strikePlayer(e);
    }
    if (C && !C.done && G.state.screen === 'combat') again();
  }

  function strikePlayer(e) {
    const p = G.state.player;
    if (C.dodge && U.chance(0.55)) { log(`${e.name} vung trượt vào bóng tối.`, 'good'); C.dodge = false; return; }
    C.dodge = false;

    let zone = e.pref;
    if (p.limbs[zone].hp <= 0 || Math.random() < 0.4) {
      const opts = D.ZONES.filter(z => p.limbs[z].hp > 0);
      zone = opts.length ? U.pick(opts) : 'body';
    }

    let dmg = U.rint(e.dmg[0], e.dmg[1]);
    if (e.limbs.arms.hp <= 0) { dmg = Math.max(1, Math.round(dmg * 0.6)); log('Tay nó vừa vỡ — cú đánh yếu đi.', 'info'); }
    if (legBroken()) dmg += U.rint(1, 2);
    if (Math.random() < e.crit) { dmg = Math.round(dmg * 1.6); log('Nó ra đòn quá tay — đòn NẶNG!', 'bad'); }
    if (C.guard) { dmg = Math.max(1, Math.round(dmg * 0.4)); C.guard = false; log('Bạn gồng đỡ trọn — sát thương giảm sâu.', 'info'); }

    G.damageZone(zone, dmg, e);
    log(`${e.name} công ${D.ZONE_VI[zone]}: −${dmg} máu.`, 'bad');
    SND.play('hurt');
    G.checkPlayerDeath();
  }

  function again() {
    if (!C || C.done) return;
    C.st = Math.min(12, C.st + 2);
    menu();
  }

  // ---------- kết thúc ----------
  function finish(kind) {
    C.done = true;
    const reward = G.afterCombat(kind, C.e);
    if (kind === 'win') {
      log(`${C.e.name} im bặt. Căn hầm nhớ một điều mới về bạn.`, 'good');
      if (reward) {
        const rn = D.ITEMS[reward] ? D.ITEMS[reward].name
          : (D.WEAPONS[reward] ? D.WEAPONS[reward].name : reward);
        log(`Lục trên xác, tìm được: <b>${rn}</b>.`, 'good');
      }
      SND.play('win');
    } else {
      log('Bạn sống sót — lần này.', 'info');
      SND.play('open');
    }
    C.phase = 'over';
    renderZones();
    document.getElementById('combatMenu').innerHTML = '<button data-k="cont">➤ Tiếp tục</button>';
  }

  function end() {
    C = null;
    G.state.screen = 'dungeon';
    document.getElementById('combatOverlay').classList.add('hidden');
    G.refreshHUD();
    G.render();
  }

  // ---------- tương tác ----------
  function click(k, extra) {
    if (!C) return;
    if (C.phase === 'over') { if (k === 'cont') end(); return; }
    if (k === 'back') { menu(); return; }
    switch (C.phase) {
      case 'menu':
        if (k === 'attack') zoneMenu();
        else if (k === 'skill') showSkills();
        else if (k === 'item') showItems();
        else if (k === 'flee') doFlee();
        break;
      case 'zone': if (D.ZONES.includes(k)) doAttack(k); break;
      case 'skills': if (k === 'skill' && extra) useSkill(extra); break;
      case 'zoneSkill':
        if (D.ZONES.includes(k)) { const id = C.pendingSkill; C.pendingSkill = null; useSkillDirect(id, k); }
        break;
      case 'items': if (k === 'item' && extra) useItemCombat(extra); break;
    }
  }

  // dùng kỹ năng có chọn vùng: trừ ST đúng lúc
  function useSkillDirect(id, zone) {
    const s = D.SKILLS[id];
    if (C.st < s.cost) return;
    C.st -= s.cost;
    applySkill(id, zone);
  }

  function key(num) {
    if (!C) return;
    const n = Number(num);
    if (C.phase === 'over') { if (n === 1) end(); return; }
    if (C.phase === 'menu') {
      if (n === 1) zoneMenu();
      else if (n === 2) showSkills();
      else if (n === 3) showItems();
      else if (n === 4) doFlee();
      return;
    }
    const z = ['head', 'body', 'arms', 'legs'][n - 1];
    if ((C.phase === 'zone' || C.phase === 'zoneSkill') && z) click(z);
  }

  window.CB = { start, click, key, get active() { return !!C; } };
  return window.CB;
})();
