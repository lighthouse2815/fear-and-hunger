'use strict';
/* ============================================================
   FNH Engine — nạp và giải mã asset RPG Maker MV
   - .rpgmvp / .rpgmvo: bỏ 16 byte header giả, XOR 16 byte đầu.
   - Không dùng Decrypter của RPG Maker MV.
   ============================================================ */
(function () {
    const FNH = window.FNH = window.FNH || {};

    FNH.AssetLoader = class AssetLoader {
        constructor(options) {
            const opts = options || {};
            this.root = opts.root || '/game/';
            this.system = null;
            this.key = null;
            this.imageCache = new Map();
            this.imagePending = new Map();
            this.audioDataCache = new Map();
            this.audioBufferCache = new Map();
            this.audioPending = new Map();
            this.jsonCache = new Map();
            this.loadedImages = 0;
            this.loadedAudio = 0;
        }

        async init() {
            this.system = await this.fetchJson('data/System.json');
            const key = String(this.system.encryptionKey || '');
            if (!/^[0-9a-fA-F]{32}$/.test(key)) {
                throw new Error('System.json không có encryptionKey hợp lệ.');
            }
            this.key = new Uint8Array(key.match(/.{2}/g).map(function (part) {
                return parseInt(part, 16);
            }));
            return this.system;
        }

        assetPath(rel, extension) {
            return this.root + String(rel).replace(/^\/+/, '') + extension;
        }

        imagePath(rel, extension) {
            return this.root + 'img/' + String(rel).replace(/^\/+/, '') + extension;
        }

        audioPath(rel, extension) {
            return this.root + 'audio/' + String(rel).replace(/^\/+/, '') + extension;
        }

        async fetchJson(rel) {
            if (this.jsonCache.has(rel)) return this.jsonCache.get(rel);
            const response = await fetch(this.assetPath(rel, ''), { cache: 'no-store' });
            if (!response.ok) throw new Error('Không đọc được ' + rel + ' (' + response.status + ').');
            const json = await response.json();
            this.jsonCache.set(rel, json);
            return json;
        }

        imageExtension(plain) {
            return plain ? '.png' : (this.system && this.system.hasEncryptedImages ? '.rpgmvp' : '.png');
        }

        audioExtension(plain) {
            return plain ? '.ogg' : (this.system && this.system.hasEncryptedAudio ? '.rpgmvo' : '.ogg');
        }

        decrypt(arrayBuffer) {
            const bytes = new Uint8Array(arrayBuffer);
            if (bytes.length >= 8 &&
                bytes[0] === 0x89 && bytes[1] === 0x50 &&
                bytes[2] === 0x4e && bytes[3] === 0x47) {
                return arrayBuffer;
            }
            if (bytes.length >= 4 &&
                bytes[0] === 0x4f && bytes[1] === 0x67 &&
                bytes[2] === 0x67 && bytes[3] === 0x53) {
                return arrayBuffer;
            }
            if (bytes.length <= 16) {
                throw new Error('Tệp mã hoá không hợp lệ.');
            }
            const data = new Uint8Array(bytes.slice(16));
            for (let i = 0; i < 16 && i < data.length; i += 1) {
                data[i] ^= this.key[i];
            }
            return data.buffer;
        }

        async fetchAsset(url) {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) {
                const error = new Error('Không đọc được ' + url + ' (' + response.status + ').');
                error.status = response.status;
                throw error;
            }
            return response.arrayBuffer();
        }

        async loadImage(rel, options) {
            const opts = options || {};
            const cacheKey = rel + (opts.plain ? '|plain' : '');
            if (this.imageCache.has(cacheKey)) return this.imageCache.get(cacheKey);
            if (this.imagePending.has(cacheKey)) return this.imagePending.get(cacheKey);

            const promise = (async () => {
                let buffer;
                try {
                    buffer = await this.fetchAsset(this.imagePath(rel, this.imageExtension(opts.plain)));
                } catch (error) {
                    if (!opts.plain && error.status === 404) {
                        buffer = await this.fetchAsset(this.imagePath(rel, '.png'));
                    } else {
                        throw error;
                    }
                }
                const decrypted = this.decrypt(buffer);
                const blob = new Blob([decrypted], { type: opts.mime || 'image/png' });
                const objectUrl = URL.createObjectURL(blob);
                try {
                    const image = new Image();
                    image.decoding = 'async';
                    await new Promise(function (resolve, reject) {
                        image.onload = resolve;
                        image.onerror = function () {
                            reject(new Error('Không giải mã được ảnh ' + rel + '.'));
                        };
                        image.src = objectUrl;
                    });
                    this.imageCache.set(cacheKey, image);
                    this.loadedImages += 1;
                    return image;
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            })();

            this.imagePending.set(cacheKey, promise);
            try {
                return await promise;
            } finally {
                this.imagePending.delete(cacheKey);
            }
        }

        async loadAudioData(rel) {
            if (this.audioDataCache.has(rel)) return this.audioDataCache.get(rel);
            const buffer = await this.fetchAsset(this.audioPath(rel, this.audioExtension(false)));
            const decrypted = this.decrypt(buffer);
            this.audioDataCache.set(rel, decrypted);
            this.loadedAudio += 1;
            return decrypted;
        }

        async decodeAudio(rel, context) {
            if (!context) throw new Error('Web Audio chưa được mở khoá.');
            if (this.audioBufferCache.has(rel)) return this.audioBufferCache.get(rel);
            if (this.audioPending.has(rel)) return this.audioPending.get(rel);

            const promise = (async () => {
                const data = await this.loadAudioData(rel);
                const buffer = await new Promise(function (resolve, reject) {
                    context.decodeAudioData(data.slice(0), resolve, reject);
                });
                this.audioBufferCache.set(rel, buffer);
                return buffer;
            })();

            this.audioPending.set(rel, promise);
            try {
                return await promise;
            } finally {
                this.audioPending.delete(rel);
            }
        }

        async preloadImages(list, onProgress) {
            let done = 0;
            const total = list.length;
            await Promise.all(list.map(async (item) => {
                const rel = typeof item === 'string' ? item : item.rel;
                const opts = typeof item === 'string' ? undefined : item;
                try {
                    await this.loadImage(rel, opts);
                } catch (error) {
                    console.warn('[FNH] Bỏ qua ảnh không nạp được:', rel, error.message);
                }
                done += 1;
                if (onProgress) onProgress(done, total);
            }));
        }
    };
})();
