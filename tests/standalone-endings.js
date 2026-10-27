'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {GameEngine}=require('../game/engine/game-engine');
const {GameDataStore}=require('../game/engine/data-store');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const watchdog=setTimeout(()=>{console.error('Trang kết thúc chưa chạy hết.');process.exit(1);},20000);
(async()=>{
    const store=new GameDataStore({fetchImpl:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../game',url),'utf8'))})});
    const endings=[
        [[], 'ENDING_E','ending_A'], [[1889],'ENDING_D','ending_D'],
        [[1890],'ENDING_C_II','ending_C'], [[2647],'ENDING_C_II','ending_C_2'],
        [[1891],'ENDING_B','ending_B'], [[1892],'ENDING_A','ending_AA'],
        [[2249],null,'ending_B'], [[2249,662],'ENDING_S_KNIGHT','ending_S_true_god'],
        [[2249,661],'ENDING_S_MERCENARY','ending_S_happy_ending'],
        [[2249,664],'ENDING_S_OUTLANDER','ending_S_violence'],
        [[2249,663],'ENDING_S_DARK_PRIEST','ending_S_enlightenment']
    ];
    for(let index=0;index<endings.length;index++){
        const [switches,achievement,picture]=endings[index];
        const e=new GameEngine({dataStore:store,onRouteEffect:()=>true});
        await e.boot({mapId:86,x:8,y:8,party:[1,3,4,5]});switches.forEach(id=>e.state.setSwitch(id,true));
        const event=e.map.eventById(4),page=e.map.eventPage(event);
        assert.equal(event.pages.indexOf(page),index,'điều kiện switch chọn đúng trang kết thúc');
        const pictures=[],handle=e.screen.handleEffect.bind(e.screen);
        e.screen.handleEffect=(code,parameters)=>{if(code===231)pictures.push(parameters[1]);return handle(code,parameters);};
        let credits=0,messages=0,done=false,result,failure;
        e.runEvent(4,{effect:()=>true,message:()=>{messages++;},scrollText:text=>{assert.match(text,/CREDITS/);assert.match(text,/Miro/);credits++;}})
            .then(value=>{done=true;result=value;},error=>{done=true;failure=error;});
        for(let frame=0;frame<10000&&!done;frame++){e.advanceRoutes(120);await flush();}
        assert.equal(done,true,`trang ${index} phải kết thúc`);if(failure)throw failure;
        assert.equal(result.terminated,'gameover');assert.equal(e.state.scene,'gameover');
        assert.equal(credits,1,'Common310 chạy đầy đủ một lần trước game over');assert.ok(messages>0);
        assert.ok(pictures.includes(picture),`trang ${index} hiện ${picture}`);
        fs.accessSync(path.join(__dirname,'../game/img/pictures',picture+'.png'));
        if(achievement)assert.equal(e.state.achievements[achievement],true);
        const saved=e.save();await e.restore(saved);
        assert.equal(e.state.scene,'gameover');assert.equal(e.state.menuEnabled,false);
        if(achievement)assert.equal(e.state.achievements[achievement],true,'save giữ achievement kết thúc');
        assert.equal(e.move(6),false,'màn kết thúc khóa di chuyển');
    }
    for(const [mapId,eventId,switches,selfSwitch,achievement] of [
        [161,2,[2829,2521],false,null], ...[2521,2522,2523,2524].map(id=>[181,26,[id],true,'OTHER_PROM'])
    ]) {
        const e=new GameEngine({dataStore:store});await e.boot({mapId,x:8,y:8,party:[1,3]});
        switches.forEach(id=>e.state.setSwitch(id,true));if(selfSwitch)e.state.setSelfSwitch(mapId,eventId,'A',true);
        const pictures=[],handle=e.screen.handleEffect.bind(e.screen);
        e.screen.handleEffect=(code,p)=>{if(code===231)pictures.push(p[1]);return handle(code,p);};
        let done=false,failure,credits=0;
        e.runEvent(eventId,{effect:()=>true,message:()=>{},scrollText:text=>{assert.match(text,/CREDITS/);credits++;}})
            .then(()=>{done=true;},error=>{done=true;failure=error;});
        for(let frame=0;frame<10000&&!done;frame++){e.advanceRoutes(120);await flush();}
        assert.equal(done,true);if(failure)throw failure;
        assert.equal(e.state.scene,'gameover');assert.equal(credits,1);assert.ok(pictures.includes('ending_happy'));
        if(achievement)assert.equal(e.state.achievements[achievement],true);
    }
    const e=new GameEngine({dataStore:store});await e.boot({mapId:159,x:8,y:8,party:[1]});
    e.state.setSelfSwitch(159,16,'A',true);
    const pictures=[],handle=e.screen.handleEffect.bind(e.screen);
    e.screen.handleEffect=(code,p)=>{if(code===231)pictures.push(p[1]);return handle(code,p);};
    let done=false,failure;e.runEvent(16,{effect:()=>true}).then(()=>{done=true;},error=>{done=true;failure=error;});
    for(let frame=0;frame<10000&&!done;frame++){e.advanceRoutes(120);await flush();}
    assert.equal(done,true);if(failure)throw failure;
    assert.deepEqual(pictures,Array.from({length:6},(_,i)=>'text_endingA_'+(i+1)));
    assert.equal(e.state.mapId,86);assert.equal(e.state.switchValue(1892),true);
    assert.equal(e.map.eventById(4).pages.indexOf(e.map.eventPage(e.map.eventById(4))),5,'đoạn chữ Ending A chuyển đúng trang Map086');
    console.log('ĐẠT: 11 trang Map086 (A/B/C/D/E/S), Happy/Prom Map161/181 và sáu ảnh chữ Map159 tới Ending A; switch/picture/thoại/credits/achievement/game over/save.');
})().then(()=>clearTimeout(watchdog)).catch(error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
