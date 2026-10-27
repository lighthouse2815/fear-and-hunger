'use strict';
/* ============================================================
   Fear & Hunger — máy chủ cho dự án web độc lập.
   Phục vụ source tại thư mục hiện tại hoặc thư mục chỉ định bằng --game.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

const COMPAT_FILE = path.join(__dirname, '__fnh/compat.js');
const DEFAULT_GAME_ROOT = __dirname;
const DEFAULT_PORT = 8140;
const DEFAULT_HOST = '127.0.0.1';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
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
        'Cách dùng: node server.js [tuỳ chọn]',
        '',
        '  --game <thư mục>   Thư mục source hoặc bản build (mặc định: cùng thư mục server)',
        '  --port <số>        Cổng HTTP (mặc định: ' + DEFAULT_PORT + ')',
        '  --host <địa chỉ>   Địa chỉ lắng nghe (mặc định: ' + DEFAULT_HOST + ')',
        '  --open             Mở trình duyệt sau khi máy chủ chạy',
        '  --help             Hiện trợ giúp'
    ].join('\n');
}

function parseArgs(argv) {
    const options = {
        gameRoot: process.env.FNH_GAME_ROOT || DEFAULT_GAME_ROOT,
        port: Number(process.env.FNH_PORT || DEFAULT_PORT),
        host: process.env.FNH_HOST || DEFAULT_HOST,
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
    const has = name => fs.existsSync(path.join(directory, name));
    return has('index.html') && has('data/System.json') &&
        ((has('standalone.html') && has('engine/game-engine.js')) ||
         (has('js/rpg_core.js') && has('js/rpg_managers.js')));
}

function findGameRoot(input) {
    const candidates = [input || process.env.FNH_GAME_ROOT || DEFAULT_GAME_ROOT];

    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        if (isGameRoot(resolved)) return resolved;
        const nestedWww = path.join(resolved, 'www');
        if (isGameRoot(nestedWww)) return nestedWww;
    }

    const message = [
        'Không tìm thấy source hoặc bản build của game.',
        'Đã thử:',
        ...candidates.map(function (item) { return '  - ' + path.resolve(item); }),
        '',
        'Hãy chỉ định thư mục game bằng:',
        '  node server.js --game "/đường/dẫn/tới/game"',
        'hoặc đặt biến môi trường FNH_GAME_ROOT.'
    ].join('\n');
    const error = new Error(message);
    error.code = 'GAME_ROOT_NOT_FOUND';
    throw error;
}

function buildIndexHtml(originalHtml, compatUrl = '/__fnh/compat.js') {
    if (originalHtml.indexOf('/__fnh/compat.js') !== -1) return originalHtml;

    const compatTag = '        <script type="text/javascript" src="' + compatUrl + '"></script>';
    const pluginPattern = /([ \t]*)<script\b[^>]*\bsrc=["']js\/plugins\.js["'][^>]*>\s*<\/script>/i;
    if (pluginPattern.test(originalHtml)) {
        return originalHtml.replace(pluginPattern, function (match, indent) {
            return match + '\n' + indent + compatTag.trim();
        });
    }

    const mainPattern = /([ \t]*)<script\b[^>]*\bsrc=["']js\/main\.js["'][^>]*>\s*<\/script>/i;
    if (mainPattern.test(originalHtml)) {
        return originalHtml.replace(mainPattern, function (match, indent) {
            return indent + compatTag.trim() + '\n' + match;
        });
    }

    return originalHtml;
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
    } else {
        if (end === null || end >= size) end = size - 1;
    }
    if (start < 0 || start >= size || end < start) return { invalid: true };
    return { start: start, end: end };
}

async function serveFile(req, res, filePath) {
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

    if (!req.headers.range) {
        const ifNoneMatch = req.headers['if-none-match'];
        const ifModifiedSince = req.headers['if-modified-since'];
        if (ifNoneMatch === etag || (!ifNoneMatch && ifModifiedSince === lastModified)) {
            res.writeHead(304, {
                'ETag': etag,
                'Last-Modified': lastModified,
                'Cache-Control': 'no-cache'
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
            'Cache-Control': 'no-cache'
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
            'Cache-Control': 'no-cache'
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
        'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', function () { res.destroy(); });
    stream.pipe(res);
}

function createRequestHandler(gameRoot) {
    const root = path.resolve(gameRoot);
    const indexFile = path.join(root, 'index.html');

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

            if (pathname === '/__fnh/health') {
                const health = {
                    ok: true,
                    mode: 'fnh-browser',
                    version: '1.4.1',
                    gameRoot: root,
                    compat: true
                };
                sendText(res, 200, JSON.stringify(health, null, 2), 'application/json; charset=utf-8');
                return;
            }

            if (pathname === '/__fnh/compat.js') {
                const localCompat = path.join(root, '__fnh/compat.js');
                await serveFile(req, res, fs.existsSync(localCompat) ? localCompat : COMPAT_FILE);
                return;
            }

            if (pathname === '/' || pathname === '/index.html') {
                const html = await fsp.readFile(indexFile, 'utf8');
                const body = Buffer.from(buildIndexHtml(html), 'utf8');
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Length': body.length,
                    'Cache-Control': 'no-store'
                });
                if (req.method === 'HEAD') res.end(); else res.end(body);
                return;
            }

            const relative = pathname.replace(/^\/+/, '');
            const filePath = path.resolve(root, relative);
            if (filePath !== root && !filePath.startsWith(root + path.sep)) {
                sendText(res, 403, 'Truy cập ngoài thư mục game bị chặn.');
                return;
            }
            await serveFile(req, res, filePath);
        } catch (error) {
            console.error('[FNH] Lỗi máy chủ:', error);
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
        console.warn('[FNH] Không mở được trình duyệt tự động:', error.message);
    }
}

async function startServer(options) {
    const settings = Object.assign({
        gameRoot: DEFAULT_GAME_ROOT,
        port: DEFAULT_PORT,
        host: DEFAULT_HOST
    }, options || {});
    const gameRoot = findGameRoot(settings.gameRoot);
    const handler = createRequestHandler(gameRoot);
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
    console.log('  FEAR & HUNGER — bản trình duyệt cục bộ');
    console.log('  Thư mục game: ' + running.gameRoot);
    console.log('  Địa chỉ:      ' + running.url);
    console.log('');
    console.log('  Nhấn Ctrl+C để dừng máy chủ.');
    console.log('  Save nằm trong localStorage của trình duyệt (theo origin ở trên).');
    console.log('');

    if (options.open) openBrowser(running.url);

    const shutdown = function () {
        console.log('\n[FNH] Đang dừng máy chủ…');
        running.close().then(function () { process.exit(0); });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

if (require.main === module) {
    main();
}

module.exports = {
    buildIndexHtml: buildIndexHtml,
    createRequestHandler: createRequestHandler,
    findGameRoot: findGameRoot,
    isGameRoot: isGameRoot,
    startServer: startServer
};
