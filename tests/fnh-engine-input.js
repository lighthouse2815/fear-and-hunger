'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FNH = { Scene: class {} };
for (const file of ['data', 'interpreter', 'scene_map']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../fnh-engine/js/' + file + '.js'), 'utf8'), { window: { FNH } });
}
const c = (code, parameters = []) => ({ code, parameters });
const scene = new FNH.Scene_Map();
scene.game = { player: { inventory: [
    { id: 1, amount: 2 }, { id: 2, amount: 1 }, { id: 3, amount: 0 }, { id: 1, kind: 'weapon', amount: 3 }
] }, flags: { 'variable:5': 12 }, gold: 0, data: new FNH.DataStore(), showToast() {} };
scene.game.data.items = [null, { name: 'Vật phẩm', itypeId: 1 }, { name: 'Chìa', itypeId: 2 }, { name: 'Hết đồ', itypeId: 1 }];
scene.map = { events: [] };
scene.input = { isPressed: () => false };
function press(key) {
    scene.input.isPressed = (...keys) => keys.includes(key);
    scene.updateEvent(0);
    scene.input.isPressed = () => false;
}
scene.startEventList({ list: [c(103, [5, 3]), c(125, [0, 0, 1])] }, 0);
assert.equal(scene.eventRunner.wait.value, 12);
press('ArrowUp');
assert.equal(scene.eventRunner.wait.value, 112);
press('ArrowRight'); press('ArrowDown');
assert.equal(scene.eventRunner.wait.value, 102);
assert.equal(scene.game.flags['variable:5'], 12, 'Chưa xác nhận không ghi vào biến');
assert.throws(() => scene.eventRunner.resume(1000), /không hợp lệ/);
press('Escape');
assert.equal(scene.eventRunner.wait.type, 'number', 'Nhập số không cho hủy');
press('Enter');
assert.equal(scene.game.flags['variable:5'], 102);
assert.equal(scene.game.gold, 1);
scene.startEventList({ list: [c(104, [6, 1])] }, 0);
assert.equal(scene.eventRunner.wait.items.length, 1, 'Lọc đúng loại item, bỏ weapon và mục hết đồ');
assert.equal(scene.eventRunner.wait.items[0].id, 1);
assert.throws(() => scene.eventRunner.resume(2), /không hợp lệ/);
press('Enter');
assert.equal(scene.game.flags['variable:6'], 1);
assert.equal(scene.game.player.inventory[0].amount, 2, 'Chọn vật phẩm không tiêu thụ');
scene.startEventList({ list: [c(104, [6, 2])] }, 0);
press('Escape');
assert.equal(scene.game.flags['variable:6'], 0);
scene.startEventList({ list: [c(104, [7, 3])] }, 0);
assert.equal(scene.eventRunner.wait.items.length, 0);
press('ArrowDown'); press('Enter');
assert.equal(scene.game.flags['variable:7'], 0, 'Danh sách trống có thể đóng và trả về 0');
scene.game.flags['variable:8'] = -100;
scene.startEventList({ list: [c(103, [8, 2])] }, 0);
assert.equal(scene.eventRunner.wait.value, 0);
press('ArrowDown');
assert.equal(scene.eventRunner.wait.value, 90, 'Chữ số quay vòng độc lập');
press('Enter');
assert.equal(scene.game.flags['variable:8'], 90);
scene.game.flags['variable:9'] = 1000;
scene.startEventList({ list: [c(103, [9, 2])] }, 0);
assert.equal(scene.eventRunner.wait.value, 99);
press('Enter');
console.log('ĐẠT: nhập số, sửa từng chữ số, xác nhận biến và chọn/hủy vật phẩm theo loại.');
