'use strict';

// Facade gameplay độc lập, kết nối data store, state, map và event interpreter.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./data-store'), require('./game-state'),
            require('./map-model'), require('./event-interpreter'), require('./script-runtime'), require('./movement-runtime'), require('./screen-runtime'), require('./autonomous-movement'), require('./lighting-runtime'), require('./filter-runtime'), require('./animation-runtime'), require('./battle-runtime')
        );
    } else {
        root.FNHStandaloneEngine = factory(
            root.FNHStandaloneData, root.FNHStandaloneState,
            root.FNHStandaloneMap, root.FNHStandaloneEvents, root.FNHStandaloneScripts, root.FNHStandaloneMovement, root.FNHStandaloneScreen, root.FNHStandaloneAutonomous, root.FNHStandaloneLighting, root.FNHStandaloneFilters, root.FNHStandaloneAnimations, root.FNHStandaloneBattle
        );
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (dataApi, stateApi, mapApi, eventApi, scriptApi, movementApi, screenApi, autonomousApi, lightingApi, filterApi, animationApi, battleApi) {
    function GameEngine(options) {
        options = options || {};
        this.dataStore = options.dataStore || new dataApi.GameDataStore({ baseUrl: options.baseUrl || '' });
        this.random = options.random || Math.random;
        this.database = null;
        this.state = null;
        this.map = null;
        this.eventRunning = false;
        this.messageRunning = false;
        this.stepRunning = false;
        this.movement = null;
        this.routeErrors = [];
        this.onRouteEffect = options.onRouteEffect || null;
        this.screen = null;
        this.buttons = new Set();
        this.width = options.width || 816;
        this.height = options.height || 624;
        this.autonomousEnabled = options.autonomousMovement === true;
        this.pendingTouchEvents = [];
    }

    GameEngine.prototype.boot = async function (initialState) {
        this.database = await this.dataStore.loadDatabase();
        var system = this.database.System;
        var state = initialState || {
            mapId: system.startMapId,
            x: system.startX,
            y: system.startY,
            direction: 2,
            party: (system.partyMembers || []).slice()
        };
        this.state = new stateApi.GameState(state, this.database);
        this.screen = new screenApi.ScreenRuntime(this.state);
        this.lighting = new lightingApi.LightingRuntime(this.state);
        this.filters = new filterApi.FilterRuntime(this.state);
        this.animations = new animationApi.AnimationRuntime(this);
        this.battle = new battleApi.BattleRuntime(this.state, this.database, this.random);
        this.state.party.slice().forEach(function (actorId) {
            if (!this.state.actor(actorId) && this.database.Actors[actorId]) this.state.addActor(actorId);
        }, this);
        await this.loadMap(this.state.mapId);
        return this;
    };

    GameEngine.prototype.prepareMap = async function (mapId, state) {
        var data = await this.dataStore.loadMap(mapId);
        var tilesetId = state.mapTileset && state.mapTileset.mapId === mapId ? state.mapTileset.tilesetId : data.tilesetId;
        return new mapApi.GameMap(Object.assign({}, data, { id: mapId }), this.database.Tilesets[tilesetId], state);
    };

    GameEngine.prototype.loadMap = async function (mapId, destination) {
        if (!this.database || !this.state) throw new Error('Engine chưa boot.');
        var map = await this.prepareMap(mapId, this.state);
        if (destination && (!map.isValid(destination.x, destination.y) ||
            (destination.direction && !mapApi.DIRECTION_BITS[destination.direction]))) {
            throw new Error('Đích chuyển bản đồ không hợp lệ.');
        }
        if (this.map && this.map.id !== mapId) {
            this.map.discardTemporaryLocations();
            this.state.eventSnapshots = {};
        }
        if (this.movement) this.movement.clear();
        if (this.animations) this.animations.dispose();
        if (this.battle) this.battle = new battleApi.BattleRuntime(this.state, this.database, this.random);
        this.state.mapId = mapId;
        this.map = map;
        delete this.screen.screen.battlebacks;
        this.lighting.sources(map);
        this.pendingTouchEvents = [];
        this.state.routeSnapshots = [];
        this.resetMovement();
        if (destination) {
            this.state.x = destination.x;
            this.state.y = destination.y;
            if (destination.direction && !this.state.directionFixed) this.state.direction = destination.direction;
        }
        this.resetCamera();
        return this.map;
    };

    GameEngine.prototype.resetCamera = function () {
        var screen = this.screen;
        screen.screen.tweens.slice().forEach(function (track) {
            if (track.path[0] === 'mapCamera') screen.finish(track);
        });
        delete screen.screen.mapCamera;
        screen.revision++;
    };

    GameEngine.prototype.scrollMap = async function (parameters, interpreter) {
        var direction = parameters[0], distance = parameters[1], speed = parameters[2];
        if (!mapApi.DIRECTION_BITS[direction] || !Number.isFinite(distance) || distance < 0 ||
            !Number.isInteger(speed) || speed < 1 || speed > 6) throw new Error('Tham số cuộn bản đồ không hợp lệ.');
        var map = this.map, screen = this.screen, track;
        // Hai lệnh cuộn liên tiếp phải chạy lần lượt, kể cả khi không bật cờ chờ.
        while ((track = screen.screen.tweens.find(function (entry) { return entry.path[0] === 'mapCamera'; }))) {
            await screen.tween([], {}, track.frames - track.elapsed);
            if (this.map !== map) return true;
            if (interpreter.signal && interpreter.signal.aborted) throw interpreter.signal.reason;
        }
        var viewport = map.viewport(this.state, this.width, this.height);
        var camera = screen.screen.mapCamera = { mapId: map.id, x: viewport.startX, y: viewport.startY };
        var dx = direction === 4 ? -distance : direction === 6 ? distance : 0;
        var dy = direction === 8 ? -distance : direction === 2 ? distance : 0;
        var goal = { x: Math.max(0, Math.min(Math.max(0, map.width - Math.ceil(this.width / 48)), camera.x + dx)),
            y: Math.max(0, Math.min(Math.max(0, map.height - Math.ceil(this.height / 48)), camera.y + dy)) };
        var frames = (Math.abs(goal.x - camera.x) + Math.abs(goal.y - camera.y)) * 256 / Math.pow(2, speed);
        var done = screen.tween(['mapCamera'], goal, frames);
        screen.revision++;
        return parameters[3] ? done : true;
    };

    GameEngine.prototype.followCamera = function (dx, dy) {
        var camera = this.screen.screen.mapCamera;
        if (!camera || camera.mapId !== this.map.id) return;
        var x = this.state.x - camera.x, y = this.state.y - camera.y;
        var centerX = Math.floor(Math.ceil(this.width / 48) / 2), centerY = Math.floor(Math.ceil(this.height / 48) / 2);
        var shiftX = (dx > 0 && x > centerX) || (dx < 0 && x < centerX) ? dx : 0;
        var shiftY = (dy > 0 && y > centerY) || (dy < 0 && y < centerY) ? dy : 0;
        var nextX = Math.max(0, Math.min(Math.max(0, this.map.width - Math.ceil(this.width / 48)), camera.x + shiftX));
        var nextY = Math.max(0, Math.min(Math.max(0, this.map.height - Math.ceil(this.height / 48)), camera.y + shiftY));
        shiftX = nextX - camera.x; shiftY = nextY - camera.y;
        camera.x = nextX; camera.y = nextY;
        this.screen.screen.tweens.forEach(function (track) {
            if (track.path[0] !== 'mapCamera') return;
            track.start.x += shiftX; track.goal.x += shiftX;
            track.start.y += shiftY; track.goal.y += shiftY;
        });
    };

    GameEngine.prototype.move = function (direction) {
        if (!this.map || !this.state) throw new Error('Engine chưa boot.');
        if (this.state.scene !== 'map') return false;
        if (this.eventRunning || this.messageRunning || (this.movement && this.movement.jobs.has(this.state))) return false;
        var moved = this.moveCharacter(this.state, direction);
        if (moved) this.state.moveFrames = this.playerStepFrames();
        return moved;
    };

    GameEngine.prototype.canDash = function () {
        if (!this.state.dashEnabled || this.map.data.disableDashing || this.state.vehicleId !== -1) return false;
        var state = this.state, database = this.database, actor = state.party.length ? state.actor(state.party[0]) : null;
        if (!actor) return true;
        var sources = [database.Actors[actor.id], database.Classes[actor.classId]];
        actor.equips.forEach(function (id, slot) { sources.push((slot === 0 ? database.Weapons : database.Armors)[id]); });
        actor.states.forEach(function (id) { sources.push(database.States[id]); });
        return !sources.some(function (source) { return source && /<disable dash(?:ing)?>/i.test(source.note || ''); });
    };

    GameEngine.prototype.playerStepFrames = function () {
        var speed = this.state.moveSpeed == null ? 4 : this.state.moveSpeed;
        if ((this.state.alwaysDash || this.buttons.has('shift')) && this.canDash()) speed++;
        return Math.pow(2, 8 - speed);
    };

    GameEngine.prototype.resetMovement = function (progress) {
        var engine = this;
        this.movement = new movementApi.MovementRuntime({
            player: this.state, state: this.state, random: function () { return engine.random(); },
            move: this.moveCharacter.bind(this),
            locate: function (character, x, y) { character.x = x; character.y = y; },
            changed: function (character) {
                if (character !== engine.state) engine.map.locateEvent(character.id, character.x, character.y, character.direction);
            },
            sound: function (sound) {
                if (!engine.onRouteEffect) throw new Error('Chưa có bộ phát âm thanh cho movement route.');
                Promise.resolve(engine.onRouteEffect(250, [sound])).catch(function (error) { engine.routeErrors.push(error); });
            }
        });
        (progress || []).forEach(function (entry) {
            var character = entry.characterId === -1 ? engine.state : engine.map.eventById(entry.characterId);
            var job = engine.movement.start(character, entry.route, entry);
            job.done.catch(function (error) { engine.routeErrors.push(error); });
        });
        this.autonomous = new autonomousApi.AutonomousMovement(this);
    };

    GameEngine.prototype.advanceRoutes = function (frames) {
        if (this.state && ['gameover', 'title', 'menu', 'save'].includes(this.state.scene)) return;
        if (this.state && this.state.scene === 'battle') {
            if (this.routeErrors.length) throw this.routeErrors.shift();
            this.screen.advance(frames, 'battle');
            this.filters.advance(frames);
            this.animations.advance(frames);
            return;
        }
        if (this.routeErrors.length) throw this.routeErrors.shift();
        if (this.state && this.state.timer.active) this.state.timer.frames = Math.max(0, this.state.timer.frames - frames);
        if (this.map && this.state) [this.state].concat(this.map.events).forEach(function (character) {
            if (character.stepAnime || (character.moveFrames > 0 && character.walkAnime !== false)) {
                character.animationFrames = (character.animationFrames || 0) + frames;
            } else character.animationFrames = 0;
            character.moveFrames = Math.max(0, (character.moveFrames || 0) - frames);
            if (character.balloon) character.balloon.remaining = Math.max(0, character.balloon.remaining - frames);
        });
        if (this.movement) this.movement.advance(frames);
        if (this.autonomous && this.autonomousEnabled) this.autonomous.advance(frames);
        if (this.screen) this.screen.advance(frames);
        if (this.lighting) this.lighting.advance(frames);
        if (this.filters) this.filters.advance(frames);
        if (this.animations) this.animations.advance(frames);
    };

    GameEngine.prototype.moveCharacter = function (character, direction, vertical, backward) {
        var delta = movementApi.DELTAS[direction];
        if (!delta) return false;
        if (!character.directionFixed && !backward) character.direction = vertical || direction;
        var x = character.x + delta[0], y = character.y + delta[1];
        if (vertical) y += movementApi.DELTAS[vertical][1];
        if (!this.map.isValid(x, y)) return false;
        if (!character.through) {
            var passable = vertical ?
                (this.map.isPassable(character.x, character.y, direction) && this.map.isPassable(x, character.y, vertical)) ||
                (this.map.isPassable(character.x, character.y, vertical) && this.map.isPassable(character.x, y, direction)) :
                this.map.isPassable(character.x, character.y, direction);
            if (!passable || this.map.eventBlocks(x, y, character.id)) return false;
            if (character !== this.state && character.priorityType === 1 && this.state.x === x && this.state.y === y) {
                var page = this.map.eventPage(character);
                if (!this.eventRunning && page && page.trigger === 2 && !this.pendingTouchEvents.some(function (entry) { return entry.event === character; })) {
                    this.pendingTouchEvents.push({ map: this.map, event: character, page: page });
                }
                return false;
            }
        }
        var dx = x - character.x, dy = y - character.y;
        character.x = x; character.y = y;
        if (character === this.state) this.followCamera(dx, dy);
        return true;
    };

    GameEngine.prototype.step = async function (direction, handlers) {
        if (!this.map || !this.state) throw new Error('Engine chưa boot.');
        if (this.state.scene !== 'map') return false;
        if (this.eventRunning || this.messageRunning || this.stepRunning || !mapApi.DIRECTION_BITS[direction]) return false;
        this.stepRunning = true;
        try {
            var sourceMap = this.map;
            var moved = this.move(direction);
            var x = this.state.x + (!moved ? direction === 4 ? -1 : direction === 6 ? 1 : 0 : 0);
            var y = this.state.y + (!moved ? direction === 8 ? -1 : direction === 2 ? 1 : 0 : 0);
            var candidates = sourceMap.eventAt(x, y);
            for (var i = 0; i < candidates.length; i++) {
                if (this.map !== sourceMap) break;
                var page = sourceMap.eventPage(candidates[i]);
                if (page && (page.trigger === 1 || page.trigger === 2) && moved === (page.priorityType !== 1)) {
                    await this.runEvent(candidates[i].id, handlers);
                }
            }
            return moved;
        } finally { this.stepRunning = false; }
    };

    GameEngine.prototype.interact = async function (handlers) {
        if (!this.map || !this.state) throw new Error('Engine chưa boot.');
        if (this.state.scene !== 'map') return null;
        if (this.eventRunning || this.messageRunning || this.stepRunning) return null;
        var direction = this.state.direction;
        var x = this.state.x + (direction === 4 ? -1 : direction === 6 ? 1 : 0);
        var y = this.state.y + (direction === 8 ? -1 : direction === 2 ? 1 : 0);
        var candidates = this.map.eventAt(this.state.x, this.state.y).map(function (event) {
            return { event: event, sameTile: true };
        }).concat(this.map.eventAt(x, y).map(function (event) {
            return { event: event, sameTile: false };
        }));
        for (var i = 0; i < candidates.length; i += 1) {
            var candidate = candidates[i];
            var page = this.map.eventPage(candidate.event);
            if (page && page.trigger === 0 && candidate.sameTile === (page.priorityType !== 1)) {
                return this.runEvent(candidate.event.id, handlers);
            }
        }
        return null;
    };

    GameEngine.prototype.interpreterFor = function (eventId, handlers, signal) {
        if (!this.map || !this.state) throw new Error('Engine chưa boot.');
        var event = this.map.eventById(eventId);
        if (!event) throw new Error('Không tìm thấy event ' + eventId + ' trên map ' + this.state.mapId);
        var page = this.map.eventPage(event, this.state);
        if (!page) return null;
        return this.createInterpreter(page.list, event.id, handlers, signal);
    };

    GameEngine.prototype.commonInterpreterFor = function (commonId, handlers, signal) {
        var common = this.database.CommonEvents[commonId];
        if (!common) throw new Error('Không tìm thấy common event ' + commonId);
        return this.createInterpreter(common.list, 0, handlers, signal);
    };

    GameEngine.prototype.characterFor = function (id, interpreter) {
        if (id < 0) return this.state;
        if (this.map.id !== interpreter.mapId) return null;
        return this.map.eventById(id === 0 ? interpreter.eventId : id);
    };

    GameEngine.prototype.createInterpreter = function (commands, eventId, handlers, signal) {
        var engine = this;
        var eventHandlers = Object.assign({}, handlers || {});
        eventHandlers.gab = function (text) {
            if (text == null) engine.screen.clearGabs();
            else engine.screen.showGab(text);
        };
        eventHandlers.menu = function (_, interpreter) { return engine.waitForMenu(interpreter.signal, interpreter); };
        var gameData = eventHandlers.gameData;
        eventHandlers.gameData = function (type, id, field, interpreter) {
            if (type === 4 && field >= 0 && field <= 9) {
                var enemy = engine.battle.enemy(id);
                return !enemy ? 0 : field === 0 ? enemy.hp : field === 1 ? enemy.mp : engine.battle.enemyParam(enemy, field - 2);
            }
            if (type === 5 && field >= 0 && field <= 4) {
                var character = engine.characterFor(id, interpreter);
                if (!character) return 0;
                if (field === 0) return character.x;
                if (field === 1) return character.y;
                if (field === 2) return character.direction;
                var viewport = engine.map.viewport(engine.state, engine.width, engine.height);
                if (field === 3) return Math.round((character.x - viewport.startX + 0.5) * 48);
                var actor = character === engine.state && engine.state.actor(engine.state.party[0] || 1);
                var name = character.characterName == null && actor ? actor.characterName : character.characterName;
                var prefix = /^[!$]+/.exec(name || '');
                return Math.round((character.y - viewport.startY + 1) * 48) - (prefix && prefix[0].includes('!') ? 0 : 6);
            }
            if (gameData) return gameData(type, id, field, interpreter);
            throw new Error('Chưa hỗ trợ dữ liệu sự kiện: ' + [type, id, field].join(','));
        };
        var condition = eventHandlers.condition;
        eventHandlers.condition = function (parameters, interpreter) {
            if (parameters[0] === 5) {
                var enemy = engine.battle.enemy(parameters[1]);
                return !!enemy && (parameters[2] === 0 ? enemy.alive && !enemy.hidden : enemy.states.includes(parameters[3]));
            }
            if (parameters[0] === 11) return engine.buttons.has(parameters[1]);
            if (parameters[0] === 6) {
                var character = engine.characterFor(parameters[1], interpreter);
                return !!character && character.direction === parameters[2];
            }
            if (parameters[0] === 13) return engine.state.vehicleId === parameters[1];
            if (condition) return condition(parameters, interpreter);
            throw new Error('Chưa hỗ trợ điều kiện sự kiện: ' + JSON.stringify(parameters));
        };
        eventHandlers.script = function (source, interpreter) {
            return scriptApi.executeScript(source, { state: engine.state,
                character: engine.characterFor(0, interpreter),
                refresh: function () { delete engine.state.characterName; delete engine.state.characterIndex; } });
        };
        var transfer = eventHandlers.transfer;
        eventHandlers.transfer = async function (destination, interpreter) {
            await engine.loadMap(destination.mapId, destination);
            if (transfer) return transfer(destination, interpreter);
        };
        var effect = eventHandlers.effect;
        eventHandlers.effect = function (code, parameters, command, interpreter) {
            if (code === 356 && engine.lighting.handleCommand(parameters[0], engine.map)) return true;
            if (code === 356 && engine.filters.handleCommand(parameters[0])) return true;
            if (code === 339) return engine.forceBattleAction(parameters, handlers, interpreter.signal);
            if (code === 337) {
                var battle = engine.battle.battle;
                if (!battle || battle.result) throw new Error('Trận chiến không hoạt động.');
                if (!engine.database.Animations[parameters[1]]) throw new Error('Không tìm thấy animation ' + parameters[1]);
                battle.enemies.forEach(function (enemy) {
                    if (enemy.alive && !enemy.hidden && (parameters[2] || parameters[0] < 0 || enemy.index === parameters[0])) {
                        engine.animations.startBattle(enemy.index, parameters[1]);
                    }
                });
                return true;
            }
            if (engine.battle.handleEffect(code, parameters)) return true;
            if (code === 203) { engine.setEventLocation(parameters, interpreter); return true; }
            if (code === 205) return engine.applyRoute(parameters, interpreter);
            if (code === 211) { engine.state.transparent = parameters[0] === 0; return true; }
            if (code === 204) return engine.scrollMap(parameters, interpreter);
            if (code === 301) return engine.startBattle(parameters, interpreter, handlers);
            if (code === 216) { engine.state.followersVisible = parameters[0] !== 0; return true; }
            if (code === 217) { engine.state.followersGathering = true; return true; }
            if (code === 212) {
                var animated = engine.characterFor(parameters[0], interpreter);
                if (!animated) return true;
                var animation = engine.animations.start(animated === engine.state ? -1 : animated.id, parameters[1], engine.map.id);
                return parameters[2] ? animation : true;
            }
            if (code === 213) {
                var target = engine.characterFor(parameters[0], interpreter);
                if (!target) return true;
                engine.showBalloon(target, parameters[1]);
                return parameters[2] ? engine.screen.tween([], {}, 76) : true;
            }
            if (code === 214) {
                var erased = engine.map.id === interpreter.mapId && engine.map.eventById(interpreter.eventId);
                if (erased) erased.erased = true;
                return true;
            }
            if (code === 282) {
                var tileset = engine.database.Tilesets[parameters[0]];
                if (!tileset) throw new Error('Không tìm thấy tileset ' + parameters[0]);
                engine.map.tileset = tileset;
                engine.state.mapTileset = { mapId: engine.map.id, tilesetId: parameters[0] };
                return true;
            }
            var screenResult = engine.screen.handleEffect(code, parameters);
            if (screenResult !== false) return screenResult;
            return effect ? effect(code, parameters, command, interpreter) : false;
        };
        return new eventApi.EventInterpreter({
            commands: commands, state: this.state, mapId: this.state.mapId,
            eventId: eventId, handlers: eventHandlers, commonEvents: this.database.CommonEvents, random: this.random, signal: signal
        });
    };

    GameEngine.prototype.completeBattleSkill = async function (report, handlers, signal) {
        var skill = this.database.Skills[report.skillId], engine = this;
        var animationId = skill.animationId;
        if (animationId < 0) {
            var actor = report.subject === 'actor' && this.state.actor(report.subjectId);
            var weapon = actor && this.database.Weapons[actor.equips[0]];
            animationId = weapon && weapon.animationId || 1;
        }
        var activeAnimations = [], waiter = this.createInterpreter([], 0, handlers, signal);
        try {
            if (animationId > 0) await waiter.awaitCommand(Promise.all(report.targets.map(function (target) {
                var waiting = engine.animations.startBattle(target.id, animationId, report.subject === 'enemy', target.type);
                activeAnimations.push(engine.animations.entries[engine.animations.entries.length - 1]);
                return waiting;
            })));
            for (var index = 0; index < report.commonEvents.length; index++) {
                if (signal && signal.aborted) throw signal.reason;
                if (this.state.scene !== 'battle' || this.battle.battle.result) return;
                await this.createInterpreter([{ code: 117, parameters: [report.commonEvents[index]] }], 0, handlers, signal).run();
                this.syncBattleActors();
            }
        } finally {
            activeAnimations.forEach(function (entry) { engine.animations.finish(entry); });
        }
    };

    GameEngine.prototype.forceBattleAction = async function (parameters, handlers, signal) {
        var runtime = this.battle, battle = runtime.battle;
        if (!battle || battle.result || this.state.scene !== 'battle') throw new Error('Trận chiến không hoạt động.');
        if (!this.database.Skills[parameters[2]]) throw new Error('Không tìm thấy skill ' + parameters[2]);
        if ((this.forcedActionDepth || 0) >= 16) throw new Error('Hành động cưỡng chế lặp quá sâu.');
        var subjects = parameters[0] === 0 ? battle.enemies.filter(function (enemy) {
            return parameters[1] < 0 || enemy.index === parameters[1];
        }) : battle.actors.filter(function (actor) { return parameters[1] === 0 || actor.id === parameters[1]; });
        var phase = battle.phase, running = runtime.eventRunning;
        battle.phase = 'action'; runtime.eventRunning = true;
        this.forcedActionDepth = (this.forcedActionDepth || 0) + 1;
        try {
            for (var index = 0; index < subjects.length; index++) {
                if (signal && signal.aborted) throw signal.reason;
                var subject = subjects[index];
                if (!subject.alive || subject.hidden || battle.result || this.state.scene !== 'battle') continue;
                var key = subject.enemyId != null ? 'enemy:' + subject.index : 'actor:' + subject.id;
                var forced = battle.forcedThisTurn || (battle.forcedThisTurn = []);
                if (!forced.includes(key)) forced.push(key);
                var report = runtime.useSkill(subject, parameters[2], parameters[3], true);
                await this.completeBattleSkill(report, handlers, signal);
            }
            return true;
        } finally {
            this.forcedActionDepth--; runtime.eventRunning = running;
            if (!battle.result) battle.phase = phase;
        }
    };

    GameEngine.prototype.runBattlePages = async function (turnEnding, handlers, signal) {
        var runtime = this.battle, battle = runtime.battle;
        battle.phase = 'events';
        var remaining = 1000, entry;
        while (!battle.result && (entry = runtime.nextEventPage(turnEnding))) {
            if (--remaining < 0) throw new Error('Sự kiện troop lặp vô hạn (troop ' + battle.troopId + ').');
            runtime.markEventPage(entry);
            runtime.eventRunning = true;
            try { await this.createInterpreter(entry.page.list, 0, handlers, signal).run(); }
            finally { runtime.eventRunning = false; }
            this.syncBattleActors();
            if (this.state.scene !== 'battle') { runtime.finish('abort'); return; }
            if (runtime.pendingResult) {
                var ending = runtime.pendingResult; runtime.pendingResult = null;
                runtime.finish(ending); return;
            }
            runtime.checkResult();
        }
        if (!battle.result) runtime.checkResult();
    };

    GameEngine.prototype.syncBattleActors = function () {
        var state = this.state;
        this.battle.battle.actors = state.party.map(function (id) {
            var actor = state.actor(id);
            return { id: id, name: actor.name, hp: actor.hp, mp: actor.mp, alive: actor.hp > 0 };
        });
    };

    GameEngine.prototype.openMenu = function () {
        if (!this.state || this.state.scene !== 'map' || !this.state.menuEnabled || this.eventRunning || this.messageRunning || this.stepRunning) return false;
        this.state.scene = 'menu'; this.buttons.clear();
        return true;
    };
    GameEngine.prototype.waitForMenu = function (signal, interpreter) {
        var engine = this;
        if (!this.menuWaiters) this.menuWaiters = new Set();
        this.menuInterpreter = interpreter;
        return new Promise(function (resolve, reject) {
            function cleanup() {
                engine.menuWaiters.delete(done);
                if (engine.menuInterpreter === interpreter) engine.menuInterpreter = null;
                if (signal) signal.removeEventListener('abort', abort);
            }
            function done() { cleanup(); resolve(); }
            function abort() { cleanup(); engine.closeMenu(); reject(signal.reason); }
            if (signal && signal.aborted) { abort(); return; }
            engine.menuWaiters.add(done);
            if (signal) signal.addEventListener('abort', abort, { once: true });
        });
    };
    GameEngine.prototype.closeMenu = function () {
        if (!this.state || !['menu', 'save'].includes(this.state.scene)) return false;
        this.state.scene = 'map'; this.buttons.clear();
        if (this.menuWaiters) this.menuWaiters.forEach(function (done) { done(); });
        return true;
    };
    GameEngine.prototype.saveMenuTo = function (saveStore, slot) {
        if (!['menu', 'save'].includes(this.state.scene) || !this.state.saveEnabled) throw new Error('Chưa thể lưu lúc này.');
        var snapshot = this.save(); snapshot.scene = 'map';
        snapshot.pendingEventStack = [];
        for (var interpreter = this.menuInterpreter; interpreter; interpreter = interpreter.parent) {
            snapshot.pendingEventStack.push(interpreter.snapshot());
        }
        return saveStore.save(slot, snapshot);
    };
    GameEngine.prototype.equipMenuActor = function (actorId, slot, itemId) {
        if (this.state.scene !== 'menu' || !this.state.party.includes(actorId)) return false;
        var traits = this.battle.battlerTraits({ id: actorId });
        if (traits.some(function (trait) { return [53, 54].includes(trait.code) && trait.dataId === slot + 1; })) return false;
        var item = (slot === 0 ? this.database.Weapons : this.database.Armors)[itemId];
        if (itemId && (!item || !traits.some(function (trait) {
            return trait.code === (slot === 0 ? 51 : 52) && trait.dataId === (slot === 0 ? item.wtypeId : item.atypeId);
        }))) return false;
        return this.state.equipActor(actorId, slot, itemId);
    };
    GameEngine.prototype.canUseMenuItem = function (itemId, actorId) {
        var item = this.database.Items[itemId], actor = actorId && this.state.actor(actorId);
        return this.state.scene === 'menu' && !this.eventRunning && !this.messageRunning && !!item &&
            [0, 2].includes(item.occasion) && [0, 7, 11].includes(item.scope) && this.state.itemCount('items', itemId) > 0 &&
            (item.scope === 0 || !!actor && this.state.party.includes(actorId) && actor.hp > 0);
    };
    GameEngine.prototype.useMenuItem = async function (itemId, actorId, handlers) {
        if (!this.canUseMenuItem(itemId, actorId)) throw new Error('Chưa thể dùng vật phẩm này.');
        var item = this.database.Items[itemId], target = { id: actorId }, engine = this;
        var effects = item.effects || [];
        effects.forEach(function (effect) {
            if (![21, 22, 43, 44].includes(effect.code)) throw new Error('Hiệu ứng vật phẩm chưa hỗ trợ: ' + effect.code);
            if ([21, 22].includes(effect.code) && !engine.database.States[effect.dataId]) throw new Error('Không tìm thấy state ' + effect.dataId);
            if (effect.code === 43 && !engine.database.Skills[effect.dataId]) throw new Error('Không tìm thấy skill ' + effect.dataId);
            if (effect.code === 44 && !engine.database.CommonEvents[effect.dataId]) throw new Error('Không tìm thấy common event ' + effect.dataId);
        });
        var damage = item.damage.type > 0 && item.scope !== 0 ? this.battle.damageValue(target, target, item) : null;
        if (item.consumable) this.state.gainItem('items', itemId, -1);
        if (item.scope !== 0) {
            if (damage) {
                if (damage.resource === 'hp') this.state.changeActorHp(actorId, -damage.damage, true);
                else this.state.changeActorMp(actorId, -damage.damage);
            }
            effects.forEach(function (effect) {
                if (effect.code === 21) {
                    var immune = engine.battle.battlerTraits(target).some(function (trait) { return trait.code === 14 && trait.dataId === effect.dataId; });
                    if (!immune && engine.random() < effect.value1) engine.state.changeActorState(actorId, effect.dataId, true);
                }
                if (effect.code === 22 && engine.random() < effect.value1) engine.state.changeActorState(actorId, effect.dataId, false);
                if (effect.code === 43) engine.state.changeActorSkill(actorId, effect.dataId, true);
            });
        }
        this.closeMenu(); this.eventRunning = true;
        try {
            for (var index = 0; index < effects.length; index++) {
                if (effects[index].code === 44) await this.createInterpreter([{ code: 117, parameters: [effects[index].dataId] }], 0, handlers).run();
                if (this.state.scene === 'gameover' || this.state.scene === 'title') break;
            }
        } finally { this.eventRunning = false; }
        return true;
    };

    GameEngine.prototype.runEnemyTurn = async function (handlers, signal) {
        var runtime = this.battle, battle = runtime.battle;
        var actions = runtime.enemyActions();
        for (var index = 0; index < actions.length && !battle.result; index++) {
            var action = actions[index], enemy = runtime.enemy(action.enemy), skill = this.database.Skills[action.skillId];
            if (this.state.scene !== 'battle') return;
            if ((battle.forcedThisTurn || []).includes('enemy:' + enemy.index) || !runtime.canUseSkill(enemy, skill)) continue;
            battle.phase = 'action';
            var report = runtime.useSkill(enemy, action.skillId, -1);
            await this.completeBattleSkill(report, handlers, signal);
            await this.runBattlePages(false, handlers, signal);
        }
        if (!battle.result) {
            runtime.endTurn();
            await this.runBattlePages(true, handlers, signal);
        }
    };

    GameEngine.prototype.battleAttack = function (actorId, enemyIndex, handlers) {
        return this.battleSkill(actorId, 1, enemyIndex, handlers);
    };

    GameEngine.prototype.battleSkill = async function (actorId, skillId, targetIndex, handlers) {
        var runtime = this.battle, battle = runtime.battle, context = this.battleContext || {};
        if (this.state.scene !== 'battle' || !battle || battle.result || battle.phase !== 'input') throw new Error('Chưa đến lượt nhân vật.');
        var subject = runtime.actor(actorId), skill = this.database.Skills[skillId];
        if (!subject || !subject.alive || !skill) throw new Error('Mục tiêu chiến đấu không hợp lệ.');
        if (![1, 2].includes(skillId) && !runtime.actorSkills(actorId).some(function (entry) { return entry.id === skillId; })) throw new Error('Nhân vật chưa học kỹ năng này.');
        if (!runtime.canUseSkill(subject, skill)) throw new Error('Chưa thể dùng kỹ năng ' + skill.name);
        var chosen = skill.scope === 1 ? runtime.enemy(targetIndex) : skill.scope === 7 ? battle.actors[targetIndex] : null;
        if ([1, 7].includes(skill.scope) && (!chosen || !chosen.alive || chosen.hidden)) throw new Error('Mục tiêu chiến đấu không hợp lệ.');
        battle.managed = true;
        battle.turn++;
        battle.forcedThisTurn = [];
        try {
            await this.runBattlePages(false, handlers || context.handlers, context.signal);
            if (battle.result) return;
            var result;
            subject = runtime.actor(actorId);
            if (subject && runtime.canUseSkill(subject, skill) && !(battle.forcedThisTurn || []).includes('actor:' + actorId)) {
                result = runtime.useSkill(subject, skillId, targetIndex);
                battle.phase = 'action';
                await this.completeBattleSkill(result, handlers || context.handlers, context.signal);
                await this.runBattlePages(false, handlers || context.handlers, context.signal);
            }
            if (!battle.result) {
                battle.phase = 'enemy';
                await this.runEnemyTurn(handlers || context.handlers, context.signal);
            }
            return result;
        } catch (error) { battle.error = error.message; runtime.finish('abort'); throw error; }
        finally {
            if (!battle.result) battle.phase = 'input';
            else if (!this.battleContext) this.leaveBattle(battle.result);
        }
    };

    GameEngine.prototype.battleEscape = async function (handlers) {
        var runtime = this.battle, battle = runtime.battle, context = this.battleContext || {};
        if (this.state.scene !== 'battle' || !battle || battle.result || battle.phase !== 'input' || !battle.canEscape) return false;
        battle.managed = true;
        if (runtime.escape()) {
            if (!this.battleContext) this.leaveBattle(battle.result);
            return true;
        }
        battle.turn++;
        battle.forcedThisTurn = [];
        try {
            await this.runBattlePages(false, handlers || context.handlers, context.signal);
            if (!battle.result) {
                battle.phase = 'enemy';
                await this.runEnemyTurn(handlers || context.handlers, context.signal);
            }
            return false;
        } catch (error) { battle.error = error.message; runtime.finish('abort'); throw error; }
        finally {
            if (!battle.result) battle.phase = 'input';
            else if (!this.battleContext) this.leaveBattle(battle.result);
        }
    };

    GameEngine.prototype.leaveBattle = function (result, interpreter) {
        this.animations.clearBattle();
        if (this.state.scene === 'battle') this.state.scene = result === 'defeat' ? 'gameover' : 'map';
        if (result === 'defeat' && interpreter) interpreter.index = interpreter.commands.length;
        return result === 'victory' ? 0 : result === 'escape' ? 1 : 2;
    };

    GameEngine.prototype.startBattle = async function (parameters, interpreter, handlers) {
        var troopId;
        if (parameters[0] === 0) troopId = parameters[1];
        else if (parameters[0] === 1) troopId = this.state.variableValue(parameters[1]);
        else if (parameters[0] === 2) {
            var region = this.map.regionId(this.state.x, this.state.y);
            var encounters = (this.map.data.encounterList || []).filter(function (entry) {
                return entry.weight > 0 && (!entry.regionSet.length || entry.regionSet.includes(region));
            });
            var total = encounters.reduce(function (sum, entry) { return sum + entry.weight; }, 0);
            if (!total) throw new Error('Bản đồ không có troop phù hợp cho cuộc chạm trán.');
            var selected = this.random() * total;
            troopId = encounters.find(function (entry) { selected -= entry.weight; return selected < 0; }).troopId;
        } else throw new Error('Kiểu chọn troop không hợp lệ.');
        this.animations.clearBattle();
        this.battle.setup(troopId, parameters[2] === true, parameters[3] === true);
        var runtime = this.battle;
        runtime.battle.managed = true;
        var context = this.battleContext = { handlers: handlers, signal: interpreter && interpreter.signal };
        this.state.scene = 'battle';
        try {
            await this.runBattlePages(false, handlers, context.signal);
            if (!runtime.battle.result) runtime.battle.phase = 'input';
            var result = await runtime.wait(context.signal);
            if (runtime.battle.error) throw new Error(runtime.battle.error);
            return this.leaveBattle(result, interpreter);
        } catch (error) { runtime.finish('abort'); throw error; }
        finally {
            if (this.battleContext === context) this.battleContext = null;
            if (this.state.scene === 'battle') this.state.scene = 'map';
        }
    };

    GameEngine.prototype.runEvent = async function (eventId, handlers, signal) {
        if (this.eventRunning) throw new Error('Một sự kiện khác đang chạy.');
        var interpreter = this.interpreterFor(eventId, handlers, signal);
        if (!interpreter) return null;
        this.eventRunning = true;
        var event = this.map.eventById(eventId);
        event.locked = true;
        try {
            return await interpreter.run();
        } finally { this.eventRunning = false; event.locked = false; }
    };

    GameEngine.prototype.showBalloon = function (character, id) {
        if (!Number.isInteger(id) || id < 1 || id > 15) throw new RangeError('ID balloon không hợp lệ.');
        character.balloon = { id: id, remaining: 76 };
        this.screen.revision++;
    };

    GameEngine.prototype.setEventLocation = function (parameters, interpreter) {
        var id = parameters[0] === 0 ? interpreter.eventId : parameters[0];
        if (id >= 0 && this.map.id !== interpreter.mapId) return;
        var character = this.characterFor(parameters[0], interpreter);
        if (!character) return;
        var engine = this;
        function locate(targetId, x, y, direction) {
            if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('Tọa độ nhân vật không hợp lệ.');
            if (targetId < 0) {
                engine.state.x = x; engine.state.y = y;
                if (direction && !engine.state.directionFixed) engine.state.direction = direction;
                engine.resetCamera();
            } else engine.map.locateEvent(targetId, x, y, direction);
        }
        var x = parameters[2], y = parameters[3];
        if (parameters[1] === 1) { x = this.state.variableValue(x); y = this.state.variableValue(y); }
        else if (parameters[1] === 2) {
            var otherId = parameters[2] === 0 ? interpreter.eventId : parameters[2];
            var other = otherId < 0 ? this.state : this.map.eventById(otherId);
            if (!other) return;
            x = other.x; y = other.y;
            locate(otherId, character.x, character.y, 0);
        } else if (parameters[1] !== 0) throw new Error('Cách đặt vị trí sự kiện chưa hỗ trợ.');
        locate(id, x, y, parameters[4]);
    };

    GameEngine.prototype.applyRoute = function (parameters, interpreter) {
        var character = this.characterFor(parameters[0], interpreter);
        var job = this.movement.start(character, parameters[1]);
        if (parameters[1].wait) return job.done;
        var engine = this;
        job.done.catch(function (error) { engine.routeErrors.push(error); });
        return true;
    };

    GameEngine.prototype.save = function () {
        if (!this.state) throw new Error('Engine chưa boot.');
        this.state.eventSnapshots = this.map.snapshotEvents();
        this.state.routeSnapshots = this.movement.snapshot();
        return this.state.toJSON();
    };

    GameEngine.prototype.saveTo = function (saveStore, slot) {
        if (!saveStore || typeof saveStore.save !== 'function') throw new TypeError('SaveStore không hợp lệ.');
        return saveStore.save(slot, this.save());
    };

    GameEngine.prototype.loadFrom = async function (saveStore, slot, handlers) {
        if (!saveStore || typeof saveStore.load !== 'function') throw new TypeError('SaveStore không hợp lệ.');
        var snapshot = saveStore.load(slot);
        if (!snapshot) return false;
        await this.restore(snapshot);
        await this.resumeSavedEvents(handlers);
        return true;
    };

    GameEngine.prototype.resumeSavedEvents = async function (handlers) {
        var stack = this.state.pendingEventStack;
        if (!stack.length) return;
        if (this.eventRunning) throw new Error('Một sự kiện khác đang chạy.');
        var engine = this, budget = { remaining: stack[0].remaining };
        var interpreters = stack.map(function (frame) {
            var interpreter = engine.createInterpreter(frame.commands, frame.eventId, handlers);
            ['index', 'mapId', 'depth', 'result', 'choiceFrames', 'conditionFrames', 'loopFrames', 'battleFrames'].forEach(function (key) {
                interpreter[key] = frame[key];
            });
            interpreter.budget = budget;
            return interpreter;
        });
        interpreters.forEach(function (interpreter, index) { interpreter.parent = interpreters[index + 1] || null; });
        var root = interpreters[interpreters.length - 1];
        var event = root.mapId === this.map.id && this.map.eventById(root.eventId);
        if (event) event.locked = true;
        this.state.pendingEventStack = []; this.eventRunning = true;
        try {
            for (var index = 0; index < interpreters.length; index++) {
                var result = await interpreters[index].run();
                if (result.terminated) break;
                var parent = interpreters[index + 1];
                if (parent) {
                    parent.result.choices.push.apply(parent.result.choices, result.choices);
                    if (result.transferred) parent.result.transferred = result.transferred;
                }
            }
        } finally { this.eventRunning = false; if (event) event.locked = false; }
    };

    GameEngine.prototype.restore = async function (snapshot) {
        if (!this.database) throw new Error('Engine chưa boot database.');
        if (this.eventRunning || this.stepRunning) throw new Error('Không thể tải save khi sự kiện đang chạy.');
        var state = new stateApi.GameState(snapshot, this.database);
        var map = await this.prepareMap(state.mapId, state);
        if (!map.isValid(state.x, state.y) || !mapApi.DIRECTION_BITS[state.direction]) throw new Error('Vị trí trong save không hợp lệ.');
        this.state = state;
        if (this.screen) this.screen.dispose();
        this.screen = new screenApi.ScreenRuntime(state);
        this.lighting = new lightingApi.LightingRuntime(state);
        if (this.filters) this.filters.dispose();
        this.filters = new filterApi.FilterRuntime(state);
        if (this.animations) this.animations.dispose();
        this.animations = new animationApi.AnimationRuntime(this);
        this.battle = new battleApi.BattleRuntime(this.state, this.database, this.random);
        if (this.movement) this.movement.clear();
        this.map = map;
        this.lighting.sources(map);
        this.pendingTouchEvents = [];
        this.resetMovement(state.routeSnapshots);
        return this;
    };

    return { GameEngine: GameEngine };
}));
