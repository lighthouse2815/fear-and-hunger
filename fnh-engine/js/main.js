'use strict';
/* ============================================================
   FNH Engine — khởi động ứng dụng
   ============================================================ */
(function () {
    const FNH = window.FNH = window.FNH || {};

    function boot() {
        const canvas = document.getElementById('fnh-canvas');
        const overlay = document.getElementById('fnh-engine-overlay');
        const startButton = document.getElementById('fnh-engine-start');
        const progress = document.getElementById('fnh-engine-progress');
        const progressBar = document.getElementById('fnh-engine-progress-bar');
        const status = document.getElementById('fnh-engine-status');

        if (!canvas || !overlay || !startButton) return;

        const game = new FNH.Game(canvas);
        window.FNH.game = game;
        let starting = false;

        function setStatus(message, isError) {
            if (!status) return;
            status.textContent = message;
            status.classList.toggle('is-error', !!isError);
        }

        function setProgress(done, total) {
            if (!progressBar) return;
            const ratio = total > 0 ? done / total : 0;
            progressBar.style.width = Math.round(ratio * 100) + '%';
        }

        startButton.addEventListener('click', async function () {
            if (starting) return;
            starting = true;
            startButton.disabled = true;
            overlay.classList.add('is-loading');
            if (progress) progress.hidden = false;
            setStatus('Đang mở khoá âm thanh…');

            try {
                try {
                    await game.audio.unlock();
                } catch (error) {
                    console.warn('[FNH] Không mở khoá được Web Audio:', error.message);
                }

                try {
                    await document.fonts.load('16px "FNH Serif"');
                } catch (error) {}

                setStatus('Đang đọc dữ liệu gốc…');
                await game.boot(function (done, total, rel) {
                    setProgress(done, total);
                    setStatus('Đang nạp tài nguyên ' + done + '/' + total + ' · ' + rel);
                });

                setStatus('Đang dựng ngục địa…');
                setProgress(1, 1);
                overlay.classList.add('is-hidden');
                game.start();
                window.setTimeout(function () {
                    overlay.style.display = 'none';
                }, 700);
            } catch (error) {
                console.error('[FNH] Không khởi động được engine:', error);
                starting = false;
                startButton.disabled = false;
                startButton.textContent = 'THỬ LẠI';
                overlay.classList.remove('is-hidden');
                overlay.classList.remove('is-loading');
                if (progress) progress.hidden = true;
                setStatus('Không khởi động được: ' + error.message, true);
            }
        });

        overlay.addEventListener('pointerdown', function () {
            if (overlay.classList.contains('is-hidden')) return;
            canvas.focus();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
