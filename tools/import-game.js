'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { buildWeb } = require('../game/build');
const { findGameRoot, isGameRoot } = require('../game/server');

const REPO_ROOT = path.resolve(__dirname, '..');

async function createProject(options = {}) {
    const output = path.resolve(options.output || path.join(REPO_ROOT, 'game'));
    try {
        await fs.lstat(output);
        throw new Error('Dự án đã tồn tại; không nhập đè code hoặc asset bạn đang sửa: ' + output);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const bundle = path.join(REPO_ROOT, 'dist/fear-and-hunger-web');
    const hint = options.gameRoot || (isGameRoot(bundle) ? bundle : undefined);
    if (options.gameRoot && !isGameRoot(path.resolve(hint)) && !isGameRoot(path.resolve(hint, 'www'))) {
        throw new Error('Nguồn không phải thư mục game hợp lệ: ' + hint);
    }
    const source = findGameRoot(hint);
    await fs.mkdir(path.dirname(output), { recursive: true });
    const temporary = await fs.mkdtemp(path.join(path.dirname(output), '.fnh-source-'));
    const staging = path.join(temporary, 'game');
    try {
        const built = await buildWeb({ gameRoot: source, output: staging, onProgress: options.onProgress });
        const systemFile = path.join(staging, 'data/System.json');
        const system = JSON.parse(await fs.readFile(systemFile, 'utf8'));
        const converted = { images: 0, audio: 0 };
        // Dùng đúng Decrypter đi kèm runtime MV, không chạy engine hay plugin.
        const core = await fs.readFile(path.join(staging, 'js/rpg_core.js'), 'utf8');
        const start = core.indexOf('function Decrypter()');
        const end = core.indexOf('function ResourceHandler()', start);
        let decrypter;
        if (system.hasEncryptedImages || system.hasEncryptedAudio) {
            if (start < 0 || end <= start) throw new Error('Không tìm thấy Decrypter của RPG Maker MV để xuất asset.');
            const context = { $dataSystem: system };
            vm.runInNewContext(core.slice(start, end), context, { timeout: 1000 });
            decrypter = context.Decrypter;
        }
        async function convert(directory) {
            for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
                const filename = path.join(directory, entry.name);
                if (entry.isDirectory()) { await convert(filename); continue; }
                const extension = path.extname(entry.name).toLowerCase();
                const target = { '.rpgmvp': '.png', '.rpgmvo': '.ogg', '.rpgmvm': '.m4a' }[extension];
                if (!target) continue;
                if (!decrypter) throw new Error('Asset còn mã hoá nhưng cấu hình nguồn không cung cấp bộ giải mã: ' + filename);
                const input = await fs.readFile(filename);
                const bytes = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
                let decoded = Buffer.from(decrypter.decryptArrayBuffer(bytes));
                if (target === '.png' && decoded.subarray(0, 4).toString() === '8BPS') {
                    // Bản cài có một PSD mang đuôi RPGMVP; giữ PSD và xuất ảnh gộp PNG.
                    const psd = filename.slice(0, -extension.length) + '.psd';
                    await fs.writeFile(psd, decoded, { flag: 'wx' });
                    const preview = psd + '.png';
                    try { await promisify(execFile)('magick', [psd + '[0]', preview]); }
                    catch (error) { throw new Error('Cần ImageMagick (magick) để xuất ảnh PSD: ' + entry.name + '. ' + error.message); }
                    decoded = await fs.readFile(preview);
                    await fs.unlink(preview);
                }
                const valid = target === '.png' ? decoded.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
                    : target === '.ogg' ? decoded.subarray(0, 4).toString() === 'OggS'
                        : decoded.subarray(4, 8).toString() === 'ftyp';
                if (!valid) throw new Error('Asset xuất ra không đúng định dạng: ' + filename);
                const plain = filename.slice(0, -extension.length) + target;
                try { await fs.writeFile(plain, decoded, { flag: 'wx' }); }
                catch (error) {
                    if (error.code !== 'EEXIST' || !(await fs.readFile(plain)).equals(decoded)) throw error;
                }
                await fs.unlink(filename);
                converted[target === '.png' ? 'images' : 'audio'] += 1;
            }
        }
        await convert(path.join(staging, 'img'));
        await convert(path.join(staging, 'audio'));
        system.hasEncryptedImages = false;
        system.hasEncryptedAudio = false;
        system.encryptionKey = '';
        await fs.writeFile(systemFile, JSON.stringify(system) + '\n');
        await fs.copyFile(path.join(REPO_ROOT, 'game/build.js'), path.join(staging, 'build.js'));
        await fs.copyFile(path.join(REPO_ROOT, 'game/check.js'), path.join(staging, 'check.js'));
        await fs.cp(path.join(REPO_ROOT, 'game/engine'), path.join(staging, 'engine'), { recursive: true });
        await fs.copyFile(path.join(REPO_ROOT, 'game/README.md'), path.join(staging, 'README.md'));
        await fs.copyFile(path.join(REPO_ROOT, 'game/NOTICE.md'), path.join(staging, 'NOTICE.md'));
        await fs.unlink(path.join(staging, 'web-build.json'));
        await fs.writeFile(path.join(staging, 'package.json'), JSON.stringify({
            name: 'fear-and-hunger-source', private: true, version: '1.0.0',
            scripts: {
                start: 'node server.js --port 8140 --open',
                dev: 'node server.js --port 8140 --open',
                check: 'node check.js .',
                build: 'node build.js --game . --out ../dist/fear-and-hunger-web'
            }, engines: { node: '>=18' }
        }, null, 2) + '\n');
        await fs.writeFile(path.join(staging, 'source-info.json'), JSON.stringify({
            format: 'fear-and-hunger-source', version: 1, engine: 'RPG Maker MV',
            originalGame: 'Fear & Hunger 1.4.1', maps: built.maps, converted,
            authorship: 'Mã engine, plugin và nội dung nhập giữ nguồn gốc tác giả; mã chỉnh sửa được quản lý trong dự án này.'
        }, null, 2) + '\n');
        await fs.rename(staging, output);
        return { output, maps: built.maps, converted };
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

async function main() {
    const options = { onProgress: name => console.log('Đang nhập: ' + name) };
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--game' || args[i] === '--out') {
            if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Thiếu giá trị cho ' + args[i]);
            options[args[i] === '--game' ? 'gameRoot' : 'output'] = args[++i];
        } else if (args[i] === '--help') {
            console.log('Cách dùng: node tools/import-game.js [--game thư_mục_www] [--out thư_mục_dự_án]');
            return;
        } else throw new Error('Tuỳ chọn không hợp lệ: ' + args[i]);
    }
    const result = await createProject(options);
    console.log('Đã tạo dự án: ' + result.output);
    console.log(result.maps + ' map; xuất ' + result.converted.images + ' PNG và ' + result.converted.audio + ' tệp âm thanh.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createProject };
