'use strict';
(function () {
    const FNH = window.FNH = window.FNH || {};
    // Chỉ nhận các lời gọi API có đối số literal; không chạy JavaScript tùy ý.
    const string = String.raw`(?:'[^'\\\r\n]*'|"[^"\\\r\n]*")`;
    const patterns = [
        { kind: 'disableTouch', regex: /TouchInput\.update\s*=\s*function\(\)\s*\{\s*\}/y },
        { kind: 'refresh', regex: /\$gamePlayer\.refresh\(\s*\)/y },
        { kind: 'character', regex: new RegExp(String.raw`\$gameActors\.actor\(\s*(\d+)\s*\)\.setCharacterImage\(\s*(${string})\s*,\s*(\d+)\s*\)`, 'y') },
        { kind: 'face', regex: new RegExp(String.raw`\$gameActors\.actor\(\s*(\d+)\s*\)\.setFaceImage\(\s*(${string})\s*,\s*(\d+)\s*\)`, 'y') },
        { kind: 'battler', regex: new RegExp(String.raw`\$gameActors\.actor\(\s*(\d+)\s*\)\.setBattlerImage\(\s*(${string})\s*\)`, 'y') },
        { kind: 'switch', regex: /\$gameSwitches\.setValue\(\s*(\d+)\s*,\s*(true|false)\s*\)/y },
        { kind: 'variable', regex: /\$gameVariables\.setValue\(\s*(\d+)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/y }
    ];

    FNH.executeEventScript = function (scene, source) {
        const operations = [];
        let index = 0;
        while (index < source.length) {
            while (/[\s;]/.test(source[index] || '') && index < source.length) index += 1;
            if (index >= source.length) break;
            let found = false;
            for (const pattern of patterns) {
                pattern.regex.lastIndex = index;
                const match = pattern.regex.exec(source);
                if (!match) continue;
                const end = pattern.regex.lastIndex;
                if (!/^[ \t]*(?:;|\r?\n|$)/.test(source.slice(end))) continue;
                operations.push({ kind: pattern.kind, args: match.slice(1) });
                index = end;
                found = true;
                break;
            }
            if (!found) throw new Error('Chưa hỗ trợ script event tại ký tự ' + index);
        }
        // Xác thực xong toàn bộ đoạn mới bắt đầu thay đổi trạng thái.
        for (const operation of operations) {
            const [id, value, imageIndex] = operation.args;
            if (operation.kind === 'disableTouch') {
                scene.input.pointerEnabled = false;
                scene.input.clearFrame();
            } else if (operation.kind === 'switch') scene.game.flags['switch:' + Number(id)] = value === 'true';
            else if (operation.kind === 'variable') scene.game.flags['variable:' + Number(id)] = Number(value);
            else if (operation.kind === 'refresh') scene.loadActorImages(scene.game.player);
            else {
                const actor = scene.eventActor(Number(id));
                if (!actor) continue;
                const name = value.slice(1, -1);
                if (operation.kind === 'character') {
                    actor.characterName = name;
                    actor.characterIndex = Number(imageIndex);
                }
                if (operation.kind === 'face') {
                    actor.faceName = name;
                    actor.faceIndex = Number(imageIndex);
                    actor.portrait = 'pictures/' + name + '_' + (Number(imageIndex) + 1);
                }
                if (operation.kind === 'battler') actor.battlerName = name;
            }
        }
    };
})();
