'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    let randomValue=0.5, draws=0;
    const e = new GameEngine({ dataStore: store, random: () => { draws++; return randomValue; }, onRouteEffect: () => true });
    await e.boot({ mapId: 74, x: 8, y: 8, party: [1] });
    e.battle.setup(1); e.state.scene = 'battle'; let r = e.battle;
    for (const id of [4,5,8]) r.handleEffect(333, [0,0,id]);
    for (const id of [11,8]) e.state.changeActorState(1,id,true);
    assert.equal(r.enemy(0).stateTurns[8],3,'333 khởi tạo thời lượng ngay khi thêm state');
    assert.equal(e.state.actor(1).stateTurns[8],3,'state actor cũng có thời lượng trước cuối lượt đầu');
    const states = battler => r.battlerState(battler).states.map(id => e.database.States[id])
        .sort((a,b) => b.priority-a.priority || a.id-b.id);
    const source = fs.readFileSync(path.join(__dirname,'../game/js/rpg_sprites.js'),'utf8');
    const reference = { Sprite: function(){}, Sprite_Base: function(){}, Sprite_StateIcon: function(){}, Sprite_StateOverlay: function(){} };
    reference.Sprite.prototype.update = reference.Sprite_Base.prototype.update = function(){};
    vm.createContext(reference);
    vm.runInContext(source.slice(source.indexOf('Sprite_StateIcon.prototype.update ='),source.indexOf('// Sprite_StateOverlay')),reference);
    vm.runInContext(source.slice(source.indexOf('Sprite_StateOverlay.prototype.update ='),source.indexOf('// Sprite_Weapon')),reference);
    const icon = Object.assign(new reference.Sprite_StateIcon(), { _animationCount:0, _animationIndex:0, _iconIndex:0,
        _battler:{ isAlive:()=>r.enemy(0).alive && !r.enemy(0).hidden, allIcons:()=>states(r.enemy(0)).map(s=>s.iconIndex).filter(Boolean) }, setFrame(){} });
    const overlay = Object.assign(new reference.Sprite_StateOverlay(), { _animationCount:0, _pattern:0, _overlayIndex:0,
        _battler:{stateOverlayIndex:()=>states(r.actor(1))[0]?.overlay || 0}, setFrame(){} });
    for (let frame=1; frame<=120; frame++) {
        if (frame===51) r.handleEffect(333,[0,0,10]);
        e.advanceRoutes(1); icon.update(); overlay.update();
        assert.equal(r.enemy(0).spriteIcon?.iconIndex || 0,icon._iconIndex,`icon ở frame ${frame}`);
        assert.equal(r.actor(1).spriteOverlay?.index || 0,overlay._overlayIndex,`overlay ở frame ${frame}`);
        if (r.actor(1).spriteOverlay) assert.equal(r.actor(1).spriteOverlay.pattern,overlay._pattern);
    }
    const selected = r.enemy(0).spriteIcon;
    assert.equal(selected.stateId,4, 'icon mới ưu tiên cao không đặt lại chỉ số xoay');
    r.handleEffect(333,[0,1,10]);
    for (let frame=0; frame<40; frame++) {
        e.advanceRoutes(1); icon.update(); overlay.update();
        assert.equal(r.enemy(0).spriteIcon.iconIndex,icon._iconIndex,'danh sách icon ngắn lại quay về đầu nếu chỉ số vượt giới hạn');
    }
    e.advanceRoutes(12.5); const save=e.save(); e.advanceRoutes(12.5);
    const continued=JSON.stringify([r.battle.spriteFrames,r.enemy(0).spriteIcon,r.actor(1).spriteOverlay]);
    const beforeRestore=draws; await e.restore(save); r=e.battle; e.advanceRoutes(12.5);
    assert.equal(draws,beforeRestore,'tải save không bốc lại thời lượng state');
    assert.equal(JSON.stringify([r.battle.spriteFrames,r.enemy(0).spriteIcon,r.actor(1).spriteOverlay]),continued);
    e.state.changeActorState(1,1,true);
    assert.equal(r.actor(1).spriteOverlay.index,5, 'đổi state đợi nhịp cập nhật overlay');
    e.advanceRoutes(8); assert.equal(r.actor(1).spriteOverlay.index,0, 'state chết ưu tiên cao chặn overlay thấp hơn');
    r.handleEffect(331,[0,1,0,99999,true]); e.advanceRoutes(40);
    assert.equal(r.enemy(0).spriteIcon.iconIndex,0,'quái chết không giữ icon trên xác');
    e.state.recoverActor(1);
    for (const state of e.database.States.filter(s=>s && s.overlay)) {
        e.state.actor(1).states=[state.id]; e.advanceRoutes(8);
        assert.equal(r.actor(1).spriteOverlay.index,state.overlay);
    }
    r.handleEffect(334,[0]); r.handleEffect(333,[0,0,8]); e.advanceRoutes(40);
    const turns=r.enemy(0).spriteIcon.turns;
    assert.ok(Number.isInteger(turns) && turns>0, 'icon state tự hết hạn hiện số lượt còn lại');
    r.endBattlerTurn(r.enemy(0)); assert.equal(r.enemy(0).stateTurns[8],2);
    r.handleEffect(333,[0,0,8]); assert.equal(r.enemy(0).stateTurns[8],3,'thêm lại state đặt lại thời lượng');
    r.enemy(0).hidden=true; e.advanceRoutes(40); assert.equal(r.enemy(0).spriteIcon.iconIndex,0);
    const beforePause=r.battle.spriteFrames; e.state.scene='menu'; e.advanceRoutes(40);
    assert.equal(r.battle.spriteFrames,beforePause,'menu tạm dừng hoạt ảnh trạng thái');
    randomValue=0; e.state.changeActorState(1,8,true); assert.equal(e.state.actor(1).stateTurns[8],2);
    randomValue=0.999; e.state.changeActorState(1,8,true); assert.equal(e.state.actor(1).stateTurns[8],4);
    randomValue=0.5; r.enemy(0).hidden=false;
    const beforeSkill=draws; r.addState(r.enemy(0),8,1,true);
    assert.equal(draws-beforeSkill,2,'skill chỉ thử xác suất và bốc thời lượng một lần');
    assert.equal(r.enemy(0).stateTurns[8],3);
    const context={}; vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname,'../game/js/plugins.js'),'utf8'),context);
    const config=context.$plugins.find(p=>p.status && p.name==='YEP_BuffsStatesCore').parameters;
    assert.equal(config['Show Enemy Icons'],'true'); assert.equal(config['Enemy State Turn'],'true');
    assert.equal(config['Show Turns'],'true'); assert.equal(config['Font Size'],'16');
    assert.equal(config['Turn Alignment'],'right'); assert.equal(config['Turn Buffer X'],'-3'); assert.equal(config['Turn Buffer Y'],'-6');
    assert.equal(config['State Color'],'0');
    assert.equal(e.database.States.filter(s=>s && s.overlay).length,8);
    assert.equal(e.database.States.filter(s=>s && s.iconIndex).length,50);
    console.log('ĐẠT: icon/overlay đối chiếu từng frame với runtime gốc, ưu tiên/đổi state/chết/ẩn/lượt, tám overlay, 50 icon và frame lẻ/save/pause.');
})().catch(error=>{console.error(error);process.exitCode=1;});
