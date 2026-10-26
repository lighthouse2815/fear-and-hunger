'use strict';

(function () {
    var query = new URLSearchParams(location.search);
    var mapId = Number(query.get('map') || 74);
    var canvas = document.getElementById('fnh-canvas');
    var status = document.getElementById('fnh-status');
    var message = document.getElementById('fnh-message');
    var engine = new FNHStandaloneEngine.GameEngine({ baseUrl: '.' });
    var renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas, { baseUrl: '.' });

    function setStatus(text) { status.textContent = text; }
    async function draw() {
        await renderer.draw(engine);
        setStatus('Map ' + engine.state.mapId + ' · ô ' + engine.state.x + ',' + engine.state.y + ' · dùng phím mũi tên để di chuyển');
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
            }
        });
        await draw();
    }
    document.addEventListener('keydown', async function (event) {
        var direction = { ArrowDown: 2, ArrowLeft: 4, ArrowRight: 6, ArrowUp: 8 }[event.key];
        if (direction) {
            event.preventDefault();
            engine.move(direction);
            await draw();
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            await runEventAtPlayer();
        }
    });
    document.getElementById('fnh-clear').addEventListener('click', function () { message.textContent = ''; });
    (async function () {
        try {
            await engine.boot({ mapId: mapId, x: 1, y: 0, direction: 2, party: [1] });
            await draw();
        } catch (error) {
            setStatus('Không khởi động được engine: ' + error.message);
            console.error(error);
        }
    }());
}());
