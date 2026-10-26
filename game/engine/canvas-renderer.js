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

    CanvasRenderer.prototype.pictureImages = function (screen) {
        var renderer = this;
        return Promise.all(screen ? Object.keys(screen.pictures).sort(function (a, b) { return a - b; }).map(async function (id) {
            var picture = screen.pictures[id];
            return { picture: picture, bitmap: picture.name ? await renderer.loadImage('img/pictures/' + picture.name + '.png') : null };
        }) : []);
    };

    CanvasRenderer.prototype.fogImages = function (screen, battle) {
        var renderer = this;
        return Promise.all((screen && screen.fogs || []).filter(function (fog) {
            var prefix = /^[!$%]+/.exec(fog.name), signs = prefix ? prefix[0] : '';
            return battle ? signs.includes('$') || signs.includes('%') : !signs.includes('%');
        }).map(async function (fog) { return { fog: fog, bitmap: await renderer.loadImage('img/fogs/' + fog.name + '.png') }; }));
    };

    CanvasRenderer.prototype.drawFogs = function (fogs, depth, startX, startY) {
        var context = this.context, canvas = this.canvas;
        fogs.forEach(function (entry) {
            var fog = entry.fog, bitmap = entry.bitmap;
            if (fog.depth !== depth) return;
            var fixed = /^[!$%]*!/.test(fog.name), factor = fixed ? 1 : 0.5;
            var x = (startX || 0) * TILE_SIZE * factor * (fixed ? 1 : fog.panX) + fog.x * (fixed ? 2 : 1);
            var y = (startY || 0) * TILE_SIZE * factor * (fixed ? 1 : fog.panY) + fog.y * (fixed ? 2 : 1);
            x = Math.floor(x) * fog.zoom; y = Math.floor(y) * fog.zoom;
            var width = bitmap.width * fog.zoom, height = bitmap.height * fog.zoom;
            context.save();
            try {
                context.globalAlpha = Math.max(0, Math.min(1, fog.opacity / 255));
                context.globalCompositeOperation = ['source-over', 'lighter', 'multiply', 'screen'][fog.blend] || 'source-over';
                if (fog.hue) context.filter = 'hue-rotate(' + fog.hue + 'deg)';
                var firstX = -((x % width + width) % width), firstY = -((y % height + height) % height);
                for (var drawY = firstY; drawY < canvas.height; drawY += height) {
                    for (var drawX = firstX; drawX < canvas.width; drawX += width) context.drawImage(bitmap, drawX, drawY, width, height);
                }
            } finally { context.restore(); }
        });
    };

    CanvasRenderer.prototype.drawParallax = function (bitmap, parallax, startX, startY) {
        if (!bitmap) return;
        var fixed = (parallax.name || '').startsWith('!');
        var x = fixed ? startX * TILE_SIZE + (parallax.x || 0) * 2 : parallax.loopX ? startX * TILE_SIZE / 2 + (parallax.x || 0) : 0;
        var y = fixed ? startY * TILE_SIZE + (parallax.y || 0) * 2 : parallax.loopY ? startY * TILE_SIZE / 2 + (parallax.y || 0) : 0;
        x = -((Math.floor(x) % bitmap.width + bitmap.width) % bitmap.width);
        y = -((Math.floor(y) % bitmap.height + bitmap.height) % bitmap.height);
        for (var drawY = y; drawY < this.canvas.height; drawY += bitmap.height) {
            for (var drawX = x; drawX < this.canvas.width; drawX += bitmap.width) this.context.drawImage(bitmap, drawX, drawY);
        }
    };

    CanvasRenderer.prototype.draw = async function (engine) {
        var frame = ++this.frame;
        if (engine.state && engine.state.scene === 'battle' && engine.battle && engine.battle.battle) {
            return this.drawBattle(engine, frame);
        }
        return this.drawMap(engine, frame);
    };

    CanvasRenderer.prototype.animationImages = function (engine, battle) {
        var renderer = this;
        return Promise.all((engine.animations ? engine.animations.entries.slice() : []).filter(function (entry) {
            return (entry.scope === 'battle') === battle;
        }).map(async function (entry) {
            var data = engine.database.Animations[entry.animationId];
            return { entry: entry, data: data,
                first: data.animation1Name ? await renderer.loadImage('img/animations/' + data.animation1Name + '.png') : null,
                second: data.animation2Name ? await renderer.loadImage('img/animations/' + data.animation2Name + '.png') : null };
        }));
    };

    CanvasRenderer.prototype.drawBattle = async function (engine, frame) {
        var battle = engine.battle.battle, renderer = this;
        var screen = engine.screen && engine.screen.screen;
        var pictures = await this.pictureImages(screen);
        var animations = await this.animationImages(engine, true);
        var fogs = await this.fogImages(screen, true);
        var fogView = engine.map.viewport(engine.state, this.canvas.width, this.canvas.height);
        var names = screen && screen.battlebacks || (engine.map.data.specifyBattleback ?
            [engine.map.data.battleback1Name, engine.map.data.battleback2Name] : ['', '']);
        var backgrounds = await Promise.all(names.map(function (name, index) {
            return name ? renderer.loadImage('img/battlebacks' + (index + 1) + '/' + name + '.png') : null;
        }));
        var enemies = await Promise.all(battle.enemies.filter(function (enemy) {
            return enemy.alive && !enemy.hidden && enemy.battlerName;
        }).map(async function (enemy) {
            var folder = engine.database.System.optSideView ? 'sv_enemies' : 'enemies';
            return { enemy: enemy, bitmap: await renderer.loadImage('img/' + folder + '/' + enemy.battlerName + '.png') };
        }));
        if (frame !== this.frame || engine.state.scene !== 'battle' || engine.battle.battle !== battle) return;
        if (!backgrounds.some(Boolean) && this.battleSnapshotFor !== battle) {
            this.battleSnapshotFor = battle;
            this.battleSnapshot = (async function () {
                var snapshot = document.createElement('canvas');
                var mapRenderer = new CanvasRenderer(snapshot, { baseUrl: renderer.baseUrl,
                    width: renderer.canvas.width, height: renderer.canvas.height });
                mapRenderer.images = renderer.images;
                await mapRenderer.drawMap(engine, ++mapRenderer.frame);
                return snapshot;
            }());
        }
        var backdrop = !backgrounds.some(Boolean) ? await this.battleSnapshot : null;
        if (frame !== this.frame || engine.state.scene !== 'battle' || engine.battle.battle !== battle) return;
        var context = this.context, width = this.canvas.width, height = this.canvas.height;
        context.save();
        try {
            context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
            if (!backgrounds.some(Boolean)) {
                context.filter = 'blur(8px)';
                context.drawImage(backdrop, 0, 0); context.filter = 'none';
            }
            this.drawFogs(fogs, 7, fogView.startX, fogView.startY);
            backgrounds.forEach(function (bitmap, index) {
                if (bitmap) {
                    var scale = Math.max(1, width / bitmap.width, height / bitmap.height);
                    var drawWidth = bitmap.width * scale, drawHeight = bitmap.height * scale;
                    context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
                }
                renderer.drawFogs(fogs, index === 0 ? 6 : 5, fogView.startX, fogView.startY);
            });
            context.scale(width / 816, height / 624);
            enemies.sort(function (a, b) { return a.enemy.y - b.enemy.y || a.enemy.index - b.enemy.index; });
            enemies.forEach(function (entry) {
                var enemy = entry.enemy, bitmap = entry.bitmap;
                var flash = engine.animations && engine.animations.targetEffect(enemy.index, null, 'enemy');
                if (!flash || !flash.hide) {
                    context.drawImage(bitmap, enemy.x - bitmap.width / 2, enemy.y - bitmap.height);
                    if (flash) renderer.drawBattlerFlash(bitmap, enemy.x - bitmap.width / 2, enemy.y - bitmap.height, flash);
                }
            });
            animations.forEach(function (animation) {
                var entry = animation.entry, data = animation.data;
                var target = enemies.find(function (item) { return entry.targetType === 'enemy' && item.enemy.index === entry.targetId; });
                var actorIndex = entry.targetType === 'actor' ? battle.actors.findIndex(function (actor) { return actor.id === entry.targetId; }) : -1;
                if (data.position === 3) renderer.drawAnimationCells(animation, 408, 312);
                else if (actorIndex >= 0) renderer.drawAnimationCells(animation, 816 * (actorIndex + 0.5) / battle.actors.length, 576);
                else if (target) renderer.drawAnimationCells(animation, target.enemy.x, target.enemy.y -
                    (data.position === 0 ? target.bitmap.height : data.position === 1 ? target.bitmap.height / 2 : 0));
            });
            [4, 3, 2, 1, 0].forEach(function (depth) { renderer.drawFogs(fogs, depth, fogView.startX, fogView.startY); });
        } finally { context.restore(); }
        if (screen) this.applyTone(context, width, height, screen.tone);
        pictures.forEach(function (entry) { renderer.drawPicture(entry); });
        this.drawScreenEffects(screen, engine.state);
        return { battle: battle.troopId, enemies: enemies.length };
    };

    CanvasRenderer.prototype.drawMap = async function (engine, frame) {
        var map = engine.map, state = engine.state;
        if (!map || !state) return;
        var screen = engine.screen && engine.screen.screen;
        var lightSources = engine.lighting ? engine.lighting.sources(map) : [];
        var parallaxName = screen && screen.parallax ? screen.parallax.name : map.data.parallaxName;
        var parallax = parallaxName ? await this.loadImage('img/parallaxes/' + parallaxName + '.png') : null;
        var pictures = await this.pictureImages(screen);
        var fogs = await this.fogImages(screen, false);
        var animationBitmaps = await this.animationImages(engine, false);
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
        if (state.followersVisible) {
            state.followers().forEach(function (position) {
                var follower = state.actor(position.id);
                if (!follower) return;
                actors.push({ x: position.x, y: position.y, priority: 1, id: 100000 + position.id, image: {
                    characterName: follower.characterName, characterIndex: follower.characterIndex,
                    direction: position.direction, pattern: animationPattern(state, 1)
                }, transparent: state.transparent, opacity: state.opacity, blendMode: state.blendMode, balloon: null });
            });
        }
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
        try {
            var shake = screen && screen.shake;
            if (shake && shake.remaining > 0) context.translate(Math.sin(shake.phase * shake.speed / 10) * shake.power * 2, 0);
            this.drawParallax(parallax, screen && screen.parallax || { name: map.data.parallaxName, loopX: map.data.parallaxLoopX,
                loopY: map.data.parallaxLoopY }, startX, startY);
            this.drawFogs(fogs, 7, startX, startY);
            var mapFilters = engine.filters ? engine.filters.forTarget(2) : [];
            if (mapFilters.length) {
                if (!this.mapCanvas) this.mapCanvas = document.createElement('canvas');
                if (this.mapCanvas.width !== this.canvas.width) this.mapCanvas.width = this.canvas.width;
                if (this.mapCanvas.height !== this.canvas.height) this.mapCanvas.height = this.canvas.height;
                this.context = this.mapCanvas.getContext('2d');
                this.context.imageSmoothingEnabled = false;
                this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
            }
            try {
                var upper = [], renderer = this;
                for (var y = Math.floor(startY); y < Math.min(map.height, startY + rows); y += 1) {
                    for (var x = Math.floor(startX); x < Math.min(map.width, startX + cols); x += 1) {
                        for (var z = 0; z < 4; z += 1) {
                            var tileId = map.tileId(x, y, z);
                            if ((map.tileset.flags[tileId] & 0x10) !== 0) upper.push([tileId, x - startX, y - startY]);
                            else this.drawTile(sheets, tileId, x - startX, y - startY);
                        }
                    }
                }
                this.drawFogs(fogs, 6, startX, startY);
                actors.sort(function (a, b) { return a.priority - b.priority || a.y - b.y || a.id - b.id; });
                actors.forEach(function (entry) {
                    if (entry.priority === 0) renderer.drawActor(sheets, entry, startX, startY);
                });
                this.drawFogs(fogs, 5, startX, startY);
                actors.forEach(function (entry) {
                    if (entry.priority === 1) renderer.drawActor(sheets, entry, startX, startY);
                });
                this.drawFogs(fogs, 4, startX, startY);
                upper.forEach(function (tile) { renderer.drawTile(sheets, tile[0], tile[1], tile[2]); });
                this.drawFogs(fogs, 3, startX, startY);
                actors.forEach(function (entry) {
                    if (entry.priority === 2) renderer.drawActor(sheets, entry, startX, startY);
                });
                this.drawFogs(fogs, 2, startX, startY);
                if (balloonBitmap) actors.forEach(function (entry) { renderer.drawBalloon(balloonBitmap, entry, startX, startY); });
            } finally { this.context = context; }
            if (mapFilters.length) context.drawImage(engine.filters.apply(this.mapCanvas, mapFilters), 0, 0);
            var wholeMapFilters = engine.filters ? engine.filters.forTarget(21) : [];
            if (wholeMapFilters.length) {
                var filtered = engine.filters.apply(this.canvas, wholeMapFilters);
                context.save(); context.setTransform(1,0,0,1,0,0);
                context.clearRect(0,0,this.canvas.width,this.canvas.height);
                context.drawImage(filtered,0,0); context.restore();
            }
            if (engine.lighting) this.drawLighting(engine.lighting, lightSources, state, viewport);
            animationBitmaps.forEach(function (animation) { renderer.drawAnimation(animation, state, map, startX, startY); });
            this.drawFogs(fogs, 1, startX, startY); this.drawFogs(fogs, 0, startX, startY);
            if (state.regionCover && state.regionCover.enabled) this.drawRegionCover(map, state.regionCover, startX, startY, cols, rows);
            // Tint thuộc lớp bản đồ; picture giao diện giữ màu riêng.
            if (screen) this.applyTone(context, this.canvas.width, this.canvas.height, screen.tone);
            this.drawWeather(screen && screen.weather);
            pictures.forEach(function (entry) { renderer.drawPicture(entry); });
        } finally { this.context = context; context.restore(); }
        this.drawScreenEffects(screen, state);
        return { startX: startX, startY: startY };
    };

    CanvasRenderer.prototype.drawScreenEffects = function (screen, state) {
        var context = this.context;
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
    };

    CanvasRenderer.prototype.drawLighting = function (runtime, sources, player, viewport) {
        if (!runtime.definitions.length) return;
        if (!this.lightCanvas) this.lightCanvas = document.createElement('canvas');
        var mask = this.lightCanvas;
        if (mask.width !== this.canvas.width) mask.width = this.canvas.width;
        if (mask.height !== this.canvas.height) mask.height = this.canvas.height;
        var context = mask.getContext('2d'), light = runtime.lighting, renderer = this;
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = '#000'; context.fillRect(0, 0, mask.width, mask.height);
        context.globalCompositeOperation = 'lighter';
        var x = (player.x - viewport.startX + 0.5) * 48, y = (player.y - viewport.startY + 0.5) * 48;
        if (light.flashlight) {
            this.drawLight(context, x, y, { radius: 40, color: '#999999', brightness: 0 }, light.time, 0);
            var beam = light.flashlight, delta = { 2: [0,1], 4: [-1,0], 6: [1,0], 8: [0,-1] }[player.direction] || [0,1];
            for (var index = 1; index < beam.length; index++) {
                var distance = 3 * index * (index + 1);
                this.drawLight(context, x + delta[0] * distance, y + delta[1] * distance,
                    { radius: index * beam.width, color: beam.color, brightness: Math.min(0.99, 3 / beam.width) }, light.time, 0);
            }
        } else this.drawLight(context, x, y, { radius: light.radius, color: light.color, fire: light.fire,
            brightness: light.radius > 0 ? Math.min(0.99, 20 / light.radius) : 0 }, light.time, 0);
        sources.forEach(function (source) {
            renderer.drawLight(context, (source.event.x - viewport.startX + 0.5) * 48,
                (source.event.y - viewport.startY + 0.5) * 48, source, light.time, source.event.id);
        });
        this.context.save(); this.context.globalCompositeOperation = 'multiply';
        this.context.drawImage(mask, 0, 0); this.context.restore();
    };

    CanvasRenderer.prototype.drawLight = function (context, x, y, source, time, seed) {
        var radius = Math.max(0, source.radius + (source.fire ? Math.sin(time * 0.4 + seed) * 7 : 0));
        if (source.radius <= 0 || radius <= 0) return;
        context.save();
        if (source.direction) {
            context.beginPath();
            var horizontal = source.direction === 2 || source.direction === 4;
            context.rect(x - (source.direction === 4 ? 0 : radius), y - (source.direction === 1 ? 0 : radius),
                radius * (horizontal ? 1 : 2), radius * (horizontal ? 2 : 1));
            context.clip();
        }
        var gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, source.color);
        if (source.brightness > 0) gradient.addColorStop(Math.min(0.99, source.brightness), source.color);
        gradient.addColorStop(1, '#000');
        context.fillStyle = gradient; context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        context.restore();
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

    CanvasRenderer.prototype.drawAnimation = function (animation, state, map, startX, startY) {
        var entry = animation.entry, data = animation.data;
        var frame = Math.floor(entry.elapsed / 4);
        if (frame < 0 || frame >= data.frames.length) return;
        var target = entry.targetId === -1 ? state : map.eventById(entry.targetId);
        if (!target) return;
        this.drawAnimationCells(animation, (target.x - startX + 0.5) * TILE_SIZE,
            (target.y - startY + (data.position === 2 ? 1 : data.position === 0 ? 0.35 : 0.5)) * TILE_SIZE);
    };

    CanvasRenderer.prototype.drawAnimationCells = function (animation, x, y) {
        var entry = animation.entry, data = animation.data, frame = Math.floor(entry.elapsed / 4), renderer = this;
        if (frame < 0 || frame >= data.frames.length) return;
        (data.frames[frame] || []).forEach(function (cell) {
            var pattern = cell[0], bitmap = pattern >= 100 ? animation.second : animation.first;
            if (pattern < 0 || !bitmap) return;
            pattern %= 100;
            var scale = Number(cell[3] == null ? 100 : cell[3]) / 100;
            var context = renderer.context, mirror = entry.mirror ? -1 : 1;
            context.save();
            context.globalAlpha = Math.max(0, Math.min(1, Number(cell[6] == null ? 255 : cell[6]) / 255));
            context.globalCompositeOperation = ['source-over', 'lighter', 'multiply', 'screen'][cell[7] || 0] || 'source-over';
            context.translate(x + Number(cell[1] || 0) * mirror, y + Number(cell[2] || 0));
            context.rotate(Number(cell[4] || 0) * Math.PI / 180 * mirror);
            context.scale((cell[5] ? -1 : 1) * mirror, 1);
            context.drawImage(bitmap, (pattern % 5) * 192, Math.floor(pattern / 5) * 192,
                192, 192, -96 * scale, -96 * scale, 192 * scale, 192 * scale);
            context.restore();
        });
    };

    CanvasRenderer.prototype.drawBattlerFlash = function (bitmap, x, y, flash) {
        if (!this.flashCanvas) this.flashCanvas = document.createElement('canvas');
        var canvas = this.flashCanvas;
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        var context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        context.globalCompositeOperation = 'source-in';
        context.fillStyle = 'rgba(' + flash.color.slice(0, 3).concat(flash.color[3] / 255 * flash.remaining / Math.max(1, flash.duration)).join(',') + ')';
        context.fillRect(0, 0, canvas.width, canvas.height);
        this.context.drawImage(canvas, x, y);
    };

    CanvasRenderer.prototype.drawRegionCover = function (map, cover, startX, startY, cols, rows) {
        var context = this.context;
        context.save(); context.fillStyle = '#000';
        for (var y = Math.floor(startY); y < Math.min(map.height, startY + rows); y += 1) {
            for (var x = Math.floor(startX); x < Math.min(map.width, startX + cols); x += 1) {
                if (!cover.open.includes(map.regionId(x, y))) context.fillRect((x - startX) * TILE_SIZE, (y - startY) * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }
        context.restore();
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
