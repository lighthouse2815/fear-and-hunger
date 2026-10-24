'use strict';
(function () {
    const FNH = window.FNH = window.FNH || {};

    // Giữ con trỏ và nhánh riêng cho từng common event; không dùng runtime MV.
    FNH.EventInterpreter = class EventInterpreter {
        constructor(list, handlers) {
            this.handlers = handlers;
            this.frames = [{ list: list || [], index: 0, branches: {} }];
            this.wait = null;
            this.done = false;
            this.gabText = '';
        }

        seek(frame, indent, codes) {
            for (; frame.index < frame.list.length; frame.index += 1) {
                const command = frame.list[frame.index];
                if ((command.indent || 0) === indent && codes.includes(command.code)) return;
            }
            throw new Error('Event thiếu lệnh kết thúc nhánh ' + codes.join('/'));
        }

        resume(value) {
            if (!this.wait || !['message', 'choice', 'number', 'item'].includes(this.wait.type)) return;
            if (this.wait.type === 'number') {
                if (!Number.isInteger(value) || value < 0 || value >= Math.pow(10, this.wait.digits)) {
                    throw new Error('Số nhập event không hợp lệ');
                }
                this.handlers.setVariable(this.wait.variableId, value);
            }
            if (this.wait.type === 'item') {
                if (value !== 0 && !this.wait.items.some((item) => item.id === value)) throw new Error('Vật phẩm chọn không hợp lệ');
                this.handlers.setVariable(this.wait.variableId, value);
            }
            if (this.wait.type === 'choice') {
                if (value === -2 && this.wait.cancel !== -2) throw new Error('Event không cho phép hủy lựa chọn');
                if (value !== -2 && (!Number.isInteger(value) || value < 0 || value >= this.wait.choices.length)) {
                    throw new Error('Lựa chọn event không hợp lệ');
                }
                this.wait.frame.branches[this.wait.indent] = value;
            }
            this.wait = null;
        }

        update(dt) {
            if (this.done) return;
            if (this.wait) {
                if (this.wait.type === 'pause') {
                    if (this.wait.scene.paused) return;
                } else if (this.wait.type === 'gab') {
                    if (this.wait.queue.busy) return;
                } else if (this.wait.type === 'route') {
                    if (this.wait.route.error) throw this.wait.route.error;
                    if (!this.wait.route.done) return;
                } else if (this.wait.type === 'time') {
                    this.wait.seconds -= dt;
                    if (this.wait.seconds > 0) return;
                } else return;
                this.wait = null;
            }
            // Chia vòng lặp dài thành nhiều frame để trình duyệt vẫn nhận input.
            for (let budget = 0; budget < 200 && !this.wait && !this.done; budget += 1) {
                const frame = this.frames[this.frames.length - 1];
                if (!frame || frame.index >= frame.list.length) {
                    this.frames.pop();
                    this.done = this.frames.length === 0;
                    continue;
                }
                const command = frame.list[frame.index++];
                const p = command.parameters || [];
                const indent = command.indent || 0;
                switch (command.code) {
                    case 0: case 108: case 408: case 118: case 505:
                        break;
                    case 101: {
                        if (this.handlers.canShowMessage && !this.handlers.canShowMessage()) {
                            frame.index -= 1;
                            return;
                        }
                        const lines = [];
                        while (frame.list[frame.index] && frame.list[frame.index].code === 401) {
                            lines.push(String(frame.list[frame.index++].parameters[0] || ''));
                        }
                        this.wait = { type: 'message', text: lines.join('\n'), faceName: p[0], faceIndex: p[1] };
                        break;
                    }
                    case 102:
                        if (this.handlers.canShowMessage && !this.handlers.canShowMessage()) {
                            frame.index -= 1;
                            return;
                        }
                        this.wait = { type: 'choice', choices: p[0] || [], cancel: p[1], defaultIndex: p[2], frame, indent };
                        break;
                    case 103: case 104: {
                        if (this.handlers.canShowMessage && !this.handlers.canShowMessage()) {
                            frame.index -= 1;
                            return;
                        }
                        if (command.code === 103) {
                            const digits = Math.max(1, Math.min(8, Number(p[1]) || 1));
                            this.wait = { type: 'number', variableId: p[0], digits, digit: 0,
                                value: Math.max(0, Math.min(Math.pow(10, digits) - 1, Math.floor(Number(this.handlers.variable(p[0])) || 0))) };
                        } else this.wait = { type: 'item', variableId: p[0], items: this.handlers.selectItems(p[1]) };
                        break;
                    }
                    case 402:
                        if (frame.branches[indent] !== p[0]) this.seek(frame, indent, [402, 403, 404]);
                        break;
                    case 403:
                        if (frame.branches[indent] !== -2) this.seek(frame, indent, [404]);
                        break;
                    case 404: case 412:
                        delete frame.branches[indent];
                        break;
                    case 111:
                        frame.branches[indent] = this.handlers.condition(p);
                        if (!frame.branches[indent]) this.seek(frame, indent, [411, 412]);
                        break;
                    case 411:
                        if (frame.branches[indent]) this.seek(frame, indent, [412]);
                        break;
                    case 112:
                        break;
                    case 413: {
                        let start = frame.index - 2;
                        while (start >= 0 && !(frame.list[start].code === 112 && (frame.list[start].indent || 0) === indent)) start -= 1;
                        if (start < 0) throw new Error('Event thiếu đầu vòng lặp');
                        frame.index = start + 1;
                        break;
                    }
                    case 113: {
                        let start = frame.index - 2;
                        while (start >= 0 && !(frame.list[start].code === 112 && (frame.list[start].indent || 0) < indent)) start -= 1;
                        if (start < 0) throw new Error('Thoát vòng lặp ngoài vòng lặp');
                        this.seek(frame, frame.list[start].indent || 0, [413]);
                        frame.index += 1;
                        break;
                    }
                    case 115:
                        frame.index = frame.list.length;
                        break;
                    case 117: {
                        const event = this.handlers.commonEvent(p[0]);
                        if (!event) throw new Error('Không tìm thấy common event ' + p[0]);
                        if (this.frames.length >= 100) throw new Error('Common event đệ quy quá sâu');
                        this.frames.push({ list: event.list || [], index: 0, branches: {} });
                        break;
                    }
                    case 119: {
                        const target = frame.list.findIndex((entry) => entry.code === 118 && entry.parameters[0] === p[0]);
                        if (target >= 0) {
                            const current = frame.index - 1;
                            let level = indent;
                            for (let i = Math.min(current, target); i <= Math.max(current, target); i += 1) {
                                const nextLevel = frame.list[i].indent || 0;
                                if (level !== nextLevel) {
                                    delete frame.branches[level];
                                    level = nextLevel;
                                }
                            }
                            frame.index = target + 1;
                        }
                        break;
                    }
                    case 355: {
                        const lines = [String(p[0] || '')];
                        while (frame.list[frame.index] && frame.list[frame.index].code === 655) {
                            lines.push(String(frame.list[frame.index++].parameters[0] || ''));
                        }
                        this.handlers.execute({ code: 355, parameters: [lines.join('\n')] });
                        break;
                    }
                    case 230:
                        this.wait = { type: 'time', seconds: Math.max(0, Number(p[0]) || 0) / 60 };
                        break;
                    default: {
                        const result = this.handlers.execute(command);
                        if (result && ['route', 'time', 'gab', 'pause'].includes(result.type)) this.wait = result;
                        if (result === false) {
                            this.frames = [];
                            this.done = true;
                        }
                        break;
                    }
                }
            }
        }
    };
})();
