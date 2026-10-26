'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameState } = require('../game/engine/game-state');
const { GameMap } = require('../game/engine/map-model');

const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'game', 'data', name), 'utf8'));
const mapData = read('Map074.json');
const tilesets = read('Tilesets.json');
const state = new GameState({ mapId: 74 });
const map = new GameMap(Object.assign({ id: 74 }, mapData), tilesets[mapData.tilesetId], state);

assert.equal(map.width, 28);
assert.equal(map.height, 29);
assert.equal(map.isValid(0, 0), true);
assert.equal(map.isValid(-1, 0), false);
assert.equal(map.tileIndex(0, 0, 0), 0);
assert.equal(map.tileId(0, 0, 0), mapData.data[0]);
assert.equal(map.regionId(0, 0), mapData.data[5 * map.height * map.width]);
assert.ok(map.events.length > 0);
const event = map.events[0];
assert.deepEqual(map.eventAt(event.x, event.y)[0], event);
assert.ok(map.eventPage(event, state) === null || Array.isArray(map.eventPage(event, state).list));

let compared = false;
for (let y = 0; y < map.height && !compared; y += 1) {
    for (let x = 0; x < map.width && !compared; x += 1) {
        const current = map.tileId(x, y, 0);
        const flags = tilesets[mapData.tilesetId].flags || [];
        if (current < flags.length && (flags[current] & 0x0f) === 0x0f) {
            assert.equal(map.tilePassable(x, y, 1), false);
            compared = true;
        }
    }
}
assert.equal(compared, true, 'map phải có ít nhất một ô bị chặn để kiểm tra flags');

console.log('ĐẠT: map model độc lập đọc tile, vùng, event page và passability.');
