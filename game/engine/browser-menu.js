'use strict';

(function (root) {
    function node(tag, text) {
        var element = document.createElement(tag);
        if (text != null) element.textContent = text;
        return element;
    }
    function MenuUi(engine, saveStore, handlers, changed) {
        this.engine = engine; this.saveStore = saveStore; this.handlers = handlers; this.changed = changed;
        this.dialog = document.getElementById('fnh-menu-dialog');
        this.content = document.getElementById('fnh-menu-content');
        this.message = document.getElementById('fnh-menu-message');
        this.actorSelect = document.getElementById('fnh-menu-actor');
        this.tab = 'status'; this.busy = false;
        var ui = this;
        document.getElementById('fnh-menu').onclick = function () { if (engine.openMenu()) ui.render(); };
        document.getElementById('fnh-menu-close').onclick = function () { ui.close(); };
        this.dialog.addEventListener('cancel', function (event) { event.preventDefault(); ui.close(); });
        this.actorSelect.onchange = function () { ui.render(); };
        this.dialog.querySelectorAll('[data-menu-tab]').forEach(function (button) {
            button.onclick = function () { ui.tab = button.dataset.menuTab; ui.render(); };
        });
    }
    MenuUi.prototype.close = function () {
        if (this.busy && !(this.engine.menuWaiters && this.engine.menuWaiters.size)) return;
        this.engine.closeMenu(); this.render(); this.changed();
    };
    MenuUi.prototype.act = async function (action) {
        if (this.busy) return;
        this.busy = true; this.message.textContent = '';
        var failure;
        try { await action(); await this.changed(); }
        catch (error) { failure = error.message; document.getElementById('fnh-status').textContent = error.message; }
        finally { this.busy = false; this.render(); if (failure) this.message.textContent = failure; }
    };
    MenuUi.prototype.render = function () {
        var engine = this.engine, state = engine.state, ui = this;
        var visible = state && ['menu', 'save'].includes(state.scene);
        document.getElementById('fnh-menu').disabled = !state || state.scene !== 'map' || !state.menuEnabled || engine.eventRunning;
        if (!visible) { if (this.dialog.open) this.dialog.close(); return; }
        if (!this.dialog.open) {
            this.message.textContent = ''; this.tab = state.scene === 'save' ? 'system' : 'status';
            this.dialog.showModal(); engine.buttons.clear();
        }
        var actorId = Number(this.actorSelect.value);
        if (!state.party.includes(actorId)) actorId = state.party[0];
        this.actorSelect.replaceChildren();
        state.party.forEach(function (id) {
            var option = node('option', state.actor(id).name); option.value = id; ui.actorSelect.appendChild(option);
        });
        if (actorId) this.actorSelect.value = actorId;
        var actor = actorId && state.actor(actorId), content = this.content;
        content.replaceChildren();
        this.dialog.querySelectorAll('[data-menu-tab]').forEach(function (button) {
            button.setAttribute('aria-pressed', String(button.dataset.menuTab === ui.tab));
        });
        content.appendChild(node('p', 'Bạc: ' + state.gold));
        if (this.tab === 'status' && actor) {
            content.appendChild(node('h3', actor.name + ' · Lv ' + actor.level));
            ['HP', 'MP', 'ATK', 'DEF', 'MAT', 'MDF', 'AGI', 'LUK'].forEach(function (name, index) {
                content.appendChild(node('p', name + ': ' + (index < 2 ? actor[index === 0 ? 'hp' : 'mp'] + '/' : '') + state.actorParam(actorId, index)));
            });
            content.appendChild(node('p', 'TP: ' + actor.tp));
            content.appendChild(node('p', actor.states.map(function (id) { return engine.database.States[id].name; }).join(', ') || 'Không có trạng thái bất lợi.'));
        } else if (this.tab === 'inventory') {
            ['items', 'weapons', 'armors'].forEach(function (kind) {
                content.appendChild(node('h3', {items:'Vật phẩm',weapons:'Vũ khí',armors:'Giáp'}[kind]));
                var table = engine.database[{items:'Items',weapons:'Weapons',armors:'Armors'}[kind]];
                Object.keys(state.inventory[kind]).filter(function (id) { return state.itemCount(kind, Number(id)) > 0; }).forEach(function (id) {
                    var item = table[id], row = node('div'); if (!item) return;
                    row.appendChild(node('strong', item.name + ' × ' + state.itemCount(kind, Number(id))));
                    row.appendChild(node('p', item.description));
                    if (kind === 'items') {
                        var use = node('button', 'Dùng'); use.type = 'button'; use.dataset.item = id;
                        use.disabled = ui.busy || !engine.canUseMenuItem(Number(id), actorId);
                        use.onclick = function () { ui.act(function () { var using = engine.useMenuItem(Number(id), actorId, ui.handlers); ui.render(); return using; }); };
                        row.appendChild(use);
                    }
                    content.appendChild(row);
                });
            });
        } else if (this.tab === 'skills' && actor) {
            engine.battle.actorSkills(actorId).forEach(function (skill) {
                content.appendChild(node('h3', skill.name + ' · MP ' + skill.mpCost + ' · TP ' + skill.tpCost));
                content.appendChild(node('p', skill.description));
            });
        } else if (this.tab === 'equipment' && actor) {
            actor.equips.forEach(function (equipped, slot) {
                var kind = slot === 0 ? 'weapons' : 'armors';
                var table = engine.database[slot === 0 ? 'Weapons' : 'Armors'];
                var label = node('label', engine.database.System.equipTypes[slot + 1] + ': ');
                var select = node('select'); select.dataset.slot = slot;
                var empty = node('option', 'Tháo'); empty.value = 0; select.appendChild(empty);
                table.filter(function (item) { return item && item.etypeId === slot + 1 && (item.id === equipped || state.itemCount(kind, item.id) > 0); }).forEach(function (item) {
                    var option = node('option', item.name); option.value = item.id; select.appendChild(option);
                });
                select.value = equipped; select.disabled = ui.busy;
                select.onchange = function () { ui.act(function () {
                    if (!engine.equipMenuActor(actorId, slot, Number(select.value))) throw new Error('Không thể đổi trang bị này.');
                }); };
                label.appendChild(select); content.appendChild(label);
            });
        } else if (this.tab === 'system') {
            var save = node('button', 'Lưu ô 1'); save.type = 'button'; save.id = 'fnh-menu-save';
            save.disabled = (ui.busy && !(engine.menuWaiters && engine.menuWaiters.size)) || !state.saveEnabled;
            save.onclick = function () {
                try { engine.saveMenuTo(ui.saveStore, 1); ui.message.textContent = 'Đã lưu ô 1.'; }
                catch (error) { ui.message.textContent = error.message; }
            };
            var load = node('button', 'Tải ô 1'); load.type = 'button'; load.id = 'fnh-menu-load';
            load.disabled = ui.busy || engine.eventRunning;
            load.onclick = function () { ui.act(async function () {
                if (!ui.saveStore.exists(1)) throw new Error('Ô 1 chưa có dữ liệu lưu.');
                ui.dialog.close();
                await engine.loadFrom(ui.saveStore, 1, ui.handlers);
            }); };
            content.append(save, load);
        }
    };
    root.FNHStandaloneMenu = { MenuUi: MenuUi };
}(typeof globalThis !== 'undefined' ? globalThis : this));
