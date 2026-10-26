'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const watchdog = setTimeout(() => { console.error('Lượt cả đội chưa kết thúc.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.5, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1, 3] });
    const skillId = engine.database.Skills.length, enemyId = engine.database.Enemies.length, troopId = engine.database.Troops.length;
    engine.database.Skills.push({ ...engine.database.Skills[3], id: skillId, animationId: 0, hitType: 0,
        successRate: 100, speed: 0, effects: [], damage: { type: 1, formula: '10', variance: 0, critical: false, elementId: 0 } });
    engine.database.Enemies.push({ ...engine.database.Enemies[1], id: enemyId,
        params: [1000, 100, 20, 10, 10, 10, 30, 10], actions: [{ skillId, conditionType: 0, rating: 5 }] });
    const members = [{ enemyId, x: 408, y: 400, hidden: false }];
    engine.database.Troops.push({ id: troopId, members, pages: [] });
    function reset(extra = [], pages = []) {
        engine.battle.finish('escape'); engine.animations.dispose();
        engine.database.Troops[troopId].members = members.concat(extra);
        engine.database.Troops[troopId].pages = pages;
        engine.state.party.forEach((id, index) => {
            engine.state.recoverActor(id); engine.state.changeActorSkill(id, skillId, true);
            engine.state.changeActorParam(id, 6, (index ? 40 : 20) - engine.state.actorParam(id, 6));
        });
        engine.battle.setup(troopId, true, true); engine.state.scene = 'battle';
    }
    async function finish(promise) {
        let done = false, value, failure;
        promise.then(result => { done = true; value = result; }, error => { done = true; failure = error; });
        for (let i = 0; i < 1000 && !done; i++) { engine.advanceRoutes(16); await flush(); }
        assert.equal(done, true); if (failure) throw failure; return value;
    }
    const select = (actor, kind = 'skill', id = skillId, target = 0) => engine.queueBattleAction(actor, kind, id, target);
    reset();
    select(1); const hp = engine.battle.enemy(0).hp;
    assert.equal(engine.battle.battle.turn, 0); assert.equal(engine.battle.enemy(0).hp, hp);
    await assert.rejects(engine.startBattleTurn(), /đủ nhân vật/);
    assert.equal(engine.battle.battle.turn, 0); assert.equal(engine.battle.battle.inputActions.length, 1);
    select(1, 'skill', 2); assert.equal(engine.battle.battle.inputActions.length, 1, 'chọn lại thay lệnh cũ');
    engine.removeBattleAction(1); assert.equal(engine.battle.battle.inputActions.length, 0);
    select(1); select(3);
    await engine.restore(engine.save());
    assert.deepEqual(engine.battle.battle.inputActions.map(a => a.actorId), [1, 3], 'save giữ lựa chọn chưa chạy');
    const running = engine.startBattleTurn();
    await assert.rejects(engine.startBattleTurn(), /Chưa đến lượt/);
    assert.equal(engine.removeBattleAction(1), false);
    const reports = await finish(running);
    assert.deepEqual(reports.map(report => [report.subject, report.subjectId]), [['actor', 3], ['enemy', 0], ['actor', 1]], 'tốc độ xen kẽ cả hai phe');
    assert.equal(engine.battle.battle.turn, 1); assert.equal(engine.battle.enemy(0).hp, hp - 20);
    assert.equal(engine.battle.battle.inputActions.length, 0); assert.equal(engine.battle.battle.phase, 'input');

    reset(); engine.state.gainItem('items', 28, 1);
    const stock = engine.state.itemCount('items', 28);
    // Chuẩn hóa lượng trong test để xác nhận giữ chỗ chung cả đội.
    engine.state.gainItem('items', 28, 1 - stock);
    select(1, 'item', 28, 0);
    assert.throws(() => select(3, 'item', 28, 1), /Không đủ vật phẩm/);
    assert.equal(engine.battle.battle.inputActions.length, 1);
    assert.equal(engine.state.itemCount('items', 28), 1, 'chọn chưa tiêu vật phẩm');
    select(1); select(3, 'item', 28, 1);
    engine.state.changeActorHp(3, -50, true); engine.battle.syncActors();
    await finish(engine.startBattleTurn()); assert.equal(engine.state.itemCount('items', 28), 0);
    assert.equal(engine.state.actor(3).hp, 60, 'hồi 20 HP rồi nhận đòn 10 HP từ AI');
    assert.throws(() => select(1, 'other', 1), /Loại hành động/);
    assert.throws(() => select(1, 'skill', skillId, 9999), /không hợp lệ/);

    // Mục tiêu chết giữa lượt: chuyển sang quái hiện khác, giữ index troop.
    reset([{ ...members[0], hidden: true }, { ...members[0] }]);
    engine.battle.enemy(0).hp = 5;
    select(1); select(3);
    const retarget = await finish(engine.startBattleTurn());
    assert.equal(retarget.find(r => r.subject === 'actor' && r.subjectId === 3).target, 0);
    assert.equal(retarget.find(r => r.subject === 'actor' && r.subjectId === 1).target, 2);
    assert.ok(retarget.every(r => !(r.subject === 'enemy' && r.subjectId === 0)), 'quái đã chết không thực hiện lệnh đã chọn');

    // Guard chạy trước kẻ địch và chỉ bị dọn khi cả lượt kết thúc.
    reset(); engine.battle.random = () => 0.25; select(1, 'skill', 2); select(3);
    const guarded = await finish(engine.startBattleTurn());
    assert.equal(guarded[0].skillId, 2);
    assert.equal(guarded.find(r => r.subject === 'enemy').hits[0].damage, 5);
    assert.equal(engine.state.actor(1).states.includes(2), false);

    engine.battle.random = () => 0.5;
    // Tốc độ đọc speed trong JSON và trait tốc độ đánh, không áp trait cho skill thường.
    const enemy = engine.battle.enemy(0), definition = engine.database.Enemies[enemyId];
    const baseSpeed = engine.battle.actionSpeed(enemy, { speed: 0 }, false);
    definition.traits.push({ code: 33, dataId: 0, value: 17 });
    assert.equal(engine.battle.actionSpeed(enemy, { speed: 100 }, false), baseSpeed + 100);
    assert.equal(engine.battle.actionSpeed(enemy, { speed: 0 }, true), baseSpeed + 17);
    definition.traits.pop();
    const page = commands => ({ span: 1, conditions: { turnValid: true, turnA: 1, turnB: 0 }, list: commands });
    reset([], [page([{ code: 311, parameters: [0, 1, 1, 0, 99999, true] }])]);
    engine.state.gainItem('items', 28, 1); select(1, 'item', 28, 0); select(3);
    const deadActor = await finish(engine.startBattleTurn());
    assert.ok(!deadActor.some(r => r.subject === 'actor' && r.subjectId === 1));
    assert.equal(engine.state.itemCount('items', 28), 1, 'nhân vật bị hạ trước lượt không tiêu item');

    reset([], [page([{ code: 339, parameters: [1, 3, 5, 0] }])]);
    select(1); select(3);
    const forced = await finish(engine.startBattleTurn());
    assert.equal(forced.filter(r => r.subject === 'actor' && r.subjectId === 3).length, 0, 'cưỡng chế thay hành động thường của đúng nhân vật');

    reset(); engine.state.gainItem('items', 28, 1); engine.battle.enemy(0).hp = 5;
    select(1, 'item', 28, 0); select(3);
    await finish(engine.startBattleTurn());
    assert.equal(engine.battle.battle.result, 'victory'); assert.equal(engine.state.scene, 'map');
    assert.equal(engine.state.itemCount('items', 28), 2, 'thắng trước hành động chậm không tiêu vật phẩm');

    reset(); engine.state.changeActorState(3, 10, true); // restriction 4: không thể hành động.
    assert.ok(engine.database.States[10].restriction > 0);
    assert.deepEqual(engine.battle.inputActors().map(a => a.id), [1]);
    select(1); await finish(engine.startBattleTurn());
    assert.equal(engine.battle.battle.turn, 1, 'không đòi lệnh từ nhân vật bị khóa');
    reset(); engine.state.gainItem('items', 28, 1-engine.state.itemCount('items',28));
    select(1, 'item', 28, 0); select(3);
    engine.state.gainItem('items', 28, -1);
    await assert.rejects(engine.startBattleTurn(), /Chưa thể dùng vật phẩm/);
    assert.equal(engine.battle.battle.turn, 0, 'kiểm tra lại tồn kho trước khi tiêu lượt');
    reset(); engine.state.changeActorState(1, 10, true); engine.state.changeActorState(3, 10, true);
    assert.equal(engine.battle.inputActors().length, 0);
    await finish(engine.startBattleTurn()); assert.equal(engine.battle.battle.turn, 1, 'đội bị khóa toàn bộ vẫn cho địch chạy lượt');
    reset(); select(1); select(3); engine.battle.random = () => 0;
    await engine.battleEscape(); assert.equal(engine.battle.battle.inputActions.length, 0);
    // Hủy trong lúc hành động đầu tiên chờ animation không chạy các lệnh sau.
    engine.battle.random = () => 0.5;
    engine.database.Skills[skillId].animationId = 7;
    const controller = new AbortController();
    const battleEvent = engine.createInterpreter([{ code: 301, parameters: [0, troopId, true, true] },
        { code: 121, parameters: [6260, 6260, 0] }], 0, {}, controller.signal).run();
    const rejectedBattle = assert.rejects(battleEvent, { name: 'AbortError' }); await flush();
    select(1); select(3);
    const turn = engine.startBattleTurn(); const rejectedTurn = assert.rejects(turn, { name: 'AbortError' }); await flush();
    assert.equal(engine.battle.battle.phase, 'action');
    controller.abort(); await rejectedBattle; await rejectedTurn;
    engine.advanceRoutes(1000); await flush();
    assert.equal(engine.battle.battle.turnActions.length, 1); assert.equal(engine.animations.entries.length, 0);
    assert.equal(engine.state.switchValue(6260), false); assert.equal(engine.state.scene, 'map');
    console.log('ĐẠT: chọn/sửa/hủy cả đội, giữ chỗ item/save, tốc độ xen kẽ/Guard, đổi mục tiêu, chết/cưỡng chế/thắng sớm và khóa hành động.');
})().then(() => clearTimeout(watchdog)).catch(error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
