'use strict';
const assert = require('node:assert/strict');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const { GameState } = require('../game/engine/game-state');
(async () => {
    const state = new GameState();
    await new EventInterpreter({ state, commands: [{ code: 281, parameters: [1] }] }).run();
    assert.equal(state.mapNameDisplay, false);
    await new EventInterpreter({ state, commands: [{ code: 281, parameters: [0] }] }).run();
    assert.equal(state.mapNameDisplay, true);
    assert.equal(new GameState(state.toJSON()).mapNameDisplay, true);
    await assert.rejects(new EventInterpreter({ state, commands: [{ code: 105, parameters: [1, false] }] }).run(), /Chưa hỗ trợ lệnh 105/);
    assert.equal(state.mapNameDisplay, true, '105 là chữ chạy, không đổi cờ tên map');
    console.log('ĐẠT: lệnh 281 điều khiển và lưu cờ tên bản đồ; lệnh 105 không đổi cờ.');
})().catch(error => { console.error(error); process.exitCode = 1; });
