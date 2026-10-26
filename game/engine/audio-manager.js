'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneAudio = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var CATEGORIES = ['bgm', 'bgs', 'me', 'se'];

    function AudioManager(options) {
        options = options || {};
        this.baseUrl = String(options.baseUrl || '.').replace(/\/+$/, '');
        this.audioFactory = options.audioFactory || (typeof Audio !== 'undefined' ? function () { return new Audio(); } : null);
        if (!this.audioFactory) throw new Error('AudioManager cần Audio hoặc audioFactory.');
        this.onError = options.onError || function (error) { console.error(error); };
        this.masterVolume = volumeValue(options.masterVolume == null ? 1 : options.masterVolume);
        this.volumes = { bgm: 1, bgs: 1, me: 1, se: 1 };
        this.buffers = { bgm: null, bgs: null, me: null };
        this.seBuffers = [];
        this.tracks = new Map();
        this.pending = new Set();
        this.savedBgm = null;
    }

    function volumeValue(value) {
        var number = Number(value);
        if (!Number.isFinite(number)) throw new TypeError('Âm lượng không hợp lệ: ' + value);
        return Math.max(0, Math.min(1, number));
    }

    AudioManager.prototype.url = function (category, name) {
        if (CATEGORIES.indexOf(category) < 0 || !name) return null;
        return this.baseUrl + '/audio/' + category + '/' + name.split('/').map(encodeURIComponent).join('/') + '.ogg';
    };

    AudioManager.prototype.updateVolume = function (audio) {
        var track = this.tracks.get(audio);
        if (track) audio.volume = this.masterVolume * this.volumes[track.category] * track.volume * track.fade;
    };

    AudioManager.prototype.requestPlay = function (audio) {
        var manager = this;
        if (!this.tracks.has(audio)) return;
        function failed(error) {
            if (!manager.tracks.has(audio)) return;
            if (error.name === 'NotAllowedError') manager.pending.add(audio);
            else if (error.name !== 'AbortError') manager.onError(error);
        }
        try {
            this.pending.delete(audio);
            var promise = audio.play();
            if (promise && promise.catch) promise.catch(failed);
        } catch (error) { failed(error); }
    };

    // App gọi trực tiếp trong pointerdown/keydown để giữ quyền phát của gesture.
    AudioManager.prototype.unlock = function () {
        var manager = this;
        Array.from(this.pending).forEach(function (audio) { manager.requestPlay(audio); });
    };

    AudioManager.prototype.play = function (category, sound, position) {
        if (CATEGORIES.indexOf(category) < 0) throw new RangeError('Nhóm âm thanh không hợp lệ: ' + category);
        if (!sound || !sound.name) { this.stop(category); return null; }
        var existing = this.buffers[category];
        var audio = existing && this.tracks.get(existing).sound.name === sound.name ? existing : this.audioFactory();
        if (audio !== existing && category !== 'se') this.stop(category);
        var track = this.tracks.get(audio);
        if (track && track.timer) clearInterval(track.timer);
        track = { category: category, sound: Object.assign({}, sound),
            volume: volumeValue(sound.volume == null ? 1 : sound.volume / 100), fade: 1, timer: null };
        this.tracks.set(audio, track);
        audio.loop = category === 'bgm' || category === 'bgs';
        audio.playbackRate = Math.max(0.01, Number(sound.pitch == null ? 100 : sound.pitch) / 100);
        audio.preservesPitch = false;
        this.updateVolume(audio);
        if (category !== 'se') this.buffers[category] = audio;
        else this.seBuffers.push(audio);
        var manager = this;
        if (audio !== existing) {
            audio.src = this.url(category, sound.name);
            audio.addEventListener('ended', function () {
                if (category === 'se') manager.release(audio);
                else if (category === 'me' && manager.buffers.me === audio) manager.stop('me');
            });
            audio.addEventListener('error', function () {
                if (manager.tracks.has(audio)) manager.onError(new Error('Không tải được âm thanh: ' + audio.src));
            });
        }
        if (position != null) audio.currentTime = Math.max(0, Number(position) || 0);
        if (category === 'me' && this.buffers.bgm) {
            this.pending.delete(this.buffers.bgm);
            this.buffers.bgm.pause();
        }
        if (category !== 'bgm' || !this.buffers.me) this.requestPlay(audio);
        return audio;
    };

    AudioManager.prototype.release = function (audio) {
        var track = this.tracks.get(audio);
        if (track && track.timer) clearInterval(track.timer);
        this.pending.delete(audio);
        this.tracks.delete(audio);
        audio.pause();
        var index = this.seBuffers.indexOf(audio);
        if (index >= 0) this.seBuffers.splice(index, 1);
    };

    AudioManager.prototype.stop = function (category) {
        if (category === 'se') {
            this.seBuffers.slice().forEach(this.release.bind(this));
            return;
        }
        var audio = this.buffers[category];
        if (audio) {
            this.buffers[category] = null;
            this.release(audio);
            if (category === 'me' && this.buffers.bgm) this.requestPlay(this.buffers.bgm);
        }
    };

    AudioManager.prototype.fadeOut = function (category, seconds) {
        var audio = this.buffers[category];
        if (!audio) return;
        var duration = Number(seconds) * 1000;
        if (!Number.isFinite(duration) || duration <= 0) { this.stop(category); return; }
        var track = this.tracks.get(audio), manager = this;
        if (track.timer) clearInterval(track.timer);
        var start = Date.now(), initial = track.fade;
        track.timer = setInterval(function () {
            track.fade = initial * Math.max(0, 1 - (Date.now() - start) / duration);
            manager.updateVolume(audio);
            if (track.fade === 0) manager.stop(category);
        }, 16);
    };

    AudioManager.prototype.setVolume = function (category, value) {
        if (category === 'master') this.masterVolume = volumeValue(value);
        else if (CATEGORIES.indexOf(category) >= 0) this.volumes[category] = volumeValue(value);
        else throw new RangeError('Nhóm âm thanh không hợp lệ: ' + category);
        this.tracks.forEach(function (track, audio) { this.updateVolume(audio); }, this);
    };

    AudioManager.prototype.handleEffect = function (code, parameters) {
        var category = { 241: 'bgm', 245: 'bgs', 249: 'me', 250: 'se' }[code];
        if (category) this.play(category, parameters[0]);
        else if (code === 242) this.fadeOut('bgm', parameters[0]);
        else if (code === 246) this.fadeOut('bgs', parameters[0]);
        else if (code === 243) {
            var audio = this.buffers.bgm;
            this.savedBgm = audio ? { sound: Object.assign({}, this.tracks.get(audio).sound), position: audio.currentTime } : null;
        } else if (code === 244) {
            if (this.savedBgm) this.play('bgm', this.savedBgm.sound, this.savedBgm.position);
            else this.stop('bgm');
        } else if (code === 251) this.stop('se');
        else return false;
        return true;
    };

    AudioManager.prototype.dispose = function () {
        // Dừng ME cuối cùng để không phát lại BGM trong lúc thu hồi tài nguyên.
        ['bgm', 'bgs', 'se', 'me'].forEach(this.stop.bind(this));
    };

    return { AudioManager: AudioManager };
}));
