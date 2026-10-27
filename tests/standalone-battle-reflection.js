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
    const db = e.database, skillId = db.Skills.length, enemyId = db.Enemies.length, troopId = db.Troops.length, stateId = db.States.length;
    // Dữ liệu hiện tại không có trait phản phép; không giả định fixture là nội dung thật.
    assert.equal(['Actors', 'Classes', 'Weapons', 'Armors', 'Enemies', 'States'].flatMap(key => db[key].filter(Boolean))
        .flatMap(data => data.traits || []).filter(trait => trait.code === 22 && trait.dataId === 5 && trait.value !== 0).length, 0);
    assert.ok(db.Animations[42]);
    db.Skills.push({ ...db.Skills[3], id: skillId, note: '', animationId: 0, hitType: 2, repeats: 1, scope: 1,
        successRate: 100, mpCost: 5, tpCost: 0, tpGain: 0, effects: [],
        damage: { type: 1, formula: '10', variance: 0, critical: false, elementId: 0 } });
    db.Enemies.push({ ...db.Enemies[1], id: enemyId, traits: [{ code: 22, dataId: 0, value: 1 }],
        params: [1000, 100, 1, 1, 1, 1, 10, 1], actions: [] });
    db.Troops.push({ id: troopId, pages: [], members: [0, 1].map(i => ({ enemyId, x: 300 + 100 * i, y: 400 })) });
    db.States.push({ ...db.States[2], id: stateId, restriction: 0, traits: [{ code: 22, dataId: 5, value: 1 }] });
    const skill = db.Skills[skillId]; let r = e.battle;
    function reset() {
        r.finish('escape'); e.animations.dispose(); e.screen.screen.tweens = [];
        e.state.party = [1, 2, 3]; e.state.party.forEach(id => e.state.recoverActor(id));
        r.setup(troopId, true, true); e.state.scene = 'battle'; r.random = () => 0.5;
        Object.assign(skill, { hitType: 2, scope: 1, repeats: 1, animationId: 0, effects: [], successRate: 100, note: '' });
        skill.damage = { type: 1, formula: '10', variance: 0, critical: false, elementId: 0 };
        db.States[stateId].restriction = 0; db.States[stateId].traits[0].value = 1;
        db.Enemies[enemyId].traits = [{ code: 22, dataId: 0, value: 1 }];
        r.addState(r.enemy(0), stateId, 1, true);
    }
    const strike = () => r.useSkill(r.actor(1), skillId, 0, true);
    async function finish(promise) {
        let done = false, value, failure;
        promise.then(result => { done = true; value = result; }, error => { done = true; failure = error; });
        for (let i = 0; i < 1000 && !done; i++) { e.advanceRoutes(16); await flush(); }
        assert.equal(done, true); if (failure) throw failure; return value;
    }
    reset(); const hp = e.state.actor(1).hp, mp = e.state.actor(1).mp;
    let report = strike();
    assert.equal(r.enemy(0).hp, 1000); assert.equal(e.state.actor(1).hp, hp - 10);
    assert.equal(e.state.actor(1).mp, mp - 5, 'trả chi phí một lần cho người thi triển');
    assert.deepEqual(report.hits[0].reflectedBy, { type: 'enemy', id: 0 });
    assert.equal(report.hits[0].targetType, 'actor'); assert.equal(report.hits[0].target, 1);
    assert.equal(report.hits[0].substituteFor, undefined); assert.equal(r.battle.lastTargets['actor:1'], 0);

    reset(); e.state.changeActorState(1, stateId, true); skill.repeats = 3;
    report = strike(); assert.equal(report.hits.length, 3); assert.equal(e.state.actor(1).hp, hp - 30, 'mỗi hit phản một lần, không phản qua lại');
    reset(); db.States[stateId].restriction = 4; assert.ok(strike().hits[0].reflectedBy, 'phản phép không yêu cầu cử động được');
    reset(); db.States[stateId].traits[0].value = 0.25;
    assert.equal(strike().hits[0].reflectedBy, undefined); assert.equal(r.enemy(0).hp, 990, 'MRF dùng xác suất');
    for (const hitType of [0, 1]) { reset(); skill.hitType = hitType; assert.equal(strike().hits[0].reflectedBy, undefined); }
    reset(); skill.successRate = 0; report = strike();
    assert.ok(report.hits[0].reflectedBy); assert.equal(report.hits[0].missed, true); assert.equal(e.state.actor(1).hp, hp);
    reset(); db.Actors[1].traits.push({ code: 22, dataId: 4, value: 1 });
    assert.equal(strike().hits[0].evaded, true); db.Actors[1].traits.pop();
    reset(); r.enemy(0).hp = 100; skill.damage.type = 5;
    strike(); assert.equal(e.state.actor(1).hp, hp - 10); assert.equal(r.enemy(0).hp, 110, 'hút HP phản hồi về người phản phép');
    reset(); r.enemy(0).mp = 20; skill.damage.type = 6;
    strike(); assert.equal(e.state.actor(1).mp, mp - 15); assert.equal(r.enemy(0).mp, 30);
    reset(); skill.effects = [{ code: 21, dataId: 17, value1: 1 }]; strike();
    assert.ok(e.state.actor(1).states.includes(17)); assert.ok(!r.enemy(0).states.includes(17));
    reset(); skill.scope = 2; report = strike();
    assert.equal(report.hits.length, 2); assert.ok(report.hits[0].reflectedBy); assert.equal(report.hits[1].reflectedBy, undefined);
    assert.equal(r.enemy(1).hp, 990); assert.equal(e.state.actor(1).hp, hp - 10);
    reset(); e.state.changeActorState(1, stateId, true); e.state.changeActorHp(1, -80, true); r.syncActors();
    const girlHp = e.state.actor(2).hp; report = r.useSkill(r.enemy(1), skillId, 0, true);
    assert.deepEqual(report.hits[0].reflectedBy, { type: 'actor', id: 1 }); assert.equal(e.state.actor(2).hp, girlHp, 'phản phép ưu tiên hơn thế thân Girl');
    assert.equal(r.enemy(1).hp, 990); assert.equal(e.state.actor(1).hp, 20);

    reset(); skill.effects = [{ code: 44, dataId: 1 }];
    const commonList = db.CommonEvents[1].list; db.CommonEvents[1].list = [{ code: 122, parameters: [6174, 6174, 1, 0, 1] }];
    skill.animationId = 1;
    const forced = e.forceBattleAction([1, 1, skillId, 0]); await flush();
    await finish(forced);
    assert.equal(e.state.variableValue(6174), 1, 'common event chỉ chạy một lần sau animation phản');
    assert.equal(e.animations.entries.length, 0); report = r.battle.lastAction;
    const saved = e.save(); await e.restore(saved); r = e.battle;
    assert.deepEqual(r.battle.lastAction.hits, report.hits); assert.equal(e.state.actor(1).hp, hp - 10, 'save không đánh phản lần hai');
    db.CommonEvents[1].list = commonList;

    reset(); skill.animationId = 1; skill.note = '<target action>\naction effect\naction effect\n</target action>';
    const controller = new AbortController();
    const cancelled = e.forceBattleAction([1, 1, skillId, 0], null, controller.signal);
    const rejected = assert.rejects(cancelled, { name: 'AbortError' }); await flush();
    assert.ok(e.animations.entries.some(entry => entry.animationId === 42 && entry.targetType === 'enemy'));
    assert.ok(e.animations.entries.some(entry => entry.animationId === 1 && entry.targetType === 'actor'));
    assert.equal(e.state.actor(1).hp, hp - 10); controller.abort(); await rejected;
    e.advanceRoutes(1000); assert.equal(e.state.actor(1).hp, hp - 10); assert.equal(e.animations.entries.length, 0);

    reset(); db.States[stateId].note = '<reflect ani: 43>'; assert.equal(r.reflectAnimationId(r.enemy(0)), 43);
    db.Enemies[enemyId].note = '<reflect animation: 44>'; assert.equal(r.reflectAnimationId(r.enemy(0)), 44);
    e.state.changeActorState(1, stateId, true); assert.equal(r.reflectAnimationId(r.actor(1)), 43);
    db.Actors[1].note += '\n<reflect animation: 45>'; assert.equal(r.reflectAnimationId(r.actor(1)), 45);
    console.log('ĐẠT: MRF hai phe/lặp/xác suất/bất động/né/state/hút/nhóm/Girl, animation phản/339/common event/save/hủy; dữ liệu thật không có trait MRF.');
})().catch(error => { console.error(error); process.exitCode = 1; });
