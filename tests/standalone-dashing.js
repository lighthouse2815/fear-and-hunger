'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const { EventScheduler } = require('../game/engine/event-scheduler');
const delay = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0 });
    await engine.boot({ mapId: 74, x: 15, y: 22, direction: 8, party: [1], switches: {246:true}, variables:{121:1}, alwaysDash:false });
    const command = text => engine.createInterpreter([{code:356,parameters:[text]}], 11).run();
    assert.equal(engine.playerStepFrames(), 16);
    engine.buttons.add('shift');
    assert.equal(engine.playerStepFrames(), 8);
    await command('DisableDashing');
    assert.equal(engine.playerStepFrames(), 16);
    await engine.restore(engine.save());
    assert.equal(engine.state.dashEnabled, false, 'save giữ lệnh tắt dash');
    await command('EnableDashing');
    assert.equal(engine.playerStepFrames(), 8);
    await command('ToggleDashing'); assert.equal(engine.canDash(), false);
    await command('ToggleDashing'); assert.equal(engine.canDash(), true);
    engine.map.data.disableDashing = true; assert.equal(engine.canDash(), false);
    engine.map.data.disableDashing = false;
    engine.state.vehicleId = 0; assert.equal(engine.canDash(), false);
    engine.state.vehicleId = -1;
    const actor = engine.state.actor(1), database = engine.database;
    const sources = [database.Actors[1], database.Classes[actor.classId], database.Weapons[actor.equips[0]]];
    for (const source of sources.filter(Boolean)) {
        const note = source.note;
        source.note = note + '\n<Disable Dash>';
        assert.equal(engine.canDash(), false);
        source.note = note;
        assert.equal(engine.canDash(), true, 'không giữ cache tắt dash sau khi nguồn thay đổi');
    }
    engine.state.changeActorState(1, 4, true);
    const note = database.States[4].note;
    database.States[4].note += '\n<Disable Dashing>';
    assert.equal(engine.canDash(), false);
    engine.state.changeActorState(1, 4, false); assert.equal(engine.canDash(), true);
    database.States[4].note = note;
    engine.state.through = true;
    assert.equal(engine.move(6), true);
    assert.equal(engine.state.moveFrames, 8);
    engine.advanceRoutes(4); assert.equal(engine.state.moveFrames, 4);
    engine.buttons.delete('shift'); engine.move(4);
    assert.equal(engine.state.moveFrames, 16);
    engine.state.alwaysDash = true;
    assert.equal(engine.playerStepFrames(), 8, 'mặc định trò chơi luôn chạy nhanh khi được phép');

    await engine.boot({ mapId:74, x:15, y:22, direction:8, party:[1], switches:{246:true}, variables:{121:1} });
    const sounds = [], errors = [], scheduler = new EventScheduler(engine, { effect: (code, parameters) => {
        if (code !== 250) return false;
        sounds.push(parameters[0].name); return true;
    } }, error => errors.push(error.message));
    for (let frame = 0; frame < 600; frame++) { scheduler.tick(); engine.advanceRoutes(1); await delay(); }
    scheduler.stop(); await delay();
    assert.deepEqual(errors, [], 'tất cả common event ở cổng ngục chạy liên tục không còn lỗi plugin chưa hỗ trợ');
    assert.equal(scheduler.failedPages.size, 0);
    assert.equal(engine.state.switchValue(79), true);
    assert.ok(engine.state.variableValue(155) > 0, 'bộ đếm thời gian chơi chạy trong nền');
    assert.equal(engine.state.dashEnabled, false, 'common event kiểm soát điều kiện chạy nhanh');
    assert.ok(sounds.length > 0, 'sự kiện âm thanh nền vẫn được gửi tới audio handler');
    for (const sound of sounds) await fs.access(path.join(__dirname, '../game/audio/se', sound + '.ogg'));

    let count = 0;
    function scan(value) {
        if (!value || typeof value !== 'object') return;
        if (value.code === 356 && /^(Enable|Disable|Toggle)Dashing$/.test(value.parameters[0])) count++;
        Object.values(value).forEach(item => { if (item && typeof item === 'object') scan(item); });
    }
    for (const file of (await fs.readdir(path.join(__dirname, '../game/data'))).filter(file => /^(Map\d+|CommonEvents|Troops)\.json$/.test(file))) {
        scan(JSON.parse(await fs.readFile(path.join(__dirname, '../game/data', file), 'utf8')));
    }
    assert.equal(count, 28);
    console.log('ĐẠT: tốc độ Shift, bật/tắt/toggle, điều kiện map/actor/trang bị/state/save, 28 lệnh JSON và 600 frame nền Map074.');
})().catch(error => { console.error(error); process.exitCode = 1; });
