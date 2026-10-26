'use strict';

// Renderer Canvas của engine độc lập, đọc trực tiếp bố cục ảnh và tile JSON.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./text-format'));
    else root.FNHStandaloneCanvas = factory(root.FNHStandaloneText);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (textApi) {
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
        var screen = engine.screen && engine.screen.screen;
        var parallaxName = screen && screen.parallax ? screen.parallax.name : map.data.parallaxName;
        var parallax = parallaxName ? await this.loadImage('img/parallaxes/' + parallaxName + '.png') : null;
        var pictures = screen ? await Promise.all(Object.keys(screen.pictures).sort(function (a, b) { return a - b; }).map(async function (id) {
            var picture = screen.pictures[id];
            return { picture: picture, bitmap: picture.name ? await this.loadImage('img/pictures/' + picture.name + '.png') : null };
        }, this)) : [];
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
                transparent: event.transparent, opacity: event.opacity, blendMode: event.blendMode, balloon: event.balloon };
        }).filter(Boolean);
        var actor = state.actor(state.party[0] || 1);
        if (actor) actors.push({ x: state.x, y: state.y, priority: 1, id: Infinity, image: {
            characterName: state.characterName == null ? actor.characterName : state.characterName,
            characterIndex: state.characterIndex == null ? actor.characterIndex : state.characterIndex,
            direction: state.direction, pattern: animationPattern(state, 1)
        }, transparent: state.transparent, opacity: state.opacity, blendMode: state.blendMode, balloon: state.balloon });
        await Promise.all(actors.map(async function (entry) {
            var name = entry.image.characterName;
            if (name) entry.bitmap = await this.loadImage('img/characters/' + name + '.png');
        }, this));
        var balloonBitmap = actors.some(function (entry) { return entry.balloon && entry.balloon.remaining > 0; }) ?
            await this.loadImage('img/system/Balloon.png') : null;
        // Một lần vẽ mới đã bắt đầu: không cho promise ảnh cũ đè lên map mới.
        if (frame !== this.frame) return;
        var cols = Math.ceil(this.canvas.width / TILE_SIZE);
        var rows = Math.ceil(this.canvas.height / TILE_SIZE);
        var viewport = map.viewport(state, this.canvas.width, this.canvas.height);
        var startX = viewport.startX, startY = viewport.startY;
        var context = this.context;
        context.fillStyle = '#080706';
        context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        context.save();
        var shake = screen && screen.shake;
        if (shake && shake.remaining > 0) context.translate(Math.sin(shake.phase * shake.speed / 10) * shake.power * 2, 0);
        if (parallax) context.drawImage(parallax, -startX * TILE_SIZE, -startY * TILE_SIZE);
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
        if (balloonBitmap) actors.forEach(function (entry) { renderer.drawBalloon(balloonBitmap, entry, startX, startY); });
        // Tint thuộc lớp bản đồ; picture giao diện giữ màu riêng.
        if (screen) this.applyTone(context, this.canvas.width, this.canvas.height, screen.tone);
        this.drawWeather(screen && screen.weather);
        pictures.forEach(function (entry) { renderer.drawPicture(entry); });
        context.restore();
        if (screen) {
            if (screen.brightness < 255) {
                context.fillStyle = 'rgba(0,0,0,' + (1 - screen.brightness / 255) + ')';
                context.fillRect(0, 0, this.canvas.width, this.canvas.height);
            }
            var flash = screen.flash;
            if (flash.opacity > 0) {
                context.fillStyle = 'rgba(' + [flash.red, flash.green, flash.blue, flash.opacity / 255].join(',') + ')';
                context.fillRect(0, 0, this.canvas.width, this.canvas.height);
            }
            this.drawGab(screen.gab, state);
        }
        return { startX: startX, startY: startY };
    };

    CanvasRenderer.prototype.drawBalloon = function (bitmap, actor, startX, startY) {
        var balloon = actor.balloon;
        if (!balloon || balloon.remaining <= 0 || actor.transparent) return;
        var prefix = /^[!$]+/.exec(actor.image.characterName || '');
        var single = prefix && prefix[0].includes('$');
        var object = prefix && prefix[0].includes('!');
        var height = actor.bitmap ? actor.bitmap.height / (single ? 4 : 8) : TILE_SIZE;
        var frame = Math.min(7, Math.floor((76 - balloon.remaining) / 8));
        this.context.drawImage(bitmap, frame * 48, (balloon.id - 1) * 48, 48, 48,
            (actor.x - startX) * 48, (actor.y - startY + 1) * 48 - height - 48 - (object ? 0 : 6), 48, 48);
    };

    CanvasRenderer.prototype.drawGab = function (gab, state) {
        if (!gab) return;
        var context = this.context, width = this.canvas.width;
        context.save();
        context.globalAlpha = gab.opacity / 255;
        context.font = '28px GameFont, serif';
        context.textBaseline = 'top';
        var lines = [''];
        textApi.formatText(gab.text, state).split(/\s+/).forEach(function (word) {
            var index = lines.length - 1, candidate = lines[index] ? lines[index] + ' ' + word : word;
            if (lines[index] && context.measureText(candidate).width > width - 48) lines.push(word);
            else lines[index] = candidate;
        });
        var height = lines.length * 34 + 20, top = this.canvas.height - height - 8;
        var gradient = context.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, 'rgba(0,0,0,0.85)'); gradient.addColorStop(1, 'rgba(0,0,0,0.3)');
        context.fillStyle = gradient;
        context.fillRect(0, top, width, height);
        context.fillStyle = '#fff'; context.shadowColor = '#000'; context.shadowBlur = 3;
        lines.forEach(function (line, index) { context.fillText(line, 24, top + 10 + index * 34); });
        context.restore();
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

    CanvasRenderer.prototype.applyTone = function (context, width, height, tone) {
        if (!tone || !(tone.red || tone.green || tone.blue || tone.gray)) return;
        var image = context.getImageData(0, 0, width, height), pixels = image.data;
        var gray = tone.gray / 255;
        for (var i = 0; i < pixels.length; i += 4) {
            var luminance = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) * gray;
            pixels[i] = pixels[i] * (1 - gray) + luminance + tone.red;
            pixels[i + 1] = pixels[i + 1] * (1 - gray) + luminance + tone.green;
            pixels[i + 2] = pixels[i + 2] * (1 - gray) + luminance + tone.blue;
        }
        context.putImageData(image, 0, 0);
    };

    CanvasRenderer.prototype.drawPicture = function (entry) {
        var picture = entry.picture, bitmap = entry.bitmap;
        if (!bitmap || picture.opacity <= 0) return;
        if (picture.tone && Object.values(picture.tone).some(function (value) { return value !== 0; })) {
            if (!this.pictureCanvas) this.pictureCanvas = document.createElement('canvas');
            this.pictureCanvas.width = bitmap.width; this.pictureCanvas.height = bitmap.height;
            var tintContext = this.pictureCanvas.getContext('2d', { willReadFrequently: true });
            tintContext.drawImage(bitmap, 0, 0);
            this.applyTone(tintContext, bitmap.width, bitmap.height, picture.tone);
            bitmap = this.pictureCanvas;
        }
        var context = this.context;
        context.save();
        context.globalAlpha = Math.max(0, Math.min(1, picture.opacity / 255));
        context.globalCompositeOperation = ['source-over', 'lighter', 'multiply', 'screen'][picture.blendMode] || 'source-over';
        context.translate(picture.x, picture.y);
        context.rotate(picture.angle * Math.PI / 180);
        context.scale(picture.scaleX / 100, picture.scaleY / 100);
        context.drawImage(bitmap, picture.origin === 1 ? -bitmap.width / 2 : 0, picture.origin === 1 ? -bitmap.height / 2 : 0);
        context.restore();
    };

    CanvasRenderer.prototype.drawWeather = function (weather) {
        if (!weather || weather.power <= 0) return;
        var context = this.context, width = this.canvas.width, height = this.canvas.height;
        context.save();
        context.strokeStyle = '#b7c5d2'; context.fillStyle = '#fff'; context.globalAlpha = 0.55;
        var count = Math.ceil(weather.power * 10), time = weather.time;
        for (var i = 0; i < count; i++) {
            var x = ((i * 149 + (weather.type === 'snow' ? Math.sin(time / 80 + i) * 20 : -time * 2)) % (width + 40) + width + 40) % (width + 40) - 20;
            var y = ((i * 83 + time * (weather.type === 'snow' ? 2 : 12)) % (height + 40)) - 20;
            if (weather.type === 'snow') { context.beginPath(); context.arc(x, y, 3, 0, Math.PI * 2); context.fill(); }
            else { context.lineWidth = weather.type === 'storm' ? 2 : 1; context.beginPath(); context.moveTo(x, y); context.lineTo(x - 5, y + 18); context.stroke(); }
        }
        context.restore();
    };

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
