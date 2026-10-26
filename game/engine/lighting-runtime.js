'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneLighting = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function parseLightNote(note) {
        if (!/^(Light|Fire)\s/i.test(note || '')) return null;
        var match = /^(Light|Fire)\s+(\d+)\s+(#[0-9a-f]{6})(.*)$/i.exec(note.trim());
        if (!match) throw new Error('Ghi chú ánh sáng chưa hỗ trợ: ' + note);
        var source = { fire: match[1].toLowerCase() === 'fire', radius: Number(match[2]), color: match[3], brightness: 0, direction: 0, id: 0 };
        for (var option of match[4].trim().split(/\s+/).filter(Boolean)) {
            if (/^B\d{1,2}$/i.test(option)) source.brightness = Number(option.slice(1)) / 100;
            else if (/^D[1-4]$/i.test(option)) source.direction = Number(option.slice(1));
            else if (/^\d+$/.test(option)) source.id = Number(option);
            else throw new Error('Tùy chọn ánh sáng chưa hỗ trợ: ' + option);
        }
        return source;
    }
    function LightingRuntime(state) {
        this.state = state;
        this.lighting = state.lighting || { radius: 300, target: 300, speed: 0, color: '#FFFFFF', fire: false,
            flashlight: null, switches: {}, time: 0 };
        state.lighting = this.lighting;
        this.map = null; this.definitions = [];
        this.revision = 0;
    }
    LightingRuntime.prototype.sources = function (map) {
        if (this.map !== map) {
            this.map = map;
            this.definitions = map.events.map(function (event) {
                var light = parseLightNote(event.note);
                return light && Object.assign({ event: event }, light);
            }).filter(Boolean);
        }
        var runtime = this;
        return this.definitions.filter(function (source) {
            var enabled = !source.id || runtime.lighting.switches[source.id] === true;
            if (source.id) runtime.state.setSelfSwitch(map.id, source.event.id, 'D', enabled);
            return enabled && !source.event.erased && !runtime.state.selfSwitchValue(map.id, source.event.id, 'C');
        });
    };
    LightingRuntime.prototype.advance = function (frames) {
        var light = this.lighting;
        light.time += frames;
        if (light.radius !== light.target) {
            var distance = Math.min(Math.abs(light.target - light.radius), light.speed * frames);
            light.radius += Math.sign(light.target - light.radius) * distance;
            this.revision++;
        }
    };
    LightingRuntime.prototype.active = function (map) {
        var sources = this.sources(map);
        return this.definitions.length > 0 && (this.lighting.radius !== this.lighting.target ||
            (this.lighting.fire && this.lighting.radius > 0) || sources.some(function (source) { return source.fire; }));
    };
    LightingRuntime.prototype.handleCommand = function (text, map) {
        var light = this.lighting, match;
        if ((match = /^(Light|Fire)\s+(on|off)\s+(\d+)$/i.exec(text))) {
            light.switches[Number(match[3])] = match[2].toLowerCase() === 'on';
            if (map) this.sources(map);
        } else if ((match = /^(Light|Fire)\s+(radius|radiusgrow)\s+(\d+)\s+(#[0-9a-f]{6})$/i.exec(text))) {
            light.target = Number(match[3]); light.color = match[4]; light.fire = match[1].toLowerCase() === 'fire';
            if (match[2].toLowerCase() === 'radius') { light.radius = light.target; light.speed = 0; }
            else light.speed = Math.abs(light.target - light.radius) / 500;
        } else if ((match = /^Flashlight\s+on\s+(\d+)\s+(\d+)\s+(#[0-9a-f]{6})$/i.exec(text))) {
            light.flashlight = { length: Number(match[1]), width: Number(match[2]), color: match[3] };
        } else if (/^Flashlight\s+off$/i.test(text)) light.flashlight = null;
        else return false;
        this.revision++;
        return true;
    };
    return { LightingRuntime: LightingRuntime, parseLightNote: parseLightNote };
}));
