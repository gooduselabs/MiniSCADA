# Client live 1.2.0 đóng băng (feature 009 T113; FR-014, FR-045, FR-063; SC-015)

Bản `@mat/live-client` trước khi thêm alarm (protocol 1.3.0): `index.ts`, `connection.ts`, `state.ts` chép nguyên từ
`packages/live-client/src/` ở commit `4e0972f` (cha của `16e7b2f`, "live-client 1.3.0, subscribeAlarms…"). Không sửa; không có test
riêng. `tools/alarm-it/compat.mjs` (phần A) nối nó với runtime x64 1.3.0 đang chạy project có alarm và kiểm: Tag chạy như cũ,
0 bản tin alarm tới client, 0 lỗi, client không gửi gì ngoài `subscribe`/`heartbeat`.

Cần Node >= 24 (bỏ kiểu TypeScript khi `import`). Chạy: `./tools/alarm-it.ps1 -Scenario compat`.
