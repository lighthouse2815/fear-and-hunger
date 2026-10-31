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

    const timed = await boot();
    const timedId = troop([page({ turnValid: true, turnA: 0, turnB: 0 }, [
        command(230, [120]), command(121, [6098, 6098, 0])
    ])], timed);
    timed.state.timer = { active: true, frames: 60 };
    const timedEvent = timed.createInterpreter([
        command(301, [0, timedId, false, true]),
        command(601, [], 0), command(121, [6095, 6095, 0], 1),
        command(602, [], 0), command(121, [6096, 6096, 0], 1),
        command(603, [], 0), command(121, [6097, 6097, 0], 1), command(604, [], 0)
    ], 1).run();
    await timedEvent;
    assert.equal(timed.state.timer.frames, 0);
    assert.equal(timed.state.switchValue(6098), true, 'hết giờ chờ trang troop thực sự hoàn tất');
    assert.equal(timed.state.switchValue(6096), true, 'trận không cho thoát vẫn trả nhánh thoát khi hết giờ');
    assert.equal(timed.state.switchValue(6095), false);
    assert.equal(timed.state.switchValue(6097), false);
    assert.equal(timed.state.scene, 'map');

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

    const coinGuard = await boot();
    coinGuard.battle.setup(1, true, true); coinGuard.state.scene = 'battle'; coinGuard.state.setSwitch(16, true); coinGuard.random = () => 0.1;
    let coinChoices = 0, dodgeMessage = '';
    await coinGuard.createInterpreter(coinGuard.database.Troops[1].pages[11].list, 0, {
        choice: () => { if (++coinChoices > 1) throw new Error('Tung xu bị lặp sau khi chọn đúng.'); return 1; },
        afterCommand: () => { if (coinGuard.state.screen.gab) dodgeMessage = coinGuard.state.screen.gab.text; },
        effect: () => true
    }).run();
    assert.equal(coinChoices, 1, 'chọn đúng TAILS chỉ hỏi một lần');
    assert.equal(coinGuard.state.switchValue(16), false, 'nhánh né dọn điều kiện của sự kiện');
    assert.match(dodgeMessage, /evading its grasp/i);

    const guard = await boot(), sounds = [];
    const handlers = { effect: (code, p) => { if (code === 250) { sounds.push(p[0]); return true; } return false; },
        message: () => {}, choice: () => 0 };
    guard.state.setSwitch(18, true);
    running = start(guard, 1, handlers); await flush();
    assert.ok(guard.battle.enemy(0).states.includes(91));
    assert.equal(guard.battle.enemy(4).alive, false, 'Guard nhớ chân đã bị chặt ở lần gặp trước');
    assert.equal(sounds.length, 1); assert.match(guard.state.screen.gab.text, /guard/i);
    for (let i=0;i<100 && guard.battle.battle.phase!=='input';i++) { guard.advanceRoutes(12);await flush(); }
    assert.equal(guard.battle.battle.phase,'input','đợi hiệu ứng chân đã chặt xong trước khi nhập lệnh');
    await guard.battleAttack(1, 1); await running;
    assert.equal(guard.battle.battle.result, 'victory', 'page HEAD DESTROYED hạ cả troop');
    assert.equal(guard.state.switchValue(23), true);
    assert.equal(guard.state.switchValue(6009), true);
    assert.equal(guard.state.scene, 'map');

    // EndPhaseTriggers phải xử lý cả các page vừa được mở bởi page trước,
    // dù troop hoặc party đã bị hạ. Chỉ chốt kết quả khi không còn page hợp lệ.
    const ending = await boot(); let finishMessage;
    const messageDone = new Promise(resolve => { finishMessage = resolve; });
    ending.state.setSwitch(6150, true);
    const endingItems = ending.state.itemCount('items', 8);
    const endingId = troop([
        page({ switchValid: true, switchId: 6150 }, [command(331, [-1, 1, 0, 99999, true]), variable(6150)]),
        page({ enemyValid: true, enemyIndex: 0, enemyHp: 0 }, [command(101, ['', 0, 0, 2]),
            command(401, ['Sự kiện sau khi quái bị hạ']), command(126, [8, 0, 0, 1]), variable(6151)]),
        page({ enemyValid: true, enemyIndex: 0, enemyHp: 0 }, [variable(6152)])
    ], ending);
    running = start(ending, endingId, { message: () => messageDone }); await flush();
    assert.equal(ending.battle.battle.result, null, 'chưa chốt thắng trước thoại của page 0 HP');
    assert.equal(ending.state.scene, 'battle'); assert.equal(ending.state.switchValue(6009), false);
    assert.equal(ending.state.itemCount('items', 8), endingItems);
    await assert.rejects(ending.battleAttack(1, 0), /Chưa đến lượt/);
    finishMessage(); await running;
    assert.equal(ending.battle.battle.result, 'victory'); assert.equal(ending.state.variableValue(6150), 1);
    assert.equal(ending.state.variableValue(6151), 1); assert.equal(ending.state.variableValue(6152), 1);
    assert.equal(ending.state.itemCount('items', 8), endingItems + 1, 'phần thưởng sự kiện trước khi trả kết quả trận');
    assert.equal(ending.state.switchValue(6009), true); assert.equal(ending.state.scene, 'map');
    await ending.restore(ending.save());
    assert.equal(ending.state.itemCount('items', 8), endingItems + 1); assert.equal(ending.state.variableValue(6151), 1, 'save không phát thưởng lại');

    const revival = await boot(); revival.state.setSwitch(6153, true);
    const revivalId = troop([
        page({ switchValid: true, switchId: 6153 }, [command(331, [-1, 1, 0, 99999, true])]),
        page({ enemyValid: true, enemyIndex: 0, enemyHp: 0 }, [command(334, [0]), variable(6153)])
    ], revival);
    running = start(revival, revivalId); await flush();
    assert.equal(revival.battle.battle.result, null, 'hồi sinh quái ở page cuối ngăn chốt thắng');
    for (let i=0;i<100 && revival.battle.battle.phase!=='input';i++) { revival.advanceRoutes(4);await flush(); }
    assert.equal(revival.battle.enemy(0).hp, revival.battle.enemy(0).mhp); assert.equal(revival.battle.battle.phase, 'input');
    assert.equal(revival.state.variableValue(6153), 1); revival.battle.random = () => 0;
    await revival.battleEscape(); await running;

    const rescue = await boot(); rescue.state.setSwitch(6154, true);
    const rescueId = troop([
        page({ switchValid: true, switchId: 6154 }, [command(311, [0, 1, 1, 0, 99999, true])]),
        page({ actorValid: true, actorId: 1, actorHp: 0 }, [command(314, [0, 1]), variable(6154)])
    ], rescue);
    running = start(rescue, rescueId); await flush();
    assert.equal(rescue.battle.battle.result, null, 'page hồi phục đội ngăn chốt thua');
    assert.equal(rescue.state.actor(1).hp, rescue.state.actorParam(1, 0)); assert.equal(rescue.state.variableValue(6154), 1);
    rescue.battle.random = () => 0; await rescue.battleEscape(); await running;

    const tie = await boot(); tie.state.setSwitch(6155, true);
    const tieId = troop([page({ switchValid: true, switchId: 6155 }, [
        command(311, [0, 1, 1, 0, 99999, true]), command(331, [-1, 1, 0, 99999, true])
    ])], tie);
    await start(tie, tieId); assert.equal(tie.battle.battle.result, 'defeat-continue', 'hai phe cùng bị hạ ưu tiên thua');

    const butterfly = await boot();
    running = start(butterfly, 9, handlers); await flush();
    butterfly.battle.handleEffect(333, [1, 0, 1]); await butterfly.runBattlePages(false, handlers); await running;
    assert.equal(butterfly.battle.battle.result, 'victory');
    assert.equal(butterfly.battle.battle.eventFlags.turns[5], butterfly.battle.battle.turn, 'Butterfly chạy page HEAD DESTROYED thật');
    assert.ok(butterfly.battle.battle.eventFlags.once[9], 'page BODY DESTROYED thật vẫn chạy sau khi head page hạ cả troop');
    assert.equal(butterfly.state.switchValue(737), true); assert.equal(butterfly.state.switchValue(230), true);

    const endError = await boot(); endError.state.setSwitch(6156, true);
    const endErrorId = troop([
        page({ switchValid: true, switchId: 6156 }, [command(331, [-1, 1, 0, 99999, true])]),
        page({ enemyValid: true, enemyIndex: 0, enemyHp: 0 }, [command(999)])
    ], endError);
    await assert.rejects(start(endError, endErrorId), /Chưa hỗ trợ lệnh 999/);
    assert.equal(endError.battle.battle.result, 'abort'); assert.equal(endError.state.switchValue(6009), false);

    const endCancel = await boot(), endController = new AbortController(); endCancel.state.setSwitch(6157, true);
    const endCancelId = troop([
        page({ switchValid: true, switchId: 6157 }, [command(331, [-1, 1, 0, 99999, true])]),
        page({ enemyValid: true, enemyIndex: 0, enemyHp: 0 }, [command(230, [600]), variable(6157)])
    ], endCancel);
    running = start(endCancel, endCancelId, {}, endController.signal);
    const endAborted = assert.rejects(running, { name: 'AbortError' }); await flush();
    assert.equal(endCancel.battle.battle.result, null); endController.abort(); await endAborted;
    endCancel.advanceRoutes(600); await flush();
    assert.equal(endCancel.state.variableValue(6157), 0); assert.equal(endCancel.state.switchValue(6009), false);
    assert.equal(endCancel.state.scene, 'map'); assert.equal(endCancel.battle.waiters.size, 0);

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
    assert.ok(engine.database.Enemies.filter(Boolean).every(enemy => enemy.exp === 0 && enemy.gold === 0 &&
        enemy.dropItems.every(drop => drop.kind === 0)), 'dữ liệu thật không cấp phần thưởng tự động ngoài sự kiện');
    console.log('ĐẠT: điều kiện/span/lượt/save/wait/hủy/lỗi; EndPhaseTriggers hết chuỗi page trước thắng/thua, hồi sinh/phần thưởng/hai phe bị hạ và Guard/Butterfly thật.');
})().then(() => { clearTimeout(watchdog); clearInterval(ticker); }).catch(error => { clearTimeout(watchdog); clearInterval(ticker); console.error(error); process.exitCode = 1; });
