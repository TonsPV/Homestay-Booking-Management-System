# Homestay Booking Management System API

Backend cho hệ thống đặt phòng và quản lý homestay, phục vụ khách hàng, nhân viên và quản trị viên. Dự án tập trung vào vòng đời đặt phòng, lịch phòng và tính nhất quán của giao dịch thanh toán.

## Công nghệ

- **Backend:** TypeScript, Node.js 22, NestJS, REST API.
- **Dữ liệu:** MySQL 8.4, TypeORM, migration.
- **Xác thực và tích hợp:** JWT, Google Identity Services, VNPay, Socket.IO.
- **Kiểm thử và hợp đồng API:** Jest, Supertest, Swagger/OpenAPI.
- **Môi trường local:** Docker Compose cho MySQL.

## Chức năng chính

| Nhóm | Chức năng |
| --- | --- |
| Tài khoản | Đăng ký, đăng nhập, hồ sơ khách hàng và phân quyền ADMIN/STAFF |
| Phòng | Quản lý phòng, loại phòng, tiện nghi, ảnh và tra cứu phòng trống |
| Đặt phòng | Tạo, hủy, cập nhật trạng thái, quản lý lịch chặn phòng và hết hạn giữ chỗ |
| Thanh toán | Thu tiền thủ công, thanh toán VNPay, xác minh IPN, hoàn tiền và đối soát |
| Hỗ trợ | Chat theo booking giữa khách hàng và bộ phận hỗ trợ qua Socket.IO |
| Vận hành | Audit log, kiểm tra liveness/readiness và kiểm tra tính toàn vẹn dữ liệu |

### Các vấn đề nghiệp vụ được xử lý

- **Đặt trùng phòng:** tạo booking trong transaction, khóa phòng và kiểm tra lịch trước khi ghi dữ liệu.
- **Yêu cầu gửi lại:** xử lý idempotency cho luồng tạo booking và thanh toán để tránh ghi nhận lặp.
- **Giữ chỗ quá hạn:** tác vụ định kỳ xử lý booking chưa thanh toán hết hạn và giải phóng lịch phòng.
- **Xác nhận thanh toán sai:** kiểm tra chữ ký, số tiền và giao dịch VNPay ở Backend; trang trình duyệt quay về không tự quyết định thanh toán thành công.
- **Truy cập sai phạm vi:** kiểm tra loại tài khoản, vai trò và quyền sở hữu dữ liệu tại Backend.

## Chạy trên máy local

### 1. Chuẩn bị

Cài **Node.js 22**, **npm** và **Docker Compose** (hoặc MySQL có sẵn). Chạy các lệnh dưới đây tại thư mục gốc Backend.

```sh
npm ci
```

Sao chép `.env.example` thành `.env`. Với PowerShell:

```powershell
Copy-Item .env.example .env
```

Chỉnh các giá trị trong `.env` trước khi khởi động:

| Biến | Cấu hình cần thiết |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` | Kết nối MySQL; dùng `127.0.0.1` khi chạy API trên máy và MySQL qua Compose |
| `MYSQL_ROOT_PASSWORD` | Mật khẩu root của MySQL khi dùng Compose |
| `JWT_ACCESS_TOKEN_SECRET` | Thay chuỗi mẫu bằng secret riêng, tối thiểu 32 ký tự |
| `CORS_ORIGINS` | Origin Frontend; mặc định trong file mẫu là `http://localhost:5173` |
| `SWAGGER_ENABLED` | Đặt `true` để xem và thử API trên Swagger local |

Danh sách cấu hình đầy đủ nằm trong [.env.example](.env.example). VNPay, đăng nhập Google và chat mặc định tắt; có thể chạy ứng dụng trước khi cấu hình các tích hợp này.

### 2. Khởi động database và API

Nếu dùng MySQL qua Docker Compose:

```sh
docker compose up -d mysql
docker compose ps
```

Đợi MySQL báo healthy, sau đó:

```sh
npm run start:dev
```

Ứng dụng tự chạy migration khi khởi động; schema không dùng `synchronize`. Compose chỉ chạy MySQL, API chạy bằng Node.js trên máy.

Với cổng local mặc định `3000`:

| Địa chỉ | Mục đích |
| --- | --- |
| `http://localhost:3000/api` | Prefix API |
| `http://localhost:3000/api/docs` | Swagger UI khi `SWAGGER_ENABLED=true` |
| `http://localhost:3000/api/docs-json` | OpenAPI JSON khi bật Swagger |
| `http://localhost:3000/api/health/live` | Kiểm tra tiến trình |
| `http://localhost:3000/api/health/ready` | Kiểm tra khả năng kết nối database |

Cổng được lấy từ `PORT`, sau đó `APP_PORT`, mặc định `3000`.

### 3. Tạo tài khoản quản trị

Sau khi migration đã chạy, cấu hình `SEED_ADMIN_FULL_NAME`, `SEED_ADMIN_EMAIL` và `SEED_ADMIN_PASSWORD` trong `.env`, rồi chạy:

```sh
npm run seed:admin
```

Dùng tài khoản này đăng nhập qua `POST /api/v1/auth/users/login`. Khách hàng đăng ký qua `POST /api/v1/auth/customers/register`.

### Tích hợp tùy chọn

- **VNPay:** bật `VNPAY_ENABLED`, điền thông tin merchant và các URL trong `.env.example`. Endpoint IPN là `/api/v1/payments/vnpay/ipn` và phải có địa chỉ VNPay truy cập được; Return URL phục vụ luồng quay về sau thanh toán.
- **Google:** bật `GOOGLE_AUTH_ENABLED` và cấu hình `GOOGLE_CLIENT_ID` phù hợp với ứng dụng Frontend.
- **Chat:** bật `CHAT_ENABLED` sau khi migration đã áp dụng; Socket.IO dùng namespace `/chat` và path `/socket.io`.

## Cấu trúc mã nguồn

```text
src/
  bootstrap/     Cấu hình HTTP, validation và xử lý response
  common/        Thành phần dùng chung, guard và health check
  config/        Kiểm tra cấu hình môi trường
  database/      Kết nối, migration, seed và công cụ dữ liệu
  module/        Auth, Customer, User, Room, Booking, Payment, Chat...
  openapi/       Cấu hình Swagger và sinh hợp đồng API
test/            Unit test và API end-to-end test
openapi/         Đặc tả API được lưu trong Git
scripts/         Công cụ kiểm tra và vận hành
```

Controller tiếp nhận HTTP request, service xử lý nghiệp vụ và lớp persistence truy cập dữ liệu. Các thao tác liên quan đến booking, lịch phòng và thanh toán sử dụng transaction khi cần giữ dữ liệu nhất quán.

## Kiểm thử và kiểm tra

```sh
npm run lint
npm run test -- --runInBand
npm run build
```

### API end-to-end

Tạo database riêng có tên kết thúc bằng `_test`, cấp quyền cho tài khoản test và sao chép `.env.test.example` thành `.env.test`. Chỉnh kết nối trong file này trước khi chạy. Bộ E2E có thay đổi dữ liệu nên không sử dụng database phát triển hoặc database thật.

Trong một phiên PowerShell dành riêng cho kiểm thử:

```powershell
Copy-Item .env.test.example .env.test
# Chỉnh .env.test để trỏ tới database test trước khi chạy tiếp.
$env:NODE_ENV = 'test'
npm run test:e2e -- --runInBand
```

### Các lệnh hỗ trợ

| Lệnh | Mục đích |
| --- | --- |
| `npm run migration:show` | Xem trạng thái migration |
| `npm run migration:run` | Áp dụng migration |
| `npm run schema:check` | Kiểm tra schema lệch với định nghĩa |
| `npm run data:audit` | Kiểm tra tính toàn vẹn dữ liệu |
| `npm run openapi:generate` | Sinh lại hợp đồng API |
| `npm run openapi:validate` | Kiểm tra hợp đồng OpenAPI và các test liên quan |

## Hợp đồng API và Frontend

Xem request, response và yêu cầu xác thực trong [đặc tả OpenAPI](openapi/openapi.json), hoặc dùng Swagger local để thử API. Các endpoint cần xác thực dùng `Authorization: Bearer <access_token>`.

Khi thay đổi endpoint hoặc DTO, chạy `npm run openapi:generate` tại Backend, sau đó chạy `npm run contract:generate` tại Frontend để đồng bộ kiểu dữ liệu.

## Chạy bản build

```sh
npm run build
npm run start:prod
```

`start:prod` chạy `dist/main.js`; cần đặt `NODE_ENV=production` trong môi trường triển khai. Cấu hình database, JWT secret, CORS và các tích hợp theo môi trường thực tế. Ảnh phòng được lưu tại `ROOM_IMAGE_UPLOAD_DIR`, cần lưu trữ bền vững nếu chạy trên nền tảng có filesystem tạm thời.
