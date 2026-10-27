'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {GameEngine}=require('../game/engine/game-engine');
const {GameDataStore}=require('../game/engine/data-store');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const watchdog=setTimeout(()=>{console.error('Đồng bộ actor trong event chưa kết thúc.');process.exit(1);},15000);
(async()=>{
    const sounds=[],store=new GameDataStore({fetchImpl:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../game',url),'utf8'))})});
    const e=new GameEngine({dataStore:store,onRouteEffect:(code,p)=>{if(code===250)sounds.push(p[0].name);return true;}});
    await e.boot({mapId:74,x:8,y:8,party:[1,3]});let r=e.battle;
    function reset(){r.finish('escape');e.state.party.forEach(id=>e.state.recoverActor(id));r.setup(1);e.state.scene='battle';sounds.length=0;}
    async function command(code,parameters){await e.createInterpreter([{code,parameters}],0).run();}
    reset();const actor=r.actor(1);r.startMotion(actor,'guard');
    await command(312,[0,1,1,0,37]);assert.equal(actor.mp,63,'lệnh cuối event cũng đồng bộ MP ngay');
    assert.equal(r.actor(1),actor);assert.equal(actor.spriteMotion.type,'guard','giữ object và motion của actor');
    let finishMessage,snapshotAtMessage;
    const running=e.createInterpreter([{code:311,parameters:[0,1,1,0,99999,true]},
        {code:101,parameters:['',0,0,2]},{code:401,parameters:['Đợi hồi sinh']}],0,{message:()=>{
        snapshotAtMessage={hp:r.actor(1).hp,alive:r.actor(1).alive,frame:r.spriteFrame(r.actor(1)).index};
        return new Promise(resolve=>{finishMessage=resolve;});
    }}).run();await flush();
    assert.deepEqual(snapshotAtMessage,{hp:0,alive:false,frame:17},'311 đồng bộ trước khi mở lời thoại');
    assert.deepEqual(sounds,[e.database.System.sounds[15].name]);
    assert.equal(r.battle.result,null,'chưa chốt thất bại giữa page còn đang chờ');
    finishMessage();await running;
    const enemyHp=r.enemy(0).hp;
    await command(339,[1,1,3,0]);assert.equal(r.enemy(0).hp,enemyHp,'actor bị event hạ không được 339 cưỡng chế đánh');
    assert.equal(r.aliveActors().some(actor=>actor.id===1),false,'AI không chọn actor đã chết');
    assert.equal(sounds.length,1,'các lệnh tiếp theo không phát tiếng chết lại');
    await command(313,[0,1,1,1]);assert.equal(actor.alive,true);assert.equal(actor.hp,1);
    await command(313,[0,1,0,1]);assert.equal(actor.alive,false);assert.equal(sounds.length,2);
    await command(314,[0,1]);assert.equal(actor.hp,100);assert.equal(actor.mp,100);assert.equal(actor.alive,true);
    await command(320,[1,'Người sống']);assert.equal(actor.name,'Người sống');
    let observed=0;
    await e.createInterpreter([{code:312,parameters:[0,1,1,0,7]}],0,{afterCommand:()=>{
        assert.equal(r.actor(1).mp,93,'callback ngoài đọc trạng thái đã đồng bộ');observed++;
    }}).run();assert.equal(observed,1);
    await command(314,[0,1]);
    const commonId=e.database.CommonEvents.length;
    e.database.CommonEvents.push({id:commonId,list:[{code:311,parameters:[0,1,1,0,40,true]}]});
    await command(117,[commonId]);assert.equal(actor.hp,60,'common event lồng nhau giữ callback sau từng lệnh');
    await command(129,[4,0,false]);assert.equal(r.actor(4).hp,e.state.actor(4).hp);
    await command(129,[4,1,false]);assert.equal(r.actor(4),undefined);
    const before=e.save();await e.restore(before);r=e.battle;
    await command(312,[0,1,1,0,12]);assert.equal(r.actor(1).mp,88,'sau restore vẫn đồng bộ');
    const release=r.protectActionTargets([r.actor(1)]);sounds.length=0;
    await command(311,[0,1,1,0,99999,true]);
    assert.equal(r.actor(1).hp,0);assert.equal(r.actor(1).alive,true);assert.equal(e.state.actor(1).states.includes(1),false);
    assert.deepEqual(sounds,[],'IMMORTAL chưa phát tiếng chết khi event đặt HP về 0');
    release();assert.equal(r.actor(1).alive,false);assert.equal(sounds.length,1);
    e.state.scene='map';await command(314,[0,1]);assert.equal(sounds.length,1,'ngoài trận không phát tiếng chết');
    console.log('ĐẠT: 311/312/313/314/tên/đội, lệnh cuối/common event/save, giữ motion/object, HP trước thoại, âm chết một lần và IMMORTAL.');
})().then(()=>clearTimeout(watchdog)).catch(error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
