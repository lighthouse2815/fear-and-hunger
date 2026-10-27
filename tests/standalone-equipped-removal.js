'use strict';
const assert = require('node:assert/strict');
const { GameState } = require('../game/engine/game-state');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const database = { Actors: require('../game/data/Actors.json'), Classes: require('../game/data/Classes.json'),
    Weapons: require('../game/data/Weapons.json'), Armors: require('../game/data/Armors.json') };
const common = require('../game/data/CommonEvents.json');
const curse = common[193].list.slice(135, 137);
assert.deepEqual(curse.map(command => command.parameters), [[1, 1, 0, 1, true], [13, 0, 0, 1, true]]);
async function run(state, commands) { await new EventInterpreter({ state, commands }).run(); }
(async () => {
    const state = new GameState({ party: [4] }, database);
    assert.equal(state.actor(4).equips[0], 1); assert.equal(state.itemCount('weapons', 1), 0);
    await run(state, curse);
    assert.equal(state.actor(4).equips[0], 0, 'Short sword đang đeo bị lấy khi nguyền');
    assert.equal(state.itemCount('weapons', 13), 1, 'nhận Cursed short sword thật');
    state.actor(4).equips[0] = 1; state.gainItem('weapons', 1, 1);
    await run(state, [curse[0]]);
    assert.equal(state.itemCount('weapons', 1), 0); assert.equal(state.actor(4).equips[0], 1, 'lấy túi trước trang bị');
    await run(state, [{ code: 127, parameters: [1, 1, 0, 1, false] }]);
    assert.equal(state.actor(4).equips[0], 1, 'cờ tắt không lấy trang bị');
    const group = new GameState({ party: [1, 2, 3, 4, 5] }, database);
    group.actor(1).equips[4] = 36; group.actor(3).equips[4] = 36; group.actor(5).equips[4] = 36;
    group.gainItem('armors', 36, 1); group.setVariable(7000, 3);
    await run(group, [{ code: 128, parameters: [36, 1, 1, 7000, true] }]);
    assert.equal(group.itemCount('armors', 36), 0); assert.equal(group.actor(1).equips[4], 0);
    assert.equal(group.actor(3).equips[4], 0); assert.equal(group.actor(5).equips[4], 36, 'dừng khi đủ số lượng');
    group.scene = 'battle'; await run(group, [{ code: 128, parameters: [36, 1, 0, 1, true] }]);
    assert.equal(group.actor(5).equips[4], 36, 'không lấy của dự bị trong trận');
    group.scene = 'map'; group.removeActor(5); group.addGuestActor(5);
    await run(group, [{ code: 128, parameters: [36, 1, 0, 1, true] }]);
    assert.equal(group.actor(5).equips[4], 36, 'không lấy trang bị guest');
    const saved = new GameState(state.toJSON(), database);
    assert.equal(saved.actor(4).equips[0], 1); assert.equal(saved.itemCount('weapons', 13), 1);
    console.log('ĐẠT: lệnh 127/128 lấy túi trước trang bị, tôn trọng party, battle, guest, biến và save.');
})().catch(error => { console.error(error); process.exitCode = 1; });
