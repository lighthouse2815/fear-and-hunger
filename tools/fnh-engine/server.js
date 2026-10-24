'use strict';
/* ============================================================
   Fear & Hunger — máy chủ cho engine web độc lập
   - Phục vụ ứng dụng trong fnh-engine/ tại /
   - Phục vụ dữ liệu gốc trong thư mục www tại /game/
   - Không sao chép, không sửa asset của game.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const APP_ROOT = path.join(REPO_ROOT, 'fnh-engine');
const DEFAULT_GAME_ROOT = path.join(
    REPO_ROOT, 'Fear.and.Hunger.v1.4.1', 'Fear.and.Hunger.v1.4.1', 'www'
);
const DEFAULT_PORT = 8139;
const DEFAULT_HOST = '127.0.0.1';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.rpgmvp': 'application/octet-stream',
    '.rpgmvo': 'application/octet-stream',
    '.rpgmvm': 'application/octet-stream',
    '.rpgmvw': 'application/octet-stream'
};

function usage() {
    return [
        'Cách dùng: node tools/fnh-engine/server.js [tuỳ chọn]',
        '',
        '  --game <thư mục>   Thư mục www hoặc thư mục game (mặc định: bản 1.4.1 trong repo)',
        '  --port <số>        Cổng HTTP (mặc định: ' + DEFAULT_PORT + ')',
        '  --host <địa chỉ>   Địa chỉ lắng nghe (mặc định: ' + DEFAULT_HOST + ')',
        '  --open             Mở trình duyệt sau khi máy chủ chạy',
        '  --help             Hiện trợ giúp'
    ].join('\n');
}

function parseArgs(argv) {
    const options = {
        gameRoot: process.env.FNH_GAME_ROOT || DEFAULT_GAME_ROOT,
        port: Number(process.env.FNH_ENGINE_PORT || DEFAULT_PORT),
        host: process.env.FNH_ENGINE_HOST || DEFAULT_HOST,
        open: false,
        help: false
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--game' || arg === '--port' || arg === '--host') {
            const value = argv[i + 1];
            if (!value) throw new Error('Thiếu giá trị cho ' + arg);
            i += 1;
            if (arg === '--game') options.gameRoot = value;
            if (arg === '--port') options.port = Number(value);
            if (arg === '--host') options.host = value;
        } else if (arg === '--open') {
            options.open = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error('Tuỳ chọn không hợp lệ: ' + arg);
        }
    }
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        throw new Error('Cổng không hợp lệ: ' + options.port);
    }
    return options;
}

function isGameRoot(directory) {
    return ['data/System.json', 'img', 'audio', 'fonts']
        .every(function (name) {
            return fs.existsSync(path.join(directory, name));
        });
}

function findGameRoot(input) {
    const candidates = [];
    if (input) candidates.push(input);
    if (process.env.FNH_GAME_ROOT) candidates.push(process.env.FNH_GAME_ROOT);
    candidates.push(DEFAULT_GAME_ROOT);

    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        if (isGameRoot(resolved)) return resolved;
        const nestedWww = path.join(resolved, 'www');
        if (isGameRoot(nestedWww)) return nestedWww;
    }

    const message = [
        'Không tìm thấy thư mục www hợp lệ của Fear & Hunger.',
        'Đã thử:',
        ...candidates.map(function (item) { return '  - ' + path.resolve(item); }),
        '',
        'Hãy chỉ định thư mục www bằng:',
        '  node tools/fnh-engine/server.js --game "/đường/dẫn/tới/www"',
        'hoặc đặt biến môi trường FNH_GAME_ROOT.'
    ].join('\n');
    const error = new Error(message);
    error.code = 'GAME_ROOT_NOT_FOUND';
    throw error;
}

function sendText(res, statusCode, text, contentType) {
    const body = Buffer.from(text, 'utf8');
    res.writeHead(statusCode, {
        'Content-Type': contentType || 'text/plain; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

function parseRange(rangeHeader, size) {
    if (!rangeHeader) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) return { invalid: true };
    let start = match[1] === '' ? null : Number(match[1]);
    let end = match[2] === '' ? null : Number(match[2]);
    if (start === null && end === null) return { invalid: true };
    if (start === null) {
        start = Math.max(0, size - end);
        end = size - 1;
    } else if (end === null || end >= size) {
        end = size - 1;
    }
    if (start < 0 || start >= size || end < start) return { invalid: true };
    return { start: start, end: end };
}

async function serveFile(req, res, filePath, cacheControl) {
    let stat;
    try {
        stat = await fsp.stat(filePath);
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
            sendText(res, 404, 'Không tìm thấy tệp.');
        } else {
            sendText(res, 500, 'Không đọc được tệp.');
        }
        return;
    }

    if (!stat.isFile()) {
        sendText(res, 404, 'Không tìm thấy tệp.');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const lastModified = stat.mtime.toUTCString();
    const etag = 'W/"' + stat.size.toString(16) + '-' + stat.mtimeMs.toString(16) + '"';
    const cache = cacheControl || 'no-cache';

    if (!req.headers.range) {
        const ifNoneMatch = req.headers['if-none-match'];
        const ifModifiedSince = req.headers['if-modified-since'];
        if (ifNoneMatch === etag || (!ifNoneMatch && ifModifiedSince === lastModified)) {
            res.writeHead(304, {
                'ETag': etag,
                'Last-Modified': lastModified,
                'Cache-Control': cache
            });
            res.end();
            return;
        }
    }

    const range = parseRange(req.headers.range, stat.size);
    if (range && range.invalid) {
        res.writeHead(416, {
            'Content-Range': 'bytes */' + stat.size,
            'Content-Type': contentType,
            'Cache-Control': cache
        });
        res.end();
        return;
    }

    if (range) {
        const length = range.end - range.start + 1;
        res.writeHead(206, {
            'Content-Type': contentType,
            'Content-Length': length,
            'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + stat.size,
            'Accept-Ranges': 'bytes',
            'Last-Modified': lastModified,
            'ETag': etag,
            'Cache-Control': cache
        });
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
        stream.on('error', function () { res.destroy(); });
        stream.pipe(res);
        return;
    }

    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Last-Modified': lastModified,
        'ETag': etag,
        'Cache-Control': cache
    });
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', function () { res.destroy(); });
    stream.pipe(res);
}

function createRequestHandler(options) {
    const settings = options || {};
    const gameRoot = path.resolve(settings.gameRoot || DEFAULT_GAME_ROOT);
    const appRoot = path.resolve(settings.appRoot || APP_ROOT);

    return async function handle(req, res) {
        try {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                sendText(res, 405, 'Phương thức không được hỗ trợ.');
                return;
            }

            const requestUrl = new URL(req.url, 'http://localhost');
            let pathname;
            try {
                pathname = decodeURIComponent(requestUrl.pathname);
            } catch (error) {
                sendText(res, 400, 'Đường dẫn không hợp lệ.');
                return;
            }
            if (pathname.indexOf('\0') !== -1) {
                sendText(res, 400, 'Đường dẫn không hợp lệ.');
                return;
            }

            if (pathname === '/__fnh-engine/health') {
                const health = {
                    ok: true,
                    mode: 'fnh-engine',
                    version: '0.1.0',
                    gameRoot: gameRoot,
                    appRoot: appRoot
                };
                sendText(res, 200, JSON.stringify(health, null, 2), 'application/json; charset=utf-8');
                return;
            }

            let root;
            let relative;
            let cacheControl;
            if (pathname === '/game' || pathname.startsWith('/game/')) {
                root = gameRoot;
                relative = pathname.slice('/game'.length).replace(/^\/+/, '');
                cacheControl = 'no-cache';
            } else {
                root = appRoot;
                relative = pathname.replace(/^\/+/, '');
                cacheControl = 'no-store';
            }

            if (!relative) relative = 'index.html';
            if (relative.endsWith('/')) relative += 'index.html';

            const filePath = path.resolve(root, relative);
            if (filePath !== root && !filePath.startsWith(root + path.sep)) {
                sendText(res, 403, 'Truy cập ngoài thư mục được phép bị chặn.');
                return;
            }
            await serveFile(req, res, filePath, cacheControl);
        } catch (error) {
            console.error('[FNH Engine] Lỗi máy chủ:', error);
            if (!res.headersSent) sendText(res, 500, 'Lỗi máy chủ nội bộ.');
            else res.destroy();
        }
    };
}

function openBrowser(url) {
    const command = process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
            ? 'cmd'
            : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try {
        const child = spawn(command, args, { detached: true, stdio: 'ignore' });
        child.unref();
    } catch (error) {
        console.warn('[FNH Engine] Không mở được trình duyệt tự động:', error.message);
    }
}

async function startServer(options) {
    const settings = Object.assign({
        gameRoot: DEFAULT_GAME_ROOT,
        appRoot: APP_ROOT,
        port: DEFAULT_PORT,
        host: DEFAULT_HOST
    }, options || {});
    const gameRoot = findGameRoot(settings.gameRoot);
    const appRoot = path.resolve(settings.appRoot);
    if (!fs.existsSync(path.join(appRoot, 'index.html'))) {
        throw new Error('Không tìm thấy ứng dụng engine tại ' + appRoot);
    }
    const handler = createRequestHandler({ gameRoot: gameRoot, appRoot: appRoot });
    const server = http.createServer(handler);

    await new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(settings.port, settings.host, function () {
            server.removeListener('error', reject);
            resolve();
        });
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : settings.port;
    const displayHost = settings.host === '0.0.0.0' || settings.host === '::'
        ? 'localhost'
        : settings.host;
    const url = 'http://' + displayHost + ':' + port + '/';

    return {
        server: server,
        gameRoot: gameRoot,
        appRoot: appRoot,
        port: port,
        host: settings.host,
        url: url,
        close: function () {
            return new Promise(function (resolve) {
                server.close(function () { resolve(); });
            });
        }
    };
}

async function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        console.error('');
        console.error(usage());
        process.exitCode = 2;
        return;
    }

    if (options.help) {
        console.log(usage());
        return;
    }

    let running;
    try {
        running = await startServer(options);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
        return;
    }

    console.log('');
    console.log('  FEAR & HUNGER — ENGINE WEB ĐỘC LẬP');
    console.log('  Ứng dụng:    ' + running.appRoot);
    console.log('  Dữ liệu gốc: ' + running.gameRoot);
    console.log('  Địa chỉ:     ' + running.url);
    console.log('');
    console.log('  Nhấn Ctrl+C để dừng máy chủ.');
    console.log('  Save nằm trong localStorage của trình duyệt (theo origin ở trên).');
    console.log('');

    if (options.open) openBrowser(running.url);

    const shutdown = function () {
        console.log('\n[FNH Engine] Đang dừng máy chủ…');
        running.close().then(function () { process.exit(0); });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

if (require.main === module) {
    main();
}

module.exports = {
    APP_ROOT: APP_ROOT,
    DEFAULT_GAME_ROOT: DEFAULT_GAME_ROOT,
    DEFAULT_PORT: DEFAULT_PORT,
    createRequestHandler: createRequestHandler,
    findGameRoot: findGameRoot,
    isGameRoot: isGameRoot,
    startServer: startServer
};
