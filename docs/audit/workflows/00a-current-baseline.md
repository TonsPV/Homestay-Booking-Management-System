# Lượt 0A - Current truth và release baseline

Ngày chạy: 2026-08-01  
Phạm vi: toàn backend; chỉ kiểm chứng, không sửa business logic và không tự chạy
migration trên database phát triển.  
HEAD: 489ecfbbcc77120fc0a5191a466ba0e37a76ede5  
Worktree: dirty; kết quả dưới đây chạy trên HEAD cộng toàn bộ thay đổi hiện có.

## 1. Quy tắc và nguồn bằng chứng

Precedence dùng trong lượt này:

1. command chạy trên worktree hiện tại;
2. code/schema/OpenAPI hiện tại;
3. runbook và kế hoạch nguồn;
4. audit cũ chỉ để giải thích lịch sử.

Không coi kết quả của ngày 2026-07-29 là current truth nếu chưa chạy lại.

## 2. Snapshot Git và môi trường

| Hạng mục | Kết quả |
|---|---|
| HEAD | 489ecfbbcc77120fc0a5191a466ba0e37a76ede5 |
| Git status | 148 entry: 73 modified, 3 deleted, 72 untracked |
| Node/npm | v22.13.0 / 10.9.2 |
| Timestamp | 2026-08-01 19:30:52 +07:00 |
| Domain module | amenity, auth, booking, customer, dashboard, payment, room, room-type, user |
| OpenAPI | 51 paths, 67 operations, 71 schemas |
| Main E2E | app.e2e-spec.ts dài 3.971 dòng, 39 test block |

Nhiều capability source, migration, test và tài liệu audit vẫn untracked. Đây
không phải bằng chứng file rác; đây là blocker về reproducibility nếu clean
checkout không có các file này.

## 3. Command gate

| Command | Kết quả | Evidence/ghi chú |
|---|---|---|
| npm run build | PASS | Nest build exit code 0 |
| npm run lint | PASS | ESLint exit code 0 |
| npm test -- --runInBand | PASS | 42 suite, 302 test |
| npm run test:cov:unit -- --runInBand | PASS | 66,04% statement; 56,52% branch; 68,66% function; 66,20% line |
| npm run test:e2e -- --runInBand | PASS | 3 suite, 41 test; log simulated VNPay timeout là fixture có chủ đích |
| npm run openapi:check | PASS | Snapshot current |
| npm run openapi:validate | PASS | OpenAPI check + 4 contract test |
| npm run migration:show | PASS command | 12 migration applied, 2 pending |
| npm run schema:check | FAIL | 13 pending schema operation |
| npm run data:audit | PASS | 10/10 invariant, 0 violation |
| npm audit --omit=dev --audit-level=high --json | FAIL | 2 High record từ js-yaml qua @nestjs/swagger |

### 3.1. Coverage trọng điểm

Coverage tổng không thay thế state matrix. Các capability cần hardening:

| File | Branch |
|---|---:|
| payment-collection.service.ts | 52,05% |
| payment-refund.service.ts | 56,47% |
| room-mutation.service.ts | 57,31% |
| room-type.service.ts | 53,57% |
| booking-lifecycle.service.ts | 76,09% |

Payment Collection/Refund hiện dưới mục tiêu 70% branch của kế hoạch nguồn.

## 4. Schema và migration

Migration chưa chạy:

- AddDashboardQueryIndexes1784782000000;
- AlignAmenityJoinMetadata1784783000000.

schema:check báo 13 pending operation, gồm index cho Dashboard/Payment/Booking/
RoomCalendar và thay đổi FK/index/metadata bảng room_type_amenities cùng
amenities.deleted_at.

Đây là schema readiness FAIL, không phải data invariant defect. data:audit vẫn
PASS toàn bộ 10 check:

- active booking/calendar;
- cancelled booking/calendar;
- single successful payment;
- booking/payment status;
- room occupancy;
- room image cover;
- room type/amenity orphan;
- expired booking;
- expired payment;
- stale refund.

Theo docs/DATABASE_MIGRATION_RUNBOOK.md:20-50, chưa được chạy migration lên
database không rõ tên hoặc không có backup restore proof. Lượt 0A không có đủ
backup ID, restore smoke flow và operator approval, nên migration apply được đánh
dấu BLOCKED_EXTERNAL/OPERATIONAL và không tự thực hiện.

## 5. Dependency và release blocker

Dependency audit tái hiện:

- @nestjs/swagger 11.4.6 kéo js-yaml 5.2.1;
- advisory GHSA-pm4m-ph32-ghv5, severity High;
- npm đề xuất đổi @nestjs/swagger xuống 11.4.5;
- chưa chạy npm audit fix --force.

Chưa chọn upgrade/override/risk acceptance vì cần review compatibility OpenAPI và
package diff. Trạng thái: GAP_EVIDENCE, P2 release risk.

Worktree chưa có clean checkout reproducibility proof. Trạng thái: GAP_EVIDENCE,
P2 release risk.

Repository không có CI workflow được kiểm tra trong lượt này; compose.yaml chỉ
provision MySQL. Trạng thái: GAP_EVIDENCE, P2 operational risk.

## 6. Capability result

| Capability | Status | Lý do |
|---|---|---|
| Build/lint/unit | VERIFIED | Command current pass |
| E2E | VERIFIED | 41/41 current pass trên MySQL test |
| OpenAPI | VERIFIED | Snapshot và contract current pass |
| Data invariants | VERIFIED | 10/10 current pass |
| Development schema | FAIL | 2 migration pending, schema check fail |
| Production release readiness | BLOCKED_EXTERNAL | Thiếu migration approval/backup proof, dependency disposition, clean Git baseline |
| Workflow correctness | PARTIAL | Chưa chạy các module-by-module matrix của Lượt 1-13 |

## 7. Điều kiện vào Lượt 0B

Lượt 0B chỉ bắt đầu sau khi:

1. chốt owner của current Git baseline;
2. có quyết định DB test/development nào được phép apply migration;
3. giữ nguyên safety guard NODE_ENV=test và database suffix _test;
4. tạo shared E2E bootstrap/fixture/cleanup owner;
5. chứng minh full 41 E2E vẫn pass sau khi harness được dùng;
6. không để nhiều suite tự migrate/truncate cùng DB song song.

Lượt 0A được đóng ở mức PARTIAL/BLOCKED, không phải PASS toàn release. Domain
audit có thể tiếp tục phân tích, nhưng không được tuyên bố backend release-stable
cho tới khi schema/reproducibility gate được giải quyết.
