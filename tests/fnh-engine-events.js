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
    commands.forEach((command) => scene.executeEventCommand(command));
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

scene.eventId = 3;
scene.map.events = [{ id: 3, x: 0, y: 1 }];
commands = [{ code: 123, parameters: ['A', 0] }];
commands.forEach((command) => scene.executeEventCommand(command));
assert.equal(scene.game.flags['self:1:3:A'], true, 'Bật self-switch theo bản đồ');
commands[0].parameters[1] = 1;
commands.forEach((command) => scene.executeEventCommand(command));
assert.equal(scene.game.flags['self:1:3:A'], false, 'Tắt self-switch');
scene.game.mapId = 2;
commands[0].parameters[1] = 0;
commands.forEach((command) => scene.executeEventCommand(command));
assert.equal(scene.game.flags['self:2:3:A'], true);
assert.equal(scene.game.flags['self:1:3:A'], false, 'Không đổi self-switch bản đồ khác');

commands = [{ code: 122, parameters: [10, 12, 0, 2, 8, 8] }];
commands.forEach((command) => scene.executeEventCommand(command));
for (let id = 10; id <= 12; id += 1) {
    assert.equal(scene.game.flags['variable:' + id], 8, 'Ngẫu nhiên tôn trọng cận dưới và trên');
}

vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../fnh-engine/js/data.js'), 'utf8'), {
    window: { FNH }
});
const data = new FNH.DataStore();
const originalPage = { list: [
    { code: 101, parameters: [] },
    { code: 401, parameters: ['Cửa khóa'] }
] };
const unlockedPage = { conditions: { switch1Valid: true, switch1Id: 5 }, list: [
    { code: 101, parameters: [] },
    { code: 401, parameters: ['Cửa mở'] },
    { code: 201, parameters: [0, 2, 4, 6, 8] }
] };
const event = { id: 3, x: 0, y: 1, pages: [originalPage, unlockedPage] };
const map = { events: [null, event] };
assert.equal(data.messageAt(map, 0, 1, {}), 'Cửa khóa');
assert.equal(data.transferAt(map, 0, 1, {}), null, 'Cửa chưa đủ điều kiện không chuyển bản đồ');
const flags = { 'switch:5': true };
assert.equal(data.messageAt(map, 0, 1, flags), 'Cửa mở');
assert.equal(data.transferAt(map, 0, 1, flags).mapId, 2);
unlockedPage.list[2].parameters = [1, 20, 21, 22, 4];
Object.assign(flags, { 'variable:20': 7, 'variable:21': 9, 'variable:22': 11 });
const transfer = data.transferAt(map, 0, 1, flags);
assert.equal(transfer.mapId, 7, 'Đích chuyển bản đồ lấy từ biến');
assert.equal(transfer.x, 9);
assert.equal(transfer.y, 11);
assert.equal(transfer.direction, 4);
event.pages.push({ conditions: { selfSwitchValid: true, selfSwitchCh: 'A' }, list: [] });
assert.equal(data.eventPage(event, { 'self:2:3:A': true }, 2), event.pages[2]);
assert.equal(data.eventPage(event, { 'self:2:3:A': true }, 1), originalPage);
assert.equal(data.eventPage(event, { 'self:3:A': true }, 1), event.pages[2], 'Đọc self-switch save cũ ở bản đồ 1');
assert.equal(data.eventPage(event, { 'self:3:A': true }, 2), originalPage);
assert.equal(data.eventPage(event, { 'self:3:A': true, 'self:1:3:A': false }, 1), originalPage);
console.log('ĐẠT: điều kiện cửa, hội thoại, self-switch và biến ngẫu nhiên.');
