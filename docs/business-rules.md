# Quy tắc nghiệp vụ hiện hành

Cập nhật ngày **10/09/2026**. Tài liệu mô tả hành vi đang có trong code; không tự bổ sung yêu cầu từ bản thiết kế lịch sử.

## Tài khoản và phân quyền

Có hai nhóm người gọi: `customer` và `user`. Tài khoản nội bộ có quyền `STAFF` hoặc `ADMIN`; tài khoản có trạng thái `ACTIVE` hoặc `LOCKED`.

- Customer quản lý hồ sơ, đổi mật khẩu và thao tác booking/payment của mình.
- ADMIN quản trị tài khoản nhân viên, danh sách/trạng thái khách hàng và danh mục.
- STAFF và ADMIN có các thao tác vận hành được controller cho phép; không mặc nhiên có quyền giống nhau.
- STAFF/ADMIN có thể đặt mật khẩu đầu tiên cho khách đủ điều kiện. Không dùng chức năng này để ghi đè mật khẩu đã thiết lập.
- Khi xác thực, máy chủ kiểm tra tài khoản, phiên bản token và quyền hiện tại trong MySQL.

Số điện thoại được chuẩn hóa trước khi tra cứu và lưu. Khách được tạo tại quầy có thể chưa có mật khẩu. Repo hiện không có luồng OTP/SMS xác nhận số điện thoại; bảng thử nghiệm cũ đã được migration loại bỏ.

Nguồn: [AuthModule](../src/module/auth/auth.module.ts), [CustomerCredentialService](../src/module/customer/customer-credential.service.ts), [CustomerAdminController](../src/module/customer/customer-admin.controller.ts).

## Loại phòng và tiện nghi

RoomType và Amenity có danh sách/chi tiết công khai và thao tác quản trị. Xóa danh mục dùng dấu thời gian xóa mềm; khôi phục và cập nhật vẫn phải tuân thủ ràng buộc trùng tên và tham chiếu.

- Giá cơ bản của loại phòng phải lớn hơn 0; sức chứa phải là số nguyên dương.
- Quan hệ tiện nghi đi qua `room_type_amenities`.
- Có cấu hình giường chuẩn hóa trong `room_type_beds` và trường cũ `room_types.bed_type`.
- Không gửi đồng thời hai cách mô tả giường trong cùng yêu cầu.
- Không tự xóa trường cũ hoặc đổi cách đọc dữ liệu cũ chỉ vì cấu hình mới đã tồn tại. Có lệnh kiểm tra và bổ sung dữ liệu giường, cần xem kết quả trước khi ghi.

Nguồn: [RoomType policy](../src/module/room-type/domain/room-type.policy.ts), [cấu hình giường](../src/module/room-type/bed-configuration.ts).

## Phòng và ảnh

Trạng thái phòng gồm `READY`, `OCCUPIED`, `CLEANING`, `MAINTENANCE`, `HIDDEN`.

- Chỉ ADMIN được chuyển tới hoặc rời trạng thái `HIDDEN`.
- Phòng có booking đã nhận phòng phải giữ `OCCUPIED`.
- Không đặt `OCCUPIED` nếu không có booking `CHECKED_IN`.
- Danh sách công khai không trả phòng `HIDDEN` hoặc `MAINTENANCE`; dữ liệu trả về được thu gọn so với màn hình quản lý.
- Khi nhận phòng, phòng chuyển sang `OCCUPIED`. Khi trả phòng, thông thường chuyển sang `CLEANING`, với các trường hợp bảo toàn trạng thái theo service.

Ảnh tải lên bị giới hạn **8 MiB**, **25 triệu điểm ảnh**; ảnh được kiểm tra nội dung bằng Sharp, xử lý thành WebP với cạnh tối đa **2560 px**, dùng tên do máy chủ tạo. Một phòng có ảnh cần có một ảnh đại diện. Đây là quy tắc do service bảo vệ và data audit kiểm tra, không phải unique constraint riêng trên `is_cover`.

Nguồn: [policy trạng thái phòng](../src/module/room/domain/room-status-transition.policy.ts), [cấu hình ảnh](../src/config/room-image-storage.ts).

## Lịch và khoảng lưu trú

Khoảng ngày là `[checkInDate, checkOutDate)`: gồm ngày nhận phòng, không gồm ngày trả phòng. Ví dụ từ 10/09 đến 12/09 chiếm hai đêm 10 và 11/09.

Mỗi phòng/mỗi đêm có tối đa một bản ghi `room_calendar`:

| Trạng thái | Điều kiện                  |
| ---------- | -------------------------- |
| `RESERVED` | Phải gắn với booking       |
| `BLOCKED`  | Không được gắn với booking |

Unique constraint `(room_id, stay_date)` là lớp bảo vệ cuối chống giữ trùng đêm. Luồng khóa lịch và đặt phòng đều dùng khóa Room để điều phối cạnh tranh. Tra phòng trống loại các phòng vướng bất kỳ đêm đã giữ hoặc bị khóa trong khoảng yêu cầu.

Ngày nghiệp vụ dùng múi giờ Việt Nam UTC+7. Một booking tối đa **90 đêm**. Ngày nhận phòng không được trong quá khứ và không vượt `BOOKING_MAX_ADVANCE_DAYS`; không áp mặc định dùng cho test vào cấu hình production.

## Tạo booking

Khách đặt trực tuyến và nhân viên tạo tại quầy dùng chung luồng điều phối nhưng khác quyền, cách xác định khách và một số điều kiện tiếp nhận.

1. Kiểm tra người gọi và chuẩn hóa dữ liệu. ID phòng được kiểm tra trước khoảng ngày trong mapper để giữ thứ tự trả lỗi khi nhiều trường cùng sai.
2. Nếu có `Idempotency-Key`, tạo định danh yêu cầu theo loại người gọi, ID người gọi, khóa và nội dung đã chuẩn hóa.
3. Yêu cầu đã có kết quả phù hợp được trả lại; không tạo booking hoặc ghi audit lần hai.
4. Với yêu cầu mới, xử lý Customer trước, khóa Room sau.
5. Kiểm tra khách, phòng/loại phòng, sức chứa, ngày và hạn mức áp dụng.
6. Tính tiền phía máy chủ từ số đêm và giá; lưu Booking, các đêm RoomCalendar và audit trong cùng transaction.

Booking mới có trạng thái `PENDING_PAYMENT`, tình trạng tiền `UNPAID` và thời hạn giữ chỗ. Tiền không lấy trực tiếp từ tổng tiền do frontend gửi.

Hạn mức khách trực tuyến dùng `BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER` và `BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER`. Không mặc định áp mọi hạn mức trực tuyến cho nghiệp vụ tại quầy.

Khóa chống lặp khi tạo booking là **tùy chọn**. Cùng người gọi, cùng khóa và cùng nội dung chuẩn hóa sẽ trả lại booking đã lưu; dùng lại khóa cho nội dung khác gây xung đột. Không đổi khóa khi chỉ gửi lại cùng thao tác vì mất phản hồi.

Nguồn: [BookingCreationService](../src/module/booking/booking-creation.service.ts), [mapper tạo booking](../src/module/booking/mappers/booking-creation.mapper.ts).

## Vòng đời booking

| Trạng thái hiện tại | Các trạng thái kế tiếp trong policy |
| ------------------- | ----------------------------------- |
| `PENDING_PAYMENT`   | `CONFIRMED`, `CANCELLED`            |
| `CONFIRMED`         | `CHECKED_IN`, `CANCELLED`           |
| `CHECKED_IN`        | `CHECKED_OUT`                       |
| `CHECKED_OUT`       | Không có bước tiếp theo             |
| `CANCELLED`         | Không có bước tiếp theo             |

Các chuyển đổi còn phải thỏa điều kiện:

- Booking trực tuyến chưa thanh toán không được xác nhận; booking do nhân viên tạo có ngoại lệ xác nhận khi chưa thu tiền.
- Nhận phòng phải đã thanh toán, ở trong khoảng lưu trú và phòng ở trạng thái `READY`.
- Booking đã thanh toán phải đi qua luồng hoàn tiền phù hợp trước khi hủy.
- Yêu cầu hoàn tiền đang chờ đối soát chặn các chuyển trạng thái liên quan; gửi lại trạng thái hiện tại được policy xử lý riêng.
- Hủy/hết hạn giải phóng các đêm đã giữ và xử lý payment trực tuyến còn chờ theo vòng đời.
- Tình trạng tiền `UNPAID`, `PAID`, `REFUNDED` độc lập với trạng thái lưu trú.

Nguồn: [BookingTransitionPolicy](../src/module/booking/domain/booking-transition.policy.ts), [BookingLifecycleService](../src/module/booking/booking-lifecycle.service.ts). Chi tiết hoàn tiền và callback nằm trong [luồng thanh toán](payment-flows.md).

## Những phần chưa triển khai

Không có trạng thái `NO_SHOW`, bảng `BookingCharge`, sổ cái, thanh toán từng phần hoặc API dashboard riêng trong cây mô-đun hiện tại. Tên migration `AddDashboardQueryIndexes` không chứng minh có API dashboard.

Bản phân tích lịch sử có đề xuất về khách không đến, thời điểm trả phòng thực tế và phụ thu trả muộn. Các nội dung này được giữ trong lưu trữ như yêu cầu/thiết kế cần xem xét, không được nhập vào mô tả hành vi đang chạy.
