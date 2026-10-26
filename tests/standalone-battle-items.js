'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const watchdog = setTimeout(() => { console.error('Vật phẩm chiến đấu chưa kết thúc.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.75, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1, 3] });
    const enemyId = engine.database.Enemies.length, troopId = engine.database.Troops.length;
    engine.database.Enemies.push({ ...engine.database.Enemies[1], id: enemyId, actions: [] });
    engine.database.Troops.push({ id: troopId, pages: [], members: [
        { enemyId, x: 400, y: 400, hidden: false }, { enemyId, x: 450, y: 400, hidden: true },
        { enemyId, x: 500, y: 400, hidden: false }
    ] });
    function reset() {
        engine.animations.dispose(); engine.battle.finish('escape');
        engine.state.party.forEach(id => engine.state.recoverActor(id));
        engine.battle.setup(troopId, true, true); engine.state.scene = 'battle';
    }
    async function finish(promise) {
        let done = false, value, failure;
        promise.then(result => { done = true; value = result; }, error => { done = true; failure = error; });
        for (let i = 0; i < 1000 && !done; i++) { engine.advanceRoutes(16); await flush(); }
        assert.equal(done, true); if (failure) throw failure; return value;
    }
    reset(); engine.state.gainItem('items', 28, 1); engine.state.changeActorHp(3, -50, true); engine.battle.syncActors();
    const before = engine.state.actor(3).hp, mp = engine.state.actor(1).mp, tp = engine.state.actor(1).tp;
    const bottles = engine.state.itemCount('items', 9);
    const result = await finish(engine.battleItem(1, 28, 1));
    assert.equal(result.itemId, 28); assert.equal(result.skillId, undefined);
    assert.equal(engine.state.actor(3).hp, before + 20, 'index bạn trỏ đúng actor thứ hai');
    assert.equal(engine.state.actor(1).mp, mp); assert.equal(engine.state.actor(1).tp, tp);
    assert.equal(engine.state.itemCount('items', 28), 0); assert.equal(engine.state.itemCount('items', 9), bottles + 1);
    assert.equal(engine.battle.battle.turn, 1);
    await assert.rejects(engine.battleItem(1, 28, 1), /Chưa thể dùng vật phẩm/);
    assert.equal(engine.battle.battle.turn, 1, 'vật phẩm hết không tiêu lượt');
    engine.state.gainItem('items', 40, 1);
    await assert.rejects(engine.battleItem(1, 40, 0), /Chưa thể dùng vật phẩm/);
    assert.equal(engine.state.itemCount('items', 40), 1, 'sách chỉ dùng ngoài trận không bị tiêu');
    engine.state.gainItem('items', 52, 1); engine.state.changeActorState(3, 17, true); engine.state.changeActorState(3, 90, true);
    await finish(engine.battleItem(1, 52, 1));
    assert.ok(!engine.state.actor(3).states.includes(17) && !engine.state.actor(3).states.includes(90));
    engine.state.gainItem('items', 10, 1);
    const attacking = engine.battleItem(1, 10, 0); await flush();
    assert.equal(engine.battle.battle.phase, 'action'); assert.equal(engine.state.itemCount('items', 10), 0);
    await assert.rejects(engine.battleItem(1, 10, 0), /Chưa đến lượt/);
    const fire = await finish(attacking);
    assert.deepEqual(fire.targets.map(target => target.id), [0, 2], 'Murky vial đánh toàn bộ quái hiện, không đánh quái ẩn');
    assert.ok(engine.battle.enemy(0).states.includes(75)); assert.ok(engine.battle.enemy(2).states.includes(75));
    assert.ok(engine.battle.enemy(0).hp < engine.battle.enemy(0).mhp);
    assert.equal(engine.animations.entries.length, 0);
    reset(); engine.state.gainItem('items', 53, 1);
    const poison = await finish(engine.battleItem(1, 53, 2));
    assert.equal(poison.damage, 0); assert.ok(engine.battle.enemy(2).states.includes(17), 'Purple vial áp độc không gây damage từ formula khi type=0');
    assert.ok(!engine.battle.enemy(0).states.includes(17));
    const snapshot = engine.save(); await engine.restore(snapshot);
    assert.equal(engine.battle.battle.lastAction.itemId, 53); assert.equal(engine.state.itemCount('items', 53), 0);
    // Hiệu ứng/đích dùng chung hỗ trợ hồi sinh, item không tiêu và validation trước khi tiêu.
    reset();
    const id = engine.database.Items.length;
    const revive = { ...engine.database.Items[28], id, scope: 9, consumable: false,
        effects: [{ code: 22, dataId: 1, value1: 1 }] };
    engine.database.Items.push(revive); engine.state.gainItem('items', id, 1);
    engine.state.changeActorState(3, 1, true); engine.battle.syncActors();
    await finish(engine.battleItem(1, id, 1));
    assert.equal(engine.state.actor(3).hp, 20); assert.equal(engine.state.actor(3).states.includes(1), false);
    assert.equal(engine.state.itemCount('items', id), 1);
    revive.effects = [{ code: 999, dataId: 0 }];
    assert.throws(() => engine.battle.useItem(engine.battle.actor(1), id, 0), /Hiệu ứng hành động chưa hỗ trợ/);
    assert.equal(engine.state.itemCount('items', id), 1);
    let count = 0;
    for (const item of engine.database.Items.filter(item => item && item.id !== id && [0, 1].includes(item.occasion))) {
        reset(); engine.state.gainItem('items', item.id, 1);
        const stock = engine.state.itemCount('items', item.id);
        const action = engine.battle.useItem(engine.battle.actor(1), item.id, 0);
        assert.equal(action.itemId, item.id); assert.equal(engine.state.itemCount('items', item.id), stock - (item.consumable ? 1 : 0));
        assert.ok(action.targets.every(target => target.type === (item.scope <= 6 ? 'enemy' : 'actor')));
        count++;
    }
    assert.equal(count, 49);
    console.log('ĐẠT: item trong trận, HP/MP/state/đích đơn-toàn đội, SE/animation/common event, chống dùng lặp, save và 49 item JSON.');
})().then(() => clearTimeout(watchdog)).catch(error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
