'use strict';
/* ============================================================
   FNH Engine — trận đấu theo lượt với Guard
   ============================================================ */
(function () {
    const FNH = window.FNH = window.FNH || {};

    FNH.Scene_Battle = class Scene_Battle extends FNH.Scene {
        constructor() {
            super();
            this.name = 'battle';
            this.time = 0;
            this.phase = 'intro';
            this.timer = 1.7;
            this.index = 0;
            this.hoverIndex = -1;
            this.commands = ['TẤN CÔNG', 'PHÒNG THỦ', 'BỎ CHẠY'];
            this.log = '';
            this.turn = 1;
            this.damageNumbers = [];
            this.enemyFlash = 0;
            this.shake = 0;
            this.guarding = false;
            this.leaving = false;
            this.returnX = 27;
            this.returnY = 65;
            this.returnDir = 2;
            this.enemy = null;
            this.player = null;
        }

        enter(options) {
            const opts = options || {};
            this.returnX = opts.returnX === undefined ? 27 : opts.returnX;
            this.returnY = opts.returnY === undefined ? 65 : opts.returnY;
            this.returnDir = opts.returnDir === undefined ? 2 : opts.returnDir;
            this.player = this.game.player;
            this.enemy = this.game.data.createGuardEncounter();
            this.enemy.hp = this.enemy.maxHp;
            this.phase = 'intro';
            this.timer = 1.7;
            this.index = 0;
            this.hoverIndex = -1;
            this.log = this.enemy.intro;
            this.turn = 1;
            this.damageNumbers = [];
            this.enemyFlash = 0;
            this.shake = 0;
            this.guarding = false;
            this.leaving = false;
            this.time = 0;
            this.game.audio.stopBgs(0.35);
            this.game.audio.playBgm('muted_aggression', { volume: 0.48, loop: true });
            this.game.audio.playSe('guard_grunt1', { volume: 0.65 });
        }

        commandRects() {
            return this.commands.map(function (label, index) {
                return {
                    x: 558,
                    y: 486 + index * 38,
                    width: 206,
                    height: 32
                };
            });
        }

        addDamage(value, x, y, color, playerDamage) {
            this.damageNumbers.push({
                value: value,
                x: x,
                y: y,
                color: color,
                life: 1.1,
                maxLife: 1.1,
                playerDamage: !!playerDamage
            });
        }

        rollDamage(attack, defense) {
            const variance = Math.floor(Math.random() * 9) - 4;
            return Math.max(1, Math.round(attack * 2 - defense * 0.7 + variance));
        }

        choose(index) {
            if (this.phase !== 'command') return;
            this.index = index;
            this.game.audio.playSe('fnh_choice', { volume: 0.5 });
            if (index === 0) {
                this.playerAttack();
            } else if (index === 1) {
                this.playerGuard();
            } else {
                this.playerFlee();
            }
        }

        playerAttack() {
            const damage = this.rollDamage(this.player.atk, this.enemy.def);
            this.enemy.hp = Math.max(0, this.enemy.hp - damage);
            this.addDamage(damage, 408, 264, '#ffd39b', false);
            this.enemyFlash = 0.24;
            this.shake = 0.34;
            this.log = this.player.name + ' chém vào Guard — ' + damage + ' sát thương.';
            this.game.audio.playSe('Slash1', { volume: 0.7 });
            this.game.audio.playSe('guard_grunt1', { volume: 0.45 });
            this.phase = 'player';
            this.timer = 0.95;
        }

        playerGuard() {
            this.guarding = true;
            this.log = this.player.name + ' nâng cao phòng thủ, chờ đòn đánh tới.';
            this.game.audio.playSe('Decision1', { volume: 0.5 });
            this.phase = 'player';
            this.timer = 0.7;
        }

        playerFlee() {
            if (Math.random() < 0.55) {
                this.log = 'Bạn lùi lại, hoà mình vào bóng tối và rút lui.';
                this.game.audio.playSe('fnh_cancel', { volume: 0.55 });
                this.game.audio.stopBgm(0.5);
                this.phase = 'fled';
                this.timer = 1.2;
            } else {
                this.log = 'Bạn cố chạy, nhưng Guard đã chặn kín lối ra.';
                this.game.audio.playSe('fnh_buzzer', { volume: 0.4 });
                this.phase = 'player';
                this.timer = 0.8;
            }
        }

        enemyTurn() {
            const wasGuarding = this.guarding;
            let damage = this.rollDamage(this.enemy.atk, this.player.def);
            if (wasGuarding) damage = Math.max(1, Math.ceil(damage * 0.45));
            this.player.hp = Math.max(0, this.player.hp - damage);
            this.addDamage(damage, 226, 398, '#ff9a86', true);
            this.shake = 0.5;
            this.guarding = false;
            this.log = wasGuarding
                ? 'Guard giáng đòn, nhưng thế thủ đã làm giảm sát thương còn ' + damage + '.'
                : 'Guard giáng một đòn nặng — ' + damage + ' sát thương.';
            this.game.audio.playSe('Damage1', { volume: 0.65 });
            this.game.audio.playSe('guard_breath1', { volume: 0.35 });
            this.phase = 'enemy';
            this.timer = 1.05;
        }

        victory() {
            this.phase = 'victory';
            this.result = 'victory';
            this.game.guardDefeated = true;
            this.game.gold += this.enemy.rewardGold;
            this.player.exp = (this.player.exp || 0) + this.enemy.rewardExp;
            this.log = 'Guard gục xuống. Bộ giáp rỉ sét vỡ vụn trong im lặng.';
            this.game.audio.stopBgm(0.5);
            this.game.audio.playSe('fnh_choice', { volume: 0.6 });
        }

        defeat() {
            this.phase = 'defeat';
            this.result = 'defeat';
            this.timer = 1.7;
            this.log = 'Đôi chân khuỵu xuống. Bóng tối nuốt lấy bạn.';
            this.game.audio.stopBgm(0.5);
            this.game.audio.playSe('Damage3', { volume: 0.7 });
        }

        returnToMap() {
            if (this.leaving) return;
            this.leaving = true;
            this.player.mapX = this.returnX;
            this.player.mapY = this.returnY;
            this.player.direction = this.returnDir;
            this.game.changeScene(FNH.Scene_Map, { fromBattle: true });
        }

        update(dt) {
            this.time += dt;
            if (this.enemyFlash > 0) this.enemyFlash = Math.max(0, this.enemyFlash - dt);
            if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 1.6);
            for (const item of this.damageNumbers) {
                item.life -= dt;
                item.y -= dt * 34;
            }
            this.damageNumbers = this.damageNumbers.filter(function (item) { return item.life > 0; });
            if (this.leaving) return;

            const input = this.input;
            if (this.phase === 'intro') {
                this.timer -= dt;
                if (input.isPressed('Enter', ' ', 'z', 'Z') || this.timer <= 0) {
                    this.phase = 'command';
                    this.log = 'Đến lượt bạn. Chọn hành động.';
                }
                return;
            }

            if (this.phase === 'command') {
                if (input.isPressed('ArrowUp', 'w', 'W')) {
                    this.index = (this.index + this.commands.length - 1) % this.commands.length;
                    this.game.audio.playSe('fnh_cursor', { volume: 0.4 });
                }
                if (input.isPressed('ArrowDown', 's', 'S')) {
                    this.index = (this.index + 1) % this.commands.length;
                    this.game.audio.playSe('fnh_cursor', { volume: 0.4 });
                }
                if (input.isPressed('Enter', ' ', 'z', 'Z')) {
                    this.choose(this.index);
                    return;
                }

                const rects = this.commandRects();
                this.hoverIndex = -1;
                for (let i = 0; i < rects.length; i += 1) {
                    if (FNH.hit(rects[i], input.mouse.x, input.mouse.y)) {
                        this.hoverIndex = i;
                        break;
                    }
                }
                if (this.hoverIndex >= 0 && this.hoverIndex !== this.index) {
                    this.index = this.hoverIndex;
                    this.game.audio.playSe('fnh_cursor', { volume: 0.35 });
                }
                const click = input.consumeClick();
                if (click) {
                    for (let i = 0; i < rects.length; i += 1) {
                        if (FNH.hit(rects[i], click.x, click.y)) {
                            this.choose(i);
                            break;
                        }
                    }
                }
                return;
            }

            if (this.phase === 'player') {
                this.timer -= dt;
                if (this.timer <= 0) {
                    if (this.enemy.hp <= 0) this.victory();
                    else this.enemyTurn();
                }
                return;
            }

            if (this.phase === 'enemy') {
                this.timer -= dt;
                if (this.timer <= 0) {
                    if (this.player.hp <= 0) {
                        this.defeat();
                    } else {
                        this.turn += 1;
                        this.phase = 'command';
                        this.log = 'Lượt ' + this.turn + '. Guard vẫn đứng đó, chờ bạn.';
                    }
                }
                return;
            }

            if (this.phase === 'victory') {
                if (input.isPressed('Enter', ' ', 'z', 'Z') || input.consumeClick()) {
                    this.returnToMap();
                }
                return;
            }

            if (this.phase === 'fled') {
                this.timer -= dt;
                if (this.timer <= 0) this.returnToMap();
                return;
            }

            if (this.phase === 'defeat') {
                this.timer -= dt;
                if (this.timer <= 0 && !this.leaving) {
                    this.leaving = true;
                    this.game.gameOver();
                }
            }
        }

        drawBattleback(ctx) {
            const image = this.game.assets.imageCache.get('battlebacks1/floor1');
            if (image) {
                const scale = Math.max(FNH.WIDTH / image.width, FNH.HEIGHT / image.height);
                const width = image.width * scale;
                const height = image.height * scale;
                ctx.drawImage(image, (FNH.WIDTH - width) / 2, (FNH.HEIGHT - height) / 2, width, height);
            } else {
                FNH.drawBackdrop(ctx, '#151413', '#050505');
            }
            const shade = ctx.createLinearGradient(0, 0, 0, FNH.HEIGHT);
            shade.addColorStop(0, 'rgba(4,5,7,0.2)');
            shade.addColorStop(0.55, 'rgba(4,5,7,0.28)');
            shade.addColorStop(1, 'rgba(4,5,7,0.8)');
            ctx.fillStyle = shade;
            ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
        }

        drawEnemy(ctx) {
            if (!this.enemy) return;
            const parts = this.enemy.parts.slice().sort(function (a, b) { return a.y - b.y; });
            const shakeX = this.shake > 0 ? (Math.random() * 2 - 1) * this.shake * 10 : 0;
            const shakeY = this.shake > 0 ? (Math.random() * 2 - 1) * this.shake * 6 : 0;

            ctx.save();
            ctx.translate(shakeX, shakeY);
            const shadow = ctx.createRadialGradient(412, 456, 10, 412, 456, 150);
            shadow.addColorStop(0, 'rgba(0,0,0,0.6)');
            shadow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = shadow;
            ctx.fillRect(250, 350, 330, 120);

            for (let i = 0; i < parts.length; i += 1) {
                const part = parts[i];
                const image = this.game.assets.imageCache.get(part.image);
                if (!image) continue;
                const breathing = Math.sin(this.time * 2.1 + i * 0.8) * 1.4;
                if (this.enemyFlash > 0) ctx.filter = 'brightness(1.85)';
                ctx.drawImage(image, part.x - image.width / 2, part.y - image.height + breathing);
                ctx.filter = 'none';
            }
            ctx.restore();
        }

        drawEnemyHud(ctx) {
            if (!this.enemy) return;
            FNH.panel(ctx, 248, 20, 320, 56, {
                alpha: 0.9,
                fillTop: 'rgba(17,15,13,0.9)',
                fillBottom: 'rgba(5,5,5,0.94)',
                border: 'rgba(172,139,93,0.48)'
            });
            FNH.text(ctx, 'GUARD', 266, 42, {
                size: 15,
                weight: 600,
                color: '#ead9b8'
            });
            FNH.text(ctx, 'LƯỢT ' + this.turn, 550, 42, {
                size: 10,
                weight: 600,
                color: 'rgba(212,194,158,0.55)',
                align: 'right'
            });
            FNH.bar(ctx, 266, 52, 284, 9, this.enemy.hp / this.enemy.maxHp, {
                colorA: '#5b1515',
                colorB: '#b34a36'
            });
            FNH.text(ctx, this.enemy.hp + ' / ' + this.enemy.maxHp, 550, 68, {
                size: 9,
                color: 'rgba(231,214,181,0.62)',
                align: 'right'
            });
        }

        drawActorPanel(ctx) {
            const player = this.player;
            FNH.panel(ctx, 24, 452, 768, 156, {
                alpha: 0.96,
                fillTop: 'rgba(19,17,14,0.96)',
                fillBottom: 'rgba(5,5,5,0.98)',
                border: 'rgba(188,164,113,0.58)'
            });

            FNH.text(ctx, this.log, 40, 472, {
                size: 11,
                color: 'rgba(229,216,190,0.88)'
            });
            ctx.strokeStyle = 'rgba(188,164,113,0.2)';
            ctx.beginPath();
            ctx.moveTo(40, 482);
            ctx.lineTo(776, 482);
            ctx.stroke();

            const face = this.game.assets.imageCache.get('faces/' + player.faceName);
            if (face) {
                const rect = FNH.faceRect(player.faceIndex, 58);
                ctx.save();
                ctx.beginPath();
                ctx.rect(42, 492, 58, 58);
                ctx.clip();
                ctx.drawImage(face, rect.sx, rect.sy, rect.sw, rect.sh, 42, 492, 58, 58);
                ctx.restore();
                ctx.strokeStyle = 'rgba(188,164,113,0.45)';
                ctx.strokeRect(42.5, 492.5, 57, 57);
            }
            FNH.text(ctx, player.name, 114, 507, {
                size: 17,
                weight: 600,
                color: '#efe2c7'
            });
            FNH.text(ctx, player.className + ' · Cấp ' + player.level, 114, 524, {
                size: 10,
                color: 'rgba(209,194,160,0.62)'
            });
            if (this.guarding) {
                FNH.text(ctx, 'ĐANG THỦ THẾ', 360, 524, {
                    size: 10,
                    weight: 600,
                    color: 'rgba(139,188,206,0.82)',
                    align: 'right'
                });
            }
            FNH.bar(ctx, 114, 533, 230, 9, player.hp / player.maxHp, {
                colorA: '#5f1818',
                colorB: '#a83c2c'
            });
            FNH.text(ctx, 'HP ' + player.hp + ' / ' + player.maxHp, 352, 542, {
                size: 10,
                color: 'rgba(233,218,188,0.78)'
            });
            FNH.bar(ctx, 114, 551, 160, 5, player.mp / Math.max(1, player.maxMp), {
                colorA: '#1f3d57',
                colorB: '#3b6f8f'
            });
            FNH.text(ctx, 'MP ' + player.mp + ' / ' + player.maxMp, 282, 558, {
                size: 9,
                color: 'rgba(205,215,224,0.62)'
            });
            FNH.text(ctx, 'ATK ' + player.atk + '   ·   DEF ' + player.def + '   ·   AGI ' + player.agi, 114, 578, {
                size: 10,
                color: 'rgba(209,194,160,0.48)'
            });

            const rects = this.commandRects();
            for (let i = 0; i < this.commands.length; i += 1) {
                FNH.button(ctx, rects[i], this.commands[i], {
                    selected: this.phase === 'command' && i === this.index,
                    hover: this.phase === 'command' && i === this.hoverIndex,
                    disabled: this.phase !== 'command',
                    size: 13
                });
            }

            FNH.text(ctx, this.phase === 'command'
                ? '↑ ↓ chọn · ENTER xác nhận'
                : this.phase === 'victory'
                    ? 'ENTER để quay lại hành lang'
                    : 'Guard đang hành động…',
                114, 598, {
                    size: 9,
                    color: 'rgba(210,194,160,0.46)'
                });
        }

        drawDamageNumbers(ctx) {
            for (const item of this.damageNumbers) {
                const alpha = FNH.clamp(item.life / item.maxLife, 0, 1);
                ctx.save();
                ctx.globalAlpha = alpha;
                FNH.text(ctx, String(item.value), item.x, item.y, {
                    size: item.playerDamage ? 25 : 30,
                    weight: 700,
                    color: item.color,
                    align: 'center',
                    shadow: true,
                    shadowBlur: 8,
                    shadowColor: 'rgba(0,0,0,0.9)'
                });
                ctx.restore();
            }
        }

        drawOverlay(ctx) {
            if (this.phase === 'intro') {
                const alpha = FNH.clamp(this.timer / 0.6, 0, 1);
                ctx.save();
                ctx.globalAlpha = Math.min(1, alpha);
                FNH.text(ctx, 'GUARD CHẶN LỐI', FNH.WIDTH / 2, 180, {
                    size: 25,
                    weight: 600,
                    color: '#eadbc0',
                    align: 'center',
                    shadow: true,
                    shadowBlur: 10
                });
                FNH.text(ctx, 'Bóng giáp rỉ sét đứng giữa hành lang.', FNH.WIDTH / 2, 204, {
                    size: 11,
                    color: 'rgba(224,207,174,0.6)',
                    align: 'center'
                });
                ctx.restore();
            }

            if (this.phase === 'victory') {
                ctx.fillStyle = 'rgba(0,0,0,0.68)';
                ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
                FNH.panel(ctx, 226, 188, 364, 224, {
                    alpha: 0.98,
                    fillTop: 'rgba(22,19,15,0.98)',
                    fillBottom: 'rgba(5,5,5,0.99)',
                    border: 'rgba(205,177,113,0.72)'
                });
                FNH.text(ctx, 'CHIẾN THẮNG', FNH.WIDTH / 2, 236, {
                    size: 28,
                    weight: 600,
                    color: '#f0e2c1',
                    align: 'center'
                });
                FNH.text(ctx, 'Guard đã gục ngã.', FNH.WIDTH / 2, 266, {
                    size: 13,
                    color: 'rgba(224,208,176,0.7)',
                    align: 'center'
                });
                FNH.text(ctx, '+ ' + this.enemy.rewardGold + ' vàng    ·    + ' + this.enemy.rewardExp + ' kinh nghiệm',
                    FNH.WIDTH / 2, 306, {
                        size: 12,
                        weight: 600,
                        color: 'rgba(231,201,137,0.86)',
                        align: 'center'
                    });
                FNH.text(ctx, 'Nhấn ENTER để quay lại hành lang.', FNH.WIDTH / 2, 366, {
                    size: 11,
                    color: 'rgba(219,202,170,0.55)',
                    align: 'center'
                });
            }

            if (this.phase === 'fled') {
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
                FNH.text(ctx, 'BẠN ĐÃ RÚT LUI', FNH.WIDTH / 2, FNH.HEIGHT / 2, {
                    size: 24,
                    weight: 600,
                    color: '#ddd0b5',
                    align: 'center',
                    shadow: true
                });
            }

            if (this.phase === 'defeat') {
                const alpha = FNH.clamp((1.7 - this.timer) / 1.2, 0, 0.85);
                ctx.fillStyle = 'rgba(32,4,4,' + alpha + ')';
                ctx.fillRect(0, 0, FNH.WIDTH, FNH.HEIGHT);
                FNH.text(ctx, 'BẠN ĐÃ GỤC NGÃ', FNH.WIDTH / 2, FNH.HEIGHT / 2, {
                    size: 26,
                    weight: 600,
                    color: 'rgba(236,203,188,0.9)',
                    align: 'center',
                    shadow: true,
                    shadowBlur: 10
                });
            }
        }

        draw(ctx) {
            this.drawBattleback(ctx);
            this.drawEnemy(ctx);
            this.drawDamageNumbers(ctx);
            this.drawEnemyHud(ctx);
            this.drawActorPanel(ctx);
            this.drawOverlay(ctx);
            FNH.drawVignette(ctx, FNH.WIDTH, FNH.HEIGHT, 0.38);
            FNH.drawGrain(ctx, FNH.WIDTH, FNH.HEIGHT, this.time);
        }
    };
})();
