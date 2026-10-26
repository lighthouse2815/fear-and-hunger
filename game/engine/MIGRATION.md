# Hoàn tất engine độc lập

Mục tiêu: nội dung JSON, PNG, OGG, font và video giữ nguyên; entry chính chạy
engine của dự án, không nạp runtime/plugin RPG Maker hoặc compat.js.
Không coi việc mở được preview hoặc có callback lệnh là hoàn tất chức năng.

## Điều kiện nghiệm thu

- Đối chiếu lệnh sự kiện, note và cấu hình plugin thực sự dùng trong nội dung.
- Luồng trước tiêu đề, chọn nhân vật, intro, khám phá, chiến đấu, menu, lưu/tải
  và kết thúc chạy được bằng engine mới; không bỏ qua lệnh chưa hỗ trợ.
- Nội dung note ảnh hưởng gameplay phải có kiểm thử với dữ liệu thật.
- Kiểm tra nguồn và bản đóng gói; Chrome xác nhận entry chính không tải mã cũ.
- Giữ nội dung và nguồn plugin để đối chiếu; mỗi phần hoàn tất commit/push riêng.

## Việc cần hoàn tất hoặc đối chiếu tiếp

1. Combat: thiết lập IMMORTAL trong action sequence, hiển thị motion/animation vũ khí,
   phản phép/thế thân, TP khi nhận damage, thoát trận, lượt thêm theo AGI và
   trigger cuối trận. Đối chiếu phần thưởng.
   Hiện thứ tự các lệnh playback và số effect trong từng phase đã được đối chiếu
   với 560 skill/item; vẫn cần kiểm tra trực quan phần thiết lập và kết thúc action.
2. Menu: đối chiếu đội hình, trang bị và các lựa chọn theo cấu hình gốc;
   hoàn thiện tùy chọn người chơi. Chế tạo item/weapon/armor theo recipe và
   ingredient note đã chạy trong menu, kiểm tra bạc/nguyên liệu và save số lần
   chế tạo; cần đối chiếu thêm recipe dùng tên thay vì ID và custom synthesis effect.
3. Bản đồ: di chuyển mượt và nhạc trận.
   Chỉ đánh dấu xong sau khi xác minh.
4. Điều khiển: đặt lại phím và đối chiếu thêm thao tác trên điện thoại.
5. Luồng chính: Map072 trước tiêu đề, chơi mới/tiếp tục, nội dung kết thúc,
   cheat theo tên và cập nhật server/build/check khi chuyển entry chính.
6. Quét nội dung toàn bộ, kiểm tra các nhánh đại diện và loại các giả định chỉ
   đúng trong fixture. Cập nhật README để chỉ rõ kết quả và giới hạn còn lại.

## Đã đối chiếu

- T/C gọi common event 289/257 thật trên bản đồ, có nút cho điện thoại, giữ
  khóa điều khiển khi chờ thoại và tôn trọng MP/switch; Z/X xác nhận/hủy.

- Các mã lệnh xuất hiện trong JSON đều có nhánh interpreter; 401/405/505 là
  dòng tiếp nối. Cần kiểm chứng handler thực thi, không chỉ đếm nhánh.
- Hiệu ứng skill/item thực tế dùng 21/22/43/44; engine đã có luồng tương ứng.
- 169 map không có encounter ngẫu nhiên. Enemies.json không cấp EXP, gold hoặc
  drop tự động; vật phẩm và tiến trình chiến thắng được xử lý qua sự kiện.
- Party chỉ đưa bốn người đầu vào trận, đồng bộ sau troop page; người dự bị
  còn sống không ngăn thất bại khi cả đội tham chiến bị hạ.
- WeaponSkill 36/37 dùng skill 281/293 cho Attack, gồm UI/chi phí/khóa/scope/AI/
  rối loạn/save; lệnh 339 giữ skill chỉ định như setSkill của runtime gốc.
- Sequence thực thi effect tại vị trí lệnh, đợi animation/frame, chạy phản công
  trước effect tiếp và common event cuối action. Death break kiểm tra chủ thể;
  hủy dọn wait/animation, không chạy effect muộn hay lặp action đã xong.
- State 15/22 có modifier `b.hp - 1`; state 22 có animation thêm 22.
- Follower/guest lưu vị trí, đuổi người phía trước, chặn event khi đang hiện;
  lệnh 217 chờ tập hợp, chuyển map/nhảy đặt lại vị trí. Không đưa guest vào combat.
- 1.533 page có comment `<follower touch>`: quái chạm follower đang hiện chạy
  sự kiện qua scheduler, không xếp trùng và không kích hoạt khi follower ẩn.
- Audio đọc pan JSON qua StereoPannerNode; giữ volume/pitch/fade và giải phóng
  graph khi dừng. Chrome đo năng lượng trái/phải từ OGG thật, tắt đầu ra loa test.
- 138 khối fog đọc PNG, zoom/opacity/blend/hue/depth; tiền tố map/battle/fixed,
  chuyển động và offset qua save/map. Chrome đối chiếu pixel, lớp picture và
  ghép sương cùng các bộ phận Guard.
- 23 map dùng parallax: nền thường đứng yên, nền ! bám map, loop/tốc độ/284,
  lặp kín vùng nhìn, tạm dừng trong trận và giữ offset qua save/chuyển map.
- Tiếng bước chân đọc 122 note terrain, ưu tiên region/terrain/mặc định; quái,
  follower/guest giảm âm theo khoảng cách, tôn trọng ẩn/No Footsteps/phương tiện,
  lệnh bật tắt giữ qua save. Volume vẫn nhân mức tổng 5%.
- Menu lưu/tải 20 ô, thông tin checkpoint và đọc ô được chọn từ game over/title;
  save trong common event giữ stack, ô hỏng không ngăn chọn các ô khác.
- State 23 buộc crit trong Select rồi khôi phục trong Deselect. Engine thực thi
  hiệu ứng theo từng đích, không dùng eval hay cờ crit toàn cục.
- CriticalControl gốc đứng trước DamageCore nên phần khởi tạo bị bỏ qua.
  Engine giữ crit gấp ba như runtime thực tế; sửa hiệu ứng Vulnerable bị hỏng.

Tài liệu này là danh sách nghiệm thu đang cập nhật, không phải tuyên bố mọi
nhánh cốt truyện đã được kiểm thử.
