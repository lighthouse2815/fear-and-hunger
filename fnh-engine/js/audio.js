'use strict';
/* ============================================================
   FNH Engine — Web Audio
   ============================================================ */
(function () {
    const FNH = window.FNH = window.FNH || {};

    FNH.AudioManager = class AudioManager {
        constructor(assets) {
            this.assets = assets;
            this.context = null;
            this.master = null;
            this.currentBgm = null;
            this.currentBgs = null;
            this.muted = false;
            this._bgmToken = 0;
            this._bgsToken = 0;
            this.unlocked = false;
        }

        get state() {
            return this.context ? this.context.state : 'locked';
        }

        async unlock() {
            if (!this.context) {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioContextClass) {
                    throw new Error('Trình duyệt không hỗ trợ Web Audio.');
                }
                this.context = new AudioContextClass();
                this.master = this.context.createGain();
                this.master.gain.value = this.muted ? 0 : 0.9;
                this.master.connect(this.context.destination);
            }
            if (this.context.state === 'suspended') {
                await this.context.resume();
            }
            this.unlocked = this.context.state === 'running';
            return this.context;
        }

        setMuted(value) {
            this.muted = !!value;
            if (this.master) {
                this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.context.currentTime, 0.02);
            }
        }

        toggleMute() {
            this.setMuted(!this.muted);
            return this.muted;
        }

        async playBgm(name, options) {
            if (!name) return null;
            const opts = options || {};
            if (!this.context) await this.unlock();
            if (this.currentBgm && this.currentBgm.name === name && this.currentBgm.playing) {
                return this.currentBgm;
            }

            const token = ++this._bgmToken;
            const buffer = await this.assets.decodeAudio('bgm/' + name, this.context);
            if (token !== this._bgmToken) return null;
            this.stopBgm(0.18);

            const source = this.context.createBufferSource();
            source.buffer = buffer;
            source.loop = opts.loop !== false;
            const gain = this.context.createGain();
            gain.gain.value = 0;
            source.connect(gain);
            gain.connect(this.master);
            source.start();
            const target = (opts.volume === undefined ? 0.7 : opts.volume) * 0.55;
            gain.gain.setTargetAtTime(target, this.context.currentTime, 0.08);

            const entry = {
                name: name,
                source: source,
                gain: gain,
                playing: true,
                duration: buffer.duration
            };
            source.onended = function () {
                entry.playing = false;
            };
            this.currentBgm = entry;
            return entry;
        }

        stopBgm(fadeSeconds) {
            this._bgmToken += 1;
            const entry = this.currentBgm;
            if (!entry) return;
            this.currentBgm = null;
            const fade = fadeSeconds === undefined ? 0.22 : fadeSeconds;
            try {
                entry.gain.gain.cancelScheduledValues(this.context.currentTime);
                entry.gain.gain.setValueAtTime(entry.gain.gain.value, this.context.currentTime);
                entry.gain.gain.linearRampToValueAtTime(0.0001, this.context.currentTime + fade);
                entry.source.stop(this.context.currentTime + fade + 0.02);
            } catch (error) {}
            entry.playing = false;
        }

        async playBgs(name, options) {
            if (!name) return null;
            const opts = options || {};
            if (!this.context) await this.unlock();
            if (this.currentBgs && this.currentBgs.name === name && this.currentBgs.playing) {
                return this.currentBgs;
            }
            const token = ++this._bgsToken;
            const buffer = await this.assets.decodeAudio('bgs/' + name, this.context);
            if (token !== this._bgsToken) return null;
            this.stopBgs(0.18);
            const source = this.context.createBufferSource();
            source.buffer = buffer;
            source.loop = opts.loop !== false;
            const gain = this.context.createGain();
            gain.gain.value = 0;
            source.connect(gain);
            gain.connect(this.master);
            source.start();
            const target = (opts.volume === undefined ? 0.42 : opts.volume) * 0.55;
            gain.gain.setTargetAtTime(target, this.context.currentTime, 0.15);
            const entry = {
                name: name,
                source: source,
                gain: gain,
                playing: true,
                duration: buffer.duration
            };
            source.onended = function () {
                entry.playing = false;
            };
            this.currentBgs = entry;
            return entry;
        }

        stopBgs(fadeSeconds) {
            this._bgsToken += 1;
            const entry = this.currentBgs;
            if (!entry) return;
            this.currentBgs = null;
            const fade = fadeSeconds === undefined ? 0.25 : fadeSeconds;
            try {
                entry.gain.gain.cancelScheduledValues(this.context.currentTime);
                entry.gain.gain.setValueAtTime(entry.gain.gain.value, this.context.currentTime);
                entry.gain.gain.linearRampToValueAtTime(0.0001, this.context.currentTime + fade);
                entry.source.stop(this.context.currentTime + fade + 0.02);
            } catch (error) {}
            entry.playing = false;
        }

        async playSe(name, options) {
            if (!name || !this.context) return;
            const opts = options || {};
            try {
                const buffer = await this.assets.decodeAudio('se/' + name, this.context);
                const source = this.context.createBufferSource();
                source.buffer = buffer;
                const gain = this.context.createGain();
                gain.gain.value = (opts.volume === undefined ? 0.7 : opts.volume) * 0.6;
                source.connect(gain);
                gain.connect(this.master);
                source.start();
            } catch (error) {
                console.warn('[FNH] Không phát được SE ' + name + ':', error.message);
            }
        }

        stopAll() {
            this.stopBgm(0.08);
            this.stopBgs(0.08);
        }
    };
})();
