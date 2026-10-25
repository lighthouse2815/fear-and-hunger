'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createProject } = require('../tools/fnh-browser/project');
const { buildWeb } = require('../tools/fnh-browser/build');
const { checkProject } = require('../tools/fnh-browser/check-project');

(async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'fnh-source-test-'));
    const source = path.join(temporary, 'original'), output = path.join(temporary, 'project');
    const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    function encrypt(plain) {
        const header = Buffer.from('5250474d56000000' + '000301' + '0000000000', 'hex');
        const encrypted = Buffer.concat([header, plain]);
        for (let i = 0; i < 16; i += 1) encrypted[16 + i] ^= key[i];
        return encrypted;
    }
    try {
        for (const directory of ['js', 'data', 'img', 'audio', 'fonts', 'icon', 'movies']) {
            await fs.mkdir(path.join(source, directory), { recursive: true });
        }
        await fs.writeFile(path.join(source, 'index.html'), '<body><script src="js/plugins.js"></script><script src="js/main.js"></script></body>');
        // Dùng bộ giải mã thật của runtime đã nhập, không thay bằng bản mô phỏng.
        await fs.copyFile(path.join(__dirname, '../game/js/rpg_core.js'), path.join(source, 'js/rpg_core.js'));
        await fs.writeFile(path.join(source, 'js/rpg_managers.js'), '/* fixture */');
        await fs.writeFile(path.join(source, 'js/rpg_objects.js'), 'window.damage = 10;');
        await fs.writeFile(path.join(source, 'data/System.json'), JSON.stringify({
            gameTitle: 'Fixture', hasEncryptedImages: true, hasEncryptedAudio: true, encryptionKey: key.toString('hex')
        }));
        await fs.writeFile(path.join(source, 'data/Map001.json'), '{"note":"original"}');
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0xkAAAAASUVORK5CYII=', 'base64');
        const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32)]);
        await fs.writeFile(path.join(source, 'img/sprite.rpgmvp'), encrypt(png));
        await fs.writeFile(path.join(source, 'audio/music.rpgmvo'), encrypt(ogg));
        const result = await createProject({ gameRoot: source, output });
        assert.deepEqual(result.converted, { images: 1, audio: 1 });
        assert.deepEqual(await fs.readFile(path.join(output, 'img/sprite.png')), png);
        assert.deepEqual(await fs.readFile(path.join(output, 'audio/music.ogg')), ogg);
        await assert.rejects(fs.access(path.join(output, 'img/sprite.rpgmvp')), { code: 'ENOENT' });
        const system = JSON.parse(await fs.readFile(path.join(output, 'data/System.json')));
        assert.equal(system.hasEncryptedImages, false);
        assert.equal(system.hasEncryptedAudio, false);
        assert.equal(JSON.parse(await fs.readFile(path.join(source, 'data/System.json'))).hasEncryptedImages, true);
        assert.deepEqual(await fs.readFile(path.join(source, 'img/sprite.rpgmvp')), encrypt(png));
        await checkProject(output);
        // Sửa logic, map, ảnh và compat trong dự án rồi build, không dùng lại nguồn gốc.
        await fs.writeFile(path.join(output, 'js/rpg_objects.js'), 'window.damage = 77;');
        await fs.writeFile(path.join(output, 'data/Map001.json'), '{"note":"edited"}');
        const changedPng = Buffer.concat([png, Buffer.from('modified-asset')]);
        await fs.writeFile(path.join(output, 'img/sprite.png'), changedPng);
        await fs.appendFile(path.join(output, '__fnh/compat.js'), '\n// edited-project-compat\n');
        await assert.rejects(createProject({ gameRoot: source, output }), /không nhập đè/);
        await fs.rm(source, { recursive: true });
        const moved = path.join(temporary, 'moved-project');
        await fs.rename(output, moved);
        const release = path.join(temporary, 'release');
        await promisify(execFile)(process.execPath, [path.join(moved, 'build.js'), '--game', moved, '--out', release]);
        assert.equal(await fs.readFile(path.join(release, 'js/rpg_objects.js'), 'utf8'), 'window.damage = 77;');
        assert.equal(JSON.parse(await fs.readFile(path.join(release, 'data/Map001.json'))).note, 'edited');
        assert.deepEqual(await fs.readFile(path.join(release, 'img/sprite.png')), changedPng);
        assert.ok((await fs.readFile(path.join(release, '__fnh/compat.js'), 'utf8')).includes('edited-project-compat'));
        await buildWeb({ gameRoot: moved, output: release });
        assert.equal(await fs.readFile(path.join(moved, 'js/rpg_objects.js'), 'utf8'), 'window.damage = 77;');
        await fs.writeFile(path.join(moved, 'data/broken.json'), '{');
        await assert.rejects(checkProject(moved), /broken\.json/);
        console.log('ĐẠT: nhập code/asset, giải mã thật, bảo vệ nguồn, sửa logic/map/ảnh, chuyển thư mục và build khi không còn game gốc.');
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
