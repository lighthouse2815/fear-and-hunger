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
    // Cờ mất tay của các nhân vật hai tay, do common event 240–242 cập nhật.
    // Moonless dùng ba cờ mất chân, không áp dụng quy tắc cầm trang bị này.
    var actorArmSwitches = {1:[36,37],2:[168,169],3:[248,249],4:[252,253],5:[256,257],
        6:[261,262],8:[381,382],9:[385,386],10:[376,377],11:[390,391],
        16:[91,92],17:[155,156],18:[161,162],19:[841,842],20:[845,846],21:[849,850]};
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
        this.audio = options.audio || null;
        this.screen = null;
        this.buttons = new Set();
        this.width = options.width || 816;
        this.height = options.height || 624;
        this.autonomousEnabled = options.autonomousMovement === true;
        this.forceDashing = options.forceDashing === true;
        this.pendingTouchEvents = [];
        this.onStateChange = this.playStateAnimation.bind(this);
        this.onBattleSound = this.playBattleSound.bind(this);
    }

    GameEngine.prototype.playBattleSound = function (index) {
        if (this.state.scene !== 'battle') return;
        var sound = (this.database.System.sounds || [])[index];
        if (!sound || !sound.name) return;
        var effect = this.onRouteEffect || this.battleContext && this.battleContext.handlers && this.battleContext.handlers.effect;
        if (!effect && this.audio) effect = this.audio.handleEffect.bind(this.audio);
        if (!effect) throw new Error('Chưa có bộ phát âm thanh chiến đấu.');
        var engine = this;
        Promise.resolve(effect(250,[sound])).catch(function (error) { engine.routeErrors.push(error); });
    };

    GameEngine.prototype.playStateAnimation = function (battler, stateId, added) {
        if (this.state.scene !== 'battle' || !this.battle || !this.battle.battle || this.battle.battle.result) return;
        var state = this.database.States[stateId], type = battler.enemyId != null ? 'enemy' : 'actor';
        var match = new RegExp('<state[-_ ]' + (added ? 'add' : 'remove') + '[-_ ]animation:\\s*(\\d+)\\s*\\/>', 'i').exec(state.note || '');
        if (match) this.animations.startBattle(type === 'enemy' ? battler.index : battler.id, Number(match[1]), false, type);
    };

    GameEngine.prototype.boot = async function (initialState) {
        this.database = await this.dataStore.loadDatabase();
        var system = this.database.System;
        var state = initialState || {
            mapId: system.startMapId,
            x: system.startX,
            y: system.startY,
            direction: 2,
            transparent: system.optTransparent === true,
            party: (system.partyMembers || []).slice()
        };
        this.state = new stateApi.GameState(state, this.database, this.random);
        this.state.onStateChange = this.onStateChange;
        this.screen = new screenApi.ScreenRuntime(this.state);
        this.lighting = new lightingApi.LightingRuntime(this.state);
        this.filters = new filterApi.FilterRuntime(this.state);
        this.animations = new animationApi.AnimationRuntime(this);
        this.battle = new battleApi.BattleRuntime(this.state, this.database, this.random, this.onStateChange, this.onBattleSound);
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
        if (this.battle) this.battle = new battleApi.BattleRuntime(this.state, this.database, this.random, this.onStateChange, this.onBattleSound);
        this.state.mapId = mapId;
        this.map = map;
        if (this.stepWait) this.screen.finish(this.stepWait);
        this.screen.setupFogs(map.data.note);
        this.screen.setupParallax(map.data);
        this.screen.showMapName(map.data.displayName);
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
        delete this.state.motion; this.state.moveFrames = 0;
        this.state.followers(true);
        this.state.followersGathering = false;
        this.resetCamera();
        this.playMapAudio();
        return this.map;
    };

    GameEngine.prototype.playMapAudio = function () {
        if (!this.audio) return;
        if (this.map.data.autoplayBgm) this.audio.play('bgm', this.map.data.bgm);
        if (this.map.data.autoplayBgs) this.audio.play('bgs', this.map.data.bgs);
    };

    GameEngine.prototype.resetCamera = function () {
        var screen = this.screen;
        screen.screen.tweens.slice().forEach(function (track) {
            if (track.path[0] === 'mapCamera') screen.finish(track);
        });
        delete screen.screen.mapCamera;
        if (this.map && this.state && (this.map.loopX() || this.map.loopY())) {
            var viewport = this.map.viewport(this.state, this.width, this.height);
            screen.screen.mapCamera = { mapId: this.map.id, x: viewport.startX, y: viewport.startY };
        }
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
        var goal = { x: map.loopX() ? camera.x + dx : Math.max(0, Math.min(Math.max(0, map.width - Math.ceil(this.width / 48)), camera.x + dx)),
            y: map.loopY() ? camera.y + dy : Math.max(0, Math.min(Math.max(0, map.height - Math.ceil(this.height / 48)), camera.y + dy)) };
        var frames = (Math.abs(goal.x - camera.x) + Math.abs(goal.y - camera.y)) * 256 / Math.pow(2, speed);
        var done = screen.tween(['mapCamera'], goal, frames);
        screen.revision++;
        return parameters[3] ? done : true;
    };

    GameEngine.prototype.followCamera = function (dx, dy) {
        var camera = this.screen.screen.mapCamera;
        if (!camera || camera.mapId !== this.map.id) return;
        var position = mapApi.displayPosition(this.state), x = this.map.screenX(position.x, camera.x), y = this.map.screenY(position.y, camera.y);
        var centerX = Math.floor(Math.ceil(this.width / 48) / 2), centerY = Math.floor(Math.ceil(this.height / 48) / 2);
        var shiftX = (dx > 0 && x > centerX) || (dx < 0 && x < centerX) ? dx : 0;
        var shiftY = (dy > 0 && y > centerY) || (dy < 0 && y < centerY) ? dy : 0;
        var nextX = this.map.loopX() ? camera.x + shiftX : Math.max(0, Math.min(Math.max(0, this.map.width - Math.ceil(this.width / 48)), camera.x + shiftX));
        var nextY = this.map.loopY() ? camera.y + shiftY : Math.max(0, Math.min(Math.max(0, this.map.height - Math.ceil(this.height / 48)), camera.y + shiftY));
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
        if (this.eventRunning || this.messageRunning || this.state.followersGathering || (this.movement && this.movement.jobs.has(this.state))) return false;
        var moved = this.moveCharacter(this.state, direction);
        if (moved && this.state.vehicleId === -1) {
            this.state.walkSteps++;
            this.state.motion.walk = true;
        }
        return moved;
    };

    GameEngine.prototype.onPlayerWalk = function () {
        if (this.state.vehicleId !== -1) return;
        var state = this.state, runtime = this.battle;
        state.walkEffects = [];
        state.party.forEach(function (id) {
            var actor = state.actor(id), beforeStates = actor.states.slice();
            var battler = { id: id, hp: actor.hp, mp: actor.mp, alive: actor.hp > 0 };
            var effect = state.walkSteps % 20 === 0 ? runtime.endBattlerTurn(battler) : null;
            actor = state.actor(id);
            if (!actor.stateSteps) actor.stateSteps = {};
            actor.states.slice().forEach(function (stateId) {
                var definition = this.database.States[stateId];
                if (!definition || !definition.removeByWalking) return;
                if (actor.stateSteps[stateId] == null) actor.stateSteps[stateId] = definition.stepsToRemove || 0;
                if (actor.stateSteps[stateId] > 0 && --actor.stateSteps[stateId] === 0) state.changeActorState(id, stateId, false);
            }, this);
            var removed = beforeStates.filter(function (stateId) { return !state.actor(id).states.includes(stateId); });
            if (removed.length && !effect) effect = { subject: 'actor', subjectId: id, hp: 0, mp: 0, tp: 0 };
            if (effect) { effect.removedStates = removed; state.walkEffects.push(effect); }
        }, this);
        if (state.walkEffects.some(function (effect) { return effect.hp < 0; })) this.screen.handleEffect(224, [[255, 0, 0, 128], 8, false]);
        if (!state.hasPartyNameCheat() && state.party.length && state.party.every(function (id) { return state.actor(id).hp <= 0; })) state.scene = 'gameover';
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
        if ((this.forceDashing || this.state.alwaysDash || this.buttons.has('shift')) && this.canDash()) speed++;
        return Math.pow(2, 8 - speed);
    };

    GameEngine.prototype.resetMovement = function (progress) {
        var engine = this;
        this.movement = new movementApi.MovementRuntime({
            player: this.state, state: this.state, random: function () { return engine.random(); },
            move: this.moveCharacter.bind(this),
            locate: function (character, x, y, frames, peak) {
                var followers = character === engine.state ? engine.state.followers().map(function (entry) { return mapApi.displayPosition(entry); }) : [];
                character.x = engine.map.roundX(x); character.y = engine.map.roundY(y);
                if (character === engine.state) engine.state.followers(true).forEach(function (entry, index) {
                    var distance = Math.round(Math.hypot(engine.map.deltaX(entry.x, followers[index].x), engine.map.deltaY(entry.y, followers[index].y)));
                    var followerPeak = 10 + distance - (engine.state.moveSpeed == null ? 4 : engine.state.moveSpeed);
                    var origin = { x: entry.x + engine.map.deltaX(followers[index].x, entry.x), y: entry.y + engine.map.deltaY(followers[index].y, entry.y) };
                    movementApi.startMotion(entry, origin, Math.max(1, followerPeak * 2), followerPeak);
                });
            },
            motionOrigin: function (from, character, x, y) {
                return { x: from.x + character.x - x, y: from.y + character.y - y };
            },
            deltaX: function (x, y) { return engine.map.deltaX(x, y); },
            deltaY: function (x, y) { return engine.map.deltaY(x, y); },
            changed: function (character) {
                if (character !== engine.state) engine.map.locateEvent(character.id, character.x, character.y, character.direction, true);
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
        if (this.stepWait && !['map', 'menu', 'save'].includes(this.state.scene)) this.screen.finish(this.stepWait);
        if (this.enemyEffectWaiters && (this.state.scene !== 'battle' || this.battle.battle.result)) {
            this.enemyEffectWaiters.forEach(function (track) { this.screen.finish(track); },this);
        }
        if (this.state && ['gameover', 'title', 'menu', 'save'].includes(this.state.scene)) return;
        if (this.state && this.state.timer.active && this.state.timer.frames > 0) {
            this.state.timer.frames = Math.max(0, this.state.timer.frames - frames);
            if (this.state.timer.frames === 0 && this.state.scene === 'battle' && this.battle.battle && !this.battle.battle.result) {
                if (this.battle.eventRunning) this.battle.pendingResult = 'escape';
                else this.battle.finish('escape');
            }
        }
        if (this.state && this.state.scene === 'battle') {
            if (this.routeErrors.length) throw this.routeErrors.shift();
            this.battle.battle.enemies.forEach(function (enemy) {
                var collapse=enemy.collapse;if (!collapse) return;
                var sounds=[];
                if (!collapse.soundStarted) { collapse.soundStarted=true;if (collapse.type===0 || collapse.type===1) sounds.push(collapse.type===0?11:12); }
                if (collapse.type===1 && collapse.duration!=null) {
                    var from=Math.ceil(collapse.duration-collapse.elapsed)-1,to=Math.max(0,Math.ceil(collapse.duration-collapse.elapsed-frames));
                    for (var remaining=from;remaining>=to;remaining--) if (remaining%20===19) sounds.push(13);
                }
                sounds.forEach(function (index) {
                    var sound=this.database.System.sounds[index];if (!sound || !sound.name) return;
                    if (!this.onRouteEffect) throw new Error('Chưa có bộ phát âm thanh cho hiệu ứng kết liễu.');
                    var engine=this;Promise.resolve(this.onRouteEffect(250,[sound])).catch(function (error) { engine.routeErrors.push(error); });
                },this);
            },this);
            this.battle.advanceSprites(frames);
            if (this.enemyEffectWaiters && !this.battle.battle.enemies.some(function (enemy) {
                return !enemy.hidden && (enemy.collapse && (enemy.collapse.duration == null || enemy.collapse.elapsed < enemy.collapse.duration) ||
                    enemy.spriteEffect && enemy.spriteEffect.remaining>0);
            })) this.enemyEffectWaiters.forEach(function (track) { this.screen.finish(track); },this);
            this.screen.advance(frames, 'battle');
            this.filters.advance(frames);
            this.animations.advance(frames);
            return;
        }
        if (this.routeErrors.length) throw this.routeErrors.shift();
        var before = this.state && mapApi.displayPosition(this.state);
        var motion = this.state && this.state.motion;
        var walked = motion && motion.walk && motion.x === this.state.x && motion.y === this.state.y && this.state.moveFrames <= frames;
        var state = this.state, followers = state ? state.followers() : [];
        var playerSpeed = this.map && state ? 8 - Math.log2(this.playerStepFrames()) : 4;
        followers.forEach(function (entry) {
            entry.walkAnime = state.walkAnime; entry.stepAnime = state.stepAnime; entry.moveSpeed = playerSpeed;
        });
        if (this.map && this.state) [this.state].concat(this.map.events, followers).forEach(function (character) {
            var speed = character === state && !(character.motion && !character.motion.walk) ? playerSpeed :
                character.moveSpeed == null ? 4 : character.moveSpeed;
            movementApi.advanceAnimation(character, frames, speed);
            character.moveFrames = Math.max(0, (character.moveFrames || 0) - frames);
            if (!character.moveFrames) delete character.motion;
            if (character.balloon) character.balloon.remaining = Math.max(0, character.balloon.remaining - frames);
        });
        if (this.movement) this.movement.advance(frames);
        if (this.state && this.state.followersGathering) {
            if (!this.state.followersVisible) this.state.followersGathering = false;
            this.state.followerFrames += frames;
            while (this.state.followerFrames >= this.playerStepFrames() && this.state.followersGathering) {
                this.state.followerFrames -= this.playerStepFrames();
                this.followPlayer();
                this.state.followersGathering = this.state.followers().some(function (entry) {
                    return entry.x !== this.state.x || entry.y !== this.state.y || entry.moveFrames > 0;
                }, this);
            }
        }
        if (this.autonomous && this.autonomousEnabled) this.autonomous.advance(frames);
        if (before && this.map) {
            var after = mapApi.displayPosition(this.state);
            this.followCamera(this.map.deltaX(after.x, before.x), this.map.deltaY(after.y, before.y));
        }
        if (this.screen) this.screen.advance(frames);
        if (this.lighting) this.lighting.advance(frames);
        if (this.filters) this.filters.advance(frames);
        if (this.animations) this.animations.advance(frames);
        if (walked) this.onPlayerWalk();
    };

    GameEngine.prototype.moveCharacter = function (character, direction, vertical, backward, frames) {
        var delta = movementApi.DELTAS[direction];
        if (!delta) return false;
        if (!character.directionFixed && !backward) character.direction = vertical || direction;
        var rawX = character.x + delta[0], rawY = character.y + delta[1];
        if (vertical) rawY += movementApi.DELTAS[vertical][1];
        var x = this.map.roundX(rawX), y = this.map.roundY(rawY);
        if (!this.map.isValid(x, y)) return false;
        if (!character.through) {
            var passable = vertical ?
                (this.map.isPassable(character.x, character.y, direction) && this.map.isPassable(x, character.y, vertical)) ||
                (this.map.isPassable(character.x, character.y, vertical) && this.map.isPassable(character.x, y, direction)) :
                this.map.isPassable(character.x, character.y, direction);
            var playerHit = this.state.x === x && this.state.y === y;
            var followerHit = this.state.followersVisible && this.state.followers().some(function (entry) { return entry.x === x && entry.y === y; });
            if (character !== this.state && character.priorityType === 1 && (playerHit || followerHit)) {
                var page = this.map.eventPage(character);
                var touch = playerHit || page && page.list.some(function (command) {
                    return command.code === 108 && String(command.parameters[0]).indexOf('<follower touch>') !== -1;
                });
                if (touch && !this.eventRunning && page && page.trigger === 2 && !this.pendingTouchEvents.some(function (entry) { return entry.event === character; })) {
                    this.pendingTouchEvents.push({ map: this.map, event: character, page: page });
                }
                return false;
            }
            if (!passable || this.map.eventBlocks(x, y, character.id)) return false;
        }
        var from = mapApi.displayPosition(character);
        from.x += x - rawX; from.y += y - rawY;
        frames = frames || (character === this.state ? this.playerStepFrames() : Math.pow(2, 8 - (character.moveSpeed == null ? 4 : character.moveSpeed)));
        if (character === this.state) this.followPlayer(frames);
        character.x = x; character.y = y;
        movementApi.startMotion(character, from, frames);
        this.playFootstep(character);
        return true;
    };

    GameEngine.prototype.footstepSound = function (character) {
        var player = character === this.state;
        if (!this.state.footstepsEnabled || player && this.state.vehicleId !== -1 || /<No Footsteps>/i.test(character.note || '')) return null;
        var distance = Math.abs(this.map.deltaX(character.x, this.state.x)) + Math.abs(this.map.deltaY(character.y, this.state.y));
        // Tăng riêng bước chân người chơi gấp bốn so với mức gốc 1.20;
        // event vẫn dùng mức 1.50 và giảm 0.10 mỗi ô theo khoảng cách.
        var volume = player ? 4.8 : 1.5 - distance * 0.1;
        if (volume <= 0) return null;
        var map = this.map, region = map.regionId(character.x, character.y), terrain = map.terrainTag(character.x, character.y);
        function find(note, kind, id) {
            var expression = new RegExp('<' + kind + '\\s+' + id + '\\s+Footstep Sound:\\s*([^>]+)>', 'ig'), match, sound;
            while ((match = expression.exec(note || ''))) sound = match[1].split(',').map(function (part) { return part.trim(); });
            return sound;
        }
        var sound = region && find(map.data.note, 'Region', region) ||
            terrain && find(map.tileset.note, 'Terrain Tag', terrain) || find(map.data.note, 'Region', 0) || ['footstep_tile', 20, 70];
        var soundVolume = Number(sound[1] || 20) * volume;
        return { name: sound[0], volume: player ? Math.min(100, soundVolume) : soundVolume,
            pitch: Number(sound[2] || 70), pan: player ? 0 : Math.max(-100, Math.min(100, this.map.deltaX(this.state.x, character.x))) };
    };

    GameEngine.prototype.playFootstep = function (character) {
        if (!this.onRouteEffect) return;
        var sound = this.footstepSound(character), engine = this;
        if (sound && sound.name) Promise.resolve(this.onRouteEffect(250, [sound])).catch(function (error) { engine.routeErrors.push(error); });
    };

    GameEngine.prototype.followPlayer = function (frames) {
        var followers = this.state.followers();
        for (var i = followers.length - 1; i >= 0; i--) {
            var follower = followers[i], ahead = i ? followers[i - 1] : this.state;
            var dx = Math.sign(this.map.deltaX(ahead.x, follower.x)), dy = Math.sign(this.map.deltaY(ahead.y, follower.y));
            var from = mapApi.displayPosition(follower);
            var rawX = follower.x + dx, rawY = follower.y + dy;
            follower.x = this.map.roundX(rawX); follower.y = this.map.roundY(rawY);
            from.x += follower.x - rawX; from.y += follower.y - rawY;
            if (dx || dy) movementApi.startMotion(follower, from, frames || this.playerStepFrames());
            if ((dx || dy) && this.state.followersVisible) this.playFootstep(follower);
            if (!this.state.directionFixed) {
                if (dy) follower.direction = dy > 0 ? 2 : 8;
                else if (dx) follower.direction = dx > 0 ? 6 : 4;
            }
        }
    };

    GameEngine.prototype.gatherFollowers = async function (interpreter) {
        this.state.followersGathering = this.state.followersVisible && this.state.followers().some(function (entry) {
            return entry.x !== this.state.x || entry.y !== this.state.y || entry.moveFrames > 0;
        }, this);
        this.state.followerFrames = 0;
        while (this.state.followersGathering) {
            if (interpreter.signal && interpreter.signal.aborted) throw interpreter.signal.reason;
            await this.screen.tween([], {}, 1);
        }
        return true;
    };

    GameEngine.prototype.step = async function (direction, handlers) {
        if (!this.map || !this.state) throw new Error('Engine chưa boot.');
        if (this.state.scene !== 'map') return false;
        if (this.eventRunning || this.messageRunning || this.stepRunning || this.state.moveFrames > 0 || this.state.followersGathering ||
            this.movement.jobs.has(this.state) || !mapApi.DIRECTION_BITS[direction]) return false;
        this.stepRunning = true;
        try {
            var sourceMap = this.map;
            var moved = this.move(direction);
            if (this.state.scene !== 'map') return moved;
            var x = this.map.roundX(this.state.x + (!moved ? direction === 4 ? -1 : direction === 6 ? 1 : 0 : 0));
            var y = this.map.roundY(this.state.y + (!moved ? direction === 8 ? -1 : direction === 2 ? 1 : 0 : 0));
            if (moved) {
                var waitId = this.screen.screen.nextId;
                var finished = this.screen.tween([], {}, this.state.moveFrames);
                this.stepWait = this.screen.screen.tweens.find(function (track) { return track.id === waitId; });
                await finished;
                if (this.map !== sourceMap || this.state.scene !== 'map' || this.state.x !== x || this.state.y !== y) return moved;
            }
            var candidates = sourceMap.eventAt(x, y);
            for (var i = 0; i < candidates.length; i++) {
                if (this.map !== sourceMap) break;
                var page = sourceMap.eventPage(candidates[i]);
                if (page && (page.trigger === 1 || page.trigger === 2) && moved === (page.priorityType !== 1)) {
                    await this.runEvent(candidates[i].id, handlers);
                }
            }
            return moved;
        } finally {
            if (this.stepWait) this.screen.finish(this.stepWait);
            this.stepWait = null; this.stepRunning = false;
        }
    };

    GameEngine.prototype.interact = async function (handlers) {
        if (!this.map || !this.state) throw new Error('Engine chưa boot.');
        if (this.state.scene !== 'map') return null;
        if (this.eventRunning || this.messageRunning || this.stepRunning) return null;
        var direction = this.state.direction;
        var x = this.map.roundX(this.state.x + (direction === 4 ? -1 : direction === 6 ? 1 : 0));
        var y = this.map.roundY(this.state.y + (direction === 8 ? -1 : direction === 2 ? 1 : 0));
        var candidates = this.map.eventAt(this.state.x, this.state.y).map(function (event) {
            return { event: event, sameTile: true };
        }).concat(this.map.eventAt(x, y).map(function (event) {
            return { event: event, sameTile: false };
        }));
        if (this.map.isCounter(x, y)) {
            var behindX = this.map.roundX(x + (direction === 4 ? -1 : direction === 6 ? 1 : 0));
            var behindY = this.map.roundY(y + (direction === 8 ? -1 : direction === 2 ? 1 : 0));
            candidates = candidates.concat(this.map.eventAt(behindX, behindY).map(function (event) {
                return { event: event, sameTile: false };
            }));
        }
        for (var i = 0; i < candidates.length; i += 1) {
            var candidate = candidates[i];
            var page = this.map.eventPage(candidate.event);
            var triggerMatches = candidate.sameTile ? page && page.trigger === 0 : page && [0, 1, 2].includes(page.trigger);
            if (triggerMatches && page.list && page.list.some(function (command) { return command.code !== 0; }) &&
                candidate.sameTile === (page.priorityType !== 1)) {
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
        var afterCommand = eventHandlers.afterCommand;
        eventHandlers.afterCommand = function (command, interpreter) {
            if (engine.state.scene === 'battle' && engine.battle && engine.battle.battle && !engine.battle.battle.result) {
                engine.syncBattleActors();
                engine.battle.battle.actionRevision = (engine.battle.battle.actionRevision || 0) + 1;
            }
            if (afterCommand) return afterCommand(command,interpreter);
        };
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
                var position = mapApi.displayPosition(character);
                if (field === 3) return Math.round((engine.map.screenX(position.x, viewport.startX) + 0.5) * 48);
                var actor = character === engine.state && engine.state.actor(engine.state.party[0] || 1);
                var name = character.characterName == null && actor ? actor.characterName : character.characterName;
                var prefix = /^[!$]+/.exec(name || '');
                return Math.round((engine.map.screenY(position.y, viewport.startY) + 1) * 48 - position.lift) - (prefix && prefix[0].includes('!') ? 0 : 6);
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
            var load = function () { return engine.loadMap(destination.mapId, destination); };
            if (eventHandlers.mapTransition) await eventHandlers.mapTransition(destination.fadeType, load, interpreter);
            else await load();
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
            if (code === 217) return engine.gatherFollowers(interpreter);
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

    GameEngine.prototype.completeBattleAction = async function (report, handlers, signal) {
        var runtime = this.battle, skill = runtime.actionData(report), engine = this;
        if (report.pendingAction && report.pendingAction.done()) return;
        var pending = report.pendingAction, subject = pending ? pending.subject :
            report.subject === 'enemy' ? runtime.enemy(report.subjectId) : runtime.actor(report.subjectId);
        var animationId = runtime.actionAnimationId(subject,skill);
        var activeAnimations = [], animationWaits = [], waits = [], counterIndex = 0;
        var releaseImmortal = pending && !report.counter ? runtime.protectActionTargets(report.targets.map(function (target) {
            return target.type === 'enemy' ? runtime.enemy(target.id) : runtime.actor(target.id);
        }).filter(Boolean)) : null;
        var waiter = this.createInterpreter([], 0, handlers, signal);
        function waitFrames(frames) {
            var before = engine.screen.screen.nextId;
            var done = engine.screen.tween([], {}, frames);
            var track = engine.screen.screen.tweens.find(function (entry) { return entry.id === before; });
            if (track) waits.push(track);
            return waiter.awaitCommand(done);
        }
        function startAnimation(indices) {
            if (skill.animationId < 0 && report.subject === 'enemy' && !engine.database.System.optSideView) runtime.playSound(9);
            if (animationId <= 0) return;
            indices.forEach(function (index) {
                var target = report.targets[index];
                animationWaits.push(engine.animations.startBattle(target.id, animationId, false, target.type));
                activeAnimations.push(engine.animations.entries[engine.animations.entries.length - 1]);
            });
        }
        async function counters() {
            while (counterIndex < report.hits.length) {
                var hit = report.hits[counterIndex++];
                if (hit.reflectedBy) {
                    var reflector = hit.reflectedBy.type === 'enemy' ? runtime.enemy(hit.reflectedBy.id) : runtime.actor(hit.reflectedBy.id);
                    var reflectionWaits = [];
                    function reflectAnimation(id, targetId, type, mirror) {
                        if (id <= 0) return;
                        reflectionWaits.push(engine.animations.startBattle(targetId, id, !!mirror, type));
                        activeAnimations.push(engine.animations.entries[engine.animations.entries.length - 1]);
                    }
                    if (hit.reflectedBy.type === 'enemy' || engine.database.System.optSideView) {
                        reflectAnimation(runtime.reflectAnimationId(reflector), hit.reflectedBy.id, hit.reflectedBy.type, hit.reflectedBy.type==='actor');
                    }
                    reflectAnimation(animationId, hit.target, hit.targetType);
                    await waiter.awaitCommand(Promise.all(reflectionWaits));
                }
                if (hit.counter) await engine.completeBattleAction(hit.counter, handlers, signal);
            }
        }
        try {
            if (subject.enemyId != null) subject.spriteEffect = { type: 'whiten', remaining: 16 };
            if (report.counter) runtime.performAction(subject, skill, false, true);
            var phases = report.counter ? { target: ['action animation', 'wait for animation', 'action effect'] } : runtime.actionPhases(skill);
            if (!report.counter && !Object.prototype.hasOwnProperty.call(runtime.actionSequence(skill)||{},'setup')) {
                var castId=runtime.castAnimationId(subject,skill,!!report.itemId);
                if (castId>0) {
                    animationWaits.push(this.animations.startBattle(report.subjectId,castId,false,report.subject));
                    activeAnimations.push(this.animations.entries[this.animations.entries.length-1]);
                }
            }
            var allTargets = report.targets.map(function (_, index) { return index; });
            for (var phase of ['setup', 'whole', 'target', 'follow', 'finish']) {
                var groups = phase === 'target' ? allTargets.map(function (index) { return [index]; }) : [allTargets];
                var stopTargets = false;
                for (var indices of groups) {
                    if (stopTargets) break;
                    for (var raw of phases[phase] || []) {
                        if (signal && signal.aborted) throw signal.reason;
                        var line = raw.trim().toLowerCase();
                        if (line === 'action animation') startAnimation(indices);
                        else if (line === 'wait for animation') {
                            do {
                                await waiter.awaitCommand(Promise.all(engine.animations.entries.filter(function (entry) {
                                    return entry.scope==='battle';
                                }).map(function (entry) { return engine.animations.waitFor(entry); })));
                            } while (engine.animations.entries.some(function (entry) { return entry.scope==='battle'; }));
                        }
                        else if (line === 'action effect' && pending) {
                            for (var targetIndex of indices) {
                                if (!subject.alive) break;
                                pending.apply([targetIndex]); await counters();
                            }
                        } else if (line === 'perform action') {
                            runtime.performAction(subject, skill, !!report.itemId, report.counter);
                            if (report.subject === 'actor') await waitFrames(20);
                        }
                        else if (line === 'motion wait: user' && report.subject === 'actor') await waitFrames(12);
                        else if (/^wait: \d+$/.test(line)) await waitFrames(Number(line.split(':')[1]));
                        else if (/^motion (swing|evade): user$/.test(line)) {
                            runtime.battle.motion = { subject: report.subject, subjectId: report.subjectId, type: line.split(' ')[1].replace(':', '') };
                            runtime.startMotion(subject, runtime.battle.motion.type);
                        } else if (line === 'death break' && subject && !subject.alive) { stopTargets = true; break; }
                    }
                }
            }
            await waiter.awaitCommand(Promise.all(animationWaits));
            await counters();
            if (pending) pending.finish();
            if (releaseImmortal) releaseImmortal();
            report.hits.forEach(function (hit) {
                var target = hit.targetType === 'enemy' ? runtime.enemy(hit.target) : runtime.actor(hit.target);
                hit.defeated = target ? !target.alive : hit.defeated;
            });
            report.defeated = !!(report.hits.length && report.hits[report.hits.length - 1].defeated);
            await this.waitEnemyEffects(handlers,signal);
            for (var index = 0; index < report.commonEvents.length; index++) {
                if (signal && signal.aborted) throw signal.reason;
                if (this.state.scene !== 'battle' || this.battle.battle.result) return;
                await this.createInterpreter([{ code: 117, parameters: [report.commonEvents[index]] }], 0, handlers, signal).run();
                this.syncBattleActors();
            }
        } finally {
            if (releaseImmortal) releaseImmortal();
            if (pending) pending.cancel();
            delete runtime.battle.motion;
            if (signal && signal.aborted) { delete subject.spriteMotion; delete subject.spriteEffect; }
            activeAnimations.forEach(function (entry) { engine.animations.finish(entry); });
            waits.forEach(function (track) { engine.screen.finish(track); });
        }
    };

    GameEngine.prototype.completeBattleSkill = GameEngine.prototype.completeBattleAction;

    GameEngine.prototype.waitEnemyEffects = async function (handlers, signal) {
        var engine = this, runtime = this.battle, battle = runtime.battle, waiter = this.createInterpreter([],0,handlers,signal);
        while (this.battle===runtime && this.state.scene==='battle' && !battle.result) {
            await waiter.awaitCommand(Promise.all(battle.enemies.map(async function (enemy) {
                var collapse = enemy.collapse;
                if (enemy.hidden || !collapse || collapse.duration != null) return;
                var folder = engine.database.System.optSideView ? 'sv_enemies' : 'enemies';
                var size = await engine.dataStore.loadImageSize('img/' + folder + '/' + enemy.battlerName + '.png');
                collapse.duration = size.height;
            })));
            if (this.battle!==runtime || this.state.scene!=='battle' || battle.result) return;
            var remaining = battle.enemies.reduce(function (frames,enemy) {
                if (enemy.hidden) return frames;
                return Math.max(frames,enemy.collapse ? enemy.collapse.duration - enemy.collapse.elapsed : 0,enemy.spriteEffect ? enemy.spriteEffect.remaining : 0);
            },0);
            if (!remaining) return;
            var id = this.screen.screen.nextId, waiting = this.screen.tween([],{},remaining);
            var track = this.screen.screen.tweens.find(function (entry) { return entry.id === id; });
            track.enemyEffects = true;
            if (!this.enemyEffectWaiters) this.enemyEffectWaiters = new Set();
            this.enemyEffectWaiters.add(track);
            try { await waiter.awaitCommand(waiting); }
            finally { this.screen.finish(track); this.enemyEffectWaiters.delete(track); }
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
                var report = runtime.useSkill(subject, parameters[2], parameters[3], true, true);
                await this.completeBattleAction(report, handlers, signal);
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
        }
        if (!battle.result) {
            await this.waitEnemyEffects(handlers,signal);
            if (this.state.scene!=='battle') runtime.finish('abort');
            else if (!battle.result) runtime.checkResult();
        }
    };

    GameEngine.prototype.syncBattleActors = function () {
        var state = this.state;
        this.battle.battle.actors = state.battleActorIds().map(function (id) {
            var actor = this.battle.battle.actors.find(function (entry) { return entry.id === id; }) || {id:id};
            this.battle.refreshActor(actor); actor.name = state.actor(id).name;
            return actor;
        },this);
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
    GameEngine.prototype.returnMenuToTitle = function () {
        if (!this.state || this.state.scene !== 'menu') return false;
        this.state.scene = 'title'; this.buttons.clear();
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
    GameEngine.prototype.canChangeMenuEquipment = function (actorId, slot) {
        var actor = this.state.actor(actorId);
        if (this.state.scene !== 'menu' || !this.state.party.includes(actorId) || !actor ||
            !Number.isInteger(slot) || slot < 0 || slot >= actor.equips.length) return false;
        var traits = this.battle.battlerTraits({ id: actorId });
        return !traits.some(function (trait) { return [53, 54].includes(trait.code) && trait.dataId === slot + 1; });
    };
    GameEngine.prototype.menuActorStatus = function (actorId) {
        if (!this.state.party.includes(actorId)) return null;
        var actor = this.state.actor(actorId), data = this.database.Actors[actorId], classData = this.database.Classes[actor.classId];
        // EXP cũng là dữ liệu thanh Hunger của GALV_BustMenu trong nội dung gốc.
        var next = actor.level >= data.maxLevel ? null : this.state.actorExpForLevel(actorId,actor.level + 1);
        var base = this.state.actorExpForLevel(actorId,actor.level);
        var traits = this.battle.battlerTraits({id:actorId});
        return { className: classData.name, exp: actor.exp, nextExp: next == null ? null : next - actor.exp,
            hunger: next == null || next === base ? 0 : Math.max(0,Math.min(1,(next - actor.exp) / (next - base))),
            stateIcons: actor.states.map(function (id) { return this.database.States[id]; },this)
                .sort(function (a,b) { return b.priority - a.priority || a.id - b.id; })
                .filter(function (state) { return state.iconIndex > 0; })
                .map(function (state) { return {id:state.id,name:state.name,iconIndex:state.iconIndex}; }),
            stateRates: [1,4,5,6,7,8,9,10].map(function (id) {
                return {id:id,rate:traits.some(function (trait) { return trait.code === 14 && trait.dataId === id; }) ? 0 : this.battle.traitRate({id:actorId},13,id)};
            },this) };
    };
    GameEngine.prototype.canEquipMenuActor = function (actorId, slot, itemId) {
        if (!this.canChangeMenuEquipment(actorId, slot)) return false;
        if (!Number.isInteger(itemId) || itemId < 0) return false;
        if (!itemId) return true;
        var actor = this.state.actor(actorId), traits = this.battle.battlerTraits({ id: actorId });
        var item = (slot === 0 ? this.database.Weapons : this.database.Armors)[itemId];
        var arms = actorArmSwitches[actorId];
        if (arms && slot <= 1 && (this.state.switchValue(arms[1]) || this.state.switchValue(arms[0]) &&
            (slot === 1 || item && item.traits.some(function (trait) { return trait.code === 54 && trait.dataId === 2; })))) return false;
        return !!item && item.etypeId === slot + 1 && (actor.equips[slot] === itemId ||
            this.state.itemCount(slot === 0 ? 'weapons' : 'armors',itemId) > 0) && traits.some(function (trait) {
            return trait.code === (slot === 0 ? 51 : 52) && trait.dataId === (slot === 0 ? item.wtypeId : item.atypeId);
        });
    };
    GameEngine.prototype.equipMenuActor = function (actorId, slot, itemId) {
        if (!this.canEquipMenuActor(actorId, slot, itemId)) return false;
        if (this.state.actor(actorId).equips[slot] === itemId) return true;
        if (!this.state.equipActor(actorId, slot, itemId)) return false;
        // Vũ khí hai tay có thể seal ô khiên; trả món vừa mất quyền dùng về túi.
        var changed;
        do {
            changed = false;
            this.state.actor(actorId).equips.slice().forEach(function (equipped,index) {
                if (!equipped) return;
                var traits = this.battle.battlerTraits({ id: actorId });
                var item = (index === 0 ? this.database.Weapons : this.database.Armors)[equipped];
                if (!item || traits.some(function (trait) { return trait.code === 54 && trait.dataId === index + 1; }) ||
                    !traits.some(function (trait) { return trait.code === (index === 0 ? 51 : 52) && trait.dataId === (index === 0 ? item.wtypeId : item.atypeId); })) {
                    this.state.equipActor(actorId,index,0); changed = true;
                }
            },this);
        } while (changed);
        return true;
    };
    GameEngine.prototype.clearMenuEquipment = function (actorId) {
        if (this.state.scene !== 'menu' || !this.state.party.includes(actorId)) return false;
        this.state.actor(actorId).equips.forEach(function (_,slot) {
            if (this.canChangeMenuEquipment(actorId,slot)) this.equipMenuActor(actorId,slot,0);
        },this);
        return true;
    };
    GameEngine.prototype.optimizeMenuEquipment = function (actorId) {
        if (!this.clearMenuEquipment(actorId)) return false;
        this.state.actor(actorId).equips.forEach(function (_,slot) {
            var table = slot === 0 ? this.database.Weapons : this.database.Armors, best = null, performance = -1000;
            table.forEach(function (item) {
                if (!item || !this.canEquipMenuActor(actorId,slot,item.id)) return;
                var value = item.params.reduce(function (sum,param) { return sum + param; },0);
                if (value > performance) { performance = value; best = item; }
            },this);
            if (best) this.equipMenuActor(actorId,slot,best.id);
        },this);
        return true;
    };
    GameEngine.prototype.synthesisIngredients = function (kind, id) {
        var table = this.database[{ item: 'Items', weapon: 'Weapons', armor: 'Armors' }[kind]], target = table && table[id];
        if (!target) return [];
        var block = /<Synthesis Ingredients>([\s\S]*?)<\/Synthesis Ingredients>/i.exec(target.note || ''), result = [];
        if (!block) return result;
        block[1].split(/\r?\n/).forEach(function (line) {
            line = line.trim(); if (!line) return;
            var match = /^(item|weapon|armor)\s+(\d+)(?:\s*:\s*(\d+))?$/i.exec(line);
            if (match) result.push({ kind: match[1].toLowerCase(), id: Number(match[2]), amount: Number(match[3] || 1) });
            else {
                match = /^gold\s*:\s*(\d+)$/i.exec(line);
                if (match) result.push({ kind: 'gold', id: 0, amount: Number(match[1]) });
                else throw new Error('Nguyên liệu chế tạo chưa hỗ trợ: ' + line);
            }
        });
        return result;
    };
    GameEngine.prototype.synthesisRecipes = function (kind) {
        var engine = this, recipes = [], seen = {};
        function scanSource(sourceKind, key) {
            var table = engine.database[{ items: 'Items', weapons: 'Weapons', armors: 'Armors' }[sourceKind]];
            if (!table[key]) return;
            if (engine.state.itemCount(sourceKind, Number(key)) <= 0 && !engine.state.party.some(function (actorId) {
                return engine.state.actor(actorId).equips.some(function (id, slot) {
                    return sourceKind === (slot === 0 ? 'weapons' : 'armors') && id === Number(key);
                });
            })) return;
                var source = table[key], note = source && source.note || '';
                ['Item', 'Weapon', 'Armor'].forEach(function (label) {
                    var match = new RegExp('<' + label + ' Recipe:\\s*([^>]+)>', 'ig'), found;
                    while ((found = match.exec(note))) found[1].split(',').forEach(function (value) {
                        var targetId = Number(value.trim());
                        if (!targetId || (kind && kind !== label.toLowerCase())) return;
                        var targetKind = label.toLowerCase(), targetTable = engine.database[{ item: 'Items', weapon: 'Weapons', armor: 'Armors' }[targetKind]];
                        if (!targetTable[targetId] || seen[targetKind + ':' + targetId]) return;
                        var ingredients = engine.synthesisIngredients(targetKind, targetId);
                        if (!ingredients.length) return;
                        seen[targetKind + ':' + targetId] = true;
                        var item = targetTable[targetId], known = (engine.state.synthesis.crafted[targetKind + 's'][targetId] || 0) > 0;
                        recipes.push({ kind: targetKind, id: targetId, item: item, ingredients: ingredients,
                            name: known ? item.name : '?'.repeat(item.name.length), known: known });
                    });
                });
        }
        ['items', 'weapons', 'armors'].forEach(function (sourceKind) {
            Object.keys(engine.state.inventory[sourceKind]).forEach(function (key) { scanSource(sourceKind, key); });
        });
        engine.state.party.forEach(function (actorId) {
            engine.state.actor(actorId).equips.forEach(function (key, slot) {
                if (key) scanSource(slot === 0 ? 'weapons' : 'armors', String(key));
            });
        });
        return recipes.sort(function (a, b) { return a.id - b.id; });
    };
    GameEngine.prototype.canSynthesize = function (recipe) {
        if (this.state.scene !== 'menu' || !recipe) return false;
        recipe = this.synthesisRecipes(recipe.kind).find(function (entry) { return entry.kind === recipe.kind && entry.id === recipe.id; });
        if (!recipe || this.state.itemCount({ item: 'items', weapon: 'weapons', armor: 'armors' }[recipe.kind], recipe.id) >= 99) return false;
        return recipe.ingredients.every(function (ingredient) {
            return ingredient.kind === 'gold' ? this.state.gold >= ingredient.amount :
                this.state.itemCount({ item: 'items', weapon: 'weapons', armor: 'armors' }[ingredient.kind], ingredient.id) >= ingredient.amount;
        }, this);
    };
    GameEngine.prototype.synthesize = function (recipe) {
        if (!this.canSynthesize(recipe)) throw new Error('Chưa đủ nguyên liệu chế tạo.');
        recipe = this.synthesisRecipes(recipe.kind).find(function (entry) { return entry.kind === recipe.kind && entry.id === recipe.id; });
        recipe.ingredients.forEach(function (ingredient) {
            if (ingredient.kind === 'gold') this.state.gold -= ingredient.amount;
            else this.state.gainItem({ item: 'items', weapon: 'weapons', armor: 'armors' }[ingredient.kind], ingredient.id, -ingredient.amount);
        }, this);
        this.state.gainItem({ item: 'items', weapon: 'weapons', armor: 'armors' }[recipe.kind], recipe.id, 1);
        var crafted = this.state.synthesis.crafted[recipe.kind + 's'];
        crafted[recipe.id] = (crafted[recipe.id] || 0) + 1;
        return recipe.item;
    };
    GameEngine.prototype.menuActionTargets = function (data, actorId, targetId) {
        var state = this.state;
        if (data.scope === 0 || data.scope <= 6) return [];
        var ids = data.scope === 11 ? [actorId] : [8, 10].includes(data.scope) ? state.party : [targetId];
        return ids.filter(function (id) {
            var actor = state.party.includes(id) && state.actor(id);
            return actor && (actor.hp > 0) !== [9, 10].includes(data.scope);
        }).map(function (id) {
            var actor = state.actor(id);
            return { id: id, name: actor.name, hp: actor.hp, mp: actor.mp, alive: actor.hp > 0 };
        });
    };
    GameEngine.prototype.canUseMenuAction = function (kind, id, actorId, targetId) {
        if (!['item', 'skill'].includes(kind) || this.state.scene !== 'menu' || this.eventRunning || this.messageRunning ||
            this.menuWaiters && this.menuWaiters.size || !this.state.party.includes(actorId)) return false;
        var item = kind === 'item', data = (item ? this.database.Items : this.database.Skills)[id];
        var actor = this.state.actor(actorId), subject = { id: actorId, alive: actor.hp > 0 };
        if (!data || !(item ? this.battle.canUseItem(subject, data, true) : this.battle.canUseSkill(subject, data, true))) return false;
        if (!item && !this.battle.actorSkills(actorId).some(function (skill) { return skill.id === id; })) return false;
        if (item && ![0, 7, 11].includes(data.scope)) return false;
        var targets = this.menuActionTargets(data, actorId, targetId);
        if ([7, 9, 11].includes(data.scope) && !targets.length) return false;
        if (item || (data.effects || []).some(function (effect) { return effect.code === 44; })) return true;
        return targets.some(function (target) {
            var actor = this.state.actor(target.id);
            if (data.damage.type === 3 && actor.hp < this.state.actorParam(target.id, 0)) return true;
            if (data.damage.type === 4 && actor.mp < this.state.actorParam(target.id, 1)) return true;
            if ((data.damage.type === 1 || data.damage.type === 2) && data.scope >= 7) return true;
            return (data.effects || []).some(function (effect) {
                return effect.code === 21 && !actor.states.includes(effect.dataId) || effect.code === 22 && actor.states.includes(effect.dataId) ||
                    effect.code === 43 && !actor.skills.includes(effect.dataId);
            });
        }, this);
    };
    GameEngine.prototype.canUseMenuItem = function (itemId, actorId) {
        return this.canUseMenuAction('item', itemId, actorId, actorId);
    };
    GameEngine.prototype.canUseMenuSkill = function (actorId, skillId, targetId) {
        return this.canUseMenuAction('skill', skillId, actorId, targetId);
    };
    GameEngine.prototype.useMenuItem = async function (itemId, actorId, handlers) {
        await this.useMenuAction('item', itemId, actorId, actorId, handlers);
        return true;
    };
    GameEngine.prototype.useMenuSkill = function (actorId, skillId, targetId, handlers) {
        return this.useMenuAction('skill', skillId, actorId, targetId, handlers);
    };
    GameEngine.prototype.useMenuAction = async function (kind, id, actorId, targetId, handlers) {
        if (!this.canUseMenuAction(kind, id, actorId, targetId)) throw new Error(kind === 'item' ? 'Chưa thể dùng vật phẩm này.' : 'Chưa thể dùng kỹ năng này.');
        var data = (kind === 'item' ? this.database.Items : this.database.Skills)[id];
        var actor = this.state.actor(actorId), subject = { id: actorId, hp: actor.hp, mp: actor.mp, alive: actor.hp > 0 };
        var targets = this.menuActionTargets(data, actorId, targetId);
        var report = this.battle.useAction(subject, data, 0, kind === 'item', false, targets);
        if (!report.commonEvents.length) return report;
        this.closeMenu(); this.eventRunning = true;
        try {
            for (var index = 0; index < report.commonEvents.length; index++) {
                await this.createInterpreter([{ code: 117, parameters: [report.commonEvents[index]] }], 0, handlers).run();
                if (this.state.scene === 'gameover' || this.state.scene === 'title') break;
            }
        } finally { this.eventRunning = false; }
        return report;
    };

    GameEngine.prototype.runEnemyTurn = async function (handlers, signal) {
        var runtime = this.battle, battle = runtime.battle;
        var actions = runtime.enemyActions();
        for (var index = 0; index < actions.length && !battle.result; index++) {
            var action = actions[index], enemy = runtime.enemy(action.enemy), skillId = runtime.confusionLevel(enemy) ? 1 : action.skillId, skill = this.database.Skills[skillId];
            if (this.state.scene !== 'battle') return;
            if ((battle.forcedThisTurn || []).includes('enemy:' + enemy.index) || !runtime.canUseSkill(enemy, skill)) continue;
            battle.phase = 'action';
            var report = runtime.useSkill(enemy, skillId, -1, false, true);
            await this.completeBattleAction(report, handlers, signal);
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

    GameEngine.prototype.battleSkill = function (actorId, skillId, targetIndex, handlers) {
        return this.battleAction(actorId, 'skill', skillId, targetIndex, handlers);
    };
    GameEngine.prototype.battleItem = function (actorId, itemId, targetIndex, handlers) {
        return this.battleAction(actorId, 'item', itemId, targetIndex, handlers);
    };
    GameEngine.prototype.validateBattleAction = function (action) {
        var runtime = this.battle, battle = runtime.battle;
        if (this.state.scene !== 'battle' || !battle || battle.result || battle.phase !== 'input') throw new Error('Chưa đến lượt nhân vật.');
        if (!action || !['skill', 'item'].includes(action.kind)) throw new Error('Loại hành động không hợp lệ.');
        var item = action.kind === 'item', subject = runtime.actor(action.actorId);
        var data = item ? this.database.Items[action.id] : runtime.skillFor(subject, action.id);
        if (!subject || !subject.alive || !data || !Number.isInteger(action.targetIndex)) throw new Error('Mục tiêu chiến đấu không hợp lệ.');
        if (!runtime.takesTurn(subject)) throw new Error('Nhân vật không có lượt bổ sung.');
        if (!item && ![1, 2].includes(action.id) && !runtime.actorSkills(subject.id).some(function (entry) { return entry.id === data.id; })) throw new Error('Nhân vật chưa học kỹ năng này.');
        if (runtime.restriction(subject) > 0 || runtime.isAutoBattle(subject) || !(item ? runtime.canUseItem(subject, data) : runtime.canUseSkill(subject, data))) throw new Error(item ? 'Chưa thể dùng vật phẩm ' + data.name : 'Chưa thể dùng kỹ năng ' + data.name);
        var chosen = data.scope === 1 ? runtime.enemy(action.targetIndex) : [7, 9].includes(data.scope) ? battle.actors[action.targetIndex] : null;
        if ([1, 7, 9].includes(data.scope) && (!chosen || (data.scope === 9 ? chosen.alive : !chosen.alive) || chosen.hidden)) throw new Error('Mục tiêu chiến đấu không hợp lệ.');
        return data;
    };
    GameEngine.prototype.validateBattleActions = function (actions, complete) {
        var battle = this.battle.battle;
        if (this.state.scene !== 'battle' || !battle || battle.result || battle.phase !== 'input') throw new Error('Chưa đến lượt nhân vật.');
        if (!Array.isArray(actions)) throw new Error('Danh sách hành động không hợp lệ.');
        var actors = new Set(), stock = {}, engine = this;
        actions.forEach(function (action) {
            var data = engine.validateBattleAction(action);
            if (actors.has(action.actorId)) throw new Error('Mỗi nhân vật chỉ được chọn một hành động trong lượt.');
            actors.add(action.actorId);
            if (action.kind === 'item' && data.consumable) {
                stock[data.id] = (stock[data.id] || 0) + 1;
                if (stock[data.id] > engine.state.itemCount('items', data.id)) throw new Error('Không đủ vật phẩm ' + data.name + ' cho cả đội.');
            }
        });
        if (complete && this.battle.inputActors().some(function (actor) { return !actors.has(actor.id); })) throw new Error('Hãy chọn hành động cho đủ nhân vật.');
    };
    GameEngine.prototype.queueBattleAction = function (actorId, kind, id, targetIndex) {
        var battle = this.battle.battle, action = { actorId: actorId, kind: kind, id: id, targetIndex: targetIndex };
        this.validateBattleAction(action);
        var actions = (battle.inputActions || []).filter(function (entry) { return entry.actorId !== actorId; }).concat([action]);
        this.validateBattleActions(actions, false);
        battle.escapeFailed = false;
        battle.inputActions = actions;
        return action;
    };
    GameEngine.prototype.removeBattleAction = function (actorId) {
        var battle = this.battle.battle;
        if (this.state.scene !== 'battle' || !battle || battle.result || battle.phase !== 'input') return false;
        battle.inputActions = (battle.inputActions || []).filter(function (action) { return action.actorId !== actorId; });
        return true;
    };
    GameEngine.prototype.startBattleTurn = function (handlers) {
        var battle = this.battle.battle;
        if (this.state.scene !== 'battle' || !battle || battle.result || battle.phase !== 'input') return Promise.reject(new Error('Chưa đến lượt nhân vật.'));
        var actions = (battle.inputActions || []).slice();
        try { this.validateBattleActions(actions, true); }
        catch (error) { return Promise.reject(error); }
        return this.runBattleTurn(actions, handlers);
    };
    GameEngine.prototype.battleAction = async function (actorId, kind, id, targetIndex, handlers) {
        var action = { actorId: actorId, kind: kind, id: id, targetIndex: targetIndex };
        this.validateBattleActions([action], false);
        var reports = await this.runBattleTurn([action], handlers);
        return reports.find(function (report) { return report.subject === 'actor' && report.subjectId === actorId; });
    };
    GameEngine.prototype.runBattleTurn = async function (actions, handlers) {
        var runtime = this.battle, battle = runtime.battle, context = this.battleContext || {}, engine = this;
        this.validateBattleActions(actions, false);
        battle.managed = true; if (!battle.extraTurn) battle.turn++; battle.forcedThisTurn = [];
        battle.inputActions = []; battle.turnActions = []; battle.turnEffects = [];
        try {
            if (context.signal && context.signal.aborted) throw context.signal.reason;
            await this.runBattlePages(false, handlers || context.handlers, context.signal);
            if (battle.result) return battle.turnActions;
            var queue = actions.map(function (action) { return Object.assign({}, action); });
            runtime.aliveActors().forEach(function (actor) {
                if (!runtime.takesTurn(actor)) return;
                if (queue.some(function (action) { return action.actorId === actor.id; })) return;
                if (runtime.confusionLevel(actor)) {
                    queue.push({ actorId: actor.id, kind: 'skill', id: 1, targetIndex: -1 });
                } else if (runtime.isAutoBattle(actor)) {
                    var action = runtime.chooseActorAction(actor);
                    if (action) queue.push(action);
                }
            });
            runtime.enemyActions().forEach(function (action) { queue.push({ enemy: action.enemy, kind: 'skill', id: action.skillId, targetIndex: -1 }); });
            queue.forEach(function (action, index) {
                var subject = action.enemy == null ? runtime.actor(action.actorId) : runtime.enemy(action.enemy);
                var data = action.kind === 'item' ? engine.database.Items[action.id] : runtime.skillFor(subject, action.id);
                action.order = index;
                action.speed = subject ? runtime.actionSpeed(subject, data, action.kind === 'skill' && action.id === 1) : -Infinity;
            });
            queue.sort(function (a, b) { return b.speed - a.speed || a.order - b.order; });
            for (var index = 0; index < queue.length && !battle.result; index++) {
                if (context.signal && context.signal.aborted) throw context.signal.reason;
                var action = queue[index], enemy = action.enemy != null;
                var subject = enemy ? runtime.enemy(action.enemy) : runtime.actor(action.actorId);
                if (this.state.scene !== 'battle') { runtime.finish('abort'); break; }
                if (!subject || !runtime.takesTurn(subject) || (battle.forcedThisTurn || []).includes(enemy ? 'enemy:' + action.enemy : 'actor:' + action.actorId)) continue;
                if (runtime.confusionLevel(subject)) { action.kind = 'skill'; action.id = 1; action.targetIndex = -1; }
                var data = action.kind === 'item' ? this.database.Items[action.id] : runtime.skillFor(subject, action.id);
                if (!(action.kind === 'item' ? runtime.canUseItem(subject, data) : runtime.canUseSkill(subject, data))) continue;
                if (!enemy && action.kind === 'skill' && ![1, 2].includes(action.id) && !runtime.actorSkills(action.actorId).some(function (skill) { return skill.id === action.id; })) continue;
                battle.phase = 'action';
                var report = action.kind === 'item' ? runtime.useItem(subject, action.id, action.targetIndex, true) : runtime.useSkill(subject, action.id, action.targetIndex, false, true);
                if (action.autoBattle && !report.confusion) report.autoBattle = true;
                battle.turnActions.push(report);
                await this.completeBattleAction(report, handlers || context.handlers, context.signal);
                await this.runBattlePages(false, handlers || context.handlers, context.signal);
            }
            if (!battle.result) {
                runtime.endTurn();
                await this.runBattlePages(true, handlers || context.handlers, context.signal);
            }
            return battle.turnActions;
        } catch (error) { battle.error = error.message; runtime.finish('abort'); throw error; }
        finally {
            if (!battle.result) await this.nextBattleInput(handlers || context.handlers);
            else if (!this.battleContext) this.leaveBattle(battle.result);
        }
    };

    GameEngine.prototype.battleEscape = async function (handlers) {
        var runtime = this.battle, battle = runtime.battle, context = this.battleContext || {};
        if (this.state.scene !== 'battle' || !battle || battle.result || battle.phase !== 'input' || !battle.canEscape) return false;
        battle.managed = true;
        battle.inputActions = []; battle.turnEffects = [];
        if (runtime.escape()) {
            if (!this.battleContext) this.leaveBattle(battle.result);
            return true;
        }
        if (!battle.extraTurn) battle.turn++;
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
            if (!battle.result) await this.nextBattleInput(handlers || context.handlers);
            else if (!this.battleContext) this.leaveBattle(battle.result);
        }
    };

    GameEngine.prototype.nextBattleInput = async function (handlers) {
        var runtime = this.battle, battle = runtime.battle;
        runtime.prepareNextInput(); battle.phase = 'input';
        // Khi chỉ địch có lượt bổ sung, tiếp tục AI để người chơi không phải
        // xác nhận một lượt mà cả đội không có quyền hành động.
        if (battle.extraTurn && !runtime.aliveActors().some(function (actor) { return runtime.takesTurn(actor); })) {
            var escapeFailed = battle.escapeFailed;
            await this.startBattleTurn(handlers);
            battle.escapeFailed = escapeFailed;
        }
    };

    GameEngine.prototype.leaveBattle = function (result, interpreter) {
        this.animations.clearBattle();
        if (result === 'defeat' && this.state.hasPartyNameCheat()) result = 'escape';
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
        var transitionWaiter = interpreter || this.createInterpreter([],0,handlers,context.signal);
        this.state.scene = 'battle';
        try {
            if (handlers && handlers.battleAudio) handlers.battleAudio('start', runtime.battle);
            if (handlers && handlers.battleTransition) {
                runtime.battle.phase = 'transition';
                await transitionWaiter.awaitCommand(handlers.battleTransition('start',runtime.battle,context.signal));
            }
            await this.runBattlePages(false, handlers, context.signal);
            if (!runtime.battle.result) runtime.battle.phase = 'input';
            var result = await runtime.wait(context.signal);
            if (runtime.battle.error) throw new Error(runtime.battle.error);
            if (handlers && handlers.battleTransition) await transitionWaiter.awaitCommand(handlers.battleTransition('out',runtime.battle,context.signal));
            var branch = this.leaveBattle(result, interpreter);
            if (handlers && handlers.battleTransition) await transitionWaiter.awaitCommand(handlers.battleTransition('in',runtime.battle,context.signal));
            return branch;
        } catch (error) { runtime.finish('abort'); throw error; }
        finally {
            if (handlers && handlers.battleTransition) handlers.battleTransition('cancel',runtime.battle);
            if (this.battleContext === context) this.battleContext = null;
            if (this.state.scene === 'battle') this.state.scene = 'map';
            if (handlers && handlers.battleAudio) handlers.battleAudio('end', runtime.battle);
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

    GameEngine.prototype.runCommonEvent = async function (id, handlers, signal) {
        if (!this.state || this.state.scene !== 'map' || this.eventRunning || this.messageRunning || this.stepRunning) return false;
        var interpreter = this.commonInterpreterFor(id, handlers, signal);
        this.eventRunning = true;
        try { await interpreter.run(); return true; }
        finally { this.eventRunning = false; }
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
                delete engine.state.motion; engine.state.moveFrames = 0;
                if (direction && !engine.state.directionFixed) engine.state.direction = direction;
                engine.state.followers(true);
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
        if (this.audio) this.state.audio = this.audio.saveState();
        var snapshot = this.state.toJSON();
        snapshot.screen.tweens = snapshot.screen.tweens.filter(function (track) { return !track.enemyEffects; });
        return snapshot;
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
        // Bản cũ đọc ngược 216: cờ false được ghi sau lệnh hiện người đi theo.
        // Chỉ sửa save cũ; save mới vẫn giữ đúng các cảnh chủ động ẩn đồng đội.
        if (snapshot.followerVisibilityVersion == null && snapshot.followersVisible === false) {
            snapshot = Object.assign({}, snapshot, {followersVisible:true});
        }
        var state = new stateApi.GameState(snapshot, this.database, this.random);
        var map = await this.prepareMap(state.mapId, state);
        if (!map.isValid(state.x, state.y) || !mapApi.DIRECTION_BITS[state.direction]) throw new Error('Vị trí trong save không hợp lệ.');
        this.state = state;
        this.state.onStateChange = this.onStateChange;
        if (this.screen) this.screen.dispose();
        this.screen = new screenApi.ScreenRuntime(state);
        this.lighting = new lightingApi.LightingRuntime(state);
        if (this.filters) this.filters.dispose();
        this.filters = new filterApi.FilterRuntime(state);
        if (this.animations) this.animations.dispose();
        this.animations = new animationApi.AnimationRuntime(this);
        this.battle = new battleApi.BattleRuntime(this.state, this.database, this.random, this.onStateChange, this.onBattleSound);
        if (this.movement) this.movement.clear();
        this.map = map;
        this.screen.showMapName(map.data.displayName);
        this.lighting.sources(map);
        this.pendingTouchEvents = [];
        this.resetMovement(state.routeSnapshots);
        if ((map.loopX() || map.loopY()) && (!state.screen.mapCamera || state.screen.mapCamera.mapId !== map.id)) this.resetCamera();
        if (this.audio) {
            this.audio.restoreState(state.audio);
            if (!state.audio) this.playMapAudio();
            if (state.scene === 'battle' && this.battle.battle && !this.battle.battle.result) {
                this.audio.beginBattle(this.battle.battle, state, this.database.System);
            }
        }
        return this;
    };

    return { GameEngine: GameEngine };
}));
