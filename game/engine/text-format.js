'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneText = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function resolveText(source, state, preserveColors) {
        var text = String(source || '').replace(/\\\\/g, '\u0000');
        for (var pass = 0; pass < 2; pass++) text = text.replace(/\\V\[(\d+)\]/gi, function (_, id) {
            return state.variableValue(Number(id));
        });
        text = text.replace(/\\([NP])\[(\d+)\]/gi, function (_, type, id) {
            var actorId = type.toUpperCase() === 'P' ? state.party[Number(id) - 1] : Number(id);
            var actor = actorId > 0 ? state.actor(actorId) : null;
            return actor ? actor.name : '';
        });
        text = text.replace(/\\G\b/gi, (state.database && state.database.System && state.database.System.currencyUnit) || '')
            .replace(/<\/?WordWrap>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n').replace(/\\[.!|^><{}]/g, '');
        return preserveColors ? text : text.replace(/\\C\[\d+\]/gi, '');
    }
    function formatText(source, state) { return resolveText(source, state).replace(/\u0000/g, '\\'); }
    function formatParts(source, state) {
        var text = resolveText(source, state, true), parts = [], pattern = /\\([IC])\[(\d+)\]/gi, match, start = 0;
        while ((match = pattern.exec(text))) {
            if (match.index > start) parts.push(text.slice(start, match.index).replace(/\u0000/g, '\\'));
            parts.push(match[1].toUpperCase() === 'I' ? { icon: Number(match[2]) } : { color: Number(match[2]) });
            start = pattern.lastIndex;
        }
        if (start < text.length) parts.push(text.slice(start).replace(/\u0000/g, '\\'));
        return parts;
    }
    return { formatText: formatText, formatParts: formatParts };
}));
