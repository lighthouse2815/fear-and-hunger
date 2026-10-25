'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

async function checkProject(root) {
    let scripts = 0, data = 0;
    async function walk(directory) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) await walk(filename);
            else if (entry.name.endsWith('.js')) {
                new vm.Script(await fs.readFile(filename, 'utf8'), { filename });
                scripts += 1;
            } else if (entry.name.endsWith('.json')) {
                try { JSON.parse(await fs.readFile(filename, 'utf8')); }
                catch (error) { throw new Error(filename + ': ' + error.message); }
                data += 1;
            }
        }
    }
    for (const directory of ['js', 'data', '__fnh']) await walk(path.join(root, directory));
    for (const directory of ['img', 'audio', 'fonts']) await fs.access(path.join(root, directory));
    return { scripts, data };
}

if (require.main === module) checkProject(path.resolve(process.argv[2] || '.'))
    .then(result => console.log('ĐẠT: ' + result.scripts + ' tệp JavaScript, ' + result.data + ' tệp dữ liệu JSON.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { checkProject };
