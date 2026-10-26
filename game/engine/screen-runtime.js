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
        this.screen.fogs = this.screen.fogs || [];
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
        var track = { id: this.screen.nextId++, path: path, start: start, goal: goal, frames: frames, elapsed: 0,
            scene: this.state.scene === 'battle' ? 'battle' : 'map' };
        this.screen.tweens.push(track);
        return new Promise(function (resolve) { runtime.waiters.set(track.id, resolve); });
    };
    ScreenRuntime.prototype.advance = function (frames, scene) {
        if (!Number.isFinite(frames) || frames < 0) throw new RangeError('Số frame không hợp lệ.');
        var runtime = this;
        this.screen.tweens.slice().forEach(function (track) {
            if (scene && (track.scene || 'map') !== scene) return;
            var target = runtime.target(track.path);
            if (!target) { runtime.finish(track); return; }
            track.elapsed = Math.min(track.frames, track.elapsed + frames);
            var ratio = track.elapsed / track.frames;
            Object.keys(track.goal).forEach(function (key) { target[key] = track.start[key] + (track.goal[key] - track.start[key]) * ratio; });
            if (track.elapsed >= track.frames) runtime.finish(track);
        });
        Object.values(this.screen.pictures).forEach(function (picture) { picture.angle += (picture.rotationSpeed || 0) * frames / 2; });
        this.screen.weather.time += frames;
        this.screen.fogs.forEach(function (fog) { fog.x += fog.moveX * frames / 4; fog.y += fog.moveY * frames / 4; });
        var parallax = this.screen.parallax;
        if ((!scene || scene === 'map') && parallax) {
            if (parallax.loopX) parallax.x = (parallax.x || 0) + parallax.speedX * frames / 4;
            if (parallax.loopY) parallax.y = (parallax.y || 0) + parallax.speedY * frames / 4;
        }
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
            this.screen.fogs.some(function (fog) { return fog.moveX || fog.moveY; }) ||
            (this.screen.parallax && ((this.screen.parallax.loopX && this.screen.parallax.speedX) || (this.screen.parallax.loopY && this.screen.parallax.speedY))) ||
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
    ScreenRuntime.prototype.setupParallax = function (map) {
        this.screen.parallax = { name: map.parallaxName || '', loopX: !!map.parallaxLoopX, loopY: !!map.parallaxLoopY,
            speedX: map.parallaxSx || 0, speedY: map.parallaxSy || 0, x: 0, y: 0 };
        this.revision++;
    };
    ScreenRuntime.prototype.setupFogs = function (note) {
        var fogs = [], expression = /<fog effect>([\s\S]*?)<\/fog effect>/ig, block;
        while ((block = expression.exec(note || ''))) {
            var fields = {};
            block[1].split(/\r?\n/).forEach(function (line) {
                var match = /^\s*([\w ]+):\s*(.*?)\s*$/.exec(line);
                if (match) fields[match[1].trim().toLowerCase()] = match[2];
            });
            var id = Number(fields.id), name = /^(['"])(.+)\1$/.exec(fields.name || '');
            if (!Number.isInteger(id) || id < 1 || !name) throw new Error('Cấu hình fog thiếu ID hoặc tên ảnh.');
            var number = function (key, fallback) {
                var value = fields[key] == null ? fallback : Number(fields[key].replace(/%$/, ''));
                if (!Number.isFinite(value)) throw new Error('Tham số fog không hợp lệ: ' + key);
                return value;
            };
            var fog = { id: id, name: name[2], opacity: number('opacity', 192), zoom: number('zoom', 100) / 100,
                hue: number('hue', 0), blend: number('blend', 0), depth: number('depth', 1),
                moveX: number('move x', 0), moveY: number('move y', 0),
                panX: Math.max(1, (10 + number('pan x', 0)) / 10), panY: Math.max(1, (10 + number('pan y', 0)) / 10), x: 0, y: 0 };
            if (fog.zoom <= 0 || fog.depth < 0 || fog.depth > 7 || !Number.isInteger(fog.depth)) throw new Error('Zoom/depth fog không hợp lệ.');
            fogs = fogs.filter(function (entry) { return entry.id !== id; }); fogs.push(fog);
        }
        this.screen.fogs = fogs.sort(function (a, b) { return a.id - b.id; });
        this.revision++;
    };
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
        else if (code === 284) screen.parallax = { name: p[0], loopX: p[1], loopY: p[2], speedX: p[3], speedY: p[4],
            x: p[1] && screen.parallax && screen.parallax.x || 0, y: p[2] && screen.parallax && screen.parallax.y || 0 };
        else return false;
        this.revision++;
        return wait && promise ? promise : true;
    };
    return { ScreenRuntime: ScreenRuntime };
}));
