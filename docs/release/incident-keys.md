# Xử lý khi lộ khóa hoặc chứng chỉ ký

Quy trình khi khóa phát hành ECDSA hoặc chứng chỉ Authenticode bị lộ, nghi bị lộ, hay bị mất. Nguồn: [contract release-signing](../../specs/011-pilot-hardening/contracts/release-signing.md) §6, [ADR-035](../adr/035-release-trust-ota.md). Vận hành ký thường ngày: [signing.md](signing.md).

## Bước chung (làm ngay, trong ngày)

1. Người phát hành báo trưởng dự án; ghi thời điểm phát hiện, khóa nào, nghi lộ qua đường nào.
2. Dừng mọi lần phát hành đang chạy; không ký thêm bằng khóa nghi lộ.
3. Liệt kê bản đã phát hành bằng khóa đó: thư mục lưu trữ `release/<ver>/`, `build-info.json` (`signing.releaseKeyId`, `signing.thumbprint`), `signing-log.json`.
4. Ghi biên bản sự cố (ngày, người, quyết định, thông báo đã gửi) ở hồ sơ nội bộ của công ty, không trong repo nếu có chi tiết bảo mật.

## Bảng xử lý

| Tình huống | Làm gì |
|---|---|
| Xoay định kỳ (mỗi 24 tháng) | Sinh khóa mới (`tools/release/keygen.ps1`). Phát gói `keyset` **ký bằng khóa đang tin cậy**, `add` khóa mới. Đợi mọi thiết bị nhận (xem `signer.keyId` trong thông tin thiết bị). Gói `keyset` kế tiếp `remove` khóa cũ. Cập nhật `deployment/keys/`. |
| Khóa chính bị lộ hoặc nghi lộ | Lấy khóa **dự phòng** từ két. Ký gói `keyset`: `add` khóa chính mới, `remove` keyId của khóa chính cũ (không được `remove` chính khóa đã ký gói). Thiết bị không nhận OTA được thì root chạy `mat-runtime --trust-key remove <keyId>` (có từ bản 1.0) tại chỗ hoặc cài lại khóa bằng `deploy.sh`. Kiểm lại mọi bản đã phát hành bằng khóa cũ (`verify-release.ps1`), phát lại bản đang dùng ký bằng khóa mới. Thông báo khách hàng (mẫu dưới). |
| Khóa dự phòng bị lộ | Dùng khóa chính ký gói `keyset` thay khóa dự phòng; sinh khóa dự phòng mới, cất két. |
| Cả hai khóa bị lộ | OTA không còn tin được. Hướng dẫn khách hàng tắt `update.enabled` trong `runtime.json` (cần root), cài khóa mới và bản mới thủ công bằng `deploy.sh`. Sinh hai khóa mới. |
| Mất khóa (không lộ) | Như xoay định kỳ nếu còn khóa kia; mất cả hai thì như "cả hai bị lộ" (không còn cách ký `keyset`). |
| Chứng chỉ Authenticode bị lộ (token mất, máy ký bị chiếm) | Yêu cầu CA thu hồi ngay (theo hợp đồng CA). Mua chứng chỉ mới, phát bản mới ký bằng chứng chỉ mới. Dấu thời gian của chữ ký cũ không còn đủ để tin: thông báo người dùng gỡ bản cũ và cài bản mới. Cập nhật dấu vân tay ở [signing.md](signing.md). |
| Chứng chỉ Authenticode hết hạn | Không phải sự cố: chữ ký có dấu thời gian trước ngày hết hạn vẫn hợp lệ. Bản mới cần chứng chỉ mới (gia hạn trước 60 ngày). |

## Mẫu thông báo khách hàng

> **Thông báo bảo mật mAT SCADA, ngày …**
> Chúng tôi đã thay khóa ký bản cập nhật runtime (khóa cũ: keyId `sha256:…`) do …. Thiết bị đang bật cập nhật từ xa sẽ nhận khóa mới qua gói xoay khóa phát hành ngày …. Thiết bị không bật cập nhật từ xa: cài bản … bằng hướng dẫn kèm theo. Không cài gói cập nhật nào ký bằng khóa cũ phát hành sau ngày …. Liên hệ: ….

## Sau sự cố

- Rà lại nơi giữ khóa, người có quyền truy cập máy ký; đổi mật khẩu khóa riêng còn lại.
- Ghi bài học vào [process.md](process.md) nếu cần đổi quy trình.
