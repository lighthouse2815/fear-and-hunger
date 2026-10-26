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
        this.pendingResult = null;
        this.battle = { troopId: troopId, turn: 0, phase: 'input', canEscape: canEscape !== false,
            canLose: canLose === true, result: null, actors: this.state.party.map(function (id) {
                var actor = this.state.actor(id); return { id: id, name: actor.name, hp: actor.hp, mp: actor.mp, alive: actor.hp > 0 };
            }, this), enemies: troop.members.map(function (member, index) {
                var data = this.database.Enemies[member.enemyId];
                if (!data) throw new Error('Không tìm thấy enemy ' + member.enemyId);
                var hp = Number(data && data.params && data.params[0]) || 1;
                return { index: index, enemyId: member.enemyId, name: data ? data.name : '', x: member.x, y: member.y,
                    hp: hp, mhp: hp, mp: Number(data.params[1]) || 0, mmp: Number(data.params[1]) || 0, tp: 0, alive: true,
                    battlerName: data.battlerName, hidden: !!member.hidden, states: [] };
            }, this) };
        this.state.battle = this.battle;
        this.battle.enemies.forEach(function (enemy) {
            enemy.hp = this.enemyParam(enemy, 0); enemy.mp = this.enemyParam(enemy, 1); this.refreshEnemy(enemy);
        }, this);
        return this.battle;
    };
    BattleRuntime.prototype.pageMatches = function (page, turnEnding) {
        var c = page.conditions || {}, battle = this.battle;
        if (!battle || ![c.turnEnding, c.turnValid, c.enemyValid, c.actorValid, c.switchValid].some(Boolean)) return false;
        if (c.turnEnding && !turnEnding) return false;
        if (c.turnValid && (c.turnB === 0 ? battle.turn !== c.turnA :
            battle.turn < c.turnA || (battle.turn - c.turnA) % c.turnB !== 0)) return false;
        var enemy = this.enemy(c.enemyIndex), actor = c.actorValid && this.state.actor(c.actorId);
        if (c.enemyValid && (!enemy || enemy.hp * 100 > enemy.mhp * c.enemyHp)) return false;
        if (c.actorValid && (!actor || actor.hp * 100 > this.state.actorParam(c.actorId, 0) * c.actorHp)) return false;
        return !c.switchValid || this.state.switchValue(c.switchId);
    };
    BattleRuntime.prototype.nextEventPage = function (turnEnding) {
        var battle = this.battle;
        var flags = battle.eventFlags || (battle.eventFlags = { once: {}, turns: {} });
        var pages = this.database.Troops[battle.troopId].pages || [];
        for (var index = 0; index < pages.length; index++) {
            var page = pages[index];
            if (page.span === 0 && flags.once[index] || page.span === 1 && flags.turns[index] === battle.turn) continue;
            if (this.pageMatches(page, turnEnding)) return { index: index, page: page };
        }
        return null;
    };
    BattleRuntime.prototype.markEventPage = function (entry) {
        var flags = this.battle.eventFlags;
        if (entry.page.span === 0) flags.once[entry.index] = true;
        if (entry.page.span === 1) flags.turns[entry.index] = this.battle.turn;
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
    BattleRuntime.prototype.enemyTraits = function (enemy) {
        var data = this.database.Enemies[enemy.enemyId], traits = (data.traits || []).slice(), database = this.database;
        enemy.states.forEach(function (id) { if (database.States[id]) traits = traits.concat(database.States[id].traits || []); });
        return traits;
    };
    BattleRuntime.prototype.enemyParam = function (enemy, id) {
        var base = this.database.Enemies[enemy.enemyId].params[id] || 0;
        var rate = this.enemyTraits(enemy).reduce(function (value, trait) {
            return trait.code === 21 && trait.dataId === id ? value * trait.value : value;
        }, 1);
        return Math.max(id === 1 ? 0 : 1, Math.round(base * rate));
    };
    BattleRuntime.prototype.refreshEnemy = function (enemy) {
        enemy.mhp = this.enemyParam(enemy, 0); enemy.mmp = this.enemyParam(enemy, 1);
        enemy.hp = Math.max(0, Math.min(enemy.mhp, enemy.hp));
        enemy.mp = Math.max(0, Math.min(enemy.mmp, enemy.mp));
        enemy.alive = enemy.hp > 0;
        if (!enemy.alive && !enemy.states.includes(1)) enemy.states.push(1);
        if (enemy.alive) enemy.states = enemy.states.filter(function (id) { return id !== 1; });
    };
    BattleRuntime.prototype.handleEffect = function (code, p) {
        if (![331, 332, 333, 334, 335, 336, 340, 342].includes(code)) return false;
        if (!this.battle || this.battle.result) throw new Error('Trận chiến không hoạt động.');
        if (code === 340) {
            if (this.eventRunning) this.pendingResult = 'escape';
            else this.finish('escape');
            return true;
        }
        if (code === 336 && !this.database.Enemies[p[1]]) throw new Error('Không tìm thấy enemy ' + p[1]);
        if (code === 333 && !this.database.States[p[2]]) throw new Error('Không tìm thấy state ' + p[2]);
        var targets = p[0] === -1 ? this.battle.enemies : this.enemy(p[0]) ? [this.enemy(p[0])] : [];
        var amount = 0;
        if (code === 331 || code === 332 || code === 342) {
            amount = p[2] === 0 ? Number(p[3]) : this.state.variableValue(p[3]);
            if (p[1] === 1) amount = -amount;
        }
        targets.forEach(function (enemy) {
            if (code === 331 && enemy.alive) enemy.hp = Math.max(p[4] ? 0 : 1, enemy.hp + amount);
            if (code === 332) enemy.mp += amount;
            if (code === 342) enemy.tp = Math.max(0, Math.min(100, (enemy.tp || 0) + amount));
            if (code === 333) {
                var stateId = p[2];
                var immune = this.enemyTraits(enemy).some(function (trait) { return trait.code === 14 && trait.dataId === stateId; });
                if (p[1] === 0 && enemy.alive && !immune) {
                    if (!enemy.states.includes(stateId)) enemy.states.push(stateId);
                    if (stateId === 1) enemy.hp = 0;
                } else if (p[1] === 1) {
                    enemy.states = enemy.states.filter(function (id) { return id !== stateId; });
                    if (stateId === 1 && enemy.hp === 0) enemy.hp = 1;
                }
            }
            if (code === 334) { enemy.states = []; enemy.hp = this.enemyParam(enemy, 0); enemy.mp = this.enemyParam(enemy, 1); }
            if (code === 335) enemy.hidden = false;
            if (code === 336) {
                enemy.enemyId = p[1];
                var data = this.database.Enemies[p[1]];
                enemy.name = data.name; enemy.battlerName = data.battlerName;
            }
            this.refreshEnemy(enemy);
        }, this);
        return true;
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
        var enemyValues = { atk: this.enemyParam(enemy, 2), def: this.enemyParam(enemy, 3), mat: this.enemyParam(enemy, 4),
            mdf: this.enemyParam(enemy, 5), agi: this.enemyParam(enemy, 6), luk: this.enemyParam(enemy, 7), level: 1, hp: enemy.hp, mp: enemy.mp };
        var power = formulaValue(skill && skill.damage ? skill.damage.formula : 'a.atk', { a: actorValues, b: enemyValues });
        // Phòng thủ đã nằm trong công thức JSON; không trừ thêm lần nữa.
        var damage = skill.damage.type === 0 ? 0 : Math.max(0, Math.round(power));
        enemy.hp = Math.max(0, enemy.hp - damage); enemy.alive = enemy.hp > 0;
        this.refreshEnemy(enemy);
        this.battle.phase = 'enemy';
        if (!this.battle.managed) this.checkResult();
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
        if (!this.battle.managed) this.battle.turn++;
        this.battle.phase = this.battle.managed ? 'events' : 'input';
        if (!this.battle.managed) this.checkResult();
        return actions;
    };
    BattleRuntime.prototype.checkResult = function () {
        if (!this.aliveEnemies().length) this.finish('victory');
        else if (!this.aliveActors().length) this.finish(this.battle.canLose ? 'defeat-continue' : 'defeat');
        return this.battle.result;
    };
    BattleRuntime.prototype.escape = function () {
        if (!this.battle || this.battle.result || this.battle.phase !== 'input' || !this.battle.canEscape) return false;
        if (this.random() < 0.5) { this.finish('escape'); return true; }
        this.battle.phase = 'enemy';
        if (!this.battle.managed) this.enemyTurn();
        return false;
    };
    BattleRuntime.prototype.save = function () { return clone(this.battle); };
    return { BattleRuntime: BattleRuntime };
}));
