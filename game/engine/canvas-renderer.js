'use strict';

// Renderer Canvas tối giản cho engine độc lập. Không dùng Tilemap/Spriteset của MV.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneCanvas = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var TILE_SIZE = 48;

    function CanvasRenderer(canvas, options) {
        options = options || {};
        if (!canvas || !canvas.getContext) throw new TypeError('CanvasRenderer cần một canvas.');
        this.canvas = canvas;
        this.context = canvas.getContext('2d');
        this.baseUrl = String(options.baseUrl || '.').replace(/\/+$/, '');
        this.images = new Map();
        this.tilesetImages = [];
        this.tilesetReference = null;
        this.characterImages = new Map();
        this.canvas.width = options.width || 816;
        this.canvas.height = options.height || 624;
        this.context.imageSmoothingEnabled = false;
    }

    CanvasRenderer.prototype.url = function (relative) {
        return this.baseUrl + '/' + relative.split('/').map(encodeURIComponent).join('/');
    };

    CanvasRenderer.prototype.loadImage = function (relative) {
        var self = this;
        if (!this.images.has(relative)) {
            this.images.set(relative, new Promise(function (resolve) {
                var image = new Image();
                image.onload = function () { resolve(image); };
                image.onerror = function () { resolve(null); };
                image.src = self.url(relative);
            }));
        }
        return this.images.get(relative);
    };

    CanvasRenderer.prototype.prepareTileset = async function (tileset) {
        this.tilesetImages = await Promise.all((tileset.tilesetNames || []).map(async function (name) {
            return name ? this.loadImage('img/tilesets/' + name + '.png') : null;
        }, this));
    };

    CanvasRenderer.prototype.draw = async function (engine) {
        var map = engine.map, state = engine.state;
        if (!map || !state) return;
        if (this.tilesetReference !== map.tileset) {
            await this.prepareTileset(map.tileset);
            this.tilesetReference = map.tileset;
        }
        var ctx = this.context;
        ctx.fillStyle = '#080706';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        var cols = Math.ceil(this.canvas.width / TILE_SIZE) + 2;
        var rows = Math.ceil(this.canvas.height / TILE_SIZE) + 2;
        var startX = Math.max(0, Math.min(map.width - cols, state.x - Math.floor(cols / 2)));
        var startY = Math.max(0, Math.min(map.height - rows, state.y - Math.floor(rows / 2)));
        for (var y = startY; y < Math.min(map.height, startY + rows); y += 1) {
            for (var x = startX; x < Math.min(map.width, startX + cols); x += 1) {
                for (var z = 0; z < 4; z += 1) this.drawTile(map.tileId(x, y, z), x - startX, y - startY);
            }
        }
        await this.drawEvents(engine, startX, startY);
        this.drawPlayer(engine, startX, startY);
        return { startX: startX, startY: startY };
    };

    CanvasRenderer.prototype.drawTile = function (tileId, screenX, screenY) {
        var sheet, local, columns;
        if (tileId >= 1536 && tileId < 2048) {
            sheet = this.tilesetImages[4];
            local = tileId - 1536;
            columns = 8;
        } else if (tileId >= 0 && tileId < 1536) {
            var sheetIndex = 5 + Math.floor(tileId / 256);
            sheet = this.tilesetImages[sheetIndex];
            local = tileId % 256;
            columns = 16;
        } else {
            return;
        }
        if (!sheet) return;
        var sx = (local % columns) * TILE_SIZE;
        var sy = Math.floor(local / columns) * TILE_SIZE;
        this.context.drawImage(sheet, sx, sy, TILE_SIZE, TILE_SIZE, screenX * TILE_SIZE, screenY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    };

    CanvasRenderer.prototype.drawEvents = async function (engine, startX, startY) {
        var self = this;
        await Promise.all(engine.map.events.map(async function (event) {
            var page = engine.map.eventPage(event, engine.state);
            if (!page || !page.image || !page.image.characterName) return;
            var name = page.image.characterName;
            var image = await self.loadImage('img/characters/' + name + '.png');
            if (!image) return;
            self.drawCharacter(image, page.image.characterIndex || 0, page.image.direction || 2,
                page.image.pattern || 1, event.x - startX, event.y - startY);
        }));
    };

    CanvasRenderer.prototype.drawPlayer = function (engine, startX, startY) {
        var actorId = engine.state.party[0] || 1;
        var actor = engine.database && engine.database.Actors[actorId];
        var name = actor && actor.characterName || 'mercenary';
        var relative = 'img/characters/' + name + '.png';
        var self = this;
        this.loadImage(relative).then(function (image) {
            if (!image) return;
            self.drawCharacter(image, actor && actor.characterIndex || 0, engine.state.direction || 2, 1,
                engine.state.x - startX, engine.state.y - startY);
        });
    };

    CanvasRenderer.prototype.drawCharacter = function (image, characterIndex, direction, pattern, x, y) {
        var single = image.width <= 144;
        var columns = single ? 3 : 12;
        var rows = single ? 4 : 8;
        var cellWidth = image.width / columns;
        var cellHeight = image.height / rows;
        var blockX = single ? 0 : (characterIndex % 4) * 3;
        var blockY = single ? 0 : Math.floor(characterIndex / 4) * 4;
        var directionRow = ({ 2: 0, 4: 1, 6: 2, 8: 3 })[direction] || 0;
        var sx = (blockX + Math.min(2, pattern)) * cellWidth;
        var sy = (blockY + directionRow) * cellHeight;
        this.context.drawImage(image, sx, sy, cellWidth, cellHeight, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    };

    return { CanvasRenderer: CanvasRenderer, TILE_SIZE: TILE_SIZE };
}));
