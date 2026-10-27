'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');

const gameRoot = path.join(__dirname, '..', 'game');
async function fetchFromGame(relativeUrl) {
    const pathname = new URL(relativeUrl, 'http://standalone.test/').pathname;
    try {
        const value = JSON.parse(await fs.readFile(path.join(gameRoot, pathname.replace(/^\/+/, '')), 'utf8'));
        return { ok: true, status: 200, json: async () => value };
    } catch (error) {
        if (error.code === 'ENOENT') return { ok: false, status: 404, json: async () => ({}) };
        throw error;
    }
}

(async () => {
    const engine = new GameEngine({ dataStore: new (require('../game/engine/data-store').GameDataStore)({ fetchImpl: fetchFromGame }), random: () => 0 });
    await engine.boot({ mapId: 74, x: 1, y: 0, direction: 2, party: [] });
    assert.equal(engine.map.id, 74);
    assert.equal(engine.state.mapId, 74);
    assert.equal(typeof engine.map.tileId(8, 7, 0), 'number');

    const initial = engine.save();
    const moved = [2, 4, 6, 8].some(direction => engine.move(direction));
    assert.equal(moved, true, 'engine phải di chuyển được từ ô khởi tạo');
    await engine.restore(initial);
    assert.deepEqual(engine.save(), initial);

    const messages = [];
    await engine.runEvent(39, { message: text => messages.push(text) });
    assert.equal(messages.length, 2, 'cả event map và common event phải hiển thị hội thoại');
    assert.match(messages[1], /Eggs/);
    assert.equal(engine.state.itemCount('items', 15), 2, 'thùng phải cấp vật phẩm từ common event 52');
    assert.equal(engine.state.selfSwitchValue(74, 39, 'A'), true);
    await engine.runEvent(39, { message: text => messages.push(text) });
    assert.equal(messages.at(-1), 'Nothing left here.');
    assert.equal(engine.state.itemCount('items', 15), 2, 'thùng đã mở không được cấp lại vật phẩm');
    assert.equal(engine.state.mapId, 74);
    await engine.restore(Object.assign({}, initial, { x: 8, y: 8, direction: 8 }));
    assert.equal(engine.move(8), false, 'không đi xuyên qua thùng đồ');
    assert.equal(engine.state.direction, 8, 'vẫn quay mặt khi bước đi bị chặn');
    let resume, shown = 0;
    const interaction = engine.interact({ message: () => {
        shown += 1;
        if (shown === 1) return new Promise(resolve => { resume = resolve; });
    } });
    assert.equal(engine.eventRunning, true);
    assert.equal(engine.move(2), false, 'chờ hội thoại xong mới được di chuyển');
    await assert.rejects(engine.runEvent(39), /sự kiện khác đang chạy/);
    resume();
    await interaction;
    assert.equal(engine.eventRunning, false);
    assert.equal(engine.state.itemCount('items', 15), 2);
    await engine.restore({ mapId: 74, x: 15, y: 5, direction: 8, directionFixed: true,
        party: [1], switches: { 246: true, 3480: true }, variables: { 121: 1 } });
    const originalEvent = Object.assign({}, engine.map.data.events[102]);
    const enterDoor = engine.step(8); engine.advanceRoutes(engine.state.moveFrames); await enterDoor;
    assert.equal(engine.state.mapId, 1, 'bước vào cửa thật phải chuyển map');
    assert.equal(engine.map.id, 1);
    assert.deepEqual([engine.state.x, engine.state.y, engine.state.direction], [27, 68, 8]);
    assert.equal(engine.state.directionFixed, false, 'Room_CHANGE bỏ khóa hướng bằng route 36');
    assert.equal(engine.state.variableValue(30), 100, 'Room_CHANGE đọc MP thật');
    assert.equal(engine.state.switchValue(775), true, 'các công tắc trong common event phải thực thi');
    const leaveDoor = engine.step(2); engine.advanceRoutes(engine.state.moveFrames); await leaveDoor;
    assert.equal(engine.state.mapId, 74);
    assert.deepEqual([engine.state.x, engine.state.y], [15, 5]);
    assert.deepEqual([engine.map.eventById(102).x, engine.map.eventById(102).y], [14, 25]);
    assert.equal(engine.map.data.events[102].x, originalEvent.x, 'không ghi vị trí runtime vào JSON được cache');
    const afterDoor = engine.save();
    await engine.restore(afterDoor);
    assert.deepEqual([engine.map.eventById(102).x, engine.map.eventById(102).y], [14, 25], 'save giữ vị trí quái');
    const beforeBadTransfer = engine.save(), beforeMap = engine.map;
    await assert.rejects(engine.loadMap(999, { x: 0, y: 0 }), /Map999/);
    await assert.rejects(engine.loadMap(1, { x: -1, y: 0 }), /Đích chuyển bản đồ/);
    await assert.rejects(engine.restore(Object.assign({}, beforeBadTransfer, { mapId: 999 })), /Map999/);
    await assert.rejects(engine.restore(Object.assign({}, beforeBadTransfer, { x: -1 })), /Vị trí trong save/);
    assert.deepEqual(engine.save(), beforeBadTransfer);
    assert.equal(engine.map, beforeMap, 'lỗi tải hoặc tọa độ không được làm map/state lệch nhau');
    await engine.restore({ mapId: 51, x: 36, y: 63, direction: 6, party: [1] });
    assert.deepEqual(engine.map.eventPage(engine.map.eventById(6)).list.map(command => command.code), [0], 'event dưới chân của cửa là trang rỗng thật');
    const doorMessages = [];
    const leave = await engine.interact({ message: text => doorMessages.push(text), choice: () => 1 });
    assert.match(doorMessages[0], /door seems to be open/, 'bỏ trang rỗng dưới chân để mở event cửa phía trước');
    assert.equal(leave.choices[0].selected, 1); assert.equal(engine.state.switchValue(22), false, 'Leave không mở cửa');
    engine.onRouteEffect = () => true;
    let opened = false;
    const opening = engine.interact({ message: () => {}, choice: () => 0 }).then(() => { opened = true; });
    for (let frame = 0; frame < 60 && !opened; frame++) { engine.advanceRoutes(1); await new Promise(resolve => setImmediate(resolve)); }
    await opening;
    assert.equal(engine.state.switchValue(22), true, 'Open hoàn tất route và mở cả hai cánh cửa thật');
    await engine.restore({ mapId: 1, x: 16, y: 63, direction: 4, party: [1] });
    assert.equal(engine.map.isCounter(15, 63), true, 'ô trước cửa Map001 dùng cờ quầy thật');
    const counterMessages = [];
    const counterDoor = await engine.interact({ message: text => counterMessages.push(text), choice: () => 3 });
    assert.match(counterMessages[0], /faint sound/, 'event cửa thật phía sau quầy nhận tương tác');
    assert.equal(counterDoor.choices[0].selected, 3);
    assert.deepEqual([engine.state.x, engine.state.y], [16, 63]);
    console.log('ĐẠT: game engine độc lập boot, di chuyển, chạy event và save/restore.');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
