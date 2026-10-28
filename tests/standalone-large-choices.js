'use strict';
const assert = require('node:assert/strict');
const { GameState } = require('../game/engine/game-state');
const { EventInterpreter } = require('../game/engine/event-interpreter');
const common = require('../game/data/CommonEvents.json');
const database = { Actors: require('../game/data/Actors.json'), Classes: require('../game/data/Classes.json'),
    Weapons: require('../game/data/Weapons.json'), Armors: require('../game/data/Armors.json') };
const commands = common[193].list, before = JSON.stringify(commands);
(async () => {
    for (const [selected, weapon, reward, soulCost] of [[0, 1, 13, 1], [7, 10, 22, 2], [12, 38, 39, 1], [18, 0, 0, 0]]) {
        const state = new GameState({ party: [4] }, database); state.actor(4).equips[0] = weapon;
        state.gainItem('items', 116, 3); let shown = 0, info;
        const result = await new EventInterpreter({ state, commands, handlers: {
            message: () => {}, choice: (choices, cancel, interpreter, details) => { shown++; info = { choices, cancel, details }; return selected; }
        } }).run();
        assert.equal(shown, 1, 'các nhóm lựa chọn liền nhau chỉ mở một lần');
        assert.equal(info.choices.length, 19); assert.equal(info.cancel, -1); assert.equal(info.details.defaultIndex, 18);
        assert.equal(result.choices[0].selected, selected);
        if (weapon) {
            assert.equal(info.details.disabled.includes(selected), false);
            assert.equal(state.actor(4).equips[0], 0); assert.equal(state.itemCount('weapons', reward), 1);
            assert.equal(state.itemCount('items', 116), 3 - soulCost);
        } else {
            assert.equal(state.itemCount('items', 116), 3); assert.equal(state.switchValue(1901), false);
        }
        assert.equal(JSON.stringify(commands), before, 'không sửa nội dung JSON nguồn');
    }
    const list = [
        { code: 102, indent: 0, parameters: [['A'], -1, -1, 2, 0] },
        { code: 402, indent: 0, parameters: [0, 'A'] }, { code: 121, indent: 1, parameters: [1, 1, 0] }, { code: 404, indent: 0 },
        { code: 102, indent: 0, parameters: [['B'], -2, 0, 2, 0] },
        { code: 402, indent: 0, parameters: [0, 'B'] }, { code: 121, indent: 1, parameters: [2, 2, 0] },
        { code: 403, indent: 0 }, { code: 121, indent: 1, parameters: [3, 3, 0] }, { code: 404, indent: 0 },
        { code: 121, indent: 0, parameters: [4, 4, 0] }
    ];
    for (const [choice, expected] of [[0, 1], [1, 2], [-2, 3]]) {
        const state = new GameState(); let count = 0;
        await new EventInterpreter({ state, commands: list, handlers: { choice: (choices, cancel, interpreter, details) => {
            count++; assert.deepEqual(choices, ['A', 'B']); assert.equal(cancel, -2); assert.equal(details.defaultIndex, 1); return choice;
        } } }).run();
        assert.equal(count, 1); assert.equal(state.switchValue(expected), true); assert.equal(state.switchValue(4), true);
        for (const id of [1, 2, 3]) if (id !== expected) assert.equal(state.switchValue(id), false);
    }
    const savedList = JSON.parse(JSON.stringify(list));
    savedList.splice(2, 0, { code: 250, indent: 1, parameters: [{ name: 'save-point' }] });
    let snapshot, savedState, choicesShown = 0;
    const state = new GameState();
    await new EventInterpreter({ state, commands: savedList, handlers: {
        choice: () => { choicesShown++; return 0; }, effect: (code, params, command, interpreter) => {
            snapshot = interpreter.snapshot(); savedState = state.toJSON(); return true;
        }
    } }).run();
    const restoredState = new GameState(savedState);
    const restored = new EventInterpreter({ state: restoredState, commands: snapshot.commands, handlers: { choice: () => { throw new Error('Không được hỏi lại lựa chọn'); } } });
    Object.assign(restored, { index: snapshot.index, result: snapshot.result, choiceFrames: snapshot.choiceFrames,
        conditionFrames: snapshot.conditionFrames, loopFrames: snapshot.loopFrames, battleFrames: snapshot.battleFrames });
    await restored.run();
    assert.equal(choicesShown, 1); assert.equal(restoredState.switchValue(1), true);
    assert.equal(restoredState.switchValue(2), false); assert.equal(restoredState.switchValue(4), true, 'save giữ nhánh và bỏ các nhóm sau');
    console.log('ĐẠT: gộp lựa chọn thật 19 mục, các nhánh, mặc định/hủy và không đổi JSON.');
})().catch(error => { console.error(error); process.exitCode = 1; });
