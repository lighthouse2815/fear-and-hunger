# Dự án Fear & Hunger Web

Đây là thư mục nguồn để chỉnh sửa và phát triển tiếp. Code, dữ liệu và asset đã
được nhập vào đây; không cần thư mục cài Fear & Hunger hoặc RPG Maker để chạy web.
Thông tin tác giả được giữ trong code và `NOTICE.md`. Thông tin nhập nằm trong
`source-info.json`.

## Chạy và build

Cần Node.js 18+, không cần `npm install`. Chạy ngay trong thư mục này:

```sh
npm start          # http://127.0.0.1:8140/
npm run check      # kiểm tra cú pháp JavaScript và dữ liệu JSON
npm run build      # tạo ../dist/fear-and-hunger-web/
```

Có thể copy nguyên thư mục dự án sang vị trí khác rồi chạy các lệnh trên.
Khi chỉnh source, tải lại trình duyệt để xem kết quả. Build không ghi đè source.
Save nằm trong trình duyệt, nên giữ cùng địa chỉ/cổng để tiếp tục save.

Ở màn hình đặt tên, nhập `lighthouse` để bật cheat cho nhân vật đó: luôn đầy HP,
miễn trạng thái chết và gây ít nhất 9.999 sát thương mỗi đòn gây mất/hút HP trúng
quái. Tên không phân biệt hoa thường; đổi sang tên khác sẽ tắt cheat. Cheat đi
theo tên trong save, không tăng sát thương hồi máu hay đòn đánh đồng đội và không
thay đổi các kết thúc do sự kiện cốt truyện gọi trực tiếp.

## Muốn sửa gì thì mở đâu?

| Phần cần sửa | File/thư mục |
| --- | --- |
| Công thức sát thương, di chuyển, vật phẩm, trạng thái | `js/rpg_objects.js` |
| Luồng trận đấu, âm thanh, tải dữ liệu, lưu/đọc | `js/rpg_managers.js` |
| Các màn hình và menu | `js/rpg_scenes.js` |
| Hộp thoại, danh sách lựa chọn, cửa sổ giao diện | `js/rpg_windows.js` |
| Vẽ nhân vật, hiệu ứng và animation | `js/rpg_sprites.js` |
| Hành vi mở rộng và combat riêng | `js/plugins/`, cấu hình trong `js/plugins.js` |
| Nút âm thanh trên web, tự vào menu, thoại ở dưới | `__fnh/compat.js` |
| Nhân vật, quái, kỹ năng, vật phẩm, vũ khí, giáp | `data/Actors.json`, `Enemies.json`, `Skills.json`, `Items.json`, `Weapons.json`, `Armors.json` |
| Map và sự kiện trên map | `data/MapNNN.json`, danh sách trong `data/MapInfos.json` |
| Sự kiện dùng chung và sự kiện chiến đấu | `data/CommonEvents.json`, `data/Troops.json` |
| Tên game, thiết lập chung | `data/System.json` |
| Ảnh PNG, sprite, tileset, nền, giao diện | `img/` |
| Nhạc và hiệu ứng OGG | `audio/bgm/`, `audio/bgs/`, `audio/me/`, `audio/se/` |
| Font và video | `fonts/`, `movies/` |

Ví dụ sửa máu quái: mở `data/Enemies.json`, tìm quái theo `name` và sửa `params[0]`.
Ví dụ sửa sát thương: tìm `Game_Action.prototype.makeDamageValue` trong
`js/rpg_objects.js`. Công thức riêng của kỹ năng còn nằm ở `damage.formula` trong
`data/Skills.json`; plugin có thể thay đổi kết quả sau đó.

Ảnh và âm thanh đã được xuất thành định dạng mở, giữ nguyên tên file và thư mục.
Thay PNG/OGG tại đúng đường dẫn để dùng asset mới. Không cần mã hoá lại.
Với file JSON dài, dùng Format Document trong trình soạn thảo để xem cấu trúc.

Nhiều logic của game nằm trong lệnh sự kiện JSON và script bên trong chúng, không
chỉ trong các file JavaScript. Bảng trên là chỉ dẫn vị trí, không phải cam kết đã
kiểm thử mọi nhánh cốt truyện hoặc kết thúc. Steamworks được tắt trong bản web.
