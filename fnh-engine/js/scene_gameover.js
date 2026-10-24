'use strict';
/* ============================================================
   FNH Engine — màn hình thất bại
   ============================================================ */
(function () {
    const FNH = window.FNH = window.FNH || {};

    FNH.Scene_GameOver = class Scene_GameOver extends FNH.Scene {
        constructor() {
            super();
            this.name = 'gameover';
            this.time = 0;
            this.index = 0;
            this.hoverIndex = -1;
            this.saveInfo = null;
            this.entries = [];
        }

        enter() {
            this.time = 0;
            this.saveInfo = this.game.getSaveInfo();
            this.entries = [
                { id: 'load', label: 'TẢI LẦN LƯU CUỐI', enabled: !!this.saveInfo },
                { id: 'title', label: 'VỀ MÀN HÌNH CHÍNH', enabled: true }
            ];
            this.index = this.saveInfo ? 0 : 1;
            this.game.audio.stopAll();
        }

        panelRect() {
            return { x: 258, y: 350, width: 300, height: 176 };
        }

        entryRects() {
            const panel = this.panelRect();
            return this.entries.map(function (entry, index) {
                return {
                    x: panel.x + 22,
                    y: panel.y + 22 + index * 52,
                    width: panel.width - 44,
                    height: 42
                };
            });
        }

        moveSelection(step) {
            let next = this.index;
            for (let i = 0; i < this.entries.length; i += 1) {
                next = (next + step + this.entries.length) % this.entries.length;
                if (this.entries[next].enabled) break;
            }
            if (next !== this.index) {
                this.index = next;
                this.game.audio.playSe('fnh_cursor', { volume: 0.4 });
            }
        }

        activate(index) {
            const entry = this.entries[index];
            if (!entry || !entry.enabled) return;
            this.game.audio.playSe('fnh_choice', { volume: 0.5 });
            if (entry.id === 'load') {
                if (!this.game.loadGame()) {
                    this.saveInfo = null;
                    this.entries[0].enabled = false;
                    this.index = 1;
                }
            } else {
                this.game.returnToTitle();
            }
        }

        update(dt) {
            this.time += dt;
            const input = this.input;
            if (input.isPressed('ArrowUp', 'w', 'W')) this.moveSelection(-1);
            if (input.isPressed('ArrowDown', 's', 'S')) this.moveSelection(1);
            if (input.isPressed('Enter', ' ', 'z', 'Z')) this.activate(this.index);
            if (input.isPressed('Escape', 'x', 'X')) this.activate(this.entries.length - 1);

            const rects = this.entryRects();
            this.hoverIndex = -1;
            for (let i = 0; i < rects.length; i += 1) {
                if (FNH.hit(rects[i], input.mouse.x, input.mouse.y)) {
                    this.hoverIndex = i;
                    break;
                }
            }
            if (this.hoverIndex >= 0 && this.entries[this.hoverIndex].enabled &&
                this.hoverIndex !== this.index) {
                this.index = this.hoverIndex;
                this.game.audio.playSe('fnh_cursor', { volume: 0.35 });
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
            ctx.fillStyle = '#020202';
            ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
            const glow = ctx.createRadialGradient(
                FNH.WIDTH / 2, FNH.HEIGHT / 2 - 30, 20,
                FNH.WIDTH / 2, FNH.HEIGHT / 2 - 30, 430
            );
            glow.addColorStop(0, 'rgba(83,18,16,0.42)');
            glow.addColorStop(0.45, 'rgba(30,7,7,0.26)');
            glow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);

            FNH.text(ctx, 'BẠN ĐÃ CHẾT', FNH.WIDTH / 2, 212, {
                size: 42,
                weight: 600,
                color: '#d9c6ad',
                align: 'center',
                shadow: true,
                shadowColor: 'rgba(105,17,14,0.9)',
                shadowBlur: 18
            });
            FNH.text(ctx, 'Ngục địa không nhả con mồi của nó ra dễ dàng.', FNH.WIDTH / 2, 248, {
                size: 13,
                color: 'rgba(211,193,164,0.6)',
                align: 'center'
            });

            const player = this.game.player;
            const stats = [
                'Thời gian ' + FNH.formatTime(this.game.playtime),
                'Vàng ' + this.game.gold,
                this.game.guardDefeated ? 'Guard đã gục ngã' : 'Guard vẫn đứng đó'
            ].join('    ·    ');
            FNH.text(ctx, stats, FNH.WIDTH / 2, 292, {
                size: 11,
                color: 'rgba(197,179,149,0.55)',
                align: 'center'
            });
            if (player) {
                FNH.text(ctx, player.name + ' · ' + player.className + ' · Cấp ' + player.level,
                    FNH.WIDTH / 2, 316, {
                        size: 12,
                        weight: 600,
                        color: 'rgba(215,196,162,0.7)',
                        align: 'center'
                    });
            }

            const panel = this.panelRect();
            FNH.panel(ctx, panel.x, panel.y, panel.width, panel.height, {
                alpha: 0.95,
                fillTop: 'rgba(17,15,13,0.95)',
                fillBottom: 'rgba(4,4,4,0.98)',
                border: 'rgba(157,125,92,0.48)'
            });
            const rects = this.entryRects();
            for (let i = 0; i < this.entries.length; i += 1) {
                FNH.button(ctx, rects[i], this.entries[i].label, {
                    selected: i === this.index,
                    hover: i === this.hoverIndex,
                    disabled: !this.entries[i].enabled,
                    size: 13
                });
            }
            if (this.saveInfo) {
                FNH.text(ctx,
                    'Lần lưu: ' + FNH.formatDate(this.saveInfo.savedAt) + ' · ' +
                    this.saveInfo.playerName + ' · Cấp ' + this.saveInfo.level,
                    FNH.WIDTH / 2, 494, {
                        size: 10,
                        color: 'rgba(201,183,151,0.46)',
                        align: 'center'
                    });
            }

            FNH.drawKeyHint(ctx, 34, 592, '↑ ↓', 'chọn', { size: 11 });
            FNH.drawKeyHint(ctx, 118, 592, 'ENTER', 'xác nhận', { size: 11 });
            FNH.drawVignette(ctx, FNH.WIDTH, FNH.HEIGHT, 0.45);
            FNH.drawGrain(ctx, FNH.WIDTH, FNH.HEIGHT, this.time);
        }
    };
})();
