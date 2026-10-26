'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const watchdog = setTimeout(() => { console.error('Taunt chưa hoàn tất.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.5, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1, 3] });
    async function finish(promise) {
        let done = false, failure;
        promise.then(() => { done = true; }, error => { done = true; failure = error; });
        for (let frame = 0; frame < 1000 && !done; frame++) { engine.advanceRoutes(16); await flush(); }
        assert.ok(done, 'hành động Taunt hoàn tất sau đủ frame');
        if (failure) throw failure;
    }
    const enemyId = engine.database.Enemies.length, troopId = engine.database.Troops.length, skillId = engine.database.Skills.length;
    engine.database.Enemies.push({ ...engine.database.Enemies[1], id: enemyId, actions: [] });
    engine.database.Troops.push({ id: troopId, pages: [], members: [0, 1, 2].map((_, index) => ({ enemyId, x: 300 + index * 100, y: 400, hidden: false })) });
    engine.database.Skills.push({ ...engine.database.Skills[3], id: skillId, animationId: 0, repeats: 1, hitType: 0, successRate: 100,
        damage: { type: 1, formula: '10', variance: 0, critical: false, elementId: 0 }, effects: [], note: '' });
    engine.battle.setup(troopId, true, true); engine.state.scene = 'battle';
    engine.state.changeActorSkill(1, skillId, true); engine.state.changeActorSkill(3, skillId, true);
    let runtime = engine.battle;
    const skill = engine.database.Skills[skillId];
    const targets = (subject = runtime.actor(1), index = 0, data = skill) => runtime.skillTargets(subject, data, index);
    runtime.handleEffect(333, [1, 0, 100]);
    for (const hitType of [0, 1, 2]) {
        const data = { ...skill, hitType };
        assert.equal(targets(runtime.actor(1), 0, data)[0].index, 1, 'state 100 hút loại đòn ' + hitType);
        assert.equal(targets(runtime.actor(1), -1, data)[0].index, 1, 'AI/ngẫu nhiên cũng ưu tiên Taunt');
    }
    for (const id of [39, 62, 99, 304]) assert.equal(targets(runtime.actor(1), 0, engine.database.Skills[id])[0].index, 0, 'Bypass Taunt thật ' + id);
    for (const scope of [2, 3, 4, 5, 6]) {
        const selected = targets(runtime.actor(1), 0, { ...skill, scope });
        assert.equal(selected.length, scope === 2 ? 3 : scope - 2);
        if (scope === 2) assert.deepEqual(selected.map(target => target.index), [0, 1, 2]);
    }
    runtime.handleEffect(333, [2, 0, 100]);
    runtime.random = () => 0; assert.equal(targets()[0].index, 1);
    runtime.random = () => 0.99; assert.equal(targets()[0].index, 2, 'nhiều Taunt: đổi mục tiêu chọn ngẫu nhiên');
    assert.equal(targets(runtime.actor(1), 1)[0].index, 1, 'giữ đích đã chọn khi chính nó đang Taunt');
    runtime.enemy(1).hidden = true; assert.equal(targets()[0].index, 2);
    runtime.handleEffect(333, [2, 0, 1]); assert.equal(targets()[0].index, 0, 'Taunt ẩn/chết không hút đòn');
    runtime.enemy(1).hidden = false; runtime.handleEffect(333, [1, 1, 100]);
    assert.equal(targets()[0].index, 0, 'xóa state đổi mục tiêu có hiệu lực ngay');

    // Note của actor/class/trang bị/state được đọc cùng nguồn trait, không sửa JSON nguồn.
    const stateId = engine.database.States.length;
    engine.database.States.push({ ...engine.database.States[100], id: stateId, note: '<Physical Taunt>' });
    runtime.handleEffect(333, [1, 0, stateId]);
    assert.equal(targets(runtime.actor(1), 0, { ...skill, hitType: 1 })[0].index, 1);
    assert.equal(targets(runtime.actor(1), 0, { ...skill, hitType: 2 })[0].index, 0);
    const actorData = engine.database.Actors[1], originalNote = actorData.note;
    actorData.note = '<Ignore Physical Taunt>';
    assert.equal(targets(runtime.actor(1), 0, { ...skill, hitType: 1 })[0].index, 0);
    actorData.note = originalNote;
    const enemyData = engine.database.Enemies[enemyId], enemyNote = enemyData.note;
    enemyData.note = '<Null Physical Taunt>';
    assert.equal(targets(runtime.actor(1), 0, { ...skill, hitType: 1 })[0].index, 0);
    enemyData.note = enemyNote; runtime.handleEffect(333, [1, 1, stateId]);
    const actor = engine.state.actor(3), classData = engine.database.Classes[actor.classId], classNote = classData.note;
    classData.note = '<Certain Taunt>';
    assert.equal(targets(runtime.enemy(0), 0)[0].id, 3, 'class hút đòn từ quái');
    classData.note = classNote;
    const equipment = engine.database.Weapons[actor.equips[0]], equipNote = equipment.note;
    equipment.note = '<Certain Taunt>';
    assert.equal(targets(runtime.enemy(0), 0)[0].id, 3, 'trang bị hút đòn từ quái');
    equipment.note = equipNote;

    engine.state.changeActorState(3, 101, true); runtime.syncActors();
    assert.equal(targets(runtime.enemy(0), 0)[0].id, 3, 'state 101 trên đồng đội nhận đòn thay nhân vật đầu');
    assert.equal(targets(runtime.enemy(0), 0, { ...skill, scope: 2 }).length, 2, 'Taunt không chặn đòn cả đội');
    assert.equal(targets(runtime.actor(1), 0, { ...skill, scope: 7 })[0].id, 1, 'không đổi mục tiêu hồi phục cùng phe');
    await engine.restore(engine.save()); runtime = engine.battle;
    assert.equal(targets(runtime.enemy(0), 0)[0].id, 3, 'save giữ Taunt đang chạy');
    engine.state.changeActorState(3, 101, false); runtime.syncActors();
    runtime.handleEffect(334, [-1]); runtime.handleEffect(333, [1, 0, 100]);
    await finish(engine.forceBattleAction([1, 1, skillId, 0]));
    assert.equal(runtime.battle.lastAction.target, 1, 'lệnh 339 cũng tôn trọng Taunt');
    runtime.handleEffect(334, [-1]); runtime.handleEffect(333, [1, 0, 100]);
    engine.queueBattleAction(1, 'skill', skillId, 0); engine.queueBattleAction(3, 'skill', 2, 0);
    const queued = engine.save(); await engine.restore(queued); runtime = engine.battle;
    let finished = false;
    const turn = engine.startBattleTurn().then(() => { finished = true; });
    for (let i = 0; i < 1000 && !finished; i++) { engine.advanceRoutes(16); await flush(); }
    await turn; assert.equal(finished, true);
    const report = runtime.battle.turnActions.find(report => report.skillId === skillId);
    assert.equal(report.target, 1); assert.equal(runtime.enemy(0).hp, runtime.enemy(0).mhp);
    assert.equal(runtime.enemy(1).hp, runtime.enemy(1).mhp - 10, 'hàng đợi vẫn áp Taunt tại thời điểm thực thi');
    assert.equal(runtime.battle.lastTargets['actor:1'], 1);
    engine.state.changeActorState(3, 101, true); runtime.finish('escape');
    assert.equal(engine.state.actor(3).states.includes(101), false, 'Taunt tạm được dọn cuối trận');
    console.log('ĐẠT: Taunt 100/101, loại đòn/Bypass, nguồn trait/Ignore/Null, nhiều mục tiêu/ẩn/chết, scope, AI/hàng đợi và save.');
})().then(() => clearTimeout(watchdog)).catch(error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
