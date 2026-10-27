'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
(async()=>{
    const store=new GameDataStore({fetchImpl:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../game',url),'utf8'))})});
    const e=new GameEngine({dataStore:store});await e.boot({mapId:74,x:8,y:8,party:[1,2,3,4],guests:[5]});
    const db=e.database;
    for(const id of e.state.party){
        const actor=e.state.actor(id),base=e.state.actorExpForLevel(id,actor.level),next=e.state.actorExpForLevel(id,actor.level+1);
        let info=e.menuActorStatus(id);assert.equal(info.className,db.Classes[actor.classId].name);
        assert.equal(info.hunger,1,'đầu cấp thanh Hunger đầy, không phải EXP tăng dần');assert.equal(info.nextExp,next-base);
        e.state.changeActorExp(id,Math.floor((next-base)/2),false);
        info=e.menuActorStatus(id);assert.equal(info.nextExp,next-e.state.actor(id).exp);
        assert.equal(info.hunger,(next-e.state.actor(id).exp)/(next-base));
        assert.deepEqual(info.stateRates.map(x=>x.id),[1,4,5,6,7,8,9,10],'đọc đúng các cột States của cấu hình gốc');
    }
    assert.equal(e.menuActorStatus(5),null,'guest không xuất hiện trong menu đội');assert.equal(e.menuActorStatus(999),null);
    const stateId=db.States.length,baseline=e.battle.traitRate({id:1},13,5);
    db.States.push({...db.States[2],id:stateId,traits:[{code:13,dataId:5,value:0.5},{code:14,dataId:6,value:1}]});
    e.state.changeActorState(1,stateId,true);
    let status=e.menuActorStatus(1);assert.equal(status.stateRates.find(x=>x.id===5).rate,baseline*0.5);
    assert.equal(status.stateRates.find(x=>x.id===6).rate,0,'miễn nhiễm hiển thị 0%, không phải xác suất mặc định');
    const snapshot=e.save(),before=JSON.stringify(snapshot);e.menuActorStatus(1);assert.equal(JSON.stringify(e.save()),before,'đọc menu không sửa trạng thái');
    await e.restore(snapshot);assert.deepEqual(e.menuActorStatus(1),status);
    e.state.changeActorExp(1,999,true);status=e.menuActorStatus(1);
    assert.equal(e.state.actor(1).level,db.Actors[1].maxLevel);assert.equal(status.nextExp,null);assert.equal(status.hunger,0);
    for(const actor of db.Actors.filter(x=>x&&x.faceName))fs.accessSync(path.join(__dirname,'../game/img/pictures',actor.faceName+'_'+(actor.faceIndex+1)+'.png'));
    console.log('ĐẠT: Hunger ngược EXP theo class/cấp, trạng thái/miễn nhiễm, không đưa guest vào menu, cấp tối đa/save và bust PNG của mọi actor thật.');
})().catch(error=>{console.error(error);process.exitCode=1;});
