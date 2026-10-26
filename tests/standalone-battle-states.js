'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.99, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1] });
    const db = engine.database, skillId = db.Skills.length, enemyId = db.Enemies.length, troopId = db.Troops.length;
    db.Skills.push({ ...db.Skills[3], id: skillId, animationId: 0, hitType: 0, repeats: 1, successRate: 100,
        mpCost: 0, tpCost: 0, tpGain: 0, effects: [], damage: { type: 1, formula: '10', variance: 0, critical: false, elementId: 0 } });
    db.Enemies.push({ ...db.Enemies[1], id: enemyId, params: [1000, 100, 10, 10, 10, 10, 10, 10], traits: [], actions: [] });
    db.Troops.push({ id: troopId, pages: [], members: [{ enemyId, x: 408, y: 400, hidden: false }] });
    let r = engine.battle;
    const data = db.Skills[skillId];
    function reset() {
        r.finish('escape'); engine.animations.dispose(); engine.state.recoverActor(1);
        r.setup(troopId, true, true); engine.state.scene = 'battle';
        data.damage.type = 1; data.damage.formula = '10'; data.damage.critical = false;
    }
    const add = id => r.handleEffect(333, [0, 0, id]);
    const strike = () => r.useSkill(r.actor(1), skillId, 0);
    for (const id of [15, 22]) {
        reset(); add(id); r.enemy(0).hp = 700;
        const report = strike();
        assert.equal(report.damage, 699); assert.equal(r.enemy(0).hp, 1, db.States[id].name + ' giữ một HP');
        assert.equal(r.enemy(0).states.includes(id), false, 'removeByDamage chạy sau modifier');
        assert.equal(strike().defeated, true, 'đòn kế tiếp dùng damage bình thường');
    }
    reset(); engine.state.changeActorState(1, 15, true); engine.state.changeActorState(1, 2, true);
    const actorHp = engine.state.actor(1).hp;
    const incoming = r.useSkill(r.enemy(0), skillId, 0);
    assert.equal(incoming.damage, actorHp - 1); assert.equal(engine.state.actor(1).hp, 1, 'modifier chạy sau Guard');
    reset(); add(15); data.damage.type = 2;
    assert.equal(strike().damage, 999); assert.equal(r.enemy(0).mp, 0, 'note trả b.hp - 1 cũng áp dụng cho damage MP');
    reset(); add(15); data.damage.type = 3;
    assert.equal(strike().damage, 999); assert.equal(r.enemy(0).hp, 1, 'modifier là giá trị cuối, không tự đảo dấu hồi phục');
    reset(); add(23); data.damage.critical = true;
    assert.equal(strike().critical, true); assert.equal(r.enemy(0).hp, 970, 'Vulnerable buộc chí mạng dù RNG không trúng crit');
    r.handleEffect(333, [0, 1, 23]);
    assert.equal(strike().critical, false, 'hiệu ứng chỉ tồn tại trên mục tiêu đang Vulnerable');
    add(23); data.damage.critical = false;
    assert.equal(strike().critical, false, 'skill không cho crit giữ nguyên');
    data.damage.critical = true;
    assert.equal(r.damageValue(r.actor(1), r.enemy(0), data, false).damage, 10, 'dự báo AI không chạy select script');
    reset(); data.damage.formula = '9999999';
    assert.equal(strike().damage, 9999, 'giới hạn damage của DamageCore');
    reset(); data.damage.type = 3; data.damage.formula = '9999999';
    assert.equal(strike().damage, -9999, 'giới hạn hồi phục của DamageCore');

    reset(); engine.state.changeActorState(1, 22, true);
    assert.equal(engine.animations.entries.length, 1);
    assert.equal(engine.animations.entries[0].animationId, 22);
    assert.equal(engine.animations.entries[0].targetType, 'actor');
    engine.state.changeActorState(1, 22, true);
    assert.equal(engine.animations.entries.length, 1, 'thêm lại state không phát animation lần nữa');
    add(22); assert.equal(engine.animations.entries.length, 2);
    assert.equal(engine.animations.entries[1].targetType, 'enemy');
    r.handleEffect(333, [0, 1, 22]);
    db.Enemies[enemyId].traits.push({ code: 14, dataId: 22, value: 1 });
    add(22); assert.equal(engine.animations.entries.length, 2, 'state bị miễn nhiễm không phát animation');
    db.Enemies[enemyId].traits.pop();
    engine.advanceRoutes(16); const elapsed = engine.animations.entries[0].elapsed;
    await engine.restore(engine.save()); r = engine.battle;
    assert.equal(engine.animations.entries.length, 2); assert.equal(engine.animations.entries[0].elapsed, elapsed);
    assert.equal(engine.animations.entries[0].targetType, 'actor', 'save giữ animation state không tạo lại');
    engine.state.changeActorState(1, 22, false); engine.state.changeActorState(1, 22, true);
    assert.equal(engine.animations.entries.length, 3, 'callback hoạt động sau restore');
    const stateId = db.States.length;
    db.States.push({ ...db.States[22], id: stateId, note: '<state remove animation: 22 />' });
    engine.state.changeActorState(1, stateId, false); assert.equal(engine.animations.entries.length, 3);
    engine.state.changeActorState(1, stateId, true); assert.equal(engine.animations.entries.length, 3);
    engine.state.changeActorState(1, stateId, false); assert.equal(engine.animations.entries.length, 4);
    r.finish('escape'); engine.leaveBattle('escape'); assert.equal(engine.animations.entries.length, 0);
    engine.state.changeActorState(1, 22, true); assert.equal(engine.animations.entries.length, 0, 'không tạo sprite battler ngoài trận');

    reset();
    db.States[stateId].note = '<state damage modifier: defender>globalThis.unexpected = true;</state damage modifier>';
    add(stateId);
    assert.throws(strike, /Modifier sát thương state chưa hỗ trợ/);
    assert.equal(globalThis.unexpected, undefined, 'không eval code trong note');
    for (const state of db.States.filter(Boolean)) {
        const block = /<state damage modifier: defender>([\s\S]*?)<\/state damage modifier>/i.exec(state.note);
        if (block && state.id !== stateId) assert.match(block[1], /^\s*return b\.hp - 1\s*$/);
    }
    console.log('ĐẠT: Terror/Critical state, Vulnerable/crit cục bộ, cap HP/MP/hồi phục, animation thêm/xóa/miễn nhiễm/save và không eval note.');
})().catch(error => { console.error(error); process.exitCode = 1; });
