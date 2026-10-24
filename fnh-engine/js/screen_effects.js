'use strict';
(function () {
    const FNH = window.FNH = window.FNH || {};
    const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
    const seconds = (frames) => Math.max(0, Number(frames) || 0) / 60;

    FNH.ScreenEffects = class ScreenEffects {
        constructor(saved) {
            const data = saved || {};
            const tone = (value) => [0, 1, 2, 3].map((i) => clamp(value && value[i], i === 3 ? 0 : -255, 255));
            this.tone = tone(data.tone);
            this.toneTarget = tone(data.toneTarget || this.tone);
            this.toneSeconds = Math.max(0, Number(data.toneSeconds) || 0);
            this.brightness = data.brightness === undefined ? 255 : clamp(data.brightness, 0, 255);
            this.fadeTarget = data.fadeTarget === undefined ? this.brightness : clamp(data.fadeTarget, 0, 255);
            this.fadeSeconds = Math.max(0, Number(data.fadeSeconds) || 0);
            this.flash = [0, 1, 2, 3].map((i) => clamp(data.flash && data.flash[i], 0, 255));
            this.flashSeconds = Math.max(0, Number(data.flashSeconds) || 0);
            this.shakePower = clamp(data.shakePower, 0, 9);
            this.shakeSpeed = clamp(data.shakeSpeed, 0, 9);
            this.shakeSeconds = Math.max(0, Number(data.shakeSeconds) || 0);
            this.shakePhase = Number(data.shakePhase) || 0;
            this.shakeX = Number(data.shakeX) || 0;
        }

        tint(value, frames) {
            this.toneTarget = [0, 1, 2, 3].map((i) => clamp(value && value[i], i === 3 ? 0 : -255, 255));
            this.toneSeconds = seconds(frames);
            if (!this.toneSeconds) this.tone = this.toneTarget.slice();
        }

        fade(brightness, frames) {
            this.fadeTarget = clamp(brightness, 0, 255);
            this.fadeSeconds = seconds(frames);
            if (!this.fadeSeconds) this.brightness = this.fadeTarget;
        }

        startFlash(value, frames) {
            this.flash = [0, 1, 2, 3].map((i) => clamp(value && value[i], 0, 255));
            this.flashSeconds = seconds(frames);
            if (!this.flashSeconds) this.flash[3] = 0;
        }

        shake(power, speed, frames) {
            this.shakePower = clamp(power, 0, 9);
            this.shakeSpeed = clamp(speed, 0, 9);
            this.shakeSeconds = seconds(frames);
            this.shakePhase = 0;
            this.shakeX = 0;
        }

        update(dt) {
            const toneRatio = this.toneSeconds ? Math.min(1, dt / this.toneSeconds) : 0;
            this.tone = this.tone.map((value, i) => value + (this.toneTarget[i] - value) * toneRatio);
            this.toneSeconds = Math.max(0, this.toneSeconds - dt);
            if (this.fadeSeconds) {
                this.brightness += (this.fadeTarget - this.brightness) * Math.min(1, dt / this.fadeSeconds);
                this.fadeSeconds = Math.max(0, this.fadeSeconds - dt);
            }
            if (this.flashSeconds) {
                this.flash[3] *= 1 - Math.min(1, dt / this.flashSeconds);
                this.flashSeconds = Math.max(0, this.flashSeconds - dt);
            }
            if (this.shakeSeconds) {
                this.shakePhase += dt * this.shakeSpeed * 6;
                this.shakeSeconds = Math.max(0, this.shakeSeconds - dt);
                this.shakeX = Math.sin(this.shakePhase) * this.shakePower * 2 * Math.min(1, this.shakeSeconds * 10);
            } else this.shakeX = 0;
        }

        apply(ctx) {
            const width = ctx.canvas.width, height = ctx.canvas.height;
            ctx.save();
            const [red, green, blue, gray] = this.tone;
            if (gray) {
                ctx.filter = 'saturate(' + (1 - gray / 255) + ')';
                ctx.globalCompositeOperation = 'copy';
                ctx.drawImage(ctx.canvas, 0, 0);
                ctx.filter = 'none';
            }
            if (red < 0 || green < 0 || blue < 0) {
                ctx.globalCompositeOperation = 'difference';
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, width, height);
                ctx.globalCompositeOperation = 'lighter';
                ctx.fillStyle = 'rgb(' + [red, green, blue].map((value) => Math.round(Math.max(0, -value))).join(',') + ')';
                ctx.fillRect(0, 0, width, height);
                ctx.globalCompositeOperation = 'difference';
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, width, height);
            }
            if (red > 0 || green > 0 || blue > 0) {
                ctx.globalCompositeOperation = 'lighter';
                ctx.fillStyle = 'rgb(' + [red, green, blue].map((value) => Math.round(Math.max(0, value))).join(',') + ')';
                ctx.fillRect(0, 0, width, height);
            }
            ctx.globalCompositeOperation = 'source-over';
            if (this.flash[3] > 0) {
                ctx.fillStyle = 'rgba(' + this.flash.slice(0, 3).join(',') + ',' + this.flash[3] / 255 + ')';
                ctx.fillRect(0, 0, width, height);
            }
            if (this.brightness < 255) {
                ctx.fillStyle = 'rgba(0,0,0,' + (1 - this.brightness / 255) + ')';
                ctx.fillRect(0, 0, width, height);
            }
            ctx.restore();
        }
    };
})();
