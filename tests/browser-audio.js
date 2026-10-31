'use strict';
module.exports = async function ({cdp,url,evalPage,waitFor,check}) {
    await cdp.send('Page.navigate',{url:url+'standalone.html?events=1&map=74'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.map && document.querySelector("#fnh-loading").hidden',30000,'khởi động kiểm tra âm thanh');
    await evalPage(cdp,`(()=>{const a=FNHStandalonePreview;a.scheduler.stop();a.engine.autonomousEnabled=false;a.engine.state.setActorName(1,'lighthouse');})()`,false,false);
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'p',code:'KeyP'});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'p',code:'KeyP'});
    await evalPage(cdp,`(()=>{const a=FNHStandalonePreview.audio;a.setVolume('master',.05);window.audioFailures=[];a.onError=error=>audioFailures.push(error.message);a.play('bgm',{name:'fear_and_hunger',volume:80});})()`,false,false);
    await waitFor(cdp,'FNHStandalonePreview.audio.context.state==="running" && FNHStandalonePreview.audio.buffers.bgm.currentTime>0',10000,'nhạc nền đang phát');
    await evalPage(cdp,`(async()=>{const a=FNHStandalonePreview.audio;for(let i=0;i<200;i++){a.play('se',{name:'footstep_tile',volume:20,pitch:70});await new Promise(resolve=>setTimeout(resolve,20));}})()`,true,false);
    await waitFor(cdp,'FNHStandalonePreview.audio.seBuffers.length===0',15000,'thu hồi các tiếng bước chân');
    check('phát nhiều tiếng bước chân không giữ hiệu ứng cũ và nhạc vẫn chạy',await evalPage(cdp,`(()=>{const a=FNHStandalonePreview.audio;return a.context.state==='running' && !a.buffers.bgm.paused && a.buffers.bgm.currentTime>2 && a.tracks.size===1 && audioFailures.length===0;})()`,false,false));
    await evalPage(cdp,'FNHStandalonePreview.audio.context.suspend()',true,false);
    await waitFor(cdp,'FNHStandalonePreview.audio.context.state==="running"',5000,'tự khôi phục âm thanh bị ngắt trong khi chơi');
    check('âm thanh tự tiếp tục sau khi trình duyệt tạm ngắt',await evalPage(cdp,`(async()=>{const a=FNHStandalonePreview.audio,track=a.tracks.get(a.buffers.bgm),analyser=a.context.createAnalyser();analyser.fftSize=2048;track.panGraph.panner.connect(analyser);analyser.connect(a.context.destination);try{await new Promise(resolve=>setTimeout(resolve,250));const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);return !a.buffers.bgm.paused && samples.some(value=>Math.abs(value)>0.000001);}finally{track.panGraph.panner.disconnect(analyser);analyser.disconnect();}})()`,true,false));
    const soakSeconds = Number(process.env.FNH_AUDIO_SOAK_SECONDS || 0);
    if (soakSeconds > 0) {
        await evalPage(cdp,`(()=>{const a=FNHStandalonePreview.audio;window.audioSoak={done:false,plays:0,interruptions:0,maxBuffers:0};const start=performance.now(),timer=setInterval(()=>{audioSoak.plays++;if(a.context.state!=='running'||!a.buffers.bgm||a.buffers.bgm.paused)audioSoak.interruptions++;a.play('se',{name:'footstep_tile',volume:20,pitch:70});audioSoak.maxBuffers=Math.max(audioSoak.maxBuffers,a.seBuffers.length);if(performance.now()-start>=${soakSeconds * 1000}){clearInterval(timer);audioSoak.done=true;}},500);})()`,false,false);
        await waitFor(cdp,'audioSoak.done',soakSeconds*1000+15000,'phát âm thanh liên tục');
        const result=await evalPage(cdp,`({...audioSoak,errors:audioFailures.slice(),running:FNHStandalonePreview.audio.context.state==='running',paused:!FNHStandalonePreview.audio.buffers.bgm||FNHStandalonePreview.audio.buffers.bgm.paused})`,false,false);
        check('phát nhạc và bước chân liên tục không mất âm thanh',result.running && !result.paused && !result.interruptions && !result.errors.length && result.plays>=soakSeconds && result.maxBuffers<20,JSON.stringify(result));
    }
};
