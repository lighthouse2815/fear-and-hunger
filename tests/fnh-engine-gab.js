'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FNH = { Scene: class {} };
for (const file of ['gab', 'data', 'interpreter', 'scene_map']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../fnh-engine/js/' + file + '.js'), 'utf8'), { window: { FNH } });
}
const queue = new FNH.GabQueue();
queue.show('A'); queue.show('A'); queue.show('B');
assert.equal(queue.queue.length, 2);
queue.update(0);
assert.equal(queue.current, 'A');
queue.show('A');
assert.equal(queue.queue.length, 1);
queue.update(3);
assert.equal(queue.current, 'B');
queue.show('C', true);
assert.equal(queue.current, null);
assert.equal(queue.queue.length, 1);
queue.update(0);
assert.equal(queue.current, 'C');
queue.clear();
assert.equal(queue.busy, false);
const c = (text) => ({ code: 356, parameters: [text] });
const scene = new FNH.Scene_Map();
scene.game = { flags: {}, gold: 0, player: {}, data: new FNH.DataStore(), showToast() {} };
scene.map = { events: [] };
scene.input = { isPressed: () => false };
scene.startEventList({ list: [c('GabText Một câu đầy đủ'), c('ShowGab'), c('WaitForGab'), { code: 125, parameters: [0, 0, 5] }] }, 0);
assert.equal(scene.eventRunner.wait.type, 'gab');
scene.eventRunner.resume();
assert.equal(scene.eventRunner.wait.type, 'gab', 'Xác nhận không bỏ qua thời gian gab');
scene.updateEvent(0);
assert.equal(scene.game.gold, 0);
scene.game.gabs.update(0);
assert.equal(scene.game.gabs.current, 'Một câu đầy đủ');
scene.game.gabs.update(30);
scene.updateEvent(0);
assert.equal(scene.game.gold, 5);
assert.equal(scene.eventRunner, null);
// Hai parallel giữ nội dung riêng dù gặp chờ giữa GabText và ShowGab.
scene.map.events = [
    { id: 1, pages: [{ trigger: 4, list: [c('GabText A'), { code: 230, parameters: [60] }, c('ShowGab'), { code: 214 }] }] },
    { id: 2, pages: [{ trigger: 4, list: [c('GabText B'), c('ShowGab'), { code: 214 }] }] }
];
scene.updateParallelEvents(0);
assert.equal(scene.game.gabs.queue[0], 'B');
scene.updateParallelEvents(1);
assert.equal(scene.game.gabs.queue[1], 'A');
scene.startEventList({ list: [c('GabText C'), c('ForceGab'), c('ClearGab')] }, 0);
assert.equal(scene.game.gabs.busy, false);
scene.startEventList({ list: [c('UnsupportedPlugin data'), { code: 125, parameters: [0, 0, 100] }] }, 0);
assert.match(scene.game.lastError.message, /UnsupportedPlugin/);
assert.equal(scene.game.gold, 5, 'Plugin chưa hỗ trợ không được âm thầm bỏ qua');
console.log('ĐẠT: hàng đợi gab, chống lặp, force/clear/wait và ngữ cảnh parallel độc lập.');

scene.game.lastError = null;
scene.input.isPressed = () => false;
scene.startEventList({ list: [
    c('choice_text 1 ????'), c('disable_choice 1'),
    { code: 102, parameters: [['Ẩn', 'Mở', 'Khác'], -1, 0] },
    { code: 402, parameters: [0] }, { code: 125, parameters: [0, 0, 100], indent: 1 },
    { code: 402, parameters: [1] }, { code: 125, parameters: [0, 0, 2], indent: 1 },
    { code: 402, parameters: [2] }, { code: 125, parameters: [0, 0, 3], indent: 1 }, { code: 404 }
] }, 0);
assert.equal(scene.eventRunner.wait.choices[0], '????');
assert.equal(scene.eventChoice, 1, 'Mặc định chuyển sang đáp án mở');
assert.throws(() => scene.eventRunner.resume(0), /bị khóa/);
scene.input.isPressed = (key) => key === 'ArrowUp';
scene.updateEvent(0);
assert.equal(scene.eventChoice, 2, 'Di chuyển bỏ qua đáp án khóa');
scene.input.isPressed = (key) => key === 'Enter';
scene.updateEvent(0);
assert.equal(scene.game.gold, 8, 'Giữ nguyên ID nhánh khi khóa đáp án');
scene.input.isPressed = () => false;
scene.startEventList({ list: [{ code: 102, parameters: [['A', 'B'], -2, 0] }] }, 0);
assert.equal(scene.eventRunner.wait.disabled[0], false, 'Thiết lập chỉ dùng một lần');
assert.equal(scene.eventRunner.wait.choices[0], 'A');
scene.eventRunner.resume(-2);
scene.updateEvent(0);
scene.startEventList({ list: [c('disable_choice 1'), { code: 102, parameters: [['A'], -1, 0] }] }, 0);
assert.match(scene.game.lastError.message, /không có đáp án mở/);
scene.startEventList({ list: [c('disable_choice 1'), { code: 102, parameters: [['A'], -2, 0] }] }, 0);
assert.equal(scene.eventChoice, -1);
scene.input.isPressed = (key) => key === 'Escape';
scene.updateEvent(0);
assert.equal(scene.eventRunner, null, 'Vẫn có thể hủy khi mọi đáp án bị khóa');
console.log('ĐẠT: plugin đổi lời lựa chọn, khóa đáp án, bỏ qua khóa và giữ chỉ số nhánh.');
