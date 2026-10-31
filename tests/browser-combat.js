'use strict';
module.exports = async function ({cdp,url,evalPage,waitFor,clickElement,check,screenshot}) {
    await cdp.send('Page.navigate',{url:url+'standalone.html?events=1&map=74'});
    await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.map && document.querySelector("#fnh-loading").hidden',30000,'khởi động combat');
    await evalPage(cdp,`(async()=>{
        const app=FNHStandalonePreview,e=app.engine;app.scheduler.stop();app.audio.setVolume('master',.05);
        const drawEnemy=FNHStandaloneCanvas.CanvasRenderer.prototype.drawBattleEnemy;
        FNHStandaloneCanvas.CanvasRenderer.prototype.drawBattleEnemy=function(...args){window.combatRenderer=this;return drawEnemy.apply(this,args);};
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
    await evalPage(cdp,`(()=>{const a=FNHStandalonePreview.audio,play=a.play;window.combatCursorSounds=[];a.play=function(category,sound,...rest){if(category==='se' && sound.name==='fnh_cursor')combatCursorSounds.push(sound);return play.call(this,category,sound,...rest);};})()`,false,false);
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown'});
    check('chuyển lệnh chiến đấu phát tiếng con trỏ gốc',await evalPage(cdp,'combatCursorSounds.length===1 && document.activeElement.textContent==="Skills"',false,false));
    await evalPage(cdp,"FNHStandalonePreview.settings.language='vi'",false,false);
    await clickElement(cdp,'#fnh-combat-commands button:nth-child(2)');
    check('giao diện danh sách chiến đấu dùng tiếng Việt',await evalPage(cdp,`!document.querySelector('#fnh-combat-list').hidden && document.querySelector('#fnh-combat-list').textContent.includes('Hủy') && document.querySelector('#fnh-combat-status').textContent.includes('Thể lực')`,false,false));
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    check('lệnh chiến đấu được dịch sang tiếng Việt',await evalPage(cdp,`document.querySelector('#fnh-combat-commands').textContent.includes('Tấn công')`,false,false));
    await evalPage(cdp,"FNHStandalonePreview.settings.language='en'",false,false);
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
    check('Attack chọn đúng bộ phận để nhấp nháy, không vẽ viền quanh vùng PNG',await evalPage(cdp,`(()=>{const b=document.activeElement,s=combatRenderer.selectedBattleTarget;return s && s.battle===FNHStandalonePreview.engine.battle.battle && s.type==='enemy' && s.id===Number(b.dataset.target) && getComputedStyle(b).outlineStyle==='none' && getComputedStyle(b).backgroundColor==='rgba(0, 0, 0, 0)';})()`,false,false));
    check('hiệu ứng làm sáng pixel của đúng PNG, giữ phần trong suốt và trả màu gốc ở nửa chu kỳ',await evalPage(cdp,`(async()=>{
        const app=FNHStandalonePreview,enemy=app.engine.battle.enemy(Number(document.activeElement.dataset.target));
        const bitmap=await combatRenderer.loadImage('img/enemies/'+enemy.battlerName+'.png'),canvas=document.createElement('canvas');
        const r=new FNHStandaloneCanvas.CanvasRenderer(canvas,{width:bitmap.width+20,height:bitmap.height+20});
        const b={spriteFrames:0},e={battle:{battle:b},animations:{targetEffect:()=>null}},entry={enemy:{...enemy,x:bitmap.width/2+10,y:bitmap.height+10,spriteEffect:null,collapse:null},bitmap};
        r.selectBattleTarget(b,'enemy',enemy.index);
        function pixels(frame){b.spriteFrames=frame;r.context.clearRect(0,0,canvas.width,canvas.height);r.drawBattleEnemy(entry,e,null);return r.context.getImageData(0,0,canvas.width,canvas.height).data;}
        const on=pixels(0),off=pixels(15);r.selectBattleTarget(null);const base=pixels(0);let changed=0,transparent=0;
        for(let i=0;i<base.length;i+=4){if(base[i+3]===0){transparent++;if(on[i+3]!==0)return false;}else if(base[i+3]===255){for(let c=0;c<3;c++){if(Math.abs(off[i+c]-base[i+c])>1)return false;if(Math.abs(on[i+c]-(base[i+c]+(255-base[i+c])*64/255))>2)return false;}if(on[i]!==base[i] || on[i+1]!==base[i+1] || on[i+2]!==base[i+2])changed++;}}
        return transparent>0 && changed>100;
    })()`,true,false));
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});
    check('phím hướng chuyển nhấp nháy sang bộ phận kế tiếp',await evalPage(cdp,'combatRenderer.selectedBattleTarget.id===1 && document.activeElement.dataset.target==="1"',false,false));
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft'});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    check('hủy chọn bộ phận dừng nhấp nháy và giữ nguyên hàng lệnh',await evalPage(cdp,'combatRenderer.selectedBattleTarget===null && FNHStandalonePreview.engine.battle.battle.inputActions.length===0',false,false));
    await clickElement(cdp,'#fnh-combat-commands button');
    await screenshot('combat-targets');
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
    check('xác nhận Attack mới xếp lệnh, chưa gây sát thương trước lượt đồng đội',await evalPage(cdp,'FNHStandalonePreview.engine.battle.battle.inputActions.length===1 && FNHStandalonePreview.engine.battle.battle.inputActions[0].id===1',false,false));
    check('xác nhận mục tiêu dừng nhấp nháy bộ phận cũ',await evalPage(cdp,'combatRenderer.selectedBattleTarget===null',false,false));
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
