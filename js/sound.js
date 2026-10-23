'use strict';
/* ============================================================
   CỐI HẦM — âm thanh nhỏ gối bằng WebAudio (không tài nguyên ngoài)
   ============================================================ */
window.SND = (() => {
  let ctx = null;
  let muted = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    return ctx;
  }

  function blip(freq, dur, type, vol) {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    try {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.03, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + dur);
    } catch (e) { /* thiếu âm thì thôi */ }
  }

  const api = {
    play(kind) {
      switch (kind) {
        case 'step':  blip(90, 0.05, 'sine', 0.015); break;
        case 'coin':  blip(880, 0.08, 'square', 0.02); blip(1320, 0.1, 'square', 0.015); break;
        case 'hit':   blip(150, 0.09, 'sawtooth', 0.05); break;
        case 'hurt':  blip(70, 0.16, 'sawtooth', 0.06); break;
        case 'open':  blip(240, 0.2, 'triangle', 0.04); blip(360, 0.2, 'triangle', 0.02); break;
        case 'rest':  blip(200, 0.3, 'sine', 0.03); break;
        case 'die':   blip(60, 0.5, 'sawtooth', 0.06); break;
        case 'win':   blip(520, 0.12, 'square', 0.03); blip(660, 0.12, 'square', 0.03); blip(880, 0.2, 'square', 0.03); break;
      }
    },
    toggle() {
      muted = !muted;
      return muted;
    },
    get muted() { return muted; },
  };
  return api;
})();
