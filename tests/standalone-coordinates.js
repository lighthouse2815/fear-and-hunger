'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');

(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store });
    await engine.boot({ mapId: 74, x: 27, y: 28, direction: 8, party: [1] });
    const interpreter = engine.createInterpreter([], 39);
    assert.equal(interpreter.gameDataOperand(5, -1, 0), 27);
    assert.equal(interpreter.gameDataOperand(5, -1, 1), 28);
    assert.equal(interpreter.gameDataOperand(5, -1, 2), 8);
    assert.equal(interpreter.gameDataOperand(5, -1, 3), 792);
    assert.equal(interpreter.gameDataOperand(5, -1, 4), 618);
    engine.state.characterName = '!Object';
    assert.equal(interpreter.gameDataOperand(5, -1, 4), 624, 'object không nâng chân sprite 6 pixel');
    assert.equal(interpreter.gameDataOperand(5, 0, 0), engine.map.eventById(39).x);
    assert.equal(interpreter.gameDataOperand(5, 102, 1), 25);
    assert.equal(interpreter.gameDataOperand(5, 9999, 0), 0);
    assert.equal(engine.commonInterpreterFor(148).gameDataOperand(5, 0, 0), 0, 'common event tự chạy không có sự kiện đích');
    const nested = engine.createInterpreter([{ code: 117, parameters: [1] }], 39);
    nested.commonEvents = [null, { list: [{ code: 122, parameters: [500, 500, 0, 3, 5, 0, 0] }] }];
    await nested.run();
    assert.equal(engine.state.variableValue(500), engine.map.eventById(39).x, 'common được gọi giữ ngữ cảnh sự kiện gọi');
    engine.map.locateEvent(39, 9, 11, 6);
    assert.equal(interpreter.gameDataOperand(5, 0, 0), 9);
    await engine.restore(engine.save());
    assert.equal(engine.createInterpreter([], 39).gameDataOperand(5, 0, 1), 11, 'đọc vị trí đã lưu/tải');
    await engine.loadMap(1);
    assert.equal(interpreter.gameDataOperand(5, 0, 0), 0, 'không mượn sự kiện cùng ID ở map khác');
    assert.equal(interpreter.gameDataOperand(5, -1, 0), 27);
    assert.throws(() => interpreter.gameDataOperand(5, -1, 9), /Chưa hỗ trợ dữ liệu/);

    let count = 0;
    const files = (await fs.readdir(path.join(__dirname, '../game/data'))).filter(name => /^Map\d+\.json$/.test(name));
    for (const file of files) {
        await engine.loadMap(Number(file.slice(3, -5)));
        for (const event of engine.map.events) for (const page of event.pages) {
            const context = engine.createInterpreter([], event.id);
            for (const command of page.list) {
                const p = command.parameters;
                if (command.code !== 122 || p[3] !== 3 || p[4] !== 5) continue;
                const target = p[5] < 0 ? engine.state : engine.map.eventById(p[5] === 0 ? event.id : p[5]);
                assert.equal(context.gameDataOperand(p[4], p[5], p[6]), target ? target[['x', 'y', 'direction'][p[6]]] : 0,
                    file + ', sự kiện ' + event.id);
                count++;
            }
        }
    }
    assert.ok(count > 18000);
    console.log('ĐẠT: tọa độ/hướng/màn hình, ngữ cảnh common event, chuyển map/lưu và ' + count + ' lệnh tọa độ JSON.');
})().catch(error => { console.error(error); process.exitCode = 1; });
