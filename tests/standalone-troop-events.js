'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const command = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
const page = (conditions, list, span = 0) => ({ conditions, list, span });
const variable = id => command(122, [id, id, 1, 0, 1]);
const engines = [];
const ticker = setInterval(() => engines.forEach(engine => engine.advanceRoutes(12)), 1);
const watchdog = setTimeout(() => { console.error('Sự kiện troop không kết thúc trong thời hạn kiểm thử.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    async function boot() {
        const engine = new GameEngine({ dataStore: store, random: () => 0.75, onRouteEffect: () => true });
        await engine.boot({ mapId: 74, x: 8, y: 8, direction: 8, party: [1] });
        engines.push(engine);
        engine.battle.random = () => 0.75;
        return engine;
    }
    const engine = await boot();
    function troop(pages, target = engine) {
        const id = target.database.Troops.length;
        target.database.Troops.push({ id, members: [target.database.Troops[1].members[0]], pages });
        return id;
    }
    const start = (engine, id, handlers, signal) => engine.createInterpreter([
        command(301, [0, id, true, true]), command(121, [6009, 6009, 0])
    ], 1, handlers, signal).run();

    // Điều kiện phải kết hợp bằng AND và so HP theo phần trăm, kể cả đúng ngưỡng.
    engine.battle.setup(1, true, true);
    const runtime = engine.battle, enemy = runtime.enemy(0);
    enemy.hp = 650;
    engine.state.changeActorHp(1, -50, true); engine.state.setSwitch(6001, true);
    const conditional = page({ enemyValid: true, enemyIndex: 0, enemyHp: 50,
        actorValid: true, actorId: 1, actorHp: 50, switchValid: true, switchId: 6001 }, []);
    assert.equal(runtime.pageMatches(conditional, false), true);
    conditional.conditions.enemyHp = 49; assert.equal(runtime.pageMatches(conditional, false), false);
    conditional.conditions.enemyHp = 50; conditional.conditions.actorHp = 49;
    assert.equal(runtime.pageMatches(conditional, false), false);
    conditional.conditions.actorHp = 50; engine.state.setSwitch(6001, false);
    assert.equal(runtime.pageMatches(conditional, false), false);
    assert.equal(runtime.pageMatches(page({}, []), false), false, 'page không điều kiện không tự chạy');
    const periodic = page({ turnValid: true, turnA: 1, turnB: 2 }, []);
    runtime.battle.turn = 3; assert.equal(runtime.pageMatches(periodic, false), true);
    runtime.battle.turn = 2; assert.equal(runtime.pageMatches(periodic, false), false);
    assert.equal(runtime.pageMatches(page({ turnEnding: true }, []), false), false);
    assert.equal(runtime.pageMatches(page({ turnEnding: true }, []), true), true);
    runtime.finish('escape'); engine.state.recoverActor(1); engine.state.setSwitch(6001, false);

    engine.database.Enemies[1] = { ...engine.database.Enemies[1], params: [10000, ...engine.database.Enemies[1].params.slice(1)] };
    const id = troop([
        page({ turnValid: true, turnA: 0, turnB: 0 }, [variable(6100)]),
        page({ turnEnding: true }, [variable(6101)], 1),
        page({ enemyValid: true, enemyIndex: 0, enemyHp: 50 }, [variable(6102)]),
        page({ switchValid: true, switchId: 6103 }, [variable(6103), command(121, [6103, 6103, 1])], 2),
        page({ switchValid: true, switchId: 6104 }, [variable(6104)], 1)
    ]);
    let running = start(engine, id); await flush();
    assert.equal(engine.state.variableValue(6100), 1);
    assert.equal(engine.battle.battle.turn, 0);
    engine.state.setSwitch(6103, true); engine.state.setSwitch(6104, true);
    const attack = engine.battleAttack(1, 0);
    await assert.rejects(engine.battleAttack(1, 0), /Chưa đến lượt/);
    assert.equal(await engine.battleEscape(), false, 'không chen chạy thoát khi page đang chạy');
    await attack;
    assert.equal(engine.state.variableValue(6101), 1, 'page mỗi lượt chỉ chạy một lần cuối lượt');
    assert.equal(engine.state.variableValue(6103), 1, 'page moment có thể tự tắt điều kiện');
    assert.equal(engine.state.variableValue(6104), 1, 'page mỗi lượt không lặp ở các lần kiểm tra trong lượt');
    assert.equal(engine.battle.battle.turn, 1);
    const loaded = await boot(); loaded.database.Troops[id] = engine.database.Troops[id];
    loaded.database.Enemies[1] = engine.database.Enemies[1];
    await loaded.restore(engine.save());
    assert.equal(loaded.battle.nextEventPage(false), null, 'save giữ cờ một lần và cờ theo lượt');
    await loaded.battleAttack(1, 0);
    assert.equal(loaded.state.variableValue(6100), 1, 'tải save không chạy lại page đầu trận');
    assert.equal(loaded.state.variableValue(6101), 2);
    assert.equal(loaded.state.variableValue(6104), 2);
    await loaded.createInterpreter([command(331, [0, 1, 0, 6000, true])], 0).run();
    await loaded.battleAttack(1, 0);
    assert.equal(loaded.state.variableValue(6102), 1, 'page HP chạy khi qua ngưỡng');
    await loaded.battleAttack(1, 0);
    assert.equal(loaded.state.variableValue(6102), 1, 'page một lần không lặp dù HP vẫn thấp');
    loaded.battle.random = () => 0; await loaded.battleEscape(); assert.equal(loaded.state.scene, 'map');
    engine.battle.random = () => 0; await engine.battleEscape(); await running;

    const retarget = await boot();
    const retargetId = retarget.database.Troops.length;
    retarget.database.Troops.push({ id: retargetId, members: retarget.database.Troops[1].members.slice(0, 2), pages: [
        page({ turnValid: true, turnA: 1, turnB: 0 }, [command(333, [1, 0, 1])])
    ] });
    running = start(retarget, retargetId); await flush();
    await assert.rejects(retarget.battleAttack(1, 9999), /không hợp lệ/);
    assert.equal(retarget.battle.battle.turn, 0, 'lệnh sai không tiêu tốn lượt');
    const redirected = await retarget.battleAttack(1, 1);
    assert.equal(redirected.target, 0, 'đổi mục tiêu khi page đầu lượt đã hạ mục tiêu được chọn');
    retarget.battle.random = () => 0; await retarget.battleEscape(); await running;

    // Wait của troop chạy theo frame trong trận; wait bản đồ vẫn tạm dừng.
    const waiting = await boot();
    let mapWaitDone = false;
    const mapWait = waiting.screen.tween([], {}, 5).then(() => { mapWaitDone = true; });
    const waitingId = troop([page({ turnValid: true, turnA: 0, turnB: 0 }, [
        command(230, [5]), variable(6110)
    ])], waiting);
    running = start(waiting, waitingId); await flush();
    assert.equal(waiting.battle.battle.phase, 'events');
    await assert.rejects(waiting.battleAttack(1, 0), /Chưa đến lượt/);
    waiting.advanceRoutes(5); await flush();
    assert.equal(waiting.state.variableValue(6110), 1);
    assert.equal(waiting.battle.battle.phase, 'input'); assert.equal(mapWaitDone, false);
    waiting.battle.random = () => 0; await waiting.battleEscape(); await running;
    waiting.advanceRoutes(5); await mapWait; assert.equal(mapWaitDone, true);

    const abortPage = await boot();
    const abortId = troop([page({ turnEnding: true }, [
        command(340), command(230, [5]), command(121, [6140, 6140, 0])
    ])], abortPage);
    running = start(abortPage, abortId); await flush();
    const endingTurn = abortPage.battleAttack(1, 0); await flush();
    assert.equal(abortPage.state.scene, 'battle', 'lệnh 340 chưa kết thúc page đang chờ');
    assert.equal(abortPage.state.switchValue(6009), false, 'event map chưa được chạy tiếp sớm');
    abortPage.advanceRoutes(5); await endingTurn; await running;
    assert.equal(abortPage.state.switchValue(6140), true, 'dọn dẹp sau 340 chạy trước khi rời trận');
    assert.equal(abortPage.state.switchValue(6009), true);
    assert.equal(abortPage.battle.battle.result, 'escape');

    const guard = await boot(), sounds = [];
    const handlers = { effect: (code, p) => { if (code === 250) { sounds.push(p[0]); return true; } return false; },
        message: () => {}, choice: () => 0 };
    guard.state.setSwitch(18, true);
    running = start(guard, 1, handlers); await flush();
    assert.ok(guard.battle.enemy(0).states.includes(91));
    assert.equal(guard.battle.enemy(4).alive, false, 'Guard nhớ chân đã bị chặt ở lần gặp trước');
    assert.equal(sounds.length, 1); assert.match(guard.state.screen.gab.text, /guard/i);
    await guard.battleAttack(1, 1); await running;
    assert.equal(guard.battle.battle.result, 'victory', 'page HEAD DESTROYED hạ cả troop');
    assert.equal(guard.state.switchValue(23), true);
    assert.equal(guard.state.switchValue(6009), true);
    assert.equal(guard.state.scene, 'map');

    const broken = await boot();
    const brokenId = troop([page({ turnEnding: true }, [command(999)], 1)], broken);
    running = start(broken, brokenId);
    const failedEvent = assert.rejects(running, /Chưa hỗ trợ lệnh 999/); await flush();
    await assert.rejects(broken.battleAttack(1, 0), /Chưa hỗ trợ lệnh 999/); await failedEvent;
    assert.equal(broken.state.scene, 'map'); assert.equal(broken.state.switchValue(6009), false);
    const infiniteId = troop([page({ turnValid: true, turnA: 0, turnB: 0 }, [variable(6111)], 2)], broken);
    await assert.rejects(start(broken, infiniteId), /Sự kiện troop lặp vô hạn/);
    assert.equal(broken.state.scene, 'map');

    const cancelled = await boot(), controller = new AbortController();
    const cancelId = troop([page({ turnValid: true, turnA: 0, turnB: 0 }, [command(230, [60]), variable(6112)])], cancelled);
    running = start(cancelled, cancelId, {}, controller.signal);
    const aborted = assert.rejects(running, { name: 'AbortError' }); await flush();
    controller.abort(); await aborted; cancelled.advanceRoutes(60); await flush();
    assert.equal(cancelled.state.variableValue(6112), 0);
    assert.equal(cancelled.state.scene, 'map'); assert.equal(cancelled.battle.waiters.size, 0);
    console.log('ĐẠT: điều kiện/span/đầu-cuối lượt/save/wait/hủy/lỗi troop; Guard thật nhớ chân bị chặt và thắng khi hạ đầu.');
})().then(() => { clearTimeout(watchdog); clearInterval(ticker); }).catch(error => { clearTimeout(watchdog); clearInterval(ticker); console.error(error); process.exitCode = 1; });
