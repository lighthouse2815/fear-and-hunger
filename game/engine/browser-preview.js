'use strict';

(function () {
    var query = new URLSearchParams(location.search);
    var mapId = Number(query.get('map') || 74);
    var canvas = document.getElementById('fnh-canvas');
    var status = document.getElementById('fnh-status');
    var message = document.getElementById('fnh-message');
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
        setStatus('Map ' + engine.state.mapId + ' · ô ' + engine.state.x + ',' + engine.state.y + ' · dùng phím mũi tên để di chuyển');
    }
    async function perform(action) {
        if (!ready || busy) return;
        busy = true;
        try { await action(); }
        catch (error) { setStatus(error.message); }
        finally { busy = false; }
    }
    async function runEventAtPlayer() {
        var events = engine.map.eventAt(engine.state.x, engine.state.y);
        if (!events.length) return;
        var event = events[events.length - 1];
        await engine.runEvent(event.id, {
            message: function (text) { message.textContent = text; },
            choice: function (choices) {
                var answer = window.prompt(choices.map(function (choice, index) { return index + ': ' + choice; }).join('\n'), '0');
                return Number(answer);
            },
            effect: async function (code, parameters) {
                if (audio.handleEffect(code, parameters)) return;
                if (code === 230) {
                    await new Promise(function (resolve) { setTimeout(resolve, parameters[0] * 1000 / 60); });
                    return;
                }
                throw new Error('Chưa hỗ trợ lệnh sự kiện ' + code + ' trong preview.');
            }
        });
        await draw();
    }
    document.addEventListener('pointerdown', function () { audio.unlock(); });
    document.addEventListener('keydown', function (event) {
        audio.unlock();
        if (event.target.closest('button,input,select,textarea')) return;
        var direction = { ArrowDown: 2, ArrowLeft: 4, ArrowRight: 6, ArrowUp: 8 }[event.key];
        if (direction) {
            event.preventDefault();
            perform(async function () { engine.move(direction); await draw(); });
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            perform(runEventAtPlayer);
        }
    });
    document.getElementById('fnh-clear').addEventListener('click', function () { message.textContent = ''; });
    document.getElementById('fnh-save').addEventListener('click', function () {
        if (!ready || busy) return;
        engine.saveTo(saveStore, 1);
        setStatus('Đã lưu ô 1 · Map ' + engine.state.mapId + ' · ô ' + engine.state.x + ',' + engine.state.y);
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
            await engine.boot({ mapId: mapId, x: 1, y: 0, direction: 2, party: [1] });
            await draw();
            ready = true;
        } catch (error) {
            setStatus('Không khởi động được engine: ' + error.message);
            console.error(error);
        }
    }());
}());
