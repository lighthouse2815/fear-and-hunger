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
    engine.battle.setup(troop.id, true, false);
    const base = engine.battle.enemy(0).hp;
    const result = engine.battle.attack(1, 0, 1);
    assert.equal(result.damage, Math.max(1, Math.round(engine.state.actorParam(1, 2) * 4 - engine.database.Enemies[1].params[3] * 2 - engine.database.Enemies[1].params[3] / 2)));
    assert.ok(engine.battle.enemy(0).hp < base);
    assert.throws(() => engine.battle.attack(1, 0, 999), /Công thức damage|Không tìm thấy/);
    console.log('ĐẠT: battle dùng công thức damage thật của Skills.json và tham số actor/enemy.');
})().catch(error => { console.error(error); process.exitCode = 1; });
