'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setTimeout(resolve, 1));
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.1, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1] });
    const db = engine.database, enemyId = db.Enemies.length, troopId = db.Troops.length;
    db.Enemies.push({ ...db.Enemies[1], id: enemyId, note: '', traits: [], params: [99999, 100, 1, 1, 1, 1, 1, 1], actions: [] });
    db.Troops.push({ id: troopId, members: [0, 1].map(i => ({ enemyId, x: 300 + i * 100, y: 350 })), pages: [] });
    function reset(weapon) {
        engine.battle.finish('escape'); engine.animations.dispose(); engine.state.scene = 'battle';
        engine.state.recoverActor(1); engine.state.actor(1).equips[0] = weapon;
        engine.battle.setup(troopId, true, true);
    }
    async function finish(promise) {
        let done = false, result, failure;
        promise.then(value => { done = true; result = value; }, error => { done = true; failure = error; });
        for (let frame = 0; frame < 3000 && !done; frame++) { engine.advanceRoutes(12); await flush(); }
        assert.ok(done, 'hành động phải hoàn tất'); if (failure) throw failure; return result;
    }
    for (const [weapon, skillId] of [[36, 281], [37, 293]]) {
        reset(weapon);
        assert.equal(engine.battle.attackSkillId(engine.battle.actor(1)), skillId);
        assert.equal(engine.validateBattleAction({ actorId: 1, kind: 'skill', id: 1, targetIndex: 999 }).id, skillId,
            'đánh cả nhóm không đòi mục tiêu đơn của skill 1');
        assert.throws(() => engine.queueBattleAction(1, 'skill', skillId, 0), /chưa học/, 'không biến ID kỹ năng riêng thành kỹ năng đã học');
        const report = await finish(engine.battleAttack(1, 999));
        assert.equal(report.skillId, skillId); assert.equal(report.targets.length, 2);
        assert.ok(engine.battle.battle.enemies.every(enemy => enemy.hp < enemy.mhp));
        await engine.restore(engine.save()); assert.equal(engine.battle.attackSkillId(engine.battle.actor(1)), skillId);
        reset(weapon);
        const attack = db.Skills[skillId], cost = attack.mpCost;
        attack.mpCost = 9999;
        assert.throws(() => engine.queueBattleAction(1, 'skill', 1, 0), /Chưa thể/, 'kiểm tra chi phí skill vũ khí khi chọn Attack');
        attack.mpCost = cost;
        const traits = db.Actors[1].traits;
        db.Actors[1].traits = traits.concat({ code: 44, dataId: skillId, value: 1 });
        assert.throws(() => engine.queueBattleAction(1, 'skill', 1, 0), /Chưa thể/, 'khóa skill vũ khí cũng khóa Attack');
        db.Actors[1].traits = traits;
        await finish(engine.forceBattleAction([1, 1, 1, 0]));
        assert.equal(engine.battle.battle.lastAction.skillId, 1, '339 giữ ID skill chỉ định, không đổi thành skill vũ khí');
        assert.equal(engine.battle.battle.lastAction.targets.length, 1);
        reset(weapon);
        db.Actors[1].traits = traits.concat({ code: 62, dataId: 0, value: 1 });
        const auto = engine.battle.chooseActorAction(engine.battle.actor(1));
        assert.equal(auto.id, 1, 'AI chọn Attack theo skill vũ khí nhưng giữ loại lệnh Attack');
        const autoReports = await finish(engine.startBattleTurn());
        assert.equal(autoReports[0].skillId, skillId); assert.equal(autoReports[0].targets.length, 2);
        db.Actors[1].traits = traits;
        reset(weapon); engine.state.changeActorState(1, 7, true); engine.battle.syncActors();
        const confused = await finish(engine.startBattleTurn());
        assert.equal(confused[0].skillId, skillId); assert.equal(confused[0].targets.length, 1, 'rối loạn vẫn chọn một đích theo quy tắc confusion');
    }
    console.log('ĐẠT: War scythe/Cursed war scythe dùng skill 281/293 cho Attack, scope/chi phí/khóa, AI/rối loạn/save và 339 giữ skill chỉ định.');
})().catch(error => { console.error(error); process.exitCode = 1; });
