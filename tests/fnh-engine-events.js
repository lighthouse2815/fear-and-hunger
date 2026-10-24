'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FNH = { Scene: class {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../fnh-engine/js/scene_map.js'), 'utf8'), {
    window: { FNH }
});

const scene = new FNH.Scene_Map();
let commands = [];
scene.map = { events: [] };
scene.guard = { alive: false };
scene.game = {
    player: { mapX: 0, mapY: 0, direction: 2, inventory: [] },
    flags: { 'variable:7': 4 },
    data: {
        commandsAt: () => commands,
        transferAt: () => null,
        messageAt: () => null
    },
    showToast() {}
};

function changeItem(parameters) {
    commands = [{ code: 126, parameters }];
    scene.interact();
}

changeItem([1, 0, 0, 3]);
assert.equal(scene.game.player.inventory[0].amount, 3, 'Nhận số lượng hằng số');
changeItem([1, 0, 1, 7]);
assert.equal(scene.game.player.inventory[0].amount, 7, 'Nhận số lượng từ biến');
changeItem([1, 1, 0, 2]);
assert.equal(scene.game.player.inventory[0].amount, 5, 'Trừ số lượng hằng số');
changeItem([1, 1, 1, 7]);
assert.equal(scene.game.player.inventory[0].amount, 1, 'Trừ số lượng từ biến');
changeItem([1, 1, 0, 10]);
assert.equal(scene.game.player.inventory.length, 0, 'Xóa mục khi hết vật phẩm');
changeItem([2, 0, 0, 0]);
changeItem([2, 0, 1, 99]);
changeItem([2, 1, 0, 3]);
assert.equal(scene.game.player.inventory.length, 0, 'Không tạo mục rỗng');
changeItem([2, 1, 0, -3]);
assert.equal(scene.game.player.inventory[0].amount, 3, 'Phép trừ số âm nhận vật phẩm');
changeItem([2, 0, 0, -5]);
assert.equal(scene.game.player.inventory.length, 0, 'Phép cộng số âm trừ vật phẩm');
console.log('ĐẠT: event vật phẩm dùng đúng tham số gốc, cộng/trừ và xóa mục rỗng.');
