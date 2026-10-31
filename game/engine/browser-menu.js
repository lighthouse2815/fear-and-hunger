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
    function renderSaveFiles(container, store, options) {
        var previous=document.activeElement;
        if(container.contains(previous) && previous.matches('.fnh-save-file')) {options.focus=true;options.selected=Number(previous.dataset.slot);}
        container.replaceChildren(); container.classList.add('fnh-save-screen');
        var t=options.settings ? options.settings.translate.bind(options.settings) : function (text) {return text;};
        var help = node('div',t(options.mode === 'save' ? 'Save to which file?' : 'Load which file?')); help.className='fnh-save-help';
        var list = node('div'); list.className='fnh-save-list'; list.setAttribute('aria-label',options.mode==='save'?'Save files':'Load files');
        var rows=node('div');rows.className='fnh-save-rows';list.appendChild(rows);
        options.windowBackground(help,816,72); options.windowBackground(list,816,552);
        for (var slot=1;slot<=20;slot++) {
            var row=node('button');row.type='button';row.className='fnh-save-file';row.dataset.slot=slot;
            var label=node('span',t('File')+' '+slot);label.className='fnh-save-id';row.appendChild(label);
            try {
                var payload=store.read(slot);
                if(payload) {
                    var members=(payload.state.party||[]).slice(0,4).map(function (id) {
                        return Object.assign({},options.engine.database.Actors[id],payload.state.actors && payload.state.actors[id]);
                    });
                    var names=node('span',members.map(function (actor) {return actor.name;}).filter(Boolean).join(', '));names.className='fnh-save-names';row.appendChild(names);
                    var playTimeMs=payload.state.playTimeMs;
                    var playTime=node('span',root.FNHStandaloneState.GameState.prototype.playTimeText.call({playTimeMs:Number.isFinite(playTimeMs)?Math.max(0,playTimeMs):0}));
                    playTime.className='fnh-save-play-time';row.appendChild(playTime);
                    var party=node('span');party.className='fnh-save-party';
                    members.forEach(function (actor) {
                        if(!actor || !actor.characterName)return;
                        var canvas=node('canvas');canvas.setAttribute('aria-label',actor.name);canvas.setAttribute('role','img');party.appendChild(canvas);
                        var filename=actor.characterName,index=actor.characterIndex||0;
                        options.renderer.loadImage('img/characters/'+filename+'.png').then(function (bitmap) {
                            var prefix=/^[!$]+/.exec(filename),single=prefix && prefix[0].includes('$'),w=bitmap.width/(single?3:12),h=bitmap.height/(single?4:8);
                            var x=(single?1:index%4*3+1)*w,y=(single?0:Math.floor(index/4)*4)*h;
                            canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(bitmap,x,y,w,h,0,0,w,h);canvas.dataset.ready='true';
                        }).catch(function (error) { canvas.title=error.message; });
                    });row.appendChild(party);
                } else if(options.mode==='load')row.classList.add('fnh-save-empty');
            } catch(error) {row.appendChild(node('span',error.message));row.classList.add('fnh-save-corrupt');}
            row.onfocus=function () {list.querySelectorAll('button').forEach(function (other) {other.dataset.selected=String(other===this);},this);};
            row.onclick=function () {options.confirm(Number(this.dataset.slot));};rows.appendChild(row);
        }
        list.onkeydown=function (event) {
            var action=options.input(event.key),buttons=Array.from(rows.children),index=buttons.indexOf(document.activeElement);
            if(['up','down','pageup','pagedown'].includes(action)) {
                var step=action==='up'?-1:action==='down'?1:action==='pageup'?-5:5;
                buttons[Math.max(0,Math.min(19,index+step))].focus();
            } else if(action==='ok') {if(!event.repeat && document.activeElement.matches('.fnh-save-file'))document.activeElement.click();}
            else return;
            event.preventDefault();event.stopPropagation();
        };
        container.append(help,list);
        var selected=rows.children[Math.max(0,Math.min(19,(options.selected||1)-1))];
        selected.dataset.selected='true';if(options.focus)selected.focus({preventScroll:true});
        rows.scrollTop=Math.max(0,(Number(selected.dataset.slot)-3)*103/816*container.clientWidth);
    }
    function MenuUi(engine, saveStore, handlers, changed, options) {
        this.engine = engine; this.saveStore = saveStore; this.handlers = handlers; this.changed = changed;
        this.options = options;
        this.dialog = document.getElementById('fnh-menu-dialog');
        this.content = document.getElementById('fnh-menu-content');
        this.message = document.getElementById('fnh-menu-message');
        this.actorSelect = document.getElementById('fnh-menu-actor');
        this.tab = 'status'; this.commandTab = 'inventory'; this.lastCommandTab = 'inventory'; this.busy = false; this.skillTarget = null; this.saveSlot = 1; this.partyCommand = null;
        var ui = this;
        document.getElementById('fnh-menu').onclick = function () { if (engine.openMenu()) ui.render(); };
        document.getElementById('fnh-menu-close').onclick = function () { ui.close(); };
        this.dialog.addEventListener('cancel', function (event) { event.preventDefault(); ui.back(); });
        this.dialog.addEventListener('keydown', function (event) {
            if (!options || !options.gameplay || event.target.closest('input,textarea')) return;
            var action = options.input(event.key);
            if (ui.dialog.classList.contains('fnh-menu-tabs') && root.FNHStandaloneGameMenu.handleKey(ui,event)) return;
            if (action === 'cancel') {
                event.preventDefault(); event.stopPropagation();
                if (!event.repeat) ui.back();
            } else if (event.target.closest('nav') && ['up','down','ok'].includes(action)) {
                event.preventDefault(); event.stopPropagation();
                if (action === 'ok') { if (!event.repeat) document.activeElement.click(); return; }
                var buttons = Array.from(ui.dialog.querySelectorAll('nav button')).filter(function (button) { return !button.hidden && !button.disabled; });
                var index = buttons.indexOf(document.activeElement), step = action === 'up' ? -1 : 1;
                if (buttons.length) buttons[(index+step+buttons.length)%buttons.length].focus();
            }
        });
        this.actorSelect.onchange = function () { ui.render(); };
        this.dialog.querySelectorAll('[data-menu-tab]').forEach(function (button) {
            button.onfocus = function () {
                ui.commandTab = button.dataset.menuTab;
                ui.dialog.querySelectorAll('[data-menu-tab]').forEach(function (other) { other.dataset.commandSelected = String(other === button); });
                if (options && options.gameplay && !ui.rendering && engine.state.scene==='menu') {
                    ui.lastCommandTab=ui.commandTab;
                    if(ui.tab!==ui.commandTab) {ui.tab=ui.commandTab;ui.gameMenu={};ui.render();}
                }
            };
            button.onpointermove = function () {
                if (ui.dialog.classList.contains('fnh-menu-tabs') && !button.disabled && document.activeElement !== button) button.focus({preventScroll:true});
            };
            button.onclick = function () {
                ui.lastCommandTab = ui.commandTab = button.dataset.menuTab;
                if (options && options.gameplay && ['equipment','skills'].includes(ui.commandTab)) {
                    ui.partyCommand = ui.commandTab; ui.tab = 'status'; ui.render();
                    var selected = ui.content.querySelector('[data-party-actor="' + ui.actorSelect.value + '"] .fnh-party-name');
                    if (selected) selected.focus({preventScroll:true});
                } else { ui.tab = ui.commandTab; ui.render(); if(options && options.gameplay)ui.enterContent(); }
            };
        });
    }
    MenuUi.prototype.focusCommand = function () {
        var command = this.dialog.querySelector('nav button[data-menu-tab="' + this.commandTab + '"]:not([hidden]):not(:disabled)') ||
            this.dialog.querySelector('nav button:not([hidden]):not(:disabled)');
        if (command) command.focus({preventScroll:true});
    };
    MenuUi.prototype.enterContent = function () {
        var first=this.content.querySelector('[data-window="category"] button:enabled, [data-window="equipment-command"] button:enabled, [data-window="skill-type"] button:enabled, [data-window="synthesis-command"] button:enabled, [data-window="options-category"] button:enabled, [data-window="game-end"] button:enabled') || this.content.querySelector('button:enabled');
        if(first)first.focus({preventScroll:true});
    };
    MenuUi.prototype.back = function () {
        if (this.busy && !(this.engine.menuWaiters && this.engine.menuWaiters.size)) return;
        if(this.dialog.classList.contains('fnh-menu-tabs')) {
            if(root.FNHStandaloneGameMenu.back(this))return;
            this.close();return;
        }
        if (this.options && this.options.gameplay && this.tab !== 'status' && this.engine.state.scene !== 'save') {
            this.tab = 'status'; this.render(); this.focusCommand();
        } else this.close();
    };
    MenuUi.prototype.close = function () {
        if (this.busy && !(this.engine.menuWaiters && this.engine.menuWaiters.size)) return;
        this.engine.closeMenu(); this.render(); document.getElementById('fnh-canvas').focus({preventScroll:true}); this.changed();
    };
    MenuUi.prototype.act = async function (action) {
        if (this.busy) return;
        var focusKey=document.activeElement.dataset.menuKey;
        this.busy = true; this.message.textContent = '';
        var failure;
        try { await action(); await this.changed(); }
        catch (error) { failure = error.message; document.getElementById('fnh-status').textContent = error.message; }
        finally {
            this.busy = false; this.render(); if (failure) this.message.textContent = failure;
            if(this.dialog.open && this.dialog.classList.contains('fnh-menu-tabs') && focusKey) {
                var focus=Array.from(this.content.querySelectorAll('button:enabled')).find(function (button) {return button.dataset.menuKey===focusKey;});
                if(focus)focus.focus({preventScroll:true});else this.enterContent();
            }
        }
    };
    MenuUi.prototype.render = function () {
        if(this.rendering)return;
        this.rendering=true;
        try {this.renderMenu();}finally {this.rendering=false;}
    };
    MenuUi.prototype.renderMenu = function () {
        var engine = this.engine, state = engine.state, ui = this;
        var visible = state && ['menu', 'save'].includes(state.scene);
        document.getElementById('fnh-menu').disabled = !state || state.scene !== 'map' || !state.menuEnabled || engine.eventRunning;
        if (!visible) { if (this.dialog.open) this.dialog.close(); return; }
        var opening = !this.dialog.open;
        if (opening) {
            this.message.textContent = ''; this.gameMenu={};this.partyCommand=null;this.tab = state.scene === 'save' ? 'system' : 'status';
            this.dialog.showModal(); if (this.options && this.options.clearInput) this.options.clearInput(); else engine.buttons.clear();
            this.commandTab = this.lastCommandTab;
        }
        var actorId = Number(this.actorSelect.value);
        if (!state.party.includes(actorId)) actorId = state.party[0];
        this.actorSelect.replaceChildren();
        state.party.forEach(function (id) {
            var option = node('option', state.actor(id).name); option.value = id; ui.actorSelect.appendChild(option);
        });
        if (actorId) this.actorSelect.value = actorId;
        var gameplay = !!(this.options && this.options.gameplay);
        this.dialog.classList.toggle('fnh-file-menu',gameplay && this.tab==='system');
        this.dialog.classList.toggle('fnh-game-menu', gameplay);
        this.dialog.classList.toggle('fnh-menu-tabs',gameplay && this.tab!=='system');
        this.dialog.classList.toggle('fnh-menu-home', gameplay && this.tab === 'status');
        var selectActor = !gameplay;
        this.actorSelect.hidden = !selectActor;
        this.dialog.querySelector('label[for="fnh-menu-actor"]').hidden = !selectActor;
        var actor = actorId && state.actor(actorId), content = this.content;
        if(!gameplay || ['status','system'].includes(this.tab))content.replaceChildren();
        this.dialog.querySelectorAll('[data-menu-tab]').forEach(function (button) {
            var tab = button.dataset.menuTab, flag = {inventory:0,skills:1,equipment:2,status:3,system:5}[tab];
            if (gameplay) {
                var term = {inventory:4, equipment:6, skills:5, options:11, gameEnd:10}[tab];
                if (term != null) button.textContent = engine.database.System.terms.commands[term];
                else if (tab === 'synthesis') button.textContent = 'Synthesis';
                button.textContent = ui.options.settings.translate(button.textContent);
            }
            button.hidden = gameplay &&
                (state.scene === 'save' ? tab !== 'system' : tab === 'status' || flag != null && engine.database.System.menuCommands[flag] === false);
            button.disabled = ui.busy || ['inventory','skills','equipment','synthesis','status'].includes(tab) && !state.party.length;
            button.setAttribute('aria-pressed', String(button.dataset.menuTab === ui.tab));
            if (gameplay) {
                var iconIndex = {inventory:1,equipment:2,synthesis:3,skills:4,options:7,gameEnd:6}[tab];
                if (iconIndex != null) {
                    var label = button.textContent, icon = node('span'); icon.className = 'fnh-menu-command-icon';
                    icon.style.backgroundPosition = (iconIndex%16/15*100) + '% 0%';
                    var text = node('span',label); text.className = 'fnh-menu-command-label';
                    button.setAttribute('aria-label',label); button.title=label;button.replaceChildren(icon,text);
                }
            }
        });
        if (gameplay && this.tab !== 'system') {
            if (this.options.windowBackground) {
                this.options.windowBackground(this.dialog.querySelector('nav'),70,252);
                if(this.tab==='status')this.options.windowBackground(content,746,624);else content.style.backgroundImage='';
            }
            if (opening) this.focusCommand();
        } else {
            this.dialog.querySelector('nav').style.backgroundImage = ''; content.style.backgroundImage = '';
            if (opening && !(gameplay && this.tab==='system')) document.getElementById('fnh-menu-close').focus({preventScroll:true});
        }
        if(gameplay && !['status','system'].includes(this.tab)) {root.FNHStandaloneGameMenu.render(this,actorId);return;}
        if (!this.options || !this.options.gameplay) content.appendChild(node('p', 'Bạc: ' + state.gold));
        if (this.tab === 'status' && actor) {
            content.dataset.menuPage='status';
            var overview=node('div');overview.className='fnh-party-overview';
            state.party.forEach(function (id) {
                var member=state.actor(id),status=engine.menuActorStatus(id),card=node('section');card.dataset.partyActor=id;
                var choose=node('button',member.name);choose.className='fnh-party-name';choose.type='button';choose.setAttribute('aria-pressed',String(id===actorId));
                choose.onclick=function () {
                    ui.actorSelect.value=id;
                    if (ui.partyCommand) {ui.tab=ui.partyCommand;ui.partyCommand=null;ui.gameMenu={};ui.render();ui.enterContent();return;}
                    ui.render();
                    var selected=content.querySelector('[data-party-actor="'+id+'"] .fnh-party-name');
                    if(selected)selected.focus({preventScroll:true});
                };card.appendChild(choose);
                if(member.faceName) {
                    var bust=node('img');bust.className='fnh-menu-bust';bust.alt=member.name;
                    bust.src='./img/pictures/'+encodeURIComponent(member.faceName+'_'+(member.faceIndex+1))+'.png';card.appendChild(bust);
                }
                var nickname=node('p',member.nickname);nickname.className='fnh-party-nickname';card.appendChild(nickname);
                var icons=node('div');icons.className='fnh-menu-state-icons';icons.setAttribute('aria-label','Trạng thái '+member.name);
                status.stateIcons.forEach(function (state) {
                    var icon=node('span');icon.className='fnh-menu-state-icon';icon.dataset.state=state.id;
                    icon.title=state.name;icon.setAttribute('role','img');icon.setAttribute('aria-label',state.name);
                    icon.style.backgroundPosition=(-(state.iconIndex%16)*32)+'px '+(-Math.floor(state.iconIndex/16)*32)+'px';icons.appendChild(icon);
                });card.appendChild(icons);
                [['HP',member.hp,state.actorParam(id,0)],['MP',member.mp,state.actorParam(id,1)]].forEach(function (entry) {
                    var label=node('label',entry[0]+': '+entry[1]+'/'+entry[2]),bar=node('meter');
                    if (gameplay) label.textContent = ui.options.settings.translate(entry[0] === 'HP' ? 'Body' : 'Mind') + ' ' + entry[1];
                    label.className='fnh-party-'+entry[0].toLowerCase();
                    bar.min=0;bar.max=Math.max(1,entry[2]);bar.value=entry[1];bar.setAttribute('aria-label',entry[0]+' '+member.name);
                    label.appendChild(bar);card.appendChild(label);
                });
                var hunger=node('label',status.nextExp==null?'':ui.options.settings.translate('Hunger')+': '+status.nextExp),gauge=node('meter');
                hunger.className='fnh-party-hunger';
                gauge.min=0;gauge.max=1;gauge.value=status.hunger;gauge.dataset.hungerActor=id;gauge.setAttribute('aria-label','Hunger '+member.name);
                hunger.appendChild(gauge);card.appendChild(hunger);overview.appendChild(card);
            });
            content.appendChild(overview);
            if (gameplay) return;
            var details=engine.menuActorStatus(actorId);
            content.appendChild(node('h3', actor.name + ' · Lv ' + actor.level));
            content.appendChild(node('p',details.className+(actor.nickname?' · '+actor.nickname:'')));
            ['HP', 'MP', 'ATK', 'DEF', 'MAT', 'MDF', 'AGI', 'LUK'].forEach(function (name, index) {
                content.appendChild(node('p', name + ': ' + (index < 2 ? actor[index === 0 ? 'hp' : 'mp'] + '/' : '') + state.actorParam(actorId, index)));
            });
            content.appendChild(node('p', 'TP: ' + actor.tp));
            content.appendChild(node('p', actor.states.map(function (id) { return engine.database.States[id].name; }).join(', ') || 'Không có trạng thái bất lợi.'));
            content.appendChild(node('p','EXP: '+(details.nextExp==null?'—':details.exp)+' · Tới cấp tiếp: '+(details.nextExp==null?'—':details.nextExp)));
            content.appendChild(node('h4','Trang bị'));
            actor.equips.forEach(function (id,slot) {
                var item=(slot===0?engine.database.Weapons:engine.database.Armors)[id];
                content.appendChild(node('p',engine.database.System.equipTypes[slot+1]+': '+(item?item.name:'—')));
            });
            if(actor.profile) { var profile=node('p',root.FNHStandaloneText.formatText(actor.profile,state));profile.className='fnh-actor-profile';content.appendChild(profile); }
            content.appendChild(node('h4','Tỷ lệ nhận trạng thái'));
            var rates=node('dl');rates.className='fnh-state-rates';
            details.stateRates.forEach(function (entry) {
                rates.append(node('dt',engine.database.States[entry.id].name),node('dd',(entry.rate*100).toFixed(2)+'%'));
            });content.appendChild(rates);
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
            [['optimize','Tối ưu trang bị','optimizeMenuEquipment'],['clear','Tháo hết','clearMenuEquipment']].forEach(function (entry) {
                var button=node('button',entry[1]);button.type='button';button.dataset.equipmentAction=entry[0];button.disabled=ui.busy;
                button.onclick=function () { ui.act(function () { engine[entry[2]](actorId); }); };content.appendChild(button);
            });
            actor.equips.forEach(function (equipped, slot) {
                var table = engine.database[slot === 0 ? 'Weapons' : 'Armors'];
                var label = node('label', engine.database.System.equipTypes[slot + 1] + ': ');
                var select = node('select'); select.dataset.slot = slot;
                var empty = node('option', 'Tháo'); empty.value = 0; select.appendChild(empty);
                table.filter(function (item) { return item && (item.id === equipped || engine.canEquipMenuActor(actorId,slot,item.id)); }).forEach(function (item) {
                    var option = node('option', item.name); option.value = item.id; select.appendChild(option);
                });
                select.value = equipped; select.disabled = ui.busy || !engine.canChangeMenuEquipment(actorId,slot);
                select.onchange = function () { ui.act(function () {
                    if (!engine.equipMenuActor(actorId, slot, Number(select.value))) throw new Error('Không thể đổi trang bị này.');
                }); };
                label.appendChild(select); content.appendChild(label);
                if (equipped && table[equipped]) content.appendChild(node('p',table[equipped].description));
                if (!engine.canChangeMenuEquipment(actorId,slot)) content.appendChild(node('p','Ô trang bị bị khóa hoặc bị phong ấn.'));
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
            if (!this.options.gameplay) {
                var dashLabel = node('label', 'Luôn chạy nhanh '), dash = node('input'); dash.type = 'checkbox'; dash.checked = state.alwaysDash;
                dash.id = 'fnh-option-dash'; dash.onchange = function () {
                    state.alwaysDash = dash.checked; settings.alwaysDash = dash.checked;
                    try { settings.save(); ui.changed(); } catch (error) { ui.message.textContent = error.message; }
                };
                dashLabel.appendChild(dash); content.appendChild(dashLabel);
            }
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
        } else if (this.tab === 'gameEnd') {
            content.appendChild(node('p','Trở về màn tiêu đề?'));
            var title = node('button','Về tiêu đề'); title.type='button'; title.id='fnh-menu-to-title'; title.disabled=ui.busy;
            title.onclick=function () { ui.act(function () { engine.returnMenuToTitle(); }); };
            var cancel = node('button','Hủy'); cancel.type='button'; cancel.id='fnh-menu-end-cancel';
            cancel.onclick=function () { ui.tab='status';ui.render(); };
            content.append(title,cancel);
        } else if (this.tab === 'system') {
            if (gameplay) {
                renderSaveFiles(content,ui.saveStore,{engine:engine,settings:ui.options.settings,renderer:ui.options.renderer,windowBackground:ui.options.windowBackground,input:ui.options.input,mode:'save',selected:ui.saveSlot,focus:opening,
                    confirm:function (slot) {
                        if(ui.busy && !(engine.menuWaiters && engine.menuWaiters.size))return;
                        try {ui.saveSlot=slot;engine.saveMenuTo(ui.saveStore,slot);ui.close();}
                        catch(error){ui.message.textContent=error.message;}
                    }});return;
            }
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
            load.hidden = !!(this.options && this.options.gameplay);
            load.disabled = ui.busy || engine.eventRunning;
            load.onclick = function () { ui.act(async function () {
                if (!ui.saveStore.exists(ui.saveSlot)) throw new Error('Ô ' + ui.saveSlot + ' chưa có dữ liệu lưu.');
                ui.dialog.close();
                await engine.loadFrom(ui.saveStore, ui.saveSlot, ui.handlers);
            }); };
            content.append(save, load);
        }
    };
    root.FNHStandaloneMenu = { MenuUi: MenuUi, fillSaveSlots: fillSaveSlots, renderSaveFiles: renderSaveFiles };
}(typeof globalThis !== 'undefined' ? globalThis : this));
