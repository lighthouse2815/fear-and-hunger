'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AudioManager } = require('../game/engine/audio-manager');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const { SaveStore } = require('../game/engine/save-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
class Audio extends EventTarget {
    constructor() { super(); this.currentTime = 0; this.paused = true; }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
}
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    const audio = new AudioManager({ audioFactory: () => new Audio(), masterVolume: 0.05 });
    const e = new GameEngine({ dataStore: store, audio });
    const entries = new Map(), saves = new SaveStore({ prefix: 'audio:', storage: {
        getItem: key => entries.get(key) || null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key)
    } });
    const bgm = { name: 'fear_and_hunger', volume: 80, pitch: 90, pan: -20 };
    const bgs = { name: 'eastern_wind', volume: 60, pitch: 110, pan: 35 };
    const alternate = { name: 'the_four_apostles', volume: 70, pitch: 100, pan: 10 };
    const c = (code, parameters = []) => ({ code, parameters, indent: 0 });
    const handlers = { effect: audio.handleEffect.bind(audio) };
    try {
        await e.boot({ mapId: 74, x: 8, y: 8, party: [1] });
        audio.play('bgm', bgm, 4); audio.handleEffect(243, []);
        audio.buffers.bgm.currentTime = 12; audio.play('bgs', bgs, 7);
        e.saveTo(saves, 1);
        const saved = saves.load(1);
        assert.deepEqual(saved.audio, { bgm: { sound: bgm, position: 12 }, bgs: { sound: bgs, position: 7 }, savedBgm: { sound: bgm, position: 4 } });
        audio.savedBgm.sound.volume = 1;
        assert.equal(saved.audio.savedBgm.sound.volume, 80, 'snapshot tách khỏi object đang phát');
        audio.play('bgm', alternate, 30); audio.stop('bgs');
        const me = audio.play('me', { name: 'game_over', volume: 100 });
        const se = audio.play('se', { name: 'fnh_choice2', volume: 100 });
        assert.equal(await e.loadFrom(saves, 1, handlers), true);
        assert.deepEqual(audio.snapshot('bgm'), saved.audio.bgm); assert.deepEqual(audio.snapshot('bgs'), saved.audio.bgs);
        assert.equal(audio.buffers.bgm.playbackRate, 0.9); assert.equal(audio.buffers.bgs.playbackRate, 1.1);
        assert.ok(Math.abs(audio.buffers.bgm.volume - 0.04) < 1e-8, 'tải không thay mức tổng riêng của người chơi');
        assert.equal(me.paused, true); assert.equal(se.paused, true); assert.equal(audio.buffers.me, null); assert.equal(audio.seBuffers.length, 0);
        audio.handleEffect(244, []); assert.equal(audio.buffers.bgm.currentTime, 4, '243/244 giữ qua save, tách vị trí nhạc đang phát');
        assert.equal(audio.tracks.get(audio.buffers.bgm).sound.volume, 80);

        // Không chạy autoplay của map đè nhạc đã lưu, kể cả save cùng tên nhạc.
        const mapData = await store.loadMap(74);
        mapData.autoplayBgm = true; mapData.bgm = alternate;
        audio.buffers.bgm.currentTime = 18; e.saveTo(saves, 2);
        audio.buffers.bgm.currentTime = 50;
        await e.loadFrom(saves, 2, handlers); assert.equal(audio.buffers.bgm.currentTime, 18);
        await e.loadMap(74); assert.equal(audio.tracks.get(audio.buffers.bgm).sound.name, alternate.name, 'chuyển map vẫn chạy autoplay');
        assert.equal(audio.buffers.bgm.currentTime, 0);
        audio.stop('bgm'); audio.stop('bgs'); e.saveTo(saves, 3);
        audio.play('bgm', alternate); audio.play('bgs', bgs);
        await e.loadFrom(saves, 3, handlers); assert.equal(audio.buffers.bgm, null); assert.equal(audio.buffers.bgs, null);

        const legacy = saves.load(1); delete legacy.audio;
        audio.savedBgm = saved.audio.savedBgm; await e.restore(legacy);
        assert.equal(audio.tracks.get(audio.buffers.bgm).sound.name, alternate.name, 'save cũ dùng autoplay map');
        assert.equal(audio.savedBgm, null, 'save cũ không giữ nhạc nhớ của phiên trước');
        mapData.autoplayBgm = false; mapData.autoplayBgs = false;
        audio.play('bgm', bgm); await e.restore(legacy); assert.equal(audio.buffers.bgm, null, 'save cũ map không autoplay dừng nhạc title');
        audio.play('bgm', bgm, 9); const previous = audio.buffers.bgm;
        const invalid = e.save(); invalid.x = -1;
        await assert.rejects(e.restore(invalid), /Vị trí/); assert.equal(audio.buffers.bgm, previous, 'tải thất bại giữ nguyên âm thanh');

        // Khôi phục âm thanh trước khi tiếp tục event; lệnh nhạc sau menu thắng snapshot.
        const menu = e.createInterpreter([c(351), c(241, [alternate]), c(121, [6173, 6173, 0])], 0, handlers).run();
        await flush(); assert.equal(e.state.scene, 'menu'); e.saveMenuTo(saves, 4); e.closeMenu(); await menu;
        audio.play('bgm', bgm, 90); e.state.setSwitch(6173, false);
        await e.loadFrom(saves, 4, handlers);
        assert.equal(audio.tracks.get(audio.buffers.bgm).sound.name, alternate.name);
        assert.equal(audio.buffers.bgm.currentTime, 0); assert.equal(e.state.switchValue(6173), true);

        audio.play('bgm', bgm, 12); audio.play('bgs', bgs, 7);
        e.battle.setup(1, true, true); e.state.scene = 'battle'; audio.beginBattle(e.battle.battle, e.state, e.database.System);
        audio.buffers.bgm.currentTime = 5; e.saveTo(saves, 5);
        audio.buffers.bgm.currentTime = 50; await e.loadFrom(saves, 5, handlers);
        assert.equal(audio.battle, e.battle.battle); assert.equal(audio.buffers.bgm.currentTime, 5);
        assert.equal(e.battle.battle.audio.mapBgm.position, 12); assert.equal(e.battle.battle.audio.mapBgs.position, 7);
        audio.endBattle('escape', e.database.System, true);
        assert.deepEqual(audio.snapshot('bgm'), { sound: bgm, position: 12 });
        assert.deepEqual(audio.snapshot('bgs'), { sound: bgs, position: 7 });
        console.log('ĐẠT: save BGM/BGS/vị trí/pitch/pan/243, im lặng/save cũ/lỗi, menu/common event và nhạc trận; không đổi âm lượng người chơi.');
    } finally { audio.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
