'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./script-runtime'));
    else root.FNHStandaloneMovement = factory(root.FNHStandaloneScripts);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (scriptApi) {
    var DIRECTIONS = [2, 4, 6, 8];
    var DELTAS = { 2: [0, 1], 4: [-1, 0], 6: [1, 0], 8: [0, -1] };
    var RIGHT = { 2: 4, 4: 8, 8: 6, 6: 2 };
    var LEFT = { 2: 6, 6: 8, 8: 4, 4: 2 };
    var FIELDS = { 29: 'moveSpeed', 30: 'moveFrequency', 42: 'opacity', 43: 'blendMode' };
    var FLAGS = { 31: ['walkAnime', true], 32: ['walkAnime', false], 33: ['stepAnime', true],
        34: ['stepAnime', false], 35: ['directionFixed', true], 36: ['directionFixed', false],
        37: ['through', true], 38: ['through', false], 39: ['transparent', true], 40: ['transparent', false] };

    function validateRoute(route) {
        if (!route || !Array.isArray(route.list)) throw new TypeError('Movement route cần danh sách lệnh.');
        for (var command of route.list) {
            if (!command || !Number.isInteger(command.code) || command.code < 0 || command.code > 45) {
                throw new Error('Chưa hỗ trợ lệnh movement route ' + (command && command.code));
            }
            if (command.code === 0) break;
            var p = command.parameters || [];
            var required = command.code === 14 || command.code === 41 ? 2 :
                [15, 27, 28, 29, 30, 42, 43, 44, 45].includes(command.code) ? 1 : 0;
            if (p.length < required) throw new Error('Thiếu tham số movement route ' + command.code);
            if (command.code === 45) scriptApi.compileScript(p[0]);
        }
    }

    function MovementRuntime(environment) {
        this.environment = environment;
        this.jobs = new Map();
    }

    MovementRuntime.prototype.start = function (character, route, progress) {
        validateRoute(route);
        if (!character) return { done: Promise.resolve(), cancel: function () {} };
        this.cancel(character);
        var resolve, reject;
        var job = { character: character, route: route, index: progress ? progress.index : 0, delay: progress ? progress.delay : 0,
            done: new Promise(function (yes, no) { resolve = yes; reject = no; }) };
        job.resolve = resolve;
        job.reject = reject;
        this.jobs.set(character, job);
        job.cancel = function () { if (this.jobs.get(character) === job) this.cancel(character); }.bind(this);
        this.advanceJob(job, 0);
        return job;
    };

    MovementRuntime.prototype.snapshot = function () {
        return Array.from(this.jobs.values()).map(function (job) {
            return { characterId: job.character === this.environment.player ? -1 : job.character.id,
                route: job.route, index: job.index, delay: job.delay };
        }, this);
    };

    MovementRuntime.prototype.cancel = function (character) {
        var job = this.jobs.get(character);
        if (!job) return;
        this.jobs.delete(character);
        job.resolve();
    };

    MovementRuntime.prototype.clear = function () {
        Array.from(this.jobs.keys()).forEach(this.cancel.bind(this));
    };

    MovementRuntime.prototype.advance = function (frames) {
        if (!Number.isFinite(frames) || frames < 0) throw new RangeError('Số frame không hợp lệ.');
        Array.from(this.jobs.values()).forEach(function (job) { this.advanceJob(job, frames); }, this);
    };

    MovementRuntime.prototype.advanceJob = function (job, frames) {
        if (this.jobs.get(job.character) !== job) return;
        job.delay -= frames;
        try {
            // Chỉ chạy đến lệnh tạo thời gian chờ; không để route lặp khóa luồng UI.
            while (job.delay <= 0 && this.jobs.get(job.character) === job) {
                var command = job.route.list[job.index];
                if (!command || command.code === 0) {
                    if (job.route.repeat) { job.index = 0; job.delay = 1; return; }
                    this.cancel(job.character);
                    return;
                }
                var result = this.execute(job.character, command);
                if (this.environment.changed) this.environment.changed(job.character);
                if (result.moved !== false || job.route.skippable) job.index++;
                // Lệnh bị chặn được thử lại ở frame sau khi route không skippable.
                job.delay = result.frames || (result.moved === false && !job.route.skippable ? 1 : 0);
            }
        } catch (error) {
            this.jobs.delete(job.character);
            job.reject(error);
        }
    };

    MovementRuntime.prototype.toward = function (character, away) {
        var target = this.environment.player;
        var dx = target.x - character.x, dy = target.y - character.y;
        if (dx === 0 && dy === 0) return [];
        var first = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : (dy > 0 ? 2 : 8);
        var second = Math.abs(dx) > Math.abs(dy) ? (dy > 0 ? 2 : 8) : (dx > 0 ? 6 : 4);
        return away ? [10 - first, 10 - second] : [first, second];
    };

    MovementRuntime.prototype.execute = function (character, command) {
        var environment = this.environment, code = command.code, p = command.parameters || [];
        var direction = character.direction || 2;
        var speed = character.moveSpeed == null ? 4 : character.moveSpeed;
        var duration = Math.pow(2, 8 - speed);
        var directions;
        if (code >= 1 && code <= 4) directions = [DIRECTIONS[code - 1]];
        else if (code >= 5 && code <= 8) directions = [[4, 2], [6, 2], [4, 8], [6, 8]][code - 5];
        else if (code === 9) directions = [DIRECTIONS[Math.floor(environment.random() * 4)]];
        else if (code === 10 || code === 11) directions = this.toward(character, code === 11);
        else if (code === 12 || code === 13) directions = [code === 12 ? direction : 10 - direction];
        if (directions) {
            if (!directions.length) return { frames: duration };
            var diagonal = code >= 5 && code <= 8;
            var moved = environment.move(character, directions[0], diagonal ? directions[1] : null, code === 13);
            if (!moved && !diagonal && (code === 10 || code === 11)) moved = environment.move(character, directions[1]);
            if (moved) character.moveFrames = duration;
            return { moved: moved, frames: moved ? duration : 0 };
        }
        if (code === 14) {
            environment.locate(character, character.x + p[0], character.y + p[1]);
            if (!character.directionFixed && (p[0] || p[1])) {
                character.direction = Math.abs(p[0]) > Math.abs(p[1]) ? (p[0] > 0 ? 6 : 4) : (p[1] > 0 ? 2 : 8);
            }
            return { frames: Math.max(1, (10 + Math.round(Math.hypot(p[0], p[1])) - speed) * 2) };
        }
        if (code === 15) return { frames: Math.max(1, Number(p[0]) || 0) };
        if (code >= 16 && code <= 26) {
            if (!character.directionFixed) {
                if (code <= 19) direction = DIRECTIONS[code - 16];
                else if (code === 20) direction = RIGHT[direction];
                else if (code === 21) direction = LEFT[direction];
                else if (code === 22) direction = 10 - direction;
                else if (code === 23) direction = environment.random() < 0.5 ? RIGHT[direction] : LEFT[direction];
                else if (code === 24) direction = DIRECTIONS[Math.floor(environment.random() * 4)];
                else direction = this.toward(character, code === 26)[0] || direction;
                character.direction = direction;
            }
        } else if (code === 27 || code === 28) environment.state.setSwitch(p[0], code === 27);
        else if (FIELDS[code]) character[FIELDS[code]] = p[0];
        else if (FLAGS[code]) character[FLAGS[code][0]] = FLAGS[code][1];
        else if (code === 41) {
            character.characterName = p[0]; character.characterIndex = p[1]; character.tileId = 0;
        } else if (code === 44) environment.sound(p[0]);
        else if (code === 45) scriptApi.executeScript(p[0], { state: environment.state, character: character });
        return { frames: 0 };
    };

    return { MovementRuntime: MovementRuntime, validateRoute: validateRoute, DELTAS: DELTAS };
}));
