'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () => JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.5, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 15, y: 22, direction: 8, party: [1] });
    const mpSkills = engine.database.Skills.filter(skill => skill && skill.damage.type === 2);
    // Cô lập công thức khỏi lặp đòn, chí mạng, dao động và hệ số nguyên tố.
    engine.database.Skills = engine.database.Skills.map(skill => skill && ({ ...skill, repeats: 1,
        damage: { ...skill.damage, variance: 0, critical: false, elementId: 0 } }));
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
    assert.equal(mpSkills.length, 8);
    for (const skill of mpSkills) {
        for (const mp of [0, 3]) {
            engine.state.recoverActor(1); reset(); engine.state.scene = 'battle';
            engine.state.changeActorMp(1, mp - engine.state.actor(1).mp);
            const report = engine.battle.useAction(engine.battle.enemy(0), skill, 0, false, true);
            const expected = Number(skill.damage.formula) ? mp : 0;
            assert.equal(report.damage, expected, `${skill.id}: chỉ báo lượng MP thực sự bị trừ`);
            assert.equal(report.hits.reduce((sum, hit) => sum + hit.damage, 0), expected);
            assert.equal(engine.state.actor(1).mp, mp - expected);
            const popups = engine.battle.battle.popups || [];
            assert.equal(popups.length, expected ? 1 : 0, `${skill.id}: MP cạn hoặc công thức 0 không tạo popup`);
            if (expected) assert.equal(popups[0].digits.map(digit => digit.digit).join(''), String(expected));
        }
    }
    engine.state.recoverActor(1); reset(); engine.state.scene = 'battle';
    engine.state.changeActorMp(1, -engine.state.actor(1).mp);
    const recovered = engine.battle.useAction(engine.battle.actor(1), engine.database.Items[30], 0, true, true);
    assert.ok(recovered.damage < -40, 'hồi MP không bị giới hạn bởi MP còn lại bằng 0');
    assert.equal(engine.state.actor(1).mp, -recovered.damage);
    assert.equal(engine.battle.battle.popups[0].row, 3);
    console.log('ĐẠT: tám skill MP thật chỉ báo lượng mất hiện có, lặp đòn không trừ dư, cạn MP không popup; hồi MP vẫn hoạt động từ 0.');
})().catch(error => { console.error(error); process.exitCode = 1; });
