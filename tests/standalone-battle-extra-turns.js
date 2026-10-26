'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {GameEngine}=require('../game/engine/game-engine');
const {GameDataStore}=require('../game/engine/data-store');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
    const store=new GameDataStore({fetchImpl:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../game',url),'utf8'))})});
    const e=new GameEngine({dataStore:store,random:()=>0.5,onRouteEffect:()=>true});await e.boot({mapId:74,x:8,y:8,party:[1,3]});
    const db=e.database,enemyId=db.Enemies.length,troopId=db.Troops.length,id=db.Skills.length,stateId=db.States.length;
    db.Skills.push({...db.Skills[3],id,note:'',animationId:0,hitType:0,repeats:1,mpCost:0,tpCost:0,effects:[],
        damage:{type:1,formula:'1',variance:0,critical:false,elementId:0}});
    db.Enemies.push({...db.Enemies[1],id:enemyId,traits:[],params:[1000,100,1,1,1,1,20,1],actions:[{skillId:id,conditionType:0,rating:5}]});
    db.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400}]});
    db.States.push({...db.States[5],id:stateId,restriction:0,autoRemovalTiming:2,minTurns:3,maxTurns:3,traits:[{code:22,dataId:7,value:-0.1}]});
    function reset(agility=[40,10],enemyAgility=20){e.battle.finish('escape');e.animations.dispose();e.state.party=[1,3];
        e.state.party.forEach((actor,index)=>{e.state.recoverActor(actor);e.state.changeActorSkill(actor,id,true);e.state.changeActorParam(actor,6,agility[index]-e.state.actorParam(actor,6));});
        db.Enemies[enemyId].params[6]=enemyAgility;db.Troops[troopId].members=[{enemyId,x:408,y:400}];
        e.battle.setup(troopId,true,true);e.state.scene='battle';}
    async function finish(promise){let done=false,value,error;promise.then(v=>{done=true;value=v;},err=>{done=true;error=err;});
        for(let i=0;i<2000&&!done;i++){e.advanceRoutes(16);await flush();}assert.ok(done);if(error)throw error;return value;}
    const select=actor=>e.queueBattleAction(actor,'skill',id,0);
    reset();assert.equal(!!e.battle.battle.extraTurn,false,'trận luôn bắt đầu bằng lượt thường');
    e.state.changeActorState(1,stateId,true);select(1);select(3);await finish(e.startBattleTurn());
    assert.equal(e.battle.battle.turn,1);assert.equal(e.battle.battle.extraTurn,true);
    assert.deepEqual(e.battle.battle.extraMembers,['actor:1']);assert.deepEqual(e.battle.inputActors().map(a=>a.id),[1]);
    assert.throws(()=>select(3),/không có lượt bổ sung/);
    const hp=e.state.actor(1).hp,turns=e.state.actor(1).stateTurns[stateId],enemyHp=e.battle.enemy(0).hp;
    select(1);await e.restore(e.save());assert.equal(e.battle.battle.extraTurn,true);assert.equal(e.battle.battle.inputActions.length,1);
    const extra=await finish(e.startBattleTurn());assert.deepEqual(extra.map(r=>r.subjectId),[1]);
    assert.equal(e.battle.battle.turn,1);assert.equal(e.battle.battle.extraTurn,false);
    assert.equal(e.state.actor(1).hp,hp,'lượt bổ sung không tick poison/regen');assert.equal(e.state.actor(1).stateTurns[stateId],turns);
    assert.equal(e.battle.enemy(0).hp,enemyHp-1);assert.equal(e.battle.battle.turnEffects.length,0);
    assert.deepEqual(e.battle.inputActors().map(a=>a.id),[1,3]);select(1);select(3);await finish(e.startBattleTurn());
    assert.equal(e.battle.battle.turn,2);assert.equal(e.state.actor(1).stateTurns[stateId],turns-1);
    await finish(e.forceBattleAction([1,3,id,0]));assert.equal(e.battle.battle.lastAction.subjectId,3,'339 vẫn ép được chủ thể không có lượt bổ sung');

    reset([10,10],40);const total=e.state.actor(1).hp+e.state.actor(3).hp;select(1);select(3);await finish(e.startBattleTurn());
    assert.equal(e.battle.battle.turn,1);assert.equal(e.battle.battle.extraTurn,false,'AI tự chạy lượt chỉ có địch rồi trở về lượt thường');
    assert.equal(e.state.actor(1).hp+e.state.actor(3).hp,total-2,'địch nhanh đánh thêm một lần');
    assert.equal(e.battle.battle.turnActions.length,1);assert.equal(e.battle.battle.turnActions[0].subject,'enemy');
    reset([30,30],20);select(1);select(3);await finish(e.startBattleTurn());assert.equal(e.battle.battle.extraTurn,false,'AGI bằng 150% chưa đủ lượt thêm');
    reset();e.state.changeActorState(1,7,true);e.battle.syncActors();
    e.battle.prepareNextInput();assert.equal(e.battle.battle.extraTurn,true,'rối loạn vẫn được lượt thêm nếu cử động được');
    e.battle.battle.extraTurn=false;e.state.changeActorState(1,10,true);e.battle.syncActors();e.battle.prepareNextInput();
    assert.equal(e.battle.battle.extraTurn,false,'bất động không nhận lượt thêm');
    reset([100,10],20);e.battle.enemy(0).hidden=true;e.battle.prepareNextInput();
    assert.deepEqual(e.battle.battle.extraMembers,['actor:1']);
    reset([60,1],50);e.battle.finish('escape');const slowId=db.Enemies.length;
    db.Enemies.push({...db.Enemies[enemyId],id:slowId,params:[1000,100,1,1,1,1,1,1]});
    db.Troops[troopId].members.push({enemyId:slowId,x:500,y:400});e.battle.setup(troopId,true,true);
    select(1);select(3);await finish(e.startBattleTurn());assert.deepEqual(e.battle.battle.extraMembers,['actor:1','enemy:0']);
    select(1);const both=await finish(e.startBattleTurn());assert.equal(both.length,2);assert.ok(both.some(r=>r.subject==='enemy'&&r.subjectId===0));
    assert.ok(!both.some(r=>r.subject==='enemy'&&r.subjectId===1));assert.equal(e.battle.battle.turn,1);assert.equal(e.battle.battle.extraTurn,false);
    fs.accessSync(path.join(__dirname,'../game/img/system/exturn.png'));
    console.log('ĐẠT: lượt bổ sung AGI >150%, xen kẽ lượt thường, quyền nhập lệnh/AI/339, không tăng turn/tick state, save, ngưỡng và ẩn/bất động.');
})().catch(error=>{console.error(error);process.exitCode=1;});
