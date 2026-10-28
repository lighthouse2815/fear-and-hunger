'use strict';
(function (root) {
    function BattleUi(engine, options) {
        this.engine = engine; this.options = options; this.mode = 'command'; this.actorId = 0;
        this.panel = document.getElementById('fnh-combat'); this.busy = false;
        var ui = this;
        this.handleKey = function (event) {
            var action = options.input(event.key), buttons = Array.from(ui.panel.querySelectorAll('button:not(:disabled)')).filter(function (button) { return button.getClientRects().length; });
            if (['up', 'down', 'left', 'right'].includes(action) && buttons.length) {
                var index = buttons.indexOf(document.activeElement), step = ['up', 'left'].includes(action) ? -1 : 1;
                buttons[(index + step + buttons.length) % buttons.length].focus();
            } else if (action === 'cancel') ui.back();
            else if (action === 'ok' && document.activeElement.tagName === 'BUTTON') { if (!event.repeat) document.activeElement.click(); }
            else return;
            event.preventDefault(); event.stopPropagation();
        };
        this.panel.addEventListener('keydown', this.handleKey);
    }
    BattleUi.prototype.back = function () {
        if (this.busy) return;
        if (this.mode === 'target') this.mode = this.kind === 'item' ? 'item' : this.id === 1 || this.id === 2 ? 'command' : 'skill';
        else if (this.mode !== 'command') this.mode = 'command';
        else {
            var actions = this.engine.battle.battle.inputActions || [], previous = actions[actions.length - 1];
            if (previous) { this.engine.removeBattleAction(previous.actorId); this.actorId = previous.actorId; }
            else this.mode = 'party';
        }
        this.render(true);
    };
    BattleUi.prototype.run = async function (action) {
        if (this.busy) return;
        this.busy = true; this.render();
        try { await action(); }
        catch (error) { document.getElementById('fnh-combat-help').textContent = error.message; }
        finally { this.busy = false; this.mode = 'command'; this.render(true); await this.options.changed(); }
    };
    BattleUi.prototype.choose = function (kind, id) {
        this.kind = kind; this.id = id;
        this.engine.state.actor(this.actorId).lastBattleCommand=kind==='item'?3:id===1?0:id===2?2:1;
        var data = kind === 'item' ? this.engine.database.Items[id] : this.engine.battle.skillFor(this.engine.battle.actor(this.actorId), id);
        if ([1, 7, 9].includes(data.scope)) { this.mode = 'target'; this.render(true); }
        else this.confirm(0);
    };
    BattleUi.prototype.confirm = function (target) {
        var ui = this;
        try {
            this.engine.queueBattleAction(this.actorId, this.kind, this.id, target);
            this.mode = 'command'; this.actorId = 0;
            var battle = this.engine.battle.battle;
            if (this.engine.battle.inputActors().every(function (actor) { return battle.inputActions.some(function (action) { return action.actorId === actor.id; }); })) {
                this.run(function () { return ui.engine.startBattleTurn(ui.options.handlers); });
            } else this.render(true);
        } catch (error) { document.getElementById('fnh-combat-help').textContent = error.message; }
    };
    BattleUi.prototype.render = function (focus) {
        var ui = this, engine = this.engine, battle = engine.battle.battle;
        var previousFocus=!focus && this.panel.contains(document.activeElement) ? document.activeElement.textContent : null;
        this.panel.hidden = !battle || engine.state.scene !== 'battle' || !!battle.result;
        if (this.panel.hidden) return;
        if (this.battle !== battle) { this.battle = battle; this.actorId = 0; this.mode = 'command'; }
        var inputs = engine.battle.inputActors(), queued = battle.inputActions || [];
        if (!inputs.some(function (actor) { return actor.id === ui.actorId; })) {
            var next = inputs.find(function (actor) { return !queued.some(function (action) { return action.actorId === actor.id; }); });
            this.actorId = next ? next.id : 0;
        }
        var active = !this.busy && battle.phase === 'input' && !engine.messageRunning;
        if (active && !this.wasActive) focus = true;
        this.wasActive = active;
        var status = document.getElementById('fnh-combat-status'); status.replaceChildren();
        battle.actors.forEach(function (actor) {
            var row = document.createElement('div'); row.className = 'fnh-combat-member'; row.dataset.selected = String(actor.id === ui.actorId);
            var name = document.createElement('span'); name.textContent = actor.name; row.appendChild(name);
            [['Body',actor.hp,engine.state.actorParam(actor.id,0)],['Mind',actor.mp,engine.state.actorParam(actor.id,1)]].forEach(function (entry) {
                var label = document.createElement('span'), meter = document.createElement('meter');
                label.textContent = entry[0] + ' ' + entry[1]; meter.min = 0; meter.max = Math.max(1,entry[2]); meter.value = entry[1];
                meter.setAttribute('aria-label', entry[0] + ' ' + actor.name); label.appendChild(meter); row.appendChild(label);
            });
            var icons = document.createElement('span'); icons.className = 'fnh-combat-icons';
            (actor.states || []).forEach(function (id) {
                var state = engine.database.States[id]; if (!state || !state.iconIndex) return;
                var icon = document.createElement('span'); icon.className = 'fnh-text-icon'; icon.title = state.name;
                icon.style.backgroundPosition = -(state.iconIndex % 16 * 32) + 'px ' + -Math.floor(state.iconIndex / 16) * 32 + 'px'; icons.appendChild(icon);
            }); row.appendChild(icons); status.appendChild(row);
        });
        var commands = document.getElementById('fnh-combat-commands'), list = document.getElementById('fnh-combat-list'), targets = document.getElementById('fnh-combat-targets');
        commands.replaceChildren(); list.replaceChildren(); targets.replaceChildren();
        commands.hidden = this.mode !== 'command' && this.mode !== 'party';
        list.hidden = !['skill','item'].includes(this.mode); targets.hidden = this.mode !== 'target';
        var help = document.getElementById('fnh-combat-help'); help.textContent = battle.extraTurn ? 'Extra turn' : battle.escapeFailed ? 'Could not escape!' : '';
        function button(parent, text, enabled, action, description) {
            var node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.disabled = !active || !enabled;
            node.onclick = action; node.onfocus = node.onmouseenter = function () {
                parent.querySelectorAll('button').forEach(function (other) { other.dataset.selected = String(other === node); });
                if (description) help.textContent = root.FNHStandaloneText.formatText(description, engine.state);
            }; parent.appendChild(node); return node;
        }
        if (this.mode === 'party') {
            button(commands,'Fight',true,function () { ui.mode = 'command'; ui.render(true); });
            button(commands,'Run!',battle.canEscape,function () { ui.run(function () { return engine.battleEscape(ui.options.handlers); }); });
        } else if (this.mode === 'command') {
            var actor = engine.battle.actor(this.actorId);
            if (actor) {
                button(commands,'Attack',engine.battle.canUseSkill(actor,engine.battle.skillFor(actor,1)),function () { ui.choose('skill',1); });
                button(commands,'Skills',true,function () { engine.state.actor(ui.actorId).lastBattleCommand=1;ui.mode = 'skill'; ui.render(true); });
                button(commands,'Guard',engine.battle.canUseSkill(actor,engine.database.Skills[2]),function () { ui.choose('skill',2); });
                button(commands,'Item',true,function () { engine.state.actor(ui.actorId).lastBattleCommand=3;ui.mode = 'item'; ui.render(true); });
            } else button(commands,'Fight',true,function () { ui.run(function () { return engine.startBattleTurn(ui.options.handlers); }); });
        } else if (this.mode === 'skill' || this.mode === 'item') {
            var itemMode = this.mode === 'item', user = engine.battle.actor(this.actorId);
            var entries = itemMode ? engine.database.Items.filter(function (item) { return item && [0,1].includes(item.occasion) && engine.state.itemCount('items',item.id)>0; }) : engine.battle.actorSkills(this.actorId).filter(function (skill) { return skill.id !== 1 && skill.id !== 2; });
            entries.forEach(function (entry) {
                button(list,entry.name + (itemMode ? ' ×' + engine.state.itemCount('items',entry.id) : '  ' + entry.mpCost),
                    itemMode ? engine.battle.canUseItem(user,entry) : engine.battle.canUseSkill(user,entry),function () { ui.choose(itemMode?'item':'skill',entry.id); },entry.description);
            });
            button(list,'Cancel',true,function () { ui.back(); });
        } else if (this.mode === 'target') {
            var data = this.kind === 'item' ? engine.database.Items[this.id] : engine.battle.skillFor(engine.battle.actor(this.actorId),this.id);
            var enemies = data.scope === 1, members = enemies ? battle.enemies.filter(function (enemy) { return enemy.alive && !enemy.hidden; }) : battle.actors.filter(function (actor) { return data.scope === 9 ? !actor.alive : actor.alive; });
            members.forEach(function (member) {
                var index = enemies ? member.index : battle.actors.indexOf(member);
                var node = button(targets,member.name,true,function () { ui.confirm(index); },member.name); node.dataset.target = index;
                if (enemies) {
                    node.className = 'fnh-combat-enemy'; node.style.left = member.x / 816 * 100 + '%'; node.style.top = member.y / 624 * 100 + '%';
                    var enemy = engine.database.Enemies[member.enemyId];
                    if (enemy && enemy.battlerName) ui.options.renderer.loadImage('img/enemies/' + encodeURIComponent(enemy.battlerName) + '.png').then(function (image) {
                        if (!node.isConnected) return;
                        node.style.width = image.width / 816 * 100 + '%'; node.style.height = image.height / 624 * 100 + '%';
                        var mask = document.createElement('canvas'); mask.width = image.width; mask.height = image.height;
                        var context = mask.getContext('2d'); context.drawImage(image,0,0);
                        var pixels = context.getImageData(0,0,image.width,image.height).data, left = [], right = [];
                        for (var y = 0; y < image.height; y += 4) {
                            var min = image.width, max = -1;
                            for (var row = y; row < Math.min(y+4,image.height); row++) for (var x = 0; x < image.width; x++) {
                                if (pixels[(row*image.width+x)*4+3] > 32) { min = Math.min(min,x); max = Math.max(max,x); }
                            }
                            if (max >= min) {
                                left.push(min/image.width*100+'% '+y/image.height*100+'%');
                                right.push((max+1)/image.width*100+'% '+Math.min(y+4,image.height)/image.height*100+'%');
                            }
                        }
                        if (left.length) node.style.clipPath = 'polygon(' + left.concat(right.reverse()).join(',') + ')';
                    }).catch(function (error) { help.textContent = error.message; });
                }
            });
            help.textContent = data.name + ' — Select a target';
        }
        if (focus || previousFocus!==null) {
            var first = this.panel.querySelector('#fnh-combat-commands:not([hidden]) button:enabled, #fnh-combat-list:not([hidden]) button:enabled, #fnh-combat-targets:not([hidden]) button:enabled');
            if(previousFocus!==null)first=Array.from(this.panel.querySelectorAll('button:enabled')).find(function (button) {return button.getClientRects().length && button.textContent===previousFocus;})||first;
            if(this.mode==='command' && this.actorId && this.options.settings && this.options.settings.commandRemember) {
                var remembered=this.engine.state.actor(this.actorId).lastBattleCommand,command=this.panel.querySelectorAll('#fnh-combat-commands button')[remembered];
                if(command && !command.disabled)first=command;
            }
            if (first) { first.focus({preventScroll:true}); first.onfocus(); }
        }
    };
    root.FNHStandaloneBattleUi = { BattleUi: BattleUi };
}(typeof globalThis !== 'undefined' ? globalThis : this));
