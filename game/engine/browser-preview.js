'use strict';

(function () {
    var query = new URLSearchParams(location.search);
    var mapId = Number(query.get('map') || 74);
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

    // Cho phép xem trạng thái engine đang chạy trong công cụ phát triển.
    window.FNHStandalonePreview = { engine: engine, audio: audio };

    function setStatus(text) { status.textContent = text; }
    async function draw() {
        await renderer.draw(engine);
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
    function showMessage(text) {
        message.textContent = text.replace(/\\c\[\d+\]/gi, '');
        next.hidden = false;
        next.focus({ preventScroll: true });
        return new Promise(function (resolve) {
            next.onclick = function () {
                next.hidden = true;
                next.onclick = null;
                canvas.focus({ preventScroll: true });
                resolve();
            };
        });
    }
    function showChoices(choices, cancelType) {
        return new Promise(function (resolve) {
            choicesPanel.replaceChildren();
            function addChoice(label, index) {
                var button = document.createElement('button');
                button.type = 'button';
                button.textContent = label;
                button.onclick = function () {
                    choicesPanel.replaceChildren();
                    canvas.focus({ preventScroll: true });
                    resolve(index);
                };
                choicesPanel.appendChild(button);
            }
            choices.forEach(addChoice);
            if (cancelType !== -1) addChoice('Quay lại', -1);
            if (choicesPanel.firstElementChild) choicesPanel.firstElementChild.focus({ preventScroll: true });
        });
    }
    var eventHandlers = {
        message: showMessage,
        choice: showChoices,
        effect: async function (code, parameters) {
            if (audio.handleEffect(code, parameters)) return;
            if (code === 230) {
                await new Promise(function (resolve) { setTimeout(resolve, parameters[0] * 1000 / 60); });
                return;
            }
            return false;
        }
    };
    engine.onRouteEffect = eventHandlers.effect;
    var previousFrame = performance.now(), drawing = false, screenRevision = -1;
    function animate(now) {
        var frames = Math.min(6, Math.max(0, (now - previousFrame) * 60 / 1000));
        previousFrame = now;
        if (ready) {
            try {
                var active = screenRevision !== engine.screen.revision || engine.screen.active() || engine.movement.jobs.size > 0 || [engine.state].concat(engine.map.events).some(function (character) {
                    return character.stepAnime || character.moveFrames > 0;
                });
                engine.advanceRoutes(frames);
                if (active && !drawing) {
                    drawing = true;
                    screenRevision = engine.screen.revision;
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
        await engine.step(direction, eventHandlers);
        await draw();
    }
    document.addEventListener('pointerdown', function () { audio.unlock(); });
    document.addEventListener('keydown', function (event) {
        audio.unlock();
        if (event.target.closest('button,input,select,textarea')) return;
        if (!next.hidden && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            if (!event.repeat) next.click();
            return;
        }
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
        if (direction) perform(function () { return step(direction); });
        else perform(interact);
    });
    document.getElementById('fnh-save').addEventListener('click', function () {
        perform(function () {
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
    });
    window.addEventListener('pagehide', function () { audio.dispose(); });
    (async function () {
        try {
            await engine.boot({ mapId: mapId, x: mapId === 74 ? 8 : 1, y: mapId === 74 ? 8 : 0,
                direction: mapId === 74 ? 8 : 2, party: [1], switches: { 246: true }, variables: { 121: 1 } });
            await draw();
            ready = true;
        } catch (error) {
            setStatus('Không khởi động được engine: ' + error.message);
            console.error(error);
        }
    }());
}());
