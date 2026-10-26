'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneScreen = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function tone(values) {
        return { red: values[0] || 0, green: values[1] || 0, blue: values[2] || 0, gray: values[3] || 0 };
    }
    function ScreenRuntime(state) {
        this.state = state;
        this.screen = state.screen || { pictures: {}, brightness: 255, tone: tone([]), flash: { red: 0, green: 0, blue: 0, opacity: 0 },
            weather: { type: 'none', power: 0, time: 0 }, tweens: [], nextId: 1 };
        state.screen = this.screen;
        this.screen.gabQueue = this.screen.gabQueue || [];
        this.screen.gab = this.screen.gab || null;
        this.waiters = new Map();
        this.revision = 0;
    }
    ScreenRuntime.prototype.target = function (path) {
        return path.reduce(function (value, key) { return value && value[key]; }, this.screen);
    };
    ScreenRuntime.prototype.finish = function (track) {
        this.screen.tweens = this.screen.tweens.filter(function (entry) { return entry !== track; });
        var resolve = this.waiters.get(track.id);
        this.waiters.delete(track.id);
        if (resolve) resolve();
    };
    ScreenRuntime.prototype.tween = function (path, goal, frames) {
        var target = this.target(path), runtime = this;
        if (!target) return Promise.resolve();
        this.screen.tweens.slice().forEach(function (track) {
            if (JSON.stringify(path) === JSON.stringify(track.path) && Object.keys(goal).some(function (key) { return key in track.goal; })) runtime.finish(track);
        });
        if (!Number.isFinite(frames) || frames < 0) throw new RangeError('Thời lượng hiệu ứng không hợp lệ.');
        if (frames === 0) { Object.assign(target, goal); return Promise.resolve(); }
        var start = {};
        Object.keys(goal).forEach(function (key) { start[key] = target[key]; });
        var track = { id: this.screen.nextId++, path: path, start: start, goal: goal, frames: frames, elapsed: 0 };
        this.screen.tweens.push(track);
        return new Promise(function (resolve) { runtime.waiters.set(track.id, resolve); });
    };
    ScreenRuntime.prototype.advance = function (frames) {
        if (!Number.isFinite(frames) || frames < 0) throw new RangeError('Số frame không hợp lệ.');
        var runtime = this;
        this.screen.tweens.slice().forEach(function (track) {
            var target = runtime.target(track.path);
            if (!target) { runtime.finish(track); return; }
            track.elapsed = Math.min(track.frames, track.elapsed + frames);
            var ratio = track.elapsed / track.frames;
            Object.keys(track.goal).forEach(function (key) { target[key] = track.start[key] + (track.goal[key] - track.start[key]) * ratio; });
            if (track.elapsed >= track.frames) runtime.finish(track);
        });
        Object.values(this.screen.pictures).forEach(function (picture) { picture.angle += (picture.rotationSpeed || 0) * frames / 2; });
        this.screen.weather.time += frames;
        if (this.screen.shake) {
            this.screen.shake.remaining = Math.max(0, this.screen.shake.remaining - frames);
            this.screen.shake.phase += frames;
        }
        var remaining = frames;
        while (this.screen.gab && remaining > 0) {
            var gab = this.screen.gab;
            var elapsed = Math.min(remaining, gab.remaining);
            gab.remaining -= elapsed; remaining -= elapsed;
            gab.opacity = Math.min(255, gab.remaining * 16);
            if (gab.remaining <= 0) { this.screen.gab = this.screen.gabQueue.shift() || null; this.revision++; }
        }
    };
    ScreenRuntime.prototype.dispose = function () {
        Array.from(this.waiters.values()).forEach(function (resolve) { resolve(); });
        this.waiters.clear();
    };
    ScreenRuntime.prototype.active = function () {
        return !!this.screen.gab || this.screen.tweens.length > 0 || this.screen.weather.power > 0 ||
            (this.screen.shake && this.screen.shake.remaining > 0) ||
            Object.values(this.screen.pictures).some(function (picture) { return picture.rotationSpeed; });
    };
    ScreenRuntime.prototype.showGab = function (text) {
        if ((this.screen.gab && this.screen.gab.text === text) || this.screen.gabQueue.some(function (gab) { return gab.text === text; })) return;
        var gab = { text: text, remaining: 106 + Array.from(text).length * 4, opacity: 255 };
        if (this.screen.gab) this.screen.gabQueue.push(gab);
        else this.screen.gab = gab;
        this.revision++;
    };
    ScreenRuntime.prototype.clearGabs = function () {
        this.screen.gab = null; this.screen.gabQueue = []; this.revision++;
    };
    ScreenRuntime.prototype.position = function (type, value) { return type === 0 ? value : this.state.variableValue(value); };
    ScreenRuntime.prototype.handleEffect = function (code, p) {
        var screen = this.screen, promise, wait = false;
        var picture = screen.pictures[p[0]];
        if (code === 221 || code === 222) {
            promise = this.tween([], { brightness: code === 221 ? 0 : 255 }, 24); wait = true;
        } else if (code === 223) {
            promise = this.tween(['tone'], tone(p[0]), p[1]); wait = p[2];
        } else if (code === 224) {
            Object.assign(screen.flash, { red: p[0][0], green: p[0][1], blue: p[0][2], opacity: p[0][3] });
            promise = this.tween(['flash'], { opacity: 0 }, p[1]); wait = p[2];
        } else if (code === 225) {
            screen.shake = { power: p[0], speed: p[1], remaining: p[2], phase: 0 };
            promise = this.tween([], {}, p[2]); wait = p[3];
        } else if (code === 230) {
            promise = this.tween([], {}, p[0]); wait = true;
        } else if (code === 231) {
            if (!Number.isInteger(p[0]) || p[0] < 1) throw new RangeError('ID hình không hợp lệ.');
            this.screen.tweens.slice().forEach(function (track) {
                if (track.path[0] === 'pictures' && track.path[1] === p[0]) this.finish(track);
            }, this);
            screen.pictures[p[0]] = { name: String(p[1]).replace(/\\V\[(\d+)\]/gi, function (_, id) { return this.state.variableValue(Number(id)); }.bind(this)),
                origin: p[2], x: this.position(p[3], p[4]), y: this.position(p[3], p[5]),
                scaleX: p[6], scaleY: p[7], opacity: p[8], blendMode: p[9], angle: 0, rotationSpeed: 0, tone: tone([]) };
        } else if (code === 232) {
            if (picture) {
                picture.origin = p[2]; picture.blendMode = p[9];
                promise = this.tween(['pictures', p[0]], { x: this.position(p[3], p[4]), y: this.position(p[3], p[5]),
                    scaleX: p[6], scaleY: p[7], opacity: p[8] }, p[10]); wait = p[11];
            }
        } else if (code === 233) {
            if (picture) picture.rotationSpeed = p[1];
        } else if (code === 234) {
            if (picture) { promise = this.tween(['pictures', p[0], 'tone'], tone(p[1]), p[2]); wait = p[3]; }
        } else if (code === 235) {
            delete screen.pictures[p[0]];
            this.screen.tweens.slice().forEach(function (track) {
                if (track.path[0] === 'pictures' && track.path[1] === p[0]) this.finish(track);
            }, this);
        } else if (code === 236) {
            if (!['none', 'rain', 'storm', 'snow'].includes(p[0])) throw new Error('Thời tiết không hợp lệ: ' + p[0]);
            if (p[0] !== 'none') screen.weather.type = p[0];
            promise = this.tween(['weather'], { power: p[0] === 'none' ? 0 : p[1] }, p[2]); wait = p[3];
        } else if (code === 283) screen.battlebacks = p.slice(0, 2);
        else if (code === 284) screen.parallax = { name: p[0], loopX: p[1], loopY: p[2], speedX: p[3], speedY: p[4] };
        else return false;
        this.revision++;
        return wait && promise ? promise : true;
    };
    return { ScreenRuntime: ScreenRuntime };
}));
