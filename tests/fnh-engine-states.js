'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FNH = { clamp: (v, min, max) => Math.max(min, Math.min(max, v)), Scene: class {} };
for (const file of ['data', 'scene_map']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../fnh-engine/js/' + file + '.js'), 'utf8'), { window: { FNH } });
}
const data = new FNH.DataStore();
data.actors = [null, { id: 1, classId: 1, initialLevel: 1, equips: [], traits: [{ code: 22, dataId: 0, value: 0.95 }] }];
data.classes = [null, { id: 1, name: 'Class', params: [[0, 100], [0, 40], [0, 10], [0, 10], [0, 10], [0, 10], [0, 10], [0, 10]], learnings: [] }];
data.states = [null,
    { id: 1, restriction: 4, traits: [], minTurns: 1, maxTurns: 1 },
    { id: 2, restriction: 0, traits: [{ code: 21, dataId: 2, value: 2 }], minTurns: 1, maxTurns: 1, autoRemovalTiming: 2 },
    { id: 3, restriction: 4, traits: [{ code: 22, dataId: 7, value: -0.1 }], minTurns: 1, maxTurns: 1, autoRemovalTiming: 0 },
    { id: 4, restriction: 0, traits: [{ code: 14, dataId: 3, value: 1 }], minTurns: 1, maxTurns: 1 },
    { id: 5, restriction: 0, traits: [{ code: 21, dataId: 1, value: 0.5 }], minTurns: 1, maxTurns: 1, removeByWalking: true, stepsToRemove: 2 }
];
const actor = data.createPlayer(1);
assert.equal(actor.hit, 0.95);
assert.equal(actor.pdr, 1);
data.addActorState(actor, 2);
assert.equal(actor.atk, 20);
data.addActorState(actor, 2);
assert.equal(actor.states.length, 1, 'Trạng thái không cộng trùng');
data.actorTurnEnd(actor);
assert.equal(actor.atk, 10);
data.addActorState(actor, 3);
assert.equal(actor.restriction, 4);
data.actorTurnEnd(actor);
assert.equal(actor.hp, 90, 'Hao HP theo trait regeneration');
data.addActorState(actor, 4);
data.removeActorState(actor, 3);
assert.equal(data.addActorState(actor, 3), false, 'Trait miễn nhiễm chặn trạng thái');
assert.equal(actor.restriction, 0);
data.addActorState(actor, 5);
assert.equal(actor.maxMp, 20);
assert.equal(actor.mp, 20);
data.actorWalkStep(actor);
assert.equal(actor.maxMp, 20);
data.actorWalkStep(actor);
assert.equal(actor.maxMp, 40);
assert.equal(actor.mp, 20, 'Hết trạng thái không tự hồi MP');
data.setActorHp(actor, 0);
assert.deepEqual(Array.from(actor.states), [1]);
assert.equal(actor.restriction, 4);
assert.equal(data.addActorState(actor, 2), false, 'Không thêm trạng thái cho actor đã chết');
data.removeActorState(actor, 1);
assert.equal(actor.hp, 1);
data.addActorState(actor, 3);
data.recoverActor(actor);
assert.equal(actor.hp, 100);
assert.equal(actor.mp, 40);
assert.equal(actor.states.length, 0);
const scene = new FNH.Scene_Map();
scene.game = { data, player: actor, flags: {}, showToast() {} };
const exec = (code, parameters) => scene.executeEventCommand({ code, parameters });
exec(313, [0, 1, 0, 2]);
assert.equal(scene.eventCondition([4, 1, 6, 2]), true);
exec(317, [0, 1, 2, 0, 0, 5]);
assert.equal(actor.atk, 30, 'Bonus chỉ số cộng trước trait multiplier');
exec(313, [0, 1, 1, 2]);
assert.equal(actor.atk, 15);
exec(314, [0, 1]);
assert.equal(actor.hp, 100);
const restored = JSON.parse(JSON.stringify(actor));
data.addActorState(restored, 5);
data.refreshActor(restored);
assert.equal(restored.maxMp, 20);
console.log('ĐẠT: trạng thái, traits, miễn nhiễm, chết/hồi sinh, thời hạn, hồi phục và bonus chỉ số.');
