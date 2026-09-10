# Homestay Booking Management System API

Tài liệu tiếng Việt, đối chiếu mã nguồn trong working tree ngày **10/09/2026**. Tên biến, handler, endpoint và command giữ nguyên. Tài liệu không xác nhận kết quả chạy test hoặc trạng thái triển khai.

## 1. Tổng quan hệ thống

Backend dùng NestJS, Express adapter, TypeORM và MySQL. `AppModule` đăng ký các module nghiệp vụ trong cùng ứng dụng; `ScheduleModule` đăng ký tác vụ nền. JWT dùng cho xác thực; Swagger tạo đặc tả OpenAPI; VNPay phục vụ thanh toán; Sharp xử lý ảnh phòng.

| Module   | Chức năng hiện có                                                     |
| -------- | --------------------------------------------------------------------- |
| Auth     | Đăng ký Customer, đăng nhập Customer/User, đọc thông tin người gọi    |
| Customer | Hồ sơ cá nhân, đổi mật khẩu, quản lý trạng thái, đặt mật khẩu ban đầu |
| User     | Tạo, tra cứu và cập nhật tài khoản nội bộ                             |
| Amenity  | Danh mục tiện nghi, quản trị và khôi phục                             |
| RoomType | Loại phòng, cấu hình giường, liên kết tiện nghi                       |
| Room     | Tra cứu phòng, tìm phòng trống, quản lý trạng thái, ảnh và lịch block |
| Booking  | Tạo/tra cứu booking, hủy, chuyển trạng thái và xử lý hết hạn          |
| Payment  | Thu tiền thủ công, VNPay, IPN/Return, refund và reconcile             |
| Audit    | Ghi audit log; không có controller API riêng trong module             |
| Health   | Liveness và readiness                                                 |

HTTP đi qua cấu hình chung, guard/ValidationPipe, controller, service và lớp truy cập MySQL; response được xử lý bởi interceptor/filter. TypeORM dùng `synchronize: false`, `migrationsRun: true` và `timezone: 'Z'`. Schema được quản lý bằng migration; khởi động ứng dụng có thể thay đổi database.

Nguồn: [AppModule](src/app.module.ts), [bootstrap](src/main.ts), [cấu hình HTTP](src/bootstrap/configure-app.ts), [package.json](package.json).

Dashboard API, OTP/SMS, `NO_SHOW`, `BookingCharge` và partial refund: **[Chưa có trong mã nguồn hiện tại]**. Không coi đề xuất trong thiết kế lịch sử là chức năng đã triển khai.

## 2. Cấu hình môi trường và biến môi trường

Ứng dụng chọn `.env.test` khi biến của tiến trình `NODE_ENV === 'test'`; các trường hợp khác chọn `.env`. Cần đặt `NODE_ENV=test` **trước khi khởi động** nếu muốn chọn file test.

Bảng dưới phân biệt **giá trị trong .env.example** với fallback trong code. Giá trị ví dụ không phải cấu hình production và không phải lúc nào cũng là fallback.

Nguồn: [.env.example](.env.example), [environment.ts](src/config/environment.ts), [AppModule](src/app.module.ts), [main.ts](src/main.ts).

### HTTP và ứng dụng

| Biến                         | Giá trị trong .env.example  | Cách sử dụng/kiểm tra trong code                                                   |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `NODE_ENV`                   | `development`               | Validator mặc định `development`; ảnh hưởng chọn file và kiểm tra production       |
| `APP_PORT`                   | `3000`                      | Cổng listen; main.ts dùng 3000 khi không có giá trị                                |
| `CORS_ORIGINS`               | `http://localhost:5173`     | Danh sách origin HTTP/HTTPS ngăn bằng dấu phẩy; production yêu cầu không rỗng      |
| `SWAGGER_ENABLED`            | `false`                     | Nếu không khai báo, validator mặc định bật ngoài production; file mẫu chủ động tắt |
| `HTTP_JSON_BODY_LIMIT`       | `1mb`                       | Fallback `1mb`; kích thước dương, không quá `50mb`                                 |
| `HTTP_URLENCODED_BODY_LIMIT` | `1mb`                       | Cùng giới hạn trên, áp dụng body URL-encoded                                       |
| `ROOM_IMAGE_UPLOAD_DIR`      | `.data/uploads/room-images` | Thư mục ảnh; fallback cùng giá trị                                                 |

Các biến boolean được validator đọc nhận `true`, `false`, `1`, `0`. Ảnh được phục vụ tại `/media/room-images/`, không nằm dưới global prefix `/api`.

### MySQL và health

| Biến                         | Giá trị trong .env.example | Cách sử dụng/kiểm tra                                                 |
| ---------------------------- | -------------------------- | --------------------------------------------------------------------- |
| `DB_HOST`                    | `127.0.0.1`                | Host MySQL; AppModule dùng `getOrThrow`                               |
| `DB_PORT`                    | `3306`                     | Port MySQL; cũng là host port trong Compose                           |
| `DB_USERNAME`                | `property_user`            | Tài khoản kết nối; Compose truyền thành `MYSQL_USER`                  |
| `DB_PASSWORD`                | Giá trị thay thế           | Mật khẩu kết nối; Compose truyền thành `MYSQL_PASSWORD`               |
| `DB_DATABASE`                | `property_management`      | Database; Compose truyền thành `MYSQL_DATABASE`                       |
| `DB_POOL_SIZE`               | `10`                       | Fallback 10; số nguyên 1–100                                          |
| `DB_POOL_QUEUE_LIMIT`        | `50`                       | Fallback 50; số nguyên 1–1000                                         |
| `DB_CONNECT_TIMEOUT_MS`      | `5000`                     | Fallback 5000; số nguyên 250–60000 ms                                 |
| `HEALTH_DB_PROBE_TIMEOUT_MS` | `1000`                     | Fallback 1000; số nguyên 100–10000 ms                                 |
| `MYSQL_ROOT_PASSWORD`        | Giá trị thay thế           | Dùng bởi Compose/MySQL, không phải tài khoản kết nối mặc định của API |

[compose.yaml](compose.yaml) chỉ khai báo service `mysql`, image `mysql:8.4` và volume `mysql_data`; không có service container API.

### JWT và Booking

| Biến                                     | Giá trị trong .env.example | Cách sử dụng/kiểm tra                                              |
| ---------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `JWT_ACCESS_TOKEN_SECRET`                | Chuỗi mẫu phải thay        | Bắt buộc, tối thiểu 32 ký tự; validator từ chối chuỗi mẫu hiện tại |
| `JWT_ACCESS_TOKEN_EXPIRES_IN`            | `1h`                       | Fallback `1h`; duration dương                                      |
| `BOOKING_PAYMENT_TIMEOUT_MINUTES`        | `15`                       | Fallback 15; số nguyên 1–1440                                      |
| `BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER` | `3`                        | Fallback 3; số nguyên 1–20                                         |
| `BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER`   | `30`                       | Fallback 30; số nguyên 1–365                                       |
| `BOOKING_MAX_ADVANCE_DAYS`               | `365`                      | Fallback 365; số nguyên 1–3650                                     |
| `EXPIRATION_SCHEDULERS_ENABLED`          | `true`                     | Fallback true; bật/tắt scheduler xử lý hết hạn                     |

### VNPay

| Biến                        | Giá trị trong .env.example                           | Cách sử dụng/kiểm tra                                                            |
| --------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `VNPAY_ENABLED`             | `false`                                              | Fallback false                                                                   |
| `VNPAY_TMN_CODE`            | Rỗng                                                 | Khi bật VNPay, yêu cầu đúng 8 ký tự chữ/số                                       |
| `VNPAY_HASH_SECRET`         | Rỗng                                                 | Khi bật VNPay, yêu cầu tối thiểu 16 ký tự                                        |
| `VNPAY_PAYMENT_URL`         | `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html` | Fallback cùng URL; yêu cầu HTTPS                                                 |
| `VNPAY_RETURN_URL`          | `http://localhost:3000/api/v1/payments/vnpay/return` | Fallback cùng URL; kiểm tra HTTP/HTTPS và điều kiện production khi bật VNPay     |
| `VNPAY_FRONTEND_RETURN_URL` | `http://localhost:5173/payments/vnpay/return`        | Fallback trong code là rỗng; có giá trị thì kiểm tra URL và điều kiện production |
| `VNPAY_REQUEST_TIMEOUT_MS`  | `10000`                                              | Fallback 10000; số nguyên 1000–120000 ms                                         |

Trong production, helper kiểm tra Return URL yêu cầu HTTPS và loại một số hostname local được liệt kê trong code. Đây không phải kiểm tra kết nối thực tế tới URL. `VNPAY_RETURN_URL` không phải endpoint IPN.

### Seed và công cụ kiểm thử

| Biến                          | Phạm vi                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| `SEED_ADMIN_FULL_NAME`        | Tên ADMIN; bắt buộc khi chạy seed                                    |
| `SEED_ADMIN_EMAIL`            | Email ADMIN; bắt buộc khi chạy seed                                  |
| `SEED_ADMIN_PHONE`            | Số điện thoại tùy chọn                                               |
| `SEED_ADMIN_PASSWORD`         | Mật khẩu được kiểm tra bởi `requirePassword`; bắt buộc khi chạy seed |
| `PRODUCTION_SMOKE_PORT`       | Script smoke; fallback 3100                                          |
| `PRODUCTION_SMOKE_TIMEOUT_MS` | Script smoke; fallback 20000 ms                                      |

Nguồn: [seed-admin.ts](src/database/seeds/seed-admin.ts), [smoke-production-start.js](scripts/smoke-production-start.js). Các biến smoke không nằm trong `.env.example`; script đọc môi trường tiến trình.

Script tạo fixture riêng còn đọc `HBMS_LIVE_ADMIN_IDENTIFIER`, `HBMS_LIVE_STAFF_IDENTIFIER`, `HBMS_LIVE_AUTH_PASSWORD` và `HBMS_LIVE_COUNTER_CUSTOMER_PHONE` trong [provision-live-auth-fixtures.ts](scripts/provision-live-auth-fixtures.ts). Không cần chạy script này để khởi động API; nó ghi dữ liệu tài khoản kiểm thử.

## 3. Cài đặt và chạy dự án

### Yêu cầu

- Node.js `22.x` theo `package.json` và npm.
- MySQL 8.4 theo Compose.
- Docker Compose nếu dùng service MySQL của repo; không bắt buộc nếu đã có MySQL phù hợp.

Các command dưới đây dùng PowerShell và chạy từ thư mục gốc repo. Chạy từng bước, dừng nếu command lỗi; không sử dụng database production cho hướng dẫn local.

### Cài dependency và tạo cấu hình

```powershell
npm ci
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
```

Sửa `.env` trước khi khởi động:

- Thay `JWT_ACCESS_TOKEN_SECRET` bằng secret riêng đạt điều kiện validator. Giữ nguyên chuỗi mẫu sẽ làm ứng dụng không khởi động.
- Điền kết nối `DB_*`; nếu dùng Compose, điền thêm `MYSQL_ROOT_PASSWORD`.
- Giữ `VNPAY_ENABLED=false` nếu chưa có cấu hình VNPay; khi bật phải cung cấp các giá trị hợp lệ.
- Không commit secret hoặc file `.env`.

### Khởi động MySQL và API

Nếu dùng MySQL trong repo:

```powershell
docker compose up -d mysql
docker compose ps
```

Chờ MySQL sẵn sàng rồi chạy:

```powershell
npm run start:dev
```

API nghiệp vụ có tiền tố `http://localhost:3000/api/v1` khi dùng port mẫu; health ở `/api/health`. Không có cam kết rằng gọi trực tiếp URL gốc prefix sẽ trả một resource.

Ứng dụng tự chạy migration còn chờ. Có thể xem/chạy migration bằng CLI:

```powershell
npm run migration:show
npm run migration:run
```

`migration:run` thay đổi schema/dữ liệu theo migration. Không bật `synchronize` để thay thế migration.

### Seed ADMIN và Swagger

Sau khi schema đã tồn tại, điền `SEED_ADMIN_*` và chạy:

```powershell
npm run seed:admin
```

Seed tạo ADMIN nếu email chưa tồn tại; không đổi mật khẩu ADMIN đã có. Nếu email thuộc User không phải ADMIN, script báo lỗi. Seed mặc định từ chối production nếu thiếu cờ cho phép trong script.

Đặt `SWAGGER_ENABLED=true`, khởi động lại API để truy cập:

- Swagger UI: `http://localhost:3000/api/docs`.
- OpenAPI JSON: `http://localhost:3000/api/docs-json`.

### Build và kiểm thử

```powershell
npx tsc --noEmit
npm run lint
npm test -- --runInBand
npm run build
```

Chạy artifact đã build:

```powershell
npm run start:prod
```

Tên script `start:prod` chỉ chạy `node dist/main.js`, **không tự đặt `NODE_ENV=production`**. Cấu hình triển khai thực tế của máy chủ: **[Chưa có trong mã nguồn hiện tại]**.

E2E cần database riêng có tên kết thúc bằng `_test`. Chuẩn bị `.env.test` từ [.env.test.example](.env.test.example), chỉnh kết nối tới database test, sau đó:

```powershell
$env:NODE_ENV = 'test'
npm run test:e2e -- --runInBand
```

E2E nạp `.env.test` với `override: true` và có thao tác thay đổi dữ liệu. Không trỏ file này vào database thật. Xem [hướng dẫn kiểm thử](docs/testing-and-deployment.md) cho migration, schema, OpenAPI và smoke; tài liệu này không tuyên bố các command vừa được chạy thành công.

## 4. API và chức năng hiện có

Danh sách dưới trích từ decorator của **67 handler** trong controller. Prefix `/api` lấy từ `configureApp`; `:id`, `:bookingId`, `:roomId`, `:imageId` là path parameter.

Cột quyền ghi lại `Roles`/`Actors` hoặc JWT ở controller. Đây không phải toàn bộ điều kiện nghiệp vụ: service còn kiểm tra quyền sở hữu và trạng thái bản ghi. Với IPN/Return, không có bearer không đồng nghĩa bỏ kiểm tra chữ ký VNPay.

Request/response DTO và schema chi tiết nằm tại [OpenAPI](openapi/openapi.json) và [hợp đồng API](docs/api-contracts.md). Tên handler được giữ nguyên để tìm trong source.

### health.controller.ts

Nguồn: [controller](src/common/health/health.controller.ts).

| Method | Endpoint            | Handler        | Quyền khai báo              |
| ------ | ------------------- | -------------- | --------------------------- |
| `GET`  | `/api/health/live`  | `getLiveness`  | Không khai báo Roles/Actors |
| `GET`  | `/api/health/ready` | `getReadiness` | Không khai báo Roles/Actors |

### amenity-admin.controller.ts

Nguồn: [controller](src/module/amenity/amenity-admin.controller.ts).

| Method   | Endpoint                              | Handler      | Quyền khai báo |
| -------- | ------------------------------------- | ------------ | -------------- |
| `POST`   | `/api/v1/admin/amenities`             | `create`     | ADMIN          |
| `GET`    | `/api/v1/admin/amenities`             | `list`       | ADMIN          |
| `GET`    | `/api/v1/admin/amenities/:id`         | `getById`    | ADMIN          |
| `PATCH`  | `/api/v1/admin/amenities/:id`         | `update`     | ADMIN          |
| `DELETE` | `/api/v1/admin/amenities/:id`         | `softDelete` | ADMIN          |
| `PATCH`  | `/api/v1/admin/amenities/:id/restore` | `restore`    | ADMIN          |

### amenity.controller.ts

Nguồn: [controller](src/module/amenity/amenity.controller.ts).

| Method | Endpoint                | Handler   | Quyền khai báo              |
| ------ | ----------------------- | --------- | --------------------------- |
| `GET`  | `/api/v1/amenities`     | `list`    | Không khai báo Roles/Actors |
| `GET`  | `/api/v1/amenities/:id` | `getById` | Không khai báo Roles/Actors |

### auth.controller.ts

Nguồn: [controller](src/module/auth/auth.controller.ts).

| Method | Endpoint                          | Handler            | Quyền khai báo              |
| ------ | --------------------------------- | ------------------ | --------------------------- |
| `POST` | `/api/v1/auth/customers/register` | `registerCustomer` | Không khai báo Roles/Actors |
| `POST` | `/api/v1/auth/customers/login`    | `loginCustomer`    | Không khai báo Roles/Actors |
| `POST` | `/api/v1/auth/users/login`        | `loginUser`        | Không khai báo Roles/Actors |
| `GET`  | `/api/v1/auth/me`                 | `me`               | JWT                         |

### booking-management.controller.ts

Nguồn: [controller](src/module/booking/booking-management.controller.ts).

| Method  | Endpoint                                 | Handler        | Quyền khai báo |
| ------- | ---------------------------------------- | -------------- | -------------- |
| `POST`  | `/api/v1/management/bookings`            | `create`       | ADMIN, STAFF   |
| `GET`   | `/api/v1/management/bookings`            | `list`         | ADMIN, STAFF   |
| `GET`   | `/api/v1/management/bookings/:id`        | `getById`      | ADMIN, STAFF   |
| `PATCH` | `/api/v1/management/bookings/:id/status` | `updateStatus` | ADMIN, STAFF   |

### booking.controller.ts

Nguồn: [controller](src/module/booking/booking.controller.ts).

| Method  | Endpoint                      | Handler   | Quyền khai báo |
| ------- | ----------------------------- | --------- | -------------- |
| `POST`  | `/api/v1/bookings`            | `create`  | customer       |
| `GET`   | `/api/v1/bookings`            | `list`    | customer       |
| `GET`   | `/api/v1/bookings/:id`        | `getById` | customer       |
| `PATCH` | `/api/v1/bookings/:id/cancel` | `cancel`  | customer       |

### customer-admin.controller.ts

Nguồn: [controller](src/module/customer/customer-admin.controller.ts).

| Method  | Endpoint                       | Handler         | Quyền khai báo |
| ------- | ------------------------------ | --------------- | -------------- |
| `GET`   | `/api/v1/customers`            | `listCustomers` | ADMIN          |
| `PATCH` | `/api/v1/customers/:id/status` | `updateStatus`  | ADMIN          |

### customer-credential-management.controller.ts

Nguồn: [controller](src/module/customer/customer-credential-management.controller.ts).

| Method  | Endpoint                                            | Handler              | Quyền khai báo |
| ------- | --------------------------------------------------- | -------------------- | -------------- |
| `PATCH` | `/api/v1/management/customers/:id/initial-password` | `setInitialPassword` | ADMIN, STAFF   |

### customer-profile.controller.ts

Nguồn: [controller](src/module/customer/customer-profile.controller.ts).

| Method  | Endpoint                        | Handler          | Quyền khai báo |
| ------- | ------------------------------- | ---------------- | -------------- |
| `GET`   | `/api/v1/customers/me`          | `me`             | customer       |
| `PATCH` | `/api/v1/customers/me`          | `updateMe`       | customer       |
| `PATCH` | `/api/v1/customers/me/password` | `changePassword` | customer       |

### payment-management.controller.ts

Nguồn: [controller](src/module/payment/payment-management.controller.ts).

| Method | Endpoint                                                   | Handler                  | Quyền khai báo |
| ------ | ---------------------------------------------------------- | ------------------------ | -------------- |
| `GET`  | `/api/v1/management/payments`                              | `listAll`                | ADMIN, STAFF   |
| `GET`  | `/api/v1/management/bookings/:bookingId/payments`          | `list`                   | ADMIN, STAFF   |
| `POST` | `/api/v1/management/bookings/:bookingId/payments`          | `create`                 | ADMIN, STAFF   |
| `POST` | `/api/v1/management/payments/:id/refund`                   | `refund`                 | ADMIN          |
| `POST` | `/api/v1/management/payments/:id/resolve-duplicate-charge` | `resolveDuplicateCharge` | ADMIN          |
| `POST` | `/api/v1/management/payments/:id/reconcile-refund`         | `reconcileRefund`        | ADMIN          |

### payment.controller.ts

Nguồn: [controller](src/module/payment/payment.controller.ts).

| Method | Endpoint                               | Handler              | Quyền khai báo |
| ------ | -------------------------------------- | -------------------- | -------------- |
| `POST` | `/api/v1/bookings/:bookingId/payments` | `createVnPayPayment` | customer       |
| `GET`  | `/api/v1/bookings/:bookingId/payments` | `list`               | customer       |

### vnpay.controller.ts

Nguồn: [controller](src/module/payment/vnpay.controller.ts).

| Method | Endpoint                        | Handler     | Quyền khai báo              |
| ------ | ------------------------------- | ----------- | --------------------------- |
| `GET`  | `/api/v1/payments/vnpay/ipn`    | `ipn`       | Không khai báo Roles/Actors |
| `GET`  | `/api/v1/payments/vnpay/return` | `getReturn` | Không khai báo Roles/Actors |

### room-image.controller.ts

Nguồn: [controller](src/module/room/room-image.controller.ts).

| Method   | Endpoint                                 | Handler    | Quyền khai báo |
| -------- | ---------------------------------------- | ---------- | -------------- |
| `DELETE` | `/api/v1/room-images/:imageId`           | `delete`   | ADMIN          |
| `PATCH`  | `/api/v1/room-images/:imageId/set-cover` | `setCover` | ADMIN          |

### room-management.controller.ts

Nguồn: [controller](src/module/room/room-management.controller.ts).

| Method   | Endpoint                                    | Handler     | Quyền khai báo |
| -------- | ------------------------------------------- | ----------- | -------------- |
| `GET`    | `/api/v1/management/rooms`                  | `list`      | ADMIN, STAFF   |
| `GET`    | `/api/v1/management/rooms/available`        | `available` | ADMIN, STAFF   |
| `GET`    | `/api/v1/management/rooms/:roomId/calendar` | `calendar`  | ADMIN, STAFF   |
| `POST`   | `/api/v1/management/rooms/:roomId/blocks`   | `block`     | ADMIN, STAFF   |
| `DELETE` | `/api/v1/management/rooms/:roomId/blocks`   | `unblock`   | ADMIN, STAFF   |
| `GET`    | `/api/v1/management/rooms/:id`              | `getById`   | ADMIN, STAFF   |

### room.controller.ts

Nguồn: [controller](src/module/room/room.controller.ts).

| Method   | Endpoint                       | Handler        | Quyền khai báo              |
| -------- | ------------------------------ | -------------- | --------------------------- |
| `GET`    | `/api/v1/rooms/search`         | `search`       | Không khai báo Roles/Actors |
| `GET`    | `/api/v1/rooms`                | `list`         | Không khai báo Roles/Actors |
| `GET`    | `/api/v1/rooms/:id`            | `getById`      | Không khai báo Roles/Actors |
| `POST`   | `/api/v1/rooms`                | `create`       | ADMIN                       |
| `PATCH`  | `/api/v1/rooms/:id`            | `update`       | ADMIN                       |
| `DELETE` | `/api/v1/rooms/:id`            | `delete`       | ADMIN                       |
| `PATCH`  | `/api/v1/rooms/:id/status`     | `updateStatus` | ADMIN, STAFF                |
| `POST`   | `/api/v1/rooms/:roomId/images` | `createImage`  | ADMIN                       |

### room-type-admin.controller.ts

Nguồn: [controller](src/module/room-type/room-type-admin.controller.ts).

| Method   | Endpoint                                 | Handler        | Quyền khai báo |
| -------- | ---------------------------------------- | -------------- | -------------- |
| `POST`   | `/api/v1/admin/room-types`               | `create`       | ADMIN          |
| `GET`    | `/api/v1/admin/room-types`               | `list`         | ADMIN          |
| `GET`    | `/api/v1/admin/room-types/:id`           | `getById`      | ADMIN          |
| `PATCH`  | `/api/v1/admin/room-types/:id`           | `update`       | ADMIN          |
| `DELETE` | `/api/v1/admin/room-types/:id`           | `softDelete`   | ADMIN          |
| `PATCH`  | `/api/v1/admin/room-types/:id/restore`   | `restore`      | ADMIN          |
| `PUT`    | `/api/v1/admin/room-types/:id/amenities` | `setAmenities` | ADMIN          |

### room-type.controller.ts

Nguồn: [controller](src/module/room-type/room-type.controller.ts).

| Method | Endpoint                 | Handler   | Quyền khai báo              |
| ------ | ------------------------ | --------- | --------------------------- |
| `GET`  | `/api/v1/room-types`     | `list`    | Không khai báo Roles/Actors |
| `GET`  | `/api/v1/room-types/:id` | `getById` | Không khai báo Roles/Actors |

### user-admin.controller.ts

Nguồn: [controller](src/module/user/user-admin.controller.ts).

| Method  | Endpoint                   | Handler        | Quyền khai báo |
| ------- | -------------------------- | -------------- | -------------- |
| `POST`  | `/api/v1/users`            | `createUser`   | ADMIN          |
| `GET`   | `/api/v1/users`            | `listUsers`    | ADMIN          |
| `PATCH` | `/api/v1/users/:id`        | `updateUser`   | ADMIN          |
| `PATCH` | `/api/v1/users/:id/status` | `updateStatus` | ADMIN          |

Chi tiết kiến trúc, nghiệp vụ, database và thanh toán: [mục lục tài liệu](docs/README.md).
