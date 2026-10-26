'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { LightingRuntime, parseLightNote } = require('../game/engine/lighting-runtime');
const { GameState } = require('../game/engine/game-state');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const delay = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const state = new GameState(), runtime = new LightingRuntime(state);
    const map = { id: 1, events: [{ id: 1, x: 0, y: 0, note: 'Fire 450 #202020 B0 77' },
        { id: 2, x: 1, y: 0, note: 'Light 250 #FFFFFF' }] };
    assert.equal(runtime.sources(map).length, 1, 'đèn có ID mặc định tắt');
    runtime.handleCommand('Light on 77', map);
    assert.equal(runtime.sources(map).length, 2);
    assert.equal(state.selfSwitchValue(1, 1, 'D'), true);
    state.setSelfSwitch(1, 1, 'C', true);
    assert.equal(runtime.sources(map).length, 1, 'kill switch C tắt nguồn sáng');
    state.setSelfSwitch(1, 1, 'C', false);
    map.events[0].erased = true;
    assert.equal(runtime.sources(map).length, 1, 'nguồn đã erase không còn sáng');
    map.events[0].erased = false;
    runtime.handleCommand('Light off 77', map);
    assert.equal(state.selfSwitchValue(1, 1, 'D'), false);
    runtime.handleCommand('Fire radius 240 #FFFFFF', map);
    assert.equal(runtime.lighting.radius, 240); assert.equal(runtime.lighting.fire, true);
    runtime.handleCommand('Light radiusgrow 0 #FFFFFF', map);
    runtime.advance(250); assert.equal(runtime.lighting.radius, 120);
    const restored = new LightingRuntime(new GameState(state.toJSON()));
    restored.advance(250); assert.equal(restored.lighting.radius, 0);
    runtime.handleCommand('Flashlight on 8 12 #FFFFFF');
    assert.deepEqual(runtime.lighting.flashlight, { length: 8, width: 12, color: '#FFFFFF' });
    runtime.handleCommand('Flashlight off'); assert.equal(runtime.lighting.flashlight, null);
    assert.equal(runtime.handleCommand('Light wrong'), false);
    assert.throws(() => parseLightNote('Light 300 unknown'), /chưa hỗ trợ/);

    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store });
    await engine.boot({ mapId: 74, x: 15, y: 22, direction: 8, party: [1] });
    async function common(id) {
        let done = false, failure;
        const running = engine.commonInterpreterFor(id).run().catch(error => { failure = error; }).finally(() => { done = true; });
        for (let frame = 0; frame < 50 && !done; frame++) { engine.advanceRoutes(1); await delay(); }
        assert.equal(done, true); await running; if (failure) throw failure;
    }
    await common(312);
    assert.equal(engine.state.lighting.radius, 240, 'common 312 chọn ánh sáng chế độ thường');
    assert.equal(engine.state.lighting.switches[77], false);
    engine.state.setSwitch(3153, true); await common(312);
    assert.equal(engine.state.lighting.radius, 0, 'common 312 tắt đuốc khi chế độ đói hết thời gian');
    assert.equal(engine.state.lighting.switches[77], true);
    await engine.createInterpreter([{ code: 356, parameters: ['Light radiusgrow 250 #FFFFFF'] }], 1).run();
    engine.advanceRoutes(250); await engine.restore(engine.save()); engine.advanceRoutes(250);
    assert.equal(engine.state.lighting.radius, 250);
    assert.equal(engine.state.lighting.switches[77], true);

    let notes = 0, commands = 0;
    function scan(value) {
        if (!value || typeof value !== 'object') return;
        if (value.note && /^(Light|Fire)\s/i.test(value.note)) { assert.ok(parseLightNote(value.note)); notes++; }
        if (value.code === 356 && /^(Light|Fire|Flashlight)\s/.test(value.parameters[0])) {
            assert.equal(runtime.handleCommand(value.parameters[0]), true, value.parameters[0]); commands++;
        }
        Object.values(value).forEach(item => { if (item && typeof item === 'object') scan(item); });
    }
    for (const file of (await fs.readdir(path.join(__dirname, '../game/data'))).filter(file => /^(Map\d+|CommonEvents|Troops)\.json$/.test(file))) {
        scan(JSON.parse(await fs.readFile(path.join(__dirname, '../game/data', file), 'utf8')));
    }
    assert.ok(notes > 1000); assert.ok(commands > 250);
    console.log('ĐẠT: đèn bật/tắt/kill, đuốc tắt dần và save, đèn pin, common 312; ' + notes + ' nguồn sáng, ' + commands + ' lệnh JSON.');
})().catch(error => { console.error(error); process.exitCode = 1; });
