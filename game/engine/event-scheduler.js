'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FNHStandaloneScheduler = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function EventScheduler(engine, handlers, onError) {
        this.engine = engine;
        this.handlers = handlers || {};
        this.onError = onError || function (error) { console.error(error); };
        this.map = null;
        this.parallel = new Map();
        this.failedPages = new Set();
        this.autorun = null;
        this.enabled = true;
    }
    EventScheduler.prototype.stop = function () {
        this.enabled = false;
        this.parallel.forEach(function (job) { job.controller.abort(); });
        this.parallel.clear();
        if (this.autorun) this.autorun.controller.abort();
    };
    EventScheduler.prototype.tick = function () {
        if (!this.enabled || !this.engine.map) return;
        var engine = this.engine, scheduler = this;
        if (this.map !== engine.map) {
            this.parallel.forEach(function (job) { job.controller.abort(); });
            this.parallel.clear();
            this.failedPages.clear();
            this.map = engine.map;
        }
        this.parallel.forEach(function (job, event) {
            if (job.common ? !engine.state.switchValue(event.switchId) : scheduler.map.eventPage(event) !== job.page) {
                job.controller.abort(); scheduler.parallel.delete(event);
            }
        });
        function start(event, page, common) {
            if (!page || scheduler.failedPages.has(page)) return;
            var trigger = common ? (event.trigger === 1 ? 3 : 4) : page.trigger;
            if (trigger === 3 && !engine.eventRunning && !engine.stepRunning && !scheduler.autorun) {
                var foreground = { page: page, controller: new AbortController() };
                scheduler.autorun = foreground;
                engine.eventRunning = true;
                var interpreter = common ? engine.commonInterpreterFor(event.id, scheduler.handlers, foreground.controller.signal) :
                    engine.interpreterFor(event.id, scheduler.handlers, foreground.controller.signal);
                interpreter.run().catch(function (error) {
                    if (error.name !== 'AbortError') { scheduler.failedPages.add(page); scheduler.onError(error); }
                }).finally(function () {
                    if (scheduler.autorun === foreground) { scheduler.autorun = null; engine.eventRunning = false; }
                });
            }
            if (trigger === 4 && !scheduler.parallel.has(event)) {
                var controller = new AbortController();
                var job = { page: page, controller: controller, common: common };
                scheduler.parallel.set(event, job);
                var background = common ? engine.commonInterpreterFor(event.id, scheduler.handlers, controller.signal) :
                    engine.interpreterFor(event.id, scheduler.handlers, controller.signal);
                background.run().catch(function (error) {
                    if (error.name !== 'AbortError') { scheduler.failedPages.add(page); scheduler.onError(error); }
                }).finally(function () {
                    if (scheduler.parallel.get(event) === job) scheduler.parallel.delete(event);
                });
            }
        }
        this.map.events.forEach(function (event) {
            var page = scheduler.map.eventPage(event);
            start(event, page, false);
        });
        (engine.database.CommonEvents || []).forEach(function (event) {
            if (event && event.trigger && engine.state.switchValue(event.switchId)) start(event, event, true);
        });
    };
    return { EventScheduler: EventScheduler };
}));
