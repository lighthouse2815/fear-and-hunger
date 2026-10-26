'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const watchdog = setTimeout(() => { console.error('Kỹ năng chưa kết thúc trong thời hạn kiểm thử.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.5, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1, 3] });
    function reset() {
        engine.animations.dispose();
        engine.battle.finish('escape'); engine.state.party.forEach(id => engine.state.recoverActor(id));
        engine.battle.setup(1, true, true); engine.state.scene = 'battle';
    }
    async function finish(promise) {
        let done = false, failure, value;
        promise.then(result => { value = result; done = true; }, error => { failure = error; done = true; });
        for (let i = 0; i < 1000 && !done; i++) { engine.advanceRoutes(16); await flush(); }
        assert.equal(done, true, 'hành động phải kết thúc sau đủ frame');
        if (failure) throw failure;
        return value;
    }
    const runtime = engine.battle;
    const commonId = engine.database.CommonEvents.length;
    engine.database.CommonEvents.push({ id: commonId, list: [{ code: 122, parameters: [6210, 6210, 1, 0, 1] }] });
    const id = engine.database.Skills.length;
    engine.database.Skills.push({ ...engine.database.Skills[3], id, name: 'Kỹ năng kiểm thử', animationId: 7, hitType: 0,
        successRate: 100, repeats: 2, mpCost: 10, tpCost: 5, tpGain: 3, scope: 1,
        damage: { type: 1, formula: '10', elementId: 0, variance: 0, critical: false },
        effects: [{ code: 21, dataId: 2, value1: 1 }, { code: 44, dataId: commonId }] });
    reset();
    engine.state.actor(1).tp = 20;
    let hp = runtime.enemy(0).hp, mp = engine.state.actor(1).mp;
    const report = runtime.useSkill(runtime.actor(1), id, 0);
    assert.equal(report.damage, 15, 'đòn thứ hai giảm một nửa vì state Guard của đòn thứ nhất');
    assert.equal(runtime.enemy(0).hp, hp - 15);
    assert.equal(engine.state.actor(1).mp, mp - 10); assert.equal(engine.state.actor(1).tp, 21, 'trả 5 TP rồi nhận 3 TP cho mỗi effect trúng');
    assert.deepEqual(report.commonEvents, [commonId], 'common event chỉ một lần dù lặp đòn');
    let completed = false;
    const completing = engine.completeBattleSkill(report).then(() => { completed = true; });
    await flush(); assert.equal(completed, false); assert.equal(engine.state.variableValue(6210), 0);
    await finish(completing); assert.equal(engine.state.variableValue(6210), 1);
    engine.state.actor(1).mp = 0;
    assert.throws(() => runtime.useSkill(runtime.actor(1), id, 0), /Chưa thể dùng/);
    const force = p => engine.createInterpreter([{ code: 339, parameters: p },
        { code: 121, parameters: [6211, 6211, 0] }], 0).run();
    engine.state.setSwitch(6211, false);
    const forced = force([1, 1, id, 0]); await flush();
    assert.equal(engine.state.switchValue(6211), false, '339 phải chờ animation và common event');
    assert.equal(runtime.battle.phase, 'action');
    await assert.rejects(engine.battleAttack(1, 0), /Chưa đến lượt/);
    await finish(forced);
    assert.equal(engine.state.actor(1).mp, 0, 'cưỡng chế vẫn chạy khi không đủ MP và không trừ âm');
    assert.equal(engine.state.switchValue(6211), true); assert.equal(runtime.battle.phase, 'input');
    assert.equal(engine.state.variableValue(6210), 2);

    // Kiểm tra các hệ số độc lập với common event và animation.
    reset();
    const neutralId = engine.database.Skills.length;
    const neutral = { ...engine.database.Skills[id], id: neutralId, animationId: 0, repeats: 1,
        mpCost: 0, tpCost: 0, tpGain: 0, effects: [], damage: { type: 1, formula: '20', elementId: 0, variance: 0, critical: false } };
    engine.database.Skills.push(neutral);
    assert.equal(runtime.useSkill(runtime.actor(1), neutralId, 0).damage, 20);
    neutral.damage.elementId = 2; neutral.damage.variance = 20; runtime.random = () => 0.75;
    assert.equal(runtime.useSkill(runtime.actor(1), neutralId, 0).damage, 25, 'nguyên tố nhân trước dao động và làm tròn');
    neutral.damage = { ...neutral.damage, elementId: 0, variance: 0, critical: true }; runtime.random = () => 0.01;
    assert.equal(runtime.useSkill(runtime.actor(1), neutralId, 0).damage, 60, 'chí mạng nhân ba');
    neutral.hitType = 1; runtime.random = () => 0.99;
    assert.equal(runtime.useSkill(runtime.actor(1), neutralId, 0).hits[0].missed, true);
    runtime.random = () => 0.01;
    assert.equal(runtime.useSkill(runtime.actor(1), neutralId, 1).hits[0].evaded, true, 'đầu Guard có né 55%');
    runtime.random = () => 0.5; neutral.hitType = 0; neutral.damage.critical = false;
    engine.state.changeActorHp(1, -80, true); runtime.syncActors();
    neutral.scope = 11; neutral.damage.type = 3;
    runtime.useSkill(runtime.actor(1), neutralId, -1);
    assert.equal(engine.state.actor(1).hp, 40, 'hồi HP không biến thành sát thương');
    neutral.scope = 1; neutral.damage.type = 5;
    runtime.useSkill(runtime.actor(1), neutralId, 0);
    assert.equal(engine.state.actor(1).hp, 60, 'hút HP hồi cho chủ thể');
    neutral.damage.type = 2;
    const targetMp = engine.state.actor(3).mp;
    runtime.useSkill(runtime.enemy(0), neutralId, 1, true);
    assert.equal(engine.state.actor(3).mp, targetMp - 20, 'sát thương MP không trừ HP');
    neutral.damage.type = 0; neutral.effects = [{ code: 21, dataId: 49, value1: 1 }];
    runtime.useSkill(runtime.actor(1), neutralId, 0);
    assert.equal(runtime.enemy(0).states.includes(49), false, 'miễn nhiễm state không bị bỏ qua');

    reset();
    await finish(force([0, 0, id, 1]));
    assert.equal(runtime.battle.lastAction.subject, 'enemy');
    assert.equal(runtime.battle.lastAction.target, 3, 'index mục tiêu quái trỏ vào vị trí party, không phải actor ID');
    const lastTarget = runtime.battle.lastAction.target;
    await engine.restore(engine.save());
    await finish(force([0, 0, id, -2]));
    assert.equal(engine.battle.battle.lastAction.target, lastTarget, 'mục tiêu trước giữ qua save');
    engine.battle.handleEffect(333, [0, 0, 1]);
    const before = engine.state.variableValue(6210);
    await finish(force([0, 0, id, -1])); assert.equal(engine.state.variableValue(6210), before, 'quái chết không bị ép hành động');
    await assert.rejects(force([0, 1, 99999, -1]), /Không tìm thấy skill/);
    // Các scope dùng cùng đường chọn mục tiêu, kể cả hồi sinh và random nhiều đòn.
    const subject = engine.battle.actor(1), skill = engine.database.Skills[id];
    for (const scope of [0, 1, 2, 3, 4, 5, 6, 7, 8, 11]) {
        const targets = engine.battle.skillTargets(subject, { ...skill, scope }, -1);
        assert.equal(targets.length, scope === 0 ? 0 : scope === 2 ? 6 : scope === 8 ? 2 : scope >= 3 && scope <= 6 ? scope - 2 : 1);
    }
    engine.state.changeActorState(3, 1, true); engine.battle.syncActors();
    assert.equal(engine.battle.skillTargets(subject, { ...skill, scope: 9 }, 1)[0].id, 3);
    assert.equal(engine.battle.skillTargets(subject, { ...skill, scope: 10 }, -1).length, 1);
    // Lệnh cưỡng chế thật chạy common event của kỹ năng 7.
    await finish(force([0, 1, 7, -1])); assert.equal(engine.state.switchValue(16), true);

    engine.state.setVariable(6210, 0); engine.state.setSwitch(6211, false);
    const controller = new AbortController();
    const cancelled = engine.createInterpreter([{ code: 339, parameters: [0, 1, id, 0] },
        { code: 121, parameters: [6211, 6211, 0] }], 0, {}, controller.signal).run();
    const rejected = assert.rejects(cancelled, { name: 'AbortError' }); await flush(); controller.abort(); await rejected; await flush();
    engine.advanceRoutes(1000); await flush();
    assert.equal(engine.state.variableValue(6210), 0); assert.equal(engine.state.switchValue(6211), false);
    assert.equal(engine.animations.entries.length, 0); assert.equal(engine.forcedActionDepth, 0);
    let count = 0;
    for (const file of (await fs.readdir(path.join(__dirname, '../game/data'))).filter(f => /^(Map\d+|CommonEvents|Troops)\.json$/.test(f))) {
        function scan(value) {
            if (!value || typeof value !== 'object') return;
            if (value.code === 339) { assert.ok(engine.database.Skills[value.parameters[2]]); count++; }
            Object.values(value).forEach(scan);
        }
        scan(JSON.parse(await fs.readFile(path.join(__dirname, '../game/data', file), 'utf8')));
    }
    assert.equal(count, 369);
    console.log('ĐẠT: 339 actor/quái, chờ/hủy, mục tiêu trước/save, MP/TP/lặp/state/common event, scope và 369 lệnh JSON.');
})().then(() => clearTimeout(watchdog)).catch(error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
