'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const { SaveStore } = require('../game/engine/save-store');
const flush = () => new Promise(resolve => setImmediate(resolve));
const watchdog = setTimeout(() => { console.error('Menu chưa kết thúc trong thời hạn kiểm thử.'); process.exit(1); }, 15000);
(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const engine = new GameEngine({ dataStore: store, random: () => 0.75, onRouteEffect: () => true });
    await engine.boot({ mapId: 74, x: 8, y: 8, party: [1, 3] });
    const storage = new Map(), saves = new SaveStore({ storage: { getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value) } });
    engine.state.menuEnabled = false; assert.equal(engine.openMenu(), false);
    engine.state.menuEnabled = true; engine.eventRunning = true; assert.equal(engine.openMenu(), false);
    engine.eventRunning = false; assert.equal(engine.openMenu(), true);
    assert.equal(engine.move(2), false); assert.equal(await engine.interact(), null);
    engine.state.timer = { active: true, frames: 60 }; engine.advanceRoutes(10);
    assert.equal(engine.state.timer.frames, 60, 'menu tạm dừng thế giới và timer');
    assert.equal(engine.equipMenuActor(1, 0, 0), true);
    assert.equal(engine.state.itemCount('weapons', 44), 1);
    assert.equal(engine.equipMenuActor(1, 0, 44), true);
    assert.equal(engine.state.itemCount('weapons', 44), 0);
    assert.equal(engine.equipMenuActor(1, 2, 44), false, 'không đưa vũ khí vào ô giáp');
    const wrong = engine.database.Weapons.find(item => item && !engine.battle.battlerTraits({ id: 1 }).some(trait => trait.code === 51 && trait.dataId === item.wtypeId));
    if (wrong) { engine.state.gainItem('weapons', wrong.id, 1); assert.equal(engine.equipMenuActor(1, 0, wrong.id), false); }
    engine.saveMenuTo(saves, 1); assert.equal(saves.load(1).scene, 'map'); assert.equal(engine.state.scene, 'menu');
    engine.state.saveEnabled = false; assert.throws(() => engine.saveMenuTo(saves, 1), /Chưa thể lưu/); engine.state.saveEnabled = true;
    engine.closeMenu(); assert.equal(engine.state.scene, 'map');
    for (const code of [351, 352]) {
        engine.state.setSwitch(6230, false);
        const running = engine.createInterpreter([{ code }, { code: 121, parameters: [6230, 6230, 0] }], 0).run();
        await flush(); assert.equal(engine.state.scene, code === 351 ? 'menu' : 'save');
        assert.equal(engine.state.switchValue(6230), false, 'event chờ đóng menu');
        engine.closeMenu(); await running; assert.equal(engine.state.switchValue(6230), true);
    }
    // Lưu giữa common event phải tiếp tục cả common event và vòng lặp của event gọi.
    const commonId = engine.database.CommonEvents.length;
    engine.database.CommonEvents.push({ id: commonId, list: [
        { code: 122, parameters: [6250, 6250, 1, 0, 1] }, { code: 352 },
        { code: 122, parameters: [6251, 6251, 1, 0, 1] }
    ] });
    const original = engine.createInterpreter([
        { code: 112, indent: 0 }, { code: 111, indent: 1, parameters: [0, 6230, 0] },
        { code: 117, indent: 2, parameters: [commonId] }, { code: 412, indent: 1 },
        { code: 113, indent: 1 }, { code: 413, indent: 0 }, { code: 121, parameters: [6252, 6252, 0] }
    ], 39).run();
    await flush(); engine.saveMenuTo(saves, 2);
    assert.equal(saves.load(2).pendingEventStack.length, 2);
    engine.closeMenu(); await original;
    await engine.loadFrom(saves, 2);
    assert.equal(engine.state.variableValue(6250), 1, 'không chạy lại phần trước lệnh lưu');
    assert.equal(engine.state.variableValue(6251), 1, 'chạy tiếp common event đúng một lần');
    assert.equal(engine.state.switchValue(6252), true, 'tiếp tục vòng lặp và event cha');
    assert.equal(engine.state.pendingEventStack.length, 0); assert.equal(engine.eventRunning, false);
    const controller = new AbortController();
    const cancelled = engine.createInterpreter([{ code: 351 }, { code: 121, parameters: [6231, 6231, 0] }], 0, {}, controller.signal).run();
    const rejected = assert.rejects(cancelled, { name: 'AbortError' }); await flush(); controller.abort(); await rejected;
    assert.equal(engine.state.scene, 'map'); assert.equal(engine.state.switchValue(6231), false); assert.equal(engine.menuWaiters.size, 0);
    engine.state.gainItem('items', 28, 2); engine.state.changeActorHp(3, -50, true);
    engine.openMenu(); assert.equal(engine.canUseMenuItem(28, 3), true);
    const hp = engine.state.actor(3).hp;
    const using = engine.useMenuItem(28, 3); await assert.rejects(engine.useMenuItem(28, 3), /Chưa thể dùng/); await using;
    assert.equal(engine.state.actor(3).hp, hp + 20);
    assert.equal(engine.state.itemCount('items', 28), 1); assert.equal(engine.state.itemCount('items', 9), 1, 'common event trả vỏ chai thật');
    engine.state.changeActorState(3, 17, true); engine.state.gainItem('items', 52, 1);
    engine.openMenu(); await engine.useMenuItem(52, 3); assert.equal(engine.state.actor(3).states.includes(17), false);
    engine.state.gainItem('items', 102, 1); engine.openMenu(); await engine.useMenuItem(102, 3);
    assert.equal(engine.state.actor(3).skills.includes(70), true, 'scroll dạy kỹ năng đúng nhân vật được chọn');
    engine.state.gainItem('items', 10, 1); engine.openMenu();
    assert.equal(engine.canUseMenuItem(10, 1), false, 'vật phẩm chỉ dùng trong trận không dùng từ menu');
    engine.state.changeActorState(3, 1, true); assert.equal(engine.canUseMenuItem(28, 3), false);
    engine.closeMenu(); await engine.loadFrom(saves, 1); assert.equal(engine.state.scene, 'map');
    // Book of enlightenment thật: save giữa common event 22 rồi tải và dọn hiệu ứng.
    const handlers = { message: () => {}, effect: code => code === 250 };
    engine.state.gainItem('items', 40, 1); engine.openMenu();
    let bookDone = false, bookFailure;
    const book = engine.useMenuItem(40, 1, handlers).then(() => { bookDone = true; }, error => { bookDone = true; bookFailure = error; });
    let savedBook = false;
    for (let i = 0; i < 1000 && !bookDone; i++) {
        engine.advanceRoutes(16); await flush();
        if (engine.state.scene === 'save') { engine.saveMenuTo(saves, 3); savedBook = true; engine.closeMenu(); }
    }
    await book; if (bookFailure) throw bookFailure;
    assert.equal(savedBook, true); assert.equal(engine.state.switchValue(3350), false);
    let loadedBook = false;
    const loadingBook = engine.loadFrom(saves, 3, handlers).then(() => { loadedBook = true; });
    for (let i = 0; i < 1000 && !loadedBook; i++) { engine.advanceRoutes(16); await flush(); }
    await loadingBook;
    assert.equal(engine.state.switchValue(3350), false); assert.equal(engine.state.screen.pictures[1], undefined);
    assert.equal(engine.state.itemCount('items', 40), 0, 'tải save không dùng sách lần nữa');
    // Kỹ năng chưa học/thiếu tài nguyên bị từ chối trước khi tiêu lượt.
    const troopId = engine.database.Troops.length;
    const enemyId = engine.database.Enemies.length;
    engine.database.Enemies.push({ ...engine.database.Enemies[1], id: enemyId, actions: [] });
    engine.database.Troops.push({ id: troopId, pages: [], members: [{ enemyId, x: 408, y: 400, hidden: false }] });
    engine.battle.setup(troopId, true, true); engine.state.scene = 'battle';
    await assert.rejects(engine.battleSkill(1, 151, 0), /chưa học/); assert.equal(engine.battle.battle.turn, 0);
    engine.state.changeActorSkill(1, 151, true); engine.state.actor(1).mp = 0;
    await assert.rejects(engine.battleSkill(1, 151, 0), /Chưa thể dùng/); assert.equal(engine.battle.battle.turn, 0);
    assert.equal(engine.openMenu(), false);
    engine.state.recoverActor(1); engine.state.changeActorHp(1, -50, true); engine.battle.syncActors();
    let finished = false, failure;
    const cast = engine.battleSkill(1, 151, 0).then(() => { finished = true; }, error => { finished = true; failure = error; });
    for (let i = 0; i < 1000 && !finished; i++) { engine.advanceRoutes(16); await flush(); }
    await cast; if (failure) throw failure;
    assert.equal(finished, true); assert.ok(engine.state.actor(1).hp > 50, 'dùng kỹ năng hồi máu lên đồng đội');
    assert.equal(engine.returnMenuToTitle(),false,'không dùng lệnh menu kết thúc khi đang đánh');
    engine.battle.finish('escape');engine.leaveBattle('escape');engine.openMenu();
    engine.buttons.add('right');assert.equal(engine.returnMenuToTitle(),true);
    assert.equal(engine.state.scene,'title');assert.equal(engine.buttons.size,0);
    engine.state.scene='map';engine.state.setSwitch(6235,false);
    const fromEvent=engine.createInterpreter([{code:351},{code:121,parameters:[6235,6235,0]}],0).run();
    await flush();assert.equal(engine.state.scene,'menu');engine.returnMenuToTitle();
    const titleResult=await fromEvent;assert.equal(titleResult.terminated,'title');
    assert.equal(engine.state.switchValue(6235),false,'về title dừng event gọi 351 và giải phóng wait');
    assert.equal(engine.menuWaiters.size,0);assert.equal(engine.menuInterpreter,null);
    const config={};vm.createContext(config);vm.runInContext(await fs.readFile(path.join(__dirname,'../game/js/plugins.js'),'utf8'),config);
    const menu=config.$plugins.find(p=>p.status&&p.name==='YEP_MainMenuManager').parameters;
    const commands=[];
    for(let i=1;i<=100;i++)if(menu['Menu '+i+' Symbol'] && menu['Menu '+i+' Show']!=='false' &&
        !menu['Menu '+i+' Show'].includes('Imported.YEP_ClassChangeCore'))commands.push(menu['Menu '+i+' Symbol']);
    assert.deepEqual(commands,['item','equip','synthesis','skill','options','gameEnd']);
    assert.equal(menu['Hide Gold Window'],'true');assert.equal(engine.database.System.menuCommands[4],false);
    assert.equal(engine.database.System.menuCommands[5],false);
    console.log('ĐẠT: menu khóa/tạm dừng, 351/352 chờ/hủy, trang bị, vật phẩm/scroll/common event, lưu/tải và chọn kỹ năng.');
})().then(() => clearTimeout(watchdog)).catch(error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
