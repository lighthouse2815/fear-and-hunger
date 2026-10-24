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
event.pages.push({ conditions: { itemValid: true, itemId: 8 }, list: [] });
assert.equal(data.eventPage(event, {}, 1), originalPage, 'Không chọn trang yêu cầu vật phẩm khi túi trống');
assert.equal(data.eventPage(event, {}, 1, { inventory: [{ id: 8, amount: 1 }] }), event.pages[3]);
assert.equal(data.eventPage(event, {}, 1, { inventory: [{ kind: 'weapon', id: 8, amount: 1 }] }), originalPage);
assert.equal(data.eventPage(event, {}, 1, { inventory: [{ id: 8, amount: 0 }] }), originalPage);
event.pages.push({ conditions: { actorValid: true, actorId: 3 }, list: [] });
assert.equal(data.eventPage(event, {}, 1, { id: 1 }), originalPage);
assert.equal(data.eventPage(event, {}, 1, { id: 3 }), event.pages[4], 'Trang yêu cầu nhân vật trong tổ đội hiện tại');
console.log('ĐẠT: điều kiện cửa, hội thoại, self-switch và biến ngẫu nhiên.');

scene.game.player.inventory = [];
for (const code of [126, 127, 128]) {
    scene.executeEventCommand({ code, parameters: [8, 0, 0, 3] });
}
assert.equal(scene.game.player.inventory.length, 3, 'Ba loại cùng ID không gộp chung');
for (const type of [8, 9, 10]) assert.equal(scene.eventCondition([type, 8, false]), true);
scene.executeEventCommand({ code: 126, parameters: [8, 1, 0, 9] });
assert.equal(scene.eventCondition([8, 8]), false, 'Vũ khí không được tính là vật phẩm');
assert.equal(scene.eventDataOperand(1, 8), 3);
assert.equal(scene.eventDataOperand(2, 8), 3);
scene.executeEventCommand({ code: 127, parameters: [8, 1, 1, 7, false] });
assert.equal(scene.eventCondition([9, 8, false]), false);
assert.equal(scene.eventDataOperand(2, 8), 3, 'Trừ vũ khí không thay đổi giáp cùng ID');
scene.game.player.equipment = [{ id: 8, type: 'weapon' }];
assert.equal(scene.eventCondition([9, 8, false]), false);
assert.equal(scene.eventCondition([9, 8, true]), true, 'Tùy chọn tính trang bị đang mặc');
assert.equal(scene.eventCondition([10, 99, true]), false);
let equipmentRefreshes = 0;
scene.game.data.refreshActor = () => { equipmentRefreshes += 1; };
scene.executeEventCommand({ code: 127, parameters: [8, 1, 0, 1, true] });
assert.equal(scene.game.player.equipment.length, 0, 'Trừ cả đồ đang mặc khi túi không đủ');
assert.equal(equipmentRefreshes, 1, 'Tính lại chỉ số sau khi tháo');
console.log('ĐẠT: túi đồ phân biệt vật phẩm, vũ khí, giáp và điều kiện trang bị.');
