'use strict';

// Mô hình bản đồ độc lập, chỉ đọc định dạng tile/event JSON hiện có.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.FNHStandaloneMap = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var DIRECTION_BITS = { 2: 1, 4: 2, 6: 4, 8: 8 };

    function GameMap(data, tileset, state) {
        if (!data || !Number.isInteger(data.width) || !Number.isInteger(data.height)) {
            throw new TypeError('Dữ liệu bản đồ không hợp lệ.');
        }
        this.data = data;
        this.tileset = tileset || { flags: [] };
        this.state = state || null;
        this.id = data.id || 0;
        this.width = data.width;
        this.height = data.height;
        this.events = (data.events || []).filter(Boolean).map(function (event) {
            var location = state && state.eventLocations && state.eventLocations[this.id + ',' + event.id];
            return Object.assign({}, event, location && { x: location.x, y: location.y, direction: location.direction });
        }, this);
    }

    GameMap.prototype.isValid = function (x, y) {
        return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
    };

    GameMap.prototype.tileIndex = function (x, y, z) {
        if (!this.isValid(x, y)) return -1;
        return (z * this.height + y) * this.width + x;
    };

    GameMap.prototype.tileId = function (x, y, z) {
        var index = this.tileIndex(x, y, z);
        return index < 0 ? 0 : (this.data.data[index] || 0);
    };

    GameMap.prototype.regionId = function (x, y) {
        return this.tileId(x, y, 5);
    };

    GameMap.prototype.eventAt = function (x, y) {
        return this.events.filter(function (event) { return event.x === x && event.y === y; });
    };

    GameMap.prototype.eventById = function (id) {
        return this.events.find(function (event) { return event.id === id; }) || null;
    };

    GameMap.prototype.locateEvent = function (id, x, y, direction) {
        var event = this.eventById(id);
        if (!event) return;
        if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('Tọa độ sự kiện không hợp lệ.');
        event.x = x;
        event.y = y;
        if (direction) event.direction = direction;
        if (this.state) this.state.eventLocations[this.id + ',' + id] = {
            x: x, y: y, direction: event.direction,
            persist: /<save\s+event\s+locations?>/i.test(this.data.note || '') ||
                /<save\s+event\s+location>/i.test(event.note || '')
        };
    };

    GameMap.prototype.discardTemporaryLocations = function () {
        if (!this.state) return;
        Object.keys(this.state.eventLocations).forEach(function (key) {
            if (key.startsWith(this.id + ',') && !this.state.eventLocations[key].persist) delete this.state.eventLocations[key];
        }, this);
    };

    GameMap.prototype.eventPage = function (event, state) {
        var currentState = state || this.state;
        if (!event || !Array.isArray(event.pages)) return null;
        for (var i = event.pages.length - 1; i >= 0; i -= 1) {
            if (this.pageConditionsMet(event.pages[i].conditions || {}, currentState, event.id)) return event.pages[i];
        }
        return null;
    };

    GameMap.prototype.pageConditionsMet = function (conditions, state, eventId) {
        if (!state) return !conditions.switch1Valid && !conditions.switch2Valid && !conditions.selfSwitchValid &&
            !conditions.variableValid && !conditions.itemValid && !conditions.actorValid;
        if (conditions.switch1Valid && !state.switchValue(conditions.switch1Id)) return false;
        if (conditions.switch2Valid && !state.switchValue(conditions.switch2Id)) return false;
        if (conditions.selfSwitchValid && !state.selfSwitchValue(this.id, eventId, conditions.selfSwitchCh)) return false;
        if (conditions.variableValid && state.variableValue(conditions.variableId) < conditions.variableValue) return false;
        if (conditions.itemValid && state.itemCount('items', conditions.itemId) <= 0) return false;
        if (conditions.actorValid && state.party.indexOf(conditions.actorId) < 0) return false;
        return true;
    };

    GameMap.prototype.isPassable = function (x, y, direction) {
        if (!this.isValid(x, y)) return false;
        var bit = DIRECTION_BITS[direction];
        if (!bit) return false;
        var nx = x + (direction === 4 ? -1 : direction === 6 ? 1 : 0);
        var ny = y + (direction === 8 ? -1 : direction === 2 ? 1 : 0);
        if (!this.isValid(nx, ny)) return false;
        return this.tilePassable(x, y, bit) && this.tilePassable(nx, ny, bit === 1 ? 8 : bit === 8 ? 1 : bit === 2 ? 4 : 2);
    };

    GameMap.prototype.tilePassable = function (x, y, bit) {
        for (var z = 3; z >= 0; z -= 1) {
            var tileId = this.tileId(x, y, z);
            var flag = this.tileset.flags && this.tileset.flags[tileId] || 0;
            if ((flag & 0x10) !== 0) continue;
            return (flag & bit) === 0;
        }
        return false;
    };

    GameMap.prototype.eventBlocks = function (x, y) {
        return this.eventAt(x, y).some(function (event) {
            var page = this.eventPage(event);
            return page && page.priorityType === 1 && !page.through;
        }, this);
    };

    return { GameMap: GameMap, DIRECTION_BITS: Object.assign({}, DIRECTION_BITS) };
}));
