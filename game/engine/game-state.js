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
        this.directionFixed = source.directionFixed === true;
        this.through = source.through === true;
        this.touchEnabled = source.touchEnabled !== false;
        this.eventSnapshots = Object.assign({}, source.eventSnapshots);
        this.routeSnapshots = Array.isArray(source.routeSnapshots) ? source.routeSnapshots : [];
        this.screen = source.screen || null;
        this.lighting = source.lighting || null;
        this.mapTileset = source.mapTileset || null;
        this.timer = source.timer || { active: false, frames: 0 };
        this.menuEnabled = source.menuEnabled !== false;
        this.saveEnabled = source.saveEnabled !== false;
        this.battleBgm = source.battleBgm || null;
        this.vehicleId = source.vehicleId == null ? -1 : source.vehicleId;
        this.wordWrap = source.wordWrap === true;
        this.pendingChoices = source.pendingChoices || { text: {}, disabled: [] };
        ['characterName', 'characterIndex', 'transparent', 'opacity', 'blendMode', 'moveSpeed', 'moveFrequency', 'walkAnime', 'stepAnime', 'moveFrames', 'animationFrames', 'balloon'].forEach(function (key) {
            if (source[key] !== undefined) this[key] = source[key];
        }, this);
        this.eventLocations = Object.assign({}, source.eventLocations);
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

    GameState.prototype.actor = function (id, data) {
        positiveId(id, 'ID actor');
        if (!this.actors[id]) {
            data = data || (this.database && this.database.Actors && this.database.Actors[id]);
            if (data) {
                var classData = this.database && this.database.Classes && this.database.Classes[data.classId];
                this.actors[id] = new actorApi.ActorState(data, classData, null, this.database).toJSON();
            }
        }
        return this.actors[id] || null;
    };

    GameState.prototype.hasActor = function (id) {
        return this.party.indexOf(id) >= 0;
    };

    GameState.prototype.addActor = function (id, data) {
        positiveId(id, 'ID actor');
        if (!this.actor(id, data)) throw new Error('Thiếu dữ liệu actor ' + id);
        if (!this.hasActor(id)) this.party.push(id);
    };

    GameState.prototype.removeActor = function (id) {
        this.party = this.party.filter(function (actorId) { return actorId !== id; });
    };

    GameState.prototype.updateActor = function (id, change) {
        var actor = this.actor(id), data = this.database && this.database.Actors[id];
        if (!actor || !data) return false;
        var classData = this.database.Classes && this.database.Classes[actor.classId || data.classId];
        var model = new actorApi.ActorState(data, classData, actor, this.database);
        change(model, data, classData);
        this.actors[id] = model.toJSON();
        return true;
    };

    GameState.prototype.actorParam = function (id, paramId) {
        var value = 0;
        this.updateActor(id, function (actor, data, classData) { value = actor.maxParam(data, classData, paramId); });
        return value;
    };

    GameState.prototype.changeActorExp = function (id, amount, levelChange) {
        return this.updateActor(id, function (actor, data, classData) {
            var exp = levelChange ? actorApi.expForLevel(classData, Math.max(1, Math.min(data.maxLevel || 99, actor.level + amount))) : actor.exp + amount;
            actor.setExp(data, exp);
        });
    };

    GameState.prototype.changeActorParam = function (id, paramId, amount) {
        return this.updateActor(id, function (actor, data, classData) {
            actor.paramPlus[paramId] = (actor.paramPlus[paramId] || 0) + amount;
            actor.hp = Math.min(actor.hp, actor.maxHp(data, classData));
            actor.mp = Math.min(actor.mp, actor.maxMp(data, classData));
        });
    };

    GameState.prototype.setActorMaxHp = function (id, value) {
        return this.updateActor(id, function (actor, data, classData) {
            actor.maxHpOverride = null;
            actor.paramPlus[0] = 0;
            actor.paramPlus[0] = Math.max(1, value) - actor.maxHp(data, classData);
            actor.hp = Math.min(actor.hp, actor.maxHp(data, classData));
        });
    };

    GameState.prototype.equipActor = function (id, slot, itemId) {
        var actor = this.actor(id);
        if (!actor || !Number.isInteger(slot) || slot < 0 || slot >= actor.equips.length) return false;
        var kind = slot === 0 ? 'weapons' : 'armors';
        var table = this.database[slot === 0 ? 'Weapons' : 'Armors'];
        if (itemId && (!table || !table[itemId] || table[itemId].etypeId !== slot + 1 || this.itemCount(kind, itemId) < 1)) return false;
        if (itemId) this.gainItem(kind, itemId, -1);
        if (actor.equips[slot]) this.gainItem(kind, actor.equips[slot], 1);
        actor.equips[slot] = itemId || 0;
        this.updateActor(id, function (model, data, classData) {
            model.hp = Math.min(model.hp, model.maxHp(data, classData));
            model.mp = Math.min(model.mp, model.maxMp(data, classData));
        });
        return true;
    };

    GameState.prototype.changeActorHp = function (id, amount, allowDeath) {
        return this.updateActor(id, function (actor, data, classData) { actor.changeHp(data, classData, amount, allowDeath); });
    };

    GameState.prototype.changeActorMp = function (id, amount) {
        return this.updateActor(id, function (actor, data, classData) { actor.changeMp(data, classData, amount); });
    };

    GameState.prototype.changeActorState = function (id, stateId, add) {
        var actor = this.actor(id);
        if (!actor) return false;
        var states = actor.states.slice();
        if (add && states.indexOf(stateId) < 0) states.push(stateId);
        if (!add) states = states.filter(function (value) { return value !== stateId; });
        actor.states = states;
        if (stateId === 1) actor.hp = add ? 0 : Math.max(1, actor.hp);
        return true;
    };

    GameState.prototype.recoverActor = function (id) {
        var actor = this.actor(id);
        if (!actor || !this.database || !this.database.Actors[id]) return false;
        var data = this.database.Actors[id];
        var classData = this.database.Classes && this.database.Classes[actor.classId || data.classId];
        var state = new actorApi.ActorState(data, classData, actor, this.database);
        state.states = [];
        actor.hp = state.maxHp(data, classData);
        actor.mp = state.maxMp(data, classData);
        actor.states = [];
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
            directionFixed: this.directionFixed,
            through: this.through,
            touchEnabled: this.touchEnabled,
            eventSnapshots: this.eventSnapshots,
            routeSnapshots: this.routeSnapshots,
            screen: this.screen, lighting: this.lighting, mapTileset: this.mapTileset,
            timer: this.timer, menuEnabled: this.menuEnabled, saveEnabled: this.saveEnabled, battleBgm: this.battleBgm, vehicleId: this.vehicleId,
            wordWrap: this.wordWrap, pendingChoices: this.pendingChoices,
            characterName: this.characterName, characterIndex: this.characterIndex,
            transparent: this.transparent, opacity: this.opacity, blendMode: this.blendMode,
            moveSpeed: this.moveSpeed, moveFrequency: this.moveFrequency, walkAnime: this.walkAnime, stepAnime: this.stepAnime,
            balloon: this.balloon,
            moveFrames: this.moveFrames, animationFrames: this.animationFrames,
            eventLocations: this.eventLocations,
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
