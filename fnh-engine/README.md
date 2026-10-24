# FNH Engine — engine web độc lập cho Fear & Hunger 1.4.1

Đây là một **engine web viết mới**, đọc trực tiếp dữ liệu, hình ảnh và âm thanh từ thư mục
`www` của bản **Fear & Hunger 1.4.1** mà bạn sở hữu. Engine không chạy runtime RPG Maker
MV, không dùng `rpg_core.js`/`rpg_managers.js`, và không sao chép asset vào repo.

Bản dựng hiện tại là một **vertical slice** chơi được:

```text
Màn hình tiêu đề
  → tạo nhân vật (4 nghề)
  → bản đồ 1 (hành lang phía Đông)
  → gặp Guard
  → trận đấu theo lượt
  → thắng / thua / bỏ chạy
  → lưu và đọc game
```

Đây chưa phải bản chuyển toàn bộ game. Xem [Phạm vi](#phạm-vi) và
[Giới hạn](#giới-hạn) bên dưới.

Mục tiêu phát triển là chuyển toàn bộ game gốc sang engine web độc lập. Có thể kiểm kê
dữ liệu cài đặt để xác định phạm vi cần hỗ trợ:

```sh
npm run audit:fnh-engine
npm run audit:fnh-engine -- --game "/đường/dẫn/tới/www"
```

Công cụ chỉ đọc và xuất thống kê JSON: bản đồ, trang event, common event, battle event,
loại lệnh/điều kiện/toán hạng và tên plugin đang bật. Không chạy mã plugin, không xuất
lời thoại, tham số plugin hoặc sao chép asset. Thống kê dữ liệu đầu vào **không phải**
phần trăm hoàn thành hay bằng chứng các tính năng đã tương thích.

Bản cài 1.4.1 hiện được kiểm tra có 169 bản đồ, 27.715 event, 61.536 trang event bản đồ,
315 common event, 220 troop, 2.404 trang battle event, 89 loại lệnh trên cả ba nguồn và
48 plugin đang bật. Để xác nhận hoàn thành cần kiểm chứng cả luồng chơi và kết quả
của các hệ thống dưới đây với bản gốc:

| Hệ thống | Trạng thái hiện tại |
| --- | --- |
| Asset, nhạc, tạo nhân vật, lưu/đọc | Có trong bản chơi thử, cần kiểm chứng toàn bộ nội dung |
| Bản đồ | Nạp JSON và một phần tileset; còn autotile, event di chuyển, va chạm và môi trường |
| Event | Có interpreter cơ bản; còn nhiều lệnh, autorun, parallel, script và plugin |
| Hội thoại | Có nội dung nhiều dòng và lựa chọn; còn định dạng, chân dung, điều kiện lựa chọn plugin |
| Chiến đấu | Chỉ trận Guard đơn giản; chưa có mô hình và công thức đầy đủ của game gốc |
| Nhân vật, tổ đội, kỹ năng, trang bị | Chưa tương thích đầy đủ |
| Đói, tinh thần, trạng thái, bộ phận cơ thể | Chưa tương thích đầy đủ |
| Cốt truyện, kết thúc, các chế độ chơi | Chưa kiểm chứng xuyên suốt |
| Plugin, hiệu ứng, video, giao diện và âm thanh theo vị trí | Chưa tương thích đầy đủ |

> **Quan trọng:** repo không chứa asset của Fear & Hunger. Thư mục
> `Fear.and.Hunger.v1.4.1/` đã nằm trong `.gitignore`. Bạn cần tự mua/sở hữu bản game gốc.

## Yêu cầu

- **Node.js 18+** để chạy máy chủ (chỉ dùng module có sẵn của Node).
- **Node.js 22+** nếu chạy smoke test trình duyệt, vì bài test dùng `WebSocket` toàn cục.
- **Chrome/Chromium** cho bài test tự động. Trình duyệt hiện đại có Canvas 2D và Web Audio
  để chơi thủ công.
- Thư mục game gốc đặt đúng vị trí mặc định:

  ```text
  Fear.and.Hunger.v1.4.1/
    Fear.and.Hunger.v1.4.1/
      www/
        data/
        img/
        audio/
        fonts/
  ```

  Có thể trỏ tới thư mục `www` ở nơi khác bằng `--game` hoặc `FNH_GAME_ROOT`.

## Chạy

Từ thư mục repo:

```sh
npm run fnh:engine        # http://127.0.0.1:8139/
npm run fnh:engine:open   # tự mở trình duyệt
```

Bấm **BẮT ĐẦU** trên overlay. Thao tác này vừa mở khoá Web Audio vừa bắt đầu nạp asset;
trình duyệt chỉ cho phép âm thanh phát sau một tương tác thật của người dùng.

Chạy trực tiếp máy chủ:

```sh
node tools/fnh-engine/server.js
node tools/fnh-engine/server.js --open
node tools/fnh-engine/server.js --game "/đường/dẫn/tới/www"
node tools/fnh-engine/server.js --port 8139 --host 127.0.0.1
```

| Tuỳ chọn | Ý nghĩa |
| --- | --- |
| `--game <thư mục>` | Thư mục `www` hoặc thư mục game chứa `www`. Mặc định là bản 1.4.1 trong repo. |
| `--port <số>` | Cổng HTTP, mặc định `8139`. |
| `--host <địa chỉ>` | Địa chỉ lắng nghe, mặc định `127.0.0.1`. |
| `--open` | Mở trình duyệt sau khi máy chủ chạy. |
| `--help` | In trợ giúp. |

Biến môi trường tương đương: `FNH_GAME_ROOT`, `FNH_ENGINE_PORT`, `FNH_ENGINE_HOST`.

Máy chủ phục vụ:

- ứng dụng trong `fnh-engine/` tại `/`;
- thư mục `www` gốc tại `/game/` (chỉ đọc, không sửa);
- `GET /__fnh-engine/health` để kiểm tra trạng thái.

Có hỗ trợ `Range` cho âm thanh và chặn truy cập ra ngoài hai thư mục gốc.

## Điều khiển

| Phím | Việc |
| --- | --- |
| Mũi tên / `WASD` | Di chuyển, chọn menu |
| `Enter` / `Z` / `Space` | Xác nhận, hành động, đối thoại |
| `Esc` / `X` | Tạm dừng, quay lại |
| `M` | Bật/tắt âm thanh |
| Chuột | Chọn menu, nhấp thẻ nhân vật |

Trong trận đấu: `↑`/`↓` chọn **TẤN CÔNG**, **PHÒNG THỦ** hoặc **BỎ CHẠY**, rồi `Enter`.

## Phạm vi

- **Bốn nghề chơi được**, dùng chân dung và ảnh mô tả gốc:
  - Cahara — Mercenary
  - D'arce — Knight
  - Enki — Dark Priest
  - Ragnvaldr — Outlander
- **Bản đồ 1** (`level1_A`, tileset `Inside`), xuất phát tại `(27, 67)`.
- **Guard** đứng tại `(27, 64)`, dùng đủ 7 bộ phận battler gốc.
- Trận đấu theo lượt với 3 lệnh; Guard có 320 HP, thưởng 35 vàng và 20 EXP.
- Thắng, thua (màn hình chết) và bỏ chạy đều có đường quay lại game.
- **Một ô lưu** trong `localStorage`:
  - khoá: `FNH_ENGINE:<namespace>:save1`;
  - namespace mặc định `default`, đổi bằng `?fnh_engine_ns=...` khi test;
  - Continue ở màn hình tiêu đề, Lưu/Đọc trong menu tạm dừng, Đọc ở màn hình chết.
- Hình ảnh, tileset, battleback, nhân vật, khuôn mặt và âm thanh đều đọc từ bản gốc.

## Kiến trúc

```text
fnh-engine/
  index.html              khung canvas + overlay bắt đầu
  css/engine.css          giao diện ngoài canvas
  js/core.js              hằng số, Input, Storage, Transition, Scene, helper vẽ
  js/assets.js            nạp/giải mã ảnh và âm thanh RPG Maker MV
  js/audio.js             Web Audio: BGM, BGS, SE
  js/data.js              đọc JSON gốc, tạo nhân vật, tile, encounter
  js/game.js              vòng lặp, chuyển cảnh, preload, lưu/đọc
  js/scene_title.js       tiêu đề
  js/scene_creation.js    chọn nghề
  js/scene_map.js         bản đồ, di chuyển, va chạm, menu tạm dừng
  js/scene_battle.js      trận đấu theo lượt
  js/scene_gameover.js    màn hình chết
  js/main.js              khởi động ứng dụng

tools/fnh-engine/server.js       máy chủ app + /game/
tests/fnh-engine-smoke.js        smoke test Chrome/CDP
```

### Giải mã asset

Engine đọc `data/System.json` để lấy `encryptionKey`, sau đó tự giải mã:

1. bỏ 16 byte header giả của tệp `.rpgmvp` / `.rpgmvo`;
2. XOR 16 byte đầu với key;
3. phần còn lại là PNG/OGG thật.

Nếu ảnh không mã hoá, loader thử tiếp tệp `.png`. Không dùng lớp `Decrypter` của RPG Maker
MV. Ảnh được giải mã vào `Blob` URL rồi nạp vào `Image`; âm thanh được giải mã qua
`AudioContext.decodeAudioData` và chỉ giải mã khi thực sự cần phát.

### Dữ liệu gốc được dùng

`System.json`, `Actors.json`, `Classes.json`, `Weapons.json`, `Armors.json`,
`Enemies.json`, `Troops.json`, `Tilesets.json`, `MapInfos.json`, `Map001.json`.
Chỉ số nhân vật lấy từ class + trang bị gốc ở level khởi đầu. Tile passability lấy từ
`Tilesets.json`; thứ tự vẽ tôn trọng cờ upper-layer `0x10`.

### Event interpreter

`js/interpreter.js` thực thi event theo từng frame, với con trỏ và nhánh riêng cho mỗi
common event. Có hỗ trợ nhánh điều kiện lồng nhau, lựa chọn (kể cả hủy), hội thoại nhiều
dòng chờ xác nhận, chờ theo frame, vòng lặp/thoát vòng lặp, nhãn và gọi common event.
Trong hội thoại dùng `Z`/`Enter`; dùng mũi tên để chọn câu trả lời. Di chuyển và menu
tạm dừng bị khóa trong lúc event đang chạy.

Các lệnh thay đổi switch, biến (hằng số/biến/ngẫu nhiên), self-switch, vàng, vật phẩm,
chuyển bản đồ và SE được thực thi tại vị trí của chúng trong luồng event. Self-switch
được tách theo bản đồ; khóa save cũ chỉ được đọc lại ở bản đồ 1. Hình ảnh event được
chọn lại theo điều kiện sau khi thực thi xong. Cửa chạm chỉ chạy từ trang đang hoạt động.

Đây chưa phải interpreter đầy đủ của MV. Điều kiện hiện hỗ trợ switch, biến,
self-switch, vàng và vật phẩm. Lệnh hoặc điều kiện chưa hỗ trợ sẽ dừng event, hiển thị
thông báo và lưu lỗi vào `FNH.game.lastError`, thay vì chạy tiếp các hệ quả sai.
Chưa có autorun/parallel event, script/plugin command, move route, hiệu ứng màn hình,
định dạng escape code của hội thoại hoặc chân dung trong khung hội thoại.

## Kiểm chứng

```sh
npm run check:fnh-engine   # node --check toàn bộ JS mới + server + test
npm run test:fnh-engine    # smoke test đầy đủ
```

Bài test sẽ:

1. khởi động máy chủ tạm trên cổng ngẫu nhiên;
2. kiểm tra route, asset mã hoá gốc, HTTP Range và chặn traversal;
3. mở Chrome headless, bấm **BẮT ĐẦU**;
4. kiểm tra tiêu đề, Web Audio, nhạc nền, giải mã ảnh/SE;
5. tạo nhân vật, kiểm tra 4 nghề và chân dung;
6. vào bản đồ 1, di chuyển tới Guard, đánh thắng;
7. lưu game, tải lại trang, Continue từ localStorage;
8. thua một trận, kiểm tra màn hình chết và đọc lại save;
9. dọn save test và kiểm tra không có lỗi runtime/console mới.

Nếu thiếu thư mục game hoặc Chrome, bài test in **BỎ QUA** và trả mã 0. Đặt `CHROME_BIN`
nếu Chrome không nằm trong `PATH`. Đặt `FNH_KEEP_SHOTS=1` để giữ ảnh chụp trong thư mục
tạm và in đường dẫn.

## Giới hạn

- Chỉ có **bản đồ 1** và **một encounter Guard**. Chưa có toàn bộ bản đồ, cốt truyện,
  hội thoại, inventory, kỹ năng, vật phẩm, cấp máu từng bộ phận hay hệ thống đói/kinh hoàng.
- Các event hình ảnh trên bản đồ được vẽ để giữ không khí, nhưng **chưa chạy event command**
  gốc đầy đủ; chỉ tập lệnh mô tả ở mục Event interpreter được thực thi.
  Guard encounter vẫn là kịch bản riêng của vertical slice.
- Trận đấu là bản đơn giản hoá: một nhân vật, một kẻ địch, ba lệnh; chưa mô phỏng đầy đủ
  công thức, trạng thái, vũ khí và animation của bản gốc.
- Chưa có âm thanh môi trường theo vị trí, video intro, Steamworks, thành tựu hay save
  NW.js.
- Chất lượng giải mã/âm thanh phụ thuộc codec của trình duyệt.
- Đây là dự án phi thương mại, chỉ dành cho người đã sở hữu bản game gốc.

## Giấy phép và asset

Mã nguồn engine nằm trong repo này. **Asset của Fear & Hunger không được cấp phép lại**
và không được đưa vào repo. Xem [`LICENSE`](../LICENSE) của repo.
