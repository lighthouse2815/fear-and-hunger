'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () => JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store });
    await engine.boot({ mapId: 74, x: 15, y: 22, direction: 8, party: [1] });
    const troop = engine.database.Troops.find(item => item && item.members && item.members.length);
    function reset() {
        if (engine.battle.battle && !engine.battle.battle.result) engine.battle.finish('escape');
        engine.battle.setup(troop.id, true, false);
    }
    reset();
    assert.throws(() => engine.battle.attack(1, 0, 999), /Công thức damage|Không tìm thấy/);
    const base = engine.battle.enemy(0).hp;
    const result = engine.battle.attack(1, 0, 1);
    assert.equal(result.damage, engine.state.actorParam(1, 2) * 4 - engine.database.Enemies[1].params[3] * 2,
        'Attack chỉ trừ phòng thủ trong công thức JSON một lần');
    assert.equal(engine.battle.enemy(0).hp, base - result.damage);
    reset();
    assert.equal(engine.battle.attack(1, 0, 3).damage, 35, 'Hack có công thức cố định 35, không trừ thêm phòng thủ');
    reset();
    const before = engine.battle.enemy(0).hp;
    assert.equal(engine.battle.attack(1, 0, 5).damage, 0, 'kỹ năng không gây damage không làm mất 1 HP');
    assert.equal(engine.battle.enemy(0).hp, before);
    reset();
    engine.state.changeActorParam(1, 2, -999);
    assert.equal(engine.battle.attack(1, 0, 1).damage, 0, 'công thức âm không làm mất HP');
    assert.equal(engine.battle.enemy(0).hp, before);
    console.log('ĐẠT: công thức Attack/Hack thật không trừ phòng thủ hai lần; sát thương bằng 0 hoặc âm giữ nguyên HP.');
})().catch(error => { console.error(error); process.exitCode = 1; });
