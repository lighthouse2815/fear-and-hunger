'use strict';
const assert = require('node:assert/strict');
const { GameEngine } = require('../game/engine/game-engine');
const { EventScheduler } = require('../game/engine/event-scheduler');
const delay = () => new Promise(resolve => setImmediate(resolve));
const page = (moveType, list = [{ code: 0 }], extra = {}) => Object.assign({ moveType, moveSpeed: 6, moveFrequency: 5,
    directionFix: false, conditions: {}, priorityType: 1, trigger: 0, walkAnime: true, image: { direction: 6 },
    moveRoute: { list, repeat: true, skippable: false }, list: [{ code: 0 }] }, extra);
const event = pages => ({ id: 1, x: 2, y: 2, pages });
async function fixture(pages, walls = [], options = {}) {
    const data = [...Array(81).fill(1), ...Array(405).fill(0)];
    walls.forEach(([x, y]) => { data[y * 9 + x] = 2; });
    const engine = new GameEngine(Object.assign({ autonomousMovement: true, random: () => 0, dataStore: {
        loadDatabase: async () => ({ Actors: [], CommonEvents: [], System: {}, Tilesets: [null, { flags: [16, 0, 15] }] }),
        loadMap: async id => ({ width: 9, height: 9, tilesetId: 1, data, events: id === 1 ? [null, event(pages)] : [] })
    } }, options));
    await engine.boot({ mapId: 1, x: 5, y: 2, direction: 4, party: [] });
    return engine;
}
(async () => {
    const patrol = await fixture([page(3, [{ code: 3 }, { code: 1 }, { code: 2 }, { code: 4 }, { code: 0 }]),
        page(0, undefined, { conditions: { switch1Valid: true, switch1Id: 9 } })]);
    patrol.advanceRoutes(1);
    let npc = patrol.map.eventById(1);
    assert.deepEqual([npc.x, npc.y, npc.autonomous.index], [3, 2, 1]);
    patrol.messageRunning = true; patrol.advanceRoutes(10); patrol.messageRunning = false;
    assert.deepEqual([npc.x, npc.y, npc.autonomous.index], [3, 2, 1], 'hội thoại tạm dừng tuần tra');
    const forced = patrol.applyRoute([1, { list: [{ code: 3 }, { code: 15, parameters: [10] }, { code: 0 }] }], { mapId: 1, eventId: 1 });
    assert.equal(forced, true);
    for (let frame = 0; frame < 10; frame++) patrol.advanceRoutes(1);
    assert.equal(npc.x, 4);
    assert.equal(npc.autonomous.index, 1, 'route cưỡng bức giữ tiến trình tuần tra');
    for (let frame = 0; frame < 8; frame++) patrol.advanceRoutes(1);
    const snapshot = patrol.save();
    patrol.advanceRoutes(4); const expected = [npc.x, npc.y, npc.autonomous.index];
    await patrol.restore(snapshot); patrol.advanceRoutes(4); npc = patrol.map.eventById(1);
    assert.deepEqual([npc.x, npc.y, npc.autonomous.index], expected, 'lưu giữa route tiếp tục đúng lệnh');
    patrol.state.setSwitch(9, true); patrol.advanceRoutes(1);
    assert.equal(npc.chaseRange, 0);
    const stopped = [npc.x, npc.y]; patrol.advanceRoutes(100);
    assert.deepEqual([npc.x, npc.y], stopped, 'đổi page dừng route cũ');

    const random = await fixture([page(1)]);
    random.advanceRoutes(1); assert.equal(random.map.eventById(1).y, 3);
    const blocked = await fixture([page(1)], [[2, 3]]);
    blocked.advanceRoutes(1); assert.equal(blocked.map.eventById(1).y, 2);

    const touching = await fixture([page(2, undefined, { trigger: 2, list: [
        { code: 122, parameters: [60, 60, 1, 0, 1] }, { code: 230, parameters: [5] }, { code: 123, parameters: ['A', 0] }
    ] }), page(0, undefined, { conditions: { selfSwitchValid: true, selfSwitchCh: 'A' } })]);
    const errors = [], scheduler = new EventScheduler(touching, {}, error => errors.push(error));
    for (let frame = 0; frame < 30; frame++) { scheduler.tick(); touching.advanceRoutes(1); await delay(); }
    assert.equal(touching.state.variableValue(60), 1, 'quái tới cạnh người chơi kích hoạt một sự kiện chạm');
    assert.deepEqual([touching.state.x, touching.state.y], [5, 2]);
    assert.deepEqual([touching.map.eventById(1).x, touching.map.eventById(1).y], [4, 2]);
    assert.equal(errors.length, 0); scheduler.stop();

    const sounds = [];
    const chase = await fixture([page(3, [{ code: 45, parameters: ['this._chaseRange = 6;\nthis._seePlayer = false;'] }, { code: 0 }])], [[3, 2]],
        { onRouteEffect: (code, parameters) => { if (parameters[0].name !== 'footstep_tile') sounds.push(parameters[0].name); } });
    chase.advanceRoutes(1); chase.advanceRoutes(1); npc = chase.map.eventById(1);
    assert.equal(npc.autonomous.chasing, true);
    assert.deepEqual([npc.x, npc.y], [2, 3], 'tìm đường vòng qua tường');
    assert.equal(npc.balloon.id, 1); assert.deepEqual(sounds, ['horror_chord']);
    chase.advanceRoutes(4); assert.equal(sounds.length, 1, 'không phát cảnh báo mỗi bước');
    chase.state.x = 40; chase.state.y = 40;
    for (let frame = 0; frame < 600; frame++) chase.advanceRoutes(1);
    assert.equal(npc.autonomous.chasing, false);
    assert.deepEqual([npc.x, npc.y], [2, 2], 'mất dấu, chờ và quay lại điểm tuần tra');

    const sight = await fixture([page(3, [{ code: 45, parameters: ['this._chaseRange = 6;\nthis._alertSound = "";'] }, { code: 0 }])]);
    sight.map.eventById(1).direction = 4;
    sight.advanceRoutes(1); sight.advanceRoutes(1);
    assert.equal(sight.map.eventById(1).autonomous.chasing, false, 'phải quay mặt về người chơi khi seePlayer bật');
    sight.map.eventById(1).direction = 6; sight.advanceRoutes(1);
    assert.equal(sight.map.eventById(1).autonomous.chasing, true);

    const balloon = await fixture([page(0)]);
    let finished = false;
    const balloonEvent = balloon.createInterpreter([{ code: 213, parameters: [-1, 2, true] }], 1).run().then(() => { finished = true; });
    await delay(); balloon.advanceRoutes(75); await delay(); assert.equal(finished, false);
    balloon.advanceRoutes(1); await balloonEvent; assert.equal(balloon.state.balloon.remaining, 0);
    balloon.showBalloon(balloon.state, 1); balloon.advanceRoutes(37);
    await balloon.restore(balloon.save()); assert.equal(balloon.state.balloon.remaining, 39);

    const invalid = await fixture([page(3, [{ code: 999 }])]);
    assert.throws(() => invalid.advanceRoutes(1), /Chưa hỗ trợ lệnh movement route 999/);
    assert.doesNotThrow(() => invalid.advanceRoutes(1), 'không lặp lỗi route mỗi frame');
    console.log('ĐẠT: tuần tra/ngẫu nhiên/tiếp cận, đuổi vòng tường/quay về, chạm, ưu tiên route, page/save và balloon.');
})().catch(error => { console.error(error); process.exitCode = 1; });
