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

1. Combat: kiểm tra các trận đại diện xuyên suốt nhánh cốt truyện khi chạy entry mới.
   Playback/số effect, sprite, popup và chuyển cảnh đã có đối chiếu riêng.
2. Menu: đối chiếu tiếp bố cục và thông tin các màn so với cấu hình gốc.
3. Điều khiển: kiểm tra thêm thao tác điện thoại xuyên suốt luồng chơi chính.
4. Luồng chính: kiểm tra các hành trình cốt truyện dài trên entry mới.
5. Quét nội dung toàn bộ, kiểm tra các nhánh đại diện và loại các giả định chỉ
   đúng trong fixture. Cập nhật README để chỉ rõ kết quả và giới hạn còn lại.

## Đã đối chiếu

- Tương tác bỏ trang event chỉ có lệnh kết thúc như Game_Event.start gốc: ô
  Map051 (36,63) có event 6 rỗng không che event 7 mở cửa, chọn Open chạy route
  của hai cánh và bật switch 22; chọn Leave giữ cửa. Unit và Chrome dùng JSON thật.
- Chrome chơi liên tục từ entry chính: chọn Mercenary, đặt tên, phát hết video
  intro, chọn Fear & Hunger và bỏ qua hồi tưởng, tới Map074 rồi đi qua cửa vào
  layout ngục theo biến 121. Không sửa switch hay chạy lại event; đây chưa phải
  kiểm thử cả hành trình tới kết thúc.
- Entry chính mở luồng khởi động engine độc lập; trang legacy giữ riêng để
  đối chiếu và mở save RPG Maker. Server/build nhận engine mới không cần runtime
  cũ, không chèn compat vào entry mới và vẫn đóng gói trang legacy.
- Luồng chơi dùng Force Dashing của TDDP_ManageDashing: luôn chạy, kể cả khi
  giữ Shift hoặc thiết lập cũ tắt tự chạy; map, trang bị/state và lệnh sự kiện
  cấm chạy vẫn ưu tiên. Ẩn tùy chọn đi bộ trong menu chơi, giữ trong preview.
- Encounter trình duyệt 60 frame theo q=((p-1)*20*p+5)*p+1, tâm zoom dùng
  tọa độ màn hình hiện có của nhân vật, snapshot map ẩn sprite. Flash frame
  2/10, fade đen từ frame 30 tới 54, rồi fade mở trận. Bắt đầu phát SE System
  số 7, BGM mới chờ 30 frame, BGM trùng bài map tiếp tục phát; giữ snapshot map và khôi phục khi hủy trước/sau
  mốc nhạc. Chrome dừng animation kiểm tra keyframe/thời lượng/mốc BGM/SE thật,
  hủy dọn cả zoom/flash/đen và không tiếp tục page hay rò âm thanh.
- Fade trình duyệt bằng Web Animations API: mở trận 24 frame trước troop page,
  kết thúc fade đen 24 frame (thua bắt buộc 48), hiện map 24 frame/game over
  48 frame trước event tiếp theo. Giữ khóa input, lỗi/hủy mọi pha dọn
  overlay/callback; pagehide dọn
  animation. Unit kiểm tra thứ tự/chờ/hủy, Chrome dừng giữa từng animation để
  xác nhận thời lượng/scene/khóa và hủy không kẹt đen.
  Nhạc trận giữ tới lúc rời scene rồi mới khôi phục BGM/BGS map; scheduler chờ
  fade cuối của autorun/parallel ở game over, dừng scheduler chủ động vẫn hủy.
- Thẻ từng đồng đội có icon trạng thái theo GALV_BustMenu (States=12), đọc
  IconSet.png 16 cột/ô 32px, sắp priority/ID và bỏ icon 0. Có tên truy cập,
  cập nhật thêm/xóa riêng từng actor; không đưa guest vào thẻ. Unit kiểm tra
  thứ tự/tên/save, Chrome kiểm tra vị trí sheet/kích thước/asset và hai actor.
- Nền trận không có battleback chụp map với sprite nhân vật/follower/NPC ẩn
  như startEncounterEffect gốc; giữ tile/sương/lớp map. Snapshot cache theo trận,
  không đổi transparent/followersVisible và rời trận vẽ sprite bình thường.
  Chrome so pixel ảnh map ẩn sprite, kiểm tra không gọi drawActor lúc chụp.
- MainMenuManager thật bật item/equip/synthesis/skill/options/gameEnd; không
  bật Formation hoặc Save, Hide Gold Window=true. Luồng có sự kiện giữ cấu
  hình này, bỏ nút lưu/tải nhanh; preview mặc định giữ công cụ kiểm tra.
  Lệnh 352/sách thật vẫn mở lưu 20 ô và chỉ hiện tab lưu; đóng rồi dọn common
  event bình thường. GameEnd hủy hoặc về title, giải phóng wait 351 và không
  chạy lệnh tiếp của event. Chrome kiểm tra sách/UI/lưu/title trên điện thoại.
- Weak của OctoBattle: đòn HP dương có rate nguyên tố >=1.1 thay popup số bằng
  chữ sheet Damage.png (ô 4, hàng 4, rộng ba ô). Theo trait thường/Attack và
  No Weak Popup; không tạo cho MP/hồi/0/Miss. Vị trí đọc PNG quái/frame actor,
  không stack/nảy; plugin trừ duration hai lần, hết frame 64, dịch X -0.04 ở
  tick đầu rồi đứng. Giữ asset/vị trí khi quái tan và qua save. Đối chiếu hàm
  gốc và 425 enemy có điểm yếu; Chrome so pixel/fade/hình học ở cả hai phe.
- Sau mỗi lệnh interpreter, actor combat được đồng bộ HP/MP/tên/đội trước lệnh
  tiếp theo, kể cả common event lồng nhau và lệnh cuối. Giữ object/motion,
  cập nhật UI khi page đang chờ thoại; 311/313 chết và 314 hồi ngay, không chốt
  thất bại giữa page. Âm chết một lần, IMMORTAL vẫn đợi xác nhận; save giữ callback.
  Chrome chạy page hạ actor, chờ thoại, hồi sinh rồi thoát trận.
- Nút hướng dùng Pointer Events/capture để giữ/thả, hủy chạm và mất capture;
  hỗ trợ nhiều ngón cùng hướng và bàn phím đồng thời. Blur/trang ẩn/mở menu
  dọn input. Giữ xung bấm nhanh cho sự kiện picture, không thêm bước từ click
  sau pointerup. Chrome phát touch thật ở viewport điện thoại, kiểm tra đi nhiều
  ô/dừng, nhiều ngón, phối hợp phím và chạm nhanh chọn Knight trong Map010.
- Chạy nguyên 11 trang kết thúc Map086 bằng điều kiện switch thật (A/B/C/D/E,
  C thứ hai, bốn S và nhánh S dự phòng); hình/thoại/Common310/achievement rồi
  game over, save giữ kết quả. Chạy Happy Map161, bốn Prom Map181 và đoạn sáu
  ảnh chữ Map159 chuyển đúng trang Ending A. Chrome chạy toàn bộ trang S Knight
  bằng UI thật, vẽ PNG, chờ credits, mở game over và khóa di chuyển/menu.
  Đây là kiểm tra các trang kết thúc và đường chuyển cuối, chưa chứng minh mọi
  hành trình từ đầu game tới kết thúc đều đã được chơi hết.
- IconSet.png xoay state quái mỗi 40 frame, ưu tiên/ID như runtime gốc,
  chặn mép trên và hiện số lượt theo BuffsStatesCore. State từ sự kiện/kỹ năng
  có thời lượng ngay lúc thêm; thêm lại đặt lại, lưu/tải không bốc số lại.
  Actor dùng States.png 96×96, tám pattern mỗi 8 frame, chọn overlay của state
  ưu tiên cao nhất (kể cả 0); hoạt động khi body trống/bị animation ẩn.
  Đối chiếu từng frame với runtime gốc, 50 state có icon/tám state có overlay,
  chết/ẩn/đổi state/frame lẻ/save/pause. Chrome so pixel sheet và chữ số lượt.
- MP damage của tám skill thật giới hạn theo MP hiện có như executeMpDamage
  gốc; báo cáo từng hit/tổng và popup không ghi dư sau khi cạn. Hồi MP vẫn
  hoạt động từ 0; Chrome kiểm tra skill 181 lặp đòn, 320 toàn đội và save.
- Popup dùng Damage.png thật cho HP/MP/hồi/0/Miss/né, đỏ chí mạng 60 frame,
  thời lượng 128 frame và fade cuối 10 frame; xếp chồng 0.9 chiều cao, popup
  cũ dời lên. Cú nảy so với hàm runtime gốc; giữ frame lẻ/tốc độ/vị trí qua save.
  Hit/Counter/phản phép/drain và regen cuối lượt tạo số trên đúng battler;
  state-only/menu/map không tạo popup giả, hủy trước effect không hiện số muộn,
  rời trận dọn popup. Chrome so pixel sheet, fade, alpha chí mạng và save.
- SE combat đọc System.sounds: Attack quái front view, HP trúng theo phe,
  physical miss, né vật lý/phép, hồi HP/MP, Counter, phản phép và actor chết.
  Mỗi effect phát một lần; MP damage/drain không phát SE HP hoặc blink; tiếng
  trúng trước tiếng chết, IMMORTAL đợi xác nhận chết. Chuẩn bị action/tải save
  không phát lại; scene map/tên rỗng giữ im lặng. Chrome giải mã hit_single,
  Attack3 và lurch_02 thật, dùng mức âm lượng của người chơi.
- Cast quái theo hitType 120/52/51, đợi xong mới chạy phase hành động; bỏ cast
  cho Attack/Guard/item và actor front view như cấu hình gốc. Note override và
  setup tùy chỉnh giữ quyền ghi đè. Attack của quái dùng animation 39, actor đọc
  animation vũ khí kể cả 0. Mirror theo đích actor thay vì phe thi triển, gồm
  tự đánh/đồng đội/phản phép/state. Wait theo toàn bộ animation trận, kể cả
  animation mới xuất hiện giữa lúc chờ và sau tải save; nhiều consumer cùng đợi
  được. Hủy dọn cast/wait; Chrome đối chiếu Pheromone 51 và đòn chính trên actor.
- Kết liễu theo trait collapse: thường mờ/nhuộm đỏ 32 frame, 26 enemy giữ xác
  (loại 3), sáu boss tan/cắt ảnh/rung theo chiều cao PNG thật. Cache kích thước
  không ghi cứng vào nội dung; lỗi PNG báo rõ. IMMORTAL xác nhận chết mới bắt
  đầu; hồi sinh hủy kết liễu, 335/hồi sinh hiện hình 16 frame và chờ hiệu ứng
  mới xong; hủy/title giải phóng wait. Save giữ tiến độ và không phát lại
  SE mở đầu; frame dài giữ đủ nhịp SE boss. Common event/trả quyền nhập lệnh
  chờ hiệu ứng xong. Chrome kiểm tra pixel và crop PNG; xác không tính là sống.
- Menu nhân vật dùng bust PNG theo faceName/faceIndex, HP/MP và Hunger theo
  `(EXP cấp sau - EXP hiện tại) / (EXP cấp sau - EXP đầu cấp)` của GALV_BustMenu.
  Chọn thẻ đổi actor chi tiết; không đưa guest vào menu. Hiện nickname/class,
  profile có escape tên/biến, EXP/trang bị và tám tỷ lệ state cấu hình gốc;
  trait kháng nhân chồng, miễn nhiễm bằng 0%, save/cấp tối đa đều kiểm tra.
- Menu trang bị lọc quyền dùng/loại/ô và món trong túi; ô bị lock/seal vô hiệu
  hóa. Vũ khí hai tay trả khiên về túi, tháo vũ khí mở lại ô; vòng nguyền giữ
  khóa. Tối ưu/tháo hết theo thứ tự ô, tổng tám params và ID khi hòa, không tháo
  ô khóa; chọn lại món đang dùng không cần bản sao. Unit quét 18 món lock/seal
  thật; Chrome thao tác Crude sword/khiên/Ring of the still-blood và hai nút.
- Sprite actor front view theo cấu hình gốc: bốn vị trí (102 + 204 × index,
  444), anchor 0.5/0.7, sheet 9×6 và frame 0/1/2/1 mỗi 12 frame. Motion
  Attack/skill/phép/item/Guard/trúng đòn/né và trạng thái/HP/chết đọc dữ liệu;
  vũ khí dùng System.attackMotions và WeaponsN.png. Save giữ motion/frame,
  hủy dọn action; quái ra đòn whiten 16 frame, mất HP blink 20 frame. Animation
  và flash/hide bám actor đúng vị trí/frame. Chrome so pixel PNG và sheet vũ khí.
- Phản phép theo trait MRF 22/5, chỉ magical hit; mỗi effect chọn lại, không
  phản dây chuyền hay thế thân. Damage/state/né dùng người thi triển làm đích,
  hút HP/MP trả người phản phép, chi phí/common event một lần. Chờ animation
  phản 42/note và animation gốc trả về caster; hủy/save/339 và UI đều kiểm tra.
  Quét actor/class/trang bị/enemy/state hiện tại không có trait MRF khác 0;
  các tình huống phản phép được kiểm tra bằng fixture rõ ràng.
- Touch dưới chân chờ sprite đi hết bước rồi mới đọc vị trí/page hiện tại;
  va chạm event ở trước mặt vẫn tức thời. Khóa bước/menu trong thời gian chờ,
  chuyển map/title hủy chờ và bỏ event cũ. Bộ đếm bước tăng khi bắt đầu, hiệu ứng
  trạng thái/flash tick cuối bước trước touch; save giữa bước giữ tick chưa chạy.
  Chrome kiểm tra frame cuối và cửa Map074 thật với common event Room_CHANGE.
- Save ngoài trận giữ BGM/BGS, vị trí, volume/pitch/pan và bookmark 243/244;
  tải dọn ME/SE/nhạc phiên cũ và khôi phục trước khi tiếp tục common event.
  Save im lặng không phát autoplay, save cũ dùng autoplay map, tải lỗi giữ nhạc
  hiện tại. Chrome tải từ title và phát OGG thật, không đổi âm lượng người chơi.
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
