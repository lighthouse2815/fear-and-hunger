'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FilterRuntime } = require('../game/engine/filter-runtime');
const { GameState } = require('../game/engine/game-state');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const delay = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const runtime = new FilterRuntime(new GameState());
    runtime.handleCommand('createFilter GOD godray-np 21 screen');
    runtime.handleCommand('setFilter GOD 450 -300 0.8 2 0.2');
    runtime.advance(50);
    assert.equal(runtime.filters.GOD.time, 0.5);
    assert.equal(runtime.active(), true);
    assert.equal(runtime.forTarget(21).length, 1);
    assert.equal(runtime.forTarget(2).length, 0);
    runtime.enabled=false;assert.equal(runtime.active(),false);assert.equal(runtime.forTarget(21).length,0);
    assert.ok(runtime.filters.GOD,'tắt hiển thị không xóa cấu hình filter');
    runtime.enabled=true;assert.equal(runtime.forTarget(21).length,1);
    const state = new GameState({ filters: runtime.filters });
    const restored = new FilterRuntime(new GameState(state.toJSON()));
    restored.advance(50); assert.equal(restored.filters.GOD.time, 1);
    runtime.handleCommand('createFilter GOD rgbsplit 2 screen');
    assert.deepEqual(runtime.filters.GOD.parameters, [0, 0], 'tạo lại cùng ID thay loại và thông số cũ');
    runtime.handleCommand('eraseFilter GOD'); assert.equal(runtime.active(), false);
    assert.equal(runtime.handleCommand('eraseFilter absent'), true);
    assert.equal(runtime.handleCommand('setFilter absent 1 2'), true, 'setFilter bỏ qua ID đã bị xóa, giống nội dung gốc');
    assert.equal(runtime.handleCommand('OtherCommand'), false);
    assert.throws(() => runtime.handleCommand('createFilter bad nope 2 screen'), /chưa hỗ trợ/);
    assert.throws(() => runtime.handleCommand('createFilter bad adjustment 0 screen'), /chưa hỗ trợ/);
    assert.throws(() => runtime.handleCommand('createFilter __proto__ rgbsplit 2 screen'), /chưa hỗ trợ/);
    runtime.handleCommand('createFilter RGB rgbsplit 2 screen');
    assert.throws(() => runtime.handleCommand('setFilter RGB 1 NaN'), /không hợp lệ/);
    assert.throws(() => runtime.handleCommand('setFilter RGB 1'), /không hợp lệ/);
    assert.throws(() => runtime.apply({}, runtime.forTarget(2)), /cần thư viện Pixi/, 'không giả vờ thành công khi thiếu GPU backend');
    runtime.dispose();

    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store });
    await engine.boot({ mapId: 74, x: 15, y: 22, direction: 8, party: [1] });
    await engine.createInterpreter([
        { code: 356, parameters: ['createFilter ZOOM zoomblur 2 screen'] },
        { code: 356, parameters: ['setFilter ZOOM 425 320 480 0.3'] }
    ], 1).run();
    await engine.restore(engine.save());
    assert.deepEqual(engine.state.filters.ZOOM.parameters, [425,320,480,0.3]);
    let done = false, failure;
    const running = engine.commonInterpreterFor(309).run().catch(error => { failure = error; }).finally(() => { done = true; });
    for (let frame = 0; frame < 20 && !done; frame++) { engine.advanceRoutes(1); await delay(); }
    assert.equal(done, true); await running; if (failure) throw failure;
    assert.deepEqual(engine.state.filters, {}, 'common 309 xóa filter bằng engine độc lập');

    let count = 0;
    function scan(value) {
        if (!value || typeof value !== 'object') return;
        if (value.code === 356 && /^(createFilter|setFilter|eraseFilter)\s/.test(value.parameters[0])) {
            assert.equal(runtime.handleCommand(value.parameters[0]), true, value.parameters[0]); count++;
        }
        Object.values(value).forEach(item => { if (item && typeof item === 'object') scan(item); });
    }
    for (const file of (await fs.readdir(path.join(__dirname, '../game/data'))).filter(file => /^(Map\d+|CommonEvents|Troops)\.json$/.test(file))) {
        scan(JSON.parse(await fs.readFile(path.join(__dirname, '../game/data', file), 'utf8')));
    }
    assert.ok(count > 240);
    const bundled = await fs.readFile(path.join(__dirname, '../game/engine/vendor/pixi-filters.js'), 'utf8');
    const original = (await fs.readFile(path.join(__dirname, '../game/js/plugins/FilterController.js'), 'utf8')).replace(/\r\n/g, '\n');
    const begin = original.indexOf('/*!\n * pixi-filters - v2.7.0');
    const end = original.indexOf('//# sourceMappingURL=pixi-filters.js.map', begin);
    assert.ok(begin >= 0 && end > begin);
    assert.ok(bundled === original.slice(begin, end).trimEnd() + '\n', 'tái sử dụng nguyên thư viện MIT hiện có');
    assert.doesNotMatch(bundled, /Game_Interpreter|Scene_Map|PluginManager|Filter_Controller/);
    console.log('ĐẠT: bốn loại filter, scope, thời gian/save, common 309 và ' + count + ' lệnh JSON; thư viện MIT tách nguyên vẹn.');
})().catch(error => { console.error(error); process.exitCode = 1; });
