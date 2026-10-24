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
                { id: 'continue', label: 'TIẾP TỤC', enabled: !!this.saveInfo },
                { id: 'new', label: 'TRÒ CHƠI MỚI', enabled: true },
                { id: 'sound', label: this.soundLabel(), enabled: true }
            ];
            this.index = this.saveInfo ? 0 : 1;
            this.game.audio.stopBgs(0.35);
            this.game.audio.playBgm('fear_and_hunger', { volume: 0.5, loop: true });
        }

        soundLabel() {
            return this.game.audio.muted ? 'ÂM THANH: TẮT' : 'ÂM THANH: BẬT';
        }

        menuRect() {
            return { x: 532, y: 330, width: 248, height: 260 };
        }

        entryRects() {
            const panel = this.menuRect();
            return this.entries.map(function (entry, index) {
                return {
                    x: panel.x + 16,
                    y: panel.y + 56 + index * 44,
                    width: panel.width - 32,
                    height: 38
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
                    this.entries[0].enabled = false;
                    this.index = 1;
                }
            } else if (entry.id === 'new') {
                this.game.changeScene(FNH.Scene_Creation);
            } else if (entry.id === 'sound') {
                this.game.toggleMute();
                this.entries[2].label = this.soundLabel();
            }
        }

        update(dt) {
            this.time += dt;
            const input = this.input;

            if (input.isPressed('ArrowUp', 'w', 'W')) this.moveSelection(-1);
            if (input.isPressed('ArrowDown', 's', 'S')) this.moveSelection(1);
            if (input.isPressed('Enter', ' ', 'z', 'Z')) this.activate(this.index);
            if (input.isPressed('m', 'M')) {
                this.game.toggleMute();
                this.entries[2].label = this.soundLabel();
            }

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
            const title = this.game.assets.imageCache.get('titles2/title2');
            if (title) {
                ctx.drawImage(title, 0, 0, FNH.WIDTH, FNH.HEIGHT);
            } else {
                FNH.drawBackdrop(ctx, '#17110e', '#050403');
            }

            const shade = ctx.createLinearGradient(0, FNH.HEIGHT * 0.28, 0, FNH.HEIGHT);
            shade.addColorStop(0, 'rgba(3,3,4,0)');
            shade.addColorStop(0.55, 'rgba(3,3,4,0.42)');
            shade.addColorStop(1, 'rgba(3,3,4,0.92)');
            ctx.fillStyle = shade;
            ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);

            const sideShade = ctx.createLinearGradient(FNH.WIDTH * 0.45, 0, FNH.WIDTH, 0);
            sideShade.addColorStop(0, 'rgba(3,3,4,0)');
            sideShade.addColorStop(1, 'rgba(3,3,4,0.6)');
            ctx.fillStyle = sideShade;
            ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);

            FNH.panel(ctx, FNH.WIDTH - 306, 22, 272, 46, {
                alpha: 0.6,
                fillTop: 'rgba(10,10,10,0.7)',
                fillBottom: 'rgba(4,4,4,0.82)',
                border: 'rgba(186,163,112,0.3)'
            });
            FNH.text(ctx, 'ENGINE WEB ĐỘC LẬP', FNH.WIDTH - 34, 41, {
                size: 11,
                color: 'rgba(235,220,188,0.84)',
                weight: 600,
                align: 'right'
            });
            FNH.text(ctx, 'đọc trực tiếp dữ liệu gốc', FNH.WIDTH - 34, 58, {
                size: 10,
                color: 'rgba(221,207,178,0.5)',
                align: 'right'
            });

            const panel = this.menuRect();
            FNH.panel(ctx, panel.x, panel.y, panel.width, panel.height, {
                alpha: 0.94,
                fillTop: 'rgba(19,17,14,0.94)',
                fillBottom: 'rgba(5,5,5,0.97)',
                border: 'rgba(186,163,112,0.62)'
            });
            FNH.text(ctx, 'HÀNH TRÌNH', panel.x + 18, panel.y + 30, {
                size: 15,
                weight: 600,
                color: '#e8d9b8'
            });
            ctx.strokeStyle = 'rgba(186,163,112,0.24)';
            ctx.beginPath();
            ctx.moveTo(panel.x + 18, panel.y + 40);
            ctx.lineTo(panel.x + panel.width - 18, panel.y + 40);
            ctx.stroke();

            const rects = this.entryRects();
            for (let i = 0; i < this.entries.length; i += 1) {
                const entry = this.entries[i];
                FNH.button(ctx, rects[i], entry.label, {
                    selected: i === this.index,
                    hover: i === this.hoverIndex,
                    disabled: !entry.enabled,
                    size: 15
                });
            }

            if (this.saveInfo) {
                const infoY = panel.y + 200;
                FNH.text(ctx, 'LẦN LƯU GẦN NHẤT', panel.x + 18, infoY, {
                    size: 10,
                    weight: 600,
                    color: 'rgba(205,185,143,0.6)'
                });
                FNH.text(ctx,
                    this.saveInfo.playerName + ' · ' + this.saveInfo.className + ' · Cấp ' + this.saveInfo.level,
                    panel.x + 18, infoY + 19, {
                        size: 12,
                        color: '#d9c9a7'
                    });
                FNH.text(ctx,
                    FNH.formatDate(this.saveInfo.savedAt) + ' · ' + FNH.formatTime(this.saveInfo.playtime),
                    panel.x + 18, infoY + 37, {
                        size: 11,
                        color: 'rgba(201,185,150,0.58)'
                    });
            } else {
                FNH.text(ctx, 'Chưa có dữ liệu lưu trong trình duyệt này.', panel.x + 18, panel.y + 200, {
                    size: 11,
                    color: 'rgba(201,185,150,0.46)'
                });
            }

            FNH.drawKeyHint(ctx, 34, 592, '↑ ↓', 'chọn', { size: 11 });
            FNH.drawKeyHint(ctx, 118, 592, 'ENTER', 'xác nhận', { size: 11 });
            FNH.drawKeyHint(ctx, 236, 592, 'M', 'tắt tiếng', { size: 11 });
        }
    };
})();
