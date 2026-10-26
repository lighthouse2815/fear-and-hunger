'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
    const store=new GameDataStore({fetchImpl:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../game',url),'utf8'))})});
    const e=new GameEngine({dataStore:store,random:()=>0.3,onRouteEffect:()=>true});await e.boot({mapId:74,x:8,y:8,party:[1]});
    const db=e.database,id=db.Enemies.length,troopId=db.Troops.length,skillId=db.Skills.length;
    db.Skills.push({...db.Skills[3],id:skillId,note:'',animationId:0,hitType:0,effects:[],repeats:1,mpCost:0,tpCost:0,
        damage:{type:1,formula:'1',critical:false,variance:0,elementId:0}});
    db.Enemies.push({...db.Enemies[1],id,traits:[],params:[1000,100,1,1,1,1,20,1],actions:[{skillId,conditionType:0,rating:5}]});
    db.Troops.push({id:troopId,pages:[],members:[{enemyId:id,x:408,y:400}]});
    function reset(canEscape=true){e.battle.finish('escape');e.state.recoverActor(1);e.battle.setup(troopId,canEscape,true);e.state.scene='battle';e.battle.battle.managed=true;}
    async function finish(promise){let done=false,value,failure;promise.then(v=>{done=true;value=v;},err=>{done=true;failure=err;});
        for(let i=0;i<2000&&!done;i++){e.advanceRoutes(16);await flush();}assert.ok(done);if(failure)throw failure;return value;}
    reset();assert.equal(e.battle.battle.escapeRatio,0.25,'AGI 10/20 cho tỷ lệ thoát ban đầu 25%');
    e.queueBattleAction(1,'skill',2,0);const hp=e.state.actor(1).hp;
    assert.equal(await finish(e.battleEscape()),false);
    assert.equal(e.battle.battle.escapeRatio,0.35);assert.equal(e.battle.battle.turn,1);assert.equal(e.battle.battle.phase,'input');
    assert.equal(e.state.actor(1).hp,hp-2,'thoát thất bại nhường lượt thường và lượt bổ sung cho địch có AGI gấp đôi');
    assert.equal(e.battle.battle.inputActions.length,0);assert.equal(e.battle.battle.escapeFailed,true);
    await e.restore(e.save());assert.equal(e.battle.battle.escapeRatio,0.35);
    assert.equal(await finish(e.battleEscape()),true,'lần tiếp theo dùng tỷ lệ đã tăng');assert.equal(e.state.scene,'map');
    reset(false);const ratio=e.battle.battle.escapeRatio;
    assert.equal(await e.battleEscape(),false);assert.equal(e.battle.battle.turn,0);assert.equal(e.battle.battle.escapeRatio,ratio);
    reset();e.battle.random=()=>0.99;
    for(let i=0;i<3;i++)assert.equal(await finish(e.battleEscape()),false);
    assert.ok(Math.abs(e.battle.battle.escapeRatio-0.55)<1e-9,'mỗi lần thất bại cộng 0.1');
    const saved=e.save();delete saved.battle.escapeRatio;await e.restore(saved);
    e.battle.random=()=>0.1;assert.equal(await e.battleEscape(),true,'save cũ tính tỷ lệ AGI khi thiếu trường mới');
    reset();e.state.changeActorParam(1,6,50);e.battle.finish('escape');e.battle.setup(troopId,true,true);
    assert.equal(e.battle.battle.escapeRatio,1.5,'không chặn tỷ lệ lớn hơn một; đội nhanh thoát chắc chắn');
    e.battle.random=()=>0.999;assert.equal(e.battle.escape(),true);
    e.state.changeActorParam(1,6,-50);db.Troops[troopId].members.push({enemyId:id,x:500,y:400,hidden:true});
    e.battle.setup(troopId,true,true);assert.equal(e.battle.battle.escapeRatio,0.25,'lấy trung bình cả troop, gồm thành viên ẩn như dữ liệu gốc');
    e.battle.enemy(0).hp=0;e.battle.refreshEnemy(e.battle.enemy(0));
    assert.equal(e.battle.battle.escapeRatio,0.25,'tỷ lệ khởi tạo không đổi sau khi quái bị hạ');
    console.log('ĐẠT: thoát trận theo AGI, cộng 10 điểm phần trăm khi thất bại, mất lượt/hủy lệnh, save mới/cũ, khóa thoát và đội nhanh.');
})().catch(error=>{console.error(error);process.exitCode=1;});
