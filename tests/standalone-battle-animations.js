'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const sounds = [], engine = new GameEngine({ dataStore: store,
        onRouteEffect: (code, p) => { if (code === 250) sounds.push(p[0].name); } });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1] });
    engine.battle.setup(1); engine.state.scene = 'battle';
    const run = p => engine.createInterpreter([{ code: 337, parameters: p },
        { code: 121, parameters: [6200, 6200, 0] }], 0).run();
    await run([0, 7, false]);
    assert.equal(engine.state.switchValue(6200), true, '337 không chờ hết animation');
    assert.equal(engine.animations.entries.length, 1);
    assert.equal(engine.animations.entries[0].targetId, 0);
    engine.advanceRoutes(8);
    assert.equal(engine.animations.entries[0].lastFrame, 0);
    assert.ok(sounds.includes('coin_flip1') || sounds.includes('coin_flip2'));
    const elapsed = engine.animations.entries[0].elapsed;
    await engine.restore(engine.save());
    assert.equal(engine.animations.entries[0].elapsed, elapsed, 'save giữ tiến trình animation trận');
    engine.advanceRoutes(1000); assert.equal(engine.animations.entries.length, 0);
    engine.battle.enemy(1).hidden = true;
    engine.battle.handleEffect(333, [2, 0, 1]);
    await run([999, 13, true]);
    assert.equal(engine.animations.entries.length, 5, 'cờ toàn bộ bỏ qua index và loại quái ẩn/chết');
    engine.advanceRoutes(8);
    assert.ok(engine.animations.targetEffect(0, null, 'enemy'), 'flash mục tiêu chạy trong trận');
    assert.equal(engine.animations.targetEffect(0, 74), null, 'không nhầm quái với event trên map');
    engine.animations.clearBattle();
    await run([-1, 30, false]); assert.equal(engine.animations.entries.length, 5);
    await assert.rejects(run([0, 9999, false]), /Không tìm thấy animation/);
    engine.animations.clearBattle();
    engine.animations.start(-1, 7, 74); // Animation bản đồ tạm dừng trong trận.
    const mapElapsed = engine.animations.entries[0].elapsed;
    await run([0, 7, false]); engine.advanceRoutes(4);
    assert.equal(engine.animations.entries[0].elapsed, mapElapsed);
    engine.battle.finish('escape'); engine.leaveBattle('escape');
    assert.equal(engine.animations.entries.length, 1, 'rời trận dọn riêng animation trận');
    engine.advanceRoutes(4); assert.ok(engine.animations.entries[0].elapsed > mapElapsed);
    engine.animations.dispose();
    await assert.rejects(run([0, 7, false]), /không hoạt động/);
    let count = 0;
    for (const file of (await fs.readdir(path.join(__dirname, '../game/data'))).filter(f => /^(Map\d+|CommonEvents|Troops)\.json$/.test(f))) {
        function scan(value) {
            if (!value || typeof value !== 'object') return;
            if (value.code === 337) { assert.ok(engine.database.Animations[value.parameters[1]]); count++; }
            Object.values(value).forEach(scan);
        }
        scan(JSON.parse(await fs.readFile(path.join(__dirname, '../game/data', file), 'utf8')));
    }
    assert.ok(count > 2000);
    console.log('ĐẠT: animation quái, 337 đơn/toàn bộ, SE/flash/frame/save, dọn trận và ' + count + ' lệnh JSON thật.');
})().catch(error => { console.error(error); process.exitCode = 1; });
