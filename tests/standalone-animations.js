'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const delay = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const sounds = [], engine = new GameEngine({ dataStore: store, onRouteEffect: (code, params) => {
        if (code === 250) sounds.push(params[0].name);
    } });
    await engine.boot({ mapId: 74, x: 15, y: 22, direction: 8, party: [1] });
    const command = engine.createInterpreter([{ code: 212, parameters: [-1, 7, true] }], 39);
    let done = false, failure;
    const running = command.run().catch(error => { failure = error; }).finally(() => { done = true; });
    assert.equal(engine.animations.entries.length, 1);
    for (let frame = 0; frame < 8; frame++) { engine.advanceRoutes(1); await delay(); }
    assert.equal(done, false, 'lệnh chờ animation chưa kết thúc quá sớm');
    assert.ok(engine.animations.entries[0].lastFrame >= 0);
    assert.ok(sounds.includes('coin_flip1') || sounds.includes('coin_flip2'));
    for (let frame = 0; frame < 300 && !done; frame++) { engine.advanceRoutes(1); await delay(); }
    await running; if (failure) throw failure;
    assert.equal(done, true); assert.equal(engine.animations.entries.length, 0);
    const target = engine.animations.start(102, 128, 74);
    engine.advanceRoutes(8); assert.equal(engine.animations.entries[0].lastFrame, 0);
    assert.equal(engine.animations.targetEffect(102, 74), null);
    const saved = engine.save();
    assert.equal(saved.animations.length, 1);
    await engine.restore(saved);
    assert.equal(engine.animations.entries.length, 1, 'save/tải giữ animation đang chạy');
    engine.advanceRoutes(100); await target;
    await engine.loadMap(1); assert.equal(engine.animations.entries.length, 0, 'đổi map dọn animation cũ');
    await engine.loadMap(74);
    await assert.rejects(engine.createInterpreter([{ code: 212, parameters: [-1, 999, true] }], 1).run(), /Không tìm thấy animation/);
    assert.throws(() => engine.animations.start(-1, 999, 74), /Không tìm thấy animation/);
    let count = 0;
    const files = (await fs.readdir(path.join(__dirname, '../game/data'))).filter(file => /^(Map\d+|CommonEvents|Troops)\.json$/.test(file));
    function scan(value) {
        if (!value || typeof value !== 'object') return;
        if (value.code === 212) { count++; assert.ok(engine.database.Animations[value.parameters[1]], 'animation ' + value.parameters[1]); }
        Object.values(value).forEach(item => { if (item && typeof item === 'object') scan(item); });
    }
    for (const file of files) scan(JSON.parse(await fs.readFile(path.join(__dirname, '../game/data', file), 'utf8')));
    assert.ok(count > 15000);
    console.log('ĐẠT: animation chờ/timing/SE, flash, save/tải, đổi map và ' + count + ' lệnh animation JSON.');
})().catch(error => { console.error(error); process.exitCode = 1; });
