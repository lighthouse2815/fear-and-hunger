# Thư viện filter

`pixi-filters.js` là bản MIT `pixi-filters` 2.7.0 đã có sẵn trong repository,
được tách nguyên khối thư viện khỏi `js/plugins/FilterController.js`.
Giữ thông báo bản quyền và giấy phép trong header. Không chứa bộ điều khiển
plugin, lớp RPG Maker hoặc bản Godray tùy biến của plugin.

Mã nguồn thư viện: https://github.com/pixijs/filters/tree/v2.7.0

Engine độc lập dùng `js/libs/pixi.js` 4.5.4 hiện có và thư viện này để thực thi
shader. `engine/filter-runtime.js` viết riêng việc đọc lệnh JSON, quản lý tham
số, thời gian, save và tài nguyên WebGL. Runtime và plugin RPG Maker không được
nạp bởi trang độc lập.
