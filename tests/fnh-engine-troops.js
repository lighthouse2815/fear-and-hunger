'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FNH = { Scene: class {}, clamp: (v, min, max) => Math.max(min, Math.min(max, v)) };
const math = Object.create(Math); math.random = () => 0;
for (const file of ['data', 'interpreter', 'action', 'scene_map', 'scene_battle']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../fnh-engine/js/' + file + '.js'), 'utf8'), { window: { FNH }, Math: math });
}
const c = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
function setup() {
    const data = new FNH.DataStore();
    data.actors = [null, { id: 1, classId: 1, initialLevel: 1, equips: [], traits: [] }];
    data.classes = [null, { id: 1, params: [[0, 100], [0, 40], [0, 20], [0, 10], [0, 10], [0, 10], [0, 10], [0, 10]] }];
    data.states = [null, { id: 1, restriction: 4, traits: [] }];
    data.items = [null, { id: 1, name: 'Loot' }];
    data.enemies = [null, { id: 1, name: 'A', battlerName: 'Enemy', params: [50, 20, 10, 10, 10, 10, 10, 10], traits: [], gold: 3, exp: 5,
        actions: [{ skillId: 1, conditionType: 0, rating: 5 }], dropItems: [{ kind: 1, dataId: 1, denominator: 1 }] }];
    data.skills = [null, { id: 1, name: 'Hit', occasion: 1, scope: 1, successRate: 100, hitType: 0, mpCost: 0,
        damage: { type: 1, formula: '10', variance: 0 }, effects: [] }];
    data.troops = [null, { id: 1, name: 'Two enemies', members: [{ enemyId: 1, x: 10, y: 20 }, { enemyId: 1, x: 30, y: 20 }], pages: [] }];
    const map = new FNH.Scene_Map();
    map.map = { events: [] };
    map.input = { isPressed: () => false, consumeClick: () => null };
    map.game = { player: data.createPlayer(1), partyIds: [1], actorStates: {}, data, flags: { 'variable:2': 1 }, mapId: 1, sceneName: 'map', gold: 0,
        assets: { loadImage: () => Promise.resolve() }, showToast() {},
        audio: { saveBgm: () => null, stopBgm() {}, stopBgs() {}, playBgm: () => Promise.resolve(), playBgs: () => Promise.resolve(), playSe() {} },
        changeScene(Type, options) {
            if (typeof Type === 'function') {
                const battle = new Type(); battle.game = this; battle.input = map.input; battle.enter(options);
                this.scene = battle; this.sceneName = battle.name;
            } else { this.scene = Type; this.sceneName = Type.name; Type.enter(options); }
        }, gameOver() { this.dead = true; }
    };
    Object.assign(map.game.player, { mapX: 4, mapY: 5, direction: 8 });
    return map;
}
for (const outcome of [0, 1, 2]) {
    const map = setup();
    const list = [c(301, [1, 2, true, true]),
        c(601), c(125, [0, 0, 10], 1),
        c(602), c(125, [0, 0, 20], 1),
        c(603), c(125, [0, 0, 30], 1), c(604), c(123, ['A', 0])];
    const page = { list };
    map.startEventList(page, 4);
    const runner = map.eventRunner;
    assert.equal(runner.wait.type, 'battle');
    assert.equal(map.game.gold, 0, 'Chưa kết thúc không chạy nhánh kết quả');
    runner.resume(0);
    assert.equal(runner.wait.type, 'battle');
    const battle = map.game.scene;
    assert.equal(battle.enemies.length, 2);
    assert.equal(battle.enemies[0].maxHp, 50);
    assert.equal(map.game.data.enemies[1].params[0], 50);
    battle.enemy = battle.enemies[0];
    if (outcome === 0) {
        for (const enemy of battle.enemies) map.game.data.setActorHp(enemy, 0);
        battle.victory();
        assert.equal(map.game.gold, 6);
        assert.equal(map.game.player.inventory[0].amount, 2);
        assert.equal(map.game.guardDefeated, undefined, 'Thắng troop không đặt cờ Guard thử nghiệm');
        battle.returnToMap();
    } else if (outcome === 1) {
        battle.playerFlee();
        assert.equal(battle.phase, 'fled');
        battle.returnToMap();
    } else {
        map.game.data.setActorHp(map.game.player, 0);
        battle.defeat();
        battle.update(2);
        assert.equal(map.game.player.hp, 1, 'Cho phép thua hồi sinh người gục trước khi về event');
    }
    assert.equal(map.game.scene, map);
    assert.equal(map.eventRunner, runner, 'Khôi phục cùng interpreter thay vì chạy lại event');
    assert.equal(map.leaving, false);
    map.updateEvent(0);
    assert.equal(map.game.gold, [16, 20, 30][outcome]);
    assert.equal(map.game.flags['self:1:4:A'], true);
    assert.equal(map.game.player.mapX, 4);
    assert.equal(map.game.player.mapY, 5);
}
const map = setup();
map.startEventList({ list: [c(301, [0, 1, false, false])] }, 1);
const battle = map.game.scene;
battle.phase = 'command';
battle.playerFlee();
assert.equal(battle.phase, 'command', 'Cờ không cho chạy được tôn trọng');
const actor = battle.enemies[0];
const chosen = battle.chooseEnemyAction(actor);
assert.equal(chosen.id, 1);
battle.enemyTurn();
assert.equal(map.game.player.hp, 90);
battle.update(1);
assert.equal(map.game.player.hp, 80, 'Từng enemy hành động theo AI của mình');
map.game.data.setActorHp(map.game.player, 0);
battle.defeat(); battle.update(2);
assert.equal(map.game.dead, true, 'Thua không được phép mở game over');
assert.throws(() => map.game.data.createTroopEncounter(999), /Không tìm thấy troop/);
assert.equal(map.game.data.troops[1].members[0].x, 10, 'Không sửa dữ liệu troop gốc');
console.log('ĐẠT: troop độc lập, AI nhiều enemy, mục tiêu, drop và nhánh thắng/chạy/thua tiếp tục event.');

const randomMap = setup();
Object.assign(randomMap.map, { width: 12, height: 12, data: Array(864).fill(0), encounterList: [
    { troopId: 999, weight: 100, regionSet: [9] }, { troopId: 1, weight: 1, regionSet: [] }
] });
randomMap.startEventList({ list: [c(301, [2, 0, true, true])] }, 1);
assert.equal(randomMap.game.scene.encounter.id, 1, 'Chọn encounter theo region và trọng số');
console.log('ĐẠT: battle processing chọn troop ngẫu nhiên theo region.');

const eventMap = setup();
eventMap.game.data.commonEvents = [];
eventMap.startEventList({ list: [c(301, [0, 1, true, true])] }, 1);
const eventBattle = eventMap.game.scene;
eventBattle.encounter.pages = [
    { span: 0, conditions: { turnValid: true, turnA: 0, turnB: 0 }, list: [c(331, [0, 1, 0, 20, false]), c(121, [8, 8, 0])] },
    { span: 1, conditions: { turnEnding: true }, list: [c(125, [0, 0, 2])] },
    { span: 2, conditions: { switchValid: true, switchId: 9 }, list: [c(121, [9, 9, 1]), c(332, [-1, 1, 0, 3])] }
];
assert.equal(eventBattle.updateBattleEvent(), true);
assert.equal(eventBattle.enemies[0].hp, 30);
assert.equal(eventMap.game.flags['switch:8'], true);
assert.equal(eventBattle.updateBattleEvent(), false, 'Trang một lần không chạy lại');
eventBattle.phase = 'turnEnd';
assert.equal(eventBattle.updateBattleEvent(), true);
assert.equal(eventMap.game.gold, 2);
assert.equal(eventBattle.updateBattleEvent(), false, 'Trang mỗi lượt chỉ chạy một lần trong lượt');
eventBattle.turn += 1;
assert.equal(eventBattle.updateBattleEvent(), true);
assert.equal(eventMap.game.gold, 4);
eventBattle.phase = 'command';
eventMap.game.flags['switch:9'] = true;
assert.equal(eventBattle.updateBattleEvent(), true);
assert.equal(eventBattle.enemies[0].mp, 17);
assert.equal(eventBattle.enemies[1].mp, 17);
assert.equal(eventBattle.updateBattleEvent(), false);
const context = eventBattle.battleEventContext();
assert.equal(context.eventCondition([5, 0, 0]), true);
eventBattle.enemies[0].hidden = true;
assert.equal(context.eventCondition([5, 0, 0]), false);
context.executeEventCommand(c(335, [0]));
assert.equal(context.eventCondition([5, 0, 0]), true);
context.executeEventCommand(c(331, [-1, 1, 0, 999, false]));
assert.equal(eventBattle.enemies[0].hp, 1);
assert.equal(eventBattle.enemies[1].hp, 1);
context.executeEventCommand(c(331, [0, 1, 0, 999, true]));
assert.equal(context.eventCondition([5, 0, 1, 1]), true);
assert.equal(context.eventDataOperand(4, 0, 0), 0);
context.executeEventCommand(c(334, [-1]));
assert.equal(eventBattle.enemies[0].hp, 50);
assert.equal(eventBattle.enemies[0].mp, 20);
assert.equal(context.eventCondition([5, 0, 1, 1]), false);
context.executeEventCommand(c(342, [-1, 0, 0, 200]));
assert.equal(eventBattle.enemies[1].tp, 100);
assert.equal(eventBattle.battleEventMatches({ conditions: {} }), false);
assert.equal(eventBattle.battleEventMatches({ conditions: { turnValid: true, turnA: 1, turnB: 2 } }), false);
eventBattle.turn = 3;
assert.equal(eventBattle.battleEventMatches({ conditions: { turnValid: true, turnA: 1, turnB: 2 } }), true);
assert.equal(eventBattle.battleEventMatches({ conditions: { enemyValid: true, enemyIndex: 0, enemyHp: 50 } }), false);
console.log('ĐẠT: sự kiện troop theo lượt, switch, HP và lệnh thay đổi cả nhóm quái.');

eventMap.game.data.enemies[2] = { ...eventMap.game.data.enemies[1], id: 2, name: 'Transformed',
    battlerName: 'Other', params: [25, 5, 30, 10, 10, 10, 10, 10], gold: 99, exp: 88, actions: [] };
const transformed = eventBattle.enemies[0];
transformed.hidden = true;
context.executeEventCommand(c(336, [0, 2]));
assert.equal(transformed.enemyId, 2);
assert.equal(transformed.hp, 25, 'Biến hình giới hạn HP theo chỉ số mới');
assert.equal(transformed.mp, 5);
assert.equal(transformed.atk, 30);
assert.equal(transformed.hidden, true, 'Biến hình giữ trạng thái ẩn');
assert.equal(transformed.parts[0].x, 10);
assert.equal(transformed.parts[0].image, 'enemies/Other');
assert.equal(transformed.rewardGold, 99);
assert.equal(transformed.rewardExp, 88);
assert.equal(transformed.actions.length, 0);
assert.equal(eventBattle.enemies[1].enemyId, 1, 'Không biến hình nhầm enemy khác');
assert.throws(() => context.executeEventCommand(c(336, [0, 999])), /Không tìm thấy enemy/);
const abortMap = setup();
abortMap.startEventList({ list: [c(301, [0, 1, false, false]), c(602), c(125, [0, 0, 9], 1), c(604)] }, 1);
const abortBattle = abortMap.game.scene;
abortBattle.battleEventContext().executeEventCommand(c(340));
assert.equal(abortMap.game.scene, abortMap, 'Abort về cùng bản đồ dù cấm chạy');
abortMap.updateEvent(0);
assert.equal(abortMap.game.gold, 9, 'Abort trả nhánh thoát và không trao thưởng chiến thắng');
console.log('ĐẠT: biến hình cập nhật dữ liệu chiến đấu và abort tiếp tục event bản đồ.');

context.executeEventCommand(c(333, [1, 0, 1]));
assert.equal(eventBattle.enemies[1].hp, 0);
context.executeEventCommand(c(333, [1, 1, 1]));
assert.equal(eventBattle.enemies[1].hp, 1);
assert.equal(eventBattle.battleEventMatches({ conditions: { actorValid: true, actorId: 1, actorHp: 50 } }), false);
eventMap.game.data.setActorHp(eventMap.game.player, 50);
assert.equal(eventBattle.battleEventMatches({ conditions: { actorValid: true, actorId: 1, actorHp: 50 } }), true);
console.log('ĐẠT: trạng thái enemy và ngưỡng HP actor trong điều kiện troop.');

const forcedMap = setup();
forcedMap.startEventList({ list: [c(301, [0, 1, true, true])] }, 1);
const forcedBattle = forcedMap.game.scene;
const forcedContext = forcedBattle.battleEventContext();
forcedBattle.phase = 'command';
forcedContext.startEventList({ list: [c(339, [0, 0, 1, 0]), c(125, [0, 0, 7])] }, 0);
assert.equal(forcedMap.game.player.hp, 90, 'Quái bị ép hành động gây sát thương đúng actor');
assert.equal(forcedContext.eventRunner.wait.type, 'time');
assert.equal(forcedMap.game.gold, 0, 'Interpreter chờ hành động trước lệnh tiếp theo');
forcedContext.updateEvent(1);
assert.equal(forcedMap.game.gold, 7);
assert.equal(forcedBattle.phase, 'command', 'Hành động ép không ghi đè pha bị ngắt');
forcedContext.executeEventCommand(c(339, [1, 1, 1, 1]));
assert.equal(forcedBattle.enemies[0].hp, 50);
assert.equal(forcedBattle.enemies[1].hp, 40, 'Actor ép dùng kỹ năng lên mục tiêu chỉ định');
forcedContext.executeEventCommand(c(339, [1, 1, 1, -2]));
assert.equal(forcedBattle.enemies[1].hp, 30, 'Mục tiêu -2 dùng mục tiêu gần nhất');
forcedMap.game.data.setActorHp(forcedBattle.enemies[1], 0);
forcedContext.executeEventCommand(c(339, [1, 1, 1, 1]));
assert.equal(forcedBattle.enemies[0].hp, 40, 'Mục tiêu đã chết được đổi sang mục tiêu sống');
const beforeForced = forcedMap.game.player.hp;
assert.equal(forcedBattle.forceAction(forcedBattle.enemies[1], 1, 0), false);
assert.equal(forcedMap.game.player.hp, beforeForced, 'Quái đã chết không thực hiện forced action');
forcedMap.game.data.skills[2] = { ...forcedMap.game.data.skills[1], id: 2, scope: 2, mpCost: 100 };
forcedBattle.forceAction(forcedMap.game.player, 2, -1);
assert.equal(forcedMap.game.player.mp, 0, 'Forced action trừ chi phí và không tạo MP âm');
assert.equal(forcedBattle.enemies[0].hp, 30);
assert.equal(forcedBattle.actionTargets(forcedMap.game.player, { scope: 0 }, -1)[0], null);
assert.equal(forcedBattle.actionTargets(forcedMap.game.player, { scope: 11 }, -1)[0], forcedMap.game.player);
assert.equal(forcedBattle.actionTargets(forcedMap.game.player, { scope: 6 }, -1).length, 4);
console.log('ĐẠT: forced action actor/quái, mục tiêu gần nhất, chi phí và chờ interpreter.');

const partyMap = setup();
partyMap.game.data.actors[2] = { ...partyMap.game.data.actors[1], id: 2, name: 'Companion' };
partyMap.startEventList({ list: [c(301, [0, 1, true, true])] }, 1);
const partyBattle = partyMap.game.scene;
partyBattle.phase = 'command';
const partyContext = partyBattle.battleEventContext();
partyContext.executeEventCommand(c(129, [2, 0, true]));
assert.equal(partyBattle.members.length, 2, 'Thêm actor trong battle cập nhật đội hình ngay');
partyBattle.finishActorAction();
assert.equal(partyBattle.player.id, 2);
partyBattle.guardedActors.add(1);
partyContext.executeEventCommand(c(129, [1, 1, false]));
assert.equal(partyBattle.members.length, 1);
assert.equal(partyMap.game.player.id, 2);
assert.equal(partyBattle.player.id, 2);
assert.equal(partyBattle.guardedActors.has(1), false);
partyBattle.finishActorAction();
assert.equal(partyBattle.phase, 'enemy', 'Đổi đội trưởng không cho actor đã đi hành động lại');
partyBattle.phase = 'command';
partyBattle.completedActors.clear();
partyContext.executeEventCommand(c(129, [1, 0, false]));
partyBattle.selectMember(0);
partyContext.executeEventCommand(c(129, [2, 1, false]));
assert.equal(partyBattle.player.id, 1, 'Xóa actor đang chọn chuyển sang người còn lượt');
assert.equal(partyBattle.phase, 'command');
assert.equal(partyBattle.members.length, 1);
partyContext.executeEventCommand(c(129, [1, 1, false]));
assert.equal(partyBattle.members.length, 0);
assert.equal(partyBattle.phase, 'defeat', 'Đội hình rỗng không tiếp tục nhận lệnh');
console.log('ĐẠT: event đổi tổ đội giữa trận, giữ lượt và loại bỏ tham chiếu actor đã rời.');

const musicMap = setup();
const musicCalls = [];
musicMap.game.data.system = { battleBgm: { name: 'Default', volume: 90, pitch: 100, pan: 0 } };
musicMap.game.audio.playBgm = (name, options) => { musicCalls.push([name, options]); return Promise.resolve(); };
musicMap.executeEventCommand(c(132, [{ name: 'Changed', volume: 0, pitch: 120, pan: -50 }]));
musicMap.startEventList({ list: [c(301, [0, 1, true, true])] }, 1);
assert.equal(musicCalls[0][0], 'Changed');
assert.equal(musicCalls[0][1].volume, 0);
assert.equal(musicCalls[0][1].pitch, 120);
assert.equal(musicMap.game.data.system.battleBgm.name, 'Default', 'Đổi nhạc không sửa database dùng chung');
const silentMap = setup();
let playedSilentMusic = false;
silentMap.game.audio.playBgm = () => { playedSilentMusic = true; };
silentMap.executeEventCommand(c(132, [{ name: '', volume: 90, pitch: 100, pan: 0 }]));
silentMap.startEventList({ list: [c(301, [0, 1, true, true])] }, 1);
assert.equal(playedSilentMusic, false, 'Tên nhạc trống cho trận im lặng theo event');
console.log('ĐẠT: event đổi nhạc trận, thông số âm thanh và tên trống.');

const backdropMap = setup();
Object.assign(backdropMap.map, { specifyBattleback: true, battleback1Name: 'MapFloor', battleback2Name: 'MapWall' });
backdropMap.executeEventCommand(c(283, ['EventFloor', 'EventWall']));
const loadedBackdrops = [];
backdropMap.game.assets.loadImage = (name) => { loadedBackdrops.push(name); return Promise.resolve(); };
backdropMap.startEventList({ list: [c(301, [0, 1, true, true])] }, 1);
assert.equal(backdropMap.game.scene.battlebackNames.join(','), 'EventFloor,EventWall');
assert.ok(loadedBackdrops.includes('battlebacks1/EventFloor'));
assert.ok(loadedBackdrops.includes('battlebacks2/EventWall'));
assert.equal(backdropMap.map.battleback1Name, 'MapFloor', 'Không đổi database bản đồ khi event đổi nền');
const databaseBackdropMap = setup();
Object.assign(databaseBackdropMap.map, { specifyBattleback: true, battleback1Name: 'MapFloor', battleback2Name: '' });
databaseBackdropMap.startEventList({ list: [c(301, [0, 1, true, true])] }, 1);
assert.equal(databaseBackdropMap.game.scene.battlebackNames.join(','), 'MapFloor,');
const emptyBackdropMap = setup();
emptyBackdropMap.executeEventCommand(c(283, ['', '']));
emptyBackdropMap.startEventList({ list: [c(301, [0, 1, true, true])] }, 1);
assert.equal(emptyBackdropMap.game.scene.battlebackNames.join(','), ',', 'Hai tên trống không rơi về nền Guard');
console.log('ĐẠT: nền trận hai lớp từ bản đồ và event, tên trống và nạp asset đúng thư mục.');
const resetBackdropMap = setup();
resetBackdropMap.executeEventCommand(c(283, ['Temporary', '']));
resetBackdropMap.enter({ resume: true });
assert.equal(resetBackdropMap.game.flags['map:battleback'].names[0], 'Temporary', 'Trở lại từ trận giữ override');
resetBackdropMap.game.mapId = 2;
resetBackdropMap.loadMap = async () => {};
resetBackdropMap.enter({ fromTransfer: true });
assert.equal(resetBackdropMap.game.flags['map:battleback'], undefined, 'Chuyển bản đồ bỏ override của bản đồ trước');
