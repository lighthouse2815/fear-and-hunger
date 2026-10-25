'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const FNH = { Scene: class {}, TILE: 48, WIDTH: 816, HEIGHT: 624, clamp: (v, min, max) => Math.max(min, Math.min(max, v)) };
for (const file of ['data', 'interpreter', 'scene_map']) vm.runInNewContext(fs.readFileSync('fnh-engine/js/' + file + '.js', 'utf8'), { window: { FNH }, console });
const c = (code, parameters = []) => ({ code, parameters });
const flush = () => new Promise(setImmediate);
function setup() {
    const scene = new FNH.Scene_Map();
    const data = new FNH.DataStore();
    data.tilesets = [null,
        { id: 1, tilesetNames: ['', '', '', '', '', 'Old'], flags: [0x10, 0] },
        { id: 2, tilesetNames: ['', '', '', '', '', 'New'], flags: [0x10, 1] },
        { id: 3, tilesetNames: ['', '', '', '', '', 'Other'], flags: [0x10, 0] }];
    scene.map = { width: 2, height: 2, tilesetId: 1, events: [], data: [1, 1, 1, 1] };
    data.maps.set(1, scene.map);
    scene.tileset = data.tilesets[1];
    scene.tileImages.set('Old', {});
    scene.game = { data, mapId: 1, player: { id: 1, mapX: 0, mapY: 0, direction: 2, characterName: 'Actor' },
        flags: {}, gold: 0, audio: { stopBgm() {} }, assets: { loadImage: async () => ({}) }, showToast() {} };
    scene.input = { isPressed: () => false };
    return scene;
}
(async () => {
    const scene = setup();
    let finish;
    scene.game.assets.loadImage = () => new Promise((resolve) => { finish = resolve; });
    scene.startEventList({ list: [c(282, [2]), c(125, [0, 0, 7])] }, 0);
    assert.equal(scene.eventRunner.wait.type, 'asset');
    scene.updateEvent(100);
    assert.equal(scene.game.gold, 0);
    assert.equal(scene.tileset.id, 1, 'Chưa tải xong giữ nguyên hình và va chạm cũ');
    finish({ name: 'NewImage' });
    await flush();
    scene.updateEvent(0);
    assert.equal(scene.game.gold, 7);
    assert.equal(scene.tileset.id, 2);
    assert.equal(scene.tileImages.get('New').name, 'NewImage');
    assert.equal(scene.tileImages.has('Old'), false);
    assert.equal(scene.game.data.isTilePassable(scene.map, scene.tileset, 0, 0, 2), false);
    assert.equal(scene.map.tilesetId, 1, 'Không sửa database bản đồ dùng chung');
    assert.equal(scene.game.flags['map:tileset'].id, 2);
    const loaded = setup();
    loaded.game.flags = JSON.parse(JSON.stringify(scene.game.flags));
    await loaded.loadMap();
    assert.equal(loaded.tileset.id, 2, 'Tải bản đồ khôi phục override từ save');
    loaded.game.mapId = 2;
    loaded.loadMap = async () => {};
    loaded.enter({ fromTransfer: true });
    assert.equal(loaded.game.flags['map:tileset'], undefined);
    scene.game.assets.loadImage = async () => { throw new Error('Ảnh bị thiếu'); };
    scene.startEventList({ list: [c(282, [3]), c(125, [0, 0, 99])] }, 0);
    await flush();
    scene.updateEvent(0);
    assert.equal(scene.game.lastError.message, 'Ảnh bị thiếu');
    assert.equal(scene.tileset.id, 2, 'Lỗi tải ảnh không đổi một nửa trạng thái');
    assert.equal(scene.game.gold, 7, 'Lỗi tải ảnh dừng phần còn lại của event');
    assert.equal(scene.game.flags['map:tileset'].id, 2);
    const racing = setup(), pending = new Map();
    racing.game.assets.loadImage = (name) => new Promise((resolve) => pending.set(name, resolve));
    const first = racing.loadTileset(2), second = racing.loadTileset(3);
    pending.get('tilesets/Other')({});
    assert.equal(await second, true);
    pending.get('tilesets/New')({});
    assert.equal(await first, false);
    assert.equal(racing.tileset.id, 3, 'Yêu cầu tải cũ không ghi đè tileset mới');
    await assert.rejects(racing.loadTileset(999), /Không tìm thấy tileset/);
    console.log('ĐẠT: đổi tileset, chờ asset, va chạm, save, lỗi tải và yêu cầu đồng thời.');
})().catch((error) => { console.error(error); process.exitCode = 1; });

const passageData = new FNH.DataStore();
const passageMap = { width: 2, height: 1, data: [1, 1, 0, 0, 2, 3, 0, 0] };
const passageTiles = { flags: [0x10, 0x0f, 0, 0x12] };
assert.equal(passageData.isTilePassable(passageMap, passageTiles, 0, 0, 6), true,
    'Lớp đi được phía trên cho phép đi qua nền bị chặn ở dưới');
assert.equal(passageData.isTilePassable(passageMap, passageTiles, 1, 0, 6), false,
    'Tile ngôi sao không ghi đè va chạm của lớp dưới');
passageTiles.flags[2] = 0x04;
passageTiles.flags[1] = 0;
assert.equal(passageData.isTilePassable(passageMap, passageTiles, 0, 0, 6), false,
    'Lớp trên chặn đúng hướng dù nền bên dưới đi được');
const directed = setup();
directed.map = { width: 2, height: 1, events: [], data: [1, 2, 0, 0, 0, 0, 0, 0] };
directed.guard.alive = false;
directed.tileset = { flags: [0x10, 0x04, 0] };
assert.equal(directed.tryMove(6), false, 'Người chơi phải được phép rời ô hiện tại');
directed.tileset.flags = [0x10, 0, 0x02];
assert.equal(directed.tryMove(6), false, 'Đi sang phải kiểm tra cạnh trái của ô đích');
directed.tileset.flags = [0x10, 0, 0x04];
assert.equal(directed.tryMove(6), true, 'Cạnh phải ô đích không chặn bước đi vào từ trái');
assert.equal(directed.toX, 1);
assert.equal(directed.toY, 0);
console.log('ĐẠT: va chạm theo lớp trên, tile ngôi sao và hai cạnh của bước đi.');
