'use strict';
/* ============================================================
   Smoke test cho engine web Fear & Hunger.
   - Khởi động server tạm trên cổng ngẫu nhiên.
   - Dùng Chrome/Chromium hệ thống qua CDP (không cần npm install).
   - Kiểm tra giải mã asset, tiêu đề, tạo nhân vật, bản đồ, di chuyển,
     trận đấu, âm thanh, lưu/đọc và lưu qua localStorage sau tải lại.
   Nếu thiếu thư mục game hoặc Chrome, bài test bỏ qua và trả mã 0.
   ============================================================ */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { findGameRoot, startServer } = require('../tools/fnh-engine/server');

const GAME_HINT = 'Fear.and.Hunger.v1.4.1/Fear.and.Hunger.v1.4.1/www';
const SAVE_SLOT = 1;
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
    console.log('[FNH engine smoke] ' + message);
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
        'document.querySelector("#fnh-engine-start") && document.querySelector("#fnh-engine-start").getBoundingClientRect().width > 0',
        20000,
        'nút BẮT ĐẦU'
    );
    const point = await evalPage(cdp, [
        '(() => {',
        '  const button = document.querySelector("#fnh-engine-start");',
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

async function tapKey(cdp, key, code, keyCode, holdMs) {
    await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: key,
        code: code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode
    });
    await sleep(holdMs || 70);
    await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: key,
        code: code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode
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
    let keepShots = process.env.FNH_KEEP_SHOTS === '1';
    const shotsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fnh-engine-smoke-'));
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
        // 1. Kiểm tra server và asset gốc.
        // ---------------------------------------------------------
        const health = await (await fetch(running.url + '__fnh-engine/health')).json();
        check('health trả về đúng chế độ engine', health.ok === true && health.mode === 'fnh-engine');

        const indexResponse = await fetch(running.url);
        const indexHtml = await indexResponse.text();
        check('trang engine được phục vụ tại /', indexResponse.status === 200 &&
            indexHtml.indexOf('fnh-canvas') !== -1 && indexHtml.indexOf('js/scene_battle.js') !== -1);
        check('không nhúng runtime RPG Maker MV', indexHtml.indexOf('rpg_core.js') === -1 &&
            indexHtml.indexOf('rpg_managers.js') === -1 && indexHtml.indexOf('rpg_scenes.js') === -1);

        const systemResponse = await fetch(running.url + 'game/data/System.json');
        const system = await systemResponse.json();
        check('đọc được System.json gốc', system.encryptionKey === 'd41d8cd98f00b204e9800998ecf8427e');

        const titleAsset = await fetch(running.url + 'game/img/titles2/title2.rpgmvp');
        const titleBytes = Buffer.from(await titleAsset.arrayBuffer());
        check('asset tiêu đề vẫn ở dạng mã hoá gốc', titleAsset.status === 200 &&
            titleBytes.length > 100000 && titleBytes.toString('hex', 0, 8) !== '89504e470d0a1a0a');

        const audioPath = path.join(gameRoot, 'audio', 'bgm', 'fear_and_hunger.rpgmvo');
        if (fs.existsSync(audioPath)) {
            const rangeResponse = await fetch(running.url + 'game/audio/bgm/fear_and_hunger.rpgmvo', {
                headers: { Range: 'bytes=0-99' }
            });
            const rangeBody = Buffer.from(await rangeResponse.arrayBuffer());
            check('hỗ trợ HTTP Range cho âm thanh', rangeResponse.status === 206 && rangeBody.length === 100);
        }

        const traversalResponse = await fetch(running.url + 'game/..%2f..%2fetc%2fpasswd');
        check('chặn truy cập ngoài thư mục game', traversalResponse.status === 403);
        const appTraversal = await fetch(running.url + '..%2f..%2fetc%2fpasswd');
        check('chặn truy cập ngoài thư mục ứng dụng', appTraversal.status === 403);

        // ---------------------------------------------------------
        // 2. Khởi động Chrome headless.
        // ---------------------------------------------------------
        const chromeBin = findChrome();
        if (!chromeBin) {
            skip('không tìm thấy Chrome/Chromium. Đặt CHROME_BIN hoặc cài Chrome để chạy phần kiểm tra trình duyệt.');
            return;
        }
        log('Chrome: ' + chromeBin);

        profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fnh-engine-chrome-'));
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
        const url = running.url + '?fnh_engine_ns=' + encodeURIComponent(namespace);
        log('Mở: ' + url);
        await cdp.send('Page.navigate', { url: url });
        await sleep(800);

        // ---------------------------------------------------------
        // 3. Mở engine, kiểm tra tiêu đề và âm thanh.
        // ---------------------------------------------------------
        await clickStart(cdp);
        await waitFor(cdp, 'window.FNH && FNH.game && FNH.game.booted && FNH.game.sceneName === "title"',
            120000, 'màn hình tiêu đề');
        await waitFor(cdp, 'FNH.game.audio.context && FNH.game.audio.context.state === "running"',
            20000, 'Web Audio chạy');
        await waitFor(cdp, 'FNH.game.audio.currentBgm && FNH.game.audio.currentBgm.name === "fear_and_hunger"',
            45000, 'nhạc tiêu đề');
        check('đã vào Scene_Title', await evalPage(cdp, 'FNH.game.sceneName === "title"', false, false));
        check('ảnh tiêu đề gốc đã giải mã', await evalPage(
            cdp, 'FNH.game.assets.imageCache.has("titles2/title2")', false, false
        ));
        check('Web Audio đã mở khoá', await evalPage(
            cdp, 'FNH.game.audio.context.state === "running"', false, false
        ));
        check('nhạc tiêu đề đang phát', await evalPage(
            cdp, '!!(FNH.game.audio.currentBgm && FNH.game.audio.currentBgm.name === "fear_and_hunger")',
            false, false
        ));
        check('nhạc tiêu đề giải mã có thời lượng', await evalPage(
            cdp, 'FNH.game.audio.currentBgm.duration > 1', false, false
        ));
        check('giải mã được âm thanh SE gốc', await evalPage(
            cdp,
            'FNH.game.assets.decodeAudio("se/fnh_choice", FNH.game.audio.context)' +
            '.then(function (buffer) { return buffer.duration > 0.05; })',
            true, false
        ));
        check('chưa có save nên Continue bị khoá', await evalPage(
            cdp,
            'FNH.game.getSaveInfo() === null && FNH.game.scene.entries[0].enabled === false',
            false, false
        ));
        const titlePixels = await evalPage(cdp, [
            '(() => {',
            '  const canvas = document.getElementById("fnh-canvas");',
            '  const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;',
            '  let bright = 0;',
            '  for (let i = 0; i < data.length; i += 4000) {',
            '    if (data[i] + data[i + 1] + data[i + 2] > 60) bright += 1;',
            '  }',
            '  return bright;',
            '})()'
        ].join('\n'), false, false);
        check('canvas tiêu đề có nội dung', titlePixels > 100, 'điểm sáng: ' + titlePixels);
        await screenshot('title');

        // ---------------------------------------------------------
        // 4. Tạo nhân vật.
        // ---------------------------------------------------------
        await tapKey(cdp, 'Enter', 'Enter', 13);
        await waitFor(cdp, 'FNH.game.sceneName === "creation"', 15000, 'màn hình tạo nhân vật');
        check('có đủ bốn nghề nghiệp', await evalPage(
            cdp, 'FNH.game.scene.classes.length === 4', false, false
        ));
        check('mặc định chọn Mercenary', await evalPage(
            cdp,
            'FNH.game.scene.index === 0 && FNH.game.scene.preview.name === "Cahara" && FNH.game.scene.preview.className === "Mercenary"',
            false, false
        ));
        check('ảnh mô tả nghề đã giải mã', await evalPage(
            cdp, 'FNH.game.assets.imageCache.has("pictures/text_mercenary")', false, false
        ));
        check('đủ ảnh chân dung bốn nghề', await evalPage(cdp, [
            '["pictures/Actor1_1", "pictures/Actor1_3", "pictures/Actor1_7", "pictures/Actor1_8"]',
            '  .every(function (key) { return FNH.game.assets.imageCache.has(key); })'
        ].join('\n'), false, false));
        await screenshot('creation');

        await tapKey(cdp, 'ArrowRight', 'ArrowRight', 39);
        await sleep(250);
        check('đổi được sang D\'arce', await evalPage(
            cdp, 'FNH.game.scene.index === 1 && FNH.game.scene.preview.name === "D\'arce"', false, false
        ));
        await tapKey(cdp, 'ArrowLeft', 'ArrowLeft', 37);
        await sleep(250);
        await tapKey(cdp, 'Enter', 'Enter', 13);

        // ---------------------------------------------------------
        // 5. Bản đồ đầu tiên, di chuyển và gặp Guard.
        // ---------------------------------------------------------
        await waitFor(cdp, 'FNH.game.sceneName === "map" && FNH.game.scene.ready === true',
            30000, 'bản đồ sẵn sàng');
        check('bản đồ 1 và vị trí xuất phát đúng', await evalPage(cdp, [
            '(() => {',
            '  const game = FNH.game;',
            '  return game.mapId === 1 && game.player.mapX === 27 && game.player.mapY === 67 &&',
            '    game.player.name === "Cahara" && game.player.className === "Mercenary";',
            '})()'
        ].join('\n'), false, false));
        check('tileset gốc đã nạp', await evalPage(
            cdp,
            'FNH.game.scene.tileImages.size >= 4 && FNH.game.assets.imageCache.has("tilesets/Inside_A5")',
            false, false
        ));
        check('sự kiện bản đồ gốc đã đọc', await evalPage(
            cdp, 'FNH.game.scene.events.length > 100 && FNH.game.scene.guard.alive === true', false, false
        ));
        await waitFor(cdp, 'FNH.game.audio.currentBgs && FNH.game.audio.currentBgs.name === "minor_terror"',
            45000, 'âm thanh nền bản đồ');
        check('âm thanh nền bản đồ đang phát', await evalPage(
            cdp, '!!(FNH.game.audio.currentBgs && FNH.game.audio.currentBgs.name === "minor_terror")',
            false, false
        ));
        check('âm thanh nền giải mã có thời lượng', await evalPage(
            cdp, 'FNH.game.audio.currentBgs.duration > 1', false, false
        ));
        await screenshot('map');

        check('common event gốc được nạp', await evalPage(cdp,
            'FNH.game.data.commonEvents.length > 1', false, false));
        await evalPage(cdp, `(() => {
            const scene = FNH.game.scene;
            const c = (code, parameters = [], indent = 0) => ({code, parameters, indent});
            scene.startEvent({id: 999999, pages: [{list: [
                c(101, ['', 0]), c(401, ['Kiểm tra hội thoại và lựa chọn']),
                c(102, [['Nhánh A', 'Nhánh B'], -1, 0]),
                c(402, [0]), c(121, [999997, 999997, 0], 1),
                c(402, [1]), c(121, [999998, 999998, 0], 1), c(404),
                c(111, [0, 999998, 0]), c(121, [999999, 999999, 0], 1), c(412)
            ]}]});
        })()`, false, false);
        await tapKey(cdp, 'ArrowUp', 'ArrowUp', 38);
        check('hội thoại khóa di chuyển và chờ xác nhận', await evalPage(cdp,
            'FNH.game.player.mapY === 67 && FNH.game.scene.eventRunner.wait.type === "message"', false, false));
        await tapKey(cdp, 'Enter', 'Enter', 13);
        await waitFor(cdp, 'FNH.game.scene.eventRunner && FNH.game.scene.eventRunner.wait.type === "choice"',
            5000, 'bảng lựa chọn event');
        await tapKey(cdp, 'ArrowDown', 'ArrowDown', 40);
        await tapKey(cdp, 'Enter', 'Enter', 13);
        await waitFor(cdp, '!FNH.game.scene.eventRunner', 5000, 'event hoàn tất');
        check('lựa chọn và điều kiện chỉ thực thi nhánh được chọn', await evalPage(cdp,
            '!FNH.game.flags["switch:999997"] && FNH.game.flags["switch:999998"] && FNH.game.flags["switch:999999"]',
            false, false));
        await evalPage(cdp, '[999997, 999998, 999999].forEach(id => delete FNH.game.flags["switch:" + id])', false, false);

        await evalPage(cdp, `(() => {
            const c = (code, parameters = []) => ({code, parameters, indent: 0});
            FNH.game.scene.map.events.push({id: 999996, x: -10, y: -10, pages: [{trigger: 4, list: [
                c(122, [999996, 999996, 1, 0, 1]), c(230, [12]),
                c(101, ['', 0]), c(401, ['Hội thoại từ event song song']), c(214)
            ]}]});
        })()`, false, false);
        await waitFor(cdp, 'FNH.game.scene.dialogRunner && FNH.game.scene.dialogRunner.wait && FNH.game.scene.dialogRunner.wait.type === "message"',
            5000, 'hội thoại parallel');
        check('parallel thực thi trong vòng lặp game và có khung thoại riêng', await evalPage(cdp,
            'FNH.game.flags["variable:999996"] === 1 && !FNH.game.scene.eventRunner && FNH.game.scene.dialogState().eventId === 999996', false, false));
        await tapKey(cdp, 'ArrowUp', 'ArrowUp', 38);
        check('hội thoại parallel khóa di chuyển', await evalPage(cdp,
            'FNH.game.player.mapY === 67', false, false));
        await tapKey(cdp, 'Enter', 'Enter', 13);
        await waitFor(cdp, '!FNH.game.scene.dialogRunner && FNH.game.scene.erasedEvents.has(999996)',
            5000, 'parallel kết thúc và xóa event');
        check('xác nhận parallel giải phóng hội thoại', await evalPage(cdp,
            '!FNH.game.scene.dialogRunner && !FNH.game.scene.eventRunner', false, false));
        await evalPage(cdp, `(() => {
            FNH.game.scene.map.events = FNH.game.scene.map.events.filter(event => !event || event.id !== 999996);
            FNH.game.scene.erasedEvents.delete(999996);
            delete FNH.game.flags['variable:999996'];
        })()`, false, false);

        await tapKey(cdp, 'ArrowUp', 'ArrowUp', 38);
        await sleep(500);
        check('nhân vật bước lên ô 27,66', await evalPage(
            cdp, 'FNH.game.player.mapX === 27 && FNH.game.player.mapY === 66', false, false
        ));
        await tapKey(cdp, 'ArrowUp', 'ArrowUp', 38);
        await sleep(500);
        check('nhân vật tiến tới ô 27,65', await evalPage(
            cdp, 'FNH.game.player.mapX === 27 && FNH.game.player.mapY === 65', false, false
        ));
        await screenshot('guard-prompt');

        await tapKey(cdp, 'ArrowUp', 'ArrowUp', 38);
        await waitFor(cdp, 'FNH.game.sceneName === "battle" && FNH.game.scene.enemy',
            20000, 'trận đấu Guard');

        // ---------------------------------------------------------
        // 6. Trận đấu theo lượt.
        // ---------------------------------------------------------
        check('trận đấu có đủ bảy bộ phận Guard', await evalPage(
            cdp, 'FNH.game.scene.enemy.parts.length === 7', false, false
        ));
        check('Guard có 320 HP', await evalPage(
            cdp, 'FNH.game.scene.enemy.maxHp === 320 && FNH.game.scene.enemy.hp === 320',
            false, false
        ));
        check('battleback gốc đã giải mã', await evalPage(
            cdp, 'FNH.game.assets.imageCache.has("battlebacks1/floor1")', false, false
        ));
        await waitFor(cdp, 'FNH.game.audio.currentBgm && FNH.game.audio.currentBgm.name === "muted_aggression"',
            45000, 'nhạc trận đấu');
        check('nhạc trận đấu đang phát', await evalPage(
            cdp, '!!(FNH.game.audio.currentBgm && FNH.game.audio.currentBgm.name === "muted_aggression")',
            false, false
        ));
        await waitFor(cdp, 'FNH.game.scene.phase === "command"', 15000, 'lượt chọn lệnh');
        await screenshot('battle');

        let battlePhase = 'command';
        for (let turn = 0; turn < 8 && battlePhase !== 'victory'; turn += 1) {
            battlePhase = await evalPage(cdp, 'FNH.game.scene.phase', false, false);
            if (battlePhase === 'victory') break;
            if (battlePhase === 'defeat' || battlePhase === 'fled') {
                throw new Error('Trận đấu kết thúc ngoài ý muốn: ' + battlePhase);
            }
            await tapKey(cdp, 'Enter', 'Enter', 13);
            await waitFor(cdp,
                'FNH.game.sceneName !== "battle" || ["command", "victory", "defeat", "fled"].indexOf(FNH.game.scene.phase) !== -1',
                12000, 'hết lượt ' + (turn + 1));
            battlePhase = await evalPage(cdp, 'FNH.game.scene.phase', false, false);
        }
        check('đánh bại Guard sau các lượt tấn công', battlePhase === 'victory', 'phase: ' + battlePhase);
        check('Guard bị đánh bại và phần thưởng được cộng', await evalPage(cdp, [
            '(() => {',
            '  const game = FNH.game;',
            '  return game.guardDefeated === true && game.gold === 35 &&',
            '    game.scene.enemy.hp === 0 && game.player.hp > 0;',
            '})()'
        ].join('\n'), false, false));
        await screenshot('victory');

        await tapKey(cdp, 'Enter', 'Enter', 13);
        await waitFor(cdp, 'FNH.game.sceneName === "map" && FNH.game.scene.ready === true',
            20000, 'trở lại bản đồ sau trận');
        check('trở lại hành lang và Guard biến mất', await evalPage(cdp, [
            '(() => {',
            '  const game = FNH.game;',
            '  return game.scene.guard.alive === false && game.player.mapX === 27 &&',
            '    game.player.mapY === 65 && game.player.hp > 0;',
            '})()'
        ].join('\n'), false, false));

        // ---------------------------------------------------------
        // 7. Lưu game qua menu tạm dừng.
        // ---------------------------------------------------------
        await tapKey(cdp, 'Escape', 'Escape', 27);
        await waitFor(cdp, 'FNH.game.scene.paused === true', 10000, 'menu tạm dừng');
        await screenshot('pause');
        await tapKey(cdp, 'ArrowDown', 'ArrowDown', 40);
        await sleep(200);
        check('chọn được mục Lưu game', await evalPage(
            cdp, 'FNH.game.scene.pauseIndex === 1', false, false
        ));
        await tapKey(cdp, 'Enter', 'Enter', 13);
        await waitFor(cdp, 'FNH.game.storage.exists(' + SAVE_SLOT + ') === true', 10000, 'save trong localStorage');
        const saveState = await evalPage(cdp, [
            '(() => {',
            '  const game = FNH.game;',
            '  const info = game.getSaveInfo();',
            '  const key = game.storage.key("save' + SAVE_SLOT + '");',
            '  return {',
            '    exists: game.storage.exists(' + SAVE_SLOT + '),',
            '    info: info,',
            '    key: key,',
            '    raw: !!localStorage.getItem(key),',
            '    prefix: game.storage.prefix',
            '  };',
            '})()'
        ].join('\n'), false, false);
        check('save dùng đúng namespace', saveState.key === 'FNH_ENGINE:' + namespace + ':save1' &&
            saveState.raw === true, JSON.stringify(saveState));
        check('save lưu đúng nhân vật và Guard đã gục', saveState.info &&
            saveState.info.playerName === 'Cahara' && saveState.info.guardDefeated === true &&
            saveState.info.mapId === 1, JSON.stringify(saveState.info));
        await tapKey(cdp, 'Escape', 'Escape', 27);
        await waitFor(cdp, 'FNH.game.scene.paused === false', 10000, 'đóng menu tạm dừng');
        await screenshot('saved');

        // ---------------------------------------------------------
        // 8. Tải lại trang và Continue từ localStorage.
        // ---------------------------------------------------------
        await cdp.send('Page.navigate', { url: url });
        await sleep(800);
        await clickStart(cdp);
        await waitFor(cdp, 'window.FNH && FNH.game && FNH.game.booted && FNH.game.sceneName === "title"',
            120000, 'tiêu đề sau tải lại');
        await waitFor(cdp, 'FNH.game.getSaveInfo() !== null', 10000, 'save sau tải lại');
        check('Continue được bật sau tải lại', await evalPage(
            cdp,
            'FNH.game.scene.entries[0].enabled === true && FNH.game.scene.index === 0',
            false, false
        ));
        await tapKey(cdp, 'Enter', 'Enter', 13);
        await waitFor(cdp, 'FNH.game.sceneName === "map" && FNH.game.scene.ready === true',
            30000, 'bản đồ sau Continue');
        check('Continue khôi phục vị trí, vàng và Guard', await evalPage(cdp, [
            '(() => {',
            '  const game = FNH.game;',
            '  return game.player.mapX === 27 && game.player.mapY === 65 &&',
            '    game.gold === 35 && game.guardDefeated === true &&',
            '    game.scene.guard.alive === false && game.player.hp > 0;',
            '})()'
        ].join('\n'), false, false));
        await screenshot('continue-map');

        // ---------------------------------------------------------
        // 9. Thất bại, màn hình chết và tải lại từ save.
        // ---------------------------------------------------------
        await evalPage(cdp, 'FNH.game.newGame(1); true', false, false);
        await waitFor(cdp, 'FNH.game.sceneName === "map" && FNH.game.scene.ready === true',
            30000, 'bản đồ mới cho kiểm tra thất bại');
        check('ván mới đặt lại Guard, vàng và vị trí', await evalPage(cdp, [
            '(() => {',
            '  const game = FNH.game;',
            '  return game.guardDefeated === false && game.gold === 0 &&',
            '    game.player.mapX === 27 && game.player.mapY === 67 &&',
            '    game.player.hp === game.player.maxHp;',
            '})()'
        ].join('\n'), false, false));
        await evalPage(cdp, 'FNH.game.player.hp = 1; true', false, false);
        await tapKey(cdp, 'ArrowUp', 'ArrowUp', 38);
        await sleep(500);
        await tapKey(cdp, 'ArrowUp', 'ArrowUp', 38);
        await sleep(500);
        await tapKey(cdp, 'ArrowUp', 'ArrowUp', 38);
        await waitFor(cdp, 'FNH.game.sceneName === "battle" && FNH.game.scene.phase === "command"',
            20000, 'trận đấu cho kiểm tra thất bại');
        await tapKey(cdp, 'ArrowDown', 'ArrowDown', 40);
        await tapKey(cdp, 'Enter', 'Enter', 13);
        await waitFor(cdp, 'FNH.game.sceneName === "gameover"', 30000, 'màn hình chết');
        check('màn hình chết có tải lần lưu cuối', await evalPage(
            cdp, 'FNH.game.scene.entries[0].enabled === true && FNH.game.scene.saveInfo !== null',
            false, false
        ));
        await screenshot('gameover');
        await tapKey(cdp, 'Enter', 'Enter', 13);
        await waitFor(cdp, 'FNH.game.sceneName === "map" && FNH.game.scene.ready === true',
            30000, 'tải lại sau khi chết');
        check('tải lại từ màn hình chết khôi phục save', await evalPage(cdp, [
            '(() => {',
            '  const game = FNH.game;',
            '  return game.gold === 35 && game.guardDefeated === true &&',
            '    game.scene.guard.alive === false && game.player.mapX === 27 &&',
            '    game.player.mapY === 65;',
            '})()'
        ].join('\n'), false, false));

        // Dọn save test khỏi localStorage.
        const removed = await evalPage(cdp, [
            '(() => {',
            '  const prefix = "FNH_ENGINE:' + namespace + ':";',
            '  const keys = Object.keys(localStorage).filter(function (key) { return key.indexOf(prefix) === 0; });',
            '  keys.forEach(function (key) { localStorage.removeItem(key); });',
            '  return keys.length;',
            '})()'
        ].join('\n'), false, false);
        check('dọn save test khỏi localStorage', removed >= 1, 'đã xoá ' + removed + ' khoá');

        const relevantErrors = runtimeErrors.filter((details) => {
            const description = details.exception && (details.exception.description || details.exception.value) || '';
            return !/physical_attack_animation/.test(description);
        });
        const relevantLogs = logErrors.filter((entry) => {
            const text = entry.text || '';
            return !/physical_attack_animation/.test(text);
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
                    '  const keys = Object.keys(localStorage).filter(function (key) {',
                    '    return key.indexOf("FNH_ENGINE:smoke-") === 0;',
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
        } else {
            log('Ảnh chụp: ' + shotsDir);
        }
    }
}

main().catch((error) => {
    process.exitCode = 1;
});
