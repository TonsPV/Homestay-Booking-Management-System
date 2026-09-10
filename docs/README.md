# Mục lục và quy định quản lý tài liệu

Cập nhật ngày **10/09/2026**. Bộ tài liệu này mô tả mã nguồn hiện có, không coi đề xuất trong bản thiết kế cũ là chức năng đã triển khai. Nội dung giải thích dùng tiếng Việt; tên file, API, enum và lệnh giữ nguyên để đối chiếu với chương trình.

## Bộ tài liệu hiện hành

| Tài liệu                                            | Phạm vi                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| [README của repo](../README.md)                     | Giới thiệu và chạy nhanh                                                         |
| [Kiến trúc](architecture.md)                        | Cấu trúc thư mục, quyền sở hữu, transaction và thứ tự khóa                       |
| [Quy tắc nghiệp vụ](business-rules.md)              | Tài khoản, phòng, lịch và vòng đời đặt phòng                                     |
| [Luồng thanh toán](payment-flows.md)                | Thu tiền, IPN, Return, hoàn tiền và quyết định mô hình hoàn tiền                 |
| [Cơ sở dữ liệu](database.md)                        | Bảng, ràng buộc, lịch sử migration và các cột hiện tại                           |
| [Hợp đồng API](api-contracts.md)                    | Xác thực, quyền, dữ liệu trả về và mã lỗi                                        |
| [Kiểm thử và triển khai](testing-and-deployment.md) | Cách chạy kiểm tra, bằng chứng theo phiên bản và việc cần xác minh khi phát hành |

Đọc README, kiến trúc và quy tắc nghiệp vụ trước; tra cứu các tài liệu còn lại theo công việc.

## Kết quả rà soát tài liệu cũ

| Tài liệu hoặc nhóm cũ                                                                                       | Quyết định và nơi thay thế                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                                                                 | Giữ vị trí; viết lại tiếng Việt, bỏ phần giải thích lặp với tài liệu chuyên đề                                                   |
| `docs/architecture.md`, `docs/architecture/system-overview.md`                                              | Gom vào `architecture.md`; cập nhật `mappers/`, `persistence/`, `common/database/`                                               |
| `docs/database.md`, `docs/architecture/data-model.md`                                                       | Gom vào `database.md`; không còn coi bảng xác nhận số điện thoại đã bị bỏ là bảng hiện hành                                      |
| `docs/payment-flows.md`, `docs/decisions/payment-refund-model-decision.md`                                  | Gom vào `payment-flows.md`; giữ lý do lựa chọn quan hệ một lần thanh toán với tối đa một bản ghi hoàn tiền                       |
| `docs/analysis/business-rules.md`                                                                           | Thay bằng `business-rules.md`; sửa các nhận định cũ về idempotency, Return và quyền sở hữu khoản thanh toán                      |
| `docs/architecture/api-contracts.md`                                                                        | Thay bằng `api-contracts.md`; lấy số lượng và đường dẫn từ đặc tả hiện tại                                                       |
| `docs/testing/test-strategy.md`                                                                             | Thay bằng `testing-and-deployment.md`; phân biệt kiểm tra local, CI và production                                                |
| `docs/analysis/current-state.md`, `docs/progress.md`                                                        | Loại khỏi bộ đang dùng; đây là ảnh chụp tiến trình khảo sát cũ, không còn là báo cáo trạng thái hiện tại                         |
| `docs/plans/implementation-plan.md`                                                                         | Lưu lịch sử; không tiếp tục hiển thị các việc đã làm như kế hoạch còn chờ                                                        |
| `docs/common-http-audit.md`, `docs/analysis/risks-and-technical-debt.md`, `docs/analysis/open-questions.md` | Giữ bản gốc trong lưu trữ; các rủi ro còn liên quan được ghi trong tài liệu triển khai                                           |
| `docs/System_Analysis_And_Design.md`, `docs/System_Analysis_And_Design_Intern.md`                           | Lưu lịch sử thiết kế; có yêu cầu tương lai chưa tồn tại trong code, không dùng làm hướng dẫn vận hành hiện tại                   |
| `docs/System_Analysis_And_Design.docx`                                                                      | Giữ nguyên bản Word lịch sử ở kho lưu trữ; bản này ghi mốc 3.4.0 và có chỗ điền thông tin học phần, không phải bản phát hành mới |
| `uat/UAT-REPORT.md`                                                                                         | Giữ một trang tiếng Việt chỉ dẫn bằng chứng cũ; bản báo cáo đầy đủ được lưu nguyên trạng                                         |

## Lưu trữ và khả năng khôi phục

Bản gốc của **20 tài liệu** trước lần rà soát này nằm tại `docs/.archive/2026-09-10/`, giữ đường dẫn tương đối từ gốc repo. Ví dụ, bản kiến trúc cũ ở `docs/.archive/2026-09-10/docs/architecture.md`.

Không xóa vĩnh viễn nội dung cũ. Tài liệu lưu trữ giữ nguyên ngôn ngữ và mốc thời gian để bảo toàn bằng chứng; chúng không thuộc bộ tài liệu hiện hành và không được hiểu là kết quả kiểm thử mới. Đường dẫn về mã nguồn trong các bản cũ có thể không còn phù hợp.

Kho lưu trữ bị Git bỏ qua và **chỉ có trên máy đã thực hiện rà soát**. Muốn giữ lịch sử này lâu dài, chủ repo cần sao lưu riêng hoặc chủ động chọn bản đã kiểm tra để đưa vào Git. Tài liệu hiện hành không còn bị `.gitignore` loại trừ; việc này chưa đồng nghĩa đã commit hoặc push.

## Quy tắc cập nhật

1. Thay đổi API: cập nhật controller/DTO, đặc tả OpenAPI và tài liệu API.
2. Thay đổi nghiệp vụ: cập nhật kiểm thử và tài liệu nghiệp vụ hoặc thanh toán.
3. Thay đổi entity/migration: cập nhật tài liệu cơ sở dữ liệu và chạy kiểm tra schema.
4. Di chuyển file hoặc provider: cập nhật kiến trúc và các đường dẫn liên quan.
5. Ghi kết quả kiểm thử kèm ngày, môi trường và commit nếu có. Không sao chép kết quả cũ rồi gọi là kết quả của phiên bản mới.
6. Mô tả chức năng đã có tách biệt với đề xuất, yêu cầu chưa triển khai và việc cần quyết định.
7. Không ghi mật khẩu, khóa API, token, dữ liệu khách hàng thật hoặc cấu hình production vào tài liệu.
