'use strict';

const assert = require('node:assert/strict');
const actors = require('../game/data/Actors.json');
const classes = require('../game/data/Classes.json');
const { GameState } = require('../game/engine/game-state');

const database = { Actors: actors, Classes: classes };
const state = new GameState({ party: [] }, database);
state.addActor(1);
assert.equal(state.hasActor(1), true);
assert.equal(state.actor(1).name, 'Mercenary');
const maxHp = state.actor(1).hp;
assert.equal(maxHp > 0, true);
state.changeActorHp(1, -10, true);
assert.equal(state.actor(1).hp, maxHp - 10);
state.changeActorMp(1, 10);
state.changeActorState(1, 5, true);
assert.deepEqual(state.actor(1).states, [5]);
state.removeActor(1);
assert.equal(state.hasActor(1), false);

const snapshot = state.toJSON();
assert.deepEqual(new GameState(snapshot, database).toJSON(), snapshot);
console.log('ĐẠT: actor/party state độc lập tính chỉ số, HP/MP, trạng thái và save.');
