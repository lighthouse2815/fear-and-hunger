'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const FNH = {};
const canvas = { width: 816, height: 624, getContext: () => ({ drawImage() {} }) };
const document = { createElement: () => canvas };
for (const file of ['core', 'data', 'action', 'scene_map', 'screen_effects', 'pictures', 'gab', 'game', 'native_menu']) {
    vm.runInNewContext(fs.readFileSync('fnh-engine/js/' + file + '.js', 'utf8'), { window: { FNH }, document });
}
const data = new FNH.DataStore();
data.system = { equipTypes: ['', 'Weapon', 'Shield', 'Head', 'Body', 'Accessory'],
    sounds: Array.from({ length: 4 }, () => ({ name: 'cursor', volume: 75, pitch: 100, pan: 0 })) };
data.actors[1] = { id: 1, name: 'Actor', classId: 1, initialLevel: 1, maxLevel: 99, equips: [1, 0, 0, 1, 0], traits: [] };
data.classes[1] = { id: 1, expParams: [30, 20, 30, 30], traits: [{ code: 51, dataId: 1 }, { code: 52, dataId: 1 }],
    params: Array.from({ length: 8 }, (_, index) => [0, index === 0 ? 100 : index === 1 ? 40 : 10]) };
data.weapons[1] = { id: 1, name: 'Sword', etypeId: 1, wtypeId: 1, params: [0, 0, 10, 0, 0, 0, 0, 0], traits: [] };
data.weapons[2] = { id: 2, name: 'Forbidden', etypeId: 1, wtypeId: 2, params: [0, 0, 99, 0, 0, 0, 0, 0], traits: [] };
data.armors[1] = { id: 1, name: 'Vest', etypeId: 4, atypeId: 1, params: [0, 0, 0, 5, 0, 0, 0, 0], traits: [] };
data.items[1] = { id: 1, name: 'Recipe book', note: '<Item Recipe: 5>', itypeId: 2 };
data.items[2] = { id: 2, name: 'Ingredient', itypeId: 1 };
data.items[3] = { id: 3, name: 'Second ingredient', itypeId: 1 };
data.items[5] = { id: 5, name: 'Medicine', itypeId: 1, occasion: 2, scope: 7, successRate: 100, hitType: 0,
    consumable: true, damage: { type: 0, formula: '0' }, effects: [{ code: 11, value1: 0.2, value2: 10 }, { code: 12, value1: 0.25, value2: 5 }],
    note: '<Synthesis Ingredients>\nitem 2: 2\nitem 2\nitem 3\ngold: 2\n</Synthesis Ingredients>' };
data.items[6] = { id: 6, name: 'Torch', itypeId: 1, occasion: 2, scope: 0, consumable: true, effects: [{ code: 44, dataId: 7 }] };
const storage = new Map();
const game = Object.assign(Object.create(FNH.Game.prototype), { canvas, data, flags: {}, gold: 5, saveSlot: 1, playtime: 0,
    player: data.createPlayer(1), actorStates: {}, partyIds: [1], audio: { playSe() {} },
    input: { isPressed: () => false, clearFrame() {} }, storage: {
        save(slot, value) { storage.set(slot, JSON.parse(JSON.stringify(value))); return true; }, load: (slot) => storage.get(slot)
    }, changeScene() {}, showToast() {} });
game.player.inventory = [{ id: 1, amount: 1 }, { id: 2, amount: 3 }, { id: 2, kind: 'weapon', amount: 1 }];
const scene = new FNH.Scene_Map(); scene.game = game; scene.input = game.input; scene.map = { events: [] }; scene.paused = true;
const menu = new FNH.NativeMenu(scene); scene.nativeMenu = menu;
const recipe = menu.recipes()[0];
assert.equal(recipe.needs[0].amount, 3, 'Gộp nguyên liệu trùng để không trừ thiếu chi phí');
const before = JSON.stringify(game.player.inventory);
assert.equal(menu.craft(recipe), false);
assert.equal(JSON.stringify(game.player.inventory), before, 'Thiếu một nguyên liệu không tiêu thụ phần đã đủ');
assert.equal(game.gold, 5);
game.player.inventory.push({ id: 3, amount: 1 });
assert.equal(menu.craft(recipe), true);
assert.equal(menu.count('item', 2), 0);
assert.equal(menu.count('weapon', 2), 1, 'Không tiêu thụ weapon trùng ID với item');
assert.equal(menu.count('item', 5), 1);
assert.equal(game.gold, 3);
assert.equal(menu.craft(recipe), false, 'Không chế tạo lần hai khi hết nguyên liệu');
game.player.hp = 10; game.player.mp = 0;
const medicine = { item: data.items[5] };
assert.equal(menu.use(medicine, 0), true);
assert.equal(game.player.hp, 40);
assert.equal(game.player.mp, 15);
assert.equal(menu.count('item', 5), 0);
assert.equal(menu.use(medicine, 0), false, 'Không dùng lại vật phẩm đã tiêu thụ hết');
assert.equal(game.player.hp, 40);
assert.equal(new FNH.Action(data, data.items[5]).canUse(game.player, false), false, 'Đồ dùng trên bản đồ không dùng được trong trận');
menu.page = 'equip'; menu.category = 2; menu.focus = 'tabs';
game.input.isPressed = (...keys) => keys.includes('Enter');
menu.update(0);
assert.equal(game.player.equipment.length, 0);
assert.equal(menu.count('weapon', 1), 1);
menu.category = 1; menu.update(0);
assert.equal(game.player.equipment.length, 2);
assert.equal(game.player.equipment.some((item) => item.id === 2 && item.type === 'weapon'), false, 'Optimize không mặc vũ khí thiếu quyền sử dụng');
game.player.inventory.push({ id: 6, amount: 1 });
assert.equal(menu.use({ item: data.items[6] }, 0), true);
assert.equal(game.reservedCommonEvent, 7);
assert.equal(scene.paused, false, 'Common event trả về bản đồ để chạy kịch bản thật');
assert.equal(menu.count('item', 6), 0);
scene.nativeMenu = new FNH.NativeMenu(scene, 'save'); scene.paused = true;
scene.nativeMenu.index = 19; scene.nativeMenu.update(0);
assert.equal(storage.has(20), true);
assert.equal(game.saveSlot, 20);
assert.equal(game.getSaveInfo(20).playerName, 'Cahara');
assert.equal(game.getSaveInfo(1), null);
assert.equal(scene.paused, false);
const originalGold = game.gold;
game.gold = 999; game.loadGame(20);
assert.equal(game.gold, originalGold, 'Tải đúng File được chọn');
game.saveSlot = 1;
game.gold = 999;
assert.equal(game.loadGame(), true, 'Tải nhanh vẫn tìm được save khi chỉ có File 20');
assert.equal(game.saveSlot, 20);
assert.equal(game.gold, originalGold);
assert.equal(game.saveGame({ slot: 21 }), false, 'Không ghi ngoài 20 slot');
console.log('ĐẠT: chế tạo theo công thức, trừ đồ nguyên tử, dùng đồ ngoài trận, trang bị hợp lệ, common event và 20 slot lưu.');
