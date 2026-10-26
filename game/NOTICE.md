# Nguồn gốc nội dung

Mã runtime RPG Maker MV, các plugin và tài nguyên Fear & Hunger 1.4.1 được nhập từ
bộ game có trong workspace để phát triển bản web. Header tác giả và thông tin của
từng plugin được giữ trong các file JavaScript tương ứng. Nguồn gốc nhập được ghi
trong `source-info.json`.

Các chỉnh sửa web gồm tương thích trình duyệt, lưu localStorage, tự vào menu,
hộp thoại phía dưới và cài đặt âm thanh. Các sửa lỗi gameplay và dữ liệu được ghi
trong lịch sử Git của dự án.

Engine viết lại trong `engine/` sử dụng Pixi 4.5.4 từ `js/libs/pixi.js` và khối
thư viện MIT `pixi-filters` 2.7.0 đã đi kèm plugin FilterController. Khối thư viện
được giữ nguyên trong `engine/vendor/pixi-filters.js`, kèm header giấy phép;
bộ điều khiển filter của engine mới không nạp plugin FilterController.
Xem `engine/vendor/README.md` để biết nguồn và phạm vi tái sử dụng.
