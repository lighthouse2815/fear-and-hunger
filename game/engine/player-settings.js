'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneSettings = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var defaults = { ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up',
        Enter: 'ok', ' ': 'ok', z: 'ok', x: 'cancel', Escape: 'cancel', Shift: 'shift',
        PageUp: 'pageup', PageDown: 'pagedown', q: 'pageup', w: 'pagedown', t: 'torch', c: 'skill' };
    var actions = ['down', 'left', 'right', 'up', 'ok', 'cancel', 'shift', 'pageup', 'pagedown', 'torch', 'skill'];
    var categories = ['master', 'bgm', 'bgs', 'me', 'se'];
    function keyName(key) { return key.length === 1 ? key.toLowerCase() : key; }
    function validKey(key) { return /^[a-z0-9 ;,.\/'\[\]\\=\-`]$/.test(key) || /^(Arrow(Down|Left|Right|Up)|Enter|Escape|Shift|PageUp|PageDown|Tab|Home|End|Insert|Delete)$/.test(key); }
    function PlayerSettings(options) {
        options = options || {};
        this.storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        this.key = options.key || 'FNH_STANDALONE_SETTINGS';
        this.volumes = { master: 100, bgm: 100, bgs: 100, me: 100, se: 100 };
        this.keys = Object.assign({}, defaults); this.alwaysDash = true;
        var saved;
        try { saved = this.storage && JSON.parse(this.storage.getItem(this.key)); } catch (_) {}
        if (!saved || saved.version !== 1) return;
        categories.forEach(function (category) {
            var value = saved.volumes && saved.volumes[category];
            if (Number.isFinite(value)) this.volumes[category] = Math.max(0, Math.min(100, value));
        }, this);
        if (typeof saved.alwaysDash === 'boolean') this.alwaysDash = saved.alwaysDash;
        if (saved.keys && typeof saved.keys === 'object') Object.keys(saved.keys).forEach(function (key) {
            if (validKey(key) && (actions.includes(saved.keys[key]) || saved.keys[key] === '')) this.keys[key] = saved.keys[key];
        }, this);
    }
    PlayerSettings.prototype.save = function () {
        if (this.storage) this.storage.setItem(this.key, JSON.stringify({ version: 1, volumes: this.volumes, keys: this.keys, alwaysDash: this.alwaysDash }));
    };
    PlayerSettings.prototype.setVolume = function (category, value) {
        if (!categories.includes(category) || !Number.isFinite(value)) throw new Error('Thiết lập âm lượng không hợp lệ.');
        var before = this.volumes[category]; this.volumes[category] = Math.max(0, Math.min(100, value));
        try { this.save(); } catch (error) { this.volumes[category] = before; throw error; }
    };
    PlayerSettings.prototype.actionFor = function (key) { return this.keys[keyName(key)] || ''; };
    PlayerSettings.prototype.bind = function (key, action) {
        key = keyName(key);
        if (!validKey(key) || action !== '' && !actions.includes(action)) throw new Error('Thiết lập phím không hợp lệ.');
        var before = this.keys[key]; this.keys[key] = action;
        try { this.save(); } catch (error) { if (before === undefined) delete this.keys[key]; else this.keys[key] = before; throw error; }
    };
    PlayerSettings.prototype.layout = function (wasd) {
        var before = this.keys;
        this.keys = Object.assign({}, defaults, wasd ? { w: 'up', a: 'left', s: 'down', d: 'right' } : {});
        try { this.save(); } catch (error) { this.keys = before; throw error; }
    };
    return { PlayerSettings: PlayerSettings, actions: actions.slice(), categories: categories.slice() };
}));
