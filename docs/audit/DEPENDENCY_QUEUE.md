# HBMS Audit Dependency Queue

Ngày khởi tạo: 2026-07-29

Queue này giữ issue phát hiện ngoài phạm vi module đang audit. Issue chỉ được
mở để sửa khi đến đúng lượt, trừ P0 đã chứng minh.

| ID | Severity | Phát hiện/phụ thuộc | Owner/lượt | Trạng thái |
|---|---|---|---|---|
| DQ-001 | P1 | Frontend contract generation và thay type viết tay chưa hoàn tất gate Phase 1 liên repository | Frontend plan, ngoài phạm vi Backend audit | OPEN |
| DQ-002 | P2 | Auth phụ thuộc trạng thái/tokenVersion của User và Customer. User lock/unlock, Customer status/password và token revocation đã có direct unit + E2E | User/Customer Lượt 2-3 | CLOSED |
| DQ-003 | P2 | 36 E2E vẫn dồn trong `test/app.e2e-spec.ts` để dùng chung một MySQL lifecycle an toàn. Flow coverage PASS, nhưng file test lớn cần tách bằng một shared DB harness trước khi thêm nhiều flow mới; không tách cơ học gây migration/cleanup race | Test architecture hardening | OPEN |
| DQ-004 | P2 | Booking và Payment service phình đã xử lý: Booking facade 101 dòng; Payment facade 139 dòng, Query 241, Manual 244, Collection 587, Refund 751. Full unit/E2E/data audit PASS | Booking 7B-7C, Payment 8B-8C, Runtime 10 | CLOSED |
| DQ-005 | P2 | Booking/Payment Phase 2, Dashboard backend và Health/runtime đã audit PASS. Dashboard phase liên repository còn phụ thuộc frontend loading/error/empty/success và browser E2E; phần này tiếp tục được theo dõi độc lập qua DQ-001 | Dashboard/Runtime Lượt 9-10 | CLOSED |
| DQ-006 | P3 | Worktree baseline không được coi là file rác theo trạng thái Git. Lượt 13 đã scan 173 production/script file: 0 unreachable, 0 runtime cycle; ba Nest starter file chết được giữ ở trạng thái deleted và mọi generated/runtime directory đã được ignore | Repository hygiene Lượt 13 | CLOSED |
| DQ-007 | P2 | Actor/role/account-status đã có owner enum chung tại `common/domain/account.enums.ts`; entity, HTTP type, validator và Swagger enum cùng dẫn xuất từ owner này, giữ nguyên value API/DB | Repository architecture Lượt 13 | CLOSED |
| DQ-008 | P2 | `RoomService` 767 dòng đã được tách sau Booking characterization thành facade 65 dòng, Query 442 và Mutation 358; controller/route/response/transaction giữ nguyên, unit/E2E PASS | Repository architecture Lượt 13 | CLOSED |
| DQ-009 | P2 | `RateLimitGuard` dùng bucket in-memory theo process. Single-instance behavior đã PASS; trước khi scale nhiều replica phải chọn shared store và xác nhận reverse-proxy/IP topology để giữ limit nhất quán | Deployment architecture/Lượt 13 | OPEN |
| DQ-010 | P2 | Database phát triển còn pending `AddDashboardQueryIndexes1784782000000` và `AlignAmenityJoinMetadata1784783000000`. Test DB up/down, schema check và data audit đã PASS; không tự apply ngoài test trong audit | Release operator theo `docs/DATABASE_MIGRATION_RUNBOOK.md` | OPEN |
| DQ-011 | P2 | Project unit line coverage đạt 64,98% và Booking Lifecycle branch 76,08%; Payment targeted aggregate branch 60,92%, trong đó Collection 52,05% và Refund 56,47% vẫn dưới mục tiêu hardening 70% dù critical verified/reject/ambiguous/reconcile flow đã có unit + E2E | Payment provider failure-matrix hardening | OPEN |

## Quy tắc cập nhật

- Mỗi issue mới phải có evidence trong báo cáo module nguồn.
- Không sửa issue module khác chỉ để đóng báo cáo hiện tại.
- Khi đóng issue phải ghi file/test/command chứng minh.
- P0 được phép ngắt thứ tự; P1-P3 giữ đúng owner/lượt.
