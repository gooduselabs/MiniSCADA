# Vector gói cập nhật `.matupdate` (feature 011, T106)

Sinh bằng `node tools/release/make-update.mjs --vectors` (Node `crypto`, `zlib`; không phụ thuộc mới). Gói lớn (ca 12, các gói của `deployment/device/tests/updater_test.sh`) sinh vào `out/` (không commit): `node tools/release/make-update.mjs --vectors --out`, chạy trước test C++ và test shell. Chữ ký ECDSA của Node có số ngẫu nhiên: sinh lại thì byte của gói đổi, mã mong đợi không đổi.

| Tệp | Nội dung |
|---|---|
| `valid.matupdate` | gói hợp lệ (runtime 1.0.1, `releaseSeq` 11, `armhf`) |
| `keyset-add.matupdate` | gói `keyset` thêm khóa thử thứ hai, ký bằng khóa thử thứ nhất |
| `bad/NN-*.matupdate` | các ca xấu của contract §6 (01–30) và 31–35 thêm |
| `cases.json` | thiết bị mẫu (`armhf`, 1.0.0, `releaseSeq` 10, project 1.0.0), mã lỗi, `detail.code`, HTTP, mã thoát của `mat-update-verify` mong đợi cho từng ca |
| `sums/` | `SHA256SUMS` hai tệp và `SHA256SUMS.sig` |
| `keys-trusted/` | thư mục khóa tin cậy của test (chỉ khóa công khai thứ nhất) |
| `keys/` | **khóa THỬ** (`test-ec-p256.pem`, `test-ec-p256-other.pem` và khóa công khai), khóa RSA công khai (bị từ chối) |

**Khóa trong `keys/` chỉ để test, công khai trong repo, không bao giờ dùng để phát hành**: `release.ps1 -Release` từ chối khóa có `keyId` thuộc danh sách khóa thử (contract release-signing §5, `CERT_TEST_KEY`).

Dùng bởi: `core/update/tests/{envelope,signature,update_verify_cli,update_fuzz}_test.cpp`, `server/tests/update_api_test.cpp`, `server/tests/trust_key_cli_test.cpp`, `deployment/device/tests/{updater_test,deploy_rollback_test}.sh`, `deployment/toolchain/test-armhf.sh`, `tools/release/make-update.test.mjs`.
