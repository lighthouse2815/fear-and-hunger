'use strict';
module.exports=async function ({cdp,url,evalPage,waitFor,check}) {
    async function key(key,code) {await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code});}
    async function mouse(selector) {
        const point=await evalPage(cdp,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`,false,false);
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
        await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    }
    await cdp.send('Page.navigate',{url:url+'standalone.html?events=1&map=74'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.map && document.querySelector("#fnh-loading").hidden',30000,'khởi động bàn phím');
    await evalPage(cdp,`(async()=>{const a=FNHStandalonePreview;a.scheduler.stop();a.audio.setVolume('master',.05);await new Promise(r=>setTimeout(r,50));await a.engine.restore({mapId:74,x:8,y:8,party:[1,3],menuEnabled:true});document.querySelector('#fnh-canvas').focus();})()`,true,false);
    await key('Escape','Escape');
    check('Escape vẫn mở menu bằng bàn phím',await evalPage(cdp,'document.activeElement.dataset.menuTab==="inventory" && document.querySelector("#fnh-menu-dialog").open',false,false));
    await mouse('[data-menu-tab=equipment]');
    check('rê và bấm chuột không đổi tab, không lấy focus',await evalPage(cdp,'document.activeElement.dataset.menuTab==="inventory" && document.querySelector("#fnh-menu-content").dataset.menuPage==="status"',false,false));
    await key('ArrowDown','ArrowDown');
    check('Down vẫn đổi trang bị ngay',await evalPage(cdp,'document.activeElement.dataset.menuTab==="equipment" && document.querySelector("#fnh-menu-content").dataset.menuPage==="equipment"',false,false));
    const before=await evalPage(cdp,'JSON.stringify(FNHStandalonePreview.engine.state.actor(1).equips)',false,false);
    await mouse('[data-equipment-action=clear]');
    check('bấm chuột không tháo trang bị',await evalPage(cdp,'JSON.stringify(FNHStandalonePreview.engine.state.actor(1).equips)',false,false)===before);
    await key('Enter','Enter');
    check('Enter mở chọn nhân vật cho trang bị',await evalPage(cdp,'document.activeElement.closest("[data-party-actor]").dataset.partyActor==="1"',false,false));
    await key('Enter','Enter');
    check('Enter vẫn chuyển vào các lệnh bên phải',await evalPage(cdp,'document.activeElement.dataset.menuKey==="equip"',false,false));
    await key('Escape','Escape');await key('Escape','Escape');
    await evalPage(cdp,`(()=>{const a=FNHStandalonePreview;window.inputDialogueDone=false;a.engine.createInterpreter([{code:101,parameters:['',0,0,2]},{code:401,parameters:['Keyboard only']}],0,a.scheduler.handlers).run().then(()=>window.inputDialogueDone=true);})()`,false,false);
    await waitFor(cdp,'!document.querySelector("#fnh-next").hidden',5000,'thoại');
    await mouse('#fnh-next');check('click chuột không bỏ qua lời thoại',await evalPage(cdp,'!window.inputDialogueDone && !document.querySelector("#fnh-next").hidden',false,false));
    await key('z','KeyZ');await waitFor(cdp,'window.inputDialogueDone',5000,'Z đọc tiếp');
    check('Z đọc tiếp và trả điều khiển',await evalPage(cdp,'!FNHStandalonePreview.engine.messageRunning',false,false));
    await evalPage(cdp,'FNHStandalonePreview.engine.openMenu();FNHStandalonePreview.engine.returnMenuToTitle()',false,false);
    await waitFor(cdp,'!document.querySelector("#fnh-end-screen").hidden',5000,'title');
    await mouse('#fnh-new-game');check('chuột không bắt đầu game từ title',await evalPage(cdp,'FNHStandalonePreview.engine.state.scene==="title"',false,false));
    await key('Enter','Enter');await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.state && FNHStandalonePreview.engine.state.mapId===10',10000,'Enter chơi mới');
    check('Enter vẫn bắt đầu game',await evalPage(cdp,'FNHStandalonePreview.engine.state.scene==="map"',false,false));
};
