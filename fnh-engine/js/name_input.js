'use strict';
(function () {
    const FNH = window.FNH = window.FNH || {};
    const pages = [
        ['ABCDEabcde', 'FGHIJfghij', 'KLMNOklmno', 'PQRSTpqrst', 'UVWXYuvwxy', 'Z[]^_z{}|~', '01234!#$%&', '56789()*+-', '/=@<>:; '],
        ['ÁÉÍÓÚáéíóú', 'ÀÈÌÒÙàèìòù', 'ÂÊÎÔÛâêîôû', 'ÄËÏÖÜäëïöü', 'ĀĒĪŌŪāēīōū', 'ÃÅÆÇÐãåæçð', 'ÑÕØŠŴñõøšŵ', 'ÝŶŸŽÞýÿŷžþ', 'ĲŒĳœß«» ']
    ].map((rows) => [...rows.join(''), 'Page', 'OK']);

    FNH.NameInput = class NameInput {
        constructor(scene, actor, maxLength) {
            this.scene = scene;
            this.actor = actor;
            this.limit = Math.max(1, Math.floor(Number(maxLength) || 1));
            this.value = [...String(actor.name || '')].slice(0, this.limit).join('');
            this.defaultName = this.value;
            this.index = 0;
            this.page = 0;
            this.time = 0;
            this.token = { done: false };
            this.wasPaused = scene.paused;
            scene.paused = true;
            scene.input.down.clear();
            scene.input.clearFrame();
            scene.game.canvas.focus();
        }

        cell(index) {
            const col = index % 10;
            return { x: 186 + col * 42 + (col >= 5 ? 24 : 0), y: 244 + Math.floor(index / 10) * 36,
                width: 42, height: 36 };
        }

        sound(name) { this.scene.game.audio.playSe(name, { volume: 0.5 }); }

        activate() {
            if (this.index === 88) {
                this.page = (this.page + 1) % pages.length;
            } else if (this.index === 89) {
                if (!this.value) { this.value = this.defaultName; return; }
                this.actor.name = this.value;
                this.close();
            } else if ([...this.value].length < this.limit) this.value += pages[this.page][this.index];
            else { this.sound('fnh_cancel'); return; }
            this.sound('fnh_choice');
        }

        close() {
            this.token.done = true;
            this.scene.paused = this.wasPaused;
            this.scene.nameInput = null;
            this.scene.closeNameInput = null;
            this.scene.input.down.clear();
            this.scene.input.clearFrame();
        }

        update(dt) {
            this.time += dt;
            const input = this.scene.input;
            const before = this.index;
            if (input.isPressed('ArrowDown')) this.index = (this.index + 10) % 90;
            if (input.isPressed('ArrowUp')) this.index = (this.index + 80) % 90;
            if (input.isPressed('ArrowLeft')) this.index += this.index % 10 === 0 ? 9 : -1;
            if (input.isPressed('ArrowRight')) this.index += this.index % 10 === 9 ? -9 : 1;
            if (input.isPressed('Shift')) this.index = 89;
            if (input.isPressed('PageDown', 'PageUp')) { this.page = (this.page + 1) % pages.length; this.sound('fnh_cursor'); }
            if (this.index !== before) this.sound('fnh_cursor');
            if (input.isPressed('Escape', 'Backspace', 'x', 'X')) {
                this.value = [...this.value].slice(0, -1).join('');
                this.sound('fnh_cancel');
            }
            if (input.isPressed('Enter', ' ', 'z', 'Z')) this.activate();
        }

        draw(ctx) {
            const game = this.scene.game;
            ctx.fillStyle = '#000'; ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
            if (game.openingBackground) {
                ctx.save(); ctx.filter = 'blur(4px)';
                ctx.drawImage(game.openingBackground, 0, 0); ctx.restore();
                ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
            }
            const skin = game.assets.imageCache.get('system/Window|plain');
            const style = { size: 28, color: '#fff', outline: 4 };
            ctx.save(); ctx.font = '28px "FNH Serif", Georgia, serif';
            const charWidth = ctx.measureText('A').width;
            ctx.restore();
            const left = Math.min((444 + 144) / 2 - (this.limit + 1) * charWidth / 2, 444 - (this.limit + 1) * charWidth);
            const nameX = 186 + left;
            FNH.drawWindow(ctx, skin, { x: 168, y: 38, width: 480, height: 180 },
                { x: nameX + [...this.value].length * charWidth, y: 110, width: charWidth, height: 36 }, this.time);
            const face = game.assets.imageCache.get('faces/' + this.actor.faceName);
            if (face) {
                const f = FNH.faceRect(this.actor.faceIndex, 144);
                ctx.drawImage(face, f.sx, f.sy, f.sw, f.sh, 186, 56, 144, 144);
            }
            ctx.fillStyle = 'rgba(255,255,255,0.19)';
            for (let i = 0; i < this.limit; i += 1) ctx.fillRect(nameX + i * charWidth + 1, 142, charWidth - 2, 2);
            [...this.value].forEach((char, index) => FNH.text(ctx, char, nameX + index * charWidth, 138, style));
            FNH.drawWindow(ctx, skin, { x: 168, y: 226, width: 480, height: 360 }, this.cell(this.index), this.time);
            pages[this.page].forEach((char, index) => {
                const rect = this.cell(index);
                FNH.text(ctx, char, rect.x + 21, rect.y + 28, { ...style, align: 'center', maxWidth: 36 });
            });
        }
    };
})();
