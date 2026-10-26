'use strict';

// Facade gameplay độc lập, kết nối data store, state, map và event interpreter.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./data-store'), require('./game-state'),
            require('./map-model'), require('./event-interpreter'), require('./script-runtime')
        );
    } else {
        root.FNHStandaloneEngine = factory(
            root.FNHStandaloneData, root.FNHStandaloneState,
            root.FNHStandaloneMap, root.FNHStandaloneEvents, root.FNHStandaloneScripts
        );
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (dataApi, stateApi, mapApi, eventApi, scriptApi) {
    function GameEngine(options) {
        options = options || {};
        this.dataStore = options.dataStore || new dataApi.GameDataStore({ baseUrl: options.baseUrl || '' });
        this.random = options.random || Math.random;
        this.database = null;
        this.state = null;
        this.map = null;
        this.eventRunning = false;
        this.stepRunning = false;
    }

    GameEngine.prototype.boot = async function (initialState) {
        this.database = await this.dataStore.loadDatabase();
        var system = this.database.System;
        var state = initialState || {
            mapId: system.startMapId,
            x: system.startX,
            y: system.startY,
            direction: 2,
            party: []
        };
        this.state = new stateApi.GameState(state, this.database);
        this.state.party.slice().forEach(function (actorId) {
            if (!this.state.actor(actorId) && this.database.Actors[actorId]) this.state.addActor(actorId);
        }, this);
        await this.loadMap(this.state.mapId);
        return this;
    };

    GameEngine.prototype.prepareMap = async function (mapId, state) {
        var data = await this.dataStore.loadMap(mapId);
        return new mapApi.GameMap(Object.assign({}, data, { id: mapId }), this.database.Tilesets[data.tilesetId], state);
    };

    GameEngine.prototype.loadMap = async function (mapId, destination) {
        if (!this.database || !this.state) throw new Error('Engine chưa boot.');
        var map = await this.prepareMap(mapId, this.state);
        if (destination && (!map.isValid(destination.x, destination.y) ||
            (destination.direction && !mapApi.DIRECTION_BITS[destination.direction]))) {
            throw new Error('Đích chuyển bản đồ không hợp lệ.');
        }
        if (this.map && this.map.id !== mapId) this.map.discardTemporaryLocations();
        this.state.mapId = mapId;
        this.map = map;
        if (destination) {
            this.state.x = destination.x;
            this.state.y = destination.y;
            if (destination.direction && !this.state.directionFixed) this.state.direction = destination.direction;
        }
        return this.map;
    };

    GameEngine.prototype.move = function (direction) {
        if (!this.map || !this.state) throw new Error('Engine chưa boot.');
        if (this.eventRunning || !mapApi.DIRECTION_BITS[direction]) return false;
        if (!this.state.directionFixed) this.state.direction = direction;
        var x = this.state.x + (direction === 4 ? -1 : direction === 6 ? 1 : 0);
        var y = this.state.y + (direction === 8 ? -1 : direction === 2 ? 1 : 0);
        if (!this.map.isValid(x, y)) return false;
        if (!this.state.through && (!this.map.isPassable(this.state.x, this.state.y, direction) || this.map.eventBlocks(x, y))) return false;
        this.state.x = x;
        this.state.y = y;
        return true;
    };

    GameEngine.prototype.step = async function (direction, handlers) {
        if (!this.map || !this.state) throw new Error('Engine chưa boot.');
        if (this.eventRunning || this.stepRunning || !mapApi.DIRECTION_BITS[direction]) return false;
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
        if (this.eventRunning || this.stepRunning) return null;
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

    GameEngine.prototype.runEvent = async function (eventId, handlers) {
        if (!this.map || !this.state) throw new Error('Engine chưa boot.');
        if (this.eventRunning) throw new Error('Một sự kiện khác đang chạy.');
        var event = this.map.eventById(eventId);
        if (!event) throw new Error('Không tìm thấy event ' + eventId + ' trên map ' + this.state.mapId);
        var page = this.map.eventPage(event, this.state);
        if (!page) return null;
        var engine = this;
        var eventHandlers = Object.assign({}, handlers || {});
        eventHandlers.script = function (source, interpreter) {
            return scriptApi.executeScript(source, { state: engine.state,
                character: engine.map.id === interpreter.mapId ? engine.map.eventById(interpreter.eventId) : null });
        };
        var transfer = eventHandlers.transfer;
        eventHandlers.transfer = async function (destination, interpreter) {
            await engine.loadMap(destination.mapId, destination);
            if (transfer) return transfer(destination, interpreter);
        };
        var effect = eventHandlers.effect;
        eventHandlers.effect = function (code, parameters, command, interpreter) {
            if (code === 203) { engine.setEventLocation(parameters, interpreter); return true; }
            if (code === 205) { engine.applyPlayerRoute(parameters); return true; }
            return effect ? effect(code, parameters, command, interpreter) : false;
        };
        this.eventRunning = true;
        try {
            return await new eventApi.EventInterpreter({
                commands: page.list, state: this.state, mapId: this.state.mapId,
                eventId: event.id, handlers: eventHandlers, commonEvents: this.database.CommonEvents, random: this.random
            }).run();
        } finally { this.eventRunning = false; }
    };

    GameEngine.prototype.setEventLocation = function (parameters, interpreter) {
        var id = parameters[0] === 0 ? interpreter.eventId : parameters[0];
        if (id >= 0 && this.map.id !== interpreter.mapId) return;
        var character = id < 0 ? this.state : this.map.eventById(id);
        if (!character) return;
        var engine = this;
        function locate(targetId, x, y, direction) {
            if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('Tọa độ nhân vật không hợp lệ.');
            if (targetId < 0) {
                engine.state.x = x; engine.state.y = y;
                if (direction && !engine.state.directionFixed) engine.state.direction = direction;
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

    GameEngine.prototype.applyPlayerRoute = function (parameters) {
        var route = parameters[1];
        if (parameters[0] !== -1 || !route || !Array.isArray(route.list) || route.repeat) {
            throw new Error('Chưa hỗ trợ kiểu movement route này.');
        }
        for (var i = 0; i < route.list.length; i++) {
            var code = route.list[i].code;
            if (code === 0) break;
            if (![35, 36, 37, 38].includes(code)) throw new Error('Chưa hỗ trợ lệnh movement route ' + code);
        }
        for (var j = 0; j < i; j++) {
            var current = route.list[j].code;
            if (current === 35 || current === 36) this.state.directionFixed = current === 35;
            if (current === 37 || current === 38) this.state.through = current === 37;
        }
    };

    GameEngine.prototype.save = function () {
        if (!this.state) throw new Error('Engine chưa boot.');
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
        this.map = map;
        return this;
    };

    return { GameEngine: GameEngine };
}));
