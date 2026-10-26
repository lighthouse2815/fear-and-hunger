'use strict';

// Trạng thái gameplay tối thiểu của engine web độc lập.
// Các event JSON sẽ dùng lớp này thay cho Game_Variables/Game_Switches/Game_Party.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./actor-state'));
    } else {
        root.FNHStandaloneState = factory(root.FNHStandaloneActors);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (actorApi) {
    function positiveId(id, label) {
        if (!Number.isInteger(id) || id < 1) throw new RangeError(label + ' không hợp lệ: ' + id);
        return id;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function emptyState() {
        return {
            mapId: 0,
            x: 0,
            y: 0,
            direction: 2,
            gold: 0,
            party: [],
            inventory: { items: {}, weapons: {}, armors: {} },
            switches: {},
            variables: {},
            selfSwitches: {}
        };
    }

    function GameState(initial, database) {
        var source = Object.assign(emptyState(), clone(initial || {}));
        this.mapId = Number(source.mapId) || 0;
        this.x = Number(source.x) || 0;
        this.y = Number(source.y) || 0;
        this.direction = Number(source.direction) || 2;
        this.gold = Math.max(0, Number(source.gold) || 0);
        this.party = Array.isArray(source.party) ? source.party.slice() : [];
        this.actors = Object.assign({}, source.actors);
        this.database = database || null;
        this.inventory = {
            items: Object.assign({}, source.inventory && source.inventory.items),
            weapons: Object.assign({}, source.inventory && source.inventory.weapons),
            armors: Object.assign({}, source.inventory && source.inventory.armors)
        };
        this.switches = Object.assign({}, source.switches);
        this.variables = Object.assign({}, source.variables);
        this.selfSwitches = Object.assign({}, source.selfSwitches);
    }

    GameState.prototype.switchValue = function (id) {
        positiveId(id, 'ID công tắc');
        return this.switches[id] === true;
    };

    GameState.prototype.setSwitch = function (id, value) {
        positiveId(id, 'ID công tắc');
        this.switches[id] = Boolean(value);
    };

    GameState.prototype.variableValue = function (id) {
        positiveId(id, 'ID biến');
        return this.variables[id] || 0;
    };

    GameState.prototype.setVariable = function (id, value) {
        positiveId(id, 'ID biến');
        var number = Number(value);
        if (!Number.isFinite(number)) throw new TypeError('Giá trị biến không hợp lệ: ' + value);
        this.variables[id] = number;
    };

    GameState.prototype.selfSwitchKey = function (mapId, eventId, letter) {
        positiveId(mapId, 'ID bản đồ');
        positiveId(eventId, 'ID sự kiện');
        if (!/^[A-D]$/.test(letter)) throw new RangeError('Self-switch không hợp lệ: ' + letter);
        return mapId + ',' + eventId + ',' + letter;
    };

    GameState.prototype.selfSwitchValue = function (mapId, eventId, letter) {
        return this.selfSwitches[this.selfSwitchKey(mapId, eventId, letter)] === true;
    };

    GameState.prototype.setSelfSwitch = function (mapId, eventId, letter, value) {
        this.selfSwitches[this.selfSwitchKey(mapId, eventId, letter)] = Boolean(value);
    };

    GameState.prototype.actor = function (id) {
        positiveId(id, 'ID actor');
        return this.actors[id] || null;
    };

    GameState.prototype.hasActor = function (id) {
        return this.party.indexOf(id) >= 0;
    };

    GameState.prototype.addActor = function (id, data) {
        positiveId(id, 'ID actor');
        if (!data && this.database && this.database.Actors) data = this.database.Actors[id];
        if (!data) throw new Error('Thiếu dữ liệu actor ' + id);
        var classData = this.database && this.database.Classes && this.database.Classes[data.classId];
        if (!this.actors[id]) this.actors[id] = new actorApi.ActorState(data, classData).toJSON();
        if (!this.hasActor(id)) this.party.push(id);
    };

    GameState.prototype.removeActor = function (id) {
        this.party = this.party.filter(function (actorId) { return actorId !== id; });
    };

    GameState.prototype.changeActorHp = function (id, amount, allowDeath) {
        var actor = this.actor(id);
        if (!actor || !this.database || !this.database.Actors[id]) return false;
        var data = this.database.Actors[id];
        var classData = this.database.Classes && this.database.Classes[data.classId];
        var state = new actorApi.ActorState(data, classData, actor);
        state.changeHp(data, classData, amount, allowDeath);
        this.actors[id] = state.toJSON();
        return true;
    };

    GameState.prototype.changeActorMp = function (id, amount) {
        var actor = this.actor(id);
        if (!actor || !this.database || !this.database.Actors[id]) return false;
        var data = this.database.Actors[id];
        var classData = this.database.Classes && this.database.Classes[data.classId];
        var state = new actorApi.ActorState(data, classData, actor);
        state.changeMp(data, classData, amount);
        this.actors[id] = state.toJSON();
        return true;
    };

    GameState.prototype.changeActorState = function (id, stateId, add) {
        var actor = this.actor(id);
        if (!actor) return false;
        var states = actor.states.slice();
        if (add && states.indexOf(stateId) < 0) states.push(stateId);
        if (!add) states = states.filter(function (value) { return value !== stateId; });
        actor.states = states;
        return true;
    };

    GameState.prototype.gainItem = function (kind, id, amount) {
        positiveId(id, 'ID vật phẩm');
        if (!Object.prototype.hasOwnProperty.call(this.inventory, kind)) {
            throw new RangeError('Loại vật phẩm không hợp lệ: ' + kind);
        }
        var quantity = Number(amount);
        if (!Number.isFinite(quantity)) throw new TypeError('Số lượng vật phẩm không hợp lệ: ' + amount);
        var key = String(id);
        var next = (this.inventory[kind][key] || 0) + quantity;
        if (next > 0) this.inventory[kind][key] = Math.floor(next);
        else delete this.inventory[kind][key];
    };

    GameState.prototype.itemCount = function (kind, id) {
        positiveId(id, 'ID vật phẩm');
        if (!Object.prototype.hasOwnProperty.call(this.inventory, kind)) {
            throw new RangeError('Loại vật phẩm không hợp lệ: ' + kind);
        }
        return this.inventory[kind][String(id)] || 0;
    };

    GameState.prototype.toJSON = function () {
        return clone({
            mapId: this.mapId,
            x: this.x,
            y: this.y,
            direction: this.direction,
            gold: this.gold,
            party: this.party,
            actors: this.actors,
            inventory: this.inventory,
            switches: this.switches,
            variables: this.variables,
            selfSwitches: this.selfSwitches
        });
    };

    return { GameState: GameState };
}));
