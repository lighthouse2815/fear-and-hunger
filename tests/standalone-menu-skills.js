'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const { SaveStore } = require('../game/engine/save-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const watchdog = setTimeout(() => { console.error('Kỹ năng ngoài trận chưa kết thúc.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.5 });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1, 3, 4] });
    const skill = engine.database.Skills[151], loving = engine.database.Skills[238];
    const open = () => { if (engine.state.scene === 'map') engine.openMenu(); };
    const learn = id => engine.state.changeActorSkill(1, id, true);
    open(); assert.equal(engine.canUseMenuSkill(1, 151, 3), false, 'không dùng kỹ năng chưa học');
    learn(151); learn(238);
    assert.equal(engine.canUseMenuSkill(1, 151, 3), false, 'đầy HP cả đội thì không tiêu MP hồi máu');
    engine.state.changeActorHp(1, -50, true); engine.state.changeActorHp(3, -50, true); engine.state.changeActorState(4, 1, true);
    engine.state.actor(1).tp = 30; const mp = engine.state.actor(1).mp;
    const report = await engine.useMenuSkill(1, 151, 3);
    assert.equal(engine.battle.battle, null, 'không tạo trận tạm để dùng skill trên map');
    assert.deepEqual(report.targets.map(t => t.id), [1, 3]);
    assert.equal(engine.state.actor(1).hp, 86); assert.equal(engine.state.actor(3).hp, 86);
    assert.equal(engine.state.actor(4).hp, 0, 'hồi cả đội không tự hồi sinh');
    assert.equal(engine.state.actor(1).mp, mp - 30); assert.equal(engine.state.actor(3).mp, 100);
    assert.equal(engine.state.actor(1).tp, 30); assert.equal(engine.state.scene, 'menu', 'hồi trực tiếp giữ menu mở');
    assert.equal(engine.canUseMenuSkill(1, 238, 99999), false); assert.equal(engine.canUseMenuSkill(1, 238, 4), false);
    await engine.useMenuSkill(1, 238, 3);
    assert.equal(engine.state.actor(3).hp, 100); assert.equal(engine.state.actor(1).hp, 86, 'hồi một mục tiêu không hồi caster');
    assert.equal(engine.canUseMenuSkill(1, 238, 3), false, 'không cast vào mục tiêu đã đầy HP');
    engine.state.actor(1).mp = 0;
    await assert.rejects(engine.useMenuSkill(1, 151, 3), /Chưa thể dùng kỹ năng/);
    assert.equal(engine.state.actor(1).mp, 0); assert.equal(engine.state.actor(1).hp, 86);
    engine.state.recoverActor(1); engine.state.changeActorHp(3, -50, true);
    engine.state.changeActorState(1, 6, true);
    assert.equal(engine.canUseMenuSkill(1, 151, 3), false, 'Silence khóa đúng loại kỹ năng');
    engine.state.changeActorState(1, 6, false); engine.state.changeActorState(1, 10, true);
    assert.equal(engine.canUseMenuSkill(1, 151, 3), false, 'restriction khóa người thi triển');
    engine.state.changeActorState(1, 10, false);
    learn(218); assert.equal(engine.canUseMenuSkill(1, 218, 3), false, 'biến thể hồi máu chỉ trong trận không dùng từ menu');
    learn(1); assert.equal(engine.canUseMenuSkill(1, 1, 3), false, 'Attack không dùng từ menu');
    engine.state.changeActorState(1, 1, true); assert.equal(engine.canUseMenuSkill(1, 151, 3), false);
    engine.state.recoverActor(1);
    const equipped = engine.database.Weapons[engine.state.actor(1).equips[0]];
    const traits = equipped.traits.slice();
    equipped.traits.push({ code: 23, dataId: 4, value: 0.5 }, { code: 43, dataId: 151, value: 1 });
    engine.state.changeActorSkill(1, 151, false);
    const beforeMp = engine.state.actor(1).mp;
    await engine.useMenuSkill(1, 151, 3); assert.equal(engine.state.actor(1).mp, beforeMp - 15, 'skill từ trait và trait giảm MP dùng chung combat');
    equipped.traits = traits; learn(151);

    // Dùng item lên đồng đội bị khóa vẫn giữ hành vi menu hiện có.
    engine.state.changeActorState(3, 10, true); engine.state.gainItem('items', 28, 1);
    assert.equal(engine.canUseMenuItem(28, 3), true);
    await engine.useMenuItem(28, 3); assert.ok(engine.state.actor(3).hp > 50);
    engine.state.changeActorState(3, 10, false); open();
    const customId = engine.database.Skills.length;
    engine.database.Skills.push({ ...loving, id: customId, scope: 11, tpCost: 5, mpCost: 1, tpGain: 0,
        damage: { ...loving.damage, formula: 'a.mat', variance: 0 } });
    learn(customId); engine.state.actor(1).tp = 4;
    engine.state.changeActorHp(1, -70, true); engine.state.changeActorHp(3, -20, true);
    assert.equal(engine.canUseMenuSkill(1, customId, 3), false);
    engine.state.actor(1).tp = 10;
    const selfHp = engine.state.actor(1).hp, friendHp = engine.state.actor(3).hp, mat = engine.state.actorParam(1, 4);
    await engine.useMenuSkill(1, customId, 3);
    assert.equal(engine.state.actor(1).hp, selfHp + mat); assert.equal(engine.state.actor(3).hp, friendHp);
    assert.equal(engine.state.actor(1).tp, 5, 'chỉ caster trả TP');
    engine.database.Skills[customId].scope = 9;
    engine.database.Skills[customId].damage = { ...loving.damage, formula: '20', variance: 0 };
    engine.database.Skills[customId].effects = [{ code: 22, dataId: 1, value1: 1 }];
    await engine.useMenuSkill(1, customId, 4);
    assert.equal(engine.state.actor(4).hp, 20); assert.equal(engine.state.actor(4).states.includes(1), false);
    engine.database.Skills[customId].scope = 8; engine.database.Skills[customId].tpCost = 0;
    engine.database.Skills[customId].effects = [{ code: 999 }];
    const beforeError = engine.save();
    await assert.rejects(engine.useMenuSkill(1, customId, 3), /Hiệu ứng hành động chưa hỗ trợ/);
    assert.deepEqual(engine.save(), beforeError, 'hiệu ứng lỗi không trừ tài nguyên trước validation');

    // Kỹ năng ngoài trận có common event thật: chuyển hóa bread hoặc water vial.
    learn(189); engine.state.recoverActor(1); engine.state.gainItem('items', 31, 1);
    const messages = [], handlers = { message: text => messages.push(text), choice: () => 0, effect: code => code === 250 };
    const transmuteMp = engine.state.actor(1).mp, bread = engine.state.itemCount('items', 31);
    const transmuted = await engine.useMenuSkill(1, 189, 99999, handlers);
    assert.deepEqual(transmuted.targets, []); assert.deepEqual(transmuted.commonEvents, [186]);
    assert.equal(engine.state.actor(1).mp, transmuteMp - 15); assert.equal(engine.state.itemCount('items', 31), bread + 2);
    assert.ok(messages.some(text => /successful/.test(text))); assert.equal(engine.eventRunning, false); assert.equal(engine.state.scene, 'map');
    open(); engine.state.gainItem('items', 31, -engine.state.itemCount('items', 31)); engine.state.gainItem('items', 85, 1);
    const water = engine.state.itemCount('items', 85), wine = engine.state.itemCount('items', 97);
    await engine.useMenuSkill(1, 189, 3, handlers);
    assert.equal(engine.state.itemCount('items', 85), water - 1); assert.equal(engine.state.itemCount('items', 97), wine + 1);

    // Save từ common event không chạy lại phần chi phí/hiệu ứng đã hoàn tất.
    const commonId = engine.database.CommonEvents.length;
    engine.database.CommonEvents.push({ id: commonId, list: [
        { code: 352 }, { code: 122, parameters: [6270, 6270, 1, 0, 1] }
    ] });
    const savingId = engine.database.Skills.length;
    engine.database.Skills.push({ ...skill, id: savingId, scope: 0, mpCost: 5, effects: [{ code: 44, dataId: commonId }] });
    learn(savingId); open();
    const storage = new Map(), saves = new SaveStore({ storage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k) || null } });
    let done = false;
    const saving = engine.useMenuSkill(1, savingId, 3).then(() => { done = true; }); await flush();
    assert.equal(done, false); assert.equal(engine.state.scene, 'save');
    await assert.rejects(engine.useMenuSkill(1, savingId, 3), /Chưa thể dùng kỹ năng/);
    engine.saveMenuTo(saves, 1); const chargedMp = engine.state.actor(1).mp;
    engine.closeMenu(); await saving; await engine.loadFrom(saves, 1);
    assert.equal(engine.state.actor(1).mp, chargedMp); assert.equal(engine.state.variableValue(6270), 1);
    console.log('ĐẠT: kỹ năng menu đơn/cả đội/bản thân, hồi sinh/MP/TP/trait/khóa, JSON chuyển hóa thật và tiếp event qua save không trừ phí lần hai.');
})().then(() => clearTimeout(watchdog)).catch(error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
