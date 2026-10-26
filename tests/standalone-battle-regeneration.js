'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const watchdog = setTimeout(() => { console.error('Trạng thái cuối lượt chưa kết thúc.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.5, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1, 3] });
    const enemyId = engine.database.Enemies.length, troopId = engine.database.Troops.length;
    engine.database.Enemies.push({ ...engine.database.Enemies[1], id: enemyId,
        params: [101, 50, 10, 10, 10, 10, 10, 10], actions: [{ skillId: 5, conditionType: 0, rating: 5 }] });
    engine.database.Troops.push({ id: troopId, pages: [], members: [
        { enemyId, x: 408, y: 400, hidden: false }, { enemyId, x: 500, y: 400, hidden: true },
        { enemyId, x: 600, y: 400, hidden: false }
    ] });
    function reset() {
        engine.battle.finish('escape'); engine.animations.dispose();
        engine.state.party.forEach(id => engine.state.recoverActor(id));
        engine.battle.setup(troopId, true, true); engine.state.scene = 'battle';
    }
    async function finish(promise) {
        let done = false, value, failure;
        promise.then(result => { done = true; value = result; }, error => { done = true; failure = error; });
        for (let i = 0; i < 1000 && !done; i++) { engine.advanceRoutes(16); await flush(); }
        assert.equal(done, true); if (failure) throw failure; return value;
    }
    reset();
    engine.state.changeActorState(1, 5, true); engine.state.changeActorState(1, 17, true);
    engine.state.changeActorState(3, 90, true);
    engine.battle.handleEffect(333, [-1, 0, 29]); engine.battle.handleEffect(333, [2, 0, 1]);
    engine.queueBattleAction(1, 'skill', 2, 0); engine.queueBattleAction(3, 'skill', 2, 0);
    await finish(engine.startBattleTurn());
    assert.equal(engine.state.actor(1).hp, 87, 'Bleeding và Poisoned cộng dồn -13% sau đủ hai hành động của đội');
    assert.equal(engine.state.actor(3).hp, 80, 'Toxic đọc -20% từ States.json');
    assert.equal(engine.battle.enemy(0).hp, 90, 'quái 101 HP mất floor(-10.1)=-11 HP');
    assert.equal(engine.battle.enemy(1).hp, 101, 'quái ẩn không bị regen'); assert.equal(engine.battle.enemy(2).hp, 0, 'quái chết không hồi phục');
    assert.equal(engine.battle.battle.turnEffects.length, 3); assert.equal(engine.battle.battle.turn, 1);
    assert.equal(engine.state.actor(1).states.includes(2), false);
    const afterTurn = engine.save(); await engine.restore(afterTurn);
    assert.equal(engine.state.actor(1).hp, 87, 'tải save không tick lại poison');
    assert.deepEqual(engine.battle.battle.turnEffects, afterTurn.battle.turnEffects);
    engine.battle.enemyTurn(); assert.equal(engine.state.actor(1).hp, 87, 'không tick lại khi chưa tới lượt địch');
    engine.state.changeActorHp(1, -85, true); engine.battle.syncActors();
    engine.battle.enemy(0).hp = 2;
    engine.battle.endTurn();
    assert.equal(engine.state.actor(1).hp, 1); assert.equal(engine.battle.enemy(0).hp, 1);
    assert.equal(engine.state.actor(1).states.includes(1), false, 'optSlipDeath=false không hạ nhân vật');
    engine.battle.endTurn(); assert.equal(engine.state.actor(1).hp, 1); assert.equal(engine.battle.enemy(0).hp, 1);

    // Hồi phục HP/MP/TP từ trait được chặn tại max; state hết lượt vẫn tick lần cuối.
    reset();
    const id = engine.database.States.length;
    engine.database.States.push({ ...engine.database.States[2], id, name: 'Hồi phục kiểm thử', minTurns: 1, maxTurns: 1,
        traits: [{ code: 22, dataId: 7, value: 0.2 }, { code: 22, dataId: 8, value: 0.3 }, { code: 22, dataId: 9, value: 0.4 }] });
    engine.state.changeActorState(1, id, true); engine.state.changeActorHp(1, -5, true); engine.state.changeActorMp(1, -7);
    engine.state.actor(1).tp = 90; engine.battle.syncActors();
    engine.battle.handleEffect(333, [0, 0, id]); engine.battle.enemy(0).hp = 99; engine.battle.enemy(0).mp = 45; engine.battle.enemy(0).tp = 90;
    const regeneration = engine.battle.endTurn();
    assert.deepEqual(regeneration.find(effect => effect.subject === 'actor' && effect.subjectId === 1),
        { subject: 'actor', subjectId: 1, hp: 5, mp: 7, tp: 10 });
    assert.equal(engine.state.actor(1).hp, 100); assert.equal(engine.state.actor(1).mp, 100); assert.equal(engine.state.actor(1).tp, 100);
    assert.deepEqual(regeneration.find(effect => effect.subject === 'enemy' && effect.subjectId === 0),
        { subject: 'enemy', subjectId: 0, hp: 2, mp: 5, tp: 10 });
    assert.equal(engine.state.actor(1).states.includes(id), false); assert.equal(engine.battle.enemy(0).states.includes(id), false);
    assert.deepEqual(engine.battle.endTurn(), [], 'không tick trait đã hết hạn');
    const negativeId = engine.database.States.length;
    engine.database.States.push({ ...engine.database.States[17], id: negativeId,
        traits: [{ code: 22, dataId: 8, value: -0.5 }, { code: 22, dataId: 9, value: -0.5 }] });
    engine.state.changeActorState(1, negativeId, true); engine.state.actor(1).mp = 3; engine.state.actor(1).tp = 3;
    engine.battle.endTurn(); assert.equal(engine.state.actor(1).mp, 0); assert.equal(engine.state.actor(1).tp, 0);

    // Giải độc trước cuối lượt ngăn tick ngay lượt đó, bao gồm common event trả chai.
    reset(); engine.state.changeActorState(1, 17, true); engine.state.gainItem('items', 52, 1);
    engine.queueBattleAction(1, 'item', 52, 0); engine.queueBattleAction(3, 'skill', 2, 0);
    await finish(engine.startBattleTurn());
    assert.equal(engine.state.actor(1).hp, 100); assert.equal(engine.state.actor(1).states.includes(17), false);
    assert.equal(engine.battle.battle.turnEffects.length, 0);

    // HP giảm bởi poison phải kích hoạt lại troop page cuối lượt.
    reset(); engine.battle.handleEffect(333, [0, 0, 17]);
    engine.database.Troops[troopId].pages = [{ span: 0, conditions: { enemyValid: true, enemyIndex: 0, enemyHp: 90, turnEnding: true }, list: [
        { code: 121, parameters: [6280, 6280, 0] }
    ] }];
    engine.queueBattleAction(1, 'skill', 2, 0); engine.queueBattleAction(3, 'skill', 2, 0);
    await finish(engine.startBattleTurn()); assert.equal(engine.state.switchValue(6280), true);
    engine.database.Troops[troopId].pages = [];

    for (const stateId of [5, 17, 29, 88, 90, 105]) {
        reset(); engine.state.changeActorState(1, stateId, true); engine.battle.handleEffect(333, [0, 0, stateId]);
        const rate = engine.database.States[stateId].traits.find(trait => trait.code === 22 && trait.dataId === 7).value;
        engine.battle.endTurn();
        assert.equal(engine.state.actor(1).hp, 100 + Math.floor(100 * rate), 'tick state thật ' + stateId + ' trên actor');
        assert.equal(engine.battle.enemy(0).hp, 101 + Math.floor(101 * rate), 'tick state thật ' + stateId + ' trên quái');
    }
    reset(); engine.state.changeActorState(1, 17, true); engine.battle.random = () => 0.99;
    assert.equal(await finish(engine.battleEscape()), false);
    assert.equal(engine.state.actor(1).hp, 90); assert.equal(engine.battle.battle.turn, 1, 'chạy thoát thất bại tick đúng một lượt');
    engine.battle.random = () => 0;
    await engine.battleEscape(); assert.equal(engine.state.actor(1).hp, 90, 'chạy thoát thành công không tick thêm');
    engine.battle.random = () => 0.5;
    // Khi cấu hình cho phép, slip damage đồng bộ trạng thái chết và kết quả thua.
    reset(); engine.database.System.optSlipDeath = true;
    engine.state.party.forEach(actorId => { engine.state.changeActorHp(actorId, -95, true); engine.state.changeActorState(actorId, 17, true); });
    engine.battle.syncActors(); engine.battle.battle.canLose = false;
    engine.queueBattleAction(1, 'skill', 2, 0); engine.queueBattleAction(3, 'skill', 2, 0);
    await finish(engine.startBattleTurn());
    assert.equal(engine.battle.battle.result, 'defeat'); assert.equal(engine.state.scene, 'gameover');
    assert.ok(engine.state.party.every(id => engine.state.actor(id).hp === 0 && engine.state.actor(id).states.includes(1)));
    console.log('ĐẠT: Bleeding/Poisoned/Toxic/Burning, cộng dồn/làm tròn, HP/MP/TP/giới hạn, ẩn/chết, hết hạn/giải độc, save, troop page và slip death.');
})().then(() => clearTimeout(watchdog)).catch(error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
