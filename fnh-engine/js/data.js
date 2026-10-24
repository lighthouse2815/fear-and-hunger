'use strict';
/* ============================================================
   FNH Engine — đọc dữ liệu RPG Maker MV gốc
   ============================================================ */
(function () {
    const FNH = window.FNH = window.FNH || {};

    const PLAYABLE = [
        { actorId: 1, name: 'Cahara', role: 'MERCENARY', text: 'text_mercenary' },
        { actorId: 3, name: "D'arce", role: 'KNIGHT', text: 'text_knight' },
        { actorId: 4, name: 'Enki', role: 'DARK PRIEST', text: 'text_darkpriest' },
        { actorId: 5, name: 'Ragnvaldr', role: 'OUTLANDER', text: 'text_outlander' }
    ];

    FNH.DataStore = class DataStore {
        constructor(assets) {
            this.assets = assets;
            this.system = null;
            this.actors = [];
            this.classes = [];
            this.skills = [];
            this.items = [];
            this.states = [];
            this.commonEvents = [];
            this.weapons = [];
            this.armors = [];
            this.enemies = [];
            this.troops = [];
            this.tilesets = [];
            this.mapInfos = [];
            this.maps = new Map();
        }

        async loadCore() {
            this.system = this.assets.system || await this.assets.fetchJson('data/System.json');
            const names = [
                'Actors', 'Classes', 'Skills', 'Items', 'Weapons', 'Armors',
                'Enemies', 'Troops', 'Tilesets', 'MapInfos', 'CommonEvents', 'States'
            ];
            const files = await Promise.all(names.map((name) => this.assets.fetchJson('data/' + name + '.json')));
            this.actors = files[0];
            this.classes = files[1];
            this.skills = files[2];
            this.items = files[3];
            this.weapons = files[4];
            this.armors = files[5];
            this.enemies = files[6];
            this.troops = files[7];
            this.tilesets = files[8];
            this.mapInfos = files[9];
            this.commonEvents = files[10];
            this.states = files[11];
            return this;
        }

        async map(id) {
            const mapId = Number(id);
            if (this.maps.has(mapId)) return this.maps.get(mapId);
            const name = 'Map' + String(mapId).padStart(3, '0');
            const map = await this.assets.fetchJson('data/' + name + '.json');
            this.maps.set(mapId, map);
            return map;
        }

        actor(id) {
            return this.actors[Number(id)] || null;
        }

        classData(id) {
            return this.classes[Number(id)] || null;
        }

        skill(id) {
            return this.skills[Number(id)] || null;
        }

        enemy(id) {
            return this.enemies[Number(id)] || null;
        }

        troop(id) {
            return this.troops[Number(id)] || null;
        }

        tileset(id) {
            return this.tilesets[Number(id)] || null;
        }

        mapInfo(id) {
            return this.mapInfos[Number(id)] || null;
        }

        transferAt(map, x, y, flags, mapId, player) {
            for (const command of this.commandsAt(map, x, y, flags, mapId, player)) {
                if (command.code !== 201 || !Array.isArray(command.parameters)) continue;
                const p = command.parameters;
                const value = (index) => p[0] === 1
                    ? Number((flags || {})['variable:' + p[index]] || 0)
                    : Number(p[index]);
                return { mapId: value(1), x: value(2), y: value(3), direction: Number(p[4]) || 2 };
            }
            return null;
        }

        messageAt(map, x, y, flags, mapId, player) {
            for (const event of ((map && map.events) || [])) {
                if (!event || event.x !== x || event.y !== y) continue;
                const active = this.eventPage(event, flags || {}, mapId, player);
                for (const page of active ? [active] : []) {
                    const list = page.list || [];
                    for (let i = 0; i < list.length; i += 1) {
                        if (list[i].code !== 101) continue;
                        const lines = [];
                        for (let j = i + 1; j < list.length && list[j].code === 401; j += 1) {
                            if (list[j].parameters && list[j].parameters[0]) lines.push(String(list[j].parameters[0]));
                        }
                        if (lines.length) return lines.join(' ');
                    }
                }
            }
            return null;
        }

        eventPage(event, flags, mapId, player, partyIds) {
            flags = flags || {};
            const pages = event && event.pages || [];
            for (let i = pages.length - 1; i >= 0; i -= 1) {
                const page = pages[i];
                const c = page.conditions || {};
                if (c.switch1Valid && !flags['switch:' + c.switch1Id]) continue;
                if (c.switch2Valid && !flags['switch:' + c.switch2Id]) continue;
                if (c.variableValid && Number(flags['variable:' + c.variableId] || 0) < Number(c.variableValue || 0)) continue;
                const selfKey = 'self:' + (mapId || 1) + ':' + event.id + ':' + c.selfSwitchCh;
                const selfValue = Object.prototype.hasOwnProperty.call(flags, selfKey)
                    ? flags[selfKey]
                    : (mapId || 1) === 1 && flags['self:' + event.id + ':' + c.selfSwitchCh];
                if (c.selfSwitchValid && !selfValue) continue;
                if (c.itemValid && !(player && (player.inventory || []).some((item) =>
                    (item.kind || 'item') === 'item' && item.id === c.itemId && item.amount > 0))) continue;
                if (c.actorValid && !(partyIds ? partyIds.includes(c.actorId) : player && player.id === c.actorId)) continue;
                return page;
            }
            return null;
        }

        commandsAt(map, x, y, flags, mapId, player) {
            for (const event of ((map && map.events) || [])) {
                if (!event || event.x !== x || event.y !== y) continue;
                const page = this.eventPage(event, flags || {}, mapId, player);
                return page ? (page.list || []) : [];
            }
            return [];
        }

        playable() {
            const self = this;
            return PLAYABLE.map(function (entry) {
                const actor = self.actor(entry.actorId);
                const cls = self.classData(actor.classId);
                return Object.assign({}, entry, {
                    actor: actor,
                    classData: cls,
                    portrait: 'pictures/' + actor.faceName + '_' + (actor.faceIndex + 1),
                    face: actor.faceName,
                    faceIndex: actor.faceIndex,
                    character: actor.characterName,
                    characterIndex: actor.characterIndex,
                    classId: actor.classId,
                    className: cls ? cls.name : entry.role
                });
            });
        }

        _param(params, index, level) {
            const row = params && params[index];
            if (!row) return 0;
            const value = row[level] === undefined ? row[row.length - 1] : row[level];
            return Number(value) || 0;
        }

        battlerTraits(actor) {
            const raw = this.actor(actor.id);
            const sources = [raw, this.classData(actor.classId)];
            for (const item of actor.equipment || []) sources.push((item.type === 'weapon' ? this.weapons : this.armors)[item.id]);
            for (const id of actor.states || []) sources.push(this.states[id]);
            return sources.filter(Boolean).flatMap((source) => source.traits || []);
        }

        refreshActor(actor) {
            const cls = this.classData(actor.classId);
            if (!cls) return;
            const traits = this.battlerTraits(actor);
            const fields = ['maxHp', 'maxMp', 'atk', 'def', 'mat', 'mdf', 'agi', 'luk'];
            fields.forEach((field, index) => {
                let value = this._param(cls.params, index, actor.level) + Number((actor.paramPlus || [])[index] || 0);
                for (const entry of actor.equipment || []) {
                    const item = (entry.type === 'weapon' ? this.weapons : this.armors)[entry.id];
                    value += Number(item && item.params && item.params[index] || 0);
                }
                for (const trait of traits) if (trait.code === 21 && trait.dataId === index) value *= trait.value;
                actor[field] = Math.round(Math.max(index === 1 ? 0 : 1, Math.min(index === 0 ? 999999 : index === 1 ? 9999 : 999, value)));
            });
            ['hit', 'eva', 'cri', 'cev', 'mev', 'mrf', 'cnt', 'hrg', 'mrg', 'trg'].forEach((field, index) => {
                actor[field] = traits.filter((trait) => trait.code === 22 && trait.dataId === index)
                    .reduce((sum, trait) => sum + trait.value, 0);
            });
            ['tgr', 'grd', 'rec', 'pha', 'mcr', 'tcr', 'pdr', 'mdr', 'fdr', 'exr'].forEach((field, index) => {
                actor[field] = traits.filter((trait) => trait.code === 23 && trait.dataId === index)
                    .reduce((product, trait) => product * trait.value, 1);
            });
            actor.hp = Math.max(0, Math.min(actor.maxHp, Number(actor.hp) || 0));
            actor.mp = Math.max(0, Math.min(actor.maxMp, Number(actor.mp) || 0));
            actor.restriction = Math.max(0, ...(actor.states || []).map((id) => this.states[id] && this.states[id].restriction || 0));
        }

        setActorHp(actor, value) {
            actor.hp = Math.max(0, Math.min(actor.maxHp, value));
            const states = actor.states || (actor.states = []);
            if (actor.hp === 0 && !states.includes(1)) {
                actor.states = [1];
                actor.stateTurns = {};
                actor.stateSteps = {};
            } else if (actor.hp > 0 && states.includes(1)) this.removeActorState(actor, 1);
            this.refreshActor(actor);
        }

        addActorState(actor, id) {
            const state = this.states[id];
            if (!state || actor.hp <= 0 || this.battlerTraits(actor).some((trait) => trait.code === 14 && trait.dataId === id)) return false;
            if (id === 1) this.setActorHp(actor, 0);
            const states = actor.states || (actor.states = []);
            if (!states.includes(id)) states.push(id);
            const turns = actor.stateTurns || (actor.stateTurns = {});
            const steps = actor.stateSteps || (actor.stateSteps = {});
            const min = Math.max(0, state.minTurns || 0), max = Math.max(min, state.maxTurns || 0);
            turns[id] = min + Math.floor(Math.random() * (max - min + 1));
            steps[id] = Math.max(0, state.stepsToRemove || 0);
            this.refreshActor(actor);
            return true;
        }

        removeActorState(actor, id) {
            if (!(actor.states || []).includes(id)) return;
            actor.states = actor.states.filter((entry) => entry !== id);
            if (actor.stateTurns) delete actor.stateTurns[id];
            if (actor.stateSteps) delete actor.stateSteps[id];
            if (id === 1 && actor.hp === 0) actor.hp = 1;
            this.refreshActor(actor);
        }

        recoverActor(actor) {
            actor.states = [];
            actor.stateTurns = {};
            actor.stateSteps = {};
            this.refreshActor(actor);
            actor.hp = actor.maxHp;
            actor.mp = actor.maxMp;
        }

        actorTurnEnd(actor, timing = 2) {
            if (timing === 2) {
                if (actor.hp > 0) {
                    const hp = Math.max(-actor.hp, Math.floor(actor.maxHp * (actor.hrg || 0)));
                    this.setActorHp(actor, actor.hp + hp);
                    actor.mp = Math.max(0, Math.min(actor.maxMp, actor.mp + Math.floor(actor.maxMp * (actor.mrg || 0))));
                    actor.tp = Math.max(0, Math.min(100, (actor.tp || 0) + Math.floor(100 * (actor.trg || 0))));
                }
                for (const id of actor.states || []) {
                    if (actor.stateTurns && actor.stateTurns[id] > 0) actor.stateTurns[id] -= 1;
                }
            }
            for (const id of (actor.states || []).slice()) {
                const state = this.states[id];
                if (state && state.autoRemovalTiming === timing && !(actor.stateTurns && actor.stateTurns[id] > 0)) this.removeActorState(actor, id);
            }
        }

        actorWalkStep(actor) {
            for (const id of (actor.states || []).slice()) {
                const state = this.states[id];
                if (!state || !state.removeByWalking) continue;
                const steps = actor.stateSteps || (actor.stateSteps = {});
                steps[id] = Math.max(0, (steps[id] || 0) - 1);
                if (!steps[id]) this.removeActorState(actor, id);
            }
        }

        createPlayer(actorId) {
            const actor = this.actor(actorId);
            if (!actor) throw new Error('Không tìm thấy actor ' + actorId + '.');
            const cls = this.classData(actor.classId);
            if (!cls) throw new Error('Không tìm thấy class ' + actor.classId + '.');
            const level = FNH.clamp(actor.initialLevel || 1, 1, actor.maxLevel || 99);
            const params = cls.params || [];
            const stats = {
                maxHp: this._param(params, 0, level),
                maxMp: this._param(params, 1, level),
                atk: this._param(params, 2, level),
                def: this._param(params, 3, level),
                mat: this._param(params, 4, level),
                mdf: this._param(params, 5, level),
                agi: this._param(params, 6, level),
                luk: this._param(params, 7, level)
            };
            const equipment = [];
            (actor.equips || []).forEach((id, slot) => {
                if (!id) return;
                const weapon = slot === 0 ? this.weapons[id] : null;
                const armor = slot === 0 ? null : this.armors[id];
                const item = weapon || armor;
                if (!item) return;
                equipment.push({ id: id, name: item.name, type: weapon ? 'weapon' : 'armor' });
                const itemParams = item.params || [];
                for (let i = 0; i < 8; i += 1) {
                    const key = ['maxHp', 'maxMp', 'atk', 'def', 'mat', 'mdf', 'agi', 'luk'][i];
                    stats[key] += Number(itemParams[i]) || 0;
                }
            });
            const canonical = PLAYABLE.find(function (entry) { return entry.actorId === actor.id; });
            const name = canonical ? canonical.name : actor.name;
            const player = {
                id: actor.id,
                name: name,
                title: actor.name,
                className: cls.name,
                classId: cls.id,
                level: level,
                exp: 0,
                hp: stats.maxHp,
                mp: stats.maxMp,
                maxHp: stats.maxHp,
                maxMp: stats.maxMp,
                atk: stats.atk,
                def: stats.def,
                mat: stats.mat,
                mdf: stats.mdf,
                agi: stats.agi,
                luk: stats.luk,
                faceName: actor.faceName,
                faceIndex: actor.faceIndex,
                characterName: actor.characterName,
                characterIndex: actor.characterIndex,
                battlerName: actor.battlerName,
                portrait: 'pictures/' + actor.faceName + '_' + (actor.faceIndex + 1),
                skills: (cls.learnings || []).filter((entry) => entry.level <= level).map((entry) => entry.skillId),
                nickname: actor.nickname || '',
                profile: actor.profile || '',
                tp: 0,
                equipment: equipment,
                inventory: [],
                states: [], stateTurns: {}, stateSteps: {}, paramPlus: []
            };
            this.refreshActor(player);
            player.hp = player.maxHp;
            player.mp = player.maxMp;
            return player;
        }

        tileIdAt(map, x, y, z) {
            if (x < 0 || y < 0 || x >= map.width || y >= map.height || z < 0 || z > 5) return 0;
            return map.data[(z * map.height + y) * map.width + x] || 0;
        }

        isHigherTile(tileset, tileId) {
            if (!tileId) return false;
            return ((tileset.flags[tileId] || 0) & 0x10) !== 0;
        }

        isTilePassable(map, tileset, x, y, direction) {
            if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
            const bit = direction === 2 ? 0x01 : direction === 4 ? 0x02 : direction === 6 ? 0x04 : 0x08;
            for (let z = 0; z < 4; z += 1) {
                const tileId = this.tileIdAt(map, x, y, z);
                if (!tileId) continue;
                const flags = tileset.flags[tileId] || 0;
                if (flags & bit) return false;
            }
            return true;
        }

        tileSource(tileset, tileId) {
            if (!tileId) return null;
            if (tileId >= 1536 && tileId < 1664) {
                return {
                    name: tileset.tilesetNames[4],
                    sx: (Math.floor(tileId / 128) % 2 * 8 + tileId % 8) * 48,
                    sy: Math.floor((tileId % 256) / 8) % 16 * 48
                };
            }
            const setNumber = 5 + Math.floor(tileId / 256);
            const name = tileset.tilesetNames[setNumber];
            if (!name) return null;
            return {
                name: name,
                sx: (Math.floor(tileId / 128) % 2 * 8 + tileId % 8) * 48,
                sy: Math.floor((tileId % 256) / 8) % 16 * 48
            };
        }

        createGuardEncounter() {
            const guard = this.enemy(1);
            const troop = this.troop(1);
            const parts = [];
            if (troop && troop.members) {
                troop.members.forEach(function (member) {
                    const enemy = this.enemy(member.enemyId);
                    if (!enemy || !enemy.battlerName) return;
                    parts.push({
                        enemyId: member.enemyId,
                        name: enemy.name,
                        image: 'enemies/' + enemy.battlerName,
                        x: member.x,
                        y: member.y
                    });
                }, this);
            }
            return {
                id: 'guard',
                name: guard ? guard.name.replace(/\s*\[.*\]$/, '') : 'Guard',
                enemyId: 1,
                parts: parts,
                maxHp: 320,
                hp: 320,
                atk: 18,
                def: 10,
                agi: 8,
                rewardGold: 35,
                rewardExp: 20,
                intro: 'Bộ giáp gỉ sét chuyển động. Một tiếng thở nặng nề vang lên trong hành lang.'
            };
        }
    };
})();
