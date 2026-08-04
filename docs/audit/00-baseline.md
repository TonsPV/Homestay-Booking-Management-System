# Lượt 0 - Baseline và Inventory

Ngày chạy: 2026-07-29

Phạm vi: toàn Backend, chỉ kiểm chứng và kiểm kê; không sửa business logic.

## 1. Worktree baseline

- Worktree đã có thay đổi trước khi bắt đầu thực thi kế hoạch.
- `git status --short`: 52 entry gồm modified, deleted và untracked.
- Toàn bộ thay đổi hiện có được xem là baseline và được giữ nguyên.
- Không reset, restore, stage hoặc commit trong lượt này.

## 2. Kết quả command

| Command | Kết quả | Bằng chứng |
|---|---|---|
| `npm run migration:show` | PASS | 12/12 migration `[X]`, không có migration pending |
| `npm run data:audit` | PASS | 10/10 invariant, mỗi check có 0 violation |
| `npm run build` | PASS | Nest build exit code 0 |
| `npm run lint` | PASS | ESLint exit code 0 |
| `npm test -- --runInBand` | PASS | 14 suite, 70 test |
| `npm run test:e2e -- --runInBand` | PASS | 1 suite, 33 test trên DB `_test` |
| `npm run test:cov:unit -- --runInBand` | PASS | 22,82% statement; 22,53% line |
| `npm run openapi:generate` | PASS | snapshot được sinh lại thành công |

E2E có log `Simulated VNPay timeout` trong test refund failure. Đây là failure
fixture có chủ đích; suite và 33/33 test vẫn pass.

## 3. OpenAPI baseline

- Operation: 66.
- Operation JSON 2xx có schema: 66/66.
- Component schema: 70.
- Root demo đã không còn trong OpenAPI.

## 4. Module inventory

| Module | TS files | Routes | Unit specs trực tiếp | Service và số dòng |
|---|---:|---:|---:|---|
| Amenity | 9 | 8 | 0 | `AmenityService` 298 |
| Auth | 11 | 4 | 0 | `AuthService` 393; `AccessTokenService` 286; `PasswordHasherService` 105 |
| Booking | 14 | 8 | 0 | `BookingService` 1.083; expiration coordinator 17 |
| Customer | 13 | 6 | 0 | profile 175; credential 119; admin 136 |
| Dashboard | 6 | 1 | 1 | `DashboardQueryService` 315 |
| Payment | 15 | 9 | 2 gián tiếp | `PaymentService` 1.716; VNPay gateway 437 |
| Room | 23 | 15 | 2 | `RoomService` 767; availability 260; image 220; storage 147 |
| RoomType | 10 | 9 | 0 | `RoomTypeService` 465 |
| User | 7 | 4 | 0 | `UserAdminService` 336 |

## 5. Baseline risk

### P1/P2 cần xử lý theo đúng lượt

- Auth, User, Customer, Amenity, RoomType và Booking chưa có unit spec trực tiếp.
- `test/app.e2e-spec.ts` vẫn gánh toàn bộ 33 E2E flow.
- `BookingService` và `PaymentService` vượt ngưỡng 800 dòng.
- Unit line coverage 22,53%, thấp hơn gate Phase 2 là 45%.
- Dashboard/runtime đã được triển khai trong khi Phase 2 chưa đóng.

### Không phát hiện trong baseline

- Không có migration pending.
- Không có data invariant violation trong 10 check hiện tại.
- Không có build/lint/unit/E2E/OpenAPI failure.
- Không có bằng chứng P0 buộc dừng toàn hệ thống.

## 6. Gate Lượt 0

Trạng thái: `PASS`.

Điều kiện chuyển lượt:

- Baseline command có kết quả thật: đạt.
- MySQL development và test DB hoạt động: đạt.
- Dependency queue đã tạo: đạt.
- Không sửa business logic trong Lượt 0: đạt.

Lượt tiếp theo được phép bắt đầu: `Lượt 1 - Auth`.
