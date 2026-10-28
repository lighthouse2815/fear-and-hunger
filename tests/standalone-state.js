'use strict';

const assert = require('node:assert/strict');
const { GameState } = require('../game/engine/game-state');

const state = new GameState({ mapId: 74, x: 12, y: 9, party: [1, 3] });
state.setSwitch(10, true);
state.setVariable(4, 12.5);
state.setSelfSwitch(74, 8, 'A', true);
state.gainItem('items', 7, 3);
state.gainItem('items', 7, -1);
state.gainItem('weapons', 2, 1);

assert.equal(state.mapId, 74);
assert.deepEqual(state.party, [1, 3]);
assert.equal(state.switchValue(10), true);
assert.equal(state.variableValue(4), 12);
state.setVariable(5, -1.1);
assert.equal(state.variableValue(5), -2, 'số âm làm tròn xuống như biến game gốc');
assert.equal(new GameState(state.toJSON()).variableValue(5), -2, 'lưu tải giữ giá trị đã làm tròn');
assert.equal(state.selfSwitchValue(74, 8, 'A'), true);
assert.equal(state.itemCount('items', 7), 2);
assert.equal(state.itemCount('weapons', 2), 1);
for (const kind of ['items', 'weapons', 'armors']) {
    state.gainItem(kind, 90, 98); state.gainItem(kind, 90, 2);
    assert.equal(state.itemCount(kind, 90), 99, kind + ' không cộng quá giới hạn gốc');
    state.gainItem(kind, 90, -1); assert.equal(state.itemCount(kind, 90), 98);
    state.gainItem(kind, 90, -1000); assert.equal(state.itemCount(kind, 90), 0);
}

const saved = state.toJSON();
saved.switches[10] = false;
assert.equal(state.switchValue(10), true, 'snapshot không được trỏ vào state đang chạy');
const restored = new GameState(state.toJSON());
assert.deepEqual(restored.toJSON(), state.toJSON());

assert.throws(() => state.switchValue(0), /ID công tắc không hợp lệ/);
assert.throws(() => state.setVariable(1, 'sai'), /Giá trị biến không hợp lệ/);
assert.throws(() => state.setSelfSwitch(74, 8, 'E', true), /Self-switch không hợp lệ/);
assert.throws(() => state.gainItem('gold', 1, 1), /Loại vật phẩm không hợp lệ/);

assert.equal(state.playTimeMs,0,'save cũ bắt đầu thời gian từ 0');
assert.equal(state.playTimeText(),'00:00:00');
for (const scene of ['map','battle','menu','save']) {
    state.scene=scene;state.advancePlayTime(1000.25);
}
assert.equal(state.playTimeMs,4001);
for (const scene of ['title','gameover']) {state.scene=scene;state.advancePlayTime(10000);}
assert.equal(state.playTimeMs,4001,'tiêu đề và Game Over không tính giờ chơi');
state.scene='map';
for (const invalid of [-1,NaN,Infinity,'1000',undefined]) state.advancePlayTime(invalid);
assert.equal(state.playTimeMs,4001);
state.advancePlayTime(360000000+359999);
assert.equal(state.playTimeText(),'100:06:04','không cuộn giờ về 0 sau 24/100 giờ');
assert.equal(new GameState(state.toJSON()).playTimeMs,state.playTimeMs,'lưu/tải không làm mất phần mili giây');
assert.equal(new GameState({playTimeMs:-100}).playTimeText(),'00:00:00');
assert.equal(new GameState({playTimeMs:'sai'}).playTimeMs,0);

console.log('ĐẠT: state quản lý công tắc, biến, self-switch, vật phẩm và thời gian chơi qua các scene/save cũ-mới.');
