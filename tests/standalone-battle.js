'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0 });
    await engine.boot({ mapId: 74, x: 15, y: 22, direction: 8, party: [1] });
    const troop = engine.database.Troops.find(item => item && item.members && item.members.length > 0);
    await engine.createInterpreter([{ code: 301, parameters: [0, troop.id, true, false] }], 1).run();
    assert.equal(engine.state.scene, 'battle'); assert.equal(engine.battle.battle.troopId, troop.id);
    const battle = engine.battle.setup(troop.id, true, false);
    assert.ok(battle.enemies.length > 0); assert.equal(battle.phase, 'input');
    const target = battle.enemies[0], before = target.hp;
    const attack = engine.battle.attack(1, 0);
    assert.ok(attack.damage > 0 && target.hp < before);
    engine.battle.enemyTurn(); assert.ok(battle.turn === 1);
    const snapshot = engine.save(); await engine.restore(snapshot);
    assert.equal(engine.state.battle.enemies[0].hp, target.hp, 'save/tải giữ trận');
    while (!engine.battle.battle.result) {
        const enemy = engine.battle.aliveEnemies()[0];
        engine.battle.attack(1, enemy.index);
        if (engine.battle.turn > 100) throw new Error('Trận không kết thúc');
    }
    assert.equal(engine.battle.battle.result, 'victory');
    const escape = engine.battle.setup(troop.id, true, false);
    assert.equal(engine.battle.escape(), true, 'random=0 chạy thoát');
    assert.equal(escape.result, 'escape');
    console.log('ĐẠT: battle core đọc troop/enemy thật, đánh mục tiêu, lượt địch, thắng, chạy thoát và save/tải.');
})().catch(error => { console.error(error); process.exitCode = 1; });
