# FNH Engine — engine web độc lập cho Fear & Hunger 1.4.1

Đây là một **engine web viết mới**, đọc trực tiếp dữ liệu, hình ảnh và âm thanh từ thư mục
`www` của bản **Fear & Hunger 1.4.1** mà bạn sở hữu. Engine không chạy runtime RPG Maker
MV, không dùng `rpg_core.js`/`rpg_managers.js`, và không sao chép asset vào repo.

Menu và phần mở đầu đọc asset/event từ bản cài gốc:

```text
Splash → New Game / Continue
  → chọn một trong bốn nhân vật → đặt tên
  → cảnh báo nội dung → phim giới thiệu
  → chọn chế độ → xem hoặc bỏ qua câu chuyện xuất thân
  → cổng ngục (bản đồ 74)
```

Bố cục tiêu đề, thẻ nhân vật, khung cửa sổ, tên menu, lời thoại và mô tả chế độ dùng
asset/dữ liệu gốc. Các lựa chọn xuất thân chạy qua interpreter và áp dụng kỹ năng,
vật phẩm, trang bị, switch/biến thật; không nhảy thẳng vào encounter Guard thử nghiệm.
Continue vẫn đọc slot lưu của engine web. Bản mở đầu đã được kiểm tra với câu chuyện
Cahara và đường bỏ qua xuất thân của D'arce, Enki, Ragnvaldr, gồm ba chế độ thường.
Dungeon Nights giữ điều kiện mở khóa của dữ liệu gốc.

Phần chiến đấu vẫn có **vertical slice thử nghiệm riêng**: bản đồ 1 → Guard →
thắng/thua → lưu và đọc. Bộ smoke test khởi tạo riêng encounter này sau khi kiểm tra
mở đầu; menu New Game không còn dẫn trực tiếp vào encounter thử nghiệm.

Đây chưa phải bản chuyển toàn bộ game. Xem [Phạm vi](#phạm-vi) và
[Giới hạn](#giới-hạn) bên dưới.

Mục tiêu phát triển là chuyển toàn bộ game gốc sang engine web độc lập. Có thể kiểm kê
dữ liệu cài đặt để xác định phạm vi cần hỗ trợ:

```sh
npm run audit:fnh-engine
npm run audit:fnh-engine -- --game "/đường/dẫn/tới/www"
```

Công cụ chỉ đọc và xuất thống kê JSON: bản đồ, trang event, common event, battle event,
loại lệnh/điều kiện/toán hạng và tên plugin đang bật. Không chạy mã plugin, không xuất
lời thoại, tham số plugin hoặc sao chép asset. Thống kê dữ liệu đầu vào **không phải**
phần trăm hoàn thành hay bằng chứng các tính năng đã tương thích.

Bản cài 1.4.1 hiện được kiểm tra có 169 bản đồ, 27.715 event, 61.536 trang event bản đồ,
315 common event, 220 troop, 2.404 trang battle event, 89 loại lệnh trên cả ba nguồn và
48 plugin đang bật. Để xác nhận hoàn thành cần kiểm chứng cả luồng chơi và kết quả
của các hệ thống dưới đây với bản gốc:

| Hệ thống | Trạng thái hiện tại |
| --- | --- |
| Asset, nhạc, tạo nhân vật, lưu/đọc | Có trong bản chơi thử, cần kiểm chứng toàn bộ nội dung |
| Bản đồ | Nạp JSON và một phần tileset; còn autotile, event di chuyển, va chạm và môi trường |
| Event | Có interpreter, autorun và parallel bản đồ/common event; còn nhiều lệnh, script và plugin |
| Hội thoại | Có nội dung nhiều dòng và lựa chọn; còn định dạng, chân dung, điều kiện lựa chọn plugin |
| Chiến đấu | Chỉ trận Guard đơn giản; chưa có mô hình và công thức đầy đủ của game gốc |
| Nhân vật, tổ đội, kỹ năng, trang bị | Chưa tương thích đầy đủ |
| Đói, tinh thần, trạng thái, bộ phận cơ thể | Chưa tương thích đầy đủ |
| Cốt truyện, kết thúc, các chế độ chơi | Chưa kiểm chứng xuyên suốt |
| Plugin, hiệu ứng, video, giao diện và âm thanh theo vị trí | Chưa tương thích đầy đủ |

> **Quan trọng:** repo không chứa asset của Fear & Hunger. Thư mục
> `Fear.and.Hunger.v1.4.1/` đã nằm trong `.gitignore`. Bạn cần tự mua/sở hữu bản game gốc.

## Yêu cầu

- **Node.js 18+** để chạy máy chủ (chỉ dùng module có sẵn của Node).
- **Node.js 22+** nếu chạy smoke test trình duyệt, vì bài test dùng `WebSocket` toàn cục.
- **Chrome/Chromium** cho bài test tự động. Trình duyệt hiện đại có Canvas 2D và Web Audio
  để chơi thủ công.
- Thư mục game gốc đặt đúng vị trí mặc định:

  ```text
  Fear.and.Hunger.v1.4.1/
    Fear.and.Hunger.v1.4.1/
      www/
        data/
        img/
        audio/
        fonts/
  ```

  Có thể trỏ tới thư mục `www` ở nơi khác bằng `--game` hoặc `FNH_GAME_ROOT`.

## Chạy

Từ thư mục repo:

```sh
npm run fnh:engine        # http://127.0.0.1:8139/
npm run fnh:engine:open   # tự mở trình duyệt
```

Game tự tải rồi hiện splash và tiêu đề ở kích thước 816×624, tự thu nhỏ nếu màn hình
không đủ chỗ. Âm thanh được mở khóa khi người chơi nhấn phím hoặc chuột lần đầu;
không có trang chào riêng trước splash.

Chạy trực tiếp máy chủ:

```sh
node tools/fnh-engine/server.js
node tools/fnh-engine/server.js --open
node tools/fnh-engine/server.js --game "/đường/dẫn/tới/www"
node tools/fnh-engine/server.js --port 8139 --host 127.0.0.1
```

| Tuỳ chọn | Ý nghĩa |
| --- | --- |
| `--game <thư mục>` | Thư mục `www` hoặc thư mục game chứa `www`. Mặc định là bản 1.4.1 trong repo. |
| `--port <số>` | Cổng HTTP, mặc định `8139`. |
| `--host <địa chỉ>` | Địa chỉ lắng nghe, mặc định `127.0.0.1`. |
| `--open` | Mở trình duyệt sau khi máy chủ chạy. |
| `--help` | In trợ giúp. |

Biến môi trường tương đương: `FNH_GAME_ROOT`, `FNH_ENGINE_PORT`, `FNH_ENGINE_HOST`.

Máy chủ phục vụ:

- ứng dụng trong `fnh-engine/` tại `/`;
- thư mục `www` gốc tại `/game/` (chỉ đọc, không sửa);
- `GET /__fnh-engine/health` để kiểm tra trạng thái.

Có hỗ trợ `Range` cho âm thanh và chặn truy cập ra ngoài hai thư mục gốc.

## Điều khiển

| Phím | Việc |
| --- | --- |
| Mũi tên / `WASD` | Di chuyển, chọn menu |
| `Enter` / `Z` / `Space` | Xác nhận, hành động, đối thoại |
| `Esc` / `X` | Tạm dừng, quay lại |
| `M` | Bật/tắt âm thanh |
| Chuột | Chọn menu, nhấp thẻ nhân vật |

Trong trận đấu: `↑`/`↓` chọn **TẤN CÔNG**, **PHÒNG THỦ** hoặc **BỎ CHẠY**, rồi `Enter`.

## Phạm vi

- **Bốn nghề chơi được**, dùng chân dung và ảnh mô tả gốc:
  - Cahara — Mercenary
  - D'arce — Knight
  - Enki — Dark Priest
  - Ragnvaldr — Outlander
- **Bản đồ 1 của encounter thử nghiệm** (`level1_A`, tileset `Inside`), xuất phát tại `(27, 67)`.
- **Mở đầu gốc** dùng bản đồ 10, 73 và cổng ngục 74; điểm bắt đầu đọc từ `System.json`.
- **Guard** đứng tại `(27, 64)`, dùng đủ 7 bộ phận battler gốc.
- Trận Guard thử nghiệm có 3 lệnh, 320 HP, thưởng 35 vàng và 20 EXP.
- Thành viên sống lần lượt hành động trước lượt Guard; mục tiêu dựa trên TGR,
  phòng thủ theo từng người, restriction bất động làm mất lượt, trạng thái cập nhật
  cuối hành động/cuối vòng. Chỉ thua khi toàn đội chết; EXP được chia cho từng actor.
  Đây vẫn chưa phải AI/bộ phận chiến đấu đầy đủ của bản gốc.
- Menu kỹ năng/vật phẩm có lọc occasion, chọn mục tiêu sống/chết, chi phí MP/TP,
  tiêu thụ đồ và hồi sinh. Attack dùng công thức database; engine hỗ trợ các công
  thức số hằng và `a.atk * 4 - b.def * 2` đang có trong bản cài được kiểm tra, gồm
  accuracy/evasion, critical, variance, element, physical/magical rate, guard,
  HP/MP damage/recover/drain, thêm/xóa state, học skill và common event. Common event
  của hành động chạy trong trận, có thể chờ hội thoại và áp dụng vào tổ đội. Hiệu ứng
  chưa hỗ trợ báo lỗi trước khi trả chi phí. Chưa có action sequence/plugin battle.
- Thắng, thua (màn hình chết) và bỏ chạy đều có đường quay lại game.
- **20 ô lưu** trong `localStorage`:
  - khoá: `FNH_ENGINE:<namespace>:save1` đến `save20`;
  - namespace mặc định `default`, đổi bằng `?fnh_engine_ns=...` khi test;
  - Continue mở danh sách File ở màn hình tiêu đề; điểm lưu event mở danh sách 20 File.
  Save cũ ở `save1` vẫn được đọc như trước.
- Hình ảnh, tileset, battleback, nhân vật, khuôn mặt và âm thanh đều đọc từ bản gốc.

## Kiến trúc

```text
fnh-engine/
  index.html              khung canvas + trạng thái tải
  css/engine.css          giao diện ngoài canvas
  js/core.js              hằng số, Input, Storage, Transition, Scene, helper vẽ
  js/assets.js            nạp/giải mã ảnh và âm thanh RPG Maker MV
  js/audio.js             Web Audio: BGM, BGS, SE
  js/data.js              đọc JSON gốc, tạo nhân vật, tile, encounter
  js/interpreter.js       con trỏ event, nhánh, lựa chọn, chờ, common event
  js/game.js              vòng lặp, chuyển cảnh, preload, lưu/đọc
  js/scene_title.js       tiêu đề
  js/scene_creation.js    chọn nghề
  js/screen_effects.js    tint, fade, flash, shake và trạng thái hiệu ứng
  js/move_route.js        interpreter cho lệnh di chuyển event/người chơi
  js/scene_map.js         bản đồ, di chuyển, va chạm, menu tạm dừng
  js/scene_battle.js      trận đấu theo lượt
  js/scene_gameover.js    màn hình chết
  js/main.js              khởi động ứng dụng

tools/fnh-engine/server.js       máy chủ app + /game/
tests/fnh-engine-smoke.js        smoke test Chrome/CDP
```

### Giải mã asset

Engine đọc `data/System.json` để lấy `encryptionKey`, sau đó tự giải mã:

1. bỏ 16 byte header giả của tệp `.rpgmvp` / `.rpgmvo`;
2. XOR 16 byte đầu với key;
3. phần còn lại là PNG/OGG thật.

Nếu ảnh không mã hoá, loader thử tiếp tệp `.png`. Không dùng lớp `Decrypter` của RPG Maker
MV. Ảnh được giải mã vào `Blob` URL rồi nạp vào `Image`; âm thanh được giải mã qua
`AudioContext.decodeAudioData` và chỉ giải mã khi thực sự cần phát.

### Dữ liệu gốc được dùng

`System.json`, `Actors.json`, `Classes.json`, `Weapons.json`, `Armors.json`,
`Enemies.json`, `Troops.json`, `Tilesets.json`, `MapInfos.json`, `CommonEvents.json`
và JSON bản đồ đang mở.
Chỉ số nhân vật lấy từ class + trang bị gốc ở level khởi đầu. Tile passability lấy từ
`Tilesets.json`; thứ tự vẽ tôn trọng cờ upper-layer `0x10`.

### Event interpreter

`js/interpreter.js` thực thi event theo từng frame, với con trỏ và nhánh riêng cho mỗi
common event. Có hỗ trợ nhánh điều kiện lồng nhau, lựa chọn (kể cả hủy), hội thoại nhiều
dòng chờ xác nhận, chờ theo frame, vòng lặp/thoát vòng lặp, nhãn và gọi common event.
Trong hội thoại dùng `Z`/`Enter`; dùng mũi tên để chọn câu trả lời. Di chuyển và menu
tạm dừng bị khóa trong lúc event đang chạy.

Các lệnh thay đổi switch, biến (hằng số/biến/ngẫu nhiên), self-switch, vàng, vật phẩm,
chuyển bản đồ và SE được thực thi tại vị trí của chúng trong luồng event. Self-switch
được tách theo bản đồ; khóa save cũ chỉ được đọc lại ở bản đồ 1. Hình ảnh event được
chọn lại theo điều kiện sau khi thực thi xong. Cửa chạm chỉ chạy từ trang đang hoạt động.
Điều kiện trang event xét cả vật phẩm và nhân vật chính đang có. NPC ở cùng lớp với
nhân vật chặn di chuyển trừ khi được đánh dấu xuyên qua. Nhấn hành động chỉ chạy event
hành động ở phía trước hoặc dưới chân; event chạm chạy khi đi vào hoặc va chạm.

Biến cũng đọc được dữ liệu game: số lượng vật phẩm, chỉ số nhân vật chính, tọa độ/hướng
và vị trí màn hình của nhân vật/event, ID thành viên trong tổ đội một người hiện tại,
ID bản đồ, số thành viên, vàng và thời gian chơi. Những dữ liệu chưa có mô hình tương
ứng (nhân vật ngoài tổ đội, timer, số trận, v.v.) được báo chưa hỗ trợ.

Đây chưa phải interpreter đầy đủ của MV. Điều kiện hiện hỗ trợ switch, biến,
self-switch, vàng, vật phẩm/vũ khí/giáp (có tùy chọn tính trang bị đang mặc), nhân vật
chính có trong tổ đội, hướng nhân vật/event và nút đang giữ (Shift, xác nhận/hủy,
hướng, PageUp/PageDown). Điều kiện nút đọc trạng thái giữ thay vì chỉ frame nhấn đầu. Lệnh 126–128 cộng/trừ riêng từng loại
trong túi, kể cả khi trùng ID; tùy chọn trừ cả trang bị đang mặc lấy số còn thiếu
từ thành viên tổ đội và tính lại chỉ số. Lệnh 319 đổi/tháo đồ theo slot, trao đổi với
túi chung, xét quyền loại trang bị và tương thích save cũ chưa ghi slot.
Lệnh hoặc điều kiện chưa hỗ trợ sẽ dừng event, hiển thị
thông báo và lưu lỗi vào `FNH.game.lastError`, thay vì chạy tiếp các hệ quả sai.
Có autorun bản đồ (trigger 3) và common autorun (trigger 1, điều kiện switch),
chạy trước điều khiển người chơi và chờ hội thoại như event
thường. Lệnh Erase Event (214) ẩn event và bỏ va chạm cho tới khi tải lại bản đồ; không
ghi trạng thái xóa vào save. Trang autorun gặp lệnh chưa hỗ trợ được dừng và không tự
thử lại cho tới khi tải lại bản đồ, tránh lặp thông báo lỗi mỗi frame.
Common autorun dùng ngữ cảnh event ID 0, không ghi self-switch hoặc xóa event bản đồ.
Có parallel event bản đồ (trigger 4) và common parallel (trigger 2, điều kiện switch).
Mỗi event có con trỏ, nhánh, thời gian chờ và ID ngữ cảnh riêng. Parallel tiếp tục chạy
khi event chính đang chờ; đổi trang, xóa event hoặc tắt switch common parallel sẽ hủy
interpreter tương ứng. Event hoàn tất lặp lại từ frame sau. Menu tạm dừng đóng băng cả
các event nền. Save từ lệnh 352 giữ continuation của event đang mở điểm lưu; các
interpreter nền khác được tạo lại khi tải bản đồ.
Các event dùng chung một khung thoại; event khác chờ tới lượt, và người chơi chỉ bị khóa
di chuyển khi có hội thoại hoặc event chính đang chạy. Lỗi một event nền không dừng
các event còn lại; trang lỗi không thử lại trong lần tải bản đồ đó.
Lệnh Set Event Location (203) hỗ trợ tọa độ hằng số/biến, đổi chỗ hai nhân vật và đổi
hướng. Vị trí runtime được dùng cho hình ảnh, va chạm, tương tác và biến tọa độ event;
JSON gốc không bị sửa. Vị trí NPC được tạo lại khi tải bản đồ, chưa ghi vào save.
Set Movement Route (205) có interpreter riêng cho từng mục tiêu (người chơi, event ID
hoặc event hiện tại), kèm chờ hoàn tất và dòng tiếp nối 505. Hỗ trợ các lệnh route 0–44:
bước thẳng/chéo, tiến/lùi, ngẫu nhiên, tới/gần hoặc tránh người chơi, nhảy, chờ, quay,
switch, tốc độ, animation, khóa hướng, xuyên qua, ẩn/hiện, đổi hình, opacity, blend và SE.
Di chuyển nội suy theo thời gian, kiểm tra va chạm hai đầu bước đi; có repeat/skippable.
Route vẫn chạy khi event chính đang chờ và đóng băng trong menu tạm dừng. Xóa event
hủy route; lệnh định vị hủy nội suy để tránh kéo hình về tọa độ cũ. Script route (45)
bị từ chối trước khi khởi chạy, không thực thi mã tùy ý hoặc bỏ qua lỗi.
NPC hỗ trợ moveType 0–3: đứng yên, ngẫu nhiên, tới gần người chơi và lộ trình custom.
Tần suất quyết định thời gian đứng chờ; NPC xa màn hình không bắt đầu bước mới.
Lệnh cưỡng chế tạm ngắt và giữ con trỏ lộ trình tự động, sau đó tiếp tục từ vị trí cũ.
Tương tác khóa NPC, quay mặt về người chơi và khôi phục hướng khi hội thoại kết thúc;
lệnh định vị/cưỡng chế giữ hướng mới do kịch bản đặt. Event chạm (trigger 2) có thể
khởi động khi NPC đi tới người chơi. Đổi trang/xóa event hủy lộ trình tự động cũ.
Lỗi route tự động báo một lần trên trang hiện tại, trang mới vẫn được chạy. Chưa có
bản đồ cuộn vòng; vị trí và con trỏ lộ trình NPC vẫn được tạo lại khi tải bản đồ.
Hiệu ứng màn hình hỗ trợ Fadeout/Fadein (221/222), Tint (223), Flash (224) và Shake
(225), bao gồm nội suy và tùy chọn chờ của event. Tông màu, độ sáng và hiệu ứng đang
chạy theo game khi chuyển bản đồ/trận đấu, được lưu/đọc cùng save; save cũ dùng ánh
sáng mặc định. Hiệu ứng áp dụng lên cảnh, không làm rung hoặc đổi màu HUD/hội thoại.
Menu tạm dừng đóng băng thời gian hiệu ứng. Chưa có weather.
Ảnh sự kiện hỗ trợ Show/Move/Rotate/Tint/Erase Picture (231–235), tọa độ hằng số/biến,
tâm ảnh, tỉ lệ, opacity, blend, thứ tự ID và chờ chuyển động/đổi màu. Ảnh đọc từ asset
gốc, được lưu/đọc cùng trạng thái chuyển động; ảnh map và battle dùng phạm vi riêng.
Ảnh được vẽ trên cảnh và dưới HUD/hội thoại; màu ảnh giữ vùng trong suốt. Menu tạm
dừng đóng băng chuyển động ảnh. Chưa hỗ trợ picture plugin. Picture trong battle event dùng cùng interpreter.
Plugin hội thoại nền hỗ trợ GabText, ShowGab, ForceGab, ClearGab và WaitForGab:
hàng đợi không khóa di chuyển, chống lặp nội dung, force thay hàng đợi, clear xóa ngay,
wait chờ toàn bộ hàng đợi. Nội dung soạn nằm riêng trên từng interpreter để các event
parallel không ghi đè nhau. Hàng đợi tạm thời không ghi vào save; thời lượng dùng mặc
định plugin (90 frame + 4 frame/ký tự), chưa đọc tham số tùy chỉnh, hình đại diện và
định dạng escape code. Plugin khác vẫn báo lỗi rõ ràng, không bỏ qua lệnh.
Event nhân vật hỗ trợ Change HP/MP/TP (311/312/326), Recover All (314), học/quên kỹ
năng (318), đổi tên/hình/biệt danh/tiểu sử (320/322/324/325). Chọn actor bằng ID hoặc
biến; ID 0 áp dụng tổ đội một người hiện tại. Actor ngoài tổ đội có trạng thái riêng và
được lưu/đọc cùng save. Kỹ năng ban đầu lấy từ learning của class ở cấp khởi đầu.
Điều kiện actor hỗ trợ tên, class, kỹ năng và trang bị; biến đọc được chỉ số actor đã
khởi tạo. Tổ đội hỗ trợ thêm/bớt và khởi tạo actor qua lệnh 129, giữ thứ tự thành viên, chuyển
trưởng nhóm, vị trí/túi đồ chung, điều kiện trang event và biến thành viên. ID actor 0
áp dụng cho toàn đội. Danh sách tổ đội và trạng thái nhân vật được lưu/đọc; save cũ
mặc định tổ đội một người. Có thể tạo tổ đội trống trong kịch bản. Chưa có follower
trên bản đồ hoặc menu formation. Trạng thái actor đọc từ States.json: thêm/xóa (313), điều kiện state, chết/hồi sinh,
hồi phục toàn bộ, miễn nhiễm, restriction, tham số trait (21), xparam (22), sparam (23),
đếm lượt và số bước trước khi hết trạng thái. Bonus chỉ số (317) được lưu và cộng trước
trait multiplier. Chưa có đầy đủ hiệu ứng do plugin, buff/debuff hoặc kỹ năng do plugin tùy biến.
Script event 355/655 hỗ trợ một tập API literal: đổi ảnh character/face/battler của
actor, refresh người chơi, setValue switch/biến bằng hằng số. Đoạn nhiều dòng được
kiểm tra toàn bộ trước khi thay đổi trạng thái; câu lệnh hoặc biểu thức ngoài tập này
báo chưa hỗ trợ. Không dùng eval hoặc tải runtime MV. Âm thanh event hỗ trợ BGM/BGS play/fade (241/242/245/246), lưu/phát lại BGM
(243/244), SE play/stop (250/251), gồm volume 0, pitch và stereo pan. Phát lại nhạc
khôi phục vị trí; đổi tham số cùng bản nhạc không khởi động lại từ đầu. Lệnh dừng
hủy cả yêu cầu decode đang chờ để âm thanh không tự phát lại sau đó. BGM đã ghi nhớ
được lưu cùng save. Bản đồ đọc cấu hình autoplay BGM/BGS từ JSON gốc. Chưa có ME
và âm thanh theo vị trí từ plugin.
Lệnh hệ thống hỗ trợ khóa/mở lưu và menu (134/135), ẩn/hiện người chơi (211), mở menu
và đợi đóng (351), Game Over/về tiêu đề (353/354). Khóa lưu được kiểm tra ở cả menu
và API lưu; các cờ này đi cùng save. Nhân vật hết HP chuyển màn hình chết khi event
đã hoàn tất; event vẫn có thể tiếp tục hội thoại hoặc hồi phục trước thời điểm đó.
Timer (124) hỗ trợ bắt đầu/dừng, hiển thị đếm ngược, điều kiện timer và toán hạng
biến dữ liệu timer. Timer đóng băng trong menu, lưu/đọc cùng save và thoát trận hiện
tại khi hết giờ. Hết giờ chỉ xử lý một lần, không tự đặt lại hoặc xóa giá trị khi dừng.
Nhập số (103) có chọn/sửa từng chữ số và xác nhận ghi vào biến, giới hạn 1–8 chữ số.
Chọn vật phẩm (104) lọc itypeId từ database và túi đồ, hiển thị tên/số lượng, xác nhận
trả ID hoặc hủy trả 0; không tự tiêu thụ vật phẩm. Cả hai dùng chung khóa hội thoại với
các event khác và khóa điều khiển di chuyển cho tới khi đóng.
Plugin choice_text/disable_choice hỗ trợ đổi nội dung và khóa đáp án theo số thứ tự
1-based của lựa chọn kế tiếp. Chỉ số nhánh gốc được giữ nguyên; con trỏ bỏ qua đáp án
khóa, xác nhận không nhận đáp án khóa, đường hủy vẫn hoạt động nếu được phép. Thiết
lập được tiêu thụ sau một bảng lựa chọn; bảng không có đáp án mở lẫn đường hủy báo
lỗi thay vì làm kẹt input. Chưa hỗ trợ công thức JavaScript của các plugin lựa chọn.
Chưa có JavaScript tùy ý,
script move route và các plugin command khác,
định dạng escape code của hội thoại hoặc chân dung trong khung hội thoại.

### Trận đấu từ event

Battle Processing (301) chọn troop trực tiếp, qua biến hoặc từ encounterList theo
region và trọng số. Interpreter chờ kết quả rồi thực thi đúng nhánh 601/602/603/604;
quay lại cùng cảnh bản đồ và con trỏ event, không khởi chạy lại event. Có cờ cho phép
bỏ chạy/thua, hồi sinh người gục khi được phép thua, khôi phục nhạc bản đồ.
Lệnh 132 đổi nhạc các trận sau và được lưu cùng flags; tên trống tắt nhạc trận,
volume/pitch/pan giữ theo event thay vì ghi đè database. Lệnh 283 đổi hai lớp
phông nền trận trên bản đồ hiện tại; trận lấy nền từ event hoặc metadata bản đồ,
giải mã cả hai lớp và lưu override cùng save. Đổi sang bản đồ khác xóa override.
Troop đọc thành viên, HP/MP/chỉ số/traits, tọa độ và sprite từ database gốc. Mỗi mục
tiêu có HP riêng; chọn một hoặc nhiều mục tiêu và chỉ thắng khi hết enemy hiện diện.
AI xét điều kiện lượt, HP, MP, state, cấp tổ đội và switch rồi chọn theo rating; từng
enemy còn sống hành động. Phần thưởng EXP/vàng và drop đọc từ enemy gốc. Trận Guard
320 HP vẫn là encounter thử nghiệm riêng.

Trang sự kiện troop dùng chung interpreter hội thoại và common event, xét điều kiện
lượt, cuối lượt, HP enemy/actor và switch; span chạy một lần trong trận, mỗi lượt
hoặc lặp lại khi điều kiện còn đúng. Các lệnh 331/332/333/334/335/342 thay đổi
HP/MP/state, hồi phục, xuất hiện và TP của một hoặc cả nhóm enemy. Điều kiện enemy
và toán hạng dữ liệu enemy đọc trạng thái runtime. Lệnh 336 biến hình cập nhật chỉ số, sprite, AI và phần thưởng, giữ vị trí cùng
trạng thái hiện tại; 340 kết thúc trận và trả về nhánh thoát. Lệnh 339 ép actor hoặc
enemy dùng kỹ năng, chọn mục tiêu chỉ định/ngẫu nhiên/gần nhất và chờ hành động
trước khi interpreter tiếp tục. Thay đổi tổ đội (129) trong trận đồng bộ danh sách
thành viên, giữ lượt đã dùng và chuyển người điều khiển khi actor rời nhóm. Lệnh 337 phát animation từ `Animations.json`, giải mã
hai sprite sheet, dựng cell theo frame 15 fps với scale/góc/mirror/hue/blend, phát SE
và flash/ẩn mục tiêu theo timing. Lệnh 212 tái sử dụng bộ dựng này trên nhân vật/NPC
bản đồ, bám theo tọa độ runtime và chờ cả tải asset lẫn vòng đời hiệu ứng khi bật wait. Chưa hỗ trợ đầy đủ plugin chiến đấu; cơ chế này chưa xác nhận toàn bộ cốt truyện chơi xuyên suốt.

## Kiểm chứng

```sh
npm run check:fnh-engine   # node --check toàn bộ JS mới + server + test
npm run test:fnh-engine    # smoke test đầy đủ
```

Bài test sẽ:

1. khởi động máy chủ tạm trên cổng ngẫu nhiên;
2. kiểm tra route, asset mã hoá gốc, HTTP Range và chặn traversal;
3. mở Chrome headless, chờ splash và tương tác để mở âm thanh;
4. kiểm tra tiêu đề, Web Audio, nhạc nền, giải mã ảnh/SE;
5. tạo nhân vật, kiểm tra 4 nghề và chân dung;
6. vào bản đồ 1, di chuyển tới Guard, đánh thắng;
7. lưu game, tải lại trang, Continue từ localStorage;
8. thua một trận, kiểm tra màn hình chết và đọc lại save;
9. dọn save test và kiểm tra không có lỗi runtime/console mới.

Nếu thiếu thư mục game hoặc Chrome, bài test in **BỎ QUA** và trả mã 0. Đặt `CHROME_BIN`
nếu Chrome không nằm trong `PATH`. Đặt `FNH_KEEP_SHOTS=1` để giữ ảnh chụp trong thư mục
tạm và in đường dẫn.

## Giới hạn

- Đã nối menu và các bản đồ mở đầu; combat vẫn có **một encounter Guard thử nghiệm**. Chưa có toàn bộ bản đồ, cốt truyện,
  hội thoại, inventory, kỹ năng, vật phẩm, cấp máu từng bộ phận hay hệ thống đói/kinh hoàng.
- Các event hình ảnh trên bản đồ được vẽ để giữ không khí, nhưng **chưa chạy event command**
  gốc đầy đủ; chỉ tập lệnh mô tả ở mục Event interpreter được thực thi.
  Guard encounter vẫn là kịch bản riêng của vertical slice.
- Trận đấu là bản đơn giản hoá: một nhân vật, một kẻ địch, ba lệnh; chưa mô phỏng đầy đủ
  công thức, trạng thái, vũ khí và animation của bản gốc.
- Đã phát video intro gốc. Chưa có âm thanh môi trường theo vị trí, Steamworks, thành tựu hay save
  NW.js.
- Chất lượng giải mã/âm thanh phụ thuộc codec của trình duyệt.
- Đây là dự án phi thương mại, chỉ dành cho người đã sở hữu bản game gốc.

## Giấy phép và asset

Mã nguồn engine nằm trong repo này. **Asset của Fear & Hunger không được cấp phép lại**
và không được đưa vào repo. Xem [`LICENSE`](../LICENSE) của repo.

### EXP, cấp và nghề

Lệnh 315/316 thay đổi EXP/cấp theo actor trực tiếp, biến hoặc toàn tổ đội. Đường cong
EXP đọc từ `Classes.expParams`, cấp giới hạn bởi `Actors.maxLevel`; lên cấp học các
kỹ năng trong `learnings`, giảm cấp giữ kỹ năng đã học. Chỉ số được tính lại mà không
tự hồi đầy HP/MP. Cờ hiển thị của event thông báo cấp/kỹ năng mới qua toast.
Lệnh 321 đổi nghề, lưu EXP riêng từng class hoặc mang EXP hiện tại sang nghề mới;
trang bị không còn hợp lệ được trả vào túi chung. Lịch sử EXP nằm trong dữ liệu actor
và được lưu cùng save. Save cũ cấp cao nhưng EXP bằng 0 được chuẩn hóa khi tải để
tránh tụt cấp khi nhận thưởng. Thưởng EXP chiến thắng dùng cùng logic cập nhật cấp/kỹ năng.

### Đổi tileset bằng event

Lệnh 282 tải các sheet đang được bộ dựng bản đồ sử dụng, rồi đổi đồng thời ảnh và
flags va chạm của tileset. Interpreter chờ tải asset trước lệnh tiếp theo; lỗi tải
ảnh giữ tileset cũ và được báo qua cơ chế lỗi event. Yêu cầu tải mới hơn có quyền
ưu tiên nếu nhiều event cùng đổi tileset. Override được lưu cùng flags, khôi phục
khi đọc save và bỏ khi chuyển sang bản đồ khác; database bản đồ không bị sửa.

### Thời tiết

Lệnh 236 hiển thị mưa, bão hoặc tuyết trên bản đồ, chuyển cường độ trong số frame
được chỉ định và cho interpreter chờ nếu bật wait. Tắt thời tiết có thời gian sẽ
giảm dần loại hiện tại tới 0. Hạt bám theo tọa độ thế giới khi camera di chuyển;
hiệu ứng nằm dưới picture/HUD và không hiển thị trong trận. Trạng thái cùng thời
gian chuyển còn lại được lưu/đọc với screen effects; menu tạm dừng đóng băng hiệu ứng.

### Đặt tên nhân vật

Lệnh 303 mở ô nhập tên chuẩn của trình duyệt cho actor được chỉ định, với tên hiện
tại và giới hạn ký tự từ event. Hỗ trợ nhập tiếng Việt/IME, không chấp nhận tên rỗng;
Enter hoặc nút xác nhận cập nhật actor rồi cho interpreter tiếp tục. Giao diện giữ
khóa hội thoại, tạm dừng bản đồ/hiệu ứng/timer và ngăn phím nhập tên điều khiển game.
Đổi scene đóng giao diện, trả điều khiển và không ghi tên chưa xác nhận. Lệnh này
không mở trong trận đấu. Tên được lưu cùng dữ liệu actor như các thay đổi actor khác.

### Nhạc hiệu và nhạc thắng trận

Lệnh 249 phát ME từ thư mục `audio/me`, giữ volume/pitch/pan từ event. Nhạc nền tạm
dừng và được phát tiếp từ vị trí đã lưu khi ME kết thúc hoặc bị dừng bằng tên trống.
BGM yêu cầu trong lúc ME đang phát được hoãn lại và thay bài chờ phát tiếp; dừng BGM
hoặc dừng tất cả ngăn nhạc cũ tự phát lại. Yêu cầu ME tải chậm không ghi đè yêu cầu
mới; lỗi tải trả quyền phát cho BGM. Lệnh 133 đổi nhạc hiệu chiến thắng, được lưu
cùng flags. Trận troop phát cấu hình này hoặc `System.victoryMe` đúng một lần và
dừng ME khi quay lại bản đồ trước khi khôi phục âm thanh bản đồ. Mở trận cũng dừng
ME bản đồ để tránh nhạc hiệu phát chồng lên nhạc chiến đấu.

### Văn bản cuộn

Lệnh 105 gom các dòng 405 và cuộn chúng qua toàn bộ khung nhìn, giữ dòng trống và
xuống dòng theo chiều rộng thực tế bằng bộ dựng hội thoại hiện có. Tốc độ đọc từ
event; giữ xác nhận, Shift hoặc chuột tăng tốc ba lần trừ khi bật no-fast. Enter
không bỏ qua đoạn văn. Interpreter chỉ chạy tiếp sau khi dòng cuối ra khỏi màn hình;
khóa hội thoại dùng chung ngăn event khác chen vào. Cơ chế dùng được trên bản đồ và
trong battle event, giữ nguyên vị trí khi scene tạm dừng.

### Điểm lưu từ event

Lệnh 352 mở danh sách 20 File khi chạy luồng gốc; Enter lưu vào File được chọn,
Esc hủy. Encounter thử nghiệm giữ giao diện lưu cũ. Event chờ người chơi đóng màn hình; lỗi ghi dữ liệu giữ màn hình để thử lại
hoặc hủy. Điểm lưu do event mở được phép lưu khi menu lưu bị khóa, giữ nguyên cờ khóa;
lệnh không mở trong trận đấu. Save này lưu con trỏ và nhánh của event, các frame common
event đang gọi cùng ngữ cảnh event ID. Tải lại tiếp tục ngay sau lệnh mở lưu, kể cả
các lệnh bật lại menu lưu hoặc đổi self-switch, và không mở lại màn hình lưu. Save cũ
không có continuation vẫn tải như trước. Event nền mở điểm lưu không chạy trùng phần
đã lưu khi continuation còn hoạt động; các event nền khác khởi tạo lại từ bản đồ.

### Video từ event

Lệnh 261 phát video gốc trong `movies` bằng trình phát chuẩn của trình duyệt, với
nguồn WebM/MP4, điều khiển phát và trạng thái tắt âm hiện tại. Event giữ khóa hội
thoại và chờ sự kiện kết thúc thật; tên trống không mở video. Nếu trình duyệt chặn
autoplay, người chơi dùng nút phát của trình video. Lỗi tải/codec dừng event và báo
lỗi thay vì chạy các lệnh phía sau. Phím điều khiển game được khóa trong lúc phát;
đổi scene (kể cả thoát battle common event) dừng phim, hủy tải và dọn phần tử media.

Bài kiểm tra Chromium phát intro tuần tự đến hết rồi xác nhận event chạy tiếp. Trong
môi trường kiểm thử, tua thẳng tới sát cuối intro từng trả lỗi giải mã; trường hợp
này được xử lý như lỗi video, không giả vờ phim đã kết thúc thành công.

### Trình bày phần mở đầu

Ván mới từ menu giữ bố cục khung thoại/choice gốc, hiển thị câu hỏi cùng lựa chọn,
đọc `ChoiceHelp`/`ChoiceMessage` và ẩn HUD thử nghiệm. `EnableWordWrap`/`DisableWordWrap`
điều khiển cách xuống dòng. Script khóa TouchInput của phần chọn nhân vật khóa click
trên canvas. Đặt tên dùng chân dung và bảng 9×10 ô theo bản gốc: mũi tên để chọn chữ,
Z/Enter để nhập, X/Esc để xóa, PageUp/PageDown đổi bảng, Shift chọn OK rồi Enter xác nhận. Khi về tiêu đề, chuột
được bật lại. Trạng thái trình bày được giữ trong save.

Các lệnh `EnableDashing`/`DisableDashing` điều khiển chạy bằng Shift. `Fire radius`,
`Light radiusgrow` giữ bán kính/màu ánh sáng trong trạng thái lưu; bản đồ có note ánh
sáng áp dụng mặt nạ quanh người chơi. `Light on/off` giữ ID đèn toàn cục và self-switch D
của event tương ứng. Đây chưa phải toàn bộ TerraxLighting hoặc các shader filter gốc;
xóa filter chưa tồn tại là thao tác hợp lệ, còn tạo filter chưa hỗ trợ vẫn báo lỗi.

### Menu theo bố cục bản gốc

Esc/X mở cột sáu biểu tượng Item, Eq, Synthesis, Sk, Options và Q. Cửa sổ tổ đội dùng
chân dung lớn cùng Hunger/Body/Mind; không còn nút lưu tự do trong menu của luồng gốc.
Hunger hiển thị EXP còn tới mốc kế tiếp theo cách menu gốc tính, Body/Mind đọc HP/MP.
Mũi tên chọn mục, Enter/Z xác nhận, Esc/X quay lại; PageUp/PageDown đổi nhân vật.

Item phân loại Item/Weapon/Armor/Books; kỹ năng lọc theo loại được actor cho phép.
Hành động dùng lại bộ thực thi chiến đấu nhưng kiểm tra occasion ngoài trận, trả chi
phí và tiêu thụ đồ thật. Common event đóng menu rồi tiếp tục trên bản đồ. Equip,
Optimize và Clear dùng cùng logic slot, quyền trang bị và túi đồ chung của engine.
Synthesis đọc note công thức trong đồ đang sở hữu, kiểm tra đủ toàn bộ nguyên liệu
và vàng trước khi trừ; lịch sử chế tạo được lưu trong flags.

Options có âm lượng Master/BGM/BGS/ME/SE riêng và Command Remember. Controls cho đổi
phím; cấu hình được lưu riêng dưới khóa `saveconfig` trong namespace hiện tại và tự
khôi phục khi tải trang. Filter shader và toàn bộ plugin menu gốc chưa được hỗ trợ.
Chế tạo hiện thao tác từng sản phẩm; giao diện chọn số lượng hàng loạt chưa có.
