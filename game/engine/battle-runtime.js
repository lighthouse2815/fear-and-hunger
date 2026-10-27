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
    function BattleRuntime(state, database, random, onStateChange) {
        this.state = state; this.database = database; this.random = random || Math.random;
        this.onStateChange = onStateChange;
        this.battle = state.battle || null;
        this.waiters = new Set();
        this.immortal = new Map();
        state.battle = this.battle;
        if (this.battle) this.battle.actors.forEach(function (actor) {
            if (state.hasNameCheat(actor.id)) this.refreshActor(actor);
        }, this);
    }
    BattleRuntime.prototype.setup = function (troopId, canEscape, canLose) {
        if (this.battle && !this.battle.result) throw new Error('Một trận chiến khác đang chạy.');
        var troop = this.database.Troops[troopId];
        if (!troop) throw new Error('Không tìm thấy troop ' + troopId);
        this.pendingResult = null;
        this.battle = { troopId: troopId, turn: 0, phase: 'input', canEscape: canEscape !== false,
            canLose: canLose === true, result: null, actors: this.state.battleActorIds().map(function (id) {
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
        this.battle.actors.concat(this.battle.enemies).forEach(function (battler) {
            if (!this.preserveTp(battler)) this.battlerState(battler).tp = Math.floor(this.random() * 25);
        }, this);
        this.battle.escapeRatio = this.initialEscapeRatio();
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
        this.battle.inputActions = [];
        if (result === 'defeat-continue') {
            this.battle.actors.forEach(function (actor) {
                this.state.changeActorState(actor.id, 1, false);
                var stateActor = this.state.actor(actor.id);
                actor.hp = stateActor.hp; actor.alive = actor.hp > 0;
            }, this);
        }
        this.battle.actors.forEach(function (actor) {
            this.state.actor(actor.id).states.slice().forEach(function (id) {
                if ((this.database.States[id] || {}).removeAtBattleEnd) this.removeState(actor, id);
            }, this);
        }, this);
        this.battle.actors.concat(this.battle.enemies).forEach(function (battler) {
            if (!this.preserveTp(battler)) this.battlerState(battler).tp = 0;
        }, this);
        this.syncActors();
        this.waiters.forEach(function (done) { done(result); });
        return result;
    };
    BattleRuntime.prototype.actor = function (id) {
        return this.battle && this.battle.actors.find(function (actor) { return actor.id === id; });
    };
    BattleRuntime.prototype.enemy = function (index) {
        return this.battle && this.battle.enemies[index];
    };
    BattleRuntime.prototype.enemyTraits = function (enemy) { return this.battlerTraits(enemy); };
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
        enemy.alive = enemy.hp > 0 || this.isImmortal(enemy);
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
                var hadState = enemy.states.includes(stateId);
                var immune = stateId === 1 && this.isImmortal(enemy) || this.enemyTraits(enemy).some(function (trait) { return trait.code === 14 && trait.dataId === stateId; });
                if (p[1] === 0 && enemy.alive && !immune) {
                    if (enemy.stateTurns) delete enemy.stateTurns[stateId];
                    if (!enemy.states.includes(stateId)) enemy.states.push(stateId);
                    if (stateId === 1) enemy.hp = 0;
                } else if (p[1] === 1) {
                    if (enemy.stateTurns) delete enemy.stateTurns[stateId];
                    enemy.states = enemy.states.filter(function (id) { return id !== stateId; });
                    if (stateId === 1 && enemy.hp === 0) enemy.hp = 1;
                }
                if (hadState !== enemy.states.includes(stateId) && this.onStateChange) this.onStateChange(enemy, stateId, p[1] === 0);
            }
            if (code === 334) { enemy.states = []; enemy.stateTurns = {}; enemy.hp = this.enemyParam(enemy, 0); enemy.mp = this.enemyParam(enemy, 1); }
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
    BattleRuntime.prototype.inputActors = function () {
        return this.aliveActors().filter(function (actor) {
            return this.takesTurn(actor) && this.restriction(actor) === 0 && !this.isAutoBattle(actor);
        }, this);
    };
    BattleRuntime.prototype.isAutoBattle = function (battler) {
        return this.battlerTraits(battler).some(function (trait) { return trait.code === 62 && trait.dataId === 0; });
    };
    BattleRuntime.prototype.restriction = function (battler) {
        return this.battlerState(battler).states.reduce(function (level, id) {
            return Math.max(level, (this.database.States[id] || {}).restriction || 0);
        }.bind(this), 0);
    };
    BattleRuntime.prototype.confusionLevel = function (battler) {
        var level = this.restriction(battler);
        return battler.alive && !battler.hidden && level >= 1 && level <= 3 ? level : 0;
    };
    BattleRuntime.prototype.actionSpeed = function (subject, data, attack) {
        var agility = this.battlerParam(subject, 6);
        var speed = agility + Math.floor(this.random() * Math.floor(5 + agility / 4)) + (data.speed || 0);
        if (attack) speed += this.battlerTraits(subject).reduce(function (sum, trait) { return sum + (trait.code === 33 ? trait.value : 0); }, 0);
        return speed;
    };
    BattleRuntime.prototype.battlerState = function (battler) {
        return battler.enemyId != null ? battler : this.state.actor(battler.id);
    };
    BattleRuntime.prototype.battlerSources = function (battler) {
        var data = this.battlerState(battler), sources;
        if (battler.enemyId != null) sources = [this.database.Enemies[battler.enemyId]];
        else {
            sources = [this.database.Actors[battler.id], this.database.Classes[data.classId]];
            data.equips.forEach(function (id, slot) { sources.push((slot === 0 ? this.database.Weapons : this.database.Armors)[id]); }, this);
        }
        data.states.forEach(function (id) { sources.push(this.database.States[id]); }, this);
        return sources.filter(Boolean);
    };
    BattleRuntime.prototype.battlerTraits = function (battler) {
        return this.battlerSources(battler).reduce(function (traits, data) { return traits.concat(data.traits || []); }, []);
    };
    BattleRuntime.prototype.preserveTp = function (battler) {
        return this.battlerTraits(battler).some(function (trait) { return trait.code === 62 && trait.dataId === 3; });
    };
    BattleRuntime.prototype.gainTp = function (battler, value) {
        var data = this.battlerState(battler);
        data.tp = Math.max(0, Math.min(100, (data.tp || 0) + value));
    };
    BattleRuntime.prototype.hasBattlerTag = function (battler, tag) {
        tag = '<' + tag.toLowerCase() + '>';
        return this.battlerSources(battler).some(function (data) { return (data.note || '').toLowerCase().includes(tag); });
    };
    BattleRuntime.prototype.hasTaunt = function (battler, hitType) {
        var type = ['Certain', 'Physical', 'Magical'][hitType];
        return !!type && this.hasBattlerTag(battler, type + ' Taunt') && !this.hasBattlerTag(battler, 'Null ' + type + ' Taunt');
    };
    BattleRuntime.prototype.tauntTargets = function (subject, skill, targets) {
        var type = ['Certain', 'Physical', 'Magical'][skill.hitType];
        if (skill.scope !== 1 || /<Bypass Taunt>/i.test(skill.note || '') || this.hasBattlerTag(subject, 'Ignore ' + type + ' Taunt')) return targets;
        var taunts = targets.filter(function (target) { return target.alive && !target.hidden && this.hasTaunt(target, skill.hitType); }, this);
        return taunts.length ? taunts : targets;
    };
    BattleRuntime.prototype.battlerParam = function (battler, id) {
        return battler.enemyId != null ? this.enemyParam(battler, id) : this.state.actorParam(battler.id, id);
    };
    BattleRuntime.prototype.traitRate = function (battler, code, id, additive) {
        return this.battlerTraits(battler).reduce(function (value, trait) {
            return trait.code === code && trait.dataId === id ? additive ? value + trait.value : value * trait.value : value;
        }, additive ? 0 : 1);
    };
    BattleRuntime.prototype.refreshActor = function (actor) {
        if (this.state.hasNameCheat(actor.id)) this.state.updateActor(actor.id, function () {});
        var data = this.state.actor(actor.id);
        if (this.isImmortal(actor)) data.states = data.states.filter(function (id) { return id !== 1; });
        actor.hp = data.hp; actor.mp = data.mp; actor.alive = data.hp > 0 || this.isImmortal(actor);
    };
    BattleRuntime.prototype.syncActors = function () {
        if (this.battle) this.battle.actors.forEach(this.refreshActor, this);
    };
    BattleRuntime.prototype.battlerKey = function (battler) {
        return battler.enemyId != null ? 'enemy:' + battler.index : 'actor:' + battler.id;
    };
    BattleRuntime.prototype.isImmortal = function (battler) { return this.immortal.has(this.battlerKey(battler)); };
    BattleRuntime.prototype.protectActionTargets = function (targets) {
        var runtime = this, keys = new Set(), protectedTargets = [];
        targets.forEach(function (target) {
            var key = runtime.battlerKey(target);
            if (keys.has(key) || !target.alive) return;
            keys.add(key); protectedTargets.push(target);
            runtime.immortal.set(key, (runtime.immortal.get(key) || 0) + 1);
        });
        var released = false;
        return function () {
            if (released) return;
            released = true;
            protectedTargets.forEach(function (target) {
                var key = runtime.battlerKey(target), count = runtime.immortal.get(key) - 1;
                if (count > 0) runtime.immortal.set(key, count);
                else {
                    runtime.immortal.delete(key);
                    if (target.enemyId != null) runtime.refreshEnemy(target);
                    else {
                        if (runtime.state.actor(target.id).hp <= 0) runtime.state.changeActorState(target.id, 1, true);
                        runtime.refreshActor(target);
                    }
                }
            });
        };
    };
    BattleRuntime.prototype.skillCost = function (battler, skill) {
        return { mp: Math.floor((skill.mpCost || 0) * this.traitRate(battler, 23, 4)), tp: skill.tpCost || 0 };
    };
    BattleRuntime.prototype.canUseSkill = function (battler, skill, menu) {
        if (!battler || !skill || !battler.alive || battler.hidden || !(menu ? [0, 2] : [0, 1]).includes(skill.occasion)) return false;
        var data = this.battlerState(battler), cost = this.skillCost(battler, skill), traits = this.battlerTraits(battler);
        if (data.mp < cost.mp || (data.tp || 0) < cost.tp || this.restriction(battler) >= (menu ? 1 : 4)) return false;
        if (traits.some(function (trait) { return trait.code === 42 && trait.dataId === skill.stypeId || trait.code === 44 && trait.dataId === skill.id; })) return false;
        if (battler.enemyId == null && (skill.requiredWtypeId1 || skill.requiredWtypeId2)) {
            var weapon = this.database.Weapons[data.equips[0]];
            if (!weapon || ![skill.requiredWtypeId1, skill.requiredWtypeId2].includes(weapon.wtypeId)) return false;
        }
        return true;
    };
    BattleRuntime.prototype.canUseItem = function (battler, item, menu) {
        return !!battler && battler.enemyId == null && battler.alive && !!item && (menu ? [0, 2] : [0, 1]).includes(item.occasion) &&
            this.state.itemCount('items', item.id) > 0 && (menu || !this.battlerState(battler).states.some(function (id) {
                return (this.database.States[id] || {}).restriction > 0;
            }, this));
    };
    BattleRuntime.prototype.actionData = function (report) {
        return report.itemId != null ? this.database.Items[report.itemId] : this.database.Skills[report.skillId];
    };
    BattleRuntime.prototype.actorSkills = function (id) {
        var actor = this.actor(id) || { id: id }, data = this.state.actor(id);
        var ids = data.skills.concat(this.battlerTraits(actor).filter(function (trait) { return trait.code === 43; })
            .map(function (trait) { return trait.dataId; }));
        return Array.from(new Set(ids)).map(function (skillId) { return this.database.Skills[skillId]; }, this).filter(Boolean);
    };
    BattleRuntime.prototype.actionSequence = function (skill) {
        var phases = {}, blocks = /<(setup|whole|target|follow|finish) action>([\s\S]*?)<\/\1 action>/gi, match;
        while ((match = blocks.exec(skill.note || ''))) {
            phases[match[1].toLowerCase()] = match[2].split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
        }
        return Object.keys(phases).length ? phases : null;
    };
    BattleRuntime.prototype.actionEffectCount = function (skill) {
        var animation = this.database.Animations[skill.animationId];
        var whole = animation && (animation.position === 3 || [2, 8, 10].includes(skill.scope));
        var counts = { setup: 0, whole: whole ? skill.repeats || 1 : 0, target: whole ? 0 : skill.repeats || 1, follow: 0, finish: 0 };
        var phases = this.actionSequence(skill), phase;
        for (phase in (phases || {})) {
            var effects = 0;
            phases[phase].forEach(function (line) {
                line = line.trim().toLowerCase();
                if (!line) return;
                if (line === 'action effect') effects++;
                else if (!/^(perform action|action animation|wait for animation|death break|motion wait: user|motion (swing|evade): user)$/.test(line)) {
                    throw new Error('Lệnh action sequence chưa hỗ trợ: ' + line);
                }
            });
            counts[phase] = effects;
        }
        return Object.values(counts).reduce(function (total, count) { return total + count; }, 0);
    };
    BattleRuntime.prototype.attackSkillId = function (battler) {
        if (!battler || battler.enemyId != null) return 1;
        var data = this.battlerState(battler), weapon = this.database.Weapons[data.equips[0]], match;
        match = weapon && /<skill_id\s*:\s*(\d+)>/i.exec(weapon.note || '');
        return match ? Number(match[1]) : 1;
    };
    BattleRuntime.prototype.actionPhases = function (skill) {
        this.actionEffectCount(skill); // Kiểm tra toàn bộ note trước khi tiêu tài nguyên.
        var animation = this.database.Animations[skill.animationId];
        var whole = animation && (animation.position === 3 || [2, 8, 10].includes(skill.scope));
        var phases = { setup: ['wait for animation'], whole: [], target: [], follow: [], finish: [] };
        var lines = ['perform action', 'wait: 10', 'action animation', 'wait for animation'];
        for (var repeat = 0; repeat < (skill.repeats || 1); repeat++) {
            if (repeat) lines.push('wait: 8');
            lines.push('action effect', 'death break');
        }
        phases[whole ? 'whole' : 'target'] = lines;
        return Object.assign(phases, this.actionSequence(skill) || {});
    };
    BattleRuntime.prototype.skillFor = function (battler, id, forced) {
        return this.database.Skills[id === 1 && !forced ? this.attackSkillId(battler) : id];
    };
    BattleRuntime.prototype.chooseActorAction = function (actor) {
        if (!actor || !actor.alive || actor.hidden || this.restriction(actor) > 0) return null;
        var attack = this.skillFor(actor, 1), skills = [attack].concat(this.actorSkills(actor.id)), best = null, bestScore = 0;
        skills.forEach(function (skill, skillIndex) {
            if (!skill || skills.indexOf(skill) !== skillIndex || !this.canUseSkill(actor, skill) || !skill.damage || ![1, 3, 5].includes(skill.damage.type)) return;
            var scope = skill.scope, opponents = scope >= 1 && scope <= 6;
            if (scope < 1 || scope > 11) return;
            var unit = opponents ? this.battle.enemies : this.battle.actors;
            var targets = scope === 11 ? [actor] : unit.filter(function (target) {
                return !target.hidden && target.alive !== [9, 10].includes(scope);
            });
            targets = this.tauntTargets(actor, skill, targets);
            var score = 0, targetIndex = -1, all = [2, 8, 10].includes(scope);
            targets.forEach(function (target) {
                var hp = this.battlerState(target).hp, mhp = this.battlerParam(target, 0);
                var damage = this.damageValue(actor, target, skill, false).damage;
                var value = opponents ? damage / Math.max(hp, 1) : Math.min(-damage, mhp - hp) / mhp;
                if (all) score += value;
                else if (value > score) { score = value; targetIndex = unit.indexOf(target); }
            }, this);
            score *= this.actionEffectCount(skill);
            if (score > 0) score += this.random();
            if (score > bestScore) {
                bestScore = score;
                best = { actorId: actor.id, kind: 'skill', id: skill === attack ? 1 : skill.id, targetIndex: targetIndex, autoBattle: true };
            }
        }, this);
        return best;
    };
    BattleRuntime.prototype.randomTarget = function (targets) {
        var weights = targets.map(function (target) { return this.traitRate(target, 23, 0); }, this);
        var sum = weights.reduce(function (value, weight) { return value + weight; }, 0);
        if (!sum) return targets[0];
        var draw = this.random() * sum;
        return targets.find(function (_, index) { draw -= weights[index]; return draw < 0; }) || targets[targets.length - 1];
    };
    BattleRuntime.prototype.confusionTarget = function (subject, skill) {
        var level = this.confusionLevel(subject), enemy = subject.enemyId != null;
        var opponents = level === 1 || level === 2 && this.random() < 0.5;
        var unit = opponents === enemy ? this.battle.actors : this.battle.enemies;
        var targets = unit.filter(function (target) { return target.alive && !target.hidden; });
        targets = this.tauntTargets(subject, skill, targets);
        return targets.length ? [this.randomTarget(targets)] : [];
    };
    BattleRuntime.prototype.skillTargets = function (subject, skill, index) {
        var enemy = subject.enemyId != null, scope = skill.scope;
        if (scope === 0) return [];
        if (scope === 11) return [subject];
        if (scope < 0 || scope > 11) throw new Error('Phạm vi kỹ năng chưa hỗ trợ: ' + scope);
        var opponents = scope <= 6, dead = scope === 9 || scope === 10;
        var all = (opponents === enemy ? this.battle.actors : this.battle.enemies);
        var available = all.filter(function (target) { return !target.hidden && target.alive !== dead; });
        var targets = this.tauntTargets(subject, skill, available);
        if ([2, 8, 10].includes(scope)) return targets;
        if (scope >= 3 && scope <= 6) {
            var result = [];
            for (var i = 0; i < scope - 2; i++) if (targets.length) result.push(this.randomTarget(targets));
            return result;
        }
        var key = (enemy ? 'enemy:' + subject.index : 'actor:' + subject.id);
        var last = (this.battle.lastTargets || {})[key];
        if (index === -2) index = last == null ? -1 : last;
        var chosen = index >= 0 ? all[index] : null;
        if (targets !== available && index >= 0 && !targets.includes(chosen)) chosen = targets[Math.floor(this.random() * targets.length)];
        return targets.length ? [targets.includes(chosen) ? chosen : index < 0 ? this.randomTarget(targets) : targets[0]] : [];
    };
    BattleRuntime.prototype.values = function (battler) {
        var values = {}, data = this.battlerState(battler);
        ['atk', 'def', 'mat', 'mdf', 'agi', 'luk'].forEach(function (key, index) { values[key] = this.battlerParam(battler, index + 2); }, this);
        values.hp = data.hp; values.mp = data.mp; values.level = data.level || 1;
        return values;
    };
    BattleRuntime.prototype.changeResource = function (battler, resource, amount) {
        if (battler.enemyId != null) {
            battler[resource] += amount; this.refreshEnemy(battler);
        } else if (resource === 'hp') {
            if (this.isImmortal(battler)) {
                var maximum = this.battlerParam(battler, 0), data = this.battlerState(battler);
                data.hp = Math.max(0, Math.min(maximum, data.hp + amount));
                this.syncActors(); return;
            }
            if (amount > 0 && this.state.actor(battler.id).hp === 0) {
                this.state.changeActorState(battler.id, 1, false); amount--;
            }
            this.state.changeActorHp(battler.id, amount, true);
        }
        else this.state.changeActorMp(battler.id, amount);
        if (battler.enemyId == null) this.refreshActor(battler);
        this.syncActors();
    };
    BattleRuntime.prototype.resetStateTurns = function (battler, id) {
        var state = this.database.States[id], data = this.battlerState(battler);
        var turns = data.stateTurns || (data.stateTurns = {});
        turns[id] = (state.minTurns || 0) + Math.floor(this.random() * ((state.maxTurns || 0) - (state.minTurns || 0) + 1));
    };
    BattleRuntime.prototype.removeState = function (battler, id) {
        if (battler.enemyId != null) this.handleEffect(333, [battler.index, 1, id]);
        else this.state.changeActorState(battler.id, id, false);
        var data = this.battlerState(battler);
        if (data.stateTurns) delete data.stateTurns[id];
        if (battler.enemyId == null) this.refreshActor(battler);
    };
    BattleRuntime.prototype.addState = function (target, id, chance, certain) {
        if (!this.database.States[id]) throw new Error('Không tìm thấy state ' + id);
        if (!target.alive || id === 1 && (this.isImmortal(target) || target.enemyId == null && this.state.hasNameCheat(target.id)) || this.battlerTraits(target).some(function (trait) { return trait.code === 14 && trait.dataId === id; })) return;
        if (this.random() >= chance * (certain ? 1 : this.traitRate(target, 13, id))) return;
        if (target.enemyId != null) this.handleEffect(333, [target.index, 0, id]);
        else this.state.changeActorState(target.id, id, true);
        this.resetStateTurns(target, id);
        if (target.enemyId == null) this.refreshActor(target);
        this.syncActors();
    };
    BattleRuntime.prototype.damageValue = function (subject, target, skill, allowCritical) {
        var damage = skill.damage, value = 0, hit = {};
        value = Math.max(0, formulaValue(damage.formula, { a: this.values(subject), b: this.values(target) }));
        var element = damage.elementId;
        if (element < 0) {
            var elements = this.battlerTraits(subject).filter(function (trait) { return trait.code === 31; });
            value *= elements.length ? Math.max.apply(null, elements.map(function (trait) { return this.traitRate(target, 11, trait.dataId); }, this)) : 1;
        } else if (element > 0) value *= this.traitRate(target, 11, element);
        if (skill.hitType === 1) value *= this.traitRate(target, 23, 6);
        if (skill.hitType === 2) value *= this.traitRate(target, 23, 7);
        var vulnerable = this.battlerState(target).states.some(function (id) {
            return /<Custom Select Effect>[\s\S]*?BattleManager\.actionForceCritical\(\)/i.test(this.database.States[id].note || '');
        }, this);
        hit.critical = allowCritical !== false && !!damage.critical && (vulnerable || this.random() < this.traitRate(subject, 22, 2, true) * (1 - this.traitRate(target, 22, 3, true)));
        if (hit.critical) value *= 3;
        var amplitude = Math.floor(value * (damage.variance || 0) / 100);
        value += Math.floor(this.random() * (amplitude + 1)) + Math.floor(this.random() * (amplitude + 1)) - amplitude;
        var recovery = damage.type === 3 || damage.type === 4;
        if (recovery) value = -value * this.traitRate(target, 23, 2);
        else if (this.battlerTraits(target).some(function (trait) { return trait.code === 62 && trait.dataId === 1; })) value /= 2 * this.traitRate(target, 23, 1);
        value = Math.max(-9999, Math.min(9999, Math.round(value)));
        [subject, target].forEach(function (battler, side) {
            this.battlerState(battler).states.slice().sort(function (a, b) {
                return (this.database.States[b].priority || 0) - (this.database.States[a].priority || 0) || a - b;
            }.bind(this)).forEach(function (id) {
                var note = this.database.States[id].note || '';
                var block = new RegExp('<state[-_ ]damage[-_ ]modifier:\\s*' + (side ? 'defender' : 'attacker') + '>([\\s\\S]*?)<\\/state[-_ ]damage[-_ ]modifier>', 'i').exec(note);
                if (!block) return;
                var expression = /^\s*return\s+([^;]+);?\s*$/.exec(block[1]);
                if (!expression) throw new Error('Modifier sát thương state chưa hỗ trợ: ' + id);
                value = formulaValue(expression[1].replace(/\bd\b/g, '(' + value + ')'), { a: this.values(subject), b: this.values(target) });
            }, this);
        }, this);
        var resource = [2, 4, 6].includes(damage.type) ? 'mp' : 'hp';
        if (subject.enemyId == null && target.enemyId != null && [1, 5].includes(damage.type) && this.state.hasNameCheat(subject.id)) value = Math.max(9999, value);
        if (damage.type === 5 || damage.type === 6) value = Math.min(value, this.battlerState(target)[resource]);
        return { damage: value, resource: resource, critical: !!hit.critical };
    };
    BattleRuntime.prototype.useSkill = function (subject, skillId, index, forced, deferred) {
        var skill = this.skillFor(subject, skillId, forced);
        if (!skill) throw new Error('Không tìm thấy skill ' + skillId);
        return this.useAction(subject, skill, index, false, forced, null, null, deferred);
    };
    BattleRuntime.prototype.useItem = function (subject, itemId, index, deferred) {
        var item = this.database.Items[itemId];
        if (!item) throw new Error('Không tìm thấy item ' + itemId);
        return this.useAction(subject, item, index, true, false, null, null, deferred);
    };
    BattleRuntime.prototype.canCounter = function (battler) {
        return battler.alive && !battler.hidden && this.restriction(battler) < 4;
    };
    BattleRuntime.prototype.reflectAnimationId = function (battler) {
        var state = this.battlerState(battler), sources;
        if (battler.enemyId != null) sources = [this.database.Enemies[battler.enemyId]];
        else sources = [this.database.Actors[battler.id], this.database.Classes[state.classId]].concat(state.equips.map(function (id, slot) {
            return (slot === 0 ? this.database.Weapons : this.database.Armors)[id];
        }, this));
        sources = sources.concat(state.states.slice().sort(function (a, b) {
            return (this.database.States[b].priority || 0) - (this.database.States[a].priority || 0) || a - b;
        }.bind(this)).map(function (id) { return this.database.States[id]; }, this));
        for (var source of sources) {
            var match = source && /<reflect (?:animation|ani):\s*(\d+)>/i.exec(source.note || '');
            if (match && Number(match[1]) > 0) return Number(match[1]);
        }
        return 42;
    };
    BattleRuntime.prototype.substituteTarget = function (target, skill) {
        if (skill.hitType === 0 || !target.alive || this.battlerState(target).hp >= this.battlerParam(target, 0) / 4) return target;
        var members = target.enemyId != null ? this.battle.enemies : this.battle.actors;
        return members.find(function (member) {
            return this.canCounter(member) && this.battlerTraits(member).some(function (trait) { return trait.code === 62 && trait.dataId === 2; });
        }, this) || target;
    };
    BattleRuntime.prototype.useAction = function (subject, skill, index, item, forced, menuTargets, counterTarget, deferred) {
        var menu = Array.isArray(menuTargets);
        if (!menu && (!this.battle || this.battle.result)) throw new Error('Trận chiến không hoạt động.');
        if (!subject || !subject.alive || subject.hidden) throw new Error('Chủ thể chiến đấu không hợp lệ.');
        var confusion = !menu && !forced && !counterTarget ? this.confusionLevel(subject) : 0;
        if (confusion) { skill = this.skillFor(subject, 1); item = false; }
        if (!forced && !(item ? this.canUseItem(subject, skill, menu) : this.canUseSkill(subject, skill, menu))) {
            throw new Error(item ? 'Chưa thể dùng vật phẩm ' + skill.name : 'Chưa thể dùng kỹ năng ' + skill.name);
        }
        var effectCount = counterTarget ? 1 : menu ? skill.repeats || 1 : this.actionEffectCount(skill);
        var targets = counterTarget ? [counterTarget] : menu ? menuTargets : confusion ? this.confusionTarget(subject, skill) : this.skillTargets(subject, skill, index), runtime = this;
        var report = { subject: subject.enemyId != null ? 'enemy' : 'actor',
            subjectId: subject.enemyId != null ? subject.index : subject.id, hits: [], commonEvents: [], targets: [], damage: 0, critical: false };
        report[item ? 'itemId' : 'skillId'] = skill.id;
        if (!item) report.sequence = runtime.actionSequence(skill);
        if (confusion) report.confusion = confusion;
        (skill.effects || []).forEach(function (effect) {
            if (effect.code === 44) {
                if (counterTarget) return;
                if (!runtime.database.CommonEvents[effect.dataId]) throw new Error('Không tìm thấy common event ' + effect.dataId);
                report.commonEvents.push(effect.dataId);
            } else if ([21, 22].includes(effect.code)) {
                if (effect.dataId && !runtime.database.States[effect.dataId]) throw new Error('Không tìm thấy state ' + effect.dataId);
            } else if (effect.code === 43) {
                if (!runtime.database.Skills[effect.dataId]) throw new Error('Không tìm thấy skill ' + effect.dataId);
            } else throw new Error('Hiệu ứng hành động chưa hỗ trợ: ' + effect.code);
        });
        if (counterTarget) {
            report.counter = true;
        } else if (item) {
            if (skill.consumable) this.state.gainItem('items', skill.id, -1);
        } else {
            var cost = this.skillCost(subject, skill);
            this.changeResource(subject, 'mp', -cost.mp);
            var subjectData = this.battlerState(subject);
            subjectData.tp = Math.max(0, (subjectData.tp || 0) - cost.tp);
        }
        report.targets = targets.map(function (target) {
            return { type: target.enemyId != null ? 'enemy' : 'actor', id: target.enemyId != null ? target.index : target.id };
        });
        report.target = report.targets[0] && report.targets[0].id;
        function apply(selected, repeats) {
            selected.forEach(function (intendedTarget) {
                if (!subject.alive) return;
                if (!menu && !counterTarget) {
                    var key = report.subject + ':' + report.subjectId;
                    var unit = intendedTarget.enemyId != null ? runtime.battle.enemies : runtime.battle.actors;
                    (runtime.battle.lastTargets || (runtime.battle.lastTargets = {}))[key] = unit.indexOf(intendedTarget);
                }
                for (var repeat = 0; repeat < repeats; repeat++) {
                    if (!subject.alive) break;
                    if ([9, 10].includes(skill.scope) ? intendedTarget.alive : !intendedTarget.alive) break;
                    var counterRate = !menu && !counterTarget && skill.hitType === 1 && runtime.canCounter(intendedTarget) ? runtime.traitRate(intendedTarget, 22, 6, true) : 0;
                    var counter = counterRate > 0 && runtime.random() < counterRate;
                    var reflectRate = !menu && !counterTarget && skill.hitType === 2 ? runtime.traitRate(intendedTarget, 22, 5, true) : 0;
                    var reflected = reflectRate > 0 && runtime.random() < reflectRate;
                    var target = reflected ? subject : !menu && !counterTarget ? runtime.substituteTarget(intendedTarget, skill) : intendedTarget;
                    var hit = { target: target.enemyId != null ? target.index : target.id, targetType: target.enemyId != null ? 'enemy' : 'actor', damage: 0 };
                    if (reflected) hit.reflectedBy = { type: intendedTarget.enemyId != null ? 'enemy' : 'actor', id: intendedTarget.enemyId != null ? intendedTarget.index : intendedTarget.id };
                    else if (target !== intendedTarget) hit.substituteFor = { type: intendedTarget.enemyId != null ? 'enemy' : 'actor', id: intendedTarget.enemyId != null ? intendedTarget.index : intendedTarget.id };
                    var success = (skill.successRate == null ? 100 : skill.successRate) / 100;
                    if (skill.hitType === 1) success *= runtime.traitRate(subject, 22, 0, true);
                    hit.missed = runtime.random() >= success;
                    hit.evaded = !hit.missed && skill.hitType !== 0 && runtime.random() < runtime.traitRate(target, 22, skill.hitType === 1 ? 1 : 4, true);
                    if (!hit.missed && !hit.evaded) {
                        var damage = skill.damage || { type: 0 }, value = 0;
                        if (damage.type > 0) {
                            var calculated = runtime.damageValue(subject, target, skill);
                            value = calculated.damage; hit.critical = calculated.critical;
                            var resource = calculated.resource;
                            runtime.changeResource(target, resource, -value);
                            if (resource === 'hp' && value > 0) runtime.battlerState(target).states.slice().forEach(function (id) {
                                var state = runtime.database.States[id];
                                if (state.removeByDamage && runtime.random() * 100 < state.chanceByDamage) runtime.removeState(target, id);
                            });
                            if (resource === 'hp' && value > 0) runtime.gainTp(target,
                                Math.floor(50 * value / runtime.battlerParam(target, 0) * runtime.traitRate(target, 23, 5)));
                            if (damage.type === 5 || damage.type === 6) runtime.changeResource(reflected ? intendedTarget : subject, resource, value);
                            hit.damage = value; hit.resource = resource; report.damage += value;
                            report.critical = report.critical || hit.critical;
                        }
                        (skill.effects || []).forEach(function (effect) {
                            if (effect.code === 22 && runtime.random() < effect.value1) { runtime.removeState(target, effect.dataId); runtime.syncActors(); }
                            if (effect.code === 43 && target.enemyId == null) runtime.state.changeActorSkill(target.id, effect.dataId, true);
                            if (effect.code !== 21) return;
                            if (effect.dataId === 0) runtime.battlerTraits(subject).filter(function (trait) { return trait.code === 32; }).forEach(function (trait) {
                                runtime.addState(target, trait.dataId, effect.value1 * trait.value, false);
                            });
                            else runtime.addState(target, effect.dataId, effect.value1, skill.hitType === 0);
                        });
                        runtime.gainTp(subject, Math.floor((skill.tpGain || 0) * runtime.traitRate(subject, 23, 5)));
                    }
                    hit.defeated = !target.alive; report.hits.push(hit);
                    if (counter && runtime.canCounter(intendedTarget)) {
                        hit.counter = runtime.useAction(intendedTarget, runtime.database.Skills[runtime.attackSkillId(intendedTarget)], 0, false, true, null, subject, deferred);
                    }
                }
            });
            report.defeated = !!(report.hits.length && report.hits[report.hits.length - 1].defeated);
            if (!menu) runtime.battle.actionRevision = (runtime.battle.actionRevision || 0) + 1;
        }
        var finished = false;
        function finish() {
            if (finished) return;
            finished = true;
            var state = runtime.battlerState(subject);
            if (!menu && !counterTarget) state.states.slice().forEach(function (id) {
                var definition = runtime.database.States[id];
                if (definition.autoRemovalTiming === 1 && state.stateTurns && state.stateTurns[id] === 0) runtime.removeState(subject, id);
            });
            if (!menu && !counterTarget) runtime.battle.lastAction = report;
        }
        if (deferred) {
            Object.defineProperty(report, 'pendingAction', { value: {
                subject: subject,
                done: function () { return finished; },
                apply: function (indices) { if (!finished) apply(indices.map(function (index) { return targets[index]; }), 1); },
                finish: finish,
                cancel: function () { finished = true; }
            } });
        } else { apply(targets, effectCount); finish(); }
        if (!menu && !counterTarget) this.battle.lastAction = report;
        return report;
    };
    BattleRuntime.prototype.attack = function (actorId, enemyIndex, skillId) {
        if (!this.battle || this.battle.result) throw new Error('Trận chiến không hoạt động.');
        if (this.battle.phase !== 'input') throw new Error('Chưa đến lượt nhân vật.');
        var actor = this.actor(actorId), enemy = this.enemy(enemyIndex);
        if (!actor || !actor.alive || !enemy || !enemy.alive || enemy.hidden) throw new Error('Mục tiêu chiến đấu không hợp lệ.');
        var report = this.useSkill(actor, skillId || 1, enemyIndex);
        this.battle.phase = 'enemy';
        if (!this.battle.managed) this.checkResult();
        return report;
    };
    BattleRuntime.prototype.enemyActionMatches = function (enemy, action) {
        var a = action.conditionParam1, b = action.conditionParam2, turn = this.battle.turn;
        switch (action.conditionType) {
        case 0: return true;
        case 1: return b === 0 ? turn === a : turn > 0 && turn >= a && (turn - a) % b === 0;
        case 2: return enemy.hp / enemy.mhp >= a && enemy.hp / enemy.mhp <= b;
        case 3: return enemy.mp / Math.max(1, enemy.mmp) >= a && enemy.mp / Math.max(1, enemy.mmp) <= b;
        case 4: return enemy.states.includes(a);
        case 5: return this.battle.actors.some(function (actor) { return this.state.actor(actor.id).level >= a; }, this);
        case 6: return this.state.switchValue(a);
        default: throw new Error('Điều kiện AI chưa hỗ trợ: ' + action.conditionType);
        }
    };
    BattleRuntime.prototype.chooseEnemyAction = function (enemy) {
        if (this.confusionLevel(enemy)) return this.canUseSkill(enemy, this.database.Skills[1]) ? { skillId: 1 } : null;
        var actions = (this.database.Enemies[enemy.enemyId].actions || []).filter(function (action) {
            return this.enemyActionMatches(enemy, action) && this.canUseSkill(enemy, this.database.Skills[action.skillId]);
        }, this);
        if (!actions.length) return null;
        var threshold = Math.max.apply(null, actions.map(function (action) { return action.rating; })) - 3;
        actions = actions.filter(function (action) { return action.rating > threshold; });
        var total = actions.reduce(function (sum, action) { return sum + action.rating - threshold; }, 0);
        var draw = this.random() * total;
        return actions.find(function (action) { draw -= action.rating - threshold; return draw < 0; }) || actions[actions.length - 1];
    };
    BattleRuntime.prototype.enemyActions = function () {
        var actions = [];
        this.aliveEnemies().forEach(function (enemy) {
            if (!this.takesTurn(enemy)) return;
            if ((this.battle.forcedThisTurn || []).includes('enemy:' + enemy.index)) return;
            var count = 1;
            this.enemyTraits(enemy).forEach(function (trait) { if (trait.code === 61 && this.random() < trait.value) count++; }, this);
            for (var index = 0; index < count; index++) {
                var action = this.chooseEnemyAction(enemy);
                if (action) actions.push({ enemy: enemy.index, skillId: action.skillId });
            }
        }, this);
        return actions;
    };
    BattleRuntime.prototype.regenerate = function (battler) {
        if (!battler.alive || battler.hidden) return null;
        var data = this.battlerState(battler), hp = data.hp, mp = data.mp, tp = data.tp || 0;
        var hpGain = Math.floor(this.battlerParam(battler, 0) * this.traitRate(battler, 22, 7, true));
        var mpGain = Math.floor(this.battlerParam(battler, 1) * this.traitRate(battler, 22, 8, true));
        var tpGain = Math.floor(100 * this.traitRate(battler, 22, 9, true));
        var maxLoss = this.database.System.optSlipDeath ? hp : Math.max(0, hp - 1);
        hpGain = Math.max(-maxLoss, hpGain);
        if (hpGain) this.changeResource(battler, 'hp', hpGain);
        if (mpGain) this.changeResource(battler, 'mp', mpGain);
        data = this.battlerState(battler);
        data.tp = Math.max(0, Math.min(100, (data.tp || 0) + tpGain));
        var effect = { subject: battler.enemyId != null ? 'enemy' : 'actor',
            subjectId: battler.enemyId != null ? battler.index : battler.id, hp: data.hp - hp, mp: data.mp - mp, tp: data.tp - tp };
        return effect.hp || effect.mp || effect.tp ? effect : null;
    };
    BattleRuntime.prototype.endBattlerTurn = function (battler) {
        var effect = this.regenerate(battler);
        var data = this.battlerState(battler), turns = data.stateTurns || (data.stateTurns = {});
        data.states.slice().forEach(function (id) {
            var state = this.database.States[id];
            if (!state || !state.autoRemovalTiming) return;
            if (state.autoRemovalTiming === 1 && turns[id] === 0) { this.removeState(battler, id); return; }
            if (turns[id] == null) this.resetStateTurns(battler, id);
            turns[id] = Math.max(0, turns[id] - 1);
            if (!turns[id] && state.autoRemovalTiming === 2) this.removeState(battler, id);
        }, this);
        return effect;
    };
    BattleRuntime.prototype.endTurn = function () {
        if (this.battle.extraTurn) return this.battle.turnEffects = [];
        this.syncActors();
        var effects = this.battle.turnEffects = [];
        this.battle.actors.concat(this.battle.enemies).forEach(function (battler) {
            var effect = this.endBattlerTurn(battler);
            if (effect) effects.push(effect);
        }, this);
        this.syncActors();
        return effects;
    };
    BattleRuntime.prototype.enemyTurn = function () {
        if (!this.battle || this.battle.result || this.battle.phase !== 'enemy') return [];
        var reports = [];
        this.enemyActions().forEach(function (action) {
            var enemy = this.enemy(action.enemy), skillId = this.confusionLevel(enemy) ? 1 : action.skillId, skill = this.database.Skills[skillId];
            if (this.canUseSkill(enemy, skill)) reports.push(this.useSkill(enemy, skillId, -1));
        }, this);
        this.endTurn();
        if (!this.battle.managed && !this.battle.extraTurn) this.battle.turn++;
        this.battle.phase = this.battle.managed ? 'events' : 'input';
        if (!this.battle.managed) { this.checkResult(); if (!this.battle.result) this.prepareNextInput(); }
        return reports;
    };
    BattleRuntime.prototype.checkResult = function () {
        if (!this.aliveActors().length) this.finish(this.battle.canLose ? 'defeat-continue' : 'defeat');
        else if (!this.aliveEnemies().length) this.finish('victory');
        return this.battle.result;
    };
    BattleRuntime.prototype.unitAgility = function (members) {
        return members.length ? members.reduce(function (sum, member) { return sum + this.battlerParam(member, 6); }.bind(this), 0) / members.length : 1;
    };
    BattleRuntime.prototype.takesTurn = function (battler) {
        return !this.battle || !this.battle.extraTurn || (this.battle.extraMembers || []).includes(this.battlerKey(battler));
    };
    BattleRuntime.prototype.prepareNextInput = function () {
        var battle = this.battle;
        if (battle.extraTurn) { battle.extraTurn = false; battle.extraMembers = []; return; }
        var actorAverage = this.unitAgility(battle.actors), enemyAverage = this.unitAgility(battle.enemies);
        battle.extraMembers = battle.actors.concat(battle.enemies).filter(function (battler) {
            return this.canCounter(battler) && this.battlerParam(battler, 6) > 1.5 * (battler.enemyId != null ? actorAverage : enemyAverage);
        }, this).map(this.battlerKey.bind(this));
        battle.extraTurn = battle.extraMembers.length > 0;
    };
    BattleRuntime.prototype.initialEscapeRatio = function () {
        return 0.5 * this.unitAgility(this.battle.actors) / this.unitAgility(this.battle.enemies);
    };
    BattleRuntime.prototype.escape = function () {
        if (!this.battle || this.battle.result || this.battle.phase !== 'input' || !this.battle.canEscape) return false;
        if (this.battle.escapeRatio == null) this.battle.escapeRatio = this.initialEscapeRatio();
        if (this.random() < this.battle.escapeRatio) { this.battle.escapeFailed = false; this.finish('escape'); return true; }
        this.battle.escapeRatio += 0.1;
        this.battle.escapeFailed = true;
        this.battle.phase = 'enemy';
        if (!this.battle.managed) this.enemyTurn();
        return false;
    };
    BattleRuntime.prototype.save = function () { return clone(this.battle); };
    return { BattleRuntime: BattleRuntime };
}));
