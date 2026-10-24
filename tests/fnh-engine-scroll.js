'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const FNH = {};
for (const file of ['core', 'interpreter', 'scene_map', 'scene_battle']) vm.runInNewContext(fs.readFileSync('fnh-engine/js/' + file + '.js', 'utf8'), { window: { FNH } });
const c = (code, parameters = []) => ({ code, parameters });
const scene = new FNH.Scene_Map();
const held = new Set();
scene.map = { events: [] };
scene.game = { flags: {}, gold: 0, player: { id: 1 }, data: {}, showToast(error) { throw new Error(error); } };
scene.input = { isPressed: () => false, isDown: (...keys) => keys.some((key) => held.has(key)), mouse: { down: false } };
const lines = [];
const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    measureText: (text) => ({ width: text.length * 12 }), fillText: (text, x, y) => lines.push([text, x, y]) };
scene.startEventList({ list: [c(105, [2, false]), c(405, ['Dòng đầu']), c(405, ['']),
    c(405, ['Dòng cuối ' + 'một đoạn văn dài '.repeat(15)]), c(125, [0, 0, 7])] }, 0);
const runner = scene.eventRunner, wait = runner.wait;
assert.equal(wait.type, 'scroll');
assert.ok(wait.text.includes('Dòng đầu\n\nDòng cuối'));
assert.equal(wait.height, null);
scene.updateEvent(1);
assert.equal(wait.offset, 0, 'Chờ bộ dựng đo chiều cao thật trước khi cuộn');
scene.drawEventDialog(ctx);
assert.ok(wait.height > 108, 'Đo cả dòng trống và dòng xuống hàng tự động');
assert.equal(lines[0][2], FNH.HEIGHT, 'Bắt đầu bên dưới khung nhìn');
scene.updateEvent(1);
assert.equal(wait.offset, 60, 'Tốc độ gốc là speed/2 pixel mỗi frame ở 60 fps');
held.add('Enter');
scene.updateEvent(1);
assert.equal(wait.offset, 240, 'Giữ xác nhận tăng tốc ba lần');
runner.resume();
assert.equal(runner.wait, wait, 'Xác nhận không bỏ qua văn bản cuộn');
held.clear();
scene.input.mouse.down = true;
scene.updateEvent(1);
assert.equal(wait.offset, 420, 'Giữ chuột cũng tăng tốc');
scene.input.mouse.down = false;
wait.noFastForward = true;
held.add('Shift');
scene.updateEvent(1);
assert.equal(wait.offset, 480, 'Cờ no-fast vô hiệu hóa tăng tốc');
scene.ready = true;
scene.paused = true;
scene.updatePause = () => {};
scene.update(1);
assert.equal(wait.offset, 480, 'Tạm dừng đóng băng vị trí cuộn');
scene.paused = false;
let afterBlocked = false;
const blocked = new FNH.EventInterpreter([c(105, [2, true]), c(405, ['Event khác']), c(125)], {
    canShowMessage: () => !scene.dialogRunner,
    execute: () => { afterBlocked = true; }
});
blocked.update(1);
assert.equal(blocked.wait, null);
assert.equal(blocked.frames[0].index, 0, 'Event khác chờ quyền dùng khung hội thoại');
assert.equal(scene.game.gold, 0);
wait.offset = FNH.HEIGHT + wait.height - 1;
scene.updateEvent(1);
assert.equal(scene.eventRunner, null);
assert.equal(scene.dialogRunner, null);
assert.equal(scene.game.gold, 7, 'Chỉ chạy lệnh kế tiếp khi dòng cuối đã ra khỏi màn hình');
blocked.update(0);
assert.equal(blocked.wait.type, 'scroll');
assert.equal(blocked.wait.noFastForward, true);
assert.equal(afterBlocked, false);
let afterEmpty = false;
const empty = new FNH.EventInterpreter([c(105, [2, false]), c(125)], { execute: () => { afterEmpty = true; } });
empty.update(0);
assert.equal(afterEmpty, true);
assert.equal(empty.done, true);
console.log('ĐẠT: văn bản cuộn, đo dòng, tốc độ, tăng tốc, no-fast, tạm dừng và khóa hội thoại.');

const battle = new FNH.Scene_Battle();
battle.game = { player: { id: 1 }, flags: {}, gold: 0, reservedCommonEvent: 1,
    data: { maps: new Map(), commonEvents: [null, { list: [c(105, [2, false]), c(405, ['Văn bản trong trận']), c(125, [0, 0, 5])] }] },
    showToast(error) { throw new Error(error); } };
battle.input = scene.input;
battle.updateCommonEvent(0);
assert.equal(battle.commonEventContext.eventRunner.wait.type, 'scroll');
battle.commonEventContext.drawEventDialog(ctx);
assert.ok(battle.commonEventContext.eventRunner.wait.height > 0);
battle.updateCommonEvent(100);
assert.equal(battle.commonEventContext.eventRunner, null);
assert.equal(battle.game.gold, 5);
console.log('ĐẠT: common event trong trận cuộn văn bản rồi tiếp tục lệnh kế tiếp.');
