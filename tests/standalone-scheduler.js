'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const { EventScheduler } = require('../game/engine/event-scheduler');
const delay = () => new Promise(resolve => setImmediate(resolve));
const page = (trigger, list, conditions = {}) => ({ trigger, list, conditions, image: {}, priorityType: 0 });
async function fixture(events, commonEvents = []) {
    const data = { width: 3, height: 3, data: [...Array(9).fill(1), ...Array(45).fill(0)], events, tilesetId: 1 };
    const engine = new GameEngine({ dataStore: {
        loadDatabase: async () => ({ Actors: [], System: {}, CommonEvents: commonEvents, Tilesets: [null, { flags: [16, 0] }] }),
        loadMap: async id => id === 1 ? data : Object.assign({}, data, { events: [] })
    } });
    await engine.boot({ mapId: 1, x: 0, y: 0 });
    return engine;
}
(async () => {
    const realTimerEvent = require('../game/data/Map166.json').events[307];
    const timed = await fixture([null, realTimerEvent]);
    const timerErrors = [], timerScheduler = new EventScheduler(timed, {}, error => timerErrors.push(error));
    timed.state.setSwitch(2741, true);
    timed.state.timer = { active: true, frames: 60 };
    timerScheduler.tick(); await delay();
    assert.equal(timed.state.switchValue(2744), false, 'trang song song chưa hết giờ khi còn một giây');
    timed.advanceRoutes(1);
    for (let i = 0; i < 20 && !timed.state.switchValue(2744); i++) { timerScheduler.tick(); await delay(); }
    assert.equal(timed.state.switchValue(2744), true, 'trang song song Map166 phát hiện dưới một giây');
    assert.equal(timed.state.switchValue(202), true);
    assert.deepEqual(timed.state.timer, { active: false, frames: 59 });
    assert.equal(timed.map.eventPage(timed.map.eventById(307)).trigger, 3, 'switch hết giờ đổi sang trang autorun');
    timerScheduler.stop();
    assert.deepEqual(timerErrors, []);

    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const puzzle = new GameEngine({ dataStore: store, onRouteEffect: () => true });
    await puzzle.boot({ mapId: 166, x: 1, y: 1, party: [1] });
    const puzzleMessages = [];
    let puzzleDone = false, puzzleError;
    const puzzleRun = puzzle.runEvent(67, { message: text => puzzleMessages.push(text),
        effect: code => [245, 250].includes(code) })
        .catch(error => { puzzleError = error; }).finally(() => { puzzleDone = true; });
    for (let i = 0; i < 2000 && !puzzleDone; i++) { puzzle.advanceRoutes(16); await delay(); }
    assert.equal(puzzleDone, true, 'toàn bộ mở màn puzzle phải kết thúc');
    await puzzleRun;
    if (puzzleError) throw puzzleError;
    assert.ok(puzzleMessages.some(text => text.includes('Solve the ancient puzzle')));
    assert.equal(puzzle.state.timer.active, true);
    assert.ok(puzzle.state.timer.frames > 0 && puzzle.state.timer.frames <= 10800);
    assert.equal(puzzle.state.switchValue(2741), true, 'autorun puzzle mở trang đếm giờ');
    assert.equal(puzzle.state.switchValue(410), false, 'autorun trả quyền điều khiển');
    assert.equal(puzzle.map.eventPage(puzzle.map.eventById(67)).trigger, 0);
    const puzzleSnapshot = puzzle.save();
    const tileErrors = [], tileScheduler = new EventScheduler(puzzle, { effect: code => code === 250 }, error => tileErrors.push(error));
    await puzzle.runEvent(40, { effect: code => code === 250 });
    for (let i = 0; i < 300 && !puzzle.state.selfSwitchValue(166, 40, 'D'); i++) {
        tileScheduler.tick(); puzzle.advanceRoutes(1); await delay();
    }
    assert.equal(puzzle.state.selfSwitchValue(166, 40, 'D'), true, 'ô thật qua ba trang autorun tới trạng thái chọn');
    assert.equal(puzzle.state.variableValue(318), 1, 'ô đúng tăng bộ đếm câu đố');
    await puzzle.runEvent(40, { effect: code => code === 250 });
    for (let i = 0; i < 300 && (puzzle.state.variableValue(318) !== 0 || puzzle.state.selfSwitchValue(166, 40, 'A')); i++) {
        tileScheduler.tick(); puzzle.advanceRoutes(1); await delay();
    }
    assert.equal(puzzle.state.variableValue(318), 0, 'bỏ chọn ô trừ bộ đếm');
    assert.equal(puzzle.state.selfSwitchValue(166, 40, 'A'), false);
    assert.deepEqual(tileErrors, []);
    tileScheduler.stop(); await delay();
    await puzzle.restore(puzzleSnapshot);
    const solveMessages = [], solveErrors = [];
    const solveScheduler = new EventScheduler(puzzle, { message: text => solveMessages.push(text),
        effect: code => [245, 250].includes(code) }, error => solveErrors.push(error));
    const correctTiles = puzzle.map.events.filter(event => {
        const page = event.pages[3];
        return page && page.list.some(command => command.code === 122 && command.parameters[0] === 318 && command.parameters[2] === 1);
    });
    assert.equal(correctTiles.length, 26, 'JSON câu đố có 26 ô đúng');
    for (const tile of correctTiles) {
        await puzzle.runEvent(tile.id, { effect: code => code === 250 });
        for (let i = 0; i < 300 && !puzzle.state.selfSwitchValue(166, tile.id, 'D'); i++) {
            solveScheduler.tick(); puzzle.advanceRoutes(1); await delay();
        }
        assert.equal(puzzle.state.selfSwitchValue(166, tile.id, 'D'), true, 'ô ' + tile.id + ' được chọn');
    }
    for (let i = 0; i < 2000 && puzzle.state.mapId === 166; i++) {
        solveScheduler.tick(); puzzle.advanceRoutes(16); await delay();
    }
    assert.equal(puzzle.state.mapId, 168, 'chọn đủ ô thật kích hoạt trang hoàn thành');
    assert.ok(solveMessages.some(text => text.includes('solved the puzzle')));
    assert.deepEqual(solveErrors, []);
    solveScheduler.stop(); await delay();
    await puzzle.restore(puzzleSnapshot);
    async function runPuzzleEnding(eventId) {
        let done = false, error;
        const messages = [];
        const run = puzzle.runEvent(eventId, { message: text => messages.push(text),
            effect: code => [245, 250].includes(code) })
            .catch(reason => { error = reason; }).finally(() => { done = true; });
        for (let i = 0; i < 2000 && !done; i++) { puzzle.advanceRoutes(16); await delay(); }
        assert.equal(done, true, 'nhánh kết thúc puzzle phải kết thúc');
        await run;
        if (error) throw error;
        return messages;
    }
    puzzle.state.setSwitch(2781, true);
    puzzle.state.setVariable(318, 26); puzzle.state.setVariable(319, 0);
    const successMessages = await runPuzzleEnding(305);
    assert.ok(successMessages.some(text => text.includes('solved the puzzle')));
    assert.equal(puzzle.state.mapId, 168);
    assert.equal(puzzle.state.timer.active, false);
    assert.equal(puzzle.state.switchValue(2791), true);
    assert.equal(puzzle.state.variableValue(334), 2);
    await puzzle.restore(puzzleSnapshot);
    puzzle.state.setSwitch(2781, true); puzzle.state.timer.frames = 0;
    await puzzle.runEvent(307);
    assert.equal(puzzle.state.switchValue(2744), true, 'trang hết giờ mở nhánh thất bại');
    const failureMessages = await runPuzzleEnding(307);
    assert.ok(failureMessages.some(text => text.includes('failed at solving')));
    assert.equal(puzzle.state.mapId, 168);
    assert.equal(puzzle.state.timer.active, false);
    assert.equal(puzzle.state.switchValue(2792), true);
    assert.equal(puzzle.state.switchValue(2791), false);
    const hideSeek = new GameEngine({ dataStore: store, onRouteEffect: () => true });
    await hideSeek.boot({ mapId: 167, x: 38, y: 44, party: [1] });
    let openingDone = false, openingError;
    const openingMessages = [];
    const opening = hideSeek.runEvent(39, { message: text => openingMessages.push(text),
        effect: code => [245, 250].includes(code) }).catch(error => { openingError = error; })
        .finally(() => { openingDone = true; });
    for (let i = 0; i < 2000 && !openingDone; i++) { hideSeek.advanceRoutes(16); await delay(); }
    assert.equal(openingDone, true, 'mở màn trốn tìm phải kết thúc');
    await opening;
    if (openingError) throw openingError;
    assert.ok(openingMessages.some(text => text.includes('hide and seek')));
    assert.equal(hideSeek.state.switchValue(2742), true);
    assert.equal(hideSeek.state.timer.active, true);
    assert.ok(hideSeek.state.timer.frames > 0 && hideSeek.state.timer.frames <= 59 * 60);
    hideSeek.state.timer = { active: true, frames: 59 };
    let hideSeekDone = false, hideSeekError;
    const hideSeekRun = hideSeek.runEvent(61).catch(error => { hideSeekError = error; })
        .finally(() => { hideSeekDone = true; });
    for (let i = 0; i < 300 && !hideSeekDone; i++) { hideSeek.advanceRoutes(8); await delay(); }
    assert.equal(hideSeekDone, true, 'nhánh hết giờ trốn tìm phải kết thúc');
    await hideSeekRun;
    if (hideSeekError) throw hideSeekError;
    assert.equal(hideSeek.state.timer.active, false);
    assert.equal(hideSeek.state.switchValue(2746), true);
    assert.equal(hideSeek.state.switchValue(2744), true);
    assert.deepEqual([hideSeek.state.mapId, hideSeek.state.x, hideSeek.state.y], [167, 38, 45]);
    const hideSeekSave = hideSeek.save(); await hideSeek.restore(hideSeekSave);
    assert.equal(hideSeek.state.switchValue(2744), true, 'lưu giữ nhánh hết giờ trốn tìm');
    const engine = await fixture([null,
        { id: 1, x: 0, y: 1, pages: [page(3, [
            { code: 122, parameters: [1, 1, 1, 0, 1] }, { code: 230, parameters: [3] }, { code: 123, parameters: ['A', 0] }
        ]), page(0, [{ code: 0 }], { selfSwitchValid: true, selfSwitchCh: 'A' })] },
        { id: 2, x: 1, y: 1, pages: [page(4, [
            { code: 122, parameters: [2, 2, 1, 0, 1] }, { code: 230, parameters: [5] }, { code: 121, parameters: [8, 8, 0] }
        ]), page(0, [{ code: 0 }], { switch1Valid: true, switch1Id: 9 })] }
    ]);
    const errors = [], scheduler = new EventScheduler(engine, {}, error => errors.push(error));
    scheduler.tick();
    await delay();
    assert.equal(engine.eventRunning, true, 'autorun khóa nhân vật');
    assert.equal(engine.state.variableValue(1), 1);
    assert.equal(engine.state.variableValue(2), 1, 'parallel chạy đồng thời với autorun');
    scheduler.tick(); await delay();
    assert.equal(engine.state.variableValue(1), 1, 'không tạo bản autorun thứ hai đang chờ');
    engine.state.setSwitch(9, true);
    scheduler.tick();
    engine.advanceRoutes(5); await delay();
    scheduler.tick(); await delay();
    assert.equal(engine.eventRunning, false);
    assert.equal(engine.state.selfSwitchValue(1, 1, 'A'), true);
    assert.equal(engine.state.switchValue(8), false, 'parallel bị đổi page không được tiếp tục sau wait');
    assert.equal(errors.length, 0);
    scheduler.stop();

    const emptyFirst = await fixture([null,
        { id: 1, x: 0, y: 1, pages: [page(3, [{ code: 0 }])] },
        { id: 2, x: 1, y: 1, pages: [page(3, [{ code: 121, parameters: [20, 20, 0] }, { code: 0 }])] }
    ]);
    const emptyScheduler = new EventScheduler(emptyFirst, {}, error => errors.push(error));
    emptyScheduler.tick(); await delay();
    assert.equal(emptyFirst.state.switchValue(20), true, 'autorun rỗng không chặn autorun có lệnh phía sau');
    assert.equal(emptyFirst.map.eventById(1).locked, undefined, 'autorun rỗng không khóa event');
    emptyScheduler.stop();

    const realStore = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(await fs.readFile(path.join(__dirname, '../game', url), 'utf8')) }) });
    const real = new GameEngine({ dataStore: realStore });
    await real.boot({ mapId: 1, x: 27, y: 68, party: [1], switches: { 153: true, 246: true } });
    assert.deepEqual(real.map.eventPage(real.map.eventById(3)).list.map(command => command.code), [0]);
    assert.deepEqual(real.map.eventPage(real.map.eventById(4)).list.map(command => command.code), [0]);
    const realScheduler = new EventScheduler(real, {}, error => errors.push(error));
    realScheduler.tick(); await delay();
    assert.equal(realScheduler.autorun.page, real.map.eventPage(real.map.eventById(84)), 'bỏ hai autorun rỗng để chạy event 84 thật');
    assert.equal(real.state.switchValue(410), true); assert.equal(real.state.switchValue(202), true);
    realScheduler.stop(); await delay();

    // Parallel không còn thuộc map mới phải dừng, không áp dụng công tắc muộn.
    const moving = await fixture([null, { id: 1, x: 0, y: 1, pages: [page(4, [
        { code: 230, parameters: [1] }, { code: 121, parameters: [10, 10, 0] }
    ])] }]);
    const movingScheduler = new EventScheduler(moving, {}, error => errors.push(error));
    movingScheduler.tick(); await delay();
    await moving.loadMap(2);
    movingScheduler.tick();
    moving.advanceRoutes(5); await delay();
    assert.equal(moving.state.switchValue(10), false);
    movingScheduler.stop();

    const common = await fixture([], [null,
        { id: 1, trigger: 1, switchId: 11, list: [
            { code: 124, parameters: [0, 2] }, { code: 230, parameters: [2] },
            { code: 122, parameters: [3, 3, 1, 0, 1] }, { code: 121, parameters: [11, 11, 1] }
        ] },
        { id: 2, trigger: 2, switchId: 12, list: [
            { code: 230, parameters: [3] }, { code: 121, parameters: [13, 13, 0] }
        ] }
    ]);
    const commonScheduler = new EventScheduler(common, {}, error => errors.push(error));
    common.state.setSwitch(11, true); common.state.setSwitch(12, true);
    commonScheduler.tick(); await delay();
    assert.equal(common.eventRunning, true);
    assert.equal(common.state.timer.frames, 120);
    common.state.setSwitch(12, false); commonScheduler.tick();
    common.advanceRoutes(3); await delay();
    assert.equal(common.state.variableValue(3), 1);
    assert.equal(common.state.timer.frames, 117);
    assert.equal(common.state.switchValue(13), false, 'common parallel bị tắt switch phải ngừng');
    assert.equal(common.eventRunning, false);
    const context = common.commonInterpreterFor(2);
    assert.equal(context.eventId, 0, 'common event tự chạy không mượn ID sự kiện 1');
    commonScheduler.stop();

    const erased = await fixture([null, { id: 1, x: 0, y: 1, pages: [page(0, [{ code: 214 }])] }]);
    await erased.runEvent(1);
    assert.equal(erased.map.eventPage(erased.map.eventById(1)), null);
    await erased.restore(erased.save());
    assert.equal(erased.map.eventPage(erased.map.eventById(1)), null, 'lưu/tải giữ sự kiện đã erase trong map hiện tại');
    await erased.loadMap(2); await erased.loadMap(1);
    assert.ok(erased.map.eventPage(erased.map.eventById(1)), 'erase chỉ có hiệu lực trong lần ở map hiện tại');

    const broken = await fixture([null, { id: 1, x: 1, y: 1, pages: [page(4, [{ code: 999 }])] }]);
    const brokenScheduler = new EventScheduler(broken, {}, error => errors.push(error));
    brokenScheduler.tick(); await delay();
    brokenScheduler.tick(); await delay();
    assert.equal(errors.length, 1, 'lệnh chưa hỗ trợ báo một lần, không lặp lỗi mỗi frame');
    assert.match(errors[0].message, /Chưa hỗ trợ lệnh 999/);
    brokenScheduler.stop();
    const ending = await fixture([null, { id: 1, x: 1, y: 1, pages: [page(4, [
        { code: 230, parameters: [60] }, { code: 121, parameters: [14, 14, 0] }
    ])] }]);
    const endingScheduler = new EventScheduler(ending, {}, error => errors.push(error));
    endingScheduler.tick(); await delay();
    ending.state.scene = 'gameover'; endingScheduler.tick();
    ending.state.timer = { active: true, frames: 120 };
    ending.advanceRoutes(120); await delay();
    assert.equal(ending.state.timer.frames, 120, 'game over dừng thời gian gameplay');
    assert.equal(ending.state.switchValue(14), false, 'game over hủy parallel đang chờ');
    assert.equal(endingScheduler.parallel.size, 0);
    ending.state.scene = 'map'; endingScheduler.tick(); await delay();
    ending.advanceRoutes(60); await delay();
    assert.equal(ending.state.switchValue(14), true, 'scheduler hoạt động lại sau khi tải map');
    endingScheduler.stop();
    console.log('ĐẠT: autorun/parallel của map/common event, hủy khi đổi page/map/switch, timer và erase/save.');
})().catch(error => { console.error(error); process.exitCode = 1; });
