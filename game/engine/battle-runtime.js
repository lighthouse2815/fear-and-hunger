'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneBattle = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function BattleRuntime(state, database, random) {
        this.state = state; this.database = database; this.random = random || Math.random;
        this.battle = state.battle || null;
        state.battle = this.battle;
    }
    BattleRuntime.prototype.setup = function (troopId, canEscape, canLose) {
        var troop = this.database.Troops[troopId];
        if (!troop) throw new Error('Không tìm thấy troop ' + troopId);
        this.battle = { troopId: troopId, turn: 0, phase: 'input', canEscape: canEscape !== false,
            canLose: canLose === true, result: null, actors: this.state.party.map(function (id) {
                var actor = this.state.actor(id); return { id: id, name: actor.name, hp: actor.hp, mp: actor.mp, alive: actor.hp > 0 };
            }, this), enemies: troop.members.filter(function (member) { return !member.hidden; }).map(function (member, index) {
                var data = this.database.Enemies[member.enemyId];
                var hp = Number(data && data.params && data.params[0]) || 1;
                return { index: index, enemyId: member.enemyId, name: data ? data.name : '', x: member.x, y: member.y,
                    hp: hp, mhp: hp, mp: Number(data && data.params && data.params[1]) || 0, alive: true,
                    battlerName: data && data.battlerName, states: [] };
            }, this) };
        this.state.battle = this.battle; return this.battle;
    };
    BattleRuntime.prototype.actor = function (id) {
        return this.battle && this.battle.actors.find(function (actor) { return actor.id === id; });
    };
    BattleRuntime.prototype.enemy = function (index) {
        return this.battle && this.battle.enemies[index];
    };
    BattleRuntime.prototype.aliveEnemies = function () { return this.battle.enemies.filter(function (enemy) { return enemy.alive; }); };
    BattleRuntime.prototype.aliveActors = function () { return this.battle.actors.filter(function (actor) { return actor.alive; }); };
    BattleRuntime.prototype.attack = function (actorId, enemyIndex, skillId) {
        if (!this.battle || this.battle.result) throw new Error('Trận chiến không hoạt động.');
        var actorState = this.state.actor(actorId), actor = this.actor(actorId), enemy = this.enemy(enemyIndex);
        if (!actor || !actorState || !enemy || !enemy.alive) throw new Error('Mục tiêu chiến đấu không hợp lệ.');
        var skill = skillId ? this.database.Skills[skillId] : null;
        var attack = this.state.actorParam(actorId, 2), power = skill && skill.damage ? Number(skill.damage.formula) || 0 : attack;
        var defense = this.database.Enemies[enemy.enemyId].params[3] || 0;
        var damage = Math.max(1, Math.round(power - defense / 2));
        enemy.hp = Math.max(0, enemy.hp - damage); enemy.alive = enemy.hp > 0;
        this.battle.phase = 'enemy';
        this.checkResult();
        return { damage: damage, critical: false, target: enemyIndex, defeated: !enemy.alive };
    };
    BattleRuntime.prototype.enemyTurn = function () {
        if (!this.battle || this.battle.result) return [];
        var actions = [], runtime = this;
        this.aliveEnemies().forEach(function (enemy) {
            var data = runtime.database.Enemies[enemy.enemyId], target = runtime.aliveActors()[0];
            if (!target) return;
            var attack = Number(data.params[2]) || 1, defense = runtime.state.actorParam(target.id, 3) || 0;
            var damage = Math.max(1, Math.round(attack - defense / 4));
            target.hp = Math.max(0, target.hp - damage); target.alive = target.hp > 0;
            var stateActor = runtime.state.actor(target.id); if (stateActor) stateActor.hp = target.hp;
            actions.push({ enemy: enemy.index, target: target.id, damage: damage, defeated: !target.alive });
        });
        this.battle.turn++; this.battle.phase = 'input';
        this.checkResult(); return actions;
    };
    BattleRuntime.prototype.checkResult = function () {
        if (!this.aliveEnemies().length) this.battle.result = 'victory';
        else if (!this.aliveActors().length) this.battle.result = this.battle.canLose ? 'defeat-continue' : 'defeat';
        return this.battle.result;
    };
    BattleRuntime.prototype.escape = function () {
        if (!this.battle.canEscape) return false;
        if (this.random() < 0.5) { this.battle.result = 'escape'; return true; }
        this.battle.turn++; this.enemyTurn(); return false;
    };
    BattleRuntime.prototype.save = function () { return clone(this.battle); };
    return { BattleRuntime: BattleRuntime };
}));
