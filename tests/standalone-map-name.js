'use strict';
const assert = require('node:assert/strict');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const { GameState } = require('../game/engine/game-state');
(async () => {
    const state = new GameState();
    await new EventInterpreter({ state, commands: [{ code: 105, parameters: [false] }] }).run();
    assert.equal(state.mapNameDisplay, false);
    await new EventInterpreter({ state, commands: [{ code: 105, parameters: [true] }] }).run();
    assert.equal(state.mapNameDisplay, true);
    assert.equal(new GameState(state.toJSON()).mapNameDisplay, true);
    console.log('ĐẠT: hiển thị tên bản đồ được điều khiển và lưu bằng engine độc lập.');
})().catch(error => { console.error(error); process.exitCode = 1; });
