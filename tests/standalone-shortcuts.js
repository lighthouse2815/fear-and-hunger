'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    const e = new GameEngine({ dataStore: store });
    await e.boot({ mapId: 74, x: 8, y: 8, party: [1], switches: { 246: true } });
    e.state.gainItem('items', 5, 2);
    let resume;
    const torch = e.runCommonEvent(289, { message: text => {
        assert.match(text, /light the torch/); return new Promise(resolve => { resume = resolve; });
    } });
    for (let tick = 0; tick < 100 && !resume; tick++) await flush();
    assert.ok(resume); assert.equal(e.eventRunning, true);
    assert.equal(e.state.itemCount('items', 5), 1);
    assert.equal(await e.runCommonEvent(289), false, 'nhấn lại khi event đang chờ không trừ thêm đuốc');
    assert.equal(e.move(6), false); assert.equal(e.openMenu(), false);
    resume(); assert.equal(await torch, true);
    assert.equal(e.eventRunning, false); assert.equal(e.state.variableValue(398), 40);
    assert.equal(e.state.switchValue(3151), true); assert.equal(e.lighting.lighting.radius, 300);

    for (const scene of ['menu', 'save', 'battle', 'title', 'gameover']) {
        e.state.scene = scene; assert.equal(await e.runCommonEvent(289), false);
        assert.equal(e.state.itemCount('items', 5), 1);
    }
    e.state.scene = 'map'; e.state.setSwitch(2845, true);
    const mp = e.state.actor(1).mp;
    assert.equal(await e.runCommonEvent(257), true);
    assert.equal(e.state.actor(1).mp, mp - 10, 'Phase đọc common event 257 thật và trừ 10 MP');
    assert.equal(e.state.switchValue(2844), true);
    e.state.setSwitch(2844, false); e.state.actor(1).mp = 9;
    await e.runCommonEvent(257);
    assert.equal(e.state.actor(1).mp, 9); assert.equal(e.state.switchValue(2844), false, 'thiếu MP không bật Phase');
    e.state.actor(1).mp = mp;
    for (const id of [202, 410]) {
        e.state.setSwitch(id, true); await e.runCommonEvent(257);
        assert.equal(e.state.actor(1).mp, mp, 'tôn trọng switch khóa kỹ năng ' + id);
        e.state.setSwitch(id, false);
    }
    e.state.setVariable(398, 0); e.state.setSwitch(3151, false); resume = null;
    const controller = new AbortController();
    const canceled = e.runCommonEvent(289, { message: () => new Promise(resolve => { resume = resolve; }) }, controller.signal);
    const rejected = assert.rejects(canceled, { name: 'AbortError' });
    for (let tick = 0; tick < 100 && !resume; tick++) await flush();
    assert.ok(resume); controller.abort(); await rejected;
    resume(); await flush();
    assert.equal(e.eventRunning, false); assert.equal(e.state.variableValue(398), 0); assert.equal(e.state.switchValue(3151), false);
    await assert.rejects(e.runCommonEvent(9999), /Không tìm thấy common event/);
    assert.equal(e.eventRunning, false, 'common event lỗi không giữ khóa điều khiển');
    console.log('ĐẠT: common event phím T/C thật, đuốc/Phase/MP/switch, khóa chờ/menu/battle, nhấn trùng, hủy và lỗi.');
})().catch(error => { console.error(error); process.exitCode = 1; });
