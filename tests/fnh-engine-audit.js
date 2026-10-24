'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { auditGame } = require('../tools/fnh-engine/audit');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fnh-audit-'));
try {
    fs.mkdirSync(path.join(root, 'data'));
    fs.mkdirSync(path.join(root, 'js'));
    const write = (name, data) => fs.writeFileSync(path.join(root, 'data', name), JSON.stringify(data));
    const commands = [
        { code: 111, parameters: [0] }, { code: 122, parameters: [1, 1, 0, 2] },
        { code: 356, parameters: ['Example private-argument'] }
    ];
    write('Map001.json', { events: [null, { pages: [{ list: commands }] }] });
    write('MapInfos.json', [null, { name: 'Không phải bản đồ' }]);
    write('CommonEvents.json', [null, { list: commands }]);
    write('Troops.json', [null, { pages: [{ list: commands }, { list: [{ code: 0 }] }] }]);
    fs.writeFileSync(path.join(root, 'js/plugins.js'), '// Generated\nvar $plugins =\n' + JSON.stringify([
        { name: 'Enabled', status: true, parameters: { secret: 'private-parameter' } },
        { name: 'Disabled', status: false }
    ]) + ';\n');
    const report = auditGame(root);
    assert.equal(report.maps, 1);
    assert.equal(report.events, 1);
    assert.equal(report.mapPages, 1);
    assert.equal(report.commonEvents, 1);
    assert.equal(report.troops, 1);
    assert.equal(report.battlePages, 2);
    assert.deepEqual(report.commands.find((entry) => entry.code === 111), { code: 111, map: 1, common: 1, battle: 1 });
    assert.deepEqual(report.conditionTypes, [{ type: 0, count: 3 }]);
    assert.deepEqual(report.variableOperandTypes, [{ type: 2, count: 3 }]);
    assert.deepEqual(report.pluginCommands, [{ type: 'Example', count: 3 }]);
    assert.deepEqual(report.activePlugins, ['Enabled']);
    assert.equal(JSON.stringify(report).includes('private-'), false, 'Không xuất tham số plugin hoặc nội dung gốc');
    fs.writeFileSync(path.join(root, 'js/plugins.js'), 'throw new Error("Không được chạy mã plugin")');
    assert.throws(() => auditGame(root), /Không đọc được/);
    console.log('ĐẠT: thống kê bản đồ, common event, battle event và plugin mà không chạy mã gốc.');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
