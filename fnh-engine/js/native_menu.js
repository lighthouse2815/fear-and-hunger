'use strict';
(function () {
    const FNH = window.FNH = window.FNH || {};
    const commands = [
        { id: 'items', icon: 1 }, { id: 'equip', icon: 2 }, { id: 'synthesis', icon: 3 },
        { id: 'skills', icon: 4 }, { id: 'options', icon: 7 }, { id: 'quit', icon: 6 }
    ];
    const tables = { item: 'items', weapon: 'weapons', armor: 'armors' };
    const controlKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Shift', 'PageUp', 'PageDown'];

    FNH.NativeMenu = class NativeMenu {
        constructor(scene, page = 'main') {
            this.scene = scene;
            this.game = scene.game;
            this.page = page;
            this.index = 0;
            if (page === 'load' || page === 'save') this.index = (this.game.getSaveInfo()?.slot || 1) - 1;
            this.category = 0;
            this.actorIndex = 0;
            this.focus = 'tabs';
            this.slot = 0;
            this.time = 0;
            this.target = null;
            this.background = document.createElement('canvas');
            this.background.width = FNH.WIDTH;
            this.background.height = FNH.HEIGHT;
            this.background.getContext('2d').drawImage(this.game.canvas, 0, 0);
        }

        actors() { return this.scene.partyIds().map((id) => this.scene.eventActor(id)); }
        actor() { return this.actors()[this.actorIndex % this.actors().length]; }
        inventory() { return this.game.player.inventory || []; }
        item(entry) { return this.game.data[tables[entry.kind || 'item']][entry.id]; }
        count(kind, id) { return this.inventory().find((entry) => (entry.kind || 'item') === kind && entry.id === id)?.amount || 0; }
        sound(index) {
            const sound = this.game.data.system.sounds[index];
            this.game.audio.playSe(sound.name, { volume: sound.volume / 100, pitch: sound.pitch, pan: sound.pan });
        }
        close() {
            this.scene.nativeMenu = null;
            this.scene.fileMenu = null;
            this.scene.paused = false;
            this.scene.pauseContinuation = null;
            this.game.input.captureKey = null;
            this.game.input.clearFrame();
        }
        open(page) { this.page = page; this.index = 0; this.category = 0; this.focus = 'tabs'; this.target = null; }
        back() {
            if (['main', 'save', 'load'].includes(this.page)) this.close();
            else if (this.target) this.target = null;
            else if (this.page === 'controls') this.open('options');
            else if (this.focus === 'equipItems') this.focus = 'slots';
            else if (this.focus === 'slots') this.focus = 'tabs';
            else if (this.focus === 'list' && ['items', 'skills', 'options'].includes(this.page)) this.focus = 'tabs';
            else this.open('main');
            this.sound(2);
        }
        changeCount(kind, id, amount) {
            this.scene.executeEventCommand({ code: 126 + ['item', 'weapon', 'armor'].indexOf(kind),
                parameters: [id, amount < 0 ? 1 : 0, 0, Math.abs(amount)] });
        }

        recipes(sources = this.inventory()) {
            const known = new Map();
            for (const entry of sources.filter((item) => item.amount > 0)) {
                const source = this.item(entry);
                for (const match of String(source?.note || '').matchAll(/<(Item|Weapon|Armor) Recipe:\s*([^>]+)>/gi)) {
                    const kind = match[1].toLowerCase();
                    for (const range of match[2].split(',')) {
                        const ids = /^(\d+)(?:\s+to\s+(\d+))?$/i.exec(range.trim());
                        if (!ids) continue;
                        for (let id = Number(ids[1]); id <= Number(ids[2] || ids[1]); id += 1) {
                            const item = this.game.data[tables[kind]][id];
                            const ingredients = /<Synthesis Ingredients>([\s\S]*?)<\/Synthesis Ingredients>/i.exec(item?.note || '');
                            if (!item?.name || !ingredients) continue;
                            const needs = new Map();
                            let gold = 0;
                            for (const line of ingredients[1].trim().split(/\r?\n/)) {
                                const ingredient = /^(item|weapon|armor)\s+(\d+)(?:\s*:\s*(\d+))?$/i.exec(line.trim());
                                const cost = /^gold\s*:\s*(\d+)$/i.exec(line.trim());
                                if (cost) gold += Number(cost[1]);
                                if (ingredient) {
                                    const type = ingredient[1].toLowerCase(), ingredientId = Number(ingredient[2]);
                                    const key = type + ':' + ingredientId;
                                    const previous = needs.get(key);
                                    needs.set(key, { kind: type, id: ingredientId, amount: (previous?.amount || 0) + Number(ingredient[3] || 1) });
                                }
                            }
                            if (needs.size || gold) known.set(kind + ':' + id, { kind, id, item, needs: [...needs.values()], gold });
                        }
                    }
                }
            }
            return [...known.values()];
        }

        craft(recipe) {
            if (!recipe || this.game.gold < recipe.gold || recipe.needs.some((need) => this.count(need.kind, need.id) < need.amount)) return false;
            for (const need of recipe.needs) this.changeCount(need.kind, need.id, -need.amount);
            this.game.gold -= recipe.gold;
            this.changeCount(recipe.kind, recipe.id, 1);
            const crafted = this.game.flags['synthesis:crafted'] || (this.game.flags['synthesis:crafted'] = []);
            const key = recipe.kind + ':' + recipe.id;
            if (!crafted.includes(key)) crafted.push(key);
            return true;
        }

        action(entry) {
            try {
                if (!entry.skill && !this.count('item', entry.item.id)) return null;
                const action = new FNH.Action(this.game.data, entry.item);
                return action.canUse(this.actor(), !!entry.skill, 2) && ![1, 2, 3, 4, 5, 6].includes(entry.item.scope) ? action : null;
            } catch (error) { return null; }
        }

        use(entry, targetIndex) {
            const action = this.action(entry);
            if (!action) return false;
            const scope = entry.item.scope;
            let targets = scope === 11 ? [this.actor()] : scope === 0 ? [null]
                : [8, 10].includes(scope) ? this.actors() : [this.actors()[targetIndex]];
            targets = targets.filter((target) => !target || ([9, 10].includes(scope) ? target.hp <= 0 : target.hp > 0));
            if (!targets.length) return false;
            if (entry.skill) action.pay(this.actor());
            else if (entry.item.consumable) this.changeCount('item', entry.item.id, -1);
            for (const target of targets) for (let repeat = 0; repeat < Math.max(1, entry.item.repeats || 1); repeat += 1) {
                const result = action.apply(this.actor(), target);
                if (result.commonEvent) this.game.reservedCommonEvent = result.commonEvent;
            }
            if (this.game.reservedCommonEvent) this.close();
            return true;
        }

        entries() {
            if (this.page === 'items') return this.inventory().filter((entry) => {
                const item = this.item(entry);
                return entry.amount > 0 && item && ((this.category === 0 && (entry.kind || 'item') === 'item' && item.itypeId === 1)
                    || (this.category === 1 && entry.kind === 'weapon') || (this.category === 2 && entry.kind === 'armor')
                    || (this.category === 3 && (entry.kind || 'item') === 'item' && item.itypeId === 2));
            }).map((entry) => ({ ...entry, item: this.item(entry) }));
            if (this.page === 'skills') return (this.actor().skills || []).map((id) => this.game.data.skill(id)).filter(Boolean)
                .filter((item) => item.stypeId === this.skillTypes()[this.category]).map((item) => ({ item, skill: true }));
            if (this.page === 'synthesis') return this.recipes().filter((entry) => entry.kind === this.synthesisTabs()[this.category]?.kind);
            if (this.page === 'equip' && this.focus === 'equipItems') {
                const actor = this.actor(), slot = this.slot;
                const dual = this.game.data.battlerTraits(actor).some((trait) => trait.code === 55 && trait.dataId === 1);
                const etype = dual && slot === 1 ? 1 : slot + 1;
                const kind = etype === 1 ? 'weapon' : 'armor';
                const permission = kind === 'weapon' ? 51 : 52;
                return [{ id: 0, kind, item: { name: '' } }, ...this.inventory().filter((entry) => entry.kind === kind && entry.amount > 0)
                    .map((entry) => ({ ...entry, item: this.item(entry) })).filter((entry) => entry.item.etypeId === etype &&
                        this.game.data.battlerTraits(actor).some((trait) => trait.code === permission && trait.dataId ===
                            entry.item[kind === 'weapon' ? 'wtypeId' : 'atypeId']))];
            }
            if (this.page === 'options') return this.optionEntries();
            return [];
        }
        skillTypes() {
            return [...new Set(this.game.data.battlerTraits(this.actor()).filter((trait) => trait.code === 41).map((trait) => trait.dataId))].sort((a, b) => a - b);
        }
        synthesisTabs() {
            const recipes = this.recipes();
            return Object.keys(tables).filter((kind) => recipes.some((entry) => entry.kind === kind))
                .map((kind) => ({ kind, label: kind[0].toUpperCase() + kind.slice(1) })).concat({ label: 'Finish' });
        }
        optionEntries() {
            const all = [{ key: 'commandRemember', label: 'Command Remember' },
                ...['master', 'bgm', 'bgs', 'me', 'se'].map((key) => ({ key, label: (key === 'master' ? 'Master' : key.toUpperCase()) + ' Volume' }))];
            return this.category === 1 ? all.slice(0, 1) : this.category === 2 ? all.slice(1) : all;
        }
        adjustOption(step) {
            const entry = this.entries()[this.index];
            if (!entry) return;
            if (entry.key === 'commandRemember') this.game.options.commandRemember = !this.game.options.commandRemember;
            else this.game.audio.setVolume(entry.key, Math.max(0, Math.min(100, this.game.audio.volumes[entry.key] + step * 10)));
            this.game.storage.save('config', { ...this.game.options, volumes: this.game.audio.volumes });
        }

        update(dt) {
            this.time += dt;
            const input = this.game.input;
            if (this.awaitingKey) return;
            if (input.isPressed('Escape', 'x', 'X')) { this.back(); return; }
            if (this.page === 'controls') {
                if (input.isPressed('ArrowDown')) this.index = (this.index + 1) % controlKeys.length;
                if (input.isPressed('ArrowUp')) this.index = (this.index + controlKeys.length - 1) % controlKeys.length;
                if (input.isPressed('Enter', ' ', 'z', 'Z')) {
                    this.awaitingKey = true;
                    input.captureKey = (code, key) => {
                        this.awaitingKey = false;
                        if (key === 'Escape') return;
                        this.game.options.keyboard[code] = controlKeys[this.index];
                        input.keyBindings = this.game.options.keyboard;
                        this.game.storage.save('config', { ...this.game.options, volumes: this.game.audio.volumes });
                        input.clearFrame();
                        this.sound(1);
                    };
                }
                return;
            }
            if (this.page === 'save' || this.page === 'load') {
                if (input.isPressed('ArrowDown')) this.index = (this.index + 1) % 20;
                if (input.isPressed('ArrowUp')) this.index = (this.index + 19) % 20;
                if (input.isPressed('PageDown')) this.index = Math.min(19, this.index + 5);
                if (input.isPressed('PageUp')) this.index = Math.max(0, this.index - 5);
                if (input.isPressed('Enter', ' ', 'z', 'Z')) {
                    if (this.page === 'save') {
                        const saved = this.game.saveGame({ slot: this.index + 1, fromEvent: true, eventContinuation: this.scene.pauseContinuation });
                        this.sound(saved ? 1 : 3);
                        if (saved) this.close();
                    } else if (this.game.getSaveInfo(this.index + 1)) {
                        const slot = this.index + 1;
                        this.close(); this.scene.leaving = true;
                        this.game.loadGame(slot);
                    } else this.sound(3);
                }
                return;
            }
            if (input.isPressed('PageDown', 'PageUp') && this.actors().length > 1) {
                this.actorIndex = (this.actorIndex + (input.isPressed('PageDown') ? 1 : this.actors().length - 1)) % this.actors().length;
                this.index = 0; this.category = 0;
            }
            const down = input.isPressed('ArrowDown', 's', 'S'), up = input.isPressed('ArrowUp', 'w', 'W');
            const right = input.isPressed('ArrowRight', 'd', 'D'), left = input.isPressed('ArrowLeft', 'a', 'A');
            const ok = input.isPressed('Enter', ' ', 'z', 'Z');
            if (down || up || right || left) this.sound(0);
            if (this.target) {
                if (down || up || right || left) this.target.index = (this.target.index + (down || right ? 1 : this.actors().length - 1)) % this.actors().length;
                if (ok) { const used = this.use(this.target.entry, this.target.index); this.sound(used ? 1 : 3); if (used) this.target = null; }
                return;
            }
            if (this.page === 'main') {
                if (down || up) this.index = (this.index + (down ? 1 : commands.length - 1)) % commands.length;
                if (ok) { this.sound(1); this.open(commands[this.index].id); }
                return;
            }
            if (this.page === 'quit') {
                if (down || up) this.index = 1 - this.index;
                if (ok) {
                    this.sound(1);
                    if (this.index === 0) { this.close(); this.scene.leaving = true; this.game.returnToTitle(); }
                    else this.open('main');
                }
                return;
            }
            if (this.page === 'equip' && this.focus === 'tabs') {
                if (right || left) this.category = (this.category + (right ? 1 : 2)) % 3;
                if (ok) {
                    if (this.category === 0) { this.focus = 'slots'; this.index = 0; }
                    else {
                        for (let slot = 0; slot < this.game.data.system.equipTypes.length - 1; slot += 1) {
                            this.game.data.changeEquipment(this.actor(), slot, 0, this.inventory());
                            if (this.category === 1) {
                                this.slot = slot; this.focus = 'equipItems';
                                const choices = this.entries().slice(1).sort((a, b) => b.item.params.reduce((a, b) => a + b, 0) - a.item.params.reduce((a, b) => a + b, 0));
                                if (choices[0]) this.game.data.changeEquipment(this.actor(), slot, choices[0].id, this.inventory());
                            }
                        }
                        this.focus = 'tabs'; this.sound(1);
                    }
                }
                return;
            }
            if (this.page === 'equip' && this.focus === 'slots') {
                const count = this.game.data.system.equipTypes.length - 1;
                if (down || up) this.index = (this.index + (down ? 1 : count - 1)) % count;
                if (ok) { this.slot = this.index; this.focus = 'equipItems'; this.index = 0; }
                return;
            }
            if (this.focus === 'tabs') {
                const count = this.page === 'items' ? 4 : this.page === 'skills' ? Math.max(1, this.skillTypes().length)
                    : this.page === 'options' ? 5 : this.synthesisTabs().length;
                if (right || left || (['options', 'synthesis'].includes(this.page) && (down || up))) {
                    this.category = (this.category + (right || down ? 1 : count - 1)) % count; this.index = 0;
                }
                if (ok) {
                    if (this.page === 'options' && this.category === 3) this.open('controls');
                    else if ((this.page === 'options' && this.category === 4) || (this.page === 'synthesis' && !this.synthesisTabs()[this.category]?.kind)) this.open('main');
                    else this.focus = 'list';
                }
                return;
            }
            const entries = this.entries();
            if (entries.length && (down || up)) this.index = (this.index + (down ? 1 : entries.length - 1)) % entries.length;
            if (this.page === 'options' && (right || left || ok)) { this.adjustOption(left ? -1 : 1); return; }
            const entry = entries[Math.min(this.index, entries.length - 1)];
            if (!ok || !entry) return;
            if (this.page === 'equip') {
                const equipped = this.game.data.changeEquipment(this.actor(), this.slot, entry.id, this.inventory());
                this.sound(equipped ? 1 : 3); this.focus = 'slots'; this.index = this.slot;
            } else if (this.page === 'synthesis') this.sound(this.craft(entry) ? 1 : 3);
            else if (!this.action(entry)) this.sound(3);
            else if ([7, 9].includes(entry.item.scope)) this.target = { entry, index: 0 };
            else this.sound(this.use(entry, 0) ? 1 : 3);
        }

        text(ctx, text, x, y, options) { FNH.text(ctx, text, x, y, { size: 28, color: '#fff', outline: 4, ...options }); }
        window(ctx, x, y, width, height, cursor) { FNH.drawWindow(ctx, this.game.assets.imageCache.get('system/Window|plain'), { x, y, width, height }, cursor, this.time); }
        icon(ctx, index, x, y) {
            const image = this.game.assets.imageCache.get('system/IconSet');
            if (image) ctx.drawImage(image, index % 16 * 32, Math.floor(index / 16) * 32, 32, 32, x, y, 32, 32);
        }
        actorCard(ctx, actor, x, width) {
            this.text(ctx, actor.name, x + 5, 82, { maxWidth: width - 10 });
            const portrait = this.game.assets.imageCache.get(actor.portrait);
            if (portrait) ctx.drawImage(portrait, x, 120, width, 360);
            const next = this.game.data.expForLevel(actor.classId, actor.level + 1);
            const current = this.game.data.expForLevel(actor.classId, actor.level);
            const hunger = Math.max(0, next - actor.exp);
            [['Hunger', hunger, Math.max(1, next - current), '#242440'],
                ['Body', actor.hp, actor.maxHp, '#8d2110'], ['Mind', actor.mp, actor.maxMp, '#8d2110']].forEach(([label, value, max, color], index) => {
                const y = 448 + index * 36;
                ctx.fillStyle = '#222'; ctx.fillRect(x + 5, y + 28, width - 10, 6);
                ctx.fillStyle = color; ctx.fillRect(x + 5, y + 28, (width - 10) * Math.max(0, Math.min(1, value / max)), 6);
                this.text(ctx, label, x + 5, y + 28, { color: '#6e96ae', maxWidth: 44 });
                this.text(ctx, value, x + width - 5, y + 28, { align: 'right' });
            });
        }
        drawList(ctx, entries, x, y, width, height) {
            const rows = Math.max(1, Math.floor((height - 36) / 36));
            const start = Math.max(0, this.index - rows + 1);
            this.window(ctx, x, y, width, height, this.focus === 'list' || this.focus === 'equipItems'
                ? { x: x + 18, y: y + 18 + (this.index - start) * 36, width: width - 36, height: 36 } : null);
            entries.slice(start, start + rows).forEach((entry, row) => {
                const yy = y + 46 + row * 36;
                if (entry.item.iconIndex) this.icon(ctx, entry.item.iconIndex, x + 20, yy - 26);
                const usable = ['items', 'skills'].includes(this.page) ? !!this.action(entry) : this.page !== 'synthesis' ||
                    (this.game.gold >= entry.gold && entry.needs.every((need) => this.count(need.kind, need.id) >= need.amount));
                this.text(ctx, entry.item.name, x + 56, yy, { maxWidth: width - 130, color: usable ? '#fff' : '#888' });
                if (entry.amount) this.text(ctx, ':' + entry.amount, x + width - 24, yy, { align: 'right' });
                if (entry.skill) this.text(ctx, entry.item.mpCost || '', x + width - 24, yy, { align: 'right', color: '#80b0dd' });
            });
        }
        draw(ctx) {
            ctx.save(); ctx.filter = 'blur(4px)'; ctx.drawImage(this.background, 0, 0); ctx.restore();
            ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
            if (this.page === 'save' || this.page === 'load') {
                const start = Math.max(0, this.index - 4);
                this.window(ctx, 0, 0, 816, 108);
                this.text(ctx, this.game.data.system.terms.messages[this.page === 'save' ? 'saveMessage' : 'loadMessage'], 24, 46);
                this.window(ctx, 0, 108, 816, 516, { x: 18, y: 126 + (this.index - start) * 96, width: 780, height: 96 });
                for (let row = 0; row < 5 && start + row < 20; row += 1) {
                    const id = start + row + 1, info = this.game.getSaveInfo(id), y = 154 + row * 96;
                    this.text(ctx, 'File ' + id, 24, y, { color: info || this.page === 'save' ? '#fff' : '#888' });
                    if (info) {
                        this.text(ctx, info.playerName, 240, y);
                        this.text(ctx, FNH.formatTime(info.playtime), 792, y + 36, { align: 'right' });
                    }
                }
                return;
            }
            if (this.page === 'main' || this.target) {
                this.window(ctx, 0, 0, 70, 252, !this.target ? { x: 18, y: 18 + this.index * 36, width: 34, height: 36 } : null);
                commands.forEach((entry, index) => this.icon(ctx, entry.icon, 19, 20 + index * 36));
                this.window(ctx, 70, 0, 746, 624, this.target ? { x: 88 + this.target.index * 177.5, y: 18, width: 177.5, height: 588 } : null);
                this.actors().slice(0, 4).forEach((actor, index) => this.actorCard(ctx, actor, 88 + index * 177.5, 177.5));
                return;
            }
            if (this.page === 'quit') {
                this.window(ctx, 288, 258, 240, 108, { x: 306, y: 276 + this.index * 36, width: 204, height: 36 });
                ['To Title', 'Cancel'].forEach((entry, index) => this.text(ctx, entry, 408, 304 + index * 36, { align: 'center' }));
                return;
            }
            if (this.page === 'controls') {
                this.window(ctx, 0, 0, 816, 108);
                this.text(ctx, this.awaitingKey ? 'Press a key. Esc to cancel.' : 'Keyboard Config', 24, 46);
                this.window(ctx, 0, 108, 816, 516, { x: 18, y: 126 + this.index * 36, width: 780, height: 36 });
                controlKeys.forEach((key, index) => {
                    this.text(ctx, key, 24, 154 + index * 36);
                    const binding = Object.entries(this.game.options.keyboard).find((entry) => entry[1] === key);
                    this.text(ctx, binding ? binding[0] : key, 792, 154 + index * 36, { align: 'right' });
                });
                return;
            }
            const entries = this.entries(), entry = entries[this.index];
            this.window(ctx, 0, 0, 816, 108);
            FNH.wrapText(ctx, entry?.item?.description || (this.page === 'options' ? 'A list of all of the game’s settings.' : ''), 24, 46, 768, 36, { size: 28, color: '#fff', outline: 4 });
            if (this.page === 'items' || this.page === 'skills') {
                const labels = this.page === 'items' ? ['Item', 'Weapon', 'Armor', 'Books'] : this.skillTypes().map((id) => this.game.data.system.skillTypes[id]);
                this.window(ctx, 0, 108, 816, 72, this.focus === 'tabs' ? { x: 18 + this.category * 780 / Math.max(1, labels.length), y: 126, width: 780 / Math.max(1, labels.length), height: 36 } : null);
                labels.forEach((label, index) => this.text(ctx, label, 18 + (index + 0.5) * 780 / labels.length, 154, { align: 'center' }));
                this.drawList(ctx, entries, 0, 180, 816, 444);
            } else if (this.page === 'equip') {
                const actor = this.actor();
                this.window(ctx, 0, 108, 308, 288);
                this.text(ctx, actor.name, 24, 154);
                ['atk', 'def', 'mat', 'mdf', 'agi', 'luk'].forEach((key, index) => {
                    this.text(ctx, this.game.data.system.terms.params[index + 2], 24, 190 + index * 36, { color: '#6e96ae' });
                    this.text(ctx, actor[key] + ' →', 282, 190 + index * 36, { align: 'right' });
                });
                this.window(ctx, 308, 108, 508, 72, this.focus === 'tabs' ? { x: 326 + this.category * 472 / 3, y: 126, width: 472 / 3, height: 36 } : null);
                ['Equip', 'Optimize', 'Clear'].forEach((label, index) => this.text(ctx, label, 326 + (index + 0.5) * 472 / 3, 154, { align: 'center' }));
                this.window(ctx, 308, 180, 508, 216, this.focus === 'slots' ? { x: 326, y: 198 + this.index * 36, width: 472, height: 36 } : null);
                this.game.data.system.equipTypes.slice(1).forEach((type, slot) => {
                    this.text(ctx, type, 332, 226 + slot * 36, { color: '#6e96ae' });
                    const equipped = actor.equipment.find((entry) => entry.slot === slot);
                    if (equipped) { const item = this.item({ kind: equipped.type, id: equipped.id }); this.icon(ctx, item.iconIndex, 480, 200 + slot * 36); this.text(ctx, item.name, 516, 226 + slot * 36, { maxWidth: 270 }); }
                });
                this.drawList(ctx, this.focus === 'equipItems' ? entries : [], 0, 396, 816, 228);
            } else if (this.page === 'synthesis') {
                this.window(ctx, 0, 108, 240, 180, this.focus === 'tabs' ? { x: 18, y: 126 + this.category * 36, width: 204, height: 36 } : null);
                this.synthesisTabs().forEach((tab, index) => this.text(ctx, tab.label, 120, 154 + index * 36, { align: 'center' }));
                this.window(ctx, 240, 108, 576, 180);
                if (!this.synthesisTotals) {
                    const all = Object.entries(tables).flatMap(([kind, table]) => this.game.data[table].filter(Boolean)
                        .map((item) => ({ kind, id: item.id, amount: 1 })));
                    this.synthesisTotals = [all.reduce((sum, source) => sum + this.recipes([source]).length, 0),
                        ...Object.keys(tables).map((kind) => all.filter((source) => source.kind === kind && /<Synthesis Ingredients>/i.test(this.item(source).note || '')).length)];
                }
                const crafted = this.game.flags['synthesis:crafted'] || [];
                const counts = [this.inventory().reduce((sum, source) => sum + this.recipes([source]).length, 0),
                    ...Object.keys(tables).map((kind) => crafted.filter((key) => key.startsWith(kind + ':')).length)];
                ['Collected Recipes', 'Crafted Items', 'Crafted Weapons', 'Crafted Armors'].forEach((label, index) => {
                    this.text(ctx, label, 264, 154 + index * 36, { color: '#6e96ae' });
                    this.text(ctx, counts[index] + '/' + this.synthesisTotals[index], 692, 154 + index * 36, { align: 'right' });
                    this.text(ctx, Math.floor(counts[index] / Math.max(1, this.synthesisTotals[index]) * 100) + '%', 792, 154 + index * 36, { align: 'right' });
                });
                this.drawList(ctx, entries, 0, 288, 408, 336);
                this.window(ctx, 408, 288, 408, 264);
                (entry?.needs || []).forEach((need, index) => this.text(ctx, this.item(need).name + '  ' + this.count(need.kind, need.id) + '/' + need.amount,
                    432, 334 + index * 36, { maxWidth: 360 }));
                this.window(ctx, 408, 552, 408, 72);
                this.text(ctx, this.game.gold, 792, 598, { align: 'right' });
            } else if (this.page === 'options') {
                this.window(ctx, 0, 108, 240, 516, this.focus === 'tabs' ? { x: 18, y: 126 + this.category * 36, width: 204, height: 36 } : null);
                ['All', 'General', 'Audio', 'Controls', 'Exit'].forEach((label, index) => this.text(ctx, label, 24, 154 + index * 36));
                this.window(ctx, 240, 108, 576, 516, this.focus === 'list' ? { x: 258, y: 126 + this.index * 36, width: 540, height: 36 } : null);
                entries.forEach((entry, index) => {
                    this.text(ctx, entry.label, 264, 154 + index * 36);
                    if (entry.key !== 'commandRemember') {
                        ctx.fillStyle = entry.key === 'master' ? '#962111' : '#be79ec';
                        ctx.fillRect(516, 154 + index * 36 + 6, 276 * this.game.audio.volumes[entry.key] / 100, 6);
                    }
                    this.text(ctx, entry.key === 'commandRemember' ? (this.game.options.commandRemember ? 'ON' : 'OFF') : this.game.audio.volumes[entry.key] + '%',
                        792, 154 + index * 36, { align: 'right' });
                });
            }
        }
    };
})();
