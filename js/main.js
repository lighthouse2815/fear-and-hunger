'use strict';
/* ============================================================
   CỐI HẦM — khởi động: màn hình, âm thanh, điều khiển
   ============================================================ */

const BOOT = (() => {
  const D = DATA;
  const $ = id => document.getElementById(id);

  // ---------- màn hình ----------
  function showScreen(name) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    if (name) $(name).classList.remove('hidden');
  }

  let wired = false;

  function init() {
    buildTitle();
    if (!wired) {
      wireCombatMenu();
      wireStash();
      wireDpad();
      wireKeys();
      wired = true;
    }
    showScreen('titleScreen');
  }

  // ---------- màn hình tiêu đề ----------
  function buildTitle() {
    const cards = $('cards');
    cards.innerHTML = '';
    for (const [id, o] of Object.entries(D.ORIGINS)) {
      const items = Object.entries(o.items)
        .map(([k, v]) => (D.ITEMS[k] ? D.ITEMS[k].name : (D.WEAPONS[k] ? D.WEAPONS[k].name : k)) + ' ×' + v)
        .join(' · ');
      const sk = o.skills.map(s => D.SKILLS[s].name).join(' · ');
      const el = document.createElement('button');
      el.className = 'card';
      el.innerHTML = `
        <div class="c-glyph">${o.glyph}</div>
        <div class="c-name">${o.name}</div>
        <div class="c-tag">${o.tagline}</div>
        <div class="c-line">Máu: ${sumLimbs(o)} · Xu may: ${o.luck} · Thể lực: ${o.st}</div>
        <div class="c-line">${items}</div>
        <div class="c-line dim">Kỹ năng: ${sk}</div>`;
      el.addEventListener('click', () => begin(id));
      cards.appendChild(el);
    }
    const cont = $('btnContinue');
    if (G.hasSave()) {
      cont.classList.remove('hidden');
      cont.onclick = () => { if (G.load()) showScreen(null); };
    } else {
      cont.classList.add('hidden');
      cont.onclick = null;
    }
  }

  function sumLimbs(o) {
    return Object.values(o.limbs).reduce((a, b) => a + b, 0);
  }

  function begin(originId) {
    $('introText').innerHTML = D.TEXTS.intro.map(p => `<p>${p}</p>`).join('');
    $('btnDescend').onclick = () => {
      showScreen(null);
      G.newGame(originId);
    };
    showScreen('introScreen');
  }

  // ---------- màn kết ----------
  function statsLine(st) {
    return `Xuất thân: <b>${st.origin}</b> · Sâu nhất tầng ${st.floors}/${D.FLOORS.length}` +
      ` · Bước chân ${st.steps} · Trận thắng <b>${st.wins}</b> · Chạy trốn ${st.fled}` +
      ` · Chi tiết cơ thể để lại: ${st.limbsCut}` +
      ` · No ${st.hunger}/100 · Kinh hoàng ${st.dread}/100`;
  }

  function showDeath(cause, st) {
    $('deathStats').innerHTML = `<p>${cause}</p><p class="stat">${statsLine(st)}</p>`;
    $('btnAgain1').onclick = () => init();
    SND.play('die');
    showScreen('deathScreen');
  }

  function showWin(text, st) {
    $('winText').innerHTML = D.TEXTS.win.map(p => `<p>${p}</p>`).join('');
    $('winStats').innerHTML = `<p class="stat">${statsLine(st)}</p>`;
    $('btnAgain2').onclick = () => init();
    SND.play('win');
    showScreen('winScreen');
  }

  // ---------- bấm nút trong trận ----------
  function wireCombatMenu() {
    $('combatMenu').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.k) CB.click(b.dataset.k);
      else if (b.dataset.sk) CB.click('skill', b.dataset.sk);
      else if (b.dataset.it) CB.click('item', b.dataset.it);
    });
  }

  function wireStash() {
    $('stash').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      G.consumeItem(b.dataset.id, false);
      G.render();
    });
  }

  function wireDpad() {
    for (const b of document.querySelectorAll('#dpad button[data-dir]')) {
      b.addEventListener('click', () => {
        const dir = b.dataset.dir;
        if (dir === 'u') G.move(0, -1);
        else if (dir === 'd') G.move(0, 1);
        else if (dir === 'l') G.move(-1, 0);
        else if (dir === 'r') G.move(1, 0);
        else if (dir === 'e') G.interact();
      });
    }
  }

  // ---------- phím ----------
  function wireKeys() {
    window.addEventListener('keydown', ev => {
      const blocked = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
      if (blocked.includes(ev.key)) ev.preventDefault();

      if (ev.key === 'm' || ev.key === 'M') {
        SND.toggle();
        G.log(SND.muted ? 'Tắt tiếng.' : 'Bật tiếng.', 'info');
        return;
      }
      const anyScreenVisible = document.querySelector('.screen:not(.hidden)');
      if (anyScreenVisible) return;

      if (G.state && G.state.screen === 'combat' && CB.active) {
        const n = { '1': 1, '2': 2, '3': 3, '4': 4 }[ev.key];
        if (n) CB.key(n);
        return;
      }
      if (!G.state) return;
      if (G.state.screen !== 'dungeon') return;

      switch (ev.key) {
        case 'ArrowUp': case 'w': case 'W': G.move(0, -1); break;
        case 'ArrowDown': case 's': case 'S': G.move(0, 1); break;
        case 'ArrowLeft': case 'a': case 'A': G.move(-1, 0); break;
        case 'ArrowRight': case 'd': case 'D': G.move(1, 0); break;
        case 'e': case 'E': G.interact(); break;
      }
    });
  }

  window.BOOT = { init, showScreen, showDeath, showWin, begin };
  return window.BOOT;
})();

window.addEventListener('DOMContentLoaded', () => window.BOOT.init());
