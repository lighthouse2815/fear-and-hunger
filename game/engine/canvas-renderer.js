'use strict';

// Renderer Canvas của engine độc lập, đọc trực tiếp bố cục ảnh và tile JSON.
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
        this.canvas.width = options.width || 816;
        this.canvas.height = options.height || 624;
        this.context.imageSmoothingEnabled = false;
        this.frame = 0;
    }

    CanvasRenderer.prototype.loadImage = function (relative) {
        var self = this;
        if (!this.images.has(relative)) {
            this.images.set(relative, new Promise(function (resolve, reject) {
                var image = new Image();
                image.onload = function () { resolve(image); };
                image.onerror = function () {
                    self.images.delete(relative);
                    reject(new Error('Không tải được ảnh: ' + relative));
                };
                image.src = self.baseUrl + '/' + relative.split('/').map(encodeURIComponent).join('/');
            }));
        }
        return this.images.get(relative);
    };

    CanvasRenderer.prototype.draw = async function (engine) {
        var map = engine.map, state = engine.state;
        if (!map || !state) return;
        var frame = ++this.frame;
        var names = map.tileset.tilesetNames || [];
        var sheets = await Promise.all(names.map(function (name) {
            return name ? this.loadImage('img/tilesets/' + name + '.png') : null;
        }, this));
        var actors = map.events.map(function (event) {
            var page = map.eventPage(event, state);
            if (!page) return null;
            var image = { characterName: event.characterName, characterIndex: event.characterIndex,
                direction: event.direction, pattern: animationPattern(event, event.pattern), tileId: event.tileId };
            return { x: event.x, y: event.y, image: image, priority: page.priorityType, id: event.id,
                transparent: event.transparent, opacity: event.opacity, blendMode: event.blendMode };
        }).filter(Boolean);
        var actor = state.actor(state.party[0] || 1);
        if (actor) actors.push({ x: state.x, y: state.y, priority: 1, id: Infinity, image: {
            characterName: state.characterName == null ? actor.characterName : state.characterName,
            characterIndex: state.characterIndex == null ? actor.characterIndex : state.characterIndex,
            direction: state.direction, pattern: animationPattern(state, 1)
        }, transparent: state.transparent, opacity: state.opacity, blendMode: state.blendMode });
        await Promise.all(actors.map(async function (entry) {
            var name = entry.image.characterName;
            if (name) entry.bitmap = await this.loadImage('img/characters/' + name + '.png');
        }, this));
        // Một lần vẽ mới đã bắt đầu: không cho promise ảnh cũ đè lên map mới.
        if (frame !== this.frame) return;
        var cols = Math.ceil(this.canvas.width / TILE_SIZE);
        var rows = Math.ceil(this.canvas.height / TILE_SIZE);
        var startX = Math.max(0, Math.min(map.width - cols, state.x - Math.floor(cols / 2)));
        var startY = Math.max(0, Math.min(map.height - rows, state.y - Math.floor(rows / 2)));
        var context = this.context;
        context.fillStyle = '#080706';
        context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        var upper = [], renderer = this;
        for (var y = startY; y < Math.min(map.height, startY + rows); y += 1) {
            for (var x = startX; x < Math.min(map.width, startX + cols); x += 1) {
                for (var z = 0; z < 4; z += 1) {
                    var tileId = map.tileId(x, y, z);
                    if ((map.tileset.flags[tileId] & 0x10) !== 0) upper.push([tileId, x - startX, y - startY]);
                    else this.drawTile(sheets, tileId, x - startX, y - startY);
                }
            }
        }
        actors.sort(function (a, b) { return a.priority - b.priority || a.y - b.y || a.id - b.id; });
        actors.forEach(function (entry) {
            if (entry.priority < 2) renderer.drawActor(sheets, entry, startX, startY);
        });
        upper.forEach(function (tile) { renderer.drawTile(sheets, tile[0], tile[1], tile[2]); });
        actors.forEach(function (entry) {
            if (entry.priority === 2) renderer.drawActor(sheets, entry, startX, startY);
        });
        return { startX: startX, startY: startY };
    };

    CanvasRenderer.prototype.drawTile = function (sheets, tileId, x, y) {
        if (!tileId) return;
        var local, sheet, sourceX, sourceY;
        if (tileId >= 1536 && tileId < 1664) {
            sheet = sheets[4];
            local = tileId - 1536;
            sourceX = local % 8;
            sourceY = Math.floor(local / 8);
        } else if (tileId > 0 && tileId < 1024) {
            sheet = sheets[5 + Math.floor(tileId / 256)];
            local = tileId % 256;
            // B–E: mỗi ảnh có hai khối 8 cột × 16 hàng, đánh số từng khối.
            sourceX = (local < 128 ? 0 : 8) + local % 8;
            sourceY = Math.floor((local % 128) / 8);
        } else throw new Error('Renderer chưa hỗ trợ tile ' + tileId);
        if (!sheet) throw new Error('Thiếu tileset cho tile ' + tileId);
        this.context.drawImage(sheet, sourceX * TILE_SIZE, sourceY * TILE_SIZE, TILE_SIZE, TILE_SIZE,
            x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    };

    function animationPattern(character, restingPattern) {
        if (!character.animationFrames) return restingPattern;
        var interval = Math.max(1, (9 - (character.moveSpeed == null ? 4 : character.moveSpeed)) * 3);
        return [0, 1, 2, 1][Math.floor(character.animationFrames / interval) % 4];
    }

    CanvasRenderer.prototype.drawActor = function (sheets, actor, startX, startY) {
        if (actor.transparent) return;
        this.context.save();
        this.context.globalAlpha = actor.opacity == null ? 1 : actor.opacity / 255;
        this.context.globalCompositeOperation = ['source-over', 'lighter', 'multiply', 'screen'][actor.blendMode || 0] || 'source-over';
        try { this.drawActorImage(sheets, actor, startX, startY); }
        finally { this.context.restore(); }
    };

    CanvasRenderer.prototype.drawActorImage = function (sheets, actor, startX, startY) {
        var image = actor.image;
        if (image.tileId) return this.drawTile(sheets, image.tileId, actor.x - startX, actor.y - startY);
        if (!actor.bitmap) return;
        var prefix = /^[!$]+/.exec(image.characterName);
        var single = prefix && prefix[0].includes('$');
        var object = prefix && prefix[0].includes('!');
        var width = actor.bitmap.width / (single ? 3 : 12);
        var height = actor.bitmap.height / (single ? 4 : 8);
        var index = image.characterIndex || 0;
        var column = (single ? 0 : (index % 4) * 3) + (image.pattern == null ? 1 : image.pattern);
        var row = (single ? 0 : Math.floor(index / 4) * 4) + ({ 2: 0, 4: 1, 6: 2, 8: 3 }[image.direction] || 0);
        this.context.drawImage(actor.bitmap, column * width, row * height, width, height,
            (actor.x - startX + 0.5) * TILE_SIZE - width / 2,
            (actor.y - startY + 1) * TILE_SIZE - height - (object ? 0 : 6), width, height);
    };

    return { CanvasRenderer: CanvasRenderer, TILE_SIZE: TILE_SIZE };
}));
