'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const watchdog = setTimeout(() => { console.error('AI đồng đội chưa hoàn tất.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1, 3] });
    const db = engine.database, stateId = db.States.length, skillId = db.Skills.length;
    const troopId = db.Troops.length, enemyId = db.Enemies.length;
    let r = engine.battle;
    for (const id of [7, 10, 12, 13, 16, 19]) {
        engine.state.addActor(id);
        assert.equal(r.isAutoBattle({ id }), true, db.Actors[id].name + ' đọc flag từ actor/class thật');
        engine.state.removeActor(id);
    }
    db.States.push({ ...db.States[26], id: stateId, traits: [{ code: 62, dataId: 0, value: 1 }] });
    db.Skills[1] = { ...db.Skills[1], note: '', hitType: 0, animationId: 0, effects: [], mpCost: 0, tpCost: 0, tpGain: 0,
        damage: { type: 1, formula: '10', variance: 0, critical: false, elementId: 0 } };
    const skill = (offset, changes) => ({ ...db.Skills[1], id: skillId + offset, repeats: 1, mpCost: 5, ...changes });
    db.Skills.push(skill(0, { damage: { ...db.Skills[1].damage, formula: '60' } }),
        skill(1, { scope: 7, damage: { ...db.Skills[1].damage, type: 3, formula: '80' } }),
        skill(2, { scope: 8, damage: { ...db.Skills[1].damage, type: 3, formula: '35' } }),
        skill(3, { scope: 2, damage: { ...db.Skills[1].damage, formula: '25' } }),
        skill(4, { scope: 9, damage: { ...db.Skills[1].damage, type: 3, formula: '50' } }),
        skill(5, { damage: { ...db.Skills[1].damage, type: 2, formula: '99999' } }));
    db.Enemies.push({ ...db.Enemies[1], id: enemyId, params: [1000, 100, 20, 10, 10, 10, 10, 10], traits: [], actions: [] });
    db.Troops.push({ id: troopId, pages: [], members: [0, 1, 2].map(index => ({ enemyId, x: 300 + index * 100, y: 400, hidden: false })) });
    function reset(pages = []) {
        r.finish('escape'); engine.animations.dispose(); db.Troops[troopId].pages = pages;
        [1, 3].forEach(id => { engine.state.recoverActor(id); engine.state.actor(id).skills = []; });
        engine.state.changeActorState(1, stateId, true);
        r.setup(troopId, true, true); engine.state.scene = 'battle'; r.random = () => 0;
    }
    const learn = (...offsets) => offsets.forEach(offset => engine.state.changeActorSkill(1, skillId + offset, true));
    const choose = () => r.chooseActorAction(r.actor(1));
    const selectOther = () => engine.queueBattleAction(3, 'skill', 2, 0);
    async function finish(promise) {
        let done = false, value, failure;
        promise.then(result => { done = true; value = result; }, error => { done = true; failure = error; });
        for (let i = 0; i < 1000 && !done; i++) { engine.advanceRoutes(16); await flush(); }
        assert.equal(done, true); if (failure) throw failure; return value;
    }
    reset(); learn(0);
    assert.deepEqual(r.inputActors().map(actor => actor.id), [3]);
    assert.throws(() => engine.queueBattleAction(1, 'skill', 2, 0), /Chưa thể dùng kỹ năng/);
    const before = engine.save(), action = choose();
    assert.equal(action.id, skillId); assert.equal(action.targetIndex, 0);
    assert.deepEqual(engine.save(), before, 'chấm điểm không trừ MP/TP, gây damage hoặc chạy effect');
    r.enemy(2).hp = 5;
    assert.equal(choose().targetIndex, 2, 'ưu tiên địch yếu theo tỷ lệ damage/HP');
    r.enemy(2).hidden = true; assert.equal(choose().targetIndex, 0);
    r.enemy(2).hidden = false; r.handleEffect(333, [2, 0, 1]); assert.equal(choose().targetIndex, 0);
    r.handleEffect(334, [2]); r.enemy(2).hp = 5; r.handleEffect(333, [1, 0, 100]);
    assert.equal(choose().targetIndex, 1, 'Taunt giới hạn ứng viên đúng loại đòn');

    reset(); learn(0); engine.state.actor(1).mp = 4;
    assert.equal(choose().id, 1, 'thiếu MP loại kỹ năng trước chấm điểm');
    engine.state.actor(1).mp = 100; db.Skills[skillId].occasion = 2;
    assert.equal(choose().id, 1); db.Skills[skillId].occasion = 1;
    db.Skills[skillId].requiredWtypeId1 = 999;
    assert.equal(choose().id, 1); db.Skills[skillId].requiredWtypeId1 = 0;
    db.Skills[skillId].damage.formula = '20'; db.Skills[skillId].damage.critical = true;
    db.States[stateId].traits.push({ code: 22, dataId: 2, value: 1 });
    assert.equal(choose().id, 1, 'chấm điểm lặp đòn nhưng không dự báo chí mạng chắc chắn');
    db.States[stateId].traits.pop(); db.Skills[skillId].damage.formula = '60'; db.Skills[skillId].damage.critical = false;
    reset(); learn(0, 3); assert.equal(choose().id, skillId + 3, 'cộng điểm sát thương cả nhóm');
    reset(); learn(0, 1, 5);
    assert.equal(choose().id, skillId, 'không chọn hồi HP đã đầy hoặc damage MP chỉ vì công thức lớn');
    engine.state.changeActorHp(3, -90, true); r.syncActors();
    assert.equal(choose().id, skillId + 1); assert.equal(choose().targetIndex, 1, 'hồi đồng đội thiếu HP');
    reset(); learn(1, 2);
    [1, 3].forEach(id => engine.state.changeActorHp(id, -50, true)); r.syncActors();
    assert.equal(choose().id, skillId + 2, 'cộng hồi phục cả đội và chặn hồi vượt HP tối đa');
    reset(); learn(4); engine.state.changeActorHp(3, -9999, true); r.syncActors();
    assert.equal(choose().id, skillId + 4); assert.equal(choose().targetIndex, 1);
    await finish(engine.startBattleTurn());
    assert.equal(engine.state.actor(3).hp, 50, 'AI thực thi hồi sinh đúng đồng đội chết');
    assert.equal(engine.state.actor(1).mp, 95);

    reset(); learn(0); selectOther();
    const reports = await finish(engine.startBattleTurn());
    assert.equal(reports.length, 2); assert.equal(reports.filter(report => report.autoBattle).length, 1);
    assert.equal(reports.find(report => report.autoBattle).skillId, skillId);
    assert.equal(r.enemy(0).hp, 940); assert.equal(engine.state.actor(1).mp, 95);
    assert.equal(r.battle.turn, 1); assert.equal(r.battle.phase, 'input');
    const saved = engine.save(); await engine.restore(saved); r = engine.battle;
    assert.equal(r.enemy(0).hp, 940); assert.equal(engine.state.actor(1).mp, 95);
    assert.equal(r.isAutoBattle(r.actor(1)), true); assert.equal(r.battle.lastAction.autoBattle, true);
    assert.deepEqual(r.inputActors().map(actor => actor.id), [3], 'save giữ quyền điều khiển và không chạy lại AI');
    engine.state.changeActorState(1, stateId, false);
    assert.deepEqual(r.inputActors().map(actor => actor.id), [1, 3], 'bỏ trait trả quyền điều khiển');
    reset(); engine.state.changeActorState(3, stateId, true);
    const autoTeam = await finish(engine.startBattleTurn());
    assert.equal(autoTeam.length, 2); assert.ok(autoTeam.every(report => report.autoBattle));
    reset(); engine.state.changeActorState(1, 9, true); r.random = () => 0.9; selectOther();
    const confused = (await finish(engine.startBattleTurn())).find(report => report.subjectId === 1);
    assert.equal(confused.confusion, 3); assert.equal(confused.autoBattle, undefined);
    assert.equal(confused.hits[0].targetType, 'actor', 'rối loạn thay cách chọn mục tiêu AI');
    reset(); engine.state.changeActorState(1, 16, true); selectOther();
    assert.equal((await finish(engine.startBattleTurn())).length, 1, 'bất động không có hành động AI');
    const sealId = db.States.length;
    db.States.push({ ...db.States[26], id: sealId, traits: [{ code: 44, dataId: 1, value: 1 }] });
    reset(); engine.state.changeActorState(1, sealId, true); selectOther();
    assert.equal(choose(), null); assert.equal((await finish(engine.startBattleTurn())).length, 1, 'không có kỹ năng hợp lệ bỏ lượt');
    const page = list => ({ span: 1, conditions: { turnValid: true, turnA: 1, turnB: 0 }, list });
    reset([page([{ code: 339, parameters: [1, 1, skillId, 0] }])]); learn(0); selectOther();
    await finish(engine.startBattleTurn());
    assert.equal(r.enemy(0).hp, 940); assert.equal(engine.state.actor(1).mp, 95, '339 thay hành động AI và không chạy thêm lần hai');
    reset(); engine.state.changeActorState(3, stateId, true);
    r.enemy(0).hp = 5; r.enemy(1).hidden = true; r.enemy(2).hidden = true;
    assert.equal((await finish(engine.startBattleTurn())).length, 1);
    assert.equal(r.battle.result, 'victory', 'thắng trận dừng đồng đội AI còn lại');
    console.log('ĐẠT: auto-battle actor/class thật, chấm điểm HP/lặp/nhóm/hồi sinh/chi phí/khóa, Taunt, quyền điều khiển, cả đội/save/rối loạn/339 và thắng trận.');
})().then(() => clearTimeout(watchdog)).catch(error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
