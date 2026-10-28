'use strict';
module.exports=async function ({cdp,url,evalPage,waitFor,check,screenshot}) {
    // Điều khiển đồng hồ hiển thị để kiểm tra cả màn 30/60/120Hz ổn định.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`
        window.walkFrames=[];let now=performance.now();window.requestAnimationFrame=callback=>walkFrames.push(callback);
        window.advanceDisplay=async function(frames,count){for(let i=0;i<count;i++){now+=frames*1000/60;for(const callback of walkFrames.splice(0))await callback(now);await new Promise(resolve=>setTimeout(resolve,0));}};
    `});
    await cdp.send('Page.navigate',{url:url+'standalone.html?events=1&map=74'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.map && document.querySelector("#fnh-loading").hidden',30000,'khởi động di chuyển');
    await evalPage(cdp,`(async()=>{const a=FNHStandalonePreview;a.scheduler.stop();a.audio.setVolume('master',.05);const e=a.engine;
        window.walkTrace=[];window.walkDraws=[];let elapsed=0;const advance=e.advanceRoutes,move=e.move;
        e.advanceRoutes=function(frames){elapsed+=frames;return advance.call(this,frames);};
        e.move=function(direction){const moved=move.call(this,direction);if(moved)walkTrace.push({elapsed,duration:this.state.moveFrames,x:this.state.x,y:this.state.y});return moved;};
        const draw=FNHStandaloneCanvas.CanvasRenderer.prototype.drawActorImage;
        FNHStandaloneCanvas.CanvasRenderer.prototype.drawActorImage=function(sheets,actor,x,y){if(actor.id===Infinity)walkDraws.push(actor.image.pattern);return draw.call(this,sheets,actor,x,y);};
        await advanceDisplay(1,2);})()`,true,false);
    async function drive(frames,count) {await evalPage(cdp,`advanceDisplay(${frames},${count})`,true,false);}
    async function key(type,key,code) {await cdp.send('Input.dispatchKeyEvent',{type,key,code});}
    async function prepare(dash=true) {
        await evalPage(cdp,`(async()=>{const e=FNHStandalonePreview.engine;await e.restore({mapId:74,x:8,y:8,party:[1,3],alwaysDash:false});e.autonomousEnabled=false;e.forceDashing=${dash};e.state.through=true;e.buttons.clear();walkTrace=[];walkDraws=[];document.querySelector('#fnh-canvas').focus();})()`,true,false);
    }
    for (const [name,frames,count,dash] of [['60Hz',1,64,true],['120Hz',.5,128,true],['30Hz',2,32,true],['đi bộ',1,64,false]]) {
        await prepare(dash);
        await key('keyDown','ArrowRight','ArrowRight');await drive(frames,count);await key('keyUp','ArrowRight','ArrowRight');await drive(frames,Math.ceil(40/frames));
        const trace=await evalPage(cdp,'walkTrace',false,false),duration=dash?8:16;
        const gaps=trace.slice(1).map((entry,i)=>entry.elapsed-trace[i].elapsed-trace[i].duration);
        check(name+': nối bước đúng tốc độ và không dừng dư giữa ô',trace.length>=4 && trace.every(entry=>entry.duration===duration) && gaps.every(gap=>gap===0),JSON.stringify(gaps));
        check(name+': thả phím dừng sạch, hình đứng ổn định',await evalPage(cdp,`!FNHStandalonePreview.engine.stepRunning && !FNHStandalonePreview.engine.state.moveFrames && FNHStandalonePreview.engine.buttons.size===0 && walkDraws.at(-1)===1 && walkDraws.includes(0) && walkDraws.includes(2)`,false,false));
        const stopped=trace.length;await drive(frames,10);
        check(name+': không tự đi thêm sau khi thả phím',await evalPage(cdp,'walkTrace.length',false,false)===stopped);
    }
    await prepare();await key('keyDown','ArrowRight','ArrowRight');await drive(1,3);
    await key('keyUp','ArrowRight','ArrowRight');await key('keyDown','ArrowDown','ArrowDown');await drive(1,5);
    check('đổi hướng ở cuối bước, không nhảy chéo hoặc dừng tại góc',await evalPage(cdp,'walkTrace.length===2 && walkTrace[0].x===9 && walkTrace[0].y===8 && walkTrace[1].x===9 && walkTrace[1].y===9 && walkTrace[1].elapsed-walkTrace[0].elapsed===8',false,false));
    await key('keyUp','ArrowDown','ArrowDown');await drive(1,40);
    await key('keyDown','Escape','Escape');await key('keyUp','Escape','Escape');
    check('sau khi dừng vẫn mở được menu Escape',await evalPage(cdp,'document.querySelector("#fnh-menu-dialog").open && FNHStandalonePreview.engine.state.scene==="menu"',false,false));
    await screenshot('movement-after-stop-menu');
    await key('keyDown','Escape','Escape');await key('keyUp','Escape','Escape');
    check('đóng menu trả lại điều khiển, không kẹt bước cũ',await evalPage(cdp,'FNHStandalonePreview.engine.state.scene==="map" && !FNHStandalonePreview.engine.stepRunning',false,false));
    await prepare();
    await evalPage(cdp,`(()=>{const e=FNHStandalonePreview.engine;window.savedTorchEvent=e.database.CommonEvents[289];e.database.CommonEvents[289]={id:289,list:[{code:121,parameters:[991,991,0]},{code:0}]};})()`,false,false);
    try {
        await key('keyDown','ArrowRight','ArrowRight');await drive(1,3);
        await key('keyDown','t','KeyT');await drive(1,48);
        check('giữ hướng không chặn phím tắt common event ở cuối bước',await evalPage(cdp,'FNHStandalonePreview.engine.state.switchValue(991)',false,false));
    } finally {
        await key('keyUp','t','KeyT');await key('keyUp','ArrowRight','ArrowRight');await drive(1,40);
        await evalPage(cdp,'FNHStandalonePreview.engine.database.CommonEvents[289]=savedTorchEvent',false,false);
    }
};
