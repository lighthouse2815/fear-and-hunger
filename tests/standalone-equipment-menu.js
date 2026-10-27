'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    const e = new GameEngine({ dataStore: store }); await e.boot({ mapId:74,x:8,y:8,party:[1,3] });
    const initial=e.save(),db=e.database;
    async function reset() { await e.restore(initial); e.openMenu(); }
    await reset();
    assert.equal(e.clearMenuEquipment(1),true);
    assert.equal(e.state.itemCount('weapons',44),1);
    assert.equal(e.canEquipMenuActor(1,0,44),true); assert.equal(e.canEquipMenuActor(1,2,44),false);
    assert.equal(e.canChangeMenuEquipment(1,-1),false); assert.equal(e.canChangeMenuEquipment(1,5),false);
    for(const id of [-1,1.5,9999,'44']) assert.equal(e.canEquipMenuActor(1,0,id),false);
    e.equipMenuActor(1,0,44);const before=e.state.toJSON();
    assert.equal(e.equipMenuActor(1,0,44),true); assert.deepEqual(e.state.toJSON(),before,'chọn lại món đang dùng không cần một bản sao trong túi');
    const unusable=db.Weapons.find(item=>item&&!e.battle.battlerTraits({id:1}).some(t=>t.code===51&&t.dataId===item.wtypeId));
    assert.ok(unusable);e.state.gainItem('weapons',unusable.id,1);
    assert.equal(e.canEquipMenuActor(1,0,unusable.id),false);
    assert.equal(e.equipMenuActor(1,0,unusable.id),false);assert.equal(e.state.itemCount('weapons',unusable.id),1);
    e.closeMenu();assert.equal(e.optimizeMenuEquipment(1),false);assert.equal(e.clearMenuEquipment(1),false);
    e.openMenu();assert.equal(e.clearMenuEquipment(2),false,'guest/vắng đội không thao tác được');

    // Ring of the still-blood khóa chính ô phụ kiện sau khi đeo.
    await reset();e.state.gainItem('armors',28,1);
    assert.equal(e.equipMenuActor(1,4,28),true);
    assert.equal(e.canChangeMenuEquipment(1,4),false);assert.equal(e.equipMenuActor(1,4,0),false);
    e.clearMenuEquipment(1);assert.equal(e.state.actor(1).equips[4],28);assert.equal(e.state.itemCount('armors',28),0);
    e.optimizeMenuEquipment(1);assert.equal(e.state.actor(1).equips[4],28,'tối ưu không tháo vòng nguyền');
    await e.restore(e.save());assert.equal(e.canChangeMenuEquipment(1,4),false,'khóa vòng giữ qua save');

    // Crude sword hai tay seal ô Shield, trả khiên về túi đúng một lần.
    await reset();const shield=db.Armors.find(item=>item&&item.etypeId===2&&e.battle.battlerTraits({id:1}).some(t=>t.code===52&&t.dataId===item.atypeId));
    assert.ok(shield);e.state.gainItem('armors',shield.id,1);e.state.gainItem('weapons',4,1);
    assert.equal(e.equipMenuActor(1,1,shield.id),true);assert.equal(e.state.itemCount('armors',shield.id),0);
    assert.equal(e.equipMenuActor(1,0,4),true);assert.equal(e.state.actor(1).equips[1],0);
    assert.equal(e.state.itemCount('armors',shield.id),1);assert.equal(e.canChangeMenuEquipment(1,1),false);
    assert.equal(e.equipMenuActor(1,1,shield.id),false);assert.equal(e.equipMenuActor(1,0,0),true);
    assert.equal(e.canChangeMenuEquipment(1,1),true);assert.equal(e.equipMenuActor(1,1,shield.id),true);
    assert.equal(e.state.itemCount('armors',shield.id),0);

    // Đối chiếu tất cả seal/lock thật theo trait thay vì hard-code ID món đồ.
    let checked=0;
    for(const key of ['Weapons','Armors']) for(const item of db[key].filter(Boolean)) {
        const blocks=item.traits.filter(t=>[53,54].includes(t.code));if(!blocks.length)continue;
        await reset();e.state.actor(1).equips[item.etypeId-1]=item.id;
        for(const trait of blocks)assert.equal(e.canChangeMenuEquipment(1,trait.dataId-1),false,item.name);
        checked++;
    }
    assert.equal(checked,18);

    await reset();e.clearMenuEquipment(1);
    // Chọn theo tổng 8 params, hòa điểm chọn ID trước; món có điểm âm vẫn có thể được chọn.
    const template=db.Weapons[44],first=db.Weapons.length;
    db.Weapons.push({...template,id:first,name:'Kiểm thử A',traits:[],params:[0,0,10,0,0,0,0,0]});
    db.Weapons.push({...template,id:first+1,name:'Kiểm thử B',traits:[],params:[0,0,5,5,0,0,0,0]});
    e.state.inventory={items:{},weapons:{[first]:1,[first+1]:1},armors:{}};
    assert.equal(e.optimizeMenuEquipment(1),true);assert.equal(e.state.actor(1).equips[0],first);
    assert.equal(e.state.itemCount('weapons',first),0);assert.equal(e.state.itemCount('weapons',first+1),1);
    e.clearMenuEquipment(1);assert.equal(e.state.itemCount('weapons',first),1);
    assert.ok(e.state.actor(1).equips.every(id=>!id));
    console.log('ĐẠT: menu lọc loại/quyền/túi/ô khóa, chọn lại, tối ưu/tháo hết, vòng nguyền/hai tay/khiên, save và 18 món seal/lock thật.');
})().catch(error=>{console.error(error);process.exitCode=1;});
