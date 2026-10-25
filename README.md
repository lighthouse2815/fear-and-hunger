# Fear & Hunger Web — dự án nguồn

Code logic, dữ liệu và asset đã được chép vào **`game/`**, có thể mở và chỉnh sửa
trực tiếp. Ảnh được xuất thành PNG, âm thanh thành OGG. Clone repository là có
nguồn và tài nguyên để chạy; không cần bộ cài Fear & Hunger hoặc RPG Maker.

```sh
npm start          # chạy source tại http://127.0.0.1:8140/
npm run dev        # tương tự, sửa file rồi tải lại trang
npm run check      # kiểm tra JavaScript và JSON của game
npm test           # kiểm tra dự án, build và trình duyệt Chrome
npm run build      # tạo dist/fear-and-hunger-web/
```

Cần Node.js 18+, không cần npm install. Test trình duyệt cần Node.js 22+ và Chrome.
Xem **[game/README.md](game/README.md)** để biết file nào xử lý combat, di chuyển,
nhân vật, hộp thoại, map, sự kiện, nhạc và hình ảnh.

`game/` là nguồn phát triển được quản lý bằng Git; `dist/` là kết quả build có thể
xóa và tạo lại. Build giữ thay đổi của bạn trong source, không đọc lại bộ cài cũ.
Có thể copy nguyên thư mục `game/` sang máy khác, chạy `npm start` trong đó và tiếp
tục sửa/build mà không cần các công cụ ở thư mục cha.

Cách tổ chức nguồn và asset trong repository tham khảo
[Jump King Web](https://github.com/lighthouse2815/jump-king). Bản này giữ mã RPG Maker
MV và plugin JavaScript sẵn có; code và nội dung nhập giữ thông tin tác giả.
Đây là dự án chuyển sang web để phát triển tiếp, không phải tuyên bố tự viết toàn
bộ mã gốc. Các sửa đổi web hiện nằm trong `game/__fnh/compat.js`.

`npm run import:game` chỉ dùng để tạo thư mục nguồn lần đầu từ bản cài hoặc gói web
đã có. Lệnh từ chối ghi đè `game/` đang tồn tại. Muốn nhập ra chỗ khác:

```sh
npm run import:game -- --game "/đường/dẫn/www" --out "/đường/dẫn/dự-án"
```

Import nguồn mã hoá dùng Decrypter đi kèm game; một ảnh PSD cần ImageMagick
(`magick`) để xuất PNG và giữ lại bản PSD. Chỉ bước nhập lại cần công cụ này;
chạy, build và chỉnh sửa nội dung đã nhập không cần bộ cài hoặc ImageMagick.

Chi tiết bản chuyển web và các giới hạn ở [PORT.md](PORT.md).
Engine tự viết ở cổng 8139 vẫn là thử nghiệm; game Cối Hầm cũ có thể chạy riêng
bằng `npm run coi-ham` tại cổng 8137.

## Cối Hầm — game riêng trong repository

Một **game web dungeon-horror** hoàn toàn nội dung gốc: chui xuống lòng đất quản lý cơn đói,
đấu theo lệnh với các vùng cơ thể tính máu riêng, sống nhờ ném xu may mắn, và quay về lối lên
sau khi trùm đáy gục ngã.

> **Minh bạch:** game này không phục chế bất kỳ game thương mại nào. Nó lấy cảm hứng từ
> *lối chơi* của thể loại dungeon-horror (cấu trúc cơ thể, xu may mắn, đói–kinh hoàng,
> giường lưu), nhưng toàn bộ mã nguồn, quái vật, vật phẩm, lời văn, đồ họa (canvas thủ tục)
> và âm thanh (WebAudio) đều tự viết. Nếu thích thể loại, hãy mua game bản quyền để ủng hộ
> tác giả gốc.

## Chạy thử

Không cần build. Từ thư mục dự án:

```sh
npm run coi-ham    # python3 -m http.server 8137
```

Mở `http://localhost:8137` và chơi. Hoặc dùng `npm run start:node` nếu chỉ có Node.

## Chạy Fear & Hunger bản gốc trên trình duyệt

Repo cũng có công cụ chạy **bản Fear & Hunger 1.4.1 do bạn sở hữu** trực tiếp trong
trình duyệt, dùng chính thư mục `www` của bản RPG Maker MV gốc:

```sh
npm run fnh        # mở http://127.0.0.1:8138/
npm run fnh:open   # tự mở trình duyệt
```

Đây là công cụ chạy trực tiếp bộ cài cũ, tách biệt với nguồn đã nhập trong `game/`.
Thư mục bộ cài ban đầu vẫn được ignore trong Git. Xem hướng dẫn
đầy đủ, cách lưu game, kiểm thử và các giới hạn tại [`PORT.md`](PORT.md).

## Engine web độc lập cho Fear & Hunger (thử nghiệm)

Ngoài công cụ tương thích ở trên, repo còn có **engine web viết mới** tại `fnh-engine/`.
Engine này không chạy runtime RPG Maker MV: nó tự đọc JSON, giải mã ảnh/âm thanh và dựng
lại màn hình bằng Canvas 2D + Web Audio.

```sh
npm run fnh:engine        # http://127.0.0.1:8139/
npm run fnh:engine:open   # tự mở trình duyệt
npm run test:fnh-engine   # smoke test Chrome/CDP
```

Menu New Game hiện đi qua chọn nhân vật, đặt tên, phim giới thiệu, chọn chế độ và
câu chuyện xuất thân gốc tới cổng ngục. Menu có cột biểu tượng, chân dung lớn, vật
phẩm/trang bị/kỹ năng/chế tạo, chỉnh âm lượng/phím và danh sách 20 File lưu.
Combat vẫn là vertical slice thử nghiệm với
Guard, thắng/thua và lưu/đọc game. Asset vẫn được đọc read-only
từ thư mục `www` gốc qua `/game/`; nguồn chính và asset đã nhập nằm ở `game/`.

Xem [`fnh-engine/README.md`](fnh-engine/README.md) để biết kiến trúc, điều khiển, phạm vi,
cách giải mã asset và các giới hạn.

## Cách chơi

| Phím | Việc |
| --- | --- |
| Mũi tên / WASD | Di chuyển (tốn 1 độ no/bước) |
| E | Nằm vào giường lá (nghỉ, hồi vùng máu, **tự lưu**) |
| 1–4 | Trong trận: chọn hành động / chọn vùng bấm |
| M | Bật/tắt tiếng |

- **Cơ thể** chia 4 vùng: ĐẦU, THÂN, TAY, CHÂN. Đầu hoặc Thân số 0 → kết thúc.
  Tay gãy → yếu dần khi vung; Chân gãy → khó chạy, đòn nhận thêm. Băng gạc hồi lại;
  bị *cụt* là mất vĩnh viễn.
- **Đánh** = ném số **xu may mắn** (= xu xuất thân + xu vũ khí). Mỗi xu NGỬA là một pha
  trúng; tuốt SẤP là hụt. Vùng ĐẦU nhận gấp rưỡi sát thương, TAY/CHÂN dùng để vô
  hiệu hóa kẻ địch (gãy tay của nó làm đòn yếu đi, gãy chân giúp chạy thoát).
- **Xuất thân**: 3 lựa chọn (Kẻ Săn, Học Sĩ, Bộ Binh) — khác xu may, máu vùng, vũ khí
  khởi đầu, kỹ năng và vật phẩm lúc xuống.
- **Đói**: 0 độ no thì cơ thể tự cắn dần máu THÂN mỗi bước. **Kinh hoàng** (≥80): xu hư.
- **Thang khóa** cần chìa. Giường lá là nút lưu. Đánh bại trùm tầng đáy thì lối ra mở
  phía *cửa vào* — vẫn phải sống sót quay về đó rồi bước vào.

## Kiểm chứng nhanh

```sh
npm test                 # Cối Hầm: node --check + smoke test headless
npm run test:fnh         # bản chạy Fear & Hunger qua compat RPG Maker MV
npm run test:fnh-engine  # engine web độc lập
```

## Cấu trúc

```sh
index.html        khung trang
css/style.css     màu cửa đá
js/utils.js       tiện ích chung (random, chọn...)
js/sound.js       còi bép WebAudio (không tài nguyên ngoài)
js/data.js        dữ liệu: xuất thân, quái, vật phẩm, kỹ năng, tầng
js/combat.js      trận đấu theo lệnh (xu + vùng cơ thể)
js/game.js        lõi chơi: mê cung, sương mù, HUD, lưu/đọc
js/main.js        mặt màn, điều khiển, phím
tests/smoke.js    smoke test headless (chạy cùng npm test)
tools/fnh-browser/  máy chủ HTTP + lớp tương thích cho bản Fear & Hunger gốc
tests/fnh-browser-smoke.js  kiểm tra bản chạy trình duyệt (npm run test:fnh)
fnh-engine/       engine web độc lập cho Fear & Hunger (Canvas + Web Audio)
tools/fnh-engine/ máy chủ phục vụ app và asset gốc tại /game/
tests/fnh-engine-smoke.js  kiểm tra engine độc lập (npm run test:fnh-engine)
```

Giấy phép: xem tệp [`LICENSE`](LICENSE) — **mã nguồn MIT**; nội dung ngôn ngữ
(tên quái, lời văn trong `js/data.js`) do chủ dự án giữ quyền riêng.
