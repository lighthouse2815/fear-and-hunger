'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FNH = { Scene: class {} };
for (const name of ['interpreter', 'data', 'scene_map']) {
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
console.log('ĐẠT: nhánh, hội thoại, lựa chọn, chờ, common event, vòng lặp và tích hợp bản đồ.');
