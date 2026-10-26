'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    const e = new GameEngine({ dataStore: store, random: () => 0.5 });
    await e.boot({ mapId: 74, x: 8, y: 8, party: [1,12] });
    const db=e.database,enemyId=db.Enemies.length,troopId=db.Troops.length,skillId=db.Skills.length;
    db.Enemies.push({...db.Enemies[1],id:enemyId,traits:[],actions:[],params:[100,100,1,1,1,1,1,1]});
    db.Troops.push({id:troopId,pages:[],members:[0,1].map(i=>({enemyId,x:300+i*100,y:400}))});
    db.Skills.push({...db.Skills[3],id:skillId,note:'',animationId:0,repeats:2,scope:1,hitType:0,successRate:100,
        mpCost:5,tpCost:4,tpGain:3,effects:[],damage:{type:1,formula:'20',variance:0,critical:false,elementId:0}});
    e.state.actor(1).tp=77;e.state.actor(12).tp=66;e.battle.setup(troopId,true,true);
    const r=e.battle,subject=r.actor(1),skill=db.Skills[skillId];
    assert.equal(e.state.actor(1).tp,12,'TP đầu trận ngẫu nhiên trong 0..24');
    assert.equal(e.state.actor(12).tp,66,'Baby Demon giữ TP theo trait class 14 thật');
    assert.equal(r.enemy(0).tp,12);const mp=e.state.actor(1).mp;
    r.useSkill(subject,skillId,0);
    assert.equal(e.state.actor(1).tp,14,'trả 4 TP một lần, nhận 3 TP mỗi effect trúng');
    assert.equal(e.state.actor(1).mp,mp-5);assert.equal(r.enemy(0).tp,32,'mỗi hit 20/100 HP cho 10 TP');
    assert.equal(r.enemy(0).hp,60);
    const before=e.save();await e.restore(before);
    assert.equal(e.state.actor(1).tp,14);assert.equal(e.battle.enemy(0).tp,32,'tải save không khởi tạo TP lần nữa');
    // Dùng runtime mới sau restore cho các lượt còn lại.
    const runtime=e.battle,actor=runtime.actor(1);
    function reset(){e.state.recoverActor(1);e.state.actor(1).tp=50;
        runtime.battle.enemies.forEach(enemy=>{enemy.hp=100;enemy.tp=0;runtime.refreshEnemy(enemy);});
        skill.damage.type=1;skill.hitType=0;skill.scope=1;skill.successRate=100;db.Enemies[enemyId].traits=[];}
    reset();skill.successRate=0;runtime.useSkill(actor,skillId,0);
    assert.equal(e.state.actor(1).tp,46);assert.equal(runtime.enemy(0).tp,0,'trượt không cấp TP cho hai bên');
    reset();skill.hitType=1;db.Enemies[enemyId].traits=[{code:22,dataId:1,value:1}];runtime.useSkill(actor,skillId,0);
    assert.equal(e.state.actor(1).tp,46);assert.equal(runtime.enemy(0).tp,0,'né không cấp TP');
    reset();skill.damage.type=2;runtime.useSkill(actor,skillId,0);
    assert.equal(e.state.actor(1).tp,52);assert.equal(runtime.enemy(0).tp,0,'mất MP không cấp TP cho đích');
    reset();skill.damage.type=3;runtime.enemy(0).hp=10;runtime.useSkill(actor,skillId,0);
    assert.equal(runtime.enemy(0).tp,0,'hồi HP không cấp TP nhận damage');
    reset();skill.damage.formula='1';runtime.useSkill(actor,skillId,0);
    assert.equal(runtime.enemy(0).tp,0,'làm tròn xuống từng hit');skill.damage.formula='20';
    reset();skill.scope=2;runtime.useSkill(actor,skillId,-1);
    assert.equal(e.state.actor(1).tp,58,'đòn hai hit trên hai đích nhận TP cho cả bốn effect');
    assert.ok(runtime.battle.enemies.every(enemy=>enemy.tp===20));
    reset();const stateId=db.States.length;db.States.push({...db.States[2],id:stateId,traits:[{code:23,dataId:5,value:2}]});
    e.state.changeActorState(1,stateId,true);runtime.syncActors();runtime.handleEffect(333,[-1,0,stateId]);
    runtime.useSkill(actor,skillId,0);
    assert.equal(e.state.actor(1).tp,58,'TCR nhân TP người dùng sau chi phí');
    assert.equal(runtime.enemy(0).tp,40,'TCR nhân TP nhận damage');
    e.state.actor(1).tp=99;runtime.enemy(0).tp=99;runtime.enemy(0).hp=100;runtime.useSkill(actor,skillId,0);
    assert.equal(e.state.actor(1).tp,100);assert.equal(runtime.enemy(0).tp,100);
    runtime.finish('escape');assert.equal(e.state.actor(1).tp,0);assert.equal(e.state.actor(12).tp,66);
    assert.equal(runtime.enemy(0).tp,0,'rời trận xóa TP nếu không có trait giữ TP');
    console.log('ĐẠT: TP đầu/cuối trận, Baby Demon giữ TP, nhận damage/TCR, từng effect/đích, trượt/né/MP/hồi HP, làm tròn/cap và save.');
})().catch(error=>{console.error(error);process.exitCode=1;});
