'use strict';

(function () {
    var query = new URLSearchParams(location.search);
    var mapId = Number(query.get('map') || 74);
    var automaticEvents = query.get('events') === '1';
    var canvas = document.getElementById('fnh-canvas');
    var status = document.getElementById('fnh-status');
    var message = document.getElementById('fnh-message-text');
    var next = document.getElementById('fnh-next');
    var choicesPanel = document.getElementById('fnh-choices');
    var engine = new FNHStandaloneEngine.GameEngine({ baseUrl: '.' });
    var renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas, { baseUrl: '.' });
    var saveStore = new FNHStandaloneSave.SaveStore({ prefix: 'FNH_STANDALONE_PREVIEW:' });
    var settings = new FNHStandaloneSettings.PlayerSettings({ key: 'FNH_STANDALONE_PREVIEW_SETTINGS' });
    var audio = new FNHStandaloneAudio.AudioManager({ baseUrl: '.', onError: function (error) { setStatus(error.message); } });
    FNHStandaloneSettings.categories.forEach(function (category) { audio.setVolume(category, settings.volumes[category] / 100); });
    document.getElementById('fnh-volume').value = settings.volumes.master;
    var ready = false;
    var busy = false;
    var audioMap = null;
    var scheduler = null;
    var errors = [];
    var inputPulses = new Map();
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
    function renderEndScreen() {
        var scene = engine.state.scene, panel = document.getElementById('fnh-end-screen');
        var visible = scene === 'gameover' || scene === 'title';
        panel.hidden = !visible;
        if (!visible) { endScene = null; return; }
        if (endScene === scene) return;
        endScene = scene;
        var slots = document.getElementById('fnh-end-save-slot');
        FNHStandaloneMenu.fillSaveSlots(slots, saveStore, Number(slots.value) || 1);
        document.getElementById('fnh-end-load').textContent = 'Tải ô ' + slots.value;
        var system = engine.database.System;
        var background = document.getElementById('fnh-end-background');
        var overlay = document.getElementById('fnh-end-overlay');
        document.getElementById('fnh-end-title').textContent = scene === 'gameover' ? 'Game Over' : system.gameTitle;
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
        document.getElementById('fnh-new-game').focus({ preventScroll: true });
    }
    async function draw() {
        await renderer.draw(engine);
        renderBattleUi();
        renderEndScreen();
        if (menuUi) menuUi.render();
        document.getElementById('fnh-always-dash').checked = engine.state.alwaysDash;
        if (audioMap !== engine.map && engine.state.scene === 'map') {
            audioMap = engine.map;
            if (audioMap.data.autoplayBgm) audio.play('bgm', audioMap.data.bgm);
            if (audioMap.data.autoplayBgs) audio.play('bgs', audioMap.data.bgs);
        }
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
            message.textContent = FNHStandaloneText.formatText(engine.state.wordWrap ? text.replace(/\n/g, ' ') : text, engine.state);
            if (options && options.choicesFollow) { next.hidden = true; return; }
            return messageDialog(text, interpreter);
        }, interpreter);
    }
    function messageDialog(text, interpreter) {
        engine.messageRunning = true;
        message.textContent = FNHStandaloneText.formatText(engine.state.wordWrap ? text.replace(/\n/g, ' ') : text, engine.state);
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
                choicesPanel.replaceChildren();
                help.textContent = '';
                if (signal) signal.removeEventListener('abort', abort);
                canvas.focus({ preventScroll: true });
            }
            function abort() { close(); reject(signal.reason); }
            function addChoice(label, index) {
                var button = document.createElement('button');
                button.type = 'button';
                button.textContent = FNHStandaloneText.formatText(label, engine.state);
                button.disabled = details.disabled.includes(index);
                button.onfocus = button.onmouseenter = function () {
                    help.textContent = FNHStandaloneText.formatText(details.help[index] || '', engine.state);
                    if (details.message[index]) message.textContent = FNHStandaloneText.formatText(details.message[index], engine.state);
                };
                button.onclick = function () {
                    close();
                    resolve(index);
                };
                choicesPanel.appendChild(button);
            }
            choices.forEach(addChoice);
            if (cancelType !== -1) addChoice('Quay lại', cancelType >= 0 ? cancelType : -1);
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
        engine.buttons.clear();
        dialog.showModal();
        input.focus(); input.select();
        return new Promise(function (resolve, reject) {
            function close() {
                engine.messageRunning = false;
                form.onsubmit = null; dialog.oncancel = null;
                if (signal) signal.removeEventListener('abort', abort);
                dialog.close(); canvas.focus({ preventScroll: true });
            }
            function abort() { close(); reject(signal.reason); }
            dialog.oncancel = function (event) { event.preventDefault(); };
            form.onsubmit = function (event) {
                event.preventDefault();
                var name = Array.from(input.value.trim()).slice(0, parameters[1]).join('');
                if (!name) return;
                actor.name = name; close(); resolve();
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
            content.textContent = FNHStandaloneText.formatText(text, engine.state);
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
    var eventHandlers = {
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
        settings: settings, updateVolume: updateVolume,
        clearInput: function () { engine.buttons.clear(); commonKeys.clear(); inputPulses.clear(); }
    });
    var previousFrame = performance.now(), drawing = false, screenRevision = -1, lightingRevision = -1, filterRevision = -1, animationRevision = -1;
    function animate(now) {
        var frames = Math.min(6, Math.max(0, (now - previousFrame) * 60 / 1000));
        previousFrame = now;
        if (ready) {
            try {
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
                var active = sceneChanged || !!scheduler || engine.autonomousEnabled || screenRevision !== engine.screen.revision || engine.screen.active() ||
                    lightingRevision !== engine.lighting.revision || engine.lighting.active(engine.map) || engine.movement.jobs.size > 0 || [engine.state].concat(engine.map.events).some(function (character) {
                    return character.stepAnime || character.moveFrames > 0 || (character.balloon && character.balloon.remaining > 0);
                });
                active = active || filterRevision !== engine.filters.revision || engine.filters.active();
                active = active || engine.animations.entries.length > 0 || animationRevision !== engine.animations.revision ||
                    !!(engine.state.regionCover && engine.state.regionCover.enabled);
                engine.advanceRoutes(frames);
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
                            inputPulses.delete(button); engine.buttons.delete(button);
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
    document.addEventListener('keyup', function (event) {
        engine.buttons.delete(inputName(event.key)); commonKeys.delete(inputName(event.key));
    });
    window.addEventListener('blur', function () { engine.buttons.clear(); inputPulses.clear(); commonKeys.clear(); });
    document.addEventListener('keydown', function (event) {
        audio.unlock();
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
        if (buttonName) engine.buttons.add(buttonName);
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
    document.getElementById('fnh-controls').addEventListener('click', function (event) {
        var shortcut = event.target.closest('button[data-common-event]');
        if (shortcut) {
            perform(async function () { await engine.runCommonEvent(Number(shortcut.dataset.commonEvent), eventHandlers); await draw(); });
            return;
        }
        var button = event.target.closest('button[data-direction]');
        if (!button) return;
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
            if (!await engine.loadFrom(saveStore, slot, eventHandlers)) { setStatus('Ô ' + slot + ' chưa có dữ liệu lưu.'); return; }
            audioMap = null;
            await draw();
        });
    });
    document.getElementById('fnh-end-save-slot').addEventListener('change', function (event) {
        document.getElementById('fnh-end-load').textContent = 'Tải ô ' + event.target.value;
    });
    window.addEventListener('pagehide', function () {
        if (scheduler) scheduler.stop();
        if (stopVideo) stopVideo();
        if (stopScrollText) stopScrollText();
        if (engine.filters) engine.filters.dispose();
        if (engine.animations) engine.animations.dispose();
        audio.dispose();
    });
    (async function () {
        try {
            if (automaticEvents && mapId === 10) await engine.boot();
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
        } catch (error) {
            setStatus('Không khởi động được engine: ' + error.message);
            console.error(error);
        }
    }());
}());
