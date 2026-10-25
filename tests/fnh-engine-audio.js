'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FNH = { Scene: class {} };
for (const file of ['audio', 'scene_map']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../fnh-engine/js/' + file + '.js'), 'utf8'), { window: { FNH }, console });
}
const param = () => ({ value: 0, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {},
    setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } });
const sources = [];
const context = {
    currentTime: 0,
    createGain: () => ({ gain: param(), connect() {} }),
    createStereoPanner: () => ({ pan: param(), connect() {} }),
    createBufferSource() {
        const source = { playbackRate: { value: 1 }, connect() {}, start(...args) { this.started = args; },
            stop(time) { this.stopped = time === undefined ? true : time; } };
        sources.push(source);
        return source;
    }
};
async function main() {
    const pending = new Map();
    const audio = new FNH.AudioManager({ decodeAudio: (name) => {
        if (name.includes('broken')) return Promise.reject(new Error('Không đọc được ME'));
        if (name.includes('delayed')) return new Promise((resolve) => pending.set(name, resolve));
        return Promise.resolve({ duration: 100 });
    } });
    audio.context = context;
    audio.master = { gain: param() };
    let entry = await audio.playBgm('music', { volume: 0, pitch: 150, pan: -50, position: 10 });
    assert.equal(entry.gain.gain.value, 0);
    assert.equal(entry.source.playbackRate.value, 1.5);
    assert.equal(entry.pan.pan.value, -0.5);
    assert.equal(entry.source.started[1], 10);
    audio.setVolume('bgm', 40);
    assert.equal(audio.buses.bgm.gain.value, 0.4);
    assert.equal(audio.currentBgm, entry, 'Đổi âm lượng không khởi động lại nhạc');
    audio.setVolume('se', 0);
    assert.equal(audio.volumes.bgm, 40, 'Âm lượng SE không làm thay đổi BGM');
    audio.setVolume('master', 50);
    assert.equal(audio.master.gain.value, 0.45);
    audio.setMuted(true);
    audio.setVolume('master', 80);
    assert.equal(audio.master.gain.value, 0, 'Đổi âm lượng không bỏ trạng thái tắt tiếng');
    audio.setMuted(false);
    assert.equal(audio.master.gain.value, 0.72);
    audio.setVolume('master', 100);
    audio.setVolume('bgm', 100);
    audio.setVolume('se', 100);
    context.currentTime = 4;
    assert.equal(audio.saveBgm().position, 16);
    const same = await audio.playBgm('music', { volume: 0.8, pitch: 50, pan: 100 });
    assert.equal(same, entry, 'Đổi tham số không khởi động lại nhạc đang phát');
    assert.equal(entry.source.playbackRate.value, 0.5);
    context.currentTime = 6;
    assert.equal(audio.saveBgm().position, 17, 'Vị trí ghi nhận thay đổi pitch');
    const loading = audio.playBgm('delayed');
    audio.stopBgm(0);
    pending.get('bgm/delayed')({ duration: 100 });
    await loading;
    assert.equal(audio.currentBgm, null, 'Dừng trong khi decode không để nhạc phát lại');
    const first = audio.playBgs('delayed');
    await audio.playBgs('new', { pitch: 120, pan: 30 });
    pending.get('bgs/delayed')({ duration: 100 });
    await first;
    assert.equal(audio.currentBgs.name, 'new', 'BGS nạp chậm không ghi đè yêu cầu mới');
    await audio.playSe('sound', { volume: 0, pitch: 80, pan: -100 });
    assert.equal(audio.seSources.size, 1);
    const se = [...audio.seSources][0];
    assert.equal(se.playbackRate.value, 0.8);
    const delayedSe = audio.playSe('delayed');
    audio.stopSe();
    pending.get('se/delayed')({ duration: 2 });
    await delayedSe;
    assert.equal(audio.seSources.size, 0);
    assert.equal(se.stopped, true);
    entry = await audio.playBgm('music');
    audio.stopAll();
    assert.equal(audio.currentBgm, null);
    assert.equal(audio.currentBgs, null);
    const flush = () => new Promise(setImmediate);
    await audio.playBgm('background', { position: 10, pitch: 100 });
    context.currentTime += 3;
    const me = await audio.playMe('fanfare', { volume: 0, pitch: 120, pan: -30 });
    assert.equal(audio.currentBgm, null);
    assert.equal(audio.saveBgm().position, 13);
    assert.equal(me.gain.gain.value, 0);
    assert.equal(me.source.playbackRate.value, 1.2);
    context.currentTime += 9;
    assert.equal(audio.saveBgm().position, 13, 'ME không làm vị trí BGM bị tạm dừng tiến lên');
    me.source.onended();
    await flush();
    assert.equal(audio.currentBgm.name, 'background');
    assert.equal(audio.currentBgm.position, 13);
    const loadingMe = audio.playMe('delayed-me');
    audio.stopAll();
    pending.get('me/delayed-me')({ duration: 10 });
    await loadingMe;
    assert.equal(audio.currentMe, null);
    assert.equal(audio.currentBgm, null, 'Dừng tất cả trong lúc tải ME không làm nhạc phát lại');
    await audio.playBgm('background');
    const olderMe = audio.playMe('delayed-older');
    await audio.playMe('newer');
    pending.get('me/delayed-older')({ duration: 10 });
    await olderMe;
    assert.equal(audio.currentMe.name, 'newer');
    await audio.playBgm('replacement', { volume: 0.3, position: 7 });
    assert.equal(audio.currentBgm, null, 'BGM yêu cầu trong ME được hoãn phát');
    audio.stopMe();
    await flush();
    assert.equal(audio.currentBgm.name, 'replacement');
    assert.equal(audio.currentBgm.position, 7);
    const stoppedMe = await audio.playMe('fanfare');
    audio.stopBgm(0);
    stoppedMe.source.onended();
    await flush();
    assert.equal(audio.currentBgm, null, 'Dừng BGM trong ME không khôi phục bài đã dừng');
    await audio.playBgm('background');
    await assert.rejects(audio.playMe('broken'), /Không đọc được ME/);
    await flush();
    assert.equal(audio.currentBgm.name, 'background', 'Lỗi tải ME khôi phục BGM');
    audio.stopAll();
    let resolveBackground, firstBackground = true;
    const loadingAudio = new FNH.AudioManager({ decodeAudio: (name) => {
        if (name === 'bgm/loading' && firstBackground) {
            firstBackground = false;
            return new Promise((resolve) => { resolveBackground = resolve; });
        }
        return Promise.resolve({ duration: 100 });
    } });
    loadingAudio.context = context;
    loadingAudio.master = {};
    const startingBackground = loadingAudio.playBgm('loading', { position: 6 });
    const interruptingMe = await loadingAudio.playMe('fanfare');
    resolveBackground({ duration: 100 });
    await startingBackground;
    assert.equal(loadingAudio.currentBgm, null, 'BGM tải trước ME không tự phát đè ME');
    interruptingMe.source.onended();
    await flush();
    assert.equal(loadingAudio.currentBgm.name, 'loading');
    assert.equal(loadingAudio.currentBgm.position, 6, 'ME giữ cả BGM chưa tải xong');
    loadingAudio.stopAll();
    const calls = [];
    const scene = new FNH.Scene_Map();
    scene.game = { audio: {
        playBgm: (...args) => { calls.push(['bgm', ...args]); return Promise.resolve(); },
        playBgs: (...args) => { calls.push(['bgs', ...args]); return Promise.resolve(); },
        playSe: (...args) => { calls.push(['se', ...args]); return Promise.resolve(); },
        playMe: (...args) => { calls.push(['me', ...args]); return Promise.resolve(); },
        stopMe: () => calls.push(['stopMe']),
        stopBgm: (...args) => calls.push(['stopBgm', ...args]), stopBgs: (...args) => calls.push(['stopBgs', ...args]),
        stopSe: () => calls.push(['stopSe']), saveBgm: () => ({ name: 'saved', volume: 0.5, position: 7 })
    }, showToast() {} };
    const execute = (code, parameters = []) => scene.executeEventCommand({ code, parameters });
    execute(241, [{ name: 'music', volume: 0, pitch: 150, pan: -50 }]);
    assert.equal(calls[0][2].volume, 0);
    assert.equal(calls[0][2].pitch, 150);
    execute(243); execute(244);
    assert.equal(calls[1][1], 'saved');
    assert.equal(calls[1][2].position, 7);
    execute(242, [3]); execute(245, [{ name: '' }]); execute(246, [2]); execute(251);
    assert.equal(calls[2][1], 3);
    assert.equal(calls[3][0], 'stopBgs');
    assert.equal(calls[5][0], 'stopSe');
    execute(249, [{ name: 'fanfare', volume: 0, pitch: 120, pan: -30 }]);
    assert.equal(calls[6][0], 'me');
    assert.equal(calls[6][2].volume, 0);
    execute(249, [{ name: '' }]);
    assert.equal(calls[7][0], 'stopMe');
    console.log('ĐẠT: ME, tiếp tục đúng vị trí BGM, hoãn/đổi BGM và hủy tải âm thanh.');
    console.log('ĐẠT: audio event, volume 0, pitch/pan, vị trí lưu, fade và hủy decode đang chờ.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
