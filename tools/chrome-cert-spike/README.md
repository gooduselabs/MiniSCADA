# Spike T006: Chrome có tin chứng chỉ tự ký có SAN IP không

`run.mjs` chạy trong container `node:22-alpine` (cài `chromium` và `nss-tools`): mỗi ca dựng một máy chủ HTTPS với chứng chỉ thử, một kho NSS riêng (`certutil -d sql:`) có hoặc không có chứng chỉ, mở `https://127.0.0.1:<cổng>` bằng `puppeteer-core` và in kết quả.

Chuẩn bị (chứng chỉ thử sinh bằng `openssl`, đặt cạnh `run.mjs` trong thư mục gắn vào `/spike`): `good` (tự ký ECDSA P-256, SAN `IP:127.0.0.1`, `keyUsage digitalSignature`, `extendedKeyUsage serverAuth`, `basicConstraints CA:FALSE`), `badsan` (SAN `IP:10.9.9.9`), `noext` (SAN `DNS:localhost`).

```sh
docker run --rm -v "$PWD:/spike" -v "<repo>/node_modules:/work/node_modules:ro" node:22-alpine \
  sh -c "apk add --no-cache chromium nss-tools >/dev/null && cp /spike/run.mjs /tmp/run.mjs && node /tmp/run.mjs"
```

Kết quả 2026-10-13 (Chromium 152, Alpine): xem ADR-021, mục "Số đo / bằng chứng". Phần Windows (kho Trusted Root của người dùng) cần người đồng ý và gỡ lại sau (`certutil -user -delstore Root`): T149.
