# CỐI HẦM

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
npm start          # python3 -m http.server 8137
```

Mở `http://localhost:8137` và chơi. Hoặc dùng `npm run start:node` nếu chỉ có Node.

## Chạy Fear & Hunger bản gốc trên trình duyệt

Repo cũng có công cụ chạy **bản Fear & Hunger 1.4.1 do bạn sở hữu** trực tiếp trong
trình duyệt, dùng chính thư mục `www` của bản RPG Maker MV gốc:

```sh
npm run fnh        # mở http://127.0.0.1:8138/
npm run fnh:open   # tự mở trình duyệt
```

Đây là phần tách biệt với game Cối Hầm ở trên. Công cụ không chứa, không tải và không
sao chép asset của Fear & Hunger; thư mục game đã được ignore trong Git. Xem hướng dẫn
đầy đủ, cách lưu game, kiểm thử và các giới hạn tại [`PORT.md`](PORT.md).

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
npm test   # node --check toàn bộ JS + smoke test headless
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
```

Giấy phép: xem tệp [`LICENSE`](LICENSE) — **mã nguồn MIT**; nội dung ngôn ngữ
(tên quái, lời văn trong `js/data.js`) do chủ dự án giữ quyền riêng.
