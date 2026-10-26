'use strict';

// Bộ thông dịch event độc lập. Các mã lệnh ở đây là định dạng dữ liệu đã lưu,
// không phải mã runtime RPG Maker được sao chép.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.FNHStandaloneEvents = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function EventInterpreter(options) {
        options = options || {};
        if (!Array.isArray(options.commands)) throw new TypeError('Event cần danh sách lệnh.');
        if (!options.state) throw new TypeError('Event cần GameState.');
        this.commands = options.commands;
        this.state = options.state;
        this.mapId = options.mapId || this.state.mapId;
        this.eventId = options.eventId == null ? 1 : options.eventId;
        this.handlers = options.handlers || {};
        this.index = 0;
        this.running = false;
        this.result = { transferred: null, choices: [] };
        this.choiceFrames = [];
        this.conditionFrames = [];
        this.loopFrames = [];
        this.commonEvents = options.commonEvents || (this.state.database && this.state.database.CommonEvents) || [];
        this.random = options.random || Math.random;
        this.depth = options.depth || 0;
        this.budget = options.budget || { remaining: options.maxSteps || 100000 };
        this.signal = options.signal || null;
    }

    EventInterpreter.prototype.run = async function () {
        if (this.running) throw new Error('Event interpreter đang chạy.');
        this.running = true;
        try {
            while (this.index < this.commands.length) {
                if (this.signal && this.signal.aborted) throw this.signal.reason;
                if (--this.budget.remaining < 0) throw new Error('Event vượt giới hạn số lệnh thực thi.');
                var command = this.commands[this.index++];
                await this.awaitCommand(this.execute(command));
            }
            return this.result;
        } finally {
            this.running = false;
        }
    };

    EventInterpreter.prototype.awaitCommand = async function (result) {
        var signal = this.signal;
        if (!signal) return result;
        if (signal.aborted) throw signal.reason;
        var abort;
        var cancelled = new Promise(function (_, reject) {
            abort = function () { reject(signal.reason); };
            signal.addEventListener('abort', abort, { once: true });
        });
        try { return await Promise.race([Promise.resolve(result), cancelled]); }
        finally { signal.removeEventListener('abort', abort); }
    };

    EventInterpreter.prototype.execute = async function (command) {
        if (!command || typeof command.code !== 'number') return;
        if (this.handlers.command) await this.handlers.command(command, this);
        switch (command.code) {
        case 0: case 108: case 408:
            return;
        case 101:
            return this.showMessage(command);
        case 102:
            return this.showChoices(command);
        case 356:
            return this.pluginCommand(command);
        case 402: case 403:
            return this.choiceBranchMarker(command);
        case 404:
            return this.choiceEnd(command);
        case 111:
            return this.condition(command);
        case 112:
            return this.beginLoop(command);
        case 113:
            return this.breakLoop();
        case 413:
            return this.repeatLoop();
        case 115:
            this.index = this.commands.length;
            return;
        case 117:
            return this.commonEvent(command.parameters[0]);
        case 118:
            return;
        case 119:
            return this.jumpToLabel(command.parameters[0]);
        case 411:
            return this.conditionElse(command);
        case 412:
            return this.conditionEndMarker(command);
        case 121:
            return this.controlSwitches(command.parameters || []);
        case 122:
            return this.controlVariables(command.parameters || []);
        case 123:
            return this.controlSelfSwitch(command.parameters || []);
        case 124:
            this.state.timer = { active: command.parameters[0] === 0, frames: (command.parameters[1] || 0) * 60 };
            return;
        case 132:
            this.state.battleBgm = Object.assign({}, command.parameters[0]);
            return;
        case 204:
            this.state.vehicleBgm = command.parameters[0] ? Object.assign({}, command.parameters[1]) : null;
            return;
        case 216:
            this.state.followersVisible = command.parameters[0] !== 0;
            return;
        case 217:
            this.state.followersGathering = true;
            return;
        case 134: case 135:
            this.state[command.code === 134 ? 'saveEnabled' : 'menuEnabled'] = command.parameters[0] !== 0;
            return;
        case 125:
            return this.controlGold(command.parameters || []);
        case 126:
            return this.controlItem('items', command.parameters || []);
        case 127:
            return this.controlItem('weapons', command.parameters || []);
        case 128:
            return this.controlItem('armors', command.parameters || []);
        case 129:
            if (command.parameters[1] === 0) this.state.addActor(command.parameters[0]);
            else this.state.removeActor(command.parameters[0]);
            return;
        case 311:
            return this.controlActorHp(command.parameters || []);
        case 312:
            return this.controlActorMp(command.parameters || []);
        case 313:
            return this.controlActorState(command.parameters || []);
        case 314:
            return this.controlActorRecover(command.parameters || []);
        case 315: case 316: case 317: case 318:
        case 319: case 320: case 321: case 322: case 324: case 325: case 326:
            return this.controlActor(command);
        case 201:
            return this.transferPlayer(command.parameters || []);
        case 205:
            // 505 lặp lại các lệnh route đã nằm trong parameters[1].list.
            while (this.commands[this.index] && this.commands[this.index].code === 505) this.index++;
            return this.effect(command);
        case 203:
        case 211: case 212: case 213: case 214: case 216: case 217:
        case 221: case 222: case 223: case 224: case 225: case 226: case 230:
        case 231: case 232: case 233: case 234: case 235: case 236:
        case 241: case 242: case 243: case 244: case 245: case 246:
        case 249: case 250: case 251: case 261:
        case 281: case 282: case 283: case 284: case 285:
        case 301: case 302: case 303:
        case 323:
        case 331: case 332: case 333: case 334: case 335: case 336: case 337: case 338:
        case 339: case 340: case 342: case 343: case 344: case 345: case 346:
        case 204: case 216: case 217: case 351: case 352: case 353: case 354:
            return this.effect(command);
        case 355:
            if (!this.handlers.script) return this.unsupported(command);
            var lines = [command.parameters[0]];
            while (this.commands[this.index] && this.commands[this.index].code === 655) {
                lines.push(this.commands[this.index++].parameters[0]);
            }
            return this.handlers.script(lines.join('\n'), this);
        default:
            return this.unsupported(command);
        }
    };

    EventInterpreter.prototype.unsupported = function (command) {
        if (this.handlers.unsupported) return this.handlers.unsupported(command, this);
        throw new Error('Chưa hỗ trợ lệnh ' + command.code + ' (map ' + this.mapId + ', event ' + this.eventId + ').');
    };

    EventInterpreter.prototype.showMessage = async function (command) {
        var lines = [];
        while (this.index < this.commands.length && this.commands[this.index].code === 401) {
            lines.push(this.commands[this.index++].parameters[0] || '');
        }
        if (!this.handlers.message) return this.unsupported(command);
        await this.handlers.message(lines.join('\n'), command.parameters || [], this, {
            choicesFollow: !!(this.commands[this.index] && this.commands[this.index].code === 102)
        });
    };

    EventInterpreter.prototype.effect = async function (command) {
        if (this.handlers.effect) {
            var result = await this.handlers.effect(command.code, command.parameters || [], command, this);
            if (result !== false) return result;
        }
        return this.unsupported(command);
    };

    EventInterpreter.prototype.commonEvent = async function (id) {
        var event = this.commonEvents[id];
        if (!event) throw new Error('Không tìm thấy common event ' + id);
        if (this.depth >= 64) throw new Error('Common event gọi lồng nhau quá sâu.');
        var result = await new EventInterpreter({
            commands: event.list, state: this.state, mapId: this.mapId, eventId: this.eventId,
            handlers: this.handlers, commonEvents: this.commonEvents, random: this.random,
            depth: this.depth + 1, budget: this.budget, signal: this.signal
        }).run();
        this.result.choices.push.apply(this.result.choices, result.choices);
        if (result.transferred) this.result.transferred = result.transferred;
    };

    EventInterpreter.prototype.jumpToLabel = function (name) {
        var target = this.commands.findIndex(function (command) { return command.code === 118 && command.parameters[0] === name; });
        if (target < 0) return;
        this.index = target + 1;
        this.conditionFrames = this.conditionFrames.filter(function (frame) { return target >= frame.startIndex && target <= frame.endIndex; });
        this.choiceFrames = this.choiceFrames.filter(function (frame) { return target >= frame.startIndex && target <= frame.endIndex; });
        this.loopFrames = this.loopFrames.filter(function (frame) { return target >= frame.start && target <= frame.end; });
    };

    EventInterpreter.prototype.controlActor = function (command) {
        var p = command.parameters || [], code = command.code, state = this.state;
        var targets = code <= 318 || code === 326 ? this.actorTargets(p) : [p[0]];
        targets.forEach(function (id) {
            var actor = state.actor(id);
            if (!actor) return;
            if (code === 315 || code === 316) state.changeActorExp(id, this.operateSigned(p[2], p[3], p[4]), code === 316);
            else if (code === 317) state.changeActorParam(id, p[2], this.operateSigned(p[3], p[4], p[5]));
            else if (code === 318) {
                if (p[2] === 0 && !actor.skills.includes(p[3])) actor.skills.push(p[3]);
                if (p[2] !== 0) actor.skills = actor.skills.filter(function (skill) { return skill !== p[3]; });
                actor.skills.sort(function (a, b) { return a - b; });
            } else if (code === 319) state.equipActor(id, p[1] - 1, p[2]);
            else if (code === 320) actor.name = p[1];
            else if (code === 321) {
                if (!state.database.Classes[p[1]]) throw new Error('Không tìm thấy class ' + p[1]);
                actor.expByClass = Object.assign({}, actor.expByClass, { [actor.classId]: actor.exp });
                actor.classId = p[1];
                if (!p[2]) actor.exp = actor.expByClass[p[1]] || 0;
                state.changeActorExp(id, 0, false);
            } else if (code === 322) {
                actor.characterName = p[1]; actor.characterIndex = p[2];
                actor.faceName = p[3]; actor.faceIndex = p[4]; actor.battlerName = p[5];
                if (state.party[0] === id) { delete state.characterName; delete state.characterIndex; }
            } else if (code === 324) actor.nickname = p[1];
            else if (code === 325) actor.profile = p[1];
            else if (code === 326) actor.tp = Math.max(0, Math.min(100, actor.tp + this.operateSigned(p[2], p[3], p[4])));
        }, this);
    };

    EventInterpreter.prototype.beginLoop = function (command) {
        var end = this.findCommand(413, command.indent || 0, this.index);
        if (end < 0) throw new Error('Vòng lặp thiếu lệnh kết thúc.');
        this.loopFrames.push({ start: this.index, end: end, indent: command.indent || 0 });
    };

    EventInterpreter.prototype.clearBranches = function (indent) {
        this.conditionFrames = this.conditionFrames.filter(function (frame) { return frame.indent < indent; });
        this.choiceFrames = this.choiceFrames.filter(function (frame) { return frame.indent < indent; });
    };

    EventInterpreter.prototype.repeatLoop = function () {
        var frame = this.loopFrames[this.loopFrames.length - 1];
        if (!frame) throw new Error('Không tìm thấy vòng lặp.');
        this.clearBranches(frame.indent + 1);
        this.index = frame.start;
    };

    EventInterpreter.prototype.breakLoop = function () {
        var frame = this.loopFrames.pop();
        if (!frame) { this.index = this.commands.length; return; }
        this.clearBranches(frame.indent + 1);
        this.index = frame.end + 1;
    };

    EventInterpreter.prototype.operateSigned = function (operation, operandType, operand) {
        var value = operandType === 0 ? Number(operand) : this.state.variableValue(operand);
        return operation === 0 ? value : -value;
    };

    EventInterpreter.prototype.actorTargets = function (parameters) {
        var selector = parameters[0] === 0 ? parameters[1] : this.state.variableValue(parameters[1]);
        return selector === 0 ? this.state.party.slice() : [selector];
    };

    EventInterpreter.prototype.controlActorHp = function (parameters) {
        var amount = this.operateSigned(parameters[2], parameters[3], parameters[4]);
        this.actorTargets(parameters).forEach(function (id) {
            this.state.changeActorHp(id, amount, parameters[5] === true);
        }, this);
    };

    EventInterpreter.prototype.controlActorMp = function (parameters) {
        var amount = this.operateSigned(parameters[2], parameters[3], parameters[4]);
        this.actorTargets(parameters).forEach(function (id) { this.state.changeActorMp(id, amount); }, this);
    };

    EventInterpreter.prototype.controlActorState = function (parameters) {
        var add = parameters[2] === 0;
        this.actorTargets(parameters).forEach(function (id) {
            this.state.changeActorState(id, parameters[3], add);
        }, this);
    };

    EventInterpreter.prototype.controlActorRecover = function (parameters) {
        this.actorTargets(parameters).forEach(function (id) { this.state.recoverActor(id); }, this);
    };

    EventInterpreter.prototype.showChoices = async function (command) {
        var parameters = command.parameters || [];
        var choices = Array.isArray(parameters[0]) ? parameters[0].slice() : [];
        var cancelType = parameters[1];
        if (!this.handlers.choice) return this.unsupported(command);
        var overrides = this.state.pendingChoices;
        this.state.pendingChoices = { text: {}, disabled: [] };
        choices = choices.map(function (text, index) { return index in overrides.text ? overrides.text[index] : text; });
        var details = { disabled: overrides.disabled.slice(), help: [], message: [], defaultIndex: parameters[2], position: parameters[3], background: parameters[4] };
        var indent = command.indent || 0, branch = -1;
        for (var i = this.index; i < this.commands.length; i++) {
            var item = this.commands[i];
            if ((item.indent || 0) === indent && item.code === 404) break;
            if ((item.indent || 0) === indent && item.code === 402) branch = item.parameters[0];
            if ((item.indent || 0) === indent + 1 && (item.code === 108 || item.code === 408) && branch >= 0) {
                var comment = /^(ChoiceHelp|ChoiceMessage)\s+(.*)$/.exec(item.parameters[0]);
                if (comment) details[comment[1] === 'ChoiceHelp' ? 'help' : 'message'][branch] = comment[2];
            }
        }
        var choice = await this.handlers.choice(choices, cancelType, this, details);
        if (choice === -1 && cancelType !== -1) choice = cancelType;
        if (!Number.isInteger(choice) || (choice < 0 ? choice !== -2 || cancelType !== -2 : choice >= choices.length)) {
            throw new Error('Lựa chọn sự kiện không hợp lệ: ' + choice);
        }
        if (details.disabled.includes(choice)) throw new Error('Lựa chọn đang bị khóa: ' + choice);
        this.result.choices.push({ choices: choices, selected: choice });
        var marker = this.findChoiceMarker(indent, choice, this.index);
        if (marker < 0) {
            var missingEnd = this.findCommand(404, indent, this.index);
            this.index = missingEnd < 0 ? this.commands.length : missingEnd + 1;
            return;
        }
        this.index = marker + 1;
        this.choiceFrames.push({ indent: indent, startIndex: marker + 1, endIndex: this.findCommand(404, indent, marker + 1) });
    };

    EventInterpreter.prototype.pluginCommand = function (command) {
        var text = String(command.parameters[0] || ''), match;
        if (/^(Enable|Disable|Toggle)Dashing$/.test(text)) {
            this.state.dashEnabled = text === 'ToggleDashing' ? !this.state.dashEnabled : text === 'EnableDashing';
            return;
        }
        var region = /^(RegionReveal|RegionHide)\s+\[?(\d+)\]?$/i.exec(text);
        if (region) {
            var id = Number(region[2]), open = this.state.regionCover.open;
            this.state.regionCover.enabled = true;
            if (region[1].toLowerCase() === 'regionreveal' && !open.includes(id)) open.push(id);
            if (region[1].toLowerCase() === 'regionhide' && id !== 0) this.state.regionCover.open = open.filter(function (value) { return value !== id; });
            return;
        }
        if (/^RegionReset$/i.test(text)) {
            this.state.regionCover.enabled = true; this.state.regionCover.open = [0]; return;
        }
        if ((match = /^choice_text\s+(\d+)\s+(.*)$/i.exec(text))) {
            this.state.pendingChoices.text[Number(match[1]) - 1] = match[2];
            return;
        }
        var achievement = /^steamworks\s+activateachievement\s+([\w-]+)$/i.exec(text);
        if (achievement) {
            this.state.achievements[achievement[1]] = true;
            return;
        }
        if ((match = /^disable_choice\s+(\d+)$/i.exec(text))) {
            var index = Number(match[1]) - 1;
            if (!this.state.pendingChoices.disabled.includes(index)) this.state.pendingChoices.disabled.push(index);
            return;
        }
        if (/^(Enable|Disable)WordWrap$/i.test(text)) {
            this.state.wordWrap = /^Enable/i.test(text);
            return;
        }
        if ((match = /^GabText(?:\s+(.*))?$/.exec(text))) { this.gabText = match[1] || ''; return; }
        if (text === 'ShowGab' && this.handlers.gab) {
            var gab = this.gabText; this.gabText = '';
            if (gab) return this.handlers.gab(gab, this);
            return;
        }
        if (text === 'ClearGab' && this.handlers.gab) return this.handlers.gab(null, this);
        return this.effect(command);
    };

    EventInterpreter.prototype.findChoiceMarker = function (indent, choice, start) {
        var wanted = choice < 0 ? 403 : 402;
        for (var i = start; i < this.commands.length; i += 1) {
            var command = this.commands[i];
            if ((command.indent || 0) !== indent) continue;
            if (command.code === 404) return -1;
            if (command.code === 403 && wanted === 403) return i;
            if (command.code === 402) {
                if (wanted === 402 && command.parameters[0] === choice) return i;
            }
        }
        return -1;
    };

    EventInterpreter.prototype.choiceFrame = function (indent) {
        for (var i = this.choiceFrames.length - 1; i >= 0; i -= 1) {
            if (this.choiceFrames[i].indent === indent) return this.choiceFrames[i];
        }
        return null;
    };

    EventInterpreter.prototype.choiceBranchMarker = function (command) {
        var frame = this.choiceFrame(command.indent || 0);
        if (frame) {
            this.index = frame.endIndex < 0 ? this.commands.length : frame.endIndex + 1;
            this.choiceFrames.splice(this.choiceFrames.indexOf(frame), 1);
        }
    };

    EventInterpreter.prototype.choiceEnd = function (command) {
        var frame = this.choiceFrame(command.indent || 0);
        if (frame) this.choiceFrames.splice(this.choiceFrames.indexOf(frame), 1);
    };

    EventInterpreter.prototype.condition = function (command) {
        var parameters = command.parameters || [];
        var passed = this.evaluateCondition(parameters);
        var indent = command.indent || 0;
        var elseIndex = this.findCommand(411, indent, this.index);
        var endIndex = this.findCommand(412, indent, this.index);
        if (endIndex < 0) throw new Error('Điều kiện thiếu lệnh kết thúc.');
        if (elseIndex > endIndex) elseIndex = -1;
        if (passed) {
            this.conditionFrames.push({ indent: indent, startIndex: this.index, passed: true, endIndex: endIndex });
            return;
        }
        if (elseIndex >= 0) {
            this.conditionFrames.push({ indent: indent, startIndex: elseIndex + 1, passed: false, endIndex: endIndex });
            this.index = elseIndex + 1;
        } else {
            this.index = endIndex >= 0 ? endIndex + 1 : this.commands.length;
        }
    };

    EventInterpreter.prototype.conditionFrame = function (indent) {
        for (var i = this.conditionFrames.length - 1; i >= 0; i -= 1) {
            if (this.conditionFrames[i].indent === indent) return this.conditionFrames[i];
        }
        return null;
    };

    EventInterpreter.prototype.conditionElse = function (command) {
        var frame = this.conditionFrame(command.indent || 0);
        if (frame && frame.passed) {
            this.index = frame.endIndex < 0 ? this.commands.length : frame.endIndex + 1;
            this.conditionFrames.splice(this.conditionFrames.indexOf(frame), 1);
        }
    };

    EventInterpreter.prototype.conditionEndMarker = function (command) {
        var frame = this.conditionFrame(command.indent || 0);
        if (frame) this.conditionFrames.splice(this.conditionFrames.indexOf(frame), 1);
    };

    EventInterpreter.prototype.findCommand = function (code, indent, start) {
        for (var i = start; i < this.commands.length; i += 1) {
            if (this.commands[i].code === code && (this.commands[i].indent || 0) === indent) return i;
        }
        return -1;
    };

    EventInterpreter.prototype.evaluateCondition = function (parameters) {
        var type = parameters[0];
        if (type === 0) return this.state.switchValue(parameters[1]) === (parameters[2] === 0);
        if (type === 1) {
            var left = this.state.variableValue(parameters[1]);
            var right = parameters[2] === 0 ? Number(parameters[3]) : this.state.variableValue(parameters[3]);
            return this.compare(left, right, parameters[4]);
        }
        if (type === 2) return this.eventId > 0 && this.state.selfSwitchValue(this.mapId, this.eventId, parameters[1]) === (parameters[2] === 0);
        if (type === 3) return this.state.timer && this.state.timer.active &&
            (parameters[2] === 0 ? Math.floor(this.state.timer.frames / 60) >= parameters[1] : Math.floor(this.state.timer.frames / 60) <= parameters[1]);
        if (type === 7) {
            var gold = this.state.gold, amount = Number(parameters[1]);
            return [gold >= amount, gold <= amount, gold < amount][parameters[2]];
        }
        if (type === 4) {
            if (parameters[2] === 0) return this.state.hasActor(parameters[1]);
            var actor = this.state.actor(parameters[1]);
            if (!actor) return false;
            if (parameters[2] === 1) return actor.name === parameters[3];
            if (parameters[2] === 2) return actor.classId === parameters[3];
            if (parameters[2] === 3) return actor.skills.includes(parameters[3]);
            if (parameters[2] === 4) return actor.equips[0] === parameters[3];
            if (parameters[2] === 5) return actor.equips.slice(1).includes(parameters[3]);
            if (parameters[2] === 6) return actor.states.includes(parameters[3]);
        }
        if (type === 8) return this.state.itemCount('items', parameters[1]) > 0;
        if (type === 9) return this.state.itemCount('weapons', parameters[1]) > 0;
        if (type === 10) return this.state.itemCount('armors', parameters[1]) > 0;
        if (this.handlers.condition) return this.handlers.condition(parameters, this);
        throw new Error('Chưa hỗ trợ điều kiện sự kiện: ' + JSON.stringify(parameters));
    };

    EventInterpreter.prototype.compare = function (left, right, operator) {
        return [left === right, left >= right, left <= right, left > right, left < right, left !== right][operator] || false;
    };

    EventInterpreter.prototype.controlSwitches = function (parameters) {
        var value = parameters[2] === 0;
        for (var id = parameters[0]; id <= parameters[1]; id += 1) this.state.setSwitch(id, value);
    };

    EventInterpreter.prototype.controlVariables = function (parameters) {
        if (parameters[3] < 0 || parameters[3] > 3) throw new Error('Chưa hỗ trợ toán hạng biến loại ' + parameters[3]);
        var base;
        if (parameters[3] === 0) base = Number(parameters[4]);
        if (parameters[3] === 1) base = this.state.variableValue(parameters[4]);
        if (parameters[3] === 3) base = this.gameDataOperand(parameters[4], parameters[5], parameters[6]);
        for (var id = parameters[0]; id <= parameters[1]; id += 1) {
            var operand = parameters[3] === 2 ? parameters[4] + Math.floor(this.random() * (parameters[5] - parameters[4] + 1)) : base;
            var current = this.state.variableValue(id);
            var next = [operand, current + operand, current - operand, current * operand,
                operand === 0 ? 0 : current / operand, operand === 0 ? 0 : current % operand][parameters[2]];
            this.state.setVariable(id, next);
        }
    };

    EventInterpreter.prototype.gameDataOperand = function (type, id, field) {
        if (type >= 0 && type <= 2) return this.state.itemCount(['items', 'weapons', 'armors'][type], id);
        if (type === 3) {
            var actor = this.state.actor(id);
            if (!actor) return 0;
            if (field === 0) return actor.level;
            if (field === 1) return actor.exp || 0;
            if (field === 2) return actor.hp;
            if (field === 3) return actor.mp;
            if (field >= 4 && field <= 11) return this.state.actorParam(id, field - 4);
        }
        if (type === 6) return this.state.party[id] || 0;
        if (type === 7 && id === 0) return this.state.mapId;
        if (type === 7 && id === 1) return this.state.party.length;
        if (type === 7 && id === 2) return this.state.gold;
        if (this.handlers.gameData) return this.handlers.gameData(type, id, field, this);
        throw new Error('Chưa hỗ trợ dữ liệu sự kiện: ' + [type, id, field].join(','));
    };

    EventInterpreter.prototype.controlSelfSwitch = function (parameters) {
        if (this.eventId <= 0) return;
        this.state.setSelfSwitch(this.mapId, this.eventId, parameters[0], parameters[1] === 0);
    };

    EventInterpreter.prototype.controlGold = function (parameters) {
        var amount = this.operateSigned(parameters[0], parameters[1], parameters[2]);
        this.state.gold = Math.max(0, this.state.gold + amount);
    };

    EventInterpreter.prototype.controlItem = function (kind, parameters) {
        var amount = parameters[2] === 0 ? Number(parameters[3]) : this.state.variableValue(parameters[3]);
        this.state.gainItem(kind, parameters[0], parameters[1] === 0 ? amount : -amount);
    };

    EventInterpreter.prototype.transferPlayer = async function (parameters) {
        var destination = {
            mapId: parameters[0] === 0 ? parameters[1] : this.state.variableValue(parameters[1]),
            x: parameters[0] === 0 ? parameters[2] : this.state.variableValue(parameters[2]),
            y: parameters[0] === 0 ? parameters[3] : this.state.variableValue(parameters[3]),
            direction: parameters[4] || this.state.direction
        };
        // Tải và kiểm tra đích trước; lỗi tải không được làm map/state lệch nhau.
        if (this.handlers.transfer) await this.handlers.transfer(destination, this);
        this.state.mapId = destination.mapId;
        this.state.x = destination.x;
        this.state.y = destination.y;
        if (!this.state.directionFixed) this.state.direction = destination.direction;
        this.result.transferred = { mapId: this.state.mapId, x: this.state.x, y: this.state.y };
    };

    return { EventInterpreter: EventInterpreter };
}));
