'use strict';
/* ============================================================
   Smoke test cho bản Fear & Hunger chạy trên trình duyệt.
   - Khởi động server tạm trên cổng ngẫu nhiên.
   - Dùng Chrome/Chromium hệ thống qua CDP (không cần npm install).
   - Kiểm tra overlay, tiêu đề, âm thanh, video, bản đồ, di chuyển,
     lưu/đọc, trận đấu và lưu qua localStorage sau khi tải lại.
   Nếu thiếu thư mục game hoặc Chrome, bài test bỏ qua và trả mã 0.
   ============================================================ */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { findGameRoot, startServer } = require('../tools/fnh-browser/server');

const GAME_HINT = 'Fear.and.Hunger.v1.4.1/Fear.and.Hunger.v1.4.1/www';
const SAVE_SLOT = 20;
const CHROME_ARGS = [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-breakpad',
    '--no-pings',
    '--disk-cache-size=10485760',
    '--media-cache-size=10485760',
    '--window-size=1280,900'
];

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function log(message) {
    console.log('[FNH smoke] ' + message);
}

function skip(message) {
    console.log('');
    console.log('BỎ QUA: ' + message);
    console.log('');
    process.exitCode = 0;
}

function findChrome() {
    const candidates = [
        process.env.CHROME_BIN,
        'google-chrome-stable',
        'google-chrome',
        'chromium',
        'chromium-browser',
        'chrome',
        'msedge',
        'microsoft-edge',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ].filter(Boolean);

    for (const candidate of candidates) {
        const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
        if (!result.error && result.status === 0) return candidate;
    }
    return null;
}

class CDP {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 0;
        this.pending = new Map();
        this.listeners = new Map();
        this.closed = false;

        ws.addEventListener('message', (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch (error) {
                return;
            }
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                clearTimeout(pending.timer);
                if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
                else pending.resolve(message.result);
                return;
            }
            if (message.method) {
                for (const listener of this.listeners.get(message.method) || []) {
                    listener(message.params);
                }
            }
        });

        ws.addEventListener('close', () => {
            this.closed = true;
            for (const pending of this.pending.values()) {
                clearTimeout(pending.timer);
                pending.reject(new Error('CDP đã đóng kết nối.'));
            }
            this.pending.clear();
        });
    }

    send(method, params, timeoutMs) {
        if (this.closed) return Promise.reject(new Error('CDP đã đóng kết nối.'));
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('CDP quá thời gian: ' + method));
            }, timeoutMs || 30000);
            this.pending.set(id, { resolve, reject, timer });
            this.ws.send(JSON.stringify({ id, method, params: params || {} }));
        });
    }

    on(method, callback) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(callback);
    }
}

async function evalPage(cdp, expression, awaitPromise, userGesture) {
    const params = {
        expression: expression,
        awaitPromise: !!awaitPromise,
        returnByValue: true
    };
    if (userGesture) params.userGesture = true;
    const result = await cdp.send('Runtime.evaluate', params, 30000);
    if (result.exceptionDetails) {
        const details = result.exceptionDetails;
        const text = details.exception && (details.exception.description || details.exception.value);
        throw new Error('Lỗi trong trang: ' + (text || details.text));
    }
    return result.result ? result.result.value : undefined;
}

async function waitFor(cdp, expression, timeoutMs, label) {
    const started = Date.now();
    while (Date.now() - started < (timeoutMs || 30000)) {
        if (await evalPage(cdp, '!!(' + expression + ')', false, false)) return;
        await sleep(200);
    }
    throw new Error('Hết thời gian chờ: ' + (label || expression));
}

async function getJson(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
            let body = '';
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error('Phản hồi không phải JSON: ' + body.slice(0, 200)));
                }
            });
        });
        request.on('error', reject);
        request.setTimeout(5000, () => request.destroy(new Error('Quá thời gian kết nối Chrome.')));
    });
}

async function waitForChrome(profile, chrome) {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 150; i += 1) {
        if (chrome.exitCode !== null) {
            throw new Error('Chrome thoát sớm với mã ' + chrome.exitCode + '.');
        }
        if (fs.existsSync(portFile)) {
            const content = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
            if (content[0] && /^\d+$/.test(content[0])) {
                return Number(content[0]);
            }
        }
        await sleep(100);
    }
    throw new Error('Chrome không ghi tệp DevToolsActivePort.');
}

async function openTarget(port) {
    let targets = null;
    for (let i = 0; i < 100; i += 1) {
        try {
            targets = await getJson('http://127.0.0.1:' + port + '/json/list');
            break;
        } catch (error) {
            await sleep(100);
        }
    }
    if (!targets) throw new Error('Không đọc được danh sách tab của Chrome.');
    const target = targets.find((item) => item.type === 'page');
    if (!target) throw new Error('Chrome không có tab nào.');
    return target;
}

async function connect(wsUrl) {
    if (typeof WebSocket === 'undefined') {
        throw new Error('Node.js cần có WebSocket toàn cục (Node 22 trở lên).');
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
    return ws;
}

async function stopChrome(chrome) {
    if (!chrome || chrome.exitCode !== null) return;
    const exited = new Promise((resolve) => {
        chrome.once('exit', resolve);
    });
    try { chrome.kill('SIGTERM'); } catch (error) {}
    await Promise.race([exited, sleep(1500)]);
    if (chrome.exitCode === null) {
        try { chrome.kill('SIGKILL'); } catch (error) {}
    }
    await Promise.race([exited, sleep(1500)]);
}

async function clickStart(cdp) {
    await waitFor(
        cdp,
        'document.querySelector("#fnh-start-button") && document.querySelector("#fnh-start-button").getBoundingClientRect().width > 0',
        20000,
        'nút BẮT ĐẦU'
    );
    const point = await evalPage(cdp, [
        '(() => {',
        '  const button = document.querySelector("#fnh-start-button");',
        '  const rect = button.getBoundingClientRect();',
        '  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };',
        '})()'
    ].join('\n'), false, false);
    await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1
    });
    await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1
    });
}

async function main() {
    let gameRoot;
    try {
        gameRoot = findGameRoot(process.env.FNH_GAME_ROOT);
    } catch (error) {
        skip('không tìm thấy thư mục game. Đặt game vào ' + GAME_HINT +
            ' hoặc dùng FNH_GAME_ROOT / --game.');
        return;
    }

    let running = null;
    let chrome = null;
    let profile = null;
    let ws = null;
    let cdp = null;
    let chromeStderr = '';
    let keepShots = false;
    const shotsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fnh-smoke-'));
    const runtimeErrors = [];
    const logErrors = [];
    let passed = 0;

    function check(name, condition, detail) {
        if (!condition) {
            throw new Error('Kiểm tra thất bại: ' + name + (detail ? ' — ' + detail : ''));
        }
        passed += 1;
        log('ĐẠT: ' + name);
    }

    async function screenshot(name) {
        if (!cdp) return null;
        try {
            const result = await cdp.send('Page.captureScreenshot', { format: 'png' }, 15000);
            const file = path.join(shotsDir, name + '.png');
            fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
            return file;
        } catch (error) {
            return null;
        }
    }

    try {
        log('Thư mục game: ' + gameRoot);
        running = await startServer({ gameRoot: gameRoot, host: '127.0.0.1', port: 0 });
        log('Máy chủ tạm: ' + running.url);

        // ---------------------------------------------------------
        // 1. Kiểm tra server, chèn compat và phục vụ asset gốc.
        // ---------------------------------------------------------
        const health = await (await fetch(running.url + '__fnh/health')).json();
        check('health trả về đúng chế độ', health.ok === true && health.mode === 'fnh-browser');

        const indexResponse = await fetch(running.url);
        const indexHtml = await indexResponse.text();
        const pluginsAt = indexHtml.indexOf('src="js/plugins.js"');
        const compatAt = indexHtml.indexOf('/__fnh/compat.js');
        const mainAt = indexHtml.indexOf('src="js/main.js"');
        check(
            'chèn compat.js đúng thứ tự plugins.js → compat → main.js',
            pluginsAt !== -1 && compatAt !== -1 && mainAt !== -1 && pluginsAt < compatAt && compatAt < mainAt
        );

        const moviePath = path.join(gameRoot, 'movies', 'intro.webm');
        if (fs.existsSync(moviePath)) {
            const rangeResponse = await fetch(running.url + 'movies/intro.webm', {
                headers: { Range: 'bytes=0-99' }
            });
            const rangeBody = Buffer.from(await rangeResponse.arrayBuffer());
            check('hỗ trợ HTTP Range cho video', rangeResponse.status === 206 && rangeBody.length === 100);
        }

        const traversalResponse = await fetch(running.url + '..%2f..%2fetc%2fpasswd');
        check('chặn truy cập ngoài thư mục game', traversalResponse.status === 403);

        // ---------------------------------------------------------
        // 2. Khởi động Chrome headless và mở game.
        // ---------------------------------------------------------
        const chromeBin = findChrome();
        if (!chromeBin) {
            skip('không tìm thấy Chrome/Chromium. Đặt CHROME_BIN hoặc cài Chrome để chạy phần kiểm tra trình duyệt.');
            return;
        }
        log('Chrome: ' + chromeBin);

        profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fnh-chrome-'));
        chrome = spawn(chromeBin, CHROME_ARGS.concat([
            '--remote-debugging-port=0',
            '--user-data-dir=' + profile,
            'about:blank'
        ]), { stdio: ['ignore', 'ignore', 'pipe'] });

        chrome.stderr.on('data', (chunk) => {
            chromeStderr += chunk.toString();
            if (chromeStderr.length > 12000) chromeStderr = chromeStderr.slice(-12000);
        });

        const debugPort = await waitForChrome(profile, chrome);
        const target = await openTarget(debugPort);
        ws = await connect(target.webSocketDebuggerUrl);
        cdp = new CDP(ws);

        cdp.on('Runtime.exceptionThrown', (params) => {
            runtimeErrors.push(params.exceptionDetails || {});
        });
        cdp.on('Log.entryAdded', (params) => {
            if (params.entry && params.entry.level === 'error') logErrors.push(params.entry);
        });

        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        await cdp.send('Log.enable');

        const namespace = 'smoke-' + process.pid + '-' + Date.now().toString(36);
        const url = running.url + '?fnh_skip_pretitle=1&fnh_save_ns=' + encodeURIComponent(namespace);
        log('Mở: ' + url);
        await cdp.send('Page.navigate', { url: url });
        await sleep(800);

        await waitFor(cdp, 'document.querySelector("#fnh-start-button")', 30000, 'overlay bắt đầu');
        check('overlay bắt đầu xuất hiện trước khi game chạy', await evalPage(
            cdp,
            '!!(document.querySelector("#fnh-start-button") && getComputedStyle(document.querySelector("#fnh-start-overlay")).display !== "none")',
            false,
            false
        ));
        await screenshot('overlay');

        await clickStart(cdp);
        await waitFor(cdp, 'window.SceneManager && SceneManager._scene instanceof Scene_Title', 60000, 'Scene_Title');
        await waitFor(cdp, 'DataManager.isDatabaseLoaded()', 10000, 'nạp database');
        await waitFor(cdp, 'FNHBrowser.audioState() === "running"', 15000, 'Web Audio chạy');
        await waitFor(
            cdp,
            'AudioManager._currentBgm && AudioManager._currentBgm.name === "fear_and_hunger" && !!(AudioManager._bgmBuffer && AudioManager._bgmBuffer.isPlaying())',
            20000,
            'nhạc tiêu đề'
        );
        await screenshot('title');

        check('đã vào Scene_Title', await evalPage(
            cdp, 'SceneManager._scene instanceof Scene_Title', false, false
        ));
        check('overlay đã ẩn sau khi bắt đầu', await evalPage(
            cdp,
            'getComputedStyle(document.querySelector("#fnh-start-overlay")).display === "none"',
            false,
            false
        ));
        check('Steamworks bị tắt', await evalPage(
            cdp,
            '$plugins.filter(function (p) { return /steamworks|greenworks/i.test(p.name) && p.status; }).length === 0',
            false,
            false
        ));
        check('không còn require/process của NW.js', await evalPage(
            cdp,
            'typeof require === "undefined" && typeof process === "undefined" && Utils.isNwjs() === false',
            false,
            false
        ));
        check('âm thanh đã được mở khoá', await evalPage(
            cdp, 'FNHBrowser.audioState() === "running"', false, false
        ));
        check('nhạc tiêu đề đang phát', await evalPage(
            cdp,
            'AudioManager._currentBgm && AudioManager._currentBgm.name === "fear_and_hunger" && !!(AudioManager._bgmBuffer && AudioManager._bgmBuffer.isPlaying())',
            false,
            false
        ));
        check('lệnh Continue phản ánh đúng trạng thái save', await evalPage(
            cdp, 'DataManager.isAnySavefileExists() === false', false, false
        ));

        // ---------------------------------------------------------
        // 3. Video intro: phát thật qua Graphics.playVideo.
        // ---------------------------------------------------------
        await evalPage(cdp, 'Graphics.playVideo("movies/intro.webm"); true', false, true);
        await sleep(2500);
        let video = await evalPage(cdp, [
            '(() => {',
            '  const v = Graphics._video;',
            '  return {',
            '    readyState: v.readyState,',
            '    paused: v.paused,',
            '    currentTime: v.currentTime,',
            '    duration: v.duration,',
            '    error: v.error && v.error.code,',
            '    visible: Graphics._isVideoVisible()',
            '  };',
            '})()'
        ].join('\n'), false, false);

        // Nếu autoplay bị chặn, click ra ngoài canvas để kích hoạt retry.
        if (video.paused) {
            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mousePressed', x: 20, y: 20, button: 'left', clickCount: 1
            });
            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mouseReleased', x: 20, y: 20, button: 'left', clickCount: 1
            });
            await sleep(1200);
            video = await evalPage(cdp, [
                '(() => {',
                '  const v = Graphics._video;',
                '  return {',
                '    readyState: v.readyState,',
                '    paused: v.paused,',
                '    currentTime: v.currentTime,',
                '    duration: v.duration,',
                '    error: v.error && v.error.code,',
                '    visible: Graphics._isVideoVisible()',
                '  };',
                '})()'
            ].join('\n'), false, false);
        }

        check('video intro tải được', video.readyState >= 2 && video.error === null, JSON.stringify(video));
        check('video intro phát tiếp', video.paused === false && video.currentTime > 1, JSON.stringify(video));
        check('video intro hiển thị đúng lớp', video.visible === true, JSON.stringify(video));
        check('video intro có thời lượng hợp lý', video.duration > 5, JSON.stringify(video));

        await evalPage(cdp, [
            '(() => {',
            '  const v = Graphics._video;',
            '  v.pause();',
            '  v.removeAttribute("src");',
            '  v.load();',
            '  Graphics._updateVisibility(false);',
            '  return true;',
            '})()'
        ].join('\n'), false, false);
        await sleep(300);

        // ---------------------------------------------------------
        // 4. Lưu/đọc trong localStorage có namespace test.
        // ---------------------------------------------------------
        const saveState = await evalPage(cdp, [
            '(() => {',
            '  DataManager.setupNewGame();',
            '  $gameVariables.setValue(123, 4242);',
            '  $gameParty.gainGold(777);',
            '  const goldBefore = $gameParty.gold();',
            '  const saved = DataManager.saveGame(' + SAVE_SLOT + ');',
            '  const exists = StorageManager.exists(' + SAVE_SLOT + ');',
            '  const info = DataManager.loadSavefileInfo(' + SAVE_SLOT + ');',
            '  const keys = Object.keys(localStorage).filter(function (key) {',
            '    return key.indexOf("FNH_WEB:' + namespace + ':") === 0;',
            '  });',
            '  $gameVariables.setValue(123, 0);',
            '  $gameParty.loseGold($gameParty.gold());',
            '  const loaded = DataManager.loadGame(' + SAVE_SLOT + ');',
            '  return {',
            '    saved: saved,',
            '    exists: exists,',
            '    info: !!info,',
            '    loaded: loaded,',
            '    variable: $gameVariables.value(123),',
            '    gold: $gameParty.gold(),',
            '    goldBefore: goldBefore,',
            '    keys: keys,',
            '    keyName: StorageManager.webStorageKey(' + SAVE_SLOT + ')',
            '  };',
            '})()'
        ].join('\n'), false, false);
        check('saveGame trả về thành công', saveState.saved === true, JSON.stringify(saveState));
        check('save tồn tại trong localStorage', saveState.exists === true && saveState.info === true, JSON.stringify(saveState));
        check('save dùng đúng namespace test', saveState.keys.length >= 2 && saveState.keyName.indexOf('FNH_WEB:' + namespace + ':') === 0, JSON.stringify(saveState));
        check('loadGame khôi phục biến và vàng', saveState.loaded === true && saveState.variable === 4242 && saveState.gold === saveState.goldBefore, JSON.stringify(saveState));

        // ---------------------------------------------------------
        // 5. Bản đồ, di chuyển và trận đấu.
        // ---------------------------------------------------------
        const mapState = await evalPage(cdp, [
            '(async () => {',
            '  DataManager.setupNewGame();',
            '  SceneManager.goto(Scene_Map);',
            '  await new Promise(function (resolve) { setTimeout(resolve, 5000); });',
            '  const scene = SceneManager._scene;',
            '  return {',
            '    scene: scene && scene.constructor.name,',
            '    mapId: $gameMap.mapId(),',
            '    mapName: $dataMapInfos[$gameMap.mapId()] && $dataMapInfos[$gameMap.mapId()].name,',
            '    party: $gameParty.members().map(function (actor) { return actor.name(); }),',
            '    spriteset: !!(scene && scene._spriteset),',
            '    events: $gameMap.events().length',
            '  };',
            '})()'
        ].join('\n'), true, false);
        check('vào được bản đồ bắt đầu', mapState.scene === 'Scene_Map' && mapState.mapId === 10, JSON.stringify(mapState));
        check('bản đồ có nhân vật và spriteset', mapState.party.length > 0 && mapState.spriteset === true, JSON.stringify(mapState));
        check('bản đồ nạp được sự kiện', mapState.events > 0, JSON.stringify(mapState));
        await screenshot('map');

        const moveState = await evalPage(cdp, [
            '(async () => {',
            '  $gamePlayer.reserveTransfer(1, 40, 40, 2, 0);',
            '  await new Promise(function (resolve) { setTimeout(resolve, 6000); });',
            '  const map = $dataMap;',
            '  let spot = null;',
            '  for (let y = 2; y < map.height - 2 && !spot; y += 1) {',
            '    for (let x = 2; x < map.width - 2; x += 1) {',
            '      const passable = [2, 4, 6, 8].every(function (direction) {',
            '        return $gameMap.isPassable(x, y, direction);',
            '      });',
            '      if (passable && $gameMap.eventsXy(x, y).length === 0) {',
            '        spot = { x: x, y: y };',
            '        break;',
            '      }',
            '    }',
            '  }',
            '  if (!spot) return { mapId: $gameMap.mapId(), spot: null, moved: false };',
            '  $gamePlayer.setPosition(spot.x, spot.y);',
            '  await new Promise(function (resolve) { setTimeout(resolve, 250); });',
            '  $gamePlayer.setDirection(2);',
            '  $gamePlayer.moveStraight(2);',
            '  await new Promise(function (resolve) { setTimeout(resolve, 900); });',
            '  return {',
            '    mapId: $gameMap.mapId(),',
            '    spot: spot,',
            '    x: $gamePlayer.x,',
            '    y: $gamePlayer.y,',
            '    moved: $gamePlayer.x !== spot.x || $gamePlayer.y !== spot.y',
            '  };',
            '})()'
        ].join('\n'), true, false);
        check('chuyển được sang bản đồ khác', moveState.mapId === 1, JSON.stringify(moveState));
        check('nhân vật di chuyển được trên bản đồ', moveState.spot !== null && moveState.moved === true, JSON.stringify(moveState));
        await screenshot('move');

        const battleState = await evalPage(cdp, [
            '(async () => {',
            '  const troop = $dataTroops.find(function (item) { return item && item.members && item.members.length > 0; });',
            '  BattleManager.setup(troop.id, true, false);',
            '  SceneManager.push(Scene_Battle);',
            '  await new Promise(function (resolve) { setTimeout(resolve, 4500); });',
            '  const scene = SceneManager._scene;',
            '  const spriteset = scene && scene._spriteset;',
            '  return {',
            '    troopId: troop.id,',
            '    scene: scene && scene.constructor.name,',
            '    members: $gameTroop.members().length,',
            '    actorSprites: spriteset && spriteset._actorSprites ? spriteset._actorSprites.length : 0,',
            '    enemySprites: spriteset && spriteset._enemySprites ? spriteset._enemySprites.length : 0,',
            '    phase: BattleManager._phase',
            '  };',
            '})()'
        ].join('\n'), true, false);
        check('vào được Scene_Battle', battleState.scene === 'Scene_Battle', JSON.stringify(battleState));
        check('trận đấu có quái và sprites', battleState.members > 0 && battleState.enemySprites > 0, JSON.stringify(battleState));
        check('trận đấu có nhân vật và giao diện', battleState.actorSprites > 0 && !!battleState.phase, JSON.stringify(battleState));
        await screenshot('battle');

        // ---------------------------------------------------------
        // 6. Tải lại trang để chứng minh save nằm trong localStorage.
        // ---------------------------------------------------------
        await cdp.send('Page.navigate', { url: url });
        await sleep(800);
        await waitFor(cdp, 'document.querySelector("#fnh-start-button")', 30000, 'overlay sau tải lại');
        await clickStart(cdp);
        await waitFor(cdp, 'window.SceneManager && SceneManager._scene instanceof Scene_Title', 60000, 'Scene_Title sau tải lại');
        await waitFor(cdp, 'FNHBrowser.audioState() === "running"', 15000, 'Web Audio sau tải lại');
        await waitFor(
            cdp,
            'AudioManager._currentBgm && AudioManager._currentBgm.name === "fear_and_hunger" && !!(AudioManager._bgmBuffer && AudioManager._bgmBuffer.isPlaying())',
            20000,
            'nhạc tiêu đề sau tải lại'
        );

        const persistState = await evalPage(cdp, [
            '(() => {',
            '  const exists = StorageManager.exists(' + SAVE_SLOT + ');',
            '  const loaded = DataManager.loadGame(' + SAVE_SLOT + ');',
            '  return {',
            '    exists: exists,',
            '    loaded: loaded,',
            '    variable: $gameVariables.value(123),',
            '    gold: $gameParty.gold(),',
            '    audio: FNHBrowser.audioState(),',
            '    bgm: AudioManager._currentBgm && AudioManager._currentBgm.name',
            '  };',
            '})()'
        ].join('\n'), false, false);
        check('save vẫn còn sau khi tải lại trang', persistState.exists === true && persistState.loaded === true, JSON.stringify(persistState));
        check('save khôi phục đúng dữ liệu sau tải lại', persistState.variable === 4242 && persistState.gold === saveState.goldBefore, JSON.stringify(persistState));
        check('âm thanh vẫn chạy sau tải lại', persistState.audio === 'running' && persistState.bgm === 'fear_and_hunger', JSON.stringify(persistState));

        // Dọn save test khỏi localStorage.
        const removed = await evalPage(cdp, [
            '(() => {',
            '  const prefix = "FNH_WEB:' + namespace + ':";',
            '  const keys = Object.keys(localStorage).filter(function (key) { return key.indexOf(prefix) === 0; });',
            '  keys.forEach(function (key) { localStorage.removeItem(key); });',
            '  return keys.length;',
            '})()'
        ].join('\n'), false, false);
        check('dọn save test khỏi localStorage', removed >= 2, 'đã xoá ' + removed + ' khoá');

        const relevantErrors = runtimeErrors.filter((details) => {
            const urlText = details.url || '';
            const description = details.exception && (details.exception.description || details.exception.value) || '';
            return !/physical_attack_animation/.test(urlText) && !/physical_attack_animation/.test(description);
        });
        const relevantLogs = logErrors.filter((entry) => {
            const text = entry.text || '';
            const urlText = entry.url || '';
            return !/physical_attack_animation/.test(text) && !/physical_attack_animation/.test(urlText);
        });
        check('không có lỗi runtime mới', relevantErrors.length === 0, JSON.stringify(relevantErrors.map((item) => ({
            url: item.url,
            text: item.exception && (item.exception.description || item.exception.value)
        }))));
        check('không có lỗi console mới', relevantLogs.length === 0, JSON.stringify(relevantLogs.map((item) => ({
            text: item.text,
            url: item.url
        }))));

        log('Hoàn tất ' + passed + ' kiểm tra.');
    } catch (error) {
        keepShots = true;
        const failureShot = await screenshot('failure');
        console.error('');
        console.error('THẤT BẠI: ' + error.message);
        if (chromeStderr) console.error('Chrome stderr (cuối):\n' + chromeStderr.slice(-3000));
        if (failureShot) console.error('Ảnh chụp lúc lỗi: ' + failureShot);
        else console.error('Thư mục ảnh chụp: ' + shotsDir);
        console.error('');
        throw error;
    } finally {
        if (cdp && !cdp.closed) {
            try {
                await evalPage(cdp, [
                    '(() => {',
                    '  const prefix = "FNH_WEB:";',
                    '  const keys = Object.keys(localStorage).filter(function (key) {',
                    '    return key.indexOf(prefix) === 0 && key.indexOf(":smoke-") !== -1;',
                    '  });',
                    '  keys.forEach(function (key) { localStorage.removeItem(key); });',
                    '  return keys.length;',
                    '})()'
                ].join('\n'), false, false);
            } catch (error) {}
        }
        if (ws) {
            try { ws.close(); } catch (error) {}
        }
        await stopChrome(chrome);
        if (running) {
            try {
                if (running.server && running.server.closeAllConnections) running.server.closeAllConnections();
                await running.close();
            } catch (error) {}
        }
        if (profile) {
            await sleep(300);
            for (let attempt = 0; attempt < 5; attempt += 1) {
                try {
                    fs.rmSync(profile, { recursive: true, force: true });
                    break;
                } catch (error) {
                    await sleep(300);
                }
            }
        }
        if (!keepShots) {
            try { fs.rmSync(shotsDir, { recursive: true, force: true }); } catch (error) {}
        }
    }
}

main().catch((error) => {
    process.exitCode = 1;
});
