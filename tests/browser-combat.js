'use strict';
module.exports = async function ({cdp,url,evalPage,waitFor,clickElement,check,screenshot}) {
    await cdp.send('Page.navigate',{url:url+'standalone.html?events=1&map=74'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.map && document.querySelector("#fnh-loading").hidden',30000,'khởi động combat');
    await evalPage(cdp,`(async()=>{
        const app=FNHStandalonePreview,e=app.engine;app.scheduler.stop();app.audio.setVolume('master',.05);
        await new Promise(resolve=>setTimeout(resolve,50));
        e.random=()=>.5;await e.restore({mapId:74,x:8,y:8,party:[1,3]});e.state.setActorName(1,'lighthouse');
        e.state.changeActorSkill(1,8,true);e.state.gainItem('items',28,1);e.state.actor(3).hp=10;
        e.battle.setup(1,true,true);e.state.scene='battle';
    })()`,true,false);
    await waitFor(cdp,'!document.querySelector("#fnh-combat").hidden && document.querySelectorAll("#fnh-combat-commands button").length===4',5000,'lệnh chiến đấu');
    check('combat đặt cửa sổ lệnh và Body/Mind trong khung theo bản gốc',await evalPage(cdp,`(()=>{
        const stage=document.querySelector('.fnh-stage').getBoundingClientRect(),commands=document.querySelector('#fnh-combat-commands').getBoundingClientRect(),status=document.querySelector('#fnh-combat-status').getBoundingClientRect();
        return Math.abs(commands.width/stage.width*816-192)<1 && Math.abs((commands.y-stage.y)/stage.height*624-444)<1 &&
            Math.abs(status.width/stage.width*816-624)<1 && getComputedStyle(document.querySelector('#fnh-battle')).display==='none' &&
            [...document.querySelectorAll('#fnh-combat-commands button')].map(b=>b.textContent).join(',')==='Attack,Skills,Guard,Item' &&
            document.querySelectorAll('.fnh-combat-member').length===2 && document.querySelector('#fnh-combat-status').textContent.includes('Body');
    })()`,false,false));
    await screenshot('combat-commands');
    await clickElement(cdp,'#fnh-combat-commands button:nth-child(2)');
    check('Skills mở danh sách thật và có mô tả',await evalPage(cdp,'!document.querySelector("#fnh-combat-list").hidden && document.querySelectorAll("#fnh-combat-list button").length>1',false,false));
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    await clickElement(cdp,'#fnh-combat-commands button:nth-child(4)');
    check('Item đọc Blue vial từ túi thay bộ chọn HTML',await evalPage(cdp,'document.querySelector("#fnh-combat-list").textContent.includes("Blue vial") && !document.querySelector("#fnh-combat select")',false,false));
    await clickElement(cdp,'#fnh-combat-list button');
    await waitFor(cdp,'!document.querySelector("#fnh-combat-targets").hidden',5000,'mục tiêu vật phẩm');
    await clickElement(cdp,'#fnh-combat-targets button:nth-child(2)');
    check('chọn item giữ chỗ và chuyển đồng đội trước khi tiêu vật phẩm',await evalPage(cdp,`(()=>{const e=FNHStandalonePreview.engine,b=e.battle.battle;return b.turn===0 && b.inputActions.length===1 && b.inputActions[0].kind==='item' && e.state.itemCount('items',28)===1;})()`,false,false));
    await clickElement(cdp,'#fnh-combat-commands button:nth-child(3)');
    await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn>=1 && FNHStandalonePreview.engine.battle.battle.phase==="input"',20000,'tự thực thi lượt');
    check('đủ lệnh tự chạy lượt, trừ đúng item và Guard thật',await evalPage(cdp,'FNHStandalonePreview.engine.state.itemCount("items",28)===0 && FNHStandalonePreview.engine.battle.battle.turn>=1',false,false));
    await clickElement(cdp,'#fnh-combat-commands button');
    await waitFor(cdp,'document.querySelectorAll("#fnh-combat-targets .fnh-combat-enemy").length>0 && document.querySelector("#fnh-combat-targets .fnh-combat-enemy").style.clipPath',5000,'hình bộ phận quái');
    check('Attack chọn bộ phận Guard, không hiện HP địch',await evalPage(cdp,'[...document.querySelectorAll("#fnh-combat-targets button")].every(b=>!b.textContent.includes("HP")) && document.querySelectorAll("#fnh-combat-targets button").length===FNHStandalonePreview.engine.battle.aliveEnemies().length',false,false));
    await screenshot('combat-targets');
    const point=await evalPage(cdp,`(()=>{
        const button=document.querySelector('#fnh-combat-targets [data-target="0"]'),r=button.getBoundingClientRect();
        for(let y=r.top+2;y<r.bottom;y+=3)for(let x=r.left+2;x<r.right;x+=3)if(document.elementFromPoint(x,y)===button)return {x,y};
        throw Error('Không chọn được phần thân qua vùng ảnh hiện');
    })()`,false,false);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    check('xác nhận Attack mới xếp lệnh, chưa gây sát thương trước lượt đồng đội',await evalPage(cdp,'FNHStandalonePreview.engine.battle.battle.inputActions.length===1 && FNHStandalonePreview.engine.battle.battle.inputActions[0].id===1',false,false));
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    check('hủy lệnh trở lại thành viên trước',await evalPage(cdp,'FNHStandalonePreview.engine.battle.battle.inputActions.length===0',false,false));
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    check('hủy cửa sổ nhân vật mở Fight và Run như game gốc',await evalPage(cdp,'document.querySelector("#fnh-combat-commands").textContent.includes("Run!")',false,false));
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    check('combat vẫn nằm gọn trong khung điện thoại',await evalPage(cdp,`(()=>{const r=document.querySelector('#fnh-combat').getBoundingClientRect();return r.width<=390 && r.x>=0;})()`,false,false));
    await screenshot('combat-mobile');
    await evalPage(cdp,`(()=>{const a=FNHStandalonePreview;a.settings.commandRemember=true;a.engine.battle.finish('escape');a.engine.state.scene='map';a.engine.state.recoverActor(1);a.engine.state.recoverActor(3);a.engine.battle.setup(1,true,true);a.engine.state.scene='battle';})()`,false,false);
    await waitFor(cdp,'document.querySelectorAll("#fnh-combat-commands button").length===4',5000,'trận kiểm tra nhớ lệnh');
    await clickElement(cdp,'#fnh-combat-commands button:nth-child(3)');await clickElement(cdp,'#fnh-combat-commands button:nth-child(3)');
    await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn>=1 && FNHStandalonePreview.engine.battle.battle.phase==="input"',20000,'lượt sau Guard');
    await waitFor(cdp,'document.activeElement.textContent==="Guard" && !document.activeElement.disabled',5000,'focus lệnh đã nhớ');
    check('Command Remember đưa con trỏ về Guard ở lượt sau',await evalPage(cdp,'document.activeElement.textContent==="Guard" && FNHStandalonePreview.engine.state.actor(1).lastBattleCommand===2',false,false));
};
