'use strict';
const assert = require('node:assert/strict');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const { GameState } = require('../game/engine/game-state');
(async () => {
    const state = new GameState();
    const run = text => new EventInterpreter({ state, commands: [{ code: 356, parameters: [text] }] }).run();
    await run('RegionReveal 5');
    assert.equal(state.regionCover.enabled, true); assert.deepEqual(state.regionCover.open, [0,5]);
    await run('RegionReveal [2]'); await run('RegionReveal [2]');
    assert.deepEqual(state.regionCover.open, [0,5,2]);
    await run('RegionHide [5]'); assert.deepEqual(state.regionCover.open, [0,2]);
    await run('RegionHide 0'); assert.deepEqual(state.regionCover.open, [0,2], 'region 0 luôn mở');
    const restored = new GameState(state.toJSON()); assert.deepEqual(restored.regionCover, state.regionCover);
    await run('RegionReset'); assert.deepEqual(state.regionCover.open, [0]);
    await assert.rejects(run('RegionReveal nope'), /Chưa hỗ trợ lệnh 356/);
    console.log('ĐẠT: RegionReveal/Hide/Reset, cú pháp ID có ngoặc và save trạng thái vùng tối.');
})().catch(error => { console.error(error); process.exitCode = 1; });
