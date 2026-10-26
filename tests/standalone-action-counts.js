'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.5 });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1] });
    const db = engine.database, r = engine.battle;
    const expected = new Map([[1, 1], [11, 0], [121, 1], [143, 2], [191, 1], [242, 1], [270, 5], [283, 1]]);
    for (const [id, count] of expected) assert.equal(r.actionEffectCount(db.Skills[id]), count, db.Skills[id].name);
    // Dùng bộ đọc note thật làm đối chứng; không nạp runtime/plugin gốc vào engine.
    const source = await fs.readFile(path.join(__dirname, '../game/js/plugins/YEP_BattleEngineCore.js'), 'utf8');
    const from = source.indexOf('DataManager.processMELODYNotetags ='), to = source.indexOf('DataManager.processBECNotetags1 =');
    const reference = { DataManager: {}, Yanfly: { Param: { BECMotionWait: 'false' }, BEC: {} },
        $dataAnimations: JSON.parse(JSON.stringify(db.Animations)) };
    vm.createContext(reference);
    vm.runInContext('Array.prototype.contains = Array.prototype.includes;\n' + source.slice(from, to), reference);
    let compared = 0;
    for (const table of [db.Skills, db.Items]) {
        reference.group = JSON.parse(JSON.stringify(table));
        vm.runInContext('DataManager.processMELODYNotetags(group)', reference);
        for (const item of reference.group.filter(Boolean)) {
            const count = ['setupActions', 'wholeActions', 'targetActions', 'followActions', 'finishActions']
                .reduce((sum, key) => sum + item[key].filter(line => line[0].toUpperCase() === 'ACTION EFFECT').length, 0);
            assert.equal(r.actionEffectCount(table[item.id]), count, 'đối chiếu note ' + item.id);
            compared++;
        }
    }
    const enemyId = db.Enemies.length, troopId = db.Troops.length;
    db.Enemies.push({ ...db.Enemies[1], id: enemyId, params: [10000, 100, 10, 10, 10, 10, 10, 10], traits: [], actions: [] });
    db.Troops.push({ id: troopId, pages: [], members: [{ enemyId, x: 408, y: 400, hidden: false }] });
    const reset = () => { r.finish('escape'); engine.state.recoverActor(1); r.setup(troopId, true, true); engine.state.scene = 'battle'; };
    for (const [id, count] of expected) {
        reset(); const report = r.useSkill(r.actor(1), id, 0, true);
        const targetCount = id === 143 ? 2 : 1;
        assert.equal(report.hits.length, count * targetCount, 'số effect thực thi ' + id);
        assert.equal(db.Skills[id].repeats, id === 1 || id === 143 ? 3 : id === 270 ? 5 : 1, 'không sửa JSON tại chỗ');
    }
    reset();
    const originalWeapon = engine.state.actor(1).equips[0];
    engine.state.actor(1).equips[0] = 36;
    assert.equal(r.attackSkillId(r.actor(1)), 281, 'WeaponSkill đọc skill_id từ vũ khí');
    assert.equal(r.useSkill(r.actor(1), 1, 0).skillId, 281, 'Attack dùng kỹ năng do vũ khí chỉ định');
    assert.equal(r.useSkill(r.actor(1), 1, 0, true).skillId, 1, 'cưỡng chế giữ ID skill chỉ định như setSkill của runtime gốc');
    engine.state.actor(1).equips[0] = originalWeapon;
    reset(); const skillId = db.Skills.length;
    db.Skills.push({ ...db.Skills[3], id: skillId, repeats: 3, note: '', effects: [], hitType: 0,
        damage: { type: 1, formula: '10', critical: false, variance: 0, elementId: 0 } });
    assert.equal(r.useSkill(r.actor(1), skillId, 0, true).damage, 30, 'không có note thì giữ repeats gốc');
    db.Skills[skillId].note = '<Target Action>\nscript: globalThis.bad = true\n</Target Action>';
    db.Skills[skillId].mpCost = 20;
    const mp = engine.state.actor(1).mp, hp = r.enemy(0).hp;
    assert.throws(() => r.useSkill(r.actor(1), skillId, 0), /Lệnh action sequence chưa hỗ trợ/);
    assert.equal(engine.state.actor(1).mp, mp); assert.equal(r.enemy(0).hp, hp); assert.equal(globalThis.bad, undefined);
    console.log('ĐẠT: đối chiếu ' + compared + ' skill/item với bộ đọc note gốc; Attack/Pummel/Mad rush/Talk, phase whole-target, repeats và từ chối script lạ trước chi phí.');
})().catch(error => { console.error(error); process.exitCode = 1; });
