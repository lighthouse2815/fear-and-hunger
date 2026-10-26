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

        const sourceElements = new WeakSet(), nodes = [];
        const context = {
            state: 'suspended', destination: {}, resumes: 0,
            createMediaElementSource(audio) {
                assert.equal(sourceElements.has(audio), false, 'mỗi element chỉ được tạo một MediaElementSource');
                sourceElements.add(audio);
                const node = { connections: [], connect(target) { this.connections.push(target); }, disconnect() { this.connections = []; } };
                nodes.push(node); return node;
            },
            createStereoPanner() {
                const node = { pan: { value: 0 }, connections: [], connect(target) { this.connections.push(target); }, disconnect() { this.connections = []; } };
                nodes.push(node); return node;
            },
            async resume() { this.state = 'running'; this.resumes++; },
            async close() { this.state = 'closed'; }
        };
        const stereoAudio = new FakeAudio();
        const stereo = new AudioManager({ audioFactory: () => stereoAudio, audioContext: context, masterVolume: 0.05 });
        stereo.unlock(); await Promise.resolve();
        assert.equal(context.resumes, 1, 'gesture mở cả AudioContext');
        stereo.play('bgm', { name: 'wind', pan: -100, volume: 80 });
        assert.equal(nodes[1].pan.value, -1);
        assert.ok(Math.abs(stereoAudio.volume - 0.04) < 0.000001, 'stereo giữ âm lượng nhỏ');
        assert.deepEqual(nodes[0].connections, [nodes[1]]);
        assert.deepEqual(nodes[1].connections, [context.destination]);
        stereo.play('bgm', { name: 'wind', pan: 300, volume: 80 });
        assert.equal(nodes[1].pan.value, 1, 'pan giới hạn trong -100..100');
        assert.equal(nodes.length, 2, 'đổi pan cùng nhạc dùng lại graph');
        stereo.stop('bgm');
        assert.equal(nodes[0].connections.length, 0);
        stereo.play('bgm', { name: 'wind', pan: 25 });
        assert.equal(nodes[1].pan.value, 0.25, 'phát lại element đã dừng không tạo source trùng');
        stereo.dispose(); await Promise.resolve();
        assert.equal(context.state, 'closed');
        assert.equal(nodes[1].connections.length, 0);

        manager.fadeOut('bgm', 10);
        manager.dispose();
        assert.equal(manager.tracks.size, 0);
        assert.equal(manager.pending.size, 0);
        console.log('ĐẠT: audio độc lập xử lý volume, stereo pan, pitch, ME, fade, replay, autoplay và thu hồi tài nguyên.');
    } finally { manager.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
