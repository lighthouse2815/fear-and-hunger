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

## Engine độc lập đang chuyển đổi

Mục tiêu mới là giữ asset, audio và JSON nội dung, thay toàn bộ runtime/plugin
RPG Maker bằng mã của dự án. Entry chính `index.html` hiện vẫn chạy runtime cũ.
Các module mới nằm trong `engine/`; mở `http://127.0.0.1:8140/standalone.html`
để kiểm tra bản đồ và nhân vật bằng Canvas mà không tải `rpg_*.js`, plugin hay
`__fnh/compat.js`. Trang preview cũng được đưa vào bản build.

Preview mở cạnh thùng đồ trên Map074. Bấm Enter hoặc **Tương tác** để mở thùng,
bấm **Tiếp tục** để đọc hội thoại. Dùng mũi tên hoặc các nút hướng để di chuyển;
khi hội thoại/sự kiện đang chạy, engine khóa di chuyển và các sự kiện khác.
Các lựa chọn hiển thị bằng nút trong trang, không mở hộp thoại `prompt`.
Đi qua cửa ở cổng ngục có thể vào Map001 và quay lại bằng sự kiện chạm thật.
Preview chọn sẵn Mercenary và layout 1 để kiểm tra; chưa thay thế phần tạo nhân vật.

Preview hiện hỗ trợ di chuyển, một phần lệnh sự kiện, lưu/tải riêng và âm thanh.
Interpreter chạy được common event lồng nhau, vòng lặp có giới hạn thực thi,
điều kiện, biến ngẫu nhiên và self-switch. Test dùng thùng đồ event 39 trên Map074
để xác nhận nhận vật phẩm từ common event 52 và không nhận lại sau khi đã mở.
Lệnh hoặc loại điều kiện chưa triển khai sẽ báo lỗi cụ thể thay vì tự bỏ qua.
`engine/script-runtime.js` chuyển 1.082 biến thể script hiện có trong JSON thành
thao tác dữ liệu: đổi hình character/face/battler, đặt giới hạn HP, cấu hình chase
và vô hiệu hóa click trên bản đồ. Không dùng `eval`, không nạp runtime gốc.
Test quét và thực thi từng biến thể; hình và giới hạn HP được giữ khi sửa chỉ số
và qua save. Cấu hình chase là dữ liệu cho hệ di chuyển, chưa tự tạo hành vi đuổi.
Interpreter cũng chạy các lệnh EXP/level, chỉ số, học/quên kỹ năng, đổi trang bị,
tên/biệt danh/hồ sơ, hình và TP. Chỉ số lấy từ class, trang bị và trait trạng thái;
đổi trang bị trao đổi với túi đồ. EXP được nhớ riêng theo class. Lệnh nhảy nhãn
dọn ngữ cảnh nhánh cũ; trạng thái chết và lệnh hồi phục đồng bộ HP.
`screen-runtime.js` xử lý picture và chuyển động/rotation/tint/opacity, fade màn hình,
flash, rung và mưa/tuyết. Renderer vẽ trực tiếp ảnh PNG, giữ scale/origin/blend;
thời lượng và cờ chờ chạy bằng frame, save tiếp tục được hiệu ứng đang dở.
Test dùng tham số picture thật từ Map010 và so sánh pixel asset trong Chrome.
Luồng bước đi xử lý trigger chạm 1/2, chạy common event trước khi chuyển map,
không tự kích hoạt lại cửa tại ô xuất hiện. Lệnh đặt vị trí event giữ tọa độ riêng
với JSON nguồn và tôn trọng note `<Save Event Locations>` khi rời map/lưu game.
Movement route hỗ trợ lệnh 0–45: đi/quay/nhảy/chờ, công tắc, tốc độ, cờ animation,
đổi hình, opacity/blend, SE và script. Route chạy theo frame, chờ va chạm hoặc bỏ
qua theo `skippable`, có thể lặp/thay/hủy; save giữ vị trí, hình và tiến trình route.
Test kiểm tra từng nhóm lệnh và quét hơn 100.000 route hiện có trong JSON.
Hiện bước đi đổi tọa độ theo ô, chưa nội suy chuyển động/sprite giữa hai ô.
Lệnh cuộn bản đồ 204 điều khiển camera theo hướng, khoảng cách và tốc độ trong JSON.
Camera cuộn theo frame, giữ tiến trình qua save, dừng ở mép map và tiếp tục theo
nhân vật khi di chuyển. Hai lệnh cuộn nối tiếp chạy lần lượt; cờ chờ giữ event
đến khi cuộn xong. Chuyển map đặt lại camera. Renderer vẽ được vị trí giữa hai ô.
Credits dùng lệnh 105/405, đọc đủ dòng và tốc độ trong JSON. Preview dùng Web
Animations API để cuộn chữ trên màn hình; event chờ cuộn hết. Giữ Shift, Enter,
Escape hoặc nút chạy nhanh để tăng tốc khi JSON cho phép. Hủy event đóng credits
và giải phóng điều khiển. Cờ hiện tên bản đồ thuộc lệnh 281, tách khỏi credits.
Tải map/save lỗi giữ map và trạng thái hiện tại nhất quán.
Audio dùng API trình duyệt có sẵn, đọc OGG với volume, pitch, fade, nhớ/phát tiếp
BGM và tạm dừng BGM khi phát ME. Cần tương tác bàn phím/chuột để mở âm thanh.
Thanh âm lượng cập nhật các âm đang phát, giữ volume của từng file.
Save preview dùng prefix `FNH_STANDALONE_PREVIEW:`, tách biệt save bản chính.

Đây chưa phải bản thay thế đầy đủ: combat, auto-event, plugin command và hiệu ứng
màn hình còn cần chuyển đổi. Các map hiện có không chứa autotile A1–A4.
Callback effect chỉ là đường truyền lệnh;
có callback không có nghĩa lệnh đã được triển khai. Audio chưa xử lý pan stereo.
Kiểm tra Chrome chạy cả entry chính và preview, xác nhận preview không nạp mã
runtime cũ và phát được OGG thật.

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
