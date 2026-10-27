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

1. Combat: hiển thị motion/animation vũ khí và phản phép.
   Hiện thứ tự các lệnh playback và số effect trong từng phase đã được đối chiếu
   với 560 skill/item; vẫn cần kiểm tra trực quan phần thiết lập và kết thúc action.
2. Menu: đối chiếu đội hình, trang bị và các lựa chọn theo cấu hình gốc;
   đối chiếu đầy đủ bố cục và thông tin của các màn menu.
3. Bản đồ: đối chiếu thêm thời điểm sự kiện chạm theo bước di chuyển.
4. Điều khiển: đối chiếu thêm thao tác trên điện thoại.
5. Luồng chính: đối chiếu tiếp âm thanh khi tải save, nội dung kết thúc
   và cập nhật server/build/check khi chuyển entry chính.
6. Quét nội dung toàn bộ, kiểm tra các nhánh đại diện và loại các giả định chỉ
   đúng trong fixture. Cập nhật README để chỉ rõ kết quả và giới hạn còn lại.

## Đã đối chiếu

- Nội suy sprite bước/chạy/chéo/lùi/route/AI/follower/guest; nhảy parabol, camera,
  ánh sáng/balloon/animation và toán hạng tọa độ màn hình dùng vị trí hiển thị.
  Collision giữ tọa độ ô, pause menu/trận, 203/chuyển map dọn motion; save giữa
  bước/nhảy giữ tiến độ. Chrome so pixel PNG giữa bước và sau tải save.
- Chế tạo che tên chưa biết bằng `?`, mở tên theo crafted/save, SE `fnh_choice2`,
  sắp ID và khóa ở 99 sản phẩm. Kiểm tra nguồn cùng loại, mất sách và đọc nguyên
  liệu chuẩn từ JSON khi craft. Toàn bộ 28 khối nguyên liệu thật dùng ID, không
  có recipe tên hoặc custom synthesis effect trong dữ liệu hiện tại.
- Cheat tên `lighthouse` đọc tên đã trim/không phân biệt hoa thường, luôn đầy HP,
  miễn death state và tăng đòn gây mất/hút HP trúng quái lên tối thiểu 9.999 sau
  modifier. Không tăng hồi phục/MP/đòn đồng đội hay cho quái cùng tên; đổi tên tắt.
  UI đặt tên/lệnh 320/chỉ số/state/save/339/tick đều kiểm tra; 353 kết thúc truyện
  vẫn chạy và dừng event như bình thường, không nạp FNH_NameCheat gốc.
- `standalone.html?title=1` chạy autorun Map072 thật: chờ/fade/giữ splash theo
  frame, 354 về title, khóa gameplay. Chrome so pixel PNG, Continue tải ô được
  chọn và New Game mở chọn nhân vật; về title không lặp splash trong cùng phiên.
  Chơi mới dùng System.optTransparent, save/preview giữ cờ được chỉ định.
- T/C gọi common event 289/257 thật trên bản đồ, có nút cho điện thoại, giữ
  khóa điều khiển khi chờ thoại và tôn trọng MP/switch; Z/X xác nhận/hủy.
- Tùy chọn âm lượng tổng/nhóm (0–100%, giữ cấu hình đã lưu), gán/bỏ phím, WASD và reset
  bàn phím giữ qua tải lại trang; preset/reset không đổi âm lượng.

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
- IMMORTAL giữ đích ở 0 HP đến hết sequence, chặn death state và xác nhận chết
  trước common event; bộ đếm giữ đúng action lồng nhau, hủy/save không để bất tử.
- TP cấp theo từng effect trúng và sát thương HP/TCR, khởi tạo 0–24 đầu trận,
  xóa cuối trận trừ trait Preserve TP (Baby Demon/class Buckman); save không
  khởi tạo lại. Trượt/né, mất MP và hồi phục không cấp TP nhận damage.
- Chạy thoát theo AGI trung bình hai phe lúc mở trận, cộng 0.1 sau thất bại,
  hủy lệnh và nhường lượt; UI báo kết quả, save giữ xác suất đã tăng.
- Galv_ExAgiTurn chọn thành viên cử động được có AGI >150% trung bình đối phương,
  xen kẽ lượt thường/lượt bổ sung; lượt thêm không tăng turn, hồi tài nguyên hay
  tick trạng thái. UI khóa thành viên không đủ điều kiện, AI chạy lượt chỉ có địch;
  Moonless tự chọn kỹ năng và save giữ lệnh/quyền hành động, 339 vẫn cưỡng chế được.
- Girl dùng trait thế thân 62/2 thật: mục tiêu dưới 25% HP, đòn không phải certain
  hit, người đỡ đầu tiên còn sống/hiện/cử động được trong đội tham chiến. Mỗi effect
  chọn lại người đỡ; damage/state/TP đi theo người nhận, phản công theo đích gốc;
  kiểm tra Taunt, phe địch, dự bị, 339/animation/hủy, UI và save không đánh lại.
- EndPhaseTriggers chạy hết các page hợp lệ, gồm page vừa mở ở 0 HP, trước khi
  chốt thắng/thua. Đợi thoại/phần thưởng, cho hồi sinh tiếp trận, ưu tiên thất bại
  khi hai phe cùng bị hạ; kiểm tra hủy/lỗi và Guard/Butterfly thật. Phần thưởng tự
  động của toàn bộ Enemies.json bằng 0; phần thưởng sự kiện không phát lại qua save.
- State 15/22 có modifier `b.hp - 1`; state 22 có animation thêm 22.
- Follower/guest lưu vị trí, đuổi người phía trước, chặn event khi đang hiện;
  lệnh 217 chờ tập hợp, chuyển map/nhảy đặt lại vị trí. Không đưa guest vào combat.
- 1.533 page có comment `<follower touch>`: quái chạm follower đang hiện chạy
  sự kiện qua scheduler, không xếp trùng và không kích hoạt khi follower ẩn.
- Audio đọc pan JSON qua StereoPannerNode; giữ volume/pitch/fade và giải phóng
  graph khi dừng. Chrome đo năng lượng trái/phải từ OGG thật, tắt đầu ra loa test.
- Nhạc trận dùng System hoặc 1.092 lệnh 132 với sáu tên thật (gồm rỗng), dừng BGS
  và giữ snapshot BGM/BGS map. Kết thúc phát tiếp vị trí/pitch/pan, ME và thua bắt
  buộc; save giữ snapshot, hủy dọn nhạc trận, không ghi đè lệnh nhớ BGM 243/244.
- 138 khối fog đọc PNG, zoom/opacity/blend/hue/depth; tiền tố map/battle/fixed,
  chuyển động và offset qua save/map. Chrome đối chiếu pixel, lớp picture và
  ghép sương cùng các bộ phận Guard.
- 23 map dùng parallax: nền thường đứng yên, nền ! bám map, loop/tốc độ/284,
  lặp kín vùng nhìn, tạm dừng trong trận và giữ offset qua save/chuyển map.
- Tiếng bước chân đọc 122 note terrain, ưu tiên region/terrain/mặc định; quái,
  follower/guest giảm âm theo khoảng cách, tôn trọng ẩn/No Footsteps/phương tiện,
  lệnh bật tắt giữ qua save. Volume nhân mức tổng người chơi đã chọn; test dùng mức 5% riêng.
- Menu lưu/tải 20 ô, thông tin checkpoint và đọc ô được chọn từ game over/title;
  save trong common event giữ stack, ô hỏng không ngăn chọn các ô khác.
- State 23 buộc crit trong Select rồi khôi phục trong Deselect. Engine thực thi
  hiệu ứng theo từng đích, không dùng eval hay cờ crit toàn cục.
- CriticalControl gốc đứng trước DamageCore nên phần khởi tạo bị bỏ qua.
  Engine giữ crit gấp ba như runtime thực tế; sửa hiệu ứng Vulnerable bị hỏng.

Tài liệu này là danh sách nghiệm thu đang cập nhật, không phải tuyên bố mọi
nhánh cốt truyện đã được kiểm thử.
