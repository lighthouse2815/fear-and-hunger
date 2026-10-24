'use strict';
(function () {
    const FNH = window.FNH = window.FNH || {};
    FNH.GabQueue = class GabQueue {
        constructor() {
            this.queue = [];
            this.current = null;
            this.seconds = 0;
        }

        show(text, force = false) {
            if (!text) return;
            if (force) this.clear();
            if (this.current === text || this.queue.includes(text)) return;
            this.queue.push(text);
        }

        clear() {
            this.queue.length = 0;
            this.current = null;
            this.seconds = 0;
        }

        get busy() {
            return !!this.current || this.queue.length > 0;
        }

        update(dt) {
            if (this.current) {
                this.seconds = Math.max(0, this.seconds - dt);
                if (!this.seconds) this.current = null;
            }
            if (!this.current && this.queue.length) {
                this.current = this.queue.shift();
                this.seconds = (90 + this.current.replace(/\\(.*?)\[(.*?)\]/gi, '').length * 4) / 60;
            }
        }

        draw(ctx) {
            if (!this.current) return;
            ctx.save();
            ctx.globalAlpha = Math.min(1, this.seconds / 0.27);
            FNH.panel(ctx, 20, 110, FNH.WIDTH - 40, 90);
            FNH.wrapText(ctx, this.current, 38, 140, FNH.WIDTH - 76, 24, { size: 17 });
            ctx.restore();
        }
    };
})();
