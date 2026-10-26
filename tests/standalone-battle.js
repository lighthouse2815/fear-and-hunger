'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const command = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
function branches(troopId, canLose = true) {
    return [command(301, [0, troopId, true, canLose]),
        command(601), command(122, [50, 50, 0, 0, 10], 1),
        command(602), command(122, [50, 50, 0, 0, 20], 1),
        command(603), command(122, [50, 50, 0, 0, 30], 1), command(604),
        command(121, [51, 51, 0])];
}
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0 });
    await engine.boot({ mapId: 74, x: 15, y: 22, direction: 8, party: [1] });
    const troop = engine.database.Troops.find(item => item && item.members && item.members.length > 0);
    let completed = false;
    let running = engine.createInterpreter(branches(troop.id), 1).run().then(() => { completed = true; });
    await flush();
    assert.equal(engine.state.scene, 'battle');
    assert.equal(engine.battle.battle.troopId, troop.id);
    assert.equal(completed, false, 'event chờ trận kết thúc');
    assert.equal(engine.state.variableValue(50), 0);
    assert.equal(engine.state.switchValue(51), false);
    assert.equal(engine.move(2), false);
    assert.equal(await engine.step(2), false);
    assert.equal(await engine.interact(), null);
    assert.throws(() => engine.battle.setup(troop.id), /đang chạy/);
    const target = engine.battle.enemy(0), before = target.hp;
    engine.battle.attack(1, 0);
    assert.ok(target.hp < before);
    assert.throws(() => engine.battle.attack(1, 0), /Chưa đến lượt/);
    engine.battle.enemyTurn();
    assert.equal(engine.battle.battle.turn, 1);
    engine.battle.enemyTurn();
    assert.equal(engine.battle.battle.turn, 1, 'không chạy lượt địch hai lần');
    assert.equal(engine.battle.escape(), true);
    await running;
    assert.equal(engine.state.scene, 'map');
    assert.equal(engine.state.variableValue(50), 20, 'chỉ chạy nhánh thoát');
    assert.equal(engine.state.switchValue(51), true, 'tiếp tục sau 604');
    assert.equal(engine.battle.waiters.size, 0);

    // Troop nhỏ cho phép kết thúc bằng đòn đánh thật, có thành viên ẩn đứng trước.
    const testTroop = engine.database.Troops.length;
    engine.database.Troops.push({ id: testTroop, members: [
        { ...troop.members[0], hidden: true }, { ...troop.members[1], hidden: false }
    ], pages: [] });
    engine.state.recoverActor(1);
    running = engine.createInterpreter(branches(testTroop), 1).run();
    await flush();
    assert.equal(engine.battle.enemy(0).hidden, true);
    assert.equal(engine.battle.aliveEnemies()[0].index, 1, 'giữ index thành viên trong JSON');
    assert.throws(() => engine.battle.attack(1, 0), /không hợp lệ/);
    engine.battle.attack(1, 1);
    await running;
    assert.equal(engine.battle.battle.result, 'victory');
    assert.equal(engine.state.variableValue(50), 10);
    assert.equal(engine.state.scene, 'map');

    running = engine.createInterpreter(branches(troop.id), 1).run();
    await flush();
    engine.state.changeActorHp(1, -99999, true);
    engine.battle.actor(1).hp = 0;
    engine.battle.actor(1).alive = false;
    engine.battle.checkResult();
    await running;
    assert.equal(engine.state.variableValue(50), 30);
    assert.equal(engine.state.actor(1).hp, 1);
    assert.ok(!engine.state.actor(1).states.includes(1));
    assert.equal(engine.state.scene, 'map');

    running = engine.createInterpreter(branches(troop.id, false), 1).run();
    await flush();
    engine.state.setVariable(50, 0); engine.state.setSwitch(51, false);
    engine.state.changeActorHp(1, -99999, true);
    engine.battle.actor(1).hp = 0; engine.battle.actor(1).alive = false;
    engine.battle.checkResult();
    await running;
    assert.equal(engine.state.scene, 'gameover');
    assert.equal(engine.state.variableValue(50), 0, 'thua bắt buộc dừng event');
    assert.equal(engine.state.switchValue(51), false);

    engine.state.scene = 'map'; engine.state.recoverActor(1);
    const controller = new AbortController();
    running = engine.createInterpreter(branches(troop.id), 1, {}, controller.signal).run();
    const cancelled = assert.rejects(running, { name: 'AbortError' });
    await flush(); controller.abort(); await cancelled; await flush();
    assert.equal(engine.state.scene, 'map');
    assert.equal(engine.battle.waiters.size, 0);
    assert.equal(engine.battle.battle.result, 'abort');

    engine.state.setVariable(60, troop.id);
    running = engine.createInterpreter([command(301, [1, 60, false, false])], 1).run();
    await flush();
    assert.equal(engine.battle.battle.troopId, troop.id);
    assert.equal(engine.battle.escape(), false, 'khóa chạy thoát theo dữ liệu');
    engine.battle.finish('victory'); await running;
    engine.battle.random = () => 0.99;
    running = engine.createInterpreter(branches(troop.id), 1).run();
    await flush();
    assert.equal(engine.battle.escape(), false);
    assert.equal(engine.battle.battle.turn, 1, 'thoát thất bại chỉ tốn một lượt');
    engine.battle.finish('escape'); await running;
    const consecutive = [command(301, [0, troop.id, false, false]),
        command(121, [52, 52, 0]), ...branches(troop.id)];
    running = engine.createInterpreter(consecutive, 1).run();
    await flush(); engine.battle.finish('victory'); await flush();
    assert.equal(engine.state.switchValue(52), true, 'trận không có nhánh không nhảy qua lệnh kế tiếp');
    assert.equal(engine.battle.battle.result, null, 'trận tiếp theo vẫn mở');
    engine.battle.finish('escape'); await running;
    const snapshot = engine.save(); await engine.restore(snapshot);
    assert.equal(engine.state.battle.result, 'escape');
    console.log('ĐẠT: event chờ battle, nhánh thắng/thoát/thua, hồi sinh, khóa map, hủy và index enemy ẩn.');
})().catch(error => { console.error(error); process.exitCode = 1; });
