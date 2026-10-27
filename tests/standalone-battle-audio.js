'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AudioManager } = require('../game/engine/audio-manager');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
class Audio extends EventTarget {
    constructor() { super(); this.currentTime = 0; this.paused = true; this.plays = 0; }
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
    pause() { this.paused = true; }
}
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    const e = new GameEngine({ dataStore: store, random: () => 0.5 });
    await e.boot({ mapId: 74, x: 8, y: 8, party: [1] });
    const audio = new AudioManager({ audioFactory: () => new Audio(), masterVolume: 0.05 });
    try {
        const db = e.database, id = db.Troops.length, calls = [];
        db.Troops.push({ id, members: [db.Troops[1].members[0]], pages: [] });
        const handlers = { effect: audio.handleEffect.bind(audio), battleAudio(phase, battle) {
            calls.push(phase);
            if (phase === 'start') audio.beginBattle(battle, e.state, db.System);
            else audio.endBattle(battle.result, db.System, e.state.scene === 'map');
        } };
        const bgm = { name: 'fear_and_hunger', volume: 80, pitch: 90, pan: -20 };
        const bgs = { name: 'wind', volume: 60, pitch: 110, pan: 35 };
        const command = (code, parameters = []) => ({ code, parameters, indent: 0 });
        const start = (canLose = true, signal) => e.createInterpreter([
            command(301, [0, id, true, canLose]), command(121, [6170, 6170, 0])
        ], 0, handlers, signal).run();
        const prepare = () => {
            e.state.setSwitch(6170, false); e.state.recoverActor(1);
            audio.play('bgm', bgm, 12); audio.play('bgs', bgs, 7);
        };
        prepare(); audio.handleEffect(243, []);
        const eventBgm = JSON.stringify(audio.savedBgm);
        let running = start(); await flush();
        assert.equal(audio.tracks.get(audio.buffers.bgm).sound.name, db.System.battleBgm.name);
        assert.equal(audio.buffers.bgs, null, 'dừng BGS bản đồ khi vào trận');
        assert.equal(audio.buffers.bgm.currentTime, 0); assert.ok(Math.abs(audio.buffers.bgm.volume - 0.045) < 0.000001);
        const saved = e.save(), current = audio.buffers.bgm;
        assert.equal(saved.battle.audio.mapBgm.position, 12); assert.equal(saved.battle.audio.mapBgs.position, 7);
        audio.beginBattle(e.battle.battle, e.state, db.System); assert.equal(audio.buffers.bgm, current, 'không phát lại mỗi frame');
        e.battle.finish('escape'); await running;
        assert.equal(e.state.switchValue(6170), true); assert.equal(audio.buffers.bgm.currentTime, 12);
        assert.equal(audio.buffers.bgs.currentTime, 7); assert.equal(audio.buffers.bgm.playbackRate, 0.9);
        assert.deepEqual(audio.tracks.get(audio.buffers.bgm).sound, bgm); assert.deepEqual(audio.tracks.get(audio.buffers.bgs).sound, bgs);
        assert.equal(JSON.stringify(audio.savedBgm), eventBgm, 'snapshot trận không ghi đè lệnh 243');
        assert.deepEqual(calls, ['start', 'end']);

        // Lệnh 132 thật có 1.092 lần xuất hiện và sáu tên nhạc, kể cả rỗng.
        const choices = new Map(); let count = 0;
        for (const file of fs.readdirSync(path.join(__dirname, '../game/data')).filter(file => file.endsWith('.json'))) {
            function scan(value) {
                if (Array.isArray(value)) value.forEach(scan);
                else if (value && typeof value === 'object') {
                    if (value.code === 132) { count++; choices.set(value.parameters[0].name, value.parameters[0]); }
                    Object.values(value).forEach(scan);
                }
            }
            scan(JSON.parse(fs.readFileSync(path.join(__dirname, '../game/data', file), 'utf8')));
        }
        assert.ok(count > 1000); assert.ok(choices.has(''));
        for (const sound of choices.values()) {
            if (sound.name) fs.accessSync(path.join(__dirname, '../game/audio/bgm', sound.name + '.ogg'));
            prepare(); await e.createInterpreter([command(132, [sound])], 0, handlers).run();
            running = start(); await flush();
            assert.equal(audio.buffers.bgm && audio.tracks.get(audio.buffers.bgm).sound.name, sound.name || null);
            e.battle.finish('escape'); await running; assert.equal(audio.buffers.bgm.currentTime, 12);
        }
        e.state.battleBgm = null;
        prepare(); e.state.battleBgm = { ...bgm, volume: 90 };
        running = start(); await flush(); assert.equal(audio.buffers.bgm.currentTime, 12, 'cùng BGM không chạy lại đầu bài khi vào trận');
        audio.buffers.bgm.currentTime = 20; e.battle.finish('escape'); await running;
        assert.equal(audio.buffers.bgm.currentTime, 20, 'cùng BGM tiếp tục khi rời trận');
        assert.equal(audio.tracks.get(audio.buffers.bgm).sound.volume, 80); e.state.battleBgm = null;
        prepare(); db.System.victoryMe = { name: 'win', volume: 80, pitch: 100 };
        running = start(); await flush(); e.battle.finish('victory'); await running;
        assert.equal(audio.buffers.bgm.paused, true, 'ME thắng tạm dừng nhạc map đã khôi phục');
        audio.buffers.me.dispatchEvent(new Event('ended')); assert.equal(audio.buffers.bgm.paused, false);
        assert.equal(audio.buffers.bgm.currentTime, 12); db.System.victoryMe = { name: '' };
        prepare(); running = start(); await flush(); e.battle.finish('defeat-continue'); await running;
        assert.equal(audio.buffers.bgm.currentTime, 12); assert.equal(audio.buffers.bgs.currentTime, 7);
        prepare(); running = start(false); await flush(); e.battle.finish('defeat'); await running;
        assert.equal(e.state.scene, 'gameover'); assert.equal(audio.buffers.bgm, null); assert.equal(audio.buffers.bgs, null);

        e.state.scene = 'map'; prepare();
        const controller = new AbortController(); running = start(true, controller.signal);
        const rejected = assert.rejects(running, /hủy âm thanh trận/); await flush();
        controller.abort(new Error('hủy âm thanh trận')); await rejected;
        assert.equal(audio.buffers.bgm.currentTime, 12); assert.equal(audio.battle, null);
        assert.equal(e.state.switchValue(6170), false);

        audio.stop('bgm'); audio.stop('bgs'); running = start(); await flush(); e.battle.finish('escape'); await running;
        assert.equal(audio.buffers.bgm, null); assert.equal(audio.buffers.bgs, null, 'không tự thêm nhạc map khi trước trận im lặng');

        // Tải trận từ save dùng snapshot map đã lưu, không nhớ nhầm nhạc trận.
        saved.battle.audio.bgm = { sound: db.System.battleBgm, position: 4 };
        await e.restore(saved); audio.beginBattle(e.battle.battle, e.state, db.System);
        assert.equal(audio.buffers.bgm.currentTime, 4); assert.equal(e.battle.battle.audio.mapBgm.position, 12);
        audio.endBattle('escape', db.System, true); assert.equal(audio.buffers.bgm.currentTime, 12);
        saved.battle.audio.bgm = null; await e.restore(saved); audio.beginBattle(e.battle.battle, e.state, db.System);
        assert.equal(audio.buffers.bgm, null, 'save giữa trận đã dừng BGM giữ im lặng');
        audio.endBattle('abort', db.System, false);
        assert.equal(audio.buffers.bgm, null); assert.equal(audio.buffers.bgs, null);
        console.log('ĐẠT: nhạc trận/lệnh 132 thật, BGM/BGS/vị trí/pitch/pan, thắng/thua/thoát/hủy, ME, save, im lặng và giữ lệnh 243.');
    } finally { audio.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
