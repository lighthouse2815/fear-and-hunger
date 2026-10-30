'use strict';
const assert = require('node:assert/strict');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const { GameState } = require('../game/engine/game-state');
const { ScreenRuntime } = require('../game/engine/screen-runtime');
const { CanvasRenderer } = require('../game/engine/canvas-renderer');
(async () => {
    const state = new GameState();
    await new EventInterpreter({ state, commands: [{ code: 281, parameters: [1] }] }).run();
    assert.equal(state.mapNameDisplay, false);
    await new EventInterpreter({ state, commands: [{ code: 281, parameters: [0] }] }).run();
    assert.equal(state.mapNameDisplay, true);
    assert.equal(new GameState(state.toJSON()).mapNameDisplay, true);
    await assert.rejects(new EventInterpreter({ state, commands: [{ code: 105, parameters: [1, false] }] }).run(), /Chưa hỗ trợ lệnh 105/);
    assert.equal(state.mapNameDisplay, true, '105 là chữ chạy, không đổi cờ tên map');
    const screen = new ScreenRuntime(state);
    const map = require('../game/data/Map004.json');
    screen.showMapName(map.displayName);
    screen.advance(16);
    assert.equal(screen.mapName.opacity, 255);
    assert.equal(screen.mapName.text, 'Level 1 - Courtyard');
    const calls = [];
    const context = { save() {}, restore() {}, createLinearGradient: () => ({ addColorStop() {} }),
        fillRect: (...args) => calls.push(['background', ...args]),
        strokeText: (...args) => calls.push(['outline', ...args]), fillText: (...args) => calls.push(['text', ...args]) };
    const renderer = new CanvasRenderer({ getContext: () => context });
    renderer.drawMapName(screen.mapName);
    assert.deepEqual(calls.find(call => call[0] === 'text'), ['text', 'Level 1 - Courtyard', 180, 36, 324]);
    state.mapNameDisplay = false;
    screen.advance(16);
    assert.equal(screen.mapName.opacity, 0);
    assert.equal(screen.active(), false, 'tên bị ẩn không buộc vẽ liên tục');
    state.mapNameDisplay = true;
    screen.advance(134);
    assert.equal(screen.mapName.remaining, 0);
    screen.advance(16);
    assert.equal(screen.mapName, null, 'tên biến mất sau 150 frame và fade');
    screen.showMapName('');
    assert.equal(screen.mapName, null, 'map không có tên không hiện bảng');
    let destination;
    await new EventInterpreter({ state, commands: [{ code: 201, parameters: [0, 4, 1, 2, 2, 1] }],
        handlers: { transfer: value => { destination = value; } } }).run();
    assert.equal(destination.fadeType, 1, 'truyền hiệu ứng fade trắng theo dữ liệu event');
    console.log('ĐẠT: tên bản đồ, thời gian fade, tùy chọn hiển thị và kiểu chuyển cảnh.');
})().catch(error => { console.error(error); process.exitCode = 1; });
