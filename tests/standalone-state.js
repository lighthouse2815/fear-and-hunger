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
assert.equal(state.variableValue(4), 12.5);
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

console.log('ĐẠT: state engine độc lập quản lý công tắc, biến, self-switch và vật phẩm.');
