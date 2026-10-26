'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

async function checkProject(root) {
    let scripts = 0, data = 0, maps = 0, transfers = 0, audioCommands = 0, pictureCommands = 0;
    const dataRoot = path.join(root, 'data');
    const mapFiles = new Set((await fs.readdir(dataRoot)).filter(name => /^Map\d+\.json$/.test(name)));
    async function asset(directory, name, extension, source) {
        if (!name || /\\/.test(name)) return;
        const filename = path.join(root, directory, name + extension);
        try { await fs.access(filename); }
        catch (error) { throw new Error(source + ': thiếu tài nguyên ' + directory + '/' + name + extension); }
    }
    async function scan(list, source) {
        for (const command of list || []) {
            const p = command.parameters || [];
            if (command.code === 201 && p[0] === 0) {
                transfers += 1;
                const target = 'Map' + String(p[1]).padStart(3, '0') + '.json';
                if (!mapFiles.has(target)) throw new Error(source + ': cửa dẫn tới bản đồ không tồn tại ' + target);
            }
            const folder = { 241: 'bgm', 245: 'bgs', 249: 'me', 250: 'se' }[command.code];
            if (folder) {
                audioCommands += 1;
                await asset('audio/' + folder, p[0] && p[0].name, '.ogg', source);
            }
            if (command.code === 231) {
                pictureCommands += 1;
                await asset('img/pictures', p[1], '.png', source);
            }
        }
    }
    async function walk(directory) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) await walk(filename);
            else if (entry.name.endsWith('.js')) {
                new vm.Script(await fs.readFile(filename, 'utf8'), { filename });
                scripts += 1;
            } else if (entry.name.endsWith('.json')) {
                let value;
                try { value = JSON.parse(await fs.readFile(filename, 'utf8')); }
                catch (error) { throw new Error(filename + ': ' + error.message); }
                data += 1;
                if (mapFiles.has(entry.name)) {
                    maps += 1;
                    for (const event of value.events || []) if (event) {
                        for (const page of event.pages || []) await scan(page.list, entry.name + ': sự kiện ' + event.id);
                    }
                } else if (entry.name === 'CommonEvents.json') {
                    for (const event of value) if (event) await scan(event.list, 'Sự kiện chung ' + event.id);
                } else if (entry.name === 'Troops.json') {
                    for (const troop of value) if (troop) {
                        for (const page of troop.pages || []) await scan(page.list, 'Trận ' + troop.id);
                    }
                }
            }
        }
    }
    for (const name of ['server.js', 'build.js', 'check.js']) {
        const filename = path.join(root, name);
        new vm.Script(await fs.readFile(filename, 'utf8'), { filename });
        scripts += 1;
    }
    for (const directory of ['js', 'data', '__fnh', 'engine']) {
        try { await walk(path.join(root, directory)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const directory of ['img', 'audio', 'fonts']) await fs.access(path.join(root, directory));
    return { scripts, data, maps, transfers, audioCommands, pictureCommands };
}

if (require.main === module) checkProject(path.resolve(process.argv[2] || '.'))
    .then(result => console.log('ĐẠT: ' + result.scripts + ' JavaScript, ' + result.data + ' JSON, ' + result.maps + ' map, ' + result.transfers + ' cửa, ' + result.audioCommands + ' lệnh âm thanh, ' + result.pictureCommands + ' lệnh ảnh.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { checkProject };
