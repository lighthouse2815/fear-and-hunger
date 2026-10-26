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

1. Combat: action sequence trong sáu nhóm note, WeaponSkill, animation vũ khí,
   phản phép/thế thân, TP khi nhận damage, thoát trận, lượt thêm theo AGI và
   trigger cuối trận. Đối chiếu phần thưởng và số thành viên tham chiến.
   Hiện action effect, số lần lặp, action animation, wait animation, death break,
   motion wait cơ bản và WeaponSkill đã được đối chiếu với 560 skill/item; các
   phase còn lại vẫn cần kiểm tra trực quan theo từng skill có note đặc biệt.
2. Menu: đội hình, trang bị và các lựa chọn
   Chế tạo item/weapon/armor theo recipe và ingredient note đã chạy trong menu,
   kiểm tra bạc/nguyên liệu và save số lần chế tạo; cần đối chiếu thêm recipe
   dùng tên thay vì ID và custom synthesis effect.
   menu theo cấu hình gốc; hoàn thiện lưu/tải nhiều ô và tùy chọn người chơi.
3. Bản đồ: di chuyển mượt, follower/guest và touch, fog/overlay, parallax, tiếng
   bước chân, âm thanh stereo và nhạc trận. Chỉ đánh dấu xong sau khi xác minh.
4. Điều khiển: phím gọi common event, đặt lại phím và thao tác trên điện thoại.
5. Luồng chính: Map072 trước tiêu đề, chơi mới/tiếp tục, nội dung kết thúc,
   cheat theo tên và cập nhật server/build/check khi chuyển entry chính.
6. Quét nội dung toàn bộ, kiểm tra các nhánh đại diện và loại các giả định chỉ
   đúng trong fixture. Cập nhật README để chỉ rõ kết quả và giới hạn còn lại.

## Đã đối chiếu

- Các mã lệnh xuất hiện trong JSON đều có nhánh interpreter; 401/405/505 là
  dòng tiếp nối. Cần kiểm chứng handler thực thi, không chỉ đếm nhánh.
- Hiệu ứng skill/item thực tế dùng 21/22/43/44; engine đã có luồng tương ứng.
- 169 map không có encounter ngẫu nhiên. Enemies.json không cấp EXP, gold hoặc
  drop tự động; vật phẩm và tiến trình chiến thắng được xử lý qua sự kiện.
- State 15/22 có modifier `b.hp - 1`; state 22 có animation thêm 22.
- State 23 buộc crit trong Select rồi khôi phục trong Deselect. Engine thực thi
  hiệu ứng theo từng đích, không dùng eval hay cờ crit toàn cục.
- CriticalControl gốc đứng trước DamageCore nên phần khởi tạo bị bỏ qua.
  Engine giữ crit gấp ba như runtime thực tế; sửa hiệu ứng Vulnerable bị hỏng.

Tài liệu này là danh sách nghiệm thu đang cập nhật, không phải tuyên bố mọi
nhánh cốt truyện đã được kiểm thử.
