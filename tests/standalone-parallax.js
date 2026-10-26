'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const { ScreenRuntime } = require('../game/engine/screen-runtime');
const { GameState } = require('../game/engine/game-state');
(async () => {
    const state = new GameState(), screen = new ScreenRuntime(state);
    let count = 0;
    for (const file of fs.readdirSync(path.join(__dirname, '../game/data')).filter(file => /^Map\d+\.json$/.test(file))) {
        const map = JSON.parse(fs.readFileSync(path.join(__dirname, '../game/data', file), 'utf8'));
        if (!map.parallaxName) continue;
        screen.setupParallax(map); screen.advance(60);
        assert.equal(screen.screen.parallax.name, map.parallaxName);
        assert.equal(screen.screen.parallax.x, 0); assert.equal(screen.screen.parallax.y, 0, 'speed chỉ cuộn khi trục bật loop');
        fs.accessSync(path.join(__dirname, '../game/img/parallaxes', map.parallaxName + '.png')); count++;
    }
    assert.equal(count, 23);
    screen.handleEffect(284, ['fortress1', true, true, 4, -2]); screen.advance(12);
    assert.equal(screen.screen.parallax.x, 12); assert.equal(screen.screen.parallax.y, -6);
    screen.advance(12, 'battle'); assert.equal(screen.screen.parallax.x, 12, 'trận tạm dừng cuộn parallax');
    const restored = new ScreenRuntime(new GameState(state.toJSON())); restored.advance(12);
    assert.equal(restored.screen.parallax.x, 24); assert.equal(restored.screen.parallax.y, -12);
    restored.handleEffect(284, ['fortress1', false, true, 8, 2]);
    assert.equal(restored.screen.parallax.x, 0); assert.equal(restored.screen.parallax.y, -12, 'giữ offset trục đang loop');
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    const e = new GameEngine({ dataStore: store }); await e.boot({ mapId: 73, x: 8, y: 8, party: [1] });
    assert.equal(e.screen.screen.parallax.name, 'fortress1');
    e.screen.handleEffect(284, ['fortress1', true, false, 4, 0]); e.advanceRoutes(16);
    const offset = e.screen.screen.parallax.x; await e.restore(e.save()); assert.equal(e.screen.screen.parallax.x, offset);
    await e.loadMap(1, { x: 5, y: 5 }); assert.equal(e.screen.screen.parallax.name, '', 'đổi map bỏ parallax do 284 trên map cũ');
    await e.loadMap(73, { x: 8, y: 8 }); assert.equal(e.screen.screen.parallax.name, 'fortress1'); assert.equal(e.screen.screen.parallax.x, 0);
    console.log('ĐẠT: 23 nền parallax thật, chỉ cuộn trục loop, lệnh 284, pause trận, save và đặt lại khi chuyển map.');
})().catch(error => { console.error(error); process.exitCode = 1; });
