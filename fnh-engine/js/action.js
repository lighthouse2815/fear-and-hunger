'use strict';
(function () {
    const FNH = window.FNH = window.FNH || {};
    FNH.Action = class Action {
        constructor(data, item) {
            if (!item) throw new Error('Thiếu dữ liệu hành động');
            this.data = data;
            this.item = item;
            if (!Number.isInteger(item.scope) || item.scope < 0 || item.scope > 11) throw new Error('Chưa hỗ trợ phạm vi hành động');
            if (item.damage && (!Number.isInteger(item.damage.type) || item.damage.type < 0 || item.damage.type > 6)) throw new Error('Chưa hỗ trợ loại sát thương');
            const formula = String(item.damage && item.damage.formula || '0').trim();
            if (!/^\d+(?:\.\d+)?$/.test(formula) && formula !== 'a.atk * 4 - b.def * 2') {
                throw new Error('Chưa hỗ trợ công thức sát thương');
            }
            for (const effect of item.effects || []) {
                if (![11, 12, 21, 22, 43, 44].includes(effect.code)) throw new Error('Chưa hỗ trợ hiệu ứng hành động ' + effect.code);
            }
            this.formula = formula;
        }

        mpCost(user) {
            return Math.floor((this.item.mpCost || 0) * (user.mcr === undefined ? 1 : user.mcr));
        }

        canUse(user, isSkill, occasion = 1) {
            if (user.hp <= 0 || user.restriction === 4 || ![0, occasion].includes(this.item.occasion)) return false;
            if (!isSkill) return true;
            const traits = this.data.battlerTraits(user);
            const requiredWeapons = [this.item.requiredWtypeId1, this.item.requiredWtypeId2].filter((id) => id > 0);
            if (requiredWeapons.length && !(user.equipment || []).some((entry) => entry.type === 'weapon' &&
                this.data.weapons[entry.id] && requiredWeapons.includes(this.data.weapons[entry.id].wtypeId))) return false;
            if (traits.some((trait) => (trait.code === 42 && trait.dataId === this.item.stypeId) ||
                (trait.code === 44 && trait.dataId === this.item.id))) return false;
            return user.mp >= this.mpCost(user) && (user.tp || 0) >= (this.item.tpCost || 0);
        }

        pay(user) {
            user.mp -= this.mpCost(user);
            user.tp = (user.tp || 0) - (this.item.tpCost || 0);
        }

        apply(user, target, guarding = false) {
            const item = this.item, data = this.data;
            const result = { hp: 0, mp: 0, missed: false, critical: false, commonEvent: null };
            for (const effect of item.effects || []) if (effect.code === 44) result.commonEvent = effect.dataId;
            if (!target) return result;
            const hit = (item.successRate === undefined ? 100 : item.successRate) / 100 *
                (item.hitType === 1 ? (user.hit === undefined ? 1 : user.hit) : 1);
            const evade = item.hitType === 1 ? target.eva || 0 : item.hitType === 2 ? target.mev || 0 : 0;
            if (Math.random() >= hit || Math.random() < evade) { result.missed = true; return result; }
            const damage = item.damage || {};
            const type = damage.type || 0;
            const traits = data.battlerTraits(target);
            if (type) {
                let value = this.formula === 'a.atk * 4 - b.def * 2' ? user.atk * 4 - target.def * 2 : Number(this.formula);
                value = Math.max(0, value);
                const elementRate = (id) => traits.filter((trait) => trait.code === 11 && trait.dataId === id)
                    .reduce((product, trait) => product * trait.value, 1);
                const attackElements = data.battlerTraits(user).filter((trait) => trait.code === 31).map((trait) => trait.dataId);
                value *= damage.elementId < 0 ? (attackElements.length ? Math.max(...attackElements.map(elementRate)) : 1)
                    : elementRate(damage.elementId);
                if (item.hitType === 1) value *= target.pdr === undefined ? 1 : target.pdr;
                if (item.hitType === 2) value *= target.mdr === undefined ? 1 : target.mdr;
                if (type === 3 || type === 4) value *= target.rec === undefined ? 1 : target.rec;
                if (damage.critical && Math.random() < (user.cri || 0) * (1 - (target.cev || 0))) {
                    result.critical = true;
                    value *= 3;
                }
                const amplitude = Math.floor(Math.abs(value) * (damage.variance || 0) / 100);
                value += Math.floor(Math.random() * (amplitude + 1)) + Math.floor(Math.random() * (amplitude + 1)) - amplitude;
                if ((guarding || traits.some((trait) => trait.code === 62 && trait.dataId === 1)) && type !== 3 && type !== 4) value /= 2 * Math.max(0.01, target.grd || 1);
                value = Math.round(value) * (type === 3 || type === 4 ? -1 : 1);
                if ([1, 3, 5].includes(type)) {
                    if (type === 5) value = Math.min(target.hp, value);
                    const old = target.hp;
                    data.setActorHp(target, target.hp - value);
                    result.hp = old - target.hp;
                    if (result.hp > 0) {
                        for (const id of (target.states || []).slice()) {
                            const state = data.states[id];
                            if (state && state.removeByDamage && Math.random() * 100 < state.chanceByDamage) data.removeActorState(target, id);
                        }
                        target.tp = Math.max(0, Math.min(100, (target.tp || 0) + Math.floor(50 * result.hp / target.maxHp * (target.tcr === undefined ? 1 : target.tcr))));
                    }
                    if (type === 5) data.setActorHp(user, user.hp + result.hp);
                } else {
                    if (type === 6) value = Math.min(target.mp, value);
                    const old = target.mp;
                    target.mp = Math.max(0, Math.min(target.maxMp, target.mp - value));
                    result.mp = old - target.mp;
                    if (type === 6) user.mp = Math.max(0, Math.min(user.maxMp, user.mp + result.mp));
                }
            }
            for (const effect of item.effects || []) {
                if (effect.code === 11 || effect.code === 12) {
                    const amount = Math.floor(((effect.code === 11 ? target.maxHp : target.maxMp) * effect.value1 + effect.value2)
                        * (target.rec === undefined ? 1 : target.rec) * (this.data.items[item.id] === item ? (user.pha === undefined ? 1 : user.pha) : 1));
                    if (effect.code === 11) {
                        const before = target.hp;
                        data.setActorHp(target, target.hp + amount);
                        result.hp -= target.hp - before;
                    } else {
                        const before = target.mp;
                        target.mp = Math.max(0, Math.min(target.maxMp, target.mp + amount));
                        result.mp -= target.mp - before;
                    }
                }
                if (effect.code === 21) {
                    const states = effect.dataId === 0 ? data.battlerTraits(user).filter((trait) => trait.code === 32)
                        .map((trait) => ({ id: trait.dataId, rate: trait.value })) : [{ id: effect.dataId, rate: 1 }];
                    for (const state of states) {
                        const rate = traits.filter((trait) => trait.code === 13 && trait.dataId === state.id)
                            .reduce((product, trait) => product * trait.value, 1);
                        const luck = item.hitType === 0 ? 1 : Math.max(0, 1 + ((user.luk || 0) - (target.luk || 0)) * 0.001);
                        if (Math.random() < effect.value1 * state.rate * rate * luck) data.addActorState(target, state.id);
                    }
                }
                if (effect.code === 22 && Math.random() < effect.value1) data.removeActorState(target, effect.dataId);
                if (effect.code === 43 && !target.enemyId) {
                    const skills = target.skills || (target.skills = []);
                    if (data.skill(effect.dataId) && !skills.includes(effect.dataId)) skills.push(effect.dataId);
                }
            }
            user.tp = Math.max(0, Math.min(100, (user.tp || 0) + Math.floor((item.tpGain || 0) * (user.tcr === undefined ? 1 : user.tcr))));
            return result;
        }
    };
})();
