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
    await e.boot({ mapId: 74, x: 8, y: 8, party: [1, 3] });
    const db = e.database, enemyId = db.Enemies.length, troopId = db.Troops.length, skillId = db.Skills.length;
    db.Enemies.push({ ...db.Enemies[1], id: enemyId, name: 'lighthouse', traits: [], actions: [], params: [20000, 100, 1, 1, 1, 1, 10, 1] });
    db.Troops.push({ id: troopId, pages: [], members: [{ enemyId, x: 408, y: 400 }] });
    db.Skills.push({ ...db.Skills[3], id: skillId, hitType: 0, scope: 1, animationId: 0, note: '', repeats: 1,
        mpCost: 0, tpCost: 0, tpGain: 0, effects: [], damage: { type: 1, formula: '10', critical: false, variance: 0, elementId: 0 } });
    const commands = list => e.createInterpreter(list.map(([code, parameters]) => ({ code, parameters, indent: 0 })), 0).run();
    e.state.changeActorHp(1, -99999, true); assert.equal(e.state.actor(1).hp, 0);
    await commands([[320, [1, '  LiGhThOuSe  ']]]);
    assert.ok(e.state.hasNameCheat(1)); assert.equal(e.state.actor(1).hp, e.state.actorParam(1, 0));
    assert.ok(!e.state.actor(1).states.includes(1), 'đổi tên khi chết hồi lại HP và bỏ death state');
    await commands([[311, [0, 1, 1, 0, 99999, true]], [313, [0, 1, 0, 1]]]);
    assert.equal(e.state.actor(1).hp, e.state.actorParam(1, 0)); assert.ok(!e.state.actor(1).states.includes(1));
    e.state.changeActorParam(1, 0, 100); assert.equal(e.state.actor(1).hp, e.state.actorParam(1, 0));
    e.state.setActorMaxHp(1, 250); assert.equal(e.state.actor(1).hp, 250);
    const traitId = db.States.length;
    db.States.push({ ...db.States[5], id: traitId, traits: [{ code: 21, dataId: 0, value: 2 }] });
    e.state.changeActorState(1, traitId, true); assert.equal(e.state.actor(1).hp, 500, 'thay max HP qua state vẫn đầy');
    e.state.changeActorState(1, traitId, false); assert.equal(e.state.actor(1).hp, 250);
    const restored = e.save(); restored.actors[1].hp = 0; restored.actors[1].states.push(1);
    restored.actors[1].stateTurns[1] = 10; restored.actors[1].stateSteps[1] = 100;
    await e.restore(restored); assert.equal(e.state.actor(1).hp, 250); assert.ok(!e.state.actor(1).states.includes(1));
    assert.equal(e.state.actor(1).stateTurns[1], undefined); assert.equal(e.state.actor(1).stateSteps[1], undefined);
    await commands([[320, [1, 'lighthouse!']]]); e.state.changeActorHp(1, -99999, true);
    assert.equal(e.state.actor(1).hp, 0, 'đổi tên khác tắt cheat');
    assert.equal(e.state.hasNameCheat(1), false);
    await commands([[320, [1, 'lighthouse']]]);

    let r = e.battle;
    const reset = () => { r.finish('escape'); e.state.recoverActor(1); e.state.recoverActor(3);
        e.battle.setup(troopId, true, true); e.state.scene = 'battle';
        Object.assign(db.Skills[skillId], { scope: 1, successRate: 100, hitType: 0, effects: [], animationId: 0 });
        db.Skills[skillId].damage = { type: 1, formula: '10', critical: false, variance: 0, elementId: 0 };
    };
    const strike = () => r.useSkill(r.actor(1), skillId, 0, true);
    reset(); let action = strike(); assert.equal(action.damage, 9999); assert.equal(r.enemy(0).hp, 10001);
    r.enemy(0).states.push(22); assert.equal(strike().damage, 10000, 'cheat giữ sát thương modifier nếu đã lớn hơn 9999');
    r.enemy(0).hp = 100; assert.equal(strike().damage, 9999, 'cheat chạy sau modifier giữ đích 1 HP của plugin gốc');
    reset(); db.Skills[skillId].damage.formula = '0'; assert.equal(strike().damage, 9999, 'đòn HP trúng bị chặn về 0 vẫn tối thiểu 9999');
    reset(); db.Skills[skillId].successRate = 0; assert.equal(strike().damage, 0, 'trượt không tăng damage');
    reset(); db.Skills[skillId].damage.type = 5; assert.equal(strike().damage, 9999); assert.equal(r.enemy(0).hp, 10001);
    reset(); r.enemy(0).hp = 4; db.Skills[skillId].damage.type = 5;
    assert.equal(strike().damage, 4, 'hút HP không vượt HP đích'); assert.equal(r.enemy(0).hp, 0);
    for (const [type, resource, expected] of [[2, 'mp', 90], [3, 'hp', 110], [4, 'mp', 60]]) {
        reset(); r.enemy(0).hp = 100; r.enemy(0).mp = type === 4 ? 50 : 100;
        db.Skills[skillId].damage.type = type; strike(); assert.equal(r.enemy(0)[resource], expected, 'không đổi MP hoặc hồi phục');
    }
    reset(); db.Skills[skillId].scope = 7;
    const allyHp = e.state.actor(3).hp; r.useSkill(r.actor(1), skillId, 1, true);
    assert.equal(e.state.actor(3).hp, allyHp - 10, 'đòn đánh đồng đội không tăng damage');
    reset(); const hp = e.state.actor(1).hp;
    r.useSkill(r.enemy(0), skillId, 0, true); assert.equal(e.state.actor(1).hp, hp, 'quái tên lighthouse không có cheat');
    r.addState(r.actor(1), 1, 1, true); assert.ok(!e.state.actor(1).states.includes(1));
    assert.equal(e.state.actor(1).stateTurns[1], undefined, 'miễn death không tạo thời lượng state giả');
    e.state.changeActorState(1, 5, true); e.state.changeActorState(1, 17, true); r.syncActors();
    r.endTurn(); assert.equal(e.state.actor(1).hp, hp, 'poison/bleeding không hạ HP');
    const release = r.protectActionTargets([r.actor(1)]); r.changeResource(r.actor(1), 'hp', -99999); release();
    assert.equal(e.state.actor(1).hp, hp, 'IMMORTAL không bỏ qua cheat'); assert.equal(r.actor(1).alive, true);
    r.finish('escape'); e.state.scene = 'map';
    e.state.walkSteps = 19; e.state.through = true;
    const walked = e.step(6); e.advanceRoutes(e.state.moveFrames); await walked;
    assert.equal(e.state.actor(1).hp, hp, 'tick đi bộ không làm mất HP');

    reset(); const skill = db.Skills[skillId]; skill.animationId = 1;
    const forced = e.forceBattleAction([1, 1, skillId, 0]); let done = false, error;
    forced.then(() => { done = true; }, failure => { done = true; error = failure; });
    for (let i = 0; i < 2000 && !done; i++) { e.advanceRoutes(8); await flush(); }
    assert.ok(done); if (error) throw error;
    assert.equal(r.battle.lastAction.damage, 9999);
    const battleSave = e.save(); battleSave.actors[1].hp = 0; battleSave.battle.actors[0].hp = 0; battleSave.battle.actors[0].alive = false;
    await e.restore(battleSave); r = e.battle;
    assert.equal(r.actor(1).alive, true); assert.equal(r.actor(1).hp, e.state.actorParam(1, 0), 'save cũ đồng bộ cả wrapper chiến đấu của cheat');
    assert.equal(r.battle.lastAction.damage, 9999); assert.equal(r.enemy(0).hp, 10001, 'save không áp đòn lại');
    await commands([[353, []], [121, [7389, 7389, 0]]]);
    assert.equal(e.state.scene, 'gameover'); assert.equal(e.state.switchValue(7389), false, 'kết thúc truyện vẫn dừng event');
    assert.ok(e.state.hasNameCheat(1));
    console.log('ĐẠT: lighthouse đổi tên/HP/chết/chỉ số/state/save, damage/trượt/hút/hồi/MP/đồng đội, quái không cheat, tick/339 và game over truyện.');
})().catch(error => { console.error(error); process.exitCode = 1; });
