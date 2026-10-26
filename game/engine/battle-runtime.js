'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneBattle = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function formulaValue(formula, values) {
        var source = String(formula || '0').replace(/\b(a|b)\.(atk|def|mat|mdf|agi|luk|level|hp|mp)\b/g, function (_, who, key) {
            return String(values[who][key] || 0);
        });
        if (!/^[0-9+*/().\s-]+$/.test(source)) throw new Error('Công thức damage chưa hỗ trợ: ' + formula);
        var tokens = source.match(/\d+(?:\.\d+)?|[()+*/-]/g) || [], output = [], operators = [], precedence = {'+':1,'-':1,'*':2,'/':2};
        tokens.forEach(function (token) {
            if (/^\d/.test(token)) output.push(Number(token));
            else if (token === '(') operators.push(token);
            else if (token === ')') { while (operators.length && operators[operators.length - 1] !== '(') output.push(operators.pop()); operators.pop(); }
            else { while (operators.length && operators[operators.length - 1] !== '(' && precedence[operators[operators.length - 1]] >= precedence[token]) output.push(operators.pop()); operators.push(token); }
        });
        while (operators.length) output.push(operators.pop());
        var stack = [];
        output.forEach(function (token) { if (typeof token === 'number') stack.push(token); else { var right = stack.pop(), left = stack.pop(); stack.push(token === '+' ? left + right : token === '-' ? left - right : token === '*' ? left * right : right === 0 ? 0 : left / right); } });
        return Number(stack[0]) || 0;
    }
    function BattleRuntime(state, database, random) {
        this.state = state; this.database = database; this.random = random || Math.random;
        this.battle = state.battle || null;
        this.waiters = new Set();
        state.battle = this.battle;
    }
    BattleRuntime.prototype.setup = function (troopId, canEscape, canLose) {
        if (this.battle && !this.battle.result) throw new Error('Một trận chiến khác đang chạy.');
        var troop = this.database.Troops[troopId];
        if (!troop) throw new Error('Không tìm thấy troop ' + troopId);
        this.battle = { troopId: troopId, turn: 0, phase: 'input', canEscape: canEscape !== false,
            canLose: canLose === true, result: null, actors: this.state.party.map(function (id) {
                var actor = this.state.actor(id); return { id: id, name: actor.name, hp: actor.hp, mp: actor.mp, alive: actor.hp > 0 };
            }, this), enemies: troop.members.map(function (member, index) {
                var data = this.database.Enemies[member.enemyId];
                if (!data) throw new Error('Không tìm thấy enemy ' + member.enemyId);
                var hp = Number(data && data.params && data.params[0]) || 1;
                return { index: index, enemyId: member.enemyId, name: data ? data.name : '', x: member.x, y: member.y,
                    hp: hp, mhp: hp, mp: Number(data && data.params && data.params[1]) || 0, alive: true,
                    battlerName: data.battlerName, hidden: !!member.hidden, states: [] };
            }, this) };
        this.state.battle = this.battle; return this.battle;
    };
    BattleRuntime.prototype.wait = function (signal) {
        var runtime = this;
        if (!this.battle) return Promise.reject(new Error('Trận chiến không hoạt động.'));
        if (this.battle.result) return Promise.resolve(this.battle.result);
        return new Promise(function (resolve, reject) {
            function cleanup() {
                runtime.waiters.delete(done);
                if (signal) signal.removeEventListener('abort', abort);
            }
            function done(result) { cleanup(); resolve(result); }
            function abort() {
                cleanup();
                runtime.finish('abort');
                reject(signal.reason);
            }
            if (signal && signal.aborted) { abort(); return; }
            runtime.waiters.add(done);
            if (signal) signal.addEventListener('abort', abort, { once: true });
        });
    };
    BattleRuntime.prototype.finish = function (result) {
        if (!this.battle || this.battle.result) return this.battle && this.battle.result;
        this.battle.result = result;
        this.battle.phase = 'finished';
        if (result === 'defeat-continue') {
            this.battle.actors.forEach(function (actor) {
                this.state.changeActorState(actor.id, 1, false);
                var stateActor = this.state.actor(actor.id);
                actor.hp = stateActor.hp; actor.alive = actor.hp > 0;
            }, this);
        }
        this.waiters.forEach(function (done) { done(result); });
        return result;
    };
    BattleRuntime.prototype.actor = function (id) {
        return this.battle && this.battle.actors.find(function (actor) { return actor.id === id; });
    };
    BattleRuntime.prototype.enemy = function (index) {
        return this.battle && this.battle.enemies[index];
    };
    BattleRuntime.prototype.aliveEnemies = function () { return this.battle.enemies.filter(function (enemy) { return enemy.alive && !enemy.hidden; }); };
    BattleRuntime.prototype.aliveActors = function () { return this.battle.actors.filter(function (actor) { return actor.alive; }); };
    BattleRuntime.prototype.attack = function (actorId, enemyIndex, skillId) {
        if (!this.battle || this.battle.result) throw new Error('Trận chiến không hoạt động.');
        var actorState = this.state.actor(actorId), actor = this.actor(actorId), enemy = this.enemy(enemyIndex);
        if (!actor || !actor.alive || !actorState || !enemy || !enemy.alive || enemy.hidden) throw new Error('Mục tiêu chiến đấu không hợp lệ.');
        if (this.battle.phase !== 'input') throw new Error('Chưa đến lượt nhân vật.');
        var skill = skillId ? this.database.Skills[skillId] : this.database.Skills[1];
        if (!skill) throw new Error('Không tìm thấy skill ' + skillId);
        var attack = this.state.actorParam(actorId, 2), actorValues = { atk: attack, def: this.state.actorParam(actorId, 3), mat: this.state.actorParam(actorId, 4), mdf: this.state.actorParam(actorId, 5), agi: this.state.actorParam(actorId, 6), luk: this.state.actorParam(actorId, 7), level: actorState.level, hp: actorState.hp, mp: actorState.mp };
        var enemyData = this.database.Enemies[enemy.enemyId], enemyValues = { atk: enemyData.params[2] || 0, def: enemyData.params[3] || 0, mat: enemyData.params[4] || 0, mdf: enemyData.params[5] || 0, agi: enemyData.params[6] || 0, luk: enemyData.params[7] || 0, level: 1, hp: enemy.hp, mp: enemy.mp };
        var power = formulaValue(skill && skill.damage ? skill.damage.formula : 'a.atk', { a: actorValues, b: enemyValues });
        var defense = this.database.Enemies[enemy.enemyId].params[3] || 0;
        var damage = Math.max(1, Math.round(power - defense / 2));
        enemy.hp = Math.max(0, enemy.hp - damage); enemy.alive = enemy.hp > 0;
        this.battle.phase = 'enemy';
        this.checkResult();
        return { damage: damage, critical: false, target: enemyIndex, defeated: !enemy.alive };
    };
    BattleRuntime.prototype.enemyTurn = function () {
        if (!this.battle || this.battle.result || this.battle.phase !== 'enemy') return [];
        var actions = [], runtime = this;
        this.aliveEnemies().forEach(function (enemy) {
            var data = runtime.database.Enemies[enemy.enemyId], target = runtime.aliveActors()[0];
            if (!target) return;
            var attack = Number(data.params[2]) || 1, defense = runtime.state.actorParam(target.id, 3) || 0;
            var damage = Math.max(1, Math.round(attack - defense / 4));
            target.hp = Math.max(0, target.hp - damage); target.alive = target.hp > 0;
            runtime.state.changeActorHp(target.id, -damage, true);
            actions.push({ enemy: enemy.index, target: target.id, damage: damage, defeated: !target.alive });
        });
        this.battle.turn++; this.battle.phase = 'input';
        this.checkResult(); return actions;
    };
    BattleRuntime.prototype.checkResult = function () {
        if (!this.aliveEnemies().length) this.finish('victory');
        else if (!this.aliveActors().length) this.finish(this.battle.canLose ? 'defeat-continue' : 'defeat');
        return this.battle.result;
    };
    BattleRuntime.prototype.escape = function () {
        if (!this.battle || this.battle.result || this.battle.phase !== 'input' || !this.battle.canEscape) return false;
        if (this.random() < 0.5) { this.finish('escape'); return true; }
        this.battle.phase = 'enemy'; this.enemyTurn(); return false;
    };
    BattleRuntime.prototype.save = function () { return clone(this.battle); };
    return { BattleRuntime: BattleRuntime };
}));
