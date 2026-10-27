'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { buildWeb } = require('../game/build');

(async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'fnh-web-build-test-'));
    const source = path.join(temporary, 'source'), output = path.join(temporary, 'package');
    let running;
    try {
        for (const name of ['audio', 'data', 'fonts', 'icon', 'img', 'js', 'movies', 'save']) {
            await fs.mkdir(path.join(source, name), { recursive: true });
        }
        const original = '<body><script src="js/plugins.js"></script><script src="js/main.js"></script></body>';
        await fs.writeFile(path.join(source, 'index.html'), original);
        await fs.writeFile(path.join(source, 'js/rpg_core.js'), '/* fixture runtime */');
        await fs.writeFile(path.join(source, 'js/rpg_managers.js'), '/* fixture manager */');
        await fs.writeFile(path.join(source, 'js/native.node'), 'excluded');
        await fs.writeFile(path.join(source, 'data/System.json'), JSON.stringify({ gameTitle: 'Fixture' }));
        await fs.writeFile(path.join(source, 'data/Map001.json'), '{}');
        const binary = Buffer.from([0, 255, 19, 88, 121]);
        await fs.writeFile(path.join(source, 'img/encrypted.rpgmvp'), binary);
        await fs.writeFile(path.join(source, 'audio/encrypted.rpgmvo'), binary);
        await fs.writeFile(path.join(source, 'save/file1.rpgsave'), 'private-save');
        const built = await buildWeb({ gameRoot: source, output });
        assert.equal(built.maps, 1);
        const html = await fs.readFile(path.join(output, 'index.html'), 'utf8');
        assert.ok(html.includes('src="./__fnh/compat.js"'), 'Compat dùng đường dẫn tương đối để hỗ trợ host dưới thư mục con');
        assert.ok(html.indexOf('js/plugins.js') < html.indexOf('./__fnh/compat.js'));
        assert.ok(html.indexOf('./__fnh/compat.js') < html.indexOf('js/main.js'));
        assert.deepEqual(await fs.readFile(path.join(output, 'img/encrypted.rpgmvp')), binary);
        assert.deepEqual(await fs.readFile(path.join(output, 'audio/encrypted.rpgmvo')), binary);
        assert.equal(await fs.readFile(path.join(source, 'index.html'), 'utf8'), original, 'Không sửa game nguồn');
        await assert.rejects(fs.access(path.join(output, 'save')), { code: 'ENOENT' });
        await assert.rejects(fs.access(path.join(output, 'js/native.node')), { code: 'ENOENT' });
        await buildWeb({ gameRoot: source, output });
        const rebuilt = await fs.readFile(path.join(output, 'index.html'), 'utf8');
        assert.equal((rebuilt.match(/src="\.\/__fnh\/compat\.js"/g) || []).length, 1, 'Build lại không chèn compat trùng');
        const unsafe = path.join(temporary, 'existing');
        await fs.mkdir(unsafe);
        await fs.writeFile(path.join(unsafe, 'keep.txt'), 'keep');
        await assert.rejects(buildWeb({ gameRoot: source, output: unsafe }), /không phải gói web/);
        assert.equal(await fs.readFile(path.join(unsafe, 'keep.txt'), 'utf8'), 'keep');
        await assert.rejects(buildWeb({ gameRoot: source, output: path.join(source, 'nested') }), /tách biệt/);
        await fs.symlink(path.join(source, 'img/encrypted.rpgmvp'), path.join(source, 'img/link.rpgmvp'));
        await assert.rejects(buildWeb({ gameRoot: source, output }), /symlink/);
        assert.equal(await fs.readFile(path.join(output, 'index.html'), 'utf8'), rebuilt, 'Build lỗi giữ nguyên gói đang chạy');
        await fs.unlink(path.join(source, 'img/link.rpgmvp'));
        await fs.mkdir(path.join(source, 'engine'));
        await fs.writeFile(path.join(source, 'engine/game-engine.js'), '/* engine độc lập */');
        await fs.writeFile(path.join(source, 'standalone.html'), '<body>engine</body>');
        await fs.writeFile(path.join(source, 'legacy.html'), original);
        const independent = '<body><script>location.replace("./standalone.html?title=1")</script></body>';
        await fs.writeFile(path.join(source, 'index.html'), independent);
        await fs.unlink(path.join(source, 'js/rpg_core.js'));
        await fs.unlink(path.join(source, 'js/rpg_managers.js'));
        const independentOutput = path.join(temporary, 'independent');
        await buildWeb({ gameRoot: source, output: independentOutput });
        const independentServer = require(path.join(independentOutput, 'server.js'));
        assert.equal(independentServer.findGameRoot(), independentOutput, 'engine độc lập không cần runtime cũ');
        const independentRunning = await independentServer.startServer({ port: 0 });
        try {
            assert.equal(await (await fetch(independentRunning.url)).text(), independent, 'không chèn compat vào entry độc lập');
            assert.equal(await (await fetch(independentRunning.url + 'legacy.html')).text(), original);
        } finally { independentRunning.server.closeAllConnections(); await independentRunning.close(); }
        await fs.rm(source, { recursive: true });
        const packagedServer = require(path.join(output, 'server.js'));
        assert.equal(packagedServer.findGameRoot(), output, 'Máy chủ gói tự tìm tài nguyên mà không có game nguồn');
        running = await packagedServer.startServer({ port: 0 });
        const response = await fetch(running.url);
        assert.equal(response.status, 200);
        assert.equal(await response.text(), rebuilt);
        assert.equal((await fetch(running.url + '__fnh/compat.js')).status, 200);
        assert.deepEqual(Buffer.from(await (await fetch(running.url + 'img/encrypted.rpgmvp')).arrayBuffer()), binary);
        const range = await fetch(running.url + 'audio/encrypted.rpgmvo', { headers: { Range: 'bytes=1-3' } });
        assert.equal(range.status, 206);
        assert.deepEqual(Buffer.from(await range.arrayBuffer()), binary.subarray(1, 4));
        assert.equal((await (await fetch(running.url + '__fnh/health')).json()).gameRoot, output);
        console.log('ĐẠT: đóng gói độc lập, giữ asset/âm thanh, đường dẫn tương đối, build lại, bảo vệ dữ liệu và chạy khi thiếu nguồn.');
    } finally {
        if (running) { running.server.closeAllConnections(); await running.close(); }
        await fs.rm(temporary, { recursive: true, force: true });
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
