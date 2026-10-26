'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneAnimations = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function AnimationRuntime(engine) {
        this.engine = engine;
        this.entries = engine.state.animations || [];
        engine.state.animations = this.entries;
        this.waiters = new Map();
        this.revision = 0;
    }
    AnimationRuntime.prototype.start = function (targetId, animationId, mapId, mirror) {
        return this.enqueue({ targetId: targetId, animationId: animationId, mapId: mapId, mirror: !!mirror });
    };
    AnimationRuntime.prototype.startBattle = function (targetId, animationId, mirror, targetType) {
        return this.enqueue({ targetId: targetId, animationId: animationId, scope: 'battle',
            targetType: targetType || 'enemy', troopId: this.engine.battle.battle.troopId, mirror: !!mirror });
    };
    AnimationRuntime.prototype.enqueue = function (entry) {
        var data = this.engine.database.Animations[entry.animationId];
        if (!data) throw new Error('Không tìm thấy animation ' + entry.animationId);
        Object.assign(entry, { elapsed: -8, lastFrame: -1, flash: null, remaining: data.frames.length * 4 + 9 });
        this.entries.push(entry); this.revision++;
        var runtime = this;
        return new Promise(function (resolve) { runtime.waiters.set(entry, resolve); });
    };
    AnimationRuntime.prototype.finish = function (entry) {
        var index = this.entries.indexOf(entry);
        if (index >= 0) this.entries.splice(index, 1);
        var resolve = this.waiters.get(entry); this.waiters.delete(entry);
        if (resolve) resolve();
        this.revision++;
    };
    AnimationRuntime.prototype.advance = function (frames) {
        var runtime = this, engine = this.engine;
        this.entries.slice().forEach(function (entry) {
            if (entry.scope === 'battle') {
                var battle = engine.battle.battle;
                if (!battle || battle.result || engine.state.scene !== 'battle' || battle.troopId !== entry.troopId) {
                    runtime.finish(entry); return;
                }
            } else {
                if (entry.mapId !== engine.map.id) { runtime.finish(entry); return; }
                if (engine.state.scene === 'battle') return;
            }
            var data = engine.database.Animations[entry.animationId];
            entry.elapsed += frames; entry.remaining -= frames;
            if (entry.flash) entry.flash.remaining = Math.max(0, entry.flash.remaining - frames);
            var end = Math.max(-1, Math.min(data.frames.length - 1, Math.floor(entry.elapsed / 4)));
            for (var frame = entry.lastFrame + 1; frame <= end; frame++) {
                data.timings.filter(function (timing) { return timing.frame === frame; }).forEach(function (timing) {
                    if (timing.se && timing.se.name) {
                        if (!engine.onRouteEffect) throw new Error('Chưa có bộ phát âm thanh cho animation.');
                        Promise.resolve(engine.onRouteEffect(250, [timing.se])).catch(function (error) { engine.routeErrors.push(error); });
                    }
                    var duration = timing.flashDuration * 4;
                    var elapsed = Math.max(0, entry.elapsed - frame * 4);
                    if (timing.flashScope === 2) {
                        var color = timing.flashColor.slice();
                        color[3] *= Math.max(0, 1 - elapsed / Math.max(1, duration));
                        engine.screen.handleEffect(224, [color, Math.max(0, duration - elapsed), false]);
                    } else if (timing.flashScope === 1 || timing.flashScope === 3) {
                        entry.flash = { color: timing.flashColor.slice(), hide: timing.flashScope === 3,
                            duration: duration, remaining: Math.max(0, duration - elapsed) };
                    }
                });
            }
            entry.lastFrame = end;
            if (entry.remaining <= 0) runtime.finish(entry);
        });
    };
    AnimationRuntime.prototype.targetEffect = function (targetId, mapId, targetType) {
        var effect = null;
        this.entries.forEach(function (entry) {
            if (entry.targetId === targetId && (targetType ? entry.scope === 'battle' && entry.targetType === targetType :
                entry.scope !== 'battle' && entry.mapId === mapId) && entry.flash && entry.flash.remaining > 0) effect = entry.flash;
        });
        return effect;
    };
    AnimationRuntime.prototype.clearBattle = function () {
        this.entries.filter(function (entry) { return entry.scope === 'battle'; }).forEach(this.finish.bind(this));
    };
    AnimationRuntime.prototype.dispose = function () {
        this.entries.slice().forEach(this.finish.bind(this));
    };
    return { AnimationRuntime: AnimationRuntime };
}));
