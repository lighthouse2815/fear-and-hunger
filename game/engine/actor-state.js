'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneActors = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function ActorState(data, classData, snapshot) {
        if (!data || !Number.isInteger(data.id)) throw new TypeError('Dữ liệu actor không hợp lệ.');
        if (!snapshot && classData && classData.level != null && classData.hp == null) {
            snapshot = classData;
            classData = null;
        }
        classData = classData || {};
        this.id = data.id;
        this.name = data.name || '';
        this.level = snapshot && snapshot.level || data.initialLevel || 1;
        this.hp = snapshot && snapshot.hp != null ? snapshot.hp : this.maxParam(data, classData, 0);
        this.mp = snapshot && snapshot.mp != null ? snapshot.mp : this.maxParam(data, classData, 1);
        this.tp = snapshot && snapshot.tp || 0;
        this.states = snapshot && Array.isArray(snapshot.states) ? snapshot.states.slice() : [];
        this.skills = snapshot && Array.isArray(snapshot.skills) ? snapshot.skills.slice() : [];
        this.equips = snapshot && Array.isArray(snapshot.equips) ? snapshot.equips.slice() : [];
    }

    ActorState.prototype.maxParam = function (data, classData, paramId) {
        var values = (data.params || classData.params) && (data.params || classData.params)[paramId];
        if (!Array.isArray(values) || !values.length) return 0;
        return Number(values[Math.max(0, Math.min(values.length - 1, this.level - 1))]) || 0;
    };

    ActorState.prototype.maxHp = function (data, classData) { return this.maxParam(data, classData, 0); };
    ActorState.prototype.maxMp = function (data, classData) { return this.maxParam(data, classData, 1); };
    ActorState.prototype.isAlive = function () { return this.hp > 0; };
    ActorState.prototype.changeHp = function (data, classData, amount, allowDeath) {
        var next = this.hp + Number(amount || 0);
        this.hp = Math.max(allowDeath ? 0 : 1, Math.min(this.maxHp(data, classData), next));
        return this.hp;
    };
    ActorState.prototype.changeMp = function (data, classData, amount) {
        this.mp = Math.max(0, Math.min(this.maxMp(data, classData), this.mp + Number(amount || 0)));
        return this.mp;
    };
    ActorState.prototype.toJSON = function () {
        return { id: this.id, name: this.name, level: this.level, hp: this.hp, mp: this.mp,
            tp: this.tp, states: this.states.slice(), skills: this.skills.slice(), equips: this.equips.slice() };
    };

    return { ActorState: ActorState };
}));
