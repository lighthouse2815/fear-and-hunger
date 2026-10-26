'use strict';

const assert = require('node:assert/strict');
const actors = require('../game/data/Actors.json');
const classes = require('../game/data/Classes.json');
const { GameState } = require('../game/engine/game-state');
const { ActorState } = require('../game/engine/actor-state');

const database = { Actors: actors, Classes: classes };
const state = new GameState({ party: [] }, database);
state.addActor(1);
assert.equal(state.hasActor(1), true);
assert.equal(state.actor(1).name, 'Mercenary');
assert.deepEqual(state.actor(1).equips, [44, 0, 0, 1, 0]);
assert.equal(state.actor(1).classId, 1);
const levelThree = new ActorState(actors[1], classes[1], { level: 3 });
assert.equal(levelThree.hp, 70, 'bảng chỉ số được đánh chỉ mục bằng level');
assert.equal(state.actor(4).mp, 100);
assert.equal(state.hasActor(4), false, 'đọc actor ngoài party không được tự thêm vào party');
const maxHp = state.actor(1).hp;
assert.equal(maxHp > 0, true);
state.changeActorHp(1, -10, true);
assert.equal(state.actor(1).hp, maxHp - 10);
state.changeActorMp(1, 10);
state.actor(1).name = 'Tên đã lưu';
state.changeActorHp(1, -1, true);
assert.equal(state.actor(1).name, 'Tên đã lưu', 'cập nhật HP không được ghi đè tên đã lưu');
state.changeActorState(1, 5, true);
assert.deepEqual(state.actor(1).states, [5]);
state.removeActor(1);
assert.equal(state.hasActor(1), false);

const snapshot = state.toJSON();
assert.deepEqual(new GameState(snapshot, database).toJSON(), snapshot);
console.log('ĐẠT: actor/party state độc lập tính chỉ số, HP/MP, trạng thái và save.');
