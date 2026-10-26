'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const watchdog = setTimeout(() => { console.error('AI chưa kết thúc trong thời hạn kiểm thử.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.75, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1, 3] });
    const troopId = engine.database.Troops.length;
    engine.database.Troops.push({ ...engine.database.Troops[1], id: troopId, pages: [] });
    engine.battle.setup(troopId, true, true); engine.state.scene = 'battle';
    const r = engine.battle, enemy = r.enemy(0);
    const matches = (type, a, b = 0) => r.enemyActionMatches(enemy, { conditionType: type, conditionParam1: a, conditionParam2: b });
    assert.equal(matches(0), true);
    assert.equal(matches(1, 0, 2), false, 'điều kiện lượt lặp không chạy ở lượt 0');
    r.battle.turn = 3; assert.equal(matches(1, 1, 2), true); assert.equal(matches(1, 3), true); assert.equal(matches(1, 2), false);
    enemy.hp = enemy.mhp / 2; assert.equal(matches(2, 0.5, 0.5), true); assert.equal(matches(2, 0, 0.49), false);
    enemy.mmp = 100; enemy.mp = 40; assert.equal(matches(3, 0.4, 0.4), true);
    assert.equal(matches(4, 2), false); enemy.states.push(2); assert.equal(matches(4, 2), true); enemy.states = [];
    assert.equal(matches(5, 1), true); assert.equal(matches(5, 99), false);
    engine.state.setSwitch(17, true); assert.equal(matches(6, 17), true);
    engine.state.setSwitch(17, false); assert.equal(matches(6, 17), false);
    assert.throws(() => matches(7, 0), /Điều kiện AI chưa hỗ trợ/);
    assert.equal(r.chooseEnemyAction(enemy), null, 'Guard torso không đánh khi switch 17 chưa bật');
    engine.state.setSwitch(17, true); assert.equal(r.chooseEnemyAction(enemy).skillId, 6);
    const data = engine.database.Enemies[1];
    const always = (skillId, rating) => ({ skillId, rating, conditionType: 0 });
    data.actions = [always(5, 5), always(7, 4), always(19, 2)];
    r.random = () => 0; assert.equal(r.chooseEnemyAction(enemy).skillId, 5);
    r.random = () => 0.99; assert.equal(r.chooseEnemyAction(enemy).skillId, 7, 'rating cách cao nhất >=3 bị loại');
    r.random = () => 0.5;
    let first = 0, second = 0;
    for (let i = 0; i < 100; i++) {
        r.random = () => (i + 0.5) / 100;
        const selected = r.chooseEnemyAction(enemy); if (selected.skillId === 5) first++; else second++;
    }
    assert.equal(first, 60); assert.equal(second, 40, 'trọng số là rating trừ (rating cao nhất - 3)');
    r.random = () => 0.75;
    r.handleEffect(333, [0, 0, 1]); assert.equal(r.chooseEnemyAction(enemy), null);
    r.handleEffect(334, [0]); enemy.hidden = true;
    assert.ok(r.enemyActions().every(action => action.enemy !== 0)); enemy.hidden = false;
    // Một quái dùng skill 7 thật, không gây sát thương và chạy common event 4.
    data.actions = [always(7, 5)];
    r.battle.enemies.slice(1).forEach(target => { target.hidden = true; });
    r.battle.managed = true; r.battle.phase = 'enemy';
    const beforeHp = engine.state.actor(1).hp;
    await engine.runEnemyTurn();
    assert.equal(engine.state.actor(1).hp, beforeHp, 'kỹ năng không damage không tự biến thành đòn đánh cố định');
    assert.equal(engine.state.switchValue(16), true, 'AI chạy common event từ skill thật');
    assert.equal(r.battle.lastAction.skillId, 7);
    await engine.forceBattleAction([0, 0, 7, -1]);
    assert.equal(r.enemyActions().length, 0, 'hành động cưỡng chế tiêu thụ hành động thường cùng lượt');
    r.battle.forcedThisTurn = [];
    // Thay skill bằng skill có animation: khóa trận đến khi animation xong.
    data.actions = [always(19, 5)]; r.battle.phase = 'enemy';
    let completed = false;
    const acting = engine.runEnemyTurn().then(() => { completed = true; }); await flush();
    assert.equal(completed, false); assert.equal(r.battle.phase, 'action');
    for (let i = 0; i < 1000 && !completed; i++) { engine.advanceRoutes(16); await flush(); }
    await acting; assert.equal(completed, true);
    // State Guard giữ đủ lượt, bộ đếm được lưu qua các update actor và save.
    engine.state.changeActorState(1, 2, true); r.resetStateTurns(r.actor(1), 2);
    engine.state.changeActorMp(1, -1);
    assert.equal(engine.state.actor(1).stateTurns[2], 1);
    const saved = engine.save(); await engine.restore(saved);
    assert.equal(engine.state.actor(1).stateTurns[2], 1);
    engine.battle.endTurn(); assert.equal(engine.state.actor(1).states.includes(2), false);
    engine.state.changeActorState(1, 2, true); engine.battle.finish('escape');
    assert.equal(engine.state.actor(1).states.includes(2), false, 'rời trận dọn state removeAtBattleEnd');
    let count = 0;
    for (const monster of engine.database.Enemies.filter(Boolean)) for (const action of monster.actions) {
        assert.ok(engine.database.Skills[action.skillId]);
        assert.ok(action.conditionType >= 0 && action.conditionType <= 6); count++;
    }
    console.log('ĐẠT: AI điều kiện 0–6, trọng số/rating, MP/state/ẩn/chết, kỹ năng/common event/animation và ' + count + ' hành động JSON.');
})().then(() => clearTimeout(watchdog)).catch(error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
