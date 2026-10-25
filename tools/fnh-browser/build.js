'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { buildIndexHtml, findGameRoot } = require('./server');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CONTENT = ['index.html', 'audio', 'data', 'fonts', 'icon', 'img', 'js', 'movies'];
const MARKER = 'web-build.json';
const FORMAT = 'fear-and-hunger-web';

function inside(directory, parent) {
    const relative = path.relative(parent, directory);
    return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function buildWeb(options = {}) {
    const source = await fs.realpath(findGameRoot(options.gameRoot));
    const requested = path.resolve(options.output || path.join(REPO_ROOT, 'dist/fear-and-hunger-web'));
    await fs.mkdir(path.dirname(requested), { recursive: true });
    const output = path.join(await fs.realpath(path.dirname(requested)), path.basename(requested));
    if (inside(output, source) || inside(source, output) || inside(REPO_ROOT, output)) {
        throw new Error('Thư mục xuất phải tách biệt với game nguồn và không được chứa repository.');
    }
    let existing = false;
    try {
        const info = await fs.lstat(output);
        if (info.isSymbolicLink()) throw new Error('Không ghi đè thư mục xuất là symlink.');
        let marker;
        try { marker = JSON.parse(await fs.readFile(path.join(output, MARKER), 'utf8')); } catch (error) {}
        if (marker?.format !== FORMAT) throw new Error('Thư mục xuất đã tồn tại và không phải gói web do công cụ tạo. Hãy chọn --out khác.');
        existing = true;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const staging = await fs.mkdtemp(path.join(path.dirname(output), '.fnh-web-build-'));
    let files = 0, bytes = 0;
    try {
        for (const entry of CONTENT) {
            if (options.onProgress) options.onProgress(entry);
            const sourcePath = path.join(source, entry);
            try { await fs.access(sourcePath); } catch (error) {
                if (entry === 'icon' || entry === 'movies') continue;
                throw new Error('Thiếu tài nguyên nguồn: ' + entry);
            }
            await fs.cp(sourcePath, path.join(staging, entry), {
                recursive: true,
                filter: async (filename) => {
                    const stat = await fs.lstat(filename);
                    if (stat.isSymbolicLink()) throw new Error('Không đóng gói symlink: ' + path.relative(source, filename));
                    if (/\.(?:node|dll|so|dylib)$/i.test(filename) || path.basename(filename) === '.DS_Store') return false;
                    if (stat.isFile()) { files += 1; bytes += stat.size; }
                    return true;
                }
            });
        }
        const html = await fs.readFile(path.join(staging, 'index.html'), 'utf8');
        await fs.writeFile(path.join(staging, 'index.html'), buildIndexHtml(html, './__fnh/compat.js'));
        await fs.mkdir(path.join(staging, '__fnh'));
        await fs.copyFile(path.join(__dirname, 'compat.js'), path.join(staging, '__fnh/compat.js'));
        await fs.copyFile(path.join(__dirname, 'server.js'), path.join(staging, 'server.js'));
        await fs.writeFile(path.join(staging, 'package.json'), JSON.stringify({
            name: 'fear-and-hunger-web', private: true, version: '1.4.1',
            scripts: { start: 'node server.js --port 8140 --open' }, engines: { node: '>=18' }
        }, null, 2) + '\n');
        const maps = (await fs.readdir(path.join(staging, 'data'))).filter((name) => /^Map\d+\.json$/.test(name)).length;
        const manifest = { format: FORMAT, version: 1, gameVersion: '1.4.1', sourceFiles: files, sourceBytes: bytes, maps };
        await fs.writeFile(path.join(staging, MARKER), JSON.stringify(manifest, null, 2) + '\n');
        await fs.writeFile(path.join(staging, 'README.md'), `# Fear & Hunger — bản web độc lập\n\nGói này chứa tài nguyên và mã chạy từ bản game bạn sở hữu.\nKhông cần thư mục cài game gốc sau khi đã đóng gói.\n\n## Chạy\n\nCài Node.js 18+ rồi chạy trong thư mục này:\n\n\`\`\`sh\nnpm start\n\`\`\`\n\nKhông cần npm install. Mở http://127.0.0.1:8140 để vào thẳng menu.\nÂm thanh mở khi bấm phím hoặc chuột lần đầu trong game.\nCó thể phục vụ nguyên thư mục này bằng máy chủ tĩnh khác, kể cả dưới một đường dẫn con.\nTrình duyệt cần HTTP(S); mở trực tiếp index.html bằng file:// không hỗ trợ tải dữ liệu game.\n\n## Nội dung và lưu game\n\nCó ${maps} bản đồ cùng hình, âm thanh, phim, dữ liệu, runtime RPG Maker MV và plugin gốc.\nSteamworks không chạy trong trình duyệt. Save dùng localStorage, giữ nguyên địa chỉ/cổng\nđể tiếp tục save; save của engine tự viết ở cổng 8139 không tương thích.\n\nTài nguyên và mã game vẫn thuộc chủ sở hữu gốc; gói này không thay đổi quyền phân phối.\n`);
        // Chỉ thay gói cũ sau khi bản mới đã được tạo xong; lỗi copy giữ gói cũ nguyên vẹn.
        let backup;
        if (existing) {
            backup = staging + '-previous';
            await fs.rename(output, backup);
        }
        try { await fs.rename(staging, output); } catch (error) {
            if (backup) await fs.rename(backup, output);
            throw error;
        }
        if (backup) await fs.rm(backup, { recursive: true, force: true });
        return { output, ...manifest };
    } finally {
        await fs.rm(staging, { recursive: true, force: true });
    }
}

async function main() {
    const options = { onProgress: (entry) => console.log('Đang đóng gói: ' + entry) };
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--game' || args[i] === '--out') {
            const key = args[i] === '--game' ? 'gameRoot' : 'output';
            if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Thiếu giá trị cho ' + args[i]);
            options[key] = args[++i];
        } else if (args[i] === '--help') {
            console.log('Cách dùng: node tools/fnh-browser/build.js [--game thư_mục_www] [--out thư_mục_xuất]');
            return;
        } else throw new Error('Tuỳ chọn không hợp lệ: ' + args[i]);
    }
    const result = await buildWeb(options);
    console.log('Đã đóng gói ' + result.maps + ' bản đồ, ' + result.sourceFiles + ' tệp.');
    console.log('Thư mục: ' + result.output);
    console.log('Chạy: cd "' + result.output + '" && npm start');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildWeb };
