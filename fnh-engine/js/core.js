'use strict';
/* ============================================================
   FNH Engine — lõi dùng chung
   Không dùng runtime RPG Maker MV. Chỉ đọc data/asset gốc.
   ============================================================ */
(function () {
    const FNH = window.FNH = window.FNH || {};

    FNH.WIDTH = 816;
    FNH.HEIGHT = 624;
    FNH.TILE = 48;
    FNH.VERSION = '0.1.0';

    FNH.clamp = function (value, min, max) {
        return Math.max(min, Math.min(max, value));
    };

    FNH.lerp = function (a, b, t) {
        return a + (b - a) * t;
    };

    FNH.easeOutCubic = function (t) {
        return 1 - Math.pow(1 - t, 3);
    };

    FNH.hexToRgb = function (hex) {
        const value = hex.replace('#', '');
        const full = value.length === 3
            ? value.split('').map(function (char) { return char + char; }).join('')
            : value;
        return {
            r: parseInt(full.slice(0, 2), 16),
            g: parseInt(full.slice(2, 4), 16),
            b: parseInt(full.slice(4, 6), 16)
        };
    };

    FNH.rgba = function (hex, alpha) {
        const rgb = FNH.hexToRgb(hex);
        return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
    };

    FNH.formatTime = function (seconds) {
        const total = Math.max(0, Math.floor(seconds || 0));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const secs = total % 60;
        if (hours > 0) {
            return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
        }
        return String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    };

    FNH.text = function (ctx, value, x, y, options) {
        const opts = options || {};
        const size = opts.size || 18;
        const weight = opts.weight || 400;
        const family = opts.family || '"FNH Serif", Georgia, serif';
        ctx.save();
        ctx.font = weight + ' ' + size + 'px ' + family;
        ctx.fillStyle = opts.color || '#e9e2d3';
        ctx.textAlign = opts.align || 'left';
        ctx.textBaseline = opts.baseline || 'alphabetic';
        if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
        if (opts.shadow) {
            ctx.shadowColor = opts.shadowColor || 'rgba(0,0,0,0.85)';
            ctx.shadowBlur = opts.shadowBlur || 5;
            ctx.shadowOffsetY = opts.shadowOffsetY || 2;
        }
        ctx.fillText(String(value), x, y);
        ctx.restore();
    };

    FNH.wrapText = function (ctx, value, x, y, maxWidth, lineHeight, options) {
        const opts = options || {};
        const size = opts.size || 18;
        const family = opts.family || '"FNH Serif", Georgia, serif';
        ctx.save();
        ctx.font = (opts.weight || 400) + ' ' + size + 'px ' + family;
        const paragraphs = String(value).split('\n');
        let lineY = y;
        for (const paragraph of paragraphs) {
            if (paragraph === '') {
                lineY += lineHeight;
                continue;
            }
            const words = paragraph.split(/\s+/);
            let line = '';
            for (const word of words) {
                const test = line ? line + ' ' + word : word;
                if (ctx.measureText(test).width > maxWidth && line) {
                    FNH.text(ctx, line, x, lineY, opts);
                    line = word;
                    lineY += lineHeight;
                } else {
                    line = test;
                }
            }
            if (line) {
                FNH.text(ctx, line, x, lineY, opts);
                lineY += lineHeight;
            }
        }
        ctx.restore();
        return lineY - y;
    };

    FNH.panel = function (ctx, x, y, width, height, options) {
        const opts = options || {};
        const radius = opts.radius === undefined ? 3 : opts.radius;
        ctx.save();
        ctx.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
        const gradient = ctx.createLinearGradient(x, y, x, y + height);
        gradient.addColorStop(0, opts.fillTop || 'rgba(20,19,18,0.94)');
        gradient.addColorStop(1, opts.fillBottom || 'rgba(7,7,7,0.96)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, radius);
        ctx.fill();
        ctx.strokeStyle = opts.border || 'rgba(176,158,119,0.55)';
        ctx.lineWidth = opts.lineWidth || 1;
        ctx.stroke();
        if (opts.inner !== false) {
            ctx.strokeStyle = 'rgba(255,255,255,0.045)';
            ctx.strokeRect(x + 3.5, y + 3.5, width - 7, height - 7);
        }
        ctx.restore();
    };

    FNH.bar = function (ctx, x, y, width, height, ratio, options) {
        const opts = options || {};
        const clamped = FNH.clamp(ratio, 0, 1);
        ctx.save();
        ctx.fillStyle = opts.track || 'rgba(0,0,0,0.62)';
        ctx.fillRect(x, y, width, height);
        const gradient = ctx.createLinearGradient(x, y, x + width, y);
        if (opts.color) {
            gradient.addColorStop(0, opts.color);
            gradient.addColorStop(1, opts.color);
        } else {
            gradient.addColorStop(0, opts.colorA || '#6f1c1c');
            gradient.addColorStop(1, opts.colorB || '#b64b35');
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, Math.max(0, width * clamped), height);
        ctx.strokeStyle = opts.border || 'rgba(206,188,147,0.38)';
        ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
        ctx.restore();
    };

    FNH.button = function (ctx, rect, label, options) {
        const opts = options || {};
        const hover = opts.hover === true;
        const selected = opts.selected === true;
        const disabled = opts.disabled === true;
        ctx.save();
        const gradient = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
        if (disabled) {
            gradient.addColorStop(0, 'rgba(22,21,20,0.78)');
            gradient.addColorStop(1, 'rgba(10,10,10,0.88)');
        } else if (selected || hover) {
            gradient.addColorStop(0, 'rgba(92,72,45,0.94)');
            gradient.addColorStop(1, 'rgba(40,31,21,0.96)');
        } else {
            gradient.addColorStop(0, 'rgba(34,31,27,0.9)');
            gradient.addColorStop(1, 'rgba(13,13,12,0.92)');
        }
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 2);
        ctx.fill();
        ctx.strokeStyle = disabled
            ? 'rgba(100,95,84,0.28)'
            : selected || hover
                ? 'rgba(222,197,140,0.9)'
                : 'rgba(154,139,108,0.45)';
        ctx.lineWidth = selected || hover ? 1.4 : 1;
        ctx.stroke();
        FNH.text(ctx, label, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1, {
            size: opts.size || 18,
            color: disabled ? 'rgba(180,174,160,0.35)' : selected || hover ? '#fff2d2' : '#d7ccb5',
            align: 'center',
            baseline: 'middle',
            shadow: true
        });
        if (opts.hint) {
            FNH.text(ctx, opts.hint, rect.x + rect.width - 12, rect.y + rect.height - 8, {
                size: 10,
                color: 'rgba(222,206,170,0.52)',
                align: 'right'
            });
        }
        ctx.restore();
    };

    FNH.hit = function (rect, x, y) {
        return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
    };

    // Dựng khung và con trỏ từ windowskin gốc, dùng chung cho menu/hội thoại.
    FNH.drawWindow = function (ctx, skin, rect, cursor, time) {
        if (!skin) return;
        const slice = (sx, sy, size, margin, target, center) => {
            const source = [0, margin, size - margin];
            const sourceSize = [margin, size - margin * 2, margin];
            const destX = [target.x, target.x + margin, target.x + target.width - margin];
            const destY = [target.y, target.y + margin, target.y + target.height - margin];
            const widths = [margin, target.width - margin * 2, margin];
            const heights = [margin, target.height - margin * 2, margin];
            for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) {
                if (!center && x === 1 && y === 1) continue;
                ctx.drawImage(skin, sx + source[x], sy + source[y], sourceSize[x], sourceSize[y],
                    destX[x], destY[y], widths[x], heights[y]);
            }
        };
        ctx.save();
        ctx.globalAlpha = 192 / 255;
        ctx.drawImage(skin, 0, 0, 96, 96, rect.x + 4, rect.y + 4, rect.width - 8, rect.height - 8);
        ctx.globalAlpha = 1;
        slice(96, 0, 96, 24, rect, false);
        if (cursor) {
            ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.cos((time || 0) * Math.PI * 1.5));
            slice(96, 96, 48, 4, cursor, true);
        }
        ctx.restore();
    };

    FNH.faceRect = function (faceIndex, size) {
        const cell = 144;
        const scale = (size || 72) / cell;
        return {
            sx: (faceIndex % 4) * cell,
            sy: Math.floor(faceIndex / 4) * cell,
            sw: cell,
            sh: cell,
            dw: cell * scale,
            dh: cell * scale
        };
    };

    FNH.drawVignette = function (ctx, width, height, strength) {
        const amount = strength === undefined ? 0.48 : strength;
        const gradient = ctx.createRadialGradient(
            width / 2, height / 2, Math.min(width, height) * 0.18,
            width / 2, height / 2, Math.max(width, height) * 0.72
        );
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(0.62, 'rgba(0,0,0,' + (amount * 0.24) + ')');
        gradient.addColorStop(1, 'rgba(0,0,0,' + amount + ')');
        ctx.save();
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    };

    FNH.drawGrain = function (ctx, width, height, time) {
        ctx.save();
        ctx.globalAlpha = 0.035;
        ctx.fillStyle = '#d8cba9';
        const seed = Math.floor(time * 18);
        for (let i = 0; i < 90; i += 1) {
            const x = ((i * 7919 + seed * 131) % width);
            const y = ((i * 104729 + seed * 311) % height);
            ctx.fillRect(x, y, 1, 1);
        }
        ctx.restore();
    };

    FNH.Input = class Input {
        constructor(canvas) {
            this.canvas = canvas;
            this.down = new Set();
            this.pressed = new Set();
            this.clicks = [];
            this.mouse = { x: 0, y: 0, down: false };
            this.enabled = true;
            this.pointerEnabled = true;
            this._bind();
        }

        _bind() {
            const self = this;
            window.addEventListener('keydown', function (event) {
                if (!self.enabled) return;
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter', 'Escape', 'Tab'].includes(event.key)) {
                    event.preventDefault();
                }
                if (!event.repeat) self.pressed.add(event.key);
                self.down.add(event.key);
            }, { passive: false });

            window.addEventListener('keyup', function (event) {
                self.down.delete(event.key);
            });

            window.addEventListener('blur', function () {
                self.down.clear();
                self.pressed.clear();
            });

            this.canvas.addEventListener('pointermove', function (event) {
                self._updateMouse(event);
            });

            this.canvas.addEventListener('pointerdown', function (event) {
                if (!self.enabled || !self.pointerEnabled) return;
                self._updateMouse(event);
                self.mouse.down = true;
            });

            window.addEventListener('pointerup', function (event) {
                if (event.target === self.canvas) {
                    self._updateMouse(event);
                    self.mouse.down = false;
                }
            });

            this.canvas.addEventListener('pointerup', function (event) {
                if (!self.enabled || !self.pointerEnabled) return;
                self._updateMouse(event);
                self.mouse.down = false;
                self.clicks.push({ x: self.mouse.x, y: self.mouse.y });
            });

            this.canvas.addEventListener('pointercancel', function () {
                self.mouse.down = false;
            });
        }

        _updateMouse(event) {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            this.mouse.x = (event.clientX - rect.left) * scaleX;
            this.mouse.y = (event.clientY - rect.top) * scaleY;
        }

        isDown() {
            for (let i = 0; i < arguments.length; i += 1) {
                if (this.down.has(arguments[i])) return true;
            }
            return false;
        }

        isPressed() {
            for (let i = 0; i < arguments.length; i += 1) {
                if (this.pressed.has(arguments[i])) return true;
            }
            return false;
        }

        consumeClick() {
            return this.clicks.shift() || null;
        }

        clearFrame() {
            this.pressed.clear();
            this.clicks.length = 0;
        }
    };

    FNH.Storage = class Storage {
        constructor(namespace) {
            const params = new URLSearchParams(window.location.search);
            this.namespace = namespace || params.get('fnh_engine_ns') || 'default';
            this.prefix = 'FNH_ENGINE:' + this.namespace + ':';
        }

        key(name) {
            return this.prefix + name;
        }

        save(slot, value) {
            try {
                window.localStorage.setItem(this.key('save' + slot), JSON.stringify(value));
                return true;
            } catch (error) {
                console.warn('[FNH] Không lưu được vào localStorage:', error);
                return false;
            }
        }

        load(slot) {
            try {
                const raw = window.localStorage.getItem(this.key('save' + slot));
                return raw ? JSON.parse(raw) : null;
            } catch (error) {
                console.warn('[FNH] Không đọc được save:', error);
                return null;
            }
        }

        exists(slot) {
            try {
                return !!window.localStorage.getItem(this.key('save' + slot));
            } catch (error) {
                return false;
            }
        }

        remove(slot) {
            try {
                window.localStorage.removeItem(this.key('save' + slot));
            } catch (error) {}
        }

        keys() {
            const result = [];
            for (let i = 0; i < window.localStorage.length; i += 1) {
                const key = window.localStorage.key(i);
                if (key && key.indexOf(this.prefix) === 0) result.push(key);
            }
            return result;
        }
    };

    FNH.Transition = class Transition {
        constructor() {
            this.alpha = 0;
            this.target = 0;
            this.speed = 2.4;
            this.callback = null;
            this.mode = 'idle';
        }

        fadeOut(callback) {
            this.target = 1;
            this.callback = callback || null;
            this.mode = 'out';
        }

        fadeIn() {
            this.alpha = 1;
            this.target = 0;
            this.mode = 'in';
        }

        update(dt) {
            if (this.alpha < this.target) {
                this.alpha = Math.min(this.target, this.alpha + dt * this.speed);
            } else if (this.alpha > this.target) {
                this.alpha = Math.max(this.target, this.alpha - dt * this.speed);
            }
            if (this.mode === 'out' && this.alpha >= 1) {
                const callback = this.callback;
                this.callback = null;
                this.mode = 'idle';
                if (callback) callback();
            } else if (this.mode === 'in' && this.alpha <= 0) {
                this.mode = 'idle';
            }
        }

        draw(ctx) {
            if (this.alpha <= 0) return;
            ctx.save();
            ctx.globalAlpha = this.alpha;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
            ctx.restore();
        }
    };

    FNH.Scene = class Scene {
        constructor() {
            this.game = null;
            this.input = null;
            this.name = 'scene';
        }

        enter() {}

        exit() {}

        update() {}

        draw() {}
    };

    FNH.drawBackdrop = function (ctx, top, bottom) {
        const gradient = ctx.createLinearGradient(0, 0, 0, FNH.HEIGHT);
        gradient.addColorStop(0, top || '#0c0c0d');
        gradient.addColorStop(1, bottom || '#030303');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
    };

    FNH.drawKeyHint = function (ctx, x, y, key, label, options) {
        const opts = options || {};
        ctx.save();
        const size = opts.size || 12;
        ctx.font = '600 ' + size + 'px "FNH Serif", Georgia, serif';
        const keyWidth = Math.max(22, ctx.measureText(key).width + 12);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.strokeStyle = 'rgba(201,184,146,0.42)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y - size - 3, keyWidth, size + 10, 2);
        ctx.fill();
        ctx.stroke();
        FNH.text(ctx, key, x + keyWidth / 2, y + 1, {
            size: size,
            color: '#e8dcc0',
            align: 'center',
            baseline: 'middle'
        });
        FNH.text(ctx, label, x + keyWidth + 8, y + 1, {
            size: size,
            color: 'rgba(216,204,178,0.72)',
            baseline: 'middle'
        });
        ctx.restore();
        return keyWidth + 8 + ctx.measureText(label).width;
    };

    FNH.pad2 = function (value) {
        return String(value).padStart(2, '0');
    };

    FNH.formatDate = function (timestamp) {
        const date = new Date(timestamp || Date.now());
        return FNH.pad2(date.getDate()) + '/' + FNH.pad2(date.getMonth() + 1) + '/' +
            date.getFullYear() + ' ' + FNH.pad2(date.getHours()) + ':' + FNH.pad2(date.getMinutes());
    };
})();
