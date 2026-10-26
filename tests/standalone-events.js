'use strict';

const assert = require('node:assert/strict');
const { GameState } = require('../game/engine/game-state');
const { EventInterpreter } = require('../game/engine/event-interpreter');

(async () => {
    const state = new GameState({ mapId: 74, gold: 10 });
    const messages = [];
    const commands = [
        { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
        { code: 401, indent: 0, parameters: ['Xin chào'] },
        { code: 121, indent: 0, parameters: [10, 10, 0] },
        { code: 122, indent: 0, parameters: [4, 4, 0, 0, 7] },
        { code: 123, indent: 0, parameters: ['A', 0] },
        { code: 125, indent: 0, parameters: [0, 5, 0] },
        { code: 126, indent: 0, parameters: [7, 0, 0, 2] },
        { code: 201, indent: 0, parameters: [0, 88, 4, 5, 2, 0] }
    ];
    const interpreter = new EventInterpreter({
        commands, state, mapId: 74, eventId: 3,
        handlers: { message: text => messages.push(text) }
    });
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

    console.log('ĐẠT: event interpreter độc lập chạy hội thoại, điều kiện, state và chuyển map.');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
