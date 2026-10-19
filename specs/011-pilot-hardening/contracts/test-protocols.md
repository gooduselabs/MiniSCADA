# Contract: quy trình đo tải, soak, mất điện, tuổi thọ eMMC và pilot

**Feature**: [spec.md](../spec.md) FR-037 đến FR-046, FR-132 đến FR-143, SC-011 đến SC-016, SC-040, SC-041 · Nguồn yêu cầu: Master Plan §6, §14.5, Sprint 7

Mọi phép đo ghi: phiên bản (`system/info`), mã commit, cấu hình (`runtime.json`, project, số Tag, số client), điều kiện (máy, mạng, nhiệt độ phòng), dữ liệu thô (`docs/reports/011-*.json`), kết luận theo ngưỡng, và **mục chưa đo**. Số chưa đo ghi "chưa đo", không ghi "đạt".

## 1. Tải

**Rig**: máy dev hoặc máy khách nối cùng LAN với BL335 (cáp, 100 Mbps); BL335 chạy runtime build armhf. Công cụ `tools/load-tester` (mở rộng, FR-038): tạo `N` client WebSocket giao thức live (đăng ký 500 hoặc 1.000 Tag), đo mất sequence, độ trễ khung, 4429 của client 11; kịch bản trình duyệt (puppeteer-core, Chrome ≥ 120) mở màn hình 250 item.

| Mã | Kịch bản | Điều kiện | Đo | Ngưỡng |
|---|---|---|---|---|
| L1 | 500 Tag (Tag tính toán + mô phỏng `SIM.*`), 10 client, 4 giờ | cổng 8080 (HTTP) và 8443 xen kẽ | CPU (từ `/proc/stat` và `/proc/<pid>/stat`), RSS, `liveLagP95Ms`, mất sequence | CPU trung bình ≤ 30 %, đỉnh ≤ 60 %; RSS ≤ 150 MB; 0 mất sequence |
| L2 | 1.000 Tag, 10 client, 1 giờ | như L1 | như L1 | CPU trung bình mục tiêu ≤ 50 %; RSS ≤ 150 MB; không đạt thì báo giới hạn và phương án |
| L3 | Client 11 | 10 client đang chạy | mã đóng của client 11; thời gian tới khi client mới vào được sau khi client 1 đóng sạch và sau khi client 1 im lặng (`load-tester -extra-attempts 50 -reentry N`) | 4429 ở 100 % lần thử (50 lần); client 1 ngắt thì client mới vào được trong ≤ 35 s |
| L4 | F5 đồng loạt: 10 trang Chrome headless mở màn hình 250 item, F5 cùng lúc, 50 vòng | cache trống | thời gian tới dữ liệu sống đầu tiên của từng trang | mọi trang ≤ 5 s (007 SC-003) |
| L5 | Màn hình 300 đến 500 phần tử SVG, 10 client | Chrome headless | FPS animation, RSS tab | ≥ 30 FPS với 50 animation (Master Plan §6.4) |
| L6 | Cắt mạng 50 lần (tắt cổng switch hoặc `ip link` ⚠️🔌) | 10 client | thời gian nối lại, số slot rò | 100 % nối lại ≤ 35 s; 0 slot rò |
| L7 | Tải cộng logic tối đa (200 luật…) | L1 + `projects/logic-load` | thêm CPU, thêm RSS, vòng quét | ≤ +3 điểm CPU, ≤ +5 MB, ≤ 5 ms |
| L8 | Giới hạn nguồn: 40 kết nối TLS im lặng từ một IP | 1 máy khác đăng nhập | thời gian đăng nhập | ≤ 2 s |

Mỗi kịch bản chạy trước ở x64 (Docker) làm tiền kiểm; số x64 không thay số BL335.

**Cách đo L1 "8080 và 8443 xen kẽ"**: `load-tester -alternate -tls-port 8443 -fingerprint <SHA-256 chứng chỉ thiết bị>` (`tools/load-tester/tls.go`): client lẻ (1, 3, …, cả client thừa 11) mở `wss://<host>:8443/api/v1/live`, client chẵn mở `ws://<host>:8080/api/v1/live`; mỗi client gửi Origin của đúng listener của nó (`http://<host>:8080` hoặc `https://<host>:8443`). Chứng chỉ luôn được kiểm tường minh: `-fingerprint` ghim SHA-256 chứng chỉ lá (so ngay sau bắt tay TLS, trước byte HTTP nào) hoặc `-insecure` (ghi `tls.verify: "insecure"` trong JSON); thiếu cả hai là dùng sai (mã 2). JSON thêm `scheme` mỗi client, `tls`, `summaryByScheme` (`ws`, `wss`: cùng các chỉ số của `summary`), `latencyByScheme` (với `-latency`) và check "cả 8080 và 8443 có dữ liệu sống, 0 mất sequence"; `wss8443Alternation` rời `notMeasured`. Ngưỡng của L1 áp cho cả hai nhóm.

**Cách đo L5 "RSS tab"**: `node tools/measure/tab-rss.mjs --url <URL màn hình L5> --pages 10 --seconds <S> --fingerprint <SHA-256>` mở 10 trang trong `chrome-headless-shell` (mỗi trang một ngữ cảnh, một tiến trình renderer), lấy mẫu mỗi `--interval` giây RSS của renderer của từng tab (`ps`) và `JSHeapUsedSize` (CDP `Performance.getMetrics`, không ép GC); báo mỗi tab đầu, cuối, tối đa, độ dốc MB/giờ (cả chuỗi và sau `--warmup` giây) và tổng RSS mọi renderer. HTTPS: công cụ ghim fingerprint rồi chỉ cho Chrome chấp nhận đúng khóa đó (`--ignore-certificate-errors-spki-list`). L5 không đặt ngưỡng RSS tab: ghi số đo; độ dốc dương kéo dài sau khởi động là dấu hiệu rò bộ nhớ phía trang cần điều tra. RSS là bộ nhớ của máy trạm chạy Chrome, không phải của BL335.

## 2. Soak

| Mã | Mô tả | Thời gian | Ở đâu |
|---|---|---|---|
| S0 | Soak gia tốc x64: tải L1 rút gọn, `kill -9` mỗi 30 phút, nạp xuống mỗi 2 giờ, đo như S1 | 24 giờ | Docker (tự động) |
| S1 | Soak chuẩn: project chuẩn (500 Tag, lưu trữ 200 Tag theo thay đổi, logic mẫu, 3 màn hình), 10 client (Chrome headless hoặc `load-tester`) liên tục, PLC giả lập Modbus ở máy khác | **7 ngày** liên tục | BL335 ⚠️🔌 |
| S2 | Soak bàn thử trong pilot | **30 ngày** | BL335 bàn thử ⚠️🔌 |

**Bộ lấy mẫu** `mat-sample` (sh, chỉ đọc, chạy bởi `matscada` hoặc root, mỗi 60 s): ghi dòng JSON vào `/run/mat-sample/samples-<n>.jsonl` (tmpfs; quay vòng 8 tệp × 1 MiB). Trường: `t` (ISO), `boot` (boot id), `rssKb`, `hwmKb`, `utime`, `stime` (jiffies), `fd`, `threads`, `ioRead`, `ioWrite` (`/proc/<pid>/io` `read_bytes`, `write_bytes`), `blkSectorsWritten` (`/sys/block/mmcblk*/stat` trường 7), `dbSizes` (`history.db`, `-wal`, `audit.db`, `retain/`), `dfData`, `dfTmp`, `memAvailKb`, `tempMilliC`, `emmc` (`mmc extcsd read` nếu có), `restarts` (`systemctl show -p NRestarts`), `dmesgErr` (số dòng `mmc|ext4|I/O error` mới). Thu bởi `tools/soak/collect.ps1` mỗi giờ (SSH) hoặc bằng tay; thu bù khi mạng đứt (tmpfs giữ ≥ 8 giờ).

**Phân tích** (`tools/soak/analyze.mjs`): bỏ 24 giờ đầu cho độ dốc RSS; hồi quy tuyến tính (bình phương tối thiểu) `rssKb ~ t`; ghi đĩa/ngày theo `ioWrite` (tiến trình) và theo `blkSectorsWritten × 512` (tổng khối); đồ thị SVG; so với ngưỡng:

| Tiêu chí | Ngưỡng |
|---|---|
| Khởi động lại ngoài kế hoạch | 0 (`restarts` không tăng, `boot` đổi = mất điện ngoài kế hoạch) |
| Độ dốc RSS | ≤ 0,5 MB/ngày; RSS lớn nhất ≤ 150 MB |
| FD, luồng | thay đổi ≤ 5 % so với trung vị ngày 2 |
| Ghi đĩa mỗi ngày (tổng khối) | ≤ 2 GB (mọi ngày) |
| tmpfs | ≤ 64 MB (kể cả `/run/mat-sample`) |
| `dmesg` | 0 dòng lỗi `mmc`, `ext4`, `I/O error` |
| WAL | `history.db-wal` ≤ 64 MB và về nhỏ sau checkpoint |
| Dữ liệu | `--check-data` cuối kỳ = 0; số dòng `history` đúng với tải đã biết (±1 %) |

Soak bị gián đoạn (mất điện phòng, mạng): ghi nhận; đồng hồ soak **chạy lại từ đầu** nếu có khởi động lại ngoài kế hoạch của thiết bị; mất mạng thu thập mà thiết bị không khởi động lại thì không gián đoạn.

## 3. Ghi eMMC và tuổi thọ

Ghi eMMC **mỗi ngày** `W_day` (byte) lấy từ `blkSectorsWritten × 512` (tất cả tiến trình, tổng) và phân theo thành phần từ `ioWrite` của runtime và kích thước tệp: `history`, `audit`, `retain`, `logic`, `log`, `project`, `wal`, `khác`.

**Chỉ số thiết bị**: đọc `EXT_CSD` bằng `mmc extcsd read /dev/mmcblk0` (nếu có `mmc-utils`; ngược lại đọc `/sys/class/mmc_host/mmc*/mmc*:*/life_time` hoặc `pre_eol_info`): `DEVICE_LIFE_TIME_EST_TYP_A` (và `_B`): 0x01 là 0 đến 10 % tuổi thọ đã dùng, 0x02 là 10 đến 20 %, …, 0x0B vượt; `PRE_EOL_INFO`: 1 bình thường, 2 cảnh báo (80 % dự phòng), 3 khẩn cấp. Ghi lúc đầu và cuối mỗi kỳ.

**Ước tính tuổi thọ** (hai cách, báo cả hai, lấy cách bi quan):

1. **Theo TBW**: `years = (TBW_flash / WAF) / (W_day_max × 365)`, với `TBW_flash` = dung lượng × số chu kỳ P/E của datasheet (nếu datasheet cho TBW của sản phẩm thì dùng thẳng), `WAF` = 5 (giả định bi quan: ghi nhỏ, ngẫu nhiên, ext4 và WAL), `W_day_max` = ngày ghi lớn nhất trong kỳ. Thiếu datasheet: **không tính**, ghi "chưa tính được tuổi thọ tuyệt đối: cần datasheet của eMMC".
2. **Theo bậc `EXT_CSD`**: `years = (10 − bậc_hiện_tại×1) × (số ngày kỳ / số bậc tăng) / 365` nếu bậc tăng ≥ 1 trong kỳ; bậc không tăng thì "≥ (số ngày kỳ × 10 / 365)" chỉ là cận dưới yếu, ghi như vậy.

**Ngưỡng**: `years ≥ 5` (D30); bậc `EXT_CSD` tăng ≤ 1 trong kỳ pilot 30 ngày; `W_day` ≤ 2 GB mọi ngày. Ví dụ tính (minh họa, không phải số đo): TBW_flash 8 GB × 3.000 = 24 TB; WAF 5 → 4,8 TB; `W_day` 2 GB → 4,8 TB / 2 GB = 2.400 ngày ≈ 6,6 năm: đạt sát ngưỡng, nên mục tiêu thực tế là `W_day` ≤ 0,5 GB.

## 4. Mất điện

**Thiết bị điều khiển nguồn** (⚠️🔌 người cung cấp và lắp): một trong: ổ cắm thông minh có API HTTP (Tasmota, `Power Off/On`), rơ-le USB nối tiếp (lệnh `A0 01 01 A2` cho mô-đun LCUS-1 hoặc tương đương), hoặc **chế độ tay** (script nhắc "rút nguồn" và đo thời gian rút). Cắt **nguồn của BL335**, không phải mạng.

`tools/powercut/powercut.mjs` mỗi vòng:

1. chờ thiết bị `READY` (HTTPS `system/info` trả lời) và tải ổn định ≥ 60 s;
2. chọn thời điểm cắt: ngẫu nhiên đều trong [0, 300] s (vòng ngẫu nhiên) hoặc **sự kiện** (vòng có chủ đích) lấy từ nhật ký của thiết bị hoặc bộ phát lệnh;
3. cắt nguồn; chờ 5 s; cấp nguồn;
4. chờ `READY` tối đa 90 s (ghi thời gian);
5. chạy `mat-runtime --check-data --json` (SSH hoặc API `diagnostics` khi có), đối chiếu audit (§FR-042), kiểm project, `retain`, `pulse.journal`;
6. ghi JSON vòng; lỗi dừng và giữ nguyên trạng thái để điều tra (không tự sửa).

**Vòng có chủ đích** (≥ 10 lần mỗi điểm, 5 điểm):

| Điểm | Sự kiện kích | Kỳ vọng sau khi lên lại |
|---|---|---|
| D1 nạp xuống | cắt ngay sau khi `ops/<id>.json` ghi bước `activate`, rồi bước `restart`, `health` (3 bước luân phiên) | bản cũ hoặc bản mới hoàn chỉnh; `staging/` rỗng |
| D2 OTA | cắt sau mỗi bước S4 đến S7 (4 bước luân phiên, ≥ 10 lần mỗi bước nếu thời gian cho phép: ≥ 5) | bản cũ hoặc bản mới; không `/opt` nửa vời |
| D3 ghi lịch sử dày | tải 500 Tag theo thay đổi, cắt khi `history.db-wal` > 4 MB | `integrity_check` ok; mất tối đa dữ liệu của một chu kỳ gom |
| D4 xung | cắt khi `pulse.journal` có mục chờ | bit nhả khi kênh nối lại; audit `pulse-recovery` |
| D5 logic | cắt trong 5 s trước lần ghi `retain` kế tiếp | giá trị counter/totalizer/giờ chạy mất ≤ một chu kỳ, không giảm |

**Đối chiếu audit**: bộ phát lệnh ghi `requestId` của mọi lệnh nhận `ACCEPTED`; sau mỗi vòng, mọi `requestId` đó phải có trong `audit.db` (đọc bằng `--export-audit`). Lệnh không có hồi đáp (cắt giữa chừng) không tính.

**Tiền kiểm x64** (FR-043): `docker kill -s KILL` 100 vòng (ngẫu nhiên và theo điểm), cùng bước 5; nêu rõ không mô phỏng mất dữ liệu chưa fsync ở tầng đĩa; có thể thêm `fiu`/`dm-flakey` nếu khả thi (ghi vào báo cáo, không bắt buộc).

**Ngưỡng**: 100/100 vòng ngẫu nhiên lên lại ≤ 90 s, `--check-data` mã 0 (mã 1 chỉ hợp lệ với `pulse.journal` có mục hoặc `-wal` cần phục hồi, ghi rõ), 0 lệnh `ACCEPTED` thiếu audit; ≥ 10 vòng mỗi điểm đạt.

## 5. Kế hoạch pilot, tiêu chí vào và ra

**Phạm vi**: 1 đến 2 site thật của khách hàng + 1 bàn thử nội bộ. Mỗi site: 1 BL335, PLC thật qua Modbus (TCP hoặc RTU), 2 đến 10 client Chrome, project do kỹ sư của khách (hoặc của đội) dựng bằng Studio; đường VPN cho truy cập từ xa; không truy cập qua port-forward Internet. Thời gian: ≥ 30 ngày liên tục (đồng hồ pilot). Bản: `1.0.0-rc.N` cố định; bản vá chỉ để sửa sự cố S1/S2 hoặc lỗi bảo mật, qua hồi quy đầy đủ, và (trừ S1) **không** làm đồng hồ dừng nếu hồi quy xanh.

**Vai trò**: Tech Lead (quyết định Go/No-Go, ký), kỹ sư pilot (cài, theo dõi, sửa), QA (đo, hồi quy), người liên hệ khách hàng (điều phối, huấn luyện, ký biên bản), người vận hành của khách (dùng hằng ngày), quản trị site (tài khoản, mạng).

**Tiêu chí vào** (tất cả, FR-140):

| # | Tiêu chí | Bằng chứng |
|---|---|---|
| E1 | US1 xong: 0 Critical/High/Medium mở (trừ mục chờ người ghi rõ) | `011-security-review.md` |
| E2 | Tải L1, L3, L4 đạt; soak S1 7 ngày đạt (hoặc báo cáo giới hạn được Tech Lead chấp thuận bằng văn bản) | `011-load.md`, `011-soak.md` |
| E3 | Mất điện: 100 vòng ngẫu nhiên và ≥ 10 vòng mỗi điểm đạt (hoặc báo cáo giới hạn) | `011-powercut.md` |
| E4 | Bản rc ký (Authenticode nếu có chứng chỉ; nếu không, quyết định ghi rõ chạy bản chưa ký), SBOM, license | `release/<rc>/` |
| E5 | OTA đạt kiểm lab (SC-020 đến SC-022) hoặc quyết định dùng quy trình thủ công | `011-acceptance.md` |
| E6 | Tài liệu 3 hướng dẫn và giáo trình xong; huấn luyện ít nhất hai buổi đã lên lịch | `docs/user/`, `docs/training/` |
| E7 | Hồi quy xanh (`ci-local.ps1`, `device-it`, `driver-it`, `web-it`) | báo cáo |
| E8 | Site: có PLC, mạng (IP tĩnh, NTP), người liên hệ, VPN, người vận hành; có sao lưu cấu hình trước khi chạy | `customer-checklist.md` |
| E9 | Phạm vi tính năng pilot ghi rõ (GĐ 4 và 5 có hay không; logic ghi PLC bật hay tắt) | `docs/pilot/plan.md` |

**Tiêu chí ra** (tất cả bắt buộc cho `1.0.0`, FR-139):

| # | Tiêu chí | Ngưỡng | Cách đo |
|---|---|---|---|
| X1 | Uptime tiến trình | ≥ 99,9 % (≤ 43 phút ngừng ngoài kế hoạch mỗi 30 ngày) | từ `uptimeS`, `restarts`, khoảng trống dữ liệu, nhật ký sự cố; mất nguồn do site loại trừ khi nhật ký xác nhận |
| X2 | Sự cố | 0 S1; ≤ 2 S2 mở, mỗi cái có cách tránh; 0 S1/S2 chưa rõ nguyên nhân | `incident-log.md` |
| X3 | Độ trễ | `liveLagP95Ms` ≤ 500 ms (mọi tuần); đo đầu-cuối Chrome ≤ chu kỳ quét + 500 ms ở ≥ 3 lần đo (mỗi site) | `diagnostics`, `load-tester --latency` |
| X4 | Ghi eMMC | ≤ 2 GB mỗi ngày (mọi ngày); chỉ số `EXT_CSD` tăng ≤ 1 bậc | `collect.ps1`, `kpi.mjs` |
| X5 | Tuổi thọ | ước tính ≥ 5 năm (§3) | §3 |
| X6 | Toàn vẹn | 0 DB hỏng sau mọi lần mất điện (site và lab) | `--check-data` |
| X7 | Bảo mật | 0 Critical/High/Medium mở; 0 lệnh ghi không có audit trong dữ liệu audit đối chiếu | `011-security-review.md`, audit |
| X8 | Chức năng | 100 % tác vụ trong `acceptance-minutes.md` (do khách hàng chọn ≥ 10 tác vụ đại diện) thực hiện được | biên bản |
| X9 | Huấn luyện | ≥ 2 người vận hành và ≥ 1 kỹ sư của khách đạt bài kiểm thực hành | phiếu đánh giá |
| X10 | Nghiệm thu khách hàng | biên bản có chữ ký | `acceptance-minutes.md` |
| X11 | Ngân sách | RSS ≤ 150 MB, CPU trung bình ≤ 30 % (tuần), tmpfs ≤ 64 MB | `diagnostics` |

Mỗi tiêu chí ra có trạng thái **Đạt**, **Không đạt** (kèm báo cáo giới hạn và phương án), hoặc **Chưa đo**. `1.0.0` chỉ gắn khi mọi X1 đến X11 là Đạt hoặc Tech Lead ghi quyết định có điều kiện cho mục không thuộc an toàn và toàn vẹn (X3, X5, X11 có thể có quyết định có điều kiện; X1, X2, X4, X6, X7, X10 không).

**Đồng hồ pilot**: chạy từ ngày bản rc được cài và `collect.ps1` bắt đầu thu; S1 làm dừng và tính lại từ ngày bản vá triển khai (hồi quy xanh); S2 ghi chú, không dừng; bản vá khác ghi chú. Pilot không kéo quá 90 ngày: quá hạn mà chưa đạt thì No-Go kèm kế hoạch.

## 6. Thu thập dữ liệu và KPI

`tools/pilot/collect.ps1 -Site <tên> -Device <địa chỉ> -User <tài khoản viewer>`: mỗi 15 phút gọi `system/diagnostics`, `system/info` (và mỗi giờ `audit` tóm tắt số dòng theo loại, **không** chứa tên Tag hay giá trị) qua HTTPS bằng tài khoản chỉ đọc; ghi `docs/pilot/data/<site>/<yyyy-mm-dd>.jsonl`; mật khẩu lấy từ biến môi trường hoặc kho thông tin xác thực Windows, không vào repo. Không thu dữ liệu quy trình (giá trị Tag, tên Tag, tên màn hình) (D38).

`tools/pilot/kpi.mjs --site <tên> --from <ngày> --to <ngày>`: tính (quy tắc cho bộ dữ liệu có khoảng trống và đồng hồ nhảy ở `tests/pilot-kpi/README`):

- **uptime**: `1 − (Σ khoảng không phục vụ ngoài kế hoạch) / (to − from)`; khoảng không phục vụ = khoảng giữa hai mẫu có `uptimeS` giảm (khởi động lại) cộng thời gian khởi động lại ước tính (đến mẫu đầu có `uptimeS` tăng), cộng khoảng trống dữ liệu > 30 phút nếu `incident-log` xác nhận là lỗi sản phẩm; cập nhật có kế hoạch (`system.update.committed` với `planned: true`) và mất nguồn của site (đánh dấu trong nhật ký) loại trừ.
- **restarts** và nguyên nhân (`lastReason`).
- **RSS, CPU**: trung bình, p95, lớn nhất theo tuần.
- **ghi đĩa mỗi ngày** theo thành phần; ngày lớn nhất.
- **liveLagP95Ms**: lớn nhất của p95 theo tuần.
- **emmcLife**: đầu/cuối và số bậc tăng.
- **sự cố**: đếm theo mức từ `incident-log.md` (bảng Markdown với cột cố định).

**Mức sự cố**:

| Mức | Định nghĩa | Phản hồi | Xử lý |
|---|---|---|---|
| S1 | mất dữ liệu, ghi sai xuống PLC, hỏng DB, thiết bị không khởi động hoặc không phục vụ được > 30 phút, lỗ hổng bảo mật bị khai thác | 4 giờ | vá và hồi quy trước khi tiếp tục; phân tích nguyên nhân bắt buộc |
| S2 | mất một chức năng chính (xem, điều khiển, nạp xuống, lưu trữ) có cách tránh | 1 ngày làm việc | cách tránh trong 1 ngày, vá trong 10 ngày; phân tích nguyên nhân bắt buộc |
| S3 | lỗi chức năng phụ hoặc hiển thị sai không ảnh hưởng vận hành | 5 ngày làm việc | theo lịch |
| S4 | thẩm mỹ, đề nghị cải tiến | ghi nhận | backlog |

Mỗi sự cố: mã `INC-<site>-<nn>`, thời điểm phát hiện, mức, mô tả, tác động, nguyên nhân, xử lý, bản vá, hồi quy, người đóng.

## 7. Báo cáo

`docs/reports/011-load.md` (§1), `011-soak.md` (§2, §3), `011-powercut.md` (§4), `011-security-review.md` (FR-032), `011-acceptance.md` (SC), `011-fr-matrix.md`, `011-go-no-go.md` (§5); dữ liệu thô `docs/reports/011-*.json` (không có bí mật, không có địa chỉ công cộng của site).
