'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FNH = { Scene: class {}, TILE: 48, WIDTH: 816, HEIGHT: 624 };
for (const name of ['interpreter', 'data', 'move_route', 'scene_map']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../fnh-engine/js/' + name + '.js'), 'utf8'), {
        window: { FNH }
    });
}

const command = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
let executed = [];
const handlers = {
    execute: (entry) => { executed.push(entry.parameters[0]); },
    condition: (p) => p[0],
    commonEvent: () => ({ list: [command(999, ['common']), command(115), command(999, ['unreachable'])] })
};
let runner = new FNH.EventInterpreter([
    command(111, [false]),
    command(999, ['wrong'], 1),
    command(111, [true], 1), command(999, ['wrong nested'], 2), command(412, [], 1),
    command(411), command(999, ['else'], 1), command(412),
    command(111, [true]), command(117, [1], 1),
    command(411), command(999, ['wrong else'], 1), command(412),
    command(999, ['after'])
], handlers);
runner.update(0);
assert.equal(executed.join(','), 'else,common,after', 'Nhánh lồng nhau và common event có con trỏ độc lập');
assert.equal(runner.done, true);

executed = [];
runner = new FNH.EventInterpreter([
    command(101, ['', 0]), command(401, ['Dòng 1']), command(401, ['Dòng 2']),
    command(999, ['after message']), command(230, [60]), command(999, ['after wait'])
], handlers);
runner.update(0);
assert.equal(runner.wait.text, 'Dòng 1\nDòng 2');
assert.equal(executed.length, 0, 'Không chạy lệnh sau hội thoại khi chưa xác nhận');
runner.resume();
runner.update(0);
assert.equal(executed.join(','), 'after message');
runner.update(0.5);
assert.equal(executed.length, 1);
runner.update(0.5);
assert.equal(executed.join(','), 'after message,after wait');

function choiceRunner() {
    return new FNH.EventInterpreter([
        command(102, [['A', 'B'], -2, 0]),
        command(402, [0]), command(999, ['A'], 1),
        command(402, [1]), command(999, ['B'], 1),
        command(403), command(999, ['cancel'], 1),
        command(404), command(999, ['end'])
    ], handlers);
}
for (const [selection, expected] of [[0, 'A,end'], [1, 'B,end'], [-2, 'cancel,end']]) {
    executed = [];
    runner = choiceRunner();
    runner.update(0);
    runner.resume(selection);
    runner.update(0);
    assert.equal(executed.join(','), expected, 'Chỉ thực thi nhánh được chọn');
}
runner = choiceRunner();
runner.update(0);
assert.throws(() => runner.resume(3), /không hợp lệ/);
runner.wait.cancel = -1;
assert.throws(() => runner.resume(-2), /không cho phép hủy/);

executed = [];
runner = new FNH.EventInterpreter([
    command(101, ['', 0, 0, 2]), command(401, ['Chọn đường đi?']),
    command(102, [['A', 'B'], -1, 0, 1, 0]),
    command(402, [0]), command(108, ['ChoiceHelp Đường thứ nhất'], 1),
    command(108, ['ChoiceMessage Mô tả A'], 1), command(999, ['A'], 1),
    command(402, [1]), command(108, ['ChoiceHelp Đường thứ hai'], 1),
    command(108, ['ChoiceMessage Mô tả B'], 1), command(999, ['B'], 1), command(404)
], { ...handlers, combineChoices: () => true });
runner.update(0);
assert.equal(runner.wait.type, 'choice', 'Lựa chọn gốc hiện cùng hội thoại, không cần xác nhận thêm');
assert.equal(runner.wait.message.text, 'Chọn đường đi?');
assert.equal(runner.wait.message.position, 2);
assert.equal(runner.wait.help[1], 'Đường thứ hai');
assert.equal(runner.wait.descriptions[0], 'Mô tả A');
runner.resume(1);
runner.update(0);
assert.equal(executed.join(','), 'B', 'Thông tin xem trước không thực thi nhánh chưa chọn');
console.log('ĐẠT: lựa chọn gốc gộp hội thoại, giữ vị trí và đọc mô tả từng nhánh.');

executed = [];
runner = new FNH.EventInterpreter([
    command(112), command(999, ['loop'], 1),
    command(112, [], 1), command(113, [], 2), command(413, [], 1),
    command(113, [], 1), command(413), command(999, ['after loop'])
], handlers);
runner.update(0);
assert.equal(executed.join(','), 'loop,after loop', 'Thoát đúng vòng lặp gần nhất');
runner = new FNH.EventInterpreter([command(112), command(413)], handlers);
runner.update(0);
assert.equal(runner.done, false, 'Vòng lặp vô hạn nhường lại frame cho trình duyệt');

executed = [];
runner = new FNH.EventInterpreter([
    command(119, ['end']), command(999, ['wrong']), command(118, ['end']), command(999, ['label'])
], handlers);
runner.update(0);
assert.equal(executed.join(','), 'label');
executed = [];
runner = new FNH.EventInterpreter([
    command(111, [true]), command(119, ['inside'], 1), command(999, ['wrong'], 1),
    command(118, ['inside'], 1), command(999, ['inside'], 1),
    command(411), command(999, ['wrong else'], 1), command(412)
], handlers);
runner.update(0);
assert.equal(executed.join(','), 'inside', 'Nhảy nhãn trong cùng nhánh giữ kết quả điều kiện');
runner = new FNH.EventInterpreter([command(117, [1])], {
    ...handlers, commonEvent: () => ({ list: [command(117, [1])] })
});
assert.throws(() => runner.update(0), /quá sâu/);
runner = new FNH.EventInterpreter([command(111, [false])], handlers);
assert.throws(() => runner.update(0), /thiếu lệnh kết thúc/);
runner = new FNH.EventInterpreter([command(201), command(999)], { ...handlers, execute: () => false });
runner.update(0);
assert.equal(runner.done, true, 'Dừng interpreter sau khi đổi cảnh');

// Kiểm tra tích hợp với cảnh bản đồ thật, không cần asset hoặc trình duyệt.
const scene = new FNH.Scene_Map();
scene.game = {
    mapId: 2, flags: {}, player: { inventory: [] }, gold: 0,
    data: new FNH.DataStore(), showToast() {}
};
scene.input = { isPressed: () => false };
const page = { list: [
    command(111, [0, 5, 0]), command(125, [0, 0, 100], 1),
    command(411), command(125, [0, 0, 3], 1), command(412),
    command(101, ['', 0]), command(401, ['Kiểm tra hội thoại']),
    command(123, ['A', 0])
] };
const event = { id: 4, x: 0, y: 1, pages: [page, {
    conditions: { selfSwitchValid: true, selfSwitchCh: 'A' }, list: [command(0)]
}] };
scene.map = { events: [null, event] };
assert.equal(scene.startEvent(event), true);
assert.equal(scene.game.gold, 3, 'Tích hợp cảnh không nhận vàng của nhánh sai');
assert.equal(scene.eventRunner.wait.type, 'message');
assert.equal(scene.game.flags['self:2:4:A'], undefined);
scene.eventRunner.resume();
scene.updateEvent(0);
assert.equal(scene.game.flags['self:2:4:A'], true);
assert.equal(scene.eventRunner, null);
assert.equal(scene.startEvent(event), false, 'Trang tự khóa được chọn sau khi chạy event');
assert.equal(scene.eventCondition([7, 3, 0]), true);
assert.equal(scene.eventCondition([2, 'A', 0]), true);
assert.throws(() => scene.eventCondition([12, 'script']), /Chưa hỗ trợ/);

const movement = new FNH.Scene_Map();
movement.guard.alive = false;
movement.game = {
    data: new FNH.DataStore(), mapId: 2, flags: {}, gold: 0,
    player: { id: 1, mapX: 0, mapY: 0, direction: 2, inventory: [] }, showToast() {}
};
movement.input = { isPressed: () => false };
movement.game.data.isTilePassable = () => true;
const npcPage = { priorityType: 1, trigger: 0, through: false, list: [command(125, [0, 0, 1])] };
const npc = { id: 1, x: 0, y: 1, pages: [npcPage] };
movement.map = { events: [null, npc] };
assert.equal(movement.tryMove(2), false, 'NPC chặn di chuyển');
assert.equal(movement.game.gold, 0, 'Va chạm không tự chạy event hành động');
movement.interact();
assert.equal(movement.game.gold, 1, 'Hành động kích hoạt NPC phía trước');
npcPage.trigger = 1;
movement.interact();
assert.equal(movement.game.gold, 1, 'Phím hành động không kích hoạt event chạm');
assert.equal(movement.tryMove(2), false);
assert.equal(movement.game.gold, 2, 'Va chạm kích hoạt event chạm');
npcPage.through = true;
assert.equal(movement.tryMove(2), true, 'Event xuyên qua không chặn di chuyển');
movement.finishMove();
npcPage.priorityType = 0;
npcPage.trigger = 0;
movement.interact();
assert.equal(movement.game.gold, 3, 'Hành động kích hoạt event dưới chân');
npcPage.trigger = 1;
assert.equal(movement.checkTransfer(), true, 'Chạm event dưới chân chạy interpreter');
assert.equal(movement.game.gold, 4);
npcPage.conditions = { switch1Valid: true, switch1Id: 1 };
assert.equal(movement.checkTransfer(), false, 'Không chạy event chưa đủ điều kiện');
Object.assign(movement.game.player, {
    level: 3, exp: 41, hp: 72, mp: 12, maxHp: 100, maxMp: 40,
    atk: 8, def: 9, mat: 10, mdf: 11, agi: 12, luk: 13,
    inventory: [{ id: 8, amount: 2 }, { id: 8, kind: 'weapon', amount: 1 }]
});
assert.equal(movement.eventDataOperand(0, 8, 0), 2);
assert.equal(movement.eventDataOperand(1, 8, 0), 1);
assert.equal(movement.eventDataOperand(2, 8, 0), 0);
for (const [index, value] of [3, 41, 72, 12, 100, 40, 8, 9, 10, 11, 12, 13].entries()) {
    assert.equal(movement.eventDataOperand(3, 1, index), value);
}
assert.equal(movement.eventDataOperand(5, -1, 0), 0);
assert.equal(movement.eventDataOperand(5, -1, 1), 1);
assert.equal(movement.eventDataOperand(5, -1, 2), 2);
assert.equal(movement.eventDataOperand(5, -1, 3), 24);
assert.equal(movement.eventDataOperand(5, -1, 4), 90);
movement.eventId = 1;
assert.equal(movement.eventDataOperand(5, 0, 1), 1, 'ID 0 dùng event đang thực thi');
assert.equal(movement.eventDataOperand(5, 1, 1), 1);
assert.equal(movement.eventDataOperand(5, 999, 0), 0);
assert.equal(movement.eventDataOperand(6, 0, 0), 1);
assert.equal(movement.eventDataOperand(6, 1, 0), 0);
assert.equal(movement.eventDataOperand(7, 0, 0), 2);
assert.equal(movement.eventDataOperand(7, 1, 0), 1);
assert.equal(movement.eventDataOperand(7, 2, 0), 4);
movement.game.playtime = 12.8;
assert.equal(movement.eventDataOperand(7, 4, 0), 12);
assert.throws(() => movement.eventDataOperand(7, 5, 0), /Chưa hỗ trợ/);
assert.throws(() => movement.eventDataOperand(3, 2, 0), /Chưa hỗ trợ/);
assert.equal(movement.eventCondition([4, 1, 0]), true);
assert.equal(movement.eventCondition([4, 2, 0]), false);
assert.equal(movement.eventCondition([6, -1, 2]), true);
assert.equal(movement.eventCondition([6, 999, 2]), false);
movement.executeEventCommand(command(122, [22, 23, 0, 3, 5, -1, 1]));
assert.equal(movement.game.flags['variable:22'], 1);
assert.equal(movement.game.flags['variable:23'], 1);
console.log('ĐẠT: nhánh, hội thoại, lựa chọn, chờ, common event, vòng lặp và tích hợp bản đồ.');

const automatic = new FNH.Scene_Map();
automatic.game = {
    mapId: 2, flags: {}, player: { mapX: 0, mapY: 0, direction: 2 }, gold: 0,
    data: new FNH.DataStore(), showToast() {}
};
automatic.input = { isPressed: () => false };
const autoPage = { trigger: 3, priorityType: 1, image: { characterName: 'Actor' }, list: [
    command(125, [0, 0, 5]), command(101), command(401, ['Tự chạy']),
    command(123, ['A', 0])
] };
const autoEvent = { id: 9, x: 0, y: 1, pages: [autoPage, {
    conditions: { selfSwitchValid: true, selfSwitchCh: 'A' }, trigger: 0, list: [command(0)]
}] };
automatic.map = { events: [null, autoEvent] };
assert.equal(automatic.startAutorun(), true);
assert.equal(automatic.game.gold, 5);
assert.equal(automatic.eventRunner.wait.type, 'message');
assert.equal(automatic.startEvent(autoEvent), false, 'Không thay thế interpreter đang chờ');
automatic.eventRunner.resume();
automatic.updateEvent(0);
assert.equal(automatic.startAutorun(), false, 'Self-switch kết thúc trang autorun');
assert.equal(automatic.game.gold, 5);

automatic.game.flags = {};
autoPage.list = [command(214), command(125, [0, 0, 2])];
assert.equal(automatic.startAutorun(), true);
assert.equal(automatic.game.gold, 7, 'Xóa event vẫn hoàn tất các lệnh còn lại');
assert.equal(automatic.events.length, 0, 'Event đã xóa không được vẽ');
assert.equal(automatic.startAutorun(), false);
assert.equal(automatic.startEvent(autoEvent), false);
automatic.game.data.isTilePassable = () => true;
automatic.guard.alive = false;
assert.equal(automatic.tryMove(2), true, 'Event đã xóa không còn chặn đường');
automatic.finishMove();
automatic.erasedEvents.clear();
assert.equal(automatic.startAutorun(), true, 'Event có thể xuất hiện khi tải lại bản đồ');

automatic.erasedEvents.clear();
autoPage.list = [command(999)];
assert.equal(automatic.startAutorun(), true);
assert.match(automatic.game.lastError.message, /Chưa hỗ trợ/);
assert.equal(automatic.startAutorun(), false, 'Không lặp lỗi autorun mỗi frame');
const replacement = { trigger: 3, list: [command(125, [0, 0, 1]), command(214)] };
autoEvent.pages.push(replacement);
assert.equal(automatic.startAutorun(), true, 'Trang mới vẫn chạy sau lỗi trang cũ');
assert.equal(automatic.game.gold, 10);
console.log('ĐẠT: autorun, hội thoại, tự khóa, xóa event và tránh lặp lỗi.');

const common = new FNH.Scene_Map();
common.game = {
    mapId: 2, flags: {}, player: {}, gold: 0,
    data: new FNH.DataStore(), showToast() {}
};
common.map = { events: [] };
common.input = { isPressed: () => false };
common.game.data.commonEvents = [null, { trigger: 1, switchId: 15, list: [
    command(125, [0, 0, 4]), command(230, [60]), command(121, [15, 15, 1])
] }];
assert.equal(common.startAutorun(), false, 'Common autorun chỉ chạy khi switch bật');
common.game.flags['switch:15'] = true;
assert.equal(common.startAutorun(), true);
assert.equal(common.eventId, 0, 'Common autorun không mượn ID event bản đồ');
assert.equal(common.game.gold, 4);
assert.equal(common.startAutorun(), false, 'Không khởi động lại common event đang chờ');
common.updateEvent(0.5);
assert.equal(common.game.flags['switch:15'], true);
common.updateEvent(0.5);
assert.equal(common.game.flags['switch:15'], false);
assert.equal(common.startAutorun(), false);
common.game.flags['switch:15'] = true;
assert.equal(common.startAutorun(), true, 'Bật lại switch chạy common autorun từ đầu');
assert.equal(common.game.gold, 8);
common.updateEvent(1);
common.game.data.commonEvents[1].list = [command(999)];
common.game.flags['switch:15'] = true;
assert.equal(common.startAutorun(), true);
assert.equal(common.startAutorun(), false, 'Common autorun lỗi không lặp mỗi frame');
common.eventId = 0;
common.executeEventCommand(command(123, ['A', 0]));
assert.equal(common.game.flags['self:2:0:A'], undefined);
assert.equal(common.eventCondition([2, 'A', 1]), false);
common.executeEventCommand(command(214));
assert.equal(common.erasedEvents.size, 0);
console.log('ĐẠT: common autorun theo switch, chờ, kích hoạt lại và ngữ cảnh riêng.');

const parallel = new FNH.Scene_Map();
parallel.game = {
    mapId: 2, flags: {}, player: { mapX: 0, mapY: 0 }, gold: 0,
    data: new FNH.DataStore(), showToast() {}
};
parallel.input = { isPressed: () => false };
const backgroundPage = { trigger: 4, list: [
    command(122, [1, 1, 1, 0, 1]), command(230, [60]), command(123, ['A', 0])
] };
const background = { id: 5, x: 1, y: 1, pages: [backgroundPage, {
    conditions: { selfSwitchValid: true, selfSwitchCh: 'A' }, trigger: 0, list: [command(0)]
}] };
parallel.map = { events: [null, background] };
parallel.eventId = 99;
parallel.moving = true;
parallel.updateParallelEvents(0);
assert.equal(parallel.moving, true, 'Khởi động parallel không kết thúc bước di chuyển');
assert.equal(parallel.eventRunner, null, 'Parallel không chiếm interpreter chính');
assert.equal(parallel.eventId, 99, 'Khôi phục ngữ cảnh chính sau cập nhật');
assert.equal(parallel.game.flags['variable:1'], 1);
parallel.updateParallelEvents(0.5);
assert.equal(parallel.game.flags['self:2:5:A'], undefined);
parallel.updateParallelEvents(0.5);
assert.equal(parallel.game.flags['self:2:5:A'], true, 'Self-switch dùng ID riêng của parallel');
parallel.updateParallelEvents(0);
assert.equal(parallel.parallelEvents.size, 0, 'Đổi trang dừng interpreter cũ');
assert.equal(parallel.game.flags['variable:1'], 1);

parallel.game.flags['switch:20'] = true;
const backgroundCommon = { id: 7, trigger: 2, switchId: 20, list: [
    command(125, [0, 0, 2]), command(230, [60]), command(125, [0, 0, 8])
] };
parallel.game.data.commonEvents = [null, backgroundCommon];
parallel.updateParallelEvents(0);
assert.equal(parallel.game.gold, 2);
parallel.game.flags['switch:20'] = false;
parallel.updateParallelEvents(2);
assert.equal(parallel.game.gold, 2, 'Tắt switch hủy common parallel đang chờ');
assert.equal(parallel.parallelEvents.size, 0);
parallel.game.flags['switch:20'] = true;
parallel.updateParallelEvents(0);
assert.equal(parallel.game.gold, 4, 'Bật lại switch chạy từ đầu');
parallel.updateParallelEvents(1);
assert.equal(parallel.game.gold, 12);
parallel.updateParallelEvents(0);
assert.equal(parallel.game.gold, 14, 'Parallel hoàn tất được lặp lại ở frame sau');
parallel.game.flags['switch:20'] = false;
parallel.updateParallelEvents(0);

const dialogPage = { trigger: 4, list: [command(101), command(401, ['Song song']), command(214)] };
const dialogEvent = { id: 6, pages: [dialogPage] };
parallel.map.events.push(dialogEvent);
parallel.updateParallelEvents(0);
const dialogContext = parallel.parallelEvents.get('map:6');
assert.equal(parallel.dialogRunner, dialogContext.eventRunner);
assert.equal(parallel.dialogState(), dialogContext);
parallel.moving = false;
const foregroundPage = { trigger: 0, list: [command(101), command(401, ['Chính']), command(125, [0, 0, 1])] };
parallel.map.events.push({ id: 8, pages: [foregroundPage] });
assert.equal(parallel.startEvent(parallel.map.events[3]), true);
assert.equal(parallel.eventRunner.wait, null, 'Hội thoại chính đợi parallel nhường khung thoại');
assert.equal(parallel.eventRunner.frames[0].index, 0, 'Không bỏ mất lệnh hội thoại đang đợi');
parallel.input.isPressed = (key) => key === 'Enter';
parallel.updateParallelEvents(0);
assert.equal(parallel.erasedEvents.has(6), true);
assert.equal(parallel.dialogRunner, null, 'Xóa parallel giải phóng khung thoại');
parallel.updateEvent(0);
assert.equal(parallel.eventRunner.wait.text, 'Chính');
assert.equal(parallel.game.gold, 14, 'Không dùng lại lần xác nhận cũ cho hội thoại vừa mở');
parallel.updateEvent(0);
assert.equal(parallel.game.gold, 15);
assert.equal(parallel.dialogRunner, null);

// Hai parallel độc lập: một lỗi không ngăn event khác chạy hoặc ghi sai self-switch.
parallel.input.isPressed = () => false;
parallel.map.events = [
    { id: 10, pages: [{ trigger: 4, list: [command(999)] }] },
    { id: 11, pages: [{ trigger: 4, list: [command(123, ['B', 0]), command(214)] }] }
];
parallel.updateParallelEvents(0);
assert.match(parallel.game.lastError.message, /Chưa hỗ trợ/);
assert.equal(parallel.game.flags['self:2:11:B'], true);
assert.equal(parallel.game.flags['self:2:10:B'], undefined);
const failedPage = parallel.map.events[0].pages[0];
assert.equal(parallel.failedAutorunPages.has(failedPage), true);
parallel.updateParallelEvents(0);
assert.equal(parallel.eventId, 8, 'Ngữ cảnh chính vẫn nguyên sau lỗi parallel');
console.log('ĐẠT: parallel bản đồ/common event, chờ độc lập, đổi trang, hội thoại và cô lập lỗi.');

const concurrent = new FNH.Scene_Map();
concurrent.game = {
    mapId: 3, flags: {}, player: {}, gold: 0, data: new FNH.DataStore(), showToast() {}
};
concurrent.input = { isPressed: () => false };
const choicesPage = (variable) => ({ trigger: 4, list: [
    command(102, [['A', 'B'], -1, 0]),
    command(402, [0]), command(122, [variable, variable, 0, 0, 1], 1),
    command(402, [1]), command(122, [variable, variable, 0, 0, 2], 1), command(404), command(214)
] });
concurrent.map = { events: [{ id: 1, pages: [choicesPage(1)] }, { id: 2, pages: [choicesPage(2)] }] };
concurrent.updateParallelEvents(0);
assert.equal(concurrent.dialogState().eventId, 1);
assert.equal(concurrent.parallelEvents.get('map:2').eventRunner.wait, null);
concurrent.input.isPressed = (key) => key === 'ArrowDown';
concurrent.updateParallelEvents(0);
concurrent.input.isPressed = (key) => key === 'Enter';
concurrent.updateParallelEvents(0);
assert.equal(concurrent.game.flags['variable:1'], 2);
assert.equal(concurrent.game.flags['variable:2'], undefined, 'Một phím không chọn hai hội thoại');
assert.equal(concurrent.dialogState().eventId, 2);
assert.equal(concurrent.dialogState().eventChoice, 0, 'Lựa chọn không bị rò sang event tiếp theo');
concurrent.updateParallelEvents(0);
assert.equal(concurrent.game.flags['variable:2'], 1);
assert.equal(concurrent.dialogRunner, null);

// Parallel vẫn cập nhật khi interpreter chính đang chờ; menu đóng băng tất cả.
concurrent.map.events = [{ id: 3, pages: [{ trigger: 4, list: [
    command(230, [30]), command(125, [0, 0, 3]), command(214)
] }] }];
concurrent.startEventList({ list: [command(230, [120])] }, 0);
const foreground = concurrent.eventRunner;
concurrent.ready = true;
concurrent.paused = true;
concurrent.updatePause = () => {};
concurrent.update(1);
assert.equal(concurrent.game.gold, 0);
assert.equal(foreground.wait.seconds, 2, 'Tạm dừng không làm giảm thời gian chờ');
concurrent.paused = false;
concurrent.updateEventImages = () => {};
concurrent.updateCamera = () => {};
concurrent.update(0);
concurrent.update(0.5);
assert.equal(concurrent.game.gold, 3, 'Parallel hoàn tất trong lúc event chính vẫn chờ');
assert.equal(concurrent.eventRunner, foreground);
assert.equal(foreground.wait.seconds, 1.5);
console.log('ĐẠT: chia sẻ khung thoại, lựa chọn riêng, chạy nền trong lúc chờ và tạm dừng.');

const positioning = new FNH.Scene_Map();
positioning.game = {
    mapId: 2, flags: { 'variable:1': 4, 'variable:2': 5 }, gold: 0,
    player: { mapX: 0, mapY: 0, direction: 2 }, data: new FNH.DataStore(), showToast() {}
};
positioning.guard.alive = false;
positioning.game.data.isTilePassable = () => true;
positioning.input = { isPressed: () => false };
const positionedPage = { trigger: 0, priorityType: 1, image: { characterName: 'Actor', direction: 2 },
    list: [command(125, [0, 0, 1])] };
const positionedEvent = { id: 1, x: 0, y: 1, pages: [positionedPage] };
positioning.map = { events: [null, positionedEvent, { id: 2, x: 8, y: 9, pages: [positionedPage] }] };
positioning.eventId = 1;
positioning.executeEventCommand(command(203, [0, 0, 3, 4, 8]));
assert.equal(positioning.eventDataOperand(5, 1, 0), 3);
assert.equal(positioning.eventDataOperand(5, 1, 1), 4);
assert.equal(positioning.eventCondition([6, 1, 8]), true);
assert.equal(positioning.events[0].x, 3, 'Hình ảnh dùng vị trí runtime');
assert.equal(positionedEvent.x, 0, 'Không sửa dữ liệu bản đồ đã cache');
assert.equal(positioning.tryMove(2), true, 'Ô cũ không còn NPC chặn');
positioning.finishMove();
positioning.executeEventCommand(command(203, [1, 1, 1, 2, 0]));
assert.equal(positioning.eventDataOperand(5, 1, 0), 4);
assert.equal(positioning.eventDataOperand(5, 1, 1), 5);
assert.equal(positioning.eventCondition([6, 1, 8]), true, 'Hướng 0 giữ hướng hiện tại');
positioning.executeEventCommand(command(203, [1, 2, 2, 0, 6]));
assert.equal(positioning.eventDataOperand(5, 1, 0), 8);
assert.equal(positioning.eventDataOperand(5, 2, 0), 4);
assert.equal(positioning.eventDataOperand(5, 2, 1), 5);
positioning.executeEventCommand(command(203, [1, 0, 0, 2, 2]));
assert.equal(positioning.tryMove(2), false, 'Va chạm dùng vị trí mới');
positioning.interact();
assert.equal(positioning.game.gold, 1, 'Tương tác dùng vị trí mới');
positionedPage.trigger = 1;
positioning.executeEventCommand(command(203, [-1, 0, 0, 2, 4]));
assert.equal(positioning.checkTransfer(), true, 'Event chạm dùng tọa độ runtime');
assert.equal(positioning.playerVisual.y, 2);
positioning.executeEventCommand(command(203, [1, 2, -1, 0, 0]));
positioning.executeEventCommand(command(203, [999, 0, 5, 5, 0]));
assert.equal(positioning.eventDataOperand(5, 1, 1), 2);
console.log('ĐẠT: định vị event bằng hằng số/biến, đổi chỗ, hướng, va chạm và tương tác.');

const animationToken = { done: false };
let continuedAfterAnimation = false;
const animationRunner = new FNH.EventInterpreter([{ code: 212 }, { code: 121 }], {
    execute: (cmd) => cmd.code === 212 ? { type: 'animation', animation: animationToken } : (continuedAfterAnimation = true)
});
animationRunner.update(0);
assert.equal(continuedAfterAnimation, false);
animationRunner.update(100);
assert.equal(continuedAfterAnimation, false, 'Chờ animation thật thay vì đoán thời gian tải asset');
animationToken.done = true;
animationRunner.update(0);
assert.equal(continuedAfterAnimation, true);
assert.equal(animationRunner.done, true);
console.log('ĐẠT: interpreter chờ vòng đời animation rồi tiếp tục đúng con trỏ.');

const nameToken = { done: false };
let nameAvailable = false, namesOpened = 0, afterName = false;
const nameRunner = new FNH.EventInterpreter([command(303, [1, 12]), command(125)], {
    canShowMessage: () => nameAvailable,
    execute: (cmd) => {
        if (cmd.code === 303) { namesOpened += 1; return { type: 'name', token: nameToken }; }
        afterName = true;
    }
});
nameRunner.update(0);
assert.equal(namesOpened, 0, 'Đặt tên chờ khung hội thoại chung rảnh');
nameAvailable = true;
nameRunner.update(0);
assert.equal(namesOpened, 1);
nameRunner.update(100);
assert.equal(afterName, false, 'Không bỏ qua nhập tên theo thời gian');
nameToken.done = true;
nameRunner.update(0);
assert.equal(afterName, true);
assert.equal(nameRunner.done, true);
console.log('ĐẠT: đặt tên khóa luồng event và tiếp tục đúng con trỏ sau xác nhận.');

const dialogue = new FNH.Scene_Map();
dialogue.game = { flags: { 'system:originalOpening': true }, assets: { imageCache: new Map() }, data: { system: {} } };
const windows = [];
FNH.drawWindow = (ctx, skin, rect) => windows.push(rect);
FNH.text = () => {};
const drawContext = { save() {}, restore() {}, measureText: (text) => ({ width: text.length * 14 }) };
for (const position of [0, 1, 2, undefined]) {
    windows.length = 0;
    dialogue.eventRunner = { wait: { type: 'message', text: 'Lời thoại', position } };
    dialogue.drawEventDialog(drawContext);
    assert.equal(windows[0].y + windows[0].height, FNH.HEIGHT, 'Ô lời thoại luôn sát đáy, kể cả event đặt ở giữa');
}
windows.length = 0;
dialogue.eventRunner = { wait: { type: 'choice', choices: ['Có', 'Không'], position: 2,
    message: { text: 'Tiếp tục?', position: 1 } } };
dialogue.eventChoice = 0;
dialogue.drawEventDialog(drawContext);
assert.equal(windows[0].y + windows[0].height, FNH.HEIGHT);
assert.ok(windows[1].y + windows[1].height <= windows[0].y, 'Lựa chọn nằm phía trên, không che ô lời thoại');
console.log('ĐẠT: lời thoại luôn nằm dưới màn hình và lựa chọn không chồng lên lời thoại.');
