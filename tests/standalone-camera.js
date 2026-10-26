'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store });
    await engine.boot({ mapId: 74, x: 15, y: 15, direction: 8, party: [1], through: true });
    const view = () => engine.map.viewport(engine.state, engine.width, engine.height);
    const run = parameters => engine.createInterpreter([{ code: 204, parameters }], 1).run();
    assert.deepEqual(view(), { startX: 7, startY: 9 });
    const player = [engine.state.x, engine.state.y];
    await run([8, 4, 3]);
    assert.deepEqual(view(), { startX: 7, startY: 9 }, 'lệnh không chờ chỉ khởi động camera');
    engine.advanceRoutes(16);
    assert.equal(view().startY, 8.5, 'camera cuộn mượt theo frame');
    assert.equal(engine.createInterpreter([], 1).gameDataOperand(5, -1, 4), 354,
        'tọa độ màn hình dùng camera hiện tại');
    const snapshot = engine.save(); await engine.restore(snapshot);
    assert.equal(view().startY, 8.5);
    engine.advanceRoutes(112);
    assert.equal(view().startY, 5, 'tiếp tục cuộn sau tải save');
    assert.deepEqual([engine.state.x, engine.state.y], player, 'cuộn không dịch chuyển nhân vật');
    assert.equal(engine.state.vehicleBgm, null, '204 không đổi nhạc phương tiện');

    let done = false;
    const waiting = run([2, 4, 4, true]).then(() => { done = true; });
    await flush(); assert.equal(done, false);
    engine.advanceRoutes(63); await flush(); assert.equal(done, false);
    engine.advanceRoutes(1); await waiting;
    assert.equal(view().startY, 9);
    await run([8, 4, 3]);
    const second = run([2, 4, 4]);
    await flush(); engine.advanceRoutes(128); await second;
    assert.equal(view().startY, 5, 'cuộn sau bắt đầu khi cuộn trước xong');
    engine.advanceRoutes(64); assert.equal(view().startY, 9);

    await run([4, 100, 6]); engine.advanceRoutes(9999);
    assert.equal(view().startX, 0, 'dừng tại mép map');
    await run([6, 100, 6]); engine.advanceRoutes(9999);
    assert.equal(view().startX, 11);
    engine.move(6);
    assert.equal(view().startX, 11, 'camera không vượt biên khi theo nhân vật');
    await run([8, 4, 3]); engine.advanceRoutes(128);
    engine.move(2);
    assert.equal(view().startY, 6, 'camera theo nhân vật khi đi qua tâm màn hình');
    await assert.rejects(run([1, 4, 3]), /Tham số cuộn/);
    await assert.rejects(run([8, -1, 3]), /Tham số cuộn/);
    await assert.rejects(run([8, 1, 0]), /Tham số cuộn/);
    const interrupted = run([2, 4, 3, true]); await flush();
    await engine.loadMap(1, { x: 1, y: 1, direction: 2 }); await interrupted;
    assert.equal(engine.screen.screen.mapCamera, undefined, 'chuyển map bỏ camera cũ và kết thúc chờ');
    assert.equal(engine.screen.screen.tweens.some(track => track.path[0] === 'mapCamera'), false);

    let count = 0;
    for (const file of (await fs.readdir(path.join(__dirname, '../game/data'))).filter(file => /^Map\d+\.json$/.test(file))) {
        const map = JSON.parse(await fs.readFile(path.join(__dirname, '../game/data', file), 'utf8'));
        for (const event of map.events.filter(Boolean)) for (const page of event.pages) for (const cmd of page.list) {
            if (cmd.code !== 204) continue;
            await engine.loadMap(Number(file.slice(3, -5)), { x: 0, y: 0 });
            await engine.createInterpreter([cmd], event.id).run();
            engine.advanceRoutes(99999); count++;
        }
    }
    assert.equal(count, 27);
    console.log('ĐẠT: camera cuộn mượt/chờ/biên/theo nhân vật/save/chuyển map và ' + count + ' lệnh 204 thật.');
})().catch(error => { console.error(error); process.exitCode = 1; });
