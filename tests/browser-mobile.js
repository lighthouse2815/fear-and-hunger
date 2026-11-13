'use strict';
module.exports = async function ({cdp,url,evalPage,waitFor,check}) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    await cdp.send('Page.navigate',{url:url+'standalone.html?events=1&map=74'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.scheduler && document.querySelector("#fnh-loading").hidden',30000,'khởi động game trên điện thoại');
    await evalPage(cdp,`(()=>{const a=FNHStandalonePreview;a.scheduler.stop();a.engine.state.x=4;a.engine.state.y=0;a.engine.state.through=true;})()`,false,false);
    async function point(selector) {
        return evalPage(cdp,`(async()=>{
            const button=document.querySelector(${JSON.stringify(selector)});button.scrollIntoView({block:'center',behavior:'instant'});
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const rect=button.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,id:1};
        })()`,true,false);
    }
    async function tap(selector) {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[await point(selector)]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }
    check('nút điều khiển cảm ứng đủ lớn và hiển thị trong game',await evalPage(cdp,`(()=>{
        const controls=document.querySelector('#fnh-controls');
        return getComputedStyle(controls).display==='grid' && [...controls.querySelectorAll('button')].every(button=>button.getBoundingClientRect().height>=44);
    })()`,false,false));
    const right=await point('#fnh-controls [data-direction="6"]');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[right]});
    await waitFor(cdp,'FNHStandalonePreview.engine.state.x>=6',5000,'giữ nút để di chuyển');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await waitFor(cdp,'!FNHStandalonePreview.engine.buttons.has("right") && !FNHStandalonePreview.engine.state.moveFrames',5000,'thả nút dừng di chuyển');
    check('giữ và thả nút cảm ứng di chuyển rồi dừng',await evalPage(cdp,'FNHStandalonePreview.engine.state.x>=6 && !FNHStandalonePreview.engine.buttons.has("right")',false,false));
    await tap('#fnh-controls [data-action="cancel"]');
    await waitFor(cdp,'document.querySelector("#fnh-menu-dialog").open',5000,'mở menu bằng cảm ứng');
    check('nút quay lại hiện trong menu điện thoại',await evalPage(cdp,'document.querySelector("#fnh-touch-menu-back").getBoundingClientRect().height>=44',false,false));
    await tap('#fnh-touch-menu-back');
    await waitFor(cdp,'!document.querySelector("#fnh-menu-dialog").open',5000,'đóng menu bằng cảm ứng');
    await evalPage(cdp,`(()=>{
        window.__mobileChoice=null;
        FNHStandalonePreview.scheduler.handlers.choice(['Một','Hai'],-2,null,
            {disabled:[],help:[],message:[],defaultIndex:0}).then(value=>window.__mobileChoice=value);
    })()`,false,false);
    await waitFor(cdp,'document.querySelectorAll("#fnh-choices button").length===2',5000,'mở lựa chọn');
    await tap('#fnh-controls [data-action="cancel"]');
    await waitFor(cdp,'window.__mobileChoice!==null',5000,'hủy lựa chọn bằng cảm ứng');
    check('nút quay lại hủy đúng nhánh lựa chọn',await evalPage(cdp,'window.__mobileChoice===-2',false,false));
    await cdp.send('Page.navigate',{url:url+'standalone.html?events=1&map=10'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.state && FNHStandalonePreview.engine.state.switchValue(296)',30000,'màn chọn nhân vật');
    check('màn chọn nhân vật hiện nút hướng',await evalPage(cdp,'getComputedStyle(document.querySelector("#fnh-controls")).display==="grid"',false,false));
    await tap('#fnh-controls [data-direction="6"]');
    await waitFor(cdp,'FNHStandalonePreview.engine.state.variableValue(9)===2',5000,'chạm chọn nhân vật');
    check('chạm hướng phải đổi nhân vật',await evalPage(cdp,'FNHStandalonePreview.engine.state.screen.pictures[7].name==="text_knight"',false,false));
    await tap('#fnh-controls [data-action="cancel"]');
    await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="title"',5000,'quay về tiêu đề');
    check('nút quay lại thoát màn chọn nhân vật',await evalPage(cdp,'!document.querySelector("#fnh-end-screen").hidden',false,false));
};
