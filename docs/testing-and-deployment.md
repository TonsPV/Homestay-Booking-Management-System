# Kiểm thử và triển khai

Cập nhật ngày **10/09/2026**. Tài liệu mô tả cách xác minh; không phải giấy xác nhận production đã sẵn sàng.

## Chuẩn bị môi trường riêng

Dùng Node.js 22 và MySQL 8.4. Database kiểm thử phải tách biệt, tên kết thúc bằng `_test`; tài khoản không được có quyền trên database thật.

1. Cài đúng dependency bằng `npm ci`.
2. Tạo `.env.test` từ [.env.test.example](../.env.test.example) nếu chưa có. Không ghi đè cấu hình đang dùng.
3. Điền kết nối tới database kiểm thử riêng và secret chỉ dùng cho test.
4. Giữ `EXPIRATION_SCHEDULERS_ENABLED=false`, thư mục ảnh riêng cho test và các giá trị VNPay thử nghiệm theo mẫu.
5. Kiểm tra cả biến môi trường của terminal lẫn `.env.test`. E2E nạp file này với `override: true`; chỉ đặt biến trên terminal không đủ để thay thế một file đang trỏ sai database.
6. Với CLI migration, schema, OpenAPI và smoke, đặt `NODE_ENV=test` để chọn đúng cấu hình kiểm thử. Không đưa secret vào Git.

E2E tạo/xóa dữ liệu phục vụ test. Khởi động ứng dụng, kể cả khi tạo OpenAPI hoặc chạy smoke, có thể tự áp dụng migration. Không chạy các bước này trên database production để “thử nhanh”.

## Thứ tự kiểm tra đầy đủ

Trên PowerShell, đặt môi trường trước:

```powershell
$env:NODE_ENV = 'test'
```

Chạy từng lệnh dưới đây; **dừng ngay khi một lệnh lỗi** và kiểm tra `$LASTEXITCODE`. PowerShell không tự dừng mọi lệnh tiếp theo chỉ vì chương trình ngoài trả mã lỗi.

```powershell
npm ci
npx tsc --noEmit
npm run lint
npm run build
npm run migration:run
npm run smoke:prod
npm run schema:check
npm run data:audit
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run openapi:check
npm run openapi:validate
git diff --check
npm audit --omit=dev --audit-level=high
```

`npm test` chỉ chạy unit test theo cấu hình trong package.json; không thay cho E2E. `openapi:validate` còn chạy nhóm test hợp đồng OpenAPI. `openapi:generate` ghi lại đặc tả; chỉ dùng khi thay đổi API có chủ đích và phải xem diff.

Lệnh audit trên chỉ chặn lỗ hổng production mức high/critical. Pass không đồng nghĩa mọi dependency, kể cả dev và mức thấp hơn, đều không có lỗ hổng. Dùng `npm audit` khi cần rà soát toàn bộ; không tự chạy `npm audit fix --force`.

## CI xác minh phiên bản nào?

[Workflow hiện tại](../.github/workflows/ci.yml) chạy trên pull request và khi push vào `main`. Nó dùng Ubuntu, Node 22 và container MySQL 8.4.

- Với pull request: checkout đúng `pull_request.head.sha`, không ngầm coi merge commit thử nghiệm là bản deploy.
- Với push: checkout `github.sha`.
- Workflow kiểm tra lại SHA trước khi chạy các bước xác minh.
- Workflow này **không có bước deploy**. CI xanh không chứng minh cấu hình production, DNS, TLS hay VNPay thật đã hoạt động.
- Sau khi commit thêm bất kỳ thay đổi nào, phải có kết quả mới cho SHA đó. Không dùng kết quả của commit trước để duyệt commit sau.

## Bằng chứng đã ghi nhận và giới hạn

| Bằng chứng                                                                                                 | Kết quả đã ghi nhận                                                                                                               | Giới hạn                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Lần xác minh local của đợt refactor trước lần sửa tài liệu này                                             | 774 unit test / 73 suite; 151 E2E / 22 suite; 6 test OpenAPI; TypeScript, lint, build, migration, schema, data audit và smoke đạt | Đây là kết quả lần chạy trước, không phải lần chạy mới trong công việc cập nhật tài liệu |
| [CI số 34379811906](https://github.com/TonsPV/Homestay-Booking-Management-System/actions/runs/34379811906) | Thành công cho SHA `78cb365bf6277ac3be2f0e6144aa350fd3e9975b`                                                                     | SHA này có trước các thay đổi cấu trúc và tài liệu đang nằm trong working tree           |
| [UAT cũ](../uat/UAT-REPORT.md)                                                                             | Có báo cáo lịch sử ngày 31/08/2026                                                                                                | Không xác nhận frontend/backend hiện tại hoặc bản deploy mới                             |

Không gắn số test vào README như một cam kết luôn đúng. Khi phát hành, ghi SHA, ngày chạy, môi trường, liên kết CI và kết quả tương ứng.

## Phạm vi của smoke và kiểm thử

[smoke:prod](../scripts/smoke-production-start.js) chạy `dist/main.js`, tắt scheduler/Swagger và chờ cổng TCP, mặc định 3100. Nó không tự đổi `NODE_ENV` thành production và không kiểm tra nội dung HTTP, nghiệp vụ thanh toán hay giao tiếp VNPay thật. Cổng kiểm tra phải trống để tránh nhầm với tiến trình khác.

Unit/E2E dùng dữ liệu và gateway phục vụ test. Kiểm tra production cần xác minh riêng callback công khai, chữ ký, cấu hình thương nhân và đường redirect. Không tạo giao dịch thật ngoài phạm vi được cho phép.

Có lệnh đo coverage, nhưng workflow hiện tại không đặt ngưỡng coverage bắt buộc. Số test pass không thay cho đánh giá độ bao phủ các đường lỗi.

## Danh sách trước khi phát hành

- Chốt và commit phiên bản; giữ working tree sạch, chạy workflow đúng SHA, triển khai artifact được tạo từ chính SHA đó.
- Sao lưu database và xác minh khả năng khôi phục. Kiểm tra migration từ schema đang dùng, không chỉ từ database trắng.
- Kiểm tra secret JWT, kết nối DB, pool, CORS, cấu hình VNPay và địa chỉ callback/Return. Không dùng giá trị ví dụ cho production.
- Tính đến việc ứng dụng tự chạy migration khi khởi động. Lập thứ tự rollout phù hợp và phương án khôi phục; không giả định DDL tự rollback.
- Cấu hình HTTPS, proxy và IP tin cậy phù hợp với rate limit. Không để probe dồn dập vượt giới hạn readiness.
- Kiểm tra HTTP liveness/readiness và một luồng nghiệp vụ được cho phép sau triển khai; việc cổng TCP mở là chưa đủ.
- Gắn volume bền vững cho ảnh; xác minh quyền ghi, sao lưu, URL phục vụ ảnh và truy cập khi có nhiều replica.
- Scheduler và một số trạng thái bảo vệ nằm trong từng tiến trình. Đánh giá phối hợp giữa replica trước khi mở rộng ngang.
- Bảo vệ log/audit chứa dữ liệu cá nhân; chốt quyền xem và thời hạn lưu.
- Không công bố Swagger ngoài phạm vi cần thiết. Kiểm tra schema/API không đổi ngoài chủ đích.
- Ghi biên bản phát hành với SHA và kết quả thực tế. Không tự merge hoặc deploy chỉ vì một lần chạy local đạt.

## Điểm cần giữ trong danh sách theo dõi

1. Hoàn tiền gateway chưa rõ kết quả có thể trả 503 nhưng vẫn ở trạng thái chờ đối soát. Frontend không được coi mọi 503 là hoàn tiền thất bại cuối cùng hoặc tạo thao tác mới tùy tiện.
2. STAFF xem danh sách thanh toán tổng có lọc phương thức; danh sách theo booking không dùng cùng bộ lọc. Cần chốt chủ đích phân quyền trước khi chuẩn hóa; tài liệu không tự coi đây là hành vi đã sửa.
3. Các báo cáo thiết kế cũ chứa đề xuất `NO_SHOW`, `BookingCharge` và trường thời điểm trả phòng thực tế chưa triển khai. Chúng không phải chức năng hiện hành.
4. Bản UAT cũ phụ thuộc fixture và môi trường riêng. Không chạy lại script UAT trên dữ liệu thật để thay thế E2E cô lập.
5. Bằng chứng CI phải đi cùng commit; kết quả local không thay cho kiểm tra môi trường vận hành.
