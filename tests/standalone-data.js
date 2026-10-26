'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GameDataStore, mapFileName, DATABASE_FILES } = require('../game/engine/data-store');

const gameRoot = path.join(__dirname, '..', 'game');

async function fetchFromGame(relativeUrl) {
    const pathname = new URL(relativeUrl, 'http://standalone.test/').pathname;
    const filename = path.join(gameRoot, pathname.replace(/^\/+/, ''));
    try {
        const value = JSON.parse(await fs.readFile(filename, 'utf8'));
        return { ok: true, status: 200, json: async () => value };
    } catch (error) {
        if (error.code === 'ENOENT') return { ok: false, status: 404, json: async () => ({}) };
        throw error;
    }
}

async function main() {
    assert.equal(mapFileName(1), 'Map001.json');
    assert.equal(mapFileName(74), 'Map074.json');
    assert.throws(() => mapFileName(0), /ID bản đồ không hợp lệ/);
    assert.throws(() => mapFileName(1000), /ID bản đồ không hợp lệ/);

    const store = new GameDataStore({ fetchImpl: fetchFromGame });
    const database = await store.loadDatabase();
    assert.equal(database.System.gameTitle, 'Fear & Hunger');
    assert.equal(database.MapInfos.length, 187);
    assert.equal(database.Tilesets.length, 61);
    assert.deepEqual(Object.keys(database).sort(), DATABASE_FILES.slice().sort());

    const map = await store.loadMap(74);
    assert.equal(map.width, 28);
    assert.equal(map.height, 29);
    assert.equal(map.tilesetId, 12);
    assert.equal(await store.loadMap(74), map, 'map phải được cache trong một phiên');
    await assert.rejects(() => store.loadMap(33), /Không tải được data\/Map033\.json/);

    console.log('ĐẠT: data-store đọc database và map JSON độc lập runtime gốc.');
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
