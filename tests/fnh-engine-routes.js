'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FNH = { Scene: class {}, TILE: 48 };
for (const file of ['data', 'interpreter', 'move_route', 'scene_map']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../fnh-engine/js/' + file + '.js'), 'utf8'), { window: { FNH } });
}
const command = (code, parameters = []) => ({ code, parameters });
function setup() {
    const scene = new FNH.Scene_Map();
    scene.game = {
        mapId: 2, flags: {}, gold: 0,
        player: { mapX: 0, mapY: 0, direction: 2, characterName: 'Actor', characterIndex: 0 },
        data: new FNH.DataStore(), audio: { playSe() {} }, showToast() {},
        assets: { loadImage: () => Promise.resolve() }
    };
    scene.game.data.isTilePassable = () => true;
    scene.map = { width: 12, height: 12, events: [null, {
        id: 1, x: 4, y: 4, pages: [{ priorityType: 1, image: { characterName: 'Actor', direction: 2 }, list: [] }]
    }] };
    scene.guard.alive = false;
    scene.eventId = 1;
    scene.input = { isPressed: () => false };
    return scene;
}
function force(scene, id, list, options = {}) {
    return scene.executeEventCommand(command(205, [id, { list: [...list, command(0)], ...options }]));
}
function advance(scene, count = 20, dt = 0.1) {
    for (let i = 0; i < count; i += 1) scene.updateMoveRoutes(dt);
}

let scene = setup();
scene.startEventList({ list: [
    command(205, [0, { wait: true, list: [command(3), command(15, [30]), command(19), command(0)] }]),
    command(505, [{ code: 3 }]), command(125, [0, 0, 5])
] }, 1);
assert.equal(scene.eventRunner.wait.type, 'route');
scene.eventRunner.resume();
assert.equal(scene.eventRunner.wait.type, 'route', 'Xác nhận không được bỏ qua route');
scene.updateMoveRoutes(0);
assert.equal(scene.eventDataOperand(5, 1, 0), 5);
assert.equal(scene.eventDataOperand(5, 1, 3), 216, 'Vị trí vẽ bắt đầu ở ô cũ');
scene.updateMoveRoutes(0.1);
assert.ok(scene.eventCharacter(1).realX > 4 && scene.eventCharacter(1).realX < 5);
scene.updateEvent(0.1);
assert.equal(scene.game.gold, 0, 'Không chạy lệnh sau route đang di chuyển');
scene.updateMoveRoutes(0.2);
scene.updateMoveRoutes(0.2);
scene.updateEvent(0.2);
assert.equal(scene.game.gold, 0, 'Không chạy lệnh sau route đang chờ');
advance(scene);
scene.updateEvent(0);
assert.equal(scene.game.gold, 5);
assert.equal(scene.eventCondition([6, 1, 8]), true);
assert.equal(scene.map.events[1].x, 4, 'Route không sửa dữ liệu gốc');

scene = setup();
scene.game.data.isTilePassable = () => false;
const waiting = force(scene, 1, [command(3)] , { wait: true });
advance(scene, 5);
assert.equal(waiting.route.index, 0, 'Route không skip thử lại khi đường bị chặn');
assert.equal(waiting.route.done, false);
scene.game.data.isTilePassable = () => true;
advance(scene);
assert.equal(waiting.route.done, true);
assert.equal(scene.eventCharacter(1).x, 5);
scene.game.data.isTilePassable = () => false;
const skipping = force(scene, 1, [command(3)], { wait: true, skippable: true });
advance(scene);
assert.equal(skipping.route.done, true);
assert.equal(scene.eventCharacter(1).x, 5, 'Skip không dịch chuyển xuyên tường');
force(scene, 1, [command(37), command(3), command(38)]);
advance(scene);
assert.equal(scene.eventCharacter(1).x, 6, 'Through cho phép qua tường');
assert.equal(scene.mapCharacter(1).throughOverride, false);

scene = setup();
force(scene, 1, [command(35), command(19), command(3), command(13), command(36), command(17)]);
advance(scene, 40);
assert.equal(scene.eventCharacter(1).x, 5);
assert.equal(scene.eventCharacter(1).y, 3, 'Lùi đi ngược hướng mà không quay mặt');
assert.equal(scene.eventCharacter(1).direction, 4);
force(scene, 1, [command(14, [2, 1])]);
scene.updateMoveRoutes(0);
scene.updateMoveRoutes(0.1);
assert.ok(scene.mapCharacter(1).jumpHeight > 0);
advance(scene);
assert.equal(scene.eventCharacter(1).x, 7);
assert.equal(scene.eventCharacter(1).y, 4);
assert.equal(scene.eventCharacter(1).direction, 6, 'Nhảy quay mặt theo hướng dịch chuyển');
assert.ok(scene.mapCharacter(1).jumpHeight < 0.001);

scene = setup();
force(scene, -1, [command(3), command(1), command(42, [128]), command(39)]);
advance(scene);
assert.equal(scene.game.player.mapX, 1);
assert.equal(scene.game.player.mapY, 1);
assert.equal(scene.playerVisual.x, 1);
assert.equal(scene.playerVisual.y, 1);
assert.equal(scene.playerRouteState.opacity, 128);
assert.equal(scene.playerRouteState.transparent, true);
assert.equal(scene.game.player.direction, 2);

scene = setup();
scene.map.events.push({ id: 2, x: 5, y: 4, pages: [{ priorityType: 1, list: [] }] });
force(scene, 1, [command(3)]);
advance(scene);
assert.equal(scene.eventCharacter(1).x, 4, 'NPC khác chặn route');
force(scene, 2, [command(1)]);
advance(scene);
assert.equal(scene.eventCharacter(1).x, 5, 'Route tiếp tục khi NPC kia rời chỗ');

scene = setup();
force(scene, 1, [command(27, [8]), command(42, [80]), command(41, ['Other', 2]), command(44, [{ name: 'test', volume: 0 }])]);
let audio;
scene.game.audio.playSe = (name, options) => { audio = { name, options }; };
advance(scene);
assert.equal(scene.game.flags['switch:8'], true);
assert.equal(scene.events[0].opacity, 80);
assert.equal(scene.events[0].imageName, 'Other');
assert.equal(audio.options.volume, 0);
const repeated = force(scene, 1, [command(22)], { repeat: true, wait: true });
advance(scene);
assert.equal(repeated.route.done, false);
const replaced = force(scene, 1, [command(28, [8])], { wait: true });
assert.equal(repeated.route.done, true, 'Route thay thế giải phóng token chờ cũ');
advance(scene);
assert.equal(replaced.route.done, true);
assert.equal(scene.game.flags['switch:8'], false);

scene = setup();
scene.startEventList({ list: [command(205, [0, { wait: true, list: [command(45, ['throw new Error()'])] }]), command(125, [0, 0, 100])] }, 1);
scene.updateMoveRoutes(0);
scene.updateEvent(0);
assert.match(scene.game.lastError.message, /Chưa hỗ trợ lệnh move route 45/);
assert.equal(scene.game.gold, 0, 'Không thực thi hậu quả sau route lỗi');
assert.equal(scene.eventRunner, null);
force(scene, 1, [command(3)], { wait: true });
scene.erasedEvents.add(1);
scene.updateMoveRoutes(0);
assert.equal(scene.moveRoutes.size, 0, 'Xóa event hủy route của nó');
console.log('ĐẠT: move route, nội suy, chờ, va chạm, skip, through, quay, nhảy, hình ảnh và lỗi an toàn.');

scene = setup();
scene.startEventList({ list: [command(205, [0, { wait: false, list: [command(3), command(45, ['ignored'])] }]), command(125, [0, 0, 100])] }, 1);
assert.equal(scene.game.gold, 0, 'Route lỗi bị từ chối trước cả các lệnh non-wait tiếp theo');
assert.equal(scene.eventCharacter(1).x, 4);
console.log('ĐẠT: xác thực route trước khi thực thi để tránh hậu quả sai.');
