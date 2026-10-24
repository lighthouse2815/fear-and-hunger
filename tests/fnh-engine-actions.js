'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FNH = { Scene: class {}, clamp: (v, min, max) => Math.max(min, Math.min(max, v)) };
let random = 0;
const math = Object.create(Math);
math.random = () => random;
for (const file of ['data', 'action', 'interpreter', 'scene_map', 'scene_battle']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../fnh-engine/js/' + file + '.js'), 'utf8'), { window: { FNH }, Math: math });
}
const data = new FNH.DataStore();
data.actors = [null, { id: 1, classId: 1, initialLevel: 1, equips: [], traits: [] }, { id: 2, classId: 1, initialLevel: 1, equips: [], traits: [] }];
data.classes = [null, { id: 1, params: [[0, 100], [0, 40], [0, 20], [0, 10], [0, 10], [0, 10], [0, 10], [0, 10]], traits: [] }];
data.states = [null, { id: 1, restriction: 4, traits: [] }, { id: 2, traits: [] }];
const user = data.createPlayer(1), target = data.createPlayer(2);
user.hit = 1;
const base = { id: 1, name: 'Attack', occasion: 1, successRate: 100, hitType: 0, scope: 1, mpCost: 10, tpCost: 0,
    damage: { formula: 'a.atk * 4 - b.def * 2', type: 1, variance: 0 }, effects: [] };
let action = new FNH.Action(data, base);
assert.equal(action.canUse(user, true), true);
action.pay(user);
assert.equal(user.mp, 30);
let result = action.apply(user, target);
assert.equal(result.hp, 60);
assert.equal(target.hp, 40);
data.recoverActor(target);
result = action.apply(user, target, true);
assert.equal(result.hp, 30, 'Guard giảm sát thương');
const heal = new FNH.Action(data, { ...base, damage: { formula: '30', type: 3, variance: 0 } });
heal.apply(user, target);
assert.equal(target.hp, 100);
const drain = new FNH.Action(data, { ...base, damage: { formula: '200', type: 5, variance: 0 } });
user.hp = 10;
drain.apply(user, target);
assert.equal(target.hp, 0);
assert.equal(user.hp, 100, 'Drain không hút nhiều hơn HP mục tiêu');
data.removeActorState(target, 1);
const mp = new FNH.Action(data, { ...base, damage: { formula: '10', type: 2, variance: 0 } });
mp.apply(user, target);
assert.equal(target.mp, 30);
user.mp = 0;
assert.equal(action.canUse(user, true), false);
assert.throws(() => new FNH.Action(data, { ...base, damage: { formula: 'process.exit()', type: 1 } }), /công thức/);
assert.throws(() => new FNH.Action(data, { ...base, effects: [{ code: 999 }] }), /hiệu ứng/);
random = 0.99;
user.hit = 0.2;
const physical = new FNH.Action(data, { ...base, hitType: 1 });
assert.equal(physical.apply(user, target).missed, true);
random = 0;
const effect = new FNH.Action(data, { ...base, damage: { type: 0, formula: '0' }, effects: [
    { code: 21, dataId: 2, value1: 1 }, { code: 44, dataId: 7 }
] });
assert.equal(effect.apply(user, target).commonEvent, 7);
assert.equal(target.states.includes(2), true);
const remove = new FNH.Action(data, { ...base, damage: { type: 0, formula: '0' }, effects: [{ code: 22, dataId: 2, value1: 1 }] });
remove.apply(user, target);
assert.equal(target.states.includes(2), false);

// Dùng vật phẩm và common event ngay trong trận, không đợi trở lại bản đồ.
const battle = new FNH.Scene_Battle();
const item = { id: 1, name: 'Bình hồi MP', occasion: 0, scope: 11, consumable: true, successRate: 100,
    damage: { type: 0, formula: '0' }, effects: [{ code: 44, dataId: 1 }] };
data.items = [null, item];
data.commonEvents = [null, { list: [{ code: 312, parameters: [0, 1, 0, 0, 20] }] }];
user.inventory = [{ id: 1, amount: 1 }];
battle.game = { data, player: user, partyIds: [1, 2], actorStates: { 2: target }, mapId: 1, flags: {},
    assets: { loadImage: () => Promise.resolve() }, audio: { playSe() {} }, showToast() {} };
battle.input = { isPressed: () => false };
battle.player = user;
battle.members = [user, target];
battle.openActionMenu(false);
assert.equal(battle.actionMenu.length, 1);
battle.chooseAction(battle.actionMenu[0]);
assert.equal(user.inventory.length, 0, 'Tiêu thụ đúng một vật phẩm');
assert.equal(user.mp, 0);
battle.updateCommonEvent(0);
assert.equal(user.mp, 20, 'Common event áp dụng ngay trong trận');
assert.equal(battle.game.reservedCommonEvent, null);
assert.equal(battle.commonEventContext.eventRunner, null);
const skill = { ...base, id: 2, mpCost: 30 };
assert.equal(battle.useAction({ item: skill, isSkill: true }, [target]), false);
assert.equal(user.mp, 20, 'Không đủ MP không trừ tài nguyên');
const revive = { ...base, id: 3, scope: 9, mpCost: 0, damage: { type: 0, formula: '0' }, effects: [{ code: 22, dataId: 1, value1: 1 }] };
data.setActorHp(target, 0);
battle.chooseAction({ item: revive, isSkill: true });
assert.equal(battle.phase, 'actionTarget');
assert.equal(battle.actionMenu[0].actor, target);
battle.useAction(battle.pendingAction, [target]);
assert.equal(target.hp, 1);
console.log('ĐẠT: công thức, guard, drain, hồi phục, miss, chi phí, vật phẩm, common event và hồi sinh.');

data.recoverActor(target);
data.states[3] = { id: 3, traits: [], removeByDamage: true, chanceByDamage: 100 };
data.addActorState(target, 3);
user.tp = 0;
const gaining = new FNH.Action(data, { ...base, tpGain: 4 });
gaining.apply(user, target);
assert.equal(target.states.includes(3), false, 'Sát thương gỡ trạng thái có removeByDamage');
assert.ok(target.tp > 0);
assert.equal(user.tp, 4);
const weaponSkill = new FNH.Action(data, { ...base, requiredWtypeId1: 2 });
user.mp = 40;
assert.equal(weaponSkill.canUse(user, true), false, 'Yêu cầu loại vũ khí được kiểm tra');
console.log('ĐẠT: giải trạng thái khi nhận sát thương, nhận TP và yêu cầu loại vũ khí.');
