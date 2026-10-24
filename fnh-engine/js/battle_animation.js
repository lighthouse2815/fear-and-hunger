'use strict';
(function () {
    const FNH = window.FNH = window.FNH || {};
    FNH.BattleAnimation = class BattleAnimation {
        constructor(data, assets, audio, target, reportError) {
            this.data = data;
            this.assets = assets;
            this.audio = audio;
            this.target = target;
            this.time = 0;
            this.frame = -1;
            this.ready = false;
            this.done = false;
            this.flash = null;
            this.hiddenUntil = 0;
            this.images = [];
            this.loading = Promise.all([data.animation1Name, data.animation2Name].map((name) =>
                name ? assets.loadImage('animations/' + name) : null)).then((images) => {
                this.images = images;
                this.ready = true;
            }).catch((error) => { this.done = true; reportError(error); });
        }

        update(dt) {
            if (!this.ready || this.done) return;
            this.time += dt;
            const next = Math.min(this.data.frames.length - 1, Math.floor(this.time * 15));
            for (let frame = this.frame + 1; frame <= next; frame += 1) {
                for (const timing of this.data.timings || []) {
                    if (timing.frame !== frame) continue;
                    if (timing.se && timing.se.name) this.audio.playSe(timing.se.name, {
                        volume: timing.se.volume / 100, pitch: timing.se.pitch, pan: timing.se.pan
                    });
                    const duration = timing.flashDuration / 15;
                    if (timing.flashScope === 1 || timing.flashScope === 2) {
                        this.flash = { scope: timing.flashScope, color: timing.flashColor, start: frame / 15, duration };
                    }
                    if (timing.flashScope === 3) this.hiddenUntil = frame / 15 + duration;
                }
            }
            this.frame = next;
            const end = this.data.frames.length / 15;
            this.done = this.time >= Math.max(end, this.hiddenUntil,
                this.flash ? this.flash.start + this.flash.duration : 0);
        }

        get hidden() { return !this.done && this.time < this.hiddenUntil; }

        draw(ctx, anchor) {
            if (!this.ready || this.done || this.frame < 0) return;
            const screen = this.data.position === 3;
            const x = screen ? FNH.WIDTH / 2 : anchor.x;
            const y = screen ? FNH.HEIGHT / 2 : anchor.y - (2 - this.data.position) * anchor.height / 2;
            const cells = this.time < this.data.frames.length / 15 ? this.data.frames[this.frame] : [];
            for (const cell of cells || []) {
                const pattern = cell[0];
                if (pattern < 0) continue;
                const sheet = pattern < 100 ? 0 : 1;
                const image = this.images[sheet];
                if (!image) continue;
                const index = pattern % 100;
                ctx.save();
                ctx.translate(x + cell[1], y + cell[2]);
                ctx.rotate(cell[4] * Math.PI / 180);
                ctx.scale(cell[3] / 100 * (cell[5] ? -1 : 1), cell[3] / 100);
                ctx.globalAlpha *= cell[6] / 255;
                ctx.globalCompositeOperation = ['source-over', 'lighter', 'multiply'][cell[7]] || 'source-over';
                ctx.filter = 'hue-rotate(' + (sheet ? this.data.animation2Hue : this.data.animation1Hue) + 'deg)';
                ctx.drawImage(image, index % 5 * 192, Math.floor(index / 5) * 192, 192, 192, -96, -96, 192, 192);
                ctx.restore();
            }
            if (this.flash && this.flash.scope === 2) this.drawFlash(ctx, { x: 0, y: 0, width: FNH.WIDTH, height: FNH.HEIGHT });
        }

        tint(image) {
            if (!this.flash || this.flash.scope !== 1 || this.time >= this.flash.start + this.flash.duration) return image;
            const canvas = this.tintCanvas || (this.tintCanvas = document.createElement('canvas'));
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            ctx.globalCompositeOperation = 'source-atop';
            this.drawFlash(ctx, { x: 0, y: 0, width: image.width, height: image.height });
            ctx.globalCompositeOperation = 'source-over';
            return canvas;
        }

        drawFlash(ctx, rect) {
            const flash = this.flash;
            if (!flash || flash.duration <= 0) return;
            const alpha = Math.max(0, 1 - (this.time - flash.start) / flash.duration) * flash.color[3] / 255;
            if (!alpha) return;
            ctx.save();
            ctx.fillStyle = 'rgba(' + flash.color.slice(0, 3).join(',') + ',' + alpha + ')';
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
            ctx.restore();
        }
    };
})();
