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
        this.eventId = options.eventId || 1;
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
    }

    EventInterpreter.prototype.run = async function () {
        if (this.running) throw new Error('Event interpreter đang chạy.');
        this.running = true;
        try {
            while (this.index < this.commands.length) {
                if (--this.budget.remaining < 0) throw new Error('Event vượt giới hạn số lệnh thực thi.');
                var command = this.commands[this.index++];
                await this.execute(command);
            }
            return this.result;
        } finally {
            this.running = false;
        }
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
        case 201:
            return this.transferPlayer(command.parameters || []);
        case 211: case 212: case 213: case 214: case 216: case 217:
        case 221: case 222: case 223: case 224: case 225: case 226: case 230:
        case 231: case 232: case 233: case 234: case 235: case 236:
        case 241: case 242: case 243: case 244: case 245: case 246:
        case 249: case 250: case 251: case 261:
        case 281: case 282: case 283: case 284: case 285:
        case 301: case 302: case 303:
        case 315: case 316:
        case 317: case 318: case 319: case 320: case 321: case 322: case 323: case 324:
        case 331: case 332: case 333: case 334: case 335: case 336: case 337: case 338:
        case 339: case 340: case 342: case 343: case 344: case 345: case 346:
        case 351: case 352: case 353: case 354: case 356:
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
        await this.handlers.message(lines.join('\n'), command.parameters || [], this);
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
            depth: this.depth + 1, budget: this.budget
        }).run();
        this.result.choices.push.apply(this.result.choices, result.choices);
        if (result.transferred) this.result.transferred = result.transferred;
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
        var choice = await this.handlers.choice(choices, cancelType, this);
        if (choice === -1 && cancelType !== -1) choice = cancelType;
        if (!Number.isInteger(choice) || (choice < 0 ? choice !== -2 || cancelType !== -2 : choice >= choices.length)) {
            throw new Error('Lựa chọn sự kiện không hợp lệ: ' + choice);
        }
        this.result.choices.push({ choices: choices, selected: choice });
        var indent = command.indent || 0;
        var marker = this.findChoiceMarker(indent, choice, this.index);
        if (marker < 0) {
            var missingEnd = this.findCommand(404, indent, this.index);
            this.index = missingEnd < 0 ? this.commands.length : missingEnd + 1;
            return;
        }
        this.index = marker + 1;
        this.choiceFrames.push({ indent: indent, endIndex: this.findCommand(404, indent, marker + 1) });
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
            this.conditionFrames.push({ indent: indent, passed: true, endIndex: endIndex });
            return;
        }
        if (elseIndex >= 0) {
            this.conditionFrames.push({ indent: indent, passed: false, endIndex: endIndex });
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
        if (type === 2) return this.state.selfSwitchValue(this.mapId, this.eventId, parameters[1]) === (parameters[2] === 0);
        if (type === 7) {
            var gold = this.state.gold, amount = Number(parameters[1]);
            return [gold >= amount, gold <= amount, gold < amount][parameters[2]];
        }
        if (type === 4 && parameters[2] === 0) return this.state.hasActor(parameters[1]);
        if (type === 8) return this.state.itemCount('items', parameters[1]) > 0;
        if (type === 9) return this.state.itemCount('weapons', parameters[1]) > 0;
        if (type === 10) return this.state.itemCount('armors', parameters[1]) > 0;
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
        if (parameters[3] < 0 || parameters[3] > 2) throw new Error('Chưa hỗ trợ toán hạng biến loại ' + parameters[3]);
        for (var id = parameters[0]; id <= parameters[1]; id += 1) {
            var operand;
            if (parameters[3] === 0) operand = Number(parameters[4]);
            else if (parameters[3] === 1) operand = this.state.variableValue(parameters[4]);
            else operand = parameters[4] + Math.floor(this.random() * (parameters[5] - parameters[4] + 1));
            var current = this.state.variableValue(id);
            var next = [operand, current + operand, current - operand, current * operand,
                operand === 0 ? 0 : current / operand, operand === 0 ? 0 : current % operand][parameters[2]];
            this.state.setVariable(id, next);
        }
    };

    EventInterpreter.prototype.controlSelfSwitch = function (parameters) {
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

    EventInterpreter.prototype.transferPlayer = function (parameters) {
        this.state.mapId = parameters[0] === 0 ? parameters[1] : this.state.variableValue(parameters[1]);
        this.state.x = parameters[0] === 0 ? parameters[2] : this.state.variableValue(parameters[2]);
        this.state.y = parameters[0] === 0 ? parameters[3] : this.state.variableValue(parameters[3]);
        if (parameters[4]) this.state.direction = parameters[4];
        this.result.transferred = { mapId: this.state.mapId, x: this.state.x, y: this.state.y };
        if (this.handlers.transfer) return this.handlers.transfer(this.result.transferred, this);
    };

    return { EventInterpreter: EventInterpreter };
}));
