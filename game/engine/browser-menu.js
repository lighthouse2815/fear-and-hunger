'use strict';

(function (root) {
    function node(tag, text) {
        var element = document.createElement(tag);
        if (text != null) element.textContent = text;
        return element;
    }
    function fillSaveSlots(select, saveStore, selected) {
        select.replaceChildren();
        for (var slot = 1; slot <= 20; slot++) {
            var description = 'Trống';
            try {
                var info = saveStore.info(slot);
                if (info) description = new Date(info.savedAt).toLocaleString('vi-VN') + ' · Map ' + info.mapId + ' · ' + info.party.join(', ');
            } catch (error) { description = error.message; }
            var option = node('option', 'Ô ' + slot + ' — ' + description); option.value = slot; select.appendChild(option);
        }
        select.value = selected || 1;
    }
    function MenuUi(engine, saveStore, handlers, changed, options) {
        this.engine = engine; this.saveStore = saveStore; this.handlers = handlers; this.changed = changed;
        this.options = options;
        this.dialog = document.getElementById('fnh-menu-dialog');
        this.content = document.getElementById('fnh-menu-content');
        this.message = document.getElementById('fnh-menu-message');
        this.actorSelect = document.getElementById('fnh-menu-actor');
        this.tab = 'status'; this.busy = false; this.skillTarget = null; this.saveSlot = 1;
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
            if (!state.party.includes(this.skillTarget)) this.skillTarget = actorId;
            content.appendChild(node('p', 'Người thi triển: ' + actor.name));
            var targetLabel = node('label', 'Mục tiêu: '), targets = node('select'); targets.id = 'fnh-menu-skill-target';
            state.party.forEach(function (id) {
                var friend = state.actor(id), option = node('option', friend.name + ' · HP ' + friend.hp + '/' + state.actorParam(id, 0) + ' · MP ' + friend.mp);
                option.value = id; targets.appendChild(option);
            });
            targets.value = this.skillTarget; targets.disabled = this.busy;
            targets.onchange = function () { ui.skillTarget = Number(targets.value); ui.render(); };
            targetLabel.appendChild(targets); content.appendChild(targetLabel);
            engine.battle.actorSkills(actorId).forEach(function (skill) {
                var cost = engine.battle.skillCost({ id: actorId }, skill);
                content.appendChild(node('h3', skill.name + ' · MP ' + cost.mp + ' · TP ' + cost.tp));
                content.appendChild(node('p', skill.description));
                var label = [8, 10].includes(skill.scope) ? 'Dùng cho cả đội' : skill.scope === 11 ? 'Dùng cho bản thân' : 'Dùng';
                var use = node('button', label); use.type = 'button'; use.dataset.skill = skill.id;
                use.disabled = ui.busy || !engine.canUseMenuSkill(actorId, skill.id, ui.skillTarget);
                use.onclick = function () { ui.act(function () {
                    var using = engine.useMenuSkill(actorId, skill.id, ui.skillTarget, ui.handlers); ui.render(); return using;
                }); };
                content.appendChild(use);
            });
        } else if (this.tab === 'synthesis') {
            ['item', 'weapon', 'armor'].forEach(function (kind) {
                var recipes = engine.synthesisRecipes(kind);
                if (!recipes.length) return;
                content.appendChild(node('h3', { item: 'Vật phẩm', weapon: 'Vũ khí', armor: 'Giáp' }[kind]));
                recipes.forEach(function (recipe) {
                    var row = node('div'), ingredients = recipe.ingredients.map(function (ingredient) {
                        if (ingredient.kind === 'gold') return 'Bạc ' + ingredient.amount;
                        var table = engine.database[{ item: 'Items', weapon: 'Weapons', armor: 'Armors' }[ingredient.kind]];
                        return (table[ingredient.id] && table[ingredient.id].name || ingredient.kind + ' ' + ingredient.id) + ' × ' + ingredient.amount;
                    }).join(', ');
                    row.appendChild(node('strong', recipe.name));
                    row.appendChild(node('p', 'Nguyên liệu: ' + ingredients));
                    var craft = node('button', 'Chế tạo'); craft.type = 'button'; craft.dataset.synthesis = recipe.kind + ':' + recipe.id;
                    craft.disabled = ui.busy || !engine.canSynthesize(recipe);
                    craft.onclick = function () { ui.act(async function () {
                        engine.synthesize(recipe);
                        if (ui.handlers.effect) await ui.handlers.effect(250, [{ name: 'fnh_choice2', volume: 100, pitch: 100, pan: 0 }]);
                    }); };
                    row.appendChild(craft); content.appendChild(row);
                });
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
        } else if (this.tab === 'options') {
            var settings = this.options.settings;
            [['master','Âm lượng tổng'],['bgm','Nhạc nền'],['bgs','Môi trường'],['me','Nhạc sự kiện'],['se','Hiệu ứng']].forEach(function (entry) {
                var label = node('label', entry[1] + ': '), slider = node('input'), value = node('output', settings.volumes[entry[0]] + '%');
                slider.type = 'range'; slider.min = 0; slider.max = 100; slider.value = settings.volumes[entry[0]];
                slider.dataset.volume = entry[0]; slider.disabled = ui.busy;
                slider.oninput = function () {
                    try { ui.options.updateVolume(entry[0], Number(slider.value)); value.textContent = slider.value + '%'; }
                    catch (error) { ui.message.textContent = error.message; }
                };
                label.append(slider, value); content.appendChild(label);
            });
            var dashLabel = node('label', 'Luôn chạy nhanh '), dash = node('input'); dash.type = 'checkbox'; dash.checked = state.alwaysDash;
            dash.id = 'fnh-option-dash'; dash.onchange = function () {
                state.alwaysDash = dash.checked; settings.alwaysDash = dash.checked;
                try { settings.save(); ui.changed(); } catch (error) { ui.message.textContent = error.message; }
            };
            dashLabel.appendChild(dash); content.appendChild(dashLabel);
            content.appendChild(node('h3', 'Bàn phím'));
            content.appendChild(node('p', 'Chọn hành động rồi nhấn phím trong ô bên dưới để gán. Chọn “Không gán” để bỏ phím.'));
            var action = node('select'); action.id = 'fnh-key-action';
            action.setAttribute('aria-label', 'Hành động của phím');
            var names = { '': 'Không gán', down: 'Đi xuống', left: 'Đi trái', right: 'Đi phải', up: 'Đi lên', ok: 'Xác nhận / Tương tác',
                cancel: 'Hủy / Menu', shift: 'Chạy nhanh', pageup: 'Trang trước', pagedown: 'Trang sau', torch: 'Đốt đuốc', skill: 'Kỹ năng' };
            Object.keys(names).forEach(function (key) { var option = node('option', names[key]); option.value = key; action.appendChild(option); });
            var keyLabel = node('label', 'Phím: '), input = node('input'); input.id = 'fnh-key-input'; input.readOnly = true;
            input.placeholder = 'Nhấn phím để gán'; input.onkeydown = function (event) {
                event.preventDefault(); event.stopPropagation();
                try {
                    settings.bind(event.key, action.value); ui.options.clearInput(); input.value = event.key === ' ' ? 'Space' : event.key;
                    ui.message.textContent = 'Đã gán ' + input.value + ': ' + names[action.value];
                } catch (error) { ui.message.textContent = error.message; }
            };
            keyLabel.appendChild(input); content.append(action, keyLabel);
            var bindings = node('dl'); bindings.id = 'fnh-key-bindings';
            function showBindings() {
                bindings.replaceChildren();
                Object.keys(names).filter(Boolean).forEach(function (name) {
                    bindings.append(node('dt', names[name]), node('dd', Object.keys(settings.keys).filter(function (key) {
                        return settings.keys[key] === name;
                    }).map(function (key) { return key === ' ' ? 'Space' : key; }).join(', ') || 'Chưa gán'));
                });
            }
            input.addEventListener('keydown', showBindings); showBindings();
            [false, true].forEach(function (wasd) {
                var layout = node('button', wasd ? 'Dùng WASD' : 'Phím mặc định'); layout.type = 'button'; layout.dataset.keyLayout = wasd ? 'wasd' : 'default';
                layout.onclick = function () {
                    try { settings.layout(wasd); ui.options.clearInput(); ui.render(); }
                    catch (error) { ui.message.textContent = error.message; }
                }; content.appendChild(layout);
            });
            content.appendChild(bindings);
        } else if (this.tab === 'system') {
            var slotLabel = node('label', 'Ô lưu: '), slots = node('select'); slots.id = 'fnh-menu-save-slot';
            fillSaveSlots(slots, ui.saveStore, this.saveSlot);
            slots.disabled = ui.busy && !(engine.menuWaiters && engine.menuWaiters.size);
            slots.onchange = function () { ui.saveSlot = Number(slots.value); ui.render(); };
            slotLabel.appendChild(slots); content.appendChild(slotLabel);
            var save = node('button', 'Lưu ô ' + this.saveSlot); save.type = 'button'; save.id = 'fnh-menu-save';
            save.disabled = (ui.busy && !(engine.menuWaiters && engine.menuWaiters.size)) || !state.saveEnabled;
            save.onclick = function () {
                try { engine.saveMenuTo(ui.saveStore, ui.saveSlot); ui.render(); ui.message.textContent = 'Đã lưu ô ' + ui.saveSlot + '.'; }
                catch (error) { ui.message.textContent = error.message; }
            };
            var load = node('button', 'Tải ô ' + this.saveSlot); load.type = 'button'; load.id = 'fnh-menu-load';
            load.disabled = ui.busy || engine.eventRunning;
            load.onclick = function () { ui.act(async function () {
                if (!ui.saveStore.exists(ui.saveSlot)) throw new Error('Ô ' + ui.saveSlot + ' chưa có dữ liệu lưu.');
                ui.dialog.close();
                await engine.loadFrom(ui.saveStore, ui.saveSlot, ui.handlers);
            }); };
            content.append(save, load);
        }
    };
    root.FNHStandaloneMenu = { MenuUi: MenuUi, fillSaveSlots: fillSaveSlots };
}(typeof globalThis !== 'undefined' ? globalThis : this));
