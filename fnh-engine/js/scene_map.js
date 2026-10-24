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
            this.animations = [];
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
            this.lockedEventId = 0;
            this.lockedEventRunner = null;
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
            if (options && options.resume) {
                this.leaving = false;
                return;
            }
            this.time = 0;
            this.ready = false;
            this.leaving = false;
            this.paused = false;
            this.erasedEvents.clear();
            this.eventStates.clear();
            this.moveRoutes.clear();
            this.lockedEventId = 0;
            this.lockedEventRunner = null;
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

            if (game.mapId === 1 && !this.map.autoplayBgm) game.audio.stopBgm(0.5);
            for (const [enabled, sound, play, stop] of [
                [this.map.autoplayBgm, this.map.bgm, 'playBgm', 'stopBgm'],
                [this.map.autoplayBgs, this.map.bgs, 'playBgs', 'stopBgs']
            ]) {
                if (!enabled) continue;
                if (!sound || !sound.name) game.audio[stop](0);
                else game.audio[play](sound.name, {
                    volume: (sound.volume === undefined ? 90 : sound.volume) / 100,
                    pitch: sound.pitch === undefined ? 100 : sound.pitch,
                    pan: sound.pan || 0, loop: true
                }).catch((error) => {
                    game.lastError = error;
                    game.showToast(error.message, 6);
                });
            }
            this.updateEventImages();
        }

        eventPage(event) {
            if (this.erasedEvents.has(event.id)) return null;
            return this.game.data.eventPage(event, this.game.flags, this.game.mapId, this.game.player, this.game.partyIds);
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
                state.moveFrequency = page && page.moveFrequency || 3;
                state.stopSeconds = 0;
                state.autonomousRoute = null;
                state.autonomousError = null;
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
                if (!passable) {
                    const player = this.game.player;
                    if (character.id !== -1 && character.priority === 1 && character.x + dx === player.mapX &&
                        character.y + dy === player.mapY && !this.eventRunner) {
                        const event = (this.map.events || []).find((entry) => entry && entry.id === character.id);
                        const page = event && this.eventPage(event);
                        if (page && page.trigger === 2) this.startEvent(event);
                    }
                    return false;
                }
            }
            character.stopSeconds = 0;
            const duration = jump ? Math.max(0.2, (20 + Math.round(Math.hypot(dx, dy))) / 60)
                : 256 / (Math.pow(2, character.moveSpeed || 4) * 60);
            character.motion = { fromX: character.realX, fromY: character.realY, elapsed: 0, duration, jump };
            character.x += dx;
            character.y += dy;
            return true;
        }

        updateCharacterMotion(character, dt) {
            const motion = character.motion;
            if (!motion) return;
            motion.elapsed += dt;
            const t = Math.min(1, motion.elapsed / motion.duration);
            character.realX = motion.fromX + (character.x - motion.fromX) * t;
            character.realY = motion.fromY + (character.y - motion.fromY) * t;
            character.jumpHeight = motion.jump ? Math.sin(t * Math.PI) * FNH.TILE / 2 : 0;
            if (t >= 1) character.motion = null;
        }

        updateAutonomousMovement(dt, forcedIds) {
            for (const event of this.map.events || []) {
                if (this.leaving) break;
                if (!event || forcedIds.has(event.id)) continue;
                const state = this.eventState(event);
                const page = state.page;
                if (!page) {
                    state.motion = null;
                    state.realX = state.x;
                    state.realY = state.y;
                    continue;
                }
                if (state.motion) {
                    this.updateCharacterMotion(state, dt);
                    continue;
                }
                if (this.lockedEventId === event.id) {
                    state.stopSeconds = 0;
                    continue;
                }
                state.stopSeconds = (state.stopSeconds || 0) + dt;
                const width = FNH.WIDTH, height = FNH.HEIGHT;
                const nearScreen = Math.abs(state.x * FNH.TILE + FNH.TILE / 2 - this.camera.x - width / 2) < width &&
                    Math.abs(state.y * FNH.TILE + FNH.TILE / 2 - this.camera.y - height / 2) < height;
                if (!page.moveType || !nearScreen || state.autonomousError ||
                    state.stopSeconds <= (5 - state.moveFrequency) / 2) continue;
                try {
                    if (!state.autonomousRoute) {
                        const definition = page.moveType === 3 ? page.moveRoute || {} : { list: [{ code: 0 }] };
                        state.autonomousRoute = new FNH.MoveRoute(this, state, definition);
                    }
                    const route = state.autonomousRoute;
                    if (page.moveType === 1 || page.moveType === 2) {
                        const roll = Math.floor(Math.random() * 6);
                        const player = this.game.player;
                        const nearPlayer = Math.abs(state.x - player.mapX) + Math.abs(state.y - player.mapY) < 20;
                        let code;
                        if (page.moveType === 2) code = !nearPlayer || roll === 4 ? 9 : roll === 5 ? 12 : 10;
                        else if (roll === 5) {
                            state.stopSeconds = 0;
                            continue;
                        } else code = roll < 2 ? 9 : 12;
                        route.route = { list: [{ code }], skippable: true };
                        route.index = 0;
                        route.done = false;
                    }
                    const imageName = state.imageName;
                    route.update(dt);
                    if (imageName !== state.imageName) this.refreshEvents();
                } catch (error) {
                    state.autonomousError = error;
                    this.game.lastError = error;
                    this.game.showToast(error.message, 6);
                }
            }
        }

        updateMoveRoutes(dt) {
            const forcedIds = new Set(this.moveRoutes.keys());
            for (const [id, route] of this.moveRoutes) {
                if (this.leaving) break;
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
                this.updateCharacterMotion(character, dt);
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
            this.updateAutonomousMovement(dt, forcedIds);
        }

        unlockEvent(runner) {
            if (!this.lockedEventId || this.lockedEventRunner !== runner) return;
            const state = this.eventStates.get(this.lockedEventId);
            if (state) {
                if (state.prelockDirection && !state.directionFix) state.direction = state.prelockDirection;
                state.prelockDirection = 0;
                state.stopSeconds = 0;
            }
            this.lockedEventId = 0;
            this.lockedEventRunner = null;
        }

        startAutorun() {
            if (this.game.reservedCommonEvent) {
                const event = this.game.data.commonEvents[this.game.reservedCommonEvent];
                if (!event) {
                    this.game.lastError = new Error('Không tìm thấy common event đặt trước');
                    this.game.showToast(this.game.lastError.message, 6);
                    this.game.reservedCommonEvent = null;
                } else if (this.startEventList(event, 0)) {
                    this.game.reservedCommonEvent = null;
                    return true;
                } else if (!this.eventRunner) this.game.reservedCommonEvent = null;
            }
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
                { id: 'save', label: 'LƯU GAME', enabled: !this.game.flags['system:saveDisabled'] },
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

            for (const animation of this.animations) animation.update(dt);
            this.animations = this.animations.filter((animation) => !animation.done);
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
            if (this.partyIds().length && this.partyIds().every((id) => this.eventActor(id).hp <= 0)) {
                this.leaving = true;
                this.game.gameOver();
                return;
            }
            if (!this.moving && this.startAutorun()) return;
            const input = this.input;
            if (input.isPressed('Escape', 'x', 'X') && !this.game.flags['system:menuDisabled']) {
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
                    for (const id of this.partyIds()) this.game.data.actorWalkStep(this.eventActor(id));
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
            if (page && page.trigger >= 0 && page.trigger <= 2 && page.list && page.list.some((command) => command.code !== 0)) {
                const state = this.eventState(event);
                this.lockedEventId = event.id;
                state.prelockDirection = state.direction;
                const dx = this.game.player.mapX - state.x, dy = this.game.player.mapY - state.y;
                if (!state.directionFix && (dx || dy)) {
                    state.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : (dy > 0 ? 2 : 8);
                }
            }
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
                variable: (id) => this.game.flags['variable:' + id] || 0,
                setVariable: (id, value) => { this.game.flags['variable:' + id] = value; },
                selectItems: (type) => (this.game.player.inventory || []).filter((entry) => {
                    const item = this.game.data.items[entry.id];
                    return (entry.kind || 'item') === 'item' && entry.amount > 0 && item && item.itypeId === type;
                }).map((entry) => ({ id: entry.id, name: this.game.data.items[entry.id].name, amount: entry.amount })),
                condition: (parameters) => this.eventCondition(parameters),
                commonEvent: (id) => this.game.data.commonEvents[id],
                execute: (command) => this.executeEventCommand(command)
            });
            this.eventRunner = runner;
            if (lockMovement && this.lockedEventId === eventId && eventId) this.lockedEventRunner = runner;
            this.updateEvent(0);
            return true;
        }

        partyIds() {
            return this.game.partyIds || [this.game.player.id];
        }

        changePartyMember(id, remove, initialize) {
            if (!this.game.data.actor(id)) return;
            const ids = this.partyIds().slice();
            const previous = this.game.player;
            const actors = this.game.actorStates || (this.game.actorStates = {});
            if (!remove && initialize) {
                const fresh = this.game.data.createPlayer(id);
                if (id === previous.id) {
                    this.finishMove();
                    Object.assign(fresh, { mapX: previous.mapX, mapY: previous.mapY, direction: previous.direction,
                        inventory: previous.inventory });
                    this.game.player = fresh;
                } else actors[id] = fresh;
            }
            if (remove) {
                const index = ids.indexOf(id);
                if (index >= 0) ids.splice(index, 1);
            } else if (!ids.includes(id)) {
                this.eventActor(id);
                ids.push(id);
            }
            this.game.partyIds = ids;
            if (ids.length && ids[0] !== this.game.player.id) {
                this.finishMove();
                const leader = this.eventActor(ids[0]);
                actors[this.game.player.id] = this.game.player;
                const current = this.game.player;
                Object.assign(leader, { mapX: current.mapX, mapY: current.mapY,
                    direction: current.direction, inventory: current.inventory || [] });
                this.game.player = leader;
                delete actors[leader.id];
            }
            if (this.game.player !== previous) {
                const route = this.moveRoutes.get(-1);
                if (route) route.done = true;
                this.moveRoutes.delete(-1);
                this.playerRouteState = null;
                this.loadActorImages(this.game.player);
            }
            if (this.battle) this.battle.syncParty();
            this.refreshEvents();
        }

        eventActor(id) {
            if (this.game.player.id === id) return this.game.player;
            if (!this.game.data.actor(id)) return null;
            const actors = this.game.actorStates || (this.game.actorStates = {});
            if (!actors[id]) actors[id] = this.game.data.createPlayer(id);
            return actors[id];
        }

        eventActorTargets(mode, id) {
            const actorId = mode === 1 ? Number(this.game.flags['variable:' + id] || 0) : id;
            if (actorId === 0) return this.partyIds().map((id) => this.eventActor(id)).filter(Boolean);
            const actor = this.eventActor(actorId);
            return actor ? [actor] : [];
        }

        loadActorImages(actor) {
            if (actor !== this.game.player) return;
            for (const name of [actor.characterName && 'characters/' + actor.characterName,
                actor.faceName && 'faces/' + actor.faceName]) {
                if (!name) continue;
                this.game.assets.loadImage(name).catch((error) => {
                    this.game.lastError = error;
                    this.game.showToast(error.message, 6);
                });
            }
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
            if (p[0] === 3) {
                const timer = this.game.eventTimer;
                if (!timer || !timer.working) return false;
                const seconds = Math.floor(timer.seconds);
                if (p[2] === 0) return seconds >= p[1];
                if (p[2] === 1) return seconds <= p[1];
            }
            if (p[0] === 4) {
                if (p[2] === 0) return this.partyIds().includes(p[1]);
                const actor = this.eventActor(p[1]);
                if (!actor) return false;
                if (p[2] === 1) return actor.name === p[3];
                if (p[2] === 2) return actor.classId === p[3];
                if (p[2] === 3) return (actor.skills || []).includes(p[3]);
                if (p[2] === 6) return (actor.states || []).includes(p[3]);
                if (p[2] === 4 || p[2] === 5) return (actor.equipment || []).some((item) =>
                    item.type === (p[2] === 4 ? 'weapon' : 'armor') && item.id === p[3]);
            }
            if (p[0] === 5) {
                const enemy = this.battle && this.battle.enemies[p[1]];
                if (!enemy) return false;
                if (p[2] === 0) return !enemy.hidden;
                if (p[2] === 1) return (enemy.states || []).includes(p[3]);
            }
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
                return kind !== 'item' && !!p[2] && this.partyIds().some((id) =>
                    (this.eventActor(id).equipment || []).some((item) => item.id === p[1] && item.type === kind));
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
            if (type === 3) {
                const actor = this.eventActor(id);
                const fields = ['level', 'exp', 'hp', 'mp', 'maxHp', 'maxMp', 'atk', 'def', 'mat', 'mdf', 'agi', 'luk'];
                if (actor && fields[parameter]) return Number(actor[fields[parameter]] || 0);
            }
            if (type === 4) {
                const enemy = this.battle && this.battle.enemies[id];
                const field = ['hp', 'mp', 'maxHp', 'maxMp', 'atk', 'def', 'mat', 'mdf', 'agi', 'luk'][parameter];
                if (field) return enemy ? Number(enemy[field] || 0) : 0;
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
            if (type === 6) return this.partyIds()[id] || 0;
            if (type === 7) {
                if (id === 0) return this.game.mapId;
                if (id === 1) return this.partyIds().length;
                if (id === 2) return this.game.gold;
                if (id === 3) return Math.floor(this.game.eventTimer && this.game.eventTimer.seconds || 0);
                if (id === 4) return Math.floor(this.game.playtime || 0);
            }
            throw new Error('Chưa hỗ trợ dữ liệu event ' + type + ':' + id + ':' + parameter);
        }

        updateEvent(dt) {
            const runner = this.eventRunner;
            if (!runner) return;
            try {
                const wait = runner.wait;
                if (wait && ['message', 'choice', 'number', 'item'].includes(wait.type) && this.eventWait === wait &&
                    (!this.dialogRunner || this.dialogRunner === runner)) {
                    const input = this.input;
                    if (wait.type === 'number') {
                        if (input.isPressed('ArrowLeft', 'a', 'A')) wait.digit = (wait.digit + wait.digits - 1) % wait.digits;
                        if (input.isPressed('ArrowRight', 'd', 'D')) wait.digit = (wait.digit + 1) % wait.digits;
                        const place = Math.pow(10, wait.digits - 1 - wait.digit);
                        const digit = Math.floor(wait.value / place) % 10;
                        if (input.isPressed('ArrowUp', 'w', 'W')) wait.value += (((digit + 1) % 10) - digit) * place;
                        if (input.isPressed('ArrowDown', 's', 'S')) wait.value += (((digit + 9) % 10) - digit) * place;
                    }
                    if (wait.type === 'item') {
                        const count = wait.items.length;
                        if (count && input.isPressed('ArrowUp', 'w', 'W')) this.eventChoice = (this.eventChoice + count - 1) % count;
                        if (count && input.isPressed('ArrowDown', 's', 'S')) this.eventChoice = (this.eventChoice + 1) % count;
                        if (input.isPressed('Escape', 'x', 'X')) runner.resume(0);
                    }
                    if (wait.type === 'choice') {
                        const count = wait.choices.length;
                        const moveChoice = (step) => {
                            for (let i = 0; i < count; i += 1) {
                                this.eventChoice = (this.eventChoice + count + step) % count;
                                if (!wait.disabled || !wait.disabled[this.eventChoice]) break;
                            }
                        };
                        if (input.isPressed('ArrowUp', 'w', 'W')) moveChoice(-1);
                        if (input.isPressed('ArrowDown', 's', 'S')) moveChoice(1);
                        if (input.isPressed('Escape', 'x', 'X') && wait.cancel !== -1 &&
                            (wait.cancel < 0 || !wait.disabled || !wait.disabled[wait.cancel])) runner.resume(wait.cancel);
                    }
                    if (runner.wait && input.isPressed('Enter', ' ', 'z', 'Z') &&
                        (wait.type !== 'choice' || (this.eventChoice >= 0 && (!wait.disabled || !wait.disabled[this.eventChoice])))) {
                        runner.resume(wait.type === 'choice' ? this.eventChoice : wait.type === 'number' ? wait.value
                            : wait.type === 'item' ? (wait.items[this.eventChoice] ? wait.items[this.eventChoice].id : 0) : undefined);
                    }
                }
                runner.update(dt);
                if (runner.wait !== this.eventWait) {
                    this.eventWait = runner.wait;
                    this.eventChoice = runner.wait && runner.wait.type === 'choice'
                        ? Math.max(0, Math.min(runner.wait.choices.length - 1, runner.wait.defaultIndex || 0)) : 0;
                    if (runner.wait && runner.wait.type === 'choice' && runner.wait.disabled && runner.wait.disabled[this.eventChoice]) {
                        this.eventChoice = runner.wait.disabled.findIndex((disabled) => !disabled);
                    }
                }
                if (this.dialogRunner === runner && (!runner.wait || !['message', 'choice', 'number', 'item'].includes(runner.wait.type))) {
                    this.dialogRunner = null;
                }
                if (runner.done) {
                    this.unlockEvent(runner);
                    this.eventRunner = null;
                    this.eventWait = null;
                    this.refreshEvents();
                }
            } catch (error) {
                this.unlockEvent(runner);
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
            if (!wait || !['message', 'choice', 'number', 'item'].includes(wait.type)) return;
            if (wait.type === 'message') {
                FNH.panel(ctx, 20, 420, FNH.WIDTH - 40, 170);
                FNH.wrapText(ctx, wait.text, 40, 450, FNH.WIDTH - 80, 25, { size: 18 });
                FNH.text(ctx, 'Z / ENTER · TIẾP TỤC', FNH.WIDTH - 40, 575, { size: 11, align: 'right' });
            } else if (wait.type === 'number') {
                FNH.panel(ctx, 180, 420, FNH.WIDTH - 360, 140);
                const value = String(wait.value).padStart(wait.digits, '0');
                const startX = FNH.WIDTH / 2 - value.length * 15;
                for (let i = 0; i < value.length; i += 1) {
                    FNH.text(ctx, value[i], startX + i * 30, 470, { size: 30,
                        color: i === wait.digit ? '#f4deb0' : '#b9b09e' });
                    if (i === wait.digit) FNH.text(ctx, '▔', startX + i * 30, 493, { size: 24, color: '#f4deb0' });
                }
                FNH.text(ctx, '← → CHỌN SỐ · ↑ ↓ ĐỔI · ENTER XÁC NHẬN', FNH.WIDTH / 2, 535, { size: 11, align: 'center' });
            } else if (wait.type === 'item') {
                const start = Math.max(0, dialog.eventChoice - 6);
                const entries = wait.items.slice(start, start + 7);
                const height = Math.max(1, entries.length) * 38 + 60;
                const y = Math.max(20, 590 - height);
                FNH.panel(ctx, 120, y, FNH.WIDTH - 240, height);
                if (!entries.length) FNH.text(ctx, 'Không có vật phẩm phù hợp.', 140, y + 30, { size: 18 });
                entries.forEach((item, index) => {
                    const selected = start + index === dialog.eventChoice;
                    FNH.text(ctx, (selected ? '› ' : '  ') + item.name + ' ×' + item.amount, 140, y + 30 + index * 38,
                        { size: 18, color: selected ? '#f4deb0' : '#b9b09e' });
                });
                FNH.text(ctx, 'ENTER · CHỌN / ESC · HỦY', FNH.WIDTH - 140, 575, { size: 11, align: 'right' });
            } else {
                const height = wait.choices.length * 38 + 32;
                const y = Math.max(20, 590 - height);
                FNH.panel(ctx, 180, y, FNH.WIDTH - 200, height);
                wait.choices.forEach((choice, index) => {
                    FNH.text(ctx, (index === dialog.eventChoice ? '› ' : '  ') + choice, 200, y + 30 + index * 38, {
                        size: 18, color: wait.disabled && wait.disabled[index] ? '#66615a'
                            : index === dialog.eventChoice ? '#f4deb0' : '#b9b09e'
                    });
                });
            }
        }

        executeEventCommand(command) {
            const p = command.parameters || [];
            if (command.code === 355) {
                FNH.executeEventScript(this, String(p[0] || ''));
            } else if (command.code === 356) {
                const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(String(p[0] || '').trim());
                if (!match) return;
                const name = match[1], argument = match[2] || '';
                if (name.toLowerCase() === 'choice_text' || name.toLowerCase() === 'disable_choice') {
                    const setting = /^(\d+)(?:\s+([\s\S]*))?$/.exec(argument);
                    const runner = this.eventRunner;
                    if (!setting || Number(setting[1]) < 1 || !runner) throw new Error('Tham số plugin lựa chọn không hợp lệ');
                    const index = Number(setting[1]) - 1;
                    if (name.toLowerCase() === 'choice_text') runner.choiceText[index] = setting[2] || '';
                    else runner.disabledChoices.add(index);
                    return;
                }
                const supported = ['GabText', 'ShowGab', 'ForceGab', 'ClearGab', 'WaitForGab'];
                if (!supported.includes(name)) throw new Error('Chưa hỗ trợ plugin command ' + name);
                const gabs = this.game.gabs || (this.game.gabs = new FNH.GabQueue());
                const runner = this.eventRunner;
                if (!runner) throw new Error('Plugin hội thoại cần interpreter đang chạy');
                if (name === 'GabText') runner.gabText = argument;
                if (name === 'ShowGab' || name === 'ForceGab') {
                    gabs.show(runner.gabText, name === 'ForceGab');
                    runner.gabText = '';
                }
                if (name === 'ClearGab') {
                    gabs.clear();
                    runner.gabText = '';
                }
                if (name === 'WaitForGab') return { type: 'gab', queue: gabs };
            } else if (command.code === 121) {
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
            } else if (command.code === 301) {
                if (this.game.sceneName === 'battle') throw new Error('Không thể mở trận đấu lồng nhau');
                let troopId = p[0] === 1 ? Number(this.game.flags['variable:' + p[1]] || 0) : p[1];
                if (p[0] === 2) {
                    const player = this.game.player;
                    const region = this.game.data.tileIdAt(this.map, player.mapX, player.mapY, 5);
                    const encounters = (this.map.encounterList || []).filter((entry) => entry.weight > 0 &&
                        (!entry.regionSet.length || entry.regionSet.includes(region)));
                    let value = Math.random() * encounters.reduce((sum, entry) => sum + entry.weight, 0);
                    troopId = 0;
                    for (const entry of encounters) {
                        value -= entry.weight;
                        if (value < 0) { troopId = entry.troopId; break; }
                    }
                } else if (p[0] !== 0 && p[0] !== 1) throw new Error('Kiểu chọn troop không hợp lệ');
                if (!this.partyIds().length) throw new Error('Không thể vào trận với tổ đội trống');
                const encounter = this.game.data.createTroopEncounter(troopId);
                const token = { done: false, result: null };
                const bgs = this.game.audio.currentBgs;
                const audio = { bgm: this.game.audio.saveBgm(), bgs: bgs ? { name: bgs.name, ...bgs.options } : null };
                this.finishMove();
                this.leaving = true;
                this.game.changeScene(FNH.Scene_Battle, { encounter, returnScene: this, token,
                    canEscape: !!p[2], canLose: !!p[3], returnAudio: audio,
                    returnX: this.game.player.mapX, returnY: this.game.player.mapY, returnDir: this.game.player.direction });
                return { type: 'battle', token };
            } else if (command.code === 129) {
                this.changePartyMember(p[0], p[1] === 1, !!p[2]);
            } else if (command.code === 124) {
                if (!this.game.eventTimer) this.game.eventTimer = { seconds: 0, working: false };
                if (p[0] === 0) {
                    this.game.eventTimer.seconds = Math.max(0, Number(p[1]) || 0);
                    this.game.eventTimer.working = true;
                } else this.game.eventTimer.working = false;
            } else if (command.code === 134 || command.code === 135) {
                const key = command.code === 134 ? 'system:saveDisabled' : 'system:menuDisabled';
                this.game.flags[key] = p[0] === 0;
            } else if (command.code === 211) {
                this.game.player.transparent = p[0] === 0;
            } else if (command.code === 351) {
                if (this.game.sceneName === 'battle') return;
                this.openPause();
                return { type: 'pause', scene: this };
            } else if (command.code === 353 || command.code === 354) {
                this.leaving = true;
                if (command.code === 353) this.game.gameOver();
                else this.game.returnToTitle();
                return false;
            } else if (command.code === 123) {
                if (!this.eventId) return;
                const key = 'self:' + (this.game.mapId || 1) + ':' + this.eventId + ':' + String(p[0] || 'A');
                this.game.flags[key] = p[1] === 0;
            } else if (command.code === 212) {
                if (this.battle) return;
                const target = this.mapCharacter(p[0]);
                if (!target) return;
                const data = this.game.data.animations[p[1]];
                if (!data) throw new Error('Không tìm thấy animation ' + p[1]);
                const animation = new FNH.BattleAnimation(data, this.game.assets, this.game.audio, target, (error) => {
                    this.game.lastError = error;
                    this.game.showToast(error.message, 6);
                });
                this.animations.push(animation);
                if (p[2]) return { type: 'animation', animation };
            } else if (command.code === 337) {
                if (!this.battle) return;
                const targets = this.battle.enemies.filter((enemy, index) =>
                    !enemy.hidden && enemy.hp > 0 && (p[2] || p[0] < 0 || index === p[0]));
                this.battle.showAnimation(p[1], targets);
            } else if (command.code === 339) {
                if (!this.battle) return;
                const users = p[0] === 0 ? this.battle.enemies.filter((enemy, index) => p[1] < 0 || index === p[1])
                    : p[1] === 0 ? this.battle.members : [this.eventActor(p[1])];
                let performed = false;
                for (const user of users) performed = this.battle.forceAction(user, p[2], p[3]) || performed;
                if (performed) return { type: 'time', seconds: 0.75 };
            } else if (command.code === 340) {
                if (!this.battle) return;
                this.battle.result = 'fled';
                this.battle.returnToMap();
                return false;
            } else if ([331, 332, 333, 334, 335, 336, 342].includes(command.code)) {
                if (!this.battle) return;
                const enemies = p[0] < 0 ? this.battle.enemies : this.battle.enemies.filter((enemy, index) => index === p[0]);
                let value = p[2] === 1 ? Number(this.game.flags['variable:' + p[3]] || 0) : Number(p[3] || 0);
                if (p[1] === 1) value = -value;
                for (const enemy of enemies) {
                    if (command.code === 331 && enemy.hp > 0) {
                        this.game.data.setActorHp(enemy, Math.max(p[4] ? 0 : 1, Math.min(enemy.maxHp, enemy.hp + value)));
                    }
                    if (command.code === 332) enemy.mp = Math.max(0, Math.min(enemy.maxMp, enemy.mp + value));
                    if (command.code === 342) enemy.tp = Math.max(0, Math.min(100, (enemy.tp || 0) + value));
                    if (command.code === 333) {
                        if (p[1] === 0) this.game.data.addActorState(enemy, p[2]);
                        else this.game.data.removeActorState(enemy, p[2]);
                    }
                    if (command.code === 334) this.game.data.recoverActor(enemy);
                    if (command.code === 335) enemy.hidden = false;
                    if (command.code === 336) {
                        this.game.data.transformEnemy(enemy, p[1]);
                        for (const part of enemy.parts) this.game.assets.loadImage(part.image).catch((error) => {
                            this.game.lastError = error;
                            this.game.showToast(error.message, 6);
                        });
                    }
                }
            } else if ([311, 312, 313, 314, 317, 318, 326].includes(command.code)) {
                const actors = this.eventActorTargets(p[0], p[1]);
                let value = p[3] === 1 ? Number(this.game.flags['variable:' + p[4]] || 0) : Number(p[4] || 0);
                if (p[2] === 1) value = -value;
                for (const actor of actors) {
                    if (command.code === 311 && actor.hp > 0) {
                        this.game.data.setActorHp(actor, Math.max(p[5] ? 0 : 1, Math.min(actor.maxHp, actor.hp + value)));
                    }
                    if (command.code === 312) actor.mp = Math.max(0, Math.min(actor.maxMp, actor.mp + value));
                    if (command.code === 326) actor.tp = Math.max(0, Math.min(100, (actor.tp || 0) + value));
                    if (command.code === 313) {
                        if (p[2] === 0) this.game.data.addActorState(actor, p[3]);
                        else this.game.data.removeActorState(actor, p[3]);
                    }
                    if (command.code === 314) this.game.data.recoverActor(actor);
                    if (command.code === 317) {
                        const amount = p[4] === 1 ? Number(this.game.flags['variable:' + p[5]] || 0) : Number(p[5] || 0);
                        if (!Number.isInteger(p[2]) || p[2] < 0 || p[2] > 7) throw new Error('Chỉ số actor không hợp lệ');
                        const bonus = actor.paramPlus || (actor.paramPlus = []);
                        bonus[p[2]] = Number(bonus[p[2]] || 0) + (p[3] === 0 ? amount : -amount);
                        this.game.data.refreshActor(actor);
                    }
                    if (command.code === 318) {
                        const skills = actor.skills || (actor.skills = []);
                        const index = skills.indexOf(p[3]);
                        if (p[2] === 0 && index < 0 && this.game.data.skill(p[3])) skills.push(p[3]);
                        if (p[2] === 1 && index >= 0) skills.splice(index, 1);
                        skills.sort((a, b) => a - b);
                    }
                }
            } else if (command.code === 319) {
                const actor = this.eventActor(p[0]);
                if (actor) this.game.data.changeEquipment(actor, p[1] - 1, p[2],
                    this.game.player.inventory || (this.game.player.inventory = []));
            } else if ([320, 322, 324, 325].includes(command.code)) {
                const actor = this.eventActor(p[0]);
                if (!actor) return;
                if (command.code === 320) actor.name = String(p[1]);
                if (command.code === 324) actor.nickname = String(p[1]);
                if (command.code === 325) actor.profile = String(p[1]);
                if (command.code === 322) {
                    actor.characterName = p[1]; actor.characterIndex = p[2];
                    actor.faceName = p[3]; actor.faceIndex = p[4]; actor.battlerName = p[5];
                    actor.portrait = 'pictures/' + actor.faceName + '_' + (actor.faceIndex + 1);
                    this.loadActorImages(actor);
                }
            } else if (command.code === 125) {
                const operation = Number(p[0] || 0);
                let amount = Number(p[2] || 0);
                if (p[1] === 1) amount = Number(this.game.flags['variable:' + amount] || 0);
                this.game.gold = Math.max(0, this.game.gold + (operation === 0 ? amount : -amount));
            } else if (command.code >= 126 && command.code <= 128) {
                const kind = ['item', 'weapon', 'armor'][command.code - 126];
                const itemId = Number(p[0] || 0);
                let amount = Number(p[3] || 0);
                if (p[2] === 1) amount = Number(this.game.flags['variable:' + amount] || 0);
                const inventory = this.game.player.inventory || (this.game.player.inventory = []);
                const entry = inventory.find((item) => item.id === itemId && (item.kind || 'item') === kind);
                const delta = p[1] === 0 ? amount : -amount;
                let shortage = kind !== 'item' && p[4] ? Math.max(0, -delta - (entry ? entry.amount : 0)) : 0;
                const total = Math.max(0, (entry ? entry.amount : 0) + delta);
                if (entry) {
                    entry.amount = total;
                    if (!total) inventory.splice(inventory.indexOf(entry), 1);
                } else if (total > 0) {
                    inventory.push(kind === 'item' ? { id: itemId, amount: total } : { id: itemId, amount: total, kind });
                }
                if (shortage > 0) {
                    for (const id of this.partyIds()) {
                        const actor = this.eventActor(id);
                        actor.equipment = (actor.equipment || []).filter((item) => {
                            if (shortage > 0 && item.type === kind && item.id === itemId) { shortage -= 1; return false; }
                            return true;
                        });
                        this.game.data.refreshActor(actor);
                        if (!shortage) break;
                    }
                }
            } else if (command.code >= 231 && command.code <= 235) {
                const pictures = this.game.pictures || (this.game.pictures = new FNH.PictureManager(this.game.assets));
                const scope = this.game.sceneName === 'battle' ? 'battle' : 'map';
                const values = (start) => ({
                    x: p[start] === 0 ? p[start + 1] : Number(this.game.flags['variable:' + p[start + 1]] || 0),
                    y: p[start] === 0 ? p[start + 2] : Number(this.game.flags['variable:' + p[start + 2]] || 0),
                    scaleX: p[start + 3], scaleY: p[start + 4], opacity: p[start + 5]
                });
                if (command.code === 231) pictures.show(p[0], p[1], p[2], values(3), p[9], scope);
                if (command.code === 232) {
                    pictures.move(p[0], p[2], values(3), p[9], p[10], scope);
                    if (p[11] && p[10] > 0) return { type: 'time', seconds: p[10] / 60 };
                }
                if (command.code === 233) pictures.rotate(p[0], p[1], scope);
                if (command.code === 234) {
                    pictures.tint(p[0], p[1], p[2], scope);
                    if (p[3] && p[2] > 0) return { type: 'time', seconds: p[2] / 60 };
                }
                if (command.code === 235) pictures.erase(p[0], scope);
            } else if (command.code >= 221 && command.code <= 225) {
                const screen = this.game.screenEffects || (this.game.screenEffects = new FNH.ScreenEffects());
                if (command.code === 221 || command.code === 222) {
                    screen.fade(command.code === 221 ? 0 : 255, 24);
                    return { type: 'time', seconds: 24 / 60 };
                }
                if (command.code === 223) screen.tint(p[0], p[1]);
                if (command.code === 224) screen.startFlash(p[0], p[1]);
                if (command.code === 225) screen.shake(p[0], p[1], p[2]);
                const frames = command.code === 225 ? p[2] : p[1];
                const wait = command.code === 225 ? p[3] : p[2];
                if (wait && frames > 0) return { type: 'time', seconds: frames / 60 };
            } else if (command.code === 205) {
                const character = this.mapCharacter(p[0]);
                if (!character) return;
                if (character.id === -1) this.finishMove();
                const route = new FNH.MoveRoute(this, character, p[1] || {});
                character.prelockDirection = 0;
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
                    other.prelockDirection = 0;
                    other.x = other.realX = x;
                    other.y = other.realY = y;
                } else if (p[1] === 0 || p[1] === 1) {
                    character.x = p[1] === 0 ? p[2] : Number(this.game.flags['variable:' + p[2]] || 0);
                    character.y = p[1] === 0 ? p[3] : Number(this.game.flags['variable:' + p[3]] || 0);
                } else throw new Error('Chưa hỗ trợ kiểu định vị event ' + p[1]);
                character.motion = null;
                character.prelockDirection = 0;
                character.realX = character.x;
                character.realY = character.y;
                if (p[4]) character.direction = p[4];
                this.refreshEvents();
            } else if (command.code === 214) {
                if (this.eventId) {
                    this.erasedEvents.add(this.eventId);
                    this.refreshEvents();
                }
            } else if ([241, 242, 243, 244, 245, 246, 250, 251].includes(command.code)) {
                const audio = this.game.audio;
                const play = (method) => {
                    const sound = p[0] || {};
                    if (!sound.name) {
                        if (method === 'playBgm') audio.stopBgm(0);
                        if (method === 'playBgs') audio.stopBgs(0);
                        return;
                    }
                    const result = audio[method](sound.name, {
                        volume: (sound.volume === undefined ? 90 : Number(sound.volume)) / 100,
                        pitch: sound.pitch === undefined ? 100 : sound.pitch,
                        pan: sound.pan || 0
                    });
                    if (result && result.catch) result.catch((error) => {
                        this.game.lastError = error;
                        this.game.showToast(error.message, 6);
                    });
                };
                if (command.code === 241) play('playBgm');
                if (command.code === 242) audio.stopBgm(Math.max(0, Number(p[0]) || 0));
                if (command.code === 243) this.game.savedBgm = audio.saveBgm();
                if (command.code === 244 && this.game.savedBgm) {
                    const sound = this.game.savedBgm;
                    audio.playBgm(sound.name, sound).catch((error) => {
                        this.game.lastError = error;
                        this.game.showToast(error.message, 6);
                    });
                }
                if (command.code === 245) play('playBgs');
                if (command.code === 246) audio.stopBgs(Math.max(0, Number(p[0]) || 0));
                if (command.code === 250) play('playSe');
                if (command.code === 251) audio.stopSe();
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
            if (this.leaving || !this.partyIds().length) return;
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
            for (const animation of this.animations) {
                if (!options || animation.target.id !== options.characterId) continue;
                if (animation.hidden) return;
                image = animation.tint(image);
            }
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
                    transparent: event.transparent, blendMode: event.blendMode, characterId: event.id });
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
            if (this.partyIds().length) sprites.push({
                y: playerFootY,
                priority: 1,
                draw: () => {
                    if (!player.transparent && (!this.playerRouteState || !this.playerRouteState.transparent)) {
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
                            transparent: player.transparent || this.playerRouteState.transparent, blendMode: this.playerRouteState.blendMode, characterId: -1 }
                            : { transparent: player.transparent, characterId: -1 }
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
            if (!this.partyIds().length) {
                FNH.text(ctx, 'TỔ ĐỘI TRỐNG', 24, 40, { size: 18, color: '#eee0c4' });
                return;
            }
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
            FNH.text(ctx, 'TẠM DỪNG · ' + this.partyIds().length + ' THÀNH VIÊN', panel.x + 24, panel.y + 34, {
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
            ctx.save();
            if (this.game.screenEffects) ctx.translate(this.game.screenEffects.shakeX, 0);
            this.drawTiles(ctx, false);
            this.drawCharacters(ctx);
            this.drawTiles(ctx, true);
            this.drawAboveCharacters(ctx);
            for (const animation of this.animations) {
                const target = animation.target;
                const x = target.id === -1 ? this.playerVisual.x : (target.realX ?? target.x);
                const y = target.id === -1 ? this.playerVisual.y : (target.realY ?? target.y);
                const name = target.id === -1 ? this.game.player.characterName : target.imageName;
                const image = this.game.assets.imageCache.get('characters/' + name);
                const frame = image ? this.characterFrame(image, name, 0, 2, 1) : null;
                animation.draw(ctx, { x: x * FNH.TILE + FNH.TILE / 2 - this.camera.x,
                    y: y * FNH.TILE + FNH.TILE - this.camera.y, height: frame ? frame.sh : FNH.TILE });
            }

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

            ctx.restore();
            if (this.game.screenEffects) this.game.screenEffects.apply(ctx);
            if (this.game.pictures) this.game.pictures.draw(ctx, 'map');
            this.drawHud(ctx);
            this.drawBanner(ctx);
            if (this.game.gabs) this.game.gabs.draw(ctx);
            this.drawEventDialog(ctx);
            if (this.paused) this.drawPause(ctx);
        }
    };
})();
