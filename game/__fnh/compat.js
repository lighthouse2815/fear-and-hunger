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

    // Giữ hội thoại ở đáy vùng game, kể cả event gốc yêu cầu đặt giữa.
    // Dùng vị trí của runtime để cửa sổ lựa chọn và tên nhân vật đi cùng hộp thoại.
    Game_Message.prototype.positionType = function () { return 2; };

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

    // Cài đặt âm thanh dùng ConfigManager gốc để đồng bộ với menu Options và save.
    window.addEventListener('load', function () {
        // Giới hạn tại đầu ra, kể cả khi plugin hoặc cấu hình cũ tăng master.
        var masterVolume = Object.getOwnPropertyDescriptor(AudioManager, 'masterVolume');
        Object.defineProperty(AudioManager, 'masterVolume', {
            get: masterVolume.get,
            set: function (value) {
                masterVolume.set.call(this, Math.max(0, Math.min(0.05, Number(value) || 0)));
            },
            configurable: true
        });
        AudioManager.masterVolume = AudioManager.masterVolume;
        // OptionsCore nạp cấu hình sau lớp gốc. Chuẩn hóa sau tất cả plugin,
        // gồm masterVolume dùng cho video; chỉ nâng cấp cấu hình cũ một lần.
        var applyData = ConfigManager.applyData, makeData = ConfigManager.makeData;
        ConfigManager.makeData = function () {
            var config = makeData.call(this);
            config.fnhQuietVolumeApplied = true;
            return config;
        };
        ConfigManager.applyData = function (config) {
            applyData.call(this, config);
            if (config.fnhQuietVolumeApplied !== true) {
                ['masterVolume', 'bgmVolume', 'bgsVolume', 'meVolume', 'seVolume'].forEach(function (key) {
                    ConfigManager[key] = Math.min(Number(ConfigManager[key]) || 0, 5);
                });
                this.save();
            }
        };
        var viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) viewport.content = 'width=device-width, initial-scale=1';
        var style = document.createElement('style');
        style.textContent =
            '#fnh-audio-button,#fnh-audio-settings{color:#e7ddca;background:#17120f;border:1px solid #8c7759;font:14px/1.5 system-ui,sans-serif}' +
            '#fnh-audio-button{position:fixed;top:12px;right:12px;z-index:20;padding:9px 14px;cursor:pointer;border-radius:4px}' +
            '#fnh-audio-settings{width:360px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);box-sizing:border-box;padding:24px;border-radius:6px;overflow:auto;box-shadow:0 20px 70px #000}' +
            '#fnh-audio-settings::backdrop{background:rgba(0,0,0,.65)}' +
            '#fnh-audio-settings header,#fnh-audio-settings label{display:flex;align-items:center;justify-content:space-between;gap:16px}' +
            '#fnh-audio-settings h2{font:24px Georgia,serif;margin:0}' +
            '#fnh-audio-settings p{color:#b8aa95;margin:12px 0 22px}' +
            '#fnh-audio-settings .fnh-volume-row{margin-top:18px}' +
            '#fnh-audio-settings input{width:100%;margin:12px 0 0;accent-color:#c8ac7c;cursor:pointer}' +
            '#fnh-audio-settings output{color:#c8ac7c;font-variant-numeric:tabular-nums}' +
            '#fnh-audio-settings button{background:transparent;color:#e7ddca;border:1px solid #8c7759;border-radius:3px;padding:6px 10px;cursor:pointer}' +
            '#fnh-audio-button:focus-visible,#fnh-audio-settings :focus-visible{outline:2px solid #e7ddca;outline-offset:3px}';
        document.head.appendChild(style);
        var button = document.createElement('button');
        button.id = 'fnh-audio-button';
        button.type = 'button';
        button.textContent = '⚙ Cài đặt';
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', 'fnh-audio-settings');
        var panel = document.createElement('dialog');
        panel.id = 'fnh-audio-settings';
        panel.setAttribute('aria-labelledby', 'fnh-audio-title');
        panel.innerHTML = '<header><h2 id="fnh-audio-title">Âm thanh</h2>' +
            '<button type="button" aria-label="Đóng cài đặt">Đóng ×</button></header>' +
            '<p>Thay đổi có hiệu lực ngay và được tự động lưu.</p>';
        var volumes = [
            ['bgmVolume', 'Nhạc nền'], ['bgsVolume', 'Âm thanh môi trường'],
            ['meVolume', 'Nhạc sự kiện'], ['seVolume', 'Hiệu ứng']
        ];
        if (typeof ConfigManager.masterVolume === 'number') volumes.unshift(['masterVolume', 'Âm lượng tổng']);
        volumes.forEach(function (entry) {
            var key = entry[0], row = document.createElement('div');
            row.className = 'fnh-volume-row';
            row.innerHTML = '<label for="fnh-' + key + '">' + entry[1] +
                '<output for="fnh-' + key + '"></output></label>' +
                '<input id="fnh-' + key + '" type="range" min="0" max="' + (key === 'masterVolume' ? 5 : 100) + '" step="1">';
            var slider = row.querySelector('input'), output = row.querySelector('output');
            slider.addEventListener('input', function () {
                ConfigManager[key] = Number(slider.value);
                output.value = slider.value + '%';
            });
            slider.addEventListener('change', function () { ConfigManager.save(); });
            panel.appendChild(row);
        });
        document.body.appendChild(button);
        document.body.appendChild(panel);
        function clearGameInput() { Input.clear(); TouchInput.clear(); }
        button.addEventListener('click', function () {
            volumes.forEach(function (entry) {
                var slider = panel.querySelector('#fnh-' + entry[0]);
                slider.value = ConfigManager[entry[0]];
                slider.parentNode.querySelector('output').value = slider.value + '%';
            });
            clearGameInput();
            panel.showModal();
        });
        panel.querySelector('button').addEventListener('click', function () { panel.close(); });
        panel.addEventListener('close', function () {
            ConfigManager.save();
            clearGameInput();
            // Dialog mặc định trả focus về nút mở; bàn phím cần trở lại khung game.
            if (Graphics._canvas) {
                Graphics._canvas.tabIndex = -1;
                Graphics._canvas.focus({ preventScroll: true });
            }
        });
        // Phím và thao tác chỉnh thanh âm lượng chỉ tác động tới cài đặt.
        [button, panel].forEach(function (element) {
            ['keydown', 'keyup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'wheel', 'contextmenu'].forEach(function (type) {
                element.addEventListener(type, function (event) { event.stopPropagation(); });
            });
        });
        // Giữ nguyên scene và tạm dừng gameplay trong lúc chỉnh âm thanh.
        var updateScene = SceneManager.updateScene;
        SceneManager.updateScene = function () {
            if (!panel.open) updateScene.call(this);
        };
    });

    // Cho phép test/người dùng kiểm tra nhanh trạng thái âm thanh.
    window.FNHBrowser.audioState = function () {
        if (typeof WebAudio === 'undefined' || !WebAudio._context) return 'uninitialized';
        return WebAudio._context.state;
    };
})();
