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
            return Object.assign({ direction: 2 }, event, location && { x: location.x, y: location.y, direction: location.direction });
        }, this);
        this.events.forEach(function (event) {
            var page = this.eventPage(event);
            var snapshot = state && state.eventSnapshots && state.eventSnapshots[event.id];
            if (snapshot && snapshot.mapId === this.id && (snapshot.properties.erased || snapshot.pageIndex === event.pages.indexOf(page))) {
                Object.assign(event, snapshot.properties);
            } else {
                var location = state && state.eventLocations && state.eventLocations[this.id + ',' + event.id];
                if (location && location.direction) event.direction = location.direction;
            }
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

    GameMap.prototype.terrainTag = function (x, y) {
        for (var layer = 3; layer >= 0; layer--) {
            var tag = (this.tileset.flags[this.tileId(x, y, layer)] || 0) >> 12;
            if (tag) return tag;
        }
        return 0;
    };

    GameMap.prototype.viewport = function (player, width, height) {
        var cols = Math.ceil(width / 48), rows = Math.ceil(height / 48);
        var camera = this.state && this.state.screen && this.state.screen.mapCamera;
        return {
            startX: Math.max(0, Math.min(this.width - cols, camera && camera.mapId === this.id ? camera.x : player.x - Math.floor(cols / 2))),
            startY: Math.max(0, Math.min(this.height - rows, camera && camera.mapId === this.id ? camera.y : player.y - Math.floor(rows / 2)))
        };
    };

    GameMap.prototype.findDirection = function (character, target, limit) {
        var queue = [{ x: character.x, y: character.y, depth: 0, direction: 0 }], visited = new Set();
        var distance = function (point) { return Math.abs(point.x - target.x) + Math.abs(point.y - target.y); };
        var best = queue[0], directions = [2, 4, 6, 8];
        visited.add(character.x + ',' + character.y);
        for (var index = 0; index < queue.length; index++) {
            var point = queue[index];
            if (distance(point) === 0) return point.direction;
            if (distance(point) < distance(best)) best = point;
            if (point.depth >= (limit || 12)) continue;
            for (var direction of directions) {
                var x = point.x + (direction === 4 ? -1 : direction === 6 ? 1 : 0);
                var y = point.y + (direction === 8 ? -1 : direction === 2 ? 1 : 0);
                var key = x + ',' + y;
                if (visited.has(key) || !this.isValid(x, y)) continue;
                if (!character.through && (!this.isPassable(point.x, point.y, direction) || this.eventBlocks(x, y, character.id))) continue;
                visited.add(key);
                queue.push({ x: x, y: y, depth: point.depth + 1, direction: point.direction || direction });
            }
        }
        return best.direction;
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
        if (!event || event.erased || !Array.isArray(event.pages)) return null;
        for (var i = event.pages.length - 1; i >= 0; i -= 1) {
            if (this.pageConditionsMet(event.pages[i].conditions || {}, currentState, event.id)) {
                var page = event.pages[i];
                if (event.activePage !== page) {
                    event.activePage = page;
                    Object.assign(event, page.image, { directionFixed: !!page.directionFix,
                        through: !!page.through, priorityType: page.priorityType,
                        walkAnime: page.walkAnime, stepAnime: page.stepAnime,
                        moveSpeed: page.moveSpeed, moveFrequency: page.moveFrequency,
                        opacity: 255, blendMode: 0, transparent: false,
                        chaseRange: 0, seePlayer: true, alertSound: 'horror_chord', autonomous: null });
                }
                return page;
            }
        }
        event.activePage = null;
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

    GameMap.prototype.eventBlocks = function (x, y, exceptId) {
        return this.eventAt(x, y).some(function (event) {
            var page = this.eventPage(event);
            return event.id !== exceptId && page && page.priorityType === 1 && !event.through;
        }, this);
    };

    GameMap.prototype.snapshotEvents = function () {
        var snapshot = {}, map = this;
        this.events.forEach(function (event) {
            var page = map.eventPage(event), properties = {};
            ['x', 'y', 'direction', 'pattern', 'characterName', 'characterIndex', 'tileId', 'moveSpeed',
                'moveFrequency', 'directionFixed', 'through', 'transparent', 'opacity', 'blendMode',
                'walkAnime', 'stepAnime', 'chaseRange', 'seePlayer', 'alertSound', 'moveFrames', 'animationFrames', 'erased', 'autonomous', 'balloon'].forEach(function (key) {
                if (event[key] !== undefined) properties[key] = event[key];
            });
            snapshot[event.id] = { mapId: map.id, pageIndex: event.pages.indexOf(page), properties: properties };
        });
        return snapshot;
    };

    return { GameMap: GameMap, DIRECTION_BITS: Object.assign({}, DIRECTION_BITS) };
}));
