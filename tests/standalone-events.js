'use strict';

const assert = require('node:assert/strict');
const { GameState } = require('../game/engine/game-state');
const { EventInterpreter } = require('../game/engine/event-interpreter');

(async () => {
    const timerState = new GameState();
    const map166 = require('../game/data/Map166.json');
    const timerStart = map166.events[67].pages[0].list.find(command => command.code === 124 && command.parameters[0] === 0);
    const timerStop = map166.events[307].pages[0].list.find(command => command.code === 124 && command.parameters[0] === 1);
    await new EventInterpreter({ state: timerState, commands: [timerStart] }).run();
    assert.equal(timerState.timer.frames, 10800);
    timerState.timer.frames = 427;
    await new EventInterpreter({ state: timerState, commands: [timerStop] }).run();
    assert.deepEqual(timerState.timer, { active: false, frames: 427 }, 'dừng giữ thời gian còn lại');
    assert.deepEqual(new GameState(timerState.toJSON()).timer, timerState.timer, 'lưu giữ thời gian đã dừng');
    await new EventInterpreter({ state: timerState, commands: [timerStart] }).run();
    assert.deepEqual(timerState.timer, { active: true, frames: 10800 }, 'bắt đầu lại đặt thời gian mới');
    const arithmetic = new GameState();
    await new EventInterpreter({ state: arithmetic, commands: [
        { code: 122, parameters: [1, 1, 0, 0, 7] },
        { code: 122, parameters: [1, 1, 4, 0, 2] },
        { code: 122, parameters: [2, 2, 0, 0, -7] },
        { code: 122, parameters: [2, 2, 4, 0, 2] }
    ] }).run();
    assert.equal(arithmetic.variableValue(1), 3, 'chia dương làm tròn xuống');
    assert.equal(arithmetic.variableValue(2), -4, 'chia âm làm tròn xuống');
    const state = new GameState({ mapId: 74, gold: 10 });
    const messages = [];
    const commands = [
        { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
        { code: 401, indent: 0, parameters: ['Xin chào'] },
        { code: 121, indent: 0, parameters: [10, 10, 0] },
        { code: 122, indent: 0, parameters: [4, 4, 0, 0, 7] },
        { code: 123, indent: 0, parameters: ['A', 0] },
        { code: 125, indent: 0, parameters: [0, 0, 5] },
        { code: 126, indent: 0, parameters: [7, 0, 0, 2] },
        { code: 201, indent: 0, parameters: [0, 88, 4, 5, 2, 0] }
    ];
    const interpreter = new EventInterpreter({
        commands, state, mapId: 74, eventId: 3,
        handlers: { message: text => messages.push(text) }
    });
    const database = Object.fromEntries(['Actors', 'Classes', 'Weapons', 'Armors', 'States', 'Skills'].map(name =>
        [name, require('../game/data/' + name + '.json')]));
    const skillState = new GameState({ party: [1] }, database);
    const skillCondition = new EventInterpreter({ state: skillState, commands: [] });
    const hasSkill = id => skillCondition.evaluateCondition([4, 1, 3, id]);
    assert.equal(hasSkill(64), false);
    skillState.changeActorState(1, 27, true);
    assert.equal(hasSkill(64), true, 'state Salmonsnake thật cấp skill 64');
    assert.equal(hasSkill(82), true, 'state Salmonsnake thật cấp skill 82');
    const savedSkills = new GameState(skillState.toJSON(), database);
    assert.equal(new EventInterpreter({ state: savedSkills, commands: [] }).evaluateCondition([4, 1, 3, 64]), true);
    skillState.changeActorState(1, 27, false);
    assert.equal(hasSkill(64), false, 'bỏ state cũng bỏ skill tạm');
    skillState.changeActorSkill(1, 64, true);
    assert.equal(hasSkill(64), true, 'skill đã học vẫn được tính');
    const result = await interpreter.run();
    assert.deepEqual(messages, ['Xin chào']);
    assert.equal(state.switchValue(10), true);
    assert.equal(state.variableValue(4), 7);
    assert.equal(state.selfSwitchValue(74, 3, 'A'), true);
    assert.equal(state.gold, 15);
    assert.equal(state.itemCount('items', 7), 2);
    assert.deepEqual(result.transferred, { mapId: 88, x: 4, y: 5 });

    const conditionalState = new GameState();
    const conditional = new EventInterpreter({
        commands: [
            { code: 111, indent: 0, parameters: [0, 1, 0] },
            { code: 122, indent: 1, parameters: [2, 2, 0, 0, 9] },
            { code: 411, indent: 0, parameters: [] },
            { code: 122, indent: 1, parameters: [2, 2, 0, 0, 3] },
            { code: 412, indent: 0, parameters: [] }
        ], state: conditionalState
    });
    await conditional.run();
    assert.equal(conditionalState.variableValue(2), 3);

    conditionalState.setSwitch(1, true);
    const trueConditional = new EventInterpreter({
        commands: [
            { code: 111, indent: 0, parameters: [0, 1, 0] },
            { code: 122, indent: 1, parameters: [2, 2, 0, 0, 9] },
            { code: 411, indent: 0, parameters: [] },
            { code: 122, indent: 1, parameters: [2, 2, 0, 0, 3] },
            { code: 412, indent: 0, parameters: [] }
        ], state: conditionalState
    });
    await trueConditional.run();
    assert.equal(conditionalState.variableValue(2), 9);

    const choiceState = new GameState();
    const choiceMessages = [];
    const choices = new EventInterpreter({
        commands: [
            { code: 102, indent: 0, parameters: [['A', 'B'], -1] },
            { code: 402, indent: 0, parameters: [0, 'A'] },
            { code: 101, indent: 1, parameters: ['', 0, 0, 2] },
            { code: 401, indent: 1, parameters: ['đã chọn A'] },
            { code: 402, indent: 0, parameters: [1, 'B'] },
            { code: 101, indent: 1, parameters: ['', 0, 0, 2] },
            { code: 401, indent: 1, parameters: ['đã chọn B'] },
            { code: 404, indent: 0, parameters: [] }
        ], state: choiceState,
        handlers: { choice: async () => 1, message: text => choiceMessages.push(text) }
    });
    await choices.run();
    assert.deepEqual(choiceMessages, ['đã chọn B']);

    const effects = [];
    await new EventInterpreter({
        commands: [
            { code: 230, indent: 0, parameters: [12] },
            { code: 250, indent: 0, parameters: [{ name: 'door', volume: 90, pitch: 100, pan: 0 }] },
            { code: 356, indent: 0, parameters: ['Custom command'] }
        ], state: new GameState(),
        handlers: { effect: (code, parameters) => effects.push([code, parameters]) }
    }).run();
    assert.deepEqual(effects.map(entry => entry[0]), [230, 250, 356]);

    const actorDatabase = { Actors: require('../game/data/Actors.json'), Classes: require('../game/data/Classes.json') };
    const actorState = new GameState({ party: [] }, actorDatabase);
    actorState.addActor(1);
    const hpBefore = actorState.actor(1).hp;
    await new EventInterpreter({
        commands: [
            { code: 311, indent: 0, parameters: [0, 1, 1, 0, 10, true] },
            { code: 313, indent: 0, parameters: [0, 1, 0, 5] },
            { code: 314, indent: 0, parameters: [0, 1] }
        ], state: actorState
    }).run();
    assert.equal(actorState.actor(1).hp, hpBefore);
    assert.deepEqual(actorState.actor(1).states, []);
    actorState.changeActorMp(1, -63);
    actorState.changeActorState(1, 56, true);
    const actorReader = new EventInterpreter({ state: actorState, commands: [
        { code: 122, parameters: [30, 30, 0, 3, 3, 1, 3] }
    ] });
    await actorReader.run();
    assert.equal(actorState.variableValue(30), 37, 'common event đọc MP hiện tại của nhân vật');
    assert.equal(actorReader.evaluateCondition([4, 1, 6, 56]), true);
    assert.equal(actorReader.evaluateCondition([4, 1, 4, 44]), true);
    assert.equal(actorReader.evaluateCondition([4, 1, 5, 1]), true);
    assert.equal(actorReader.evaluateCondition([4, 1, 5, 54]), false);
    actorState.setVariable(7, 3);
    await new EventInterpreter({ state: actorState, commands: [
        { code: 122, parameters: [7, 8, 1, 1, 7] }
    ] }).run();
    assert.equal(actorState.variableValue(7), 6);
    assert.equal(actorState.variableValue(8), 3, 'toán hạng biến phải được đọc trước khi ghi cả dải');

    // Hai điều kiện cùng indent: Else của điều kiện sau không thuộc điều kiện trước.
    const branchState = new GameState({ mapId: 74, gold: 20 });
    await new EventInterpreter({ state: branchState, commands: [
        { code: 111, indent: 0, parameters: [0, 1, 0] },
        { code: 121, indent: 1, parameters: [9, 9, 0] },
        { code: 412, indent: 0, parameters: [] },
        { code: 121, indent: 0, parameters: [2, 2, 0] },
        { code: 111, indent: 0, parameters: [0, 2, 0] },
        { code: 121, indent: 1, parameters: [3, 3, 0] },
        { code: 411, indent: 0, parameters: [] },
        { code: 121, indent: 1, parameters: [4, 4, 0] },
        { code: 412, indent: 0, parameters: [] }
    ] }).run();
    assert.equal(branchState.switchValue(9), false);
    assert.equal(branchState.switchValue(2), true);
    assert.equal(branchState.switchValue(3), true);
    assert.equal(branchState.switchValue(4), false);

    const operands = new EventInterpreter({ state: branchState, random: () => 0.999, commands: [
        { code: 122, parameters: [7, 7, 0, 2, 1, 14] },
        { code: 125, parameters: [1, 1, 7] }
    ] });
    await operands.run();
    assert.equal(branchState.variableValue(7), 14);
    assert.equal(branchState.gold, 6, 'trừ vàng bằng toán hạng biến');
    assert.equal(operands.evaluateCondition([7, 5, 0]), true);
    assert.equal(operands.evaluateCondition([2, 'A', 1]), true, 'kiểm tra self-switch OFF');

    const loopState = new GameState();
    await new EventInterpreter({ state: loopState, commands: [
        { code: 112, indent: 0 },
        { code: 122, indent: 1, parameters: [1, 1, 1, 0, 1] },
        { code: 111, indent: 1, parameters: [1, 1, 0, 3, 1] },
        { code: 113, indent: 2 },
        { code: 412, indent: 1 },
        { code: 413, indent: 0 }
    ] }).run();
    assert.equal(loopState.variableValue(1), 3);
    await assert.rejects(new EventInterpreter({ state: new GameState(), maxSteps: 10, commands: [
        { code: 112, indent: 0 }, { code: 413, indent: 0 }
    ] }).run(), /giới hạn số lệnh/);

    await assert.rejects(new EventInterpreter({ state: new GameState(), commands: [
        { code: 999 }, { code: 121, parameters: [1, 1, 0] }
    ] }).run(), /Chưa hỗ trợ lệnh 999/);
    await assert.rejects(new EventInterpreter({ state: new GameState(), commands: [
        { code: 301, parameters: [0, 1, false, false] }
    ], handlers: { effect: () => false } }).run(), /Chưa hỗ trợ lệnh 301/);
    await assert.rejects(new EventInterpreter({ state: new GameState(), commands: [
        { code: 111, indent: 0, parameters: [12, 'return true'] }, { code: 412, indent: 0 }
    ] }).run(), /Chưa hỗ trợ điều kiện/);

    console.log('ĐẠT: event interpreter độc lập chạy hội thoại, điều kiện, state và chuyển map.');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
