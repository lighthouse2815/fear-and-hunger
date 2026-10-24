'use strict';
/* ============================================================
   Fear & Hunger — lớp tương thích trình duyệt
   Được server chèn vào index.html gốc, sau plugins.js và trước main.js.
   Không sửa thư mục game; chỉ vô hiệu hoá phần chỉ chạy trên NW.js/Steam.
   ============================================================ */
(function () {
    if (window.__FNH_BROWSER_COMPAT__) return;
    window.__FNH_BROWSER_COMPAT__ = true;

    var params = new URLSearchParams(window.location.search);
    var skipPretitle = params.get('fnh_skip_pretitle') === '1';
    var saveNamespace = params.get('fnh_save_ns') || '';
    var overlay = null;
    var startRequested = false;
    var gameStarted = false;
    var pendingRun = null;

    // ---------------------------------------------------------
    // 1. Tắt plugin chỉ dành cho NW.js/Steam trước khi main.js nạp chúng.
    //    Các lệnh plugin "steamworks ..." trong dữ liệu sẽ tự động thành no-op.
    // ---------------------------------------------------------
    var disabledPlugins = [];
    if (Array.isArray(window.$plugins)) {
        window.$plugins.forEach(function (plugin) {
            if (/steamworks|greenworks/i.test(plugin.name)) {
                plugin.status = false;
                disabledPlugins.push(plugin.name);
            }
        });
    }

    // Trình duyệt không có require/process, nhưng chặn luôn trường hợp extension
    // hoặc môi trường nhúng vô tình cung cấp hai biến đó.
    if (typeof Utils !== 'undefined') {
        Utils.isNwjs = function () { return false; };
    }

    // ---------------------------------------------------------
    // 2. Không gian lưu tuỳ chọn (dùng cho test, tránh đụng save thật).
    // ---------------------------------------------------------
    var storagePrefix = '';
    if (typeof StorageManager !== 'undefined' && saveNamespace) {
        storagePrefix = 'FNH_WEB:' + saveNamespace + ':';
        var originalWebStorageKey = StorageManager.webStorageKey;
        StorageManager.webStorageKey = function (savefileId) {
            return storagePrefix + originalWebStorageKey.call(this, savefileId);
        };
    }

    window.FNHBrowser = {
        version: '1.4.1',
        disabledPlugins: disabledPlugins,
        storagePrefix: storagePrefix,
        skipPretitle: skipPretitle
    };

    // ---------------------------------------------------------
    // 3. Mở khoá Web Audio bằng một tương tác thật của người dùng.
    //    Chrome chặn AudioContext chạy trước gesture; NW.js thì không.
    // ---------------------------------------------------------
    function unlockAudio() {
        if (typeof WebAudio === 'undefined') return;
        if (typeof Utils !== 'undefined' && Utils.isOptionValid && Utils.isOptionValid('noaudio')) {
            return;
        }
        try {
            if (!WebAudio._initialized) {
                WebAudio.initialize();
            }
            var context = WebAudio._context;
            if (context && context.state === 'suspended' && context.resume) {
                context.resume().catch(function () {});
            }
        } catch (error) {
            console.warn('[FNH] Không khởi tạo được Web Audio:', error);
        }
    }

    ['pointerdown', 'keydown', 'touchstart', 'touchend'].forEach(function (type) {
        document.addEventListener(type, unlockAudio, true);
    });

    // ---------------------------------------------------------
    // 4. Màn hình bắt đầu: tạo gesture trước khi engine chạy để âm thanh
    //    và video intro không bị trình duyệt chặn.
    // ---------------------------------------------------------
    function createOverlay() {
        if (overlay) return overlay;

        var node = document.createElement('div');
        node.id = 'fnh-start-overlay';
        node.setAttribute('role', 'dialog');
        node.setAttribute('aria-modal', 'true');
        node.setAttribute('aria-label', 'Bắt đầu Fear and Hunger');
        node.innerHTML =
            '<div class="fnh-start-card">' +
                '<div class="fnh-start-kicker">BẢN CHẠY TRÊN TRÌNH DUYỆT</div>' +
                '<h1>FEAR &amp; HUNGER</h1>' +
                '<p class="fnh-start-lead">Nhấn nút bên dưới để bắt đầu. Một lần tương tác là đủ ' +
                    'để trình duyệt cho phép âm thanh và video.</p>' +
                '<button id="fnh-start-button" type="button">BẮT ĐẦU</button>' +
                '<p class="fnh-start-note">Tiến trình được lưu trong localStorage của trình duyệt. ' +
                    'Không có dữ liệu nào được tải lên mạng.</p>' +
                '<p class="fnh-start-note fnh-start-small">Bản quyền trò chơi thuộc nhà phát triển gốc. ' +
                    'Thư mục game không nằm trong Git.</p>' +
            '</div>';
        node.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:2147483647',
            'display:flex', 'align-items:center', 'justify-content:center',
            'background:radial-gradient(circle at 50% 35%, #211a16 0%, #070605 62%, #000 100%)',
            'color:#e7ddca', 'font-family:Georgia, "Times New Roman", serif',
            'text-align:center', 'padding:24px', 'box-sizing:border-box'
        ].join(';');

        var style = document.createElement('style');
        style.textContent =
            '#fnh-start-overlay .fnh-start-card{max-width:560px;width:100%;padding:38px 34px;' +
            'border:1px solid rgba(185,157,113,.35);background:rgba(10,8,7,.78);' +
            'box-shadow:0 24px 80px rgba(0,0,0,.75), inset 0 0 50px rgba(90,25,18,.14)}' +
            '#fnh-start-overlay .fnh-start-kicker{font:600 11px/1.4 system-ui,sans-serif;' +
            'letter-spacing:.32em;color:#b99d71;margin-bottom:18px}' +
            '#fnh-start-overlay h1{font-size:clamp(34px,6vw,58px);line-height:1;margin:0 0 22px;' +
            'font-weight:400;letter-spacing:.08em;color:#efe3cc;text-shadow:0 2px 24px rgba(120,20,20,.35)}' +
            '#fnh-start-overlay .fnh-start-lead{font:400 15px/1.65 system-ui,sans-serif;' +
            'color:#c7b9a3;margin:0 auto 26px;max-width:430px}' +
            '#fnh-start-overlay #fnh-start-button{cursor:pointer;border:1px solid #b99d71;' +
            'background:linear-gradient(#4b201a,#2a100d);color:#f3e7d0;padding:14px 42px;' +
            'font:600 14px/1 system-ui,sans-serif;letter-spacing:.22em;transition:filter .15s,transform .15s}' +
            '#fnh-start-overlay #fnh-start-button:hover{filter:brightness(1.25)}' +
            '#fnh-start-overlay #fnh-start-button:active{transform:translateY(1px)}' +
            '#fnh-start-overlay #fnh-start-button:focus-visible{outline:2px solid #e7ddca;outline-offset:4px}' +
            '#fnh-start-overlay .fnh-start-note{font:400 12px/1.55 system-ui,sans-serif;' +
            'color:#8e8272;margin:24px auto 0;max-width:420px}' +
            '#fnh-start-overlay .fnh-start-small{font-size:11px;color:#615a50;margin-top:10px}' +
            '#fnh-start-overlay.is-loading #fnh-start-button{opacity:.55;pointer-events:none}' +
            '#fnh-start-overlay.is-loading .fnh-start-lead::after{content:" Đang tải dữ liệu…"}';

        document.head.appendChild(style);
        document.body.appendChild(node);

        node.querySelector('#fnh-start-button').addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            requestStart();
        });

        node.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                event.preventDefault();
                event.stopPropagation();
                requestStart();
            }
        });

        // Phím tắt vẫn hoạt động khi người dùng lỡ bấm ra ngoài nút.
        document.addEventListener('keydown', function (event) {
            if (!overlay || overlay.style.display === 'none') return;
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                event.preventDefault();
                requestStart();
            }
        }, true);

        overlay = node;
        return node;
    }

    function showOverlay(loading) {
        var node = createOverlay();
        node.style.display = 'flex';
        node.classList.toggle('is-loading', !!loading);
        var button = node.querySelector('#fnh-start-button');
        if (button && !loading && document.activeElement !== button) {
            button.focus({ preventScroll: true });
        }
    }

    function hideOverlay() {
        if (!overlay) return;
        if (overlay.contains(document.activeElement)) document.activeElement.blur();
        overlay.style.display = 'none';
    }

    function requestStart() {
        if (startRequested || gameStarted) return;
        startRequested = true;
        unlockAudio();

        if (pendingRun) {
            var run = pendingRun;
            pendingRun = null;
            gameStarted = true;
            hideOverlay();
            run();
        } else {
            // Trang chưa tải xong: giữ overlay nhưng đổi sang trạng thái chờ.
            showOverlay(true);
        }
    }

    // ---------------------------------------------------------
    // 5. Hoãn SceneManager.run cho đến khi người dùng bấm bắt đầu.
    // ---------------------------------------------------------
    if (typeof SceneManager !== 'undefined' && typeof SceneManager.run === 'function') {
        var originalRun = SceneManager.run;
        SceneManager.run = function (sceneClass) {
            if (gameStarted) {
                return originalRun.call(this, sceneClass);
            }
            pendingRun = function () {
                originalRun.call(SceneManager, sceneClass);
            };
            if (startRequested) {
                var run = pendingRun;
                pendingRun = null;
                gameStarted = true;
                hideOverlay();
                run();
            } else {
                showOverlay(false);
            }
        };
    }

    // ---------------------------------------------------------
    // 6. Tiện ích bổ sung cho môi trường web.
    // ---------------------------------------------------------
    // Video intro có âm thanh: nếu autoplay vẫn bị chặn, thử lại ở tương tác kế tiếp.
    if (typeof Graphics !== 'undefined' && Graphics._onVideoLoad) {
        Graphics._onVideoLoad = function () {
            this._updateVisibility(true);
            this._videoLoading = false;
            var video = this._video;
            if (!video) return;
            var playPromise = null;
            try {
                playPromise = video.play();
            } catch (error) {
                playPromise = null;
            }
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(function () {
                    var retry = function () {
                        try { video.play(); } catch (error) {}
                    };
                    document.addEventListener('pointerdown', retry, { once: true, capture: true });
                    document.addEventListener('keydown', retry, { once: true, capture: true });
                });
            }
        };
    }

    // Trên web, window.close() thường bị chặn nếu tab không do script mở.
    if (typeof SceneManager !== 'undefined' && SceneManager.terminate) {
        SceneManager.terminate = function () {
            try { window.close(); } catch (error) {}
            if (document.getElementById('fnh-exit-overlay')) return;
            var node = document.createElement('div');
            node.id = 'fnh-exit-overlay';
            node.style.cssText = [
                'position:fixed', 'inset:0', 'z-index:2147483646', 'display:flex',
                'align-items:center', 'justify-content:center', 'background:#000',
                'color:#e7ddca', 'font:16px/1.6 system-ui,sans-serif', 'text-align:center',
                'padding:24px'
            ].join(';');
            node.innerHTML = '<div><p>Trò chơi đã kết thúc.</p>' +
                '<p style="color:#8e8272;font-size:13px">Bạn có thể đóng tab này.</p></div>';
            document.body.appendChild(node);
        };
    }

    // ---------------------------------------------------------
    // 7. Bỏ qua màn hình pre-title khi test (không ảnh hưởng chạy thường).
    // ---------------------------------------------------------
    window.addEventListener('load', function () {
        if (skipPretitle && window.TH && window.TH.PreTitleEvents) {
            window.TH.PreTitleEvents.ShownOnce = true;
        }
    });

    // Hiện overlay ngay khi DOM sẵn sàng, kể cả trước khi window.load.
    function bootOverlay() {
        if (!gameStarted && !startRequested) showOverlay(false);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootOverlay, { once: true });
    } else {
        bootOverlay();
    }

    // Cho phép test/người dùng kiểm tra nhanh trạng thái âm thanh.
    window.FNHBrowser.audioState = function () {
        if (typeof WebAudio === 'undefined' || !WebAudio._context) return 'uninitialized';
        return WebAudio._context.state;
    };
})();
