'use strict';
module.exports=async function ({cdp,url,evalPage,waitFor,check}) {
    await cdp.send('Page.navigate',{url:url+'standalone.html?events=1&map=74'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.map && document.querySelector("#fnh-loading").hidden',30000,'khởi động kiểm tra bất tử');
    await evalPage(cdp,`(async()=>{const a=FNHStandalonePreview;a.scheduler.stop();await new Promise(r=>setTimeout(r,50));a.audio.setVolume('master',.05);await a.engine.restore({mapId:74,x:8,y:8,party:[1]});await a.engine.createInterpreter([{code:320,parameters:[1,' LiGhThOuSe ']}],0).run();})()`,true,false);
    const light=await evalPage(cdp,`(async()=>{
        const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore});
        await e.boot({mapId:16,x:36,y:39,party:[1,3],followersVisible:false});e.lighting.handleCommand('Light radius 0 #FFFFFF');
        const canvas=document.createElement('canvas'),renderer=new FNHStandaloneCanvas.CanvasRenderer(canvas);
        async function brightness(){await renderer.draw(e);const p=canvas.getContext('2d').getImageData(0,0,816,624).data;let sum=0;for(let i=0;i<p.length;i+=64)sum+=p[i]+p[i+1]+p[i+2];return sum;}
        const dark=await brightness();e.state.setActorName(3,' LiGhThOuSe ');const bright=await brightness();
        const saved=e.save();e.state.party=[1];const outside=await brightness();
        await e.restore(saved);const restored=await brightness();
        e.state.setActorName(3,'Mercenary');const renamed=await brightness();
        return {dark,bright,outside,restored,renamed,radius:e.state.lighting.radius};
    })()`,true,false);
    check('lighthouse trong đội chiếu sáng toàn bản đồ không cần đuốc',light.bright>light.dark*1.5 && light.radius===0,JSON.stringify(light));
    check('ánh sáng theo tên và đội, giữ sau tải save và tắt khi đổi tên',
        light.outside<light.bright/3 && light.renamed<light.bright/3 && Math.abs(light.restored-light.bright)<light.bright*0.01,JSON.stringify(light));
    check('lighthouse chặn HP về 0 và trạng thái chết từ lệnh sự kiện',await evalPage(cdp,`(async()=>{const e=FNHStandalonePreview.engine;await e.createInterpreter([{code:311,parameters:[0,1,1,0,999999,true]},{code:313,parameters:[0,1,0,1]}],0).run();return e.state.actor(1).hp===e.state.actorParam(1,0) && !e.state.actor(1).states.includes(1);})()`,true,false));
    await evalPage(cdp,'FNHStandalonePreview.engine.createInterpreter([{code:353},{code:121,parameters:[991,991,0]}],0).run()',true,false);
    await evalPage(cdp,'new Promise(requestAnimationFrame)',true,false);
    check('Game Over cốt truyện không mở màn chết và lệnh tiếp theo vẫn chạy',await evalPage(cdp,'FNHStandalonePreview.engine.state.scene==="map" && FNHStandalonePreview.engine.state.switchValue(991) && document.querySelector("#fnh-end-screen").hidden',false,false));
    check('thất bại trong trận có cheat trả về bản đồ',await evalPage(cdp,`(()=>{const e=FNHStandalonePreview.engine;e.battle.setup(1,false,false);e.state.scene='battle';const result=e.battle.finish('defeat');e.leaveBattle(result);return result==='escape' && e.state.scene==='map' && e.state.actor(1).hp>0;})()`,false,false));
    check('save Game Over cũ tải lại thành nhân vật sống trên bản đồ',await evalPage(cdp,`(async()=>{const a=FNHStandalonePreview,snapshot=a.engine.save();snapshot.scene='gameover';snapshot.actors[1].hp=0;snapshot.actors[1].states.push(1);const saves=new FNHStandaloneSave.SaveStore({prefix:'FNH_CHEAT_TEST:'});saves.save(1,snapshot);await a.engine.restore(saves.load(1));return a.engine.state.scene==='map' && a.engine.state.actor(1).hp>0 && !a.engine.state.actor(1).states.includes(1);})()`,true,false));
    await evalPage(cdp,`FNHStandalonePreview.engine.createInterpreter([{code:320,parameters:[1,'Mercenary']},{code:353},{code:121,parameters:[992,992,0]}],0).run()`,true,false);
    await waitFor(cdp,'!document.querySelector("#fnh-end-screen").hidden',5000,'Game Over khi tắt cheat');
    check('tắt cheat vẫn mở Game Over và dừng sự kiện bình thường',await evalPage(cdp,'FNHStandalonePreview.engine.state.scene==="gameover" && !FNHStandalonePreview.engine.state.switchValue(992) && document.querySelector("#fnh-end-title").textContent==="Game Over"',false,false));
};
