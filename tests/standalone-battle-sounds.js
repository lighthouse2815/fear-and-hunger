'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {GameEngine}=require('../game/engine/game-engine');
const {GameDataStore}=require('../game/engine/data-store');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const watchdog=setTimeout(()=>{console.error('Âm thanh chiến đấu chưa hoàn tất.');process.exit(1);},15000);
(async()=>{
    const store=new GameDataStore({fetchImpl:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../game',url),'utf8'))})});
    const sounds=[],e=new GameEngine({dataStore:store,random:()=>0.5,onRouteEffect:(code,p)=>{if(code===250)sounds.push({...p[0]});return true;}});
    await e.boot({mapId:74,x:8,y:8,party:[1,3]});const db=e.database,enemyId=db.Enemies.length,troopId=db.Troops.length,skillId=db.Skills.length;
    db.Enemies.push({...db.Enemies[1],id:enemyId,note:'',params:[1000,100,10,1,1,1,10,1],traits:[{code:22,dataId:0,value:1}],actions:[]});
    db.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400}]});
    db.Skills.push({...db.Skills[3],id:skillId,note:'',animationId:0,hitType:1,scope:1,repeats:1,successRate:100,mpCost:0,tpCost:0,tpGain:0,effects:[],
        damage:{type:1,formula:'10',variance:0,critical:false,elementId:0}});
    db.Skills[1]={...db.Skills[skillId],id:1,animationId:-1,note:'<target action>\naction animation\naction effect\nwait for animation\n</target action>'};
    let r=e.battle;const skill=db.Skills[skillId],actorTraits=db.Actors[1].traits.slice();
    function reset(){r.finish('escape');e.animations.dispose();db.Actors[1].traits=actorTraits.slice();e.state.party.forEach(id=>e.state.recoverActor(id));
        db.Enemies[enemyId].traits=[{code:22,dataId:0,value:1}];r.setup(troopId,true,true);e.state.scene='battle';sounds.length=0;
        Object.assign(skill,{animationId:0,hitType:1,scope:1,repeats:1,successRate:100,note:''});skill.damage={type:1,formula:'10',variance:0,critical:false,elementId:0};}
    const expected=indices=>indices.map(index=>db.System.sounds[index]);
    const strike=()=>r.useSkill(r.actor(1),skillId,0,true),incoming=()=>r.useSkill(r.enemy(0),skillId,0,true);
    async function finish(promise){let done=false,error;promise.then(()=>{done=true;},failure=>{done=true;error=failure;});
        for(let i=0;i<1000&&!done;i++){e.advanceRoutes(4);await flush();}assert.ok(done);if(error)throw error;}
    reset();strike();assert.deepEqual(sounds,expected([10]));assert.equal(r.enemy(0).hp,990);
    reset();incoming();assert.deepEqual(sounds,expected([14]));
    reset();skill.repeats=3;strike();assert.deepEqual(sounds,expected([10,10,10]),'mỗi effect phát riêng một SE trúng đòn');
    reset();skill.successRate=0;strike();assert.deepEqual(sounds,expected([17]));
    for(const hitType of [0,2]){reset();skill.hitType=hitType;skill.successRate=0;strike();assert.deepEqual(sounds,[],'chỉ miss physical phát SE');}
    reset();db.Actors[1].traits.push({code:22,dataId:1,value:1});incoming();assert.deepEqual(sounds,expected([18]));
    reset();skill.hitType=2;db.Actors[1].traits.push({code:22,dataId:4,value:1});incoming();assert.deepEqual(sounds,expected([19]));
    reset();skill.scope=7;skill.damage.type=3;e.state.changeActorHp(1,-50,true);strike();assert.deepEqual(sounds,expected([16]));
    reset();skill.scope=7;skill.damage.type=4;e.state.changeActorMp(1,-50);strike();assert.deepEqual(sounds,expected([16]));
    for(const type of [2,5,6]){reset();skill.damage.type=type;strike();assert.deepEqual(sounds,[],'MP damage/drain không phát SE HP trúng đòn');
        if(type===5)assert.equal(r.enemy(0).spriteEffect,undefined,'drain không blink như đòn gây damage thường');}
    reset();skill.hitType=2;db.Enemies[enemyId].traits.push({code:22,dataId:5,value:1});strike();
    assert.deepEqual(sounds,expected([20,14]),'phản phép phát trước tiếng caster nhận damage');
    reset();db.Enemies[enemyId].traits.push({code:22,dataId:6,value:1});strike();
    assert.deepEqual(sounds,expected([10,18,14]),'Counter phát né trước khi phản công trúng');
    reset();e.state.changeActorHp(1,-95,true);r.syncActors();sounds.length=0;incoming();
    assert.deepEqual(sounds,expected([14,15]),'trúng đòn rồi mới phát chết');r.syncActors();assert.equal(sounds.length,2);
    const dead=e.save();await e.restore(dead);r=e.battle;assert.equal(sounds.length,2,'tải save người chết không phát lại SE');
    reset();e.state.changeActorState(1,1,true);e.syncBattleActors();assert.deepEqual(sounds,expected([15]),'sự kiện death state đồng bộ wrapper phát chết một lần');
    reset();const release=r.protectActionTargets([r.actor(1)]);r.changeResource(r.actor(1),'hp',-99999);assert.deepEqual(sounds,[]);
    e.syncBattleActors();assert.equal(r.actor(1).alive,true,'đồng bộ party trong common event không xác nhận chết khi đang IMMORTAL');
    release();assert.deepEqual(sounds,expected([15]),'IMMORTAL chỉ phát chết sau xác nhận');
    reset();const pending=r.useSkill(r.actor(1),skillId,0,true,true);assert.deepEqual(sounds,[],'chuẩn bị action không phát damage sớm');
    await finish(e.completeBattleAction(pending));assert.deepEqual(sounds,expected([10]));
    await e.completeBattleAction(pending);assert.deepEqual(sounds,expected([10]),'hoàn tất lại không phát SE hai lần');
    reset();await finish(e.forceBattleAction([0,0,1,0]));
    assert.equal(sounds.filter(sound=>sound.name===db.System.sounds[9].name).length,1,'Attack quái front view phát Attack3 một lần');
    assert.ok(sounds.some(sound=>sound.name==='lurch_02'),'SE của animation 39 vẫn chạy');
    reset();e.state.scene='map';e.onBattleSound(14);assert.deepEqual(sounds,[],'không phát âm combat khi đã rời scene');
    e.state.scene='battle';db.System.sounds[14]={name:'',volume:100,pitch:100,pan:0};e.onBattleSound(14);assert.deepEqual(sounds,[],'tên rỗng giữ im lặng');
    console.log('ĐẠT: SE System trúng/lặp/miss/né/hồi/MP/drain/Counter/phản phép/chết, IMMORTAL/save/chuẩn bị/hủy scene và Attack3/animation 39 thật.');
})().then(()=>clearTimeout(watchdog)).catch(error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
