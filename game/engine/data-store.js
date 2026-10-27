'use strict';

// Lớp dữ liệu độc lập cho engine web mới.
// File này không phụ thuộc runtime RPG Maker hoặc plugin của game gốc.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.FNHStandaloneData = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var DATABASE_FILES = [
        'Actors', 'Animations', 'Armors', 'Classes', 'CommonEvents',
        'Enemies', 'Items', 'MapInfos', 'Skills', 'States', 'System',
        'Tilesets', 'Troops', 'Weapons'
    ];

    function mapFileName(mapId) {
        if (!Number.isInteger(mapId) || mapId < 1 || mapId > 999) {
            throw new RangeError('ID bản đồ không hợp lệ: ' + mapId);
        }
        return 'Map' + String(mapId).padStart(3, '0') + '.json';
    }

    function joinUrl(baseUrl, relativePath) {
        var base = String(baseUrl || '').replace(/\/+$/, '');
        return base ? base + '/' + relativePath : relativePath;
    }

    function cloneDatabase(database) {
        var copy = {};
        Object.keys(database).forEach(function (key) {
            copy[key] = database[key];
        });
        return copy;
    }

    function GameDataStore(options) {
        options = options || {};
        this.baseUrl = options.baseUrl || '';
        this.fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? function (url) { return fetch(url); } : null);
        if (!this.fetchImpl) throw new Error('GameDataStore cần fetch hoặc fetchImpl.');
        this.database = null;
        this.mapCache = new Map();
        this.imageSizes = new Map();
    }

    GameDataStore.prototype.loadJson = async function (relativePath) {
        var url = joinUrl(this.baseUrl, relativePath);
        var response;
        try {
            response = await this.fetchImpl(url);
        } catch (error) {
            throw new Error('Không tải được ' + relativePath + ': ' + error.message);
        }
        if (!response || !response.ok) {
            var status = response && response.status ? ' (HTTP ' + response.status + ')' : '';
            throw new Error('Không tải được ' + relativePath + status);
        }
        try {
            return await response.json();
        } catch (error) {
            throw new Error('JSON không hợp lệ ở ' + relativePath + ': ' + error.message);
        }
    };

    GameDataStore.prototype.loadDatabase = async function () {
        var self = this;
        var entries = await Promise.all(DATABASE_FILES.map(async function (name) {
            return [name, await self.loadJson('data/' + name + '.json')];
        }));
        this.database = {};
        entries.forEach(function (entry) {
            self.database[entry[0]] = entry[1];
        });
        return cloneDatabase(this.database);
    };

    GameDataStore.prototype.loadImageSize = function (relativePath) {
        if (!this.imageSizes.has(relativePath)) {
            var store = this;
            var loading = (async function () {
                var response = await store.fetchImpl(joinUrl(store.baseUrl,relativePath));
                if (!response || !response.ok) throw new Error('Không tải được ' + relativePath);
                var data = new DataView(await response.arrayBuffer());
                if (data.byteLength < 24 || data.getUint32(0) !== 0x89504e47 || data.getUint32(4) !== 0x0d0a1a0a ||
                    data.getUint32(12) !== 0x49484452 || !data.getUint32(16) || !data.getUint32(20)) throw new Error('PNG không hợp lệ: ' + relativePath);
                return {width:data.getUint32(16),height:data.getUint32(20)};
            }());
            this.imageSizes.set(relativePath,loading);
            loading.catch(function () { store.imageSizes.delete(relativePath); });
        }
        return this.imageSizes.get(relativePath);
    };

    GameDataStore.prototype.loadMap = async function (mapId) {
        var filename = mapFileName(mapId);
        if (!this.mapCache.has(mapId)) {
            this.mapCache.set(mapId, this.loadJson('data/' + filename));
        }
        return this.mapCache.get(mapId);
    };

    GameDataStore.prototype.clearMapCache = function () {
        this.mapCache.clear();
    };

    GameDataStore.prototype.getDatabase = function () {
        if (!this.database) throw new Error('Chưa gọi loadDatabase().');
        return cloneDatabase(this.database);
    };

    return {
        DATABASE_FILES: DATABASE_FILES.slice(),
        GameDataStore: GameDataStore,
        mapFileName: mapFileName
    };
}));
