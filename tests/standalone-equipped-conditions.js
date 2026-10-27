'use strict';
const assert = require('node:assert/strict');
const { GameState } = require('../game/engine/game-state');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const database = {
    Actors: require('../game/data/Actors.json'), Classes: require('../game/data/Classes.json'),
    Weapons: require('../game/data/Weapons.json'), Armors: require('../game/data/Armors.json')
};
const common = require('../game/data/CommonEvents.json');
const weapon = common[193].list.find(command => command.code === 111 && command.parameters[0] === 9).parameters;
const armor = common[248].list.find(command => command.code === 111 && command.parameters[0] === 10).parameters;
assert.deepEqual(weapon, [9, 1, true]); assert.deepEqual(armor, [10, 36, true]);
const state = new GameState({ party: [1, 2, 3, 4, 5] }, database);
const interpreter = new EventInterpreter({ state, commands: [] });
const condition = (parameters) => interpreter.evaluateCondition(parameters);
assert.equal(state.itemCount('weapons', 1), 0);
assert.equal(state.actor(4).equips[0], 1, 'Dark Priest mang Short sword thật');
assert.equal(condition(weapon), true, 'đang trang bị thỏa điều kiện CURSE WEAPONS');
assert.equal(condition([9, 1, false]), false, 'không tính trang bị khi cờ tắt');
state.actor(5).equips[4] = 36;
assert.equal(condition(armor), true, 'đồng đội dự bị đeo Crow Mauler soul thỏa điều kiện ngoài trận');
state.scene = 'battle'; assert.equal(condition(armor), false, 'dự bị không thuộc party tham chiến');
state.actor(3).equips[4] = 36; assert.equal(condition(armor), true, 'trang bị trong bốn người chiến đấu được tính');
assert.equal(condition([9, 36, true]), false, 'ID giáp không trùng thành vũ khí');
state.actor(3).equips[4] = 0; state.scene = 'map'; state.removeActor(5);
assert.equal(condition(armor), false, 'actor rời party không còn được tính');
state.addGuestActor(5); assert.equal(condition(armor), false, 'guest không thuộc party');
state.gainItem('armors', 36, 1); assert.equal(condition([10, 36, false]), true, 'đồ trong túi tính dù cờ tắt');
const saved = new GameState(state.toJSON(), database), restored = new EventInterpreter({ state: saved, commands: [] });
assert.equal(restored.evaluateCondition(weapon), true, 'điều kiện trang bị giữ sau save');
assert.equal(restored.evaluateCondition([10, 36, false]), true, 'điều kiện túi giữ sau save');
console.log('ĐẠT: điều kiện vũ khí/giáp thật tính trang bị theo party, trận, dự bị, guest và save.');
