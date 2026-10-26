'use strict';
const assert = require('node:assert/strict');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const { GameState } = require('../game/engine/game-state');
(async () => {
    const state = new GameState();
    const run = commands => new EventInterpreter({ state, commands }).run();
    await run([{ code: 216, parameters: [0] }, { code: 217, parameters: [] }]);
    assert.equal(state.followersVisible, false); assert.equal(state.followersGathering, true);
    await run([{ code: 216, parameters: [1] }]);
    assert.equal(state.followersVisible, true);
    const restored = new GameState(state.toJSON());
    assert.equal(restored.followersVisible, true); assert.equal(restored.followersGathering, true);
    console.log('ĐẠT: lưu cờ hiển thị và yêu cầu tập hợp follower trong engine độc lập.');
})().catch(error => { console.error(error); process.exitCode = 1; });
