'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
let engine;
const watchdog = setTimeout(() => { console.error('Trận chưa kết thúc:', JSON.stringify(engine && engine.battle.battle)); process.exit(1); }, 5000);
const ticker = setInterval(() => { if (engine) engine.advanceRoutes(12); }, 1);
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
    engine = new GameEngine({ dataStore: store, random: () => 0.75, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 15, y: 22, direction: 8, party: [1] });
    const handlers = { effect: code => code === 250, message: () => {}, choice: () => 0 };
    const interpret = (commands, signal) => engine.createInterpreter(commands, 1, handlers, signal);
    const sourceTroop = engine.database.Troops.find(item => item && item.members && item.members.length > 0);
    const troop = { ...sourceTroop, id: engine.database.Troops.length, pages: [] };
    engine.database.Troops.push(troop);
    let completed = false;
    let running = interpret(branches(troop.id)).run().then(() => { completed = true; });
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
    const attacking = engine.battleAttack(1, 0);
    assert.throws(() => engine.battle.attack(1, 0), /Chưa đến lượt/);
    await attacking;
    assert.ok(target.hp < before);
    assert.equal(engine.battle.battle.turn, 1);
    engine.battle.enemyTurn();
    assert.equal(engine.battle.battle.turn, 1, 'không chạy lượt địch hai lần');
    engine.battle.random = () => 0;
    assert.equal(engine.battle.escape(), true);
    await running;
    engine.battle.random = () => 0.75;
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
    running = interpret(branches(testTroop)).run();
    await flush();
    assert.equal(engine.battle.enemy(0).hidden, true);
    assert.equal(engine.battle.aliveEnemies()[0].index, 1, 'giữ index thành viên trong JSON');
    assert.throws(() => engine.battle.attack(1, 0), /không hợp lệ/);
    await engine.battleAttack(1, 1);
    await running;
    assert.equal(engine.battle.battle.result, 'victory');
    assert.equal(engine.state.variableValue(50), 10);
    assert.equal(engine.state.scene, 'map');

    running = interpret(branches(troop.id)).run();
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

    running = interpret(branches(troop.id, false)).run();
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
    running = interpret(branches(troop.id), controller.signal).run();
    const cancelled = assert.rejects(running, { name: 'AbortError' });
    await flush(); controller.abort(); await cancelled; await flush();
    assert.equal(engine.state.scene, 'map');
    assert.equal(engine.battle.waiters.size, 0);
    assert.equal(engine.battle.battle.result, 'abort');

    engine.state.setVariable(60, troop.id);
    running = interpret([command(301, [1, 60, false, false])]).run();
    await flush();
    assert.equal(engine.battle.battle.troopId, troop.id);
    assert.equal(engine.battle.escape(), false, 'khóa chạy thoát theo dữ liệu');
    engine.battle.finish('victory'); await running;
    engine.battle.random = () => 0.99;
    running = interpret(branches(troop.id)).run();
    await flush();
    assert.equal(await engine.battleEscape(), false);
    assert.equal(engine.battle.battle.turn, 1, 'thoát thất bại chỉ tốn một lượt');
    engine.battle.finish('escape'); await running;
    const consecutive = [command(301, [0, troop.id, false, false]),
        command(121, [6000, 6000, 0]), ...branches(troop.id)];
    running = interpret(consecutive).run();
    await flush(); engine.battle.finish('victory'); await flush();
    assert.equal(engine.state.switchValue(6000), true, 'trận không có nhánh không nhảy qua lệnh kế tiếp');
    assert.equal(engine.battle.battle.result, null, 'trận tiếp theo vẫn mở');
    engine.battle.finish('escape'); await running;
    const snapshot = engine.save(); await engine.restore(snapshot);
    assert.equal(engine.state.battle.result, 'escape');
    [3, 4, 5, 6].forEach(id => engine.state.addActor(id));
    engine.state.addGuestActor(7);
    engine.battle.setup(troop.id, true, false);
    assert.deepEqual(engine.battle.battle.actors.map(actor => actor.id), [1, 3, 4, 5], 'trận chỉ nhận bốn người đầu, không nhận dự bị hay guest');
    engine.syncBattleActors();
    assert.deepEqual(engine.battle.battle.actors.map(actor => actor.id), [1, 3, 4, 5], 'đồng bộ sau troop page giữ giới hạn');
    engine.battle.battle.actors.forEach(actor => engine.state.changeActorHp(actor.id, -99999, true));
    engine.battle.syncActors(); engine.battle.checkResult();
    assert.equal(engine.battle.battle.result, 'defeat', 'dự bị còn sống không ngăn thất bại của đội tham chiến');
    assert.ok(engine.state.actor(6).hp > 0);
    engine.state.removeActor(3);
    engine.battle.setup(troop.id, true, true); engine.syncBattleActors();
    assert.deepEqual(engine.battle.battle.actors.map(actor => actor.id), [1, 4, 5, 6], 'thay đổi đội đưa người dự bị kế tiếp vào trận');
    engine.battle.finish('escape');
    console.log('ĐẠT: event chờ battle, nhánh thắng/thoát/thua, hồi sinh, khóa map, hủy và index enemy ẩn.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { clearInterval(ticker); clearTimeout(watchdog); });
