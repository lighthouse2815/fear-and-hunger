'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.5 });
    await engine.boot({ mapId: 74, x: 8, y: 8, direction: 8, party: [1] });
    const reset = (troopId = 1) => {
        if (engine.battle.battle && !engine.battle.battle.result) engine.battle.finish('escape');
        return engine.battle.setup(troopId, true, true);
    };
    const run = (code, parameters) => engine.createInterpreter([{ code, parameters }], 1).run();
    reset();
    const enemy = engine.battle.enemy(0), reader = engine.createInterpreter([], 1);
    await run(331, [0, 1, 0, 50, true]); assert.equal(enemy.hp, 1250);
    engine.state.setVariable(60, 100);
    await run(331, [0, 1, 1, 60, false]); assert.equal(enemy.hp, 1150);
    await run(331, [0, 1, 0, 99999, false]); assert.equal(enemy.hp, 1);
    await run(331, [0, 1, 0, 99999, true]);
    assert.equal(enemy.hp, 0); assert.equal(enemy.alive, false); assert.ok(enemy.states.includes(1));
    assert.equal(reader.evaluateCondition([5, 0, 0]), false);
    assert.equal(reader.evaluateCondition([5, 0, 1, 1]), true);
    await run(331, [0, 0, 0, 50, true]); assert.equal(enemy.hp, 0, 'đổi HP không hồi sinh quái chết');
    await run(333, [0, 1, 1]); assert.equal(enemy.hp, 1); assert.equal(enemy.alive, true);
    await run(333, [0, 0, 49]); assert.ok(!enemy.states.includes(49), 'tôn trọng miễn nhiễm state từ JSON');
    await run(333, [0, 0, 2]); assert.ok(enemy.states.includes(2));
    assert.equal(reader.evaluateCondition([5, 0, 1, 2]), true);
    await run(334, [0]); assert.equal(enemy.hp, enemy.mhp); assert.deepEqual(enemy.states, []);
    await run(333, [0, 0, 57]);
    assert.equal(reader.gameDataOperand(4, 0, 5), 15, 'state DEFENCE UP tăng phòng thủ 50%');
    const beforeAttack = enemy.hp;
    const defended = engine.battle.attack(1, 0);
    const expected = (engine.state.actorParam(1, 2) * 4 - 30) * 1.15;
    assert.ok(defended.hits.every(hit => Math.abs(hit.damage - expected) <= expected * 0.2 + 1), 'đọc phòng thủ state và nguyên tố từ JSON');
    assert.equal(enemy.hp, beforeAttack - defended.damage);
    assert.equal(defended.hits.length, 1, 'note Target Action ghi đè số effect của Attack');
    await run(333, [0, 1, 57]); assert.equal(reader.gameDataOperand(4, 0, 5), 10);
    await run(342, [0, 0, 0, 500]); assert.equal(enemy.tp, 100);
    await run(342, [0, 1, 1, 60]); assert.equal(enemy.tp, 0);
    enemy.hidden = true; assert.equal(reader.evaluateCondition([5, 0, 0]), false);
    await run(335, [0]); assert.equal(enemy.hidden, false);
    assert.equal(reader.evaluateCondition([5, 0, 0]), true);
    await run(336, [0, 486]);
    assert.equal(enemy.enemyId, 486); assert.equal(enemy.index, 0);
    assert.equal(enemy.battlerName, engine.database.Enemies[486].battlerName);
    assert.ok(enemy.hp <= enemy.mhp);
    for (let field = 0; field <= 9; field++) {
        const expected = field === 0 ? enemy.hp : field === 1 ? enemy.mp : engine.battle.enemyParam(enemy, field - 2);
        assert.equal(reader.gameDataOperand(4, 0, field), expected);
    }
    const mpEnemy = { ...engine.database.Enemies[1], id: engine.database.Enemies.length,
        params: [1300, 100, 10, 10, 12, 10, 10, 11] };
    engine.database.Enemies.push(mpEnemy);
    await run(336, [0, mpEnemy.id]); await run(334, [0]);
    const mp = enemy.mp; await run(332, [0, 1, 0, 20]); assert.equal(enemy.mp, mp - 20);
    await run(332, [0, 0, 0, 99999]); assert.equal(enemy.mp, enemy.mmp);
    assert.equal(reader.gameDataOperand(4, 99999, 0), 0);
    await assert.rejects(run(336, [0, 999999]), /Không tìm thấy enemy/);
    await assert.rejects(run(333, [0, 0, 999999]), /Không tìm thấy state/);
    const snapshot = engine.save(); await engine.restore(snapshot);
    assert.equal(engine.battle.enemy(0).enemyId, mpEnemy.id);
    assert.equal(engine.battle.enemy(0).mp, enemy.mp);
    await run(333, [-1, 0, 1]);
    assert.ok(engine.battle.battle.enemies.every(enemy => !enemy.alive));
    await run(334, [-1]); assert.ok(engine.battle.battle.enemies.every(enemy => enemy.alive));
    const ending = engine.battle.wait(); await run(340, []); assert.equal(await ending, 'escape');
    await assert.rejects(run(331, [0, 1, 0, 10, true]), /không hoạt động/);

    reset(); engine.state.scene = 'battle'; engine.state.timer = { active: true, frames: 12 };
    engine.advanceRoutes(5); assert.equal(engine.state.timer.frames, 7);
    const timeout = engine.battle.wait(); engine.advanceRoutes(7);
    assert.equal(await timeout, 'escape', 'hết giờ trả nhánh thoát ngay cả khi không cho chạy');
    assert.equal(engine.state.timer.frames, 0); assert.equal(engine.state.timer.active, true);
    reset(); engine.battle.battle.canEscape = false; engine.state.timer = { active: true, frames: 1 };
    engine.battle.eventRunning = true; engine.advanceRoutes(2);
    assert.equal(engine.battle.pendingResult, 'escape', 'chờ trang troop đang chạy');
    assert.equal(engine.battle.battle.result, null);
    engine.battle.eventRunning = false; engine.battle.finish(engine.battle.pendingResult); engine.battle.pendingResult = null;
    engine.state.scene = 'map'; engine.state.timer = { active: true, frames: 5 };
    engine.advanceRoutes(8); assert.equal(engine.state.timer.frames, 0, 'hết giờ trên map không tự kết thúc scene');

    let count = 0;
    for (const troop of engine.database.Troops.filter(Boolean)) for (const page of troop.pages) for (const command of page.list) {
        if (![331, 332, 333, 334, 335, 336, 340, 342].includes(command.code)) continue;
        reset(troop.id);
        await engine.createInterpreter([command], 0).run();
        for (const enemy of engine.battle.battle.enemies) {
            assert.ok(Number.isFinite(enemy.hp) && enemy.hp >= 0 && enemy.hp <= enemy.mhp);
            assert.ok(Number.isFinite(enemy.mp) && enemy.mp >= 0 && enemy.mp <= enemy.mmp);
            assert.equal(enemy.alive, enemy.hp > 0);
        }
        count++;
    }
    assert.ok(count > 2000);
    console.log('ĐẠT: lệnh HP/MP/TP/state/hồi sinh/hiện/biến hình/kết thúc trận, đọc dữ liệu, save và ' + count + ' lệnh troop thật.');
})().catch(error => { console.error(error); process.exitCode = 1; });
