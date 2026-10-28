'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {CanvasRenderer}=require('../game/engine/canvas-renderer');
const source=fs.readFileSync(path.join(__dirname,'../game/js/rpg_sprites.js'),'utf8');
const begin=source.indexOf('Sprite_Battler.prototype.updateSelectionEffect =');
const end=source.indexOf('Sprite_Battler.prototype.setupAnimation =',begin);
const reference={Sprite_Battler:function(){}};vm.createContext(reference);vm.runInContext(source.slice(begin,end),reference);
let selected=true,color;
const old=new reference.Sprite_Battler();old._selectionEffectCount=0;old._battler={isSelected:()=>selected};old._effectTarget={setBlendColor:value=>{color=Array.from(value);}};
const renderer=new CanvasRenderer({getContext:()=>({})});
const battle={spriteFrames:100};renderer.selectBattleTarget(battle,'enemy',2);
for(let frame=1;frame<=120;frame++) {
    battle.spriteFrames=100+frame;old.updateSelectionEffect();
    assert.deepEqual(renderer.battleSelectionColor(battle,'enemy',2)||[0,0,0,0],color,'nhịp trắng/trong suốt khớp bản gốc ở frame '+frame);
    assert.equal(renderer.battleSelectionColor(battle,'enemy',1),null,'bộ phận khác không bị sáng');
    assert.equal(renderer.battleSelectionColor(battle,'actor',2),null,'đúng loại mục tiêu');
    renderer.selectBattleTarget(battle,'enemy',2);
    assert.equal(renderer.selectedBattleTarget.start,100,'vẽ lại UI không khởi động lại nhịp');
}
battle.spriteFrames=135;renderer.selectBattleTarget(battle,'enemy',1);
assert.deepEqual(renderer.battleSelectionColor(battle,'enemy',1),[255,255,255,64],'đổi bộ phận bắt đầu nhịp mới');
assert.equal(renderer.battleSelectionColor(battle,'enemy',2),null);
assert.equal(renderer.battleSelectionColor({spriteFrames:135},'enemy',1),null,'trận khác không nhận hiệu ứng cũ');
battle.result='victory';assert.equal(renderer.battleSelectionColor(battle,'enemy',1),null,'kết thúc trận tắt lựa chọn');delete battle.result;
renderer.selectBattleTarget(null);assert.equal(renderer.battleSelectionColor(battle,'enemy',1),null,'hủy lựa chọn dọn hiệu ứng');
console.log('ĐẠT: nhịp chọn mục tiêu khớp sprite gốc 120 frame, đổi bộ phận, vẽ lại UI, phân biệt actor/enemy, hủy và kết thúc trận.');
