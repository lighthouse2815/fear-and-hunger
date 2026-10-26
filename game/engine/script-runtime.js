'use strict';

// Chuyển script nội dung sang thao tác dữ liệu của engine mới. Không eval runtime cũ.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneScripts = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function compileScript(source) {
        return String(source).split(/\r?\n/).filter(function (line) { return line.trim(); }).map(function (line) {
            var text = line.trim(), match;
            match = /^\$gameActors\.actor\((\d+)\)\.(setCharacterImage|setFaceImage|setBattlerImage)\((['"])(.*?)\3(?:,\s*(\d+))?\)\s*;?$/.exec(text);
            if (match) {
                var kind = { setCharacterImage: 'character', setFaceImage: 'face', setBattlerImage: 'battler' }[match[2]];
                if ((kind === 'battler') !== (match[5] === undefined)) throw new Error('Đối số hình nhân vật không hợp lệ: ' + text);
                return { type: 'image', id: Number(match[1]), kind: kind, name: match[4], index: Number(match[5] || 0) };
            }
            match = /^\$gameActors\.actor\((\d+)\)\.setMaxHp\((\d+)\)\s*;?$/.exec(text);
            if (match) return { type: 'maxHp', id: Number(match[1]), value: Number(match[2]) };
            match = /^this\._chaseRange\s*=\s*(\d+)\s*;?$/.exec(text);
            if (match) return { type: 'chaseRange', value: Number(match[1]) };
            match = /^this\._seePlayer\s*=\s*(true|false)\s*;?$/.exec(text);
            if (match) return { type: 'seePlayer', value: match[1] === 'true' };
            match = /^this\._alertSound\s*=\s*(['"])(.*?)\1\s*;?$/.exec(text);
            if (match) return { type: 'alertSound', value: match[2] };
            if (/^\$gamePlayer\.refresh\(\)\s*;?$/.test(text)) return { type: 'refresh' };
            if (/^TouchInput\.update\s*=\s*function\(\)\s*\{\s*\}\s*;?$/.test(text)) return { type: 'disableTouch' };
            throw new Error('Chưa chuyển đổi script nội dung: ' + text);
        });
    }

    function executeScript(source, context) {
        var operations = compileScript(source);
        operations.forEach(function (operation) {
            var actor;
            if (operation.type === 'image' || operation.type === 'maxHp') {
                actor = context.state.actor(operation.id);
                if (!actor) throw new Error('Không tìm thấy actor ' + operation.id);
                if (operation.type === 'image') {
                    actor[operation.kind + 'Name'] = operation.name;
                    if (operation.kind !== 'battler') actor[operation.kind + 'Index'] = operation.index;
                } else {
                    actor.maxHpOverride = Math.max(1, operation.value);
                    actor.hp = Math.min(actor.hp, actor.maxHpOverride);
                }
            } else if (operation.type === 'disableTouch') context.state.touchEnabled = false;
            else if (operation.type !== 'refresh') {
                if (!context.character) throw new Error('Script cần nhân vật đang chạy movement route.');
                context.character[operation.type] = operation.value;
            }
        });
        if (context.refresh) context.refresh();
        return operations;
    }

    return { compileScript: compileScript, executeScript: executeScript };
}));
