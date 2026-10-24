'use strict';
/* ============================================================
   FNH Engine — điều phối cảnh, lưu/đọc và vòng lặp chính
   ============================================================ */
(function () {
    const FNH = window.FNH = window.FNH || {};

    const SAVE_SLOT = 1;

    const PRELOAD = [
        'titles2/title2',
        'pictures/character_select_bg',
        'pictures/background_character',
        'pictures/border_character',
        'pictures/text_mercenary',
        'pictures/text_knight',
        'pictures/text_darkpriest',
        'pictures/text_outlander',
        'pictures/Actor1_1',
        'pictures/Actor1_3',
        'pictures/Actor1_7',
        'pictures/Actor1_8',
        'faces/Actor1',
        'characters/mercenary',
        'characters/knight',
        'characters/dark_priest',
        'characters/outlander',
        'characters/$guard1',
        'characters/!Flame',
        'characters/mauler1',
        'characters/$boxes',
        'tilesets/Inside_A5',
        'tilesets/Inside_B',
        'tilesets/Inside_C_3',
        'tilesets/Inside_D2',
        'battlebacks1/floor1',
        'enemies/guard1_torso',
        'enemies/guard1_head',
        'enemies/guard1_R_hand',
        'enemies/guard1_L_hand',
        'enemies/guard1_R_leg',
        'enemies/guard1_L_leg',
        'enemies/guard1_stinger'
    ];

    FNH.Game = class Game {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.input = new FNH.Input(canvas);
            this.assets = new FNH.AssetLoader({ root: '/game/' });
            this.data = new FNH.DataStore(this.assets);
            this.audio = new FNH.AudioManager(this.assets);
            this.storage = new FNH.Storage();
            this.transition = new FNH.Transition();

            this.scene = null;
            this.sceneName = 'boot';
            this.booted = false;
            this.running = false;
            this.time = 0;
            this.playtime = 0;
            this.lastFrame = 0;
            this.player = null;
            this.gold = 0;
            this.mapId = 1;
            this.guardDefeated = false;
            this.flags = {};
            this.toast = null;
            this.toastTimer = 0;
            this.saveSlot = SAVE_SLOT;
            this.preloadDone = 0;
            this.preloadTotal = PRELOAD.length;
            this.lastError = null;

            this._loop = this._loop.bind(this);
        }

        async boot(onProgress) {
            this.assets.system = await this.assets.init();
            await this.data.loadCore();
            let done = 0;
            const total = PRELOAD.length;
            await Promise.all(PRELOAD.map(async (rel) => {
                try {
                    await this.assets.loadImage(rel);
                } catch (error) {
                    console.warn('[FNH] Không nạp được ảnh:', rel, error.message);
                }
                done += 1;
                this.preloadDone = done;
                if (onProgress) onProgress(done, total, rel);
            }));
            this.booted = true;
            return this;
        }

        start() {
            if (this.running) return;
            this.running = true;
            this.setScene(new FNH.Scene_Title());
            this.transition.alpha = 1;
            this.transition.fadeIn();
            this.lastFrame = performance.now();
            requestAnimationFrame(this._loop);
        }

        _loop(now) {
            if (!this.running) return;
            const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
            this.lastFrame = now;
            this.update(dt);
            this.draw();
            requestAnimationFrame(this._loop);
        }

        update(dt) {
            this.time += dt;
            if (this.sceneName === 'map' || this.sceneName === 'battle') {
                this.playtime += dt;
            }
            if (this.scene) this.scene.update(dt);
            this.transition.update(dt);
            if (this.toastTimer > 0) {
                this.toastTimer -= dt;
                if (this.toastTimer <= 0) this.toast = null;
            }
            this.input.clearFrame();
        }

        draw() {
            const ctx = this.ctx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
            if (this.scene) this.scene.draw(ctx);
            this.drawToast(ctx);
            this.transition.draw(ctx);
        }

        drawToast(ctx) {
            if (!this.toast) return;
            const alpha = Math.min(1, this.toastTimer * 2);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = '600 14px "FNH Serif", Georgia, serif';
            const width = Math.max(220, ctx.measureText(this.toast).width + 44);
            const x = (FNH.WIDTH - width) / 2;
            FNH.panel(ctx, x, 16, width, 38, {
                radius: 2,
                fillTop: 'rgba(24,21,17,0.96)',
                fillBottom: 'rgba(9,9,8,0.98)',
                border: 'rgba(196,174,126,0.65)'
            });
            FNH.text(ctx, this.toast, FNH.WIDTH / 2, 36, {
                size: 14,
                color: '#efe4ca',
                align: 'center',
                baseline: 'middle'
            });
            ctx.restore();
        }

        setScene(scene, options) {
            if (this.scene && this.scene.exit) this.scene.exit();
            this.scene = scene;
            this.sceneName = scene.name || scene.constructor.name;
            scene.game = this;
            scene.input = this.input;
            if (scene.enter) scene.enter(options || {});
        }

        changeScene(SceneClass, options) {
            if (this.transition.mode === 'out') return;
            this.transition.fadeOut(() => {
                this.setScene(new SceneClass(), options);
                this.transition.fadeIn();
            });
        }

        newGame(actorId) {
            this.player = this.data.createPlayer(actorId);
            this.player.mapX = 27;
            this.player.mapY = 67;
            this.player.direction = 8;
            this.gold = 0;
            this.playtime = 0;
            this.mapId = 1;
            this.guardDefeated = false;
            this.flags = {};
            this.changeScene(FNH.Scene_Map, { fresh: true });
        }

        saveGame() {
            if (!this.player) return false;
            const payload = {
                version: 1,
                savedAt: Date.now(),
                playtime: Math.round(this.playtime),
                mapId: this.mapId,
                player: this.player,
                gold: this.gold,
                guardDefeated: this.guardDefeated,
                flags: this.flags
            };
            return this.storage.save(this.saveSlot, payload);
        }

        getSaveInfo() {
            const save = this.storage.load(this.saveSlot);
            if (!save || save.version !== 1 || !save.player) return null;
            return {
                savedAt: save.savedAt,
                playtime: save.playtime || 0,
                mapId: save.mapId || 1,
                playerName: save.player.name || 'Nhân vật',
                className: save.player.className || '',
                level: save.player.level || 1,
                guardDefeated: !!save.guardDefeated
            };
        }

        loadGame() {
            const save = this.storage.load(this.saveSlot);
            if (!save || save.version !== 1 || !save.player) {
                this.showToast('Không tìm thấy dữ liệu lưu.');
                return false;
            }
            this.player = save.player;
            this.player.mapX = Number.isFinite(this.player.mapX) ? this.player.mapX : 27;
            this.player.mapY = Number.isFinite(this.player.mapY) ? this.player.mapY : 67;
            this.player.direction = this.player.direction || 2;
            this.player.hp = FNH.clamp(this.player.hp, 1, this.player.maxHp);
            this.gold = save.gold || 0;
            this.playtime = save.playtime || 0;
            this.mapId = save.mapId || 1;
            this.guardDefeated = !!save.guardDefeated;
            this.flags = save.flags || {};
            this.changeScene(FNH.Scene_Map, { fromSave: true });
            return true;
        }

        returnToTitle() {
            this.audio.stopAll();
            this.changeScene(FNH.Scene_Title);
        }

        gameOver() {
            this.audio.stopAll();
            this.changeScene(FNH.Scene_GameOver);
        }

        showToast(message, seconds) {
            this.toast = String(message);
            this.toastTimer = seconds || 2.2;
        }

        toggleMute() {
            const muted = this.audio.toggleMute();
            this.showToast(muted ? 'Đã tắt âm thanh' : 'Đã bật âm thanh', 1.5);
            return muted;
        }
    };

    FNH.Game.PRELOAD = PRELOAD;
})();
