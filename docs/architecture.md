# Kiến trúc hệ thống HBMS

Cập nhật ngày **10/09/2026** theo mã nguồn trong thư mục làm việc. HBMS là ứng dụng NestJS nguyên khối chia theo nghiệp vụ: một tiến trình API, một MySQL, tác vụ nền trong tiến trình và tích hợp VNPay.

## Luồng xử lý

```text
Yêu cầu HTTP
  → Thiết lập requestId, giới hạn nội dung và CORS
  → Guard xác thực và phân quyền, kiểm tra DTO
  → Controller
  → Service điều phối
  → Policy kiểm tra nghiệp vụ và mapper chuyển đổi dữ liệu
  → Truy vấn TypeORM hoặc TransactionRunner → Store → MySQL
  → Interceptor trả kết quả hoặc Filter chuẩn hóa lỗi
```

Tạo URL VNPay là ký dữ liệu tại máy chủ. Gọi mạng để hoàn tiền hoặc đối soát VNPay là ranh giới riêng, không được giữ transaction cơ sở dữ liệu trong lúc chờ cổng thanh toán.

## Cấu trúc thư mục

```text
src/
├── main.ts
├── app.module.ts
├── bootstrap/              # Thiết lập HTTP chung
├── config/                 # Kiểm tra cấu hình môi trường
├── database/               # DataSource, migration, seed, công cụ dữ liệu
├── openapi/                # Tạo và kiểm tra đặc tả API
├── common/
│   ├── account/            # Enum và DTO tài khoản dùng chung
│   ├── database/           # Transaction và helper MySQL
│   ├── http/
│   ├── pagination/
│   ├── validation/
│   └── health/
└── module/
    ├── auth/
    ├── customer/
    ├── user/
    ├── amenity/
    ├── room-type/
    ├── room/
    ├── booking/
    ├── payment/
    └── audit/
```

Trong từng mô-đun:

| Nhóm file         | Vai trò                                                    |
| ----------------- | ---------------------------------------------------------- |
| `*.module.ts`     | Đăng ký controller, provider và phụ thuộc DI               |
| `*.controller.ts` | Xử lý giao tiếp HTTP                                       |
| `*.service.ts`    | Điều phối nghiệp vụ, truy vấn hoặc tích hợp                |
| `*.types.ts`      | Các kiểu dữ liệu được chia sẻ giữa các phần của mô-đun     |
| `dto/`            | Lớp dữ liệu có decorator phục vụ HTTP và OpenAPI           |
| `domain/`         | Chính sách nghiệp vụ, trạng thái và lỗi nghiệp vụ          |
| `mappers/`        | Chuyển đổi đầu vào, dữ liệu ghi và kết quả trả về          |
| `ports/`          | Hợp đồng store; abstract class có thể là token DI lúc chạy |
| `persistence/`    | Triển khai store bằng TypeORM                              |
| `schema/`         | Entity TypeORM; giữ tên cũ, chưa đổi thành `entities/`     |

Mô-đun nhỏ không cần đủ mọi thư mục. Kiểu chỉ dùng riêng cho một helper có thể ở cạnh helper đó. Quy ước là hướng tổ chức, không có nghĩa mọi type hiện tại đã được chuyển hết sang `*.types.ts`.

## Quyền sở hữu

| Mô-đun   | Nghiệp vụ chính                                       |
| -------- | ----------------------------------------------------- |
| Auth     | Đăng nhập, đăng ký, JWT, nhận diện người gọi và guard |
| Customer | Hồ sơ, mật khẩu và quản trị khách hàng                |
| User     | Quản trị tài khoản nhân viên bởi ADMIN                |
| Amenity  | Danh mục tiện nghi                                    |
| RoomType | Loại phòng, cấu hình giường và tiện nghi đi kèm       |
| Room     | Phòng, trạng thái, ảnh và lịch khóa phòng             |
| Booking  | Tạo, tra cứu, hủy, nhận/trả phòng và hết hạn giữ chỗ  |
| Payment  | Thu tiền, VNPay, hoàn tiền và đối soát                |
| Audit    | Nhật ký các thay đổi nghiệp vụ được ghi nhận          |

Type dùng ở nhiều mô-đun vẫn ở nơi sở hữu: `BedConfig` thuộc RoomType, `CredentialCapabilities` thuộc Customer, hợp đồng hoàn tiền thuộc Payment. Chỉ khái niệm dùng chung không phụ thuộc nghiệp vụ cụ thể mới nằm trong `common`.

`AppRequest` nhận kiểu principal qua generic; `AuthenticatedRequest` trong Auth bổ sung `AuthenticatedPrincipal`. Common HTTP không import ngược mô-đun Auth.

## Transaction và chia sẻ provider

[TransactionRunner và TransactionContext](../src/common/database/transaction.ts) là hợp đồng. [TypeOrmTransactionRunner](../src/common/database/typeorm-transaction.runner.ts) triển khai và quản lý `EntityManager`. Store nhận cùng context để ghi trong cùng transaction; không tự mở transaction độc lập cho từng thao tác liên quan.

[AuditModule](../src/module/audit/audit.module.ts) cung cấp ghi nhật ký dùng chung. `TransactionalAuditLog` nhận context của nghiệp vụ để bản ghi audit cùng thành công hoặc cùng hủy với thay đổi dữ liệu.

Giữ [PaymentPersistenceModule](../src/module/payment/persistence/payment-persistence.module.ts) độc lập với `PaymentModule`:

```text
PaymentModule → BookingModule → PaymentPersistenceModule
PaymentModule ────────────────→ PaymentPersistenceModule
```

Booking cần store của Payment nhưng Payment đang cần `BookingPaymentLifecycleService`. Bắt Booking import ngược `PaymentModule` sẽ tạo vòng phụ thuộc. Việc làm phẳng thư mục không thay đổi đăng ký provider này.

## Thứ tự khóa chính

| Luồng                          | Thứ tự cần bảo toàn                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Tạo booking mới                | Xử lý/khóa Customer theo nhánh nghiệp vụ → khóa Room → ghi Booking và từng đêm RoomCalendar      |
| Gửi lại booking đã có kết quả  | Có đường đọc kết quả cũ trước transaction; không áp lại điều kiện tiếp nhận cho kết quả đã lưu   |
| Hủy hoặc hết hạn booking       | Khóa Booking → cập nhật các payment chờ và giải phóng lịch theo nghiệp vụ                        |
| Nhận/trả phòng                 | Khóa Booking → khóa Room                                                                         |
| Thu tiền thủ công              | Khóa Booking → tra khóa chống lặp và tạo Payment                                                 |
| IPN VNPay                      | Đọc bản chụp Payment → khóa Booking → khóa Payment → có thể khóa Payment được chấp nhận trước đó |
| Chuẩn bị hoàn tiền             | Khóa Booking → khóa Payment; xử lý thu trùng có thể khóa thêm Payment gốc                        |
| Ghi kết quả hoàn tiền/đối soát | Đọc thông tin cần thiết → khóa Booking → khóa Payment trước khi áp kết quả                       |
| Khóa/mở lịch phòng             | Khóa Room → thêm/xóa RoomCalendar trong khoảng ngày                                              |

Bảng chỉ tóm tắt các khóa điều phối chính, không thay thế việc đọc từng câu truy vấn. Khóa không thay thế unique constraint, kiểm tra trạng thái hay khóa chống lặp.

[BookingPaymentLifecycleService](../src/module/booking/booking-payment-lifecycle.service.ts) giữ các tác động liên quan Booking, Payment, RoomCalendar và Audit trong các luồng thanh toán/hủy/hoàn tiền.

## Xác thực

`AccessTokenService` làm việc với JWT; `AccessTokenClaimsValidator` kiểm tra dữ liệu token. `AccessTokenPrincipalService` đọc lại trạng thái tài khoản và quyền hiện tại. `JwtStrategy` và `JwtAuthGuard` tích hợp Passport với HTTP, tạo `request.user` và ánh xạ sang `request.auth`.

Token dùng HS256. `token_version` phải khớp dữ liệu máy chủ; quyền trong token không thay thế quyền hiện tại trong cơ sở dữ liệu. Guard kiểm tra quyền vào route; service tiếp tục kiểm tra người gọi có quyền với bản ghi cụ thể hay không.

## Tác vụ nền và ranh giới vận hành

Booking và Payment có tác vụ chạy mỗi phút, chịu điều khiển bởi `EXPIRATION_SCHEDULERS_ENABLED`. Chống chạy chồng trong một tiến trình không phải khóa điều phối giữa nhiều máy. Bộ xử lý hết hạn Payment cũng đếm hoàn tiền chờ lâu; không được hiểu là cơ chế tự hoàn tiền qua mạng.

Ảnh phòng lưu trên ổ đĩa. Ghi file và ghi MySQL không phải một transaction nguyên tử; các nhánh lỗi có xử lý bù và dọn file theo khả năng.

Các vấn đề nhiều bản sao ứng dụng, proxy, sao lưu và giám sát nằm trong [kiểm thử và triển khai](testing-and-deployment.md).
