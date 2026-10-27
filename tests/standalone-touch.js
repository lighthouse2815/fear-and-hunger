'use strict';

const assert = require('node:assert/strict');
const { GameEngine } = require('../game/engine/game-engine');

function event(id, trigger, priorityType, list) {
    return { id, x: 1, y: 0, pages: [{ conditions: {}, trigger, priorityType, through: false, list }] };
}
function map(events) {
    return { width: 3, height: 1, tilesetId: 1, events, data: [1, 1, 1, ...Array(15).fill(0)] };
}
async function fixture(maps) {
    const engine = new GameEngine({ dataStore: {
        loadDatabase: async () => ({ Actors: [], System: {}, Tilesets: [null, { flags: [16, 0] }] }),
        loadMap: async id => maps[id]
    } });
    await engine.boot({ mapId: 1, x: 0, y: 0, direction: 6 });
    return engine;
}
function step(engine, direction) {
    const pending = engine.step(direction);
    engine.advanceRoutes(engine.state.moveFrames || 0);
    return pending;
}

(async () => {
    const walk = await fixture({ 1: map([
        event(1, 1, 0, [{ code: 121, parameters: [5, 5, 0] }]),
        event(2, 0, 0, [{ code: 121, parameters: [6, 6, 0] }])
    ]) });
    const arriving = walk.step(6), duration = walk.state.moveFrames;
    assert.equal(walk.state.switchValue(5), false, 'chưa chạy sự kiện khi sprite còn ở ô trước');
    walk.advanceRoutes(duration / 2);
    assert.equal(walk.state.switchValue(5), false, 'giữa bước chưa kích hoạt sự kiện dưới chân');
    assert.equal(await walk.step(6), false, 'không mở bước thứ hai khi chưa tới đích');
    assert.equal(walk.openMenu(), false, 'menu không chen vào bước đang tới event');
    walk.advanceRoutes(duration / 2 - 1);
    assert.equal(walk.state.switchValue(5), false, 'chờ đến frame cuối');
    walk.advanceRoutes(1); assert.equal(await arriving, true);
    assert.equal(walk.state.switchValue(5), true, 'bước lên trigger 1 chạy sự kiện');
    assert.equal(walk.state.switchValue(6), false, 'trigger 0 phải chờ tương tác');
    await walk.interact();
    assert.equal(walk.state.switchValue(6), true);

    for (const trigger of [0, 1, 2]) {
        const facing = await fixture({ 1: map([event(1, trigger, 1, [{ code: 121, parameters: [40 + trigger, 40 + trigger, 0] }, { code: 0 }])]) });
        await facing.interact();
        assert.equal(facing.state.switchValue(40 + trigger), true, 'xác nhận trước mặt kích hoạt cả event chạm ' + trigger);
        assert.equal(facing.state.x, 0, 'tương tác không tự bước vào event');
    }
    const beneath = await fixture({ 1: map([event(1, 2, 0, [{ code: 121, parameters: [49, 49, 0] }, { code: 0 }])]) });
    beneath.state.x = 1;
    assert.equal(await beneath.interact(), null, 'event chạm dưới chân không chạy bằng nút xác nhận');
    assert.equal(beneath.state.switchValue(49), false);

    for (const trigger of [0, 1, 2]) {
        const target = event(1, trigger, 1, [{ code: 121, parameters: [50 + trigger, 50 + trigger, 0] }, { code: 0 }]); target.x = 2;
        const counter = await fixture({ 1: map([target]) });
        assert.equal(await counter.interact(), null, 'không tương tác xuyên hai ô khi không có quầy');
        counter.map.tileset.flags[2] = 0x80; counter.map.data.data[counter.map.tileIndex(1, 0, 3)] = 2;
        assert.equal(counter.map.isCounter(1, 0), true, 'cờ quầy ở lớp trên được nhận diện');
        assert.equal(counter.map.isCounter(-1, 0), false, 'ngoài map không phải quầy');
        await counter.interact();
        assert.equal(counter.state.switchValue(50 + trigger), true, 'tương tác qua quầy hỗ trợ trigger ' + trigger);
    }
    const front = event(1, 0, 1, [{ code: 121, parameters: [54, 54, 0] }, { code: 0 }]);
    const behind = event(2, 0, 1, [{ code: 121, parameters: [55, 55, 0] }, { code: 0 }]); behind.x = 2;
    const priority = await fixture({ 1: map([front, behind]) });
    priority.map.tileset.flags[2] = 0x80; priority.map.data.data[priority.map.tileIndex(1, 0, 3)] = 2;
    await priority.interact();
    assert.equal(priority.state.switchValue(54), true, 'event trước mặt ưu tiên hơn event sau quầy');
    assert.equal(priority.state.switchValue(55), false);

    const bump = await fixture({ 1: map([event(1, 2, 1, [
        { code: 101, parameters: [] }, { code: 401, parameters: ['Bị chặn'] },
        { code: 121, parameters: [5, 5, 0] }
    ])]) });
    let resume, messages = 0;
    const pending = bump.step(6, { message: () => {
        messages++;
        return new Promise(resolve => { resume = resolve; });
    } });
    assert.equal(bump.eventRunning, true);
    assert.equal(bump.state.x, 0, 'va chạm không cho đi xuyên event có priority bình thường');
    assert.equal(await bump.step(6), false);
    assert.equal(messages, 1, 'giữ phím không được mở thêm một sự kiện khi đang chờ');
    resume();
    assert.equal(await pending, false);
    assert.equal(bump.state.switchValue(5), true);
    assert.equal(bump.stepRunning, false);
    bump.state.direction = 8;
    bump.applyRoute([-1, { list: [{ code: 35 }, { code: 37 }, { code: 0 }], repeat: false }], { mapId: 1 });
    await step(bump, 6);
    assert.equal(bump.state.x, 1, 'route Through cho phép đi xuyên vật thể');
    assert.equal(bump.state.direction, 8, 'route Direction Fix giữ hướng khi di chuyển');
    bump.applyRoute([-1, { list: [{ code: 36 }, { code: 38 }, { code: 0 }], repeat: false }], { mapId: 1 });
    assert.equal(bump.state.directionFixed, false);
    assert.equal(bump.state.through, false);
    assert.throws(() => bump.applyRoute([-1, { list: [{ code: 35 }, { code: 45 }], repeat: false }], { mapId: 1 }), /Thiếu tham số movement route 45/);
    assert.equal(bump.state.directionFixed, false, 'route chưa hỗ trợ không được áp dụng dở dang');

    const destination = event(1, 1, 0, [
        { code: 121, parameters: [7, 7, 0] }, { code: 201, parameters: [0, 1, 0, 0, 4, 0] }
    ]);
    destination.x = 0;
    const transfer = await fixture({
        1: map([event(1, 1, 0, [{ code: 201, parameters: [0, 2, 0, 0, 6, 0] }])]),
        2: map([destination])
    });
    await step(transfer, 6);
    assert.equal(transfer.state.mapId, 2);
    assert.equal(transfer.state.switchValue(7), false, 'đặt chân ở map đích không được chuyển ngược liên tục');
    await step(transfer, 6);
    await step(transfer, 4);
    assert.equal(transfer.state.mapId, 1);
    assert.equal(transfer.state.switchValue(7), true, 'quay lại ô cửa bằng bước đi mới chạy trigger');

    const movedEvent = await fixture({ 1: map([event(1, 1, 0, [{ code: 121, parameters: [8, 8, 0] }])]) });
    let pendingStep = movedEvent.step(6);
    movedEvent.map.locateEvent(1, 2, 0);
    movedEvent.advanceRoutes(8); await pendingStep;
    assert.equal(movedEvent.state.switchValue(8), false, 'đọc vị trí event lúc đến đích thay vì danh sách trước bước');
    const changedPage = await fixture({ 1: map([event(1, 1, 0, [{ code: 121, parameters: [8, 8, 0] }])]) });
    pendingStep = changedPage.step(6); changedPage.map.eventById(1).erased = true;
    changedPage.advanceRoutes(8); await pendingStep;
    assert.equal(changedPage.state.switchValue(8), false, 'event bị xóa giữa bước không chạy page cũ');

    const interrupted = await fixture({ 1: map([event(1, 1, 0, [{ code: 121, parameters: [8, 8, 0] }])]), 2: map([]) });
    pendingStep = interrupted.step(6);
    await interrupted.loadMap(2, { x: 1, y: 0 }); await pendingStep;
    assert.equal(interrupted.stepRunning, false); assert.equal(interrupted.state.switchValue(8), false, 'chuyển map giữa bước bỏ trigger ở map cũ');
    assert.equal(interrupted.screen.screen.tweens.length, 0, 'hủy dọn frame chờ');
    await interrupted.loadMap(1, { x: 0, y: 0 });
    pendingStep = interrupted.step(6); interrupted.state.scene = 'title'; interrupted.advanceRoutes(1); await pendingStep;
    assert.equal(interrupted.stepRunning, false); assert.equal(interrupted.state.switchValue(8), false, 'title hủy chờ, không giữ khóa busy');
    console.log('ĐẠT: touch chờ hết bước, va chạm tức thời, khóa input/menu, page/vị trí mới, hủy map/title và cửa hai chiều không lặp.');
})().catch(error => { console.error(error); process.exitCode = 1; });
