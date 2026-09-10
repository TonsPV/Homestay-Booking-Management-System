# Cơ sở dữ liệu

Cập nhật theo mã nguồn ngày **10/09/2026**. Đây là mô tả schema trong repo, không phải xác nhận schema của máy production.

## Nguồn đối chiếu

- [Entity theo từng module](../src/module/).
- [Danh sách migration và cấu hình CLI](../src/database/data-source.ts).
- [Migration](../src/database/migrations/).
- [Kiểm tra sai lệch schema](../scripts/check-schema-drift.ts).
- [Kiểm tra bất biến dữ liệu](../scripts/data-audit.ts).

MySQL **8.4** là phiên bản dùng trong CI. Ứng dụng dùng TypeORM, `synchronize: false` và tự chạy migration khi khởi động. Không sửa bảng trực tiếp để thay cho migration.

## Các bảng hiện hành

Có **12 bảng entity**, một bảng liên kết và bảng lịch sử migration; tổng cộng **14 bảng** sau khi áp dụng đầy đủ migration.

| Bảng                  | Dữ liệu và quan hệ chính                                    |
| --------------------- | ----------------------------------------------------------- |
| `users`               | Tài khoản nội bộ, vai trò và trạng thái tài khoản           |
| `customers`           | Khách hàng, thông tin liên hệ và thông tin xác thực         |
| `room_types`          | Loại phòng, giá cơ bản và cấu hình sức chứa                 |
| `room_type_beds`      | Cấu hình giường thuộc loại phòng                            |
| `amenities`           | Danh mục tiện nghi                                          |
| `room_type_amenities` | Liên kết nhiều–nhiều giữa loại phòng và tiện nghi           |
| `rooms`               | Phòng thực tế, loại phòng và trạng thái vận hành            |
| `room_images`         | Ảnh của phòng, thứ tự và cờ ảnh đại diện                    |
| `bookings`            | Đặt phòng, khách hàng, phòng, ngày ở, số tiền và trạng thái |
| `room_calendar`       | Giữ hoặc chặn phòng theo từng ngày                          |
| `payments`            | Các lần thu tiền; một booking có thể có nhiều lần thử       |
| `payment_refunds`     | Tối đa một bản ghi hoàn tiền cho mỗi payment                |
| `audit_logs`          | Nhật ký hành động và metadata                               |
| `typeorm_migrations`  | Những migration đã áp dụng; không phải entity nghiệp vụ     |

## Quan hệ và bất biến cần giữ

- Booking tham chiếu Customer, Room và tùy trường hợp User tạo đơn.
- `bookings.accepted_payment_id` giữ quan hệ với khoản thu được chấp nhận, kể cả sau hoàn tiền. Không được xóa dấu vết này để cho phép thu lại lần hai.
- Khóa ngoại ghép `(accepted_payment_id, id)` của Booking tham chiếu `(id, booking_id)` của Payment. Nó bảo đảm payment được chọn thuộc đúng booking, **không tự bảo đảm mọi quy tắc chống thu trùng**; quy tắc này còn nằm trong service, khóa hàng và kiểm tra dữ liệu.
- `payment_refunds.payment_id` là duy nhất. Khóa idempotency và mã yêu cầu hoàn tiền cũng có chỉ mục duy nhất. Các trường phản hồi gateway, lý do và thời điểm đối soát nằm ở bảng hoàn tiền, không còn là nhóm cột hoàn tiền cũ trên Payment.
- RoomCalendar duy nhất theo `(room_id, stay_date)`. Dòng `RESERVED` phải có booking; dòng `BLOCKED` không được có booking.
- Ngày trả phòng phải sau ngày nhận phòng. Khoảng giữ phòng là `[checkInDate, checkOutDate)`, không giữ đêm của ngày trả phòng.
- Giá cơ bản, tổng tiền booking và số tiền payment phải dương. Tiền được xử lý dưới dạng chuỗi decimal; không đổi thành số thực JavaScript để tính tiền.
- Bộ trường idempotency trên Booking phải cùng có dữ liệu hoặc cùng rỗng. Khóa duy nhất được xác định theo loại người gửi, ID người gửi và key.
- Cờ ảnh đại diện không có ràng buộc duy nhất đủ để thay thế việc điều phối trong ứng dụng; cần duy trì kiểm tra dữ liệu.
- Audit dùng loại đối tượng và ID đối tượng, không có khóa ngoại đa hình tới tất cả bảng nghiệp vụ.

Chi tiết kiểu cột, khả năng nhận null và giá trị mặc định được khai báo trong các entity bên dưới. Migration mới là lịch sử thay đổi DDL; phải kiểm tra cả hai khi sửa schema.

## Các hành động audit hiện có

`BOOKING_CREATED`, `BOOKING_STATUS_CHANGED`, `BOOKING_CANCELLED`,
`ROOM_STATUS_CHANGED`, `PAYMENT_CONFIRMED`, `REFUND_REQUESTED`,
`REFUND_COMPLETED`, `ACCOUNT_LOCKED`, `ACCOUNT_UNLOCKED`,
`CUSTOMER_INITIAL_PASSWORD_SET`, `ROOM_CALENDAR_BLOCKED`,
`ROOM_CALENDAR_UNBLOCKED`.

Không dùng danh sách chín hành động trong tài liệu cũ làm chuẩn. Metadata có thể chứa dữ liệu liên quan khách hàng; cần kiểm soát quyền truy cập và chính sách lưu giữ.

## Migration

Repo có **29 migration**, mốc cuối `1784798000000`. Một số mốc quan trọng:

| Mốc             | Ý nghĩa                                                      |
| --------------- | ------------------------------------------------------------ |
| `1784784000000` | Bổ sung mô hình xác nhận số điện thoại trong lịch sử         |
| `1784794000000` | Loại bỏ luồng/bảng xác nhận số điện thoại cũ                 |
| `1784795000000` | Tách và chuyển dữ liệu hoàn tiền sang `payment_refunds`      |
| `1784796000000` | Ràng buộc khoản thanh toán được chấp nhận thuộc đúng booking |
| `1784797000000` | Bỏ các cột hoàn tiền cũ trên Payment                         |
| `1784798000000` | Bổ sung hành động audit cho mật khẩu ban đầu và lịch phòng   |

Không xóa migration cũ chỉ vì chức năng sau đó bị gỡ: database mới vẫn cần đi qua đúng chuỗi lịch sử. Một số migration dùng helper trong repo; khi refactor helper phải kiểm thử lại cả khởi tạo database trắng.

## Kiểm tra và vận hành an toàn

Các lệnh `migration:show`, `migration:run`, `schema:check` và `data:audit` nằm trong [package.json](../package.json). Chuẩn bị môi trường theo [hướng dẫn kiểm thử](testing-and-deployment.md) trước khi chạy.

- `schema:check`: phát hiện khác biệt giữa entity và schema đã migrate.
- `data:audit`: kiểm tra 13 nhóm bất biến, gồm lịch booking, dòng thanh toán được chấp nhận, hoàn tiền, trạng thái phòng, ảnh đại diện, liên kết tiện nghi và bản ghi hết hạn.
- `phone:normalize:check` và `room-type-beds:audit`: rà soát dữ liệu chuyên biệt.
- Các lệnh có `:run`, `:backfill` hoặc `--apply` có thể ghi dữ liệu. Không chạy tự động trên production chỉ để kiểm tra.
- `migration:revert` không thay thế bản sao lưu; DDL của MySQL không bảo đảm hoàn tác như transaction nghiệp vụ.
- Không bật `synchronize` trên production. Sao lưu và thử khôi phục trước thay đổi schema.

## Danh mục cột theo entity

Danh mục dưới đây được trích từ các decorator cột hiện tại. Tên cột giữ nguyên để tra cứu; không liệt kê thuộc tính quan hệ như thể chúng là cột bổ sung.

### `amenities`

Nguồn: [amenity.entity.ts](../src/module/amenity/schema/amenity.entity.ts).

| Cột           | Thuộc tính trong code | Kiểu khai báo | Cho phép null |
| ------------- | --------------------- | ------------- | ------------- |
| `id`          | `id`                  | `bigint`      | Không         |
| `name`        | `name`                | `varchar`     | Không         |
| `description` | `description`         | `varchar`     | Có            |
| `created_at`  | `createdAt`           | `datetime`    | Không         |
| `updated_at`  | `updatedAt`           | `datetime`    | Không         |
| `deleted_at`  | `deletedAt`           | `datetime`    | Có            |

### `audit_logs`

Nguồn: [audit-log.entity.ts](../src/module/audit/schema/audit-log.entity.ts).

| Cột           | Thuộc tính trong code | Kiểu khai báo | Cho phép null |
| ------------- | --------------------- | ------------- | ------------- |
| `id`          | `id`                  | `bigint`      | Không         |
| `actor_type`  | `actorType`           | `enum`        | Không         |
| `actor_id`    | `actorId`             | `bigint`      | Có            |
| `action`      | `action`              | `enum`        | Không         |
| `entity_type` | `entityType`          | `enum`        | Không         |
| `entity_id`   | `entityId`            | `varchar`     | Không         |
| `request_id`  | `requestId`           | `varchar`     | Có            |
| `metadata`    | `metadata`            | `json`        | Có            |
| `created_at`  | `createdAt`           | `datetime`    | Không         |

### `bookings`

Nguồn: [booking.entity.ts](../src/module/booking/schema/booking.entity.ts).

| Cột                         | Thuộc tính trong code    | Kiểu khai báo | Cho phép null |
| --------------------------- | ------------------------ | ------------- | ------------- |
| `id`                        | `id`                     | `bigint`      | Không         |
| `booking_code`              | `bookingCode`            | `varchar`     | Không         |
| `customer_id`               | `customerId`             | `bigint`      | Không         |
| `room_id`                   | `roomId`                 | `bigint`      | Không         |
| `created_by_user_id`        | `createdByUserId`        | `bigint`      | Có            |
| `check_in_date`             | `checkInDate`            | `date`        | Không         |
| `check_out_date`            | `checkOutDate`           | `date`        | Không         |
| `guest_count`               | `guestCount`             | `int`         | Không         |
| `contact_name`              | `contactName`            | `varchar`     | Không         |
| `contact_phone`             | `contactPhone`           | `varchar`     | Không         |
| `contact_email`             | `contactEmail`           | `varchar`     | Có            |
| `total_amount`              | `totalAmount`            | `decimal`     | Không         |
| `status`                    | `status`                 | `enum`        | Không         |
| `payment_status`            | `paymentStatus`          | `enum`        | Không         |
| `accepted_payment_id`       | `acceptedPaymentId`      | `bigint`      | Có            |
| `request_intent_actor_type` | `requestIntentActorType` | `varchar`     | Có            |
| `request_intent_actor_id`   | `requestIntentActorId`   | `bigint`      | Có            |
| `request_intent_key`        | `requestIntentKey`       | `varchar`     | Có            |
| `request_intent_hash`       | `requestIntentHash`      | `char`        | Có            |
| `payment_expires_at`        | `paymentExpiresAt`       | `datetime`    | Có            |
| `customer_note`             | `customerNote`           | `text`        | Có            |
| `cancelled_at`              | `cancelledAt`            | `datetime`    | Có            |
| `cancellation_reason`       | `cancellationReason`     | `varchar`     | Có            |
| `created_at`                | `createdAt`              | `datetime`    | Không         |
| `updated_at`                | `updatedAt`              | `datetime`    | Không         |

### `room_calendar`

Nguồn: [room-calendar.entity.ts](../src/module/booking/schema/room-calendar.entity.ts).

| Cột          | Thuộc tính trong code | Kiểu khai báo | Cho phép null |
| ------------ | --------------------- | ------------- | ------------- |
| `id`         | `id`                  | `bigint`      | Không         |
| `room_id`    | `roomId`              | `bigint`      | Không         |
| `booking_id` | `bookingId`           | `bigint`      | Có            |
| `stay_date`  | `stayDate`            | `date`        | Không         |
| `status`     | `status`              | `varchar`     | Không         |
| `reason`     | `reason`              | `varchar`     | Có            |

### `customers`

Nguồn: [customer.entity.ts](../src/module/customer/schema/customer.entity.ts).

| Cột             | Thuộc tính trong code | Kiểu khai báo | Cho phép null |
| --------------- | --------------------- | ------------- | ------------- |
| `id`            | `id`                  | `bigint`      | Không         |
| `full_name`     | `fullName`            | `varchar`     | Không         |
| `email`         | `email`               | `varchar`     | Có            |
| `phone`         | `phone`               | `varchar`     | Không         |
| `password_hash` | `passwordHash`        | `varchar`     | Có            |
| `token_version` | `tokenVersion`        | `int`         | Không         |
| `status`        | `status`              | `enum`        | Không         |
| `created_at`    | `createdAt`           | `datetime`    | Không         |
| `updated_at`    | `updatedAt`           | `datetime`    | Không         |
| `deleted_at`    | `deletedAt`           | `datetime`    | Có            |

### `payment_refunds`

Nguồn: [payment-refund.entity.ts](../src/module/payment/schema/payment-refund.entity.ts).

| Cột                       | Thuộc tính trong code   | Kiểu khai báo | Cho phép null |
| ------------------------- | ----------------------- | ------------- | ------------- |
| `id`                      | `id`                    | `bigint`      | Không         |
| `payment_id`              | `paymentId`             | `bigint`      | Không         |
| `idempotency_key`         | `idempotencyKey`        | `varchar`     | Có            |
| `request_id`              | `requestId`             | `varchar`     | Có            |
| `previous_payment_status` | `previousPaymentStatus` | `varchar`     | Có            |
| `gateway_transaction_id`  | `gatewayTransactionId`  | `varchar`     | Có            |
| `response_code`           | `responseCode`          | `varchar`     | Có            |
| `transaction_status`      | `transactionStatus`     | `varchar`     | Có            |
| `message`                 | `message`               | `varchar`     | Có            |
| `reason`                  | `reason`                | `varchar`     | Có            |
| `refunded_by_user_id`     | `refundedByUserId`      | `bigint`      | Có            |
| `requested_at`            | `requestedAt`           | `datetime`    | Có            |
| `refunded_at`             | `refundedAt`            | `datetime`    | Có            |
| `last_queried_at`         | `lastQueriedAt`         | `datetime`    | Có            |
| `created_at`              | `createdAt`             | `datetime`    | Không         |
| `updated_at`              | `updatedAt`             | `datetime`    | Không         |

### `payments`

Nguồn: [payment.entity.ts](../src/module/payment/schema/payment.entity.ts).

| Cột                           | Thuộc tính trong code      | Kiểu khai báo | Cho phép null |
| ----------------------------- | -------------------------- | ------------- | ------------- |
| `id`                          | `id`                       | `bigint`      | Không         |
| `booking_id`                  | `bookingId`                | `bigint`      | Không         |
| `amount`                      | `amount`                   | `decimal`     | Không         |
| `currency`                    | `currency`                 | `char`        | Không         |
| `method`                      | `method`                   | `varchar`     | Không         |
| `status`                      | `status`                   | `enum`        | Không         |
| `review_reason`               | `reviewReason`             | `enum`        | Có            |
| `review_canonical_payment_id` | `reviewCanonicalPaymentId` | `bigint`      | Có            |
| `gateway_name`                | `gatewayName`              | `varchar`     | Có            |
| `gateway_reference`           | `gatewayReference`         | `varchar`     | Có            |
| `gateway_transaction_id`      | `gatewayTransactionId`     | `varchar`     | Có            |
| `gateway_payment_url`         | `gatewayPaymentUrl`        | `varchar`     | Có            |
| `gateway_response_code`       | `gatewayResponseCode`      | `varchar`     | Có            |
| `gateway_transaction_status`  | `gatewayTransactionStatus` | `varchar`     | Có            |
| `gateway_transaction_date`    | `gatewayTransactionDate`   | `char`        | Có            |
| `idempotency_key`             | `idempotencyKey`           | `varchar`     | Có            |
| `created_by_user_id`          | `createdByUserId`          | `bigint`      | Có            |
| `paid_at`                     | `paidAt`                   | `datetime`    | Có            |
| `expires_at`                  | `expiresAt`                | `datetime`    | Có            |
| `created_at`                  | `createdAt`                | `datetime`    | Không         |
| `updated_at`                  | `updatedAt`                | `datetime`    | Không         |

### `room_images`

Nguồn: [room-image.entity.ts](../src/module/room/schema/room-image.entity.ts).

| Cột          | Thuộc tính trong code | Kiểu khai báo | Cho phép null |
| ------------ | --------------------- | ------------- | ------------- |
| `id`         | `id`                  | `bigint`      | Không         |
| `room_id`    | `roomId`              | `bigint`      | Không         |
| `image_url`  | `imageUrl`            | `varchar`     | Không         |
| `sort_order` | `sortOrder`           | `int`         | Không         |
| `is_cover`   | `isCover`             | `boolean`     | Không         |

### `rooms`

Nguồn: [room.entity.ts](../src/module/room/schema/room.entity.ts).

| Cột            | Thuộc tính trong code | Kiểu khai báo | Cho phép null |
| -------------- | --------------------- | ------------- | ------------- |
| `id`           | `id`                  | `bigint`      | Không         |
| `room_type_id` | `roomTypeId`          | `bigint`      | Không         |
| `room_number`  | `roomNumber`          | `varchar`     | Không         |
| `name`         | `name`                | `varchar`     | Không         |
| `description`  | `description`         | `text`        | Có            |
| `status`       | `status`              | `enum`        | Không         |
| `created_at`   | `createdAt`           | `datetime`    | Không         |
| `updated_at`   | `updatedAt`           | `datetime`    | Không         |
| `deleted_at`   | `deletedAt`           | `datetime`    | Có            |

### `room_type_beds`

Nguồn: [room-type-bed.entity.ts](../src/module/room-type/schema/room-type-bed.entity.ts).

| Cột            | Thuộc tính trong code | Kiểu khai báo | Cho phép null |
| -------------- | --------------------- | ------------- | ------------- |
| `id`           | `id`                  | `bigint`      | Không         |
| `room_type_id` | `roomTypeId`          | `bigint`      | Không         |
| `bed_type`     | `bedType`             | `varchar`     | Không         |
| `quantity`     | `quantity`            | `int`         | Không         |

### `room_types`

Nguồn: [room-type.entity.ts](../src/module/room-type/schema/room-type.entity.ts).

| Cột           | Thuộc tính trong code | Kiểu khai báo | Cho phép null |
| ------------- | --------------------- | ------------- | ------------- |
| `id`          | `id`                  | `bigint`      | Không         |
| `name`        | `name`                | `varchar`     | Không         |
| `description` | `description`         | `text`        | Có            |
| `bed_type`    | `bedType`             | `varchar`     | Có            |
| `max_guests`  | `maxGuests`           | `int`         | Không         |
| `base_price`  | `basePrice`           | `decimal`     | Không         |
| `created_at`  | `createdAt`           | `datetime`    | Không         |
| `updated_at`  | `updatedAt`           | `datetime`    | Không         |
| `deleted_at`  | `deletedAt`           | `datetime`    | Có            |

### `users`

Nguồn: [user.entity.ts](../src/module/user/schema/user.entity.ts).

| Cột             | Thuộc tính trong code | Kiểu khai báo | Cho phép null |
| --------------- | --------------------- | ------------- | ------------- |
| `id`            | `id`                  | `bigint`      | Không         |
| `full_name`     | `fullName`            | `varchar`     | Không         |
| `email`         | `email`               | `varchar`     | Không         |
| `phone`         | `phone`               | `varchar`     | Có            |
| `password_hash` | `passwordHash`        | `varchar`     | Không         |
| `token_version` | `tokenVersion`        | `int`         | Không         |
| `role`          | `role`                | `enum`        | Không         |
| `status`        | `status`              | `enum`        | Không         |
| `created_at`    | `createdAt`           | `datetime`    | Không         |
| `updated_at`    | `updatedAt`           | `datetime`    | Không         |
| `deleted_at`    | `deletedAt`           | `datetime`    | Có            |
