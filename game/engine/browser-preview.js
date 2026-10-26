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
    var audio = new FNHStandaloneAudio.AudioManager({ baseUrl: '.', onError: function (error) { setStatus(error.message); } });
    var ready = false;
    var busy = false;
    var audioMap = null;
    var scheduler = null;
    var errors = [];
    var inputPulses = new Map();
    var video = document.getElementById('fnh-video');
    var videoPlay = document.getElementById('fnh-video-play');
    var stopVideo = null;
    var uiTail = Promise.resolve();

    // Cho phép xem trạng thái engine đang chạy trong công cụ phát triển.
    window.FNHStandalonePreview = { engine: engine, audio: audio, errors: errors };

    function setStatus(text) { status.textContent = text; }
    async function draw() {
        await renderer.draw(engine);
        document.getElementById('fnh-always-dash').checked = engine.state.alwaysDash;
        if (audioMap !== engine.map) {
            audioMap = engine.map;
            if (audioMap.data.autoplayBgm) audio.play('bgm', audioMap.data.bgm);
            if (audioMap.data.autoplayBgs) audio.play('bgs', audioMap.data.bgs);
        }
        setStatus('Map ' + engine.state.mapId + ' · ô ' + engine.state.x + ',' + engine.state.y + ' · Mũi tên: di chuyển · Enter: tương tác');
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
    var eventHandlers = {
        message: showMessage,
        choice: showChoices,
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
    var previousFrame = performance.now(), drawing = false, screenRevision = -1, lightingRevision = -1, filterRevision = -1;
    function animate(now) {
        var frames = Math.min(6, Math.max(0, (now - previousFrame) * 60 / 1000));
        previousFrame = now;
        if (ready) {
            try {
                if (scheduler) scheduler.tick();
                var active = !!scheduler || engine.autonomousEnabled || screenRevision !== engine.screen.revision || engine.screen.active() ||
                    lightingRevision !== engine.lighting.revision || engine.lighting.active(engine.map) || engine.movement.jobs.size > 0 || [engine.state].concat(engine.map.events).some(function (character) {
                    return character.stepAnime || character.moveFrames > 0 || (character.balloon && character.balloon.remaining > 0);
                });
                active = active || filterRevision !== engine.filters.revision || engine.filters.active();
                engine.advanceRoutes(frames);
                var heldDirection = engine.buttons.has('down') ? 2 : engine.buttons.has('left') ? 4 :
                    engine.buttons.has('right') ? 6 : engine.buttons.has('up') ? 8 : 0;
                if (heldDirection && !pictureInput() && !engine.messageRunning && !engine.eventRunning &&
                    !(engine.state.moveFrames > 0) && !engine.movement.jobs.has(engine.state)) {
                    perform(function () { return step(heldDirection); });
                }
                inputPulses.forEach(function (remaining, button) {
                    if (remaining <= frames) { inputPulses.delete(button); engine.buttons.delete(button); }
                    else inputPulses.set(button, remaining - frames);
                });
                if (active && !drawing) {
                    drawing = true;
                    screenRevision = engine.screen.revision;
                    lightingRevision = engine.lighting.revision;
                    filterRevision = engine.filters.revision;
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
        if (engine.state.moveFrames > 0) await engine.screen.tween([], {}, engine.state.moveFrames);
        await engine.step(direction, eventHandlers);
        await draw();
    }
    document.addEventListener('pointerdown', function () { audio.unlock(); });
    function inputName(key) {
        return { ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up',
            Enter: 'ok', ' ': 'ok', Escape: 'cancel', Shift: 'shift', PageUp: 'pageup', PageDown: 'pagedown' }[key];
    }
    function pictureInput() {
        return automaticEvents && (!video.hidden || engine.state.mapId === 10);
    }
    document.addEventListener('keyup', function (event) { engine.buttons.delete(inputName(event.key)); });
    window.addEventListener('blur', function () { engine.buttons.clear(); inputPulses.clear(); });
    document.addEventListener('keydown', function (event) {
        audio.unlock();
        if (event.target.closest('button,input,select,textarea')) return;
        var buttonName = inputName(event.key);
        if (buttonName) engine.buttons.add(buttonName);
        if (!next.hidden && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            if (!event.repeat) next.click();
            return;
        }
        if (pictureInput() && buttonName) { event.preventDefault(); return; }
        var direction = { ArrowDown: 2, ArrowLeft: 4, ArrowRight: 6, ArrowUp: 8 }[event.key];
        if (direction) {
            event.preventDefault();
            perform(function () { return step(direction); });
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!event.repeat) perform(interact);
        }
    });
    document.getElementById('fnh-controls').addEventListener('click', function (event) {
        var button = event.target.closest('button[data-direction]');
        if (!button) return;
        var direction = Number(button.dataset.direction);
        if (pictureInput()) {
            var name = { 0: 'ok', 2: 'down', 4: 'left', 6: 'right', 8: 'up' }[direction];
            engine.buttons.add(name); inputPulses.set(name, 3);
            return;
        }
        if (direction) perform(function () { return step(direction); });
        else perform(interact);
    });
    document.getElementById('fnh-save').addEventListener('click', function () {
        perform(function () {
            if (!engine.state.saveEnabled || engine.eventRunning || (scheduler && scheduler.parallel.size)) {
                setStatus('Chưa thể lưu khi sự kiện đang chạy hoặc việc lưu đang bị khóa.');
                return;
            }
            engine.saveTo(saveStore, 1);
            setStatus('Đã lưu ô 1 · Map ' + engine.state.mapId + ' · ô ' + engine.state.x + ',' + engine.state.y);
        });
    });
    document.getElementById('fnh-load').addEventListener('click', function () {
        perform(async function () {
            if (!await engine.loadFrom(saveStore, 1)) {
                setStatus('Ô 1 chưa có dữ liệu lưu.');
                return;
            }
            await draw();
        });
    });
    document.getElementById('fnh-volume').addEventListener('input', function (event) {
        audio.setVolume('master', Number(event.target.value) / 100);
        video.volume = audio.masterVolume;
    });
    document.getElementById('fnh-always-dash').addEventListener('change', function (event) {
        if (engine.state) engine.state.alwaysDash = event.target.checked;
    });
    window.addEventListener('pagehide', function () {
        if (scheduler) scheduler.stop();
        if (stopVideo) stopVideo();
        if (engine.filters) engine.filters.dispose();
        audio.dispose();
    });
    (async function () {
        try {
            if (automaticEvents && mapId === 10) await engine.boot();
            else await engine.boot({ mapId: mapId, x: mapId === 74 ? 8 : 1, y: mapId === 74 ? 8 : 0,
                direction: mapId === 74 ? 8 : 2, party: [1], switches: { 246: true }, variables: { 121: 1 } });
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
