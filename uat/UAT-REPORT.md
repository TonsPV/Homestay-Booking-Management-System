# Báo cáo kiểm thử nghiệm thu — thông tin lịch sử

Cập nhật chỉ dẫn ngày **10/09/2026**. Không thực hiện lại UAT trong lần cập nhật tài liệu này.

Báo cáo gốc ngày **31/08/2026** dùng backend mốc `9846312` cùng các thay đổi chưa commit và một phiên bản frontend tại thời điểm đó. Kết quả phụ thuộc dữ liệu thử, máy chạy và trạng thái repo lúc kiểm thử; không dùng để xác nhận bản deploy hiện tại.

Bản đầy đủ được giữ nguyên tại `docs/.archive/2026-09-10/uat/UAT-REPORT.md` tính từ gốc repo. Kho này bị Git bỏ qua, chỉ có trên máy đã rà soát; muốn giữ lâu dài cần sao lưu riêng.

## Tài liệu nên dùng hiện nay

- [Kiểm thử và triển khai](../docs/testing-and-deployment.md): các bước kiểm tra theo đúng SHA, phạm vi E2E, smoke và bằng chứng CI.
- [Luồng thanh toán](../docs/payment-flows.md): phân biệt Return/IPN, hoàn tiền chưa rõ kết quả và đối soát.
- [Mục lục tài liệu](../docs/README.md).

Các script `uat/*.mjs` và bản thử nghiệm trong `uat/.archive/` không tự động trở thành bộ kiểm thử phát hành. Không chạy chúng với database thật khi chưa xác minh endpoint, fixture và quyền ghi.

Khi thực hiện UAT mới, ghi rõ SHA của cả backend/frontend, môi trường, dữ liệu thử, bước tái hiện, kết quả mong đợi/thực tế và bằng chứng. Không sao chép kết quả cũ thành kết quả mới.
