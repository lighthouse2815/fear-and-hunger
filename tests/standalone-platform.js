'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const { GameState } = require('../game/engine/game-state');
(async () => {
    const state = new GameState();
    await new EventInterpreter({ state, commands: [{ code: 356, parameters: ['steamworks activateachievement OTHER_WELCOME'] }] }).run();
    assert.equal(state.achievements.OTHER_WELCOME, true);
    const restored = new GameState(state.toJSON()); assert.equal(restored.achievements.OTHER_WELCOME, true);
    await assert.rejects(new EventInterpreter({ state, commands: [{ code: 356, parameters: ['steamworks openoverlay Friends'] }] }).run(), /Chưa hỗ trợ lệnh 356/);
    let count = 0, names = new Set();
    function scan(value) {
        if (!value || typeof value !== 'object') return;
        if (value.code === 356 && /^steamworks activateachievement\s+/i.test(value.parameters[0])) {
            count++; names.add(value.parameters[0].split(/\s+/)[2]);
        }
        Object.values(value).forEach(item => { if (item && typeof item === 'object') scan(item); });
    }
    for (const file of (await fs.readdir(path.join(__dirname, '../game/data'))).filter(file => /^(Map\d+|CommonEvents|Troops)\.json$/.test(file))) {
        scan(JSON.parse(await fs.readFile(path.join(__dirname, '../game/data', file), 'utf8')));
    }
    assert.equal(count, 205); assert.ok(names.size > 40);
    console.log('ĐẠT: lưu achievement Steamworks trong save; ' + count + ' lệnh achievement JSON chạy an toàn trên trình duyệt.');
})().catch(error => { console.error(error); process.exitCode = 1; });
