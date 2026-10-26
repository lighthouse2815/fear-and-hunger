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

(async () => {
    const walk = await fixture({ 1: map([
        event(1, 1, 0, [{ code: 121, parameters: [5, 5, 0] }]),
        event(2, 0, 0, [{ code: 121, parameters: [6, 6, 0] }])
    ]) });
    assert.equal(await walk.step(6), true);
    assert.equal(walk.state.switchValue(5), true, 'bước lên trigger 1 chạy sự kiện');
    assert.equal(walk.state.switchValue(6), false, 'trigger 0 phải chờ tương tác');
    await walk.interact();
    assert.equal(walk.state.switchValue(6), true);

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
    await bump.step(6);
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
    await transfer.step(6);
    assert.equal(transfer.state.mapId, 2);
    assert.equal(transfer.state.switchValue(7), false, 'đặt chân ở map đích không được chuyển ngược liên tục');
    await transfer.step(6);
    await transfer.step(4);
    assert.equal(transfer.state.mapId, 1);
    assert.equal(transfer.state.switchValue(7), true, 'quay lại ô cửa bằng bước đi mới chạy trigger');
    console.log('ĐẠT: sự kiện chạm, va chạm, khóa sự kiện và cửa hai chiều không lặp chuyển map.');
})().catch(error => { console.error(error); process.exitCode = 1; });
