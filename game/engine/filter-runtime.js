'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(null);
    else root.FNHStandaloneFilters = factory(root.PIXI);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (pixi) {
    var DEFAULTS = { zoomblur: [0,0,0,0.1], adjustment: [1,1,1,1,1,1,1,1], rgbsplit: [0,0], 'godray-np': [0,0,0.5,2.5,1] };
    var CLASSES = { zoomblur: 'ZoomBlurFilter', adjustment: 'AdjustmentFilter', rgbsplit: 'RGBSplitFilter', 'godray-np': 'GodrayFilter' };
    function FilterRuntime(state) {
        this.filters = state.filters || {};
        state.filters = this.filters;
        this.revision = 0;
        this.instances = new Map(); this.textures = new Map();
        this.backend = null;
    }
    FilterRuntime.prototype.handleCommand = function (source) {
        var parts = String(source).trim().split(/\s+/), command = parts.shift(), id = parts.shift();
        if (command === 'createFilter') {
            var type = parts[0], target = Number(parts[1]);
            if (!Object.prototype.hasOwnProperty.call(DEFAULTS, type) || ![2,21].includes(target) || parts[2] !== 'screen' || parts.length !== 3 || !/^[\w#-]+$/.test(id || '') ||
                ['__proto__', 'constructor', 'prototype'].includes(id)) {
                throw new Error('Cấu hình filter chưa hỗ trợ: ' + source);
            }
            this.filters[id] = { id: id, type: type, target: target, parameters: DEFAULTS[type].slice(), time: 0 };
        } else if (command === 'setFilter') {
            var entry = Object.prototype.hasOwnProperty.call(this.filters, id) && this.filters[id], values = parts.map(Number);
            if (values.some(function (number) { return !Number.isFinite(number); }) || (entry && values.length !== DEFAULTS[entry.type].length)) {
                throw new Error('Tham số filter không hợp lệ: ' + source);
            }
            if (entry) entry.parameters = values;
            else return true;
        } else if (command === 'eraseFilter') {
            if (!this.filters[id]) return true;
            delete this.filters[id]; this.instances.delete(id);
        } else return false;
        this.revision++;
        return true;
    };
    FilterRuntime.prototype.advance = function (frames) {
        Object.values(this.filters).forEach(function (entry) { if (entry.type === 'godray-np') entry.time += frames * 0.01; });
    };
    FilterRuntime.prototype.active = function () {
        if(this.enabled===false)return false;
        return Object.values(this.filters).some(function (entry) { return entry.type === 'godray-np' && entry.parameters[4] > 0; });
    };
    FilterRuntime.prototype.forTarget = function (target) {
        if(this.enabled===false)return [];
        return Object.values(this.filters).filter(function (entry) { return entry.target === target; });
    };
    FilterRuntime.prototype.instance = function (entry) {
        var cached = this.instances.get(entry.id);
        if (!cached || cached.type !== entry.type) {
            cached = { type: entry.type, filter: new pixi.filters[CLASSES[entry.type]]() };
            this.instances.set(entry.id, cached);
        }
        var filter = cached.filter, p = entry.parameters;
        if (entry.type === 'zoomblur') { filter.center = p.slice(0,2); filter.innerRadius = p[2]; filter.strength = p[3]; }
        else if (entry.type === 'adjustment') ['gamma','saturation','contrast','brightness','red','green','blue','alpha'].forEach(function (key, index) { filter[key] = p[index]; });
        else if (entry.type === 'rgbsplit') ['red','green','blue'].forEach(function (key, index) {
            var angle = (p[1] + index * 120) * Math.PI / 180;
            filter[key] = [p[0] * Math.sin(angle), p[0] * Math.cos(angle)];
        });
        else if (entry.type === 'godray-np') {
            filter.parallel = false; filter.center = p.slice(0,2); filter.gain = p[2]; filter.lacunarity = p[3]; filter.strength = p[4]; filter.time = entry.time;
        }
        return filter;
    };
    FilterRuntime.prototype.apply = function (canvas, entries) {
        if (!entries.length) return canvas;
        if (!pixi) throw new Error('Filter GPU cần thư viện Pixi.');
        if (!this.backend) {
            var renderer;
            try { renderer = new pixi.WebGLRenderer(canvas.width, canvas.height, { transparent: true, antialias: false, preserveDrawingBuffer: true }); }
            catch (error) { throw new Error('Không khởi tạo được WebGL cho filter: ' + error.message); }
            var stage = new pixi.Container(), sprite = new pixi.Sprite();
            stage.addChild(sprite);
            this.backend = { renderer: renderer, stage: stage, sprite: sprite };
        }
        var backend = this.backend;
        if (backend.renderer.width !== canvas.width || backend.renderer.height !== canvas.height) backend.renderer.resize(canvas.width, canvas.height);
        var texture = this.textures.get(canvas);
        if (!texture || texture.width !== canvas.width || texture.height !== canvas.height) {
            if (texture) texture.texture.destroy(true);
            texture = { texture: pixi.Texture.fromCanvas(canvas, pixi.SCALE_MODES.NEAREST), width: canvas.width, height: canvas.height };
            this.textures.set(canvas, texture);
        }
        texture.texture.baseTexture.update();
        backend.sprite.texture = texture.texture;
        backend.stage.filterArea = new pixi.Rectangle(0, 0, canvas.width, canvas.height);
        backend.stage.filters = entries.map(this.instance.bind(this));
        backend.renderer.render(backend.stage);
        return backend.renderer.view;
    };
    FilterRuntime.prototype.dispose = function () {
        if (this.backend) { this.backend.stage.destroy({ children: true }); this.backend.renderer.destroy(true); this.backend = null; }
        this.textures.forEach(function (entry) { entry.texture.destroy(true); });
        this.textures.clear(); this.instances.clear();
    };
    return { FilterRuntime: FilterRuntime };
}));
