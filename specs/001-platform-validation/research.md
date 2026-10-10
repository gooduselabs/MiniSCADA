# Research — Sprint 0

## R1. Build chéo armhf
- **Decision**: Docker image `ubuntu:20.04` + `g++-arm-linux-gnueabihf` (GCC 9.4), CMake + Ninja; sysroot lấy bằng `rsync` từ BL335 khi cần thư viện thật.
- **Rationale**: BL335 chạy Ubuntu 20.04 (glibc 2.31); cùng baseline tránh lỗi ABI/GLIBC_x.y. Docker lặp lại được trong CI.
- **Alternatives**: WSL2 Ubuntu 20.04 (không cần Docker Desktop nhưng khó đưa vào CI); build tĩnh với musl (loại vì khác môi trường thật); build native trên thiết bị (thiết bị không có gcc, yếu).
- **Điều kiện**: Docker Desktop đang tắt trên máy dev — cần bật. Nếu không dùng được Docker thì chuyển WSL2.

## R2. Máy chủ web: CivetWeb vs Drogon
- **Decision**: CivetWeb là mặc định; Drogon build làm PoC thứ hai chỉ để so số đo.
- **Rationale**: CivetWeb là C, MIT, ít phụ thuộc, có HTTP + WebSocket, RAM nhỏ. Drogon (C++17, async) kéo thêm jsoncpp/c-ares/OpenSSL/zlib → nhị phân và RSS lớn hơn; chỉ thắng nếu CPU CivetWeb không đạt.
- **Tiêu chí chọn**: RSS, CPU trung bình/đỉnh với kịch bản 10 client × 500 Tag; độ ổn định khi client chậm.

## R3. Công cụ tải
- **Decision**: Go (`gorilla/websocket` hoặc `nhooyr.io/websocket`), một binary chạy trên Windows; mô phỏng N client, đo độ trễ cập nhật, mất sequence, kết quả bị từ chối.
- **Rationale**: Go đã có trên máy, goroutine rẻ, một file thực thi, cross-compile dễ.
- **Alternatives**: Node (`ws`) — được nhưng đo thời gian kém ổn định hơn; k6 — thừa cho 11 client.

## R4. Đo tài nguyên trên thiết bị
- **Decision**: script sh đọc `/proc/meminfo`, `/proc/<pid>/status` (VmRSS), `/proc/stat`/`/proc/<pid>/stat` mỗi 1 s, ghi CSV theo `contracts/measurement.schema.json`; chạy qua SSH.
- **Rationale**: không cần công cụ cài thêm; thiết bị chưa có `mmc`/`python3` đã xác nhận (cần kiểm tra lại khi truy cập).
- **Lưu ý**: dùng "MemAvailable" và so với ngân sách §6.1; RAM OS idle đo sau khi khởi động ổn định ≥ 5 phút.

## R5. Định dạng bản tin dữ liệu PoC
- **Decision**: JSON gọn (mảng `[index,value,quality]`) với delta gom 250 ms; sequence tăng dần; heartbeat 5 s.
- **Rationale**: đơn giản, debug được; Master Plan cho phép serializer gọn cho hot path. Nếu CPU vượt ngưỡng sẽ thử nhị phân (ghi vào ADR).

## R6. Studio (Tauri 2)
- **Decision**: khởi tạo `create-tauri-app` (vanilla-ts); cài Rust (rustup, toolchain MSVC) và Visual Studio Build Tools C++; đóng gói NSIS với WebView2 Fixed Version/offline installer.
- **Rationale**: yêu cầu của Master Plan §4, §11.9.
- **Rủi ro**: máy dev hiện chưa có Rust; cài đặt tốn ~3–5 GB và cần sự đồng ý của người dùng. Đây là việc độc lập, không chặn Go/No-Go về thiết bị.

## R7. CI
- **Decision**: GitHub Actions: job `lint` (ESLint, Prettier, clang-format), `test` (Vitest, GoogleTest x64, go test), `build-armhf` (Docker toolchain), artifact binary. Chạy được cục bộ qua script tương đương vì repo chưa có remote.

## R8. SVG mẫu
- **Decision**: tự tạo ≥ 10 SVG theo các nhóm (bồn, motor, van, ống, đồng hồ, icon, nested group, gradient, clipPath, use) bằng tay/Inkscape; ghi rõ phần mềm nguồn trong `tests/fixtures/svg/README.md`. Bản xuất từ Illustrator/CorelDRAW cần người dùng cung cấp.
- **Rationale**: không có Illustrator/CorelDRAW trên máy; tiêu chí "≥ 3 phần mềm" chỉ đạt khi người dùng đưa file. Ghi là điểm mở trong báo cáo.

## R9. Hệ điều hành thương mại (ADR)
- **Decision tạm**: nghiêng về Buildroot theo Master Plan; ADR chốt cuối sprint dựa trên mức hỗ trợ BSP của nhà sản xuất BL335.

## Điểm mở (không chặn plan)
1. Docker Desktop cần bật (hoặc dùng WSL2).
2. Cần SSH vào BL335 để đo; thao tác thay đổi trên thiết bị phải hỏi người dùng.
3. Cài Rust/MSVC cho Tauri cần người dùng đồng ý.
4. SVG từ Illustrator/CorelDRAW do người dùng cung cấp.
