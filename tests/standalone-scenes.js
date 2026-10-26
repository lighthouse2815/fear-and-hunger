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
    console.log('ĐẠT: lệnh menu/save/game over/title cập nhật scene và lưu đúng trong engine độc lập.');
})().catch(error => { console.error(error); process.exitCode = 1; });
