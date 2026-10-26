'use strict';
const assert = require('node:assert/strict');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const { GameState } = require('../game/engine/game-state');
const common = require('../game/data/CommonEvents.json')[310].list;
const map = require('../game/data/Map161.json').events[2].pages.flatMap(page => page.list);
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    for (const list of [common, map]) {
        const start = list.findIndex(command => command.code === 105);
        let end = start + 1;
        while (list[end] && list[end].code === 405) end++;
        const credits = list.slice(start, end);
        const state = new GameState();
        let finish, parameters, text;
        const running = new EventInterpreter({ state, commands: [
            ...credits, { code: 121, parameters: [10, 10, 0] }
        ], handlers: { scrollText: (value, options) => {
            text = value; parameters = options;
            return new Promise(resolve => { finish = resolve; });
        } } }).run();
        await flush();
        assert.equal(text, credits.slice(1).map(command => command.parameters[0]).join('\n'));
        assert.match(text, /CREDITS/); assert.match(text, /Miro/);
        assert.ok(text.includes('\n\n'), 'giữ dòng trống của credits');
        assert.deepEqual(parameters, [1, false]);
        assert.equal(state.switchValue(10), false, 'event chờ chữ chạy hết');
        finish(); await running;
        assert.equal(state.switchValue(10), true);
        assert.equal(state.mapNameDisplay, true);
    }
    const controller = new AbortController(), state = new GameState();
    const cancelled = new EventInterpreter({ state, signal: controller.signal, commands: [
        { code: 105, parameters: [2, true] }, { code: 405, parameters: ['Credits'] },
        { code: 121, parameters: [10, 10, 0] }
    ], handlers: { scrollText: () => new Promise(() => {}) } }).run();
    const rejected = assert.rejects(cancelled, { name: 'AbortError' });
    await flush(); controller.abort(); await rejected;
    assert.equal(state.switchValue(10), false);
    await assert.rejects(new EventInterpreter({ state, commands: [{ code: 105, parameters: [0, false] }] }).run(), /Tốc độ chữ chạy/);
    console.log('ĐẠT: đọc đủ credits Common310/Map161, giữ dòng/escape, tham số tốc độ, chờ và hủy event.');
})().catch(error => { console.error(error); process.exitCode = 1; });
