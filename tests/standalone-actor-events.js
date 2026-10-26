'use strict';

const assert = require('node:assert/strict');
const { GameState } = require('../game/engine/game-state');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const { executeScript } = require('../game/engine/script-runtime');
const database = Object.fromEntries(['Actors', 'Classes', 'Weapons', 'Armors', 'States', 'Skills']
    .map(name => [name, require('../game/data/' + name + '.json')]));

(async () => {
    const state = new GameState({ party: [] }, database);
    state.addActor(1);
    const run = commands => new EventInterpreter({ state, commands }).run();
    assert.equal(state.actor(1).exp, 57, 'EXP khởi tạo của Mercenary level 2');
    await run([{ code: 315, parameters: [0, 1, 0, 0, 99, false] }]);
    assert.equal(state.actor(1).level, 2, 'EXP +99 trong mở đầu vẫn ở level 2');
    await run([{ code: 315, parameters: [0, 1, 0, 0, 1, false] }]);
    assert.equal(state.actor(1).level, 3);
    assert.equal(state.actor(1).hp, 70, 'lên level 3 dùng HP của JSON, không tự tăng HP');
    await run([{ code: 316, parameters: [0, 1, 1, 0, 1, false] }]);
    assert.equal(state.actor(1).level, 2);
    assert.equal(state.actor(1).exp, 57);
    assert.equal(state.actorParam(1, 2), 57, 'ATK class 30 cộng Scimitar 27');
    assert.equal(state.actorParam(1, 3), 36, 'DEF class 16 cộng giáp 20');
    await run([{ code: 317, parameters: [0, 1, 2, 0, 0, 5] }]);
    assert.equal(state.actorParam(1, 2), 62);
    await run([{ code: 318, parameters: [0, 1, 0, 40] }, { code: 318, parameters: [0, 1, 0, 40] }]);
    assert.equal(state.actor(1).skills.filter(id => id === 40).length, 1);
    await run([{ code: 318, parameters: [0, 1, 1, 40] }]);
    assert.equal(state.actor(1).skills.includes(40), false);
    await run([{ code: 319, parameters: [1, 1, 1] }]);
    assert.equal(state.actor(1).equips[0], 44, 'không tạo vũ khí khi túi không có');
    state.gainItem('weapons', 1, 1);
    await run([{ code: 319, parameters: [1, 1, 1] }]);
    assert.equal(state.itemCount('weapons', 1), 0);
    assert.equal(state.itemCount('weapons', 44), 1, 'đổi trang bị trả vũ khí cũ về túi');
    assert.equal(state.actorParam(1, 2), 45);
    await run([
        { code: 320, parameters: [1, 'Tên mới'] }, { code: 324, parameters: [1, 'Biệt danh'] },
        { code: 325, parameters: [1, 'Hồ sơ'] }, { code: 326, parameters: [0, 1, 0, 0, 130] },
        { code: 322, parameters: [1, '$knight', 0, 'Actor1', 2, 'knight1_1'] }
    ]);
    assert.equal(state.actor(1).name, 'Tên mới');
    assert.equal(state.actor(1).tp, 100);
    assert.equal(state.actor(1).characterName, '$knight');
    assert.equal(state.actor(1).nickname, 'Biệt danh');
    assert.equal(state.actor(1).profile, 'Hồ sơ');
    await run([{ code: 321, parameters: [1, 2, false] }]);
    assert.equal(state.actor(1).classId, 2);
    assert.equal(state.actor(1).level, 1);
    await run([{ code: 321, parameters: [1, 1, false] }]);
    assert.equal(state.actor(1).level, 2, 'quay lại class giữ EXP riêng của class trước');
    state.changeActorHp(1, -1000, false);
    assert.equal(state.actor(1).hp, 1);
    state.changeActorHp(1, -1000, true);
    assert.equal(state.actor(1).hp, 0);
    assert.equal(state.actor(1).states.includes(1), true);
    state.changeActorHp(1, 1000, true);
    assert.equal(state.actor(1).hp, 0, 'lệnh HP không tự hồi sinh người đã chết');
    state.changeActorState(1, 1, false);
    assert.equal(state.actor(1).hp, 1);
    state.recoverActor(1);
    assert.equal(state.actor(1).hp, 100);
    executeScript('$gameActors.actor(1).setMaxHp(50);', { state });
    state.changeActorExp(1, 1, true);
    assert.equal(state.actorParam(1, 0), 20, 'setMaxHp giữ hiệu chỉnh chỉ số khi JSON level mới thay base HP');
    const restored = new GameState(state.toJSON(), database);
    assert.deepEqual(restored.toJSON(), state.toJSON());

    const labels = new GameState();
    await new EventInterpreter({ state: labels, commands: [
        { code: 118, parameters: ['loop'] },
        { code: 122, parameters: [1, 1, 1, 0, 1] },
        { code: 111, indent: 0, parameters: [1, 1, 0, 3, 4] },
        { code: 119, indent: 1, parameters: ['loop'] },
        { code: 412, indent: 0 }, { code: 121, parameters: [1, 1, 0] }
    ] }).run();
    assert.equal(labels.variableValue(1), 3);
    assert.equal(labels.switchValue(1), true, 'nhảy nhãn xóa frame nhánh cũ để tiếp tục sau vòng');
    console.log('ĐẠT: EXP/level từ JSON, chỉ số/trang bị, kỹ năng, hình/tên, chết/hồi sinh và nhảy nhãn.');
})().catch(error => { console.error(error); process.exitCode = 1; });
