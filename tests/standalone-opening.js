'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const { EventScheduler } = require('../game/engine/event-scheduler');
const delay = () => new Promise(resolve => setImmediate(resolve));

(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    for (const [selection, actorId, switchId] of [[1, 1, 246], [2, 3, 242], [3, 4, 243], [4, 5, 244]]) {
        const engine = new GameEngine({ dataStore: store });
        await engine.boot();
        assert.equal(engine.map.id, 10);
        assert.deepEqual(engine.state.party, [1]);
        const errors = [];
        let namedActor, finishName;
        const scheduler = new EventScheduler(engine, { effect: (code, parameters) => {
            if (code === 250) return true; // Âm thanh thật được kiểm tra trên Chrome.
            if (code === 303) {
                namedActor = parameters[0];
                return new Promise(resolve => { finishName = resolve; });
            }
            return false;
        } }, error => errors.push(error));
        async function until(condition) {
            for (let frame = 0; frame < 1000 && !condition(); frame++) {
                scheduler.tick(); engine.advanceRoutes(1); await delay();
                if (errors.length) throw errors[0];
            }
            assert.ok(condition(), 'luồng mở đầu phải đạt trạng thái mong đợi');
        }
        await until(() => engine.state.switchValue(296));
        assert.equal(engine.state.menuEnabled, false);
        assert.equal(engine.state.screen.pictures[6].name, 'Actor1_1');
        for (let index = 1; index < selection; index++) {
            engine.buttons.add('right');
            await until(() => engine.state.variableValue(9) === index + 1);
            engine.buttons.delete('right');
            for (let frame = 0; frame < 12; frame++) { scheduler.tick(); engine.advanceRoutes(1); await delay(); }
        }
        engine.buttons.add('ok');
        await until(() => namedActor != null);
        engine.buttons.clear();
        assert.equal(namedActor, actorId);
        assert.equal(engine.state.switchValue(switchId), true);
        assert.equal(engine.eventRunning, true, 'nhập tên giữ khóa autorun');
        assert.equal(engine.state.itemCount('items', 5), 3);
        engine.state.actor(actorId).name = 'Schoolkid'; finishName();
        await until(() => engine.state.selfSwitchValue(10, 1, 'A'));
        assert.deepEqual(engine.state.party, [actorId]);
        assert.equal(engine.state.switchValue(2839), true, 'tên đặc biệt chạy nhánh JSON gốc');
        assert.ok(engine.state.actor(actorId).skills.includes(87));
        assert.equal(engine.state.switchValue(214), false);
        assert.equal(Object.keys(engine.state.screen.pictures).length, 0);
        scheduler.stop(); await delay();
        assert.equal(errors.length, 0);
    }
    console.log('ĐẠT: Map010 thật mở picture, chọn đủ bốn nhân vật, chờ tên và chạy nhánh tên đặc biệt.');
})().catch(error => { console.error(error); process.exitCode = 1; });
