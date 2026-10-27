'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {GameEngine}=require('../game/engine/game-engine');
const {GameDataStore}=require('../game/engine/data-store');
const {EventScheduler}=require('../game/engine/event-scheduler');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const watchdog=setTimeout(()=>{console.error('Chuyển cảnh trận chưa kết thúc.');process.exit(1);},15000);
(async()=>{
    const store=new GameDataStore({fetchImpl:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../game',url),'utf8'))})});
    const e=new GameEngine({dataStore:store,onRouteEffect:()=>true});await e.boot({mapId:74,x:8,y:8,party:[1]});
    const id=e.database.Troops.length;
    e.database.Troops.push({id,members:[e.database.Troops[1].members[0]],pages:[{span:0,conditions:{turnValid:true,turnA:0,turnB:0},list:[{code:121,parameters:[7310,7310,0]}]}]});
    const phases=[];let next;
    const handlers={battleTransition(phase){phases.push([phase,e.state.scene]);if(phase!=='cancel')return new Promise(resolve=>{next=resolve;});}};
    const commands=[{code:301,parameters:[0,id,true,true]},{code:121,parameters:[7311,7311,0]}];
    let done=false;const running=e.createInterpreter(commands,0,handlers).run().then(()=>{done=true;});await flush();
    assert.equal(e.battle.battle.phase,'transition');assert.equal(e.state.switchValue(7310),false);
    await assert.rejects(e.battleAttack(1,0),/Chưa đến lượt/);assert.equal(e.move(6),false);
    next();await flush();assert.equal(e.battle.battle.phase,'input');assert.equal(e.state.switchValue(7310),true);
    e.battle.finish('escape');await flush();assert.deepEqual(phases,[['start','battle'],['out','battle']]);
    assert.equal(e.state.scene,'battle');assert.equal(done,false);assert.equal(e.state.switchValue(7311),false);
    next();await flush();assert.deepEqual(phases[2],['in','map']);assert.equal(done,false);
    next();await running;assert.deepEqual(phases[3],['cancel','map']);assert.equal(e.state.switchValue(7311),true);
    // Hủy ở bất kỳ pha nào giải phóng callback và không chạy lệnh map muộn.
    for(const abortAt of ['start','out','in']){
        e.state.scene='map';e.state.setSwitch(7311,false);const calls=[],controller=new AbortController();let release;
        const pending=e.createInterpreter(commands,0,{battleTransition(phase){calls.push(phase);if(phase===abortAt)return new Promise(resolve=>{release=resolve;});}},controller.signal).run();
        const rejected=assert.rejects(pending,{name:'AbortError'});await flush();
        if(abortAt!=='start'){e.battle.finish('escape');await flush();}
        assert.ok(calls.includes(abortAt));controller.abort();await rejected;await flush();
        assert.ok(calls.includes('cancel'),'adapter không cần tự giải phóng promise để engine hủy');
        // Pha in cũng phải được hủy khi adapter chưa tự xử lý signal.
        if(release)release();await flush();
        assert.ok(calls.includes('cancel'));assert.equal(e.state.switchValue(7311),false);assert.equal(e.state.scene,'map');
    }
    const directPhases=[];
    const direct=e.startBattle([0,id,true,true],null,{battleTransition:phase=>{directPhases.push(phase);}});
    await flush();e.battle.finish('escape');assert.equal(await direct,1);
    assert.deepEqual(directPhases,['start','out','in','cancel'],'API trực tiếp không cần interpreter vẫn giữ thứ tự chuyển cảnh');
    // Autorun không tự hủy signal ở game over trong khi fade cuối còn đang chạy.
    const event=e.map.eventById(39),page=e.map.eventPage(event);event.pages=[{...page,trigger:3,list:commands}];e.map.events=[event];
    const scheduledPhases=[],errors=[];
    const scheduler=new EventScheduler(e,{battleTransition(phase){scheduledPhases.push(phase);if(phase!=='cancel')return new Promise(resolve=>{next=resolve;});}},error=>errors.push(error));
    scheduler.tick();await flush();next();await flush();e.battle.finish('defeat');await flush();next();await flush();
    assert.equal(e.state.scene,'gameover');const signal=scheduler.autorun.controller.signal;
    scheduler.tick();await flush();assert.equal(signal.aborted,false,'scheduler chờ chuyển cảnh cuối thay vì cắt fade game over');
    assert.equal(e.eventRunning,true);next();await flush();assert.equal(e.eventRunning,false);assert.deepEqual(errors,[]);
    assert.deepEqual(scheduledPhases,['start','out','in','cancel']);scheduler.stop();
    e.state.scene='map';e.state.setSwitch(7311,false);
    const stopPhases=[],stopped=new EventScheduler(e,{battleTransition(phase){stopPhases.push(phase);if(phase!=='cancel')return new Promise(resolve=>{next=resolve;});}},error=>errors.push(error));
    stopped.tick();await flush();const stoppedSignal=stopped.autorun.controller.signal;stopped.stop();await flush();
    assert.equal(stoppedSignal.aborted,true);assert.equal(e.eventRunning,false);assert.equal(e.state.switchValue(7311),false);
    assert.deepEqual(stopPhases,['start','cancel']);assert.deepEqual(errors,[],'dừng scheduler vẫn hủy fade chủ động mà không báo lỗi giả');
    console.log('ĐẠT: fade mở trước page/input, đóng trước rời trận, hiện map trước tiếp event; hủy mỗi pha dọn callback và khóa lệnh muộn.');
})().then(()=>clearTimeout(watchdog)).catch(error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
