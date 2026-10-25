'use strict';
/* ============================================================
   FNH Engine — màn hình tiêu đề
   ============================================================ */
(function () {
    const FNH = window.FNH = window.FNH || {};

    FNH.Scene_Title = class Scene_Title extends FNH.Scene {
        constructor() {
            super();
            this.name = 'title';
            this.time = 0;
            this.index = 0;
            this.saveInfo = null;
            this.entries = [];
            this.hoverIndex = -1;
        }

        enter() {
            this.time = 0;
            this.saveInfo = this.game.getSaveInfo();
            this.entries = [
                { id: 'new', label: this.game.data.system.terms.commands[18], enabled: true },
                { id: 'continue', label: this.game.data.system.terms.commands[19], enabled: !!this.saveInfo }
            ];
            this.index = this.saveInfo ? 1 : 0;
            this.game.audio.stopBgs(0.35);
            const bgm = this.game.data.system.titleBgm;
            this.game.audio.playBgm(bgm.name, { volume: bgm.volume / 100, pitch: bgm.pitch, pan: bgm.pan, loop: true });
        }

        menuRect() {
            return { x: 288, y: 420, width: 240, height: 108 };
        }

        entryRects() {
            const panel = this.menuRect();
            return this.entries.map((entry, index) => ({
                x: panel.x + 18, y: panel.y + 18 + index * 36,
                width: panel.width - 36, height: 36
            }));
        }

        moveSelection(step) {
            let next = this.index;
            for (let i = 0; i < this.entries.length; i += 1) {
                next = (next + step + this.entries.length) % this.entries.length;
                if (this.entries[next].enabled) break;
            }
            if (next !== this.index) {
                this.index = next;
                this.game.audio.playSe('fnh_cursor', { volume: 0.45 });
            }
        }

        activate(index) {
            const entry = this.entries[index];
            if (!entry || !entry.enabled) return;
            this.game.audio.playSe('fnh_choice', { volume: 0.55 });
            if (entry.id === 'continue') {
                if (!this.game.loadGame()) {
                    this.saveInfo = null;
                    this.entries[1].enabled = false;
                    this.index = 0;
                }
            } else if (entry.id === 'new') {
                this.game.changeScene(FNH.Scene_Creation);
            }
        }

        update(dt) {
            this.time += dt;
            const input = this.input;

            if (input.isPressed('ArrowUp', 'w', 'W')) this.moveSelection(-1);
            if (input.isPressed('ArrowDown', 's', 'S')) this.moveSelection(1);
            if (input.isPressed('Enter', ' ', 'z', 'Z')) this.activate(this.index);
            if (input.isPressed('m', 'M')) this.game.toggleMute();

            const rects = this.entryRects();
            this.hoverIndex = -1;
            for (let i = 0; i < rects.length; i += 1) {
                if (FNH.hit(rects[i], input.mouse.x, input.mouse.y)) {
                    this.hoverIndex = i;
                    break;
                }
            }
            if (this.hoverIndex >= 0 && this.entries[this.hoverIndex].enabled && this.hoverIndex !== this.index) {
                this.index = this.hoverIndex;
                this.game.audio.playSe('fnh_cursor', { volume: 0.4 });
            }

            const click = input.consumeClick();
            if (click) {
                for (let i = 0; i < rects.length; i += 1) {
                    if (FNH.hit(rects[i], click.x, click.y)) {
                        this.index = i;
                        this.activate(i);
                        break;
                    }
                }
            }
        }

        draw(ctx) {
            const title = this.game.assets.imageCache.get('titles2/' + this.game.data.system.title2Name);
            if (title) ctx.drawImage(title, 0, 0, FNH.WIDTH, FNH.HEIGHT);
            const rects = this.entryRects();
            FNH.drawWindow(ctx, this.game.assets.imageCache.get('system/Window|plain'),
                this.menuRect(), rects[this.index], this.time);
            this.entries.forEach((entry, index) => {
                const rect = rects[index];
                FNH.text(ctx, entry.label, rect.x + rect.width / 2, rect.y + 18, {
                    size: 28, color: entry.enabled ? '#fff' : 'rgba(255,255,255,0.5)',
                    align: 'center', baseline: 'middle', shadow: true
                });
            });
        }
    };

    FNH.Scene_Splash = class Scene_Splash extends FNH.Scene {
        constructor() {
            super();
            this.name = 'splash';
            this.time = 0;
        }

        update(dt) {
            this.time += dt;
            if (this.time >= 260 / 60) this.game.changeScene(FNH.Scene_Title);
        }

        draw(ctx) {
            const splash = this.game.assets.imageCache.get('pictures/splash_screen1');
            const frame = this.time * 60;
            if (!splash) return;
            ctx.save();
            ctx.globalAlpha = FNH.clamp(Math.min((frame - 40) / 40, (220 - frame) / 40), 0, 1);
            ctx.drawImage(splash, 0, 0, FNH.WIDTH, FNH.HEIGHT);
            ctx.restore();
        }
    };
})();
