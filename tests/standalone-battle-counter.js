'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const watchdog = setTimeout(() => { console.error('Phản đòn chưa hoàn tất.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.5, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1, 3] });
    let runtime = engine.battle;
    const db = engine.database;
    const skillId = db.Skills.length, enemyId = db.Enemies.length, troopId = db.Troops.length, stateId = db.States.length;
    const originalAttack = db.Skills[1];
    db.Skills.push({ ...originalAttack, id: skillId, note: '', name: 'Đòn kiểm tra', animationId: 0, repeats: 1,
        effects: [], mpCost: 0, tpCost: 0, tpGain: 0, damage: { type: 1, formula: '10', variance: 0, critical: false, elementId: 0 } });
    db.Enemies.push({ ...db.Enemies[1], id: enemyId, params: [1000, 100, 20, 10, 10, 10, 10, 10],
        traits: [{ code: 22, dataId: 0, value: 1 }], actions: [] });
    db.Troops.push({ id: troopId, pages: [], members: [{ enemyId, x: 408, y: 400, hidden: false }] });
    db.States.push({ ...db.States[26], id: stateId, restriction: 4, traits: [] });
    db.Skills[1] = { ...db.Skills[skillId], id: 1, name: 'Attack', repeats: 3, mpCost: 200, tpCost: 200, tpGain: 10,
        effects: [{ code: 44, dataId: 1 }],
        damage: { type: 1, formula: '7', variance: 0, critical: false, elementId: 0 } };
    function reset() {
        runtime.finish('escape'); engine.animations.dispose();
        engine.state.party.forEach(id => { engine.state.recoverActor(id); engine.state.changeActorSkill(id, skillId, true); });
        runtime.setup(troopId, true, true); engine.state.scene = 'battle'; runtime.random = () => 0.5;
        db.Skills[skillId].repeats = 1; db.Skills[skillId].hitType = 1; db.Skills[skillId].effects = [];
    }
    const strike = () => runtime.useSkill(runtime.actor(1), skillId, 0);
    const counterState = () => runtime.handleEffect(333, [0, 0, 37]);
    async function finish(promise) {
        let done = false, value, failure;
        promise.then(result => { done = true; value = result; }, error => { done = true; failure = error; });
        for (let i = 0; i < 1000 && !done; i++) { engine.advanceRoutes(16); await flush(); }
        assert.equal(done, true); if (failure) throw failure; return value;
    }
    reset(); counterState(); engine.state.changeActorState(1, 26, true);
    engine.state.changeActorState(3, 101, true);
    const allyHp = engine.state.actor(3).hp;
    const hp = engine.state.actor(1).hp, mp = runtime.enemy(0).mp;
    db.Skills[skillId].repeats = 3;
    const report = strike();
    assert.equal(runtime.enemy(0).hp, 970, 'phản đòn vẫn nhận đủ sát thương đòn gốc');
    assert.equal(engine.state.actor(1).hp, hp - 21, 'mỗi lần trúng đòn gây một lần phản công');
    assert.equal(engine.state.actor(3).hp, allyHp, 'phản đòn bỏ qua đồng đội đang Taunt');
    assert.ok(report.hits.every(hit => hit.counter.hits.length === 1 && !hit.counter.hits[0].counter), 'không lặp ba đòn Attack hoặc phản công lẫn nhau vô hạn');
    assert.ok(report.hits.every(hit => !hit.counter.commonEvents.length), 'phản đòn không chạy hiệu ứng common event toàn cục');
    assert.equal(runtime.enemy(0).mp, mp, 'phản đòn không trả chi phí Attack');
    assert.equal(runtime.enemy(0).tp, 30, 'TP gain được tính cho từng lần phản công');
    assert.equal(runtime.battle.lastAction, report);
    assert.equal(runtime.battle.lastTargets['enemy:0'], undefined, 'phản đòn không thay mục tiêu trước của hành động đã chọn');

    reset(); counterState(); runtime.enemy(0).hp = 10;
    assert.equal(strike().hits[0].counter, undefined, 'bị hạ bởi đòn gốc không thể phản công');
    reset(); counterState(); runtime.handleEffect(333, [0, 0, stateId]);
    assert.equal(strike().hits[0].counter, undefined, 'bất động trước đòn không phản công');
    reset(); counterState(); db.Skills[skillId].effects = [{ code: 21, dataId: stateId, value1: 1 }];
    assert.equal(strike().hits[0].counter, undefined, 'bất động do chính đòn gốc ngăn phản công');
    reset(); counterState(); db.States[stateId].restriction = 1;
    runtime.handleEffect(333, [0, 0, stateId]);
    assert.ok(strike().hits[0].counter, 'rối loạn vẫn cử động được và có thể phản đòn');
    db.States[stateId].restriction = 4;
    reset(); db.Skills[skillId].effects = [{ code: 21, dataId: 37, value1: 1 }];
    assert.equal(strike().hits[0].counter, undefined, 'thêm Counter sau khi chọn phản ứng không phản công ngay');
    for (const hitType of [0, 2]) {
        reset(); counterState(); db.Skills[skillId].hitType = hitType;
        assert.equal(strike().hits[0].counter, undefined, 'chỉ đòn vật lý kích hoạt phản công');
    }
    reset(); counterState();
    db.Skills[skillId].successRate = 0;
    assert.ok(strike().hits[0].counter, 'đòn gốc trượt vẫn có phản công theo plugin');
    db.Skills[skillId].successRate = 100;
    reset(); counterState(); db.Enemies[enemyId].traits.push({ code: 22, dataId: 1, value: 1 });
    const evaded = strike().hits[0];
    assert.equal(evaded.evaded, true); assert.ok(evaded.counter, 'né đòn gốc không hủy phản công');
    db.Enemies[enemyId].traits.pop();
    reset(); counterState();
    db.States[37].traits[0].value = 0.25;
    assert.equal(strike().hits[0].counter, undefined, 'trait phần trăm dùng xác suất thật');
    db.States[37].traits[0].value = 1;

    reset(); engine.state.changeActorState(1, 26, true); engine.state.changeActorState(3, 101, true);
    // Bỏ qua Taunt chỉ cho đòn gốc để chọn nhân vật đang Counter.
    const note = db.Skills[skillId].note;
    db.Skills[skillId].note = '<Bypass Taunt>';
    runtime.handleEffect(333, [0, 0, 100]);
    const actorHp = engine.state.actor(1).hp;
    const incoming = runtime.useSkill(runtime.enemy(0), skillId, 0);
    assert.equal(incoming.hits[0].counter.subject, 'actor');
    assert.equal(incoming.hits[0].counter.target, 0, 'phản công nhắm đúng chủ thể tấn công');
    assert.equal(engine.state.actor(1).hp, actorHp - 10);
    assert.equal(runtime.enemy(0).hp, 993);
    db.Skills[skillId].note = note;
    await engine.restore(engine.save()); runtime = engine.battle;
    assert.deepEqual(runtime.battle.lastAction.hits[0].counter, incoming.hits[0].counter, 'save giữ báo cáo phản đòn không gây sát thương lại');
    assert.equal(runtime.enemy(0).hp, 993);

    reset(); counterState();
    const originalStart = engine.animations.startBattle, animations = [];
    engine.animations.startBattle = function (id, animationId, mirror, type) {
        animations.push({ id, type }); return originalStart.call(this, id, animationId, mirror, type);
    };
    db.Skills[skillId].animationId = 1; db.Skills[1].animationId = 1;
    await finish(engine.forceBattleAction([1, 1, skillId, 0]));
    assert.deepEqual(animations, [{ id: 0, type: 'enemy' }, { id: 1, type: 'actor' }], '339 chờ animation đòn gốc rồi đến phản công đúng phía');
    assert.equal(engine.animations.entries.length, 0);
    assert.equal(runtime.battle.phase, 'input');
    assert.equal(runtime.battle.forcedThisTurn.includes('enemy:0'), false, 'phản đòn không chiếm hành động AI');

    reset(); counterState();
    db.Skills[skillId].repeats = 3;
    engine.state.changeActorHp(1, 7 - engine.state.actor(1).hp, true);
    engine.state.removeActor(3);
    engine.syncBattleActors();
    await finish(engine.battleSkill(1, skillId, 0));
    assert.equal(runtime.battle.result, 'defeat-continue', 'phản đòn kết liễu được xử lý kết quả trận');
    assert.equal(runtime.battle.turnActions[0].hits.length, 1, 'chủ thể bị phản công hạ dừng đòn lặp còn lại');
    assert.equal(runtime.enemy(0).hp, 990);
    assert.equal(engine.state.scene, 'map');

    reset(); counterState(); animations.length = 0;
    const controller = new AbortController();
    const action = engine.forceBattleAction([1, 1, skillId, 0], {}, controller.signal);
    const canceled = assert.rejects(action, /hủy phản đòn/);
    for (let frame = 0; frame < 40 && !animations.length; frame++) { engine.advanceRoutes(1); await flush(); }
    assert.equal(animations.length, 1, 'hủy khi animation đòn gốc đang chạy, trước effect và phản công');
    controller.abort(new Error('hủy phản đòn')); await canceled;
    engine.advanceRoutes(1000); await flush();
    assert.equal(engine.animations.entries.length, 0, 'hủy animation gốc không để phản công chạy muộn');
    assert.equal(animations.length, 1);
    db.Skills[1] = originalAttack;
    console.log('ĐẠT: Counter 26/37 sau đòn, lặp/xác suất, chết/bất động/trượt/né, không dây chuyền/chi phí/Taunt, save, 339/animation/hủy và kết quả trận.');
})().then(() => clearTimeout(watchdog)).catch(error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
