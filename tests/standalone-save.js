'use strict';

const assert = require('node:assert/strict');
const { SaveStore } = require('../game/engine/save-store');

const values = new Map();
const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
};
const store = new SaveStore({ storage, prefix: 'test:' });
assert.equal(store.load(1), null);
assert.equal(store.info(1), null);
const payload = store.save(1, { mapId: 74, x: 3, switches: { 4: true } });
assert.equal(payload.version, 1);
assert.deepEqual(store.info(1), { savedAt: payload.savedAt, mapId: 74, party: [] });
assert.equal(store.exists(1), true);
assert.deepEqual(store.load(1), { mapId: 74, x: 3, switches: { 4: true } });
store.remove(1);
assert.equal(store.exists(1), false);
assert.throws(() => store.save(-1, {}), /Ô lưu không hợp lệ/);
storage.setItem('test:0', '{}');
assert.throws(() => store.load(0), /Ô lưu không tương thích/);
store.save(20, { mapId: 10, party: [3], actors: { 3: { name: 'Knight' } } });
assert.deepEqual(store.info(20).party, ['Knight']);
assert.equal(store.load(20).mapId, 10);
storage.setItem('test:2', '{');
assert.throws(() => store.info(2), /Ô lưu bị hỏng/);
assert.equal(store.load(20).mapId, 10, 'ô hỏng không ảnh hưởng ô khác');
console.log('ĐẠT: save store độc lập lưu, đọc, kiểm tra và xóa snapshot.');
