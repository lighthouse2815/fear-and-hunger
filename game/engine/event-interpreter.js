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
    }

    EventInterpreter.prototype.run = async function () {
        if (this.running) throw new Error('Event interpreter đang chạy.');
        this.running = true;
        try {
            while (this.index < this.commands.length) {
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
        case 201:
            return this.transferPlayer(command.parameters || []);
        case 211: case 212: case 213: case 214: case 216: case 217:
        case 221: case 222: case 223: case 224: case 225: case 226: case 230:
        case 231: case 232: case 233: case 234: case 235: case 236:
        case 241: case 242: case 243: case 244: case 245: case 246:
        case 249: case 250: case 251: case 261:
        case 281: case 282: case 283: case 284: case 285:
        case 301: case 302: case 303:
        case 311: case 312: case 313: case 314: case 315: case 316:
        case 317: case 318: case 319: case 320: case 321: case 322: case 323: case 324:
        case 331: case 332: case 333: case 334: case 335: case 336: case 337: case 338:
        case 339: case 340: case 342: case 343: case 344: case 345: case 346:
        case 351: case 352: case 353: case 354: case 356:
            return this.effect(command);
        case 355: case 655:
            if (this.handlers.script) return this.handlers.script(command.parameters && command.parameters[0], this);
            return;
        default:
            if (this.handlers.unsupported) return this.handlers.unsupported(command, this);
        }
    };

    EventInterpreter.prototype.showMessage = async function (command) {
        var lines = [];
        while (this.index < this.commands.length && this.commands[this.index].code === 401) {
            lines.push(this.commands[this.index++].parameters[0] || '');
        }
        if (this.handlers.message) await this.handlers.message(lines.join('\n'), command.parameters || [], this);
    };

    EventInterpreter.prototype.effect = async function (command) {
        if (this.handlers.effect) return this.handlers.effect(command.code, command.parameters || [], command, this);
    };

    EventInterpreter.prototype.showChoices = async function (command) {
        var parameters = command.parameters || [];
        var choices = Array.isArray(parameters[0]) ? parameters[0].slice() : [];
        var cancelType = parameters[1];
        var choice = this.handlers.choice ? await this.handlers.choice(choices, cancelType, this) : 0;
        choice = Number.isInteger(choice) ? choice : cancelType;
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
        var seen = 0;
        for (var i = start; i < this.commands.length; i += 1) {
            var command = this.commands[i];
            if ((command.indent || 0) !== indent) continue;
            if (command.code === 404) return -1;
            if (command.code === 403 && wanted === 403) return i;
            if (command.code === 402) {
                if (wanted === 402 && seen++ === choice) return i;
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
        if (type === 2) return this.state.selfSwitchValue(this.mapId, this.eventId, parameters[1]);
        if (type === 7) return this.compare(this.state.gold, Number(parameters[1]), parameters[2]);
        if (type === 8) return this.state.itemCount('items', parameters[1]) > 0;
        if (type === 9) return this.state.itemCount('weapons', parameters[1]) > 0;
        if (type === 10) return this.state.itemCount('armors', parameters[1]) > 0;
        return false;
    };

    EventInterpreter.prototype.compare = function (left, right, operator) {
        return [left === right, left >= right, left <= right, left > right, left < right, left !== right][operator] || false;
    };

    EventInterpreter.prototype.controlSwitches = function (parameters) {
        var value = parameters[2] === 0;
        for (var id = parameters[0]; id <= parameters[1]; id += 1) this.state.setSwitch(id, value);
    };

    EventInterpreter.prototype.controlVariables = function (parameters) {
        var operand = parameters[3] === 0 ? Number(parameters[4]) : this.state.variableValue(parameters[4]);
        for (var id = parameters[0]; id <= parameters[1]; id += 1) {
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
        var amount = parameters[0] === 0 ? Number(parameters[1]) : this.state.variableValue(parameters[1]);
        this.state.gold = Math.max(0, this.state.gold + (parameters[2] === 0 ? amount : -amount));
    };

    EventInterpreter.prototype.controlItem = function (kind, parameters) {
        var amount = parameters[2] === 0 ? Number(parameters[3]) : this.state.variableValue(parameters[3]);
        this.state.gainItem(kind, parameters[0], parameters[1] === 0 ? amount : -amount);
    };

    EventInterpreter.prototype.transferPlayer = function (parameters) {
        if (parameters[0] !== 0) return;
        this.state.mapId = parameters[1];
        this.state.x = parameters[2];
        this.state.y = parameters[3];
        if (parameters[4]) this.state.direction = parameters[4];
        this.result.transferred = { mapId: this.state.mapId, x: this.state.x, y: this.state.y };
        if (this.handlers.transfer) return this.handlers.transfer(this.result.transferred, this);
    };

    return { EventInterpreter: EventInterpreter };
}));
