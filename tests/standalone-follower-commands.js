'use strict';
const assert = require('node:assert/strict');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const { GameState } = require('../game/engine/game-state');
(async () => {
    const state = new GameState();
    const run = commands => new EventInterpreter({ state, commands }).run();
    await run([{ code: 216, parameters: [0] }, { code: 217, parameters: [] }, { code: 204, parameters: [0, {}] }]);
    assert.equal(state.followersVisible, false); assert.equal(state.followersGathering, true); assert.equal(state.vehicleBgm, null);
    await run([{ code: 216, parameters: [1] }, { code: 204, parameters: [1, { name: 'dungeon', volume: 80, pitch: 100, pan: 0 }] }]);
    assert.equal(state.followersVisible, true); assert.equal(state.vehicleBgm.name, 'dungeon');
    const restored = new GameState(state.toJSON());
    assert.deepEqual(restored.vehicleBgm, state.vehicleBgm); assert.equal(restored.followersGathering, true);
    console.log('ĐẠT: ẩn/hiện follower, gom follower và BGM phương tiện được lưu trong engine độc lập.');
})().catch(error => { console.error(error); process.exitCode = 1; });
