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
            this.weatherType = ['rain', 'storm', 'snow'].includes(data.weatherType) ? data.weatherType : 'none';
            this.weatherPower = clamp(data.weatherPower, 0, 9);
            this.weatherTarget = clamp(data.weatherTarget, 0, 9);
            this.weatherSeconds = Math.max(0, Number(data.weatherSeconds) || 0);
            this.weatherTime = Math.max(0, Number(data.weatherTime) || 0);
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

        changeWeather(type, power, frames) {
            if (!['none', 'rain', 'storm', 'snow'].includes(type)) throw new Error('Không hỗ trợ thời tiết ' + type);
            const duration = seconds(frames);
            if (type !== 'none' || !duration) this.weatherType = type;
            this.weatherTarget = type === 'none' ? 0 : clamp(power, 0, 9);
            this.weatherSeconds = duration;
            if (!duration) this.weatherPower = this.weatherTarget;
        }

        drawWeather(ctx, cameraX = 0, cameraY = 0) {
            if (this.weatherType === 'none' || this.weatherPower <= 0) return;
            const width = ctx.canvas.width, height = ctx.canvas.height;
            const spanX = width + 160, spanY = height + 160;
            const wrap = (value, span) => ((value % span) + span) % span - 80;
            const snow = this.weatherType === 'snow', storm = this.weatherType === 'storm';
            const speed = snow ? 120 : storm ? 480 : 360;
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,' + this.weatherPower * 6 / 255 + ')';
            ctx.fillRect(0, 0, width, height);
            ctx.strokeStyle = 'rgba(235,245,255,0.65)';
            ctx.fillStyle = 'rgba(245,250,255,0.8)';
            ctx.lineWidth = storm ? 2 : 1;
            ctx.beginPath();
            for (let index = 0; index < Math.floor(this.weatherPower * 10); index += 1) {
                const drift = snow ? Math.sin(this.weatherTime + index) * 18 : -this.weatherTime * speed / 2;
                const x = wrap(index * 173.41 + drift - cameraX, spanX);
                const y = wrap(index * 97.73 + this.weatherTime * speed - cameraY, spanY);
                if (snow) { ctx.moveTo(x + 2, y); ctx.arc(x, y, 2, 0, Math.PI * 2); }
                else { ctx.moveTo(x, y); ctx.lineTo(x - (storm ? 16 : 6), y + (storm ? 48 : 18)); }
            }
            if (snow) ctx.fill();
            else ctx.stroke();
            ctx.restore();
        }

        update(dt) {
            this.weatherTime += dt;
            if (this.weatherSeconds) {
                this.weatherPower += (this.weatherTarget - this.weatherPower) * Math.min(1, dt / this.weatherSeconds);
                this.weatherSeconds = Math.max(0, this.weatherSeconds - dt);
                if (!this.weatherSeconds && this.weatherTarget === 0) this.weatherType = 'none';
            }
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
