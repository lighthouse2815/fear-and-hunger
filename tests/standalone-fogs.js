'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const { ScreenRuntime } = require('../game/engine/screen-runtime');
const { GameState } = require('../game/engine/game-state');
const { CanvasRenderer } = require('../game/engine/canvas-renderer');
(async () => {
    const state = new GameState(), screen = new ScreenRuntime(state);
    let count = 0;
    for (const file of fs.readdirSync(path.join(__dirname, '../game/data')).filter(file => /^Map\d+\.json$/.test(file))) {
        const map = JSON.parse(fs.readFileSync(path.join(__dirname, '../game/data', file), 'utf8'));
        screen.setupFogs(map.note);
        for (const fog of screen.screen.fogs) {
            assert.ok([1,2,3].includes(fog.id)); assert.ok(['$Fog1','Fog1'].includes(fog.name));
            assert.ok([1,1.3,1.5].includes(fog.zoom)); assert.equal(fog.blend, 1); assert.equal(fog.depth, 1);
            assert.equal(fog.panX, 1); assert.equal(fog.panY, 1); assert.equal(fog.moveX, 0); assert.equal(fog.moveY, 0);
            fs.accessSync(path.join(__dirname, '../game/img/fogs', fog.name + '.png')); count++;
        }
    }
    assert.equal(count, 138);
    screen.setupFogs('<fog effect>\nid: 1\nname: "$Fog1"\nmove x: 4\nmove y: -2\npan x: 10\nzoom: 150%\n</fog effect>');
    assert.equal(screen.active(), true); screen.advance(24);
    assert.equal(screen.screen.fogs[0].x, 24); assert.equal(screen.screen.fogs[0].y, -12);
    assert.equal(screen.screen.fogs[0].panX, 2);
    const restored = new ScreenRuntime(new GameState(state.toJSON())); restored.advance(12, 'battle');
    assert.equal(restored.screen.fogs[0].x, 36); assert.equal(restored.screen.fogs[0].y, -18);
    for (const note of ['<fog effect>name: "Fog1"</fog effect>', '<fog effect>id: 1\nname: "Fog1"\nzoom: 0</fog effect>',
        '<fog effect>id: 1\nname: "Fog1"\nopacity: abc</fog effect>']) assert.throws(() => screen.setupFogs(note), /fog/);
    screen.setupFogs(''); assert.equal(screen.screen.fogs.length, 0);
    const renderer = new CanvasRenderer({ getContext: () => ({}) }); renderer.loadImage = async name => name;
    const fogs = { fogs: ['Fog1', '$Fog1', '%Fog1', '!$Fog1'].map((name, id) => ({ id, name })) };
    assert.deepEqual((await renderer.fogImages(fogs, false)).map(entry => entry.fog.name), ['Fog1','$Fog1','!$Fog1']);
    assert.deepEqual((await renderer.fogImages(fogs, true)).map(entry => entry.fog.name), ['$Fog1','%Fog1','!$Fog1']);
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    const e = new GameEngine({ dataStore: store }); await e.boot({ mapId: 74, x: 8, y: 8, party: [1] });
    assert.equal(e.screen.screen.fogs.length, 3);
    e.screen.screen.fogs[0].x = 123; await e.restore(e.save()); assert.equal(e.screen.screen.fogs[0].x, 123);
    await e.loadMap(1, { x: 5, y: 5 }); assert.equal(e.screen.screen.fogs.length, 0, 'rời map có sương dọn lớp fog');
    await e.loadMap(74, { x: 8, y: 8 }); assert.equal(e.screen.screen.fogs[0].x, 0, 'vào lại map khởi tạo fog theo note');
    console.log('ĐẠT: 138 cấu hình fog thật, PNG/zoom/blend/depth, tiền tố map/battle, chuyển động, save, chuyển map và tham số lỗi.');
})().catch(error => { console.error(error); process.exitCode = 1; });
