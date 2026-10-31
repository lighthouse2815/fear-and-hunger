'use strict';
module.exports=async function ({cdp,url,evalPage,waitFor,check}) {
    await cdp.send('Page.navigate',{url:url+'standalone.html?events=1&map=51'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.map && document.querySelector("#fnh-loading").hidden',30000,'khởi động map cửa');
    await evalPage(cdp,`(async()=>{const a=FNHStandalonePreview;a.scheduler.stop();await new Promise(r=>setTimeout(r,50));await a.engine.restore({mapId:51,x:36,y:63,direction:6,party:[1]});a.audio.setVolume('master',.5);a.audio.setVolume('se',.5);const play=a.audio.play;a.audio.play=function(category,sound,...rest){const result=play.call(this,category,sound,...rest);if(category==='se' && sound.name==='wooden_door'){window.doorSound={name:sound.name,volume:result.volume,pitch:result.playbackRate,url:result.src,playing:false};result.addEventListener('playing',()=>doorSound.playing=true);}return result;};document.querySelector('#fnh-canvas').focus();})()`,true,false);
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
    await waitFor(cdp,'document.querySelectorAll("#fnh-choices button").length===2',5000,'lựa chọn cửa gỗ');
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
    await waitFor(cdp,'window.doorSound && doorSound.playing',5000,'âm thanh cửa phát');
    check('cửa gỗ phát đúng OGG gốc theo âm lượng hiệu ứng',await evalPage(cdp,`doorSound.name==='wooden_door' && doorSound.url.endsWith('/audio/se/wooden_door.ogg') && Math.abs(doorSound.volume-.55*.5*.5)<1e-6 && doorSound.pitch===1`,false,false));
    await waitFor(cdp,'FNHStandalonePreview.engine.state.switchValue(22)',5000,'cửa mở xong');
    await evalPage(cdp,`(async()=>{const a=FNHStandalonePreview;await a.engine.restore({mapId:1,x:16,y:63,direction:4,party:[1]});window.doorSound=null;document.querySelector('#fnh-canvas').focus();})()`,true,false);
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
    await waitFor(cdp,'document.querySelectorAll("#fnh-choices button").length===4',5000,'cửa gỗ trong ngục');
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
    await waitFor(cdp,'window.doorSound && doorSound.playing && FNHStandalonePreview.engine.state.switchValue(22)',5000,'âm thanh cửa trong ngục');
    check('cửa trong ngục cũng mở và phát tiếng cửa gốc',await evalPage(cdp,`doorSound.url.endsWith('/audio/se/wooden_door.ogg') && Math.abs(doorSound.volume-.55*.5*.5)<1e-6`,false,false));
}
