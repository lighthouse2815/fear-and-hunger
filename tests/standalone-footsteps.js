'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GameEngine } = require('../game/engine/game-engine');
const { GameDataStore } = require('../game/engine/data-store');
const { AudioManager } = require('../game/engine/audio-manager');

(async () => {
    const store = new GameDataStore({ fetchImpl: async url => ({ ok: true, json: async () =>
        JSON.parse(fs.readFileSync(path.join(__dirname, '../game', url), 'utf8')) }) });
    const database = await store.loadDatabase(), sounds = [];
    const data = { width: 24, height: 3, tilesetId: 1, note: '', data: Array(72).fill(1).concat(Array(360).fill(0)),
        events: [null, { id: 1, x: 4, y: 1, note: '', pages: [{ conditions: {}, trigger: 0, priorityType: 1, list: [], image: { characterName: '$guard1', direction: 2 } }] }] };
    const engine = new GameEngine({ onRouteEffect: (code, parameters) => sounds.push([code, parameters[0]]), dataStore: {
        loadDatabase: async () => Object.assign({}, database, { Tilesets: [null, { flags: [16, 0, 2 << 12], note: '<Terrain Tag 2 Footstep Sound: footstep_wood, 40, 90>' }] }),
        loadMap: async () => data
    } });
    await engine.boot({ mapId: 1, x: 1, y: 1, party: [1] });
    assert.equal(engine.move(6), true);
    assert.deepEqual(sounds.pop(), [250, { name: 'footstep_tile', volume: 96, pitch: 70, pan: 0 }]);
    data.data[1 * 24 + 3] = 2;
    assert.equal(engine.move(6), true);
    assert.deepEqual(sounds.pop(), [250, { name: 'footstep_wood', volume: 100, pitch: 90, pan: 0 }]);
    engine.map.data.note = '<Region 1 Footstep Sound: footstep_water, 30, 100>\n<Region 0 Footstep Sound: footstep_dirt>';
    data.data[5 * 72 + 1 * 24 + 3] = 1;
    assert.deepEqual(engine.footstepSound(engine.state), { name: 'footstep_water', volume: 100, pitch: 100, pan: 0 }, 'region ưu tiên terrain và giới hạn âm lượng');
    data.data[5 * 72 + 1 * 24 + 3] = 0;
    assert.equal(engine.footstepSound(engine.state).name, 'footstep_wood', 'terrain ưu tiên region mặc định 0');
    data.data[1 * 24 + 3] = 1;
    assert.equal(engine.footstepSound(engine.state).name, 'footstep_dirt');
    const event = engine.map.eventById(1);
    assert.equal(engine.moveCharacter(event, 6), true);
    const distant = sounds.pop()[1];
    assert.deepEqual(distant, { name: 'footstep_dirt', volume: 26, pitch: 70, pan: -2 });
    event.x = 22; assert.equal(engine.footstepSound(event), null, 'ngoài tầm nghe không phát SE');
    event.x = 4; event.note = '<No Footsteps>'; assert.equal(engine.footstepSound(event), null);
    event.note = ''; engine.state.vehicleId = 0; assert.equal(engine.footstepSound(engine.state), null);
    engine.state.vehicleId = -1;
    sounds.length = 0;
    assert.equal(engine.move(6), false); assert.equal(sounds.length, 0, 'va chạm không phát tiếng bước');
    await engine.createInterpreter([{ code: 356, parameters: ['DisableFootsteps'] }], 0).run();
    assert.equal(engine.footstepSound(event), null);
    await engine.restore(engine.save()); assert.equal(engine.state.footstepsEnabled, false);
    await engine.createInterpreter([{ code: 356, parameters: ['EnableFootsteps'] }], 0).run();
    assert.ok(engine.footstepSound(engine.state));
    engine.state.addActor(3); engine.state.addGuestActor(4); engine.state.followers();
    engine.move(4); engine.move(4); sounds.length = 0; engine.move(4);
    assert.equal(sounds.length, 3, 'đội và guest đang hiện cùng phát bước đi');
    engine.state.followersVisible = false; sounds.length = 0; engine.move(6);
    assert.equal(sounds.length, 1, 'follower ẩn không phát SE');

    let checked = 0;
    engine.state.x = 3; engine.state.y = 1; engine.map.data.note = '';
    for (const tileset of database.Tilesets.filter(Boolean)) {
        for (const match of (tileset.note || '').matchAll(/<Terrain Tag (\d+) Footstep Sound:\s*([^>]+)>/ig)) {
            const tag = Number(match[1]), parts = match[2].split(',').map(value => value.trim());
            engine.map.tileset = { flags: [16, tag << 12], note: match[0] };
            const sound = engine.footstepSound(engine.state);
            assert.equal(sound.name, parts[0]);
            assert.equal(sound.volume, Math.min(100, Number(parts[1] || 20) * 4.8));
            assert.equal(sound.pitch, Number(parts[2] || 70));
            fs.accessSync(path.join(__dirname, '../game/audio/se', sound.name + '.ogg'));
            checked++;
        }
    }
    assert.equal(checked, 122);
    const quiet = new AudioManager({ masterVolume: 0.05, audioFactory: () => ({ addEventListener() {}, play: async () => {}, pause() {} }) });
    const audio = quiet.play('se', { name: 'footstep_tile', volume: 96, pitch: 70 });
    assert.equal(audio.volume, 0.048, 'tiếng bước đi vẫn chịu âm lượng tổng 5%');
    quiet.setVolume('se',0);assert.equal(audio.volume,0,'tắt hiệu ứng vẫn tắt tiếng bước chân');quiet.dispose();
    console.log('ĐẠT: 122 note bước chân thật, region/terrain/default, người/quái/guest, khoảng cách/pan, va chạm/ẩn/phương tiện, bật tắt/save và volume 5%.');
})().catch(error => { console.error(error); process.exitCode = 1; });
