# Lượt 12 - Database và maintenance

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. Phạm vi

- 14 migration được đăng ký trong `data-source.ts`;
- entity metadata, index, FK và check constraint;
- E2E database safety guard và migration application;
- 10 data invariant, data-audit runner;
- admin seed và Vietnamese phone normalization;
- backup/migration/rollback runbook.

Không chạy DDL trên database phát triển. Revert/apply thật chỉ chạy sau khi xác
nhận `NODE_ENV=test` và `DB_DATABASE=hbms_test`.

## 2. Phát hiện và sửa

| ID | Severity | Phát hiện | Sửa |
|---|---|---|---|
| DB-001 | P1 | `schema:log` còn 8 operation: precision `amenities.deleted_at`, index và FK action của `room_type_amenities` lệch entity metadata | Thêm migration `1784783000000-AlignAmenityJoinMetadata`; `schema:check` hiện báo khớp 0 operation |
| DB-002 | P2 | Data-audit có runtime read-only guard nhưng thiếu negative test trực tiếp | Export guard; test từ chối non-SELECT và `SELECT; DELETE`, từ chối count không hợp lệ |
| DB-003 | P2 | `seed:admin` có thể chạy trên production mà không cần xác nhận rõ | Production bắt buộc `--allow-production`; thêm direct unit |
| DB-004 | P2 | Chưa có runbook backup/restore proof, migration window và rollback decision | Thêm `docs/DATABASE_MIGRATION_RUNBOOK.md` |
| DB-005 | P2 | Chưa có automated migration registration/up/down contract | Thêm contract test cho thứ tự, uniqueness, SQL up/down và baseline backup-only |

Migration mới không sửa migration lịch sử đã có thể được áp dụng ở môi trường
khác. `up` và `down` đều giữ dữ liệu join, chỉ đổi precision/index/FK metadata.

## 3. Migration và schema evidence

- `synchronize: false` tại cả app TypeORM config và CLI data source.
- 14/14 migration test DB đã applied theo timestamp order.
- 13 migration sau baseline có `up`/`down` executable test.
- Initial baseline chủ động reject `down` và yêu cầu restore backup, không giả
  lập rollback an toàn.
- Dashboard index migration và Amenity alignment migration đều đã được
  `migration:revert` rồi `migration:run` thành công trên MySQL `hbms_test`.
- `npm run schema:check`: metadata khớp migration, 0 pending schema operation.
- E2E query `INFORMATION_SCHEMA` xác nhận critical check/FK/unique/composite
  indexes tồn tại sau migration.

Database phát triển hiện còn hai migration pending:

- `AddDashboardQueryIndexes1784782000000`;
- `AlignAmenityJoinMetadata1784783000000`.

Audit không tự apply lên DB phát triển. Operator phải theo runbook và backup
trước khi chạy.

## 4. Data invariant

`npm run data:audit` chỉ thực hiện SELECT và PASS 10/10:

1. active booking/calendar;
2. cancelled booking/calendar;
3. single successful payment;
4. booking/payment status agreement;
5. room/check-in occupancy;
6. exactly one image cover;
7. room-type/amenity orphan;
8. expired booking;
9. expired VNPay payment;
10. stale refund.

Check name là duy nhất. Runner từ chối SQL mutation và count âm/NaN. E2E safety
guard chạy trước migration/cleanup, bắt buộc `NODE_ENV=test` và database suffix
`_test`.

## 5. Seed và phone normalization

- Phone check dry-run: 0 planned change, 0 invalid, 0 collision.
- Apply mode đọc lại dữ liệu dưới pessimistic write lock, chạy trong transaction,
  so khớp `affected=1` để phát hiện concurrent update.
- Production phone apply và admin seed đều cần `--allow-production`.
- Admin seed normalize input/phone, hash password, idempotent theo email và từ
  chối account cùng email nhưng không có role ADMIN.
- Không chạy admin seed trong audit vì đây là mutation không cần thiết.

## 6. Regression gate

- Database targeted: 5 suite, 28/28 test PASS.
- Build: PASS.
- Lint: PASS.
- Full unit: 41 suite, 276/276 PASS.
- MySQL E2E: 36/36 PASS.
- Latest migration real up/down: PASS.
- Schema drift: 0 operation, PASS.
- Data audit: 10/10 PASS.
- OpenAPI check/contract: 3/3 PASS.

## 7. Capability matrix

| Tiêu chí | Trạng thái |
|---|---|
| Migration up/down, order và application | PASS |
| Index/FK/check constraint | PASS |
| `synchronize: false` | PASS |
| Test DB safety guard | PASS |
| Data-audit read-only | PASS |
| Seed/phone normalization safety | PASS |
| Backup/runbook trước production migration | PASS |
| Orphan/calendar/cover/payment/refund invariant | PASS |

Không còn P0/P1 trong phạm vi. Lượt tiếp theo:
`Lượt 13 - Repository hygiene và architecture direction`.
