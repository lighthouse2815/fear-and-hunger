'use strict';
const assert = require('node:assert/strict');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const { GameState } = require('../game/engine/game-state');
(async () => {
    const state = new GameState();
    for (const [code, scene] of [[351,'menu'],[352,'save'],[353,'gameover'],[354,'title']]) {
        await new EventInterpreter({ state, commands: [{ code, parameters: [] }] }).run();
        assert.equal(state.scene, scene);
        assert.equal(new GameState(state.toJSON()).scene, scene);
    }
    for (const [code, scene] of [[353, 'gameover'], [354, 'title']]) {
        const state = new GameState();
        const result = await new EventInterpreter({ state, commonEvents: [null, { list: [
            { code: 117, parameters: [2] }, { code: 121, parameters: [12, 12, 0] }
        ] }, { list: [{ code }, { code: 121, parameters: [11, 11, 0] }] }], commands: [
            { code: 117, parameters: [1] }, { code: 121, parameters: [13, 13, 0] }
        ] }).run();
        assert.equal(result.terminated, scene);
        assert.equal(state.scene, scene);
        assert.deepEqual([11, 12, 13].map(id => state.switchValue(id)), [false, false, false],
            'kết thúc cả common event lồng nhau và event gọi');
    }
    console.log('ĐẠT: lưu scene; game over/về tiêu đề dừng cả event và common event lồng nhau.');
})().catch(error => { console.error(error); process.exitCode = 1; });
