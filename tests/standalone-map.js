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

// Tile chỉ chặn một hướng vẫn phải chặn, dù lớp đất bên dưới cho phép đi.
const flags = [16, 0, 4, 2];
const layers = Array(12).fill(0);
layers[0] = layers[1] = 1;
layers[6] = 2;
const directional = new GameMap({ id: 1, width: 2, height: 1, data: layers, events: [] }, { flags }, state);
assert.equal(directional.isPassable(0, 0, 6), false);
flags[2] = 16 | 4;
assert.equal(directional.isPassable(0, 0, 6), true, 'tile star không chặn đường');
layers[7] = 3;
assert.equal(directional.isPassable(0, 0, 6), false, 'kiểm tra cả hướng đi vào ô đích');

// Sự kiện tile dưới nhân vật được xét trước các lớp bản đồ, kể cả sau đổi trang/vị trí.
const eventFlags = [16, 0, 15, 16];
const eventLayers = Array(12).fill(0);
eventLayers[0] = eventLayers[1] = 1;
const tileEventMap = new GameMap({ id: 2, width: 2, height: 1, data: eventLayers, events: [{
    id: 1, x: 1, y: 0, pages: [
        { conditions: {}, image: { tileId: 2 }, priorityType: 0, through: false },
        { conditions: { switch1Valid: true, switch1Id: 2 }, image: { tileId: 3 }, priorityType: 0, through: false }
    ]
}] }, { flags: eventFlags }, state);
assert.equal(tileEventMap.isPassable(0, 0, 6), false, 'tile sự kiện chặn lối trên nền đi được');
tileEventMap.eventById(1).through = true;
assert.equal(tileEventMap.isPassable(0, 0, 6), true, 'bỏ qua tile sự kiện bật xuyên qua');
tileEventMap.eventById(1).through = false;
tileEventMap.eventById(1).priorityType = 1;
assert.equal(tileEventMap.isPassable(0, 0, 6), true, 'không xét tile sự kiện cùng lớp nhân vật');
tileEventMap.eventById(1).priorityType = 0;
tileEventMap.locateEvent(1, 0, 0);
assert.equal(tileEventMap.isPassable(0, 0, 6), false, 'tile sự kiện chặn cả ô đang đứng');
state.setSwitch(2, true);
assert.equal(tileEventMap.isPassable(0, 0, 6), true, 'trang mới có tile star không chặn đường');
state.setSwitch(2, false);
tileEventMap.eventById(1).erased = true;
assert.equal(tileEventMap.isPassable(0, 0, 6), true, 'bỏ qua sự kiện đã xóa');

const villageData = read('Map016.json');
const village = new GameMap(Object.assign({ id: 16 }, villageData), tilesets[villageData.tilesetId], state);
assert.equal(village.isPassable(35, 39, 2), false, 'phía trái thang vẫn bị chặn như game gốc');
for (const y of [39, 40, 41, 42]) {
    assert.equal(village.isPassable(36, y, 2), true, 'đi xuống thang thật ở Map016, hàng ' + y);
    assert.equal(village.isPassable(36, y + 1, 8), true, 'đi lên thang thật ở Map016, hàng ' + (y + 1));
}

directional.events.push({ id: 1, x: 1, y: 0, pages: [
    { conditions: { switch1Valid: true, switch1Id: 1 }, priorityType: 1, through: false }
] });
assert.equal(directional.eventBlocks(1, 0), false);
state.setSwitch(1, true);
assert.equal(directional.eventBlocks(1, 0), true);
directional.events[0].pages[0].through = true;
directional.events[0].through = true;
assert.equal(directional.eventBlocks(1, 0), false);
directional.locateEvent(1, 0, 0, 8);
assert.equal(directional.eventAt(0, 0)[0].id, 1);
assert.equal(directional.eventById(1).direction, 8);
assert.equal(state.eventLocations['1,1'].persist, false);
directional.discardTemporaryLocations();
assert.equal(state.eventLocations['1,1'], undefined, 'map không có note không nhớ vị trí khi rời map');
directional.data.note = '<Save Event Locations>';
directional.locateEvent(1, 1, 0, 2);
directional.discardTemporaryLocations();
assert.equal(state.eventLocations['1,1'].persist, true, 'tôn trọng note lưu vị trí trong nội dung gốc');

console.log('ĐẠT: map model độc lập đọc tile, vùng, event page và passability.');
