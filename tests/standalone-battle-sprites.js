'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    const e = new GameEngine({ dataStore: store, random: () => 0.5, onRouteEffect: () => true });
    await e.boot({ mapId: 74, x: 8, y: 8, party: [1, 2, 3, 4] });
    const db = e.database, troopId = db.Troops.length, enemyId = db.Enemies.length, skillId = db.Skills.length;
    db.Enemies.push({ ...db.Enemies[1], id: enemyId, params: [1000,100,1,1,1,1,10,1], actions: [], traits: [] });
    db.Troops.push({ id: troopId, pages: [], members: [{ enemyId, x: 408, y: 400 }] });
    db.Skills.push({ ...db.Skills[3], id: skillId, note: '', animationId: 0, effects: [], scope: 1, hitType: 0,
        mpCost: 0, tpCost: 0, successRate: 100, repeats: 1, damage: { type: 1, formula: '10', variance: 0, critical: false, elementId: 0 } });
    let r = e.battle;
    function reset() {
        r.finish('escape'); e.animations.dispose(); e.state.party.forEach(id => e.state.recoverActor(id));
        r.setup(troopId, true, true); e.state.scene = 'battle';
    }
    async function finish(promise) {
        let done = false, failure;
        promise.then(() => { done = true; }, error => { done = true; failure = error; });
        for (let i = 0; i < 1000 && !done; i++) { e.advanceRoutes(4); await flush(); }
        assert.equal(done, true); if (failure) throw failure;
    }
    reset(); assert.equal(db.System.optSideView, false);
    let actor = r.actor(1);
    assert.equal(r.spriteFrame(actor).index, 0);
    const patterns = [r.spriteFrame(actor).pattern];
    for (let i = 0; i < 4; i++) { e.advanceRoutes(12); patterns.push(r.spriteFrame(actor).pattern); }
    assert.deepEqual(patterns, [0,1,2,1,0], 'idle lặp 0/1/2/1 mỗi 12 frame');
    r.startMotion(actor, 'swing', 5); e.advanceRoutes(12);
    assert.deepEqual(r.spriteFrame(actor), { index: 7, pattern: 1, weaponImageId: 5, weaponPattern: 1 });
    const save = e.save(); e.advanceRoutes(24); assert.equal(actor.spriteMotion, undefined);
    await e.restore(save); r = e.battle; actor = r.actor(1);
    assert.deepEqual(r.spriteFrame(actor), { index: 7, pattern: 1, weaponImageId: 5, weaponPattern: 1 }, 'save giữ motion và frame vũ khí');
    e.advanceRoutes(24); assert.equal(r.spriteFrame(actor).index, 0);
    for (const [type, index] of [['thrust',6],['swing',7],['missile',8],['spell',10],['skill',9],['item',11],['damage',4],['evade',5]]) {
        r.startMotion(actor, type); assert.equal(r.spriteFrame(actor).index, index); e.advanceRoutes(36);
        assert.equal(r.spriteFrame(actor).index, 0);
    }
    for (let wtypeId = 0; wtypeId < db.System.attackMotions.length; wtypeId++) {
        const weapon = db.Weapons.find(entry => entry && entry.wtypeId === wtypeId);
        if (!weapon && wtypeId !== 0) continue;
        e.state.actor(1).equips[0] = weapon ? weapon.id : 0;
        r.performAction(actor, db.Skills[r.attackSkillId(actor)], false);
        const expected = db.System.attackMotions[wtypeId], frame = r.spriteFrame(actor);
        assert.equal(frame.index, [6,7,8][expected.type]); assert.equal(frame.weaponImageId, expected.weaponImageId);
        if (frame.weaponImageId) fs.accessSync(path.join(__dirname, '../game/img/system/Weapons' + (Math.floor((frame.weaponImageId - 1) / 12) + 1) + '.png'));
    }
    r.performAction(actor, db.Skills[2], false); assert.equal(r.spriteFrame(actor).index, 3);
    r.battle.phase = 'action'; e.advanceRoutes(40); assert.equal(r.spriteFrame(actor).index, 3, 'Guard giữ đến khi action effect thêm trait');
    e.state.changeActorState(1,2,true); e.advanceRoutes(40); assert.equal(r.spriteFrame(actor).index, 3);
    r.endTurn(); assert.notEqual(r.spriteFrame(actor).index, 3, 'hết Guard trả motion idle');
    const spell = db.Skills.find(entry => entry && db.System.magicSkills.includes(entry.stypeId) && ![1,2].includes(entry.id));
    r.performAction(actor, spell, false); assert.equal(r.spriteFrame(actor).index, 10);
    r.performAction(actor, db.Items[28], true); assert.equal(r.spriteFrame(actor).index, 11);
    reset(); actor = r.actor(1); e.state.changeActorHp(1,-80,true); r.syncActors();
    assert.equal(r.spriteFrame(actor).index, 14, 'HP dưới 25% chọn dying');
    e.state.recoverActor(1); e.state.changeActorState(1,db.States.find(entry => entry && entry.motion === 2).id,true); r.syncActors();
    assert.equal(r.spriteFrame(actor).index, 16, 'sleep theo States.motion');
    e.state.changeActorState(1,1,true); r.syncActors(); r.startMotion(actor,'damage');
    assert.equal(r.spriteFrame(actor).index, 17, 'chết ưu tiên hơn motion trúng đòn');

    reset(); actor = r.actor(1);
    const acting = e.forceBattleAction([1,1,skillId,0]); await flush();
    assert.equal(r.spriteFrame(actor).index, 9, 'perform action chọn motion skill thật');
    await finish(acting); assert.equal(r.enemy(0).hp,990); assert.equal(r.enemy(0).spriteEffect.type,'blink');
    e.advanceRoutes(20); assert.equal(r.enemy(0).spriteEffect,undefined);
    const enemy = e.forceBattleAction([0,0,skillId,0]); await flush();
    assert.equal(r.enemy(0).spriteEffect.type,'whiten'); assert.equal(r.enemy(0).spriteEffect.remaining,16);
    await finish(enemy); assert.equal(r.spriteFrame(actor).index,4);
    const controller = new AbortController(), cancelled = e.forceBattleAction([1,1,skillId,0],{},controller.signal);
    const rejected = assert.rejects(cancelled,{name:'AbortError'}); await flush(); controller.abort(); await rejected;
    assert.equal(actor.spriteMotion,undefined,'hủy dọn motion của action');
    console.log('ĐẠT: frame actor 9×6/12 frame, idle/trạng thái/chết, attackMotions/vũ khí, skill/item/Guard, 339, quái whiten/blink và motion qua save/hủy.');
})().catch(error => { console.error(error); process.exitCode = 1; });
