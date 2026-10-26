'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const { GameState } = require('../game/engine/game-state');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const { ScreenRuntime } = require('../game/engine/screen-runtime');
const { formatText } = require('../game/engine/text-format');
const delay = () => new Promise(resolve => setImmediate(resolve));

(async () => {
    const state = new GameState({ party: [1], actors: { 1: { name: 'Cahara' } }, variables: { 5: 42 } }, { System: { currencyUnit: 'silver' } });
    assert.equal(formatText('\\N[1] / \\P[1]: \\V[5] \\G', state), 'Cahara / Cahara: 42 silver');
    assert.equal(formatText('\\\\N[1] <WordWrap>red \\C[2]text\\C[0]<br>done.\\|', state), '\\N[1] red text\ndone.');
    const runtime = new ScreenRuntime(state);
    const interpreter = new EventInterpreter({ state, commands: [
        { code: 356, parameters: ['GabText First \\N[1]'] }, { code: 356, parameters: ['ShowGab'] },
        { code: 356, parameters: ['ShowGab'] }, { code: 356, parameters: ['GabText Second'] },
        { code: 356, parameters: ['ShowGab'] }
    ], handlers: { gab: text => runtime.showGab(text) } });
    await interpreter.run();
    assert.equal(state.screen.gab.text, 'First \\N[1]');
    assert.equal(state.screen.gabQueue.length, 1, 'ShowGab xóa thông tin cũ để không hiện lặp');
    runtime.showGab('Second');
    assert.equal(state.screen.gabQueue.length, 1, 'không xếp trùng cùng nội dung');
    runtime.advance(state.screen.gab.remaining - 8);
    assert.equal(state.screen.gab.opacity, 128);
    const restored = new ScreenRuntime(new GameState(state.toJSON()));
    restored.advance(8);
    assert.equal(restored.screen.gab.text, 'Second', 'lưu/tải giữ hàng đợi và tiến trình mờ dần');
    restored.advance(10000); assert.equal(restored.screen.gab, null);
    runtime.clearGabs(); assert.equal(runtime.active(), false);

    const bad = new EventInterpreter({ state, commands: [
        { code: 356, parameters: ['disable_choice 1'] }, { code: 102, parameters: [['Locked'], -1, 0, 1, 0] }
    ], handlers: { choice: () => 0 } });
    await assert.rejects(bad.run(), /Lựa chọn đang bị khóa/);
    const unknown = new EventInterpreter({ state, commands: [{ code: 356, parameters: ['UnknownPlugin'] }] });
    await assert.rejects(unknown.run(), /Chưa hỗ trợ lệnh 356/);

    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    for (const [actorId, selection] of [[1, 246], [3, 242], [4, 243], [5, 244]]) {
        const engine = new GameEngine({ dataStore: store, random: () => 0 });
        await engine.boot({ mapId: 10, x: 7, y: 11, direction: 8, party: [actorId], switches: { 295: true, [selection]: true } });
        let choiceCount = 0, done = false, failure;
        const running = engine.runEvent(1, { message: () => {}, choice: (choices, cancel, interpreter, details) => {
            choiceCount++;
            if (choiceCount === 1) {
                assert.equal(choices[3], '????');
                assert.deepEqual(details.disabled, [3]);
                assert.match(details.help[0], /game mode/);
                assert.match(details.message[0], /easier mode/);
                return 0;
            }
            assert.deepEqual(details.disabled, [], 'override chỉ áp dụng cho lựa chọn kế tiếp');
            return 1;
        } }).catch(error => { failure = error; }).finally(() => { done = true; });
        for (let frame = 0; frame < 1000 && !done; frame++) { engine.advanceRoutes(1); await delay(); }
        assert.equal(done, true); await running; if (failure) throw failure;
        assert.equal(engine.state.mapId, 74, 'bỏ qua phần truyện dẫn tới cổng ngục');
        assert.equal(engine.state.switchValue(3480), true);
        assert.equal(engine.state.wordWrap, false);
        assert.equal(choiceCount, 2);
        await engine.runEvent(11);
        assert.match(engine.state.screen.gab.text, /dungeons of Fear & Hunger/);
        assert.equal(engine.state.menuEnabled, true);
        assert.equal(engine.state.switchValue(79), true);
    }
    console.log('ĐẠT: biến/tên trong lời thoại, Gab xếp hàng/mờ/lưu, khóa lựa chọn và bốn luồng Map010 → Map074.');
})().catch(error => { console.error(error); process.exitCode = 1; });
