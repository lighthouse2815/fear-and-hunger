'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../game/js/plugins/physical_attack_animation.js'), 'utf8');

function actorFor(parameters) {
    function Actor() { this.baseCalls = 0; this.weaponCalls = 0; }
    Actor.prototype.performAction = function () { this.baseCalls += 1; };
    Actor.prototype.performAttack = function () { this.weaponCalls += 1; };
    vm.runInNewContext(code, {
        Game_Actor: Actor,
        PluginManager: { parameters(name) { assert.equal(name, 'physical_attack_animation'); return parameters; } }
    });
    return new Actor();
}
function action(physical, type, override) {
    return {
        isPhysical: () => physical, isSkill: () => true,
        item: () => ({ stypeId: type, meta: override === undefined ? {} : { CCPS_weapon: override } })
    };
}
const configured = actorFor({ PhysicalAttacks: 'false', SkillTypes: '4' });
configured.performAction(action(false, 4));
assert.equal(configured.weaponCalls, 1, 'Loại kỹ năng 4 của cấu hình thật dùng hoạt ảnh vũ khí');
configured.performAction(action(true, 1));
assert.equal(configured.weaponCalls, 1, 'Tôn trọng tuỳ chọn tắt hoạt ảnh cho mọi đòn vật lý');
configured.performAction(action(true, 4, 'false'));
assert.equal(configured.weaponCalls, 1, 'Ghi chú kỹ năng có thể tắt hoạt ảnh');
configured.performAction(action(false, 1, 'true'));
assert.equal(configured.weaponCalls, 2, 'Ghi chú kỹ năng có thể bật hoạt ảnh');
assert.equal(configured.baseCalls, 4, 'Giữ hành vi performAction gốc cho mọi kỹ năng');
const defaults = actorFor({});
defaults.performAction(action(true, 1));
assert.equal(defaults.weaponCalls, 1);
const multiple = actorFor({ PhysicalAttacks: 'false', SkillTypes: '2 4 invalid 7' });
multiple.performAction(action(false, 7));
multiple.performAction(action(false, 2));
assert.equal(multiple.weaponCalls, 2, 'Đọc được nhiều loại kỹ năng và bỏ giá trị sai');
console.log('ĐẠT: hoạt ảnh vũ khí theo cấu hình thật, mặc định, loại kỹ năng và ghi chú bật/tắt.');
