'use strict';

// Facade gameplay độc lập, kết nối data store, state, map và event interpreter.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./data-store'), require('./game-state'),
            require('./map-model'), require('./event-interpreter')
        );
    } else {
        root.FNHStandaloneEngine = factory(
            root.FNHStandaloneData, root.FNHStandaloneState,
            root.FNHStandaloneMap, root.FNHStandaloneEvents
        );
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (dataApi, stateApi, mapApi, eventApi) {
    function GameEngine(options) {
        options = options || {};
        this.dataStore = options.dataStore || new dataApi.GameDataStore({ baseUrl: options.baseUrl || '' });
        this.database = null;
        this.state = null;
        this.map = null;
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

    GameEngine.prototype.loadMap = async function (mapId) {
        if (!this.database || !this.state) throw new Error('Engine chưa boot.');
        var data = await this.dataStore.loadMap(mapId);
        this.state.mapId = mapId;
        this.map = new mapApi.GameMap(Object.assign({ id: mapId }, data), this.database.Tilesets[data.tilesetId], this.state);
        return this.map;
    };

    GameEngine.prototype.move = function (direction) {
        if (!this.map || !this.state) throw new Error('Engine chưa boot.');
        if (!this.map.isPassable(this.state.x, this.state.y, direction)) return false;
        this.state.x += direction === 4 ? -1 : direction === 6 ? 1 : 0;
        this.state.y += direction === 8 ? -1 : direction === 2 ? 1 : 0;
        this.state.direction = direction;
        return true;
    };

    GameEngine.prototype.runEvent = async function (eventId, handlers) {
        if (!this.map || !this.state) throw new Error('Engine chưa boot.');
        var event = this.map.events.find(function (entry) { return entry.id === eventId; });
        if (!event) throw new Error('Không tìm thấy event ' + eventId + ' trên map ' + this.state.mapId);
        var page = this.map.eventPage(event, this.state);
        if (!page) return null;
        var engine = this;
        var eventHandlers = Object.assign({}, handlers || {});
        var transfer = eventHandlers.transfer;
        eventHandlers.transfer = async function (destination, interpreter) {
            await engine.loadMap(destination.mapId);
            if (transfer) return transfer(destination, interpreter);
        };
        return new eventApi.EventInterpreter({
            commands: page.list, state: this.state, mapId: this.state.mapId,
            eventId: event.id, handlers: eventHandlers
        }).run();
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
        this.state = new stateApi.GameState(snapshot, this.database);
        await this.loadMap(this.state.mapId);
        return this;
    };

    return { GameEngine: GameEngine };
}));
