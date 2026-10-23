'use strict';
/* Tiện ích chung của CỐI HẦM */
window.U = Object.freeze({
  rint(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); },
  pick(arr) { return arr[this.rint(0, arr.length - 1)]; },
  chance(p) { return Math.random() < p; },
  clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },
});
