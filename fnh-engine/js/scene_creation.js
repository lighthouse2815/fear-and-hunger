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
            return this.classes.map((entry, index) => ({
                x: 40 + index * 185, y: 65, width: 182, height: 360
            }));
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

            this.hoverIndex = -1;
            for (let i = 0; i < cards.length; i += 1) {
                if (FNH.hit(cards[i], input.mouse.x, input.mouse.y)) {
                    this.hoverIndex = i;
                    break;
                }
            }
        }

        draw(ctx) {
            const images = this.game.assets.imageCache;
            const background = images.get('pictures/character_select_bg');
            if (background) ctx.drawImage(background, 0, 0);
            const cards = this.cardRects();
            const selected = cards[this.index];
            const backing = images.get('pictures/background_character');
            const border = images.get('pictures/border_character');
            if (backing && selected) ctx.drawImage(backing, selected.x, selected.y);
            this.classes.forEach((entry, index) => {
                const portrait = images.get(entry.portrait);
                if (portrait) ctx.drawImage(portrait, cards[index].x, cards[index].y);
            });
            if (border && selected) ctx.drawImage(border, selected.x, selected.y);
            const entry = this.classes[this.index];
            const description = entry && images.get('pictures/' + entry.text);
            if (description) ctx.drawImage(description, 50, 445);
        }
    };
})();
