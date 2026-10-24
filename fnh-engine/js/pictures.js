'use strict';
(function () {
    const FNH = window.FNH = window.FNH || {};
    const movingFields = ['x', 'y', 'scaleX', 'scaleY', 'opacity'];

    FNH.PictureManager = class PictureManager {
        constructor(assets, saved) {
            this.assets = assets;
            this.pictures = new Map();
            this.images = new Map();
            this.renderCache = new Map();
            this.lastError = null;
            for (const entry of saved || []) {
                const state = { ...entry, tone: (entry.tone || [0, 0, 0, 0]).slice(),
                    toneTarget: (entry.toneTarget || entry.tone || [0, 0, 0, 0]).slice(),
                    target: entry.target ? { ...entry.target } : null };
                this.pictures.set(this.key(state.id, state.scope), state);
            }
        }

        key(id, scope = 'map') {
            if (!Number.isInteger(id) || id < 1 || id > 100) throw new Error('ID picture ngoài phạm vi 1–100: ' + id);
            return scope + ':' + id;
        }

        get(id, scope) {
            return this.pictures.get(this.key(id, scope));
        }

        show(id, name, origin, values, blendMode, scope = 'map') {
            const key = this.key(id, scope);
            const state = { id, scope, name: String(name || ''), origin, ...values, blendMode,
                angle: 0, speed: 0, tone: [0, 0, 0, 0], toneTarget: [0, 0, 0, 0], toneSeconds: 0,
                moveSeconds: 0, target: null };
            this.pictures.set(key, state);
            this.renderCache.delete(key);
            this.requestImage(state.name);
            return state;
        }

        move(id, origin, values, blendMode, frames, scope) {
            const state = this.get(id, scope);
            if (!state) return;
            state.origin = origin;
            state.blendMode = blendMode;
            state.target = { ...values };
            state.moveSeconds = Math.max(0, Number(frames) || 0) / 60;
            if (!state.moveSeconds) Object.assign(state, values);
        }

        rotate(id, speed, scope) {
            const state = this.get(id, scope);
            if (state) state.speed = Number(speed) || 0;
        }

        tint(id, tone, frames, scope) {
            const state = this.get(id, scope);
            if (!state) return;
            state.toneTarget = [0, 1, 2, 3].map((i) => Math.max(i === 3 ? 0 : -255, Math.min(255, Number(tone[i]) || 0)));
            state.toneSeconds = Math.max(0, Number(frames) || 0) / 60;
            if (!state.toneSeconds) state.tone = state.toneTarget.slice();
        }

        erase(id, scope) {
            const key = this.key(id, scope);
            this.pictures.delete(key);
            this.renderCache.delete(key);
        }

        update(dt) {
            for (const state of this.pictures.values()) {
                if (state.moveSeconds) {
                    const ratio = Math.min(1, dt / state.moveSeconds);
                    for (const field of movingFields) state[field] += (state.target[field] - state[field]) * ratio;
                    state.moveSeconds = Math.max(0, state.moveSeconds - dt);
                }
                if (state.toneSeconds) {
                    const ratio = Math.min(1, dt / state.toneSeconds);
                    state.tone = state.tone.map((value, i) => value + (state.toneTarget[i] - value) * ratio);
                    state.toneSeconds = Math.max(0, state.toneSeconds - dt);
                }
                state.angle = (state.angle + state.speed * dt * 30) % 360;
            }
        }

        requestImage(name) {
            if (!name) return null;
            let entry = this.images.get(name);
            if (!entry) {
                entry = { image: null };
                this.images.set(name, entry);
                this.assets.loadImage('pictures/' + name).then((image) => {
                    entry.image = image;
                }).catch((error) => { this.lastError = error; });
            }
            return entry.image;
        }

        tintedImage(state, image) {
            if (!state.tone.some((value) => value)) return image;
            const key = this.key(state.id, state.scope);
            let cache = this.renderCache.get(key);
            if (!cache) {
                cache = { canvas: document.createElement('canvas') };
                this.renderCache.set(key, cache);
            }
            const toneKey = state.tone.map((value) => Math.round(value)).join(',');
            if (cache.toneKey !== toneKey || cache.image !== image) {
                const canvas = cache.canvas;
                canvas.width = image.width;
                canvas.height = image.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0);
                const effect = new FNH.ScreenEffects();
                effect.tint(state.tone, 0);
                effect.apply(ctx);
                // Các phép cộng/trừ màu phủ cả canvas; trả lại alpha của ảnh gốc.
                if (state.tone.slice(0, 3).some((value) => value)) {
                    ctx.globalCompositeOperation = 'destination-in';
                    ctx.drawImage(image, 0, 0);
                    ctx.globalCompositeOperation = 'source-over';
                }
                cache.toneKey = toneKey;
                cache.image = image;
            }
            return cache.canvas;
        }

        draw(ctx, scope = 'map') {
            const pictures = [...this.pictures.values()].filter((state) => state.scope === scope).sort((a, b) => a.id - b.id);
            for (const state of pictures) {
                const image = this.requestImage(state.name);
                if (!image || state.opacity <= 0) continue;
                const source = this.tintedImage(state, image);
                ctx.save();
                ctx.translate(state.x, state.y);
                ctx.rotate(state.angle * Math.PI / 180);
                ctx.scale(state.scaleX / 100, state.scaleY / 100);
                ctx.globalAlpha = Math.max(0, Math.min(1, state.opacity / 255));
                ctx.globalCompositeOperation = ['source-over', 'lighter', 'multiply', 'screen'][state.blendMode] || 'source-over';
                ctx.drawImage(source, state.origin === 1 ? -image.width / 2 : 0, state.origin === 1 ? -image.height / 2 : 0);
                ctx.restore();
            }
        }

        toJSON() {
            return [...this.pictures.values()];
        }
    };
})();
