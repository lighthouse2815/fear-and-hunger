'use strict';
/* ============================================================
   FNH Engine — trận đấu theo lượt với Guard
   ============================================================ */
(function () {
    const FNH = window.FNH = window.FNH || {};

    FNH.Scene_Battle = class Scene_Battle extends FNH.Scene {
        constructor() {
            super();
            this.name = 'battle';
            this.time = 0;
            this.phase = 'intro';
            this.timer = 1.7;
            this.index = 0;
            this.hoverIndex = -1;
            this.commands = ['TẤN CÔNG', 'PHÒNG THỦ', 'BỎ CHẠY', 'KỸ NĂNG', 'VẬT PHẨM'];
            this.actionMenu = null;
            this.actionMenuIndex = 0;
            this.log = '';
            this.turn = 1;
            this.damageNumbers = [];
            this.enemyFlash = 0;
            this.shake = 0;
            this.guarding = false;
            this.leaving = false;
            this.returnX = 27;
            this.returnY = 65;
            this.returnDir = 2;
            this.enemy = null;
            this.player = null;
            this.members = [];
            this.memberIndex = 0;
            this.guardedActors = new Set();
        }

        enter(options) {
            const opts = options || {};
            this.returnX = opts.returnX === undefined ? 27 : opts.returnX;
            this.returnY = opts.returnY === undefined ? 65 : opts.returnY;
            this.returnDir = opts.returnDir === undefined ? 2 : opts.returnDir;
            const ids = this.game.partyIds || [this.game.player.id];
            this.members = ids.map((id) => id === this.game.player.id ? this.game.player : this.game.actorStates[id]).filter(Boolean);
            this.memberIndex = Math.max(0, this.members.findIndex((actor) => actor.hp > 0));
            this.player = this.members[this.memberIndex] || this.game.player;
            this.guardedActors.clear();
            this.encounter = opts.encounter || null;
            this.returnScene = opts.returnScene || null;
            this.battleToken = opts.token || null;
            this.returnAudio = opts.returnAudio || null;
            this.canEscape = opts.canEscape !== false;
            this.canLose = !!opts.canLose;
            if (this.encounter) {
                this.enemies = this.encounter.enemies;
                this.enemy = this.enemies.find((enemy) => !enemy.hidden && enemy.hp > 0) || this.enemies[0];
            } else {
                this.enemy = this.game.data.createGuardEncounter();
                this.enemy.hp = this.enemy.maxHp;
                this.enemy.maxMp = 0;
                this.enemy.mp = 0;
                this.enemy.baseParams = [this.enemy.maxHp, 0, this.enemy.atk, this.enemy.def, 10, 10, this.enemy.agi || 10, 10];
                if (this.game.data.refreshActor) this.game.data.refreshActor(this.enemy);
                this.enemies = [this.enemy];
            }
            for (const enemy of this.enemies) {
                for (const part of enemy.parts) this.game.assets.loadImage(part.image).catch((error) => {
                    this.game.lastError = error;
                    this.game.showToast(error.message, 6);
                });
            }
            const mean = (members) => members.reduce((sum, actor) => sum + actor.agi, 0) / Math.max(1, members.length);
            this.escapeRatio = this.encounter ? 0.5 * mean(this.members) / Math.max(1, mean(this.enemies)) : 0.55;
            this.commonEventContext = null;
            this.battleEventFlags = new Map();
            this.phase = 'intro';
            this.timer = 1.7;
            this.index = 0;
            this.hoverIndex = -1;
            this.log = this.enemy.intro || (this.encounter ? this.encounter.name : this.enemy.name);
            this.turn = 1;
            this.damageNumbers = [];
            this.enemyFlash = 0;
            this.shake = 0;
            this.guarding = false;
            this.leaving = false;
            this.time = 0;
            this.result = null;
            this.game.audio.stopBgs(0.35);
            const music = this.encounter && this.game.data.system ? this.game.data.system.battleBgm : null;
            if (music && music.name) this.game.audio.playBgm(music.name, {
                volume: music.volume / 100, pitch: music.pitch, pan: music.pan, loop: true
            });
            else this.game.audio.playBgm('muted_aggression', { volume: 0.48, loop: true });
            if (!this.encounter) this.game.audio.playSe('guard_grunt1', { volume: 0.65 });
        }

        livingEnemies() {
            return this.enemies.filter((enemy) => !enemy.hidden && enemy.hp > 0);
        }

        chooseEnemyAction(enemy) {
            const valid = (enemy.actions || []).filter((entry) => {
                const a = entry.conditionParam1, b = entry.conditionParam2;
                if (entry.conditionType === 1 && !(b === 0 ? this.turn === a : this.turn > 0 && this.turn >= a && this.turn % b === a % b)) return false;
                if (entry.conditionType === 2 && !(enemy.hp / enemy.maxHp >= a && enemy.hp / enemy.maxHp <= b)) return false;
                if (entry.conditionType === 3 && !(enemy.mp / Math.max(1, enemy.maxMp) >= a && enemy.mp / Math.max(1, enemy.maxMp) <= b)) return false;
                if (entry.conditionType === 4 && !(enemy.states || []).includes(a)) return false;
                if (entry.conditionType === 5 && !this.members.some((actor) => actor.level >= a)) return false;
                if (entry.conditionType === 6 && !this.game.flags['switch:' + a]) return false;
                if (entry.conditionType < 0 || entry.conditionType > 6) throw new Error('Chưa hỗ trợ điều kiện AI ' + entry.conditionType);
                const skill = this.game.data.skill(entry.skillId);
                return skill && new FNH.Action(this.game.data, skill).canUse(enemy, true);
            });
            if (!valid.length) return null;
            const cutoff = Math.max(...valid.map((entry) => entry.rating)) - 3;
            const candidates = valid.filter((entry) => entry.rating > cutoff);
            let value = Math.random() * candidates.reduce((sum, entry) => sum + entry.rating - cutoff, 0);
            for (const entry of candidates) {
                value -= entry.rating - cutoff;
                if (value < 0) return this.game.data.skill(entry.skillId);
            }
            return this.game.data.skill(candidates[candidates.length - 1].skillId);
        }

        randomTarget(members) {
            if (!members.length) return null;
            const weights = members.map((actor) => actor.tgr === undefined ? 1 : Math.max(0, actor.tgr));
            let value = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
            for (let i = 0; i < members.length; i += 1) {
                value -= weights[i];
                if (value < 0) return members[i];
            }
            return members[members.length - 1];
        }

        actionTargets(user, skill, targetIndex) {
            const allies = this.enemies.includes(user) ? this.enemies : this.members;
            const opponents = this.enemies.includes(user) ? this.members : this.enemies;
            const present = (actor) => !actor.hidden;
            const alive = opponents.filter((actor) => present(actor) && actor.hp > 0);
            const friends = allies.filter((actor) => present(actor) && (skill.scope === 9 || skill.scope === 10 ? actor.hp <= 0 : actor.hp > 0));
            if (skill.scope === 0) return [null];
            if (skill.scope === 11) return [user];
            if (skill.scope === 2) return alive;
            if (skill.scope === 8 || skill.scope === 10) return friends;
            if (skill.scope >= 3 && skill.scope <= 6) return Array.from({ length: skill.scope - 2 }, () => this.randomTarget(alive));
            const pool = skill.scope >= 7 ? friends : alive;
            const unit = skill.scope >= 7 ? allies : opponents;
            const index = targetIndex === -2 ? (user.lastTargetIndex || 0) : targetIndex;
            const target = index >= 0 ? (pool.includes(unit[index]) ? unit[index] : pool[0]) : this.randomTarget(pool);
            return target ? [target] : [];
        }

        forceAction(user, skillId, targetIndex) {
            if (!user || user.hp <= 0) return false;
            const skill = this.game.data.skill(skillId);
            const action = new FNH.Action(this.game.data, skill);
            const targets = this.actionTargets(user, skill, targetIndex);
            action.pay(user);
            user.mp = Math.max(0, user.mp);
            user.tp = Math.max(0, user.tp);
            for (const target of targets) {
                for (let repeat = 0; repeat < Math.max(1, skill.repeats || 1); repeat += 1) {
                    const result = action.apply(user, target, this.guardedActors.has(target && target.id));
                    if (result.commonEvent) this.game.reservedCommonEvent = result.commonEvent;
                    if (result.hp) this.addDamage(Math.abs(result.hp), 408, 264, result.hp < 0 ? '#a9d99c' : '#ff9a86', false);
                }
                if (target) user.lastTargetIndex = (this.enemies.includes(target) ? this.enemies : this.members).indexOf(target);
            }
            if (this.enemyQueue) this.enemyQueue = this.enemyQueue.filter((enemy) => enemy !== user);
            this.log = user.name + ' dùng ' + skill.name + '.';
            this.game.data.actorTurnEnd(user, 1);
            return true;
        }

        nextEnemyAction() {
            const enemy = this.enemyQueue.shift();
            if (!enemy) return false;
            this.phase = 'enemy';
            this.timer = 0.75;
            if (enemy.hp <= 0 || enemy.hidden || enemy.restriction === 4) return true;
            try {
                const skill = this.chooseEnemyAction(enemy);
                if (!skill) { this.log = enemy.name + ' không hành động.'; return true; }
                const action = new FNH.Action(this.game.data, skill);
                const targets = this.actionTargets(enemy, skill, -1);
                action.pay(enemy);
                for (const target of targets) {
                    if (!target && skill.scope !== 0) continue;
                    for (let repeat = 0; repeat < Math.max(1, skill.repeats || 1); repeat += 1) {
                        const result = action.apply(enemy, target, this.guardedActors.has(target && target.id));
                        if (result.commonEvent) this.game.reservedCommonEvent = result.commonEvent;
                        if (result.hp) this.addDamage(Math.abs(result.hp), 226, 398, result.hp < 0 ? '#a9d99c' : '#ff9a86', true);
                    }
                    if (target && this.members.includes(target)) this.player = target;
                }
                this.log = enemy.name + ' dùng ' + skill.name + '.';
                this.game.data.actorTurnEnd(enemy, 1);
            } catch (error) {
                this.game.lastError = error;
                this.game.showToast(error.message, 6);
                this.enemyQueue.length = 0;
            }
            return true;
        }

        selectMember(index) {
            this.memberIndex = index;
            this.player = this.members[index];
            this.index = 0;
            this.hoverIndex = -1;
            this.guarding = this.guardedActors.has(this.player.id);
            this.game.assets.loadImage('faces/' + this.player.faceName).catch((error) => {
                this.game.lastError = error;
                this.game.showToast(error.message, 6);
            });
            if (this.player.restriction === 4) {
                this.log = this.player.name + ' không thể hành động.';
                this.phase = 'player';
                this.timer = 0.7;
            } else {
                this.phase = 'command';
                this.log = 'Đến lượt ' + this.player.name + '.';
            }
        }

        finishActorAction() {
            this.game.data.actorTurnEnd(this.player, 1);
            const next = this.members.findIndex((actor, index) => index > this.memberIndex && actor.hp > 0);
            if (next >= 0) this.selectMember(next);
            else this.enemyTurn();
        }

        commandRects() {
            return this.commands.map(function (label, index) {
                return {
                    x: 476 + (index % 2) * 150,
                    y: 490 + Math.floor(index / 2) * 34,
                    width: 144,
                    height: 30
                };
            });
        }

        addDamage(value, x, y, color, playerDamage) {
            this.damageNumbers.push({
                value: value,
                x: x,
                y: y,
                color: color,
                life: 1.1,
                maxLife: 1.1,
                playerDamage: !!playerDamage
            });
        }

        rollDamage(attack, defense) {
            const variance = Math.floor(Math.random() * 9) - 4;
            return Math.max(1, Math.round(attack * 2 - defense * 0.7 + variance));
        }

        choose(index) {
            if (this.phase !== 'command') return;
            this.index = index;
            this.game.audio.playSe('fnh_choice', { volume: 0.5 });
            if (index === 0) {
                this.playerAttack();
            } else if (index === 1) {
                this.playerGuard();
            } else if (index === 2) {
                this.playerFlee();
            } else {
                this.openActionMenu(index === 3);
            }
        }

        openActionMenu(isSkill) {
            const data = this.game.data;
            const skillIds = [...new Set([...(this.player.skills || []), ...data.battlerTraits(this.player)
                .filter((trait) => trait.code === 43).map((trait) => trait.dataId)])];
            const entries = isSkill ? skillIds.map((id) => ({ item: data.skill(id), isSkill: true }))
                : (this.game.player.inventory || []).filter((entry) => (entry.kind || 'item') === 'item' && entry.amount > 0)
                    .map((entry) => ({ item: data.items[entry.id], isSkill: false, amount: entry.amount }));
            this.actionMenu = entries.filter((entry) => entry.item && [0, 1].includes(entry.item.occasion));
            this.actionMenuIndex = 0;
            this.phase = 'actionMenu';
        }

        useAction(entry, targets) {
            try {
                const action = new FNH.Action(this.game.data, entry.item);
                if (!action.canUse(this.player, entry.isSkill)) {
                    this.log = 'Không thể dùng hành động này.';
                    return false;
                }
                if (entry.isSkill) action.pay(this.player);
                else if (entry.item.consumable) {
                    const inventory = this.game.player.inventory;
                    const item = inventory.find((item) => (item.kind || 'item') === 'item' && item.id === entry.item.id && item.amount > 0);
                    if (!item) return false;
                    item.amount -= 1;
                    if (!item.amount) inventory.splice(inventory.indexOf(item), 1);
                }
                const results = [];
                for (const target of targets.length ? targets : [null]) {
                    for (let repeat = 0; repeat < Math.max(1, entry.item.repeats || 1); repeat += 1) {
                        const result = action.apply(this.player, target, this.guardedActors.has(target && target.id));
                        if (result.commonEvent) this.game.reservedCommonEvent = result.commonEvent;
                        results.push(result);
                    }
                }
                if (targets[0]) this.player.lastTargetIndex = (this.enemies.includes(targets[0]) ? this.enemies : this.members).indexOf(targets[0]);
                if (targets[0] && this.enemies && this.enemies.includes(targets[0])) this.enemy = targets[0];
                const total = results.reduce((sum, result) => sum + result.hp, 0);
                const missed = results.every((result) => result.missed);
                if (total) this.addDamage(Math.abs(total), targets[0] === this.enemy ? 408 : 226,
                    targets[0] === this.enemy ? 264 : 398, total < 0 ? '#a9d99c' : '#ffd39b', targets[0] !== this.enemy);
                this.enemyFlash = targets.includes(this.enemy) && total ? 0.24 : 0;
                this.log = this.player.name + ' dùng ' + entry.item.name + (missed ? ' — trượt' : total ? ' — HP ' + (-total) : '') + '.';
                this.phase = 'player';
                this.timer = 0.9;
                this.actionMenu = null;
                this.game.audio.playSe('Decision1', { volume: 0.5 });
                return true;
            } catch (error) {
                this.game.lastError = error;
                this.game.showToast(error.message, 6);
                return false;
            }
        }

        chooseAction(entry) {
            const scope = entry.item.scope;
            if (scope === 7 || scope === 9) {
                const targets = this.members.filter((actor) => scope === 9 ? actor.hp <= 0 : actor.hp > 0);
                if (!targets.length) { this.log = 'Không có mục tiêu phù hợp.'; return; }
                this.pendingAction = entry;
                this.actionMenu = targets.map((actor) => ({ actor }));
                this.actionMenuIndex = 0;
                this.phase = 'actionTarget';
                return;
            }
            if (scope === 8 || scope === 10) {
                const targets = this.members.filter((actor) => scope === 10 ? actor.hp <= 0 : actor.hp > 0);
                if (!targets.length) { this.log = 'Không có mục tiêu phù hợp.'; return; }
                this.useAction(entry, targets);
            } else if (scope === 11) this.useAction(entry, [this.player]);
            else if (scope === 1 && this.livingEnemies().length > 1) {
                this.pendingAction = entry;
                this.actionMenu = this.livingEnemies().map((actor) => ({ actor }));
                this.actionMenuIndex = 0;
                this.phase = 'actionTarget';
            } else if (scope === 2) this.useAction(entry, this.livingEnemies());
            else if (scope >= 1 && scope <= 6) this.useAction(entry, Array.from({ length: scope >= 3 ? scope - 2 : 1 }, () => this.randomTarget(this.livingEnemies())));
            else if (scope === 0) this.useAction(entry, []);
            else this.game.showToast('Chưa hỗ trợ phạm vi hành động ' + scope, 4);
        }

        updateActionMenu() {
            const input = this.input;
            if (input.isPressed('Escape', 'x', 'X')) {
                this.phase = 'command';
                this.actionMenu = null;
                return;
            }
            const count = this.actionMenu.length;
            if (count && input.isPressed('ArrowUp', 'w', 'W')) this.actionMenuIndex = (this.actionMenuIndex + count - 1) % count;
            if (count && input.isPressed('ArrowDown', 's', 'S')) this.actionMenuIndex = (this.actionMenuIndex + 1) % count;
            if (count && input.isPressed('Enter', ' ', 'z', 'Z')) {
                const entry = this.actionMenu[this.actionMenuIndex];
                if (this.phase === 'actionTarget') this.useAction(this.pendingAction, [entry.actor]);
                else this.chooseAction(entry);
            }
        }

        drawActionMenu(ctx) {
            if (!this.actionMenu || !['actionMenu', 'actionTarget'].includes(this.phase)) return;
            FNH.panel(ctx, 96, 100, FNH.WIDTH - 192, 340);
            const start = Math.max(0, this.actionMenuIndex - 6);
            const entries = this.actionMenu.slice(start, start + 7);
            if (!entries.length) FNH.text(ctx, 'Không có hành động phù hợp.', 120, 140, { size: 18 });
            entries.forEach((entry, index) => {
                let label;
                if (entry.actor) label = entry.actor.name + ' · HP ' + entry.actor.hp + '/' + entry.actor.maxHp;
                else label = entry.item.name + (entry.isSkill ? ' · MP ' + Math.floor((entry.item.mpCost || 0) * (this.player.mcr === undefined ? 1 : this.player.mcr)) : ' ×' + entry.amount);
                FNH.text(ctx, (start + index === this.actionMenuIndex ? '› ' : '  ') + label, 120, 138 + index * 38,
                    { size: 18, color: start + index === this.actionMenuIndex ? '#f4deb0' : '#b9b09e' });
            });
            FNH.text(ctx, '↑ ↓ CHỌN · ENTER XÁC NHẬN · ESC QUAY LẠI', 120, 423, { size: 11 });
        }

        playerAttack() {
            this.chooseAction({ item: this.game.data.skill(1), isSkill: true });
        }

        playerGuard() {
            this.guarding = true;
            this.guardedActors.add(this.player.id);
            this.log = this.player.name + ' nâng cao phòng thủ, chờ đòn đánh tới.';
            this.game.audio.playSe('Decision1', { volume: 0.5 });
            this.phase = 'player';
            this.timer = 0.7;
        }

        playerFlee() {
            if (!this.canEscape) {
                this.log = 'Không thể bỏ chạy khỏi trận này.';
                this.game.audio.playSe('fnh_buzzer', { volume: 0.4 });
                return;
            }
            if (Math.random() < this.escapeRatio) {
                this.result = 'fled';
                this.log = 'Bạn lùi lại, hoà mình vào bóng tối và rút lui.';
                this.game.audio.playSe('fnh_cancel', { volume: 0.55 });
                this.game.audio.stopBgm(0.5);
                this.phase = 'fled';
                this.timer = 1.2;
            } else {
                this.escapeRatio += 0.1;
                this.log = 'Bạn cố chạy nhưng không thoát được.';
                this.game.audio.playSe('fnh_buzzer', { volume: 0.4 });
                this.phase = 'player';
                this.timer = 0.8;
            }
        }

        enemyTurn() {
            if (this.encounter) {
                this.enemyQueue = this.livingEnemies().slice();
                this.nextEnemyAction();
                return;
            }
            if (this.enemy.restriction === 4) {
                this.log = this.enemy.name + ' không thể hành động.';
                this.phase = 'enemy';
                this.timer = 0.7;
                return;
            }
            const alive = this.members.filter((actor) => actor.hp > 0);
            if (!alive.length) {
                this.defeat();
                return;
            }
            const weights = alive.map((actor) => actor.tgr === undefined ? 1 : Math.max(0, actor.tgr));
            let roll = Math.random() * weights.reduce((sum, value) => sum + value, 0);
            let target = alive[alive.length - 1];
            for (let i = 0; i < alive.length; i += 1) {
                roll -= weights[i];
                if (roll < 0) { target = alive[i]; break; }
            }
            const wasGuarding = this.guardedActors.has(target.id);
            let damage = this.rollDamage(this.enemy.atk, target.def);
            damage = Math.max(0, Math.round(damage * (target.pdr === undefined ? 1 : target.pdr)));
            if (wasGuarding) damage = Math.max(0, Math.ceil(damage / (2 * Math.max(0.01, target.grd || 1))));
            this.game.data.setActorHp(target, target.hp - damage);
            this.player = target;
            this.guarding = wasGuarding;
            this.addDamage(damage, 226, 398, '#ff9a86', true);
            this.shake = 0.5;
            this.log = 'Guard đánh ' + target.name + (wasGuarding ? ' đang phòng thủ' : '') + ' — ' + damage + ' sát thương.';
            this.game.audio.playSe('Damage1', { volume: 0.65 });
            this.game.audio.playSe('guard_breath1', { volume: 0.35 });
            this.phase = 'enemy';
            this.timer = 1.05;
        }

        victory() {
            if (this.result === 'victory') return;
            this.phase = 'victory';
            this.result = 'victory';
            if (!this.encounter) this.game.guardDefeated = true;
            this.rewardGold = this.enemies.filter((enemy) => enemy.hp <= 0).reduce((sum, enemy) => sum + enemy.rewardGold, 0);
            this.rewardExp = this.enemies.filter((enemy) => enemy.hp <= 0).reduce((sum, enemy) => sum + enemy.rewardExp, 0);
            this.game.gold += this.rewardGold;
            const inventory = this.game.player.inventory || (this.game.player.inventory = []);
            for (const enemy of this.enemies.filter((enemy) => enemy.hp <= 0)) {
                for (const drop of enemy.dropItems || []) {
                    if (!drop.kind || Math.random() * Math.max(1, drop.denominator) >= 1) continue;
                    const kind = ['item', 'weapon', 'armor'][drop.kind - 1];
                    const table = [this.game.data.items, this.game.data.weapons, this.game.data.armors][drop.kind - 1];
                    if (!kind || !table || !table[drop.dataId]) continue;
                    const entry = inventory.find((entry) => entry.id === drop.dataId && (entry.kind || 'item') === kind);
                    if (entry) entry.amount += 1;
                    else inventory.push({ id: drop.dataId, amount: 1, kind });
                }
            }
            for (const actor of this.members) {
                actor.exp = (actor.exp || 0) + Math.round(this.rewardExp * (actor.exr === undefined ? 1 : actor.exr));
            }
            this.log = 'Đối thủ đã gục ngã.';
            this.game.audio.stopBgm(0.5);
            this.game.audio.playSe('fnh_choice', { volume: 0.6 });
        }

        defeat() {
            this.phase = 'defeat';
            this.result = 'defeat';
            this.timer = 1.7;
            this.log = 'Đôi chân khuỵu xuống. Bóng tối nuốt lấy bạn.';
            this.game.audio.stopBgm(0.5);
            this.game.audio.playSe('Damage3', { volume: 0.7 });
        }

        returnToMap() {
            if (this.leaving) return;
            this.leaving = true;
            this.game.player.mapX = this.returnX;
            this.game.player.mapY = this.returnY;
            this.game.player.direction = this.returnDir;
            if (this.battleToken && this.returnScene) {
                this.battleToken.result = this.result === 'victory' ? 0 : this.result === 'defeat' ? 2 : 1;
                this.battleToken.done = true;
                this.game.audio.stopBgm(0.2);
                for (const [sound, method] of [[this.returnAudio && this.returnAudio.bgm, 'playBgm'],
                    [this.returnAudio && this.returnAudio.bgs, 'playBgs']]) {
                    if (sound && sound.name) this.game.audio[method](sound.name, sound).catch((error) => {
                        this.game.lastError = error;
                        this.game.showToast(error.message, 6);
                    });
                }
                this.game.changeScene(this.returnScene, { resume: true });
            } else this.game.changeScene(FNH.Scene_Map, { fromBattle: true });
        }

        battleEventContext() {
            if (!this.commonEventContext) {
                const context = this.commonEventContext = new FNH.Scene_Map();
                context.game = this.game;
                context.input = this.input;
                context.battle = this;
                context.map = this.game.data.maps.get(this.game.mapId) || { events: [] };
            }
            return this.commonEventContext;
        }

        battleEventMatches(page) {
            const c = page.conditions || {};
            if (!(c.turnEnding || c.turnValid || c.enemyValid || c.actorValid || c.switchValid)) return false;
            if (c.turnEnding && this.phase !== 'turnEnd') return false;
            if (c.turnValid) {
                const turn = this.phase === 'intro' ? 0 : this.turn;
                if (c.turnB === 0 ? turn !== c.turnA : turn < 1 || turn < c.turnA || turn % c.turnB !== c.turnA % c.turnB) return false;
            }
            if (c.enemyValid) {
                const enemy = this.enemies[c.enemyIndex];
                if (!enemy || enemy.hp * 100 > enemy.maxHp * c.enemyHp) return false;
            }
            if (c.actorValid) {
                const actor = this.battleEventContext().eventActor(c.actorId);
                if (!actor || actor.hp * 100 > actor.maxHp * c.actorHp) return false;
            }
            if (c.switchValid && !this.game.flags['switch:' + c.switchId]) return false;
            return true;
        }

        updateBattleEvent() {
            if (!this.encounter || ['victory', 'fled', 'defeat'].includes(this.phase)) return false;
            const pages = this.encounter.pages || [];
            for (let index = 0; index < pages.length; index += 1) {
                const page = pages[index];
                if (this.commonEventContext && this.commonEventContext.failedAutorunPages.has(page)) continue;
                const turn = this.phase === 'intro' ? 0 : this.turn;
                const flag = this.battleEventFlags.get(index);
                if (flag !== undefined && (page.span === 0 || page.span === 1 && flag === turn)) continue;
                if (!this.battleEventMatches(page)) continue;
                if (page.span <= 1) this.battleEventFlags.set(index, turn);
                return this.battleEventContext().startEventList(page, 0);
            }
            return false;
        }

        updateCommonEvent(dt) {
            if (this.game.reservedCommonEvent && !(this.commonEventContext && this.commonEventContext.eventRunner)) {
                const id = this.game.reservedCommonEvent;
                const event = this.game.data.commonEvents[id];
                this.game.reservedCommonEvent = null;
                if (!event) {
                    this.game.lastError = new Error('Không tìm thấy common event ' + id);
                    this.game.showToast(this.game.lastError.message, 6);
                    return false;
                }
                this.battleEventContext();
                this.commonEventContext.startEventList(event, 0);
                if (this.commonEventContext.leaving) this.leaving = true;
                return true;
            }
            const context = this.commonEventContext;
            if (!context || !context.eventRunner) return false;
            if (context.paused) context.updatePause(dt);
            else context.updateEvent(dt);
            this.paused = context.paused;
            if (context.leaving) this.leaving = true;
            return true;
        }

        update(dt) {
            this.time += dt;
            if (this.enemyFlash > 0) this.enemyFlash = Math.max(0, this.enemyFlash - dt);
            if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 1.6);
            for (const item of this.damageNumbers) {
                item.life -= dt;
                item.y -= dt * 34;
            }
            this.damageNumbers = this.damageNumbers.filter(function (item) { return item.life > 0; });
            if (this.leaving) return;
            if (this.updateCommonEvent(dt)) return;
            if (this.updateBattleEvent()) return;

            const input = this.input;
            if (this.phase === 'actionMenu' || this.phase === 'actionTarget') {
                this.updateActionMenu();
                return;
            }
            if (this.phase === 'intro') {
                this.timer -= dt;
                if (input.isPressed('Enter', ' ', 'z', 'Z') || this.timer <= 0) {
                    const index = this.members.findIndex((actor) => actor.hp > 0);
                    if (index < 0) this.defeat();
                    else this.selectMember(index);
                }
                return;
            }

            if (this.phase === 'command') {
                if (input.isPressed('ArrowUp', 'w', 'W')) {
                    this.index = (this.index + this.commands.length - 1) % this.commands.length;
                    this.game.audio.playSe('fnh_cursor', { volume: 0.4 });
                }
                if (input.isPressed('ArrowDown', 's', 'S')) {
                    this.index = (this.index + 1) % this.commands.length;
                    this.game.audio.playSe('fnh_cursor', { volume: 0.4 });
                }
                if (input.isPressed('Enter', ' ', 'z', 'Z')) {
                    this.choose(this.index);
                    return;
                }

                const rects = this.commandRects();
                this.hoverIndex = -1;
                for (let i = 0; i < rects.length; i += 1) {
                    if (FNH.hit(rects[i], input.mouse.x, input.mouse.y)) {
                        this.hoverIndex = i;
                        break;
                    }
                }
                if (this.hoverIndex >= 0 && this.hoverIndex !== this.index) {
                    this.index = this.hoverIndex;
                    this.game.audio.playSe('fnh_cursor', { volume: 0.35 });
                }
                const click = input.consumeClick();
                if (click) {
                    for (let i = 0; i < rects.length; i += 1) {
                        if (FNH.hit(rects[i], click.x, click.y)) {
                            this.choose(i);
                            break;
                        }
                    }
                }
                return;
            }

            if (this.phase === 'player') {
                this.timer -= dt;
                if (this.timer <= 0) {
                    if (!this.livingEnemies().length) this.victory();
                    else this.finishActorAction();
                }
                return;
            }

            if (this.phase === 'enemy') {
                this.timer -= dt;
                if (this.timer <= 0) {
                    if (this.encounter && this.enemyQueue.length && this.members.some((actor) => actor.hp > 0)) {
                        this.nextEnemyAction();
                        return;
                    }
                    for (const actor of this.members) this.game.data.actorTurnEnd(actor, 2);
                    for (const enemy of this.enemies) this.game.data.actorTurnEnd(enemy, 2);
                    this.phase = 'turnEnd';
                }
                if (this.phase !== 'turnEnd') return;
                if (this.updateBattleEvent()) return;
            }

            if (this.phase === 'turnEnd') {
                if (!this.livingEnemies().length) {
                    this.victory();
                    return;
                }
                this.guardedActors.clear();
                const index = this.members.findIndex((actor) => actor.hp > 0);
                if (index < 0) this.defeat();
                else {
                    this.turn += 1;
                    this.selectMember(index);
                }
                return;
            }

            if (this.phase === 'victory') {
                if (input.isPressed('Enter', ' ', 'z', 'Z') || input.consumeClick()) {
                    this.returnToMap();
                }
                return;
            }

            if (this.phase === 'fled') {
                this.timer -= dt;
                if (this.timer <= 0) this.returnToMap();
                return;
            }

            if (this.phase === 'defeat') {
                this.timer -= dt;
                if (this.timer <= 0 && !this.leaving) {
                    if (this.canLose && this.returnScene) {
                        for (const actor of this.members) if (actor.hp <= 0) this.game.data.setActorHp(actor, 1);
                        this.returnToMap();
                    } else {
                        this.leaving = true;
                        this.game.gameOver();
                    }
                }
            }
        }

        drawBattleback(ctx) {
            const image = this.game.assets.imageCache.get('battlebacks1/floor1');
            if (image) {
                const scale = Math.max(FNH.WIDTH / image.width, FNH.HEIGHT / image.height);
                const width = image.width * scale;
                const height = image.height * scale;
                ctx.drawImage(image, (FNH.WIDTH - width) / 2, (FNH.HEIGHT - height) / 2, width, height);
            } else {
                FNH.drawBackdrop(ctx, '#151413', '#050505');
            }
            const shade = ctx.createLinearGradient(0, 0, 0, FNH.HEIGHT);
            shade.addColorStop(0, 'rgba(4,5,7,0.2)');
            shade.addColorStop(0.55, 'rgba(4,5,7,0.28)');
            shade.addColorStop(1, 'rgba(4,5,7,0.8)');
            ctx.fillStyle = shade;
            ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
        }

        drawEnemy(ctx) {
            if (!this.enemy) return;
            const parts = this.enemies.filter((enemy) => !enemy.hidden && enemy.hp > 0).flatMap((enemy) => enemy.parts).sort(function (a, b) { return a.y - b.y; });
            const shakeX = this.shake > 0 ? (Math.random() * 2 - 1) * this.shake * 10 : 0;
            const shakeY = this.shake > 0 ? (Math.random() * 2 - 1) * this.shake * 6 : 0;

            ctx.save();
            ctx.translate(shakeX, shakeY);
            const shadow = ctx.createRadialGradient(412, 456, 10, 412, 456, 150);
            shadow.addColorStop(0, 'rgba(0,0,0,0.6)');
            shadow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = shadow;
            ctx.fillRect(250, 350, 330, 120);

            for (let i = 0; i < parts.length; i += 1) {
                const part = parts[i];
                const image = this.game.assets.imageCache.get(part.image);
                if (!image) continue;
                const breathing = Math.sin(this.time * 2.1 + i * 0.8) * 1.4;
                if (this.enemyFlash > 0) ctx.filter = 'brightness(1.85)';
                ctx.drawImage(image, part.x - image.width / 2, part.y - image.height + breathing);
                ctx.filter = 'none';
            }
            ctx.restore();
        }

        drawEnemyHud(ctx) {
            if (!this.enemy) return;
            FNH.panel(ctx, 248, 20, 320, 56, {
                alpha: 0.9,
                fillTop: 'rgba(17,15,13,0.9)',
                fillBottom: 'rgba(5,5,5,0.94)',
                border: 'rgba(172,139,93,0.48)'
            });
            FNH.text(ctx, this.enemy.name || 'ĐỐI THỦ', 266, 42, {
                size: 15,
                weight: 600,
                color: '#ead9b8'
            });
            FNH.text(ctx, 'LƯỢT ' + this.turn, 550, 42, {
                size: 10,
                weight: 600,
                color: 'rgba(212,194,158,0.55)',
                align: 'right'
            });
            FNH.bar(ctx, 266, 52, 284, 9, this.enemy.hp / this.enemy.maxHp, {
                colorA: '#5b1515',
                colorB: '#b34a36'
            });
            FNH.text(ctx, this.enemy.hp + ' / ' + this.enemy.maxHp, 550, 68, {
                size: 9,
                color: 'rgba(231,214,181,0.62)',
                align: 'right'
            });
        }

        drawActorPanel(ctx) {
            const player = this.player;
            FNH.panel(ctx, 24, 452, 768, 156, {
                alpha: 0.96,
                fillTop: 'rgba(19,17,14,0.96)',
                fillBottom: 'rgba(5,5,5,0.98)',
                border: 'rgba(188,164,113,0.58)'
            });

            FNH.text(ctx, this.log, 40, 472, {
                size: 11,
                color: 'rgba(229,216,190,0.88)'
            });
            ctx.strokeStyle = 'rgba(188,164,113,0.2)';
            ctx.beginPath();
            ctx.moveTo(40, 482);
            ctx.lineTo(776, 482);
            ctx.stroke();

            const face = this.game.assets.imageCache.get('faces/' + player.faceName);
            if (face) {
                const rect = FNH.faceRect(player.faceIndex, 58);
                ctx.save();
                ctx.beginPath();
                ctx.rect(42, 492, 58, 58);
                ctx.clip();
                ctx.drawImage(face, rect.sx, rect.sy, rect.sw, rect.sh, 42, 492, 58, 58);
                ctx.restore();
                ctx.strokeStyle = 'rgba(188,164,113,0.45)';
                ctx.strokeRect(42.5, 492.5, 57, 57);
            }
            FNH.text(ctx, player.name, 114, 507, {
                size: 17,
                weight: 600,
                color: '#efe2c7'
            });
            FNH.text(ctx, player.className + ' · Cấp ' + player.level + ' · Đội ' + this.members.filter((actor) => actor.hp > 0).length + '/' + this.members.length, 114, 524, {
                size: 10,
                color: 'rgba(209,194,160,0.62)'
            });
            if (this.guarding) {
                FNH.text(ctx, 'ĐANG THỦ THẾ', 360, 524, {
                    size: 10,
                    weight: 600,
                    color: 'rgba(139,188,206,0.82)',
                    align: 'right'
                });
            }
            FNH.bar(ctx, 114, 533, 230, 9, player.hp / player.maxHp, {
                colorA: '#5f1818',
                colorB: '#a83c2c'
            });
            FNH.text(ctx, 'HP ' + player.hp + ' / ' + player.maxHp, 352, 542, {
                size: 10,
                color: 'rgba(233,218,188,0.78)'
            });
            FNH.bar(ctx, 114, 551, 160, 5, player.mp / Math.max(1, player.maxMp), {
                colorA: '#1f3d57',
                colorB: '#3b6f8f'
            });
            FNH.text(ctx, 'MP ' + player.mp + ' / ' + player.maxMp, 282, 558, {
                size: 9,
                color: 'rgba(205,215,224,0.62)'
            });
            FNH.text(ctx, 'ATK ' + player.atk + '   ·   DEF ' + player.def + '   ·   AGI ' + player.agi, 114, 578, {
                size: 10,
                color: 'rgba(209,194,160,0.48)'
            });

            const rects = this.commandRects();
            for (let i = 0; i < this.commands.length; i += 1) {
                FNH.button(ctx, rects[i], this.commands[i], {
                    selected: this.phase === 'command' && i === this.index,
                    hover: this.phase === 'command' && i === this.hoverIndex,
                    disabled: this.phase !== 'command',
                    size: 13
                });
            }

            FNH.text(ctx, this.phase === 'command'
                ? '↑ ↓ chọn · ENTER xác nhận'
                : this.phase === 'victory'
                    ? 'ENTER để quay lại hành lang'
                    : 'Đang hành động…',
                114, 598, {
                    size: 9,
                    color: 'rgba(210,194,160,0.46)'
                });
        }

        drawDamageNumbers(ctx) {
            for (const item of this.damageNumbers) {
                const alpha = FNH.clamp(item.life / item.maxLife, 0, 1);
                ctx.save();
                ctx.globalAlpha = alpha;
                FNH.text(ctx, String(item.value), item.x, item.y, {
                    size: item.playerDamage ? 25 : 30,
                    weight: 700,
                    color: item.color,
                    align: 'center',
                    shadow: true,
                    shadowBlur: 8,
                    shadowColor: 'rgba(0,0,0,0.9)'
                });
                ctx.restore();
            }
        }

        drawOverlay(ctx) {
            if (this.phase === 'intro') {
                const alpha = FNH.clamp(this.timer / 0.6, 0, 1);
                ctx.save();
                ctx.globalAlpha = Math.min(1, alpha);
                FNH.text(ctx, this.encounter ? this.encounter.name : 'GUARD CHẶN LỐI', FNH.WIDTH / 2, 180, {
                    size: 25,
                    weight: 600,
                    color: '#eadbc0',
                    align: 'center',
                    shadow: true,
                    shadowBlur: 10
                });
                FNH.text(ctx, 'Bóng giáp rỉ sét đứng giữa hành lang.', FNH.WIDTH / 2, 204, {
                    size: 11,
                    color: 'rgba(224,207,174,0.6)',
                    align: 'center'
                });
                ctx.restore();
            }

            if (this.phase === 'victory') {
                ctx.fillStyle = 'rgba(0,0,0,0.68)';
                ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
                FNH.panel(ctx, 226, 188, 364, 224, {
                    alpha: 0.98,
                    fillTop: 'rgba(22,19,15,0.98)',
                    fillBottom: 'rgba(5,5,5,0.99)',
                    border: 'rgba(205,177,113,0.72)'
                });
                FNH.text(ctx, 'CHIẾN THẮNG', FNH.WIDTH / 2, 236, {
                    size: 28,
                    weight: 600,
                    color: '#f0e2c1',
                    align: 'center'
                });
                FNH.text(ctx, 'Đối thủ đã gục ngã.', FNH.WIDTH / 2, 266, {
                    size: 13,
                    color: 'rgba(224,208,176,0.7)',
                    align: 'center'
                });
                FNH.text(ctx, '+ ' + this.rewardGold + ' vàng    ·    + ' + this.rewardExp + ' kinh nghiệm',
                    FNH.WIDTH / 2, 306, {
                        size: 12,
                        weight: 600,
                        color: 'rgba(231,201,137,0.86)',
                        align: 'center'
                    });
                FNH.text(ctx, 'Nhấn ENTER để quay lại hành lang.', FNH.WIDTH / 2, 366, {
                    size: 11,
                    color: 'rgba(219,202,170,0.55)',
                    align: 'center'
                });
            }

            if (this.phase === 'fled') {
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
                FNH.text(ctx, 'BẠN ĐÃ RÚT LUI', FNH.WIDTH / 2, FNH.HEIGHT / 2, {
                    size: 24,
                    weight: 600,
                    color: '#ddd0b5',
                    align: 'center',
                    shadow: true
                });
            }

            if (this.phase === 'defeat') {
                const alpha = FNH.clamp((1.7 - this.timer) / 1.2, 0, 0.85);
                ctx.fillStyle = 'rgba(32,4,4,' + alpha + ')';
                ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
                FNH.text(ctx, 'BẠN ĐÃ GỤC NGÃ', FNH.WIDTH / 2, FNH.HEIGHT / 2, {
                    size: 26,
                    weight: 600,
                    color: 'rgba(236,203,188,0.9)',
                    align: 'center',
                    shadow: true,
                    shadowBlur: 10
                });
            }
        }

        draw(ctx) {
            ctx.save();
            if (this.game.screenEffects) ctx.translate(this.game.screenEffects.shakeX, 0);
            this.drawBattleback(ctx);
            this.drawEnemy(ctx);
            this.drawDamageNumbers(ctx);
            ctx.restore();
            if (this.game.screenEffects) this.game.screenEffects.apply(ctx);
            if (this.game.pictures) this.game.pictures.draw(ctx, 'battle');
            this.drawEnemyHud(ctx);
            this.drawActorPanel(ctx);
            this.drawOverlay(ctx);
            this.drawActionMenu(ctx);
            if (this.commonEventContext) {
                this.commonEventContext.drawEventDialog(ctx);
                if (this.commonEventContext.paused) this.commonEventContext.drawPause(ctx);
            }
            if (this.game.gabs) this.game.gabs.draw(ctx);
            FNH.drawVignette(ctx, FNH.WIDTH, FNH.HEIGHT, 0.38);
            FNH.drawGrain(ctx, FNH.WIDTH, FNH.HEIGHT, this.time);
        }
    };
})();
