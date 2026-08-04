# Lượt 7A - Booking characterization

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. Phạm vi

Chỉ characterization `BookingService` 1.083 dòng. Không tách service, không đổi
state machine, transaction, route, response hoặc DB schema trong 7A.

Dependency Payment, Room, Customer và RoomCalendar chỉ được mock/đọc hoặc chạy
qua MySQL E2E để xác minh invariant.

Public method:

- customer create/list/detail/cancel;
- management create/list/detail/update status;
- expiration batch.

## 2. State/use-case matrix

| Use case/rule | Direct unit | MySQL E2E | Kết quả |
|---|---|---|---|
| Online create | Price snapshot, payment deadline, RESERVED từng đêm | Create/payment/cancel flow | PASS |
| Counter create/customer resolution | Validation được code giữ; E2E customer mới/đã có | Counter booking + initial password | PASS |
| Date boundary | Past, reverse range, tối đa 90 đêm | Past stay bị từ chối | PASS |
| Guest capacity | Transaction kiểm `maxGuests` | Counter guest overflow 400 | PASS |
| Overlap/concurrency | Duplicate calendar key map 409 | Hai create đồng thời chỉ một thắng | PASS |
| Customer ownership | ID actor + owner query/locked cancel | Customer khác nhận 404 | PASS |
| Customer cancel | Chỉ pending/confirmed unpaid; release calendar; fail pending VNPay | Cancel trả lại availability | PASS |
| Management transitions | Online unpaid không confirm; unpaid không check-in | Main transition flow | PASS |
| Check-in boundary | PAID + trong stay window + Room READY | E2E date/state | PASS |
| Room transition | READY→OCCUPIED khi check-in | E2E room/booking consistency | PASS |
| Check-out | Code giữ HIDDEN/MAINTENANCE, nếu không chuyển CLEANING | E2E lifecycle | PASS |
| Expiration | Lock batch, cancel, fail pending VNPay, release calendar | E2E expiration | PASS |
| Refund pending guard | Code + Payment E2E | Booking transition bị chặn khi refund pending | PASS |

## 3. Transaction và money invariant

- Create chạy một transaction: lock Room, validate active Customer/capacity, save
  price snapshot, insert một `RESERVED` row cho mỗi stay night.
- Unique `(room_id, stay_date)` là lớp bảo vệ overlap/concurrency cuối cùng và
  được map thành 409.
- Tổng tiền tính bằng integer cents/BigInt, không dùng floating point.
- Cancellation/expiry update Booking, fail pending VNPay và delete RoomCalendar
  trong cùng transaction.
- Check-in/check-out lock Room trước khi đổi operational status.

## 4. Finding

Không phát hiện defect P0/P1 mới trong 7A. Mục tiêu của lượt là đóng khoảng trống
test trực tiếp:

- thêm `booking.service.spec.ts` với 11 characterization test;
- targeted coverage: 68,29% statement, 52,45% branch, 67,95% line;
- MySQL E2E 34/34 pass, gồm overlap, counter, cancellation, expiry, refund guard.

Log `Simulated VNPay timeout` là failure fixture có chủ đích.

## 5. Architecture gate

`BookingService` vượt 800 dòng và chứa Query, Creation, Lifecycle, Expiration.
Theo plan, 7A không được tách. Characterization hiện đủ để bắt đầu 7B theo thứ tự:

1. Query capability;
2. Creation capability;
3. Lifecycle capability;
4. facade giữ nguyên public method/controller contract;
5. chạy full unit/E2E sau từng extraction.

Không xóa file và không thay contract trong 7A.

## 6. Capability matrix

| Capability/Rule | Status | Evidence | Gap | Fix/Backlog |
|---|---|---|---|---|
| Online/counter create | PASS | Unit + E2E | Counter chủ yếu E2E | 7B giữ behavior |
| Price/calendar atomicity | PASS | Unit + MySQL E2E | Không | - |
| Overlap/concurrency | PASS | Unit conflict + concurrent E2E | Không | - |
| Cancel/release | PASS | Unit + E2E | Không | - |
| State/check-in/check-out | PASS | Unit + E2E | Một số branch chỉ E2E | 7C đo lại |
| Expiration | PASS | Unit + E2E | Batch >100 chưa load test | Lượt DB/performance |
| Service structure | FAIL | 1.083 dòng, nhiều capability | Chưa tách theo chủ đích 7A | 7B |
| E2E module file | PARTIAL | Flow mạnh | Monolith | DQ-003 |

7A qua gate. Lượt tiếp theo: `Lượt 7B - Booking structure and fixes`.
