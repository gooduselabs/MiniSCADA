# Fixture eMMC cho `analyze.mjs` (feature 011, spike T012)

Các tệp `extcsd-*.txt` mô phỏng đầu ra của `mmc extcsd read /dev/mmcblk0` (gói `mmc-utils`) để viết và kiểm bộ phân tích tuổi thọ eMMC của soak (R13, FR-045) khi chưa có thiết bị. **Giá trị là giả lập**, không phải số đo của BL335.

## Nguồn của định dạng và giới hạn

- Định dạng từng dòng lấy từ chuỗi `printf` trong nhị phân `mmc` của gói **`mmc-utils` 0+git20180327.b4fe0c8c-1** (Ubuntu 20.04, cài trong container dùng một lần, trích bằng `strings`, 2026-10-16). Thứ tự dòng theo thứ tự chuỗi trong nhị phân (gần với thứ tự trong mã nguồn `mmc_cmds.c`, hàm `do_read_extcsd`).
- **Chưa đối chiếu được với đầu ra thật của BL335** (không có SSH, không truy cập mạng để xem mã nguồn hay đầu ra mẫu). Chưa biết BL335 có `mmc-utils` không và là bản nào; bản mới hơn có thể thêm hoặc đổi dòng (ví dụ `BOOT_WP_STATUS`, `FFU_STATUS`, `PRE_LOADING_DATA_SIZE`). Dải chỉ số của `VENDOR_SPECIFIC_FIELD[127..64]` và `CONTEXT_CONF[51..37]` lấy theo bố cục EXT_CSD của JEDEC, không kiểm từ mã nguồn. T013 phải chép một đầu ra thật vào đây (`extcsd-bl335.txt`) và sửa fixture nếu khác.
- Ba dòng sức khỏe chỉ được in khi EXT_CSD rev ≥ 7 (eMMC 5.0 trở lên); đã thấy đúng nguyên văn trong nhị phân:

```text
eMMC Life Time Estimation A [EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_A]: 0x%02x
eMMC Life Time Estimation B [EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_B]: 0x%02x
eMMC Pre EOL information [EXT_CSD_PRE_EOL_INFO]: 0x%02x
```

## Tệp

| Tệp | EXT_CSD | Life A | Life B | Pre EOL | Ý nghĩa mong đợi của bộ phân tích |
|---|---|---|---|---|---|
| `extcsd-healthy.txt` | rev 1.8 (MMC 5.1) | 0x01 | 0x01 | 0x01 | khỏe: đã dùng 0–10 %, khối dự phòng bình thường |
| `extcsd-worn.txt` | rev 1.8 (MMC 5.1) | 0x09 | 0x0a | 0x02 | mòn: 80–90 % (A), 90–100 % (B), cảnh báo (đã dùng 80 % khối dự phòng) |
| `extcsd-eol.txt` | rev 1.8 (MMC 5.1) | 0x0b | 0x0b | 0x03 | vượt tuổi thọ ước tính, khẩn cấp |
| `extcsd-emmc45-no-health.txt` | rev 1.6 (MMC 4.5) | — | — | — | không có dòng sức khỏe: báo "không hỗ trợ", không phải lỗi |

## Giải mã (JEDEC JESD84-B50/B51)

- `DEVICE_LIFE_TIME_EST_TYP_A` (vùng SLC/pSLC) và `_TYP_B` (vùng MLC): `0x00` không xác định; `0x01` đến `0x0A` là đã dùng 0–10 %, 10–20 %, …, 90–100 % tuổi thọ ước tính; `0x0B` vượt tuổi thọ ước tính.
- `PRE_EOL_INFO`: `0x00` không xác định; `0x01` bình thường; `0x02` cảnh báo (đã dùng 80 % khối dự phòng); `0x03` khẩn cấp.
- Gợi ý cho `analyze.mjs`: chỉ dựa vào các dòng khóa, bỏ qua dòng lạ:
  - `^\s*Extended CSD rev 1\.(\d+) \(MMC ([0-9.]+)\)$`
  - `^eMMC Life Time Estimation ([AB]) \[EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_[AB]\]: 0x([0-9a-fA-F]{2})$`
  - `^eMMC Pre EOL information \[EXT_CSD_PRE_EOL_INFO\]: 0x([0-9a-fA-F]{2})$`
  - so sánh đầu và cuối soak: tăng một bậc trong 7 ngày là đáng chú ý; `PRE_EOL_INFO ≥ 0x02` hoặc life ≥ `0x0A` là đỏ.

## Lệnh chỉ đọc dự kiến cho T013 (kiểm thiết bị)

Chỉ đọc, không đổi cấu hình; chạy bằng root qua SSH khi người dùng cho phép. **Không** chạy lệnh `mmc` ghi (`mmc extcsd write`, `mmc bkops enable`, `mmc writeprotect ...`, `mmc sanitize`, `mmc ffu`, `mmc rpmb ...`, `mmc gp/enh_area/write_reliability set`): một số không đảo ngược được.

```sh
command -v mmc && (dpkg-query -W mmc-utils 2>/dev/null || true)  # có mmc-utils không, bản nào
ls -l /dev/mmcblk* ; ls /sys/block                                 # tên thiết bị eMMC
mmc extcsd read /dev/mmcblk0 > /tmp/extcsd.txt                     # đọc EXT_CSD (CMD8), ghi ra tmpfs
grep -E 'Extended CSD rev|Life Time Estimation|Pre EOL' /tmp/extcsd.txt
# không có mmc-utils: nhân Linux mới (khoảng ≥ 4.10, chưa kiểm trên BL335) có thuộc tính sysfs tương đương
cat /sys/block/mmcblk0/device/life_time      # "0xAA 0xBB" = TYP_A TYP_B
cat /sys/block/mmcblk0/device/pre_eol_info   # "0x01"
cat /sys/block/mmcblk0/device/{type,name,manfid,oemid,date,fwrev,rev} 2>/dev/null
cat /sys/block/mmcblk0/stat                  # trường 7 = số sector (512 B) đã ghi từ lúc khởi động
cat /proc/$(pidof mat-runtime)/io            # write_bytes của tiến trình
uname -r ; mount | grep -E 'mmcblk|on / ' ; df -h
```

Ghi kết quả vào `docs/reports/device-profile.md` (mục "011"); chép đầu ra `mmc extcsd read` thật vào `tools/soak/fixtures/extcsd-bl335.txt` (bỏ số sê-ri nếu có trong CID; EXT_CSD không chứa sê-ri).
