'use strict';
module.exports=async function ({cdp,url,evalPage,waitFor,check}) {
    await cdp.send('Page.navigate',{url:url+'standalone.html?events=1&map=1'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.map && document.querySelector("#fnh-loading").hidden',30000,'khởi động tung xu');
    await evalPage(cdp,`(()=>{const a=FNHStandalonePreview;a.scheduler.stop();a.audio.setVolume('master',.05);})()`,false,false);
    async function key(type,key,code) {await cdp.send('Input.dispatchKeyEvent',{type,key,code});}
    async function runScenario({battle=false,coin=true,shift='held',rolls=[.1,.9]}) {
        await evalPage(cdp,`(async()=>{const a=FNHStandalonePreview,e=a.engine;await e.restore({mapId:1,x:7,y:55,direction:8,party:[1]});e.state.gainItem('items',201,${coin?1:0});let random=${JSON.stringify(rolls)};e.random=()=>random.shift()??.1;if(${battle}){e.battle.setup(1,true,true);e.state.scene='battle';}window.coinAnimations=[];const animations=e.animations,start=animations.start.bind(animations),startBattle=animations.startBattle.bind(animations);animations.start=function(...args){coinAnimations.push(args[1]);return start(...args);};animations.startBattle=function(...args){coinAnimations.push(args[1]);return startBattle(...args);};window.coinGate=null;window.coinError=null;window.coinAbort=new AbortController();const handlers={...a.scheduler.handlers,afterCommand(command){if(command.code===122 && command.parameters[0]===357)return new Promise(resolve=>window.coinGate=resolve);}};const list=${battle?'e.database.Troops[1].pages[11].list':'e.map.eventById(12).pages[0].list'};e.createInterpreter(list,${battle?0:12},handlers,coinAbort.signal).run().catch(error=>{if(error.name!=='AbortError')coinError=error.message;});})()`,true,false);
        if(!battle){await waitFor(cdp,`[...document.querySelectorAll('#fnh-choices button')].some(b=>b.textContent==='Open')`,5000,'mở rương');await evalPage(cdp,`[...document.querySelectorAll('#fnh-choices button')].find(b=>b.textContent==='Open').click()`,false,false);}
        await waitFor(cdp,`[...document.querySelectorAll('#fnh-choices button')].some(b=>b.textContent==='HEADS')`,10000,'chọn mặt đồng xu');
        if(shift==='held'||shift==='released')await key('keyDown','Shift','ShiftLeft');
        if(shift==='released')await key('keyUp','Shift','ShiftLeft');
        await key('keyDown','Enter','Enter');await key('keyUp','Enter','Enter');
        await waitFor(cdp,'typeof window.coinGate==="function"',5000,'đã chọn mặt đồng xu');
        if(shift==='held')await key('keyUp','Shift','ShiftLeft');
        check('thả Shift sau khi chọn không để phím bị kẹt',await evalPage(cdp,'!FNHStandalonePreview.engine.buttons.has("shift")',false,false));
        if(shift==='after')await key('keyDown','Shift','ShiftLeft');
        await evalPage(cdp,'window.coinGate();window.coinGate=null',false,false);
        await waitFor(cdp,'coinAnimations.length>0 || coinError',5000,'animation đồng xu');
        const result=await evalPage(cdp,`(()=>{const e=FNHStandalonePreview.engine;return {animations:coinAnimations,coins:e.state.itemCount('items',201),second:e.state.variableValue(358),error:coinError};})()`,false,false);
        if(shift==='after')await key('keyUp','Shift','ShiftLeft');
        await evalPage(cdp,'coinAbort.abort()',false,false);
        return result;
    }
    let result=await runScenario({shift:'held'});
    check('giữ Shift khi chọn rương dùng một Lucky coin và tung hai đồng gốc',!result.error && result.coins===0 && result.second===2 && result.animations[0]===267,JSON.stringify(result));
    result=await runScenario({shift:'held',rolls:[.9,.1]});
    check('hai đồng độc lập: đồng thứ hai vẫn có thể ra mặt được chọn',!result.error && result.coins===0 && result.second===1 && result.animations[0]===269,JSON.stringify(result));
    result=await runScenario({shift:'held',rolls:[.9,.9]});
    check('cả hai đồng có thể cùng không ra mặt được chọn',!result.error && result.coins===0 && result.second===2 && result.animations[0]===268,JSON.stringify(result));
    result=await runScenario({shift:'none'});
    check('không giữ Shift chỉ tung một đồng và giữ Lucky coin',!result.error && result.coins===1 && result.animations[0]===7,JSON.stringify(result));
    result=await runScenario({shift:'released'});
    check('thả Shift trước khi chọn không tiêu Lucky coin',!result.error && result.coins===1 && result.animations[0]===7,JSON.stringify(result));
    result=await runScenario({shift:'after'});
    check('nhấn Shift sau khi chọn không tự dùng Lucky coin',!result.error && result.coins===1 && result.animations[0]===7,JSON.stringify(result));
    result=await runScenario({coin:false,shift:'held'});
    check('không có Lucky coin thì giữ Shift vẫn chỉ tung một đồng',!result.error && result.coins===0 && result.animations[0]===7,JSON.stringify(result));
    result=await runScenario({battle:true,shift:'held'});
    check('coin flip trong trận cũng dùng Lucky coin và animation hai đồng',!result.error && result.coins===0 && result.second===2 && result.animations[0]===267,JSON.stringify(result));
};
