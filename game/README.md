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
Preview mặc định chọn sẵn Mercenary và layout 1 để kiểm tra. Mở
`/standalone.html?map=10&events=1` để chạy màn chọn bốn nhân vật, nhập tên và intro.

Preview hiện hỗ trợ di chuyển, một phần lệnh sự kiện, lưu/tải riêng và âm thanh.
Interpreter chạy được common event lồng nhau, vòng lặp có giới hạn thực thi,
điều kiện, biến ngẫu nhiên và self-switch. Test dùng thùng đồ event 39 trên Map074
để xác nhận nhận vật phẩm từ common event 52 và không nhận lại sau khi đã mở.
Lệnh hoặc loại điều kiện chưa triển khai sẽ báo lỗi cụ thể thay vì tự bỏ qua.
`engine/script-runtime.js` chuyển 1.082 biến thể script hiện có trong JSON thành
thao tác dữ liệu: đổi hình character/face/battler, đặt giới hạn HP, cấu hình chase
và vô hiệu hóa click trên bản đồ. Không dùng `eval`, không nạp runtime gốc.
Test quét và thực thi từng biến thể; hình và giới hạn HP được giữ khi sửa chỉ số
và qua save. Hệ di chuyển tự động dùng cấu hình chase để đuổi, tìm đường và quay
về vị trí ban đầu; chế độ `events=1` bật cả scheduler autorun/parallel của map
và common event.
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
Trận đấu vẽ nền battleback và sprite quái từ PNG, đặt từng bộ phận theo Troops.json
và xếp lớp theo tọa độ. Bộ phận ẩn hoặc đã chết không được vẽ. Khi không có nền
chỉ định, renderer làm mờ ảnh bản đồ hiện tại. Giao diện hiển thị HP/MP trong đội.
Luồng 301 chờ kết quả rồi chỉ chạy nhánh 601/602/603 tương ứng; trận thua bắt buộc
dừng event và mở màn game over. Combat còn thiếu cơ chế plugin mở rộng để thay entry chính.
Lệnh 337 phát animation trên quái bằng sprite sheet PNG hiện có: chọn một hoặc
toàn bộ mục tiêu còn sống/đang hiện, không chờ animation kết thúc. Frame, SE,
flash/ẩn sprite, vị trí đầu/giữa/chân/toàn màn hình và phản chiếu được xử lý trong
engine độc lập. Save giữ animation đang chạy; rời trận dọn animation trận và
tiếp tục animation bản đồ đã tạm dừng.
Các lệnh sự kiện 331–336, 340 và 342 đã đổi được HP/MP/TP, state, hồi phục, hiện
quái, biến hình và kết thúc trận. Thao tác giữ index thành viên trong troop,
tôn trọng miễn nhiễm state, đồng bộ trạng thái chết và lưu được qua save.
Điều kiện và biến sự kiện đọc được chỉ số/state của quái. Engine tự chọn page
trong Troops.json theo lượt, cuối lượt, HP nhân vật/quái và công tắc; các điều
kiện kết hợp bằng AND. Page chạy một lần, mỗi lượt hoặc theo điều kiện liên tục;
cờ đã chạy được giữ qua save. Interpreter hiện có xử lý nội dung page và common
event, khóa nút đánh/chạy trong lúc chờ. Hiệu ứng, Gab và picture tiếp tục chạy
trong trận; wait bản đồ được tạm dừng. Guard thật có thể thắng bằng page hạ đầu
và nhớ chân đã bị chặt. Lệnh chưa hỗ trợ trong page báo lỗi và dừng trận; không
tự bỏ qua. Sự kiện lặp liên tục có giới hạn để tránh treo trình duyệt.
Kỹ năng đọc công thức, phạm vi, lặp đòn, MP/TP, tỉ lệ trúng/né/chí mạng, nguyên tố,
Guard và hiệu ứng thêm state/common event từ JSON. Attack thực hiện đủ ba lần đánh
trong dữ liệu, không còn là một đòn đơn. Lệnh 339 ép quái theo index hoặc nhân vật
theo ID hành động, chọn mục tiêu chỉ định/ngẫu nhiên/mục tiêu trước, chạy cả khi
không đủ MP/TP nhưng bỏ qua chủ thể ẩn/chết. Event chờ animation và common event
xong mới tiếp tục; hủy event dọn animation và ngăn common event chạy muộn.
AI chọn kỹ năng từ actions trong Enemies.json theo điều kiện 0–6 (lượt, HP/MP,
state, level đội và switch), lọc chi phí/khóa kỹ năng/trạng thái không hành động,
và lấy ngẫu nhiên theo rating. Quái ẩn/chết hoặc không có hành động hợp lệ bỏ lượt.
Engine chạy animation, common event và kiểm tra troop page sau từng hành động;
quái không còn tự đánh cố định vào nhân vật đầu tiên. State có bộ đếm lượt, giữ
qua save/update actor; Guard hết sau lượt và state tạm được dọn khi rời trận.
Cuối lượt, engine cộng dồn trait hồi/mất HP/MP/TP từ nhân vật, class, trang bị
và state. Bleeding, Poisoned, Bleeding_enemy, Burning, Toxic và Tentacles gây
sát thương thật theo States.json. Tỉ lệ được nhân với HP/MP tối đa hoặc 100 TP,
làm tròn xuống và chặn giới hạn. `System.optSlipDeath=false` hiện có giữ ít nhất
1 HP; quái ẩn/chết và nhân vật chết không được tick. Trạng thái hết hạn sau khi
hiệu ứng cuối lượt đã chạy; giải độc trước đó ngăn tick ngay lượt đó. Log trận
hiện thay đổi tài nguyên cuối lượt; HP thay đổi được troop page đọc ngay và save
không tick lại. Chưa triển khai sát thương trạng thái theo bước đi ngoài trận.
Hiện mới chuyển hiệu ứng kỹ năng cơ bản trong JSON, chưa thay toàn bộ cơ chế
combat mở rộng trong note/plugin (counter, taunt, action sequence và state script).
Preview có nút **Menu** (hoặc Escape trên bản đồ): chọn nhân vật để xem chỉ số,
trạng thái, kỹ năng, túi đồ và đổi trang bị. Trang bị trao đổi với túi đồ và tôn
trọng loại trang bị/ô bị khóa. Vật phẩm dùng ngoài trận đọc công thức hồi HP/MP,
state, học skill và common event từ JSON; Blue vial trả vỏ chai và scroll dạy
đúng nhân vật được chọn. Khi menu mở, map/di chuyển/timer được tạm dừng.
Trong trận có thể chọn nhân vật, kỹ năng đã học hoặc Guard, mục tiêu quái/đồng đội.
Kỹ năng chưa học hoặc thiếu MP/TP bị từ chối trước khi tiêu lượt; log hiện trượt,
né và sát thương. Chọn lệnh cho từng nhân vật bằng **Chọn đánh**, **Chọn kỹ năng**
hoặc **Chọn vật phẩm**, xem/sửa/bỏ lệnh trong danh sách rồi bấm **Bắt đầu lượt**.
Engine chờ đủ các thành viên còn hành động được; nhân vật chết hoặc bị khóa hành
động không cần chọn. Lệnh hai phe được sắp theo AGI, dao động tốc độ, speed của
kỹ năng/vật phẩm và trait tốc độ đánh. Troop page được kiểm tra sau từng lệnh;
cả đội chỉ tăng một lượt và cập nhật state cuối lượt một lần. Chủ thể chết,
bị khóa hoặc đã hành động cưỡng chế sẽ bỏ lệnh thường; mục tiêu chết được chọn
lại trong cùng phe. Kết quả thắng/thua dừng phần hàng đợi còn lại. Chọn/sửa/bỏ
lệnh không trừ MP/TP/item; số item giữ chỗ được kiểm tra chung cả đội, lựa chọn
được giữ qua save. Chưa có AI cho đồng đội bị confusion/auto-battle.
Trong trận, chọn loại hành động **Vật phẩm**, vật phẩm trong túi và mục tiêu rồi
bấm **Chọn vật phẩm**, sau đó xác nhận cả lượt. Item dùng chung luồng sát thương/animation/common event
với kỹ năng, trừ số lượng đúng một lần, không trừ MP/TP. Bộ lọc occasion giữ các
vật phẩm chỉ dùng trên bản đồ khỏi trận. Blue vial trả chai qua common event,
White vial giải độc; Murky/Purple vial áp damage/state lên mục tiêu trong JSON. Lệnh 351/352 chờ đóng menu/lưu rồi mới tiếp tục event.
Lưu từ menu trở về scene bản đồ, giữ stack common event, vị trí lệnh, nhánh và
vòng lặp của event đang gọi menu. Tải save tiếp tục từ sau lệnh menu, giữ khóa
điều khiển đến khi event xong. Book of enlightenment có thể lưu giữa common
event rồi tiếp tục hội thoại, dọn picture và switch sau khi tải. Vật phẩm chỉ
dùng được khi menu mở ngoài sự kiện.
Trong tab **Kỹ năng** của menu, nhân vật ở đầu menu là người thi triển; chọn
mục tiêu riêng trong đội rồi bấm **Dùng** hoặc **Dùng cho cả đội**. Healing whispers
hồi các thành viên còn sống, Loving whispers hồi đúng mục tiêu. Skill từ trang
bị/trait cũng dùng được; MP/TP, Silence, loại vũ khí và occasion được kiểm tra
như combat. Kỹ năng hồi phục không thể dùng vào mục tiêu đã đầy tài nguyên nếu
không có hiệu ứng hữu ích khác. Chi phí/hiệu ứng dùng chung luồng với combat.
Hồi phục trực tiếp giữ menu mở và cập nhật chỉ số; kỹ năng có common event đóng
menu để chạy hội thoại/lựa chọn, khóa di chuyển đến khi xong. Simple transmutation
chạy common event 186 thật, đổi bread hoặc water vial theo lựa chọn. Save từ menu
trong common event tiếp tục sau lệnh lưu, không trả chi phí kỹ năng lần nữa.
Lệnh game over/về tiêu đề dừng cả chuỗi common event đang gọi và hủy các sự kiện
nền đang chờ. Hai màn này dùng ảnh/nhạc có sẵn, cho tải ô lưu 1 hoặc chơi mới.
Chơi mới mở luồng chọn nhân vật độc lập từ Map010. Tải save trở lại map và tiếp
tục scheduler; ô lưu trống được báo ngay trên giao diện.
Tải map/save lỗi giữ map và trạng thái hiện tại nhất quán.
Audio dùng API trình duyệt có sẵn, đọc OGG với volume, pitch, fade, nhớ/phát tiếp
BGM và tạm dừng BGM khi phát ME. Cần tương tác bàn phím/chuột để mở âm thanh.
Thanh âm lượng cập nhật các âm đang phát, giữ volume của từng file.
Save preview dùng prefix `FNH_STANDALONE_PREVIEW:`, tách biệt save bản chính.

Đây chưa phải bản thay thế đầy đủ: combat, menu và một số hành vi sự kiện vẫn
cần hoàn thiện. Entry chính vẫn dùng runtime cũ. Các map hiện có không chứa autotile A1–A4.
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
