'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {GameEngine}=require('../game/engine/game-engine');
const {GameDataStore}=require('../game/engine/data-store');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const watchdog=setTimeout(()=>{console.error('Hiệu ứng kết liễu không kết thúc trong thời hạn kiểm thử.');process.exit(1);},15000);
(async()=>{
    const requests=[],sounds=[],root=path.join(__dirname,'../game');
    const store=new GameDataStore({fetchImpl:async url=>{
        requests.push(url);const bytes=fs.readFileSync(path.join(root,url));
        return {ok:true,json:async()=>JSON.parse(bytes),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
    }});
    const e=new GameEngine({dataStore:store,random:()=>0.5,onRouteEffect:(code,p)=>{if(code===250)sounds.push(p[0].name);return true;}});
    await e.boot({mapId:74,x:8,y:8,party:[1,3]});const db=e.database,troopId=db.Troops.length;
    db.Troops.push({id:troopId,pages:[],members:[{enemyId:1,x:400,y:450},{enemyId:1,x:600,y:450}]});
    let r=e.battle;
    function reset(enemyId=1){r.finish('escape');e.animations.dispose();db.Troops[troopId].members[0].enemyId=enemyId;r.setup(troopId,true,true);e.state.scene='battle';sounds.length=0;}
    async function finish(promise){let done=false,error;promise.then(()=>{done=true;},failure=>{done=true;error=failure;});
        for(let i=0;i<1000&&!done;i++){e.advanceRoutes(4);await flush();}assert.ok(done);if(error)throw error;}
    const kill=()=>r.handleEffect(331,[0,1,0,99999,true]);
    reset();kill();assert.equal(r.enemy(0).alive,false);assert.deepEqual(r.enemy(0).collapse,{type:0,elapsed:0,duration:32});
    let done=false,waiting=e.waitEnemyEffects().then(()=>{done=true;});await flush();
    e.advanceRoutes(16);await flush();assert.equal(done,false);assert.equal(r.enemy(0).collapse.elapsed,16);
    const saved=e.save();e.advanceRoutes(16);await waiting;assert.equal(done,true);
    await e.restore(saved);r=e.battle;assert.equal(r.enemy(0).collapse.elapsed,16);
    await finish(e.waitEnemyEffects());assert.equal(r.enemy(0).collapse.elapsed,32,'save giữ thời gian mờ, không phát lại từ đầu');
    reset();kill();waiting=e.waitEnemyEffects();await flush();e.advanceRoutes(8);r.handleEffect(334,[0]);
    assert.equal(r.enemy(0).collapse,undefined,'hồi sinh hủy kết liễu');assert.equal(r.enemy(0).spriteEffect.type,'appear');
    e.advanceRoutes(16);await waiting;assert.equal(r.enemy(0).spriteEffect,undefined,'hồi sinh đợi hiện hình 16 frame');
    reset();kill();done=false;waiting=e.waitEnemyEffects().then(()=>{done=true;});await flush();e.advanceRoutes(31);r.handleEffect(334,[0]);
    e.advanceRoutes(1);await flush();assert.equal(done,false,'hồi sinh ở frame cuối kéo dài wait cho hết hiện hình');
    e.advanceRoutes(15);await waiting;assert.equal(done,true);
    reset();r.enemy(1).hidden=true;r.handleEffect(335,[1]);done=false;waiting=e.waitEnemyEffects().then(()=>{done=true;});await flush();
    e.advanceRoutes(15);await flush();assert.equal(done,false);e.advanceRoutes(1);await waiting;
    assert.equal(r.enemy(1).spriteEffect,undefined,'335 hiện quái bằng fade 16 frame');
    reset();const release=r.protectActionTargets([r.enemy(0)]);r.changeResource(r.enemy(0),'hp',-99999);
    assert.equal(r.enemy(0).collapse,undefined);assert.equal(r.enemy(0).alive,true);
    release();assert.equal(r.enemy(0).collapse.duration,32,'IMMORTAL chỉ bắt đầu kết liễu khi đã xác nhận chết');
    reset();r.enemy(0).hidden=true;kill();await e.waitEnemyEffects();assert.equal(e.enemyEffectWaiters.size,0,'quái ẩn không giữ wait hiệu ứng');

    const corpseIds=db.Enemies.filter(Boolean).filter(enemy=>{
        const types=enemy.traits.filter(trait=>trait.code===63).map(trait=>trait.dataId);return types.length&&Math.max(...types)===3;
    }).map(enemy=>enemy.id);
    assert.equal(corpseIds.length,26);
    for(const id of corpseIds){reset(id);kill();assert.equal(r.enemy(0).collapse.type,3);await e.waitEnemyEffects();e.advanceRoutes(1000);
        assert.equal(r.enemy(0).collapse.type,3);assert.equal(r.aliveEnemies().length,1,'xác không được tính là người còn sống');}

    const bosses=db.Enemies.filter(Boolean).filter(enemy=>enemy.traits.some(trait=>trait.code===63&&trait.dataId===1));
    assert.equal(bosses.length,6);
    for(const boss of bosses){reset(boss.id);kill();assert.equal(r.enemy(0).collapse.duration,null);
        waiting=e.waitEnemyEffects();await flush();const bytes=fs.readFileSync(path.join(root,'img/enemies',boss.battlerName+'.png'));
        assert.equal(r.enemy(0).collapse.duration,bytes.readUInt32BE(20));await finish(waiting);
        assert.equal(r.enemy(0).collapse.elapsed,bytes.readUInt32BE(20));}
    assert.equal(requests.filter(url=>url.endsWith('tormented_one_secondform_1_ring.png')).length,1,'cache kích thước cho các enemy dùng chung PNG');
    assert.ok([11,12,13].every(index=>!db.System.sounds[index].name),'dữ liệu thật để trống âm thanh collapse');
    db.System.sounds[11]={name:'fnh_choice2',volume:80,pitch:100,pan:0};
    reset();kill();await finish(e.waitEnemyEffects());e.advanceRoutes(100);assert.deepEqual(sounds,['fnh_choice2']);
    db.System.sounds[12]={name:'fnh_choice2',volume:80,pitch:100,pan:0};db.System.sounds[13]={name:'hit_single',volume:80,pitch:100,pan:0};
    reset(256);kill();waiting=e.waitEnemyEffects();await flush();e.advanceRoutes(45);
    assert.deepEqual(sounds,['fnh_choice2','hit_single','hit_single'],'frame dài không bỏ sót nhịp boss mỗi 20 frame');
    const mid=e.save();await finish(waiting);await e.restore(mid);r=e.battle;sounds.length=0;e.advanceRoutes(20);
    assert.deepEqual(sounds,['hit_single'],'tải không phát lại âm bắt đầu boss');
    const controller=new AbortController();waiting=e.waitEnemyEffects({},controller.signal);
    const rejected=assert.rejects(waiting,{name:'AbortError'});await flush();controller.abort();await rejected;
    assert.equal(e.enemyEffectWaiters.size,0);assert.ok(!e.screen.screen.tweens.some(track=>Object.keys(track.goal).length===0),'hủy dọn frame chờ');
    reset();kill();waiting=e.waitEnemyEffects();await flush();e.state.scene='title';e.advanceRoutes(1);await waiting;
    assert.equal(e.enemyEffectWaiters.size,0,'title giải phóng chờ kết liễu');

    reset();const skillId=db.Skills.length,commonId=db.CommonEvents.length;
    db.CommonEvents.push({id:commonId,list:[{code:121,parameters:[6175,6175,0]}]});
    db.Skills.push({...db.Skills[3],id:skillId,animationId:0,hitType:0,scope:1,repeats:1,successRate:100,mpCost:0,tpCost:0,
        note:'<target action>\naction effect\n</target action>',damage:{type:1,formula:'9999',variance:0,critical:false,elementId:0},effects:[{code:44,dataId:commonId}]});
    const actionController=new AbortController(),action=e.forceBattleAction([1,1,skillId,0],{},actionController.signal);
    const actionRejected=assert.rejects(action,{name:'AbortError'});await flush();
    assert.equal(r.battle.lastAction.hits[0].defeated,true,'báo cáo xác nhận chết trước khi chờ kết liễu');
    assert.equal(e.state.switchValue(6175),false,'common event đợi kết liễu xong');
    actionController.abort();await actionRejected;e.advanceRoutes(1000);
    assert.equal(e.state.switchValue(6175),false,'hủy trong lúc kết liễu không chạy common event muộn');
    reset(23);r.useSkill(r.actor(1),skillId,0,true);
    assert.equal(r.enemy(0).collapse.type,3);assert.equal(r.enemy(0).spriteEffect.type,'blink','xác loại 3 vẫn giữ blink của đòn trúng');
    await finish(e.waitEnemyEffects());assert.equal(r.enemy(0).collapse.type,3);assert.equal(r.enemy(0).spriteEffect,undefined);

    // Lỗi PNG phải được báo và cache lỗi được dọn để có thể tải lại.
    let calls=0;const broken=new GameDataStore({fetchImpl:async()=>{calls++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(24)};}});
    await assert.rejects(broken.loadImageSize('bad.png'),/PNG không hợp lệ/);await assert.rejects(broken.loadImageSize('bad.png'),/PNG không hợp lệ/);assert.equal(calls,2);
    console.log('ĐẠT: collapse 32 frame, 26 xác giữ hình/6 boss theo PNG, IMMORTAL/hồi sinh/ẩn, save/nhịp SE/frame dài, hủy/title và lỗi/cache PNG.');
})().then(()=>clearTimeout(watchdog)).catch(error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
