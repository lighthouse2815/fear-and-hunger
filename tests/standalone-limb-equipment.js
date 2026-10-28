'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    const e = new GameEngine({ dataStore: store, random: () => .5, onRouteEffect: () => true });
    await e.boot({ mapId:74, x:8, y:8, party:[1] });
    const db = e.database;
    async function finish(promise) {
        let done = false, result, failure;
        promise.then(value => { done = true; result = value; }, error => { done = true; failure = error; });
        for (let frame = 0; frame < 15000 && !done; frame++) {
            e.advanceRoutes(4); await new Promise(resolve => setImmediate(resolve));
        }
        assert.ok(done, 'sự kiện mất tay phải kết thúc');
        if (failure) throw failure;
        return result;
    }
    async function loseArm(id) {
        e.closeMenu(); e.state.changeActorState(id,3,true);
        assert.equal(await finish(e.runCommonEvent(240,{ message:async()=>{}, gab:async()=>{}, effect:async()=>true })),true);
        assert.equal(e.state.actor(id).states.includes(3),false,'event thật tiêu thụ trạng thái Arm cut');
        e.openMenu();
    }
    let checked = 0;
    for (const id of [1,2,3,4,5,6,8,9,19,20,21]) {
        await e.restore({ mapId:74, x:8, y:8, party:[id], switches:{246:true} }); e.openMenu();
        e.clearMenuEquipment(id);
        const weapons = db.Weapons.filter(item => {
            if (!item) return false;
            e.state.gainItem('weapons',item.id,1);
            return e.canEquipMenuActor(id,0,item.id);
        });
        const twoHands = item => item.traits.some(t => t.code===54 && t.dataId===2);
        const single = weapons.find(item => !twoHands(item));
        const shields = db.Armors.filter(item => {
            if (!item || item.etypeId!==2) return false;
            e.state.gainItem('armors',item.id,1);
            return e.canEquipMenuActor(id,1,item.id);
        });
        assert.ok(single,'nhân vật có vũ khí một tay: '+id);
        assert.equal(e.equipMenuActor(id,0,single.id),true);
        if (shields.length) assert.equal(e.equipMenuActor(id,1,shields[0].id),true);
        await loseArm(id);
        assert.equal(e.state.actor(id).equips[0],single.id,'một tay giữ được vũ khí một tay');
        for (const weapon of weapons) assert.equal(e.canEquipMenuActor(id,0,weapon.id),!twoHands(weapon),id+': '+weapon.name);
        for (const shield of shields) {
            assert.equal(e.canEquipMenuActor(id,1,shield.id),false);
            assert.equal(e.equipMenuActor(id,1,shield.id),false);
        }
        if (shields.length) assert.equal(e.state.actor(id).equips[1],0,'event thật tháo khiên khi mất tay');
        e.optimizeMenuEquipment(id);
        assert.ok(!twoHands(db.Weapons[e.state.actor(id).equips[0]]),'tối ưu không lách vũ khí hai tay');
        await e.restore(e.save());
        for (const weapon of weapons.filter(twoHands)) assert.equal(e.canEquipMenuActor(id,0,weapon.id),false,'lưu/tải giữ cờ mất một tay');
        // Dùng lại vũ khí một tay trước lần mất tay thứ hai.
        assert.equal(e.equipMenuActor(id,0,single.id),true);
        await loseArm(id);
        assert.equal(e.state.actor(id).equips[0],0,'event thật tháo vũ khí khi mất cả hai tay');
        for (const weapon of weapons) {
            assert.equal(e.canEquipMenuActor(id,0,weapon.id),false);
            assert.equal(e.equipMenuActor(id,0,weapon.id),false);
        }
        const inventory = JSON.stringify(e.state.inventory.weapons);
        e.optimizeMenuEquipment(id);
        assert.deepEqual(e.state.actor(id).equips.slice(0,2),[0,0],'tối ưu không lách mất hai tay');
        assert.equal(JSON.stringify(e.state.inventory.weapons),inventory,'không mất hoặc nhân đôi vũ khí');
        await e.restore(e.save());
        assert.equal(e.canEquipMenuActor(id,0,single.id),false,'lưu/tải giữ giới hạn hai tay');
        assert.equal(e.canEquipMenuActor(id,0,0),true,'vẫn cho tháo trang bị');
        e.clearMenuEquipment(id);
        checked++;
    }
    // Cờ của người này không khóa người khác; áo và phụ kiện vẫn dùng được.
    await e.restore({mapId:74,x:8,y:8,party:[1,3],switches:{36:true,37:true}}); e.openMenu();
    e.state.gainItem('weapons',44,1); e.state.gainItem('armors',1,1);
    assert.equal(e.canEquipMenuActor(1,0,44),false);
    assert.equal(e.equipMenuActor(3,0,44),true);
    assert.equal(e.canEquipMenuActor(1,3,1),true);
    e.state.setSwitch(36,false); e.state.setSwitch(37,false);
    e.state.gainItem('weapons',4,1);
    assert.equal(e.equipMenuActor(1,0,4),true,'khôi phục tay cho dùng lại vũ khí hai tay');
    await loseArm(1);
    assert.equal(e.state.actor(1).equips[0],0,'event thật tháo vũ khí hai tay đang cầm');
    await loseArm(1);
    e.closeMenu(); e.battle.setup(1,true,true); e.state.scene='battle';
    const actor = e.battle.actor(1);
    assert.equal(e.battle.attackSkillId(actor),1);
    assert.equal(e.battle.canUseSkill(actor,db.Skills[1]),true,'mất tay vẫn Attack tay không');
    assert.equal(e.battle.canUseSkill(actor,db.Skills[238]),true,'mất tay không tự khóa phép');
    const hp = e.battle.enemy(0).hp;
    const report = await finish(e.battleAttack(1,0,{message:async()=>{},gab:async()=>{},effect:async()=>true}));
    assert.equal(report.skillId,1);
    assert.ok(e.battle.enemy(0).hp<hp,'Attack tay không gây sát thương thật');
    e.state.changeActorState(1,13,true); e.battle.syncActors();
    assert.equal(e.battle.canUseSkill(actor,db.Skills[1]),false,'trạng thái bất lực vẫn chặn hành động');
    console.log('ĐẠT: sự kiện mất tay thật cho '+checked+' nhân vật, lọc vũ khí/khiên, tối ưu, lưu/tải, khôi phục tay và Attack tay không.');
})().catch(error => {console.error(error);process.exitCode=1;});
