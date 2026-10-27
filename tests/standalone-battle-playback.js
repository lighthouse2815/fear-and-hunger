'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {GameEngine}=require('../game/engine/game-engine');
const {GameDataStore}=require('../game/engine/data-store');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const watchdog=setTimeout(()=>{console.error('Playback hành động không kết thúc trong thời hạn kiểm thử.');process.exit(1);},15000);
(async()=>{
    const store=new GameDataStore({fetchImpl:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../game',url),'utf8'))})});
    const e=new GameEngine({dataStore:store,random:()=>0.5,onRouteEffect:()=>true});await e.boot({mapId:74,x:8,y:8,party:[1,3]});
    const db=e.database,enemyId=db.Enemies.length,troopId=db.Troops.length,skillId=db.Skills.length;
    db.Enemies.push({...db.Enemies[1],id:enemyId,params:[1000,100,1,1,1,1,10,1],traits:[],actions:[]});
    db.Troops.push({id:troopId,pages:[],members:[{enemyId,x:300,y:400},{enemyId,x:500,y:400}]});
    db.Skills.push({...db.Skills[3],id:skillId,note:'',animationId:1,scope:1,repeats:1,successRate:100,hitType:0,mpCost:0,tpCost:0,tpGain:0,effects:[],
        damage:{type:1,formula:'10',variance:0,critical:false,elementId:0}});
    let r=e.battle;
    function reset(){r.finish('escape');e.animations.dispose();e.state.party.forEach(id=>e.state.recoverActor(id));r.setup(troopId,true,true);e.state.scene='battle';
        Object.assign(db.Skills[skillId],{hitType:0,note:'',scope:1});}
    async function finish(promise){let done=false,error;promise.then(()=>{done=true;},failure=>{done=true;error=failure;});
        for(let i=0;i<1000&&!done;i++){e.advanceRoutes(4);await flush();}assert.ok(done);if(error)throw error;}
    reset();
    for(const enemy of db.Enemies.filter(Boolean))assert.equal(r.actionAnimationId({enemyId:enemy.id},db.Skills[1]),39);
    for(const weapon of db.Weapons.filter(Boolean)){e.state.actor(1).equips[0]=weapon.id;assert.equal(r.actionAnimationId(r.actor(1),db.Skills[1]),weapon.animationId);}
    e.state.actor(1).equips[0]=0;assert.equal(r.actionAnimationId(r.actor(1),db.Skills[1]),1);
    for(const [hitType,id] of [[0,120],[1,52],[2,51]]){
        const skill={...db.Skills[skillId],hitType};assert.equal(r.castAnimationId(r.enemy(0),skill,false),id);
        assert.equal(r.castAnimationId(r.actor(1),skill,false),0,'front view không cast trên actor dù có sprite');
        assert.equal(r.castAnimationId(r.enemy(0),skill,true),0,'item không có cast animation');
    }
    assert.equal(r.castAnimationId(r.enemy(0),db.Skills[1],false),0);assert.equal(r.castAnimationId(r.enemy(0),db.Skills[2],false),0);
    assert.equal(r.castAnimationId(r.enemy(0),{...db.Skills[skillId],note:'<Cast Ani: 0>'},false),0);
    assert.equal(r.castAnimationId(r.enemy(0),{...db.Skills[skillId],note:'<Cast Animation: 7>'},false),7);
    db.System.optSideView=true;assert.equal(r.castAnimationId(r.actor(1),db.Skills[skillId],false),120);db.System.optSideView=false;

    reset();let running=e.forceBattleAction([0,0,skillId,0]);await flush();
    let entry=e.animations.entries[0];assert.equal(entry.animationId,120);assert.equal(entry.targetType,'enemy');assert.equal(entry.targetId,0);assert.equal(entry.mirror,false);
    const hp=e.state.actor(1).hp;e.advanceRoutes(12);await flush();assert.equal(e.state.actor(1).hp,hp);assert.equal(entry.remaining,1);
    await finish(running);assert.equal(e.state.actor(1).hp,hp-10);
    reset();db.Skills[skillId].note='<setup action>\n</setup action>';
    running=e.forceBattleAction([0,0,skillId,0]);await flush();assert.ok(!e.animations.entries.some(item=>item.animationId===120));await finish(running);

    for(const [subject,subjectId,scope,targetType,targetId] of [[1,1,1,'enemy',0],[0,0,1,'actor',1],[1,1,7,'actor',1],[0,0,7,'enemy',0]]){
        reset();db.Skills[skillId].scope=scope;db.Skills[skillId].note='<target action>\naction animation\nwait for animation\naction effect\n</target action>';
        running=e.forceBattleAction([subject,subjectId,skillId,0]);
        for(let i=0;i<100&&!e.animations.entries.some(item=>item.animationId===1);i++){e.advanceRoutes(4);await flush();}
        entry=e.animations.entries.find(item=>item.animationId===1);
        assert.equal(entry.targetType,targetType);assert.equal(entry.targetId,targetId);assert.equal(entry.mirror,targetType==='actor','mirror theo đích, không theo phe thi triển');
        await finish(running);
    }
    reset();
    e.animations.startBattle(1,120,true,'actor');assert.equal(e.animations.entries[0].mirror,false,'cờ mirror tường minh cũng được actor đảo lại');
    const old=e.animations.entries[0];let first=false,second=false;
    const one=e.animations.waitFor(old).then(()=>{first=true;}),two=e.animations.waitFor(old).then(()=>{second=true;});
    running=e.forceBattleAction([1,1,skillId,0]);await flush();
    assert.equal(r.actor(1).spriteMotion,undefined,'setup đợi animation đang chạy trước khi perform action');
    e.animations.startBattle(0,7,false,'enemy');
    e.advanceRoutes(old.remaining);await flush();await one;await two;assert.ok(first&&second);
    assert.equal(r.actor(1).spriteMotion,undefined,'wait tiếp tục giữ action khi animation mới xuất hiện trong lúc đang chờ');
    await finish(running);
    e.animations.startBattle(1,7,false,'actor');const progress=e.save();await e.restore(progress);r=e.battle;
    const restored=e.animations.entries[0];assert.equal(restored.mirror,true);
    running=e.forceBattleAction([1,1,skillId,0]);await flush();assert.equal(e.state.actor(1).hp,hp);
    await finish(running);assert.equal(e.animations.entries.length,0,'wait hỗ trợ cả animation phục hồi từ save');

    reset();const controller=new AbortController();running=e.forceBattleAction([0,0,skillId,0],{},controller.signal);
    const rejected=assert.rejects(running,{name:'AbortError'});await flush();assert.ok(e.animations.entries.some(item=>item.animationId===120));
    controller.abort();await rejected;assert.equal(e.animations.entries.length,0);assert.equal(e.animations.waiters.size,0);assert.equal(e.state.actor(1).hp,hp);
    console.log('ĐẠT: cast 120/52/51 và override/Attack/Guard/item/front view, animation quái 39/vũ khí/0, mirror theo đích, wait nhiều consumer/save và hủy.');
})().then(()=>clearTimeout(watchdog)).catch(error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
