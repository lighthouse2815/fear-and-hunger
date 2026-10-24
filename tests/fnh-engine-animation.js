'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const FNH = { WIDTH: 816, HEIGHT: 624 };
vm.runInNewContext(fs.readFileSync('fnh-engine/js/battle_animation.js', 'utf8'), { window: { FNH } });
(async () => {
    const sounds = [], images = [], calls = [];
    const animation = new FNH.BattleAnimation({ position: 3, animation1Name: 'coin_flip', animation2Name: '',
        animation1Hue: 0, animation2Hue: 0,
        frames: [[[1, 10, 20, 150, 45, 1, 128, 1]], [[-1]], [[-1]]],
        timings: [{ frame: 0, se: { name: 'coin', volume: 90, pitch: 110, pan: 0 }, flashScope: 2, flashColor: [255, 0, 0, 255], flashDuration: 2 },
            { frame: 1, flashScope: 3, flashDuration: 1 }] },
    { loadImage: async (name) => { images.push(name); return { width: 960, height: 960 }; } },
    { playSe: (name, options) => sounds.push([name, options]) }, {}, (error) => { throw error; });
    animation.update(1);
    assert.equal(animation.time, 0, 'Không bỏ qua frame khi ảnh chưa nạp');
    await animation.loading;
    animation.update(0);
    assert.equal(images[0], 'animations/coin_flip');
    assert.equal(sounds.length, 1);
    assert.equal(sounds[0][1].volume, 0.9);
    const ctx = { globalAlpha: 1, save() {}, restore() {}, translate: (...v) => calls.push(['translate', ...v]),
        rotate() {}, scale: (...v) => calls.push(['scale', ...v]), drawImage: (...v) => calls.push(['image', ...v]),
        fillRect: (...v) => calls.push(['flash', ...v]) };
    animation.draw(ctx, { x: 1, y: 2, height: 100 });
    assert.equal(calls.find((c) => c[0] === 'translate')[1], 418);
    assert.equal(calls.find((c) => c[0] === 'scale')[1], -1.5);
    assert.equal(calls.find((c) => c[0] === 'image')[2], 192);
    assert.equal(calls.find((c) => c[0] === 'flash')[3], 816);
    animation.update(1 / 15);
    assert.equal(animation.hidden, true);
    animation.update(1);
    assert.equal(animation.done, true);
    assert.equal(animation.hidden, false);
    assert.equal(sounds.length, 1, 'Timing âm thanh không phát lặp theo frame trình duyệt');
    let reported;
    const failed = new FNH.BattleAnimation({ animation1Name: 'missing', frames: [] },
        { loadImage: async () => { throw new Error('missing'); } }, {}, {}, (error) => { reported = error; });
    await failed.loading;
    assert.equal(failed.done, true);
    assert.equal(reported.message, 'missing');
    console.log('ĐẠT: animation gốc, frame/cell, mirror, timing âm thanh, flash và lỗi asset.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
