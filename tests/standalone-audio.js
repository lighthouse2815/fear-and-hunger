'use strict';

const assert = require('node:assert/strict');
const { AudioManager } = require('../game/engine/audio-manager');

class FakeAudio extends EventTarget {
    constructor() {
        super();
        this.played = 0;
        this.paused = true;
        this.currentTime = 0;
        this.blocked = false;
    }
    play() {
        this.played += 1;
        if (this.blocked) return Promise.reject(new DOMException('Cần tương tác', 'NotAllowedError'));
        this.paused = false;
        return Promise.resolve();
    }
    pause() { this.paused = true; }
}

(async () => {
    const errors = [];
    const manager = new AudioManager({ baseUrl: './subpath', audioFactory: () => new FakeAudio(), onError: error => errors.push(error) });
    try {
        const bgm = manager.play('bgm', { name: 'nhạc nền', volume: 80, pitch: 70 });
        assert.equal(bgm.src, './subpath/audio/bgm/nh%E1%BA%A1c%20n%E1%BB%81n.ogg');
        assert.equal(bgm.loop, true);
        assert.equal(bgm.playbackRate, 0.7);
        assert.equal(bgm.volume, 0.8);
        bgm.currentTime = 12;
        manager.setVolume('master', 0.5);
        assert.equal(bgm.volume, 0.4, 'master phải giữ volume riêng của bản nhạc');
        assert.equal(manager.play('bgm', { name: 'nhạc nền', volume: 60 }), bgm);
        assert.equal(bgm.currentTime, 12, 'lặp yêu cầu cùng BGM không khởi động lại nhạc');
        assert.equal(bgm.volume, 0.3);
        const se = manager.play('se', { name: 'door', volume: 50 });
        manager.setVolume('se', 0.2);
        assert.equal(se.volume, 0.05, 'thay volume phải cập nhật cả SE đang phát');
        se.dispatchEvent(new Event('ended'));
        assert.equal(manager.seBuffers.length, 0);
        assert.equal(manager.tracks.has(se), false);

        manager.handleEffect(243, []);
        const me = manager.play('me', { name: 'victory', volume: 100 });
        assert.equal(bgm.paused, true, 'ME tạm dừng BGM');
        me.dispatchEvent(new Event('ended'));
        assert.equal(bgm.paused, false, 'hết ME tiếp tục BGM');
        assert.equal(bgm.currentTime, 12);
        manager.stop('bgm');
        manager.handleEffect(244, []);
        assert.equal(manager.buffers.bgm.currentTime, 12, 'replay khôi phục vị trí nhạc đã nhớ');

        manager.handleEffect(245, [{ name: 'wind', volume: 50 }]);
        assert.equal(manager.buffers.bgs.loop, true);
        manager.handleEffect(246, [0.02]);
        await new Promise(resolve => setTimeout(resolve, 60));
        assert.equal(manager.buffers.bgs, null);
        manager.handleEffect(250, [{ name: 'door', volume: 100 }]);
        manager.handleEffect(251, []);
        assert.equal(manager.seBuffers.length, 0);
        assert.equal(manager.handleEffect(999, []), false);
        manager.play('bgm', { name: '' });
        assert.equal(manager.buffers.bgm, null, 'tên nhạc rỗng phải dừng BGM');
        assert.throws(() => manager.setVolume('master', NaN), /Âm lượng không hợp lệ/);

        const blockedAudio = new FakeAudio();
        blockedAudio.blocked = true;
        const locked = new AudioManager({ audioFactory: () => blockedAudio, onError: error => errors.push(error) });
        locked.play('bgm', { name: 'title' });
        await Promise.resolve();
        assert.equal(locked.pending.size, 1);
        blockedAudio.blocked = false;
        locked.unlock();
        assert.equal(blockedAudio.paused, false, 'gesture phải phát lại yêu cầu bị autoplay chặn');
        assert.equal(locked.pending.size, 0);
        blockedAudio.dispatchEvent(new Event('error'));
        assert.match(errors[0].message, /Không tải được âm thanh/);
        locked.dispose();

        manager.fadeOut('bgm', 10);
        manager.dispose();
        assert.equal(manager.tracks.size, 0);
        assert.equal(manager.pending.size, 0);
        console.log('ĐẠT: audio độc lập xử lý volume, pitch, ME, fade, replay, autoplay và thu hồi tài nguyên.');
    } finally { manager.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
