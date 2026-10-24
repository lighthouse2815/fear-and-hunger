'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FNH = { Scene: class {} };
const math = Object.create(Math);
math.random = () => 0;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../fnh-engine/js/scene_battle.js'), 'utf8'), { window: { FNH }, Math: math });
function actor(id) { return { id, name: 'Actor ' + id, hp: 100, maxHp: 100, def: 10, atk: 10, tgr: 1, exp: 0, faceName: 'Face' }; }
const battle = new FNH.Scene_Battle();
const first = actor(1), second = actor(2);
let destination;
const ended = [];
battle.game = { player: first, partyIds: [1, 2], actorStates: { 2: second }, gold: 0,
    assets: { loadImage: () => Promise.resolve() }, showToast() {},
    audio: { playSe() {}, playBgm() {}, stopBgm() {}, stopBgs() {} },
    data: { createGuardEncounter: () => ({ hp: 320, maxHp: 320, atk: 10, def: 10, rewardGold: 35, rewardExp: 20 }),
        actorTurnEnd: (actor, timing) => ended.push([actor.id, timing]),
        setActorHp: (actor, value) => { actor.hp = Math.max(0, Math.min(actor.maxHp, value)); } },
    changeScene: (...args) => { destination = args; }, gameOver() { throw new Error('Chưa được game over'); } };
battle.input = { isPressed: () => false, consumeClick: () => null };
battle.enter({ returnX: 7, returnY: 8, returnDir: 4 });
battle.update(2);
assert.equal(battle.player, first);
battle.playerGuard();
battle.update(1);
assert.equal(battle.player, second);
assert.equal(battle.phase, 'command', 'Thành viên tiếp theo hành động trước kẻ địch');
battle.playerAttack();
battle.update(1);
assert.equal(battle.phase, 'enemy');
assert.equal(first.hp, 95, 'Phòng thủ gắn đúng actor bị chọn mục tiêu');
assert.equal(second.hp, 100);
battle.update(2);
assert.equal(battle.player, first);
assert.equal(battle.turn, 2);
assert.equal(battle.guardedActors.size, 0);
assert.ok(ended.some(([id, timing]) => id === 2 && timing === 2));
first.hp = 0;
battle.selectMember(1);
battle.playerAttack();
battle.update(1);
assert.equal(second.hp, 91, 'Bỏ qua mục tiêu đã chết');
battle.update(2);
assert.equal(battle.player, second);
assert.equal(battle.phase, 'command', 'Trưởng nhóm gục không làm thua khi đồng đội còn sống');
second.restriction = 4;
battle.selectMember(1);
assert.equal(battle.phase, 'player', 'Actor bất động mất lượt');
second.restriction = 0;
battle.enemy.hp = 1;
battle.playerAttack();
battle.update(1);
assert.equal(battle.phase, 'victory');
assert.equal(first.exp, 20);
assert.equal(second.exp, 20);
assert.equal(battle.game.gold, 35);
battle.returnToMap();
assert.equal(first.mapX, 7);
assert.equal(first.mapY, 8);
assert.equal(second.mapX, undefined, 'Không ghi vị trí trưởng nhóm vào actor đang hiển thị');
assert.ok(destination);
console.log('ĐẠT: lượt tổ đội, phòng thủ theo người, mục tiêu sống, trạng thái, phần thưởng và quay lại bản đồ.');
