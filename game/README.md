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
Phím T đốt đuốc qua common event 289, C dùng Phase qua common event 257. Các
nút **Đốt đuốc**/**Kỹ năng** gọi cùng luồng trên điện thoại. Z xác nhận/tương tác,
X hủy/mở menu; phím tắt chỉ chạy trên bản đồ khi không có sự kiện đang chờ.
Tab **Tùy chọn** chỉnh âm lượng tổng và từng nhóm, dùng WASD hoặc tự gán/bỏ
phím cho từng hành động. Cấu hình được lưu riêng trong trình duyệt và giữ khi
tải lại trang; đặt lại bàn phím không đổi âm lượng. Âm lượng tổng và từng nhóm
điều chỉnh 0–100%, giữ nguyên mức đã lưu khi chơi bình thường. Giảm âm lượng
xuống 5% chỉ nằm trong phiên kiểm thử; Chrome test tắt đầu ra loa nhưng vẫn
xác minh giải mã, phát OGG và âm lượng thật.
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
Sương đọc 138 khối `<fog effect>` từ note map, dùng PNG trong `img/fogs/` với
zoom, opacity, blend, hue, chiều sâu và chuyển động. Tiền tố `$` hiện cả trong
trận, `%` chỉ trong trận, `!` bám tọa độ map. Save giữ offset sương; chuyển map
nạp cấu hình của map đích. Picture giao diện nằm phía trên sương.
Parallax thường đứng yên theo màn hình và lặp kín vùng nhìn; nền tiền tố `!`
bám map. Trục bật loop cuộn theo nửa tốc độ camera cộng tốc độ trong JSON;
lệnh 284 đổi nền/cờ/tốc độ. Save giữ offset và chuyển map đặt lại nền đúng map.
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
Guard và hiệu ứng thêm state/common event từ JSON. Số đòn lấy từ phase action
sequence sau khi note ghi đè mặc định: Attack chạy một effect, Pummel hai effect
trên mỗi đích, Mad rush năm effect. Skill/item không ghi đè phase giữ repeats JSON. Lệnh 339 ép quái theo index hoặc nhân vật
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
không tick lại. Ngoài bản đồ, cứ 20 bước đi bộ thành công sẽ chạy cùng hiệu ứng
và cập nhật thời lượng state như một lượt. Va tường, menu, route cưỡng chế và
phương tiện không tăng nhịp này. Save giữ tổng bước, tiến trình xóa state theo
`removeByWalking`/`stepsToRemove` và kết quả tick; dữ liệu save cũ bắt đầu ở 0 bước.
Flash đỏ và thanh trạng thái báo mất HP khi đi bộ. HP cập nhật trước event chạm;
nếu cả đội bị hạ theo cấu hình slip death thì mở game over và không chạy event
ở ô đích. Biến sự kiện đọc được tổng bước qua toán hạng dữ liệu 7/3.
Engine chạy phase setup/whole/target/follow/finish theo thứ tự dữ liệu. Effect
được áp tại đúng lệnh, tách khỏi bước trả MP/TP/item; wait animation và wait frame
giữ hành động đến khi xong. Attack đặt effect trước wait, kỹ năng mặc định đặt
effect sau animation. Phản công chạy sau từng effect, trước effect tiếp theo;
death break kiểm tra chủ thể. Common event chạy cuối hành động. Hủy dọn các wait
và animation còn dở, không áp effect muộn. IMMORTAL mặc định giữ đích sống ở
0 HP qua các effect, chặn death state rồi xác nhận chết trước common event cuối
action. Hành động lồng nhau giữ bộ đếm riêng, hủy luôn giải phóng bảo vệ. Phần
hiển thị motion vẫn cần đối chiếu tiếp trước khi chuyển entry chính.
Danh sách nghiệm thu toàn bộ được theo dõi tại [engine/MIGRATION.md](engine/MIGRATION.md).
Modifier của Terror/Critical state đọc công thức số học trong note và chạy sau
damage/Guard/cap, giữ đích ở 1 HP theo `b.hp - 1`. Nhận damage xóa state theo
JSON. Vulnerable buộc chí mạng cho skill cho phép crit, chỉ trong lần áp dụng
lên đúng đích; không thay cờ crit toàn cục và không chạy script khi AI chấm điểm.
State add/remove animation đọc note, không phát lại khi thêm state đã có hoặc
khi miễn nhiễm; save giữ tiến trình và rời trận dọn animation. Không eval note.
Taunt đọc note Physical/Magical/Certain từ state, nhân vật, class, trang bị và
quái. State 100/101 hút đòn đơn phù hợp về mục tiêu còn sống/đang hiện; nhiều
mục tiêu khiêu khích chọn ngẫu nhiên, đòn AI ngẫu nhiên vẫn dùng trọng số TGR.
Đòn cả đội/nhiều mục tiêu và hồi phục cùng phe không bị chuyển hướng. Bốn skill
39/62/99/304 có `<Bypass Taunt>` giữ cách chọn đích bình thường; các tag Ignore/Null
cũng được đọc trực tiếp. Taunt được kiểm tra lại khi thực thi lệnh, kể cả 339,
và hiện nhãn **Khiêu khích** trong UI. Save giữ state; rời trận dọn Taunt tạm.
Thế thân đọc trait 62/2 của Girl và các nguồn trait khác. Khi mục tiêu còn sống
có HP dưới 25% tối đa, người đỡ đầu tiên trong phe còn sống/đang hiện/cử động
được nhận đòn vật lý hoặc phép thay mục tiêu; certain hit bỏ qua thế thân.
Mỗi effect chọn lại người đỡ, damage/state/TP áp lên người thực sự nhận đòn.
Taunt chọn đích trước thế thân; phản công vẫn thuộc đích gốc theo plugin đang
dùng. Người dự bị không đỡ; 339 cùng luồng, save giữ báo cáo và log ghi tên người đỡ.
Phản đòn đọc trait CNT (22/6), gồm state 26/37: chỉ đòn vật lý kích hoạt,
mục tiêu nhận đòn gốc rồi phản công nếu còn sống và cử động được. Trượt/né đòn
gốc vẫn có thể phản công; chết hoặc bất động sau đòn sẽ hủy phản công. Mỗi lần
phản công đánh thường đúng một lần vào người tấn công, bỏ qua Taunt, không trả
MP/TP, không chiếm lượt AI và không sinh chuỗi phản công. Đòn lặp dừng nếu chủ
thể bị hạ. Lệnh 339 cùng luồng lượt đều chờ animation phản công; log hiển thị
kết quả và save giữ báo cáo mà không áp dụng sát thương lại.
Preview có nút **Menu** (hoặc Escape trên bản đồ): chọn nhân vật để xem chỉ số,
trạng thái, kỹ năng, túi đồ và đổi trang bị. Trang bị trao đổi với túi đồ và tôn
trọng loại trang bị/ô bị khóa. Vật phẩm dùng ngoài trận đọc công thức hồi HP/MP,
state, học skill và common event từ JSON; Blue vial trả vỏ chai và scroll dạy
đúng nhân vật được chọn. Khi menu mở, map/di chuyển/timer được tạm dừng.
Trong trận có thể chọn nhân vật, kỹ năng đã học hoặc Guard, mục tiêu quái/đồng đội.
Bốn người đầu trong party tham chiến; người dự bị và guest không vào hàng đợi
hay danh sách mục tiêu. Thay đổi party trong troop page cập nhật lại bốn vị trí.
Attack đọc `<skill_id>` của vũ khí: War scythe/Cursed war scythe dùng skill
281/293 đánh cả nhóm. Phạm vi, chi phí, khóa kỹ năng, tốc độ và AI đều dùng skill
thực tế; rối loạn vẫn chọn một đích theo phe. Lệnh 339 giữ ID skill chỉ định.
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
được giữ qua save.
Sau lượt thường, thành viên có AGI lớn hơn 150% AGI trung bình phe đối diện
được một lượt bổ sung. Chỉ thành viên đủ điều kiện được nhập lệnh hoặc chạy AI;
nếu chỉ địch đủ điều kiện, engine tự chạy lượt đó. Lượt bổ sung không tăng số
lượt, hồi tài nguyên hay tick thời lượng trạng thái; sau đó trở lại lượt thường.
UI dùng ảnh `exturn.png` có sẵn và ghi rõ lượt bổ sung. Save giữ quyền hành động
và lệnh đã chọn; lệnh cưỡng chế 339 vẫn chạy được ngoài danh sách đủ điều kiện.
TP đầu trận ngẫu nhiên 0–24 nếu không có trait giữ TP; Baby Demon giữ theo class.
Mỗi effect trúng cấp TP cho người dùng; nhận sát thương HP dương cấp TP theo tỷ
lệ HP tối đa và TCR, làm tròn từng hit. Trượt/né, mất MP và hồi HP không cấp TP
nhận damage. TP bị chặn ở 0–100, lưu/tải giữ đúng giá trị; rời trận xóa TP trừ
các thành viên có trait giữ TP.
Chạy thoát dùng tỷ lệ `0.5 × AGI trung bình đội / AGI trung bình troop` lúc mở
trận; thất bại tăng thêm 10 điểm phần trăm, hủy lệnh đã chọn và nhường một lượt
cho địch. UI báo thất bại; save giữ tỷ lệ đã tăng và trận khóa thoát không mất lượt.
Đồng đội có trait auto-battle (62/0) tự chọn Attack hoặc kỹ năng đang dùng được;
Moonless, Ghoul, Skeleton, Blood golem, Baby Demon và Buckman đọc flag từ dữ liệu
actor/class. Các nguồn trang bị/state cũng dùng chung cách đọc trait. AI chấm
điểm sát thương theo HP hiện tại của đích, hồi phục theo lượng HP còn thiếu,
cộng điểm đòn cả nhóm và nhân số lần đánh; dao động sát thương được đọc từ JSON,
không giả định chí mạng. Kỹ năng chỉ đổi MP/state không có điểm HP để AI chọn.
Chấm điểm không tiêu tài nguyên hay chạy hiệu ứng. Khi thực thi vẫn kiểm tra lại
MP/TP, khóa kỹ năng, vũ khí, chủ thể chết/bất động và mục tiêu ẩn/chết/Taunt.
Không có lựa chọn có điểm dương thì bỏ lượt. UI ghi **Tự chiến đấu**, khóa lệnh
tay và cho bắt đầu lượt khi cả đội tự động. Lệnh 339 thay hành động AI trong lượt;
save giữ flag và kết quả mà không áp dụng hành động lại. Rối loạn ưu tiên cách
đánh thường và chọn phe bên dưới.
Rối loạn đọc mức khóa lớn nhất trong state: mức 1 tự đánh địch (Rage/Bloodlust),
mức 2 chọn ngẫu nhiên một trong hai phe (Confusion/Brain flower), mức 3 đánh
đồng đội kể cả bản thân (Fascination). Đòn tự động dùng Attack, lặp/chi phí/khóa
kỹ năng theo JSON, chọn mục tiêu còn sống/đang hiện theo TGR và Taunt trong phe
đã chọn. Nhân vật rối loạn không cần nhận lệnh tay; cả đội rối loạn vẫn có thể
bấm **Bắt đầu lượt**. Trạng thái mới trước lúc thực thi đổi lệnh đã chọn thành
Attack và không tiêu vật phẩm cũ. Lệnh 339 và phản đòn giữ đích chỉ định.
Mức khóa 4 ưu tiên hơn rối loạn; Confused/Confused_enemy trong JSON thuộc mức này
nên không tự đánh. UI hiện phe có thể bị tấn công; hết state trả quyền chọn lệnh.
Sát thương HP dương có thể xóa state theo `removeByDamage`/`chanceByDamage`;
mất MP, hồi HP và sát thương bằng 0 không kích hoạt việc này.
Save giữ trạng thái, lượt và kết quả mà không chạy lại hành động đã xong.
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
Tab **Chế tạo** đọc recipe/ingredient từ note JSON của vật phẩm, vũ khí và giáp;
sách công thức phải có trong túi để mở công thức. Engine kiểm tra số lượng nguyên
liệu, bạc, trừ đúng một lần, cộng vật phẩm tạo ra và lưu số lần chế tạo. Công thức
và nguyên liệu bằng ID được giữ nguyên; dòng tên chưa có trong dữ liệu sẽ báo lỗi.
Lệnh game over/về tiêu đề dừng cả chuỗi common event đang gọi và hủy các sự kiện
nền đang chờ. Hai màn này dùng ảnh/nhạc có sẵn, cho chọn tải một trong 20 ô lưu
hoặc chơi mới. Tab **Hệ thống** của menu cũng lưu/tải 20 ô, hiển thị thời điểm,
map và tên đội hình; ô hỏng được báo riêng, không cản dùng các ô khác.
Party giữ guest actor riêng với đội chiến đấu; script `addGuestActor`/
`removeGuestActor` và điều kiện `hasGuestActor` cập nhật/đọc save. Follower và guest
đi theo vị trí người phía trước qua góc rẽ, không dời theo hướng nhìn. Lệnh 217
chờ cả nhóm tập hợp; ẩn follower bỏ va chạm với event. Save giữ vị trí và tiến
trình tập hợp; chuyển map đặt cả nhóm ở ô đích. Guest không vào menu hay hàng đợi chiến đấu.
Quái trigger 2 có comment `<follower touch>` cũng chạy sự kiện khi chạm đồng đội
đang hiện, dùng cùng scheduler và khóa sự kiện như khi chạm nhân vật dẫn đầu.
Chơi mới mở luồng chọn nhân vật độc lập từ Map010. Tải save trở lại map và tiếp
tục scheduler; ô lưu trống được báo ngay trên giao diện.
Tải map/save lỗi giữ map và trạng thái hiện tại nhất quán.
Audio dùng API trình duyệt có sẵn, đọc OGG với volume, pitch, stereo pan, fade, nhớ/phát tiếp
BGM và tạm dừng BGM khi phát ME. Cần tương tác bàn phím/chuột để mở âm thanh.
Thanh âm lượng cập nhật các âm đang phát, giữ volume của từng file.
Mỗi bước thành công phát SE theo region, terrain rồi mặc định; 122 note trong
Tilesets.json được giữ nguyên tên, volume và pitch. Quái/follower/guest giảm âm
theo khoảng cách và có pan; follower ẩn, event `<No Footsteps>` và người chơi
trên phương tiện không phát bước chân. Lệnh EnableFootsteps/DisableFootsteps
được lưu cùng trạng thái. Mẫu terrain lấy tại ô vừa bước tới.
Save preview dùng prefix `FNH_STANDALONE_PREVIEW:`, tách biệt save bản chính.

Đây chưa phải bản thay thế đầy đủ: combat, menu và một số hành vi sự kiện vẫn
cần hoàn thiện. Entry chính vẫn dùng runtime cũ. Các map hiện có không chứa autotile A1–A4.
Callback effect chỉ là đường truyền lệnh;
có callback không có nghĩa lệnh đã được triển khai.
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
