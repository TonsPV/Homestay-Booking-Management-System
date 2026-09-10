# Hợp đồng API

Cập nhật ngày **10/09/2026**. Nguồn đối chiếu là controller, DTO, guard và [đặc tả OpenAPI](../openapi/openapi.json), không phải danh sách API trong bản thiết kế cũ.

Đặc tả hiện có **51 đường dẫn, 67 thao tác HTTP, 80 schema**. Trong đó **53 thao tác khai báo bearer**, 14 thao tác không khai báo bearer. Các con số mô tả bản đặc tả tại thời điểm rà soát, không phải cam kết cố định cho phiên bản sau.

## Địa chỉ và xác thực

API nghiệp vụ có tiền tố `/api/v1`; health ở `/api/health`. Đường dẫn tài liệu tương tác là `/api/docs` và `/api/docs-json` khi bật Swagger.

Gửi token bằng header `Authorization: Bearer <token>`. Phân quyền gồm ba lớp: token hợp lệ, quyền vào route, và quyền đối với bản ghi cụ thể. Có token không có nghĩa được xem booking/payment của người khác.

## Nhóm API và quyền

| Nhóm                                            | Quyền chính                                                 |
| ----------------------------------------------- | ----------------------------------------------------------- |
| Đăng ký/đăng nhập, danh mục/phòng công khai     | Không yêu cầu bearer                                        |
| `auth/me`                                       | Người đã xác thực                                           |
| Booking và payment phía Customer                | Customer; kiểm tra chủ sở hữu                               |
| Booking vận hành, lịch phòng, thu tiền thủ công | STAFF hoặc ADMIN theo route                                 |
| Danh mục `admin/amenities`, `admin/room-types`  | ADMIN                                                       |
| `users`, danh sách và trạng thái khách hàng     | ADMIN                                                       |
| Đặt mật khẩu đầu tiên cho khách                 | STAFF hoặc ADMIN, kiểm tra điều kiện nghiệp vụ              |
| Hoàn tiền, xử lý thu trùng, đối soát            | ADMIN                                                       |
| IPN và Return                                   | Không dùng bearer; kiểm tra dữ liệu/chữ ký VNPay theo luồng |
| Health                                          | Không dùng bearer; readiness có giới hạn tần suất           |

Không suy đoán quyền chỉ từ tên đường dẫn. Ví dụ một số thao tác quản lý phòng vẫn nằm dưới `/rooms`. Không đổi URL trong công việc dọn cấu trúc thư mục.

STAFF bị giới hạn phương thức ở danh sách payment quản lý tổng; danh sách payment theo booking hiện không truyền cùng bộ lọc phương thức. Đây là khác biệt cần chủ nghiệp vụ xác nhận, không được tài liệu hóa thành một chính sách đồng nhất đã có.

## Dữ liệu thành công

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thanh cong.",
  "data": {},
  "path": "/api/v1/bookings",
  "timestamp": "2026-09-10T00:00:00.000Z",
  "requestId": "ma-yeu-cau"
}
```

`meta` là tùy chọn. Với danh sách phân trang, thông tin thường ở `meta.pagination`, gồm `page`, `limit`, `total`, `totalPages`; dữ liệu danh sách nằm trong `data`, không giả định mọi endpoint trả `items` bên trong `data`.

## Dữ liệu lỗi

```json
{
  "success": false,
  "statusCode": 400,
  "errorCode": "COMMON_VALIDATION_FAILED",
  "message": "Du lieu khong hop le.",
  "error": "Bad Request",
  "path": "/api/v1/bookings",
  "timestamp": "2026-09-10T00:00:00.000Z",
  "requestId": "ma-yeu-cau"
}
```

Ví dụ chỉ minh họa cấu trúc; thông báo cụ thể phụ thuộc trường sai và thứ tự kiểm tra. `message` có thể là chuỗi hoặc mảng chuỗi. `fieldErrors` và `details` chỉ xuất hiện khi có dữ liệu hợp lệ tương ứng.

Frontend nên dùng `errorCode`, trạng thái HTTP và trạng thái nghiệp vụ thay vì phân tích chuỗi thông báo. Giữ nguyên các giá trị mã lỗi khi đổi tên biến hoặc dịch tài liệu.

Nguồn: [kiểu phản hồi](../src/common/http/api-response.ts), [mã lỗi](../src/common/error-codes.ts), [bộ lọc ngoại lệ](../src/common/http/http-exception.filter.ts).

## Kiểu dữ liệu và thứ tự kiểm tra

- ID số lớn được biểu diễn bằng chuỗi; không tự chuyển tất cả sang JavaScript `number`.
- Số tiền được trả dạng chuỗi thập phân khi contract quy định.
- Ngày lưu trú là `YYYY-MM-DD`; thời điểm JSON theo cách tuần tự hóa `Date`, không đồng nhất với ngày nghiệp vụ UTC+7.
- DTO xác định trường được nhận; nhiều kiểm tra ý nghĩa nằm ở helper/service.
- Nhiều trường cùng sai có thể trả lỗi khác nhau nếu đổi thứ tự validation. Mapper tạo booking giữ kiểm tra ID phòng trước ngày lưu trú.

## Khóa chống xử lý lặp

`Idempotency-Key` theo mẫu hiện tại dài 8–100 ký tự, bắt đầu bằng chữ/số, phần sau chỉ gồm chữ/số hoặc `.`, `_`, `:`, `-`. Mức bắt buộc và xử lý khoảng trắng do từng luồng quyết định.

| Thao tác                              | Yêu cầu                                                        |
| ------------------------------------- | -------------------------------------------------------------- |
| Tạo booking trực tuyến/tại quầy       | Tùy chọn; nên giữ cùng khóa khi gửi lại cùng thao tác          |
| Tạo payment thủ công/VNPay            | Bắt buộc                                                       |
| Hoàn tiền VNPay/xử lý thu trùng VNPay | Bắt buộc                                                       |
| Hoàn tiền thủ công                    | Không bắt buộc header này                                      |
| Đối soát hoàn tiền                    | Dùng bản ghi hoàn tiền đã có; không phải tạo thao tác hoàn mới |

Khóa không thay thế xác thực, quyền sở hữu hay kiểm tra số tiền. Không dùng lại khóa cho nội dung nghiệp vụ khác.

## Ngoại lệ với cấu trúc JSON chung

- IPN trả `{ RspCode, Message }` đúng giao thức VNPay.
- Return có thể chuyển hướng HTTP 302 khi cấu hình URL frontend.
- Ảnh được phục vụ tại `/media/room-images`, không phải dữ liệu JSON.

Xem [luồng thanh toán](payment-flows.md) để phân biệt Return, IPN, trạng thái cần kiểm tra và kết quả hoàn tiền chưa xác định.

## Cập nhật và kiểm chứng

`npm run openapi:generate` ghi lại đặc tả; chỉ chạy khi thay đổi contract có chủ đích. `npm run openapi:check` so sánh đặc tả, còn `npm run openapi:validate` chạy thêm kiểm thử contract.

Bộ tạo OpenAPI khởi tạo ứng dụng và cần MySQL; không coi đây là công cụ hoàn toàn độc lập cơ sở dữ liệu. Dùng cấu hình test theo [hướng dẫn kiểm thử](testing-and-deployment.md). Đợt cập nhật tài liệu này không sửa hoặc dịch các mô tả trong JSON OpenAPI vì đây là hiện vật sinh từ code.
