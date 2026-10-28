'use strict';
module.exports=async function ({cdp,url,evalPage,waitFor,check,screenshot}) {
    await cdp.send('Page.navigate',{url:url+'standalone.html?events=1&map=24'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.map && document.querySelector("#fnh-loading").hidden',30000,'khởi động đội hình');
    await evalPage(cdp,`(async()=>{const a=FNHStandalonePreview;a.scheduler.stop();await new Promise(r=>setTimeout(r,50));a.audio.setVolume('master',.05);await a.engine.restore({mapId:24,x:59,y:18,direction:8,party:[1],switches:{246:true,1016:true}});await a.engine.runEvent(191,{message:async()=>{},choice:async()=>0,effect:async()=>true});window.partyDraws=[];const draw=FNHStandaloneCanvas.CanvasRenderer.prototype.drawActorImage;FNHStandaloneCanvas.CanvasRenderer.prototype.drawActorImage=function(sheets,actor,x,y){if(actor.id===Infinity||actor.id>=100000)partyDraws.push({id:actor.id,name:actor.image.characterName,x:actor.x,y:actor.y});return draw.call(this,sheets,actor,x,y);};document.querySelector('#fnh-canvas').focus();})()`,true,false);
    check('sự kiện Le\'garde thật thêm đúng đội và hiện người đi theo',await evalPage(cdp,'JSON.stringify(FNHStandalonePreview.engine.state.party)==="[1,6]" && FNHStandalonePreview.engine.state.followersVisible',false,false));
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown'});
    await waitFor(cdp,'FNHStandalonePreview.engine.state.y>=20',5000,'đi cùng Le\'garde');
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown'});
    await waitFor(cdp,'!FNHStandalonePreview.engine.stepRunning && !FNHStandalonePreview.engine.state.moveFrames',5000,'dừng cả đội');
    check('renderer vẽ sprite captain ở phía sau nhân vật dẫn đầu',await evalPage(cdp,`(()=>{const e=FNHStandalonePreview.engine,f=e.state.followers()[0];return f.id===6 && f.y!==e.state.y && partyDraws.some(d=>d.id===100006&&d.name==='captain') && partyDraws.some(d=>d.id===Infinity);})()`,false,false));
    await screenshot('legarde-follows-after-recruitment');
    check('save cũ bị ẩn sai tải lại thấy Le\'garde',await evalPage(cdp,`(async()=>{const e=FNHStandalonePreview.engine,s=e.save();delete s.followerVisibilityVersion;s.followersVisible=false;const store=new FNHStandaloneSave.SaveStore({prefix:'FNH_PARTY_TEST:'});store.save(1,s);await e.restore(store.load(1));return e.state.followersVisible && e.state.followers()[0].id===6;})()`,true,false));
    check('216 ẩn đúng trong cảnh truyện và save mới giữ cờ ẩn',await evalPage(cdp,`(async()=>{const e=FNHStandalonePreview.engine;await e.createInterpreter([{code:216,parameters:[1]}],0).run();await e.restore(e.save());return !e.state.followersVisible;})()`,true,false));
    await evalPage(cdp,'FNHStandalonePreview.engine.createInterpreter([{code:216,parameters:[0]}],0).run();partyDraws=[]',true,false);
    await waitFor(cdp,'partyDraws.some(d=>d.id===100006)',5000,'216 hiện lại sprite Le\'garde');
    check('216 hiện lại đồng đội sau cảnh truyện',await evalPage(cdp,'FNHStandalonePreview.engine.state.followersVisible',false,false));
};
