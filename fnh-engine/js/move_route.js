'use strict';
(function () {
    const FNH = window.FNH = window.FNH || {};
    const offsets = { 2: [0, 1], 4: [-1, 0], 6: [1, 0], 8: [0, -1] };
    const clockwise = { 2: 4, 4: 8, 8: 6, 6: 2 };

    FNH.MoveRoute = class MoveRoute {
        constructor(scene, character, route) {
            for (const command of route.list || []) {
                if (!Number.isInteger(command.code) || command.code < 0 || command.code > 44) {
                    throw new Error('Chưa hỗ trợ lệnh move route ' + command.code);
                }
            }
            this.scene = scene;
            this.character = character;
            this.route = route;
            this.index = 0;
            this.waitSeconds = 0;
            this.done = false;
            this.error = null;
        }

        turn(direction) {
            if (!this.character.directionFix) this.character.direction = direction;
        }

        towardPlayer(away) {
            const player = this.scene.game.player;
            const dx = player.mapX - this.character.x;
            const dy = player.mapY - this.character.y;
            if (!dx && !dy) return 0;
            const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : (dy > 0 ? 2 : 8);
            return away ? 10 - direction : direction;
        }

        step(direction, backward) {
            if (!direction) return true;
            if (!backward) this.turn(direction);
            const [dx, dy] = offsets[direction];
            return this.scene.moveRouteCharacter(this.character, dx, dy);
        }

        update(dt) {
            if (this.done || this.character.motion) return;
            this.waitSeconds = Math.max(0, this.waitSeconds - dt);
            if (this.waitSeconds > 0) return;
            const command = (this.route.list || [])[this.index] || { code: 0 };
            const p = command.parameters || [];
            const c = this.character;
            let moved = true;
            switch (command.code) {
                case 0:
                    if (this.route.repeat) this.index = 0;
                    else this.done = true;
                    return;
                case 1: case 2: case 3: case 4:
                    moved = this.step([2, 4, 6, 8][command.code - 1]);
                    break;
                case 5: case 6: case 7: case 8: {
                    const [dx, dy] = [[-1, 1], [1, 1], [-1, -1], [1, -1]][command.code - 5];
                    if (c.direction === (dx < 0 ? 6 : 4)) this.turn(dx < 0 ? 4 : 6);
                    if (c.direction === (dy < 0 ? 8 : 2)) this.turn(dy < 0 ? 2 : 8);
                    moved = this.scene.moveRouteCharacter(c, dx, dy);
                    break;
                }
                case 9: moved = this.step([2, 4, 6, 8][Math.floor(Math.random() * 4)]); break;
                case 10: case 11: {
                    const direction = this.towardPlayer(command.code === 11);
                    moved = this.step(direction);
                    if (!moved && c.x !== this.scene.game.player.mapX && c.y !== this.scene.game.player.mapY) {
                        const player = this.scene.game.player;
                        const other = direction === 2 || direction === 8 ? (player.mapX > c.x ? 6 : 4)
                            : (player.mapY > c.y ? 2 : 8);
                        moved = this.step(command.code === 11 ? 10 - other : other);
                    }
                    break;
                }
                case 12: moved = this.step(c.direction); break;
                case 13: moved = this.step(10 - c.direction, true); break;
                case 14: {
                    const dx = Number(p[0]), dy = Number(p[1]);
                    if (Math.abs(dx) > Math.abs(dy)) this.turn(dx < 0 ? 4 : 6);
                    else if (dy) this.turn(dy < 0 ? 8 : 2);
                    this.scene.moveRouteCharacter(c, dx, dy, true);
                    break;
                }
                case 15: this.waitSeconds = Math.max(0, Number(p[0]) || 0) / 60; break;
                case 16: case 17: case 18: case 19: this.turn([2, 4, 6, 8][command.code - 16]); break;
                case 20: this.turn(clockwise[c.direction]); break;
                case 21: this.turn(10 - clockwise[c.direction]); break;
                case 22: this.turn(10 - c.direction); break;
                case 23: this.turn(Math.random() < 0.5 ? clockwise[c.direction] : 10 - clockwise[c.direction]); break;
                case 24: this.turn([2, 4, 6, 8][Math.floor(Math.random() * 4)]); break;
                case 25: case 26: {
                    const direction = this.towardPlayer(command.code === 26);
                    if (direction) this.turn(direction);
                    break;
                }
                case 27: case 28: this.scene.game.flags['switch:' + p[0]] = command.code === 27; break;
                case 29: c.moveSpeed = Math.max(1, Math.min(6, Number(p[0]) || 4)); break;
                case 30: c.moveFrequency = Math.max(1, Math.min(5, Number(p[0]) || 3)); break;
                case 31: case 32: c.walkAnime = command.code === 31; break;
                case 33: case 34: c.stepAnime = command.code === 33; break;
                case 35: case 36: c.directionFix = command.code === 35; break;
                case 37: case 38: c.throughOverride = command.code === 37; break;
                case 39: case 40: c.transparent = command.code === 39; break;
                case 41: c.imageName = String(p[0] || ''); c.imageIndex = Number(p[1]) || 0; break;
                case 42: c.opacity = Math.max(0, Math.min(255, Number(p[0]) || 0)); break;
                case 43: c.blendMode = Number(p[0]) || 0; break;
                case 44:
                    if (p[0] && p[0].name) this.scene.game.audio.playSe(p[0].name, {
                        volume: (p[0].volume === undefined ? 90 : p[0].volume) / 100
                    });
                    break;
                default: throw new Error('Chưa hỗ trợ lệnh move route ' + command.code);
            }
            if (moved || this.route.skippable) this.index += 1;
        }
    };
})();
