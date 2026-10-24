# Fear & Hunger 1.4.1 — chạy trên trình duyệt

Công cụ này chạy **bản game Fear & Hunger 1.4.1 do bạn sở hữu** ngay trong trình duyệt,
bằng chính thư mục `www` của bản RPG Maker MV gốc. Nó không tải game, không sao chép
asset và không đóng gói lại game. Toàn bộ hình ảnh, âm thanh, dữ liệu và mã plugin vẫn
được đọc trực tiếp từ thư mục game trên máy bạn.

> Thư mục `Fear.and.Hunger.v1.4.1/` đã nằm trong `.gitignore`. Không commit hoặc tải
> asset của game lên GitHub. Bạn cần tự mua/sở hữu bản game gốc để sử dụng công cụ này.

## Yêu cầu

- Node.js 18 trở lên để chạy máy chủ. Nên dùng Node.js 22 trở lên để chạy bài test
  trình duyệt (bài test dùng `WebSocket` có sẵn trong Node).
- Trình duyệt hiện đại có WebGL và Web Audio. Đã kiểm tra với Chrome/Chromium; Firefox
  có thể chạy nhưng chưa được kiểm chứng trong repo này. Bài test tự động dùng
  Chrome/Chromium.
- Thư mục game đặt đúng vị trí mặc định:

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

Bấm **BẮT ĐẦU** trên màn hình mở đầu. Thao tác này rất quan trọng: trình duyệt chỉ cho
phép Web Audio và video có âm thanh phát sau một tương tác thật của người dùng. Sau khi
bấm, engine mới thực sự khởi động.

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

## Cách hoạt động

- `tools/fnh-browser/server.js` là máy chủ HTTP không dependency, phục vụ nguyên cây
  `www`. Với `index.html`, server chèn thêm một thẻ script trỏ tới
  `/__fnh/compat.js`; các tệp khác được trả nguyên bản.
- `tools/fnh-browser/compat.js` chạy trước `main.js` và:
  - tắt các plugin Steamworks/Greenworks trước khi `PluginManager.setup()`;
  - ép `Utils.isNwjs()` trả `false` để engine dùng đường lưu localStorage;
  - hoãn `SceneManager.run()` cho tới khi người dùng bấm **BẮT ĐẦU**;
  - mở khoá Web Audio bằng gesture và thử lại video nếu autoplay bị chặn;
  - thay `SceneManager.terminate()` bằng màn hình kết thúc, vì trình duyệt thường chặn
    `window.close()`;
  - hỗ trợ namespace save và bỏ qua màn hình pre-title khi test.
- Không có asset nào bị sửa, sao chép hoặc ghi vào repo.

## Giới hạn đã biết

- **Steamworks bị tắt.** Các lệnh `steamworks ...` trong game trở thành no-op. Thành tựu,
  overlay Steam và các tính năng Steam không hoạt động. Phần chơi còn lại không phụ
  thuộc vào Steam.
- **Không có save của NW.js.** Save mới nằm trong localStorage như mô tả ở trên.
- **Đóng game:** nút thoát/`window.close()` của trình duyệt có thể bị chặn; game hiện
  màn hình "Trò chơi đã kết thúc" thay vì đóng tab.
- **Plugin `physical_attack_animation.js` có lỗi cú pháp từ bản gốc.** Plugin gọi
  `eval(String(parameters))` với một object, nên không nạp được và in lỗi
  `SyntaxError: Unexpected identifier 'Object'` trong console. Lỗi này có từ trước, không
  phải do bản chuyển trình duyệt; game vẫn chạy và bài test bỏ qua đúng lỗi đã biết này.
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
| Không có âm thanh | Bấm **BẮT ĐẦU** lại sau khi tải trang; kiểm tra tab không bị tắt tiếng. |
| Video không phát | Bấm vào vùng game một lần nữa để kích hoạt retry; kiểm tra codec WebM/VP9 của trình duyệt. |
| Mất save | Không xoá site data; dùng đúng cổng và đúng trình duyệt. |
| `npm run test:fnh` báo BỎ QUA | Chưa có game hoặc Chrome. Đặt game đúng chỗ và cài Chrome, hoặc đặt `CHROME_BIN`. |
