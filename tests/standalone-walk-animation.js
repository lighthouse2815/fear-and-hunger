'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { advanceAnimation, startMotion } = require('../game/engine/movement-runtime');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const { displayPosition } = require('../game/engine/map-model');

// Đối chiếu từng frame với lớp nhân vật gốc, chỉ nạp trong bài test.
const source = fs.readFileSync(path.join(__dirname, '../game/js/rpg_objects.js'), 'utf8');
const reference = { $gameMap: { tileWidth: () => 48, tileHeight: () => 48 } };
vm.createContext(reference);
vm.runInContext(source.slice(source.indexOf('function Game_CharacterBase()'), source.indexOf('function Game_Character()')), reference);
function compare({speed=4, step=false, walk=true, original=1, moving=64, idle=40, slice=1}) {
    const old = new reference.Game_CharacterBase();
    old.setMoveSpeed(speed); old.setStepAnime(step); old.setWalkAnime(walk); old.setPattern(original);
    old.isOriginalPattern = function () { return this.pattern() === original; };
    old.resetPattern = function () { this.setPattern(original); };
    old.refreshBushDepth = () => {};
    const character = { x: 0, y: 0, moveSpeed: speed, pattern: original, stepAnime: step, walkAnime: walk };
    const duration = 2 ** (8-speed), patterns=[];
    for (let frame=0; frame<moving+idle; frame++) {
        if (frame<moving && frame%duration===0) {
            character.x++; startMotion(character,{x:character.x-1,y:0},duration);
            old._x++; old.resetStopCount();
        }
        old.update();
        for (let n=0;n<1/slice;n++) {
            advanceAnimation(character,slice,speed);
            character.moveFrames=Math.max(0,(character.moveFrames||0)-slice);
        }
        const current=character.walkAnimation.pattern<3 ? character.walkAnimation.pattern : 1;
        assert.equal(current,old.pattern(),`speed=${speed}, step=${step}, walk=${walk}, original=${original}, frame=${frame}, slice=${slice}`);
        assert.equal(character.walkAnimation.count,old._animationCount,`bộ đếm ở frame ${frame}`);
        patterns.push(current);
    }
    return patterns;
}
for (const speed of [3,4,5,6]) for (const slice of [1,.5]) {
    compare({speed,slice}); compare({speed,slice,step:true}); compare({speed,slice,walk:false});
    compare({speed,slice,original:0}); compare({speed,slice,moving:0,step:true});
}
assert.deepEqual(compare({speed:5,idle:0}).slice(0,9),[1,1,1,1,1,1,1,1,2],'chạy giữ hình đứng ở đầu bước rồi đổi chân theo nhịp gốc');

(async()=>{
    const store=new GameDataStore({fetchImpl:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../game',url),'utf8'))})});
    const db=await store.loadDatabase();db.Tilesets=[null,{flags:[16,0],tilesetNames:[]}];
    const map={width:40,height:30,tilesetId:1,data:Array(1200).fill(1).concat(Array(6000).fill(0)),events:[null,
        {id:1,x:20,y:15,pages:[{conditions:{},priorityType:1,trigger:0,moveType:0,moveSpeed:4,walkAnime:true,stepAnime:true,image:{characterName:'$guard1',pattern:1,direction:2},list:[]}]}]};
    const engine=new GameEngine({dataStore:{loadDatabase:async()=>db,loadMap:async()=>map},random:()=>.5});
    await engine.boot({mapId:1,x:8,y:8,party:[1,3],alwaysDash:false});engine.forceDashing=true;
    for(let step=0;step<3;step++) {engine.move(6);for(let n=0;n<8;n++)engine.advanceRoutes(1);}
    assert.equal(engine.state.walkAnimation.pattern,3,'tốc độ chạy tác động nhịp chân của người chơi');
    assert.equal(engine.state.followers()[0].moveSpeed,5,'đồng đội dùng tốc độ chạy thực tế');
    engine.move(6);engine.advanceRoutes(2.5);
    const saved=JSON.parse(JSON.stringify(engine.save()));
    engine.advanceRoutes(3.5);
    const expected=JSON.parse(JSON.stringify({player:engine.state.walkAnimation,event:engine.map.eventById(1).walkAnimation,follower:engine.state.followers()[0].walkAnimation,position:displayPosition(engine.state)}));
    await engine.restore(saved);engine.advanceRoutes(3.5);
    assert.deepEqual({player:engine.state.walkAnimation,event:engine.map.eventById(1).walkAnimation,follower:engine.state.followers()[0].walkAnimation,position:displayPosition(engine.state)},expected,'lưu/tải tiếp tục đúng nhịp chân người chơi, NPC và đồng đội');
    const paused=JSON.stringify(engine.state.walkAnimation);engine.state.scene='menu';engine.advanceRoutes(40);
    assert.equal(JSON.stringify(engine.state.walkAnimation),paused,'menu tạm dừng animation');engine.state.scene='map';
    engine.advanceRoutes(40);assert.equal(engine.state.walkAnimation.pattern<3?engine.state.walkAnimation.pattern:1,1,'dừng chân trở về hình đứng sau nhịp cuối');
    engine.state.walkAnimation=undefined;assert.doesNotThrow(()=>engine.advanceRoutes(1),'save cũ không có nhịp chân vẫn đọc được');
    console.log('ĐẠT: nhịp chân đối chiếu runtime gốc theo từng frame, đi/chạy/đứng/NPC, 60/120Hz, đồng đội, pause và lưu/tải.');
})().catch(error=>{console.error(error);process.exitCode=1;});
