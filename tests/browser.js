'use strict';
/* ============================================================
   Smoke test cho bản Fear & Hunger chạy trên trình duyệt.
   - Khởi động server tạm trên cổng ngẫu nhiên.
   - Dùng Chrome/Chromium hệ thống qua CDP (không cần npm install).
   - Kiểm tra tự vào menu, âm thanh, video, bản đồ, di chuyển,
     lưu/đọc, trận đấu và lưu qua localStorage sau khi tải lại.
   Nếu thiếu source hoặc Chrome, bài test báo lỗi để tránh kết quả xanh giả.
   ============================================================ */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const packageRoot = process.env.FNH_WEB_PACKAGE || path.resolve(__dirname, '../game');
const { findGameRoot, startServer } = require(path.resolve(packageRoot, 'server.js'));

const GAME_HINT = 'game/';
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
        try {
            if (await evalPage(cdp, '!!(' + expression + ')', false, false)) return;
        } catch (error) {
            if (!/Inspected target navigated or closed|Execution context was destroyed|Cannot find context with specified id/.test(error.message)) throw error;
        }
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

async function sendAudioGesture(cdp, type) {
    if (type === 'keyboard') {
        await cdp.send('Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40
        });
        await cdp.send('Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40
        });
    } else {
        await cdp.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: 20, y: 20, button: 'left', clickCount: 1
        });
        await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: 20, y: 20, button: 'left', clickCount: 1
        });
    }
}

async function clickElement(cdp, selector) {
    const point = await evalPage(cdp, `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        const rect = element.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`, false, false);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}

async function main() {
    let gameRoot;
    try {
        gameRoot = findGameRoot(packageRoot);
    } catch (error) {
        throw new Error('Không tìm thấy source trong ' + GAME_HINT + ' hoặc FNH_WEB_PACKAGE: ' + error.message);
    }

    let running = null;
    let chrome = null;
    let profile = null;
    let ws = null;
    let cdp = null;
    let chromeStderr = '';
    let keepShots = process.env.FNH_KEEP_SHOTS === '1';
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
        if (packageRoot) {
            check('máy chủ và dữ liệu đều chạy từ gói độc lập',
                path.resolve(health.gameRoot) === path.resolve(packageRoot));
        }

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
            throw new Error('Không tìm thấy Chrome/Chromium. Đặt CHROME_BIN hoặc cài Chrome để chạy kiểm tra trình duyệt.');
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
        const url = running.url + '?fnh_save_ns=' + encodeURIComponent(namespace);
        log('Mở: ' + url);
        await cdp.send('Page.navigate', { url: url });
        await sleep(800);

        // Menu phải xuất hiện trước bất kỳ tương tác nào; không dựa vào query bỏ intro.
        await waitFor(cdp, 'window.SceneManager && SceneManager._scene instanceof Scene_Title && SceneManager.isCurrentSceneStarted()', 60000, 'menu tự xuất hiện');
        await waitFor(cdp, 'DataManager.isDatabaseLoaded()', 10000, 'nạp database');
        await waitFor(cdp, 'SceneManager._scene._commandWindow.isOpen() && SceneManager._scene._commandWindow.active',
            10000, 'menu mở xong trước tương tác');
        check('menu tự xuất hiện khi chưa bấm phím hoặc chuột', await evalPage(
            cdp, 'SceneManager._scene._commandWindow.isOpen() && SceneManager._scene._commandWindow.active', false, false
        ));
        await screenshot('title-before-input');
        await sendAudioGesture(cdp, 'keyboard');
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
        check('không còn màn hình và nút bắt đầu', await evalPage(
            cdp, '!document.querySelector("#fnh-start-overlay, #fnh-start-button")', false, false
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
        check('âm thanh mở khoá bằng phím trên menu', await evalPage(
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

        await clickElement(cdp, '#fnh-audio-button');
        await waitFor(cdp, 'document.querySelector("#fnh-audio-settings").open', 5000, 'mở cài đặt âm thanh');
        check('nút cài đặt mở đủ năm thanh âm lượng', await evalPage(cdp,
            'document.querySelectorAll("#fnh-audio-settings input[type=range]").length === 5', false, false));
        const audioSettings = { masterVolume: 80, bgmVolume: 37, bgsVolume: 29, meVolume: 43, seVolume: 61 };
        await evalPage(cdp, `(() => {
            const settings = ${JSON.stringify(audioSettings)};
            for (const key of Object.keys(settings)) {
                const slider = document.querySelector('#fnh-' + key);
                slider.value = settings[key];
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                slider.dispatchEvent(new Event('change', { bubbles: true }));
            }
        })()`, false, false);
        check('thanh âm lượng cập nhật nhạc đang phát và âm lượng video', await evalPage(cdp,
            'Math.abs(AudioManager._bgmBuffer.volume - 37 * AudioManager._currentBgm.volume / 10000) < 0.00001 && AudioManager.bgsVolume === 29 && AudioManager.meVolume === 43 && AudioManager.seVolume === 61 && Graphics._video.volume === 0.8', false, false));
        await evalPage(cdp, 'document.querySelector("#fnh-bgmVolume").focus()', false, false);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
        check('kéo về 0 tắt nhạc và phím chỉnh không đổi menu game', await evalPage(cdp,
            'ConfigManager.bgmVolume === 0 && AudioManager._bgmBuffer.volume === 0 && SceneManager._scene instanceof Scene_Title', false, false));
        audioSettings.bgmVolume = 0;
        await screenshot('audio-settings');
        await clickElement(cdp, '#fnh-audio-settings button');
        await waitFor(cdp, '!document.querySelector("#fnh-audio-settings").open && document.activeElement === Graphics._canvas',
            5000, 'đóng cài đặt và trả focus về game');
        check('đóng cài đặt trả bàn phím về khung game', await evalPage(cdp,
            'document.activeElement === Graphics._canvas', false, false));
        // Tiếp tục nghe nhạc để kiểm tra video và gameplay bên dưới.
        await evalPage(cdp, 'ConfigManager.bgmVolume = 37; ConfigManager.save()', false, false);
        audioSettings.bgmVolume = 37;

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
            '  $gameParty.leader().setName("lighthouse");',
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
            '  $gameParty.leader().gainHp(-999999);',
            '  return {',
            '    saved: saved,',
            '    exists: exists,',
            '    info: !!info,',
            '    loaded: loaded,',
            '    cheat: $gameParty.leader().name() === "lighthouse" && $gameParty.leader().hp === $gameParty.leader().mhp,',
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
        check('cheat theo tên vẫn hoạt động sau lưu/đọc', saveState.cheat === true, JSON.stringify(saveState));

        // ---------------------------------------------------------
        // 5. Bản đồ, di chuyển và trận đấu.
        // ---------------------------------------------------------
        const mapState = await evalPage(cdp, [
            '(async () => {',
            '  SceneManager._scene._commandWindow.selectSymbol("newGame");',
            '  SceneManager._scene._commandWindow.processOk();',
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
        check('New Game trên menu mở được phần tạo nhân vật', mapState.scene === 'Scene_Map' && mapState.mapId === 10, JSON.stringify(mapState));
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

        // Đi qua event cửa thật, không chỉ gọi API chuyển map trực tiếp.
        // Tạo lượt chơi từ title: reset dữ liệu ngay trong Scene_Map đang chạy
        // khiến runtime cũ đọc $dataMap đã bị xoá khi chụp nền chuyển scene.
        await evalPage(cdp, 'SceneManager.goto(Scene_Title)', false, false);
        await waitFor(cdp, 'SceneManager._scene instanceof Scene_Title && SceneManager.isCurrentSceneStarted()',
            20000, 'trở về title trước lượt kiểm tra cửa');
        await evalPage(cdp, `(() => {
            DataManager.setupNewGame();
            $gameSwitches.setValue(246, true);
            $gameSwitches.setValue(3480, true);
            $gameVariables.setValue(121, 1);
            $gamePlayer.reserveTransfer(74, 15, 5, 8, 0);
            SceneManager.goto(Scene_Map);
        })()`, false, false);
        await waitFor(cdp, 'SceneManager._scene instanceof Scene_Map && $gameMap.mapId() === 74 && !$gamePlayer.isTransferring() && !$gameMap.isEventRunning()',
            30000, 'cổng ngục sẵn sàng');
        await evalPage(cdp, '$gamePlayer.moveStraight(8)', false, false);
        await waitFor(cdp, '$gameMap.mapId() === 1 && !$gamePlayer.isTransferring() && !$gameMap.isEventRunning()',
            30000, 'đi qua cửa vào ngục');
        check('event cửa thật đưa từ cổng ngục vào map 1', await evalPage(cdp,
            '$gamePlayer.x === 27 && $gamePlayer.y === 68', false, false));
        await screenshot('entrance-to-dungeon');
        await evalPage(cdp, '$gamePlayer.moveStraight(2)', false, false);
        await waitFor(cdp, '$gameMap.mapId() === 74 && !$gamePlayer.isTransferring() && !$gameMap.isEventRunning()',
            30000, 'quay về cổng ngục');
        check('event cửa thật cho phép quay lại map trước', await evalPage(cdp,
            '$gamePlayer.x === 15 && $gamePlayer.y === 5', false, false));

        await evalPage(cdp, '$gameTimer.start(600)', false, false);
        await clickElement(cdp, '#fnh-audio-button');
        await sleep(100);
        const pausedFrames = await evalPage(cdp, '$gameTimer._frames', false, false);
        await sleep(250);
        check('game tạm dừng khi chỉnh âm thanh trên bản đồ', await evalPage(cdp,
            '$gameTimer._frames === ' + pausedFrames + ' && document.querySelector("#fnh-bgmVolume").value === "37"', false, false));
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await waitFor(cdp, '!document.querySelector("#fnh-audio-settings").open && $gameTimer._frames < ' + pausedFrames, 5000, 'Escape đóng cài đặt và tiếp tục game');
        await evalPage(cdp, '$gameTimer.stop()', false, false);

        await evalPage(cdp, `(() => {
            $gameMap._interpreter.setup([
                { code: 101, indent: 0, parameters: ['', 0, 0, 1] },
                { code: 401, indent: 0, parameters: ['Kiểm tra hội thoại ở đáy màn hình.'] },
                { code: 102, indent: 0, parameters: [['Tiếp tục'], -1, 0, 2, 0] },
                { code: 402, indent: 0, parameters: [0, 'Tiếp tục'] },
                { code: 0, indent: 1, parameters: [] },
                { code: 404, indent: 0, parameters: [] },
                { code: 0, indent: 0, parameters: [] }
            ]);
        })()`, false, false);
        await waitFor(cdp, 'SceneManager._scene._messageWindow._choiceWindow.active', 15000, 'hội thoại và lựa chọn');
        check('event yêu cầu thoại giữa vẫn hiện sát đáy vùng game', await evalPage(cdp,
            'Math.abs(SceneManager._scene._messageWindow.y + SceneManager._scene._messageWindow.height - Graphics.boxHeight) < 1', false, false));
        check('lựa chọn nằm phía trên hộp thoại và trong vùng game', await evalPage(cdp,
            'SceneManager._scene._messageWindow._choiceWindow.y >= 0 && SceneManager._scene._messageWindow._choiceWindow.y + SceneManager._scene._messageWindow._choiceWindow.height <= SceneManager._scene._messageWindow.y', false, false));
        await screenshot('dialogue-bottom');
        await evalPage(cdp, 'SceneManager._scene._messageWindow._choiceWindow.processOk()', false, false);
        await waitFor(cdp, '!$gameMessage.isBusy() && !$gameMap.isEventRunning()', 10000, 'đóng hội thoại');

        await evalPage(cdp, `(() => {
            SceneManager.push(Scene_Name);
            SceneManager.prepareNextScene($gameParty.leader().actorId(), 10);
        })()`, false, false);
        await waitFor(cdp, 'SceneManager._scene instanceof Scene_Name && SceneManager.isCurrentSceneStarted()', 10000, 'màn hình nhập tên');
        check('nhập được đầy đủ tên cheat qua cửa sổ đặt tên gốc', await evalPage(cdp, `(() => {
            const edit = SceneManager._scene._editWindow;
            while (edit.back()) {}
            for (const character of 'lighthouse') edit.add(character);
            const complete = edit.name() === 'lighthouse';
            SceneManager._scene.onInputOk();
            return complete;
        })()`, false, false));
        await waitFor(cdp, 'SceneManager._scene instanceof Scene_Map && SceneManager.isCurrentSceneStarted()', 10000, 'trở về map sau đặt tên');
        const cheatState = await evalPage(cdp, `(() => {
            const actor = $gameParty.leader(), normal = new Game_Actor(3);
            actor.gainHp(-999999);
            const damage = actor.hp === actor.mhp && actor.isAlive();
            actor.setHp(0);
            const directHp = actor.hp === actor.mhp && actor.isAlive();
            actor.addState(actor.deathStateId());
            const deathState = !actor.isDeathStateAffected() && actor.isAlive();
            actor.die();
            const directDeath = actor.hp === actor.mhp && actor.isAlive();
            normal.gainHp(-999999);
            const normalDies = normal.isDead();
            normal.setName(' LIGHTHOUSE ');
            const revived = normal.isAlive() && normal.hp === normal.mhp;
            const previousMaxHp = normal.mhp;
            normal.addParam(0, 50);
            const maxHp = normal.mhp > previousMaxHp && normal.hp === normal.mhp;
            normal.setName('lighthous');
            normal.setHp(0);
            const disabled = normal.isDead();
            const enemy = new Game_Enemy(1, 0, 0), comparisons = [];
            for (const type of [1, 2, 3, 4, 5]) {
                const skill = $dataSkills.find(item => item && item.damage.type === type);
                const item = $dataItems.find(item => item && item.damage.type === type);
                if (!skill && !item) throw new Error('Thiếu kỹ năng/vật phẩm kiểm tra loại ' + type);
                const action = new Game_Action(actor);
                if (skill) action.setSkill(skill.id);
                else action.setItem(item.id);
                action.evalDamageFormula = () => type === 3 || type === 4 ? -10 : 10;
                action.applyVariance = value => value;
                actor.setName('D\u2019arce');
                const base = action.makeDamageValue(enemy, false);
                const allyBase = action.makeDamageValue(normal, false);
                actor.setName('lighthouse');
                const boosted = action.makeDamageValue(enemy, false);
                comparisons.push({ type, base, boosted, ally: action.makeDamageValue(normal, false) === allyBase });
            }
            return { damage, directHp, deathState, directDeath, normalDies, revived, maxHp, disabled, comparisons };
        })()`, false, false);
        check('lighthouse bất tử trước sát thương, đặt HP bằng 0, trạng thái chết và die()',
            cheatState.damage && cheatState.directHp && cheatState.deathState && cheatState.directDeath, JSON.stringify(cheatState));
        check('tên khác vẫn chết bình thường; đổi tên bật/tắt cheat ngay',
            cheatState.normalDies && cheatState.revived && cheatState.disabled, JSON.stringify(cheatState));
        check('HP vẫn đầy sau khi chỉ số HP tối đa tăng', cheatState.maxHp, JSON.stringify(cheatState));
        check('chỉ tăng sát thương mất/hút HP lên quái; giữ hồi máu, MP và đồng đội',
            cheatState.comparisons.every(item => item.ally &&
                ([1, 5].includes(item.type) ? item.boosted >= 9999 : item.boosted === item.base)), JSON.stringify(cheatState));

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
        await waitFor(cdp, 'BattleManager.isInputting() && BattleManager.actor()', 20000, 'lượt nhập lệnh chiến đấu');
        await evalPage(cdp, 'SceneManager._scene._actorCommandWindow.selectSymbol("attack"); SceneManager._scene._actorCommandWindow.processOk()', false, false);
        await waitFor(cdp, 'SceneManager._scene._enemyWindow.active', 10000, 'chọn bộ phận khi tấn công');
        check('Guard gốc gồm đủ bảy mục tiêu bộ phận', await evalPage(cdp,
            '$gameTroop.members().length === 7 && $gameTroop.members().every(enemy => enemy.mhp === $dataEnemies[enemy.enemyId()].params[0])', false, false));
        check('tấn công mở chọn bộ phận bằng cửa sổ gốc', await evalPage(cdp,
            'SceneManager._scene._enemyWindow.maxItems() > 1 && BattleManager.inputtingAction().isAttack()', false, false));
        await screenshot('battle-targets');

        // Trận kiểm tra dùng cheat theo tên, kiểm soát tốc độ và độ chính xác;
        // đi qua luồng ra đòn, event chết của Guard, thắng trận và trở về map thật.
        await evalPage(cdp, `(() => {
            const actor = BattleManager.actor(), action = BattleManager.inputtingAction();
            if (actor.name() !== 'lighthouse') throw new Error('Cheat chưa bật cho nhân vật chiến đấu');
            actor.addParam(6, 1000);
            action.itemHit = () => 1;
            action.itemEva = () => 0;
            const targets = SceneManager._scene._enemyWindow;
            const torsoIndex = targets._enemies.indexOf($gameTroop.members()[0]);
            if (torsoIndex < 0) throw new Error('Không tìm thấy thân Guard trong danh sách mục tiêu');
            targets.select(torsoIndex);
            targets.processOk();
        })()`, false, false);
        const battleDeadline = Date.now() + 40000;
        let battleResult;
        while (Date.now() < battleDeadline) {
            battleResult = await evalPage(cdp, `({
                scene: SceneManager._scene.constructor.name,
                turn: $gameTroop.turnCount(), torsoHp: $gameTroop.members()[0].hp,
                message: $gameMessage.isBusy(), inBattle: $gameParty.inBattle()
            })`, false, false);
            if (battleResult.scene === 'Scene_Map' && !battleResult.inBattle) break;
            if (battleResult.message) {
                await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                await sleep(100);
                await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
            }
            await sleep(180);
        }
        check('ra đòn, hạ Guard, thắng trận và quay lại map',
            battleResult.scene === 'Scene_Map' && !battleResult.inBattle && battleResult.torsoHp === 0 && battleResult.turn > 0,
            JSON.stringify(battleResult));

        // ---------------------------------------------------------
        // 6. Tải lại trang để chứng minh save nằm trong localStorage.
        // ---------------------------------------------------------
        await cdp.send('Page.navigate', { url: url });
        await sleep(800);
        await waitFor(cdp, 'window.SceneManager && SceneManager._scene instanceof Scene_Title && SceneManager.isCurrentSceneStarted()', 60000, 'menu tự xuất hiện sau tải lại');
        check('âm lượng được giữ sau khi tải lại trang', await evalPage(cdp,
            'Object.entries(' + JSON.stringify(audioSettings) + ').every(([key, value]) => ConfigManager[key] === value)', false, false));
        check('tải lại vào thẳng menu mà không hiện nút bắt đầu', await evalPage(
            cdp, '!document.querySelector("#fnh-start-overlay, #fnh-start-button") && SceneManager._scene._commandWindow.active', false, false
        ));
        await sendAudioGesture(cdp, 'pointer');
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
            '  $gameParty.leader().setHp(0);',
            '  return {',
            '    exists: exists,',
            '    loaded: loaded,',
            '    cheat: $gameParty.leader().name() === "lighthouse" && $gameParty.leader().isAlive(),',
            '    variable: $gameVariables.value(123),',
            '    gold: $gameParty.gold(),',
            '    audio: FNHBrowser.audioState(),',
            '    bgm: AudioManager._currentBgm && AudioManager._currentBgm.name',
            '  };',
            '})()'
        ].join('\n'), false, false);
        check('save vẫn còn sau khi tải lại trang', persistState.exists === true && persistState.loaded === true, JSON.stringify(persistState));
        check('save khôi phục đúng dữ liệu sau tải lại', persistState.variable === 4242 && persistState.gold === saveState.goldBefore, JSON.stringify(persistState));
        check('cheat hoạt động khi tải save sau khi tải lại trang', persistState.cheat === true, JSON.stringify(persistState));
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

        await cdp.send('Emulation.setUserAgentOverride', {
            userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
        });
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await cdp.send('Page.navigate', { url: url });
        await waitFor(cdp, 'window.SceneManager && SceneManager._scene instanceof Scene_Title && SceneManager.isCurrentSceneStarted()', 60000, 'menu trên điện thoại');
        await sendAudioGesture(cdp, 'pointer');
        await waitFor(cdp, 'FNHBrowser.audioState() === "running" && AudioManager._bgmBuffer && AudioManager._bgmBuffer.isPlaying()', 20000, 'nhạc trên điện thoại');
        check('điện thoại tải và phát OGG có trong dự án', await evalPage(cdp,
            'Utils.isMobileDevice() && AudioManager.audioFileExt() === ".ogg" && AudioManager._bgmBuffer._url.endsWith(".ogg")', false, false));
        await clickElement(cdp, '#fnh-audio-button');
        check('cài đặt vừa màn hình điện thoại', await evalPage(cdp, `(() => {
            const r = document.querySelector('#fnh-audio-settings').getBoundingClientRect();
            return r.left >= 0 && r.top >= 0 && r.right <= visualViewport.width && r.bottom <= visualViewport.height;
        })()`, false, false));
        await screenshot('mobile-audio');
        await clickElement(cdp, '#fnh-audio-settings button');

        // Kiểm tra entry của engine mới trong một document riêng, dùng cùng CDP.
        await cdp.send('Page.navigate', { url: running.url + 'standalone.html' });
        await waitFor(cdp, 'window.FNHStandalonePreview && FNHStandalonePreview.engine.map && document.querySelector("#fnh-status").textContent.startsWith("Map 74")',
            30000, 'preview độc lập tải dữ liệu và vẽ map');
        check('preview không nạp runtime hoặc plugin gốc', await evalPage(cdp, `(() => {
            const scripts = performance.getEntriesByType('resource').filter(item => item.initiatorType === 'script');
            return !window.SceneManager && !window.Game_Actor && !window.$plugins &&
                scripts.length >= 8 && scripts.every(item => {
                    const path = new URL(item.name).pathname;
                    return path.startsWith('/engine/') || path === '/js/libs/pixi.js';
                });
        })()`, false, false));
        check('preview vẽ asset thật trên Canvas', await evalPage(cdp, `(() => {
            const canvas = document.querySelector('#fnh-canvas');
            const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let different = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] !== 8 || pixels[i + 1] !== 7 || pixels[i + 2] !== 6) different++;
            }
            return different > 10000;
        })()`, false, false));
        check('renderer cắt đúng hai khối tileset B–E', await evalPage(cdp, `(async () => {
            const canvas = document.createElement('canvas');
            const renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas, { width: 96, height: 48 });
            const sheet = await renderer.loadImage('img/tilesets/Fortress_B.png');
            const sheets = []; sheets[5] = sheet;
            renderer.drawTile(sheets, 8, 0, 0);
            renderer.drawTile(sheets, 128, 1, 0);
            const reference = document.createElement('canvas');
            reference.width = 96; reference.height = 48;
            const context = reference.getContext('2d');
            context.drawImage(sheet, 0, 48, 48, 48, 0, 0, 48, 48);
            context.drawImage(sheet, 384, 0, 48, 48, 48, 0, 48, 48);
            const actual = canvas.getContext('2d').getImageData(0, 0, 96, 48).data;
            const expected = context.getImageData(0, 0, 96, 48).data;
            return actual.every((value, index) => value === expected[index]);
        })()`, true, false));
        check('camera giữa hai ô vẽ đủ tile và đúng pixel', await evalPage(cdp, `(async () => {
            const source = FNHStandalonePreview.engine;
            const state = new FNHStandaloneState.GameState({ mapId: 74, x: 15, y: 15 }, source.database);
            const map = new FNHStandaloneMap.GameMap({ ...source.map.data, id: 74, events: [], parallaxName: '' }, source.map.tileset, state);
            const screen = new FNHStandaloneScreen.ScreenRuntime(state);
            const engine = { map, state, screen };
            const reference = document.createElement('canvas');
            const full = new FNHStandaloneCanvas.CanvasRenderer(reference, { width: 192, height: 192 });
            screen.screen.mapCamera = { mapId: 74, x: 7, y: 9 };
            await full.draw(engine);
            const canvas = document.createElement('canvas');
            const renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas, { width: 144, height: 144 });
            screen.screen.mapCamera = { mapId: 74, x: 7.5, y: 9.5 };
            await renderer.draw(engine);
            const expected = reference.getContext('2d').getImageData(24, 24, 144, 144).data;
            const actual = canvas.getContext('2d').getImageData(0, 0, 144, 144).data;
            return actual.every((value, index) => value === expected[index]);
        })()`, true, false));
        check('sprite lớn giữ kích thước và nhận diện dấu $', await evalPage(cdp, `(async () => {
            const canvas = document.createElement('canvas');
            const renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas, { width: 400, height: 300 });
            const bitmap = await renderer.loadImage('img/characters/$guard1.png');
            renderer.drawActor([], { x: 3, y: 3, bitmap, image: {
                characterName: '$guard1', characterIndex: 0, pattern: 0, direction: 6
            } }, 0, 0);
            const reference = document.createElement('canvas');
            reference.width = 400; reference.height = 300;
            reference.getContext('2d').drawImage(bitmap, 0, 220, 80, 110, 128, 76, 80, 110);
            const actual = canvas.getContext('2d').getImageData(0, 0, 400, 300).data;
            const expected = reference.getContext('2d').getImageData(0, 0, 400, 300).data;
            return actual.every((value, index) => value === expected[index]);
        })()`, true, false));
        await evalPage(cdp, 'FNHStandalonePreview.engine.random = () => 0; document.querySelector("#fnh-canvas").focus()', false, false);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await waitFor(cdp, '!document.querySelector("#fnh-next").hidden && document.querySelector("#fnh-message-text").textContent.includes("You search the barrel")',
            5000, 'Enter mở hội thoại của thùng phía trước');
        await clickElement(cdp, '#fnh-controls [data-direction="2"]');
        check('hội thoại chờ xác nhận và khóa di chuyển', await evalPage(cdp,
            'FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.engine.state.y === 8 && FNHStandalonePreview.engine.state.itemCount("items", 15) === 0', false, false));
        await clickElement(cdp, '#fnh-next');
        await waitFor(cdp, 'document.querySelector("#fnh-message-text").textContent.includes("Eggs") && !document.querySelector("#fnh-next").hidden',
            5000, 'common event hiển thị vật phẩm');
        await clickElement(cdp, '#fnh-next');
        await waitFor(cdp, '!FNHStandalonePreview.engine.eventRunning', 5000, 'đóng hội thoại thùng đồ');
        await clickElement(cdp, '#fnh-controls [data-direction="0"]');
        await waitFor(cdp, 'document.querySelector("#fnh-message-text").textContent === "Nothing left here." && !document.querySelector("#fnh-next").hidden',
            5000, 'mở thùng lần hai');
        await clickElement(cdp, '#fnh-next');
        await waitFor(cdp, '!FNHStandalonePreview.engine.eventRunning', 5000, 'kết thúc sự kiện lần hai');
        check('engine mới mở thùng đồ thật và không cấp vật phẩm lặp', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.itemCount("items", 15) === 2 && FNHStandalonePreview.engine.state.selfSwitchValue(74, 39, "A")', false, false));
        await clickElement(cdp, '#fnh-save');
        await waitFor(cdp, 'document.querySelector("#fnh-status").textContent.startsWith("Đã lưu")', 5000, 'lưu preview');
        await clickElement(cdp, '#fnh-controls [data-direction="2"]');
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.y === 9', 5000, 'nút di chuyển preview');
        await clickElement(cdp, '#fnh-load');
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.y === 8', 5000, 'tải save preview');

        await evalPage(cdp, `(() => {
            const engine=FNHStandalonePreview.engine;
            window.menuBefore=engine.save();
            engine.state.changeActorHp(1,-50,true); engine.state.gainItem('items',28,1);
        })()`,false,false);
        await clickElement(cdp,'#fnh-menu');
        await waitFor(cdp,'document.querySelector("#fnh-menu-dialog").open',5000,'mở menu độc lập');
        check('menu hiện chỉ số và khóa di chuyển trên bản đồ',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;
            return e.state.scene==='menu' && /HP: 50/.test(document.querySelector('#fnh-menu-content').textContent) && !e.move(2);
        })()`,false,false));
        await clickElement(cdp,'[data-menu-tab="equipment"]');
        check('menu đổi trang bị và trả vật phẩm vào túi',await evalPage(cdp,`(() => {
            const select=document.querySelector('#fnh-menu-content select[data-slot="0"]');
            select.value='0';select.dispatchEvent(new Event('change',{bubbles:true}));
            return FNHStandalonePreview.engine.state.itemCount('weapons',44)===1;
        })()`,false,false));
        await clickElement(cdp,'[data-menu-tab="inventory"]');
        await clickElement(cdp,'#fnh-menu-content button[data-item="28"]');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.itemCount("items",9)===(window.menuBefore.inventory.items[9]||0)+1 && !document.querySelector("#fnh-menu-dialog").open',5000,'dùng vial và trả vỏ chai');
        check('dùng vật phẩm trong menu hồi HP và chạy common event thật',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.actor(1).hp===70 && FNHStandalonePreview.engine.state.itemCount("items",28)===(window.menuBefore.inventory.items[28]||0)',false,false));
        await clickElement(cdp,'#fnh-menu'); await clickElement(cdp,'[data-menu-tab="system"]');
        await clickElement(cdp,'#fnh-menu-save');
        check('lưu từ menu tạo checkpoint trở về bản đồ',await evalPage(cdp,
            'JSON.parse(localStorage.getItem("FNH_STANDALONE_PREVIEW:1")).state.scene==="map"',false,false));
        await clickElement(cdp,'#fnh-menu-close');
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(window.menuBefore).then(()=>true)',true,false);
        await evalPage(cdp,`(async()=>{
            const engine=FNHStandalonePreview.engine;
            const running=engine.createInterpreter([{code:351},{code:121,parameters:[6240,6240,0]}],0).run();
            window.menuEvent=running;
        })()`,true,false);
        await waitFor(cdp,'document.querySelector("#fnh-menu-dialog").open',5000,'lệnh 351 mở menu');
        check('351 chờ người chơi đóng menu',await evalPage(cdp,'!FNHStandalonePreview.engine.state.switchValue(6240)',false,false));
        await clickElement(cdp,'#fnh-menu-close');
        await evalPage(cdp,'window.menuEvent',true,false);
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(window.menuBefore).then(()=>true)',true,false);
        await evalPage(cdp,'delete window.menuBefore;delete window.menuEvent',false,false);
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;window.menuSkillBefore=e.save();e.state.addActor(3);
            [1,3].forEach(id=>{e.state.recoverActor(id);e.state.changeActorHp(id,-80,true);});
            [151,238,189,218].forEach(id=>e.state.changeActorSkill(1,id,true));
            e.state.gainItem('items',31,1);e.battle.random=()=>0.5;
        })()`,false,false);
        await clickElement(cdp,'#fnh-menu'); await clickElement(cdp,'[data-menu-tab="skills"]');
        await evalPage(cdp,`(() => {
            const caster=document.querySelector('#fnh-menu-actor');caster.value='1';caster.dispatchEvent(new Event('change',{bubbles:true}));
            const target=document.querySelector('#fnh-menu-skill-target');target.value='3';target.dispatchEvent(new Event('change',{bubbles:true}));
        })()`,false,false);
        check('menu kỹ năng phân biệt caster/mục tiêu và khóa kỹ năng chỉ trong trận',await evalPage(cdp,
            `document.querySelector('#fnh-menu-actor').value==="1" && document.querySelector('#fnh-menu-skill-target').value==="3" && document.querySelector('button[data-skill="218"]').disabled`,false,false));
        await clickElement(cdp,'button[data-skill="238"]');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.actor(3).hp===100',5000,'Loving whispers hồi đồng đội');
        check('menu dùng kỹ năng hồi một mục tiêu và chỉ trừ MP caster',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;
            return e.state.scene==='menu' && e.state.actor(1).hp===20 && e.state.actor(1).mp===70 && e.state.actor(3).mp===100 &&
                document.querySelector('button[data-skill="238"]').disabled;
        })()`,false,false));
        await clickElement(cdp,'button[data-skill="151"]');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.actor(1).mp===40',5000,'Healing whispers hồi cả đội');
        check('menu giữ mở sau hồi phục và cập nhật HP cả đội',await evalPage(cdp,
            'document.querySelector("#fnh-menu-dialog").open && FNHStandalonePreview.engine.state.actor(1).hp===56 && FNHStandalonePreview.engine.state.actor(3).hp===100',false,false));
        await clickElement(cdp,'button[data-skill="189"]');
        await waitFor(cdp,'document.querySelectorAll("#fnh-choices button").length===2 && !document.querySelector("#fnh-menu-dialog").open',5000,'kỹ năng chuyển hóa mở lựa chọn JSON');
        await clickElement(cdp,'#fnh-choices button:first-child');
        await waitFor(cdp,'!document.querySelector("#fnh-next").hidden && document.querySelector("#fnh-message-text").textContent.includes("successful")',5000,'chuyển hóa xong');
        await clickElement(cdp,'#fnh-next');
        await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning',5000,'common event kỹ năng xong');
        check('kỹ năng menu chạy common event thật và trừ MP một lần',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.actor(1).mp===25 && FNHStandalonePreview.engine.state.itemCount("items",31)===(window.menuSkillBefore.inventory.items[31]||0)+3 && FNHStandalonePreview.engine.state.scene==="map"',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(window.menuSkillBefore).then(()=>true)',true,false);
        await evalPage(cdp,'delete window.menuSkillBefore',false,false);
        await evalPage(cdp,`(() => {
            const engine=FNHStandalonePreview.engine;window.bookBefore=engine.save();engine.state.gainItem('items',40,1);
        })()`,false,false);
        await clickElement(cdp,'#fnh-menu'); await clickElement(cdp,'[data-menu-tab="inventory"]');
        await clickElement(cdp,'#fnh-menu-content button[data-item="40"]');
        for(let i=0;i<8;i++) {
            await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="save" || !document.querySelector("#fnh-next").hidden',5000,'đọc sách lưu game');
            if(await evalPage(cdp,'FNHStandalonePreview.engine.state.scene==="save"',false,false)) break;
            await clickElement(cdp,'#fnh-next');
        }
        await waitFor(cdp,'document.querySelector("#fnh-menu-dialog").open && !document.querySelector("#fnh-menu-save").disabled',5000,'sách mở màn lưu');
        await clickElement(cdp,'#fnh-menu-save');
        check('sách lưu game giữ stack common event trong save',await evalPage(cdp,
            'JSON.parse(localStorage.getItem("FNH_STANDALONE_PREVIEW:1")).state.pendingEventStack.length===2',false,false));
        await clickElement(cdp,'#fnh-menu-close');
        for(let i=0;i<4;i++) {
            await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning || !document.querySelector("#fnh-next").hidden',5000,'đọc phần kết của sách');
            if(await evalPage(cdp,'!FNHStandalonePreview.engine.eventRunning',false,false)) break;
            await clickElement(cdp,'#fnh-next');
        }
        await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning',5000,'sách dọn hiệu ứng');
        await clickElement(cdp,'#fnh-load');
        for(let i=0;i<4;i++) {
            await waitFor(cdp,'!document.querySelector("#fnh-next").hidden || !FNHStandalonePreview.engine.state.switchValue(3350)',5000,'tiếp tục sách từ save');
            if(await evalPage(cdp,'!FNHStandalonePreview.engine.state.switchValue(3350)',false,false)) break;
            await clickElement(cdp,'#fnh-next');
        }
        await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning',5000,'tải save chạy xong common event');
        check('tải sách tiếp tục hội thoại và dọn picture/switch đúng một lần',await evalPage(cdp,
            '!FNHStandalonePreview.engine.state.screen.pictures[1] && !FNHStandalonePreview.engine.state.switchValue(3350) && FNHStandalonePreview.engine.state.itemCount("items",40)===(window.bookBefore.inventory.items[40]||0)',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(window.bookBefore).then(()=>true)',true,false);
        await evalPage(cdp,'delete window.bookBefore',false,false);
        await evalPage(cdp,`(() => {
            const engine=FNHStandalonePreview.engine;
            window.skillUiBefore=engine.save();
            const enemyId=engine.database.Enemies.length,troopId=engine.database.Troops.length;
            engine.database.Enemies.push({...engine.database.Enemies[1],id:enemyId,actions:[]});
            engine.database.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400,hidden:false}]});
            engine.battle.setup(troopId,true,true);engine.state.scene='battle';
        })()`,false,false);
        await waitFor(cdp,'!document.querySelector("#fnh-battle").hidden',5000,'mở trận để kiểm tra chọn kỹ năng');
        await clickElement(cdp,'#fnh-battle-use-skill');
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===1 && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'dùng Guard từ danh sách kỹ năng');
        check('giao diện chọn kỹ năng thực thi Guard và hết state cuối lượt',await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.lastAction.skillId===2 && !FNHStandalonePreview.engine.state.actor(1).states.includes(2)',false,false));
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;e.state.changeActorHp(1,-50,true);e.battle.syncActors();
            window.beforeBattleItemHp=e.state.actor(1).hp;window.beforeBattleBottles=e.state.itemCount('items',9);
            e.state.gainItem('items',28,1);
            const kind=document.querySelector('#fnh-battle-kind');kind.value='item';kind.dispatchEvent(new Event('change',{bubbles:true}));
            const items=document.querySelector('#fnh-battle-item');items.value='28';items.dispatchEvent(new Event('change',{bubbles:true}));
        })()`,false,false);
        await clickElement(cdp,'#fnh-battle-friends button[data-index="0"]');
        await clickElement(cdp,'#fnh-battle-use-item');
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===2 && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'dùng Blue vial trong trận');
        check('UI vật phẩm chiến đấu hồi HP, trả chai và dùng hết một item',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;
            return e.state.actor(1).hp===window.beforeBattleItemHp+20 && e.state.itemCount('items',9)===window.beforeBattleBottles+1 && e.battle.battle.lastAction.itemId===28;
        })()`,false,false));
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;e.state.gainItem('items',10,1);
            document.querySelector('#fnh-battle-kind').dispatchEvent(new Event('change',{bubbles:true}));
            const items=document.querySelector('#fnh-battle-item');items.value='10';items.dispatchEvent(new Event('change',{bubbles:true}));
        })()`,false,false);
        await clickElement(cdp,'#fnh-battle-use-item');
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===3 && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'vial gây cháy chờ animation xong');
        check('UI item tấn công dùng JSON và hiện tên trong log',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;
            return e.battle.battle.lastAction.itemId===10 && e.state.itemCount('items',10)===0 &&
                e.battle.enemy(0).hp<e.battle.enemy(0).mhp && document.querySelector('#fnh-battle-log').textContent.includes('Murky vial');
        })()`,false,false));
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;e.state.addActor(3);e.syncBattleActors();
            e.battle.enemy(0).hp=e.battle.enemy(0).mhp;
            e.state.gainItem('items',28,1-e.state.itemCount('items',28));
            const actors=document.querySelector('#fnh-battle-actor');
            actors.dispatchEvent(new Event('change',{bubbles:true}));
            const kind=document.querySelector('#fnh-battle-kind');kind.value='item';kind.dispatchEvent(new Event('change',{bubbles:true}));
            const items=document.querySelector('#fnh-battle-item');items.value='28';items.dispatchEvent(new Event('change',{bubbles:true}));
        })()`,false,false);
        await clickElement(cdp,'#fnh-battle-use-item');
        check('chọn lệnh chưa tiêu item và chờ đủ đồng đội',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;
            return e.battle.battle.turn===3 && e.state.itemCount('items',28)===1 && e.battle.battle.inputActions.length===1 &&
                document.querySelector('#fnh-battle-start').disabled && document.querySelector('#fnh-battle-actor').value==='3';
        })()`,false,false));
        await clickElement(cdp,'#fnh-battle-use-item');
        check('UI giữ chỗ vật phẩm chung cả đội',await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.inputActions.length===1 && document.querySelector("#fnh-status").textContent.includes("Không đủ vật phẩm")',false,false));
        await evalPage(cdp,`(() => {
            const kind=document.querySelector('#fnh-battle-kind');kind.value='skill';kind.dispatchEvent(new Event('change',{bubbles:true}));
            const skill=document.querySelector('#fnh-battle-skill');skill.value='2';skill.dispatchEvent(new Event('change',{bubbles:true}));
        })()`,false,false);
        await clickElement(cdp,'#fnh-battle-use-skill');
        check('UI cho xem đủ lệnh cả đội trước khi bắt đầu',await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.inputActions.length===2 && !document.querySelector("#fnh-battle-start").disabled && document.querySelector("#fnh-battle-queue").textContent.includes("Blue vial")',false,false));
        await clickElement(cdp,'#fnh-battle-queue button[data-actor="1"]');
        check('bỏ chọn lệnh không mất item và khóa bắt đầu',await evalPage(cdp,
            'document.querySelector("#fnh-battle-start").disabled && FNHStandalonePreview.engine.state.itemCount("items",28)===1',false,false));
        await clickElement(cdp,'#fnh-battle-attack');
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===4 && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'cả đội thực hiện đúng một lượt');
        check('thực thi hai nhân vật chỉ tăng lượt một lần và dọn danh sách',await evalPage(cdp,`(() => {
            const b=FNHStandalonePreview.engine.battle.battle;
            return b.turnActions.length===2 && b.turnActions[0].subjectId===3 && b.turnActions[0].skillId===2 &&
                b.turnActions[1].subjectId===1 && b.inputActions.length===0;
        })()`,false,false));
        await evalPage(cdp,'delete window.beforeBattleItemHp;delete window.beforeBattleBottles',false,false);
        await evalPage(cdp,`(async()=>{
            const engine=FNHStandalonePreview.engine;engine.battle.finish('escape');engine.leaveBattle('escape');
            await engine.restore(window.skillUiBefore);delete window.skillUiBefore;
        })()`,true,false);
        await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine;
            const page = engine.map.eventPage(engine.map.eventById(39));
            window.battleOriginalPage = { page, list: page.list };
            page.list = [
                { code: 301, indent: 0, parameters: [0, 1, true, true] },
                { code: 601, indent: 0, parameters: [] },
                { code: 122, indent: 1, parameters: [999, 999, 0, 0, 10] },
                { code: 602, indent: 0, parameters: [] },
                { code: 122, indent: 1, parameters: [999, 999, 0, 0, 20] },
                { code: 603, indent: 0, parameters: [] },
                { code: 122, indent: 1, parameters: [999, 999, 0, 0, 30] },
                { code: 604, indent: 0, parameters: [] }
            ];
            window.battleOriginalActor = JSON.parse(JSON.stringify(engine.state.actor(1)));
            window.battleActorParams = engine.state.actor(1).paramPlus.slice();
            engine.state.changeActorParam(1, 2, -40); // Giữ trận đủ dài để kiểm tra nhánh chạy thoát.
            engine.battle.random = () => 0.75;
        })()`, false, false);
        await clickElement(cdp, '#fnh-controls [data-direction="0"]');
        await waitFor(cdp, '!document.querySelector("#fnh-battle").hidden && FNHStandalonePreview.engine.battle.battle.phase === "input"',
            5000, 'event mở giao diện battle và chạy xong page đầu trận');
        check('troop Guard chạy page đầu trận và common event thật', await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine;
            const valid = engine.battle.enemy(0).states.includes(91) && engine.battle.battle.eventFlags.once[5] &&
                /guard/i.test(engine.state.screen.gab.text);
            engine.screen.clearGabs();
            return !!valid;
        })()`, false, false));
        check('renderer battle ghép đủ bộ phận Guard từ PNG thật', await evalPage(cdp, `(async () => {
            const engine = FNHStandalonePreview.engine;
            const canvas = document.createElement('canvas');
            const renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas);
            await renderer.draw(engine);
            const reference = document.createElement('canvas'); reference.width = 816; reference.height = 624;
            const context = reference.getContext('2d'); context.imageSmoothingEnabled = false;
            context.fillStyle = '#000'; context.fillRect(0, 0, 816, 624);
            const background = await renderer.loadImage('img/battlebacks2/front.png');
            context.drawImage(background, (816 - background.width) / 2, (624 - background.height) / 2);
            const enemies = engine.battle.battle.enemies.slice().sort((a, b) => a.y - b.y || a.index - b.index);
            for (const enemy of enemies) {
                const bitmap = await renderer.loadImage('img/enemies/' + enemy.battlerName + '.png');
                context.drawImage(bitmap, enemy.x - bitmap.width / 2, enemy.y - bitmap.height);
            }
            window.battleExpectedPixels = context.getImageData(0, 0, 816, 624).data;
            const actual = canvas.getContext('2d').getImageData(0, 0, 816, 624).data;
            return actual.every((value, index) => value === battleExpectedPixels[index]);
        })()`, true, false));
        await waitFor(cdp, `(() => {
            const pixels = document.querySelector('#fnh-canvas').getContext('2d').getImageData(0, 0, 816, 624).data;
            return pixels.every((value, index) => value === battleExpectedPixels[index]);
        })()`, 5000, 'chuyển scene tự vẽ battle trên canvas chính');
        check('UI battle hiển thị HP và MP của nhân vật', await evalPage(cdp,
            'document.querySelector("#fnh-battle-party").textContent.includes("HP") && document.querySelector("#fnh-battle-party").textContent.includes("MP")', false, false));
        check('battle bỏ sprite bộ phận ẩn và đã chết', await evalPage(cdp, `(async () => {
            const original = FNHStandalonePreview.engine;
            const battle = JSON.parse(JSON.stringify(original.battle.battle));
            battle.enemies[1].hidden = true; battle.enemies[1].battlerName = 'khong-ton-tai';
            battle.enemies[2].alive = false; battle.enemies[2].battlerName = 'khong-ton-tai';
            const engine = Object.assign(Object.create(original), { battle: { battle } });
            const canvas = document.createElement('canvas');
            const renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas);
            const result = await renderer.draw(engine);
            return result.enemies === 5 && !renderer.images.has('img/enemies/khong-ton-tai.png');
        })()`, true, false));
        await evalPage(cdp, 'delete window.battleExpectedPixels', false, false);
        check('337 vẽ sprite sheet tại quái, phản chiếu và flash đúng alpha', await evalPage(cdp, `(async () => {
            const original = FNHStandalonePreview.engine;
            const engine = new FNHStandaloneEngine.GameEngine({ dataStore: original.dataStore, onRouteEffect: () => true });
            await engine.boot({ mapId: 74, x: 8, y: 8, party: [1] });
            engine.battle.setup(1); engine.state.scene = 'battle';
            engine.screen.screen.battlebacks = ['', 'front'];
            const canvas = document.createElement('canvas'), renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas);
            await renderer.draw(engine);
            const base = canvas.getContext('2d').getImageData(0,0,816,624).data;
            await engine.createInterpreter([{code:337,parameters:[0,7,false]}],0).run();
            engine.advanceRoutes(8); await renderer.draw(engine);
            const actual = canvas.getContext('2d').getImageData(0,0,816,624).data;
            if (!actual.some((v,i) => v !== base[i])) return false;
            const sheet = document.createElement('canvas'); sheet.width = 192; sheet.height = 192;
            const ctx = sheet.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0,0,96,192);
            const cell = {entry:{elapsed:0,mirror:true},data:{frames:[[[0,20,0,100,0,false,255,0]]]},first:sheet};
            const test = document.createElement('canvas'), draw = new FNHStandaloneCanvas.CanvasRenderer(test,{width:384,height:384});
            draw.drawAnimationCells(cell,192,192);
            const pixel = (x,y) => Array.from(draw.context.getImageData(x,y,1,1).data);
            if (pixel(200,192)[0] !== 255 || pixel(100,192)[3] !== 0) return false;
            draw.context.clearRect(0,0,384,384);
            draw.context.fillStyle = '#000'; draw.context.fillRect(0,0,384,384);
            draw.drawBattlerFlash(sheet,0,0,{color:[0,255,0,255],remaining:4,duration:4});
            if (pixel(20,20)[1] !== 255 || pixel(100,20)[1] !== 0) return false;
            engine.animations.dispose(); return true;
        })()`, true, false));
        check('339 chờ animation quái và common event trước lệnh tiếp', await evalPage(cdp, `(async () => {
            const source = FNHStandalonePreview.engine;
            const engine = new FNHStandaloneEngine.GameEngine({dataStore:source.dataStore,random:()=>0.75,onRouteEffect:()=>true});
            await engine.boot({mapId:74,x:8,y:8,party:[1]});
            engine.battle.setup(1); engine.state.scene='battle';
            let done=false;
            const running=engine.createInterpreter([{code:339,parameters:[0,1,19,-1]},
                {code:121,parameters:[6220,6220,0]}],0).run().then(()=>{done=true;});
            await new Promise(resolve=>setTimeout(resolve,0));
            if(done || engine.state.switchValue(6220) || engine.battle.battle.phase!=='action') return false;
            for(let i=0;i<1000&&!done;i++){engine.advanceRoutes(8);await new Promise(resolve=>setTimeout(resolve,0));}
            await running;
            const canvas=document.createElement('canvas'), renderer=new FNHStandaloneCanvas.CanvasRenderer(canvas);
            engine.animations.startBattle(1,14,true,'actor'); engine.advanceRoutes(8);
            await renderer.draw(engine);
            engine.animations.dispose();
            return done && engine.state.switchValue(6220) && engine.battle.battle.phase==='input';
        })()`,true,false));
        check('AI dùng kỹ năng JSON và common event thay đòn đánh cố định', await evalPage(cdp, `(async () => {
            const source = FNHStandalonePreview.engine;
            const engine = new FNHStandaloneEngine.GameEngine({dataStore:source.dataStore,random:()=>0.75,onRouteEffect:()=>true});
            await engine.boot({mapId:74,x:8,y:8,party:[1]});
            const enemyId=engine.database.Enemies.length, troopId=engine.database.Troops.length;
            engine.database.Enemies.push({...engine.database.Enemies[1],id:enemyId,
                actions:[{conditionType:0,rating:5,skillId:7}]});
            engine.database.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400,hidden:false}]});
            engine.battle.setup(troopId); engine.state.scene='battle';
            engine.battle.battle.managed=true;
            const hp=engine.state.actor(1).hp;
            await engine.runEnemyTurn();
            return engine.battle.battle.lastAction.skillId===7 && engine.state.switchValue(16) && engine.state.actor(1).hp===hp;
        })()`,true,false));
        check('event độc lập điều khiển quái và giữ thay đổi qua save', await evalPage(cdp, `(async () => {
            const source = FNHStandalonePreview.engine;
            const engine = new FNHStandaloneEngine.GameEngine({ dataStore: source.dataStore });
            await engine.boot({ mapId: 74, x: 8, y: 8, direction: 8, party: [1] });
            engine.battle.setup(1, true, true);
            await engine.createInterpreter([
                { code: 331, parameters: [0, 1, 0, 50, true] },
                { code: 333, parameters: [1, 0, 1] },
                { code: 336, parameters: [2, 484] },
                { code: 122, parameters: [500, 500, 0, 3, 4, 0, 0] }
            ], 0).run();
            const snapshot = engine.save(); await engine.restore(snapshot);
            return engine.battle.enemy(0).hp === 1250 && !engine.battle.enemy(1).alive &&
                engine.battle.enemy(1).states.includes(1) && engine.battle.enemy(2).enemyId === 484 &&
                engine.state.variableValue(500) === 1250;
        })()`, true, false));
        check('event chờ battle và chưa chạy nhánh kết quả', await evalPage(cdp,
            'FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.engine.state.variableValue(999) === 0', false, false));
        await clickElement(cdp, '#fnh-controls [data-direction="2"]');
        check('battle khóa nút di chuyển trên map', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.y === 8', false, false));
        await clickElement(cdp, '#fnh-battle-attack');
        await clickElement(cdp, '#fnh-battle-start');
        await waitFor(cdp, 'FNHStandalonePreview.engine.battle.battle.turn === 1', 5000, 'đánh khi event vẫn đang chờ');
        check('nút đánh hoạt động trong event đang chờ battle', await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.enemy(0).hp < FNHStandalonePreview.engine.battle.enemy(0).mhp', false, false));
        await waitFor(cdp, 'FNHStandalonePreview.engine.battle.battle.phase === "input"', 10000, 'chờ kỹ năng và page cuối lượt');
        await evalPage(cdp, 'FNHStandalonePreview.engine.battle.random = () => 0', false, false);
        await clickElement(cdp, '#fnh-battle-escape');
        await waitFor(cdp, '!FNHStandalonePreview.engine.eventRunning && document.querySelector("#fnh-battle").hidden',
            5000, 'thoát battle và tiếp tục event');
        check('chạy đúng nhánh thoát và trở lại map', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.scene === "map" && FNHStandalonePreview.engine.state.variableValue(999) === 20', false, false));
        await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine;
            engine.state.actor(1).paramPlus = window.battleActorParams; delete window.battleActorParams;
            engine.state.recoverActor(1); engine.state.setVariable(999, 0);
            const page = engine.database.Troops[1].pages[5];
            window.originalTroopStart = page.list;
            page.list = [{ code: 230, parameters: [60] }, ...page.list];
        })()`, false, false);
        await clickElement(cdp, '#fnh-controls [data-direction="0"]');
        await waitFor(cdp, '!document.querySelector("#fnh-battle").hidden && FNHStandalonePreview.engine.battle.battle.phase === "events"',
            5000, 'page đầu trận chờ theo frame');
        check('page đang chờ khóa cả đánh và chạy thoát', await evalPage(cdp,
            'document.querySelector("#fnh-battle-attack").disabled && document.querySelector("#fnh-battle-escape").disabled', false, false));
        await waitFor(cdp, 'FNHStandalonePreview.engine.battle.battle.phase === "input" && !document.querySelector("#fnh-battle-attack").disabled',
            5000, 'page đầu trận chạy xong mới nhận lệnh');
        await evalPage(cdp, `FNHStandalonePreview.engine.database.Troops[1].pages[5].list = originalTroopStart;
            FNHStandalonePreview.engine.battle.random = () => 0.75;
            delete window.originalTroopStart;`, false, false);
        await clickElement(cdp, '#fnh-battle-targets [data-index="1"]');
        await clickElement(cdp, '#fnh-battle-attack');
        await clickElement(cdp, '#fnh-battle-start');
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.scene === "map" && !FNHStandalonePreview.engine.eventRunning && document.querySelector("#fnh-battle").hidden',
            5000, 'page hạ đầu Guard kết thúc trận thật');
        check('hạ đầu Guard chạy troop event và nhánh thắng của map', await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.result === "victory" && FNHStandalonePreview.engine.state.switchValue(23) && FNHStandalonePreview.engine.state.variableValue(999) === 10 && FNHStandalonePreview.engine.battle.battle.enemies.every(enemy => !enemy.alive)', false, false));
        await evalPage(cdp, 'FNHStandalonePreview.engine.screen.clearGabs()', false, false);
        await evalPage(cdp, `battleOriginalPage.page.list = battleOriginalPage.list;
            FNHStandalonePreview.engine.state.actors[1] = window.battleOriginalActor; delete window.battleOriginalActor;
            FNHStandalonePreview.engine.state.recoverActor(1); delete window.battleOriginalPage;`, false, false);
        await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine;
            const list = engine.database.CommonEvents[310].list;
            const start = list.findIndex(command => command.code === 105);
            let end = start + 1;
            while (list[end] && list[end].code === 405) end++;
            const page = engine.map.eventPage(engine.map.eventById(39));
            window.creditsOriginal = { page, list: page.list, runEvent: engine.runEvent };
            window.creditsController = new AbortController();
            engine.runEvent = function (id, handlers) { return creditsOriginal.runEvent.call(this, id, handlers, creditsController.signal); };
            page.list = [...list.slice(start, end),
                { code: 121, parameters: [997, 997, 0] },
                { code: 105, parameters: [1, true] }, { code: 405, parameters: ['Không chạy nhanh'] },
                { code: 121, parameters: [998, 998, 0] }];
        })()`, false, false);
        await clickElement(cdp, '#fnh-controls [data-direction="0"]');
        await waitFor(cdp, '!document.querySelector("#fnh-scroll-text").hidden && document.querySelector("#fnh-scroll-content").getAnimations().length > 0',
            5000, 'mở chữ chạy credits thật');
        check('credits thật đang chạy và event chờ hoàn tất', await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine;
            const content = document.querySelector('#fnh-scroll-content');
            return engine.eventRunning && engine.messageRunning && !engine.state.switchValue(997) &&
                content.textContent.includes('CREDITS') && content.textContent.includes('Miro') &&
                content.getAnimations()[0].effect.getTiming().duration > 10000;
        })()`, false, false));
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
        await waitFor(cdp, 'document.querySelector("#fnh-scroll-content").getAnimations()[0].playbackRate === 3',
            5000, 'giữ Shift tăng tốc credits');
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
        await waitFor(cdp, 'document.querySelector("#fnh-scroll-content").getAnimations()[0].playbackRate === 1',
            5000, 'nhả Shift trả tốc độ gốc');
        check('chữ credits dịch chuyển theo animation trình duyệt', await evalPage(cdp,
            'document.querySelector("#fnh-scroll-content").getAnimations()[0].currentTime > 0', false, false));
        await evalPage(cdp, 'document.querySelector("#fnh-scroll-content").getAnimations()[0].finish()', false, false);
        await waitFor(cdp, 'document.querySelector("#fnh-scroll-content").textContent === "Không chạy nhanh"',
            5000, 'credits hết cho event chạy tiếp');
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
        await new Promise(resolve => setTimeout(resolve, 100));
        check('cờ cấm tua nhanh được giữ đúng', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.switchValue(997) && document.querySelector("#fnh-scroll-fast").hidden && document.querySelector("#fnh-scroll-content").getAnimations()[0].playbackRate === 1', false, false));
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
        await evalPage(cdp, 'creditsController.abort()', false, false);
        await waitFor(cdp, '!FNHStandalonePreview.engine.eventRunning && document.querySelector("#fnh-scroll-text").hidden',
            5000, 'hủy event đóng chữ chạy');
        check('hủy credits giải phóng UI và không chạy lệnh sau', await evalPage(cdp,
            '!FNHStandalonePreview.engine.messageRunning && !FNHStandalonePreview.engine.state.switchValue(998) && document.querySelector("#fnh-scroll-content").getAnimations().length === 0', false, false));
        await evalPage(cdp, `creditsOriginal.page.list = creditsOriginal.list;
            FNHStandalonePreview.engine.runEvent = creditsOriginal.runEvent;
            delete window.creditsOriginal; delete window.creditsController;`, false, false);
        check('save preview khôi phục vị trí, vật phẩm và trạng thái thùng', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.itemCount("items", 15) === 2 && FNHStandalonePreview.engine.state.selfSwitchValue(74, 39, "A")', false, false));
        await evalPage(cdp, 'localStorage.removeItem("FNH_STANDALONE_PREVIEW:1")', false, false);
        await evalPage(cdp, `FNHStandalonePreview.engine.restore(Object.assign(FNHStandalonePreview.engine.save(), {
            mapId: 74, x: 15, y: 5, direction: 8
        })).then(() => true)`, true, false);
        await clickElement(cdp, '#fnh-controls [data-direction="8"]');
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.mapId === 1 && document.querySelector("#fnh-status").textContent.startsWith("Map 1 ·")',
            15000, 'bước qua cửa thật bằng nút lên của preview');
        check('engine độc lập chạy common event và chuyển vào ngục', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.x === 27 && FNHStandalonePreview.engine.state.y === 68 && FNHStandalonePreview.engine.state.variableValue(30) === 100', false, false));
        await clickElement(cdp, '#fnh-controls [data-direction="2"]');
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.mapId === 74 && document.querySelector("#fnh-status").textContent.startsWith("Map 74 ·")',
            15000, 'cửa thật quay lại cổng ngục');
        check('cửa preview hai chiều giữ vị trí quái sau khi quay lại', await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine, enemy = engine.map.eventById(102);
            return engine.state.x === 15 && engine.state.y === 5 && enemy.x === 14 && enemy.y === 25;
        })()`, false, false));
        check('script đổi hình và giới hạn HP giữ qua lưu/tải độc lập', await evalPage(cdp, `(async () => {
            const engine = FNHStandalonePreview.engine;
            FNHStandaloneScripts.executeScript("$gameActors.actor(1).setCharacterImage('mercenary3', 7);\\n$gameActors.actor(1).setMaxHp(30);", { state: engine.state });
            await engine.restore(engine.save());
            engine.state.recoverActor(1);
            const actor = engine.state.actor(1);
            return actor.characterName === 'mercenary3' && actor.characterIndex === 7 && actor.hp === 30;
        })()`, true, false));
        await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine;
            engine.applyRoute([-1, { wait: false, list: [
                { code: 37 }, { code: 3 }, { code: 15, parameters: [3] },
                { code: 41, parameters: ['$guard1', 0] }, { code: 42, parameters: [128] },
                { code: 38 }, { code: 27, parameters: [12] }, { code: 0 }
            ] }], { mapId: 74 });
        })()`, false, false);
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.switchValue(12) && FNHStandalonePreview.engine.movement.jobs.size === 0',
            5000, 'route chạy qua animation frame và hoàn tất');
        check('movement route chạy theo frame và đổi hình thật trên preview', await evalPage(cdp, `(() => {
            const state = FNHStandalonePreview.engine.state;
            return state.x === 16 && state.y === 5 && state.characterName === '$guard1' && state.opacity === 128 && !state.through;
        })()`, false, false));
        check('lệnh tọa độ đọc vị trí thật của người chơi và sự kiện', await evalPage(cdp, `(async () => {
            const engine = FNHStandalonePreview.engine;
            await engine.createInterpreter([
                { code: 122, parameters: [5005,5005,0,3,5,-1,0] },
                { code: 122, parameters: [5006,5006,0,3,5,102,1] }
            ], 39).run();
            return engine.state.variableValue(5005) === engine.state.x && engine.state.variableValue(5006) === engine.map.eventById(102).y;
        })()`, true, false));
        await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine;
            window.__beforeAutonomous = engine.save();
            engine.state.x = 15; engine.state.y = 22;
            engine.state.setSwitch(1781, true);
            engine.autonomousEnabled = true;
        })()`, false, false);
        await waitFor(cdp, 'FNHStandalonePreview.engine.map.eventById(102).y < 25', 5000, 'hound thật tự tiến về người chơi');
        check('hound Map074 di chuyển bằng bộ tự động của engine mới', await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine, hound = engine.map.eventById(102);
            engine.autonomousEnabled = false;
            return engine.map.eventPage(hound).moveType === 2 && hound.autonomous &&
                Math.abs(hound.x - 15) + Math.abs(hound.y - 22) < 4;
        })()`, false, false));
        await evalPage(cdp, 'FNHStandalonePreview.engine.restore(window.__beforeAutonomous).then(() => { delete window.__beforeAutonomous; return true; })', true, false);
        check('balloon dùng đúng sprite và frame từ asset có sẵn', await evalPage(cdp, `(async () => {
            const canvas = document.createElement('canvas');
            const renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas, { width: 400, height: 300 });
            const bitmap = await renderer.loadImage('img/system/Balloon.png');
            const character = await renderer.loadImage('img/characters/$guard1.png');
            renderer.drawBalloon(bitmap, { x: 3, y: 3, bitmap: character, image: { characterName: '$guard1' }, balloon: { id: 1, remaining: 60 } }, 0, 0);
            const reference = document.createElement('canvas'); reference.width = 400; reference.height = 300;
            reference.getContext('2d').drawImage(bitmap, 96, 0, 48, 48, 144, 28, 48, 48);
            const actual = canvas.getContext('2d').getImageData(0,0,400,300).data;
            const expected = reference.getContext('2d').getImageData(0,0,400,300).data;
            return actual.every((value,index) => value === expected[index]);
        })()`, true, false));
        check('ánh sáng Canvas nhận công tắc, màu đèn, vị trí và hướng đèn pin', await evalPage(cdp, `(() => {
            const state = new FNHStandaloneState.GameState({ x: 8, y: 6, direction: 6 });
            const runtime = new FNHStandaloneLighting.LightingRuntime(state);
            const map = { id: 1, events: [{ id: 1, x: 3, y: 3, note: 'Light 60 #FF0000 7' }] };
            const canvas = document.createElement('canvas'), renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas);
            const context = canvas.getContext('2d'), view = { startX: 0, startY: 0 };
            function pixel(x,y) { return Array.from(context.getImageData(x,y,1,1).data).slice(0,3); }
            function draw() {
                context.fillStyle = '#fff'; context.fillRect(0,0,816,624);
                renderer.drawLighting(runtime, runtime.sources(map), state, view);
            }
            runtime.handleCommand('Light radius 0 #FFFFFF'); draw();
            if (pixel(168,168).some(Boolean)) return false;
            runtime.handleCommand('Light on 7', map); draw();
            if (pixel(168,168)[0] < 250 || pixel(168,168)[1] !== 0 || pixel(300,300).some(Boolean)) return false;
            map.events[0].x = 4; draw();
            if (pixel(216,168)[0] < 250 || pixel(168,168)[0] > 128) return false;
            runtime.handleCommand('Light off 7', map);
            runtime.handleCommand('Flashlight on 8 12 #FFFFFF'); draw();
            return pixel(534,312)[0] > 50 && pixel(282,312)[0] === 0 && !state.selfSwitchValue(1,1,'D');
        })()`, false, false));
        check('filter GPU xử lý màu, RGB split, zoom và tia sáng thật', await evalPage(cdp, `(() => {
            const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
            const context = canvas.getContext('2d');
            context.fillStyle = '#4060a0'; context.fillRect(0,0,96,96);
            context.fillStyle = '#ff8040'; context.fillRect(32,32,24,24);
            const result = document.createElement('canvas'); result.width = 96; result.height = 96;
            const output = result.getContext('2d');
            const runtime = new FNHStandaloneFilters.FilterRuntime(new FNHStandaloneState.GameState());
            function draw() {
                output.clearRect(0,0,96,96);
                output.drawImage(runtime.apply(canvas, runtime.forTarget(2)),0,0);
                return output.getImageData(0,0,96,96).data;
            }
            function differs(a,b) { return a.some((value,index) => Math.abs(value - b[index]) > 3); }
            try {
                runtime.handleCommand('createFilter A adjustment 2 screen');
                runtime.handleCommand('setFilter A 1 1 1 1 0 1 1 1');
                const color = draw();
                if (color[0] > 1 || Math.abs(color[1]-96) > 2 || Math.abs(color[2]-160) > 2 || color[3] !== 255) return false;
                runtime.handleCommand('eraseFilter A');
                const baseline = context.getImageData(0,0,96,96).data;
                runtime.handleCommand('createFilter RGB rgbsplit 2 screen'); runtime.handleCommand('setFilter RGB 5 30');
                if (!differs(draw(),baseline)) return false;
                runtime.handleCommand('eraseFilter RGB');
                runtime.handleCommand('createFilter Z zoomblur 2 screen'); runtime.handleCommand('setFilter Z 48 48 0 0.5');
                if (!differs(draw(),baseline)) return false;
                runtime.handleCommand('eraseFilter Z');
                runtime.handleCommand('createFilter G godray-np 2 screen'); runtime.handleCommand('setFilter G 45 -30 0.8 2 0.3');
                const first = draw(); runtime.advance(60); const second = draw();
                return differs(first,baseline) && differs(first,second) && runtime.backend.renderer.type === PIXI.RENDERER_TYPE.WEBGL;
            } finally { runtime.dispose(); }
        })()`, false, false));
        check('filter tôn trọng scope parallax và giữ nguyên màu picture', await evalPage(cdp, `(async () => {
            const engine = FNHStandalonePreview.engine;
            const canvas = document.createElement('canvas');
            const renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas, { width: 96, height: 96 });
            const map = new FNHStandaloneMap.GameMap({ id: 999, width: 2, height: 2, events: [],
                data: Array(24).fill(0), parallaxName: 'unused' }, { flags: [16], tilesetNames: [] }, engine.state);
            const background = document.createElement('canvas'); background.width = 96; background.height = 96;
            background.getContext('2d').fillStyle = '#c86432'; background.getContext('2d').fillRect(0,0,96,96);
            renderer.images.set('img/parallaxes/unused.png', Promise.resolve(background));
            const state = new FNHStandaloneState.GameState({ x: 0, y: 0, party: [] });
            state.actor = () => null;
            const screen = new FNHStandaloneScreen.ScreenRuntime(state);
            const filters = new FNHStandaloneFilters.FilterRuntime(state);
            const view = { state, map, screen, filters };
            const pixel = () => Array.from(canvas.getContext('2d').getImageData(40,40,1,1).data);
            try {
                filters.handleCommand('createFilter A adjustment 2 screen'); filters.handleCommand('setFilter A 1 1 1 1 0 1 1 1');
                await renderer.draw(view); const mapOnly = pixel();
                filters.handleCommand('createFilter A adjustment 21 screen'); filters.handleCommand('setFilter A 1 1 1 1 0 1 1 1');
                await renderer.draw(view); const withBackground = pixel();
                const picture = document.createElement('canvas'); picture.width = 96; picture.height = 96;
                picture.getContext('2d').fillStyle = '#c86432'; picture.getContext('2d').fillRect(0,0,96,96);
                renderer.images.set('img/pictures/unused.png', Promise.resolve(picture));
                screen.handleEffect(231,[1,'unused',0,0,0,0,100,100,255,0]);
                await renderer.draw(view); const withPicture = pixel();
                return mapOnly[0] === 200 && withBackground[0] <= 1 && withBackground[1] === 100 &&
                    withPicture[0] === 200 && withPicture[1] === 100 && withPicture[2] === 50;
            } finally { filters.dispose(); }
        })()`, true, false));
        check('filter qua interpreter giữ tham số và thời gian sau lưu/tải', await evalPage(cdp, `(async () => {
            const engine = FNHStandalonePreview.engine;
            await engine.createInterpreter([
                {code:356,parameters:['createFilter GOD godray-np 2 screen']},
                {code:356,parameters:['setFilter GOD 450 -300 0.8 2 0.2']}
            ],39).run();
            engine.filters.advance(40);
            const saved = engine.save(), time = saved.filters.GOD.time;
            await engine.restore(saved);
            const valid = engine.state.filters.GOD.time === time && engine.state.filters.GOD.parameters[4] === 0.2;
            engine.filters.handleCommand('eraseFilter GOD');
            return valid;
        })()`, true, false));
        await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine;
            window.__beforeHeldInput = engine.save();
            engine.state.x = 4; engine.state.y = 20; engine.state.through = true; engine.state.moveFrames = 0;
            document.querySelector('#fnh-canvas').focus();
        })()`, false, false);
        await cdp.send('Input.dispatchKeyEvent', {type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.x >= 6', 5000, 'giữ phím tự bước qua nhiều ô');
        await cdp.send('Input.dispatchKeyEvent', {type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
        await sleep(400);
        const stoppedAt = await evalPage(cdp, 'FNHStandalonePreview.engine.state.x', false, false);
        await sleep(400);
        check('giữ phím di chuyển theo frame và thả phím dừng lại', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.x === ' + stoppedAt + ' && !FNHStandalonePreview.engine.buttons.has("right")', false, false));
        check('lệnh chạy nhanh thay đổi thời gian bước đi và giữ sau lưu/tải', await evalPage(cdp, `(async () => {
            const engine = FNHStandalonePreview.engine;
            await engine.createInterpreter([{code:356,parameters:['EnableDashing']}],39).run();
            engine.buttons.add('shift');
            const fast = engine.playerStepFrames();
            await engine.createInterpreter([{code:356,parameters:['DisableDashing']}],39).run();
            const slow = engine.playerStepFrames();
            await engine.restore(engine.save());
            const saved = !engine.state.dashEnabled;
            engine.buttons.clear();
            await engine.restore(window.__beforeHeldInput); delete window.__beforeHeldInput;
            return fast * 2 === slow && saved;
        })()`, true, false));
        check('tùy chọn đi bộ giữ Shift và lệnh sự kiện quyết định chạy nhanh', await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine, state = engine.state;
            const before = { alwaysDash: state.alwaysDash, dashEnabled: state.dashEnabled };
            const option = document.querySelector('#fnh-always-dash');
            try {
                state.dashEnabled = true;
                option.checked = false; option.dispatchEvent(new Event('change', {bubbles:true}));
                const walking = engine.playerStepFrames();
                engine.buttons.add('shift'); const running = engine.playerStepFrames(); engine.buttons.delete('shift');
                option.checked = true; option.dispatchEvent(new Event('change', {bubbles:true}));
                return !engine.buttons.has('shift') && walking === running * 2 && engine.playerStepFrames() === running;
            } finally { Object.assign(state,before); option.checked = before.alwaysDash; }
        })()`, false, false));
        await evalPage(cdp, 'FNHStandalonePreview.engine.createInterpreter([{code:213,parameters:[-1,1,true]},{code:121,parameters:[501,501,0]}],39).run()', true, false);
        check('lệnh balloon chờ kết thúc trước khi chạy lệnh tiếp', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.balloon.remaining === 0 && FNHStandalonePreview.engine.state.switchValue(501)', false, false));
        check('renderer vẽ animation sprite sheet theo frame, scale và blend', await evalPage(cdp, `(async () => {
            const canvas = document.createElement('canvas');
            const renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas, { width: 384, height: 384 });
            const bitmap = await renderer.loadImage('img/animations/coin_flip.png');
            const data = FNHStandalonePreview.engine.database.Animations[7];
            renderer.drawAnimation({ entry: { elapsed: 0, targetId: -1, mirror: false }, data, first: bitmap, second: null },
                { x: 4, y: 4 }, { eventById: () => null }, 0, 0);
            const pixels = canvas.getContext('2d').getImageData(0, 0, 384, 384).data;
            let visible = 0;
            for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] > 0) visible++;
            return visible > 100 && pixels.some((value, index) => index % 4 === 0 && value > 150);
        })()`, true, false));
        check('lệnh nhân vật chạy bằng interpreter mới trên Chrome', await evalPage(cdp, `(async () => {
            const state = FNHStandalonePreview.engine.state;
            await new FNHStandaloneEvents.EventInterpreter({ state, commands: [
                { code: 318, parameters: [0, 1, 0, 40] },
                { code: 320, parameters: [1, 'Người sống sót'] },
                { code: 317, parameters: [0, 1, 2, 0, 0, 5] },
                { code: 322, parameters: [1, 'mercenary', 0, 'Actor1', 0, 'Actor1_1'] }
            ] }).run();
            const actor = state.actor(1);
            return actor.skills.includes(40) && actor.name === 'Người sống sót' &&
                actor.characterName === 'mercenary' && state.actorParam(1, 2) === 62;
        })()`, true, false));
        check('picture engine mới vẽ đúng asset và gốc tọa độ', await evalPage(cdp, `(async () => {
            const canvas = document.createElement('canvas');
            const renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas);
            const bitmap = await renderer.loadImage('img/pictures/Actor1_1.png');
            renderer.drawPicture({ bitmap, picture: { x: 200, y: 180, scaleX: 50, scaleY: 50,
                origin: 1, opacity: 128, angle: 0, blendMode: 0, tone: { red: 0, green: 0, blue: 0, gray: 0 } } });
            const reference = document.createElement('canvas'); reference.width = 816; reference.height = 624;
            const context = reference.getContext('2d'); context.imageSmoothingEnabled = false;
            context.globalAlpha = 128 / 255;
            context.drawImage(bitmap, 200 - bitmap.width / 4, 180 - bitmap.height / 4, bitmap.width / 2, bitmap.height / 2);
            const actual = canvas.getContext('2d').getImageData(0, 0, 816, 624).data;
            const expected = context.getImageData(0, 0, 816, 624).data;
            return actual.every((value, index) => value === expected[index]);
        })()`, true, false));
        await evalPage(cdp, 'FNHStandalonePreview.engine.screen.handleEffect(223, [[-255,-255,-255,0], 3, true])', true, false);
        await waitFor(cdp, `(() => {
            const canvas = document.querySelector('#fnh-canvas');
            const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            return pixels.every((value, index) => index % 4 === 3 ? value === 255 : value === 0);
        })()`, 5000, 'tint màn hình chạy theo frame và vẽ màu đen');
        check('hiệu ứng màn hình mới chạy trên Canvas thật', await evalPage(cdp,
            'FNHStandalonePreview.engine.screen.screen.tone.red === -255', false, false));
        await evalPage(cdp, 'FNHStandalonePreview.engine.screen.handleEffect(223, [[0,0,0,0], 0, false])', false, false);
        // Chạy các lệnh audio dữ liệu bằng interpreter mới, không dùng AudioManager MV.
        await evalPage(cdp, `new FNHStandaloneEvents.EventInterpreter({
            state: FNHStandalonePreview.engine.state,
            commands: [{ code: 241, parameters: [{ name: 'fear_and_hunger', volume: 80, pitch: 100 }] }],
            handlers: { effect: FNHStandalonePreview.audio.handleEffect.bind(FNHStandalonePreview.audio) }
        }).run()`, true, true);
        await waitFor(cdp, 'FNHStandalonePreview.audio.buffers.bgm && !FNHStandalonePreview.audio.buffers.bgm.paused && FNHStandalonePreview.audio.buffers.bgm.currentTime > 0',
            20000, 'OGG phát trong audio manager độc lập');
        check('interpreter mới phát được BGM OGG thật', await evalPage(cdp,
            'FNHStandalonePreview.audio.buffers.bgm.src.endsWith("/audio/bgm/fear_and_hunger.ogg") && FNHStandalonePreview.audio.buffers.bgm.volume === 0.8', false, false));
        await evalPage(cdp, `(() => {
            const volume = document.querySelector('#fnh-volume');
            volume.value = 50;
            volume.dispatchEvent(new Event('input', { bubbles: true }));
        })()`, false, false);
        check('volume preview giữ âm lượng riêng của BGM', await evalPage(cdp,
            'FNHStandalonePreview.audio.buffers.bgm.volume === 0.4', false, false));
        await evalPage(cdp, 'FNHStandalonePreview.audio.handleEffect(242, [0.05])', false, false);
        await waitFor(cdp, 'FNHStandalonePreview.audio.buffers.bgm === null', 3000, 'BGM fade và dừng');
        await screenshot('standalone-preview');

        await evalPage(cdp, `(async () => {
            const engine = FNHStandalonePreview.engine;
            const store = new FNHStandaloneSave.SaveStore({ prefix: 'FNH_STANDALONE_PREVIEW:' });
            engine.saveTo(store, 1);
            await engine.createInterpreter([{ code: 353 }, { code: 121, parameters: [996, 996, 0] }], 0).run();
        })()`, true, false);
        await waitFor(cdp, `!document.querySelector('#fnh-end-screen').hidden &&
            document.querySelector('#fnh-end-background').naturalWidth > 0`, 5000, 'màn game over dùng asset thật');
        check('game over dừng sự kiện và khóa di chuyển', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.scene === "gameover" && !FNHStandalonePreview.engine.state.switchValue(996) && !FNHStandalonePreview.engine.move(2) && document.querySelector("#fnh-end-title").textContent === "Game Over"', false, false));
        await clickElement(cdp, '#fnh-save');
        check('game over không ghi đè save bằng trạng thái đã chết', await evalPage(cdp,
            'new FNHStandaloneSave.SaveStore({ prefix: "FNH_STANDALONE_PREVIEW:" }).load(1).scene === "map" && FNHStandalonePreview.engine.state.scene === "gameover"', false, false));
        await clickElement(cdp, '#fnh-end-load');
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.scene === "map" && document.querySelector("#fnh-end-screen").hidden',
            5000, 'tải save từ màn game over');
        check('tải save game over trở lại map', await evalPage(cdp,
            '!FNHStandalonePreview.engine.eventRunning && document.querySelector("#fnh-status").textContent.startsWith("Map ")', false, false));
        await evalPage(cdp, `localStorage.removeItem('FNH_STANDALONE_PREVIEW:1');
            FNHStandalonePreview.engine.createInterpreter([{ code: 353 }], 0).run()`, true, false);
        await waitFor(cdp, '!document.querySelector("#fnh-end-screen").hidden', 5000, 'game over lần hai');
        await clickElement(cdp, '#fnh-end-load');
        await waitFor(cdp, 'document.querySelector("#fnh-status").textContent.includes("chưa có dữ liệu")', 5000, 'báo ô lưu trống');
        check('ô lưu trống giữ màn game over hoạt động', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.scene === "gameover" && !document.querySelector("#fnh-end-screen").hidden', false, false));
        await evalPage(cdp, 'FNHStandalonePreview.engine.createInterpreter([{ code: 354 }], 0).run()', true, false);
        await waitFor(cdp, `FNHStandalonePreview.engine.state.scene === 'title' &&
            !document.querySelector('#fnh-end-overlay').hidden && document.querySelector('#fnh-end-overlay').naturalWidth > 0 &&
            FNHStandalonePreview.audio.buffers.bgm && !FNHStandalonePreview.audio.buffers.bgm.paused`,
            10000, 'về tiêu đề dùng asset và BGM độc lập');
        check('màn tiêu đề có hình, nhạc và nút chơi mới', await evalPage(cdp,
            'document.querySelector("#fnh-end-title").textContent === FNHStandalonePreview.engine.database.System.gameTitle && document.querySelector("#fnh-new-game").getBoundingClientRect().width > 0', false, false));
        await clickElement(cdp, '#fnh-new-game');
        await waitFor(cdp, 'window.FNHStandalonePreview && FNHStandalonePreview.engine.state && FNHStandalonePreview.engine.state.switchValue(296)',
            30000, 'engine mới mở màn chọn nhân vật thật');
        check('màn chọn nhân vật chạy sự kiện nền và giữ màu picture', await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine;
            const pixels = document.querySelector('#fnh-canvas').getContext('2d').getImageData(0,0,816,624).data;
            let colored = 0;
            for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i+1] + pixels[i+2] > 60) colored++;
            return engine.state.screen.pictures[7].name === 'text_mercenary' && colored > 10000 && !window.SceneManager;
        })()`, false, false));
        await clickElement(cdp, '#fnh-controls [data-direction="6"]');
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.variableValue(9) === 2', 5000, 'chọn knight bằng nút phải');
        check('sự kiện JSON đổi ảnh và vị trí khung chọn', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.screen.pictures[8].x === 225 && FNHStandalonePreview.engine.state.screen.pictures[7].name === "text_knight"', false, false));
        await sleep(250);
        await clickElement(cdp, '#fnh-controls [data-direction="0"]');
        await waitFor(cdp, 'document.querySelector("#fnh-name-dialog").open', 5000, 'nhập tên độc lập');
        check('nhập tên giữ khóa autorun và đúng nhân vật được chọn', await evalPage(cdp,
            'FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.engine.state.switchValue(242) && document.querySelector("#fnh-name-input").maxLength === 10', false, false));
        await evalPage(cdp, 'document.querySelector("#fnh-name-input").value = "Schoolkid"; document.querySelector("#fnh-name-form").requestSubmit()', false, false);
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.selfSwitchValue(10,1,"A")', 5000, 'kết thúc chọn nhân vật');
        check('luồng chọn knight cập nhật party, tên và nhánh đặc biệt', await evalPage(cdp, `(() => {
            const state = FNHStandalonePreview.engine.state;
            return state.party.join(',') === '3' && state.actor(3).name === 'Schoolkid' && state.switchValue(2839) &&
                state.itemCount('items',5) === 3 && !document.querySelector('#fnh-name-dialog').open;
        })()`, false, false));
        await waitFor(cdp, '!document.querySelector("#fnh-video").hidden && document.querySelector("#fnh-video").currentTime > 0',
            25000, 'intro chạy bằng video trình duyệt trong engine mới');
        check('intro độc lập phát asset webm thật và giữ sự kiện đang chờ', await evalPage(cdp, `(() => {
            const video = document.querySelector('#fnh-video');
            return video.src.endsWith('/movies/intro.webm') && !video.paused && video.duration > 1 &&
                !FNHStandalonePreview.engine.state.switchValue(295);
        })()`, false, false));
        await screenshot('standalone-opening');
        await evalPage(cdp, 'FNHStandalonePreview.scheduler.stop()', false, false);
        await waitFor(cdp, 'document.querySelector("#fnh-video").hidden', 5000, 'hủy sự kiện dọn video');
        check('dừng sự kiện intro không áp dụng lệnh tiếp theo', await evalPage(cdp,
            '!FNHStandalonePreview.engine.state.switchValue(295) && FNHStandalonePreview.errors.length === 0', false, false));
        await evalPage(cdp, `(() => {
            const engine = FNHStandalonePreview.engine;
            engine.state.setSwitch(295, true);
            engine.state.setSwitch(2839, false);
            window.__openingDone = false;
            engine.runEvent(1, FNHStandalonePreview.scheduler.handlers).then(() => { window.__openingDone = true; });
        })()`, false, false);
        await waitFor(cdp, 'document.querySelectorAll("#fnh-choices button").length === 4', 5000, 'chọn độ khó bằng engine độc lập');
        check('chế độ ẩn bị khóa và lựa chọn hiện mô tả từ JSON', await evalPage(cdp, `(() => {
            const choices = document.querySelectorAll('#fnh-choices button');
            return choices[3].disabled && choices[3].textContent === '????' && document.querySelector('#fnh-next').hidden &&
                document.querySelector('#fnh-choice-help').textContent.includes('game mode') &&
                document.querySelector('#fnh-message-text').textContent.includes('easier mode');
        })()`, false, false));
        await clickElement(cdp, '#fnh-choices button:first-child');
        await waitFor(cdp, 'document.querySelectorAll("#fnh-choices button").length === 2 && document.querySelector("#fnh-message-text").textContent.includes("Play intro?")',
            5000, 'lựa chọn xem truyện mở đầu');
        await clickElement(cdp, '#fnh-choices button:nth-child(2)');
        await waitFor(cdp, 'window.__openingDone && FNHStandalonePreview.engine.state.mapId === 74', 5000, 'chọn chế độ và đi tới cổng ngục');
        await evalPage(cdp, 'FNHStandalonePreview.engine.runEvent(11, FNHStandalonePreview.scheduler.handlers)', true, false);
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.screen.gab && FNHStandalonePreview.engine.state.screen.gab.text.includes("stand in front")',
            5000, 'Gab mở đầu ngục chạy bằng engine mới');
        check('luồng chọn độ khó tới cổng ngục và thông báo Gab độc lập', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.menuEnabled && FNHStandalonePreview.engine.state.switchValue(79) && !window.SceneManager', false, false));
        await screenshot('standalone-dungeon');

        const relevantErrors = runtimeErrors;
        const relevantLogs = logErrors;
        check('không có lỗi runtime mới', relevantErrors.length === 0, JSON.stringify(relevantErrors.map((item) => ({
            url: item.url,
            text: item.exception && (item.exception.description || item.exception.value)
        }))));
        check('không có lỗi console mới', relevantLogs.length === 0, JSON.stringify(relevantLogs.map((item) => ({
            text: item.text,
            url: item.url
        }))));

        log('Hoàn tất ' + passed + ' kiểm tra.');
        if (keepShots) log('Ảnh chụp: ' + shotsDir);
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
