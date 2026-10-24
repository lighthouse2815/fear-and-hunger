'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let playFailure = null;
class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.pauseCount = 0; this.loadCount = 0; }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    appendChild(child) { this.children.push(child); child.parent = this; }
    replaceChildren() { this.children = []; }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    emit(type) { if (this.listeners[type]) this.listeners[type](); }
    pause() { this.pauseCount += 1; }
    load() { this.loadCount += 1; }
    play() { return playFailure ? Promise.reject(playFailure) : Promise.resolve(); }
    remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
}
const document = { body: new Element('body'), createElement: (tag) => new Element(tag) };
const FNH = {};
for (const file of ['core', 'assets', 'interpreter', 'scene_map', 'scene_battle']) {
    vm.runInNewContext(fs.readFileSync('fnh-engine/js/' + file + '.js', 'utf8'), { window: { FNH }, document });
}
const c = (code, parameters = []) => ({ code, parameters });
const flush = () => new Promise(setImmediate);
function scene() {
    const result = new FNH.Scene_Map();
    result.map = { events: [] };
    result.input = { enabled: true, down: new Set(['Enter']), pressed: new Set(['Enter']), isPressed: () => false,
        clearFrame() { this.pressed.clear(); } };
    result.game = { flags: {}, gold: 0, player: { id: 1 }, data: {}, audio: { muted: true },
        assets: new FNH.AssetLoader({ root: '/game/' }), showToast() {} };
    return result;
}
(async () => {
    const map = scene();
    map.startEventList({ list: [c(261, ['intro scene']), c(125, [0, 0, 7])] }, 0);
    const video = map.movieElement;
    assert.equal(map.eventRunner.wait.type, 'video');
    assert.equal(map.input.enabled, false);
    assert.equal(map.input.down.size, 0);
    assert.equal(video.controls, true);
    assert.equal(video.muted, true);
    assert.equal(video.children[0].src, '/game/movies/intro%20scene.webm');
    assert.equal(video.children[1].type, 'video/mp4');
    map.updateEvent(100);
    assert.equal(map.game.gold, 0, 'Không đoán thời lượng phim để chạy tiếp event');
    assert.equal(map.dialogRunner, map.eventRunner);
    video.emit('ended');
    map.updateEvent(0);
    assert.equal(map.game.gold, 7);
    assert.equal(map.input.enabled, true);
    assert.equal(map.movieElement, null);
    assert.equal(video.loadCount, 1);
    assert.equal(video.children.length, 0);
    assert.equal(document.body.children.length, 0);
    map.startEventList({ list: [c(261, ['']), c(125, [0, 0, 3])] }, 0);
    assert.equal(map.game.gold, 10, 'Tên phim trống không mở trình phát hoặc giữ event');
    map.startEventList({ list: [c(261, ['missing']), c(125, [0, 0, 99])] }, 0);
    map.movieElement.emit('error');
    map.updateEvent(0);
    assert.equal(map.game.gold, 10, 'Lỗi video dừng hậu quả phía sau');
    assert.match(map.game.lastError.message, /missing/);
    assert.equal(map.input.enabled, true);
    playFailure = Object.assign(new Error('Cần thao tác người dùng'), { name: 'NotAllowedError' });
    map.startEventList({ list: [c(261, ['intro']), c(125, [0, 0, 1])] }, 0);
    await flush();
    assert.equal(map.eventRunner.wait.token.done, false, 'Autoplay bị chặn giữ điều khiển phát cho người chơi');
    assert.equal(map.movieElement.controls, true);
    map.movieElement.emit('ended');
    map.updateEvent(0);
    assert.equal(map.game.gold, 11);
    playFailure = null;
    map.startEventList({ list: [c(261, ['intro']), c(125, [0, 0, 100])] }, 0);
    map.exit();
    map.updateEvent(0);
    assert.equal(map.game.gold, 11, 'Rời scene không giả vờ video đã phát xong');
    assert.equal(map.input.enabled, true);
    assert.equal(map.movieElement, null);
    assert.equal(document.body.children.length, 0);
    const paused = scene();
    playFailure = Object.assign(new Error('Người chơi tạm dừng khi còn đang tải'), { name: 'AbortError' });
    paused.startEventList({ list: [c(261, ['intro']), c(125, [0, 0, 1])] }, 0);
    await flush();
    assert.equal(paused.eventRunner.wait.token.done, false, 'Tạm dừng lúc tải không biến thành lỗi video');
    assert.equal(paused.movieElement.controls, true);
    playFailure = null;
    paused.movieElement.emit('ended');
    paused.updateEvent(0);
    assert.equal(paused.game.gold, 1, 'Người chơi vẫn có thể phát tiếp tới hết phim');
    const battle = new FNH.Scene_Battle();
    battle.commonEventContext = map;
    const request = map.openMovie('intro');
    battle.exit();
    assert.ok(request.token.error);
    assert.equal(map.movieElement, null, 'Thoát trận dọn video của common event');
    console.log('ĐẠT: video event, chờ kết thúc, autoplay, lỗi, tên trống và dọn tài nguyên khi rời scene.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
