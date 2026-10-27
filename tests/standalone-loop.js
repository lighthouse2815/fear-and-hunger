'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const { displayPosition } = require('../game/engine/map-model');
const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
    JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
(async () => {
    let finishMap;
    const booting = new GameEngine({ dataStore: {
        loadDatabase: async () => ({ Actors: [], System: {}, Tilesets: [null, { flags: [16, 0] }] }),
        loadMap: () => new Promise(resolve => { finishMap = resolve; })
    } });
    const boot = booting.boot({ mapId: 1, x: 0, y: 0, party: [] });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(booting.state && !booting.map, 'state có thể được tạo trước khi map tải xong');
    assert.doesNotThrow(() => booting.advanceRoutes(1), 'frame trong lúc tải map không truy cập camera chưa có map');
    finishMap({ width: 1, height: 1, tilesetId: 1, data: [1, 0, 0, 0, 0, 0], events: [null] });
    await boot;
    for (const id of [157, 160, 185]) {
        const engine = new GameEngine({ dataStore: store, random: () => 0.5, onRouteEffect: () => true });
        await engine.boot({ mapId: id, x: 1, y: 1, direction: 6, party: [1, 3], alwaysDash: false });
        const map = engine.map;
        assert.equal(map.data.scrollType, 3); assert.ok(map.loopX() && map.loopY());
        const y = Array.from({ length: map.height }, (_, i) => i).find(i =>
            map.tilePassable(map.width - 1, i, 4) && map.tilePassable(0, i, 2) && !map.eventBlocks(0, i, -1) && !map.eventBlocks(map.width - 1, i, -1));
        const x = Array.from({ length: map.width }, (_, i) => i).find(i =>
            map.tilePassable(i, map.height - 1, 1) && map.tilePassable(i, 0, 8) && !map.eventBlocks(i, 0, -1));
        assert.notEqual(y, undefined); assert.notEqual(x, undefined);
        assert.equal(map.tileId(-1, y, 0), 0, 'API đọc tile ngoài bản đồ giữ hành vi cũ');
        assert.equal(map.tileId(map.roundX(-1), y, 0), map.tileId(map.width - 1, y, 0));
        assert.equal(map.screenX(map.width - 2, 0), -2, 'sprite lớn sát mép trái vẫn giữ phần tràn vào màn hình');
        assert.equal(map.deltaX(map.width * 2 + 1, 0), 1, 'khoảng cách vẫn đúng sau nhiều vòng');
        assert.equal(map.tileId(x, map.roundY(map.height), 0), map.tileId(x, 0, 0));
        assert.equal(map.isPassable(map.width - 1, y, 6), true);
        assert.equal(map.isPassable(x, map.height - 1, 2), true);
        engine.state.x = map.width - 1; engine.state.y = y;
        engine.resetCamera();
        const cameraBefore = engine.screen.screen.mapCamera.x;
        let follower = engine.state.followers()[0]; follower.x = map.width - 2; follower.y = y;
        assert.equal(engine.move(6), true); assert.equal(engine.state.x, 0);
        assert.equal(displayPosition(engine.state).x, -1, 'nội suy qua mép chỉ cách một ô');
        let view = map.viewport(engine.state, 816, 624);
        assert.equal(map.screenX(displayPosition(engine.state).x, view.startX), 8);
        engine.advanceRoutes(8); assert.equal(displayPosition(engine.state).x, -0.5);
        assert.equal(engine.screen.screen.mapCamera.x, cameraBefore + 0.5, 'camera và sương tiếp tục tiến qua mép');
        const snapshot = engine.save(); await engine.restore(snapshot);
        assert.equal(displayPosition(engine.state).x, -0.5, 'save giữa bước giữ nội suy');
        engine.advanceRoutes(8); assert.equal(displayPosition(engine.state).x, 0);
        assert.equal(engine.move(6), true); follower = engine.state.followers()[0];
        assert.equal(follower.x, 0); assert.equal(displayPosition(follower).x, -1, 'follower đi qua mép ngắn nhất');
        engine.advanceRoutes(16);
        engine.state.x = 0; engine.state.y = y; engine.resetCamera();
        assert.equal(engine.move(4), true); assert.equal(engine.state.x, map.width - 1);
        assert.equal(displayPosition(engine.state).x, map.width, 'nội suy chiều ngược cũng chỉ đi một ô');
        engine.advanceRoutes(16);
        engine.state.x = x; engine.state.y = map.height - 1;
        engine.resetCamera();
        assert.equal(engine.move(2), true); assert.equal(engine.state.y, 0);
        assert.equal(displayPosition(engine.state).y, -1); engine.advanceRoutes(16);
        engine.state.x = x; engine.state.y = 0; engine.resetCamera();
        assert.equal(engine.move(8), true); assert.equal(engine.state.y, map.height - 1);
        assert.equal(displayPosition(engine.state).y, map.height); engine.advanceRoutes(16);
        assert.equal(map.findDirection({ x: map.width - 1, y, through: true }, { x: 0, y }, 2), 6);
        const cameraX = engine.screen.screen.mapCamera.x;
        const scrolling = engine.createInterpreter([{ code: 204, parameters: [6, 3, 4, true] }], 0).run();
        await new Promise(resolve => setImmediate(resolve)); engine.advanceRoutes(48); await scrolling;
        assert.equal(engine.screen.screen.mapCamera.x, cameraX + 3, 'lệnh cuộn vượt mép thay vì dừng ở biên');
        engine.resetCamera();
        const commands = [{ code: 122, parameters: [7000, 7000, 0, 3, 5, -1, 3] }];
        await engine.createInterpreter(commands, 0).run();
        assert.equal(engine.state.variableValue(7000), 408, 'tọa độ màn hình dùng camera lặp');
    }
    const plain = new GameEngine({ dataStore: store });
    await plain.boot({ mapId: 74, x: 0, y: 0, party: [1] });
    assert.equal(plain.map.loopX(), false); assert.equal(plain.map.roundX(-1), -1);
    assert.equal(plain.map.isPassable(0, 0, 4), false, 'map thường vẫn chặn mép');
    const event = { id: 1, x: 0, y: 1, pages: [{ conditions: {}, trigger: 2, priorityType: 1, image: {},
        list: [{ code: 121, parameters: [7100, 7100, 0] }, { code: 0 }] }] };
    const data = { width: 3, height: 3, scrollType: 3, tilesetId: 1, data: Array(9).fill(1).concat(Array(45).fill(0)), events: [null, event] };
    const fixture = new GameEngine({ dataStore: { loadDatabase: async () => ({ Actors: [], System: {}, Tilesets: [null, { flags: [16, 0, 0x80] }] }), loadMap: async () => data } });
    await fixture.boot({ mapId: 1, x: 2, y: 1, direction: 6 });
    assert.equal(await fixture.step(6), false, 'event chắn ở mép đối diện');
    assert.equal(fixture.state.switchValue(7100), true, 'va chạm kích hoạt event bên kia mép');
    fixture.state.setSwitch(7100, false); await fixture.interact();
    assert.equal(fixture.state.switchValue(7100), true, 'tương tác nhận event chạm bên kia mép');
    fixture.map.eventById(1).x = 1; fixture.map.data.data[fixture.map.tileIndex(0, 1, 0)] = 2;
    fixture.state.setSwitch(7100, false); await fixture.interact();
    assert.equal(fixture.state.switchValue(7100), true, 'tương tác qua quầy ở mép bản đồ');
    fixture.state.through = true;
    const jump = fixture.movement.start(fixture.state, { list: [{ code: 14, parameters: [2, 0] }, { code: 0 }] });
    assert.equal(fixture.state.x, 1); assert.equal(displayPosition(fixture.state).x, -1, 'nhảy qua mép giữ điểm xuất phát gần đích');
    fixture.advanceRoutes(fixture.state.moveFrames); await jump.done;
    console.log('ĐẠT: ba map lặp qua mép X/Y, va chạm, nội suy, follower, camera, tọa độ màn hình và save.');
})().catch(error => { console.error(error); process.exitCode = 1; });
