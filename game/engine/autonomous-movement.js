'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./movement-runtime'));
    else root.FNHStandaloneAutonomous = factory(root.FNHStandaloneMovement);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (movementApi) {
    var DIRECTIONS = [2, 4, 6, 8];
    function AutonomousMovement(engine) { this.engine = engine; }

    AutonomousMovement.prototype.advance = function (frames) {
        var runtime = this, engine = this.engine;
        if (engine.eventRunning || engine.messageRunning) return;
        engine.map.events.forEach(function (event) {
            var page = engine.map.eventPage(event);
            if (!page) return;
            if (!event.autonomous) {
                event.autonomous = { index: 0, delay: Math.max(0, 30 * (5 - (event.moveFrequency || 3))), lock: 0, chasing: false,
                    home: { x: event.x, y: event.y, direction: event.direction } };
            }
            var progress = event.autonomous;
            if (progress.failed || event.locked || engine.movement.jobs.has(event)) return;
            if (!progress.chasing && !progress.returning && (Math.abs(engine.map.deltaX(event.x, engine.state.x)) > engine.width / 96 + 12 ||
                Math.abs(engine.map.deltaY(event.y, engine.state.y)) > engine.height / 96 + 12)) return;
            try {
                if (!progress.validated) {
                    if (page.moveType === 3) movementApi.validateRoute(page.moveRoute);
                    progress.validated = true;
                }
                runtime.advanceEvent(event, page, progress, frames);
            }
            catch (error) { progress.failed = true; throw error; }
        });
    };

    AutonomousMovement.prototype.advanceEvent = function (event, page, progress, frames) {
        var engine = this.engine, player = engine.state;
        var dx = engine.map.deltaX(player.x, event.x), dy = engine.map.deltaY(player.y, event.y);
        var facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : (dy > 0 ? 2 : 8);
        progress.lock = Math.max(0, progress.lock - frames);
        if (event.chaseRange > 0 && Math.abs(dx) + Math.abs(dy) <= event.chaseRange &&
            (event.seePlayer === false || event.direction === facing)) progress.lock = 300;
        var chasing = event.chaseRange > 0 && progress.lock > 0;
        if (chasing && !progress.chasing) {
            progress.returning = false;
            if (event.alertSound) engine.movement.environment.sound({ name: event.alertSound, volume: 100, pitch: 100, pan: 0 });
            engine.showBalloon(event, 1);
        } else if (!chasing && progress.chasing) {
            progress.returning = true; progress.returnDelay = 180;
        }
        progress.chasing = chasing;
        progress.delay = Math.max(0, progress.delay - frames);
        if (progress.delay > 0) return;
        if (chasing) return this.moveTo(event, progress, player);
        if (progress.returning) {
            progress.returnDelay = Math.max(0, progress.returnDelay - frames);
            if (progress.returnDelay > 0) return;
            if (event.x !== progress.home.x || event.y !== progress.home.y) return this.moveTo(event, progress, progress.home);
            if (!event.directionFixed) event.direction = progress.home.direction;
            progress.returning = false;
        }
        var frequencyDelay = Math.max(0, 30 * (5 - event.moveFrequency));
        if (page.moveType === 1 || page.moveType === 2) {
            var code = page.moveType === 1 || Math.abs(dx) + Math.abs(dy) >= 20 ? 9 : 10;
            var result = engine.movement.execute(event, { code: code });
            engine.movement.environment.changed(event);
            progress.delay = Math.max(1, result.frames || 0) + frequencyDelay;
        } else if (page.moveType === 3 && !progress.done) {
            var route = page.moveRoute;
            // Các lệnh tức thời dùng chung bộ route; vòng lặp luôn nhường frame.
            while (progress.delay === 0) {
                var command = route.list[progress.index];
                if (!command || command.code === 0) {
                    if (route.repeat) { progress.index = 0; progress.delay = 1 + frequencyDelay; }
                    else progress.done = true;
                    return;
                }
                var outcome = engine.movement.execute(event, command);
                engine.movement.environment.changed(event);
                if (outcome.moved !== false || route.skippable) progress.index++;
                progress.delay = outcome.frames || (outcome.moved === false && !route.skippable ? 1 : 0);
                if (progress.delay > 0) progress.delay += frequencyDelay;
            }
        }
    };

    AutonomousMovement.prototype.moveTo = function (event, progress, target) {
        var engine = this.engine;
        var direction = engine.map.findDirection(event, target);
        if (!direction) { progress.delay = 1; return; }
        var result = engine.movement.execute(event, { code: DIRECTIONS.indexOf(direction) + 1 });
        engine.movement.environment.changed(event);
        progress.delay = Math.max(1, result.frames || 0);
    };
    return { AutonomousMovement: AutonomousMovement };
}));
