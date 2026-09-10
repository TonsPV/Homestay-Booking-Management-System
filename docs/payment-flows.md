# Thanh toán và hoàn tiền

Cập nhật ngày **10/09/2026** theo mô-đun Payment, các policy và `BookingPaymentLifecycleService`.

## Thành phần

| Thành phần                       | Trách nhiệm                                                   |
| -------------------------------- | ------------------------------------------------------------- |
| `PaymentService`                 | Điểm gọi của controller, chuyển tiếp đến service chuyên trách |
| `PaymentManualService`           | Thu tiền mặt/chuyển khoản                                     |
| `PaymentCollectionService`       | Tạo thanh toán VNPay, xử lý IPN, đọc kết quả Return           |
| `PaymentRefundService`           | Điều phối hoàn tiền và đối soát                               |
| `PaymentQueryService`            | Trả dữ liệu theo quyền người gọi                              |
| `VnPayGatewayService`            | Ký URL, xác minh callback, gọi hoàn tiền và QueryDr           |
| `BookingPaymentLifecycleService` | Áp dụng nhất quán trạng thái Booking, Payment, lịch và audit  |

Policy hoàn tiền và bộ nhận diện thu trùng ở `payment/domain/`; mapper ở `payment/mappers/`; store TypeORM ở `payment/persistence/`. Không đưa các lệnh gọi cơ sở dữ liệu vào mapper.

## Các API chính

| Phương thức và đường dẫn                                        | Mục đích                                           |
| --------------------------------------------------------------- | -------------------------------------------------- |
| `POST /api/v1/bookings/:bookingId/payments`                     | Customer tạo thanh toán VNPay cho booking của mình |
| `POST /api/v1/management/bookings/:bookingId/payments`          | STAFF/ADMIN ghi nhận thu tiền thủ công             |
| `GET /api/v1/payments/vnpay/ipn`                                | Thông báo kết quả từ VNPay                         |
| `GET /api/v1/payments/vnpay/return`                             | Trình duyệt quay về sau thanh toán                 |
| `POST /api/v1/management/payments/:id/refund`                   | ADMIN hoàn tiền                                    |
| `POST /api/v1/management/payments/:id/resolve-duplicate-charge` | ADMIN xử lý khoản thu trùng đủ điều kiện           |
| `POST /api/v1/management/payments/:id/reconcile-refund`         | ADMIN đối soát kết quả hoàn tiền                   |

Phương thức thanh toán: `CASH`, `BANK_TRANSFER`, `VNPAY`. Trạng thái: `PENDING`, `SUCCESS`, `FAILED`, `REQUIRES_REVIEW`, `REFUND_PENDING`, `REFUNDED`.

## Thu tiền thủ công

STAFF/ADMIN gửi phương thức thanh toán và khóa chống lặp; số tiền lấy từ `booking.totalAmount`.

Trong transaction, service khóa Booking, kiểm tra yêu cầu gửi lại và khả năng thanh toán, xử lý lần thanh toán trực tuyến đã hết hạn, rồi tạo Payment thành công. Bộ điều phối vòng đời ghi nhận booking đã thanh toán, xác nhận booking khi phù hợp và ghi audit. Không nhận số tiền tùy ý từ client.

## Tạo thanh toán VNPay

Customer phải sở hữu booking và gửi `Idempotency-Key`. Dữ liệu tùy chọn gồm `bankCode` và `locale` theo DTO.

Service khóa Booking, tra yêu cầu cũ, kiểm tra thanh toán đang chờ và hạn thanh toán, rồi tạo Payment `PENDING`. URL được ký tại máy chủ và trả cùng `payment`, `paymentUrl`, `expiresAt`. Tạo URL không phải gọi mạng sang VNPay.

## IPN và Return có quyền khác nhau

**Chỉ IPN là callback được phép cập nhật trạng thái tài chính.**

IPN xác minh chữ ký, mã đơn vị, tham chiếu, số tiền và dữ liệu kết quả. Sau khi đọc Payment, service khóa Booking rồi Payment; khi cần sẽ khóa khoản thanh toán đã được chấp nhận trước đó. Số tiền được kiểm tra lại trong transaction.

- Thành công hợp lệ: ghi Payment `SUCCESS`, cập nhật quyền sở hữu khoản thu và trạng thái Booking phù hợp, ghi audit.
- Booking đã hủy: lưu khoản thu cần kiểm tra với `BOOKING_CANCELLED`, không tự khôi phục booking/lịch.
- Đã có khoản thu được chấp nhận khác: lưu `ANOTHER_SUCCESSFUL_PAYMENT`, không coi khoản thu thứ hai là tiền gốc của booking.
- Thất bại hoặc gửi lại: xử lý theo trạng thái hiện có, không ghi nhận thành công lặp.

IPN trả trực tiếp `{ RspCode, Message }`, không bọc bằng cấu trúc JSON thông thường của HBMS:

| Mã   | Ý nghĩa                                                              |
| ---- | -------------------------------------------------------------------- |
| `00` | Đã xử lý thông báo, không đồng nghĩa giao dịch thanh toán thành công |
| `01` | Không tìm thấy tham chiếu                                            |
| `02` | Giao dịch đã được xử lý                                              |
| `04` | Sai số tiền                                                          |
| `97` | Chữ ký không hợp lệ                                                  |
| `99` | Dữ liệu không hợp lệ hoặc lỗi xử lý                                  |

Return chỉ xác minh và đọc trạng thái đã lưu. Trình duyệt có thể quay về trước IPN, nên frontend phải đọc lại booking/payment thay vì coi Return là bằng chứng đã thu tiền.

Nếu `VNPAY_FRONTEND_RETURN_URL` rỗng, Return trả JSON; nếu có cấu hình, controller chuyển hướng 302 với các trường kết quả tương ứng. Cả hai cách đều không cập nhật trạng thái tài chính.

`VNPAY_RETURN_URL` là địa chỉ trình duyệt quay về, **không phải địa chỉ IPN**. Địa chỉ IPN phải được cấu hình với đơn vị cung cấp ở đường dẫn công khai `/api/v1/payments/vnpay/ipn`.

## Quyết định mô hình hoàn tiền

Mỗi bản ghi `payments` đại diện cho một lần thử thanh toán. Không tái sử dụng bản ghi đó bằng cách ghi đè tham chiếu cổng thanh toán cho một lần thử mới.

Quan hệ hiện tại:

```text
Payment → PaymentRefund: không có hoặc có một bản ghi
Booking → acceptedPaymentId: khoản thanh toán được chấp nhận của booking
```

- `payment_refunds.payment_id` là duy nhất.
- Bản ghi hoàn tiền giữ khóa chống lặp, mã yêu cầu, trạng thái payment trước đó, bằng chứng cổng thanh toán, người thực hiện và thời gian.
- Gửi lại và đối soát cập nhật cùng bản ghi hoàn tiền.
- Một kết quả từ chối đã xác minh được giữ lại. Không mở bản ghi hoàn tiền độc lập thứ hai cho cùng Payment chỉ bằng cách đổi khóa.
- Khóa ngoại ghép `(accepted_payment_id, id)` bảo đảm khoản thanh toán được chỉ định thuộc đúng booking. Nó không tự thay thế toàn bộ quy tắc nghiệp vụ chống thu hai lần.

Hệ thống chỉ hỗ trợ hoàn toàn bộ số tiền. Chưa có thanh toán chia nhỏ, hoàn từng phần hoặc sổ cái tổng quát. Cần thiết kế lại có chủ đích nếu bổ sung các khả năng này.

Quyết định được triển khai qua các migration `1784795000000` đến `1784797000000`; bản quyết định gốc được giữ trong kho lưu trữ.

## Hoàn tiền thủ công

Luồng này không cần header chống lặp. Trong transaction, khóa Booking trước Payment, yêu cầu Payment thành công và Booking đã thanh toán, đồng thời từ chối trạng thái lưu trú không phù hợp.

Khi hoàn thành, ghi dấu hoàn tiền, cập nhật trạng thái booking/lịch theo vòng đời và ghi audit. Không suy diễn “hoàn tiền thủ công” là tự động chuyển tiền qua ngân hàng; đây là ghi nhận nghiệp vụ trong hệ thống.

## Hoàn tiền VNPay

```text
Transaction chuẩn bị
  → Khóa Booking, Payment
  → Kiểm tra điều kiện và khóa chống lặp
  → Lưu bản ghi hoàn tiền, đặt REFUND_PENDING
  → Commit
Gọi VNPay bên ngoài transaction
Transaction ghi kết quả
  → Khóa Booking, Payment
  → Xác minh và áp dụng kết quả
  → Commit
```

Chỉ kết quả đã xác minh, đúng số tiền hoàn toàn bộ, có mã giao dịch và trạng thái giao thức phù hợp mới hoàn tất. Kiểm tra cụ thể nằm trong [payment-refund.policy.ts](../src/module/payment/domain/payment-refund.policy.ts).

Khi timeout, lỗi mạng hoặc kết quả mơ hồ, giữ `REFUND_PENDING` để đối soát. Không giải phóng lịch của booking đang hoàn tiền thông thường chỉ vì đã gửi yêu cầu; chỉ áp dụng các tác động kết thúc khi có kết quả đủ tin cậy.

Khi cổng xác nhận từ chối, khôi phục trạng thái payment phù hợp trước đó nhưng giữ bằng chứng hoàn tiền. Không gửi yêu cầu mới một cách mù quáng.

## Thu trùng và khoản thu muộn

Luồng xử lý thu trùng kiểm tra lý do `ANOTHER_SUCCESSFUL_PAYMENT`, phương thức VNPay, tham chiếu giao dịch và Payment gốc hợp lệ. Hoàn khoản thu trùng không được hủy booking đã được thanh toán hợp lệ bằng khoản thu gốc.

Khoản thu đến sau khi booking đã hủy thuộc trường hợp `BOOKING_CANCELLED`; không gộp nhầm với trường hợp thu trùng. Đối chiếu [bộ nhận diện thu trùng](../src/module/payment/domain/duplicate-charge.detector.ts) và các nhánh trong [PaymentRefundService](../src/module/payment/payment-refund.service.ts).

## Đối soát và cách frontend xử lý lỗi

ADMIN dùng API đối soát để truy vấn VNPay qua QueryDr bên ngoài transaction, rồi cập nhật kết quả trong transaction. Danh sách quản lý có số lượng hoàn tiền chờ quá bảy ngày để theo dõi.

Một phản hồi 503 với `PAYMENT_REFUND_OUTCOME_UNKNOWN` nghĩa là **chưa biết chắc kết quả**, không phải khẳng định hoàn tiền thất bại. Frontend nên hiển thị trạng thái chờ kiểm tra, đọc lại dữ liệu và cho người có quyền đối soát. Không đổi khóa và gửi hoàn tiền mới để “thử lại”.

Giữ nguyên mã lỗi và thông báo giao thức trong code khi dịch tài liệu.
