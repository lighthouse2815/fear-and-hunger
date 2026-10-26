'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileScript, executeScript } = require('../game/engine/script-runtime');
const { GameState } = require('../game/engine/game-state');
const root = path.join(__dirname, '..', 'game/data');
const database = { Actors: require('../game/data/Actors.json'), Classes: require('../game/data/Classes.json') };
const scripts = new Set();
function scan(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.parameters)) {
        if ([355, 655, 45].includes(value.code)) scripts.add(value.parameters[0]);
        if (value.code === 111 && value.parameters[0] === 12) scripts.add(value.parameters[1]);
    }
    Object.values(value).filter(entry => entry && typeof entry === 'object').forEach(scan);
}
for (const file of fs.readdirSync(root).filter(name => name.endsWith('.json'))) {
    scan(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')));
}
assert.equal(scripts.size, 1082, 'kiểm kê toàn bộ biến thể script trong JSON hiện tại');
for (const script of scripts) {
    const state = new GameState({}, database), character = {};
    const operations = compileScript(script);
    assert.ok(operations.length > 0, script);
    executeScript(script, { state, character });
    for (const operation of operations) {
        if (operation.type === 'image') {
            const actor = state.actor(operation.id);
            assert.equal(actor[operation.kind + 'Name'], operation.name);
            if (operation.kind !== 'battler') assert.equal(actor[operation.kind + 'Index'], operation.index);
        } else if (operation.type === 'maxHp') {
            assert.equal(state.actor(operation.id).maxHpOverride, operation.value);
        } else if (operation.type === 'disableTouch') assert.equal(state.touchEnabled, false);
        else if (operation.type !== 'refresh') assert.equal(character[operation.type], operation.value);
    }
}
const state = new GameState({ party: [1] }, database);
executeScript("$gameActors.actor(0001).setCharacterImage('mercenary3', 7);\n$gameActors.actor(1).setMaxHp(30);", { state });
state.changeActorHp(1, 1000, true);
assert.equal(state.actor(1).hp, 30, 'hồi HP phải giữ giới hạn do script đặt');
state.recoverActor(1);
assert.equal(state.actor(1).hp, 30);
state.changeActorMp(1, -10);
assert.equal(state.actor(1).characterName, 'mercenary3', 'cập nhật HP/MP giữ thay đổi hình');
const restored = new GameState(state.toJSON(), database);
restored.changeActorHp(1, 1000, true);
assert.equal(restored.actor(1).hp, 30);
assert.equal(restored.actor(1).characterIndex, 7);
const levelThree = new GameState({ actors: { 1: { ...state.actor(1), level: 3 } } }, database);
executeScript('$gameActors.actor(1).setMaxHp(100);', { state: levelThree });
levelThree.recoverActor(1);
assert.equal(levelThree.actor(1).hp, 100, 'setMaxHp đặt giá trị mới, kể cả cao hơn chỉ số của class');
assert.throws(() => executeScript('$gameActors.actor(1).setMaxHp(50);\nunknown()', { state }), /Chưa chuyển đổi script/);
assert.equal(state.actor(1).maxHpOverride, 30, 'script không hỗ trợ không được áp dụng một phần');
assert.throws(() => compileScript('globalThis.__injected = true'), /Chưa chuyển đổi script/);
assert.equal(globalThis.__injected, undefined);
console.log('ĐẠT: chuyển 1.082 biến thể script JSON sang API mới, giữ hình và giới hạn HP qua save.');
