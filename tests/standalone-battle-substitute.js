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
    await e.boot({ mapId: 74, x: 8, y: 8, party: [1, 2, 3] });
    const db = e.database, enemyId = db.Enemies.length, troopId = db.Troops.length, skillId = db.Skills.length, stateId = db.States.length;
    db.Skills.push({ ...db.Skills[3], id: skillId, note: '', animationId: 0, hitType: 1, repeats: 1,
        successRate: 100, mpCost: 5, tpCost: 0, tpGain: 0, effects: [],
        damage: { type: 1, formula: '10', variance: 0, critical: false, elementId: 0 } });
    db.Enemies.push({ ...db.Enemies[1], id: enemyId, traits: [{ code: 22, dataId: 0, value: 1 }],
        params: [1000, 100, 1, 1, 1, 1, 10, 1], actions: [] });
    db.Troops.push({ id: troopId, pages: [], members: [0, 1].map(i => ({ enemyId, x: 300 + 100 * i, y: 400 })) });
    db.States.push({ ...db.States[2], id: stateId, restriction: 0, traits: [{ code: 62, dataId: 2, value: 1 }] });
    let r = e.battle;
    function hp(id, value) { e.state.changeActorHp(id, value - e.state.actor(id).hp, true); r.syncActors(); }
    function reset() {
        r.finish('escape'); e.animations.dispose(); e.state.party = [1, 2, 3];
        e.state.party.forEach(id => e.state.recoverActor(id));
        r.setup(troopId, true, true); e.state.scene = 'battle'; hp(1, 20);
        Object.assign(db.Skills[skillId], { hitType: 1, repeats: 1, animationId: 0, effects: [], successRate: 100, note: '' });
        db.Enemies[enemyId].traits = [{ code: 22, dataId: 0, value: 1 }];
    }
    const strike = () => r.useSkill(r.enemy(0), skillId, 0);
    async function finish(promise) {
        let done = false, value, error;
        promise.then(result => { done = true; value = result; }, failure => { done = true; error = failure; });
        for (let frame = 0; frame < 2000 && !done; frame++) { e.advanceRoutes(8); await flush(); }
        assert.ok(done, 'hành động hoàn tất'); if (error) throw error; return value;
    }
    assert.ok(db.Actors[2].traits.some(t => t.code === 62 && t.dataId === 2), 'Girl có trait thế thân thật');
    reset(); const girlHp = e.state.actor(2).hp, girlTp = e.state.actor(2).tp, actorTp = e.state.actor(1).tp, mp = r.enemy(0).mp;
    db.Skills[skillId].effects = [{ code: 21, dataId: 5, value1: 1 }];
    const hit = strike().hits[0];
    assert.equal(e.state.actor(1).hp, 20); assert.equal(e.state.actor(2).hp, girlHp - 10);
    assert.deepEqual(hit.substituteFor, { type: 'actor', id: 1 }); assert.equal(hit.target, 2);
    assert.ok(e.state.actor(2).states.includes(5)); assert.ok(!e.state.actor(1).states.includes(5), 'state áp lên người đỡ');
    assert.equal(e.state.actor(1).tp, actorTp); assert.equal(e.state.actor(2).tp, girlTp + Math.floor(500 / e.state.actorParam(2, 0)), 'TP damage cấp cho người đỡ');
    assert.equal(r.enemy(0).mp, mp - 5); assert.equal(r.battle.lastTargets['enemy:0'], 0, 'mục tiêu trước vẫn là đích đã chọn');
    reset(); hp(1, 25); assert.equal(strike().hits[0].substituteFor, undefined, 'đúng 25% HP không được đỡ');
    reset(); hp(1, 24); assert.equal(strike().hits[0].target, 2, 'dưới 25% HP được đỡ');
    reset(); db.Skills[skillId].hitType = 0; assert.equal(strike().hits[0].target, 1, 'certain hit bỏ qua thế thân');
    reset(); db.Skills[skillId].hitType = 2; assert.equal(strike().hits[0].target, 2, 'phép cũng được đỡ');
    for (const state of [1, 10]) {
        reset(); e.state.changeActorState(2, state, true); r.syncActors();
        assert.equal(strike().hits[0].target, 1, 'chết hoặc Sleep không thể thế thân');
    }
    reset(); e.state.changeActorState(2, 7, true); r.syncActors(); assert.equal(strike().hits[0].target, 2, 'Rage vẫn cử động được');
    reset(); r.actor(2).hidden = true; assert.equal(strike().hits[0].target, 1, 'ẩn không đỡ đòn');
    reset(); e.state.party = [1, 3, 4, 5, 2]; e.syncBattleActors(); assert.equal(strike().hits[0].target, 1, 'Girl dự bị không đỡ');
    reset(); e.state.changeActorState(3, stateId, true); r.syncActors();
    assert.equal(strike().hits[0].target, 2, 'chọn người thế thân đầu tiên theo thứ tự đội');
    reset(); e.state.changeActorState(1, stateId, true); r.syncActors();
    assert.equal(strike().hits[0].target, 1, 'đích có trait đứng đầu không gọi người thế thân kế tiếp');
    reset(); hp(2, 5); db.Skills[skillId].repeats = 2;
    const repeated = strike(); assert.deepEqual(repeated.hits.map(hit => hit.target), [2, 1], 'mỗi effect tìm lại người đỡ khi Girl bị hạ');
    assert.equal(e.state.actor(1).hp, 10); assert.equal(e.state.actor(2).hp, 0);
    reset(); db.Skills[skillId].successRate = 0;
    const missed = strike().hits[0]; assert.equal(missed.target, 2); assert.ok(missed.missed); assert.equal(e.state.actor(1).hp, 20);
    reset(); e.state.changeActorState(1, 100, true); hp(3, 20); r.syncActors();
    const taunt = r.useSkill(r.enemy(0), skillId, 2);
    assert.deepEqual(taunt.targets, [{ type: 'actor', id: 1 }]); assert.deepEqual(taunt.hits[0].substituteFor, { type: 'actor', id: 1 });
    reset(); e.state.changeActorState(1, 26, true); r.syncActors();
    const counter = strike().hits[0]; assert.equal(counter.target, 2); assert.equal(counter.counter.subjectId, 1, 'phản công thuộc đích gốc theo HIME');
    reset(); e.state.changeActorState(2, 26, true); r.syncActors(); assert.equal(strike().hits[0].counter, undefined, 'người đỡ không tự nhận quyền phản công');

    reset(); r.enemy(0).hp = 20; r.handleEffect(333, [1, 0, stateId]);
    const outgoing = r.useSkill(r.actor(1), skillId, 0, true);
    assert.equal(outgoing.hits[0].targetType, 'enemy'); assert.equal(outgoing.hits[0].target, 1); assert.equal(r.enemy(0).hp, 20);
    r.enemy(1).hidden = true; assert.equal(r.useSkill(r.actor(1), skillId, 0, true).hits[0].target, 0, 'quái ẩn không đỡ');

    reset(); db.Skills[skillId].animationId = 1;
    await finish(e.forceBattleAction([0, 0, skillId, 0])); const forced = r.battle.lastAction;
    assert.equal(forced.hits[0].target, 2); assert.equal(e.animations.entries.length, 0); assert.equal(r.battle.phase, 'input');
    const after = e.state.actor(2).hp; await e.restore(e.save()); r = e.battle;
    assert.equal(e.state.actor(2).hp, after); assert.deepEqual(r.battle.lastAction.hits[0].substituteFor, { type: 'actor', id: 1 });
    reset(); db.Skills[skillId].animationId = 1;
    const controller = new AbortController(), action = e.forceBattleAction([0, 0, skillId, 0], {}, controller.signal);
    const rejection = assert.rejects(action, /hủy thế thân/);
    for (let frame = 0; frame < 100 && !e.animations.entries.length; frame++) { e.advanceRoutes(1); await flush(); }
    assert.ok(e.animations.entries.length); controller.abort(new Error('hủy thế thân')); await rejection;
    e.advanceRoutes(1000); assert.equal(e.state.actor(1).hp, 20); assert.equal(e.state.actor(2).hp, girlHp);
    assert.equal(e.animations.entries.length, 0); assert.equal(r.immortal.size, 0);
    console.log('ĐẠT: Girl thế thân dưới 25% HP, loại đòn, sống/ẩn/bất động/dự bị, lặp/state/Taunt/phản công, phe địch, 339/save và hủy.');
})().catch(error => { console.error(error); process.exitCode = 1; });
