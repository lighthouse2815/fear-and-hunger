'use strict';
module.exports=async function ({cdp,url,evalPage,waitFor,check}) {
    async function key(key) {
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});
    }
    await cdp.send('Page.navigate',{url:url+'standalone.html?title=1'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.state && FNHStandalonePreview.engine.state.scene==="title" && !document.querySelector("#fnh-end-screen").hidden',30000,'màn hình chính');
    await evalPage(cdp,`(()=>{const a=FNHStandalonePreview.audio,play=a.play;window.cursorSounds=[];window.cursorPlayed=false;a.play=function(category,sound,...rest){const track=play.call(this,category,sound,...rest);if(category==='se' && sound.name==='fnh_cursor'){cursorSounds.push({sound:{...sound},volume:track.volume,rate:track.playbackRate});track.addEventListener('playing',()=>window.cursorPlayed=true);}return track;};})()`,false,false);
    await key('ArrowDown');
    await waitFor(cdp,'window.cursorPlayed',5000,'âm thanh con trỏ phát thật');
    check('di chuyển ở tiêu đề phát đúng âm thanh gốc theo âm lượng SE',await evalPage(cdp,`(()=>{const a=FNHStandalonePreview.audio,s=cursorSounds[0],original=FNHStandalonePreview.engine.database.System.sounds[0];return cursorSounds.length===1 && s.sound.name===original.name && s.sound.pitch===original.pitch && s.rate===1.4 && Math.abs(s.volume-a.masterVolume*a.volumes.se*.75)<1e-6;})()`,false,false));
    await key('Enter');
    check('màn chính mở cài đặt bằng bàn phím',await evalPage(cdp,`!document.querySelector('#fnh-title-settings').hidden && document.activeElement.dataset.setting==='language'`,false,false));
    await key('ArrowRight');
    check('tiếng Việt cập nhật ngay giao diện cài đặt',await evalPage(cdp,`document.documentElement.lang==='vi' && document.querySelector('[data-setting=screenWidth]').textContent.includes('Cỡ màn hình') && document.querySelector('#fnh-open-settings').textContent==='Cài đặt'`,false,false));
    await key('ArrowDown');await key('ArrowRight');await key('ArrowDown');
    await waitFor(cdp,'cursorSounds.length===5',2000,'âm thanh điều hướng cài đặt');
    await evalPage(cdp,'window.cursorBeforeBoundary=cursorSounds.length',false,false);await key('ArrowRight');
    await evalPage(cdp,'new Promise(resolve=>setTimeout(resolve,30))',true,false);
    check('không phát tiếng khi âm lượng đã ở mức tối đa',await evalPage(cdp,'cursorSounds.length===cursorBeforeBoundary',false,false));
    await key('ArrowLeft');
    await waitFor(cdp,'cursorSounds.length===cursorBeforeBoundary+1',2000,'âm thanh đổi âm lượng');
    check('đổi giá trị cài đặt phát một tiếng con trỏ',await evalPage(cdp,'cursorSounds.length===cursorBeforeBoundary+1',false,false));
    check('cỡ màn hình và âm lượng được áp dụng và lưu',await evalPage(cdp,`(()=>{const s=FNHStandalonePreview.settings, saved=JSON.parse(localStorage.getItem('FNH_STANDALONE_PREVIEW_SETTINGS'));return s.screenWidth==='large' && s.volumes.master===80 && saved.language==='vi' && saved.screenWidth==='large' && saved.volumes.master===80;})()`,false,false));
    await key('Escape');
    check('thoát cài đặt trở về màn chính và giữ lựa chọn',await evalPage(cdp,`document.querySelector('#fnh-title-settings').hidden && document.activeElement.id==='fnh-open-settings' && document.querySelector('#fnh-new-game').textContent==='Chơi mới'`,false,false));
    await cdp.send('Page.reload');
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.state && FNHStandalonePreview.engine.state.scene==="title" && !document.querySelector("#fnh-end-screen").hidden',30000,'tải lại màn hình chính');
    check('tải lại giữ ngôn ngữ, kích thước và âm lượng',await evalPage(cdp,`FNHStandalonePreview.settings.language==='vi' && FNHStandalonePreview.settings.screenWidth==='large' && FNHStandalonePreview.settings.volumes.master===80 && document.querySelector('#fnh-new-game').textContent==='Chơi mới' && getComputedStyle(document.documentElement).getPropertyValue('--fnh-screen-width').trim()==='1088px'`,false,false));
    async function click(selector) {
        const point=await evalPage(cdp,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,false,false);
        await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    }
    await click('#fnh-open-settings');await click('[data-setting=language]');
    check('có thể mở cài đặt và đổi ngôn ngữ bằng chuột',await evalPage(cdp,`!document.querySelector('#fnh-title-settings').hidden && FNHStandalonePreview.settings.language==='en'`,false,false));
    await click('[data-setting=language]');await click('[data-setting=back]');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await key('Enter');
    for(let i=0;i<7;i++)await key('ArrowDown');
    check('cài đặt trên điện thoại vẫn hiển thị nút quay lại',await evalPage(cdp,`(()=>{const b=document.activeElement,r=b.getBoundingClientRect(),p=document.querySelector('#fnh-title-settings').getBoundingClientRect();return b.dataset.setting==='back' && r.bottom<=p.bottom+.5 && r.top>=p.top-.5 && p.left>=0 && p.right<=390;})()`,false,false));
    await key('ArrowUp');await key('ArrowLeft');
    check('thay đổi hàng cuối vẫn giữ lựa chọn trong vùng nhìn thấy',await evalPage(cdp,`(()=>{const b=document.activeElement,r=b.getBoundingClientRect(),p=document.querySelector('#fnh-title-settings').getBoundingClientRect();return b.dataset.setting==='se' && r.bottom<=p.bottom+.5 && r.top>=p.top-.5 && FNHStandalonePreview.settings.volumes.se===80;})()`,false,false));
};
