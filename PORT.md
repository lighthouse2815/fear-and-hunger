# Fear & Hunger 1.4.1 — dự án nguồn và bản web

Công cụ này chạy **bản game Fear & Hunger 1.4.1 do bạn sở hữu** trong trình duyệt,
dùng runtime RPG Maker MV và plugin gốc. Có thể đóng gói thành thư mục web độc lập,
hoặc chạy trực tiếp từ thư mục `www` của bản cài hiện có. Công cụ không tải game.

Thư mục **`game/`** hiện chứa mã nguồn JavaScript, dữ liệu gameplay, 169 map và
asset PNG/OGG/font/video đã nhập, được theo dõi bằng Git. `npm start` chạy trực tiếp
nguồn này ở cổng 8140; `npm run build` tạo bản phát hành trong `dist/`. Không cần
thư mục cài game để phát triển tiếp. Xem [hướng dẫn sửa source](game/README.md).
Bộ cài nguyên bản `Fear.and.Hunger.v1.4.1/` và kết quả build `dist/` vẫn được ignore.

```sh
npm start
npm run check
npm test
npm run build
```

`npm run import:game` chỉ tạo source lần đầu khi đích chưa tồn tại. Import xuất
ảnh/âm thanh bằng Decrypter của runtime gốc, tắt cờ mã hoá trong `data/System.json`,
và giữ nguyên code/runtime/plugin. Một PSD mang đuôi RPGMVP được giữ lại ở định dạng
PSD và xuất thêm PNG bằng ImageMagick. Các file xuất ra dùng trực tiếp, không cần
bộ giải mã hoặc ImageMagick để phát triển, chạy hay build.

Phần bên dưới cũng mô tả công cụ chạy trực tiếp bộ cài cũ và engine thử nghiệm.

## Đóng gói thành bản web độc lập

```sh
npm run build:fnh-web
npm run fnh:web
```

Bước build ưu tiên thư mục nguồn `game/` nếu đã có; khi chưa nhập source, công cụ
có thể đọc bản cài hiện có. Kết quả nằm ở `dist/fear-and-hunger-web/`. Nguồn hiện có
**169 bản đồ**; toàn bộ `audio`, `data`, `fonts`, `icon`, `img`, `js`
và `movies` được mang vào gói, gồm runtime RPG Maker MV và plugin gốc. Ảnh/âm thanh
trong nguồn giữ nguyên bytes; nguồn đã nhập dùng PNG/OGG mở. `index.html` nhận lớp
tương thích bằng đường dẫn tương đối `./__fnh/compat.js`, chạy được khi host ở thư mục con.

Gói xuất không đọc thư mục cài game ban đầu, không gọi engine thử nghiệm và không
cần cài dependency npm. Copy nguyên gói sang vị trí/máy khác, cài Node.js 18+ rồi chạy:

```sh
cd fear-and-hunger-web
npm start                        # http://127.0.0.1:8140/
```

Có thể dùng máy chủ tĩnh khác hoặc hosting HTTP(S). Mở trực tiếp `index.html` bằng
`file://` không hỗ trợ XHR của runtime. Menu tự hiện khi mở web; âm thanh được mở ở
lần bấm phím hoặc chuột đầu tiên trong game theo yêu cầu của trình duyệt. Save nằm
trong localStorage của địa chỉ đang chơi; giữ cùng origin để dùng tiếp save. Save cũ
của engine tự viết ở cổng 8139 không chuyển sang được.

Chỉ định nguồn và nơi xuất:

```sh
npm run build:fnh-web -- --game "/đường/dẫn/www" --out "/đường/dẫn/fear-and-hunger-web"
```

Công cụ từ chối ghi đè thư mục không có dấu nhận dạng gói web và không nhận symlink
trong dữ liệu nguồn. Build lại tạo gói tạm trước rồi mới thay gói đã tạo lần trước;
lỗi copy giữ nguyên gói cũ. Không mang save cá nhân hoặc thư viện native của NW.js
vào gói web. Nội dung gốc không bị sửa. Gói xuất nằm trong `.gitignore`; công cụ này
không thay đổi quyền phân phối tài nguyên và mã game gốc.

Kiểm chứng bộ đóng gói và chạy test bằng đúng server/tài nguyên trong gói:

```sh
node tests/fnh-browser-build.js
FNH_WEB_PACKAGE=dist/fear-and-hunger-web npm run test:fnh
```

Test đóng gói dùng nguồn tạm, xóa nguồn rồi chạy server từ gói xuất để kiểm tra tính
độc lập, thứ tự script, ảnh/âm thanh và HTTP Range. Smoke test dùng Chromium kiểm tra
di chuyển, đi qua event cửa thật 74 → 1 → 74, combat chọn bộ phận Guard, video,
âm thanh và lưu/đọc qua tải lại trang. Đây không phải bằng chứng đã chơi kiểm thử
mọi nhánh cốt truyện hoặc mọi kết thúc.

## Yêu cầu

- Node.js 18 trở lên để chạy máy chủ. Nên dùng Node.js 22 trở lên để chạy bài test
  trình duyệt (bài test dùng `WebSocket` có sẵn trong Node).
- Trình duyệt hiện đại có WebGL và Web Audio. Đã kiểm tra với Chrome/Chromium; Firefox
  có thể chạy nhưng chưa được kiểm chứng trong repo này. Bài test tự động dùng
  Chrome/Chromium.
- Khi build hoặc chạy trực tiếp từ nguồn, thư mục game đặt đúng vị trí mặc định:

  ```text
  Fear.and.Hunger.v1.4.1/
    Fear.and.Hunger.v1.4.1/
      www/
        index.html
        js/
        data/
        img/
        audio/
        movies/
  ```

  Nếu thư mục `www` nằm ở chỗ khác, truyền đường dẫn bằng `--game` hoặc biến môi
  trường `FNH_GAME_ROOT` (xem bên dưới).

## Chạy game

Từ thư mục repo:

```sh
npm run fnh
```

Mở địa chỉ in ra trong terminal, mặc định là:

```text
http://127.0.0.1:8138/
```

Trang tự khởi động game và vào thẳng menu, không có nút BẮT ĐẦU. Nhạc bắt đầu
sau lần bấm phím hoặc chuột đầu tiên trong game vì trình duyệt yêu cầu tương tác
để phát âm thanh. Dùng `?fnh_skip_pretitle=0` nếu muốn xem phần pre-title gốc.

Nút **⚙ Cài đặt** ở góc trên bên phải mở các thanh âm lượng tổng (gồm video),
nhạc nền, âm thanh môi trường, nhạc sự kiện và hiệu ứng. Thay đổi có hiệu lực ngay,
đồng bộ với menu Options gốc và được lưu cho lần mở sau. Game tạm dừng khi bảng
cài đặt mở; bấm **Đóng** hoặc **Esc** để tiếp tục.

Có thể mở trình duyệt tự động:

```sh
npm run fnh:open
```

Hoặc dùng trực tiếp:

```sh
node tools/fnh-browser/server.js --open
node tools/fnh-browser/server.js --game "/đường/dẫn/tới/www"
node tools/fnh-browser/server.js --port 8138 --host 127.0.0.1
```

Các tuỳ chọn:

| Tuỳ chọn | Ý nghĩa |
| --- | --- |
| `--game <thư mục>` | Thư mục `www` hoặc thư mục game chứa `www`. Mặc định là bản 1.4.1 trong repo. |
| `--port <số>` | Cổng HTTP, mặc định `8138`. |
| `--host <địa chỉ>` | Địa chỉ lắng nghe, mặc định `127.0.0.1`. |
| `--open` | Mở trình duyệt sau khi máy chủ chạy. |
| `--help` | In trợ giúp. |

Biến môi trường tương đương: `FNH_GAME_ROOT`, `FNH_PORT`, `FNH_HOST`.

### Chạy trên Windows / macOS

Máy chủ chỉ dùng module có sẵn của Node nên không cần cài thêm gói. Trên Windows, dùng
`npm run fnh` hoặc `node tools\fnh-browser\server.js`; `--open` gọi `start`. Trên macOS,
`--open` gọi `open`.

## Engine web độc lập (fnh-engine)

Repo còn có một cách chạy khác: **engine web viết mới** tại `fnh-engine/`, không dùng
runtime RPG Maker MV. Engine tự đọc JSON, giải mã ảnh/âm thanh gốc và dựng cảnh bằng
Canvas 2D + Web Audio. Đây là phần tách biệt với công cụ compat ở trên.

```sh
npm run fnh:engine        # http://127.0.0.1:8139/
npm run fnh:engine:open   # tự mở trình duyệt
npm run test:fnh-engine   # smoke test Chrome/CDP
```

Bản dựng hiện tại là vertical slice: tiêu đề → tạo nhân vật (4 nghề) → bản đồ 1 → gặp
Guard → trận đấu theo lượt → thắng/thua → lưu và đọc game. Asset vẫn được đọc read-only
từ `www` gốc qua `/game/`. Engine thử nghiệm này tách biệt với nguồn chính ở `game/`.

Máy chủ engine mặc định ở cổng **8139**, có các tuỳ chọn `--game`, `--port`, `--host`,
`--open`, `--help`; biến môi trường `FNH_GAME_ROOT`, `FNH_ENGINE_PORT`, `FNH_ENGINE_HOST`.
Save dùng localStorage với tiền tố `FNH_ENGINE:<namespace>:` (mặc định `default`), có thể
đổi namespace bằng `?fnh_engine_ns=...` khi test.

Xem hướng dẫn đầy đủ, kiến trúc, điều khiển và giới hạn tại
[`fnh-engine/README.md`](fnh-engine/README.md).

## Lưu game

Game dùng `localStorage` của trình duyệt thay cho thư mục `save/` của NW.js:

- Save, load, save tự động và cấu hình đều nằm trong localStorage.
- Save gắn với **origin** `http://127.0.0.1:8138`. Nếu đổi cổng, trình duyệt coi đó là
  origin khác và sẽ không thấy save cũ. Hãy giữ nguyên cổng mặc định nếu muốn tiếp tục
  chơi save đã có.
- Xoá dữ liệu trang web (site data), dùng chế độ ẩn danh hoặc đổi trình duyệt sẽ làm mất
  save. Không có Steam Cloud.
- Save của bản NW.js cũ (nếu có) không tự chuyển sang localStorage. Bản game trong repo
  này không có save NW.js nào.

Trong lúc phát triển/test, có thể tách save bằng tham số:

```text
?fnh_save_ns=ten-namespace
```

Mọi khoá sẽ có tiền tố `FNH_WEB:ten-namespace:`. Đây là tham số dành cho kiểm thử; chơi
bình thường không cần dùng.

## Kiểm tra tự động

```sh
npm run test:fnh
```

Bài test sẽ:

1. Khởi động máy chủ tạm trên một cổng ngẫu nhiên.
2. Kiểm tra việc chèn `compat.js` đúng thứ tự, HTTP Range cho video và chặn truy cập
   ngoài thư mục game.
3. Mở Chrome headless, bấm nút bắt đầu, kiểm tra `Scene_Title`, Web Audio đang chạy,
   nhạc tiêu đề đang phát.
4. Phát thử video `movies/intro.webm` qua đúng API của engine.
5. Lưu/đọc một save thử trong namespace riêng, kiểm tra biến, vàng và localStorage.
6. Vào bản đồ bắt đầu, chuyển bản đồ, di chuyển nhân vật và dựng một trận đấu.
7. Tải lại trang để xác nhận save vẫn còn, rồi dọn các khoá test.

Nếu chưa có thư mục game hoặc chưa cài Chrome/Chromium, bài test in thông báo **BỎ QUA**
và trả mã 0. Đây là chủ ý vì asset game không nằm trong repo. Đặt biến `CHROME_BIN` nếu
Chrome không nằm trong `PATH`.

Bài test không cần `npm install` và không thêm dependency nào.

Engine độc lập có bài test riêng:

```sh
npm run test:fnh-engine
```

Bài test này kiểm tra giải mã asset, tiêu đề, Web Audio, tạo nhân vật, bản đồ 1, di
chuyển, trận Guard, thắng/thua, lưu/đọc và Continue sau khi tải lại. Cũng như bài test
compat, nó bỏ qua và trả mã 0 nếu thiếu thư mục game hoặc Chrome. Node.js 22+ là cần
thiết cho cả hai bài test trình duyệt.

## Cách hoạt động

- `tools/fnh-browser/server.js` là máy chủ HTTP không dependency, phục vụ nguyên cây
  `www`. Với `index.html`, server chèn thêm một thẻ script trỏ tới
  `/__fnh/compat.js`; các tệp khác được trả nguyên bản.
- Bản chính dùng `game/__fnh/compat.js`, chạy trước `main.js` và:
  - tắt các plugin Steamworks/Greenworks trước khi `PluginManager.setup()`;
  - ép `Utils.isNwjs()` trả `false` để engine dùng đường lưu localStorage;
  - để runtime tự khởi động và bỏ qua pre-title để hiện menu ngay;
  - mở khoá Web Audio bằng gesture và thử lại video nếu autoplay bị chặn;
  - thay `SceneManager.terminate()` bằng màn hình kết thúc, vì trình duyệt thường chặn
    `window.close()`;
  - hỗ trợ namespace save và tuỳ chọn bật lại pre-title gốc.
- Nguồn `game/` cùng asset đã nhập được quản lý bằng Git; bản cài ban đầu không bị sửa.

## Giới hạn đã biết

- **Steamworks bị tắt.** Các lệnh `steamworks ...` trong game trở thành no-op. Thành tựu,
  overlay Steam và các tính năng Steam không hoạt động. Phần chơi còn lại không phụ
  thuộc vào Steam.
- **Không có save của NW.js.** Save mới nằm trong localStorage như mô tả ở trên.
- **Đóng game:** nút thoát/`window.close()` của trình duyệt có thể bị chặn; game hiện
  màn hình "Trò chơi đã kết thúc" thay vì đóng tab.
- **Hoạt ảnh vũ khí:** plugin đã được sửa để đọc đúng `PhysicalAttacks` và `SkillTypes`,
  giữ ghi chú bật/tắt của kỹ năng. Bài test trình duyệt không bỏ qua lỗi plugin.
- **Video/âm thanh phụ thuộc trình duyệt.** Nếu video vẫn không phát, hãy bấm thêm một lần
  vào vùng game; compat có cơ chế thử lại ở tương tác kế tiếp. Chế độ ẩn danh hoặc chặn
  autoplay nghiêm ngặt có thể ảnh hưởng trải nghiệm.
- **Hiệu năng** phụ thuộc WebGL/CPU của máy. Bản gốc là game NW.js; trình duyệt có thể
  chậm hơn một chút, đặc biệt khi dùng renderer phần mềm.

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
| --- | --- |
| `Không tìm thấy thư mục game RPG Maker MV hợp lệ` | Kiểm tra lại đường dẫn tới thư mục `www`, hoặc truyền `--game`. |
| Cổng đã bận | Đổi `--port`, nhưng nhớ rằng save gắn với origin/cổng. |
| Không có âm thanh | Bấm phím hoặc chuột trong game; kiểm tra tab không bị tắt tiếng. |
| Video không phát | Bấm vào vùng game một lần nữa để kích hoạt retry; kiểm tra codec WebM/VP9 của trình duyệt. |
| Mất save | Không xoá site data; dùng đúng cổng và đúng trình duyệt. |
| `npm run test:fnh` báo BỎ QUA | Chưa có game hoặc Chrome. Đặt game đúng chỗ và cài Chrome, hoặc đặt `CHROME_BIN`. |
| `npm run test:fnh-engine` báo BỎ QUA | Như trên; engine độc lập cũng cần thư mục `www` gốc và Chrome/Chromium. |
| Muốn thử engine độc lập | Chạy `npm run fnh:engine`, mở `http://127.0.0.1:8139/`; xem `fnh-engine/README.md`. |
