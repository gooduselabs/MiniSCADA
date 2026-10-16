# Hướng dẫn mẫu

Đúng: [đích](ok.md), [neo](ok.md#đăng-nhập-và-khóa-tạm), [neo riêng](ok.md#muc-rieng), [trong tệp](#mục-a), [web](https://example.com/x).

Sai: [hỏng](khong-co.md) và [neo hỏng](ok.md#khong-co-neo).

## Mục A

Tệp đúng `tools/build-x.ps1`, tệp kế hoạch `tools/pilot/kpi.mjs`, tệp sai `tools/khong-co.mjs`, mẫu `docs/pilot/data/<site>/`.

Mã đúng `AUTH_LOCKED`, 423 `AUTH_LOCKED`, `E_SCHEMA_VERSION`, kế hoạch `UPDATE_BAD_SIGNATURE`; sai: `E_KHONG_CO`, 403 `KHONG_CO_MA`, mã `MA_LA`. Không phải mã: `MAT_SKIP_CHECKSUM`.

Lệnh nội dòng `mat-runtime --user-add kysu1` đúng, `mat-runtime --khong-co` sai; `systemctl restart mat-runtime` không phải lệnh runtime.

```sh
mat-runtime --user-add admin --role administrator   # chú thích --khong-tinh
/opt/mat-runtime/bin/mat-runtime --check-project \
    --bad-flag
runuser -u matscada -- mat-runtime --self-check
mat-runtime --test-only-flag
journalctl -u mat-runtime -n 50
sh deploy.sh --dry-run
sh deploy.sh --force
```

```powershell
./tools/build-x.ps1 -BuildDir x -Clean -Verbose
./tools/build-x.ps1 -Fast
./tools/khong-co.ps1 -X
release.ps1 -Release
release.ps1 -Sign
```

## Mục A
