'use strict';
/* ============================================================
   FNH Engine — tạo nhân vật
   ============================================================ */
(function () {
    const FNH = window.FNH = window.FNH || {};

    FNH.Scene_Creation = class Scene_Creation extends FNH.Scene {
        constructor() {
            super();
            this.name = 'creation';
            this.time = 0;
            this.index = 0;
            this.classes = [];
            this.preview = null;
            this.hoverIndex = -1;
            this.hoverConfirm = false;
            this.leaving = false;
        }

        enter() {
            this.time = 0;
            this.classes = this.game.data.playable();
            this.index = 0;
            this.leaving = false;
            this.refreshPreview();
            this.game.audio.playBgm('fear_and_hunger', { volume: 0.5, loop: true });
        }

        refreshPreview() {
            const entry = this.classes[this.index];
            this.preview = entry ? this.game.data.createPlayer(entry.actorId) : null;
        }

        cardRects() {
            const width = 132;
            const height = 261;
            const gap = 16;
            const total = this.classes.length * width + (this.classes.length - 1) * gap;
            const startX = (FNH.WIDTH - total) / 2;
            return this.classes.map(function (entry, index) {
                return {
                    x: startX + index * (width + gap),
                    y: 92,
                    width: width,
                    height: height
                };
            });
        }

        confirmRect() {
            return { x: 632, y: 568, width: 144, height: 38 };
        }

        moveSelection(step) {
            if (!this.classes.length) return;
            const next = (this.index + step + this.classes.length) % this.classes.length;
            if (next !== this.index) {
                this.index = next;
                this.refreshPreview();
                this.game.audio.playSe('fnh_cursor', { volume: 0.45 });
            }
        }

        confirm() {
            if (this.leaving) return;
            const entry = this.classes[this.index];
            if (!entry) return;
            this.leaving = true;
            this.game.audio.playSe('fnh_choice', { volume: 0.6 });
            this.game.newGame(entry.actorId);
        }

        update(dt) {
            this.time += dt;
            const input = this.input;

            if (input.isPressed('ArrowLeft', 'a', 'A')) this.moveSelection(-1);
            if (input.isPressed('ArrowRight', 'd', 'D')) this.moveSelection(1);
            if (input.isPressed('Enter', ' ', 'z', 'Z')) this.confirm();
            if (input.isPressed('Escape', 'x', 'X')) {
                this.game.audio.playSe('fnh_cancel', { volume: 0.45 });
                this.game.changeScene(FNH.Scene_Title);
            }

            const cards = this.cardRects();
            const click = input.consumeClick();
            if (click) {
                if (FNH.hit(this.confirmRect(), click.x, click.y)) {
                    this.confirm();
                } else {
                    for (let i = 0; i < cards.length; i += 1) {
                        if (FNH.hit(cards[i], click.x, click.y)) {
                            if (i === this.index) {
                                this.confirm();
                            } else {
                                this.index = i;
                                this.refreshPreview();
                                this.game.audio.playSe('fnh_choice', { volume: 0.45 });
                            }
                            break;
                        }
                    }
                }
            }

            this.hoverIndex = -1;
            for (let i = 0; i < cards.length; i += 1) {
                if (FNH.hit(cards[i], input.mouse.x, input.mouse.y)) {
                    this.hoverIndex = i;
                    break;
                }
            }
            this.hoverConfirm = FNH.hit(this.confirmRect(), input.mouse.x, input.mouse.y);
        }

        drawCard(ctx, rect, entry, selected, hover) {
            const background = this.game.assets.imageCache.get('pictures/background_character');
            const border = this.game.assets.imageCache.get('pictures/border_character');
            const portrait = this.game.assets.imageCache.get(entry.portrait);

            ctx.save();
            if (selected) {
                ctx.shadowColor = 'rgba(211,177,105,0.75)';
                ctx.shadowBlur = 18;
            }
            ctx.fillStyle = '#080808';
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
            ctx.restore();

            if (background) {
                ctx.drawImage(background, rect.x, rect.y, rect.width, rect.height);
            }
            if (portrait) {
                ctx.drawImage(portrait, rect.x, rect.y, rect.width, rect.height);
            } else {
                FNH.text(ctx, '…', rect.x + rect.width / 2, rect.y + rect.height / 2, {
                    size: 24,
                    color: 'rgba(210,195,160,0.4)',
                    align: 'center',
                    baseline: 'middle'
                });
            }
            if (border) {
                ctx.drawImage(border, rect.x, rect.y, rect.width, rect.height);
            }

            const shade = ctx.createLinearGradient(0, rect.y + rect.height - 58, 0, rect.y + rect.height);
            shade.addColorStop(0, 'rgba(0,0,0,0)');
            shade.addColorStop(1, 'rgba(0,0,0,0.9)');
            ctx.fillStyle = shade;
            ctx.fillRect(rect.x + 1, rect.y + rect.height - 58, rect.width - 2, 57);

            FNH.text(ctx, entry.name, rect.x + rect.width / 2, rect.y + rect.height - 27, {
                size: 17,
                weight: 600,
                color: selected ? '#fff0c8' : '#e0d4bb',
                align: 'center',
                shadow: true
            });
            FNH.text(ctx, entry.role, rect.x + rect.width / 2, rect.y + rect.height - 10, {
                size: 9,
                weight: 600,
                color: selected ? 'rgba(232,204,146,0.9)' : 'rgba(200,187,158,0.58)',
                align: 'center'
            });

            ctx.save();
            ctx.strokeStyle = selected
                ? 'rgba(231,199,128,0.95)'
                : hover
                    ? 'rgba(196,174,126,0.65)'
                    : 'rgba(111,101,82,0.38)';
            ctx.lineWidth = selected ? 2 : 1;
            ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
            ctx.restore();

            if (selected) {
                ctx.save();
                ctx.fillStyle = '#d9b875';
                ctx.beginPath();
                ctx.moveTo(rect.x + rect.width / 2 - 7, rect.y - 10);
                ctx.lineTo(rect.x + rect.width / 2 + 7, rect.y - 10);
                ctx.lineTo(rect.x + rect.width / 2, rect.y - 2);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
        }

        draw(ctx) {
            const background = this.game.assets.imageCache.get('pictures/character_select_bg');
            if (background) {
                ctx.drawImage(background, 0, 0, FNH.WIDTH, FNH.HEIGHT);
            } else {
                FNH.drawBackdrop(ctx);
            }
            const shade = ctx.createLinearGradient(0, 0, 0, FNH.HEIGHT);
            shade.addColorStop(0, 'rgba(3,3,4,0.52)');
            shade.addColorStop(0.45, 'rgba(3,3,4,0.16)');
            shade.addColorStop(1, 'rgba(3,3,4,0.74)');
            ctx.fillStyle = shade;
            ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);

            FNH.text(ctx, 'TẠO NHÂN VẬT', 48, 50, {
                size: 27,
                weight: 600,
                color: '#ece0c6',
                shadow: true
            });
            FNH.text(ctx, 'Chọn một nghề nghiệp. Mỗi con đường dẫn xuống cùng một ngục địa.', 48, 74, {
                size: 13,
                color: 'rgba(216,203,177,0.66)'
            });
            FNH.text(ctx, 'BƯỚC 1 / 2', FNH.WIDTH - 48, 50, {
                size: 11,
                weight: 600,
                color: 'rgba(216,190,133,0.62)',
                align: 'right'
            });

            const cards = this.cardRects();
            for (let i = 0; i < cards.length; i += 1) {
                this.drawCard(ctx, cards[i], this.classes[i], i === this.index, i === this.hoverIndex);
            }

            const entry = this.classes[this.index];
            const textImage = entry && this.game.assets.imageCache.get('pictures/' + entry.text);
            if (textImage) {
                ctx.drawImage(textImage, 48, 372, 720, 169);
            } else {
                FNH.panel(ctx, 48, 372, 720, 169, {
                    fillTop: 'rgba(16,15,13,0.9)',
                    fillBottom: 'rgba(5,5,5,0.94)'
                });
                FNH.text(ctx, entry ? entry.name : '', 408, 430, {
                    size: 22,
                    weight: 600,
                    color: '#e5d6b8',
                    align: 'center'
                });
            }

            if (this.preview) {
                const stats = [
                    'HP ' + this.preview.maxHp,
                    'MP ' + this.preview.maxMp,
                    'ATK ' + this.preview.atk,
                    'DEF ' + this.preview.def,
                    'AGI ' + this.preview.agi
                ].join('   ·   ');
                FNH.text(ctx, stats, 48, 562, {
                    size: 12,
                    weight: 600,
                    color: 'rgba(221,207,177,0.72)'
                });
            }

            const confirm = this.confirmRect();
            FNH.button(ctx, confirm, 'BƯỚC VÀO', {
                selected: true,
                hover: this.hoverConfirm,
                size: 15
            });

            FNH.drawKeyHint(ctx, 48, 592, '← →', 'đổi nghề', { size: 11 });
            FNH.drawKeyHint(ctx, 150, 592, 'ENTER', 'xác nhận', { size: 11 });
            FNH.drawKeyHint(ctx, 268, 592, 'ESC', 'quay lại', { size: 11 });
        }
    };
})();
