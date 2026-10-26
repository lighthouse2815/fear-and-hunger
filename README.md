# Fear & Hunger Web

Một dự án game web với mã JavaScript, logic, dữ liệu và asset trong **`game/`**.
Clone repository là có nguồn để chạy và chỉnh sửa, không cần bộ cài game gốc.

```sh
npm start           # http://127.0.0.1:8140/
npm run dev         # chạy source; sửa file rồi tải lại trang
npm run check       # cú pháp và liên kết map/ảnh/âm thanh
npm test            # unit, đóng gói và kiểm tra trình duyệt
npm run build       # dist/fear-and-hunger-web/
```

Cần Node.js 18+. Test trình duyệt cần Node.js 22+ và Chrome/Chromium;
có thể chỉ định đường dẫn bằng `CHROME_BIN`. Không cần `npm install`.

## Chỉnh sửa game

Xem **[game/README.md](game/README.md)** để biết nơi sửa combat, nhân vật, map,
sự kiện, hội thoại và tài nguyên.

| Thư mục | Nội dung |
| --- | --- |
| `game/js/` | Mã runtime, gameplay và plugin |
| `game/data/` | 169 map, nhân vật, vật phẩm, kỹ năng, quái và sự kiện |
| `game/img/`, `game/audio/` | Ảnh PNG và âm thanh OGG |
| `game/__fnh/compat.js` | Tương thích trình duyệt và cài đặt âm thanh |
| `tests/` | Kiểm tra dữ liệu, gameplay, import và build |
| `tools/import-game.js` | Công cụ nhập lại dữ liệu khi cần |
| `dist/` | Kết quả build; có thể tạo lại từ source |

Menu hiện ngay khi mở web. Nhạc bật sau lần bấm phím/chuột đầu tiên.
Dùng phím mũi tên để di chuyển, Enter/Z để xác nhận/tương tác, Esc/X để quay lại
hoặc mở menu. Nút **⚙ Cài đặt** chỉnh âm lượng tổng, nhạc và hiệu ứng; lựa chọn
được lưu tự động. Hộp thoại nằm phía dưới vùng game.

Save nằm trong localStorage; giữ cùng trình duyệt và địa chỉ/cổng để tiếp tục save.
Có thể copy nguyên thư mục `game/` sang nơi khác rồi chạy `npm start` trong đó.

## Bản phát hành

Chạy `npm run build`, sau đó dùng `npm run preview` hoặc phục vụ nguyên thư mục
`dist/fear-and-hunger-web/` bằng hosting HTTP(S). Mở bằng `file://` không hỗ trợ
việc tải dữ liệu của game. Preview và source dùng cùng cổng 8140: dừng bản đang
chạy trước khi mở bản còn lại để giữ nguyên địa chỉ lưu game.

## Kiểm chứng

Engine viết lại có bản xem thử tại `/standalone.html`. Mở
`/standalone.html?map=10&events=1` để chạy màn chọn bốn nhân vật, nhập tên và intro
từ các sự kiện JSON bằng engine mới. Lựa chọn độ khó, khóa chế độ ẩn, mô tả lựa
chọn và thông báo Gab ở cổng ngục đã có implementation độc lập.
Animation JSON cũng được phát bằng sprite sheet và timing trong `engine/animation-runtime.js`,
giữ chờ lệnh, âm thanh, flash và trạng thái khi lưu.
Trang này nạp mã trong `game/engine/` cùng thư viện Pixi có sẵn, không nạp runtime
RPG Maker hay plugin gốc. Bộ điều khiển filter mới dùng thư viện MIT
`pixi-filters` được tách từ bản đã có trong repo; xem
[nguồn thư viện](game/engine/vendor/README.md).
Việc thay runtime ở trang chính vẫn đang tiếp tục; combat và các hiệu ứng plugin
chưa được chuyển hết.

Kiểm tra dữ liệu quét tất cả map, cửa chuyển map và tên ảnh/âm thanh trực tiếp
trong map, common event và battle event. Test trình duyệt dùng runtime thật để
kiểm tra menu, di chuyển, chuyển map, combat, hội thoại, video, âm thanh,
cài đặt, lưu/đọc và Android Chrome. Thiếu Chrome/source sẽ báo lỗi.

Các lệnh/sự kiện dựng tên tài nguyên bằng biến hoặc script vẫn cần kiểm thử trong
luồng chơi. Bộ kiểm tra không thay thế việc chơi hết mọi nhánh và mọi kết thúc.
Steamworks được tắt trong bản web. Xem [nguồn gốc nội dung](game/NOTICE.md).

## Nhập lại dữ liệu

Source và asset đã được commit; chỉ cần lệnh này khi nhập bộ dữ liệu khác:

```sh
npm run import:game -- --game "/đường/dẫn/www" --out "/đường/dẫn/dự-án-mới"
```

Công cụ từ chối ghi đè thư mục đang có. Ảnh và âm thanh được xuất bằng bộ giải mã
của runtime; PSD được giữ lại và xuất thêm PNG bằng ImageMagick (`magick`).
Chạy/build/chỉnh sửa nội dung đã nhập không cần ImageMagick hoặc bộ cài gốc.
Cách quản lý nguồn và asset trong repo tham khảo
[Jump King Web](https://github.com/lighthouse2815/jump-king).

## Cloudflare Pages

Game: https://fear-and-hunger-web.pages.dev/

Cloudflare đã kết nối trực tiếp với GitHub repository
`lighthouse2815/fear-and-hunger`, nhánh production **`main`**. Mỗi lần push/merge vào
`main`, Cloudflare tự build và cập nhật game. Không cần chạy lệnh deploy trên máy.

Cấu hình trong Dashboard → Settings → Build:

- Build command: `npm run check && npm run build`.
- Build output directory: `dist/fear-and-hunger-web`.
- Root directory: thư mục gốc repository.
- Production branch: `main`; Automatic deployments: Enabled.

Có thể xem tiến trình và lỗi tại tab Deployments. Cấu hình này đã được thiết lập
trong Chrome bằng Git Integration, không cần thêm API token vào GitHub.

Khi cần upload thủ công để khôi phục hoặc kiểm tra nhanh:

```sh
npm ci                     # cài công cụ deploy, dùng Node.js 22+
npx wrangler login         # chỉ khi máy chưa đăng nhập Cloudflare
npm run deploy:cloudflare
```

`wrangler.jsonc` trỏ tới `dist/fear-and-hunger-web/`. Lệnh deploy kiểm tra nguồn,
build rồi upload toàn bộ code và asset lên Pages. Hosting chỉ phục vụ file tĩnh,
không chạy `server.js` hay cần thư mục game trên máy bạn. Save của địa chỉ Pages
được lưu riêng trong trình duyệt, tách với save ở localhost.

Thông tin đăng nhập do Wrangler quản lý ngoài source. Không đưa token vào Git.
