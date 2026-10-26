'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'game');
const html = fs.readFileSync(path.join(root, 'standalone.html'), 'utf8');
assert.match(html, /engine\/game-engine\.js/);
assert.match(html, /engine\/canvas-renderer\.js/);
assert.doesNotMatch(html, /rpg_|plugins\.js|compat\.js/);
assert.match(html, /js\/libs\/pixi\.js/);
assert.match(html, /engine\/vendor\/pixi-filters\.js/);
assert.match(html, /engine\/animation-runtime\.js/);
assert.doesNotMatch(html, /js\/plugins\//);
assert.match(fs.readFileSync(path.join(root, 'engine/browser-preview.js'), 'utf8'), /new FNHStandaloneEngine\.GameEngine/);
console.log('ĐẠT: trang preview độc lập chỉ nạp engine mới và asset/data hiện có.');
