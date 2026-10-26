'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const watchdog = setTimeout(() => { console.error('Rối loạn chưa hoàn tất.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.5, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1, 3] });
    let r = engine.battle;
    const db = engine.database, skillId = db.Skills.length, enemyId = db.Enemies.length, troopId = db.Troops.length;
    db.Skills[1] = { ...db.Skills[1], note: '', animationId: 0, hitType: 0, successRate: 100, effects: [],
        damage: { type: 1, formula: '10', variance: 0, critical: false, elementId: 0 }, mpCost: 2, tpCost: 1, tpGain: 0 };
    db.Skills.push({ ...db.Skills[1], id: skillId, name: 'Đòn chọn', repeats: 1, mpCost: 3,
        damage: { ...db.Skills[1].damage, formula: '3' } });
    db.Enemies.push({ ...db.Enemies[1], id: enemyId, params: [1000, 100, 10, 10, 10, 10, 10, 10], traits: [], actions: [] });
    db.Troops.push({ id: troopId, pages: [], members: [0, 1, 2].map(index => ({ enemyId, x: 300 + index * 100, y: 400, hidden: false })) });
    function reset(pages = []) {
        r.finish('escape'); engine.animations.dispose(); db.Troops[troopId].pages = pages;
        [1, 3].forEach(id => { engine.state.recoverActor(id); engine.state.actor(id).tp = 50; engine.state.changeActorSkill(id, skillId, true); });
        r.setup(troopId, true, true); r.battle.enemies.forEach(enemy => { enemy.tp = 50; });
        engine.state.scene = 'battle'; r.random = () => 0.5;
    }
    const confuse = (id, stateId) => engine.state.changeActorState(id, stateId, true);
    async function finish(promise) {
        let done = false, value, failure;
        promise.then(result => { done = true; value = result; }, error => { done = true; failure = error; });
        for (let i = 0; i < 1000 && !done; i++) { engine.advanceRoutes(16); await flush(); }
        assert.equal(done, true); if (failure) throw failure; return value;
    }
    for (const [stateId, level] of [[7, 1], [8, 2], [9, 3], [25, 1], [99, 2]]) {
        reset(); confuse(1, stateId); assert.equal(r.confusionLevel(r.actor(1)), level, db.States[stateId].name);
        assert.deepEqual(r.inputActors().map(actor => actor.id), [3]);
        assert.throws(() => engine.queueBattleAction(1, 'skill', 2, 0), /Chưa thể dùng kỹ năng/);
        r.random = () => level === 1 ? 0.1 : 0.9;
        const mp = engine.state.actor(1).mp, report = r.useSkill(r.actor(1), skillId, 0);
        assert.equal(report.skillId, 1); assert.equal(report.confusion, level);
        assert.equal(report.hits.length, 3, 'đánh thường lặp theo JSON');
        assert.ok(report.hits.every(hit => hit.targetType === (level === 1 ? 'enemy' : 'actor')));
        assert.ok(report.hits.every(hit => hit.target === report.target), 'một mục tiêu ngẫu nhiên cho tất cả đòn lặp');
        assert.equal(engine.state.actor(1).mp, mp - 2); assert.equal(engine.state.actor(1).tp, 49);
    }
    reset(); confuse(1, 8); r.random = () => 0.1;
    assert.equal(r.useSkill(r.actor(1), 1, 0).hits[0].targetType, 'enemy', 'mức 2 có thể chọn phe địch');
    reset(); confuse(1, 9); r.random = () => 0;
    const selfHp = engine.state.actor(1).hp;
    assert.equal(r.useSkill(r.actor(1), 1, 0).target, 1, 'đánh cùng phe có thể chọn bản thân');
    assert.equal(engine.state.actor(1).hp, selfHp - 30);
    reset(); confuse(1, 9); engine.state.changeActorHp(3, -9999, true); r.syncActors();
    assert.equal(r.useSkill(r.actor(1), 1, 0).target, 1, 'không chọn đồng đội chết');
    reset(); confuse(1, 7); r.enemy(1).hidden = true; r.handleEffect(333, [2, 0, 1]);
    assert.equal(r.useSkill(r.actor(1), 1, 2).target, 0, 'không chọn quái ẩn/chết');
    const noTarget = db.States.length;
    db.States.push({ ...db.States[26], id: noTarget, traits: [{ code: 23, dataId: 0, value: 0 }] });
    reset(); confuse(1, 9); confuse(1, noTarget); r.random = () => 0;
    assert.equal(r.useSkill(r.actor(1), 1, 0).target, 3, 'chọn ngẫu nhiên theo trọng số TGR');
    reset(); confuse(1, 7); r.handleEffect(333, [2, 0, 100]); r.random = () => 0;
    assert.equal(r.useSkill(r.actor(1), 1, 0).target, 2, 'Taunt lọc đích ngẫu nhiên trong phe được chọn');
    reset(); confuse(1, 7); r.random = () => 0.49;
    r.useSkill(r.enemy(0), skillId, 0);
    assert.equal(r.confusionLevel(r.actor(1)), 0, 'sát thương HP xóa rối loạn theo chanceByDamage');
    reset(); confuse(1, 7); r.random = () => 0.5;
    r.useSkill(r.enemy(0), skillId, 0);
    assert.equal(r.confusionLevel(r.actor(1)), 1, 'ngưỡng 50% không luôn xóa trạng thái');
    for (const [type, formula] of [[1, '0'], [2, '3'], [3, '3']]) {
        reset(); confuse(1, 7); r.random = () => 0;
        db.Skills[skillId].damage = { ...db.Skills[skillId].damage, type, formula };
        r.useSkill(r.enemy(0), skillId, 0);
        assert.equal(r.confusionLevel(r.actor(1)), 1, 'không mất rối loạn vì 0 sát thương, mất MP hoặc hồi HP');
    }
    db.Skills[skillId].damage = { ...db.Skills[skillId].damage, type: 1, formula: '3' };
    for (const stateId of [10, 16, 28]) {
        reset(); confuse(1, 7); confuse(1, stateId);
        assert.equal(r.restriction(r.actor(1)), 4); assert.equal(r.confusionLevel(r.actor(1)), 0);
        assert.equal(r.canUseSkill(r.actor(1), db.Skills[1]), false, 'lấy mức khóa cao nhất, không suy từ tên Confused');
    }
    reset(); confuse(1, 7); engine.state.actor(1).mp = 0;
    engine.queueBattleAction(3, 'skill', 2, 0);
    assert.ok(!(await finish(engine.startBattleTurn())).some(report => report.subjectId === 1), 'thiếu chi phí Attack vẫn bỏ lượt');
    const sealed = db.States.length;
    db.States.push({ ...db.States[26], id: sealed, traits: [{ code: 44, dataId: 1, value: 1 }] });
    reset(); confuse(1, 7); confuse(1, sealed); engine.queueBattleAction(3, 'skill', 2, 0);
    assert.ok(!(await finish(engine.startBattleTurn())).some(report => report.subjectId === 1), 'khóa Attack được tôn trọng');

    reset(); confuse(1, 9);
    const forced = r.useSkill(r.actor(1), skillId, 0, true);
    assert.equal(forced.skillId, skillId); assert.equal(forced.confusion, undefined);
    assert.equal(forced.hits[0].targetType, 'enemy'); assert.equal(forced.damage, 3, 'cưỡng chế bỏ qua rối loạn');
    reset(); r.handleEffect(333, [0, 0, 9]);
    assert.equal(r.chooseEnemyAction(r.enemy(0)).skillId, 1, 'quái rối loạn tự đánh dù không có actions');
    assert.deepEqual(r.enemyActions(), [{ enemy: 0, skillId: 1 }]);
    r.random = () => 0.9;
    const enemyReport = r.useSkill(r.enemy(0), skillId, 0);
    assert.equal(enemyReport.hits[0].targetType, 'enemy'); assert.equal(enemyReport.target, 2);
    reset(); r.handleEffect(333, [0, 0, 9]); r.random = () => 0.9;
    await finish(engine.battleEscape());
    assert.equal(r.battle.result, null); assert.equal(r.enemy(2).hp, 970, 'chạy thất bại vẫn cho quái rối loạn tự đánh cùng phe');

    reset(); confuse(1, 7); engine.queueBattleAction(3, 'skill', 2, 0);
    const before = engine.state.actor(1).mp;
    const reports = await finish(engine.startBattleTurn());
    assert.equal(reports.length, 2); assert.equal(reports.filter(report => report.confusion).length, 1);
    assert.equal(reports.find(report => report.confusion).subjectId, 1);
    assert.equal(r.battle.turn, 1); assert.equal(r.battle.phase, 'input');
    assert.equal(engine.state.actor(1).mp, before - 2);
    engine.state.actor(1).stateTurns[7] = 0;
    engine.queueBattleAction(3, 'skill', 2, 0); await finish(engine.startBattleTurn());
    assert.equal(engine.state.actor(1).states.includes(7), false);
    assert.deepEqual(r.inputActors().map(actor => actor.id), [1, 3], 'hết trạng thái trả quyền chọn lệnh');

    const page = list => ({ span: 1, conditions: { turnValid: true, turnA: 1, turnB: 0 }, list });
    reset([page([{ code: 313, parameters: [0, 3, 0, 7] }])]);
    engine.state.gainItem('items', 28, 1); const stock = engine.state.itemCount('items', 28);
    engine.queueBattleAction(1, 'skill', 2, 0); engine.queueBattleAction(3, 'item', 28, 0);
    const changed = await finish(engine.startBattleTurn());
    assert.equal(changed.filter(report => report.subjectId === 3).length, 1, 'đổi lệnh đã chọn không thêm hành động trùng');
    assert.equal(changed.find(report => report.subjectId === 3).skillId, 1);
    assert.equal(engine.state.itemCount('items', 28), stock, 'rối loạn trước hành động không tiêu vật phẩm đã chọn');
    reset([page([{ code: 339, parameters: [1, 1, skillId, 0] }])]); confuse(1, 9);
    engine.queueBattleAction(3, 'skill', 2, 0); await finish(engine.startBattleTurn());
    assert.equal(r.enemy(0).hp, 997, '339 giữ kỹ năng/mục tiêu và thay hành động tự động trong lượt');
    assert.equal(r.battle.turnActions.filter(report => report.subjectId === 1).length, 0);

    reset(); confuse(1, 99); confuse(3, 7);
    const checkpoint = engine.save(); await engine.restore(checkpoint); r = engine.battle;
    assert.equal(r.inputActors().length, 0); assert.equal(engine.state.actor(1).mp, checkpoint.actors[1].mp);
    assert.equal((await finish(engine.startBattleTurn())).length, 2, 'cả đội rối loạn bắt đầu lượt không cần lệnh tay');
    const saved = engine.save(), hp = r.battle.enemies.map(enemy => enemy.hp);
    await engine.restore(saved); r = engine.battle;
    assert.deepEqual(r.battle.enemies.map(enemy => enemy.hp), hp, 'tải save không đánh lại');
    assert.equal(r.confusionLevel(r.actor(1)), 2, 'Brain flower giữ qua save');
    reset(); confuse(1, 7); confuse(3, 7);
    r.enemy(0).hp = 20; r.enemy(1).hidden = true; r.enemy(2).hidden = true;
    const won = await finish(engine.startBattleTurn());
    assert.equal(r.battle.result, 'victory'); assert.equal(won.length, 1, 'thắng trận ngăn hành động tự động còn lại');
    console.log('ĐẠT: rối loạn 7/8/9/25/99, chọn phe/TGR/ẩn/chết, khóa 4/chi phí/skill, tự chạy cả đội/quái, đổi item/339, hết hạn/save và thắng trận.');
})().then(() => clearTimeout(watchdog)).catch(error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
