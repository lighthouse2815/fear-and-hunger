'use strict';
const assert = require('node:assert/strict');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const { GameState } = require('../game/engine/game-state');
const { GameEngine } = require('../game/engine/game-engine');
const { executeScript } = require('../game/engine/script-runtime');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameDataStore } = require('../game/engine/data-store');
const { EventScheduler } = require('../game/engine/event-scheduler');
const delay = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const state = new GameState();
    const run = commands => new EventInterpreter({ state, commands }).run();
    await run([{ code: 216, parameters: [0] }, { code: 217, parameters: [] }]);
    assert.equal(state.followersVisible, false); assert.equal(state.followersGathering, true);
    await run([{ code: 216, parameters: [1] }]);
    assert.equal(state.followersVisible, true);
    const restored = new GameState(state.toJSON());
    assert.equal(restored.followersVisible, true); assert.equal(restored.followersGathering, true);
    const guestState = new GameState({ actors: { 3: { id: 3 } } }, { Actors: { 3: { id: 3, classId: 1 } }, Classes: { 1: {} } });
    assert.equal(guestState.addGuestActor(3), true); assert.equal(guestState.hasGuestActor(3), true);
    assert.equal(guestState.addGuestActor(3), false); assert.equal(guestState.removeGuestActor(3), true);
    assert.equal(guestState.hasGuestActor(3), false);
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const database = await store.loadDatabase();
    const engine = new GameEngine({ dataStore: {
        loadDatabase: async () => Object.assign({}, database, { Tilesets: [null, { flags: [16, 0] }] }),
        loadMap: async () => ({ width: 8, height: 8, tilesetId: 1,
            data: Array(64).fill(1).concat(Array(320).fill(0)), events: [null, {
                id: 1, x: 4, y: 1, pages: [{ conditions: {}, trigger: 2, priorityType: 1, through: false, list: [] }]
            }] })
    } });
    await engine.boot({ mapId: 1, x: 1, y: 1, party: [1, 2] });
    executeScript('$gameParty.addGuestActor(3);', { state: engine.state });
    assert.equal(engine.createInterpreter([], 0).evaluateCondition([12, '$gameParty.hasGuestActor(3)']), true);
    engine.state.followers();
    for (const direction of [6, 6, 2, 2]) assert.equal(engine.move(direction), true);
    const coordinates = () => engine.state.followers().map(({ id, x, y, direction }) => [id, x, y, direction]);
    assert.deepEqual(coordinates(), [[2, 3, 2, 2], [3, 3, 1, 6]], 'đồng đội đi theo góc rẽ, không được dời theo hướng nhìn');
    engine.move(4);
    assert.equal(engine.moveCharacter(engine.map.eventById(1), 4), true, 'ô guest đã rời không còn va chạm');
    await engine.restore(engine.save());
    assert.equal(engine.state.hasGuestActor(3), true);
    assert.deepEqual(coordinates().map(entry => entry.slice(0, 3)), [[2, 3, 3], [3, 3, 2]], 'save giữ từng vị trí');
    const event = engine.map.eventById(1);
    event.x = 4; event.y = 2;
    assert.equal(engine.moveCharacter(event, 4), false, 'sự kiện không xuyên follower đang hiện');
    assert.equal(engine.pendingTouchEvents.length, 0, 'follower không kích hoạt chạm thay người chơi');
    const guardMap = await store.loadMap(1);
    const touchComment = guardMap.events[9].pages[0].list.find(command => command.code === 108 && command.parameters[0].includes('<follower touch>'));
    assert.ok(touchComment, 'dùng thẻ follower touch từ Guard thật Map001');
    engine.map.eventPage(event).list = [touchComment, { code: 121, parameters: [903, 903, 0] }];
    assert.equal(engine.moveCharacter(event, 4), false);
    assert.equal(engine.moveCharacter(event, 4), false);
    assert.equal(engine.pendingTouchEvents.length, 1, 'tag chạm follower chỉ xếp sự kiện một lần');
    const scheduler = new EventScheduler(engine);
    scheduler.tick(); await delay(); scheduler.stop(); await delay();
    assert.equal(engine.state.switchValue(903), true, 'scheduler thực thi sự kiện chạm follower');
    await engine.createInterpreter([{ code: 216, parameters: [0] }], 0).run();
    assert.equal(engine.moveCharacter(event, 4), true, 'follower ẩn không chặn sự kiện');
    assert.equal(engine.pendingTouchEvents.length, 0, 'follower ẩn không kích hoạt tag chạm');
    await engine.createInterpreter([{ code: 217, parameters: [] }], 0).run();
    assert.equal(engine.state.followersGathering, false, 'không chờ follower đang ẩn');
    await engine.createInterpreter([{ code: 216, parameters: [1] }], 0).run();
    const gather = engine.createInterpreter([{ code: 217, parameters: [] }, { code: 121, parameters: [7, 7, 0] }], 0).run();
    await delay();
    assert.equal(engine.state.followersGathering, true);
    assert.equal(engine.move(6), false, 'khóa người chơi khi đang tập hợp');
    assert.equal(engine.state.switchValue(7), false, 'lệnh sau phải đợi tập hợp');
    const gatheringSave = engine.save();
    for (let frame = 0; frame < 100 && engine.state.followersGathering; frame++) { engine.advanceRoutes(1); await delay(); }
    await gather;
    assert.equal(engine.state.switchValue(7), true);
    assert.ok(engine.state.followers().every(entry => entry.x === engine.state.x && entry.y === engine.state.y));
    await engine.restore(gatheringSave);
    for (let frame = 0; frame < 100 && engine.state.followersGathering; frame++) engine.advanceRoutes(1);
    assert.equal(engine.state.followersGathering, false, 'tập hợp đang dở tiếp tục sau tải save');
    await engine.loadMap(2, { x: 6, y: 6, direction: 8 });
    assert.ok(engine.state.followers().every(entry => entry.x === 6 && entry.y === 6 && entry.direction === 8));
    engine.state.addActor(3);
    assert.equal(engine.state.hasGuestActor(3), false, 'vào đội chính không giữ guest trùng');
    engine.state.removeActor(2);
    assert.deepEqual(engine.state.followers().map(entry => entry.id), [3]);
    [4, 5, 6].forEach(id => engine.state.addActor(id));
    engine.state.addGuestActor(7);
    assert.deepEqual(engine.state.followers().map(entry => entry.id), [3, 4, 5, 7], 'chỉ ba đồng đội tham chiến và guest được vẽ');
    console.log('ĐẠT: follower/guest đi theo góc rẽ, va chạm/ẩn, 217 chờ tập hợp, chuyển map và save vị trí.');
})().catch(error => { console.error(error); process.exitCode = 1; });
