'use strict';
const assert = require('node:assert/strict');
const { GameEngine } = require('../game/engine/game-engine');
const { EventScheduler } = require('../game/engine/event-scheduler');
const delay = () => new Promise(resolve => setImmediate(resolve));
const page = (trigger, list, conditions = {}) => ({ trigger, list, conditions, image: {}, priorityType: 0 });
async function fixture(events, commonEvents = []) {
    const data = { width: 3, height: 3, data: [...Array(9).fill(1), ...Array(45).fill(0)], events, tilesetId: 1 };
    const engine = new GameEngine({ dataStore: {
        loadDatabase: async () => ({ Actors: [], System: {}, CommonEvents: commonEvents, Tilesets: [null, { flags: [16, 0] }] }),
        loadMap: async id => id === 1 ? data : Object.assign({}, data, { events: [] })
    } });
    await engine.boot({ mapId: 1, x: 0, y: 0 });
    return engine;
}
(async () => {
    const engine = await fixture([null,
        { id: 1, x: 0, y: 1, pages: [page(3, [
            { code: 122, parameters: [1, 1, 1, 0, 1] }, { code: 230, parameters: [3] }, { code: 123, parameters: ['A', 0] }
        ]), page(0, [{ code: 0 }], { selfSwitchValid: true, selfSwitchCh: 'A' })] },
        { id: 2, x: 1, y: 1, pages: [page(4, [
            { code: 122, parameters: [2, 2, 1, 0, 1] }, { code: 230, parameters: [5] }, { code: 121, parameters: [8, 8, 0] }
        ]), page(0, [{ code: 0 }], { switch1Valid: true, switch1Id: 9 })] }
    ]);
    const errors = [], scheduler = new EventScheduler(engine, {}, error => errors.push(error));
    scheduler.tick();
    await delay();
    assert.equal(engine.eventRunning, true, 'autorun khóa nhân vật');
    assert.equal(engine.state.variableValue(1), 1);
    assert.equal(engine.state.variableValue(2), 1, 'parallel chạy đồng thời với autorun');
    scheduler.tick(); await delay();
    assert.equal(engine.state.variableValue(1), 1, 'không tạo bản autorun thứ hai đang chờ');
    engine.state.setSwitch(9, true);
    scheduler.tick();
    engine.advanceRoutes(5); await delay();
    scheduler.tick(); await delay();
    assert.equal(engine.eventRunning, false);
    assert.equal(engine.state.selfSwitchValue(1, 1, 'A'), true);
    assert.equal(engine.state.switchValue(8), false, 'parallel bị đổi page không được tiếp tục sau wait');
    assert.equal(errors.length, 0);
    scheduler.stop();

    // Parallel không còn thuộc map mới phải dừng, không áp dụng công tắc muộn.
    const moving = await fixture([null, { id: 1, x: 0, y: 1, pages: [page(4, [
        { code: 230, parameters: [1] }, { code: 121, parameters: [10, 10, 0] }
    ])] }]);
    const movingScheduler = new EventScheduler(moving, {}, error => errors.push(error));
    movingScheduler.tick(); await delay();
    await moving.loadMap(2);
    movingScheduler.tick();
    moving.advanceRoutes(5); await delay();
    assert.equal(moving.state.switchValue(10), false);
    movingScheduler.stop();

    const common = await fixture([], [null,
        { id: 1, trigger: 1, switchId: 11, list: [
            { code: 124, parameters: [0, 2] }, { code: 230, parameters: [2] },
            { code: 122, parameters: [3, 3, 1, 0, 1] }, { code: 121, parameters: [11, 11, 1] }
        ] },
        { id: 2, trigger: 2, switchId: 12, list: [
            { code: 230, parameters: [3] }, { code: 121, parameters: [13, 13, 0] }
        ] }
    ]);
    const commonScheduler = new EventScheduler(common, {}, error => errors.push(error));
    common.state.setSwitch(11, true); common.state.setSwitch(12, true);
    commonScheduler.tick(); await delay();
    assert.equal(common.eventRunning, true);
    assert.equal(common.state.timer.frames, 120);
    common.state.setSwitch(12, false); commonScheduler.tick();
    common.advanceRoutes(3); await delay();
    assert.equal(common.state.variableValue(3), 1);
    assert.equal(common.state.timer.frames, 117);
    assert.equal(common.state.switchValue(13), false, 'common parallel bị tắt switch phải ngừng');
    assert.equal(common.eventRunning, false);
    const context = common.commonInterpreterFor(2);
    assert.equal(context.eventId, 0, 'common event tự chạy không mượn ID sự kiện 1');
    commonScheduler.stop();

    const erased = await fixture([null, { id: 1, x: 0, y: 1, pages: [page(0, [{ code: 214 }])] }]);
    await erased.runEvent(1);
    assert.equal(erased.map.eventPage(erased.map.eventById(1)), null);
    await erased.restore(erased.save());
    assert.equal(erased.map.eventPage(erased.map.eventById(1)), null, 'lưu/tải giữ sự kiện đã erase trong map hiện tại');
    await erased.loadMap(2); await erased.loadMap(1);
    assert.ok(erased.map.eventPage(erased.map.eventById(1)), 'erase chỉ có hiệu lực trong lần ở map hiện tại');

    const broken = await fixture([null, { id: 1, x: 1, y: 1, pages: [page(4, [{ code: 999 }])] }]);
    const brokenScheduler = new EventScheduler(broken, {}, error => errors.push(error));
    brokenScheduler.tick(); await delay();
    brokenScheduler.tick(); await delay();
    assert.equal(errors.length, 1, 'lệnh chưa hỗ trợ báo một lần, không lặp lỗi mỗi frame');
    assert.match(errors[0].message, /Chưa hỗ trợ lệnh 999/);
    brokenScheduler.stop();
    console.log('ĐẠT: autorun/parallel của map/common event, hủy khi đổi page/map/switch, timer và erase/save.');
})().catch(error => { console.error(error); process.exitCode = 1; });
