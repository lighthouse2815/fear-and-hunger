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
    await e.boot({ mapId: 74, x: 8, y: 8, party: [1] });
    const db=e.database, enemyId=db.Enemies.length, troopId=db.Troops.length, skillId=db.Skills.length, commonId=db.CommonEvents.length;
    db.Enemies.push({...db.Enemies[1], id:enemyId, note:'', params:[1000,100,1,1,1,1,1,1], traits:[], actions:[]});
    db.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400}]});
    db.CommonEvents.push({id:commonId,list:[{code:111,indent:0,parameters:[5,0,1,1]},
        {code:121,indent:1,parameters:[7390,7390,0]},{code:412,indent:0,parameters:[]}]});
    db.Skills.push({...db.Skills[3],id:skillId,name:'Đòn kiểm tra',note:'<Target Action>\naction effect\nwait for animation\naction animation\nwait for animation\naction effect\n</Target Action>',
        animationId:1,hitType:0,repeats:1,scope:1,mpCost:0,tpCost:0,effects:[{code:44,dataId:commonId}],
        damage:{type:1,formula:'20',elementId:0,variance:0,critical:false}});
    function reset(){e.animations.dispose();e.battle.finish('escape');e.state.recoverActor(1);e.state.setSwitch(7390,false);
        e.battle.setup(troopId,true,true);e.state.scene='battle';}
    async function until(test){for(let i=0;i<2000&&!test();i++){e.advanceRoutes(8);await flush();}assert.ok(test());}
    async function finish(promise){let done=false,result,error;promise.then(v=>{done=true;result=v;},err=>{done=true;error=err;});
        await until(()=>done);if(error)throw error;return result;}
    reset();e.battle.enemy(0).hp=10;
    const action=e.forceBattleAction([1,1,skillId,0]);
    await until(()=>e.animations.entries.length>0);
    const target=e.battle.enemy(0);
    assert.equal(target.hp,0);assert.equal(target.alive,true);assert.equal(target.states.includes(1),false);
    assert.equal(e.battle.isImmortal(target),true,'giữ đích sống giữa các effect dù đã cạn HP');
    e.battle.addState(target,1,1,true);assert.equal(target.states.includes(1),false,'chống death state trong action');
    await finish(action);
    assert.equal(e.battle.battle.lastAction.hits.length,2);assert.equal(e.battle.battle.lastAction.damage,40);
    assert.equal(target.alive,false);assert.ok(target.states.includes(1));assert.equal(e.battle.immortal.size,0);
    assert.equal(e.state.switchValue(7390),true,'bỏ IMMORTAL trước common event cuối action');
    assert.ok(e.battle.battle.lastAction.hits.every(hit=>hit.defeated));

    reset();e.state.changeActorHp(1,10-e.state.actor(1).hp,true);
    db.Skills[skillId].effects=[];
    const incoming=e.forceBattleAction([0,0,skillId,0]);await until(()=>e.animations.entries.some(entry=>entry.animationId===1&&entry.targetType==='actor'));
    assert.equal(e.state.actor(1).hp,0);assert.equal(e.battle.actor(1).alive,true);assert.equal(e.state.actor(1).states.includes(1),false);
    await finish(incoming);assert.equal(e.battle.actor(1).alive,false);assert.ok(e.state.actor(1).states.includes(1));
    assert.equal(e.battle.battle.lastAction.hits.length,2);

    reset();e.battle.enemy(0).hp=10;
    const controller=new AbortController(), canceled=e.forceBattleAction([1,1,skillId,0],{},controller.signal);
    const rejection=assert.rejects(canceled,/hủy sequence/);await until(()=>e.animations.entries.length>0);
    controller.abort(new Error('hủy sequence'));await rejection;
    assert.equal(e.battle.enemy(0).alive,false);assert.equal(e.battle.immortal.size,0,'hủy không để đích bất tử vĩnh viễn');
    e.advanceRoutes(1000);await flush();assert.equal(e.battle.battle.lastAction.hits.length,1,'không áp effect sau khi hủy');
    await e.restore(e.save());assert.equal(e.battle.enemy(0).alive,false);assert.equal(e.battle.isImmortal(e.battle.enemy(0)),false);

    reset();const enemy=e.battle.enemy(0), first=e.battle.protectActionTargets([enemy,enemy]), second=e.battle.protectActionTargets([enemy]);
    e.battle.changeResource(enemy,'hp',-99999);first();assert.equal(enemy.alive,true,'action lồng nhau còn giữ IMMORTAL');
    first();second();assert.equal(enemy.alive,false);assert.equal(e.battle.immortal.size,0,'release lặp không thay đổi bộ đếm');
    console.log('ĐẠT: IMMORTAL actor/quái giữ đủ effect ở 0 HP, chống death state, kết thúc trước common event, hủy/save và action lồng nhau.');
})().catch(error=>{console.error(error);process.exitCode=1;});
