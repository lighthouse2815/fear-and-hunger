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
    // Chỉ tắt đầu ra loa; vẫn kiểm tra phát/giải mã audio và volume thật.
    '--mute-audio',
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
    if(selector==='#fnh-end-load') {
        const slot=await evalPage(cdp,'document.querySelector("#fnh-end-save-slot").value',false,false);
        return clickElement(cdp,'#fnh-end-file-list [data-slot="'+slot+'"]');
    }
    if (selector === '#fnh-menu-close' && await evalPage(cdp,'getComputedStyle(document.querySelector("#fnh-menu-close")).display === "none"',false,false)) {
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
        if(await evalPage(cdp,'document.querySelector("#fnh-menu-dialog").open && document.querySelector("#fnh-menu-dialog").classList.contains("fnh-menu-tabs")',false,false)) {
            await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
        }
        return;
    }
    if(await evalPage(cdp,'document.body.classList.contains("fnh-gameplay")',false,false)) {
        await evalPage(cdp,`(()=>{const button=document.querySelector(${JSON.stringify(selector)});if(!button || button.disabled)throw Error('Không xác nhận được nút: '+${JSON.stringify(selector)});button.focus({preventScroll:true});})()`,false,false);
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});return;
    }
    const point = await evalPage(cdp, `(async () => {
        const selector = ${JSON.stringify(selector)};
        document.querySelector(selector).scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        // Hai frame để layout/scroll của dialog và màn hình điện thoại ổn định.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const element = document.querySelector(selector);
        const rect = element.getBoundingClientRect();
        const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        if (!element.contains(document.elementFromPoint(point.x, point.y))) throw new Error('Nút bị che hoặc chưa hiển thị: ' + selector);
        return point;
    })()`, true, false);
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

        const primaryHtml = await (await fetch(running.url)).text();
        check('entry chính mở engine độc lập và không chèn compat', primaryHtml.includes('standalone.html?') && !primaryHtml.includes('__fnh/compat.js'));
        const indexResponse = await fetch(running.url + 'legacy.html');
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
        if (process.env.FNH_BROWSER_SCOPE === 'settings') {
            await require('./browser-settings')({cdp,url:running.url,evalPage,waitFor,check});
            check('không có lỗi runtime trong cài đặt',runtimeErrors.length===0,JSON.stringify(runtimeErrors));
            log('Hoàn tất '+passed+' kiểm tra cài đặt.');return;
        }
        if (process.env.FNH_BROWSER_SCOPE === 'party') {
            await require('./browser-party')({cdp,url:running.url,evalPage,waitFor,clickElement,check,screenshot});
            check('không có lỗi runtime khi tuyển và hiển thị đồng đội',runtimeErrors.length===0,JSON.stringify(runtimeErrors));
            log('Hoàn tất '+passed+' kiểm tra đội hình.');return;
        }
        if (process.env.FNH_BROWSER_SCOPE === 'playtime') {
            await require('./browser-play-time')({cdp,url:running.url,evalPage,waitFor,check,screenshot});
            check('không có lỗi runtime khi hiển thị thời gian chơi',runtimeErrors.length===0,JSON.stringify(runtimeErrors));
            log('Hoàn tất '+passed+' kiểm tra thời gian chơi.');return;
        }
        if (process.env.FNH_BROWSER_SCOPE === 'cheat') {
            await require('./browser-name-cheat')({cdp,url:running.url,evalPage,waitFor,check});
            check('không có lỗi runtime khi dùng cheat',runtimeErrors.length===0,JSON.stringify(runtimeErrors));
            log('Hoàn tất '+passed+' kiểm tra bất tử.');return;
        }
        if(process.env.FNH_BROWSER_SCOPE==='input') {
            await require('./browser-keyboard')({cdp,url:running.url,evalPage,waitFor,check});
            check('không có lỗi runtime khi khóa chuột',runtimeErrors.length===0,JSON.stringify(runtimeErrors));
            log('Hoàn tất '+passed+' kiểm tra điều khiển.');return;
        }
        if (process.env.FNH_BROWSER_SCOPE === 'movement') {
            await require('./browser-movement')({cdp,url:running.url,evalPage,waitFor,clickElement,check,screenshot});
            check('không có lỗi runtime khi di chuyển',runtimeErrors.length===0,JSON.stringify(runtimeErrors));
            log('Hoàn tất '+passed+' kiểm tra chuyển động.');return;
        }
        if(process.env.FNH_BROWSER_SCOPE==='save') {
            await require('./browser-save')({cdp,url:running.url,evalPage,waitFor,clickElement,check,screenshot});
            check('không có lỗi runtime ở màn lưu tải',runtimeErrors.length===0,JSON.stringify(runtimeErrors));
            log('Hoàn tất '+passed+' kiểm tra lưu tải.');return;
        }
        if (process.env.FNH_BROWSER_SCOPE === 'menu') {
            await require('./browser-menu')({cdp,url:running.url,evalPage,waitFor,clickElement,check,screenshot});
            check('không có lỗi runtime trong menu',runtimeErrors.length===0,JSON.stringify(runtimeErrors));
            log('Hoàn tất ' + passed + ' kiểm tra menu.'); return;
        }
        if (process.env.FNH_BROWSER_SCOPE === 'dialogue') {
            await require('./browser-dialogue')({cdp,url:running.url,evalPage,waitFor,clickElement,check,screenshot});
            check('không có lỗi runtime trong hội thoại', runtimeErrors.length === 0, JSON.stringify(runtimeErrors));
            log('Hoàn tất ' + passed + ' kiểm tra hội thoại.'); return;
        }
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', {source: `
            window.fnhTestCombatAttack=function(){
                const targets=document.querySelector('#fnh-combat-targets');
                if(targets && !targets.hidden){
                    const target=targets.querySelector('[data-target="0"]:enabled') || targets.querySelector('button:enabled');
                    if(target)target.click();return;
                }
                const commands=document.querySelector('#fnh-combat-commands');
                if(commands && !commands.hidden){
                    const attack=[...commands.querySelectorAll('button:enabled')].find(button=>button.textContent==='Attack');
                    if(attack)attack.click();
                    else {const fight=[...commands.querySelectorAll('button:enabled')].find(button=>button.textContent==='Fight');if(fight)fight.click();}
                }
            };`});

        if (process.env.FNH_BROWSER_SCOPE === 'combat') {
            await require('./browser-combat')({ cdp, url: running.url, evalPage, waitFor, clickElement, check, screenshot });
            check('không có lỗi runtime trong giao diện chiến đấu', runtimeErrors.length === 0, JSON.stringify(runtimeErrors));
            log('Hoàn tất ' + passed + ' kiểm tra combat.');
            return;
        }

        const namespace = 'smoke-' + process.pid + '-' + Date.now().toString(36);
        const url = running.url + 'legacy.html?fnh_save_ns=' + encodeURIComponent(namespace);
        log('Mở: ' + url);
        await cdp.send('Page.navigate', { url: url });
        await sleep(800);

        // Menu phải xuất hiện trước bất kỳ tương tác nào; không dựa vào query bỏ intro.
        await waitFor(cdp, 'window.SceneManager && typeof Scene_Title === "function" && SceneManager._scene instanceof Scene_Title && SceneManager.isCurrentSceneStarted()', 60000, 'menu tự xuất hiện');
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
        check('chơi bình thường giữ âm lượng gốc 100 phần trăm', await evalPage(cdp,
            'ConfigManager.masterVolume === 100 && ConfigManager.bgmVolume === 100 && ConfigManager.bgsVolume === 100 && ConfigManager.meVolume === 100 && ConfigManager.seVolume === 100 && Graphics._video.volume === 1', false, false));
        await evalPage(cdp, 'ConfigManager.masterVolume = 5', false, false);
        await waitFor(cdp, 'WebAudio._masterGainNode && WebAudio._masterGainNode.gain.value <= 0.050001',
            5000, 'gain Web Audio cập nhật theo chu kỳ xử lý âm thanh');
        check('giảm tổng xuống 5 phần trăm chỉ trong fixture kiểm thử', await evalPage(cdp,
            'AudioManager.masterVolume === 0.05 && Graphics._video.volume === 0.05', false, false));
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
        check('cấu hình cũ không bị ép nhỏ hoặc khóa master', await evalPage(cdp, `(() => {
            const config = ConfigManager.makeData(); config.masterVolume = 100; config.fnhQuietVolumeApplied = true;
            ConfigManager.applyData(config);
            return ConfigManager.masterVolume === 100 && Graphics._video.volume === 1;
        })()`, false, false));
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
            'Math.abs(AudioManager._bgmBuffer.volume - 37 * AudioManager._currentBgm.volume / 10000) < 0.00001 && AudioManager.bgsVolume === 29 && AudioManager.meVolume === 43 && AudioManager.seVolume === 61 && Graphics._video.volume === 0.8 && ConfigManager.masterVolume === 80 && document.querySelector("#fnh-masterVolume").max === "100"', false, false));
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
        await waitFor(cdp, 'window.SceneManager && typeof Scene_Title === "function" && SceneManager._scene instanceof Scene_Title && SceneManager.isCurrentSceneStarted()', 60000, 'menu tự xuất hiện sau tải lại');
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
        await waitFor(cdp, 'window.SceneManager && typeof Scene_Title === "function" && SceneManager._scene instanceof Scene_Title && SceneManager.isCurrentSceneStarted()', 60000, 'menu trên điện thoại');
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
        check('lệnh vùng cũ không che map và nhân vật khi plugin gốc không bật', await evalPage(cdp, `(async () => {
            const e = new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore});
            await e.boot({mapId:1,x:34,y:63,party:[1]});
            e.lighting = null; e.screen = null;
            const renderer = new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas'));
            await renderer.draw(e);
            const before = renderer.context.getImageData(0,0,816,624).data;
            await e.createInterpreter([{code:356,parameters:['RegionReveal 1']}],1).run();
            await renderer.draw(e);
            const after = renderer.context.getImageData(0,0,816,624).data;
            return e.state.regionCover.enabled && before.every((value,index)=>value===after[index]);
        })()`, true, false));
        await evalPage(cdp, `(async () => {
            const e = FNHStandalonePreview.engine;
            window.beforeMapTransition = e.save();
            await e.restore({ mapId: 74, x: 15, y: 5, direction: 8, party: [1], switches: {246:true, 3480:true}, variables: {121:1} });
            document.querySelector('#fnh-canvas').focus();
        })()`, true, false);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp' });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp' });
        await waitFor(cdp, '!document.querySelector("#fnh-map-fade").hidden', 10000, 'cửa thật bắt đầu chuyển cảnh');
        check('chuyển map dùng fade đen của sự kiện gốc', await evalPage(cdp,
            'getComputedStyle(document.querySelector("#fnh-map-fade")).backgroundColor === "rgb(0, 0, 0)"', false, false));
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.mapId === 1 && document.querySelector("#fnh-map-fade").hidden',
            10000, 'chuyển cảnh vào map mới hoàn tất');
        check('map mới hiện đúng tên từ dữ liệu gốc', await evalPage(cdp,
            'FNHStandalonePreview.engine.screen.mapName.text === FNHStandalonePreview.engine.map.data.displayName && FNHStandalonePreview.engine.screen.mapName.opacity > 0', false, false));
        await waitFor(cdp, '!FNHStandalonePreview.engine.eventRunning && !FNHStandalonePreview.engine.stepRunning',
            10000, 'sự kiện chuyển map kết thúc');
        await evalPage(cdp, '(async () => { await FNHStandalonePreview.engine.restore(window.beforeMapTransition); })()', true, false);
        await evalPage(cdp, `(() => {
            const e = FNHStandalonePreview.engine;
            window.shortcutBefore = e.save();
            e.state.gainItem('items', 5, 2); e.state.setSwitch(2845, true);
            document.querySelector('#fnh-canvas').focus();
        })()`, false, false);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 't', code: 'KeyT', windowsVirtualKeyCode: 84 });
        await waitFor(cdp, 'document.querySelector("#fnh-message-text").textContent.includes("light the torch") && !document.querySelector("#fnh-next").hidden', 5000, 'phím T gọi common event đốt đuốc');
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 't', code: 'KeyT', windowsVirtualKeyCode: 84 });
        check('phím T khóa điều khiển và chỉ trừ một đuốc khi chờ thoại', await evalPage(cdp,
            'FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.engine.state.itemCount("items",5) === (window.shortcutBefore.inventory.items[5] || 0) + 1 && !FNHStandalonePreview.engine.move(6)', false, false));
        await clickElement(cdp, '#fnh-next');
        await waitFor(cdp, '!FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.engine.state.switchValue(3151)', 5000, 'đuốc bật ánh sáng và bộ đếm');
        await clickElement(cdp, '[data-common-event="289"]');
        await waitFor(cdp, '!document.querySelector("#fnh-next").hidden', 5000, 'nút đốt đuốc trên điện thoại');
        await clickElement(cdp, '#fnh-next');
        await waitFor(cdp, '!FNHStandalonePreview.engine.eventRunning', 5000, 'kết thúc đuốc thứ hai');
        check('nút đốt đuốc chạy cùng common event thật', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.itemCount("items",5) === (window.shortcutBefore.inventory.items[5] || 0) && FNHStandalonePreview.engine.state.variableValue(398) === 40 && FNHStandalonePreview.engine.lighting.lighting.radius === 300', false, false));
        await evalPage(cdp, 'window.shortcutMp = FNHStandalonePreview.engine.state.actor(1).mp; document.querySelector("#fnh-canvas").focus()', false, false);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 });
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.switchValue(2844)', 5000, 'phím C gọi Phase');
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 });
        check('phím C dùng Phase theo MP và switch trong JSON', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.actor(1).mp === window.shortcutMp - 10', false, false));
        await evalPage(cdp, '(async () => { await FNHStandalonePreview.engine.restore(window.shortcutBefore); delete window.shortcutBefore; delete window.shortcutMp; })()', true, false);
        check('preview mặc định giữ toàn bộ thang âm lượng khi chơi bình thường', await evalPage(cdp,
            'FNHStandalonePreview.audio.masterVolume===1 && FNHStandalonePreview.settings.volumes.master===100 && document.querySelector("#fnh-volume").max==="100"',false,false));
        const settingsState = await evalPage(cdp,'FNHStandalonePreview.engine.save()',false,false);
        await clickElement(cdp,'#fnh-menu');await clickElement(cdp,'[data-menu-tab="options"]');
        await evalPage(cdp, `(() => {
            for(const [category,value] of [['master',3],['bgm',37],['se',2]]) {
                const slider=document.querySelector('[data-volume="'+category+'"]');slider.value=value;slider.dispatchEvent(new Event('input'));
            }
            document.querySelector('#fnh-key-action').value='torch';document.querySelector('#fnh-key-input').focus();
        })()`,false,false);
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'h',code:'KeyH',windowsVirtualKeyCode:72});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'h',code:'KeyH',windowsVirtualKeyCode:72});
        await evalPage(cdp,'document.querySelector("#fnh-key-action").value="";document.querySelector("#fnh-key-input").focus()',false,false);
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'t',code:'KeyT',windowsVirtualKeyCode:84});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'t',code:'KeyT',windowsVirtualKeyCode:84});
        check('menu tùy chọn cập nhật âm lượng và gán/bỏ phím',await evalPage(cdp, `(() => {
            const app=FNHStandalonePreview;
            return document.querySelectorAll('[data-volume]').length===5 && app.audio.masterVolume===0.03 && app.audio.volumes.bgm===0.37 &&
                app.audio.volumes.se===0.02 && document.querySelector('#fnh-video').volume===0.03 && document.querySelector('#fnh-volume').value==='3' &&
                app.settings.actionFor('h')==='torch' && !app.settings.actionFor('t');
        })()`,false,false));
        const settingsTime = await evalPage(cdp,'performance.timeOrigin',false,false);
        await cdp.send('Page.navigate',{url:running.url+'standalone.html'});
        await waitFor(cdp,'performance.timeOrigin!=='+settingsTime+' && window.FNHStandalonePreview && FNHStandalonePreview.engine.map && document.querySelector("#fnh-status").textContent.startsWith("Map 74")',30000,'tải lại tùy chọn đã lưu');
        check('âm lượng và cấu hình phím giữ sau tải lại trang',await evalPage(cdp,
            'FNHStandalonePreview.audio.masterVolume===0.03 && FNHStandalonePreview.audio.volumes.bgm===0.37 && FNHStandalonePreview.settings.actionFor("h")==="torch" && !FNHStandalonePreview.settings.actionFor("t")',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.state.gainItem("items",5,1);document.querySelector("#fnh-canvas").focus()',false,false);
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'h',code:'KeyH',windowsVirtualKeyCode:72});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'h',code:'KeyH',windowsVirtualKeyCode:72});
        await waitFor(cdp,'!document.querySelector("#fnh-next").hidden && document.querySelector("#fnh-message-text").textContent.includes("light the torch")',5000,'phím vừa gán gọi common event thật');
        await clickElement(cdp,'#fnh-next');await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning',5000,'xong common event phím mới');
        check('nhấn nhanh phím đã gán vẫn chạy đốt đuốc đúng một lần',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.itemCount("items",5)===0 && FNHStandalonePreview.engine.state.switchValue(3151)',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.state.through=true;window.settingsX=FNHStandalonePreview.engine.state.x;document.querySelector("#fnh-canvas").focus()',false,false);
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'d',code:'KeyD',windowsVirtualKeyCode:68});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'d',code:'KeyD',windowsVirtualKeyCode:68});
        await waitFor(cdp,'FNHStandalonePreview.engine.state.x===window.settingsX+1',5000,'WASD di chuyển thật');
        check('WASD mặc định điều khiển được nhân vật sau tải lại',await evalPage(cdp,'FNHStandalonePreview.settings.actionFor("w")==="up" && FNHStandalonePreview.settings.actionFor("d")==="right"',false,false));
        await waitFor(cdp,'!FNHStandalonePreview.engine.stepRunning && FNHStandalonePreview.engine.state.moveFrames===0',5000,'sprite tới đích trước khi mở menu tùy chọn');
        await clickElement(cdp,'#fnh-menu');await clickElement(cdp,'[data-menu-tab="options"]');await clickElement(cdp,'[data-key-layout="default"]');
        await evalPage(cdp, `(() => {
            for(const [category,value] of [['master',5],['bgm',100],['se',100]]) {
                const slider=document.querySelector('[data-volume="'+category+'"]');slider.value=value;slider.dispatchEvent(new Event('input'));
            }
            delete window.settingsX;
        })()`,false,false);
        await evalPage(cdp,'FNHStandalonePreview.engine.restore('+JSON.stringify(settingsState)+').then(()=>true)',true,false);
        await waitFor(cdp,'!document.querySelector("#fnh-menu-dialog").open',5000,'khôi phục bản đồ sau kiểm tra tùy chọn');
        check('Canvas vẽ sprite giữa bước và giữ đúng pixel sau tải save',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true});
            await e.boot({mapId:74,x:2,y:2,party:[1],alwaysDash:false,characterName:'$guard1',characterIndex:0});
            const blank=()=>new FNHStandaloneMap.GameMap({id:74,width:40,height:30,data:Array(7200).fill(0),events:[]},{flags:[16],tilesetNames:[]},e.state);
            e.map=blank();e.state.through=true;e.move(6);e.advanceRoutes(8);
            const canvas=document.createElement('canvas'),renderer=new FNHStandaloneCanvas.CanvasRenderer(canvas);
            await renderer.draw({state:e.state,map:e.map});
            const actual=canvas.getContext('2d').getImageData(0,0,816,624).data;
            const image=new Image();image.src='img/characters/%24guard1.png';await image.decode();
            const expected=document.createElement('canvas');expected.width=816;expected.height=624;
            const ctx=expected.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#080706';ctx.fillRect(0,0,816,624);
            const w=image.width/3,h=image.height/4;
            ctx.drawImage(image,0,2*h,w,h,144-w/2,138-h,w,h);
            const pixels=ctx.getImageData(0,0,816,624).data;
            if(!pixels.every((value,index)=>value===actual[index]))return false;
            const saved=e.save();e.advanceRoutes(8);await e.restore(saved);e.map=blank();
            await renderer.draw({state:e.state,map:e.map});
            const restored=canvas.getContext('2d').getImageData(0,0,816,624).data;
            return e.state.x===3 && e.state.moveFrames===8 && pixels.every((value,index)=>value===restored[index]);
        })()`,true,false));
        check('renderer nội suy đồng đội, guest và quái dùng route',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true});
            await e.boot({mapId:74,x:5,y:5,party:[1,3],guests:[2],alwaysDash:false});e.state.through=true;
            e.map=new FNHStandaloneMap.GameMap({id:74,width:40,height:30,data:Array(7200).fill(0),events:[null,{id:1,x:12,y:5,pages:[{
                conditions:{},trigger:0,priorityType:1,moveSpeed:4,through:true,image:{characterName:'$guard1',direction:6,pattern:1},list:[]
            }]}]},{flags:[16],tilesetNames:[]},e.state);
            e.move(6);e.advanceRoutes(16);e.move(2);
            e.movement.start(e.map.eventById(1),{list:[{code:3},{code:0}]});e.advanceRoutes(8);
            const renderer=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas')),positions=[];
            const draw=renderer.drawActor;renderer.drawActor=function(sheets,entry,x,y){positions.push(entry);return draw.call(this,sheets,entry,x,y);};
            await renderer.draw({state:e.state,map:e.map});
            return positions.some(p=>p.id===Infinity&&p.x===6&&p.y===5.5) && positions.some(p=>p.id===100003&&p.x===5.5&&p.y===5) &&
                positions.some(p=>p.id===100002&&p.x===5&&p.y===5) && positions.some(p=>p.id===1&&p.x===12.5&&p.y===5);
        })()`,true,false));
        check('nhảy nâng sprite, balloon và animation cùng vị trí nội suy',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true});
            await e.boot({mapId:74,x:2,y:2,party:[1],alwaysDash:false,characterName:'$guard1',characterIndex:0});
            e.map=new FNHStandaloneMap.GameMap({id:74,width:40,height:30,data:Array(7200).fill(0),events:[]},{flags:[16],tilesetNames:[]},e.state);
            e.movement.start(e.state,{list:[{code:14,parameters:[2,0]},{code:0}]});e.advanceRoutes(8);
            const renderer=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas')),drawn=[];
            const draw=renderer.drawActor;renderer.drawActor=function(sheets,entry,x,y){drawn.push(entry);return draw.call(this,sheets,entry,x,y);};
            await renderer.draw({state:e.state,map:e.map});
            const actor=drawn[0];if(actor.x!==3||actor.y!==2||actor.lift!==32)return false;
            const calls=[];renderer.context.drawImage=(...args)=>calls.push(args);
            actor.balloon={id:1,remaining:76};renderer.drawBalloon({},actor,0,0);
            const h=actor.bitmap.height/4;if(calls[0][5]!==144||calls[0][6]!==144-h-48-6-32)return false;
            let location;renderer.drawAnimationCells=(animation,x,y)=>{location=[x,y];};
            renderer.drawAnimation({entry:{targetId:-1,elapsed:0},data:{position:2,frames:[[]]}},e.state,e.map,0,0);
            return location[0]===168&&location[1]===112;
        })()`,true,false));
        check('cửa thật Map074 chờ sprite tới hết bước rồi mới chuyển map',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,random:()=>0});
            await e.boot({mapId:74,x:15,y:5,direction:8,directionFixed:true,party:[1],alwaysDash:false,
                switches:{246:true,3480:true},variables:{121:1}});
            const entered=e.step(8),duration=e.state.moveFrames;
            e.advanceRoutes(duration-1);await Promise.resolve();
            const position=FNHStandaloneMap.displayPosition(e.state);
            if(!e.stepRunning || e.state.mapId!==74 || position.y<=4 || position.y>=5 || e.openMenu())return false;
            e.advanceRoutes(1);await entered;
            return !e.stepRunning && e.state.mapId===1 && e.state.x===27 && e.state.y===68 &&
                e.state.variableValue(30)===100 && e.state.switchValue(775);
        })()`,true,false));
        check('Canvas vẽ follower và guest ở vị trí lưu, ẩn cả hai đúng lệnh', await evalPage(cdp, `(async () => {
            const source = FNHStandalonePreview.engine;
            const state = new FNHStandaloneState.GameState({ mapId: 74, x: 15, y: 15, party: [1, 2], guests: [3],
                followerPositions: [{ id: 2, x: 14, y: 15, direction: 6 }, { id: 3, x: 13, y: 15, direction: 2 }] }, source.database);
            const map = new FNHStandaloneMap.GameMap({ ...source.map.data, id: 74, events: [], parallaxName: '' }, source.map.tileset, state);
            const canvas = document.createElement('canvas');
            const renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas);
            const drawn = [], drawActor = renderer.drawActor;
            renderer.drawActor = function (sheets, entry, x, y) { drawn.push(entry); return drawActor.call(this, sheets, entry, x, y); };
            await renderer.draw({ state, map });
            const withFollowers = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            const positionsCorrect = drawn.length === 3 && drawn.some(entry => entry.x === 14 && entry.image.characterName === state.actor(2).characterName) &&
                drawn.some(entry => entry.x === 13 && entry.image.direction === 2 && entry.image.characterName === state.actor(3).characterName);
            state.followersVisible = false; drawn.length = 0;
            await renderer.draw({ state, map });
            const hidden = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            return positionsCorrect && drawn.length === 1 && withFollowers.some((value, index) => value !== hidden[index]);
        })()`, true, false));
        check('fog PNG lặp kín Canvas, đúng opacity/zoom và nằm dưới picture', await evalPage(cdp, `(async () => {
            const original = FNHStandalonePreview.engine;
            const state = new FNHStandaloneState.GameState({ mapId: 74, x: 8, y: 8, party: [1] }, original.database);
            const screen = new FNHStandaloneScreen.ScreenRuntime(state); screen.setupFogs(original.map.data.note);
            const map = new FNHStandaloneMap.GameMap({ ...original.map.data, id: 74, events: [] }, original.map.tileset, state);
            const canvas = document.createElement('canvas'), renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas, { width: 96, height: 96 });
            const fogs = await renderer.fogImages(screen.screen, false);
            const fog = { ...fogs[0].fog, x: 500, y: 500, opacity: 128, zoom: 1.5, blend: 0 };
            renderer.drawFogs([{ fog, bitmap: fogs[0].bitmap }], 1, 0, 0);
            const reference = document.createElement('canvas'); reference.width = reference.height = 96;
            const context = reference.getContext('2d'); context.imageSmoothingEnabled = false; context.globalAlpha = 128 / 255;
            for (const y of [-750,18]) for (const x of [-750,18]) context.drawImage(fogs[0].bitmap, x, y, 768, 768);
            const expected = context.getImageData(0,0,96,96).data;
            const actual = canvas.getContext('2d').getImageData(0,0,96,96).data;
            if (!actual.every((value,index)=>value===expected[index]) || !actual.some(value=>value>0)) return false;
            await renderer.draw({ state, screen, map });
            const withFog = canvas.getContext('2d').getImageData(0,0,96,96).data;
            screen.screen.fogs = []; await renderer.draw({ state, screen, map });
            const without = canvas.getContext('2d').getImageData(0,0,96,96).data;
            if (!withFog.some((value,index)=>value!==without[index])) return false;
            screen.setupFogs(original.map.data.note);
            screen.handleEffect(231, [1,'Actor1_1',0,0,0,0,100,100,255,0]);
            await renderer.draw({ state, screen, map });
            const pixel = canvas.getContext('2d').getImageData(0,0,96,96).data;
            screen.screen.fogs = []; await renderer.draw({ state, screen, map });
            const noFogPicture = canvas.getContext('2d').getImageData(0,0,96,96).data;
            context.globalAlpha = 1; context.clearRect(0,0,96,96);
            context.drawImage(await renderer.loadImage('img/pictures/Actor1_1.png'),0,0);
            const mask = context.getImageData(0,0,96,96).data;
            let opaque = 0;
            for (let index=0;index<mask.length;index+=4) if(mask[index+3]===255) {
                opaque++;
                for(let channel=0;channel<4;channel++) if(pixel[index+channel]!==noFogPicture[index+channel]) return false;
            }
            return opaque > 100;
        })()`, true, false));
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
        check('parallax tĩnh đứng yên, loop cuộn nửa tốc độ camera và nền ! bám map', await evalPage(cdp, `(async () => {
            const canvas = document.createElement('canvas'), renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas,{width:96,height:96});
            const bitmap = await renderer.loadImage('img/parallaxes/fortress1.png');
            const reference = document.createElement('canvas');reference.width=reference.height=96;
            const context=reference.getContext('2d');context.imageSmoothingEnabled=false;
            for (const [settings,x,y] of [
                [{name:'fortress1',loopX:false,loopY:false},0,0],
                [{name:'fortress1',loopX:true,loopY:true,x:3,y:-2},51,22],
                [{name:'!fortress1',loopX:false,loopY:false},96,48]
            ]) {
                renderer.context.clearRect(0,0,96,96);context.clearRect(0,0,96,96);
                renderer.drawParallax(bitmap,settings,2,1);context.drawImage(bitmap,-x,-y);
                const actual=renderer.context.getImageData(0,0,96,96).data,expected=context.getImageData(0,0,96,96).data;
                if(!actual.every((value,index)=>value===expected[index])) return false;
            }
            const tile=document.createElement('canvas');tile.width=tile.height=16;
            const tileContext=tile.getContext('2d');tileContext.fillStyle='#a2314b';tileContext.fillRect(0,0,16,16);
            renderer.context.clearRect(0,0,96,96);renderer.drawParallax(tile,{name:'small',loopX:false,loopY:false},20,20);
            const pixels=renderer.context.getImageData(0,0,96,96).data;
            return pixels.every((value,index)=>value===[162,49,75,255][index%4]);
        })()`,true,false));
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
        await waitFor(cdp, '!FNHStandalonePreview.engine.stepRunning && FNHStandalonePreview.engine.state.moveFrames===0', 5000, 'hoàn tất bước trước khi tải save preview');
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
        await evalPage(cdp, `(() => {
            window.__firstSlot = localStorage.getItem('FNH_STANDALONE_PREVIEW:1');
            const slots = document.querySelector('#fnh-menu-save-slot');
            slots.value = 20; slots.dispatchEvent(new Event('change'));
            FNHStandalonePreview.engine.state.setVariable(8234, 42);
        })()`, false, false);
        await clickElement(cdp, '#fnh-menu-save');
        check('menu lưu riêng hai mươi ô và hiện thông tin checkpoint', await evalPage(cdp, `(() => {
            const slots = document.querySelector('#fnh-menu-save-slot');
            const saved = JSON.parse(localStorage.getItem('FNH_STANDALONE_PREVIEW:20')).state;
            const bounds = slots.getBoundingClientRect(), dialog = document.querySelector('#fnh-menu-dialog').getBoundingClientRect();
            return slots.options.length === 20 && slots.selectedOptions[0].textContent.includes('Map 74') &&
                bounds.left >= dialog.left && bounds.right <= dialog.right &&
                saved.variables[8234] === 42 && saved.scene === 'map' && localStorage.getItem('FNH_STANDALONE_PREVIEW:1') === window.__firstSlot;
        })()`, false, false));
        await evalPage(cdp, 'FNHStandalonePreview.engine.state.setVariable(8234, 0)', false, false);
        await clickElement(cdp, '#fnh-menu-load');
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.scene === "map" && FNHStandalonePreview.engine.state.variableValue(8234) === 42 && !document.querySelector("#fnh-menu-dialog").open', 5000, 'tải ô 20 từ menu');
        check('menu tải đúng ô được chọn', await evalPage(cdp, 'FNHStandalonePreview.engine.state.variableValue(8234) === 42', false, false));
        await clickElement(cdp, '#fnh-menu'); await clickElement(cdp, '[data-menu-tab="system"]');
        await evalPage(cdp, `(() => {
            const slots = document.querySelector('#fnh-menu-save-slot'); slots.value = 1; slots.dispatchEvent(new Event('change'));
            localStorage.removeItem('FNH_STANDALONE_PREVIEW:20'); delete window.__firstSlot;
        })()`, false, false);
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
            const e=FNHStandalonePreview.engine;window.equipmentBefore=e.save();e.openMenu();e.clearMenuEquipment(1);
            const traits=e.battle.battlerTraits({id:1}),wrong=e.database.Weapons.find(item=>item&&!traits.some(t=>t.code===51&&t.dataId===item.wtypeId));
            window.equipmentWrong=wrong.id;e.state.gainItem('weapons',wrong.id,1);e.state.gainItem('weapons',4,1);e.state.gainItem('armors',28,1);
            const shield=e.database.Armors.find(item=>item&&item.etypeId===2&&traits.some(t=>t.code===52&&t.dataId===item.atypeId));
            window.equipmentShield=shield.id;window.equipmentShieldCount=e.state.itemCount('armors',shield.id);e.state.gainItem('armors',shield.id,1);
            e.closeMenu();
        })()`,false,false);
        await clickElement(cdp,'#fnh-menu');await clickElement(cdp,'[data-menu-tab="equipment"]');
        await evalPage(cdp,`(() => {
            const select=document.querySelector('#fnh-menu-actor');select.value='1';select.dispatchEvent(new Event('change'));
        })()`,false,false);
        check('menu trang bị lọc món không dùng được và có tối ưu/tháo hết',await evalPage(cdp,`(() => {
            const select=document.querySelector('select[data-slot="0"]');
            return !Array.from(select.options).some(option=>Number(option.value)===window.equipmentWrong) &&
                !!document.querySelector('[data-equipment-action="optimize"]') && !!document.querySelector('[data-equipment-action="clear"]');
        })()`,false,false));
        await evalPage(cdp,`(() => {
            const select=document.querySelector('select[data-slot="1"]');select.value=window.equipmentShield;select.dispatchEvent(new Event('change'));
        })()`,false,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.state.actor(1).equips[1]===window.equipmentShield && !document.querySelector("select[data-slot=\\"0\\"]").disabled',5000,'đeo khiên trước vũ khí hai tay');
        await evalPage(cdp,`(() => {
            const select=document.querySelector('select[data-slot="0"]');select.value=4;select.dispatchEvent(new Event('change'));
        })()`,false,false);
        await waitFor(cdp,'document.querySelector("select[data-slot=\\"1\\"]").disabled',5000,'vũ khí hai tay khóa ô khiên');
        check('Crude sword trả khiên về túi và UI khóa ô Shield',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.actor(1).equips[1]===0 && FNHStandalonePreview.engine.state.itemCount("armors",window.equipmentShield)===window.equipmentShieldCount+1',false,false));
        await evalPage(cdp,`(() => {
            const select=document.querySelector('select[data-slot="4"]');select.value=28;select.dispatchEvent(new Event('change'));
        })()`,false,false);
        await waitFor(cdp,'document.querySelector("select[data-slot=\\"4\\"]").disabled',5000,'vòng nguyền khóa ô phụ kiện');
        await clickElement(cdp,'[data-equipment-action="clear"]');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.actor(1).equips[0]===0 && !document.querySelector("[data-equipment-action=\\"optimize\\"]").disabled',5000,'tháo các ô thay được');
        await clickElement(cdp,'[data-equipment-action="optimize"]');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.actor(1).equips[0]>0 && !document.querySelector("[data-equipment-action=\\"clear\\"]").disabled',5000,'tối ưu trang bị dùng được');
        check('tháo hết và tối ưu giữ Ring of the still-blood bị khóa',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.actor(1).equips[4]===28 && document.querySelector("select[data-slot=\\"4\\"]").disabled && document.querySelector("#fnh-menu-content").textContent.includes("Ô trang bị bị khóa")',false,false));
        await evalPage(cdp,`(async()=>{
            await FNHStandalonePreview.engine.restore(window.equipmentBefore);
            for(const key of ['equipmentBefore','equipmentWrong','equipmentShield','equipmentShieldCount'])delete window[key];
        })()`,true,false);
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;window.statusBefore=e.save();e.state.party=[1,3];e.state.addActor(3);e.state.addGuestActor(2);
            const actor=e.state.actor(1),base=e.state.actorExpForLevel(1,actor.level),next=e.state.actorExpForLevel(1,actor.level+1);
            e.state.changeActorExp(1,base+Math.floor((next-base)/2)-actor.exp,false);
            e.state.updateActor(1,model=>{model.nickname='Người sống sót';model.profile='Tiểu sử: '+String.fromCharCode(92)+'N[3]';model.equips[4]=28;});
        })()`,false,false);
        await clickElement(cdp,'#fnh-menu');
        await waitFor(cdp,'Array.from(document.querySelectorAll(".fnh-menu-bust")).every(image=>image.complete && image.naturalWidth>0)',5000,'ảnh bust PNG thật nạp trong menu đội');
        check('menu hiện bust và Hunger ngược EXP cho đúng đội, không đưa guest vào',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,cards=Array.from(document.querySelectorAll('[data-party-actor]'));
            const expected=e.menuActorStatus(1),meter=document.querySelector('[data-hunger-actor="1"]'),image=cards[0].querySelector('img');
            return cards.map(card=>Number(card.dataset.partyActor)).join(',')==='1,3' && image.src.endsWith('/img/pictures/Actor1_1.png') &&
                image.naturalWidth>0 && meter.value===expected.hunger && meter.value>0 && meter.value<1 &&
                cards[0].textContent.includes('Hunger: '+expected.nextExp) && getComputedStyle(image).objectFit==='none';
        })()`,false,false));
        const statusDetails=await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,content=document.querySelector('#fnh-menu-content'),text=content.textContent;
            const bleeding=Array.from(content.querySelectorAll('.fnh-state-rates dt')).find(node=>node.textContent===e.database.States[5].name);
            return {nickname:text.includes('Người sống sót'),profile:text.includes('Tiểu sử: '+e.state.actor(3).name),
                equipment:text.includes(e.database.Armors[28].name),exp:text.includes('EXP: '+e.state.actor(1).exp),
                immune:bleeding.nextElementSibling.textContent==='0.00%',actualProfile:content.querySelector('.fnh-actor-profile').textContent};
        })()`,false,false);
        check('chi tiết menu đọc nickname, profile, trang bị và tỷ lệ miễn nhiễm',
            ['nickname','profile','equipment','exp','immune'].every(key=>statusDetails[key]),JSON.stringify(statusDetails));
        await clickElement(cdp,'[data-party-actor="3"] button');
        check('bấm thẻ đồng đội đổi chi tiết nhân vật và menu không tràn chiều ngang',await evalPage(cdp,`(() => {
            const panel=document.querySelector('#fnh-menu-dialog');
            return document.querySelector('#fnh-menu-actor').value==='3' && document.querySelector('[data-party-actor="3"] button').getAttribute('aria-pressed')==='true' &&
                panel.scrollWidth<=panel.clientWidth+1;
        })()`,false,false));
        await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;e.state.actor(1).states=[];e.state.actor(3).states=[];
            [4,5,8,17,94].forEach(id=>e.state.changeActorState(1,id,true));e.state.changeActorState(3,11,true);
        })()`,false,false);
        await clickElement(cdp,'[data-menu-tab="status"]');
        check('thẻ cả đội hiện icon trạng thái PNG theo ưu tiên và có tên truy cập',await evalPage(cdp,`(async()=>{
            const first=document.querySelector('[data-party-actor="1"]'),second=document.querySelector('[data-party-actor="3"]');
            const icons=Array.from(first.querySelectorAll('.fnh-menu-state-icon'));
            if(icons.map(icon=>icon.dataset.state).join(',')!=='8,5,17,4' || second.querySelectorAll('.fnh-menu-state-icon').length!==1)return false;
            if(!icons.every(icon=>icon.getAttribute('role')==='img' && icon.getAttribute('aria-label')===FNHStandalonePreview.engine.database.States[Number(icon.dataset.state)].name))return false;
            const styles=icons.map(icon=>getComputedStyle(icon));
            if(styles.map(style=>style.backgroundPosition).join('|')!=='-192px 0px|0px -320px|-32px -320px|-96px -320px')return false;
            if(!styles.every(style=>style.width==='32px' && style.height==='32px' && style.backgroundImage.includes('/img/system/IconSet.png')))return false;
            const image=new Image();image.src='img/system/IconSet.png';await image.decode();return image.width===512 && image.height>320;
        })()`,true,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.state.changeActorState(1,5,false)',false,false);
        await clickElement(cdp,'[data-menu-tab="status"]');
        check('xóa state cập nhật icon đúng actor mà không đổi đồng đội khác',await evalPage(cdp,
            'Array.from(document.querySelectorAll(\'[data-party-actor="1"] .fnh-menu-state-icon\')).map(icon=>icon.dataset.state).join(",")==="8,17,4" && document.querySelector(\'[data-party-actor="3"] .fnh-menu-state-icon\').dataset.state==="11"',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(window.statusBefore).then(()=>{delete window.statusBefore;return true;})',true,false);
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
            const e=FNHStandalonePreview.engine;window.synthesisBefore=e.save();
            e.state.gainItem('items',7,1);e.state.gainItem('items',27,1);e.state.gainItem('items',8,1);
            const audio=FNHStandalonePreview.audio;window.synthesisFactory=audio.audioFactory;window.synthesisSounds=[];
            audio.audioFactory=function(){const element=window.synthesisFactory();window.synthesisSounds.push(element);return element;};
        })()`,false,false);
        await clickElement(cdp,'#fnh-menu'); await clickElement(cdp,'[data-menu-tab="synthesis"]');
        await waitFor(cdp,'document.querySelector("button[data-synthesis=\\"item:5\\"]") && !document.querySelector("button[data-synthesis=\\"item:5\\"]").disabled',5000,'mở công thức Torch');
        check('menu chế tạo đọc công thức và đủ nguyên liệu',await evalPage(cdp,`(() => {
            const row=document.querySelector('button[data-synthesis="item:5"]').parentElement;
            return row.querySelector('strong').textContent==='?????' && !row.querySelector('strong').textContent.includes('Torch') && row.textContent.includes('Tinderbox') && row.textContent.includes('Stick');
        })()`,false,false));
        await clickElement(cdp,'button[data-synthesis="item:5"]');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.itemCount("items",5)===1',5000,'chế tạo Torch');
        check('menu chế tạo trừ đúng nguyên liệu và lưu số lần chế tạo',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;
            return e.state.itemCount('items',7)===0 && e.state.itemCount('items',27)===0 && e.state.itemCount('items',8)===0 && e.state.synthesis.crafted.items[5]===1;
        })()`,false,false));
        await waitFor(cdp,'window.synthesisSounds.some(audio=>audio.src.endsWith("/audio/se/fnh_choice2.ogg") && audio.duration>0 && audio.currentTime>0)',
            10000,'chế tạo phát SE OGG thật theo cấu hình gốc');
        check('chế tạo phát fnh_choice2 và giữ âm lượng người chơi',await evalPage(cdp,
            'window.synthesisSounds.some(audio=>audio.src.endsWith("/audio/se/fnh_choice2.ogg") && Math.abs(audio.volume-FNHStandalonePreview.audio.masterVolume*FNHStandalonePreview.audio.volumes.se)<0.000001)',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.state.gainItem("items",7,1);FNHStandalonePreview.engine.state.gainItem("items",27,1);FNHStandalonePreview.engine.state.gainItem("items",8,1)',false,false);
        await clickElement(cdp,'[data-menu-tab="synthesis"]');
        check('đã chế tạo mở tên Torch thật trong menu',await evalPage(cdp,
            'document.querySelector(\'button[data-synthesis="item:5"]\').parentElement.querySelector("strong").textContent==="Torch"',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.state.gainItem("items",5,98)',false,false);
        await clickElement(cdp,'[data-menu-tab="synthesis"]');
        check('đủ 99 Torch khóa nút chế tạo và giữ nguyên nguyên liệu',await evalPage(cdp,
            'document.querySelector(\'button[data-synthesis="item:5"]\').disabled && FNHStandalonePreview.engine.state.itemCount("items",7)===1 && FNHStandalonePreview.engine.state.itemCount("items",27)===1 && FNHStandalonePreview.engine.state.itemCount("items",8)===1',false,false));
        await clickElement(cdp,'#fnh-menu-close');
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(window.synthesisBefore).then(()=>true)',true,false);
        await evalPage(cdp,'FNHStandalonePreview.audio.audioFactory=window.synthesisFactory;delete window.synthesisFactory;delete window.synthesisSounds;delete window.synthesisBefore',false,false);
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
        await evalPage(cdp, `(() => {
            const e=FNHStandalonePreview.engine,db=e.database;window.escapeBefore=e.save();
            const enemyId=db.Enemies.length,troopId=db.Troops.length,id=db.Skills.length;
            db.Skills.push({...db.Skills[3],id,note:'',animationId:0,repeats:1,hitType:0,effects:[],mpCost:0,tpCost:0,
                damage:{type:1,formula:'1',variance:0,critical:false,elementId:0}});
            db.Enemies.push({...db.Enemies[1],id:enemyId,params:[1000,100,1,1,1,1,20,1],traits:[],actions:[{skillId:id,conditionType:0,rating:5}]});
            db.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400}]});
            e.state.party=[1];e.state.recoverActor(1);e.state.changeActorParam(1,6,10-e.state.actorParam(1,6));
            window.escapeHp=e.state.actor(1).hp;e.battle.setup(troopId,true,true);e.state.scene='battle';e.battle.random=()=>0.3;
        })()`,false,false);
        await waitFor(cdp,'!document.querySelector("#fnh-battle").hidden && !document.querySelector("#fnh-battle-escape").disabled',5000,'mở trận kiểm tra thoát theo AGI');
        await clickElement(cdp,'#fnh-battle-escape');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===1 && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'thoát thất bại nhường lượt');
        check('UI báo thoát thất bại và tăng tỷ lệ theo AGI',await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.escapeRatio===0.35 && FNHStandalonePreview.engine.state.actor(1).hp===window.escapeHp-2 && document.querySelector("#fnh-battle-log").textContent.includes("Không thể chạy thoát")',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(FNHStandalonePreview.engine.save()).then(()=>{FNHStandalonePreview.engine.battle.random=()=>0.3;})',true,false);
        await clickElement(cdp,'#fnh-battle-escape');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="map" && document.querySelector("#fnh-battle").hidden',5000,'lần thoát tiếp dùng tỷ lệ tăng sau save');
        check('thoát lần hai giữ xác suất đã tăng qua save',await evalPage(cdp,'FNHStandalonePreview.engine.battle.battle.result==="escape"',false,false));
        await evalPage(cdp,'(async()=>{await FNHStandalonePreview.engine.restore(window.escapeBefore);delete window.escapeBefore;delete window.escapeHp;})()',true,false);
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,db=e.database;window.extraBefore=e.save();
            const enemyId=db.Enemies.length,troopId=db.Troops.length,id=db.Skills.length;
            db.Skills.push({...db.Skills[3],id,note:'',animationId:0,repeats:1,hitType:0,effects:[],mpCost:0,tpCost:0,
                damage:{type:1,formula:'1',variance:0,critical:false,elementId:0}});
            db.Enemies.push({...db.Enemies[1],id:enemyId,params:[1000,100,1,1,1,1,20,1],traits:[],actions:[{skillId:id,conditionType:0,rating:5}]});
            db.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400}]});
            e.state.party=[1,3];e.state.party.forEach((actor,index)=>{e.state.recoverActor(actor);e.state.changeActorParam(actor,6,(index?10:40)-e.state.actorParam(actor,6));});
            e.state.changeActorState(1,5,true);e.battle.setup(troopId,true,true);e.state.scene='battle';e.battle.random=()=>0.5;
        })()`,false,false);
        await waitFor(cdp,'!document.querySelector("#fnh-battle").hidden && !document.querySelector("#fnh-battle-use-skill").disabled',5000,'mở trận có AGI khác nhau');
        await clickElement(cdp,'#fnh-battle-use-skill');await clickElement(cdp,'#fnh-battle-use-skill');await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.extraTurn && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'actor nhanh được lượt bổ sung');
        check('UI chỉ cho nhân vật đủ AGI chọn lệnh trong lượt bổ sung',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;window.extraHp=e.state.actor(1).hp;
            return e.battle.battle.turn===1 && !document.querySelector('#fnh-extra-turn').hidden &&
                document.querySelector('#fnh-extra-turn').naturalWidth>0 && document.querySelector('#fnh-battle-round').textContent.includes('Lượt bổ sung') &&
                !document.querySelector('#fnh-battle-actor option[value="1"]').disabled && document.querySelector('#fnh-battle-actor option[value="3"]').disabled;
        })()`,false,false));
        await clickElement(cdp,'#fnh-battle-use-skill');
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(FNHStandalonePreview.engine.save()).then(()=>true)',true,false);
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'!FNHStandalonePreview.engine.battle.battle.extraTurn && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'kết thúc lượt bổ sung sau tải save');
        check('lượt bổ sung giữ turn và không tick Bleeding lần nữa',await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.turn===1 && FNHStandalonePreview.engine.state.actor(1).hp===window.extraHp && FNHStandalonePreview.engine.battle.battle.turnActions.length===1 && FNHStandalonePreview.engine.battle.battle.turnEffects.length===0',false,false));
        await evalPage(cdp,'(async()=>{await FNHStandalonePreview.engine.restore(window.extraBefore);delete window.extraBefore;delete window.extraHp;})()',true,false);
        await evalPage(cdp, `(() => {
            const e=FNHStandalonePreview.engine,db=e.database;window.substituteBefore=e.save();
            const enemyId=db.Enemies.length,troopId=db.Troops.length,id=db.Skills.length;
            db.Skills.push({...db.Skills[3],id,note:'',animationId:1,repeats:1,hitType:1,successRate:100,effects:[],mpCost:5,tpCost:0,
                damage:{type:1,formula:'10',variance:0,critical:false,elementId:0}});
            db.Enemies.push({...db.Enemies[1],id:enemyId,params:[1000,100,1,1,1,1,10,1],traits:[{code:22,dataId:0,value:1}],actions:[]});
            db.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400}]});
            e.state.party=[1,2];e.state.party.forEach(actor=>e.state.recoverActor(actor));
            e.state.changeActorHp(1,20-e.state.actor(1).hp,true);
            e.battle.setup(troopId,true,true);e.state.scene='battle';e.battle.random=()=>0.5;
            window.substituteGirlHp=e.state.actor(2).hp;window.substituteSkill=id;
            window.substituteAction=e.forceBattleAction([0,0,id,0]);
        })()`,false,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.animations.entries.some(entry=>entry.animationId===1)',5000,'animation đòn có Girl thế thân');
        check('thế thân chưa áp sát thương trước animation và giữ khóa hành động',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.actor(1).hp===20 && FNHStandalonePreview.engine.state.actor(2).hp===window.substituteGirlHp && document.querySelector("#fnh-battle-start").disabled',false,false));
        await evalPage(cdp,'window.substituteAction',true,false);
        await waitFor(cdp,'document.querySelector("#fnh-battle-log").textContent.includes("Thế thân")',5000,'log hiển thị người đỡ đòn');
        check('Girl dùng trait thật đỡ đòn 339 và UI ghi người nhận damage',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.actor(1).hp===20 && FNHStandalonePreview.engine.state.actor(2).hp===window.substituteGirlHp-10 && FNHStandalonePreview.engine.battle.battle.lastAction.hits[0].target===2 && document.querySelector("#fnh-battle-log").textContent.includes("Girl")',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(FNHStandalonePreview.engine.save()).then(()=>true)',true,false);
        check('save giữ báo cáo thế thân mà không gây sát thương lần nữa',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.actor(2).hp===window.substituteGirlHp-10 && FNHStandalonePreview.engine.battle.battle.lastAction.hits[0].substituteFor.id===1',false,false));
        await evalPage(cdp, `(async()=>{
            const e=FNHStandalonePreview.engine;e.battle.random=()=>0.5;e.state.changeActorState(2,10,true);e.battle.syncActors();
            await e.forceBattleAction([0,0,window.substituteSkill,0]);
        })()`,true,false);
        check('Girl bị Sleep không đỡ đòn và trả damage về mục tiêu gốc',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.actor(1).hp===10 && FNHStandalonePreview.engine.state.actor(2).hp===window.substituteGirlHp-10 && !FNHStandalonePreview.engine.battle.battle.lastAction.hits[0].substituteFor',false,false));
        await evalPage(cdp,'(async()=>{await FNHStandalonePreview.engine.restore(window.substituteBefore);delete window.substituteBefore;delete window.substituteGirlHp;delete window.substituteSkill;delete window.substituteAction;})()',true,false);
        await evalPage(cdp, `(() => {
            const e = FNHStandalonePreview.engine, db = e.database;
            window.weaponUiBefore = e.save();
            const enemyId = db.Enemies.length, troopId = db.Troops.length;
            db.Enemies.push({ ...db.Enemies[1], id: enemyId, note: '', traits: [], params: [99999,100,1,1,1,1,1,1], actions: [] });
            db.Troops.push({ id: troopId, pages: [], members: [0,1].map(i => ({ enemyId, x: 300+i*100, y: 400 })) });
            e.state.actor(1).equips[0] = 36;
            e.battle.setup(troopId, true, true); e.state.scene = 'battle'; e.battle.random = () => 0.1;
        })()`, false, false);
        await waitFor(cdp, '!document.querySelector("#fnh-battle").hidden && !document.querySelector("#fnh-battle-attack").disabled', 5000, 'Attack nhận War scythe');
        check('UI Attack kiểm tra đúng chi phí skill vũ khí', await evalPage(cdp, `(() => {
            const e = FNHStandalonePreview.engine, skill = e.database.Skills[281], cost = skill.mpCost;
            const actors = document.querySelector('#fnh-battle-actor');
            skill.mpCost = 9999; actors.dispatchEvent(new Event('change'));
            const disabled = document.querySelector('#fnh-battle-attack').disabled;
            skill.mpCost = cost; actors.dispatchEvent(new Event('change'));
            return disabled && !document.querySelector('#fnh-battle-attack').disabled;
        })()`, false, false));
        await clickElement(cdp, '#fnh-battle-attack'); await clickElement(cdp, '#fnh-battle-start');
        await waitFor(cdp, 'FNHStandalonePreview.engine.battle.battle.turn === 1 && FNHStandalonePreview.engine.battle.battle.phase === "input"', 10000, 'War scythe đánh cả nhóm');
        check('nút Attack dùng skill 281 và gây damage lên cả nhóm', await evalPage(cdp, `(() => {
            const e = FNHStandalonePreview.engine;
            return e.battle.battle.lastAction.skillId === 281 && e.battle.battle.lastAction.targets.length === 2 &&
                e.battle.battle.enemies.every(enemy => enemy.hp < enemy.mhp);
        })()`, false, false));
        await evalPage(cdp, 'FNHStandalonePreview.engine.forceBattleAction([1,1,1,0])', true, true);
        check('339 giữ skill 1 khi chủ thể đang cầm War scythe', await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.lastAction.skillId === 1 && FNHStandalonePreview.engine.battle.battle.lastAction.targets.length === 1', false, false));
        await evalPage(cdp, '(async () => { await FNHStandalonePreview.engine.restore(window.weaponUiBefore); delete window.weaponUiBefore; })()', true, false);
        await evalPage(cdp, `(() => {
            const e = FNHStandalonePreview.engine, db = e.database;
            window.sequenceBefore = e.save();
            const enemyId = db.Enemies.length, troopId = db.Troops.length, skillId = db.Skills.length;
            db.Enemies.push({ ...db.Enemies[1], id: enemyId, note: '', traits: [], params: [1000,100,1,1,1,1,1,1], actions: [] });
            db.Troops.push({ id: troopId, pages: [], members: [{ enemyId, x: 408, y: 400 }] });
            db.Skills.push({ ...db.Skills[3], id: skillId, animationId: 7, note: '', scope: 1, repeats: 1, effects: [], hitType: 0,
                damage: { type: 1, formula: '10', variance: 0, critical: false, elementId: 0 } });
            e.battle.setup(troopId, true, true); e.state.scene = 'battle';
            window.sequenceAction = e.forceBattleAction([1,1,skillId,0]);
        })()`, false, false);
        await waitFor(cdp, 'FNHStandalonePreview.engine.animations.entries.some(entry => entry.animationId === 7 && entry.elapsed >= 0)', 5000, 'sequence phát animation trước effect');
        check('damage chờ animation khi phase mặc định yêu cầu wait', await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.enemy(0).hp === 1000 && FNHStandalonePreview.engine.battle.battle.lastAction.hits.length === 0 && document.querySelector("#fnh-battle-attack").disabled', false, false));
        await evalPage(cdp, 'window.sequenceAction', true, false);
        check('effect sau animation áp damage đúng một lần', await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.enemy(0).hp === 990 && FNHStandalonePreview.engine.battle.battle.lastAction.hits.length === 1', false, false));
        await evalPage(cdp, `(() => {
            const e=FNHStandalonePreview.engine,id=e.battle.battle.lastAction.skillId,skill=e.database.Skills[id];
            skill.animationId=7;
            skill.note='<Whole Action>\\naction effect\\naction animation\\nwait for animation\\naction effect\\n</Whole Action>';
            e.battle.enemy(0).hp=1;
            window.immortalAction=e.forceBattleAction([1,1,id,0]);
        })()`,false,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.animations.entries.some(entry=>entry.animationId===7&&entry.elapsed>=0)',5000,'IMMORTAL giữ đích khi animation đang chạy');
        check('đích 0 HP còn hiện trong animation của action',await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.enemy(0).hp===0 && FNHStandalonePreview.engine.battle.enemy(0).alive && !FNHStandalonePreview.engine.battle.enemy(0).states.includes(1)',false,false));
        await evalPage(cdp,'window.immortalAction',true,false);
        check('bỏ IMMORTAL sau đủ effect và dọn trạng thái khi kết thúc action',await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.lastAction.hits.length===2 && !FNHStandalonePreview.engine.battle.enemy(0).alive && FNHStandalonePreview.engine.battle.enemy(0).states.includes(1) && FNHStandalonePreview.engine.battle.immortal.size===0',false,false));
        await evalPage(cdp,'delete window.immortalAction',false,false);
        await evalPage(cdp, '(async () => { await FNHStandalonePreview.engine.restore(window.sequenceBefore); delete window.sequenceBefore; delete window.sequenceAction; })()', true, false);
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
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;
            e.battle.random=()=>0.5;e.state.party.forEach(id=>e.state.recoverActor(id));
            e.battle.battle.enemies.forEach(enemy=>{e.battle.handleEffect(334,[enemy.index]);});
            e.state.changeActorState(1,5,true);e.state.changeActorState(1,17,true);
            e.battle.handleEffect(333,[0,0,29]);
            const actors=document.querySelector('#fnh-battle-actor');actors.value='1';actors.dispatchEvent(new Event('change',{bubbles:true}));
            const kind=document.querySelector('#fnh-battle-kind');kind.value='skill';kind.dispatchEvent(new Event('change',{bubbles:true}));
            const skills=document.querySelector('#fnh-battle-skill');skills.value='2';skills.dispatchEvent(new Event('change',{bubbles:true}));
        })()`,false,false);
        await clickElement(cdp,'#fnh-battle-use-skill');
        await clickElement(cdp,'#fnh-battle-use-skill');
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===5 && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'tick trạng thái sau toàn bộ đội');
        check('trạng thái trừ HP một lần cuối lượt và hiện log trên Chrome',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;
            return e.state.actor(1).hp===87 && e.battle.enemy(0).hp===1170 &&
                e.battle.battle.turnEffects.length===2 && /Cuối lượt:.*HP -13/.test(document.querySelector('#fnh-battle-log').textContent);
        })()`,false,false));
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine, current=e.battle.battle;
            e.battle.finish('escape');e.leaveBattle('escape');
            e.state.party.forEach(id=>e.state.recoverActor(id));e.state.changeActorState(3,101,true);
            const troopId=e.database.Troops.length, member=e.database.Troops[current.troopId].members[0];
            e.database.Troops.push({id:troopId,pages:[],members:[member,{...member,x:550}]});
            e.battle.setup(troopId,true,true);e.state.scene='battle';e.battle.random=()=>0.75;
            e.battle.handleEffect(333,[1,0,100]);e.state.changeActorSkill(1,39,true);
        })()`,false,false);
        await waitFor(cdp,`document.querySelector('#fnh-battle-targets button[data-index="1"]')?.textContent.includes('Khiêu khích')`,5000,'hiển thị Taunt từ state JSON');
        check('UI đánh dấu mục tiêu khiêu khích ở cả hai phe',await evalPage(cdp,
            'document.querySelector("#fnh-battle-party").textContent.includes("Khiêu khích")',false,false));
        await clickElement(cdp,'#fnh-battle-targets button[data-index="0"]');
        await clickElement(cdp,'#fnh-battle-attack');
        await clickElement(cdp,'#fnh-battle-use-skill');
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===1 && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'Taunt chuyển mục tiêu đòn đã chọn');
        check('đòn đánh từ UI bị Taunt chuyển sang đúng quái',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine, report=e.battle.battle.turnActions.find(action=>action.skillId===1);
            return report.target===1 && e.battle.enemy(0).hp===e.battle.enemy(0).mhp && e.battle.enemy(1).hp<e.battle.enemy(1).mhp;
        })()`,false,false));
        await evalPage(cdp,`(() => {
            const actor=document.querySelector('#fnh-battle-actor');actor.value='1';actor.dispatchEvent(new Event('change',{bubbles:true}));
            const skill=document.querySelector('#fnh-battle-skill');skill.value='39';skill.dispatchEvent(new Event('change',{bubbles:true}));
        })()`,false,false);
        await clickElement(cdp,'#fnh-battle-use-skill');
        await clickElement(cdp,'#fnh-battle-use-skill');
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===2 && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'kỹ năng Bypass Taunt thật');
        check('Bypass Taunt giữ mục tiêu đã chọn và quái hút về đồng đội khiêu khích',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine, report=e.battle.battle.turnActions.find(action=>action.skillId===39);
            const enemy=e.battle.useSkill(e.battle.enemy(0),5,0,true);
            return report.target===0 && enemy.target===3;
        })()`,false,false));
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;
            e.battle.finish('escape');e.leaveBattle('escape');e.state.removeActor(3);
            e.state.changeActorParam(1,0,1000);e.state.recoverActor(1);e.state.changeActorState(1,26,true);
            const enemyId=e.database.Enemies.length,troopId=e.database.Troops.length;
            e.database.Enemies.push({...e.database.Enemies[1],id:enemyId,actions:[],
                params:[10000,100,Math.ceil(e.state.actorParam(1,3)/2)+20,10,10,10,10,10],traits:[{code:22,dataId:0,value:1}]});
            e.database.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400,hidden:false}]});
            e.battle.setup(troopId,true,true);e.state.scene='battle';e.battle.random=()=>0.5;
            e.battle.handleEffect(333,[0,0,37]);window.counterBeforeHp=e.state.actor(1).hp;
        })()`,false,false);
        await waitFor(cdp,'document.querySelectorAll("#fnh-battle-targets button").length===1 && !document.querySelector("#fnh-battle-attack").disabled',5000,'chuẩn bị trận Counter');
        await clickElement(cdp,'#fnh-battle-attack');
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.animations.entries.some(entry=>entry.scope==="battle" && entry.targetType==="actor")',10000,'animation phản công về nhân vật');
        check('phản công có animation đúng phía và giữ khóa lượt',await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.phase==="action" && document.querySelector("#fnh-battle-start").disabled',false,false));
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===1 && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'hoàn tất Counter theo Target Action');
        check('Attack thật nhận một phản đòn theo note và hiện log trên Chrome',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,r=e.battle.battle.lastAction;
            return r.hits.length===1 && r.hits.every(hit=>hit.counter?.hits.length===1 && !hit.counter.hits[0].counter) &&
                e.state.actor(1).hp===window.counterBeforeHp-r.hits.reduce((sum,hit)=>sum+hit.counter.damage,0) &&
                e.battle.enemy(0).hp===10000-r.damage && e.state.actor(1).hp<window.counterBeforeHp &&
                document.querySelector('#fnh-battle-log').textContent.includes('Phản đòn:');
        })()`,false,false));
        check('lưu tải sau phản công giữ HP và báo cáo mà không đánh lại',await evalPage(cdp,`(async () => {
            const e=FNHStandalonePreview.engine,hp=e.state.actor(1).hp,enemyHp=e.battle.enemy(0).hp;
            await e.restore(e.save());delete window.counterBeforeHp;
            return e.state.actor(1).hp===hp && e.battle.enemy(0).hp===enemyHp &&
                e.battle.battle.lastAction.hits.every(hit=>hit.counter?.counter) && !e.animations.entries.length;
        })()`,true,false));
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,troopId=e.battle.battle.troopId;
            e.battle.finish('escape');e.leaveBattle('escape');e.state.addActor(3);
            [1,3].forEach(id=>{e.state.changeActorParam(id,0,2000);e.state.recoverActor(id);});
            e.state.changeActorState(1,9,true);e.state.changeActorState(3,16,true);
            e.battle.setup(troopId,true,true);e.state.scene='battle';e.battle.random=()=>0.75;
            window.confusionAllyHp=e.state.actor(3).hp;
        })()`,false,false);
        await waitFor(cdp,'document.querySelector("#fnh-battle-party").textContent.includes("Rối loạn: tự đánh đồng đội") && !document.querySelector("#fnh-battle-start").disabled',5000,'đội mất điều khiển vẫn bắt đầu lượt');
        check('UI khóa lệnh tay và cho bắt đầu khi cả đội rối loạn/bất động',await evalPage(cdp,
            'document.querySelector("#fnh-battle-attack").disabled && [...document.querySelector("#fnh-battle-actor").options].every(option=>option.disabled)',false,false));
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===1 && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'Fascination tự tấn công đồng đội');
        check('rối loạn đánh đồng đội bằng Attack thật và hiện log',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,r=e.battle.battle.lastAction;
            return e.battle.battle.turnActions.length===1 && r.skillId===1 && r.confusion===3 &&
                r.hits.length===1 && r.hits.every(hit=>hit.targetType==='actor' && hit.target===3) &&
                e.state.actor(3).hp===window.confusionAllyHp-r.damage && r.damage>0 &&
                document.querySelector('#fnh-battle-log').textContent.includes('Rối loạn');
        })()`,false,false));
        check('Brain flower giữ mất điều khiển qua save mà không đánh lại',await evalPage(cdp,`(async () => {
            const e=FNHStandalonePreview.engine,hp=e.state.actor(3).hp;
            e.state.changeActorState(1,9,false);e.state.changeActorState(1,99,true);
            await e.restore(e.save());e.battle.random=()=>0.1;delete window.confusionAllyHp;
            return e.battle.confusionLevel(e.battle.actor(1))===2 && e.state.actor(3).hp===hp &&
                e.battle.battle.turn===1 && e.battle.inputActors().length===0;
        })()`,true,false));
        await waitFor(cdp,'document.querySelector("#fnh-battle-party").textContent.includes("Rối loạn: tự đánh một trong hai phe")',5000,'UI đọc Brain flower từ save');
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===2 && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'Brain flower chọn phe địch');
        check('Brain flower có thể chọn phe địch và Confused khóa 4 không tự đánh',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,r=e.battle.battle.lastAction;
            return r.confusion===2 && r.subjectId===1 && r.hits.every(hit=>hit.targetType==='enemy') &&
                r.damage>0 && e.battle.battle.turnActions.length===1;
        })()`,false,false));
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,troopId=e.battle.battle.troopId;
            e.battle.finish('escape');e.leaveBattle('escape');
            [...e.state.party].forEach(id=>e.state.removeActor(id));e.state.addActor(7);e.state.recoverActor(7);
            e.battle.setup(troopId,true,true);e.state.scene='battle';e.battle.random=()=>0.5;
        })()`,false,false);
        await waitFor(cdp,'document.querySelector("#fnh-battle-party").textContent.includes("Moonless") && document.querySelector("#fnh-battle-party").textContent.includes("Tự chiến đấu") && !document.querySelector("#fnh-battle-start").disabled',5000,'Moonless đọc auto-battle từ class');
        check('Moonless hiện chế độ tự chiến đấu và không đòi lệnh tay',await evalPage(cdp,
            `document.querySelector('#fnh-battle-attack').disabled && document.querySelector('#fnh-battle-actor option[value="7"]').disabled`,false,false));
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===1 && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'Moonless tự chọn đòn đánh');
        check('AI dùng kỹ năng thật gây damage và hiện log trên Chrome',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,r=e.battle.battle.lastAction;
            return r.autoBattle && r.subjectId===7 && [1,88].includes(r.skillId) && r.damage>0 &&
                r.hits.every(hit=>hit.targetType==='enemy') && e.battle.enemy(0).hp<10000 &&
                document.querySelector('#fnh-battle-log').textContent.includes('Tự chiến đấu');
        })()`,false,false));
        check('Moonless đủ AGI nhận lượt bổ sung tự chiến đấu',await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.extraTurn && !document.querySelector("#fnh-extra-turn").hidden',false,false));
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;e.state.changeActorSkill(7,238,true);e.state.changeActorHp(7,-90,true);e.battle.syncActors();
            window.autoBefore={hp:e.state.actor(7).hp,mp:e.state.actor(7).mp,cost:e.battle.skillCost(e.battle.actor(7),e.database.Skills[238]).mp};
        })()`,false,false);
        await clickElement(cdp,'#fnh-battle-start');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.turn===1 && !FNHStandalonePreview.engine.battle.battle.extraTurn && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'AI chọn Loving whispers trong lượt bổ sung khi thiếu HP');
        check('AI chọn hồi HP thật và chỉ trả MP một lần khi thực thi',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,r=e.battle.battle.lastAction;
            return r.autoBattle && r.skillId===238 && r.target===7 && r.damage<0 &&
                e.state.actor(7).hp===window.autoBefore.hp-r.damage && e.state.actor(7).mp===window.autoBefore.mp-window.autoBefore.cost;
        })()`,false,false));
        check('lưu tải đồng đội tự động giữ HP/MP và quyền điều khiển',await evalPage(cdp,`(async () => {
            const e=FNHStandalonePreview.engine,hp=e.state.actor(7).hp,mp=e.state.actor(7).mp;
            await e.restore(e.save());delete window.autoBefore;
            return e.battle.isAutoBattle(e.battle.actor(7)) && e.battle.inputActors().length===0 &&
                e.state.actor(7).hp===hp && e.state.actor(7).mp===mp && e.battle.battle.lastAction.autoBattle && e.battle.battle.turn===1;
        })()`,true,false));
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;e.battle.enemy(0).hp=500;e.battle.handleEffect(333,[0,0,22]);
        })()`,false,false);
        check('Critical state phát animation 22 trên đúng quái',await evalPage(cdp,
            'FNHStandalonePreview.engine.animations.entries.some(entry=>entry.animationId===22 && entry.targetType==="enemy" && entry.targetId===0)',false,false));
        check('modifier Critical state giữ một HP rồi xóa khi nhận damage',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,r=e.battle.useSkill(e.battle.actor(7),88,0,true);
            return r.damage===499 && e.battle.enemy(0).hp===1 && !e.battle.enemy(0).states.includes(22);
        })()`,false,false));
        check('Vulnerable buộc crit cho đòn thật và không rò sang đòn sau',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;e.battle.enemy(0).hp=700;e.battle.random=()=>0.5;
            e.battle.handleEffect(333,[0,0,23]);const critical=e.battle.useSkill(e.battle.actor(7),1,0,true);
            e.battle.handleEffect(333,[0,1,23]);const normal=e.battle.useSkill(e.battle.actor(7),1,0,true);
            return critical.hits.length===1 && critical.hits.every(hit=>hit.critical) && !normal.critical && normal.damage>0;
        })()`,false,false));
        await evalPage(cdp,'delete window.beforeBattleItemHp;delete window.beforeBattleBottles',false,false);
        await evalPage(cdp,`(async()=>{
            const engine=FNHStandalonePreview.engine;engine.battle.finish('escape');engine.leaveBattle('escape');
            await engine.restore(window.skillUiBefore);delete window.skillUiBefore;
        })()`,true,false);
        // restore đổi state trước frame cập nhật panel; chờ DOM để vị trí click trên điện thoại ổn định.
        await waitFor(cdp, 'document.querySelector("#fnh-battle").hidden && !document.querySelector("#fnh-menu-dialog").open',
            5000, 'UI khôi phục bản đồ trước khi tương tác sự kiện kế tiếp');
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,db=e.database,a=FNHStandalonePreview.audio;window.battleSoundsBefore=e.save();window.battleSoundsFactory=a.audioFactory;window.battleSoundElements=[];
            a.audioFactory=function(){const element=window.battleSoundsFactory();window.battleSoundElements.push(element);return element;};
            const enemyId=db.Enemies.length,troopId=db.Troops.length,skillId=db.Skills.length;
            db.Enemies.push({...db.Enemies[1],id:enemyId,note:'',params:[1000,100,10,1,1,1,10,1],actions:[],traits:[]});
            db.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400}]});
            db.Skills.push({...db.Skills[3],id:skillId,animationId:0,hitType:0,scope:1,repeats:1,mpCost:0,tpCost:0,tpGain:0,effects:[],successRate:100,
                note:'<target action>'+String.fromCharCode(10)+'action effect'+String.fromCharCode(10)+'</target action>',
                damage:{type:1,formula:'10',variance:0,critical:false,elementId:0}});
            e.state.party=[1,3];e.state.party.forEach(id=>e.state.recoverActor(id));e.battle.setup(troopId,true,true);e.state.scene='battle';e.battle.random=()=>0.5;
            window.battleSoundSkill=skillId;window.battleSoundDone=false;
            e.forceBattleAction([0,0,skillId,0]).then(()=>{window.battleSoundDone=true;},error=>{window.battleSoundFailure=error.message;});
        })()`,false,false);
        await waitFor(cdp,'window.battleSoundDone || window.battleSoundFailure',10000,'SE damage phát trong lệnh 339');
        await waitFor(cdp,'window.battleSoundElements.some(audio=>audio.src.endsWith("/audio/se/hit_single.ogg") && audio.duration>0)',10000,'SE System trúng đòn giải mã OGG thật');
        check('339 phát hit_single theo volume System và mức tổng 5% riêng của test',await evalPage(cdp,`(() => {
            const audio=window.battleSoundElements.find(element=>element.src.endsWith('/audio/se/hit_single.ogg'));
            return !window.battleSoundFailure && FNHStandalonePreview.engine.state.actor(1).hp===90 &&
                Math.abs(audio.volume-0.9*FNHStandalonePreview.audio.masterVolume)<1e-8 && audio.playbackRate===1;
        })()`,false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(FNHStandalonePreview.engine.save()).then(()=>true)',true,false);
        check('tải save không phát lại âm hit_single của hành động đã xong',await evalPage(cdp,
            'window.battleSoundElements.filter(audio=>audio.src.endsWith("/audio/se/hit_single.ogg")).length===1',false,false));
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;window.battleSoundDone=false;
            e.forceBattleAction([0,0,1,0]).then(()=>{window.battleSoundDone=true;},error=>{window.battleSoundFailure=error.message;});
        })()`,false,false);
        await waitFor(cdp,'window.battleSoundDone || window.battleSoundFailure',10000,'Attack quái phát animation và SE mặc định');
        await waitFor(cdp,'window.battleSoundElements.some(audio=>audio.src.endsWith("/audio/se/Attack3.ogg") && audio.duration>0) && window.battleSoundElements.some(audio=>audio.src.endsWith("/audio/se/lurch_02.ogg") && audio.duration>0)',10000,'OGG Attack3 và animation 39 phát thật');
        check('Attack quái phát một Attack3 cùng SE lurch_02 trong animation 39',await evalPage(cdp,
            '!window.battleSoundFailure && window.battleSoundElements.filter(audio=>audio.src.endsWith("/audio/se/Attack3.ogg")).length===1',false,false));
        await evalPage(cdp,`(async()=>{
            await FNHStandalonePreview.engine.restore(window.battleSoundsBefore);FNHStandalonePreview.audio.audioFactory=window.battleSoundsFactory;
            for(const key of ['battleSoundsBefore','battleSoundsFactory','battleSoundElements','battleSoundSkill','battleSoundDone','battleSoundFailure'])delete window[key];
        })()`,true,false);
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,db=e.database;window.playbackBefore=e.save();const enemyId=db.Enemies.length,troopId=db.Troops.length,skillId=db.Skills.length;
            db.Enemies.push({...db.Enemies[1],id:enemyId,params:[1000,100,1,1,1,1,10,1],actions:[],traits:[]});
            db.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400}]});
            db.Skills.push({...db.Skills[3],id:skillId,hitType:2,animationId:1,note:'',scope:1,repeats:1,mpCost:7,tpCost:0,tpGain:0,effects:[],successRate:100,
                damage:{type:1,formula:'10',variance:0,critical:false,elementId:0}});
            e.state.party=[1,3];e.state.party.forEach(id=>e.state.recoverActor(id));e.battle.setup(troopId,true,true);e.state.scene='battle';e.battle.random=()=>0.5;
            window.playbackHp=e.state.actor(1).hp;window.playbackDone=false;
            e.forceBattleAction([0,0,skillId,0]).then(()=>{window.playbackDone=true;},error=>{window.playbackFailure=error.message;});
        })()`,false,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.animations.entries.some(a=>a.animationId===51) && document.querySelector("#fnh-battle-attack").disabled',5000,'quái cast magical bằng Pheromone 51 trước đòn chính');
        check('cast quái bám chủ thể, chờ hiệu ứng và chỉ trả MP một lần',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine,cast=e.animations.entries.find(a=>a.animationId===51);
            return !!cast && cast.targetType==='enemy' && cast.targetId===0 && !cast.mirror && !window.playbackDone &&
                e.state.actor(1).hp===window.playbackHp && e.battle.enemy(0).mp===93;
        })()`,false,false));
        await waitFor(cdp,'FNHStandalonePreview.engine.animations.entries.some(a=>a.animationId===1 && a.targetType==="actor")',10000,'kết thúc cast rồi mới mở animation đòn chính');
        check('animation đòn chính trên actor được đảo theo đích',await evalPage(cdp,
            'FNHStandalonePreview.engine.animations.entries.some(a=>a.animationId===1 && a.targetType==="actor" && a.targetId===1 && a.mirror)',false,false));
        await waitFor(cdp,'window.playbackDone || window.playbackFailure',10000,'hết playback quái');
        check('hết cast và animation mới áp damage, không tiêu MP lần hai',await evalPage(cdp,
            '!window.playbackFailure && FNHStandalonePreview.engine.state.actor(1).hp===window.playbackHp-10 && FNHStandalonePreview.engine.battle.enemy(0).mp===93',false,false));
        await evalPage(cdp,`(async()=>{
            await FNHStandalonePreview.engine.restore(window.playbackBefore);
            for(const key of ['playbackBefore','playbackHp','playbackDone','playbackFailure'])delete window[key];
        })()`,true,false);
        await evalPage(cdp, `(() => {
            const e=FNHStandalonePreview.engine,db=e.database;window.reflectionBefore=e.save();
            const enemyId=db.Enemies.length,troopId=db.Troops.length,skillId=db.Skills.length;
            db.Enemies.push({...db.Enemies[1],id:enemyId,params:[1000,100,1,1,1,1,10,1],actions:[],traits:[{code:22,dataId:5,value:1}]});
            db.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400}]});
            db.Skills.push({...db.Skills[3],id:skillId,animationId:1,hitType:2,scope:1,repeats:1,mpCost:5,tpCost:0,tpGain:0,effects:[],successRate:100,
                note:'<target action>\\naction effect\\n</target action>',damage:{type:1,formula:'10',variance:0,critical:false,elementId:0}});
            e.state.party=[1,2,3];e.state.party.forEach(id=>e.state.recoverActor(id));
            e.battle.setup(troopId,true,true);e.state.scene='battle';e.battle.random=()=>0.5;
            window.reflectionHp=e.state.actor(1).hp;window.reflectionDone=false;
            e.forceBattleAction([1,1,skillId,0]).then(()=>{window.reflectionDone=true;},error=>{window.reflectionFailure=error.message;});
        })()`,false,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.animations.entries.some(a=>a.animationId===42) && document.querySelector("#fnh-battle-log").textContent.includes("Phản phép")',5000,'phản phép phát animation và hiện log');
        check('phản phép 339 trả damage về người thi triển, giữ quái và chờ animation',await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;
            return !window.reflectionDone && !window.reflectionFailure && e.state.actor(1).hp===window.reflectionHp-10 && e.battle.enemy(0).hp===1000 &&
                e.animations.entries.some(a=>a.animationId===1 && a.targetType==='actor' && a.targetId===1) && document.querySelector('#fnh-battle-attack').disabled;
        })()`,false,false));
        await waitFor(cdp,'window.reflectionDone || window.reflectionFailure',10000,'hết animation phản phép');
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(FNHStandalonePreview.engine.save()).then(()=>true)',true,false);
        check('tải save giữ phản phép và không gây damage hoặc trả chi phí lần hai',await evalPage(cdp,
            '!window.reflectionFailure && FNHStandalonePreview.engine.state.actor(1).hp===window.reflectionHp-10 && FNHStandalonePreview.engine.battle.battle.lastAction.hits[0].reflectedBy.type==="enemy"',false,false));
        await evalPage(cdp,`(async()=>{
            await FNHStandalonePreview.engine.restore(window.reflectionBefore);
            for(const key of ['reflectionBefore','reflectionHp','reflectionDone','reflectionFailure'])delete window[key];
        })()`,true,false);

        await evalPage(cdp, `(() => {
            const e=FNHStandalonePreview.engine,db=e.database;window.endphaseBefore=e.save();
            const c=(code,parameters=[])=>({code,parameters,indent:0}),enemyId=db.Enemies.length,troopId=db.Troops.length;
            db.Enemies.push({...db.Enemies[1],id:enemyId,params:[100,100,1,1,1,1,10,1],traits:[],actions:[]});
            db.Troops.push({id:troopId,members:[{enemyId,x:408,y:400}],pages:[
                {span:0,conditions:{switchValid:true,switchId:6150},list:[c(331,[-1,1,0,99999,true])]},
                {span:0,conditions:{enemyValid:true,enemyIndex:0,enemyHp:0},list:[c(101,['',0,0,2]),c(401,['Sự kiện trước khi kết thúc trận.'])]},
                {span:0,conditions:{enemyValid:true,enemyIndex:0,enemyHp:0},list:[c(126,[8,0,0,1]),c(122,[6151,6151,1,0,1])]}
            ]});
            e.state.setSwitch(6150,true);e.state.setSwitch(6152,false);e.state.setVariable(6151,0);
            window.endphaseItems=e.state.itemCount('items',8);window.endphasePage=e.map.eventPage(e.map.eventById(39));
            window.endphaseOriginalList=window.endphasePage.list;
            window.endphasePage.list=[c(132,[{name:'the_four_apostles',volume:90,pitch:100,pan:20}]),c(301,[0,troopId,true,true]),c(121,[6152,6152,0])];
            const audio=FNHStandalonePreview.audio;
            audio.play('bgm',{name:'fear_and_hunger',volume:80,pitch:90,pan:-20},3);
            audio.play('bgs',{name:'eastern_wind',volume:60,pitch:100,pan:35},2);
        })()`,false,false);
        await clickElement(cdp,'#fnh-controls [data-direction="0"]');
        await waitFor(cdp,'!document.querySelector("#fnh-next").hidden && document.querySelector("#fnh-message").textContent.includes("Sự kiện trước khi kết thúc trận")',
            5000,'page 0 HP mở thoại trước khi chốt thắng');
        const endphaseState=await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;
            return {empty:e.battle.aliveEnemies().length===0,pending:!e.battle.battle.result,battle:e.state.scene==='battle',
                locked:document.querySelector('#fnh-battle-attack').disabled,waiting:!e.state.switchValue(6152),
                noReward:e.state.itemCount('items',8)===window.endphaseItems};
        })()`,false,false);
        check('troop đã bị hạ vẫn giữ thoại, khóa battle và chưa chạy event map',Object.values(endphaseState).every(Boolean),JSON.stringify(endphaseState));
        await waitFor(cdp,'FNHStandalonePreview.audio.buffers.bgm && !FNHStandalonePreview.audio.buffers.bgm.paused && FNHStandalonePreview.audio.buffers.bgm.currentTime>0',
            10000,'OGG nhạc trận từ lệnh 132 phát thật trong lúc page chờ thoại');
        check('vào trận phát nhạc 132, dừng BGS và lưu vị trí nhạc map',await evalPage(cdp,`(() => {
            const app=FNHStandalonePreview,audio=app.audio,saved=app.engine.save().battle.audio;
            return audio.buffers.bgm.src.endsWith('/audio/bgm/the_four_apostles.ogg') && !audio.buffers.bgs &&
                saved.mapBgm.sound.name==='fear_and_hunger' && saved.mapBgm.position>=3 && saved.mapBgs.position>=2 &&
                audio.tracks.get(audio.buffers.bgm).panGraph.panner.pan.value>0;
        })()`,false,false));
        await clickElement(cdp,'#fnh-next');
        await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.engine.state.scene==="map"',5000,'hoàn tất tất cả page rồi trở về map');
        check('page sau thoại phát thưởng một lần rồi mới trả kết quả thắng',await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.result==="victory" && FNHStandalonePreview.engine.state.switchValue(6152) && FNHStandalonePreview.engine.state.variableValue(6151)===1 && FNHStandalonePreview.engine.state.itemCount("items",8)===window.endphaseItems+1',false,false));
        await waitFor(cdp,'FNHStandalonePreview.audio.buffers.bgs && !FNHStandalonePreview.audio.buffers.bgs.paused && FNHStandalonePreview.audio.buffers.bgm && !FNHStandalonePreview.audio.buffers.bgm.paused',
            10000,'phát tiếp cả BGM và BGS sau trận');
        const resumedAudio = await evalPage(cdp,`(() => {
            const app=FNHStandalonePreview,a=app.audio;
            return {bgm:a.snapshot('bgm'),bgs:a.snapshot('bgs'),rate:a.buffers.bgm && a.buffers.bgm.playbackRate,saved:app.engine.battle.battle.audio};
        })()`,false,false);
        check('rời trận trả đúng BGM/BGS, vị trí, pitch và pan của bản đồ',await evalPage(cdp,`(() => {
            const app=FNHStandalonePreview,a=app.audio,saved=app.engine.battle.battle.audio;
            return a.buffers.bgm.src.endsWith('/audio/bgm/fear_and_hunger.ogg') && a.buffers.bgs.src.endsWith('/audio/bgs/eastern_wind.ogg') &&
                a.buffers.bgm.currentTime>=saved.mapBgm.position && a.buffers.bgm.currentTime<saved.mapBgm.position+3 &&
                a.buffers.bgs.currentTime>=saved.mapBgs.position && a.buffers.bgs.currentTime<saved.mapBgs.position+3 &&
                a.buffers.bgm.playbackRate===0.9 && a.tracks.get(a.buffers.bgm).panGraph.panner.pan.value<0;
        })()`,false,false),JSON.stringify(resumedAudio));
        await evalPage(cdp, `(() => {
            const e=FNHStandalonePreview.engine;window.audioResumeSnapshot=e.save();
            e.battle.setup(1,true,true);e.state.scene='battle';
        })()`,false,false);
        await waitFor(cdp,'FNHStandalonePreview.audio.battle===FNHStandalonePreview.engine.battle.battle',5000,'nhạc vào trận được đồng bộ');
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(FNHStandalonePreview.engine.save()).then(()=>true)',true,false);
        await waitFor(cdp,'FNHStandalonePreview.audio.battle===FNHStandalonePreview.engine.battle.battle',5000,'nhạc theo snapshot trận sau tải save');
        await evalPage(cdp,'FNHStandalonePreview.engine.battle.random=()=>0;FNHStandalonePreview.engine.battleEscape()',true,false);
        await waitFor(cdp,'!FNHStandalonePreview.audio.battle && FNHStandalonePreview.audio.buffers.bgs && !FNHStandalonePreview.audio.buffers.bgs.paused',10000,'tải trận rồi thoát phát lại BGS map');
        check('tải save giữa trận giữ BGS cũ, không bị autoplay map ghi đè',await evalPage(cdp,
            'FNHStandalonePreview.audio.buffers.bgs.src.endsWith("/audio/bgs/eastern_wind.ogg") && FNHStandalonePreview.audio.buffers.bgs.currentTime>=2 && FNHStandalonePreview.audio.buffers.bgm.src.endsWith("/audio/bgm/fear_and_hunger.ogg")',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(window.audioResumeSnapshot).then(()=>{delete window.audioResumeSnapshot;return true;})',true,false);
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(FNHStandalonePreview.engine.save()).then(()=>true)',true,false);
        check('tải save sau end phase không phát thưởng hay chạy page lần hai',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.variableValue(6151)===1 && FNHStandalonePreview.engine.state.itemCount("items",8)===window.endphaseItems+1',false,false));
        await evalPage(cdp, `(async()=>{
            window.endphasePage.list=window.endphaseOriginalList;
            await FNHStandalonePreview.engine.restore(window.endphaseBefore);
            delete window.endphaseBefore;delete window.endphaseItems;delete window.endphasePage;delete window.endphaseOriginalList;
        })()`,true,false);
        await waitFor(cdp,'document.querySelector("#fnh-battle").hidden',5000,'khôi phục map sau kiểm tra end phase');
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
            const actorEntries=[],drawActor=renderer.drawBattleActor;
            renderer.drawBattleActor=function(entry,engine){actorEntries.push(entry);return drawActor.call(this,entry,engine);};
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
            const backdrop=context.getImageData(0,0,816,624),variants=[];
            for(const pattern of [0,1,2]) {
                context.putImageData(backdrop,0,0);
                for(const entry of actorEntries) {
                    const bitmap=entry.bitmap,motion=entry.motion;if(!bitmap)continue;
                    const w=Math.floor(bitmap.width/9),h=Math.floor(bitmap.height/6);
                    context.drawImage(bitmap,Math.floor((Math.floor(motion.index/6)*3+pattern)*bitmap.width/9),
                        Math.floor(motion.index%6*bitmap.height/6),w,h,102+204*entry.index-w/2,444-h*0.7,w,h);
                }
            const viewport = engine.map.viewport(engine.state,816,624);
            for (const fog of engine.screen.screen.fogs.filter(fog=>fog.name.startsWith('$'))) {
                const bitmap = await renderer.loadImage('img/fogs/' + fog.name + '.png');
                const pattern = context.createPattern(bitmap,'repeat');
                pattern.setTransform(new DOMMatrix().translate(-Math.floor(viewport.startX*24+fog.x)*fog.zoom,
                    -Math.floor(viewport.startY*24+fog.y)*fog.zoom).scale(fog.zoom));
                context.save(); context.fillStyle=pattern; context.globalAlpha=fog.opacity/255; context.globalCompositeOperation='lighter';
                context.fillRect(0,0,816,624); context.restore();
            }
                variants.push(context.getImageData(0,0,816,624).data);
            }
            window.battleExpectedPixels = variants;
            const actual = canvas.getContext('2d').getImageData(0, 0, 816, 624).data;
            // createPattern và drawImage làm tròn alpha khác nhau tối đa 1/255
            // khi fog có zoom lẻ; bố cục/ảnh quái vẫn so sánh trên toàn bộ pixel.
            return variants.some(expected=>actual.every((value, index) => Math.abs(value - expected[index]) <= 1));
        })()`, true, false));
        await waitFor(cdp, `(() => {
            const pixels = document.querySelector('#fnh-canvas').getContext('2d').getImageData(0, 0, 816, 624).data;
            return battleExpectedPixels.some(expected=>pixels.every((value, index) => Math.abs(value - expected[index]) <= 1));
        })()`, 5000, 'chuyển scene tự vẽ battle trên canvas chính');
        check('UI battle hiển thị HP và MP của nhân vật', await evalPage(cdp,
            'document.querySelector("#fnh-battle-party").textContent.includes("HP") && document.querySelector("#fnh-battle-party").textContent.includes("MP")', false, false));
        check('battle bỏ sprite bộ phận ẩn và đã chết', await evalPage(cdp, `(async () => {
            const original = FNHStandalonePreview.engine;
            const battle = JSON.parse(JSON.stringify(original.battle.battle));
            battle.enemies[1].hidden = true; battle.enemies[1].battlerName = 'khong-ton-tai';
            battle.enemies[2].alive = false; battle.enemies[2].battlerName = 'khong-ton-tai';
            const engine = Object.assign(Object.create(original), { battle: Object.assign(Object.create(original.battle),{battle}) });
            const canvas = document.createElement('canvas');
            const renderer = new FNHStandaloneCanvas.CanvasRenderer(canvas);
            const result = await renderer.draw(engine);
            return result.enemies === 5 && !renderer.images.has('img/enemies/khong-ton-tai.png');
        })()`, true, false));
        await evalPage(cdp, 'delete window.battleExpectedPixels', false, false);
        check('ảnh nền trận từ map ẩn nhân vật/NPC nhưng giữ map và không đổi cờ gameplay',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true});
            await e.boot({mapId:74,x:8,y:8,party:[1,3]});e.state.followersVisible=true;
            const canvas=document.createElement('canvas'),renderer=new FNHStandaloneCanvas.CanvasRenderer(canvas);
            const api=FNHStandaloneCanvas.CanvasRenderer.prototype,original=api.drawActor,draws=[];
            api.drawActor=function(...args){if(this===renderer || this.hideCharacters)draws.push({hidden:this.hideCharacters,id:args[1].id});return original.apply(this,args);};
            try{
                await renderer.draw(e);if(!draws.length || draws.every(entry=>!Number.isFinite(entry.id)))return false;
                const snapshot=e.save();draws.length=0;e.battle.setup(1);e.state.scene='battle';e.screen.screen.battlebacks=['',''];
                const result=await renderer.draw(e),background=await renderer.battleSnapshot;
                const first=background.getContext('2d').getImageData(0,0,816,624).data;
                if(result.enemies!==7 || draws.length || e.state.transparent!==snapshot.transparent || e.state.followersVisible!==snapshot.followersVisible)return false;
                const ref=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas'),{hideCharacters:true});await ref.drawMap(e,++ref.frame);
                const expected=ref.context.getImageData(0,0,816,624).data;
                if(!first.every((value,index)=>value===expected[index]))return false;
                const cached=renderer.battleSnapshot;e.state.x++;await renderer.draw(e);
                if(renderer.battleSnapshot!==cached)return false;
                e.battle.finish('escape');e.leaveBattle('escape');draws.length=0;await renderer.draw(e);
                return draws.length>0 && draws.every(entry=>!entry.hidden);
            }finally{api.drawActor=original;}
        })()`,true,false));
        check('sprite actor front view cắt đúng PNG, anchor, motion và frame vũ khí qua save',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true});
            await e.boot({mapId:74,x:8,y:8,party:[1,2,3,4]});e.battle.setup(1);e.state.scene='battle';
            const canvas=document.createElement('canvas'),renderer=new FNHStandaloneCanvas.CanvasRenderer(canvas);
            const ref=document.createElement('canvas');ref.width=816;ref.height=624;const ctx=ref.getContext('2d');ctx.imageSmoothingEnabled=false;
            const bitmap=await renderer.loadImage('img/sv_actors/Actor1_1.png'),weapon=await renderer.loadImage('img/system/Weapons1.png');
            const w=Math.floor(bitmap.width/9),h=Math.floor(bitmap.height/6);
            for(const elapsed of [0,12,24]) {
                e.battle.startMotion(e.battle.actor(1),'swing',5);e.advanceRoutes(elapsed);
                await e.restore(e.save());
                const motion=e.battle.spriteFrame(e.battle.actor(1)),pattern=elapsed/12;
                renderer.context.clearRect(0,0,816,624);ctx.clearRect(0,0,816,624);
                renderer.drawBattleActor({actor:e.battle.actor(1),index:0,bitmap,weapon,motion},e);
                ctx.drawImage(bitmap,Math.floor((3+pattern)*bitmap.width/9),Math.floor(bitmap.height/6),w,h,102-w/2,444-h*0.7,w,h);
                ctx.drawImage(weapon,pattern*96,4*64,96,64,38,380,96,64);
                const actual=renderer.context.getImageData(0,0,816,624).data,expected=ctx.getImageData(0,0,816,624).data;
                if(!actual.every((value,index)=>value===expected[index]))return false;
            }
            const drawn=[],draw=renderer.drawBattleActor;renderer.drawBattleActor=function(entry,engine){drawn.push(entry);return draw.call(this,entry,engine);};
            const result=await renderer.draw(e);
            return result.actors===4 && drawn.map(entry=>entry.actor.id).join(',')==='1,2,3,4';
        })()`,true,false));
        check('animation actor bám vị trí front view và hide ẩn đúng sprite',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true});
            await e.boot({mapId:74,x:8,y:8,party:[1,3]});e.battle.setup(1);e.state.scene='battle';
            e.animations.startBattle(3,1,false,'actor');e.advanceRoutes(8);
            const renderer=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas')),locations=[];
            renderer.drawAnimationCells=(animation,x,y)=>locations.push([x,y]);await renderer.draw(e);
            const bitmap=await renderer.loadImage('img/sv_actors/knight1_1.png'),h=Math.floor(bitmap.height/6);
            const y=444-(e.database.Animations[1].position===0?h:e.database.Animations[1].position===1?h/2:0);
            if(!locations.some(p=>p[0]===306&&p[1]===y))return false;
            e.animations.entries[0].flash={hide:true,color:[0,0,0,0],remaining:4,duration:4};
            renderer.context.clearRect(0,0,816,624);
            renderer.drawBattleActor({actor:e.battle.actor(3),index:1,bitmap,motion:e.battle.spriteFrame(e.battle.actor(3))},e);
            return renderer.context.getImageData(0,0,816,624).data.every(value=>value===0);
        })()`,true,false));
        check('collapse thường nhuộm đỏ và mờ đúng alpha trên PNG thật',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore});
            await e.boot({mapId:74,x:8,y:8,party:[1]});e.battle.setup(1);e.state.scene='battle';
            e.battle.handleEffect(331,[0,1,0,99999,true]);e.advanceRoutes(16);
            const enemy=e.battle.enemy(0),renderer=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas'));
            const bitmap=await renderer.loadImage('img/enemies/'+enemy.battlerName+'.png');
            const source=document.createElement('canvas');source.width=bitmap.width;source.height=bitmap.height;
            source.getContext('2d').drawImage(bitmap,0,0);const pixels=source.getContext('2d').getImageData(0,0,bitmap.width,bitmap.height).data;
            enemy.x=bitmap.width/2+20;enemy.y=bitmap.height+20;renderer.context.fillStyle='#000';renderer.context.fillRect(0,0,816,624);
            renderer.drawBattleEnemy({enemy,bitmap},e);
            let checked=0;
            for(let y=0;y<Math.min(bitmap.height,604);y++)for(let x=0;x<Math.min(bitmap.width,796);x++){
                const i=(y*bitmap.width+x)*4;if(pixels[i+3]!==255)continue;
                const actual=renderer.context.getImageData(x+20,y+20,1,1).data;
                const expected=[255,128,128].map((color,c)=>Math.round((pixels[i+c]*127/255+color*128/255)*0.5));
                if(expected.some((value,c)=>Math.abs(value-actual[c])>1))return false;checked++;
            }
            if(checked<=100 || enemy.collapse.elapsed!==16 || enemy.alive)return false;
            e.battle.handleEffect(334,[0]);e.advanceRoutes(8);renderer.context.fillRect(0,0,816,624);renderer.drawBattleEnemy({enemy,bitmap},e);
            for(let i=0;i<pixels.length;i+=4){
                if(pixels[i+3]!==255)continue;const x=(i/4)%bitmap.width,y=Math.floor(i/4/bitmap.width);if(x>=796 || y>=604)continue;
                const actual=renderer.context.getImageData(x+20,y+20,1,1).data;
                return [0,1,2].every(c=>Math.abs(Math.round(pixels[i+c]*0.5)-actual[c])<=1) && !enemy.collapse && enemy.spriteEffect.remaining===8;
            }
            return false;
        })()`,true,false));
        check('boss tan theo chiều cao PNG, giữ frame qua save và xác loại 3 còn hiện',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore});
            await e.boot({mapId:74,x:8,y:8,party:[1]});const db=e.database,id=db.Troops.length;
            db.Troops.push({id,pages:[],members:[{enemyId:256,x:400,y:450},{enemyId:23,x:550,y:450},{enemyId:1,x:200,y:450}]});
            e.battle.setup(id);e.state.scene='battle';e.battle.handleEffect(331,[0,1,0,99999,true]);e.battle.handleEffect(331,[1,1,0,99999,true]);
            const renderer=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas'));
            const first=await renderer.draw(e);if(first.enemies!==3 || e.battle.enemy(0).collapse.duration!==391)return false;
            e.advanceRoutes(100);await e.restore(e.save());
            const calls=[],draw=renderer.context.drawImage.bind(renderer.context);renderer.context.drawImage=(...args)=>{calls.push(args);draw(...args);};
            const enemy=e.battle.enemy(0),bitmap=await renderer.loadImage('img/enemies/'+enemy.battlerName+'.png');renderer.drawBattleEnemy({enemy,bitmap},e);
            if(enemy.collapse.elapsed!==100 || !calls.some(args=>args[4]===291 && args[6]===159))return false;
            e.advanceRoutes(1000);const after=await renderer.draw(e);
            return after.enemies===2 && e.battle.enemy(1).collapse.type===3 && !e.battle.enemy(1).alive && e.battle.aliveEnemies().length===1;
        })()`,true,false));
        check('icon trạng thái dùng IconSet thật, xoay theo ưu tiên, có số lượt và chặn mép trên',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true,random:()=>0.5});
            await e.boot({mapId:74,x:8,y:8,party:[1]});e.battle.setup(1);e.state.scene='battle';
            for(const id of [4,5])e.battle.addState(e.battle.enemy(0),id,1,true);e.advanceRoutes(40);
            const enemy=e.battle.enemy(0);if(enemy.spriteIcon.iconIndex!==163 || enemy.spriteIcon.turns!==null)return false;
            enemy.y=10;const renderer=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas'));
            let position;const draw=renderer.drawBattleStateIcon.bind(renderer);
            renderer.drawBattleStateIcon=(sheet,icon,x,y)=>{position={x,y};draw(sheet,icon,x,y);};await renderer.draw(e);
            if(!position || position.y!==20 || position.x!==enemy.x || !renderer.images.has('img/system/IconSet.png'))return false;
            const sheet=await renderer.loadImage('img/system/IconSet.png'),ref=document.createElement('canvas');ref.width=816;ref.height=624;
            renderer.context.clearRect(0,0,816,624);draw(sheet,enemy.spriteIcon,120,100);
            ref.getContext('2d').drawImage(sheet,3*32,10*32,32,32,104,84,32,32);
            const actual=renderer.context.getImageData(0,0,816,624).data,expected=ref.getContext('2d').getImageData(0,0,816,624).data;
            if(!actual.some((value,index)=>index%4===3 && value>0) || !actual.every((value,index)=>value===expected[index]))return false;
            e.battle.handleEffect(334,[0]);e.battle.addState(enemy,8,1,true);e.advanceRoutes(40);
            let label;const fill=renderer.context.fillText.bind(renderer.context);
            renderer.context.fillText=(text,x,y,...args)=>{label={text,x,y,font:renderer.context.font,align:renderer.context.textAlign};fill(text,x,y,...args);};
            draw(sheet,enemy.spriteIcon,120,100);
            return label && label.text===String(enemy.stateTurns[8]) && label.x===133 && Math.abs(label.y-99.6)<0.001 && label.font==='16px GameFont' && label.align==='right';
        })()`,true,false));
        check('overlay States.png giữ ưu tiên, frame/save và vẫn hiện khi body trống hoặc bị animation ẩn',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true});
            await e.boot({mapId:74,x:8,y:8,party:[1,3]});e.battle.setup(1);e.state.scene='battle';
            for(const id of [11,8])e.state.changeActorState(1,id,true);e.state.changeActorState(3,94,true);e.advanceRoutes(16);
            // Giữ cùng backend cho các lần đọc pixel; Chrome đổi GPU sang CPU
            // sau readback có thể làm tròn RGB PNG trong suốt khác 1/255.
            const canvas=document.createElement('canvas');canvas.getContext('2d',{willReadFrequently:true});
            const renderer=new FNHStandaloneCanvas.CanvasRenderer(canvas);await renderer.draw(e);
            if(!renderer.images.has('img/system/States.png') || e.battle.actor(1).spriteOverlay.index!==5 || e.battle.actor(3).spriteOverlay.index!==4)return false;
            const sheet=await renderer.loadImage('img/system/States.png'),ref=document.createElement('canvas');ref.width=816;ref.height=624;
            const refContext=ref.getContext('2d',{willReadFrequently:true});
            function draw(){renderer.context.clearRect(0,0,816,624);const actor=e.battle.actor(1);renderer.drawBattleActor({actor,index:0,bitmap:null,motion:e.battle.spriteFrame(actor)},e,sheet);return renderer.context.getImageData(0,0,816,624).data;}
            const actual=draw();refContext.drawImage(sheet,192,384,96,96,54,348,96,96);
            const expected=refContext.getImageData(0,0,816,624).data;
            if(!actual.some((value,index)=>index%4===3 && value>0) || !actual.every((value,index)=>value===expected[index]))return false;
            e.animations.targetEffect=()=>({hide:true});if(!draw().every((value,index)=>value===actual[index]))return false;
            e.advanceRoutes(5.5);const save=e.save();e.advanceRoutes(2.5);const advanced=draw();
            await e.restore(save);e.advanceRoutes(2.5);if(!draw().every((value,index)=>value===advanced[index]))return false;
            e.state.changeActorState(1,1,true);e.advanceRoutes(8);
            return e.battle.actor(1).spriteOverlay.index===0 && !draw().some(Boolean);
        })()`,true,false));
        check('popup Damage.png cắt đúng HP/MP/hồi/Miss, stack và fade theo pixel thật',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true});
            await e.boot({mapId:74,x:8,y:8,party:[1]});e.battle.setup(1);e.state.scene='battle';
            const renderer=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas')),bitmap=await renderer.loadImage('img/system/Damage.png');
            const ref=document.createElement('canvas');ref.width=816;ref.height=624;const ctx=ref.getContext('2d');ctx.imageSmoothingEnabled=false;
            for(const [resource,value,miss,row] of [['hp',123,false,0],['hp',-123,false,1],['mp',123,false,2],['mp',-123,false,3],['hp',0,true,4]]) {
                e.battle.battle.popups=[];e.battle.addDamagePopup(e.battle.enemy(0),{resource,damage:value,missed:miss});
                const p=e.battle.battle.popups[0];p.x=400;p.y=442;
                for(const elapsed of [0,123]) {
                    p.elapsed=elapsed;renderer.context.clearRect(0,0,816,624);ctx.clearRect(0,0,816,624);
                    renderer.drawDamagePopup(bitmap,p);ctx.globalAlpha=elapsed===123?0.5:1;
                    if(miss)ctx.drawImage(bitmap,0,128,96,32,352,442-40-32*1.9,96,32);
                    else [1,2,3].forEach((digit,i)=>ctx.drawImage(bitmap,digit*24,row*32,24,32,400+(i-1)*24-12,442-40-32*1.9,24,32));
                    const actual=renderer.context.getImageData(0,0,816,624).data,expected=ctx.getImageData(0,0,816,624).data;
                    if(!actual.every((value,index)=>value===expected[index]))return false;
                }
            }
            return true;
        })()`,true,false));
        const popupVisual=await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true});
            await e.boot({mapId:74,x:8,y:8,party:[1]});e.battle.setup(1);e.state.scene='battle';
            e.battle.addDamagePopup(e.battle.enemy(0),{resource:'hp',damage:123,critical:true});e.advanceRoutes(12.5);
            const popupState=JSON.stringify(e.battle.battle.popups[0]);
            const renderer=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas')),sheet=await renderer.loadImage('img/system/Damage.png');
            renderer.drawDamagePopup(sheet,e.battle.battle.popups[0]);const before=renderer.context.getImageData(0,0,816,624).data;
            await e.restore(e.save());renderer.context.clearRect(0,0,816,624);renderer.drawDamagePopup(sheet,e.battle.battle.popups[0]);
            const restored=renderer.context.getImageData(0,0,816,624).data;
            // Chrome có thể chuyển Canvas từ GPU sang CPU sau getImageData:
            // source-atop làm tròn RGB lệch tối đa 1/255, alpha/vị trí phải đúng.
            const savedPixels=before.every((value,index)=>Math.abs(value-restored[index])<=(index%4===3?0:1));
            const savedState=popupState===JSON.stringify(e.battle.battle.popups[0]);
            const result=await renderer.draw(e);
            const source=document.createElement('canvas');source.width=24;source.height=32;source.getContext('2d').drawImage(sheet,24,0,24,32,0,0,24,32);
            const pixels=source.getContext('2d').getImageData(0,0,24,32).data;
            const p={...e.battle.battle.popups[0],x:100,y:100,elapsed:0,stack:0,digits:[{digit:1,x:0,y:0,dy:0}]};
            renderer.context.clearRect(0,0,816,624);renderer.drawDamagePopup(sheet,p);
            const tint=renderer.context.getImageData(88,68,24,32).data;
            let alphaError=0;pixels.forEach((value,index)=>{if(index%4===3)alphaError=Math.max(alphaError,Math.abs(value-tint[index]));});
            return {savedState,savedPixels,enemies:result.enemies,loaded:renderer.images.has('img/system/Damage.png'),alphaError};
        })()`,true,false);
        check('popup chí mạng giữ alpha PNG và save tiếp tục đúng vị trí cú nảy',
            popupVisual.savedState && popupVisual.savedPixels && popupVisual.enemies===7 && popupVisual.loaded && popupVisual.alphaError===0,JSON.stringify(popupVisual));
        check('MP damage thật chỉ báo lượng còn lại, lặp/toàn đội và save không tạo số dư',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true});
            await e.boot({mapId:74,x:8,y:8,party:[1,3]});
            for(const skillId of [181,320]) {
                e.state.party.forEach(id=>e.state.recoverActor(id));e.battle.setup(1);e.state.scene='battle';
                for(const id of [1,3])e.state.changeActorMp(id,(id===1?3:0)-e.state.actor(id).mp);
                const report=e.battle.useSkill(e.battle.enemy(0),skillId,0,true);
                if(report.damage!==3 || report.hits.reduce((sum,hit)=>sum+hit.damage,0)!==3)return false;
                const popups=e.battle.battle.popups;
                if(popups.length!==1 || popups[0].row!==2 || popups[0].digits[0].digit!==3 || e.state.actor(1).mp!==0)return false;
                await e.restore(e.save());
                if(e.state.actor(1).mp!==0 || e.battle.battle.popups.length!==1)return false;
                e.battle.finish('escape');
            }
            return true;
        })()`,true,false));
        check('Weak cắt đúng Damage.png, vị trí theo PNG quái và nhịp mờ của OctoBattle',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true,random:()=>0.5});
            await e.boot({mapId:74,x:8,y:8,party:[1]});e.battle.setup(1);e.state.scene='battle';
            const report=e.battle.useSkill(e.battle.actor(1),3,0,true),popup=e.battle.battle.popups[0];
            if(!report.hits[0].weak || !popup.weak || popup.digits || popup.bitmap!=='guard1_torso')return false;
            const canvas=document.createElement('canvas');canvas.getContext('2d',{willReadFrequently:true});
            const renderer=new FNHStandaloneCanvas.CanvasRenderer(canvas),sheet=await renderer.loadImage('img/system/Damage.png');
            const target=await renderer.loadImage('img/enemies/guard1_torso.png'),ref=document.createElement('canvas');ref.width=816;ref.height=624;
            const ctx=ref.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;
            for(const elapsed of [0,1,61,62.5,63]){
                popup.elapsed=elapsed;renderer.context.clearRect(0,0,816,624);ctx.clearRect(0,0,816,624);
                renderer.drawDamagePopup(sheet,popup,target);ctx.globalAlpha=Math.max(0,Math.min(1,(128-2*Math.floor(elapsed))/10));
                ctx.drawImage(sheet,96,128,72,32,popup.x-Math.round(target.width*0.25)-(elapsed>=1?0.04:0)-36,popup.y-Math.round(target.height*0.6)-56,72,32);
                const actual=renderer.context.getImageData(0,0,816,624).data,expected=ctx.getImageData(0,0,816,624).data;
                if(!actual.some((value,index)=>index%4===3 && value>0) || !actual.every((value,index)=>value===expected[index]))return false;
            }
            popup.elapsed=32.5;e.battle.handleEffect(331,[0,1,0,99999,true]);e.battle.enemy(0).collapse.elapsed=32;
            const before=JSON.stringify(popup);await e.restore(e.save());const result=await renderer.draw(e);
            if(result.enemies!==6 || JSON.stringify(e.battle.battle.popups[0])!==before)return false;
            e.advanceRoutes(31.5);return e.battle.battle.popups.length===0;
        })()`,true,false));
        check('Weak phía actor dùng kích thước một frame của sheet và giữ sau save',await evalPage(cdp,`(async()=>{
            const e=new FNHStandaloneEngine.GameEngine({dataStore:FNHStandalonePreview.engine.dataStore,onRouteEffect:()=>true,random:()=>0.5});
            await e.boot({mapId:74,x:8,y:8,party:[1]});e.battle.setup(1);e.state.scene='battle';e.state.actor(1).equips[3]=12;
            const skill={...e.database.Skills[3],hitType:0,damage:{type:1,formula:'10',elementId:4,critical:false,variance:0}};
            const report=e.battle.useAction(e.battle.enemy(0),skill,0,false,true);await e.restore(e.save());
            const popup=e.battle.battle.popups[0],renderer=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas'));
            await renderer.draw(e);const calls=[],draw=renderer.context.drawImage.bind(renderer.context);renderer.context.drawImage=(...args)=>{calls.push(args);draw(...args);};
            const sheet=await renderer.loadImage('img/system/Damage.png'),target=await renderer.loadImage('img/sv_actors/Actor1_1.png');
            renderer.drawDamagePopup(sheet,popup,target);
            return report.hits[0].weak && popup.type==='actor' && calls.some(args=>args[1]===96 && args[3]===72 && args[5]===102-Math.round(target.width/9*0.25)-36 && args[6]===444-Math.round(target.height/6*0.6)-56);
        })()`,true,false));
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
            let finished=false;
            const turn=engine.runEnemyTurn().then(()=>{finished=true;});
            for(let frame=0;frame<1000&&!finished;frame++){engine.advanceRoutes(16);await new Promise(resolve=>setTimeout(resolve,0));}
            if(!finished) throw new Error('AI chưa hoàn tất sau đủ frame');
            await turn;
            return engine.battle.battle.lastAction.skillId===7 && engine.state.switchValue(16) && engine.state.actor(1).hp===hp;
        })()`,true,false));
        check('TP nhận theo từng hit, giữ qua save và theo trait Baby Demon', await evalPage(cdp, `(async () => {
            const source=FNHStandalonePreview.engine,e=new FNHStandaloneEngine.GameEngine({dataStore:source.dataStore,random:()=>0.5,onRouteEffect:()=>true});
            await e.boot({mapId:74,x:8,y:8,party:[1,12]});const db=e.database,enemyId=db.Enemies.length,troopId=db.Troops.length,id=db.Skills.length;
            db.Enemies.push({...db.Enemies[1],id:enemyId,params:[100,100,1,1,1,1,1,1],traits:[],actions:[]});
            db.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400}]});
            db.Skills.push({...db.Skills[3],id,note:'',animationId:0,scope:1,repeats:2,hitType:0,effects:[],mpCost:0,tpCost:4,tpGain:3,
                damage:{type:1,formula:'20',critical:false,variance:0,elementId:0}});
            e.state.actor(12).tp=66;e.battle.setup(troopId,true,true);e.state.scene='battle';
            if(e.state.actor(1).tp!==12||e.state.actor(12).tp!==66)return false;
            e.battle.useSkill(e.battle.actor(1),id,0);
            if(e.state.actor(1).tp!==14||e.battle.enemy(0).tp!==32)return false;
            await e.restore(e.save());
            if(e.state.actor(1).tp!==14||e.battle.enemy(0).tp!==32)return false;
            e.battle.finish('escape');return e.state.actor(1).tp===0&&e.state.actor(12).tp===66;
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
        await waitFor(cdp, 'FNHStandalonePreview.engine.battle.battle.turn === 1 && FNHStandalonePreview.engine.battle.battle.phase === "input"', 10000, 'đánh xong animation và page khi event vẫn đang chờ');
        check('nút đánh hoạt động trong event đang chờ battle', await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.enemy(0).hp < FNHStandalonePreview.engine.battle.enemy(0).mhp', false, false));
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
        // Ngoài animation/action sequence còn hai fade 24 frame khi rời trận.
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.scene === "map" && !FNHStandalonePreview.engine.eventRunning && document.querySelector("#fnh-battle").hidden',
            7000, 'page hạ đầu Guard kết thúc trận thật');
        check('hạ đầu Guard chạy troop event và nhánh thắng của map', await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.result === "victory" && FNHStandalonePreview.engine.state.switchValue(23) && FNHStandalonePreview.engine.state.variableValue(999) === 10 && FNHStandalonePreview.engine.battle.battle.enemies.every(enemy => !enemy.alive)', false, false));
        await evalPage(cdp, 'FNHStandalonePreview.engine.screen.clearGabs()', false, false);
        await evalPage(cdp, `battleOriginalPage.page.list = battleOriginalPage.list;
            FNHStandalonePreview.engine.state.actors[1] = window.battleOriginalActor; delete window.battleOriginalActor;
            FNHStandalonePreview.engine.state.recoverActor(1); delete window.battleOriginalPage;`, false, false);
        await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine,id=e.database.Troops.length,page=e.map.eventPage(e.map.eventById(39));
            window.__actorRefreshFixture={page,list:page.list,snapshot:e.save()};
            e.database.Troops.push({id,members:[{enemyId:1,x:400,y:450}],pages:[{span:0,conditions:{turnValid:true,turnA:0,turnB:0},list:[
                {code:312,parameters:[0,1,1,0,37]},{code:311,parameters:[0,1,1,0,99999,true]},
                {code:101,parameters:['',0,0,2]},{code:401,parameters:['Kiểm tra actor đã chết']},
                {code:314,parameters:[0,1]},
                {code:101,parameters:['',0,0,2]},{code:401,parameters:['Kiểm tra actor hồi sinh']},{code:340,parameters:[]},{code:0}
            ]}]});page.list=[{code:301,parameters:[0,id,true,true]},{code:0}];
        })()`,false,false);
        await clickElement(cdp,'#fnh-controls [data-direction="0"]');
        await waitFor(cdp,'!document.querySelector("#fnh-next").hidden && document.querySelector("#fnh-message-text").textContent.includes("actor đã chết")',5000,'311 hạ actor rồi chờ thoại trong troop page');
        check('troop page đồng bộ HP/MP và chết trước thoại, chưa chốt thua giữa page',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine,actor=e.battle.actor(1);
            return e.state.actor(1).hp===0 && actor.hp===0 && actor.mp===63 && !actor.alive &&
                e.battle.spriteFrame(actor).index===17 && e.state.scene==='battle' && !e.battle.battle.result &&
                document.querySelector('#fnh-battle-attack').disabled;
        })()`,false,false));
        await clickElement(cdp,'#fnh-next');
        await waitFor(cdp,'!document.querySelector("#fnh-next").hidden && document.querySelector("#fnh-message-text").textContent.includes("actor hồi sinh")',5000,'314 hồi actor trước thoại tiếp');
        check('314 hồi sinh ngay trong page đang chạy và UI nhận trạng thái mới',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine,actor=e.battle.actor(1);
            return actor.hp===100 && actor.mp===100 && actor.alive && !e.state.actor(1).states.includes(1) && !e.battle.battle.result;
        })()`,false,false));
        await clickElement(cdp,'#fnh-next');
        await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.engine.state.scene==="map"',5000,'page hồi sinh xong mới thoát trận');
        await evalPage(cdp,`(async()=>{
            __actorRefreshFixture.page.list=__actorRefreshFixture.list;
            await FNHStandalonePreview.engine.restore(__actorRefreshFixture.snapshot);delete window.__actorRefreshFixture;
        })()`,true,false);
        await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine,page=e.map.eventPage(e.map.eventById(39)),id=e.database.Troops.length;
            window.__fadeFixture={page,list:page.list,snapshot:e.save(),animate:Element.prototype.animate};
            e.database.Troops.push({id,members:[e.database.Troops[1].members[0]],pages:[]});
            e.state.setSwitch(7320,false);page.list=[{code:301,parameters:[0,id,true,true]},{code:121,parameters:[7320,7320,0]}];
            Element.prototype.animate=function(...args){const animation=__fadeFixture.animate.apply(this,args);
                if(this.closest('#fnh-battle-encounter,#fnh-battle-flash,#fnh-battle-fade'))animation.pause();
                if(this.id==='fnh-battle-fade')window.__battleFadeAnimation=animation;return animation;};
        })()`,false,false);
        await clickElement(cdp,'#fnh-controls [data-direction="0"]');
        await waitFor(cdp,'window.__battleFadeAnimation && !document.querySelector("#fnh-battle-fade").hidden',5000,'fade mở trận');
        check('encounter 60 frame dùng zoom gốc, flash frame 2/10 và chưa phát BGM trước frame 30',await evalPage(cdp,`(()=>{
            const app=FNHStandalonePreview,shot=document.querySelector('#fnh-battle-encounter canvas');
            const zoom=shot.getAnimations().find(animation=>animation.effect.getKeyframes()[0].transform),frames=zoom.effect.getKeyframes();
            const flash=document.querySelector('#fnh-battle-flash').getAnimations()[0].effect.getKeyframes();
            const black=__battleFadeAnimation.effect.getKeyframes();
            return !document.querySelector('#fnh-battle-encounter').hidden && zoom.effect.getTiming().duration===1000 && frames.length===61 &&
                frames[0].transform==='scale(1)' && frames[30].transform==='scale(1)' && frames[60].transform==='scale(6)' &&
                flash.some(frame=>Math.abs(frame.offset-2/60)<0.00001 && frame.opacity==='1') &&
                flash.some(frame=>Math.abs(frame.offset-10/60)<0.00001 && frame.opacity==='1') &&
                black.some(frame=>frame.offset===0.5 && frame.opacity==='0') && black.some(frame=>frame.offset===0.9 && frame.opacity==='1') &&
                app.engine.battle.battle.audio.pending && !app.audio.buffers.bgm && !app.audio.buffers.bgs &&
                shot.getAnimations().some(animation=>animation.effect.getTiming().duration===500) &&
                app.audio.seBuffers.some(sound=>sound.src.endsWith('/audio/se/into_darkness.ogg') && sound.playbackRate===0.9 && Math.abs(sound.volume-app.audio.masterVolume*app.audio.volumes.se*0.55)<0.000001);
        })()`,false,false));
        await evalPage(cdp,`document.querySelector('#fnh-battle-encounter canvas').getAnimations().find(animation=>animation.effect.getTiming().duration===500).finish()`,false,false);
        await waitFor(cdp,'!FNHStandalonePreview.engine.battle.battle.audio.pending && FNHStandalonePreview.audio.buffers.bgm',5000,'frame 30 phát BGM trận');
        check('mốc 30 frame mở nhạc trận nhưng vẫn chờ zoom/flash xong trước page',await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.phase==="transition" && __battleFadeAnimation.playState==="paused" && FNHStandalonePreview.audio.buffers.bgm.src.endsWith("/audio/bgm/"+encodeURIComponent(FNHStandalonePreview.engine.database.System.battleBgm.name)+".ogg")',false,false));
        async function finishEncounter() {
            await evalPage(cdp,`document.getAnimations().filter(animation=>animation.effect.target.closest('#fnh-battle-encounter,#fnh-battle-flash,#fnh-battle-fade')).forEach(animation=>animation.finish())`,false,false);
            await waitFor(cdp,'__battleFadeAnimation.playState==="paused" && __battleFadeAnimation.effect.getTiming().duration===400',5000,'encounter xong mới mở fade battle');
        }
        await finishEncounter();
        check('fade mở 24 frame giữ khóa lệnh trước page/input trên Chrome',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine,animation=window.__battleFadeAnimation;
            return e.eventRunning && e.battle.battle.phase==='transition' && document.querySelector('#fnh-battle-attack').disabled &&
                Math.abs(animation.effect.getTiming().duration-400)<0.001 && animation.effect.getKeyframes()[0].opacity==='1' &&
                !e.state.switchValue(7320) && !e.move(6);
        })()`,false,false));
        await evalPage(cdp,'__battleFadeAnimation.finish()',false,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.phase==="input" && document.querySelector("#fnh-battle-fade").hidden',5000,'fade xong nhận input');
        await evalPage(cdp,'FNHStandalonePreview.engine.battle.finish("escape")',false,false);
        await waitFor(cdp,'!document.querySelector("#fnh-battle-fade").hidden && __battleFadeAnimation.playState==="paused"',5000,'fade đóng trận');
        check('fade đóng giữ scene trận và sự kiện chờ, không chạy nhánh map sớm',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;
            return e.state.scene==='battle' && e.eventRunning && !e.state.switchValue(7320) &&
                FNHStandalonePreview.audio.battle===e.battle.battle && __battleFadeAnimation.effect.getKeyframes()[1].opacity==='1';
        })()`,false,false));
        await evalPage(cdp,'__battleFadeAnimation.finish()',false,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="map" && __battleFadeAnimation.playState==="paused"',5000,'hiện map sau fade đóng');
        check('map hiện qua fade 24 frame trước khi tiếp tục event',await evalPage(cdp,
            'FNHStandalonePreview.engine.eventRunning && !FNHStandalonePreview.engine.state.switchValue(7320) && !document.querySelector("#fnh-battle-fade").hidden && __battleFadeAnimation.effect.getKeyframes()[0].opacity==="1"',false,false));
        await evalPage(cdp,'__battleFadeAnimation.finish()',false,false);
        await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.engine.state.switchValue(7320) && document.querySelector("#fnh-battle-fade").hidden',5000,'rời trận sạch sau fade');
        await clickElement(cdp,'#fnh-controls [data-direction="0"]');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.phase==="transition" && __battleFadeAnimation.playState==="paused"',5000,'mở trận kiểm tra fade thua');
        await finishEncounter();
        await evalPage(cdp,'__battleFadeAnimation.finish()',false,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.phase==="input"',5000,'nhận input trước kiểm tra thua');
        await evalPage(cdp,'FNHStandalonePreview.engine.battle.finish("defeat")',false,false);
        await waitFor(cdp,'__battleFadeAnimation.playState==="paused"',5000,'fade thua bắt buộc');
        check('fade thua bắt buộc đóng 48 frame như slowFadeSpeed gốc',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.scene==="battle" && __battleFadeAnimation.effect.getTiming().duration===800',false,false));
        await evalPage(cdp,'__battleFadeAnimation.finish()',false,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="gameover" && __battleFadeAnimation.playState==="paused"',5000,'fade vào game over');
        check('game over hiện qua fade 48 frame và còn giữ event cho tới hết chuyển cảnh',await evalPage(cdp,
            'FNHStandalonePreview.engine.eventRunning && __battleFadeAnimation.effect.getTiming().duration===800 && !document.querySelector("#fnh-end-screen").hidden',false,false));
        await evalPage(cdp,'__battleFadeAnimation.finish()',false,false);
        await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning',5000,'hết fade game over');
        await evalPage(cdp,'FNHStandalonePreview.engine.state.scene="map"',false,false);
        await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;e.state.setSwitch(7320,false);
            __fadeFixture.runEvent=e.runEvent;window.__fadeController=new AbortController();
            e.runEvent=function(id,handlers){return __fadeFixture.runEvent.call(this,id,handlers,__fadeController.signal);};
        })()`,false,false);
        await clickElement(cdp,'#fnh-controls [data-direction="0"]');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.phase==="transition" && __battleFadeAnimation.playState==="paused"',5000,'mở fade để hủy');
        await evalPage(cdp,'__fadeController.abort()',false,false);
        await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning && document.querySelector("#fnh-battle-fade").hidden',5000,'hủy dọn màn fade');
        check('hủy fade không kẹt màn đen và không tiếp tục nhánh map',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.scene==="map" && !FNHStandalonePreview.engine.state.switchValue(7320) && document.querySelector("#fnh-battle-fade").getAnimations().length===0 && document.querySelector("#fnh-battle-encounter").hidden && document.querySelector("#fnh-battle-flash").hidden && !FNHStandalonePreview.audio.battle',false,false));
        await evalPage(cdp,`(async()=>{
            __fadeFixture.page.list=__fadeFixture.list;Element.prototype.animate=__fadeFixture.animate;
            FNHStandalonePreview.engine.runEvent=__fadeFixture.runEvent;delete window.__fadeController;
            await FNHStandalonePreview.engine.restore(__fadeFixture.snapshot);delete window.__fadeFixture;delete window.__battleFadeAnimation;
        })()`,true,false);
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
        await evalPage(cdp,`(()=>{
            // Hàng 0, x >= 4 không có event chạm; hàng 20 có event 139–142.
            const e=FNHStandalonePreview.engine;e.state.x=4;e.state.y=0;e.state.moveFrames=0;
            document.querySelector('#fnh-canvas').focus();
        })()`,false,false);
        await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
        const heldTouchPoint=await evalPage(cdp,`(async()=>{
            const button=document.querySelector('#fnh-controls [data-direction="6"]');button.scrollIntoView({block:'center',behavior:'instant'});
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const rect=button.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,id:1};
        })()`,true,false);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[heldTouchPoint]});
        await waitFor(cdp,'FNHStandalonePreview.engine.state.x>=6',5000,'giữ chạm đi nhiều ô');
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await waitFor(cdp,'!FNHStandalonePreview.engine.buttons.has("right") && !FNHStandalonePreview.engine.state.moveFrames',5000,'thả chạm dừng hướng');
        const stoppedTouchAt=await evalPage(cdp,'FNHStandalonePreview.engine.state.x',false,false);
        await sleep(350);
        check('giữ/thả nút cảm ứng đi nhiều ô rồi dừng, không thêm bước từ click cuối',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.x==='+stoppedTouchAt+' && getComputedStyle(document.querySelector(\'#fnh-controls [data-direction="6"]\')).touchAction==="none"',false,false));
        await evalPage(cdp,'document.querySelector("#fnh-canvas").focus({preventScroll:true})',false,false);
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[heldTouchPoint]});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
        check('thả phím không xóa hướng đang được giữ bằng chạm',await evalPage(cdp,'FNHStandalonePreview.engine.buttons.has("right")',false,false));
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
        check('hủy chạm không xóa hướng bàn phím còn giữ',await evalPage(cdp,'FNHStandalonePreview.engine.buttons.has("right")',false,false));
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[heldTouchPoint]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
        check('pointercancel giải phóng hướng khi không còn phím giữ',await evalPage(cdp,'!FNHStandalonePreview.engine.buttons.has("right")',false,false));
        const secondTouchPoint={...heldTouchPoint,x:heldTouchPoint.x+8,id:2};
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[heldTouchPoint,secondTouchPoint]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[secondTouchPoint]});
        check('thả một ngón giữ hướng của ngón còn lại trên cùng nút',await evalPage(cdp,'FNHStandalonePreview.engine.buttons.has("right")',false,false));
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[heldTouchPoint]});
        await evalPage(cdp,'window.dispatchEvent(new Event("blur"))',false,false);
        check('mất focus dọn hướng chạm đang giữ',await evalPage(cdp,'FNHStandalonePreview.engine.buttons.size===0',false,false));
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await evalPage(cdp,`document.querySelector('#fnh-controls [data-direction="6"]').addEventListener('pointerdown',event=>{window.__heldPointerId=event.pointerId;},{once:true})`,false,false);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[heldTouchPoint]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...heldTouchPoint,x:heldTouchPoint.x+1}]});
        await evalPage(cdp,`(()=>{
            const button=document.querySelector('#fnh-controls [data-direction="6"]');button.releasePointerCapture(window.__heldPointerId);
        })()`,false,false);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...heldTouchPoint,x:heldTouchPoint.x+2}]});
        await waitFor(cdp,'!FNHStandalonePreview.engine.buttons.has("right")',5000,'mất capture dọn hướng');
        check('lostpointercapture dừng hướng và không kẹt sau chạm',await evalPage(cdp,'!FNHStandalonePreview.engine.buttons.has("right")',false,false));
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
        await waitFor(cdp,'!FNHStandalonePreview.engine.stepRunning && !FNHStandalonePreview.engine.state.moveFrames',5000,'bước cuối kết thúc trước khi tải checkpoint');
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
        await evalPage(cdp,`(() => {
            const e=FNHStandalonePreview.engine;window.beforeWalkState=e.save();
            e.state.x=4;e.state.y=20;e.state.through=true;e.state.walkSteps=19;e.state.moveFrames=0;
            e.state.party.forEach(id=>e.state.recoverActor(id));e.state.changeActorState(1,5,true);e.state.changeActorState(1,17,true);
            window.walkExpectedLoss=Math.min(e.state.actor(1).hp-1,-Math.floor(e.state.actorParam(1,0)*e.battle.traitRate({id:1},22,7,true)));
            window.walkExpectedHp=e.state.actor(1).hp-window.walkExpectedLoss;
        })()`,false,false);
        await clickElement(cdp,'#fnh-controls [data-direction="6"]');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.walkSteps===20 && FNHStandalonePreview.engine.state.actor(1).hp===window.walkExpectedHp',5000,'trạng thái tick theo bước đi thật');
        check('bước đi tick trạng thái và hiển thị thay đổi HP ngoài bản đồ',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.walkEffects.length===1 && document.querySelector("#fnh-status").textContent.includes("HP -"+window.walkExpectedLoss)',false,false));
        await clickElement(cdp,'#fnh-save');
        await waitFor(cdp,'document.querySelector("#fnh-status").textContent.startsWith("Đã lưu")',5000,'lưu nhịp trạng thái bước đi');
        await clickElement(cdp,'#fnh-controls [data-direction="4"]');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.walkSteps===21 && !FNHStandalonePreview.engine.stepRunning && FNHStandalonePreview.engine.state.moveFrames===0',5000,'bước không tick lại trạng thái');
        await clickElement(cdp,'#fnh-load');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.walkSteps===20',5000,'tải save giữ nhịp bước');
        check('save bước đi giữ HP và không tick trạng thái lần hai',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.actor(1).hp===window.walkExpectedHp && FNHStandalonePreview.engine.state.x===5',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(window.beforeWalkState).then(()=>true)',true,false);
        await evalPage(cdp,'delete window.beforeWalkState;delete window.walkExpectedHp;delete window.walkExpectedLoss',false,false);
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
            'FNHStandalonePreview.audio.buffers.bgm.src.endsWith("/audio/bgm/fear_and_hunger.ogg") && Math.abs(FNHStandalonePreview.audio.buffers.bgm.volume - 0.04) < 0.000001', false, false));
        check('pan OGG thật chuyển năng lượng sang đúng kênh stereo', await evalPage(cdp, `(async () => {
            const manager = FNHStandalonePreview.audio, context = manager.context;
            manager.unlock(); await context.resume();
            const audio = manager.buffers.bgm, graph = manager.tracks.get(audio).panGraph;
            const splitter = context.createChannelSplitter(2), left = context.createAnalyser(), right = context.createAnalyser();
            left.fftSize = right.fftSize = 256;
            graph.panner.connect(splitter); splitter.connect(left, 0); splitter.connect(right, 1);
            async function energy(pan) {
                manager.play('bgm', { name: 'fear_and_hunger', volume: 80, pitch: 100, pan });
                // Cùng BGM dùng lại graph; nối lại nhánh đo sau cập nhật pan.
                graph.panner.connect(splitter);
                await new Promise(resolve => setTimeout(resolve, 200));
                const l = new Float32Array(256), r = new Float32Array(256);
                left.getFloatTimeDomainData(l); right.getFloatTimeDomainData(r);
                return [l.reduce((sum, value) => sum + value * value, 0), r.reduce((sum, value) => sum + value * value, 0)];
            }
            try {
                const leftOnly = await energy(-100), rightOnly = await energy(100);
                return leftOnly[0] > 0.00000001 && leftOnly[1] < leftOnly[0] * 0.001 &&
                    rightOnly[1] > 0.00000001 && rightOnly[0] < rightOnly[1] * 0.001 && !audio.paused;
            } finally {
                splitter.disconnect(); left.disconnect(); right.disconnect();
                manager.play('bgm', { name: 'fear_and_hunger', volume: 80, pitch: 100, pan: 0 });
            }
        })()`, true, true));
        await evalPage(cdp, `(() => {
            const volume = document.querySelector('#fnh-volume');
            volume.value = 50;
            volume.dispatchEvent(new Event('input', { bubbles: true }));
        })()`, false, false);
        check('volume preview điều chỉnh bình thường trên 5% và giữ mức riêng BGM', await evalPage(cdp,
            'FNHStandalonePreview.audio.buffers.bgm.volume === 0.4 && document.querySelector("#fnh-volume").max === "100"', false, false));
        check('preview giữ cấu hình 100% và API không bị khóa nhỏ', await evalPage(cdp, `(() => {
            const app = FNHStandalonePreview, key = 'FNH_QUIET_TEST';
            localStorage.setItem(key, JSON.stringify({version:1,volumes:{master:100}}));
            try {
                const settings = new FNHStandaloneSettings.PlayerSettings({key});
                app.audio.setVolume('master',1);
                return settings.volumes.master === 100 && app.audio.masterVolume === 1 &&
                    app.audio.buffers.bgm.volume === 0.8;
            } finally {
                localStorage.removeItem(key);
                const slider = document.querySelector('#fnh-volume'); slider.value = 5; slider.dispatchEvent(new Event('input'));
            }
        })()`, false, false));
        check('bước đi phát SE OGG thật theo terrain và volume tổng', await evalPage(cdp, `(async () => {
            const engine = FNHStandalonePreview.engine, manager = FNHStandalonePreview.audio, snapshot = engine.save();
            try {
                engine.state.through = true;
                if (!engine.move(engine.state.x + 1 < engine.map.width ? 6 : 4)) return false;
                const sound = engine.footstepSound(engine.state), audio = manager.seBuffers.at(-1);
                const track = manager.tracks.get(audio);
                if (!audio || track.sound.name !== sound.name || Math.abs(audio.volume - sound.volume / 100 * manager.masterVolume) > 0.000001) return false;
                await new Promise((resolve, reject) => {
                    if (audio.readyState >= 3) resolve();
                    else { audio.addEventListener('canplay', resolve, { once: true }); audio.addEventListener('error', reject, { once: true }); }
                });
                return audio.duration > 0 && audio.src.endsWith('/audio/se/' + encodeURIComponent(sound.name) + '.ogg');
            } finally { await engine.restore(snapshot); }
        })()`, true, true));
        await evalPage(cdp, 'FNHStandalonePreview.audio.handleEffect(242, [0.05])', false, false);
        await waitFor(cdp, 'FNHStandalonePreview.audio.buffers.bgm === null', 3000, 'BGM fade và dừng');
        await screenshot('standalone-preview');

        await evalPage(cdp, `(() => {
            const e=FNHStandalonePreview.engine,a=FNHStandalonePreview.audio;window.beforeMapAudioSave=e.save();
            a.play('bgm',{name:'fear_and_hunger',volume:80,pitch:90,pan:-20},1);a.handleEffect(243,[]);
            a.buffers.bgm.currentTime=4;a.play('bgs',{name:'eastern_wind',volume:60,pitch:110,pan:35},2);
        })()`,false,false);
        await waitFor(cdp,'FNHStandalonePreview.audio.buffers.bgm.currentTime>=4 && !FNHStandalonePreview.audio.buffers.bgm.paused && FNHStandalonePreview.audio.buffers.bgs.currentTime>=2 && !FNHStandalonePreview.audio.buffers.bgs.paused',
            10000,'OGG map phát thật trước khi lưu âm thanh');
        await evalPage(cdp, `(async()=>{
            const e=FNHStandalonePreview.engine,s=new FNHStandaloneSave.SaveStore({prefix:'FNH_STANDALONE_PREVIEW:'});
            e.saveTo(s,19);window.savedMapAudio=s.load(19).audio;
            await e.createInterpreter([{code:354}],0).run();
        })()`,true,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="title" && !document.querySelector("#fnh-end-screen").hidden',5000,'về title trước khi tải save âm thanh');
        await evalPage(cdp,'document.querySelector("#fnh-end-save-slot").value=19',false,false);
        if (await evalPage(cdp,'document.querySelector("#fnh-end-save-panel").hidden',false,false)) await clickElement(cdp,'#fnh-continue');
        await clickElement(cdp,'#fnh-end-load');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="map" && FNHStandalonePreview.audio.buffers.bgm && !FNHStandalonePreview.audio.buffers.bgm.paused && FNHStandalonePreview.audio.buffers.bgs && !FNHStandalonePreview.audio.buffers.bgs.paused',
            10000,'tải từ title phát lại BGM và BGS đã lưu');
        check('tải từ title khôi phục OGG map, vị trí, pitch, pan và nhạc nhớ 243',await evalPage(cdp,`(() => {
            const a=FNHStandalonePreview.audio,s=window.savedMapAudio;
            return a.buffers.bgm.src.endsWith('/audio/bgm/fear_and_hunger.ogg') && a.buffers.bgs.src.endsWith('/audio/bgs/eastern_wind.ogg') &&
                a.buffers.bgm.currentTime>=s.bgm.position && a.buffers.bgm.currentTime<s.bgm.position+3 &&
                a.buffers.bgs.currentTime>=s.bgs.position && a.buffers.bgs.currentTime<s.bgs.position+3 &&
                a.buffers.bgm.playbackRate===0.9 && a.buffers.bgs.playbackRate===1.1 &&
                a.tracks.get(a.buffers.bgm).panGraph.panner.pan.value<0 && a.tracks.get(a.buffers.bgs).panGraph.panner.pan.value>0 &&
                JSON.stringify(a.savedBgm)===JSON.stringify(s.savedBgm) && a.masterVolume===0.05;
        })()`,false,false));
        await evalPage(cdp,`FNHStandalonePreview.engine.createInterpreter([{code:244}],0,{effect:FNHStandalonePreview.audio.handleEffect.bind(FNHStandalonePreview.audio)}).run()`,true,false);
        check('lệnh 244 sau tải đọc bookmark riêng của 243',await evalPage(cdp,
            'FNHStandalonePreview.audio.buffers.bgm.currentTime>=window.savedMapAudio.savedBgm.position && FNHStandalonePreview.audio.buffers.bgm.currentTime<window.savedMapAudio.savedBgm.position+2',false,false));
        await evalPage(cdp, `(async()=>{
            const e=FNHStandalonePreview.engine,a=FNHStandalonePreview.audio,s=new FNHStandaloneSave.SaveStore({prefix:'FNH_STANDALONE_PREVIEW:'});
            a.stop('bgm');a.stop('bgs');e.saveTo(s,19);await e.createInterpreter([{code:354}],0).run();
        })()`,true,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="title" && !document.querySelector("#fnh-end-screen").hidden',5000,'title phát nhạc trước tải save im lặng');
        await evalPage(cdp,'document.querySelector("#fnh-end-save-slot").value=19',false,false);
        if (await evalPage(cdp,'document.querySelector("#fnh-end-save-panel").hidden',false,false)) await clickElement(cdp,'#fnh-continue');
        await clickElement(cdp,'#fnh-end-load');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="map" && document.querySelector("#fnh-end-screen").hidden',5000,'tải save im lặng từ title');
        check('save im lặng dừng nhạc title, không phát autoplay đè snapshot',await evalPage(cdp,
            '!FNHStandalonePreview.audio.buffers.bgm && !FNHStandalonePreview.audio.buffers.bgs',false,false));
        await evalPage(cdp,`(async()=>{
            await FNHStandalonePreview.engine.restore(window.beforeMapAudioSave);
            localStorage.removeItem('FNH_STANDALONE_PREVIEW:19');delete window.beforeMapAudioSave;delete window.savedMapAudio;
        })()`,true,false);

        await evalPage(cdp, `(async () => {
            const engine = FNHStandalonePreview.engine;
            const store = new FNHStandaloneSave.SaveStore({ prefix: 'FNH_STANDALONE_PREVIEW:' });
            engine.saveTo(store, 1);
            const extra = engine.save(); extra.variables[8235] = 20; store.save(20, extra);
            await engine.createInterpreter([{ code: 353 }, { code: 121, parameters: [996, 996, 0] }], 0).run();
        })()`, true, false);
        await waitFor(cdp, `!document.querySelector('#fnh-end-screen').hidden &&
            document.querySelector('#fnh-end-background').naturalWidth > 0`, 5000, 'màn game over dùng asset thật');
        check('game over dừng sự kiện và khóa di chuyển', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.scene === "gameover" && !FNHStandalonePreview.engine.state.switchValue(996) && !FNHStandalonePreview.engine.move(2) && document.querySelector("#fnh-end-title").textContent === "Game Over"', false, false));
        await clickElement(cdp, '#fnh-save');
        check('game over không ghi đè save bằng trạng thái đã chết', await evalPage(cdp,
            'new FNHStandaloneSave.SaveStore({ prefix: "FNH_STANDALONE_PREVIEW:" }).load(1).scene === "map" && FNHStandalonePreview.engine.state.scene === "gameover"', false, false));
        await evalPage(cdp, `(() => {
            const slots = document.querySelector('#fnh-end-save-slot'); slots.value = 20; slots.dispatchEvent(new Event('change'));
        })()`, false, false);
        if (await evalPage(cdp,'document.querySelector("#fnh-end-save-panel").hidden',false,false)) await clickElement(cdp,'#fnh-continue');
        await clickElement(cdp, '#fnh-end-load');
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.scene === "map" && document.querySelector("#fnh-end-screen").hidden',
            5000, 'tải save từ màn game over');
        check('tải ô 20 từ game over trở lại map', await evalPage(cdp,
            '!FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.engine.state.variableValue(8235) === 20 && document.querySelector("#fnh-end-save-slot").options.length === 20 && document.querySelector("#fnh-status").textContent.startsWith("Map ")', false, false));
        await evalPage(cdp, `document.querySelector('#fnh-end-save-slot').value = 1;
            localStorage.removeItem('FNH_STANDALONE_PREVIEW:20'); localStorage.removeItem('FNH_STANDALONE_PREVIEW:1');
            FNHStandalonePreview.engine.createInterpreter([{ code: 353 }], 0).run()`, true, false);
        await waitFor(cdp, '!document.querySelector("#fnh-end-screen").hidden', 5000, 'game over lần hai');
        if (await evalPage(cdp,'document.querySelector("#fnh-end-save-panel").hidden',false,false)) await clickElement(cdp,'#fnh-continue');
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
        check('tiêu đề tôn trọng cấu hình không vẽ tên chồng lên ảnh', await evalPage(cdp,
            '!FNHStandalonePreview.engine.database.System.optDrawTitle && document.querySelector("#fnh-end-title").hidden && document.querySelector("#fnh-end-actions").getBoundingClientRect().width > 0', false, false));
        check('tiêu đề có ba lệnh và màn tải riêng', await evalPage(cdp,`(()=>{
            const panel=document.querySelector('#fnh-end-actions'),rect=panel.getBoundingClientRect(),stage=document.querySelector('.fnh-stage').getBoundingClientRect();
            return Array.from(panel.querySelectorAll('button:not([hidden])')).map(button=>button.textContent).join(',')==='New Game,Continue,Settings' &&
                document.querySelector('#fnh-end-save-panel').hidden && Math.abs(rect.width/stage.width*816-240)<1 &&
                Math.abs(rect.height/stage.height*624-144)<1 && !document.querySelector('#fnh-title-frame').hidden;
        })()`,false,false));
        await evalPage(cdp, `(() => {
            const state=new FNHStandaloneState.GameState({mapId:74,x:8,y:8,direction:8,party:[1],switches:{246:true},variables:{121:1,8235:72}},FNHStandalonePreview.engine.database);
            state.actor(1);const snapshot=state.toJSON();
            new FNHStandaloneSave.SaveStore({prefix:'FNH_STANDALONE_PREVIEW:'}).save(20,snapshot);
        })()`,false,false);
        await cdp.send('Page.navigate',{url:running.url});
        await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.state && FNHStandalonePreview.engine.state.mapId===72 && FNHStandalonePreview.engine.state.screen.pictures[1] && FNHStandalonePreview.engine.state.screen.pictures[1].opacity>0',
            15000,'Map072 chạy splash thật sau khi khởi động');
        check('pre-title dùng Map072, nhân vật ẩn và khóa điều khiển gameplay',await evalPage(cdp,
            'FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.engine.state.transparent && FNHStandalonePreview.engine.state.x===0 && FNHStandalonePreview.engine.state.y===0 && getComputedStyle(document.querySelector("#fnh-controls")).display==="none" && document.querySelector("#fnh-save").hidden && document.querySelector("#fnh-menu").hidden',false,false));
        await evalPage(cdp, `(async()=>{
            window.pretitleImage=new Image();pretitleImage.src='img/pictures/splash_screen1.png';await pretitleImage.decode();
        })()`,true,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.state.screen.pictures[1].opacity===255',5000,'splash tăng đủ opacity theo sự kiện');
        check('Canvas vẽ splash PNG thật đủ màu trước tiêu đề',await evalPage(cdp,`(async()=>{
            await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
            const expected=document.createElement('canvas');expected.width=816;expected.height=624;
            const context=expected.getContext('2d');context.drawImage(pretitleImage,0,0);
            const pixels=context.getImageData(0,0,816,624).data,actual=document.querySelector('#fnh-canvas').getContext('2d').getImageData(0,0,816,624).data;
            let checked=0;
            for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]===255){checked++;if(pixels[i]!==actual[i]||pixels[i+1]!==actual[i+1]||pixels[i+2]!==actual[i+2])return false;}
            delete window.pretitleImage;return checked>10000;
        })()`,true,false));
        await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="title" && !FNHStandalonePreview.engine.eventRunning && !document.querySelector("#fnh-end-screen").hidden',
            10000,'splash tự fade ra và lệnh 354 mở title');
        check('pre-title kết thúc sạch và không nạp runtime/plugin cũ',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.screen.pictures[1].opacity===0 && !FNHStandalonePreview.scheduler.autorun && FNHStandalonePreview.scheduler.parallel.size===0 && !window.SceneManager && !performance.getEntriesByType("resource").some(entry=>/\\/js\\/rpg_|\\/js\\/plugins|\\/__fnh\\//.test(entry.name))',false,false));
        await evalPage(cdp,'document.querySelector("#fnh-end-save-slot").value=20',false,false);
        if (await evalPage(cdp,'document.querySelector("#fnh-end-save-panel").hidden',false,false)) await clickElement(cdp,'#fnh-continue');
        await clickElement(cdp,'#fnh-end-load');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.mapId===74 && FNHStandalonePreview.engine.state.scene==="map" && document.querySelector("#fnh-end-screen").hidden',
            10000,'tiếp tục ô lưu từ title sau splash');
        check('Continue tải đúng ô, trả điều khiển và scheduler sang map đã lưu',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.variableValue(8235)===72 && !document.querySelector("#fnh-controls").hidden && FNHStandalonePreview.scheduler.enabled',false,false));
        check('luồng chơi luôn chạy nhanh theo cấu hình gốc và ẩn tùy chọn đi bộ',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine,old=e.state.alwaysDash,enabled=e.state.dashEnabled;e.state.alwaysDash=false;e.state.dashEnabled=true;
            const fast=e.playerStepFrames();e.state.dashEnabled=false;const slow=e.playerStepFrames();
            e.state.dashEnabled=enabled;e.state.alwaysDash=old;
            return e.forceDashing && fast*2===slow && document.querySelector('#fnh-always-dash').closest('label').hidden;
        })()`,false,false));
        await clickElement(cdp,'#fnh-menu');
        await clickElement(cdp,'[data-menu-tab="options"]');
        check('menu luồng chơi không hiển thị tùy chọn luôn chạy',await evalPage(cdp,
            '!document.querySelector("#fnh-option-dash")',false,false));
        await clickElement(cdp,'#fnh-menu-close');
        await evalPage(cdp, `(() => {
            const e=FNHStandalonePreview.engine;window.cheatNamePage=e.map.eventPage(e.map.eventById(39));window.cheatNameList=window.cheatNamePage.list;
            e.state.setActorName(1,'Mercenary');e.state.changeActorHp(1,-99999,true);e.state.setSwitch(7388,false);
            window.cheatNamePage.list=[{code:303,parameters:[1,10]},{code:121,parameters:[7388,7388,0]}];
        })()`,false,false);
        await clickElement(cdp,'#fnh-controls [data-direction="0"]');
        await waitFor(cdp,'document.querySelector("#fnh-name-dialog").open',5000,'mở hộp nhập tên cheat độc lập');
        await evalPage(cdp,'document.querySelector("#fnh-name-input").value="LiGhThOuSe";document.querySelector("#fnh-name-form").requestSubmit()',false,false);
        await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.engine.state.switchValue(7388)',5000,'nhập tên cheat hoàn tất qua UI');
        check('nhập lighthouse trong engine mới hồi đầy HP và miễn death qua sự kiện',await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine;
            await e.createInterpreter([{code:311,parameters:[0,1,1,0,99999,true]},{code:313,parameters:[0,1,0,1]},{code:317,parameters:[0,1,0,0,0,50]}],0).run();
            return e.state.hasNameCheat(1) && e.state.actor(1).hp===e.state.actorParam(1,0) && !e.state.actor(1).states.includes(1);
        })()`,true,false));
        check('cheat tăng đòn HP lên quái và giữ kết quả sau save',await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine,db=e.database,enemyId=db.Enemies.length,troopId=db.Troops.length,id=db.Skills.length;
            db.Enemies.push({...db.Enemies[1],id:enemyId,name:'lighthouse',params:[20000,100,1,1,1,1,10,1],traits:[],actions:[]});
            db.Troops.push({id:troopId,pages:[],members:[{enemyId,x:408,y:400}]});
            db.Skills.push({...db.Skills[3],id,note:'',animationId:0,scope:1,repeats:1,hitType:0,effects:[],mpCost:0,tpCost:0,
                damage:{type:1,formula:'10',critical:false,variance:0,elementId:0}});
            e.battle.setup(troopId,true,true);e.state.scene='battle';e.battle.random=()=>0.5;
            e.battle.useSkill(e.battle.actor(1),id,0,true);
            await e.restore(e.save());
            const hp=e.state.actor(1).hp;e.battle.useSkill(e.battle.enemy(0),id,0,true);
            const passed=e.battle.enemy(0).hp===10001 && e.state.actor(1).hp===hp && e.state.hasNameCheat(1);
            e.battle.finish('escape');e.leaveBattle('escape');return passed;
        })()`,true,false));
        check('đổi tên tắt cheat, bật lại chặn cả game over cốt truyện',await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine;
            await e.createInterpreter([{code:320,parameters:[1,'Mercenary']},{code:311,parameters:[0,1,1,0,99999,true]}],0).run();
            if(e.state.actor(1).hp!==0||e.state.hasNameCheat(1))return false;
            e.state.setActorName(1,'lighthouse');
            await e.createInterpreter([{code:353},{code:121,parameters:[7389,7389,0]}],0).run();
            window.cheatNamePage.list=window.cheatNameList;delete window.cheatNamePage;delete window.cheatNameList;
            return e.state.scene==='map' && e.state.switchValue(7389) && e.state.hasNameCheat(1);
        })()`,true,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.createInterpreter([{code:354}],0).run()',true,false);
        await waitFor(cdp,'!document.querySelector("#fnh-end-screen").hidden && FNHStandalonePreview.engine.state.scene==="title"',5000,'trở lại tiêu đề không phát splash lần hai');
        check('về title trong cùng phiên không chuyển lại Map072',await evalPage(cdp,
            'FNHStandalonePreview.engine.state.mapId===74 && (!FNHStandalonePreview.engine.state.screen.pictures[1] || FNHStandalonePreview.engine.state.screen.pictures[1].name!=="splash_screen1")',false,false));
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
        await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
        const selectTouchPoint=await evalPage(cdp,`(async()=>{
            const button=document.querySelector('#fnh-controls [data-direction="6"]');button.scrollIntoView({block:'center',behavior:'instant'});
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const rect=button.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,id:1};
        })()`,true,false);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[selectTouchPoint]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
        await waitFor(cdp, 'FNHStandalonePreview.engine.state.variableValue(9) === 2', 5000, 'chạm nhanh chọn knight bằng nút phải');
        check('chạm nhanh điều khiển JSON đổi ảnh và vị trí khung chọn', await evalPage(cdp,
            'FNHStandalonePreview.engine.state.screen.pictures[8].x === 225 && FNHStandalonePreview.engine.state.screen.pictures[7].name === "text_knight"', false, false));
        await sleep(250);
        await clickElement(cdp, '#fnh-controls [data-direction="0"]');
        await waitFor(cdp, 'document.querySelector("#fnh-name-dialog").open', 5000, 'nhập tên độc lập');
        check('nhập tên giữ khóa autorun và đúng nhân vật được chọn', await evalPage(cdp,
            'FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.engine.state.switchValue(242) && document.querySelector("#fnh-name-input").maxLength === 10', false, false));
        check('đặt tên dùng chân dung, ô tên và bảng ký tự như bản gốc', await evalPage(cdp,
            'document.querySelectorAll("#fnh-name-grid button").length === 90 && document.querySelector("#fnh-name-slots").children.length === 10 && getComputedStyle(document.querySelector("#fnh-name-face")).backgroundImage.includes("/img/faces/") && document.querySelector("#fnh-name-grid button:last-child").textContent === "OK"', false, false));
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
                !video.controls && video.disablePictureInPicture && getComputedStyle(video).pointerEvents === 'none' &&
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

        await evalPage(cdp,`(()=>{
            const preview=FNHStandalonePreview;preview.scheduler.stop();window.__gameplayMenuSnapshot=preview.engine.save();
            preview.engine.state.gold=123;preview.engine.state.menuEnabled=true;
        })()`,false,false);
        await clickElement(cdp,'#fnh-menu');
        check('menu chơi thường ẩn bạc, lưu tự do và nút lưu nhanh theo cấu hình gốc',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;
            return e.state.scene==='menu' && !document.querySelector('#fnh-menu-content').textContent.includes('Bạc:') &&
                document.querySelector('[data-menu-tab="system"]').hidden && document.querySelector('#fnh-save').hidden && document.querySelector('#fnh-load').hidden &&
                !document.querySelector('[data-menu-tab="gameEnd"]').hidden && !document.querySelector('[data-menu-tab="options"]').hidden &&
                !document.querySelector('[data-menu-tab="synthesis"]').hidden && !document.querySelector('[data-menu-tab="formation"]');
        })()`,false,false));
        check('menu chơi chỉ có sáu lệnh gốc và nội dung khớp icon đang chọn',await evalPage(cdp,`(()=>{
            const menu=document.querySelector('#fnh-menu-dialog');
            const commands=Array.from(menu.querySelectorAll('[data-menu-tab]')).filter(button=>!button.hidden).map(button=>button.dataset.menuTab);
            const content=document.querySelector('#fnh-menu-content');
            return commands.join(',')==='inventory,equipment,synthesis,skills,options,gameEnd' &&
                menu.classList.contains('fnh-menu-tabs') && content.dataset.menuPage===document.activeElement.dataset.menuTab &&
                menu.querySelector('[data-menu-tab="inventory"]').getAttribute('aria-label')===FNHStandalonePreview.engine.database.System.terms.commands[4] &&
                !content.textContent.includes('EXP:') && !content.textContent.includes('TP:') &&
                !content.querySelector('.fnh-state-rates') && content.querySelector('.fnh-menu-window') &&
                document.querySelector('#fnh-menu-actor').hidden;
        })()`,false,false));
        await screenshot('standalone-game-menu');
        await clickElement(cdp,'#fnh-menu-close');
        await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;e.state.gainItem('items',40,1);
            window.__gameplayBookDone=false;window.__gameplayBookError=null;
            window.__gameplayUseMenuItem=e.useMenuItem;
            e.useMenuItem=async function(...args){try{const result=await __gameplayUseMenuItem.apply(this,args);window.__gameplayBookDone=true;return result;}
                catch(error){window.__gameplayBookError=error.message;throw error;}};
        })()`,false,false);
        await clickElement(cdp,'#fnh-menu');
        await clickElement(cdp,'[data-menu-tab="inventory"]');
        await clickElement(cdp,'[data-menu-key="category-books"]');
        await clickElement(cdp,'#fnh-menu-content button[data-item="40"]');
        await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine;
            for(let i=0;i<1000 && e.state.scene!=='save' && !window.__gameplayBookError;i++){
                if(!document.querySelector('#fnh-next').hidden)document.querySelector('#fnh-next').click();
                e.advanceRoutes(120);await new Promise(resolve=>setTimeout(resolve,0));
            }
        })()`,true,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="save" && document.querySelector("#fnh-menu-dialog").open',5000,'sách mở màn lưu riêng trong chơi thường');
        check('lệnh 352 từ sách vẫn mở lưu và khóa các tab khác trong chơi thường',await evalPage(cdp,`(()=>{
            const tabs=Array.from(document.querySelectorAll('[data-menu-tab]')).filter(button=>!button.hidden).map(button=>button.dataset.menuTab);
            return tabs.join(',')==='system' && document.querySelectorAll('#fnh-menu-content .fnh-save-file').length===20 && !document.querySelector('#fnh-menu-load');
        })()`,false,false));
        await clickElement(cdp,'#fnh-menu-content [data-slot="1"]');
        await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine;
            for(let i=0;i<1000 && !window.__gameplayBookDone && !window.__gameplayBookError;i++){
                if(!document.querySelector('#fnh-next').hidden)document.querySelector('#fnh-next').click();
                e.advanceRoutes(120);await new Promise(resolve=>setTimeout(resolve,0));
            }
        })()`,true,false);
        check('sách lưu trong chơi thường giữ checkpoint và dọn common event đúng một lần',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine,saved=new FNHStandaloneSave.SaveStore({prefix:'FNH_STANDALONE_PREVIEW:'}).load(1);
            return window.__gameplayBookDone && !window.__gameplayBookError && saved.pendingEventStack.length>0 &&
                e.state.scene==='map' && !e.state.switchValue(3350) && !e.state.screen.pictures[1];
        })()`,false,false));
        await waitFor(cdp,'!document.querySelector("#fnh-menu-dialog").open && !document.querySelector("#fnh-menu").disabled',5000,'sách kết thúc và trả điều khiển menu');
        await clickElement(cdp,'#fnh-menu');
        await clickElement(cdp,'[data-menu-tab="gameEnd"]');
        await clickElement(cdp,'#fnh-menu-end-cancel');
        check('hủy kết thúc giữ menu và trạng thái chơi',await evalPage(cdp,'FNHStandalonePreview.engine.state.scene==="menu" && document.querySelector("#fnh-menu-dialog").open',false,false));
        await clickElement(cdp,'[data-menu-tab="gameEnd"]');
        await clickElement(cdp,'#fnh-menu-to-title');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="title" && !document.querySelector("#fnh-end-screen").hidden && !document.querySelector("#fnh-menu-dialog").open',5000,'menu trở về title');
        check('lệnh kết thúc mở tiêu đề độc lập và dọn input/menu',await evalPage(cdp,'FNHStandalonePreview.engine.buttons.size===0 && document.querySelector("#fnh-end-title").textContent===FNHStandalonePreview.engine.database.System.gameTitle && !window.SceneManager',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.useMenuItem=window.__gameplayUseMenuItem;delete window.__gameplayUseMenuItem;FNHStandalonePreview.engine.restore(window.__gameplayMenuSnapshot).then(()=>{delete window.__gameplayMenuSnapshot;return true;})',true,false);

        await evalPage(cdp,`(async()=>{
            const preview=FNHStandalonePreview,e=preview.engine;preview.scheduler.stop();
            await e.loadMap(86);e.state.x=8;e.state.y=8;e.state.setSwitch(2249,true);e.state.setSwitch(662,true);
            window.__endingDone=false;window.__endingError=null;
            e.runEvent(4,preview.scheduler.handlers).then(()=>{window.__endingDone=true;},error=>{window.__endingError=error.message;});
        })()`,true,false);
        await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine;
            for(let i=0;i<1000;i++){
                const picture=e.screen.screen.pictures[26];
                if(picture && picture.name==='ending_S_true_god' && picture.opacity===255)return;
                if(!document.querySelector('#fnh-next').hidden)document.querySelector('#fnh-next').click();
                e.advanceRoutes(30);await new Promise(resolve=>setTimeout(resolve,0));
            }
            throw Error('Ending S chưa hiện ảnh');
        })()`,true,false);
        check('kết thúc S chạy page thật, hiện PNG và giữ khóa sự kiện',await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine,renderer=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas'));
            await renderer.draw(e);const image=await renderer.loadImage('img/pictures/ending_S_true_god.png');
            return image.width>0 && renderer.images.has('img/pictures/ending_S_true_god.png') && e.eventRunning &&
                !e.state.menuEnabled && !e.openMenu() && !window.__endingDone && !window.SceneManager;
        })()`,true,false));
        await screenshot('standalone-ending-s');
        await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine;
            for(let i=0;i<1000;i++){
                if(!document.querySelector('#fnh-scroll-text').hidden)return;
                if(!document.querySelector('#fnh-next').hidden)document.querySelector('#fnh-next').click();
                e.advanceRoutes(120);await new Promise(resolve=>setTimeout(resolve,0));
            }
            throw Error('Ending S chưa tới credits');
        })()`,true,false);
        check('Ending S ghi achievement rồi chờ credits đầy đủ trước game over',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine,content=document.querySelector('#fnh-scroll-content');
            return e.state.achievements.ENDING_S_KNIGHT && e.state.scene==='map' && e.eventRunning && e.messageRunning &&
                content.textContent.includes('CREDITS') && content.textContent.includes('Miro') && content.getAnimations().length===1 && !window.__endingDone;
        })()`,false,false));
        await evalPage(cdp,`(async()=>{
            document.querySelector('#fnh-scroll-content').getAnimations()[0].finish();
            const e=FNHStandalonePreview.engine;
            for(let i=0;i<1000 && !window.__endingDone && !window.__endingError;i++){
                if(!document.querySelector('#fnh-next').hidden)document.querySelector('#fnh-next').click();
                e.advanceRoutes(120);await new Promise(resolve=>setTimeout(resolve,0));
            }
        })()`,true,false);
        await waitFor(cdp,'window.__endingDone && !document.querySelector("#fnh-end-screen").hidden',5000,'kết thúc S tới game over');
        check('kết thúc thật mở game over, giữ achievement qua save và khóa di chuyển',await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine,saved=e.save();await e.restore(saved);
            return e.state.scene==='gameover' && e.state.achievements.ENDING_S_KNIGHT && !e.move(6) &&
                !e.eventRunning && !window.__endingError && document.querySelector('#fnh-end-title').textContent==='Game Over';
        })()`,true,false));

        // Chạy liên tục qua UI thật; không sửa switch hoặc gọi lại event mở đầu.
        await evalPage(cdp,'FNHStandalonePreview.settings.setVolume("master",5)',false,false);
        await cdp.send('Page.navigate',{url:running.url});
        await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.state && FNHStandalonePreview.engine.state.scene==="title"',30000,'khởi động hành trình thật');
        await clickElement(cdp,'#fnh-new-game');
        await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.state && FNHStandalonePreview.engine.state.switchValue(296)',30000,'chọn Mercenary');
        await clickElement(cdp,'#fnh-controls [data-direction="0"]');
        await waitFor(cdp,'document.querySelector("#fnh-name-dialog").open',10000,'đặt tên Mercenary');
        await evalPage(cdp,`document.querySelector('#fnh-name-input').value='Mercenary';
            document.querySelector('#fnh-name-form').requestSubmit();window.__journeyVideoEnded=false;
            document.querySelector('#fnh-video').addEventListener('ended',()=>window.__journeyVideoEnded=true,{once:true})`,false,false);
        let journeyFinished=false;
        for(let attempt=0;attempt<600 && !journeyFinished;attempt++){
            journeyFinished=await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine,video=document.querySelector('#fnh-video');
                const choices=[...document.querySelectorAll('#fnh-choices button')].filter(button=>!button.disabled);
                if(!video.hidden){video.playbackRate=8;if(video.paused)document.querySelector('#fnh-video-play').click();}
                else if(choices.length){const intro=document.querySelector('#fnh-message-text').textContent.includes('Play intro?');
                    (intro ? choices[1] : choices[0]).click();}
                else if(!document.querySelector('#fnh-next').hidden)document.querySelector('#fnh-next').click();
                return e.state.mapId===74 && e.state.scene==='map' && !e.eventRunning;
            })()`,false,true);
            if(!journeyFinished)await sleep(250);
        }
        check('chơi liên tục từ entry chính qua video và lựa chọn tới cổng ngục',journeyFinished && await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;
            return window.__journeyVideoEnded && e.state.switchValue(295) && e.state.switchValue(79) &&
                e.state.party.join(',')==='1' && e.state.actor(1).name==='Mercenary' &&
                e.state.menuEnabled && FNHStandalonePreview.errors.length===0;
        })()`,false,false));
        for(let step=0;step<35 && await evalPage(cdp,'FNHStandalonePreview.engine.state.mapId===74',false,false);step++){
            await evalPage(cdp,`document.querySelector('#fnh-controls [data-direction="8"]').click()`,false,true);
            await sleep(250);
        }
        await waitFor(cdp,'FNHStandalonePreview.engine.state.mapId!==74 && !FNHStandalonePreview.engine.eventRunning',10000,'đi qua cửa ngục thật');
        check('đi từ cổng qua cửa vào layout ngục theo biến JSON',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine,layout=e.state.variableValue(121);
            const map=layout===1?1:layout===2?29:layout===3?51:183;
            return e.state.mapId===map && e.state.x===(layout===1||layout===2?27:layout===3?26:91) &&
                e.state.y===(layout===1||layout===2||layout===3?68:73) && FNHStandalonePreview.errors.length===0;
        })()`,false,false));
        await evalPage(cdp,`(async()=>{
            const app=FNHStandalonePreview;app.scheduler.stop();
            await app.engine.restore({mapId:51,x:36,y:63,direction:6,party:[1]});
        })()`,true,false);
        await clickElement(cdp,'#fnh-controls [data-direction="0"]');
        await waitFor(cdp,'document.querySelectorAll("#fnh-choices button").length===2',5000,'mở lựa chọn cửa Map051 thật');
        check('event rỗng dưới chân không che lựa chọn mở cửa phía trước',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;
            return e.map.eventPage(e.map.eventById(6)).list.length===1 && e.map.eventById(7).locked &&
                document.querySelector('#fnh-message-text').textContent.includes('door seems to be open');
        })()`,false,false));
        await clickElement(cdp,'#fnh-choices button:first-child');
        await waitFor(cdp,'FNHStandalonePreview.engine.state.switchValue(22) && !FNHStandalonePreview.engine.eventRunning',5000,'route mở hai cánh cửa Map051');
        check('chọn Open mở cửa Map051 và trả quyền điều khiển',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;
            return e.map.eventPage(e.map.eventById(8)).priorityType===0 && !e.messageRunning &&
                FNHStandalonePreview.errors.length===0;
        })()`,false,false));
        await evalPage(cdp,`(async()=>{
            const app=FNHStandalonePreview,e=app.engine;
            await e.restore({mapId:1,x:27,y:68,party:[1],switches:{153:true,246:true}});
            window.__realAutorunScheduler=new FNHStandaloneScheduler.EventScheduler(e,app.scheduler.handlers,error=>app.errors.push(error.message));
            __realAutorunScheduler.tick();
        })()`,true,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.state.switchValue(410) && FNHStandalonePreview.engine.state.switchValue(202)',5000,'autorun Map001 thật sau trang rỗng');
        check('autorun rỗng Map001 không chặn sự kiện 84 thật',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;
            return __realAutorunScheduler.autorun.page===e.map.eventPage(e.map.eventById(84)) &&
                !e.map.eventById(3).locked && !e.map.eventById(4).locked && FNHStandalonePreview.errors.length===0;
        })()`,false,false));
        await evalPage(cdp,'__realAutorunScheduler.stop();delete window.__realAutorunScheduler',false,false);
        await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning',5000,'hủy autorun kiểm tra');
        await evalPage(cdp,'FNHStandalonePreview.engine.restore({mapId:51,x:63,y:46,direction:6,party:[1]}).then(()=>true)',true,false);
        await clickElement(cdp,'#fnh-controls [data-direction="0"]');
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle && FNHStandalonePreview.engine.battle.battle.phase==="input"',10000,'xác nhận trước Guard thật');
        check('nút tương tác kích hoạt Guard chạm ở ô phía trước',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine,p=e.map.eventPage(e.map.eventById(9));
            return p.trigger===2 && e.map.eventById(9).locked && e.battle.battle.troopId===1 &&
                e.state.x===63 && e.state.y===46 && e.state.scene==='battle';
        })()`,false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.battle.finish("escape")',false,false);
        await waitFor(cdp,'FNHStandalonePreview.engine.state.scene==="map" && !FNHStandalonePreview.engine.eventRunning',10000,'kết thúc ca Guard chạm');
        await evalPage(cdp,'FNHStandalonePreview.engine.restore({mapId:1,x:16,y:63,direction:4,party:[1]}).then(()=>true)',true,false);
        await clickElement(cdp,'#fnh-controls [data-direction="0"]');
        await waitFor(cdp,'document.querySelectorAll("#fnh-choices button").length===4',5000,'cửa Map001 phía sau quầy');
        check('tương tác qua ô quầy mở lựa chọn cửa Map001 thật',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;
            return e.map.isCounter(15,63) && e.map.eventById(7).locked && e.state.x===16 && e.state.y===63 &&
                document.querySelector('#fnh-message-text').textContent.includes('faint sound');
        })()`,false,false));
        await clickElement(cdp,'#fnh-choices button:nth-child(4)');
        await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning',5000,'rời cửa phía sau quầy');
        check('CURSE WEAPONS nhận Short sword đang trang bị thay vì khóa lựa chọn',await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine,snapshot=e.save(),list=e.database.CommonEvents[193].list.slice(0,7);
            try{
                e.state.addActor(4);e.state.actor(4).equips[0]=1;e.state.gainItem('weapons',1,-99);
                e.state.pendingChoices={text:{},disabled:[]};await e.createInterpreter(list,0).run();
                if(e.state.pendingChoices.disabled.includes(0) || e.state.itemCount('weapons',1)!==0)return false;
                e.state.removeActor(4);e.state.pendingChoices={text:{},disabled:[]};await e.createInterpreter(list,0).run();
                return e.state.pendingChoices.disabled.includes(0) && e.state.pendingChoices.text[0]==='????';
            }finally{await e.restore(snapshot);}
        })()`,true,false));
        check('đồng hồ từ lệnh Map166 hiển thị và giữ qua lưu tải',await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine,snapshot=e.save(),timer=document.querySelector('#fnh-timer');
            const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            try{
                const map=await (await fetch('data/Map166.json')).json();
                const start=map.events[67].pages[0].list.find(command=>command.code===124 && command.parameters[0]===0);
                const stop=map.events[307].pages[0].list.find(command=>command.code===124 && command.parameters[0]===1);
                if(!start || !stop || start.parameters[1]!==180)return false;
                e.state.scene='menu';await e.createInterpreter([start],0).run();
                await frame();if(!timer.hidden || e.state.timer.frames!==10800)return false;
                e.state.scene='map';await frame();
                if(timer.hidden || !['03:00','02:59'].includes(timer.textContent))return false;
                e.state.scene='menu';e.state.timer.frames=61;await e.restore(e.save());
                e.state.scene='map';await frame();if(timer.hidden || !['00:01','00:00'].includes(timer.textContent))return false;
                const remaining=e.state.timer.frames;
                await e.createInterpreter([stop],0).run();await frame();return timer.hidden && e.state.timer.frames===remaining;
            }finally{await e.restore(snapshot);}
        })()`,true,false));
        check('chạm ô câu đố thật chọn và bỏ chọn qua điều khiển',await evalPage(cdp,`(async()=>{
            const app=FNHStandalonePreview,e=app.engine,snapshot=e.save();
            const scheduler=new FNHStandaloneScheduler.EventScheduler(e,app.scheduler.handlers,error=>app.errors.push(error.message));
            const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
            try{
                await e.restore({mapId:166,x:60,y:36,direction:2,party:[1],switches:{2741:true},timer:{active:true,frames:10800}});
                const tile=e.map.eventById(40),tick=async predicate=>{
                    for(let i=0;i<300 && !predicate();i++){scheduler.tick();e.advanceRoutes(1);await frame();}
                    return predicate();
                };
                document.querySelector('#fnh-controls [data-direction="0"]').click();
                if(!await tick(()=>e.state.selfSwitchValue(166,40,'D') && !e.eventRunning))return false;
                if(e.state.variableValue(318)!==1)return false;
                document.querySelector('#fnh-controls [data-direction="0"]').click();
                if(!await tick(()=>!e.state.selfSwitchValue(166,40,'A') && e.state.variableValue(318)===0 && !e.eventRunning))return false;
                return e.map.eventPage(tile)===tile.pages[0];
            }finally{scheduler.stop();await e.restore(snapshot);}
        })()`,true,false));
        check('điều kiện skill tính trait trạng thái thật và giữ qua save',await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine,snapshot=e.save();
            try {
                e.state.addActor(1);e.state.changeActorSkill(1,64,false);e.state.changeActorState(1,27,true);
                const condition=()=>e.createInterpreter([],0).evaluateCondition([4,1,3,64]);
                if(!condition() || !e.battle.actorSkills(1).some(skill=>skill.id===64))return false;
                await e.restore(e.save());
                if(!condition() || !e.battle.actorSkills(1).some(skill=>skill.id===64))return false;
                e.state.changeActorState(1,27,false);
                return !condition() && !e.battle.actorSkills(1).some(skill=>skill.id===64);
            } finally { await e.restore(snapshot); }
        })()`,true,false));
        check('CURSE WEAPONS lấy kiếm đang đeo và cấp kiếm nguyền đúng một lần',await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine,snapshot=e.save(),list=e.database.CommonEvents[193].list.slice(135,137);
            try{
                e.state.addActor(4);e.state.actor(4).equips[0]=1;e.state.gainItem('weapons',1,-99);e.state.gainItem('weapons',13,-99);
                await e.createInterpreter(list,0).run();
                if(e.state.actor(4).equips[0]!==0 || e.state.itemCount('weapons',1)!==0 || e.state.itemCount('weapons',13)!==1)return false;
                const saved=e.save();await e.restore(saved);
                return e.state.actor(4).equips[0]===0 && e.state.itemCount('weapons',13)===1;
            }finally{await e.restore(snapshot);}
        })()`,true,false));
        await evalPage(cdp,`(()=>{
            const app=FNHStandalonePreview,e=app.engine;window.__curseJourneySnapshot=e.save();
            e.state.addActor(4);e.state.actor(4).equips[0]=1;e.state.gainItem('weapons',1,-99);
            e.state.gainItem('weapons',13,-99);e.state.gainItem('items',116,-99);e.state.gainItem('items',116,1);
            e.state.setSwitch(1901,false);window.__curseJourneyDone=false;window.__curseJourneyError=null;
            e.runCommonEvent(193,app.scheduler.handlers).then(()=>window.__curseJourneyDone=true,error=>window.__curseJourneyError=error.message);
        })()`,false,false);
        await waitFor(cdp,'document.querySelectorAll("#fnh-choices button").length>0 || window.__curseJourneyError',5000,'mở danh sách nguyền vũ khí thật');
        check('common event nguyền hiện Short sword đang đeo và giữ các món thiếu bị khóa',await evalPage(cdp,`(()=>{
            const buttons=[...document.querySelectorAll('#fnh-choices button')];
            return !window.__curseJourneyError && buttons.length>6 && !buttons[0].disabled && buttons[0].textContent.includes('Short sword') && buttons[1].disabled;
        })()`,false,false));
        await clickElement(cdp,'#fnh-choices button:first-child');
        await waitFor(cdp,'!document.querySelector("#fnh-next").hidden || window.__curseJourneyError',5000,'thông báo nhận kiếm nguyền');
        check('event nguyền tiêu soul, tháo kiếm đang đeo và hiện phần thưởng',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;
            return !window.__curseJourneyError && e.eventRunning && e.state.actor(4).equips[0]===0 &&
                e.state.itemCount('items',116)===0 && e.state.itemCount('weapons',1)===0 && e.state.itemCount('weapons',13)===1 &&
                e.state.switchValue(1901) && document.querySelector('#fnh-message-text').textContent.includes('Cursed short sword');
        })()`,false,false));
        await clickElement(cdp,'#fnh-next');
        await waitFor(cdp,'window.__curseJourneyDone || window.__curseJourneyError',5000,'kết thúc common event nguyền vũ khí');
        check('common event nguyền hoàn tất và giữ kết quả qua save',await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine;if(window.__curseJourneyError || e.eventRunning)return false;
            await e.restore(e.save());return e.state.actor(4).equips[0]===0 && e.state.itemCount('weapons',13)===1 && e.state.switchValue(1901);
        })()`,true,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(window.__curseJourneySnapshot).then(()=>{delete window.__curseJourneySnapshot;return true})',true,false);
        await evalPage(cdp,`(()=>{
            const app=FNHStandalonePreview,e=app.engine;window.__curseJourneySnapshot=e.save();
            e.state.addActor(4);e.state.actor(4).equips[0]=38;e.state.gainItem('weapons',38,-99);
            e.state.gainItem('weapons',39,-99);e.state.gainItem('items',116,-99);e.state.gainItem('items',116,1);
            window.__curseJourneyDone=false;window.__curseJourneyError=null;
            e.runCommonEvent(193,app.scheduler.handlers).then(()=>window.__curseJourneyDone=true,error=>window.__curseJourneyError=error.message);
        })()`,false,false);
        await waitFor(cdp,'document.querySelectorAll("#fnh-choices button").length===19 || window.__curseJourneyError',5000,'lựa chọn gộp Morning star');
        check('lựa chọn thứ 13 của event nguyền hiện Morning star đang đeo',await evalPage(cdp,`(()=>{
            const buttons=document.querySelectorAll('#fnh-choices button');return !window.__curseJourneyError && buttons.length===19 &&
                !buttons[12].disabled && buttons[12].textContent.includes('Morning star') && buttons[0].disabled;
        })()`,false,false));
        check('lựa chọn nguyền vẽ icon Morning star từ IconSet',await evalPage(cdp,`(()=>{
            const button=document.querySelector('#fnh-choices button:nth-child(13)'),icon=button.querySelector('.fnh-text-icon');
            if(!icon || button.textContent.includes('\\\\i['))return false;
            const style=getComputedStyle(icon);
            return style.backgroundImage.includes('/img/system/IconSet.png') && style.backgroundPosition==='0px -608px' &&
                style.width==='32px' && style.height==='32px';
        })()`,false,false));
        check('chi phí nguyền dùng màu từ bảng Window.png',await evalPage(cdp,`(async()=>{
            const button=document.querySelector('#fnh-choices button:nth-child(13)');
            const colored=[...button.querySelectorAll('span')].find(node=>node.textContent==='[1]');
            const skin=new Image();skin.src='img/system/Window.png';await skin.decode();
            const canvas=document.createElement('canvas');canvas.width=skin.width;canvas.height=skin.height;
            const context=canvas.getContext('2d');context.drawImage(skin,0,0);
            const pixel=context.getImageData(126,150,1,1).data;
            return colored && getComputedStyle(colored).color===\`rgb(\${pixel[0]}, \${pixel[1]}, \${pixel[2]})\`;
        })()`,true,false));
        await evalPage(cdp,'document.querySelector("#fnh-choices button:nth-child(13)").focus()',false,false);
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
        check('mũi tên bỏ qua các lựa chọn bị khóa',await evalPage(cdp,`(()=>{
            const buttons=[...document.querySelectorAll('#fnh-choices button')];
            const next=buttons.slice(13).find(button=>!button.disabled);
            return buttons[13].disabled && document.activeElement===next;
        })()`,false,false));
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
        check('mũi tên lên trở về Morning star',await evalPage(cdp,
            'document.activeElement===document.querySelector("#fnh-choices button:nth-child(13)")',false,false));
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90});
        await waitFor(cdp,'!document.querySelector("#fnh-next").hidden || window.__curseJourneyError',5000,'nhận Cursed morning star');
        check('nhánh lựa chọn thứ 13 tiêu soul và nguyền đúng vũ khí',await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;return !window.__curseJourneyError && e.state.actor(4).equips[0]===0 &&
                e.state.itemCount('items',116)===0 && e.state.itemCount('weapons',38)===0 && e.state.itemCount('weapons',39)===1 &&
                document.querySelector('#fnh-message-text').textContent.includes('Cursed morning star');
        })()`,false,false));
        await clickElement(cdp,'#fnh-next');
        await waitFor(cdp,'window.__curseJourneyDone || window.__curseJourneyError',5000,'kết thúc nhánh thứ 13');
        check('nhánh thứ 13 kết thúc mà không mở lại nhóm lựa chọn',await evalPage(cdp,
            '!window.__curseJourneyError && !FNHStandalonePreview.engine.eventRunning && document.querySelectorAll("#fnh-choices button").length===0',false,false));
        await evalPage(cdp,'FNHStandalonePreview.engine.restore(window.__curseJourneySnapshot).then(()=>{delete window.__curseJourneySnapshot;return true})',true,false);
        await evalPage(cdp,`(()=>{
            window.__keyboardChoiceResult=null;
            FNHStandalonePreview.scheduler.handlers.choice(['Một','Hai'],-2,null,
                {disabled:[],help:[],message:[],defaultIndex:0}).then(value=>window.__keyboardChoiceResult=value);
        })()`,false,false);
        await waitFor(cdp,'document.querySelectorAll("#fnh-choices button").length===3',5000,'lựa chọn cho phép hủy');
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await waitFor(cdp,'window.__keyboardChoiceResult!==null',5000,'hủy lựa chọn bằng bàn phím');
        check('phím hủy trả về nhánh hủy của lựa chọn',await evalPage(cdp,
            'window.__keyboardChoiceResult===-1 && !document.querySelector("#fnh-choices button")',false,false));
        await evalPage(cdp,`FNHStandalonePreview.scheduler.handlers.message(${JSON.stringify('Vật phẩm \\i[191] và \\\\i[8]')},[],null,{choicesFollow:true})`,true,false);
        check('hội thoại hiện icon và giữ mã được escape thành chữ',await evalPage(cdp,`(()=>{
            const message=document.querySelector('#fnh-message-text'),icons=message.querySelectorAll('.fnh-text-icon');
            return icons.length===1 && getComputedStyle(icons[0]).backgroundPosition==='-480px -352px' &&
                message.textContent===${JSON.stringify('Vật phẩm  và \\i[8]')};
        })()`,false,false));
        check('phần thưởng trứng thật không cộng vượt 99 và giữ đúng qua save',await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine,snapshot=e.save();
            try{
                const command=e.database.CommonEvents[52].list.find(entry=>entry.code===126 && entry.parameters[0]===15 && entry.parameters[1]===0 && entry.parameters[3]===2);
                if(!command)return false;
                e.state.gainItem('items',15,-99);e.state.gainItem('items',15,98);
                await e.createInterpreter([command],0).run();if(e.state.itemCount('items',15)!==99)return false;
                await e.restore(e.save());return e.state.itemCount('items',15)===99;
            }finally{await e.restore(snapshot);}
        })()`,true,false));
        check('ba map lặp vẽ tile, nhân vật và follower liền mạch qua mép',await evalPage(cdp,`(async()=>{
            const e=FNHStandalonePreview.engine;
            for(const id of [157,160,185]){
                await e.restore({mapId:id,x:1,y:1,direction:6,party:[1,3],alwaysDash:false});
                const m=e.map,y=Array.from({length:m.height},(_,i)=>i).find(i=>m.isPassable(m.width-1,i,6) && !m.eventBlocks(0,i,-1));
                if(y===undefined)return false;
                e.state.x=m.width-1;e.state.y=y;e.resetCamera();const follower=e.state.followers()[0];follower.x=m.width-3;follower.y=y;
                if(!e.move(6) || e.state.x!==0)return false;
                e.state.scene='menu'; // Dừng frame trong lúc đợi PNG để so đúng vị trí.
                const renderer=new FNHStandaloneCanvas.CanvasRenderer(document.createElement('canvas'));
                const tiles=[],actors=[],drawTile=renderer.drawTile,drawActor=renderer.drawActor;
                renderer.drawTile=function(sheets,tile,x,y){tiles.push({tile,x,y});return drawTile.call(this,sheets,tile,x,y);};
                renderer.drawActor=function(sheets,actor,x,y){actors.push({id:actor.id,x:actor.x-x,y:actor.y-y});return drawActor.call(this,sheets,actor,x,y);};
                const view=m.viewport(e.state,816,624),row=Math.floor(view.startY);
                await renderer.drawMap(e,++renderer.frame);
                if(!actors.some(actor=>actor.id===Infinity && actor.x===8) ||
                    !actors.some(actor=>actor.id===100003 && actor.x===6) ||
                    !tiles.some(tile=>tile.tile===m.tileId(m.roundX(Math.floor(view.startX)+8),m.roundY(row),0) && tile.x===8 && tile.y===row-view.startY))return false;
                e.state.scene='map';e.advanceRoutes(e.state.moveFrames/2);e.state.scene='menu';const before=e.save();await e.restore(before);
                const position=FNHStandaloneMap.displayPosition(e.state),next=e.map.viewport(e.state,816,624);
                if(position.x!==-0.5 || e.map.screenX(position.x,next.startX)!==8)return false;
                e.state.scene='map';e.state.moveFrames=0;delete e.state.motion;
                const vertical=Array.from({length:e.map.width},(_,i)=>i).find(i=>e.map.isPassable(i,e.map.height-1,2) && !e.map.eventBlocks(i,0,-1));
                if(vertical===undefined)return false;
                e.state.x=vertical;e.state.y=e.map.height-1;e.resetCamera();
                if(!e.move(2) || e.state.y!==0)return false;
                e.state.scene='menu';tiles.length=0;actors.length=0;
                const verticalView=e.map.viewport(e.state,816,624),column=Math.floor(verticalView.startX);
                await renderer.drawMap(e,++renderer.frame);
                if(!actors.some(actor=>actor.id===Infinity && actor.y===6) ||
                    !tiles.some(tile=>tile.tile===e.map.tileId(e.map.roundX(column),e.map.roundY(Math.floor(verticalView.startY)+6),0) && tile.x===column-verticalView.startX && tile.y===6))return false;
            }
            return true;
        })()`,true,false));

        // Hai hành trình thật trên layout 3: thắng bằng cheat và nhân vật thường.
        async function guardJourney(cheat) {
        await evalPage(cdp,'FNHStandalonePreview.settings.setVolume("master",5)',false,false);
        const seeded = await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'Math.random = () => 0.5;'});
        await cdp.send('Page.navigate',{url:running.url});
        await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.state && FNHStandalonePreview.engine.state.scene==="title"',30000,'khởi động hành trình Guard');
        await clickElement(cdp,'#fnh-new-game');
        await waitFor(cdp,'window.FNHStandalonePreview && FNHStandalonePreview.engine.state && FNHStandalonePreview.engine.state.switchValue(296)',30000,'chọn nhân vật hành trình Guard');
        await clickElement(cdp,'#fnh-controls [data-direction="0"]');
        await waitFor(cdp,'document.querySelector("#fnh-name-dialog").open',10000,'đặt tên hành trình Guard');
        await evalPage(cdp,`document.querySelector('#fnh-name-input').value=${JSON.stringify(cheat ? 'lighthouse' : 'Mercenary')};document.querySelector('#fnh-name-form').requestSubmit()`,false,false);
        let reachedGate=false;
        for(let attempt=0;attempt<600 && !reachedGate;attempt++){
            reachedGate=await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine,v=document.querySelector('#fnh-video');
                const buttons=[...document.querySelectorAll('#fnh-choices button')].filter(button=>!button.disabled);
                if(!v.hidden){v.playbackRate=8;if(v.paused)document.querySelector('#fnh-video-play').click();}
                else if(buttons.length){const intro=document.querySelector('#fnh-message-text').textContent.includes('Play intro?');(intro?buttons[1]:buttons[0]).click();}
                else if(!document.querySelector('#fnh-next').hidden)document.querySelector('#fnh-next').click();
                return e.state.mapId===74 && e.state.scene==='map' && !e.eventRunning;
            })()`,false,true);
            if(!reachedGate)await sleep(250);
        }
        check('bắt đầu hành trình Guard '+(cheat?'với cheat':'bình thường'),reachedGate && await evalPage(cdp,
            'FNHStandalonePreview.engine.state.variableValue(121)===3 && FNHStandalonePreview.engine.state.hasNameCheat(1)==='+cheat,false,false));
        for(let step=0;step<35 && await evalPage(cdp,'FNHStandalonePreview.engine.state.mapId===74',false,false);step++){
            await evalPage(cdp,`document.querySelector('#fnh-controls [data-direction="8"]').click()`,false,true);await sleep(250);
        }
        await waitFor(cdp,'FNHStandalonePreview.engine.state.mapId===51 && !FNHStandalonePreview.engine.eventRunning',10000,'vào layout 3 thật');
        let metGuard=false;
        for(let step=0;step<240 && !metGuard;step++){
            metGuard=await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine,next=document.querySelector('#fnh-next');if(!next.hidden)next.click();
                const choice=document.querySelector('#fnh-choices button:not(:disabled)');if(choice)choice.click();
                if(e.state.scene==='battle')return true;
                const guard=e.map.eventById(9);let direction=e.map.findDirection(e.state,guard,60);
                if(!direction){
                    if(e.state.x===36 && e.state.y===63){
                        if(e.state.direction!==6)direction=6;
                        else if(!e.eventRunning)document.querySelector('#fnh-controls [data-direction="0"]').click();
                    }else direction=e.map.findDirection(e.state,{x:36,y:63},60);
                }
                if(direction && !e.eventRunning)document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                return false;
            })()`,false,true);
            if(!metGuard)await sleep(180);
        }
        check('đi qua cửa và gặp Guard thật bằng điều khiển gameplay',metGuard && await evalPage(cdp,
            'FNHStandalonePreview.engine.battle.battle.troopId===1 && FNHStandalonePreview.engine.state.switchValue(22)',false,false));
        await waitFor(cdp,'FNHStandalonePreview.engine.battle.battle.phase==="input"',20000,'Guard nhận lệnh');
        let completedGuard=false;
        for(let frame=0;frame<400 && !completedGuard;frame++){
            completedGuard=await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine,next=document.querySelector('#fnh-next');if(!next.hidden)next.click();
                const choice=document.querySelector('#fnh-choices button:not(:disabled)');if(choice)choice.click();
                if(e.state.scene==='battle' && e.battle.battle.phase==='input') window.fnhTestCombatAttack();
                return e.state.scene==='map' && !e.eventRunning && e.battle.battle && e.battle.battle.result==='victory';
            })()`,false,true);
            if(!completedGuard)await sleep(200);
        }
        if(!completedGuard)throw new Error('Hành trình Guard chưa hoàn tất: '+JSON.stringify(await evalPage(cdp,`(()=>{
            const e=FNHStandalonePreview.engine;return {scene:e.state.scene,map:e.state.mapId,event:e.eventRunning,
                result:e.battle.battle && e.battle.battle.result,phase:e.battle.battle && e.battle.battle.phase,hp:e.state.actor(1).hp,
                message:document.querySelector('#fnh-message-text').textContent,next:document.querySelector('#fnh-next').hidden,
                choices:[...document.querySelectorAll('#fnh-choices button')].map(button=>button.textContent),errors:FNHStandalonePreview.errors};
        })()`,false,false)));
        check(cheat?'thắng Guard và hoàn tất nhánh sự kiện thật khi dùng tên lighthouse':'thắng Guard và hoàn tất nhánh sự kiện bằng nhân vật thường',completedGuard && await evalPage(cdp,
            'FNHStandalonePreview.engine.state.switchValue(23) && FNHStandalonePreview.engine.state.actor(1).hp>0 && FNHStandalonePreview.engine.state.hasNameCheat(1)==='+cheat+' && FNHStandalonePreview.errors.length===0',false,false));
        if (cheat) {
            await evalPage(cdp,`(()=>{const e=FNHStandalonePreview.engine;window.__guardRandom=e.random;e.random=()=>0.3;})()`,false,false);
            let foundKey=false;
            for(let step=0;step<180 && !foundKey;step++){
                foundKey=await evalPage(cdp,`(()=>{
                    const e=FNHStandalonePreview.engine;
                    if(e.state.itemCount('items',20)>0 && !e.eventRunning)return true;
                    const next=document.querySelector('#fnh-next');if(!next.hidden)next.click();
                    const buttons=[...document.querySelectorAll('#fnh-choices button')];
                    const choice=buttons.find(button=>button.textContent==='Search him') || buttons.find(button=>button.textContent==='No');
                    if(choice)choice.click();
                    if(e.state.scene!=='map' || e.eventRunning)return false;
                    const guard=e.map.eventById(9);
                    if(e.state.x===guard.x && e.state.y===guard.y)document.querySelector('#fnh-controls [data-direction="0"]').click();
                    else {const direction=e.map.findDirection(e.state,guard,60);if(direction)document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();}
                    return false;
                })()`,false,true);
                if(!foundKey)await sleep(150);
            }
            if(!foundKey)throw new Error('Không tìm được Small key trên Guard: '+JSON.stringify(await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine,guard=e.map.eventById(9);return {x:e.state.x,y:e.state.y,guardX:guard.x,guardY:guard.y,
                    scene:e.state.scene,event:e.eventRunning,key:e.state.itemCount('items',20),message:document.querySelector('#fnh-message-text').textContent,
                    choices:[...document.querySelectorAll('#fnh-choices button')].map(button=>button.textContent),errors:FNHStandalonePreview.errors};
            })()`,false,false)));
            await evalPage(cdp,'FNHStandalonePreview.engine.random=window.__guardRandom;delete window.__guardRandom',false,false);
            check('lục xác Guard nhận Small key từ loot thật',await evalPage(cdp,
                'FNHStandalonePreview.engine.state.itemCount("items",20)===1 && FNHStandalonePreview.engine.state.switchValue(45)',false,false));
            let foundGirl=false;
            for(let step=0;step<240 && !foundGirl;step++){
                foundGirl=await evalPage(cdp,`(()=>{
                    const e=FNHStandalonePreview.engine, text=document.querySelector('#fnh-message-text').textContent;
                    if(text.includes('little girl inside the cage'))return true;
                    const next=document.querySelector('#fnh-next');if(!next.hidden)next.click();
                    const choice=document.querySelector('#fnh-choices button:not(:disabled)');if(choice)choice.click();
                    if(e.state.scene==='battle' && e.battle.battle.phase==='input') window.fnhTestCombatAttack();
                    if(e.state.scene!=='map' || e.eventRunning)return false;
                    const cage=e.map.eventById(88),dx=cage.x-e.state.x,dy=cage.y-e.state.y;
                    let direction;
                    if(Math.abs(dx)+Math.abs(dy)===1){
                        direction=dx<0?4:dx>0?6:dy<0?8:2;
                        if(e.state.direction===direction){document.querySelector('#fnh-controls [data-direction="0"]').click();return false;}
                    }else direction=e.map.findDirection(e.state,cage,60);
                    if(direction)document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                    return false;
                })()`,false,true);
                if(!foundGirl)await sleep(180);
            }
            if(!foundGirl)throw new Error('Không tới lồng Girl: '+JSON.stringify(await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine,cage=e.map.eventById(88);
                return {map:e.state.mapId,x:e.state.x,y:e.state.y,direction:e.state.direction,scene:e.state.scene,
                    event:e.eventRunning,cageX:cage.x,cageY:cage.y,path:e.map.findDirection(e.state,cage,60),
                    message:document.querySelector('#fnh-message-text').textContent,errors:FNHStandalonePreview.errors};
            })()`,false,false)));
            check('sau Guard đi đến lồng và gặp Girl qua sự kiện thật',foundGirl && await evalPage(cdp,
                'FNHStandalonePreview.engine.state.mapId===51 && FNHStandalonePreview.engine.eventRunning && FNHStandalonePreview.errors.length===0',false,false));
            let canTalk=false;
            for(let attempt=0;attempt<100 && !canTalk;attempt++){
                canTalk=await evalPage(cdp,`(()=>{
                    const buttons=[...document.querySelectorAll('#fnh-choices button')];
                    if(buttons.some(button=>button.textContent==='Talk'))return true;
                    const skip=buttons.find(button=>button.textContent===\"Don't\");if(skip)skip.click();
                    else if(!document.querySelector('#fnh-next').hidden)document.querySelector('#fnh-next').click();
                    return false;
                })()`,false,true);
                if(!canTalk)await sleep(100);
            }
            if(!canTalk)throw new Error('Không mở được hội thoại Girl: '+JSON.stringify(await evalPage(cdp,`(()=>({
                message:document.querySelector('#fnh-message-text').textContent,
                choices:[...document.querySelectorAll('#fnh-choices button')].map(button=>button.textContent),
                event:FNHStandalonePreview.engine.eventRunning,errors:FNHStandalonePreview.errors
            }))()`,false,false)));
            await evalPage(cdp,'[...document.querySelectorAll("#fnh-choices button")].find(button=>button.textContent==="Talk").click()',false,false);
            await waitFor(cdp,'document.querySelector("#fnh-message-text").textContent.includes("*sob*") && document.querySelectorAll("#fnh-choices button").length>0',5000,'nói chuyện với Girl');
            check('Girl khóc và hiện lựa chọn hội thoại thật',await evalPage(cdp,`(()=>{
                const choices=[...document.querySelectorAll('#fnh-choices button')].map(button=>button.textContent);
                return choices.includes('"Are you okay?"') && choices.includes('"Are you a monster?"');
            })()`,false,false));
            await evalPage(cdp,'[...document.querySelectorAll("#fnh-choices button")].find(button=>button.textContent.includes("Are you okay?")).click()',false,false);
            await waitFor(cdp,'document.querySelector("#fnh-message-text").textContent.includes("She doesn\'t respond.") && !document.querySelector("#fnh-next").hidden',5000,'câu trả lời của Girl');
            await clickElement(cdp,'#fnh-next');
            await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning',5000,'kết thúc nói chuyện với Girl');
            check('nói chuyện xong trả quyền điều khiển và giữ Girl trong lồng',await evalPage(cdp,
                'FNHStandalonePreview.engine.state.scene==="map" && !FNHStandalonePreview.engine.state.hasActor(2) && !FNHStandalonePreview.engine.state.switchValue(81) && FNHStandalonePreview.errors.length===0',false,false));
            await clickElement(cdp,'#fnh-controls [data-direction="0"]');
            let rescued=false;
            for(let attempt=0;attempt<240 && !rescued;attempt++){
                rescued=await evalPage(cdp,`(()=>{
                    const e=FNHStandalonePreview.engine;
                    if(e.state.hasActor(2) && e.state.switchValue(81) && !e.eventRunning)return true;
                    const next=document.querySelector('#fnh-next');if(!next.hidden)next.click();
                    const buttons=[...document.querySelectorAll('#fnh-choices button')];
                    const button=buttons.find(b=>b.textContent.includes('Use Small key')) ||
                        buttons.find(b=>b.textContent==='Open the cage') || buttons.find(b=>b.textContent===\"Don't\");
                    if(button && !button.disabled)button.click();
                    if(e.state.scene==='battle' && e.battle.battle.phase==='input') window.fnhTestCombatAttack();
                    return false;
                })()`,false,true);
                if(!rescued)await sleep(100);
            }
            if(!rescued)throw new Error('Không giải cứu được Girl: '+JSON.stringify(await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine;return {party:e.state.party,scene:e.state.scene,key:e.state.itemCount('items',20),
                    switch81:e.state.switchValue(81),event:e.eventRunning,message:document.querySelector('#fnh-message-text').textContent,
                    choices:[...document.querySelectorAll('#fnh-choices button')].map(button=>button.textContent),errors:FNHStandalonePreview.errors};
            })()`,false,false)));
            check('chìa khóa từ Guard mở lồng và thêm Girl vào đội',rescued && await evalPage(cdp,
                'FNHStandalonePreview.engine.state.itemCount("items",20)===0 && FNHStandalonePreview.engine.state.party.includes(2) && FNHStandalonePreview.errors.length===0',false,false));
            check('lưu tải giữ Girl và lồng đã mở',await evalPage(cdp,`(async()=>{
                const e=FNHStandalonePreview.engine;await e.restore(e.save());
                return e.state.party.includes(2) && e.state.switchValue(81) && e.state.itemCount('items',20)===0 &&
                    e.state.followers().some(follower=>follower.id===2);
            })()`,true,false));
            let enteredNextFloor=false;
            for(let step=0;step<400 && !enteredNextFloor;step++){
                enteredNextFloor=await evalPage(cdp,`(()=>{
                    const e=FNHStandalonePreview.engine;
                    if(e.state.mapId===128 && e.state.scene==='map' && !e.eventRunning)return true;
                    const next=document.querySelector('#fnh-next');if(!next.hidden)next.click();
                    const choice=document.querySelector('#fnh-choices button:not(:disabled)');if(choice)choice.click();
                    if(e.state.scene==='battle' && e.battle.battle.phase==='input') window.fnhTestCombatAttack();
                    if(e.state.scene!=='map' || e.eventRunning || e.state.mapId!==51)return false;
                    const door=e.map.eventById(16),dx=door.x-e.state.x,dy=door.y-e.state.y;
                    if(!e.state.switchValue(24) && Math.abs(dx)+Math.abs(dy)===1){
                        const direction=dx<0?4:dx>0?6:dy<0?8:2;
                        if(e.state.direction===direction)document.querySelector('#fnh-controls [data-direction="0"]').click();
                        else document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                    }else{
                        const direction=e.map.findDirection(e.state,door,80);
                        if(direction)document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                    }
                    return false;
                })()`,false,true);
                if(!enteredNextFloor)await sleep(180);
            }
            if(!enteredNextFloor)throw new Error('Không đến tầng tiếp theo cùng Girl: '+JSON.stringify(await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine;return {map:e.state.mapId,x:e.state.x,y:e.state.y,scene:e.state.scene,
                    event:e.eventRunning,door:e.state.switchValue(24),party:e.state.party,message:document.querySelector('#fnh-message-text').textContent,
                    battle:e.battle.battle && {phase:e.battle.battle.phase,actions:e.battle.battle.inputActions},status:document.querySelector('#fnh-status').textContent,
                    choices:[...document.querySelectorAll('#fnh-choices button')].map(button=>button.textContent),errors:FNHStandalonePreview.errors};
            })()`,false,false)));
            check('đi cùng Girl qua cửa tới tầng tiếp theo',await evalPage(cdp,
                'FNHStandalonePreview.engine.state.mapId===128 && FNHStandalonePreview.engine.state.party.includes(2) && FNHStandalonePreview.engine.state.followers().some(f=>f.id===2) && FNHStandalonePreview.errors.length===0',false,false));
            let enteredDeeper=false;
            for(let step=0;step<400 && !enteredDeeper;step++){
                enteredDeeper=await evalPage(cdp,`(()=>{
                    const e=FNHStandalonePreview.engine;
                    if([3,31,53].includes(e.state.mapId) && e.state.scene==='map' && !e.eventRunning)return true;
                    const next=document.querySelector('#fnh-next');if(!next.hidden)next.click();
                    const choice=document.querySelector('#fnh-choices button:not(:disabled)');if(choice)choice.click();
                    if(e.state.scene==='battle' && e.battle.battle.phase==='input') window.fnhTestCombatAttack();
                    if(e.state.scene!=='map' || e.eventRunning || e.state.mapId!==128)return false;
                    const door=e.map.eventById(3),dx=door.x-e.state.x,dy=door.y-e.state.y;
                    if(!e.state.switchValue(58) && Math.abs(dx)+Math.abs(dy)===1){
                        const direction=dx<0?4:dx>0?6:dy<0?8:2;
                        if(e.state.direction===direction)document.querySelector('#fnh-controls [data-direction="0"]').click();
                        else document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                    }else{
                        const direction=e.map.findDirection(e.state,door,80);
                        if(direction)document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                    }
                    return false;
                })()`,false,true);
                if(!enteredDeeper)await sleep(180);
            }
            if(!enteredDeeper)throw new Error('Không đi sâu hơn cùng Girl: '+JSON.stringify(await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine;return {map:e.state.mapId,x:e.state.x,y:e.state.y,scene:e.state.scene,
                    event:e.eventRunning,door:e.state.switchValue(58),layout:e.state.variableValue(123),party:e.state.party,
                    message:document.querySelector('#fnh-message-text').textContent,errors:FNHStandalonePreview.errors};
            })()`,false,false)));
            check('đi cùng Girl qua hành lang tới khu vực ngục kế tiếp',await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine,expected={1:3,2:31,3:53}[e.state.variableValue(123)];
                return e.state.mapId===expected && e.state.party.includes(2) && e.state.followers().some(f=>f.id===2) && FNHStandalonePreview.errors.length===0;
            })()`,false,false));
            let defeatedPriests=false,metPriests=false;
            for(let step=0;step<550 && !defeatedPriests;step++){
                const progress=await evalPage(cdp,`(()=>{
                    const e=FNHStandalonePreview.engine,battle=e.battle.battle;
                    if(battle && battle.troopId===12 && e.state.scene==='battle')window.__metPriests=true;
                    if(window.__metPriests && battle && battle.troopId===12 && battle.result==='victory' && e.state.scene==='map' && !e.eventRunning)return 2;
                    const next=document.querySelector('#fnh-next');if(!next.hidden)next.click();
                    const buttons=[...document.querySelectorAll('#fnh-choices button:not(:disabled)')];
                    const choice=buttons.find(button=>button.textContent==='Attack him') || buttons[0];if(choice)choice.click();
                    if(e.state.scene==='battle' && e.battle.battle.phase==='input') window.fnhTestCombatAttack();
                    if(e.state.scene!=='map' || e.eventRunning || window.__metPriests)return window.__metPriests?1:0;
                    const priest=e.map.eventById(16),dx=priest.x-e.state.x,dy=priest.y-e.state.y;
                    if(Math.abs(dx)+Math.abs(dy)===1){
                        const direction=dx<0?4:dx>0?6:dy<0?8:2;
                        if(e.state.direction===direction)document.querySelector('#fnh-controls [data-direction="0"]').click();
                        else document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                    }else{
                        const direction=e.map.findDirection(e.state,priest,80);
                        if(direction)document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                    }
                    return 0;
                })()`,false,true);
                metPriests=metPriests || progress>0;defeatedPriests=progress===2;
                if(!defeatedPriests)await sleep(180);
            }
            if(!defeatedPriests)throw new Error('Không hoàn tất trận Priest: '+JSON.stringify(await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine,b=e.battle.battle;return {map:e.state.mapId,x:e.state.x,y:e.state.y,scene:e.state.scene,
                    event:e.eventRunning,met:window.__metPriests,battle:b&&{troop:b.troopId,phase:b.phase,result:b.result,actions:b.inputActions},
                    party:e.state.party,message:document.querySelector('#fnh-message-text').textContent,
                    choices:[...document.querySelectorAll('#fnh-choices button')].map(button=>button.textContent),errors:FNHStandalonePreview.errors};
            })()`,false,false)));
            check('gặp và thắng hai Priest cùng Girl trong hành trình thật',metPriests && await evalPage(cdp,
                'FNHStandalonePreview.engine.state.party.includes(2) && FNHStandalonePreview.engine.battle.battle.troopId===12 && FNHStandalonePreview.errors.length===0',false,false));
            await evalPage(cdp,'window.__ritualBefore=FNHStandalonePreview.engine.state.variableValue(37)',false,false);
            let sacrificed=false;
            for(let step=0;step<400 && !sacrificed;step++){
                sacrificed=await evalPage(cdp,`(()=>{
                    const e=FNHStandalonePreview.engine;
                    if(e.state.switchValue(2043) && !e.eventRunning && e.state.scene==='map')return true;
                    const next=document.querySelector('#fnh-next');if(!next.hidden)next.click();
                    const choice=[...document.querySelectorAll('#fnh-choices button:not(:disabled)')].find(button=>button.textContent==='Sacrifice him');
                    if(choice)choice.click();
                    if(e.state.scene==='battle' && e.battle.battle.phase==='input') window.fnhTestCombatAttack();
                    if(e.state.scene!=='map' || e.eventRunning)return false;
                    const statue=e.map.eventById(37),dx=statue.x-e.state.x,dy=statue.y-e.state.y;
                    if(Math.abs(dx)+Math.abs(dy)===1){
                        const direction=dx<0?4:dx>0?6:dy<0?8:2;
                        if(e.state.direction===direction)document.querySelector('#fnh-controls [data-direction="0"]').click();
                        else document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                    }else{
                        const direction=e.map.findDirection(e.state,statue,80);
                        if(direction)document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                    }
                    return false;
                })()`,false,true);
                if(!sacrificed)await sleep(180);
            }
            if(!sacrificed)throw new Error('Không hoàn tất tế lễ tại tượng: '+JSON.stringify(await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine;return {map:e.state.mapId,x:e.state.x,y:e.state.y,scene:e.state.scene,event:e.eventRunning,
                    ritual:e.state.switchValue(2043),message:document.querySelector('#fnh-message-text').textContent,
                    choices:[...document.querySelectorAll('#fnh-choices button')].map(button=>button.textContent),errors:FNHStandalonePreview.errors};
            })()`,false,false)));
            check('tế lễ tăng điểm Alll-Mer và thay trang tượng',await evalPage(cdp,`(async()=>{
                const e=FNHStandalonePreview.engine;if(e.state.variableValue(37)!==window.__ritualBefore+1 || !e.state.switchValue(2042))return false;
                await e.restore(e.save());return e.state.switchValue(2043) && e.state.variableValue(37)===window.__ritualBefore+1 &&
                    e.map.eventPage(e.map.eventById(37)).conditions.switch1Id===2043 && e.state.party.includes(2);
            })()`,true,false));
            let fellDeeper=false,triggeredTrap=false;
            for(let step=0;step<500 && !fellDeeper;step++){
                const progress=await evalPage(cdp,`(()=>{
                    const e=FNHStandalonePreview.engine;
                    if([6,37].includes(e.state.mapId) && e.state.scene==='map' && !e.eventRunning)return 2;
                    const message=document.querySelector('#fnh-message-text').textContent;
                    if(message.includes('crack underneath your feet'))window.__sawFloorTrap=true;
                    const next=document.querySelector('#fnh-next');if(!next.hidden)next.click();
                    const buttons=[...document.querySelectorAll('#fnh-choices button:not(:disabled)')];
                    const choice=buttons.find(button=>button.textContent==='HEADS') || buttons[0];if(choice)choice.click();
                    if(e.state.scene==='battle' && e.battle.battle.phase==='input') window.fnhTestCombatAttack();
                    if(e.state.scene!=='map' || e.eventRunning || e.state.mapId!==31)return window.__sawFloorTrap?1:0;
                    const trapId=e.state.switchValue(1562)?300:e.state.switchValue(1563)?89:277;
                    const trap=e.map.eventById(trapId),direction=e.map.findDirection(e.state,trap,80);
                    if(direction)document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                    return window.__sawFloorTrap?1:0;
                })()`,false,true);
                triggeredTrap=triggeredTrap || progress>0;fellDeeper=progress===2;
                if(!fellDeeper)await sleep(180);
            }
            if(!fellDeeper)throw new Error('Không đi xuống qua sàn sập: '+JSON.stringify(await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine;return {map:e.state.mapId,x:e.state.x,y:e.state.y,scene:e.state.scene,event:e.eventRunning,
                    trap:window.__sawFloorTrap,layout:e.state.variableValue(126),message:document.querySelector('#fnh-message-text').textContent,
                    choices:[...document.querySelectorAll('#fnh-choices button')].map(button=>button.textContent),errors:FNHStandalonePreview.errors};
            })()`,false,false)));
            check('sàn sập đưa cả đội xuống tầng sâu theo layout thật',triggeredTrap && await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine;return e.state.mapId==={1:6,2:37}[e.state.variableValue(126)] &&
                    e.state.party.includes(2) && e.state.followers().some(f=>f.id===2) && FNHStandalonePreview.errors.length===0;
            })()`,false,false));
            await evalPage(cdp,`(()=>{const e=FNHStandalonePreview.engine;window.__crateInventory=JSON.stringify(e.state.inventory);})()`,false,false);
            let searchedCrate=false;
            for(let step=0;step<250 && !searchedCrate;step++){
                searchedCrate=await evalPage(cdp,`(()=>{
                    const e=FNHStandalonePreview.engine;
                    if(e.state.selfSwitchValue(37,133,'A') && !e.eventRunning && e.state.scene==='map')return true;
                    const next=document.querySelector('#fnh-next');if(!next.hidden)next.click();
                    const choice=document.querySelector('#fnh-choices button:not(:disabled)');if(choice)choice.click();
                    if(e.state.scene==='battle' && e.battle.battle.phase==='input') window.fnhTestCombatAttack();
                    if(e.state.scene!=='map' || e.eventRunning || e.state.mapId!==37)return false;
                    const crate=e.map.eventById(133),dx=crate.x-e.state.x,dy=crate.y-e.state.y;
                    if(Math.abs(dx)+Math.abs(dy)===1){
                        const direction=dx<0?4:dx>0?6:dy<0?8:2;
                        if(e.state.direction===direction)document.querySelector('#fnh-controls [data-direction="0"]').click();
                        else document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                    }else{
                        const direction=e.map.findDirection(e.state,crate,80);
                        if(direction)document.querySelector('#fnh-controls [data-direction="'+direction+'"]').click();
                    }
                    return false;
                })()`,false,true);
                if(!searchedCrate)await sleep(180);
            }
            if(!searchedCrate)throw new Error('Không mở được thùng tầng sâu: '+JSON.stringify(await evalPage(cdp,`(()=>{
                const e=FNHStandalonePreview.engine;return {map:e.state.mapId,x:e.state.x,y:e.state.y,scene:e.state.scene,event:e.eventRunning,
                    message:document.querySelector('#fnh-message-text').textContent,errors:FNHStandalonePreview.errors};
            })()`,false,false)));
            check('thùng tầng sâu cho vật phẩm và giữ trạng thái sau lưu tải',await evalPage(cdp,`(async()=>{
                const e=FNHStandalonePreview.engine,inventory=JSON.stringify(e.state.inventory);
                if(inventory===window.__crateInventory || !e.state.party.includes(2))return false;
                window.__crateAfter=inventory;
                await e.restore(e.save());return e.state.selfSwitchValue(37,133,'A') && JSON.stringify(e.state.inventory)===inventory &&
                    e.map.eventPage(e.map.eventById(133)).conditions.selfSwitchValid && e.state.party.includes(2);
            })()`,true,false));
            await clickElement(cdp,'#fnh-controls [data-direction="0"]');
            await waitFor(cdp,'document.querySelector("#fnh-message-text").textContent.includes("Nothing left here.") && !document.querySelector("#fnh-next").hidden',5000,'mở lại thùng đã tìm');
            await clickElement(cdp,'#fnh-next');
            await waitFor(cdp,'!FNHStandalonePreview.engine.eventRunning',5000,'kết thúc tìm lại thùng');
            check('mở lại thùng đã tìm không nhận thêm vật phẩm',await evalPage(cdp,
                'JSON.stringify(FNHStandalonePreview.engine.state.inventory)===window.__crateAfter && FNHStandalonePreview.engine.state.party.includes(2)',false,false));
        }
        await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:seeded.identifier});
        }
        await guardJourney(true);
        await guardJourney(false);

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
        if (runtimeErrors.length) console.error('Lỗi JavaScript trong trang:\n' + JSON.stringify(runtimeErrors, null, 2));
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
