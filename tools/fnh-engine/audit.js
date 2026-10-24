'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { findGameRoot } = require('./server');

function auditGame(gameRoot) {
    const dataRoot = path.join(gameRoot, 'data');
    const read = (name) => JSON.parse(fs.readFileSync(path.join(dataRoot, name), 'utf8'));
    const report = { maps: 0, events: 0, mapPages: 0, commonEvents: 0, troops: 0, battlePages: 0 };
    const commands = new Map();
    const conditions = new Map();
    const operands = new Map();
    const pluginCommands = new Map();
    function count(table, key) { table.set(key, (table.get(key) || 0) + 1); }
    function scan(list, source) {
        for (const command of list || []) {
            const code = command.code;
            const p = command.parameters || [];
            if (!commands.has(code)) commands.set(code, { code, map: 0, common: 0, battle: 0 });
            commands.get(code)[source] += 1;
            if (code === 111) count(conditions, p[0]);
            if (code === 122) count(operands, p[3]);
            if (code === 356) count(pluginCommands, String(p[0] || '').trim().split(/\s+/)[0]);
        }
    }
    for (const name of fs.readdirSync(dataRoot).filter((name) => /^Map\d+\.json$/.test(name)).sort()) {
        const map = read(name);
        report.maps += 1;
        for (const event of map.events || []) {
            if (!event) continue;
            report.events += 1;
            for (const page of event.pages || []) {
                report.mapPages += 1;
                scan(page.list, 'map');
            }
        }
    }
    for (const event of read('CommonEvents.json')) {
        if (!event) continue;
        report.commonEvents += 1;
        scan(event.list, 'common');
    }
    for (const troop of read('Troops.json')) {
        if (!troop) continue;
        report.troops += 1;
        for (const page of troop.pages || []) {
            report.battlePages += 1;
            scan(page.list, 'battle');
        }
    }
    const plugins = fs.readFileSync(path.join(gameRoot, 'js/plugins.js'), 'utf8');
    const assignment = /\bvar\s+\$plugins\s*=\s*([\s\S]*?);?\s*$/.exec(plugins);
    if (!assignment) throw new Error('Không đọc được danh sách plugin gốc');
    const pluginList = JSON.parse(assignment[1].replace(/;\s*$/, ''));
    report.activePlugins = pluginList.filter((plugin) => plugin.status).map((plugin) => plugin.name).sort();
    report.commands = [...commands.values()].sort((a, b) => a.code - b.code);
    const entries = (table) => [...table].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([type, count]) => ({ type, count }));
    report.conditionTypes = entries(conditions);
    report.variableOperandTypes = entries(operands);
    report.pluginCommands = entries(pluginCommands);
    return report;
}

function main(args) {
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
        console.log('Cách dùng: npm run audit:fnh-engine -- [--game <thư mục www>]');
        return;
    }
    if (args.length && (args.length !== 2 || args[0] !== '--game')) throw new Error('Tham số không hợp lệ');
    const gameRoot = findGameRoot(args[1]);
    if (!gameRoot) throw new Error('Không tìm thấy thư mục game gốc');
    console.log(JSON.stringify(auditGame(gameRoot), null, 2));
}

if (require.main === module) {
    try { main(process.argv.slice(2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { auditGame };
