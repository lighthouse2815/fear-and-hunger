'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const FNH = {};
for (const file of ['core', 'data', 'screen_effects', 'pictures', 'gab', 'interpreter', 'scene_map', 'game']) {
    vm.runInNewContext(fs.readFileSync('fnh-engine/js/' + file + '.js', 'utf8'), { window: { FNH }, console });
}
const c = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
const root = [c(121, [1, 1, 0]), c(111, [0, 1, 0]), c(117, [1], 1),
    c(411), c(125, [0, 0, 999], 1), c(412), c(125, [0, 0, 11]), c(123, ['A', 0])];
const data = new FNH.DataStore();
data.actors[1] = { id: 1, classId: 1, initialLevel: 1, equips: [], name: 'Actor' };
data.classes[1] = { id: 1, params: [[0, 100], [0, 40], ...Array.from({ length: 6 }, () => [0, 10])] };
data.tilesets[1] = { id: 1, tilesetNames: Array(9).fill(''), flags: [] };
data.commonEvents = [null, { list: [c(125, [0, 0, 3]), c(352), c(134, [1]), c(125, [0, 0, 5]), c(117, [2])] },
    { list: [c(125, [0, 0, 7])] }];
data.maps.set(1, { width: 2, height: 2, tilesetId: 1, data: [], events: [null,
    { id: 7, x: 0, y: 0, pages: [{ conditions: {}, image: {}, list: root }] }] });
let payload;
const storage = { save(slot, value) { payload = JSON.parse(JSON.stringify(value)); return true; },
    load() { return payload ? JSON.parse(JSON.stringify(payload)) : null; } };
function game() {
    return Object.assign(Object.create(FNH.Game.prototype), { data, storage, saveSlot: 1, mapId: 1, gold: 0, playtime: 0,
        flags: { 'system:saveDisabled': true }, player: data.createPlayer(1), partyIds: [1], actorStates: {},
        audio: { playSe() {}, stopBgm() {} }, assets: { loadImage: async () => ({}) }, changeScene() {}, showToast() {} });
}
async function mapScene(game) {
    const scene = new FNH.Scene_Map();
    scene.game = game;
    scene.input = { isPressed: () => false };
    await scene.loadMap();
    return scene;
}
(async () => {
    const original = game(), scene = await mapScene(original);
    scene.startEventList({ list: root }, 7);
    assert.equal(original.gold, 3);
    assert.equal(scene.paused, true);
    scene.activatePause(0);
    const saved = JSON.parse(JSON.stringify(payload));
    assert.equal(saved.eventContinuation.eventId, 7);
    assert.equal(saved.eventContinuation.state.frames.length, 2, 'Lưu cả frame gốc và common event đang gọi');
    assert.equal(saved.flags['system:saveDisabled'], true);
    scene.updateEvent(0);
    assert.equal(original.gold, 26);
    const restored = game();
    assert.equal(restored.loadGame(), true);
    const restoredScene = await mapScene(restored);
    assert.equal(restored.gold, 26, 'Tải save chạy phần còn lại của common event rồi về đúng frame gọi');
    assert.equal(restored.flags['self:1:7:A'], true, 'Khôi phục đúng ngữ cảnh self-switch của event');
    assert.equal(restored.flags['system:saveDisabled'], false);
    assert.equal(restoredScene.eventRunner, null);
    assert.equal(restoredScene.paused, false, 'Không mở lại màn hình lưu khi khôi phục');
    assert.equal(restored.pendingEventContinuation, null, 'Continuation chỉ được dùng một lần');
    assert.equal(restored.saveGame(), true);
    assert.equal(payload.eventContinuation, null, 'Save thường không giữ continuation đã chạy xong');
    payload = saved;
    delete payload.eventContinuation;
    const legacy = game();
    legacy.loadGame();
    await mapScene(legacy);
    assert.equal(legacy.gold, 3, 'Save cũ không có continuation vẫn tải bình thường');
    assert.equal(legacy.pendingEventContinuation, null);
    data.commonEvents[3] = { id: 3, trigger: 2, switchId: 3, list: [c(125, [0, 0, 1]), c(352),
        c(230, [10]), c(121, [3, 3, 1]), c(125, [0, 0, 2])] };
    const parallelGame = game();
    parallelGame.flags['switch:3'] = true;
    const parallelScene = await mapScene(parallelGame);
    parallelScene.updateParallelEvents(0);
    assert.equal(parallelGame.gold, 1);
    assert.equal(parallelScene.paused, true);
    parallelScene.activatePause(0);
    assert.equal(payload.eventContinuation.parallelKey, 'common:3');
    const parallelRestored = game();
    parallelRestored.loadGame();
    const parallelRestoredScene = await mapScene(parallelRestored);
    parallelRestoredScene.updateParallelEvents(0);
    assert.equal(parallelRestored.gold, 1, 'Parallel được khôi phục không chạy trùng phần trước điểm lưu');
    parallelRestoredScene.updateEvent(1);
    parallelRestoredScene.updateParallelEvents(0);
    assert.equal(parallelRestored.gold, 3);
    assert.equal(parallelRestored.flags['switch:3'], false);
    console.log('ĐẠT: lưu/tải event lồng common event, nhánh, self-switch, parallel và save cũ.');
})().catch((error) => { console.error(error); process.exitCode = 1; });

const stateRunner = new FNH.EventInterpreter([c(352)], { execute: () => ({ type: 'pause', scene: { paused: true } }) });
stateRunner.update(0);
stateRunner.gabText = 'Nội dung đang soạn';
stateRunner.choiceText[0] = 'Lựa chọn đổi tên';
stateRunner.disabledChoices.add(1);
const checkpoint = JSON.parse(JSON.stringify(stateRunner.snapshot()));
const stateRestored = new FNH.EventInterpreter([], {}, checkpoint);
assert.equal(stateRestored.gabText, 'Nội dung đang soạn');
assert.equal(stateRestored.choiceText[0], 'Lựa chọn đổi tên');
assert.equal(stateRestored.disabledChoices.has(1), true);
assert.notEqual(stateRestored.frames[0].branches, checkpoint.frames[0].branches);
assert.throws(() => new FNH.EventInterpreter([], {}, { frames: [{ list: [], index: -1 }] }), /Con trỏ event/);
