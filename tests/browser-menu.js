'use strict';
module.exports=async function ({cdp,url,evalPage,waitFor,clickElement,check,screenshot}) {
    await cdp.send('Page.navigate',{url:url+'standalone.html?events=1&map=74'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.map && document.querySelector("#fnh-loading").hidden',30000,'khởi động menu');
    await evalPage(cdp,`(async()=>{const a=FNHStandalonePreview;a.scheduler.stop();await new Promise(r=>setTimeout(r,50));await a.engine.restore({mapId:74,x:8,y:8,party:[1,3],menuEnabled:true});document.querySelector('#fnh-canvas').focus();})()`,true,false);
    async function key(key,code,repeat) { await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,autoRepeat:!!repeat});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code}); }
    await key('Escape','Escape');await waitFor(cdp,'document.querySelector("#fnh-menu-dialog").open',5000,'Escape mở menu');
    check('Escape mở đội hình và focus icon Item như bản gốc',await evalPage(cdp,'document.querySelector("#fnh-menu-dialog").classList.contains("fnh-menu-home") && document.activeElement.dataset.menuTab==="inventory" && document.querySelectorAll(".fnh-menu-command-icon").length===6',false,false));
    check('viền hai khung dùng asset gốc, danh sách 70×252 và không có nút đóng thừa',await evalPage(cdp,`(()=>{const d=document.querySelector('#fnh-menu-dialog').getBoundingClientRect(),n=document.querySelector('#fnh-menu-dialog nav');return Math.abs(n.getBoundingClientRect().width/d.width*816-70)<1 && Math.abs(n.getBoundingClientRect().height/d.height*624-252)<1 && n.style.backgroundImage.includes('data:image/png') && getComputedStyle(document.querySelector('#fnh-menu-close')).display==='none';})()`,false,false));
    await screenshot('menu-escape-home');
    await key('ArrowDown','ArrowDown');check('phím hướng chuyển icon sang Eq',await evalPage(cdp,'document.activeElement.dataset.menuTab==="equipment"',false,false));
    await key('Enter','Enter');check('Enter mở trang bị',await evalPage(cdp,'document.querySelector("#fnh-menu-dialog").open && !document.querySelector("#fnh-menu-dialog").classList.contains("fnh-menu-home") && document.querySelector("select[data-slot]")!==null',false,false));
    await key('Escape','Escape');check('Escape từ màn con quay về đội hình và giữ menu',await evalPage(cdp,'FNHStandalonePreview.engine.state.scene==="menu" && document.querySelector("#fnh-menu-dialog").classList.contains("fnh-menu-home")',false,false));
    await key('x','KeyX');await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="map"',5000,'X đóng menu');
    await key('Escape','Escape',true);check('giữ Escape không mở lại menu ngoài ý muốn',await evalPage(cdp,'FNHStandalonePreview.engine.state.scene==="map" && !document.querySelector("#fnh-menu-dialog").open',false,false));
    await key('Escape','Escape');await key('Escape','Escape');check('Escape mở/đóng sạch, không kẹt điều khiển',await evalPage(cdp,'FNHStandalonePreview.engine.state.scene==="map" && FNHStandalonePreview.engine.buttons.size===0',false,false));
    await key('Escape','Escape');await clickElement(cdp,'[data-menu-tab="options"]');await key('Escape','Escape');
    check('Options cũng quay về màn chính khi hủy',await evalPage(cdp,'document.querySelector("#fnh-menu-dialog").classList.contains("fnh-menu-home")',false,false));
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    check('menu co vừa điện thoại và sáu icon vẫn hiện',await evalPage(cdp,`(()=>{const d=document.querySelector('#fnh-menu-dialog').getBoundingClientRect();return d.width<=390 && d.left>=0 && [...document.querySelectorAll('.fnh-menu-command-icon')].every(i=>i.getBoundingClientRect().width>0);})()`,false,false));
    await screenshot('menu-escape-mobile');
    await key('Escape','Escape');
    await evalPage(cdp,`(()=>{const a=FNHStandalonePreview;window.menuSaveDone=false;a.engine.createInterpreter([{code:352},{code:121,parameters:[992,992,0]}],0,a.scheduler.handlers).run().then(()=>window.menuSaveDone=true);})()`,false,false);
    await waitFor(cdp,'document.querySelector("#fnh-menu-dialog").open && FNHStandalonePreview.engine.state.scene==="save"',5000,'màn lưu sự kiện');
    await key('Escape','Escape');await waitFor(cdp,'window.menuSaveDone',5000,'đóng màn lưu sự kiện');
    check('Escape ở màn lưu trả về sự kiện và chạy lệnh tiếp',await evalPage(cdp,'FNHStandalonePreview.engine.state.scene==="map" && FNHStandalonePreview.engine.state.switchValue(992)',false,false));
};
