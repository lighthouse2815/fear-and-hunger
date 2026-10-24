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
            this.eventRunner = null;
            this.erasedEvents = new Set();
            this.eventStates = new Map();
            this.moveRoutes = new Map();
            this.playerRouteState = null;
            this.failedAutorunPages = new Set();
            this.parallelEvents = new Map();
            this.dialogRunner = null;
            this.eventChoice = 0;
            this.eventWait = null;
            this.eventId = 0;
            this.guard = { x: GUARD_X, y: GUARD_Y, alive: true };
        }

        enter(options) {
            this.time = 0;
            this.ready = false;
            this.leaving = false;
            this.paused = false;
            this.erasedEvents.clear();
            this.eventStates.clear();
            this.moveRoutes.clear();
            this.playerRouteState = null;
            this.failedAutorunPages.clear();
            this.parallelEvents.clear();
            this.dialogRunner = null;
            this.eventRunner = null;
            this.eventWait = null;
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
            this.guard.alive = this.game.mapId === 1 && !this.game.guardDefeated;
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

            this.refreshEvents();

            // Ưu tiên vị trí event gốc cho encounter Guard; bản đồ tùy biến
            // hoặc bản dump thiếu tên vẫn dùng tọa độ vertical slice hiện tại.
            const guardEvent = this.events.find((event) => {
                return String(event.name || '').trim().toLowerCase() === 'guard';
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

        eventPage(event) {
            if (this.erasedEvents.has(event.id)) return null;
            return this.game.data.eventPage(event, this.game.flags, this.game.mapId, this.game.player);
        }

        eventState(event) {
            let state = this.eventStates.get(event.id);
            if (!state) {
                state = { id: event.id, x: event.x, y: event.y, realX: event.x, realY: event.y };
                this.eventStates.set(event.id, state);
            }
            const page = this.eventPage(event);
            if (state.page !== page) {
                state.page = page;
                const image = page && page.image || {};
                state.imageName = image.characterName || '';
                state.imageIndex = image.characterIndex || 0;
                state.direction = image.direction || 2;
                state.pattern = image.pattern || 0;
                state.priority = page ? page.priorityType ?? 1 : 1;
                state.through = !!(page && page.through);
                state.throughOverride = undefined;
                state.moveSpeed = page && page.moveSpeed || 4;
                state.walkAnime = !page || page.walkAnime !== false;
                state.stepAnime = !!(page && page.stepAnime);
                state.directionFix = !!(page && page.directionFix);
                state.opacity = 255;
                state.transparent = false;
            }
            return state;
        }

        mapCharacter(id) {
            if (id === -1) {
                if (!this.playerRouteState) {
                    const player = this.game.player;
                    const visual = this.playerVisual;
                    this.playerRouteState = {
                        id: -1, moveSpeed: 4, walkAnime: true, opacity: 255,
                        get x() { return player.mapX; }, set x(value) { player.mapX = value; },
                        get y() { return player.mapY; }, set y(value) { player.mapY = value; },
                        get realX() { return visual.x; }, set realX(value) { visual.x = value; },
                        get realY() { return visual.y; }, set realY(value) { visual.y = value; },
                        get direction() { return player.direction; }, set direction(value) { player.direction = value; },
                        get imageName() { return player.characterName; }, set imageName(value) { player.characterName = value; },
                        get imageIndex() { return player.characterIndex; }, set imageIndex(value) { player.characterIndex = value; }
                    };
                }
                return this.playerRouteState;
            }

            const eventId = id === 0 ? this.eventId : id;
            const event = (this.map.events || []).find((entry) => entry && entry.id === eventId);
            return event ? this.eventState(event) : null;
        }

        routeCanPass(character, x, y, direction) {
            const offset = directionOffset(direction);
            const nx = x + offset.x, ny = y + offset.y;
            if (nx < 0 || ny < 0 || nx >= this.map.width || ny >= this.map.height) return false;
            if (character.throughOverride ?? character.through) return true;
            if (!this.game.data.isTilePassable(this.map, this.tileset, x, y, direction) ||
                !this.game.data.isTilePassable(this.map, this.tileset, nx, ny, oppositeDirection(direction))) return false;
            for (const event of this.map.events || []) {
                if (!event || event.id === character.id) continue;
                const page = this.eventPage(event);
                const state = this.eventState(event);
                if ((character.id === -1 || character.priority === 1) && page && page.priorityType === 1 &&
                    !(state.throughOverride ?? page.through) && state.x === nx && state.y === ny) return false;
            }
            if (character.id !== -1 && character.priority === 1 && this.game.player.mapX === nx && this.game.player.mapY === ny) return false;
            return character.id !== -1 || !this.isGuardAt(nx, ny);
        }

        moveRouteCharacter(character, dx, dy, jump = false) {
            const horizontal = dx < 0 ? 4 : 6;
            const vertical = dy < 0 ? 8 : 2;
            if (!jump) {
                const x = character.x, y = character.y;
                const passable = dx && dy
                    ? (this.routeCanPass(character, x, y, vertical) && this.routeCanPass(character, x, y + dy, horizontal)) ||
                      (this.routeCanPass(character, x, y, horizontal) && this.routeCanPass(character, x + dx, y, vertical))
                    : this.routeCanPass(character, x, y, dx ? horizontal : vertical);
                if (!passable) return false;
            }
            const duration = jump ? Math.max(0.2, (20 + Math.round(Math.hypot(dx, dy))) / 60)
                : 256 / (Math.pow(2, character.moveSpeed || 4) * 60);
            character.motion = { fromX: character.realX, fromY: character.realY, elapsed: 0, duration, jump };
            character.x += dx;
            character.y += dy;
            return true;
        }

        updateMoveRoutes(dt) {
            for (const [id, route] of this.moveRoutes) {
                if (id !== -1) {
                    const event = (this.map.events || []).find((entry) => entry && entry.id === id);
                    if (!event || !this.eventPage(event)) {
                        route.done = true;
                        route.character.motion = null;
                        route.character.realX = route.character.x;
                        route.character.realY = route.character.y;
                        this.moveRoutes.delete(id);
                        continue;
                    }
                    this.eventState(event);
                }
                const character = route.character;
                if (character.motion) {
                    const motion = character.motion;
                    motion.elapsed += dt;
                    const t = Math.min(1, motion.elapsed / motion.duration);
                    character.realX = motion.fromX + (character.x - motion.fromX) * t;
                    character.realY = motion.fromY + (character.y - motion.fromY) * t;
                    character.jumpHeight = motion.jump ? Math.sin(t * Math.PI) * FNH.TILE / 2 : 0;
                    if (t >= 1) character.motion = null;
                }
                try {
                    const imageName = character.imageName;
                    route.update(dt);
                    if (imageName !== character.imageName) {
                        this.refreshEvents();
                        if (id === -1 && character.imageName) {
                            this.game.assets.loadImage('characters/' + character.imageName).catch((error) => {
                                this.game.lastError = error;
                                this.game.showToast(error.message, 6);
                            });
                        }
                    }
                } catch (error) {
                    route.error = error;
                    route.done = true;
                    if (!route.route.wait) {
                        this.game.lastError = error;
                        this.game.showToast(error.message, 6);
                    }
                }
                if (route.done) this.moveRoutes.delete(id);
            }
        }

        startAutorun() {
            for (const event of this.map.events || []) {
                if (!event) continue;
                const page = this.eventPage(event);
                if (page && page.trigger === 3 && !this.failedAutorunPages.has(page) && this.startEvent(event)) return true;
            }
            for (const event of this.game.data.commonEvents || []) {
                if (event && event.trigger === 1 && this.game.flags['switch:' + event.switchId] &&
                    !this.failedAutorunPages.has(event) && this.startEventList(event, 0)) return true;
            }
            return false;
        }

        withEventContext(context, action) {
            const fields = ['eventRunner', 'eventWait', 'eventChoice', 'eventId', 'runningEventPage'];
            const previous = fields.map((field) => this[field]);
            fields.forEach((field) => { this[field] = context[field]; });
            try {
                return action();
            } finally {
                fields.forEach((field, index) => {
                    context[field] = this[field];
                    this[field] = previous[index];
                });
            }
        }

        updateParallelEvents(dt) {
            const active = new Map();
            for (const event of this.map.events || []) {
                if (!event) continue;
                const page = this.eventPage(event);
                if (page && page.trigger === 4) active.set('map:' + event.id, { page, eventId: event.id });
            }
            for (const event of this.game.data.commonEvents || []) {
                if (event && event.trigger === 2 && this.game.flags['switch:' + event.switchId]) {
                    active.set('common:' + event.id, { page: event, eventId: 0 });
                }
            }
            for (const [key, context] of this.parallelEvents) {
                if (!active.has(key) || active.get(key).page !== context.runningEventPage) {
                    if (this.dialogRunner === context.eventRunner) this.dialogRunner = null;
                    this.parallelEvents.delete(key);
                }
            }
            for (const [key, entry] of active) {
                if (this.leaving) break;
                // Các event trước có thể vừa đổi switch, đổi trang hoặc xóa event này.
                const valid = entry.eventId ? this.eventPage(this.map.events.find((event) => event && event.id === entry.eventId)) === entry.page
                    : this.game.flags['switch:' + entry.page.switchId];
                if (!valid || this.failedAutorunPages.has(entry.page)) continue;
                let context = this.parallelEvents.get(key);
                if (!context) {
                    context = { eventRunner: null, eventWait: null, eventChoice: 0,
                        eventId: entry.eventId, runningEventPage: entry.page };
                    this.parallelEvents.set(key, context);
                }
                this.withEventContext(context, () => {
                    if (this.eventRunner) this.updateEvent(dt);
                    else this.startEventList(entry.page, entry.eventId, false);
                });
            }
        }

        dialogState() {
            if (!this.dialogRunner || this.dialogRunner === this.eventRunner) return this;
            for (const context of this.parallelEvents.values()) {
                if (context.eventRunner === this.dialogRunner) return context;
            }
            return this;
        }

        refreshEvents() {
            this.events = this.map.events.filter(Boolean).map((event) => {
                const page = this.eventPage(event);
                if (!page) return null;
                const state = this.eventState(event);
                if (!state.imageName && !(page.image && page.image.tileId > 0)) return null;
                state.name = event.name;
                state.animated = /flame|fire/i.test(state.imageName);
                return state;
            }).filter(Boolean);
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
            const player = this.game.player;
            for (const event of this.map.events || []) {
                if (!event) continue;
                const position = this.eventState(event);
                if (position.x !== player.mapX || position.y !== player.mapY) continue;
                const page = this.eventPage(event);
                if (page && (page.trigger === 1 || page.trigger === 2)) return this.startEvent(event);
            }
            return false;
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
                { id: 'items', label: 'VẬT PHẨM', enabled: true },
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
            } else if (entry.id === 'items') {
                const inventory = this.game.player.inventory || [];
                if (!inventory.length) {
                    this.game.showToast('Túi đồ đang trống.', 2);
                } else {
                    const names = inventory.map((item) => {
                        const table = item.kind === 'weapon' ? this.game.data.weapons
                            : item.kind === 'armor' ? this.game.data.armors : this.game.data.items;
                        const data = table[item.id];
                        return (data ? data.name : 'Item ' + item.id) + ' ×' + item.amount;
                    });
                    this.game.showToast(names.join(' · '), 4.5);
                }
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

            this.updateMoveRoutes(dt);
            this.updateParallelEvents(dt);
            if (this.leaving) return;
            if (this.eventRunner) {
                this.updateEvent(dt);
                this.updateCamera(dt);
                this.updateEventImages();
                return;
            }
            if (this.dialogRunner) {
                this.updateCamera(dt);
                this.updateEventImages();
                return;
            }
            if (!this.moving && this.startAutorun()) return;
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
            if (this.moveRoutes.has(-1)) return;
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
            if (!this.playerRouteState || !this.playerRouteState.directionFix) player.direction = direction;
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
            if (this.playerRouteState && this.playerRouteState.throughOverride) {
                if (nx < 0 || ny < 0 || nx >= this.map.width || ny >= this.map.height) return false;
            } else if (!this.game.data.isTilePassable(this.map, this.tileset, nx, ny, direction)) {
                this.bump = 1;
                return false;
            }
            for (const event of this.map.events || []) {
                if (!event) continue;
                const position = this.eventState(event);
                if (position.x !== nx || position.y !== ny) continue;
                const page = this.eventPage(event);
                if (!page || page.priorityType !== 1 || (position.throughOverride ?? page.through) ||
                    (this.playerRouteState && this.playerRouteState.throughOverride)) continue;
                if (page.trigger === 1 || page.trigger === 2) this.startEvent(event);
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
            const player = this.game.player;
            const event = (this.map.events || []).filter(Boolean).find((entry) => {
                const page = this.eventPage(entry);
                if (!page || page.trigger !== 0) return false;
                const position = this.eventState(entry);
                if (page.priorityType === 1) return position.x === front.x && position.y === front.y;
                return position.x === player.mapX && position.y === player.mapY;
            });
            if (!event || !this.startEvent(event)) this.game.showToast('Không có gì trong bóng tối.', 1.4);
        }

        startEvent(event) {
            if (this.eventRunner || this.leaving) return false;
            const page = this.eventPage(event);
            return this.startEventList(page, event.id);
        }

        startEventList(page, eventId, lockMovement = true) {
            if (this.eventRunner || this.leaving || !page || !page.list ||
                !page.list.some((command) => command.code !== 0)) return false;
            if (lockMovement) this.finishMove();
            this.eventId = eventId;
            this.runningEventPage = page;
            const runner = new FNH.EventInterpreter(page.list, {
                canShowMessage: () => {
                    if (this.dialogRunner && this.dialogRunner !== runner) return false;
                    this.dialogRunner = runner;
                    return true;
                },
                condition: (parameters) => this.eventCondition(parameters),
                commonEvent: (id) => this.game.data.commonEvents[id],
                execute: (command) => this.executeEventCommand(command)
            });
            this.eventRunner = runner;
            this.updateEvent(0);
            return true;
        }

        eventCondition(p) {
            const flags = this.game.flags;
            if (p[0] === 0) return !!flags['switch:' + p[1]] === (p[2] === 0);
            if (p[0] === 1) {
                const left = Number(flags['variable:' + p[1]] || 0);
                const right = p[2] === 0 ? p[3] : Number(flags['variable:' + p[3]] || 0);
                const results = [left === right, left >= right, left <= right, left > right, left < right, left !== right];
                if (p[4] >= 0 && p[4] < results.length) return results[p[4]];
            }
            if (p[0] === 2) {
                if (!this.eventId) return false;
                const key = 'self:' + (this.game.mapId || 1) + ':' + this.eventId + ':' + p[1];
                const value = Object.prototype.hasOwnProperty.call(flags, key) ? flags[key]
                    : (this.game.mapId || 1) === 1 && flags['self:' + this.eventId + ':' + p[1]];
                return !!value === (p[2] === 0);
            }
            if (p[0] === 4 && p[2] === 0) return this.game.player.id === p[1];
            if (p[0] === 6) {
                const character = this.eventCharacter(p[1]);
                return !!character && character.direction === p[2];
            }
            if (p[0] === 7) {
                const gold = this.game.gold;
                if (p[2] === 0) return gold >= p[1];
                if (p[2] === 1) return gold <= p[1];
                if (p[2] === 2) return gold < p[1];
            }
            if (p[0] >= 8 && p[0] <= 10) {
                const kind = ['item', 'weapon', 'armor'][p[0] - 8];
                if ((this.game.player.inventory || []).some((item) =>
                    item.id === p[1] && (item.kind || 'item') === kind && item.amount > 0)) return true;
                return kind !== 'item' && !!p[2] && (this.game.player.equipment || []).some((item) =>
                    item.id === p[1] && item.type === kind);
            }
            throw new Error('Chưa hỗ trợ điều kiện event ' + p[0]);
        }

        eventCharacter(id) {
            const character = this.mapCharacter(id);
            return character ? { x: character.x, y: character.y, realX: character.realX, realY: character.realY,
                direction: character.direction, name: character.imageName } : null;
        }

        eventDataOperand(type, id, parameter) {
            const player = this.game.player;
            if (type >= 0 && type <= 2) {
                const kind = ['item', 'weapon', 'armor'][type];
                const entry = (player.inventory || []).find((item) => item.id === id && (item.kind || 'item') === kind);
                return entry ? entry.amount : 0;
            }
            if (type === 3 && player.id === id) {
                const fields = ['level', 'exp', 'hp', 'mp', 'maxHp', 'maxMp', 'atk', 'def', 'mat', 'mdf', 'agi', 'luk'];
                if (fields[parameter]) return Number(player[fields[parameter]] || 0);
            }
            if (type === 5) {
                const character = this.eventCharacter(id);
                if (!character) return 0;
                if (parameter === 0) return character.x;
                if (parameter === 1) return character.y;
                if (parameter === 2) return character.direction;
                if (parameter === 3) return Math.round(character.realX * FNH.TILE + FNH.TILE / 2 - this.camera.x);
                if (parameter === 4) {
                    const shift = /^[!$]*!/.test(character.name || '') ? 0 : 6;
                    return Math.round(character.realY * FNH.TILE + FNH.TILE - this.camera.y - shift);
                }
            }
            if (type === 6) return id === 0 ? player.id : 0;
            if (type === 7) {
                if (id === 0) return this.game.mapId;
                if (id === 1) return 1;
                if (id === 2) return this.game.gold;
                if (id === 4) return Math.floor(this.game.playtime || 0);
            }
            throw new Error('Chưa hỗ trợ dữ liệu event ' + type + ':' + id + ':' + parameter);
        }

        updateEvent(dt) {
            const runner = this.eventRunner;
            if (!runner) return;
            try {
                const wait = runner.wait;
                if (wait && ['message', 'choice'].includes(wait.type) && this.eventWait === wait &&
                    (!this.dialogRunner || this.dialogRunner === runner)) {
                    const input = this.input;
                    if (wait.type === 'choice') {
                        const count = wait.choices.length;
                        if (input.isPressed('ArrowUp', 'w', 'W')) this.eventChoice = (this.eventChoice + count - 1) % count;
                        if (input.isPressed('ArrowDown', 's', 'S')) this.eventChoice = (this.eventChoice + 1) % count;
                        if (input.isPressed('Escape', 'x', 'X') && wait.cancel !== -1) {
                            runner.resume(wait.cancel);
                        }
                    }
                    if (runner.wait && input.isPressed('Enter', ' ', 'z', 'Z')) {
                        runner.resume(wait.type === 'choice' ? this.eventChoice : undefined);
                    }
                }
                runner.update(dt);
                if (runner.wait !== this.eventWait) {
                    this.eventWait = runner.wait;
                    this.eventChoice = runner.wait && runner.wait.type === 'choice'
                        ? Math.max(0, Math.min(runner.wait.choices.length - 1, runner.wait.defaultIndex || 0)) : 0;
                }
                if (this.dialogRunner === runner && (!runner.wait || !['message', 'choice'].includes(runner.wait.type))) {
                    this.dialogRunner = null;
                }
                if (runner.done) {
                    this.eventRunner = null;
                    this.eventWait = null;
                    this.refreshEvents();
                }
            } catch (error) {
                if (this.dialogRunner === runner) this.dialogRunner = null;
                if (this.runningEventPage) {
                    this.failedAutorunPages.add(this.runningEventPage);
                }
                this.game.lastError = error;
                this.game.showToast(error.message, 6);
                this.eventRunner = null;
                this.eventWait = null;
                this.refreshEvents();
            }
        }

        drawEventDialog(ctx) {
            const dialog = this.dialogState();
            const wait = dialog.eventRunner && dialog.eventRunner.wait;
            if (!wait || !['message', 'choice'].includes(wait.type)) return;
            if (wait.type === 'message') {
                FNH.panel(ctx, 20, 420, FNH.WIDTH - 40, 170);
                FNH.wrapText(ctx, wait.text, 40, 450, FNH.WIDTH - 80, 25, { size: 18 });
                FNH.text(ctx, 'Z / ENTER · TIẾP TỤC', FNH.WIDTH - 40, 575, { size: 11, align: 'right' });
            } else {
                const height = wait.choices.length * 38 + 32;
                const y = Math.max(20, 590 - height);
                FNH.panel(ctx, 180, y, FNH.WIDTH - 200, height);
                wait.choices.forEach((choice, index) => {
                    FNH.text(ctx, (index === dialog.eventChoice ? '› ' : '  ') + choice, 200, y + 30 + index * 38, {
                        size: 18, color: index === dialog.eventChoice ? '#f4deb0' : '#b9b09e'
                    });
                });
            }
        }

        executeEventCommand(command) {
            const p = command.parameters || [];
            if (command.code === 121) {
                const from = Number(p[0] || 0);
                const to = Number(p[1] || from);
                for (let id = from; id <= to; id += 1) {
                    const key = 'switch:' + id;
                    if (p[2] === 2) this.game.flags[key] = !this.game.flags[key];
                    else this.game.flags[key] = p[2] === 0;
                }
            } else if (command.code === 122) {
                if (p[3] !== 0 && p[3] !== 1 && p[3] !== 2 && p[3] !== 3) throw new Error('Chưa hỗ trợ toán hạng biến ' + p[3]);
                const from = Number(p[0] || 0);
                const to = Number(p[1] || from);
                let operand = Number(p[4] || 0);
                if (p[3] === 1) operand = Number(this.game.flags['variable:' + operand] || 0);
                if (p[3] === 3) operand = this.eventDataOperand(p[4], p[5], p[6]);
                for (let id = from; id <= to; id += 1) {
                    const key = 'variable:' + id;
                    const old = Number(this.game.flags[key] || 0);
                    if (p[3] === 2) operand = Number(p[4] || 0) + Math.floor(Math.random() * (Number(p[5] || 0) - Number(p[4] || 0) + 1));
                    if (p[2] === 0) this.game.flags[key] = operand;
                    else if (p[2] === 1) this.game.flags[key] = old + operand;
                    else if (p[2] === 2) this.game.flags[key] = old - operand;
                    else if (p[2] === 3) this.game.flags[key] = old * operand;
                    else if (p[2] === 4 && operand !== 0) this.game.flags[key] = Math.floor(old / operand);
                    else if (p[2] === 5 && operand !== 0) this.game.flags[key] = old % operand;
                }
            } else if (command.code === 123) {
                if (!this.eventId) return;
                const key = 'self:' + (this.game.mapId || 1) + ':' + this.eventId + ':' + String(p[0] || 'A');
                this.game.flags[key] = p[1] === 0;
            } else if (command.code === 125) {
                const operation = Number(p[0] || 0);
                let amount = Number(p[2] || 0);
                if (p[1] === 1) amount = Number(this.game.flags['variable:' + amount] || 0);
                this.game.gold = Math.max(0, this.game.gold + (operation === 0 ? amount : -amount));
            } else if (command.code >= 126 && command.code <= 128) {
                const kind = ['item', 'weapon', 'armor'][command.code - 126];
                if (kind !== 'item' && p[1] === 1 && p[4]) {
                    throw new Error('Chưa hỗ trợ tháo trang bị khi trừ ' + kind);
                }
                const itemId = Number(p[0] || 0);
                let amount = Number(p[3] || 0);
                if (p[2] === 1) amount = Number(this.game.flags['variable:' + amount] || 0);
                const inventory = this.game.player.inventory || (this.game.player.inventory = []);
                const entry = inventory.find((item) => item.id === itemId && (item.kind || 'item') === kind);
                const delta = p[1] === 0 ? amount : -amount;
                const total = Math.max(0, (entry ? entry.amount : 0) + delta);
                if (entry) {
                    entry.amount = total;
                    if (!total) inventory.splice(inventory.indexOf(entry), 1);
                } else if (total > 0) {
                    inventory.push(kind === 'item' ? { id: itemId, amount: total } : { id: itemId, amount: total, kind });
                }
            } else if (command.code === 205) {
                const character = this.mapCharacter(p[0]);
                if (!character) return;
                if (character.id === -1) this.finishMove();
                const route = new FNH.MoveRoute(this, character, p[1] || {});
                const previous = this.moveRoutes.get(character.id);
                if (previous) previous.done = true;
                this.moveRoutes.set(character.id, route);
                if (route.route.wait) return { type: 'route', route };
            } else if (command.code === 203) {
                const character = this.mapCharacter(p[0]);
                if (!character) return;
                if (p[0] === -1) this.finishMove();
                if (p[1] === 2) {
                    const other = this.mapCharacter(p[2]);
                    if (!other) return;
                    if (p[2] === -1) this.finishMove();
                    const x = character.x, y = character.y;
                    character.x = other.x;
                    character.y = other.y;
                    other.motion = null;
                    other.x = other.realX = x;
                    other.y = other.realY = y;
                } else if (p[1] === 0 || p[1] === 1) {
                    character.x = p[1] === 0 ? p[2] : Number(this.game.flags['variable:' + p[2]] || 0);
                    character.y = p[1] === 0 ? p[3] : Number(this.game.flags['variable:' + p[3]] || 0);
                } else throw new Error('Chưa hỗ trợ kiểu định vị event ' + p[1]);
                character.motion = null;
                character.realX = character.x;
                character.realY = character.y;
                if (p[4]) character.direction = p[4];
                this.refreshEvents();
            } else if (command.code === 214) {
                if (this.eventId) {
                    this.erasedEvents.add(this.eventId);
                    this.refreshEvents();
                }
            } else if (command.code === 250 && p[0] && p[0].name) {
                this.game.audio.playSe(p[0].name, { volume: (Number(p[0].volume) || 90) / 100 });
            } else if (command.code === 201) {
                const value = (index) => p[0] === 1
                    ? Number(this.game.flags['variable:' + p[index]] || 0) : Number(p[index]);
                this.game.mapId = value(1);
                this.game.player.mapX = value(2);
                this.game.player.mapY = value(3);
                if (p[4]) this.game.player.direction = Number(p[4]);
                this.leaving = true;
                this.game.changeScene(FNH.Scene_Map, { fromTransfer: true });
                return false;
            } else {
                throw new Error('Chưa hỗ trợ lệnh event ' + command.code);
            }
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
            if (!image || (options && options.transparent)) return;
            const frame = this.characterFrame(image, name, imageIndex, direction, pattern);
            const opts = options || {};
            ctx.save();
            if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
            if (opts.filter) ctx.filter = opts.filter;
            if (opts.blendMode) ctx.globalCompositeOperation = ['source-over', 'lighter', 'multiply', 'screen'][opts.blendMode] || 'source-over';
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
            if (!event.imageName || event.transparent || event.opacity === 0) return;
            const image = this.eventImages.get(event.imageName);
            if (!image) return;
            let pattern = event.pattern;
            if (event.animated || event.stepAnime || (event.motion && event.walkAnime)) {
                pattern = Math.floor(this.time * 5 + event.id) % 3;
            }
            this.drawShadow(ctx, footX, footY, event.imageName.charAt(0) === '$' ? 52 : 38, 0.3 * (event.opacity ?? 255) / 255);
            this.drawCharacter(ctx, image, event.imageName, event.imageIndex, event.direction, pattern, footX,
                footY - (event.jumpHeight || 0), { alpha: (event.opacity ?? 255) / 255,
                    transparent: event.transparent, blendMode: event.blendMode });
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
                    if (!this.playerRouteState || !this.playerRouteState.transparent) {
                        this.drawShadow(ctx, playerFootX, playerFootY, 40, 0.35 * (this.playerRouteState ? this.playerRouteState.opacity / 255 : 1));
                    }
                    this.drawCharacter(
                        ctx,
                        this.game.assets.imageCache.get('characters/' + player.characterName),
                        player.characterName,
                        player.characterIndex,
                        player.direction,
                        this.playerRouteState && ((this.playerRouteState.motion && this.playerRouteState.walkAnime) || this.playerRouteState.stepAnime)
                            ? Math.floor(this.time * 6) % 3 : this.playerRouteState && !this.playerRouteState.walkAnime ? 1 : this.stepPattern,
                        playerFootX,
                        playerFootY - (this.playerRouteState && this.playerRouteState.jumpHeight || 0),
                        this.playerRouteState ? { alpha: this.playerRouteState.opacity / 255,
                            transparent: this.playerRouteState.transparent, blendMode: this.playerRouteState.blendMode } : undefined
                    );
                }
            });

            for (const event of this.events) {
                if (event.priority === 2) continue;
                const footX = (event.realX ?? event.x) * FNH.TILE + FNH.TILE / 2 - this.camera.x;
                const footY = (event.realY ?? event.y) * FNH.TILE + FNH.TILE - this.camera.y;
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
                const footX = (event.realX ?? event.x) * FNH.TILE + FNH.TILE / 2 - this.camera.x;
                const footY = (event.realY ?? event.y) * FNH.TILE + FNH.TILE - this.camera.y;
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
            const inventory = this.game.player.inventory || [];
            const itemCount = inventory.reduce((total, item) => total + Math.max(0, Number(item.amount) || 0), 0);
            FNH.text(ctx, 'VẬT PHẨM ' + itemCount, 310, 57, {
                size: 9,
                color: 'rgba(223,199,141,0.62)',
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
            this.drawEventDialog(ctx);
            if (this.paused) this.drawPause(ctx);
        }
    };
})();
