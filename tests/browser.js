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
        const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
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
                scripts.length >= 8 && scripts.every(item => new URL(item.name).pathname.startsWith('/engine/'));
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
