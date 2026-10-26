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
        if (this.state && this.state.scene === 'battle') return;
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
            if (engine.battle.handleEffect(code, parameters)) return true;
            if (code === 203) { engine.setEventLocation(parameters, interpreter); return true; }
            if (code === 205) return engine.applyRoute(parameters, interpreter);
            if (code === 211) { engine.state.transparent = parameters[0] === 0; return true; }
            if (code === 204) return engine.scrollMap(parameters, interpreter);
            if (code === 301) return engine.startBattle(parameters, interpreter);
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

    GameEngine.prototype.startBattle = async function (parameters, interpreter) {
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
        this.battle.setup(troopId, parameters[2] === true, parameters[3] === true);
        this.state.scene = 'battle';
        try {
            var result = await this.battle.wait(interpreter && interpreter.signal);
            if (result === 'defeat') {
                this.state.scene = 'gameover';
                if (interpreter) interpreter.index = interpreter.commands.length;
                return 2;
            }
            return result === 'victory' ? 0 : result === 'escape' ? 1 : 2;
        } finally {
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

    GameEngine.prototype.loadFrom = async function (saveStore, slot) {
        if (!saveStore || typeof saveStore.load !== 'function') throw new TypeError('SaveStore không hợp lệ.');
        var snapshot = saveStore.load(slot);
        if (!snapshot) return false;
        await this.restore(snapshot);
        return true;
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
