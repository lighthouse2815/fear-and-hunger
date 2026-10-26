'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneSave = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function SaveStore(options) {
        options = options || {};
        this.storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        this.prefix = options.prefix || 'FNH_STANDALONE:';
        if (!this.storage) throw new Error('SaveStore cần localStorage hoặc storage tương thích.');
    }

    SaveStore.prototype.key = function (slot) {
        if (!Number.isInteger(slot) || slot < 0) throw new RangeError('Ô lưu không hợp lệ: ' + slot);
        return this.prefix + String(slot);
    };

    SaveStore.prototype.save = function (slot, state) {
        if (!state || typeof state !== 'object') throw new TypeError('State lưu không hợp lệ.');
        var payload = { version: 1, savedAt: new Date().toISOString(), state: state };
        this.storage.setItem(this.key(slot), JSON.stringify(payload));
        return payload;
    };

    SaveStore.prototype.load = function (slot) {
        var value = this.storage.getItem(this.key(slot));
        if (!value) return null;
        var payload;
        try { payload = JSON.parse(value); }
        catch (error) { throw new Error('Ô lưu bị hỏng: ' + slot); }
        if (!payload || payload.version !== 1 || !payload.state) throw new Error('Ô lưu không tương thích: ' + slot);
        return payload.state;
    };

    SaveStore.prototype.exists = function (slot) {
        return this.storage.getItem(this.key(slot)) !== null;
    };

    SaveStore.prototype.remove = function (slot) {
        this.storage.removeItem(this.key(slot));
    };

    return { SaveStore: SaveStore };
}));
