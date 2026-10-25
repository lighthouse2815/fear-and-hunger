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
    var skipPretitle = params.get('fnh_skip_pretitle') !== '0';
    var saveNamespace = params.get('fnh_save_ns') || '';

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
    // 4. Tiện ích bổ sung cho môi trường web.
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
    // 5. Vào thẳng menu; dùng ?fnh_skip_pretitle=0 để xem pre-title gốc.
    // ---------------------------------------------------------
    window.addEventListener('load', function () {
        if (skipPretitle && window.TH && window.TH.PreTitleEvents) {
            window.TH.PreTitleEvents.ShownOnce = true;
        }
    });

    // Cho phép test/người dùng kiểm tra nhanh trạng thái âm thanh.
    window.FNHBrowser.audioState = function () {
        if (typeof WebAudio === 'undefined' || !WebAudio._context) return 'uninitialized';
        return WebAudio._context.state;
    };
})();
