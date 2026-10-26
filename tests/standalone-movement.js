'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { validateRoute } = require('../game/engine/movement-runtime');
const database = { Actors: require('../game/data/Actors.json'), Classes: require('../game/data/Classes.json'),
    Tilesets: [null, { flags: [16, 0] }], System: {} };

async function create() {
    const list = [{ code: 0 }];
    const events = [null, { id: 1, x: 5, y: 5, pages: [{ conditions: {}, directionFix: false,
        image: { characterName: '$guard1', characterIndex: 0, direction: 2, pattern: 1 },
        trigger: 0, priorityType: 1, through: false, moveSpeed: 4, moveFrequency: 3, list }] }];
    const data = { width: 12, height: 12, tilesetId: 1, events, data: [...Array(144).fill(1), ...Array(720).fill(0)] };
    const sounds = [];
    const engine = new GameEngine({ random: () => 0,
        dataStore: { loadDatabase: async () => database, loadMap: async () => data },
        onRouteEffect: (code, parameters) => sounds.push([code, parameters]) });
    await engine.boot({ mapId: 1, x: 8, y: 5, party: [1] });
    return { engine, sounds };
}
function pump(engine, limit = 2000) {
    for (let i = 0; i < limit && engine.movement.jobs.size; i++) engine.advanceRoutes(1);
    assert.equal(engine.movement.jobs.size, 0, 'route phải kết thúc trong thời gian dự kiến');
}
async function route(engine, commands, options = {}) {
    const done = engine.applyRoute([1, { list: commands.concat({ code: 0 }), wait: true, ...options }], { mapId: 1 });
    pump(engine);
    await done;
}

const watchdog = setTimeout(() => { throw new Error("Movement test chưa kết thúc"); }, 5000);
(async () => {
    const expectedMoves = { 1: [5, 6], 2: [4, 5], 3: [6, 5], 4: [5, 4], 5: [4, 6], 6: [6, 6],
        7: [4, 4], 8: [6, 4], 9: [5, 6], 10: [6, 5], 11: [4, 5], 12: [5, 6], 13: [5, 4], 14: [6, 3] };
    for (let code = 1; code <= 14; code++) {
        const { engine } = await create();
        await route(engine, [{ code, parameters: code === 14 ? [1, -2] : [] }]);
        const event = engine.map.eventById(1);
        assert.deepEqual([event.x, event.y], expectedMoves[code], 'route di chuyển ' + code);
        if (code === 13) assert.equal(event.direction, 2, 'bước lùi giữ hướng nhìn');
    }
    const facing = { 16: 2, 17: 4, 18: 6, 19: 8, 20: 4, 21: 6, 22: 8, 23: 4, 24: 2, 25: 6, 26: 4 };
    for (let code = 16; code <= 26; code++) {
        const { engine } = await create();
        await route(engine, [{ code }]);
        assert.equal(engine.map.eventById(1).direction, facing[code], 'route quay ' + code);
    }
    const { engine, sounds } = await create();
    const event = engine.map.eventById(1);
    await route(engine, [
        { code: 27, parameters: [12] }, { code: 28, parameters: [13] },
        { code: 29, parameters: [5] }, { code: 30, parameters: [4] },
        { code: 31 }, { code: 33 }, { code: 35 }, { code: 37 }, { code: 39 },
        { code: 41, parameters: ['$knight', 0] }, { code: 42, parameters: [120] }, { code: 43, parameters: [1] },
        { code: 44, parameters: [{ name: 'door', volume: 70, pitch: 100, pan: 0 }] },
        { code: 45, parameters: ['this._chaseRange = 5'] }
    ]);
    assert.equal(engine.state.switchValue(12), true);
    assert.equal(engine.state.switchValue(13), false);
    assert.deepEqual([event.moveSpeed, event.moveFrequency, event.characterName, event.opacity, event.blendMode], [5, 4, '$knight', 120, 1]);
    for (const key of ['walkAnime', 'stepAnime', 'directionFixed', 'through', 'transparent']) assert.equal(event[key], true);
    assert.equal(event.chaseRange, 5);
    assert.equal(sounds[0][0], 250);
    assert.equal(sounds[0][1][0].name, 'door');
    const snapshot = engine.save();
    await engine.restore(snapshot);
    const savedEvent = engine.map.eventById(1);
    assert.equal(savedEvent.opacity, 120);
    assert.equal(savedEvent.characterName, '$knight');
    await route(engine, [{ code: 32 }, { code: 34 }, { code: 36 }, { code: 38 }, { code: 40 }]);
    for (const key of ['walkAnime', 'stepAnime', 'directionFixed', 'through', 'transparent']) assert.equal(savedEvent[key], false);

    const waiting = engine.applyRoute([1, { wait: true, list: [
        { code: 15, parameters: [10] }, { code: 27, parameters: [30] }, { code: 0 }
    ] }], { mapId: 1 });
    engine.advanceRoutes(9);
    assert.equal(engine.state.switchValue(30), false);
    engine.advanceRoutes(1);
    await waiting;
    assert.equal(engine.state.switchValue(30), true);

    // Một route chờ có thể được hủy/thay và không tiếp tục ghi vào nhân vật cũ.
    const oldJob = engine.movement.start(savedEvent, { list: [{ code: 15, parameters: [100] }, { code: 0 }] });
    const newJob = engine.movement.start(savedEvent, { list: [{ code: 15, parameters: [2] }, { code: 0 }] });
    oldJob.cancel();
    assert.equal(engine.movement.jobs.get(savedEvent), newJob);
    pump(engine);
    await Promise.all([oldJob.done, newJob.done]);
    const repeated = engine.movement.start(savedEvent, { repeat: true, list: [{ code: 27, parameters: [40] }, { code: 0 }] });
    engine.advanceRoutes(100);
    assert.equal(engine.state.switchValue(40), true);
    assert.equal(engine.movement.jobs.size, 1);
    repeated.cancel();
    await repeated.done;

    // Lưu giữa hai bước: khôi phục thời gian chờ và không lặp bước đã đi.
    engine.applyRoute([-1, { wait: false, list: [{ code: 1 }, { code: 1 }, { code: 0 }] }], { mapId: 1 });
    assert.equal(engine.state.y, 6);
    engine.advanceRoutes(5);
    const midRoute = engine.save();
    await engine.restore(midRoute);
    assert.equal(engine.state.y, 6);
    engine.advanceRoutes(10);
    assert.equal(engine.state.y, 6);
    engine.advanceRoutes(1);
    assert.equal(engine.state.y, 7);
    pump(engine);

    // Thử lại lệnh khi va chạm; skippable bỏ qua ngay để không treo sự kiện.
    engine.state.x = 5; engine.state.y = 6;
    const blocked = engine.movement.start(engine.state, { list: [{ code: 4 }, { code: 0 }] });
    engine.advanceRoutes(10);
    assert.equal(engine.state.y, 6);
    engine.map.locateEvent(1, 4, 5);
    pump(engine);
    await blocked.done;
    assert.equal(engine.state.y, 5);
    engine.state.x = 4; engine.state.y = 6;
    const skipped = engine.movement.start(engine.state, { skippable: true, list: [{ code: 4 }, { code: 27, parameters: [41] }, { code: 0 }] });
    await skipped.done;
    assert.equal(engine.state.y, 6);
    assert.equal(engine.state.switchValue(41), true);
    assert.throws(() => validateRoute({ list: [{ code: 100 }] }), /movement route 100/);

    let routes = 0;
    function scan(value) {
        if (!value || typeof value !== 'object') return;
        if (value.code === 205) { validateRoute(value.parameters[1]); routes++; }
        if (value.moveRoute) { validateRoute(value.moveRoute); routes++; }
        Object.values(value).filter(v => v && typeof v === 'object').forEach(scan);
    }
    const dataRoot = path.join(__dirname, '..', 'game/data');
    for (const file of fs.readdirSync(dataRoot).filter(f => f.endsWith('.json'))) scan(JSON.parse(fs.readFileSync(path.join(dataRoot, file))));
    assert.ok(routes > 44000);
    console.log('ĐẠT: lệnh route 0–45, va chạm, chờ/lặp/hủy, save giữa route; quét ' + routes + ' route JSON.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
