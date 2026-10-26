'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const watchdog = setTimeout(() => { console.error('Trạng thái bước đi chưa hoàn tất.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const sourceMap = store.loadMap.bind(store);
    const map = { width: 4, height: 1, tilesetId: 1, events: [], data: [1, 1, 1, 1, ...Array(20).fill(0)] };
    store.loadMap = id => id === 901 ? Promise.resolve(map) : sourceMap(id);
    const engine = new GameEngine({ dataStore: store, random: () => 0.5 });
    await engine.boot({ mapId: 901, x: 0, y: 0, party: [1, 3], through: true });
    const walk = async count => { for (let i = 0; i < count; i++) assert.equal(await engine.step(engine.state.x === 0 ? 6 : 4), true); };
    engine.state.changeActorState(1, 5, true); engine.state.changeActorState(1, 17, true);
    engine.state.changeActorState(3, 90, true);
    await walk(19);
    assert.equal(engine.state.walkSteps, 19); assert.equal(engine.state.actor(1).hp, 100);
    assert.equal(await engine.step(4), true); // x=1 -> 0, bước 20.
    assert.equal(engine.state.actor(1).hp, 87); assert.equal(engine.state.actor(3).hp, 80);
    assert.equal(engine.state.walkEffects.length, 2); assert.ok(engine.state.screen.flash.opacity > 0);
    const effects = engine.state.walkEffects;
    assert.equal(await engine.step(4), false, 'va mép map không tính bước');
    assert.equal(engine.state.walkSteps, 20); assert.equal(engine.state.actor(1).hp, 87); assert.equal(engine.state.walkEffects, effects);
    engine.openMenu(); assert.equal(await engine.step(6), false); engine.closeMenu();
    engine.eventRunning = true; assert.equal(await engine.step(6), false); engine.eventRunning = false;
    assert.equal(engine.state.walkSteps, 20);
    // Route cưỡng chế và teleport không phải bước đi bộ điều khiển.
    const route = engine.createInterpreter([{ code: 205, parameters: [-1, { list: [{ code: 3 }, { code: 0 }], wait: true, skippable: true }] }], 0).run();
    await new Promise(resolve => setImmediate(resolve)); engine.advanceRoutes(60); await route;
    assert.equal(engine.state.x, 1); assert.equal(engine.state.walkSteps, 20);
    await engine.loadMap(901, { x: 0, y: 0, direction: 6 }); assert.equal(engine.state.walkSteps, 20);
    engine.state.vehicleId = 0; await walk(2); engine.state.vehicleId = -1;
    assert.equal(engine.state.walkSteps, 20, 'trên phương tiện không tick trạng thái đi bộ');
    await walk(19); assert.equal(engine.state.walkSteps, 39);
    const saved = engine.save(); await engine.restore(saved);
    assert.equal(engine.state.walkSteps, 39); assert.equal(engine.state.actor(1).hp, 87, 'tải save không tick lại');
    await walk(1); assert.equal(engine.state.actor(1).hp, 74); assert.equal(engine.state.actor(3).hp, 60);
    assert.equal(engine.createInterpreter([], 0).gameDataOperand(7, 3, 0), 40, 'event đọc được tổng bước');
    // Save cũ không có bộ đếm bước vẫn được tải.
    const old = engine.save(); delete old.walkSteps; delete old.walkEffects;
    await engine.restore(old); assert.equal(engine.state.walkSteps, 0); assert.deepEqual(engine.state.walkEffects, []);
    await walk(19); engine.state.gainItem('items', 52, 1); engine.openMenu(); await engine.useMenuItem(52, 1);
    assert.equal(engine.state.actor(1).states.includes(17), false);
    const before = engine.state.actor(1).hp; await walk(1);
    assert.equal(engine.state.actor(1).hp, before - 3, 'giải độc trước bước 20 ngăn poison; Bleeding vẫn tick');

    // Bộ đếm removeByWalking giữ qua thay đổi chỉ số/save, thêm lại state đặt lại đếm.
    const id = engine.database.States.length;
    engine.database.States.push({ ...engine.database.States[5], id, removeByWalking: true, stepsToRemove: 3 });
    engine.state.changeActorState(1, id, true); await walk(1);
    assert.equal(engine.state.actor(1).stateSteps[id], 2);
    engine.state.changeActorMp(1, -1); assert.equal(engine.state.actor(1).stateSteps[id], 2);
    await engine.restore(engine.save()); await walk(1); assert.equal(engine.state.actor(1).stateSteps[id], 1);
    engine.state.changeActorState(1, id, true); assert.equal(engine.state.actor(1).stateSteps[id], 3);
    await walk(3); assert.equal(engine.state.actor(1).states.includes(id), false);
    assert.equal(engine.state.actor(1).stateSteps[id], undefined); assert.deepEqual(engine.state.walkEffects[0].removedStates, [id]);
    engine.state.changeActorState(1, id, true); engine.state.changeActorState(1, id, false);
    assert.equal(engine.state.actor(1).stateSteps[id], undefined);
    engine.state.changeActorState(1, id, true); engine.state.recoverActor(1); assert.deepEqual(engine.state.actor(1).stateSteps, {});
    engine.state.changeActorState(1, id, true);
    const legacy = engine.save(); delete legacy.actors[1].stateSteps;
    await engine.restore(legacy); await walk(1); assert.equal(engine.state.actor(1).stateSteps[id], 2);

    // Trait hồi phục + state hữu hạn dùng đúng nhịp 20 bước.
    const regenId = engine.database.States.length;
    engine.database.States.push({ ...engine.database.States[2], id: regenId, traits: [
        { code: 22, dataId: 7, value: 0.2 }, { code: 22, dataId: 8, value: 0.3 }, { code: 22, dataId: 9, value: 0.4 }
    ] });
    engine.state.recoverActor(1); engine.state.changeActorHp(1, -50, true); engine.state.changeActorMp(1, -50);
    engine.state.actor(1).tp = 0; engine.state.changeActorState(1, regenId, true); engine.state.walkSteps = 19;
    await walk(1);
    assert.equal(engine.state.actor(1).hp, 70); assert.equal(engine.state.actor(1).mp, 80); assert.equal(engine.state.actor(1).tp, 40);
    assert.equal(engine.state.actor(1).states.includes(regenId), false, 'state hết sau tick cuối, không giảm duration mỗi bước');

    // HP đổi trước sự kiện chạm; game over do slip damage ngăn sự kiện ở ô đích.
    map.events = [{ id: 1, x: 1, y: 0, pages: [{ conditions: {}, priorityType: 0, trigger: 1, list: [
        { code: 122, parameters: [6290, 6290, 0, 3, 3, 1, 2] }, { code: 121, parameters: [6291, 6291, 0] }
    ] }] }];
    await engine.loadMap(901, { x: 0, y: 0, direction: 6 });
    engine.state.recoverActor(1); engine.state.changeActorState(1, 17, true); engine.state.walkSteps = 19;
    await engine.step(6); assert.equal(engine.state.variableValue(6290), 90);
    engine.state.setSwitch(6291, false); engine.database.System.optSlipDeath = true;
    engine.state.party.forEach(id => { engine.state.recoverActor(id); engine.state.changeActorHp(id, -95, true); engine.state.changeActorState(id, 17, true); });
    engine.state.x = 0; engine.state.walkSteps = 19;
    await engine.step(6); assert.equal(engine.state.scene, 'gameover'); assert.equal(engine.state.switchValue(6291), false);
    assert.equal(engine.stepRunning, false); assert.equal(await engine.step(4), false);
    console.log('ĐẠT: trạng thái mỗi 20 bước, va chạm/menu/route/vehicle, save cũ-mới, removeByWalking, hồi phục, giải độc và game over trước touch event.');
})().then(() => clearTimeout(watchdog)).catch(error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
