'use strict';
/* ============================================================
   FNH Engine — bản đồ đầu tiên, di chuyển và tạm dừng
   ============================================================ */
(function () {
    const FNH = window.FNH = window.FNH || {};

    const MOVE_TIME = 0.145;
    const GUARD_X = 27;
    const GUARD_Y = 64;

    function directionOffset(direction) {
        if (direction === 4) return { x: -1, y: 0 };
        if (direction === 6) return { x: 1, y: 0 };
        if (direction === 8) return { x: 0, y: -1 };
        return { x: 0, y: 1 };
    }

    function oppositeDirection(direction) {
        if (direction === 2) return 8;
        if (direction === 8) return 2;
        if (direction === 4) return 6;
        return 4;
    }

    FNH.Scene_Map = class Scene_Map extends FNH.Scene {
        constructor() {
            super();
            this.name = 'map';
            this.time = 0;
            this.ready = false;
            this.leaving = false;
            this.map = null;
            this.tileset = null;
            this.tileImages = new Map();
            this.eventImages = new Map();
            this.eventPending = new Set();
            this.events = [];
            this.camera = { x: 0, y: 0 };
            this.playerVisual = { x: 27, y: 67 };
            this.moving = false;
            this.moveT = 0;
            this.fromX = 27;
            this.fromY = 67;
            this.toX = 27;
            this.toY = 67;
            this.stepPattern = 1;
            this.moveCooldown = 0;
            this.bump = 0;
            this.bannerTimer = 0;
            this.paused = false;
            this.pauseIndex = 0;
            this.pauseSaveInfo = null;
            this.pauseHover = -1;
            this.guard = { x: GUARD_X, y: GUARD_Y, alive: true };
        }

        enter(options) {
            this.time = 0;
            this.ready = false;
            this.leaving = false;
            this.paused = false;
            this.bannerTimer = 3.8;
            this.map = null;
            this.tileset = null;
            this.tileImages.clear();
            this.eventImages.clear();
            this.eventPending.clear();
            this.moving = false;
            this.moveT = 0;
            this.moveCooldown = 0;
            this.stepPattern = 1;
            this.guard.alive = !this.game.guardDefeated;
            this.playerVisual.x = this.game.player.mapX;
            this.playerVisual.y = this.game.player.mapY;
            this.loadMap().catch((error) => {
                console.error('[FNH] Không mở được bản đồ:', error);
                this.game.showToast('Không mở được bản đồ: ' + error.message, 6);
            });
        }

        async loadMap() {
            const game = this.game;
            this.map = await game.data.map(game.mapId);
            this.tileset = game.data.tileset(this.map.tilesetId);
            if (!this.map || !this.tileset) throw new Error('Thiếu dữ liệu bản đồ hoặc tileset.');

            const names = [];
            for (let i = 4; i <= 8; i += 1) {
                const name = this.tileset.tilesetNames[i];
                if (name) names.push(name);
            }
            await Promise.all(names.map(async (name) => {
                try {
                    const image = await game.assets.loadImage('tilesets/' + name);
                    this.tileImages.set(name, image);
                } catch (error) {
                    console.warn('[FNH] Không nạp được tileset ' + name + ':', error.message);
                }
            }));

            try {
                await game.assets.loadImage('characters/' + game.player.characterName);
            } catch (error) {
                console.warn('[FNH] Không nạp được nhân vật:', error.message);
            }
            try {
                await game.assets.loadImage('characters/$guard1');
            } catch (error) {
                console.warn('[FNH] Không nạp được guard:', error.message);
            }

            this.events = this.map.events.filter(Boolean).map((event) => {
                const page = event.pages.find(function (item) {
                    return item.image && (item.image.characterName || item.image.tileId > 0);
                });
                if (!page) return null;
                return {
                    id: event.id,
                    name: event.name,
                    x: event.x,
                    y: event.y,
                    page: page,
                    imageName: page.image.characterName,
                    imageIndex: page.image.characterIndex,
                    direction: page.image.direction || 2,
                    pattern: page.image.pattern || 0,
                    priority: page.priorityType || 1,
                    animated: /flame|fire/i.test(page.image.characterName || '')
                };
            }).filter(Boolean);

            // Ưu tiên vị trí event gốc cho encounter Guard; bản đồ tùy biến
            // hoặc bản dump thiếu tên vẫn dùng tọa độ vertical slice hiện tại.
            const guardEvent = this.events.find((event) => {
                const text = ((event.name || '') + ' ' + (event.imageName || '')).toLowerCase();
                return text.includes('guard');
            });
            if (guardEvent) {
                this.guard.x = guardEvent.x;
                this.guard.y = guardEvent.y;
            } else {
                this.guard.x = GUARD_X;
                this.guard.y = GUARD_Y;
            }

            this.camera.x = this.clampCameraX(this.playerVisual.x * FNH.TILE + FNH.TILE / 2 - FNH.WIDTH / 2);
            this.camera.y = this.clampCameraY(this.playerVisual.y * FNH.TILE + FNH.TILE - FNH.HEIGHT / 2);
            this.ready = true;

            game.audio.stopBgm(0.5);
            game.audio.playBgs('minor_terror', { volume: 0.34, loop: true });
            this.updateEventImages();
        }

        clampCameraX(value) {
            if (!this.map) return 0;
            const max = Math.max(0, this.map.width * FNH.TILE - FNH.WIDTH);
            return FNH.clamp(value, 0, max);
        }

        clampCameraY(value) {
            if (!this.map) return 0;
            const max = Math.max(0, this.map.height * FNH.TILE - FNH.HEIGHT);
            return FNH.clamp(value, 0, max);
        }

        finishMove() {
            if (!this.moving) return;
            this.moving = false;
            this.game.player.mapX = this.toX;
            this.game.player.mapY = this.toY;
            this.playerVisual.x = this.toX;
            this.playerVisual.y = this.toY;
            this.stepPattern = 1;
        }

        checkTransfer() {
            const transfer = this.game.data.transferAt(this.map, this.game.player.mapX, this.game.player.mapY);
            if (!transfer || !transfer.mapId || transfer.mapId === this.game.mapId) return false;
            this.game.mapId = transfer.mapId;
            this.game.player.mapX = transfer.x;
            this.game.player.mapY = transfer.y;
            this.game.player.direction = transfer.direction;
            this.leaving = true;
            this.game.changeScene(FNH.Scene_Map, { fromTransfer: true });
            return true;
        }

        openPause() {
            this.finishMove();
            this.paused = true;
            this.pauseIndex = 0;
            this.pauseHover = -1;
            this.pauseSaveInfo = this.game.getSaveInfo();
            this.game.audio.playSe('fnh_choice', { volume: 0.45 });
        }

        closePause() {
            this.paused = false;
            this.game.audio.playSe('fnh_cancel', { volume: 0.4 });
        }

        pauseEntries() {
            return [
                { id: 'resume', label: 'TIẾP TỤC', enabled: true },
                { id: 'save', label: 'LƯU GAME', enabled: true },
                { id: 'load', label: 'TẢI GAME', enabled: !!this.pauseSaveInfo },
                { id: 'sound', label: this.game.audio.muted ? 'ÂM THANH: TẮT' : 'ÂM THANH: BẬT', enabled: true },
                { id: 'title', label: 'VỀ MÀN HÌNH CHÍNH', enabled: true }
            ];
        }

        pausePanelRect() {
            return { x: 214, y: 72, width: 388, height: 486 };
        }

        pauseEntryRects() {
            const panel = this.pausePanelRect();
            return this.pauseEntries().map(function (entry, index) {
                return {
                    x: panel.x + 24,
                    y: panel.y + 158 + index * 48,
                    width: panel.width - 48,
                    height: 40
                };
            });
        }

        movePauseSelection(step) {
            const entries = this.pauseEntries();
            let next = this.pauseIndex;
            for (let i = 0; i < entries.length; i += 1) {
                next = (next + step + entries.length) % entries.length;
                if (entries[next].enabled) break;
            }
            if (next !== this.pauseIndex) {
                this.pauseIndex = next;
                this.game.audio.playSe('fnh_cursor', { volume: 0.4 });
            }
        }

        activatePause(index) {
            const entries = this.pauseEntries();
            const entry = entries[index];
            if (!entry || !entry.enabled) return;
            this.game.audio.playSe('fnh_choice', { volume: 0.5 });
            if (entry.id === 'resume') {
                this.closePause();
            } else if (entry.id === 'save') {
                if (this.game.saveGame()) {
                    this.pauseSaveInfo = this.game.getSaveInfo();
                    this.game.showToast('Đã lưu: ' + this.game.player.name + ' · ' + FNH.formatTime(this.game.playtime), 2.2);
                } else {
                    this.game.showToast('Không lưu được game.', 2.5);
                }
            } else if (entry.id === 'load') {
                this.leaving = true;
                this.game.loadGame();
            } else if (entry.id === 'sound') {
                this.game.toggleMute();
            } else if (entry.id === 'title') {
                this.leaving = true;
                this.game.returnToTitle();
            }
        }

        updatePause(dt) {
            const input = this.input;
            if (input.isPressed('Escape', 'x', 'X')) {
                this.closePause();
                return;
            }
            if (input.isPressed('ArrowUp', 'w', 'W')) this.movePauseSelection(-1);
            if (input.isPressed('ArrowDown', 's', 'S')) this.movePauseSelection(1);
            if (input.isPressed('Enter', ' ', 'z', 'Z')) this.activatePause(this.pauseIndex);

            const rects = this.pauseEntryRects();
            this.pauseHover = -1;
            for (let i = 0; i < rects.length; i += 1) {
                if (FNH.hit(rects[i], input.mouse.x, input.mouse.y)) {
                    this.pauseHover = i;
                    break;
                }
            }
            if (this.pauseHover >= 0 && this.pauseEntries()[this.pauseHover].enabled &&
                this.pauseHover !== this.pauseIndex) {
                this.pauseIndex = this.pauseHover;
                this.game.audio.playSe('fnh_cursor', { volume: 0.35 });
            }

            const click = input.consumeClick();
            if (click) {
                for (let i = 0; i < rects.length; i += 1) {
                    if (FNH.hit(rects[i], click.x, click.y)) {
                        this.pauseIndex = i;
                        this.activatePause(i);
                        break;
                    }
                }
            }
        }

        update(dt) {
            this.time += dt;
            if (this.bannerTimer > 0) this.bannerTimer -= dt;
            if (this.bump > 0) this.bump = Math.max(0, this.bump - dt * 4);
            if (!this.ready || this.leaving) return;
            if (this.paused) {
                this.updatePause(dt);
                return;
            }

            const input = this.input;
            if (input.isPressed('Escape', 'x', 'X')) {
                this.openPause();
                return;
            }
            if (input.isPressed('m', 'M')) this.game.toggleMute();
            if (input.isPressed('Enter', ' ', 'z', 'Z')) {
                this.interact();
                return;
            }

            this.updateMovement(dt);
            this.updateCamera(dt);
            this.updateEventImages();
        }

        readDirection() {
            const input = this.input;
            if (input.isDown('ArrowUp', 'w', 'W')) return 8;
            if (input.isDown('ArrowDown', 's', 'S')) return 2;
            if (input.isDown('ArrowLeft', 'a', 'A')) return 4;
            if (input.isDown('ArrowRight', 'd', 'D')) return 6;
            return 0;
        }

        updateMovement(dt) {
            const player = this.game.player;
            if (this.moving) {
                this.moveT += dt / MOVE_TIME;
                if (this.moveT >= 1) {
                    this.moving = false;
                    this.moveT = 0;
                    player.mapX = this.toX;
                    player.mapY = this.toY;
                    this.playerVisual.x = this.toX;
                    this.playerVisual.y = this.toY;
                    this.stepPattern = 1;
                    this.moveCooldown = 0.045;
                    this.checkTransfer();
                } else {
                    this.playerVisual.x = FNH.lerp(this.fromX, this.toX, this.moveT);
                    this.playerVisual.y = FNH.lerp(this.fromY, this.toY, this.moveT);
                }
                return;
            }

            if (this.moveCooldown > 0) {
                this.moveCooldown -= dt;
                return;
            }
            const direction = this.readDirection();
            if (!direction) return;
            player.direction = direction;
            this.tryMove(direction);
        }

        frontTile() {
            const offset = directionOffset(this.game.player.direction);
            return {
                x: this.game.player.mapX + offset.x,
                y: this.game.player.mapY + offset.y
            };
        }

        isGuardAt(x, y) {
            return this.guard.alive && x === this.guard.x && y === this.guard.y;
        }

        tryMove(direction) {
            const player = this.game.player;
            const offset = directionOffset(direction);
            const nx = player.mapX + offset.x;
            const ny = player.mapY + offset.y;

            if (this.isGuardAt(nx, ny)) {
                this.triggerGuard();
                return false;
            }
            if (!this.game.data.isTilePassable(this.map, this.tileset, nx, ny, direction)) {
                this.bump = 1;
                return false;
            }

            this.fromX = player.mapX;
            this.fromY = player.mapY;
            this.toX = nx;
            this.toY = ny;
            this.moveT = 0;
            this.moving = true;
            this.stepPattern = this.stepPattern === 0 ? 1 : this.stepPattern === 1 ? 2 : 1;
            return true;
        }

        interact() {
            const front = this.frontTile();
            if (this.isGuardAt(front.x, front.y)) {
                this.triggerGuard();
                return;
            }
            const message = this.game.data.messageAt(this.map, front.x, front.y);
            if (message) {
                this.game.showToast(message, Math.max(2.5, Math.min(8, message.length / 14)));
                return;
            }
            this.game.showToast('Không có gì trong bóng tối.', 1.4);
        }

        triggerGuard() {
            if (this.leaving) return;
            this.leaving = true;
            const player = this.game.player;
            const returnDirection = oppositeDirection(player.direction);
            player.mapX = Math.round(this.playerVisual.x);
            player.mapY = Math.round(this.playerVisual.y);
            player.direction = returnDirection;
            this.game.audio.playSe('guard_growl1', { volume: 0.65 });
            this.game.changeScene(FNH.Scene_Battle, {
                returnX: player.mapX,
                returnY: player.mapY,
                returnDir: returnDirection
            });
        }

        updateCamera(dt) {
            const targetX = this.playerVisual.x * FNH.TILE + FNH.TILE / 2 - FNH.WIDTH / 2;
            const targetY = this.playerVisual.y * FNH.TILE + FNH.TILE - FNH.HEIGHT / 2;
            const speed = 1 - Math.exp(-dt * 9);
            this.camera.x = FNH.lerp(this.camera.x, this.clampCameraX(targetX), speed);
            this.camera.y = FNH.lerp(this.camera.y, this.clampCameraY(targetY), speed);
        }

        updateEventImages() {
            const startX = this.camera.x / FNH.TILE - 2;
            const startY = this.camera.y / FNH.TILE - 2;
            const endX = startX + FNH.WIDTH / FNH.TILE + 4;
            const endY = startY + FNH.HEIGHT / FNH.TILE + 4;
            for (const event of this.events) {
                if (event.x < startX || event.x > endX || event.y < startY || event.y > endY) continue;
                if (!event.imageName) continue;
                if (this.eventImages.has(event.imageName) || this.eventPending.has(event.imageName)) continue;
                this.eventPending.add(event.imageName);
                this.game.assets.loadImage('characters/' + event.imageName).then((image) => {
                    this.eventImages.set(event.imageName, image);
                }).catch(function () {
                    this.eventImages.set(event.imageName, null);
                }.bind(this)).finally(function () {
                    this.eventPending.delete(event.imageName);
                }.bind(this));
            }
        }

        characterFrame(image, name, imageIndex, direction, pattern) {
            const row = direction === 2 ? 0 : direction === 4 ? 1 : direction === 6 ? 2 : 3;
            if (name && name.charAt(0) === '$') {
                const fw = image.width / 3;
                const fh = image.height / 4;
                return {
                    sx: (pattern % 3) * fw,
                    sy: row * fh,
                    sw: fw,
                    sh: fh
                };
            }
            const fw = image.width / 12;
            const fh = image.height / 8;
            const blockX = imageIndex % 4;
            const blockY = Math.floor(imageIndex / 4);
            return {
                sx: (blockX * 3 + (pattern % 3)) * fw,
                sy: (blockY * 4 + row) * fh,
                sw: fw,
                sh: fh
            };
        }

        drawCharacter(ctx, image, name, imageIndex, direction, pattern, footX, footY, options) {
            if (!image) return;
            const frame = this.characterFrame(image, name, imageIndex, direction, pattern);
            const opts = options || {};
            ctx.save();
            if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
            if (opts.filter) ctx.filter = opts.filter;
            ctx.drawImage(
                image,
                frame.sx, frame.sy, frame.sw, frame.sh,
                footX - frame.sw / 2, footY - frame.sh,
                frame.sw, frame.sh
            );
            ctx.restore();
        }

        drawShadow(ctx, x, y, width, alpha) {
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,' + (alpha === undefined ? 0.36 : alpha) + ')';
            ctx.beginPath();
            ctx.ellipse(x, y - 2, width / 2, 7, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        drawTiles(ctx, upper) {
            if (!this.map || !this.tileset) return;
            const startX = Math.max(0, Math.floor(this.camera.x / FNH.TILE));
            const startY = Math.max(0, Math.floor(this.camera.y / FNH.TILE));
            const endX = Math.min(this.map.width, startX + Math.ceil(FNH.WIDTH / FNH.TILE) + 2);
            const endY = Math.min(this.map.height, startY + Math.ceil(FNH.HEIGHT / FNH.TILE) + 2);

            for (let y = startY; y < endY; y += 1) {
                for (let x = startX; x < endX; x += 1) {
                    for (let z = 0; z < 4; z += 1) {
                        const tileId = this.game.data.tileIdAt(this.map, x, y, z);
                        if (!tileId) continue;
                        const higher = this.game.data.isHigherTile(this.tileset, tileId);
                        if (higher !== upper) continue;
                        const source = this.game.data.tileSource(this.tileset, tileId);
                        if (!source) continue;
                        const image = this.tileImages.get(source.name);
                        if (!image) continue;
                        const dx = Math.round(x * FNH.TILE - this.camera.x);
                        const dy = Math.round(y * FNH.TILE - this.camera.y);
                        ctx.drawImage(image, source.sx, source.sy, FNH.TILE, FNH.TILE, dx, dy, FNH.TILE, FNH.TILE);
                    }
                }
            }
        }

        drawEvent(ctx, event, footX, footY) {
            if (!event.imageName) return;
            const image = this.eventImages.get(event.imageName);
            if (!image) return;
            let pattern = event.pattern;
            if (event.animated) {
                pattern = Math.floor(this.time * 5 + event.id) % 3;
            }
            this.drawShadow(ctx, footX, footY, event.imageName.charAt(0) === '$' ? 52 : 38, 0.3);
            this.drawCharacter(ctx, image, event.imageName, event.imageIndex, event.direction, pattern, footX, footY);
        }

        drawGuard(ctx) {
            if (!this.guard.alive) return;
            const image = this.game.assets.imageCache.get('characters/$guard1');
            if (!image) return;
            const footX = this.guard.x * FNH.TILE + FNH.TILE / 2 - this.camera.x;
            const footY = this.guard.y * FNH.TILE + FNH.TILE - this.camera.y;
            const glow = ctx.createRadialGradient(footX, footY - 26, 4, footX, footY - 26, 54);
            glow.addColorStop(0, 'rgba(122,26,20,0.2)');
            glow.addColorStop(1, 'rgba(122,26,20,0)');
            ctx.save();
            ctx.fillStyle = glow;
            ctx.fillRect(footX - 60, footY - 90, 120, 120);
            ctx.restore();
            this.drawShadow(ctx, footX, footY, 54, 0.42);
            this.drawCharacter(ctx, image, '$guard1', 0, 2, 1, footX, footY);
        }

        drawCharacters(ctx) {
            const sprites = [];
            const player = this.game.player;
            const playerFootX = this.playerVisual.x * FNH.TILE + FNH.TILE / 2 - this.camera.x;
            const playerFootY = this.playerVisual.y * FNH.TILE + FNH.TILE - this.camera.y;
            sprites.push({
                y: playerFootY,
                priority: 1,
                draw: () => {
                    this.drawShadow(ctx, playerFootX, playerFootY, 40, 0.35);
                    this.drawCharacter(
                        ctx,
                        this.game.assets.imageCache.get('characters/' + player.characterName),
                        player.characterName,
                        player.characterIndex,
                        player.direction,
                        this.stepPattern,
                        playerFootX,
                        playerFootY
                    );
                }
            });

            for (const event of this.events) {
                if (event.priority === 2) continue;
                const footX = event.x * FNH.TILE + FNH.TILE / 2 - this.camera.x;
                const footY = event.y * FNH.TILE + FNH.TILE - this.camera.y;
                if (footX < -160 || footX > FNH.WIDTH + 160 || footY < -220 || footY > FNH.HEIGHT + 220) continue;
                sprites.push({
                    y: footY,
                    priority: event.priority,
                    draw: () => this.drawEvent(ctx, event, footX, footY)
                });
            }

            if (this.guard.alive) {
                const footY = this.guard.y * FNH.TILE + FNH.TILE - this.camera.y;
                sprites.push({
                    y: footY,
                    priority: 1,
                    draw: () => this.drawGuard(ctx)
                });
            }

            sprites.sort(function (a, b) {
                if (a.priority !== b.priority) return a.priority - b.priority;
                return a.y - b.y;
            });
            for (const sprite of sprites) sprite.draw();
        }

        drawAboveCharacters(ctx) {
            for (const event of this.events) {
                if (event.priority !== 2) continue;
                const footX = event.x * FNH.TILE + FNH.TILE / 2 - this.camera.x;
                const footY = event.y * FNH.TILE + FNH.TILE - this.camera.y;
                if (footX < -160 || footX > FNH.WIDTH + 160 || footY < -220 || footY > FNH.HEIGHT + 220) continue;
                this.drawEvent(ctx, event, footX, footY);
            }
        }

        drawHud(ctx) {
            const player = this.game.player;
            const face = this.game.assets.imageCache.get('faces/' + player.faceName);
            FNH.panel(ctx, 16, 16, 314, 82, {
                alpha: 0.88,
                fillTop: 'rgba(16,15,13,0.9)',
                fillBottom: 'rgba(5,5,5,0.92)',
                border: 'rgba(166,148,110,0.42)'
            });
            if (face) {
                const rect = FNH.faceRect(player.faceIndex, 58);
                ctx.save();
                ctx.beginPath();
                ctx.rect(26, 28, 58, 58);
                ctx.clip();
                ctx.drawImage(face, rect.sx, rect.sy, rect.sw, rect.sh, 26, 28, 58, 58);
                ctx.restore();
                ctx.strokeStyle = 'rgba(188,166,118,0.45)';
                ctx.strokeRect(26.5, 28.5, 57, 57);
            }
            FNH.text(ctx, player.name, 96, 40, {
                size: 16,
                weight: 600,
                color: '#efe2c6'
            });
            FNH.text(ctx, player.className + ' · Cấp ' + player.level, 96, 56, {
                size: 10,
                color: 'rgba(210,195,160,0.62)'
            });
            FNH.bar(ctx, 96, 64, 160, 8, player.hp / player.maxHp, {
                colorA: '#5f1818',
                colorB: '#a83c2c'
            });
            FNH.text(ctx, 'HP ' + player.hp + '/' + player.maxHp, 264, 71, {
                size: 9,
                color: 'rgba(233,218,188,0.78)'
            });
            FNH.bar(ctx, 96, 77, 120, 5, player.mp / Math.max(1, player.maxMp), {
                colorA: '#1f3d57',
                colorB: '#3b6f8f'
            });
            FNH.text(ctx, 'MP ' + player.mp + '/' + player.maxMp, 224, 82, {
                size: 8,
                color: 'rgba(205,215,224,0.6)'
            });
            FNH.text(ctx, 'VÀNG ' + this.game.gold, 310, 40, {
                size: 10,
                color: 'rgba(223,199,141,0.7)',
                align: 'right'
            });

            FNH.panel(ctx, 602, 16, 198, 58, {
                alpha: 0.82,
                fillTop: 'rgba(13,13,12,0.85)',
                fillBottom: 'rgba(4,4,4,0.9)',
                border: 'rgba(142,128,100,0.34)'
            });
            FNH.text(ctx, 'TẦNG 1', 618, 38, {
                size: 13,
                weight: 600,
                color: '#ddcfb2'
            });
            FNH.text(ctx, 'HÀNH LANG PHÍA ĐÔNG', 618, 55, {
                size: 9,
                color: 'rgba(207,193,164,0.54)'
            });
            FNH.text(ctx, this.game.audio.muted ? 'ÂM: TẮT' : 'ÂM: BẬT', 782, 55, {
                size: 9,
                color: 'rgba(207,193,164,0.45)',
                align: 'right'
            });

            const guardDistance = Math.abs(player.mapX - this.guard.x) + Math.abs(player.mapY - this.guard.y);
            if (this.guard.alive && guardDistance === 1) {
                FNH.panel(ctx, 306, 548, 204, 30, {
                    alpha: 0.9,
                    fillTop: 'rgba(30,18,15,0.92)',
                    fillBottom: 'rgba(8,5,5,0.95)',
                    border: 'rgba(175,103,78,0.55)'
                });
                FNH.text(ctx, 'Z / ENTER · ĐỐI ĐẦU GUARD', 408, 568, {
                    size: 11,
                    weight: 600,
                    color: '#e5c4a8',
                    align: 'center'
                });
            }

            FNH.drawKeyHint(ctx, 20, 610, 'WASD', 'di chuyển', { size: 10 });
            FNH.drawKeyHint(ctx, 120, 610, 'Z', 'hành động', { size: 10 });
            FNH.drawKeyHint(ctx, 224, 610, 'ESC', 'tạm dừng', { size: 10 });
            FNH.text(ctx, 'TẦNG NGỤC · ' + FNH.formatTime(this.game.playtime), FNH.WIDTH - 20, 610, {
                size: 10,
                color: 'rgba(210,195,160,0.42)',
                align: 'right'
            });
        }

        drawBanner(ctx) {
            if (this.bannerTimer <= 0) return;
            const elapsed = 3.8 - this.bannerTimer;
            let alpha = 1;
            if (elapsed < 0.5) alpha = elapsed / 0.5;
            if (this.bannerTimer < 0.7) alpha = this.bannerTimer / 0.7;
            ctx.save();
            ctx.globalAlpha = alpha;
            const gradient = ctx.createLinearGradient(0, 130, 0, 240);
            gradient.addColorStop(0, 'rgba(0,0,0,0)');
            gradient.addColorStop(0.5, 'rgba(0,0,0,0.55)');
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 130, FNH.WIDTH, 110);
            FNH.text(ctx, 'TẦNG 1', FNH.WIDTH / 2, 182, {
                size: 34,
                weight: 600,
                color: '#eadcbe',
                align: 'center',
                shadow: true,
                shadowBlur: 12
            });
            FNH.text(ctx, 'HÀNH LANG PHÍA ĐÔNG · NGỤC ĐỊA', FNH.WIDTH / 2, 210, {
                size: 11,
                color: 'rgba(221,204,170,0.72)',
                align: 'center'
            });
            ctx.restore();
        }

        drawPause(ctx) {
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.76)';
            ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
            ctx.restore();

            const panel = this.pausePanelRect();
            FNH.panel(ctx, panel.x, panel.y, panel.width, panel.height, {
                alpha: 0.98,
                fillTop: 'rgba(20,18,15,0.98)',
                fillBottom: 'rgba(5,5,5,0.99)',
                border: 'rgba(192,168,116,0.62)'
            });
            FNH.text(ctx, 'TẠM DỪNG', panel.x + 24, panel.y + 34, {
                size: 22,
                weight: 600,
                color: '#eee0c4'
            });
            ctx.strokeStyle = 'rgba(192,168,116,0.24)';
            ctx.beginPath();
            ctx.moveTo(panel.x + 24, panel.y + 48);
            ctx.lineTo(panel.x + panel.width - 24, panel.y + 48);
            ctx.stroke();

            const player = this.game.player;
            const face = this.game.assets.imageCache.get('faces/' + player.faceName);
            if (face) {
                const rect = FNH.faceRect(player.faceIndex, 84);
                ctx.save();
                ctx.beginPath();
                ctx.rect(panel.x + 24, panel.y + 62, 84, 84);
                ctx.clip();
                ctx.drawImage(face, rect.sx, rect.sy, rect.sw, rect.sh, panel.x + 24, panel.y + 62, 84, 84);
                ctx.restore();
                ctx.strokeStyle = 'rgba(192,168,116,0.42)';
                ctx.strokeRect(panel.x + 24.5, panel.y + 62.5, 83, 83);
            }
            FNH.text(ctx, player.name, panel.x + 122, panel.y + 82, {
                size: 19,
                weight: 600,
                color: '#efe1c5'
            });
            FNH.text(ctx, player.className + ' · Cấp ' + player.level, panel.x + 122, panel.y + 102, {
                size: 11,
                color: 'rgba(211,196,162,0.65)'
            });
            FNH.bar(ctx, panel.x + 122, panel.y + 114, 160, 8, player.hp / player.maxHp, {
                colorA: '#5f1818',
                colorB: '#a83c2c'
            });
            FNH.text(ctx, 'HP ' + player.hp + '/' + player.maxHp, panel.x + 290, panel.y + 121, {
                size: 9,
                color: 'rgba(233,218,188,0.72)'
            });
            FNH.bar(ctx, panel.x + 122, panel.y + 130, 110, 5, player.mp / Math.max(1, player.maxMp), {
                colorA: '#1f3d57',
                colorB: '#3b6f8f'
            });
            FNH.text(ctx, 'MP ' + player.mp + '/' + player.maxMp, panel.x + 240, panel.y + 136, {
                size: 8,
                color: 'rgba(205,215,224,0.6)'
            });

            const entries = this.pauseEntries();
            const rects = this.pauseEntryRects();
            for (let i = 0; i < entries.length; i += 1) {
                FNH.button(ctx, rects[i], entries[i].label, {
                    selected: i === this.pauseIndex,
                    hover: i === this.pauseHover,
                    disabled: !entries[i].enabled,
                    size: 14
                });
            }

            const infoY = panel.y + 410;
            FNH.text(ctx, 'THỜI GIAN CHƠI · ' + FNH.formatTime(this.game.playtime), panel.x + 24, infoY, {
                size: 10,
                color: 'rgba(210,195,160,0.54)'
            });
            if (this.pauseSaveInfo) {
                FNH.text(ctx,
                    'Lần lưu: ' + FNH.formatDate(this.pauseSaveInfo.savedAt) + ' · ' +
                    this.pauseSaveInfo.playerName + ' · Cấp ' + this.pauseSaveInfo.level,
                    panel.x + 24, infoY + 18, {
                        size: 10,
                        color: 'rgba(210,195,160,0.45)'
                    });
            } else {
                FNH.text(ctx, 'Chưa có dữ liệu lưu.', panel.x + 24, infoY + 18, {
                    size: 10,
                    color: 'rgba(210,195,160,0.38)'
                });
            }

            FNH.drawKeyHint(ctx, panel.x + 24, panel.y + panel.height - 18, '↑ ↓', 'chọn', { size: 10 });
            FNH.drawKeyHint(ctx, panel.x + 108, panel.y + panel.height - 18, 'ENTER', 'xác nhận', { size: 10 });
            FNH.drawKeyHint(ctx, panel.x + 216, panel.y + panel.height - 18, 'ESC', 'đóng', { size: 10 });
        }

        draw(ctx) {
            if (!this.ready) {
                FNH.drawBackdrop(ctx, '#0a0a0b', '#020202');
                FNH.text(ctx, 'ĐANG MỞ CÁNH CỬA…', FNH.WIDTH / 2, FNH.HEIGHT / 2, {
                    size: 18,
                    color: 'rgba(225,211,181,0.7)',
                    align: 'center'
                });
                return;
            }

            ctx.fillStyle = '#050505';
            ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
            this.drawTiles(ctx, false);
            this.drawCharacters(ctx);
            this.drawTiles(ctx, true);
            this.drawAboveCharacters(ctx);

            const light = ctx.createRadialGradient(
                FNH.WIDTH / 2, FNH.HEIGHT / 2, 70,
                FNH.WIDTH / 2, FNH.HEIGHT / 2, 470
            );
            light.addColorStop(0, 'rgba(0,0,0,0)');
            light.addColorStop(0.65, 'rgba(0,0,0,0.2)');
            light.addColorStop(1, 'rgba(0,0,0,0.68)');
            ctx.fillStyle = light;
            ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
            FNH.drawVignette(ctx, FNH.WIDTH, FNH.HEIGHT, 0.55);
            FNH.drawGrain(ctx, FNH.WIDTH, FNH.HEIGHT, this.time);

            this.drawHud(ctx);
            this.drawBanner(ctx);
            if (this.paused) this.drawPause(ctx);
        }
    };
})();
