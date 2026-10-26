'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    const e = new GameEngine({ dataStore: store, random: () => 0.5, onRouteEffect: () => true });
    await e.boot({ mapId: 74, x: 8, y: 8, party: [1] });
    const db = e.database, enemyId = db.Enemies.length, troopId = db.Troops.length, skillId = db.Skills.length, commonId = db.CommonEvents.length;
    db.Enemies.push({ ...db.Enemies[1], id: enemyId, note: '', traits: [], params: [1000,100,1,1,1,1,1,1], actions: [] });
    db.Troops.push({ id: troopId, pages: [], members: [0,1].map(i => ({ enemyId, x: 300+i*100, y: 400 })) });
    db.CommonEvents.push({ id: commonId, list: [{ code: 122, parameters: [7300,7300,1,0,1] }] });
    db.Skills.push({ ...db.Skills[3], id: skillId, note: '', scope: 1, animationId: 1, hitType: 0, successRate: 100,
        repeats: 1, mpCost: 4, tpCost: 2, tpGain: 1, damage: { type: 1, formula: '10', critical: false, variance: 0, elementId: 0 },
        effects: [{ code: 44, dataId: commonId }] });
    function reset() {
        e.animations.dispose(); e.battle.finish('escape'); e.state.recoverActor(1); e.state.actor(1).tp = 20;
        e.battle.setup(troopId, true, true); e.state.scene = 'battle'; e.state.setVariable(7300, 0);
        e.state.actor(1).tp = 20;
    }
    async function until(test) {
        for (let frame = 0; frame < 2000 && !test(); frame++) { e.advanceRoutes(4); await flush(); }
        assert.ok(test(), 'sequence đạt điểm kiểm tra sau đủ frame');
    }
    async function finish(promise) {
        let done = false, value, failure;
        promise.then(result => { done = true; value = result; }, error => { done = true; failure = error; });
        await until(() => done); if (failure) throw failure; return value;
    }
    const force = signal => e.forceBattleAction([1,1,skillId,0], {}, signal);
    reset();
    const mp = e.state.actor(1).mp, running = force();
    assert.equal(e.state.actor(1).mp, mp - 4); assert.equal(e.state.actor(1).tp, 18);
    assert.equal(e.battle.enemy(0).hp, 1000, 'khởi tạo hành động chưa áp damage');
    await until(() => e.animations.entries.length > 0);
    e.advanceRoutes(4); await flush();
    assert.equal(e.battle.enemy(0).hp, 1000, 'mặc định đợi animation rồi mới chạy effect');
    assert.equal(e.state.variableValue(7300), 0);
    await finish(running);
    assert.equal(e.battle.enemy(0).hp, 990); assert.equal(e.state.variableValue(7300), 1);
    assert.equal(e.state.actor(1).mp, mp - 4); assert.equal(e.state.actor(1).tp, 19);
    const report = e.battle.battle.lastAction;
    assert.equal(JSON.stringify(report).includes('pendingAction'), false, 'không ghi closure/runtime vào save');
    await finish(e.completeBattleAction(report));
    assert.equal(e.battle.enemy(0).hp, 990, 'hoàn tất lại không áp damage lần nữa');
    assert.equal(e.state.variableValue(7300), 1, 'không chạy common event lại khi action đã hoàn tất');

    reset(); const controller = new AbortController(), canceled = force(controller.signal);
    const rejected = assert.rejects(canceled, /hủy trước effect/);
    await until(() => e.animations.entries.length > 0);
    controller.abort(new Error('hủy trước effect')); await rejected; e.advanceRoutes(1000); await flush();
    assert.equal(e.battle.enemy(0).hp, 1000); assert.equal(e.state.variableValue(7300), 0);
    assert.equal(e.animations.entries.length, 0); assert.equal(e.screen.waiters.size, 0);

    db.Skills[skillId].note = '<Target Action>\naction animation\naction effect\nwait for animation\n</Target Action>';
    reset(); const immediate = force(); await flush();
    assert.ok(e.animations.entries.length > 0);
    assert.equal(e.battle.enemy(0).hp, 990, 'note đặt effect trước wait áp damage trong lúc animation chạy');
    assert.equal(e.state.variableValue(7300), 0); await finish(immediate);

    db.Skills[skillId].scope = 2; db.Skills[skillId].animationId = 0;
    db.Skills[skillId].note = '<Target Action>\naction effect\ndeath break\naction effect\n</Target Action>';
    reset(); e.battle.enemy(0).hp = 1;
    await finish(force());
    assert.equal(e.battle.enemy(1).hp, 980, 'death break kiểm tra chủ thể, không bỏ mục tiêu tiếp theo khi đích trước bị hạ');
    assert.equal(e.battle.battle.lastAction.hits.length, 4, 'IMMORTAL giữ đích ở 0 HP đến cuối sequence nên nhận đủ effect');

    for (const [id, count] of [[1,1],[121,1],[143,4],[191,2],[242,2],[270,5],[283,1]]) {
        reset();
        const original = db.Skills[id];
        db.Skills[id] = { ...original, hitType: 0, successRate: 100, effects: [], mpCost: 0, tpCost: 0,
            damage: { type: 1, formula: '10', critical: false, variance: 0, elementId: 0 } };
        await finish(e.forceBattleAction([1,1,id,0]));
        assert.equal(e.battle.battle.lastAction.hits.length, count, 'thực thi note thật theo phase của skill ' + id);
        db.Skills[id] = original;
    }
    console.log('ĐẠT: phase whole/target thật, damage đúng thời điểm animation/effect/wait, trả phí một lần, common event cuối action, hủy, không đánh lại và death break theo chủ thể.');
})().catch(error => { console.error(error); process.exitCode = 1; });
