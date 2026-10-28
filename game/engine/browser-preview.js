'use strict';

(function () {
    var query = new URLSearchParams(location.search);
    var titleFlow = query.get('title') === '1';
    var mapId = Number(query.get('map') || 74);
    var automaticEvents = titleFlow || query.get('events') === '1';
    document.body.classList.toggle('fnh-gameplay', automaticEvents);
    if (automaticEvents) document.querySelector('.fnh-stage').appendChild(document.getElementById('fnh-message'));
    var canvas = document.getElementById('fnh-canvas');
    var timer = document.getElementById('fnh-timer');
    var status = document.getElementById('fnh-status');
    var message = document.getElementById('fnh-message-text');
    var next = document.getElementById('fnh-next');
    var choicesPanel = document.getElementById('fnh-choices');
    var engine = new FNHStandaloneEngine.GameEngine({ baseUrl: '.', forceDashing: automaticEvents });
    var renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas, { baseUrl: '.' });
    var textColors = [];
    var saveStore = new FNHStandaloneSave.SaveStore({ prefix: 'FNH_STANDALONE_PREVIEW:' });
    var settings = new FNHStandaloneSettings.PlayerSettings({ key: 'FNH_STANDALONE_PREVIEW_SETTINGS' });
    var audio = new FNHStandaloneAudio.AudioManager({ baseUrl: '.', onError: function (error) { setStatus(error.message); } });
    engine.audio = audio;
    FNHStandaloneSettings.categories.forEach(function (category) { audio.setVolume(category, settings.volumes[category] / 100); });
    document.getElementById('fnh-volume').value = settings.volumes.master;
    document.getElementById('fnh-always-dash').closest('label').hidden = automaticEvents;
    var ready = false;
    var busy = false;
    var scheduler = null;
    var errors = [];
    var inputPulses = new Map();
    var heldPointers = new Map(), heldKeys = new Map(), pointerClicks = new WeakSet();
    var commonKeys = new Map(), commonBindings = { torch: 289, skill: 257 };
    var video = document.getElementById('fnh-video');
    video.volume = audio.masterVolume;
    var videoPlay = document.getElementById('fnh-video-play');
    var stopVideo = null;
    var uiTail = Promise.resolve();
    var scrollAnimation = null, scrollFastHeld = false, scrollNoFast = false, stopScrollText = null;

    // Cho phép xem trạng thái engine đang chạy trong công cụ phát triển.
    window.FNHStandalonePreview = { engine: engine, audio: audio, settings: settings, errors: errors };

    function setStatus(text) { status.textContent = text; }
    function renderTimer() {
        var state = engine.state, countdown = state && state.timer;
        timer.hidden = !countdown || !countdown.active || !['map', 'battle'].includes(state.scene);
        if (timer.hidden) return;
        var seconds = Math.floor(countdown.frames / 60);
        timer.textContent = String(Math.floor(seconds / 60) % 60).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    }
    function setRichText(element, text) {
        var nodes = [], color = null;
        FNHStandaloneText.formatParts(text, engine.state).forEach(function (part) {
            if (typeof part === 'string') {
                if (color === null) nodes.push(document.createTextNode(part));
                else {
                    var span = document.createElement('span');
                    span.style.color = textColors[color] || 'rgb(0, 0, 0)';
                    span.textContent = part;
                    nodes.push(span);
                }
                return;
            }
            if (part.color !== undefined) { color = part.color; return; }
            var icon = document.createElement('span');
            icon.className = 'fnh-text-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.style.backgroundPosition = -(part.icon % 16) * 32 + 'px ' + -Math.floor(part.icon / 16) * 32 + 'px';
            nodes.push(icon);
        });
        element.replaceChildren.apply(element, nodes);
    }
    var menuUi;
    var battleTarget = 0, battleActor = 0, battleFriend = 0, battleSkill = 2, battleItem = 0, battleKind = 'skill';
    var lastBattle = null, lastScene = null, lastBattlePhase = null, lastActionRevision = null;
    function formatResourceChanges(effect) {
        var subject = effect.subject === 'actor' ? engine.state.actor(effect.subjectId) : engine.battle.enemy(effect.subjectId);
        var changes = ['hp', 'mp', 'tp'].filter(function (key) { return effect[key]; }).map(function (key) {
            return key.toUpperCase() + ' ' + (effect[key] > 0 ? '+' : '') + effect[key];
        });
        (effect.removedStates || []).forEach(function (id) { changes.push(engine.database.States[id].name + ' đã hết'); });
        return subject.name + ': ' + changes.join(', ');
    }
    function tauntLabel(battler) {
        return battler.alive && !battler.hidden && [0, 1, 2].some(function (hitType) { return engine.battle.hasTaunt(battler, hitType); }) ? ' · Khiêu khích' : '';
    }
    function confusionLabel(battler) {
        var level = engine.battle.confusionLevel(battler);
        return level ? ' · Rối loạn: tự đánh ' + ['', 'địch', 'một trong hai phe', 'đồng đội'][level] : '';
    }
    function autoBattleLabel(battler) {
        return battler.alive && engine.battle.isAutoBattle(battler) && !engine.battle.confusionLevel(battler) ? ' · Tự chiến đấu' : '';
    }
    function renderBattleUi() {
        var panel = document.getElementById('fnh-battle'), battle = engine.battle && engine.battle.battle;
        if (battle !== lastBattle) { battleKind = 'skill'; battleActor = 0; }
        lastBattle = battle; lastScene = engine.state.scene;
        lastBattlePhase = battle && battle.phase;
        lastActionRevision = battle && battle.actionRevision;
        if (!battle || engine.state.scene !== 'battle' || battle.result) { panel.hidden = true; return; }
        panel.hidden = false;
        document.getElementById('fnh-battle-round').textContent = 'Lượt ' + battle.turn + (battle.extraTurn ? ' · Lượt bổ sung' : '');
        document.getElementById('fnh-extra-turn').hidden = !battle.extraTurn;
        if (!battle.enemies.some(function (enemy) { return enemy.index === battleTarget && enemy.alive && !enemy.hidden; })) {
            var target = engine.battle.aliveEnemies()[0];
            battleTarget = target ? target.index : -1;
        }
        var targets = document.getElementById('fnh-battle-targets'); targets.replaceChildren();
        battle.enemies.forEach(function (enemy) {
            if (enemy.hidden) return;
            var button = document.createElement('button'); button.type = 'button'; button.textContent = enemy.name + ' · ' + enemy.hp + '/' + enemy.mhp + tauntLabel(enemy) + confusionLabel(enemy);
            button.disabled = !enemy.alive; button.dataset.index = enemy.index;
            if (enemy.index === battleTarget) button.setAttribute('aria-pressed', 'true');
            button.onclick = function () { battleTarget = enemy.index; renderBattleUi(); };
            targets.appendChild(button);
        });
        document.getElementById('fnh-battle-title').textContent = battle.result || ('Lượt ' + (battle.turn + 1));
        document.getElementById('fnh-battle-party').textContent = battle.actors.map(function (actor) {
            return actor.name + ' · HP ' + actor.hp + ' · MP ' + actor.mp + tauntLabel(actor) + confusionLabel(actor) + autoBattleLabel(actor);
        }).join(' | ');
        var actors = document.getElementById('fnh-battle-actor'); actors.replaceChildren();
        if (!engine.battle.inputActors().some(function (actor) { return actor.id === battleActor; })) {
            var leader = engine.battle.inputActors()[0]; battleActor = leader ? leader.id : 0;
        }
        battle.actors.forEach(function (actor) {
            var option = document.createElement('option'); option.value = actor.id; option.textContent = actor.name;
            option.disabled = !engine.battle.inputActors().some(function (entry) { return entry.id === actor.id; }); actors.appendChild(option);
        });
        actors.value = battleActor; actors.disabled = battle.phase !== 'input';
        var skills = document.getElementById('fnh-battle-skill'); skills.replaceChildren();
        var learned = battleActor ? [engine.database.Skills[2]].concat(engine.battle.actorSkills(battleActor)).filter(function (skill, index, list) {
            return skill && skill.id !== 1 && list.findIndex(function (entry) { return entry.id === skill.id; }) === index;
        }) : [];
        if (!learned.some(function (skill) { return skill.id === battleSkill; })) battleSkill = 2;
        learned.forEach(function (skill) {
            var option = document.createElement('option'); option.value = skill.id;
            option.textContent = skill.name + ' · MP ' + skill.mpCost + ' · TP ' + skill.tpCost;
            option.disabled = !engine.battle.canUseSkill(engine.battle.actor(battleActor), skill); skills.appendChild(option);
        });
        skills.value = battleSkill; skills.disabled = battle.phase !== 'input';
        var kind = document.getElementById('fnh-battle-kind'); kind.value = battleKind; kind.disabled = battle.phase !== 'input';
        document.getElementById('fnh-battle-skill-controls').hidden = battleKind !== 'skill';
        document.getElementById('fnh-battle-item-controls').hidden = battleKind !== 'item';
        var items = engine.database.Items.filter(function (item) { return item && [0, 1].includes(item.occasion) && engine.state.itemCount('items', item.id) > 0; });
        if (!items.some(function (item) { return item.id === battleItem; })) battleItem = items.length ? items[0].id : 0;
        var itemSelect = document.getElementById('fnh-battle-item'); itemSelect.replaceChildren();
        items.forEach(function (item) {
            var option = document.createElement('option'); option.value = item.id;
            option.textContent = item.name + ' × ' + engine.state.itemCount('items', item.id);
            option.disabled = !engine.battle.canUseItem(engine.battle.actor(battleActor), item); itemSelect.appendChild(option);
        });
        itemSelect.value = battleItem; itemSelect.disabled = battle.phase !== 'input';
        document.getElementById('fnh-battle-use-item').disabled = battle.phase !== 'input' || !engine.battle.canUseItem(engine.battle.actor(battleActor), engine.database.Items[battleItem]);
        var selected = battleKind === 'item' ? engine.database.Items[battleItem] : engine.database.Skills[battleSkill], friends = document.getElementById('fnh-battle-friends');
        friends.replaceChildren(); friends.hidden = !selected || ![7, 9].includes(selected.scope);
        battle.actors.forEach(function (actor, index) {
            var button = document.createElement('button'); button.type = 'button'; button.textContent = actor.name + ' · HP ' + actor.hp;
            button.dataset.index = index; button.setAttribute('aria-pressed', String(index === battleFriend));
            button.disabled = selected && selected.scope === 9 ? actor.alive : !actor.alive;
            button.onclick = function () { battleFriend = index; renderBattleUi(); }; friends.appendChild(button);
        });
        document.getElementById('fnh-battle-use-skill').disabled = battle.phase !== 'input' || !battleActor || !engine.battle.canUseSkill(engine.battle.actor(battleActor), engine.database.Skills[battleSkill]);
        var queued = battle.inputActions || [], queuePanel = document.getElementById('fnh-battle-queue');
        queuePanel.replaceChildren();
        var summary = document.createElement('p');
        summary.textContent = 'Đã chọn ' + queued.length + '/' + engine.battle.inputActors().length + ' nhân vật'; queuePanel.appendChild(summary);
        queued.forEach(function (action) {
            var data = (action.kind === 'item' ? engine.database.Items : engine.database.Skills)[action.id];
            var subject = engine.state.actor(action.actorId), row = document.createElement('p');
            var target = data.scope === 1 ? engine.battle.enemy(action.targetIndex) : data.scope === 7 || data.scope === 9 ? battle.actors[action.targetIndex] : null;
            row.textContent = subject.name + ': ' + data.name + (target ? ' → ' + target.name : '');
            var remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Bỏ chọn'; remove.dataset.actor = action.actorId;
            remove.disabled = battle.phase !== 'input';
            remove.onclick = function () { engine.removeBattleAction(action.actorId); battleActor = action.actorId; renderBattleUi(); };
            row.appendChild(remove); queuePanel.appendChild(row);
        });
        var start = document.getElementById('fnh-battle-start');
        start.textContent = battle.extraTurn ? 'Bắt đầu lượt bổ sung' : 'Bắt đầu lượt';
        try { engine.validateBattleActions(queued, true); start.disabled = false; }
        catch (_) { start.disabled = true; }
        var lastAction = battle.lastAction;
        document.getElementById('fnh-battle-log').textContent = lastAction ? (lastAction.confusion ? 'Rối loạn · ' : lastAction.autoBattle ? 'Tự chiến đấu · ' : '') + engine.battle.actionData(lastAction).name +
            ' · ' + lastAction.hits.map(function (hit) {
                var text = hit.missed ? 'Trượt' : hit.evaded ? 'Né' : String(hit.damage);
                if (hit.substituteFor) {
                    var protector = hit.targetType === 'enemy' ? engine.battle.enemy(hit.target) : engine.battle.actor(hit.target);
                    text = 'Thế thân ' + (protector ? protector.name : hit.target) + ': ' + text;
                }
                if (hit.reflectedBy) {
                    var reflector = hit.reflectedBy.type === 'enemy' ? engine.battle.enemy(hit.reflectedBy.id) : engine.battle.actor(hit.reflectedBy.id);
                    text = 'Phản phép ' + (reflector ? reflector.name : hit.reflectedBy.id) + ': ' + text;
                }
                if (hit.counter) text += ' → Phản đòn: ' + hit.counter.hits.map(function (reply) {
                    return reply.missed ? 'Trượt' : reply.evaded ? 'Né' : String(reply.damage);
                }).join(', ');
                return text;
            }).join(', ') : '';
        if (battle.escapeFailed) document.getElementById('fnh-battle-log').textContent = 'Không thể chạy thoát. ' + document.getElementById('fnh-battle-log').textContent;
        var turnEffects = (battle.turnEffects || []).map(formatResourceChanges);
        if (turnEffects.length) document.getElementById('fnh-battle-log').textContent += ' · Cuối lượt: ' + turnEffects.join(' | ');
        document.getElementById('fnh-battle-attack').disabled = battle.phase !== 'input' || !battleActor || !engine.battle.canUseSkill(engine.battle.actor(battleActor), engine.battle.skillFor(engine.battle.actor(battleActor), 1));
        document.getElementById('fnh-battle-escape').disabled = !battle.canEscape || battle.phase !== 'input';
    }
    var endScene = null;
    function presentationInput() {
        return titleFlow && engine.state && (engine.state.scene === 'title' || engine.state.mapId === 72 && engine.state.scene === 'map');
    }
    function syncBattleAudio() {
        var battle = engine.battle.battle;
        // Kết quả có trước fade đóng; chỉ phát lại nhạc map khi thực sự rời scene.
        if (engine.state.scene === 'battle' && battle && !battle.result) {
            if (battle.audio && battle.audio.pending) return;
            audio.beginBattle(battle, engine.state, engine.database.System);
            battle.audio.bgm = audio.snapshot('bgm'); battle.audio.bgs = audio.snapshot('bgs');
        } else if (audio.battle && engine.state.scene !== 'battle') audio.endBattle(audio.battle.result || 'abort', engine.database.System, engine.state.scene === 'map');
    }
    function renderEndScreen() {
        var scene = engine.state.scene, panel = document.getElementById('fnh-end-screen');
        ['fnh-controls', 'fnh-menu', 'fnh-save', 'fnh-load'].forEach(function (id) {
            document.getElementById(id).hidden = presentationInput() || automaticEvents && ['fnh-save','fnh-load'].includes(id);
        });
        var visible = scene === 'gameover' || scene === 'title';
        panel.hidden = !visible;
        if (!visible) { endScene = null; return; }
        if (endScene === scene) return;
        endScene = scene;
        panel.dataset.scene = scene;
        document.getElementById('fnh-title-frame').hidden = scene !== 'title';
        document.getElementById('fnh-end-save-panel').hidden = true;
        document.getElementById('fnh-end-actions').hidden = false;
        var slots = document.getElementById('fnh-end-save-slot');
        FNHStandaloneMenu.fillSaveSlots(slots, saveStore, Number(slots.value) || 1);
        document.getElementById('fnh-end-load').textContent = 'Tải ô ' + slots.value;
        var system = engine.database.System;
        document.getElementById('fnh-new-game').textContent = system.terms.commands[18];
        var continueButton = document.getElementById('fnh-continue');
        continueButton.textContent = system.terms.commands[19];
        continueButton.disabled = scene === 'title' && !Array.from({ length: 20 }, function (_, index) { return index + 1; }).some(function (slot) { return saveStore.exists(slot); });
        document.getElementById('fnh-new-game').dataset.selected = String(continueButton.disabled || scene !== 'title');
        continueButton.dataset.selected = String(!continueButton.disabled && scene === 'title');
        var background = document.getElementById('fnh-end-background');
        var overlay = document.getElementById('fnh-end-overlay');
        var title = document.getElementById('fnh-end-title');
        title.textContent = scene === 'gameover' ? 'Game Over' : system.gameTitle;
        title.hidden = scene === 'title' && !system.optDrawTitle;
        var first = scene === 'gameover' ? './img/system/GameOver.png' :
            system.title1Name ? './img/titles1/' + encodeURIComponent(system.title1Name) + '.png' : null;
        background.hidden = !first;
        if (first) background.src = first; else background.removeAttribute('src');
        overlay.hidden = scene !== 'title' || !system.title2Name;
        if (!overlay.hidden) overlay.src = './img/titles2/' + encodeURIComponent(system.title2Name) + '.png';
        else overlay.removeAttribute('src');
        audio.stop('bgm'); audio.stop('bgs'); audio.stop('me');
        if (scene === 'title') audio.play('bgm', system.titleBgm);
        else if (system.gameoverMe.name) audio.play('me', system.gameoverMe);
        panel.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        document.getElementById(scene === 'title' && !continueButton.disabled ? 'fnh-continue' : 'fnh-new-game').focus({ preventScroll: true });
    }
    async function draw() {
        syncBattleAudio();
        renderTimer();
        await renderer.draw(engine);
        renderBattleUi();
        renderEndScreen();
        if (menuUi) menuUi.render();
        document.getElementById('fnh-always-dash').checked = engine.state.alwaysDash;
        var walkEffects = engine.state.scene === 'map' ? engine.state.walkEffects.map(formatResourceChanges) : [];
        setStatus('Map ' + engine.state.mapId + ' · ô ' + engine.state.x + ',' + engine.state.y + ' · Mũi tên: di chuyển · Enter: tương tác' +
            (walkEffects.length ? ' · ' + walkEffects.join(' | ') : ''));
    }
    async function perform(action) {
        if (!ready || busy) return;
        busy = true;
        try { await action(); }
        catch (error) { setStatus(error.message); }
        finally { busy = false; }
    }
    function queueUi(show, interpreter) {
        var result = uiTail.then(function () {
            if (interpreter && interpreter.signal && interpreter.signal.aborted) throw interpreter.signal.reason;
            return show();
        });
        uiTail = result.catch(function () {});
        return result;
    }
    function showMessage(text, parameters, interpreter, options) {
        return queueUi(function () {
            if (engine.state.scene === 'battle') renderBattleUi();
            setRichText(message, engine.state.wordWrap ? text.replace(/\n/g, ' ') : text);
            if (options && options.choicesFollow) { next.hidden = true; return; }
            return messageDialog(text, interpreter);
        }, interpreter);
    }
    function messageDialog(text, interpreter) {
        engine.messageRunning = true;
        setRichText(message, engine.state.wordWrap ? text.replace(/\n/g, ' ') : text);
        next.hidden = false;
        next.focus({ preventScroll: true });
        return new Promise(function (resolve, reject) {
            var signal = interpreter && interpreter.signal;
            function close() {
                engine.messageRunning = false;
                next.hidden = true;
                next.onclick = null;
                if (signal) signal.removeEventListener('abort', abort);
                canvas.focus({ preventScroll: true });
            }
            function abort() { close(); reject(signal.reason); }
            next.onclick = function () { close(); resolve(); };
            if (signal) signal.addEventListener('abort', abort, { once: true });
        });
    }
    function showChoices(choices, cancelType, interpreter, details) {
        return queueUi(function () { return choiceDialog(choices, cancelType, interpreter, details); }, interpreter);
    }
    function choiceDialog(choices, cancelType, interpreter, details) {
        engine.messageRunning = true;
        return new Promise(function (resolve, reject) {
            var signal = interpreter && interpreter.signal;
            details = details || { disabled: [], help: [], message: [], defaultIndex: 0 };
            var help = document.getElementById('fnh-choice-help');
            choicesPanel.replaceChildren();
            function close() {
                engine.messageRunning = false;
                choicesPanel.onkeydown = null;
                choicesPanel.replaceChildren();
                help.textContent = '';
                if (signal) signal.removeEventListener('abort', abort);
                canvas.focus({ preventScroll: true });
            }
            function abort() { close(); reject(signal.reason); }
            function addChoice(label, index) {
                var button = document.createElement('button');
                button.type = 'button';
                setRichText(button, label);
                button.disabled = details.disabled.includes(index);
                button.onfocus = button.onmouseenter = function () {
                    setRichText(help, details.help[index] || '');
                    if (details.message[index]) setRichText(message, details.message[index]);
                };
                button.onclick = function () {
                    close();
                    resolve(index);
                };
                choicesPanel.appendChild(button);
            }
            choices.forEach(addChoice);
            if (cancelType !== -1) addChoice('Quay lại', cancelType >= 0 ? cancelType : -1);
            choicesPanel.onkeydown = function (event) {
                var action = inputName(event.key);
                if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
                    var buttons = Array.from(choicesPanel.querySelectorAll('button:enabled'));
                    var current = buttons.indexOf(document.activeElement);
                    var step = action === 'up' || action === 'left' ? -1 : 1;
                    if (buttons.length) buttons[(current + step + buttons.length) % buttons.length].focus();
                } else if (action === 'ok') {
                    if (!event.repeat && document.activeElement && !document.activeElement.disabled) document.activeElement.click();
                } else if (action === 'cancel') {
                    if (!event.repeat && cancelType !== -1) choicesPanel.lastElementChild.click();
                } else return;
                event.preventDefault();
                event.stopPropagation();
            };
            var focused = choicesPanel.children[details.defaultIndex];
            if (!focused || focused.disabled) focused = choicesPanel.querySelector('button:enabled');
            if (focused) focused.focus({ preventScroll: true });
            if (signal) signal.addEventListener('abort', abort, { once: true });
        });
    }
    function showName(parameters, interpreter) {
        return queueUi(function () { return nameDialog(parameters, interpreter); }, interpreter);
    }
    function nameDialog(parameters, interpreter) {
        var actor = engine.state.actor(parameters[0]);
        if (!actor) throw new Error('Không tìm thấy nhân vật ' + parameters[0]);
        engine.messageRunning = true;
        var dialog = document.getElementById('fnh-name-dialog');
        var form = document.getElementById('fnh-name-form');
        var input = document.getElementById('fnh-name-input');
        var signal = interpreter && interpreter.signal;
        input.value = Array.from(actor.name).slice(0, parameters[1]).join('');
        input.maxLength = parameters[1];
        var defaultName = input.value, page = 0, selected = 0;
        var grid = document.getElementById('fnh-name-grid'), slots = document.getElementById('fnh-name-slots');
        var nameMeasure = document.createElement('canvas').getContext('2d'); nameMeasure.font = '28px GameFont';
        var charWidth = nameMeasure.measureText('A').width;
        slots.style.left = (18 + Math.min(294 - (parameters[1] + 1) * charWidth / 2, 444 - (parameters[1] + 1) * charWidth)) / 480 * 100 + '%';
        slots.style.width = parameters[1] * charWidth / 480 * 100 + '%';
        slots.style.right = 'auto';
        var face = document.getElementById('fnh-name-face');
        face.setAttribute('aria-label', actor.name);
        face.style.backgroundImage = actor.faceName ? 'url("./img/faces/' + encodeURIComponent(actor.faceName) + '.png")' : 'none';
        face.style.backgroundPosition = (actor.faceIndex % 4 * 100 / 3) + '% ' + Math.floor(actor.faceIndex / 4) * 100 + '%';
        var tables = [
            ['ABCDEabcde','FGHIJfghij','KLMNOklmno','PQRSTpqrst','UVWXYuvwxy','Z[]^_z{}|~','01234!#$%&','56789()*+-','/=@<>:; '],
            ['ÁÉÍÓÚáéíóú','ÀÈÌÒÙàèìòù','ÂÊÎÔÛâêîôû','ÄËÏÖÜäëïöü','ĀĒĪŌŪāēīōū','ÃÅÆÇÐãåæçð','ÑÕØŠŴñõøšŵ','ÝŶŸŽÞýÿŷžþ','ĲŒĳœß«» ']
        ].map(function (rows) { return Array.from(rows.join('')).concat(['Page', 'OK']); });
        function updateName() {
            var letters = Array.from(input.value).slice(0, parameters[1]);
            input.value = letters.join(''); slots.replaceChildren();
            for (var i = 0; i < parameters[1]; i++) {
                var cell = document.createElement('span'); cell.textContent = letters[i] || '';
                cell.dataset.cursor = String(i === letters.length); slots.appendChild(cell);
            }
        }
        function renderKeys(focus) {
            grid.replaceChildren();
            tables[page].forEach(function (letter, index) {
                var key = document.createElement('button'); key.type = 'button'; key.textContent = letter;
                if (index >= 88) {
                    key.textContent = ''; var caption = document.createElement('span'); caption.textContent = letter;
                    caption.style.display = 'block'; caption.style.transform = 'scaleX(' + Math.min(1, 36 / nameMeasure.measureText(letter).width) + ')'; key.appendChild(caption);
                }
                key.dataset.selected = String(index === selected);
                key.setAttribute('aria-label', letter === ' ' ? 'Space' : letter);
                key.style.left = ((index % 10 * 42 + Math.floor(index % 10 / 5) * 24) / 444 * 100) + '%';
                key.style.top = (Math.floor(index / 10) / 9 * 100) + '%';
                key.onfocus = function () {
                    selected = index;
                    Array.from(grid.children).forEach(function (other) { other.dataset.selected = String(other === key); });
                };
                key.onclick = function () {
                    selected = index;
                    if (index === 88) { page = 1 - page; renderKeys(true); }
                    else if (index === 89) form.requestSubmit();
                    else if (Array.from(input.value).length < parameters[1]) { input.value += letter; updateName(); }
                };
                grid.appendChild(key);
            });
            if (focus) grid.children[selected].focus({ preventScroll: true });
        }
        updateName(); renderKeys(false);
        engine.buttons.clear();
        dialog.showModal();
        input.focus(); input.select();
        return new Promise(function (resolve, reject) {
            function close() {
                engine.messageRunning = false;
                form.onsubmit = null; dialog.oncancel = null;
                input.oninput = null; dialog.onkeydown = null; grid.replaceChildren();
                if (signal) signal.removeEventListener('abort', abort);
                dialog.close(); canvas.focus({ preventScroll: true });
            }
            function abort() { close(); reject(signal.reason); }
            input.oninput = updateName;
            dialog.onkeydown = function (event) {
                event.stopPropagation();
                var key = event.key;
                if (key === 'Escape' || key === 'Backspace' && event.target !== input) {
                    input.value = Array.from(input.value).slice(0, -1).join(''); updateName();
                } else if (key === 'PageUp' || key === 'PageDown') { page = 1 - page; renderKeys(true); }
                else if (key.startsWith('Arrow')) {
                    var row = Math.floor(selected / 10), column = selected % 10;
                    if (key === 'ArrowDown') row = (row + 1) % 9;
                    if (key === 'ArrowUp') row = (row + 8) % 9;
                    if (key === 'ArrowLeft') column = (column + 9) % 10;
                    if (key === 'ArrowRight') column = (column + 1) % 10;
                    selected = row * 10 + column; grid.children[selected].focus({ preventScroll: true });
                } else if (key === 'Enter') {
                    if (!event.repeat) {
                        if (event.target === input) { selected = 89; grid.children[selected].focus({ preventScroll: true }); }
                        else grid.children[selected].click();
                    }
                } else if (key.length === 1 && event.target !== input && !event.ctrlKey && !event.metaKey) {
                    if (Array.from(input.value).length < parameters[1]) { input.value += key; updateName(); }
                } else return;
                event.preventDefault();
            };
            dialog.oncancel = function (event) { event.preventDefault(); };
            form.onsubmit = function (event) {
                event.preventDefault();
                var name = Array.from(input.value.trim()).slice(0, parameters[1]).join('');
                if (!name) { input.value = defaultName; updateName(); return; }
                engine.state.setActorName(parameters[0], name); close(); resolve();
            };
            if (signal) {
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) abort();
            }
        });
    }
    function playVideo(name, interpreter) {
        if (stopVideo) stopVideo();
        if (!name) return true;
        engine.buttons.clear();
        video.src = './movies/' + encodeURIComponent(name) + '.webm';
        video.volume = audio.masterVolume;
        video.hidden = false;
        return new Promise(function (resolve, reject) {
            var signal = interpreter && interpreter.signal;
            var finished = false;
            function finish(error) {
                if (finished) return;
                finished = true;
                video.onended = null; video.onerror = null; videoPlay.onclick = null;
                if (signal) signal.removeEventListener('abort', abort);
                stopVideo = null; video.pause(); video.removeAttribute('src'); video.load();
                video.hidden = true; videoPlay.hidden = true;
                canvas.focus({ preventScroll: true });
                if (error) reject(error); else resolve();
            }
            function abort() { finish(signal.reason); }
            function play() {
                video.play().then(function () { videoPlay.hidden = true; }).catch(function (error) {
                    if (error.name === 'NotAllowedError') videoPlay.hidden = false;
                    else finish(error);
                });
            }
            stopVideo = function () { finish(); };
            video.onended = function () { finish(); };
            video.onerror = function () { finish(new Error('Không phát được video ' + name)); };
            videoPlay.onclick = play;
            if (signal) {
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) { abort(); return; }
            }
            play();
        });
    }
    function showScrollingText(text, parameters, interpreter) {
        return queueUi(function () {
            var panel = document.getElementById('fnh-scroll-text');
            var content = document.getElementById('fnh-scroll-content');
            var fast = document.getElementById('fnh-scroll-fast');
            var signal = interpreter && interpreter.signal;
            setRichText(content, text);
            engine.messageRunning = true; engine.buttons.clear();
            scrollNoFast = parameters[1] === true; scrollFastHeld = false;
            fast.hidden = scrollNoFast; panel.hidden = false;
            panel.scrollIntoView({ block: 'nearest', behavior: 'instant' }); panel.focus({ preventScroll: true });
            var height = panel.clientHeight, contentHeight = content.scrollHeight;
            scrollAnimation = content.animate([
                { transform: 'translateY(' + height + 'px)' },
                { transform: 'translateY(-' + contentHeight + 'px)' }
            ], { duration: (height + contentHeight) / (parameters[0] / 2) * 1000 / 60, easing: 'linear', fill: 'forwards' });
            return new Promise(function (resolve, reject) {
                var animation = scrollAnimation, finished = false;
                function finish(error) {
                    if (finished) return;
                    finished = true;
                    if (signal) signal.removeEventListener('abort', abort);
                    fast.onpointerdown = fast.onpointerup = fast.onpointercancel = fast.onpointerleave = null;
                    scrollAnimation = null; scrollFastHeld = false; stopScrollText = null;
                    animation.cancel(); panel.hidden = true; content.textContent = '';
                    engine.messageRunning = false; engine.buttons.clear(); canvas.focus({ preventScroll: true });
                    if (error) reject(error); else resolve();
                }
                function abort() { finish(signal.reason); }
                fast.onpointerdown = function (event) { event.preventDefault(); scrollFastHeld = true; };
                fast.onpointerup = fast.onpointercancel = fast.onpointerleave = function () { scrollFastHeld = false; };
                animation.finished.then(function () { finish(); }, function (error) { finish(error); });
                stopScrollText = function () { finish(new DOMException('Đã dừng chữ chạy.', 'AbortError')); };
                if (signal) {
                    signal.addEventListener('abort', abort, { once: true });
                    if (signal.aborted) abort();
                }
            });
        }, interpreter);
    }
    var battleFade = null, encounterAnimations = [];
    async function encounterBattle(battle,signal) {
        var encounter=document.getElementById('fnh-battle-encounter'),shot=encounter.querySelector('canvas');
        var flash=document.getElementById('fnh-battle-flash'),black=document.getElementById('fnh-battle-fade');
        var snapshot=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas'),{hideCharacters:true});
        snapshot.images=renderer.images;await snapshot.drawMap(engine,++snapshot.frame);
        if(signal && signal.aborted)throw signal.reason;
        shot.getContext('2d').drawImage(snapshot.canvas,0,0);encounter.hidden=false;flash.hidden=false;black.hidden=false;black.style.opacity='0';
        renderer.battleSnapshotFor=battle;renderer.battleSnapshot=Promise.resolve(snapshot.canvas);
        var interpreter=engine.createInterpreter([],0),data=interpreter.handlers.gameData;
        var x=data(5,-1,3,interpreter),y=data(5,-1,4,interpreter)-24;
        shot.style.transformOrigin=(x/816*100)+'% '+(y/624*100)+'%';
        var zoom=[];
        for(var frame=0;frame<=60;frame++){
            var p=frame/60,q=((p-1)*20*p+5)*p+1;
            zoom.push({offset:p,transform:'scale('+q+')'});
        }
        var timing={duration:1000,easing:'linear',fill:'forwards'};
        var animations=encounterAnimations=[shot.animate(zoom,timing),flash.animate([
            {offset:0,opacity:0},{offset:1.999/60,opacity:0},{offset:2/60,opacity:1},
            {offset:9.999/60,opacity:22/30},{offset:10/60,opacity:1},{offset:40/60,opacity:0},{offset:1,opacity:0}
        ],timing),black.animate([{offset:0,opacity:0},{offset:0.5,opacity:0},{offset:0.9,opacity:1},{offset:1,opacity:1}],timing)];
        var music=shot.animate([{opacity:1},{opacity:1}],{duration:500});animations.push(music);
        var complete=Promise.all(animations.map(function(animation){return animation.finished;}));
        complete.catch(function(){});
        function abort(){animations.forEach(function(animation){animation.cancel();});}
        if(signal)signal.addEventListener('abort',abort,{once:true});
        try{
            await music.finished;
            if(signal && signal.aborted)throw signal.reason;
            audio.beginBattle(battle,engine.state,engine.database.System);
            await complete;
        }catch(error){if(signal && signal.aborted)throw signal.reason;throw error;}
        finally{
            if(signal)signal.removeEventListener('abort',abort);
            animations.forEach(function(animation){animation.cancel();});
            if(encounterAnimations===animations)encounterAnimations=[];
            encounter.hidden=true;flash.hidden=true;black.style.opacity='1';
        }
    }
    async function transitionBattle(phase,battle,signal) {
        var panel = document.getElementById('fnh-battle-fade');
        if (phase === 'cancel') {
            if (battleFade) battleFade.cancel();
            encounterAnimations.forEach(function(animation){animation.cancel();});encounterAnimations=[];
            document.getElementById('fnh-battle-encounter').hidden=true;document.getElementById('fnh-battle-flash').hidden=true;
            battleFade = null; panel.hidden = true; return;
        }
        clearInput();
        if (signal && signal.aborted) throw signal.reason;
        if(phase==='start')await encounterBattle(battle,signal);
        panel.hidden = false; panel.style.opacity = phase === 'out' ? '0' : '1';
        await draw();
        if (signal && signal.aborted) throw signal.reason;
        var frames = (phase === 'out' && battle.result === 'defeat' || phase === 'in' && engine.state.scene === 'gameover') ? 48 : 24;
        var animation = battleFade = panel.animate([{opacity:phase === 'out'?0:1},{opacity:phase === 'out'?1:0}],
            {duration:frames*1000/60,easing:'linear',fill:'forwards'});
        function abort() { animation.cancel(); }
        if (signal) signal.addEventListener('abort',abort,{once:true});
        try { await animation.finished; }
        catch (error) { if (signal && signal.aborted) throw signal.reason; throw error; }
        finally {
            if (signal) signal.removeEventListener('abort',abort);
            if (battleFade === animation) { panel.style.opacity=phase === 'out'?'1':'0';animation.cancel();battleFade=null; }
        }
        if (phase !== 'out') panel.hidden=true;
    }
    var eventHandlers = {
        battleTransition: transitionBattle,
        battleAudio: function (phase, battle) {
            if (phase === 'start') {
                audio.beginBattle(battle, engine.state, engine.database.System,true);
                var sound=engine.database.System.sounds[7];if(sound && sound.name)audio.play('se',sound);
            }
            else audio.endBattle(battle.result || 'abort', engine.database.System, engine.state.scene === 'map');
        },
        message: showMessage,
        choice: showChoices,
        scrollText: showScrollingText,
        effect: async function (code, parameters, command, interpreter) {
            if (audio.handleEffect(code, parameters)) return;
            if (code === 303) return showName(parameters, interpreter);
            if (code === 261) return playVideo(parameters[0], interpreter);
            if (code === 230) {
                await new Promise(function (resolve) { setTimeout(resolve, parameters[0] * 1000 / 60); });
                return;
            }
            return false;
        }
    };
    engine.onRouteEffect = eventHandlers.effect;
    function updateVolume(category, value) {
        settings.setVolume(category, value); audio.setVolume(category, settings.volumes[category] / 100);
        video.volume = audio.masterVolume; document.getElementById('fnh-volume').value = settings.volumes.master;
    }
    menuUi = new FNHStandaloneMenu.MenuUi(engine, saveStore, eventHandlers, draw, {
        settings: settings, updateVolume: updateVolume, gameplay: automaticEvents,
        clearInput: clearInput
    });
    var previousFrame = performance.now(), drawing = false, screenRevision = -1, lightingRevision = -1, filterRevision = -1, animationRevision = -1;
    function animate(now) {
        var frames = Math.min(6, Math.max(0, (now - previousFrame) * 60 / 1000));
        previousFrame = now;
        if (ready) {
            try {
                syncBattleAudio();
                if (scrollAnimation) scrollAnimation.playbackRate = !scrollNoFast &&
                    (scrollFastHeld || engine.buttons.has('ok') || engine.buttons.has('cancel') || engine.buttons.has('shift')) ? 3 : 1;
                var sceneChanged = lastBattle !== engine.battle.battle || lastScene !== engine.state.scene ||
                    lastBattlePhase !== (engine.battle.battle && engine.battle.battle.phase) ||
                    lastActionRevision !== (engine.battle.battle && engine.battle.battle.actionRevision);
                if (sceneChanged) { renderBattleUi(); renderEndScreen(); menuUi.render(); }
                if (scheduler) scheduler.tick();
                commonKeys.forEach(function (held, key) {
                    held.remaining -= frames;
                    if (held.remaining > 0 || busy || engine.eventRunning || engine.messageRunning || engine.state.scene !== 'map') return;
                    held.remaining = 6;
                    perform(async function () { await engine.runCommonEvent(commonBindings[key], eventHandlers); await draw(); });
                });
                var active = engine.state.scene === 'battle' || sceneChanged || !!scheduler || engine.autonomousEnabled || screenRevision !== engine.screen.revision || engine.screen.active() ||
                    lightingRevision !== engine.lighting.revision || engine.lighting.active(engine.map) || engine.movement.jobs.size > 0 || [engine.state].concat(engine.map.events, engine.state.followers()).some(function (character) {
                    return character.stepAnime || character.moveFrames > 0 || (character.balloon && character.balloon.remaining > 0);
                });
                active = active || filterRevision !== engine.filters.revision || engine.filters.active();
                active = active || engine.animations.entries.length > 0 || animationRevision !== engine.animations.revision ||
                    !!(engine.state.regionCover && engine.state.regionCover.enabled);
                engine.advanceRoutes(frames);
                renderTimer();
                var heldDirection = engine.buttons.has('down') ? 2 : engine.buttons.has('left') ? 4 :
                    engine.buttons.has('right') ? 6 : engine.buttons.has('up') ? 8 : 0;
                if (heldDirection && !pictureInput() && !engine.messageRunning && !engine.eventRunning &&
                    !(engine.state.moveFrames > 0) && !engine.movement.jobs.has(engine.state)) {
                    perform(function () { return step(heldDirection); });
                }
                inputPulses.forEach(function (pulse, button) {
                    pulse.remaining -= frames;
                    if (pulse.remaining <= 0) setTimeout(function () {
                        // Interpreter đọc điều kiện qua microtask sau scheduler.tick().
                        // Giữ xung đến hết task để frame dài không làm mất lần bấm.
                        if (inputPulses.get(button) === pulse) {
                            inputPulses.delete(button); releaseButton(button);
                        }
                    }, 0);
                });
                if (active && !drawing) {
                    drawing = true;
                    screenRevision = engine.screen.revision;
                    lightingRevision = engine.lighting.revision;
                    filterRevision = engine.filters.revision;
                    animationRevision = engine.animations.revision;
                    renderer.draw(engine).catch(function (error) { setStatus(error.message); })
                        .finally(function () { drawing = false; });
                }
            } catch (error) { setStatus(error.message); }
        }
        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
    async function interact() {
        await engine.interact(eventHandlers);
        await draw();
    }
    async function step(direction) {
        if (engine.state.scene !== 'map') return;
        if (engine.state.moveFrames > 0) await engine.screen.tween([], {}, engine.state.moveFrames);
        await engine.step(direction, eventHandlers);
        await draw();
    }
    document.addEventListener('pointerdown', function () { audio.unlock(); });
    function inputName(key) {
        return settings.actionFor(key);
    }
    function pictureInput() {
        return automaticEvents && (!video.hidden || engine.state.mapId === 10);
    }
    function clearInput() {
        engine.buttons.clear(); inputPulses.clear(); commonKeys.clear(); heldPointers.clear(); heldKeys.clear();
    }
    function releaseButton(name) {
        if (!inputPulses.has(name) && !Array.from(heldPointers.values()).includes(name) && !Array.from(heldKeys.values()).includes(name)) engine.buttons.delete(name);
    }
    document.addEventListener('keyup', function (event) {
        var key = event.code || event.key.toLowerCase(), name = heldKeys.get(key) || inputName(event.key);
        heldKeys.delete(key); releaseButton(name); commonKeys.delete(name);
    });
    window.addEventListener('blur', clearInput);
    document.addEventListener('visibilitychange', function () { if (document.hidden) clearInput(); });
    document.addEventListener('keydown', function (event) {
        audio.unlock();
        if (presentationInput()) {
            if (engine.state.scene === 'title' && !document.getElementById('fnh-end-screen').contains(event.target)) handleEndKey(event);
            return;
        }
        if (document.querySelector('dialog[open]')) return;
        var buttonName = inputName(event.key);
        if (buttonName === 'cancel' && engine.state && engine.state.scene === 'map' &&
            !scrollAnimation && !pictureInput() && !engine.eventRunning && !engine.messageRunning && engine.openMenu()) {
            event.preventDefault(); menuUi.render(); return;
        }
        if (event.target.closest('button,input,select,textarea')) return;
        var commonKey = buttonName;
        if (commonBindings[commonKey]) {
            event.preventDefault();
            if (!commonKeys.has(commonKey)) {
                commonKeys.set(commonKey, { remaining: 24 });
                perform(async function () { await engine.runCommonEvent(commonBindings[commonKey], eventHandlers); await draw(); });
            }
            return;
        }
        if (buttonName) { heldKeys.set(event.code || event.key.toLowerCase(), buttonName); engine.buttons.add(buttonName); }
        if (!next.hidden && buttonName === 'ok') {
            event.preventDefault();
            if (!event.repeat) next.click();
            return;
        }
        if (pictureInput() && buttonName) { event.preventDefault(); return; }
        var direction = { down: 2, left: 4, right: 6, up: 8 }[buttonName];
        if (direction) {
            event.preventDefault();
            perform(function () { return step(direction); });
        } else if (buttonName === 'ok') {
            event.preventDefault();
            if (!event.repeat) perform(interact);
        }
    });
    var controls = document.getElementById('fnh-controls');
    controls.addEventListener('pointerdown', function (event) {
        var button = event.target.closest('button[data-direction]'), direction = button && Number(button.dataset.direction);
        if (!direction || presentationInput() || document.querySelector('dialog[open]') || event.button !== 0) return;
        event.preventDefault(); button.setPointerCapture(event.pointerId); pointerClicks.add(button);
        var name = { 2:'down',4:'left',6:'right',8:'up' }[direction];
        heldPointers.set(event.pointerId,name); engine.buttons.add(name);
        if (pictureInput()) inputPulses.set(name,{remaining:3});
        else perform(function () { return step(direction); });
    });
    function releasePointer(event) {
        var name = heldPointers.get(event.pointerId);
        heldPointers.delete(event.pointerId); if (name) releaseButton(name);
    }
    ['pointerup','pointercancel','lostpointercapture'].forEach(function (type) { controls.addEventListener(type,releasePointer); });
    controls.addEventListener('click', function (event) {
        if (presentationInput()) return;
        var shortcut = event.target.closest('button[data-common-event]');
        if (shortcut) {
            perform(async function () { await engine.runCommonEvent(Number(shortcut.dataset.commonEvent), eventHandlers); await draw(); });
            return;
        }
        var button = event.target.closest('button[data-direction]');
        if (!button) return;
        if (event.detail > 0 && pointerClicks.has(button)) { pointerClicks.delete(button); return; }
        var direction = Number(button.dataset.direction);
        if (pictureInput()) {
            var name = { 0: 'ok', 2: 'down', 4: 'left', 6: 'right', 8: 'up' }[direction];
            engine.buttons.add(name); inputPulses.set(name, { remaining: 3 });
            return;
        }
        if (direction) perform(function () { return step(direction); });
        else perform(interact);
    });
    document.getElementById('fnh-save').addEventListener('click', function () {
        if (presentationInput()) return;
        perform(function () {
            if (engine.state.scene !== 'map' || !engine.state.saveEnabled || engine.eventRunning || (scheduler && scheduler.parallel.size)) {
                setStatus('Chưa thể lưu khi sự kiện đang chạy hoặc việc lưu đang bị khóa.');
                return;
            }
            engine.saveTo(saveStore, 1);
            setStatus('Đã lưu ô 1 · Map ' + engine.state.mapId + ' · ô ' + engine.state.x + ',' + engine.state.y);
        });
    });
    document.getElementById('fnh-load').addEventListener('click', function () {
        if (presentationInput()) return;
        perform(async function () {
            if (!await engine.loadFrom(saveStore, 1, eventHandlers)) {
                setStatus('Ô 1 chưa có dữ liệu lưu.');
                return;
            }
            await draw();
        });
    });
    document.getElementById('fnh-volume').addEventListener('input', function (event) {
        try { updateVolume('master', Number(event.target.value)); }
        catch (error) { setStatus(error.message); }
    });
    document.getElementById('fnh-always-dash').addEventListener('change', function (event) {
        if (engine.state) engine.state.alwaysDash = event.target.checked;
        try { settings.alwaysDash = event.target.checked; settings.save(); }
        catch (error) { setStatus(error.message); }
    });
    async function battleAction(action) {
        if (!ready || engine.state.scene !== 'battle') return;
        try {
            await action();
            // Cho event đang chờ nhận kết quả và trở về map trước khi vẽ UI.
            await Promise.resolve();
            await draw();
        } catch (error) { setStatus(error.message); }
    }
    function selectBattleAction(kind, id, targetIndex) {
        engine.queueBattleAction(battleActor, kind, id, targetIndex);
        var queued = engine.battle.battle.inputActions;
        var nextActor = engine.battle.inputActors().find(function (actor) {
            return !queued.some(function (action) { return action.actorId === actor.id; });
        });
        if (nextActor) battleActor = nextActor.id;
        renderBattleUi();
    }
    document.getElementById('fnh-battle-start').addEventListener('click', function () {
        battleAction(function () { return engine.startBattleTurn(eventHandlers); });
    });
    document.getElementById('fnh-battle-attack').addEventListener('click', function () {
        battleAction(async function () {
            var actor = engine.battle.actor(battleActor);
            if (!actor) return;
            selectBattleAction('skill', 1, battleTarget);
        });
    });
    document.getElementById('fnh-battle-actor').addEventListener('change', function (event) { battleActor = Number(event.target.value); renderBattleUi(); });
    document.getElementById('fnh-battle-skill').addEventListener('change', function (event) { battleSkill = Number(event.target.value); renderBattleUi(); });
    document.getElementById('fnh-battle-kind').addEventListener('change', function (event) { battleKind = event.target.value; renderBattleUi(); });
    document.getElementById('fnh-battle-item').addEventListener('change', function (event) { battleItem = Number(event.target.value); renderBattleUi(); });
    document.getElementById('fnh-battle-use-item').addEventListener('click', function () {
        var item = engine.database.Items[battleItem];
        battleAction(function () { return selectBattleAction('item', battleItem, item && [7, 9].includes(item.scope) ? battleFriend : battleTarget); });
    });
    document.getElementById('fnh-battle-use-skill').addEventListener('click', function () {
        var skill = engine.database.Skills[battleSkill];
        battleAction(function () { return selectBattleAction('skill', battleSkill, [7, 9].includes(skill.scope) ? battleFriend : battleTarget); });
    });
    document.getElementById('fnh-battle-escape').addEventListener('click', function () {
        battleAction(function () { return engine.battleEscape(eventHandlers); });
    });
    document.getElementById('fnh-new-game').addEventListener('click', function () {
        location.assign('./standalone.html?map=10&events=1');
    });
    document.getElementById('fnh-end-load').addEventListener('click', function () {
        perform(async function () {
            var slot = Number(document.getElementById('fnh-end-save-slot').value);
            try {
                if (!await engine.loadFrom(saveStore, slot, eventHandlers)) {
                    var empty = 'Ô ' + slot + ' chưa có dữ liệu lưu.';
                    setStatus(empty); document.getElementById('fnh-end-error').textContent = empty; return;
                }
            } catch (error) { document.getElementById('fnh-end-error').textContent = error.message; throw error; }
            await draw();
        });
    });
    document.getElementById('fnh-continue').addEventListener('click', function () {
        document.getElementById('fnh-end-actions').hidden = true;
        document.getElementById('fnh-end-save-panel').hidden = false;
        document.getElementById('fnh-end-error').textContent = '';
        document.getElementById('fnh-end-save-slot').focus();
    });
    document.querySelectorAll('#fnh-end-actions > button').forEach(function (button) {
        button.addEventListener('focus', function () {
            document.querySelectorAll('#fnh-end-actions > button').forEach(function (other) { other.dataset.selected = String(other === button); });
        });
    });
    document.getElementById('fnh-end-save-back').addEventListener('click', function () {
        document.getElementById('fnh-end-save-panel').hidden = true;
        document.getElementById('fnh-end-actions').hidden = false;
        document.getElementById('fnh-continue').focus();
    });
    function handleEndKey(event) {
        var action = inputName(event.key);
        if (action === 'cancel' && !document.getElementById('fnh-end-save-panel').hidden) document.getElementById('fnh-end-save-back').click();
        else if (!document.getElementById('fnh-end-actions').hidden && ['up', 'down'].includes(action)) {
            var buttons = Array.from(document.querySelectorAll('#fnh-end-actions > button:enabled'));
            var index = buttons.findIndex(function (button) { return button.dataset.selected === 'true'; });
            buttons[(index + (action === 'up' ? -1 : 1) + buttons.length) % buttons.length].focus();
        } else if (action === 'ok' && !document.getElementById('fnh-end-actions').hidden) {
            if (!event.repeat) document.querySelector('#fnh-end-actions > button[data-selected="true"]').click();
        } else if (action === 'ok' && document.activeElement.tagName === 'BUTTON') { if (!event.repeat) document.activeElement.click(); }
        else return;
        event.preventDefault(); event.stopPropagation();
    }
    document.getElementById('fnh-end-screen').addEventListener('keydown', handleEndKey);
    document.getElementById('fnh-end-save-slot').addEventListener('change', function (event) {
        document.getElementById('fnh-end-load').textContent = 'Tải ô ' + event.target.value;
    });
    window.addEventListener('pagehide', function () {
        transitionBattle('cancel');
        if (scheduler) scheduler.stop();
        if (stopVideo) stopVideo();
        if (stopScrollText) stopScrollText();
        if (engine.filters) engine.filters.dispose();
        if (engine.animations) engine.animations.dispose();
        audio.dispose();
    });
    (async function () {
        try {
            var skin = await renderer.loadImage('img/system/Window.png');
            document.querySelectorAll('#fnh-title-frame, .fnh-name-frame').forEach(function (target) {
                var frame = target.getContext('2d'), w = target.width, h = target.height;
                [[24,0,48,24,24,0,w-48,24],[24,72,48,24,24,h-24,w-48,24],
                    [0,24,24,48,0,24,24,h-48],[72,24,24,48,w-24,24,24,h-48],
                    [0,0,24,24,0,0,24,24],[72,0,24,24,w-24,0,24,24],
                    [0,72,24,24,0,h-24,24,24],[72,72,24,24,w-24,h-24,24,24]].forEach(function (part) {
                    frame.drawImage(skin, part[0] + 96, part[1], part[2], part[3], part[4], part[5], part[6], part[7]);
                });
            });
            var palette = document.createElement('canvas');
            palette.width = skin.width; palette.height = skin.height;
            var context = palette.getContext('2d'); context.drawImage(skin, 0, 0);
            for (var n = 0; n < 32; n++) {
                var pixel = context.getImageData(102 + n % 8 * 12, 150 + Math.floor(n / 8) * 12, 1, 1).data;
                textColors.push('rgb(' + pixel[0] + ', ' + pixel[1] + ', ' + pixel[2] + ')');
            }
            if (titleFlow) { await engine.boot(); await engine.loadMap(72, { x: 0, y: 0, direction: 2 }); }
            else if (automaticEvents && mapId === 10) await engine.boot();
            else await engine.boot({ mapId: mapId, x: mapId === 74 ? 8 : 1, y: mapId === 74 ? 8 : 0,
                direction: mapId === 74 ? 8 : 2, party: [1], switches: { 246: true }, variables: { 121: 1 } });
            engine.state.alwaysDash = settings.alwaysDash;
            await draw();
            if (automaticEvents) {
                scheduler = new FNHStandaloneScheduler.EventScheduler(engine, eventHandlers, function (error) {
                    errors.push(error.message); setStatus(error.message); console.error(error);
                });
                window.FNHStandalonePreview.scheduler = scheduler;
            }
            ready = true;
            document.getElementById('fnh-loading').hidden = true;
        } catch (error) {
            document.getElementById('fnh-loading').hidden = true;
            setStatus('Không khởi động được engine: ' + error.message);
            console.error(error);
        }
    }());
}());
