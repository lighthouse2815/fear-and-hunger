'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneActors = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function ActorState(data, classData, snapshot) {
        if (!data || !Number.isInteger(data.id)) throw new TypeError('Dữ liệu actor không hợp lệ.');
        classData = classData || {};
        this.id = data.id;
        this.name = snapshot && snapshot.name != null ? snapshot.name : data.name || '';
        this.classId = snapshot && snapshot.classId || data.classId;
        ['characterName', 'characterIndex', 'faceName', 'faceIndex', 'battlerName'].forEach(function (key) {
            this[key] = snapshot && snapshot[key] != null ? snapshot[key] : data[key];
        }, this);
        this.maxHpOverride = snapshot && snapshot.maxHpOverride != null ? snapshot.maxHpOverride : null;
        this.level = snapshot && snapshot.level || data.initialLevel || 1;
        this.hp = snapshot && snapshot.hp != null ? snapshot.hp : this.maxParam(data, classData, 0);
        this.mp = snapshot && snapshot.mp != null ? snapshot.mp : this.maxParam(data, classData, 1);
        this.tp = snapshot && snapshot.tp || 0;
        this.states = snapshot && Array.isArray(snapshot.states) ? snapshot.states.slice() : [];
        this.skills = snapshot && Array.isArray(snapshot.skills) ? snapshot.skills.slice() :
            (classData.learnings || []).filter(function (entry) { return entry.level <= this.level; }, this)
                .map(function (entry) { return entry.skillId; });
        this.equips = snapshot && Array.isArray(snapshot.equips) ? snapshot.equips.slice() : (data.equips || []).slice();
    }

    ActorState.prototype.maxParam = function (data, classData, paramId) {
        if (paramId === 0 && this.maxHpOverride != null) return this.maxHpOverride;
        var table = data.params || (classData && classData.params);
        var values = table && table[paramId];
        if (!Array.isArray(values) || !values.length) return 0;
        return Number(values[Math.max(0, Math.min(values.length - 1, this.level))]) || 0;
    };

    ActorState.prototype.maxHp = function (data, classData) {
        return this.maxParam(data, classData, 0);
    };
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
        return { id: this.id, name: this.name, classId: this.classId, level: this.level, hp: this.hp, mp: this.mp,
            characterName: this.characterName, characterIndex: this.characterIndex,
            faceName: this.faceName, faceIndex: this.faceIndex, battlerName: this.battlerName,
            maxHpOverride: this.maxHpOverride,
            tp: this.tp, states: this.states.slice(), skills: this.skills.slice(), equips: this.equips.slice() };
    };

    return { ActorState: ActorState };
}));
