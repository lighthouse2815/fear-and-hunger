'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneText = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function formatText(source, state) {
        var text = String(source || '').replace(/\\\\/g, '\u0000');
        for (var pass = 0; pass < 2; pass++) text = text.replace(/\\V\[(\d+)\]/gi, function (_, id) {
            return state.variableValue(Number(id));
        });
        text = text.replace(/\\([NP])\[(\d+)\]/gi, function (_, type, id) {
            var actorId = type.toUpperCase() === 'P' ? state.party[Number(id) - 1] : Number(id);
            var actor = actorId > 0 ? state.actor(actorId) : null;
            return actor ? actor.name : '';
        });
        return text.replace(/\\G\b/gi, (state.database && state.database.System && state.database.System.currencyUnit) || '')
            .replace(/\\C\[\d+\]/gi, '').replace(/<\/?WordWrap>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n').replace(/\\[.!|^><{}]/g, '').replace(/\u0000/g, '\\');
    }
    return { formatText: formatText };
}));
