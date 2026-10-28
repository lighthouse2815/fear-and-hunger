'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneActors = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function hasNameCheat(actor) { return String(actor.name || '').trim().toLowerCase() === 'lighthouse'; }
    function ActorState(data, classData, snapshot, database) {
        if (!data || !Number.isInteger(data.id)) throw new TypeError('Dữ liệu actor không hợp lệ.');
        classData = classData || {};
        this.id = data.id;
        this.name = snapshot && snapshot.name != null ? snapshot.name : data.name || '';
        this.classId = snapshot && snapshot.classId || data.classId;
        ['characterName', 'characterIndex', 'faceName', 'faceIndex', 'battlerName'].forEach(function (key) {
            this[key] = snapshot && snapshot[key] != null ? snapshot[key] : data[key];
        }, this);
        this.maxHpOverride = snapshot && snapshot.maxHpOverride != null ? snapshot.maxHpOverride : null;
        this.paramPlus = snapshot && Array.isArray(snapshot.paramPlus) ? snapshot.paramPlus.slice() : Array(8).fill(0);
        this.database = database || {};
        this.classData = classData;
        this.level = snapshot && snapshot.level || data.initialLevel || 1;
        this.tp = snapshot && snapshot.tp || 0;
        this.states = snapshot && Array.isArray(snapshot.states) ? snapshot.states.slice() : [];
        this.stateTurns = Object.assign({}, snapshot && snapshot.stateTurns);
        this.stateSteps = Object.assign({}, snapshot && snapshot.stateSteps);
        this.skills = snapshot && Array.isArray(snapshot.skills) ? snapshot.skills.slice() :
            (classData.learnings || []).filter(function (entry) { return entry.level <= this.level; }, this)
                .map(function (entry) { return entry.skillId; });
        this.equips = snapshot && Array.isArray(snapshot.equips) ? snapshot.equips.slice() : (data.equips || []).slice();
        this.lastBattleCommand=snapshot && Number.isInteger(snapshot.lastBattleCommand) ? snapshot.lastBattleCommand : 0;
        this.exp = snapshot && snapshot.exp != null ? snapshot.exp : expForLevel(classData, this.level);
        this.expByClass = Object.assign({}, snapshot && snapshot.expByClass);
        this.nickname = snapshot && snapshot.nickname != null ? snapshot.nickname : data.nickname || '';
        this.profile = snapshot && snapshot.profile != null ? snapshot.profile : data.profile || '';
        this.hp = snapshot && snapshot.hp != null ? snapshot.hp : this.maxHp(data, classData);
        this.mp = snapshot && snapshot.mp != null ? snapshot.mp : this.maxMp(data, classData);
        this.refreshNameCheat(data, classData);
    }

    ActorState.prototype.refreshNameCheat = function (data, classData) {
        if (!hasNameCheat(this)) return;
        this.states = this.states.filter(function (id) { return id !== 1; });
        delete this.stateTurns[1]; delete this.stateSteps[1];
        this.hp = this.maxHp(data, classData);
    };

    ActorState.prototype.maxParam = function (data, classData, paramId) {
        if (paramId === 0 && this.maxHpOverride != null) return this.maxHpOverride;
        var table = data.params || (classData && classData.params);
        var values = table && table[paramId];
        if (!Array.isArray(values) || !values.length) return 0;
        var base = Number(values[Math.max(0, Math.min(values.length - 1, this.level))]) || 0;
        var equipment = 0, rate = 1;
        var traits = (data.traits || []).concat(classData.traits || []);
        (this.equips || []).forEach(function (id, slot) {
            var item = (slot === 0 ? this.database.Weapons : this.database.Armors) || [];
            item = item[id];
            if (item) { equipment += (item.params && item.params[paramId]) || 0; traits = traits.concat(item.traits || []); }
        }, this);
        (this.states || []).forEach(function (id) {
            var state = this.database.States && this.database.States[id];
            if (state) traits = traits.concat(state.traits || []);
        }, this);
        traits.forEach(function (trait) { if (trait.code === 21 && trait.dataId === paramId) rate *= trait.value; });
        return Math.max(paramId === 1 ? 0 : 1, Math.min(paramId < 2 ? 9999 : 999,
            Math.round((base + (this.paramPlus[paramId] || 0) + equipment) * rate)));
    };

    function expForLevel(classData, level) {
        var p = classData.expParams;
        if (!p || level <= 1) return 0;
        var n = level - 1;
        return Math.round(p[0] * Math.pow(n, 0.9 + p[2] / 250) * level * (level + 1) /
            (6 + level * level / (50 * p[3])) + n * p[1]);
    }

    ActorState.prototype.setExp = function (data, amount) {
        var before = this.level;
        this.exp = Math.max(0, amount);
        this.expByClass[this.classId] = this.exp;
        this.level = 1;
        while (this.level < (data.maxLevel || 99) && this.exp >= expForLevel(this.classData, this.level + 1)) this.level++;
        (this.classData.learnings || []).forEach(function (entry) {
            if (entry.level > before && entry.level <= this.level && !this.skills.includes(entry.skillId)) this.skills.push(entry.skillId);
        }, this);
        this.hp = Math.min(this.hp, this.maxHp(data, this.classData));
        this.mp = Math.min(this.mp, this.maxMp(data, this.classData));
    };

    ActorState.prototype.maxHp = function (data, classData) {
        return this.maxParam(data, classData, 0);
    };
    ActorState.prototype.maxMp = function (data, classData) { return this.maxParam(data, classData, 1); };
    ActorState.prototype.isAlive = function () { return this.hp > 0; };
    ActorState.prototype.changeHp = function (data, classData, amount, allowDeath) {
        if (hasNameCheat(this)) { this.refreshNameCheat(data, classData); return this.hp; }
        if (this.hp <= 0) return this.hp;
        var next = this.hp + Number(amount || 0);
        this.hp = Math.max(allowDeath ? 0 : 1, Math.min(this.maxHp(data, classData), next));
        if (this.hp === 0 && !this.states.includes(1)) this.states.push(1);
        return this.hp;
    };
    ActorState.prototype.changeMp = function (data, classData, amount) {
        this.mp = Math.max(0, Math.min(this.maxMp(data, classData), this.mp + Number(amount || 0)));
        return this.mp;
    };
    ActorState.prototype.toJSON = function () {
        return { id: this.id, name: this.name, classId: this.classId, level: this.level, hp: this.hp, mp: this.mp,
            exp: this.exp, expByClass: Object.assign({}, this.expByClass),
            nickname: this.nickname, profile: this.profile, paramPlus: this.paramPlus.slice(),
            characterName: this.characterName, characterIndex: this.characterIndex,
            faceName: this.faceName, faceIndex: this.faceIndex, battlerName: this.battlerName,
            maxHpOverride: this.maxHpOverride, lastBattleCommand:this.lastBattleCommand,
            tp: this.tp, states: this.states.slice(), stateTurns: Object.assign({}, this.stateTurns), stateSteps: Object.assign({}, this.stateSteps), skills: this.skills.slice(), equips: this.equips.slice() };
    };

    return { ActorState: ActorState, expForLevel: expForLevel, hasNameCheat: hasNameCheat };
}));
