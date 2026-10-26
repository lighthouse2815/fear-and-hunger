'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');

const gameRoot = path.join(__dirname, '..', 'game');
async function fetchFromGame(relativeUrl) {
    const pathname = new URL(relativeUrl, 'http://standalone.test/').pathname;
    try {
        const value = JSON.parse(await fs.readFile(path.join(gameRoot, pathname.replace(/^\/+/, '')), 'utf8'));
        return { ok: true, status: 200, json: async () => value };
    } catch (error) {
        if (error.code === 'ENOENT') return { ok: false, status: 404, json: async () => ({}) };
        throw error;
    }
}

(async () => {
    const engine = new GameEngine({ dataStore: new (require('../game/engine/data-store').GameDataStore)({ fetchImpl: fetchFromGame }), random: () => 0 });
    await engine.boot({ mapId: 74, x: 1, y: 0, direction: 2, party: [] });
    assert.equal(engine.map.id, 74);
    assert.equal(engine.state.mapId, 74);
    assert.equal(typeof engine.map.tileId(8, 7, 0), 'number');

    const initial = engine.save();
    const moved = [2, 4, 6, 8].some(direction => engine.move(direction));
    assert.equal(moved, true, 'engine phải di chuyển được từ ô khởi tạo');
    await engine.restore(initial);
    assert.deepEqual(engine.save(), initial);

    const messages = [];
    await engine.runEvent(39, { message: text => messages.push(text) });
    assert.equal(messages.length, 2, 'cả event map và common event phải hiển thị hội thoại');
    assert.match(messages[1], /Eggs/);
    assert.equal(engine.state.itemCount('items', 15), 2, 'thùng phải cấp vật phẩm từ common event 52');
    assert.equal(engine.state.selfSwitchValue(74, 39, 'A'), true);
    await engine.runEvent(39, { message: text => messages.push(text) });
    assert.equal(messages.at(-1), 'Nothing left here.');
    assert.equal(engine.state.itemCount('items', 15), 2, 'thùng đã mở không được cấp lại vật phẩm');
    assert.equal(engine.state.mapId, 74);
    console.log('ĐẠT: game engine độc lập boot, di chuyển, chạy event và save/restore.');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
