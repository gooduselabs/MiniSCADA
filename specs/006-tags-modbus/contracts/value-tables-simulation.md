# Contract: bảng giá trị và bộ sinh mô phỏng

**Feature**: [spec.md](../spec.md) FR-021, FR-022, FR-052, FR-054, SC-008, SC-017 · **Research**: R18 · **ADR**: [015](../../../docs/adr/015-expression-language.md)

Hai bản cài đặt: TS (`@mat/expression` cho bảng giá trị, `@mat/tag-sim` cho bộ sinh; Studio, trang xem qua `binding-engine`) và C++ (`core/expression`, `drivers/simulation`). Cùng bộ vector, so từng bit (§3). Bản C++ của bộ sinh build với `-ffp-contract=off`.

## 1. Bảng giá trị

**Định dạng file:** [project-format-0.2.md](project-format-0.2.md) §5; trường: [data-model.md](../data-model.md) §3.

**Chuẩn hóa mục:**

- `value: v` (số) là điểm {v}; `value: true/false` là {1}/{0};
- `from`/`to` là khoảng nửa mở [from, to); vắng `from` là −∞, vắng `to` là +∞; cả hai vắng là lỗi schema;
- `from ≥ to` là lỗi `E_VT_RANGE` (khoảng rỗng).

**Chồng nhau** (`E_VT_OVERLAP`, báo ở mục sau trong cặp):

| Cặp | Chồng khi |
|---|---|
| điểm, điểm | bằng nhau |
| điểm v, khoảng | `from ≤ v < to` |
| khoảng, khoảng | `max(from₁, from₂) < min(to₁, to₂)` |

**Tra** `lookup(B, x)`:

1. `x` là BOOL thì đổi thành 1/0; `x` NaN thì sang bước 3;
2. tìm mục có `x == v` hoặc `from ≤ x < to`. Không chồng nên có tối đa một mục;
3. không có thì `default` nếu có; không thì `{ text: "", color: null }`.

Kết quả: `{ text, color, entry }` (`entry` là chỉ số mục, `"default"` hoặc `null`).

**Dùng ở:**

- `text(x, B)` của biểu thức: lấy `text`;
- binding `valueTable` ([project-format-0.2.md](project-format-0.2.md) §8): `text` hoặc `color`; `color` null thì không áp;
- Studio: Bảng theo dõi (cột chữ và màu), Bảng Tag, ô thử của editor Bảng giá trị (FR-048).

## 2. Bộ sinh mô phỏng

**Thời gian** `t`: số nguyên ms UTC (≥ 0, < 2^53). BL335 lấy theo đồng hồ hệ thống ở mỗi lượt engine (250 ms); Studio lấy `Date.now()` ở mỗi lượt Mô phỏng (250 ms). `T` = `periodMs` (số nguyên 100–86.400.000).

**Phép nguyên chính xác:**

- `m = t mod T`: C++ `int64_t %`; TS `%` trên số nguyên < 2^53, đều chính xác;
- `k = (t − m) / T`: chia hết, nên chính xác. Không dùng `floor(t / T)` vì phép chia số thực có thể làm tròn lên ở biên.

| `kind` | Công thức (đúng thứ tự phép tính) |
|---|---|
| `const` | `value` |
| `ramp` | `p = m / T; out = from + (to − from) × p` |
| `sine` | `f = m / T + phase; nếu f ≥ 1 thì f = f − 1; out = center + amplitude × sinTurns(f)` |
| `random` | `u = U(seed, k); out = min + (max − min) × u` (Tag BOOL: `u ≥ 0.5`) |
| `square` | `on = m < duty × T` (Tag BOOL: `on`; Tag số: 1/0) |
| `manual` | `initial`, rồi giá trị của lệnh ghi cuối |
| `legacy` | `MockTagProvider` (§2.4) |

**Đổi về kiểu Tag:** số nguyên thì `round` (nửa ra xa số 0, như biểu thức), rồi kẹp vào khoảng của kiểu; `FLOAT32` thì làm tròn 32 bit (`Math.fround`, ép `float`); `FLOAT64` giữ nguyên. Quality luôn GOOD; deadband của Tag vẫn áp.

### 2.1 `sinTurns(f)`, f ∈ [0, 1): sin(2πf), tất định

Không gọi `std::sin` hay `Math.sin`: hai hàm có thể khác nhau một ulp.

```text
HALF_PI = 1.5707963267948966          (0x3FF921FB54442D18)
q = floor(f × 4)                       ; 0…3 (nhân với 4 chính xác)
r = f × 4 − q                          ; [0, 1), chính xác
nếu r > 0.5 thì { r = 1 − r; dùng hàm "kia" }   ; sin ↔ cos; 1 − r chính xác
x = r × HALF_PI                        ; x ∈ [0, π/4]
S(x) = x + x·z·(S1 + z·(S2 + z·(S3 + z·(S4 + z·(S5 + z·S6))))), z = x·x
C(x) = 1 − (0.5·z − z·(z·(C1 + z·(C2 + z·(C3 + z·(C4 + z·(C5 + z·C6))))))), z = x·x
q = 0: S hoặc C;  q = 1: C hoặc S;  q = 2: −S hoặc −C;  q = 3: −C hoặc −S
```

- Quy tắc chọn: ở góc phần tư q, giá trị là `sin(π/2 · (q + r))`. Với `r ≤ 0.5` dùng cặp bên trái (S với q chẵn, C với q lẻ); với `r > 0.5` đổi sang cặp bên phải và dùng `1 − r`.
- Hệ số (của fdlibm `__kernel_sin`, `__kernel_cos`, © Sun Microsystems, cho phép dùng tự do):

  | | Giá trị |
  |---|---|
  | S1 | −1.66666666666666324348e-01 |
  | S2 | 8.33333333332248946124e-03 |
  | S3 | −1.98412698298579493134e-04 |
  | S4 | 2.75573137070700676789e-06 |
  | S5 | −2.50507602534068634195e-08 |
  | S6 | 1.58969099521155010221e-10 |
  | C1 | 4.16666666666666019037e-02 |
  | C2 | −1.38888888888741095749e-03 |
  | C3 | 2.48015872894767294178e-05 |
  | C4 | −2.75573143513906633035e-07 |
  | C5 | 2.08757232129817482790e-09 |
  | C6 | −1.13596475577881948265e-11 |

- Mọi phép theo đúng thứ tự trên, không gộp nhân-cộng. Sai số so với sin thật dưới 2 ulp. Không cần đúng tuyệt đối, chỉ cần hai bản giống từng bit.

### 2.2 `U(seed, k)` ∈ [0, 1): hàm băm theo bộ đếm

```text
mix(x):  x ^= x >>> 16; x = x × 0x7FEB352D (mod 2^32); x ^= x >>> 15; x = x × 0x846CA68B (mod 2^32); x ^= x >>> 16
k_lo = k mod 2^32;  k_hi = floor(k / 2^32)
h = mix(seed ^ 0x9E3779B9);  h = mix(h ^ k_lo);  h = mix(h ^ k_hi)
U = (h >>> 8) / 16777216               ; 24 bit, chính xác trong số thực 64 bit
```

- `mix` là "lowbias32" (Chris Wellons, public domain).
- TS: `Math.imul`, `>>> 0`; `k_lo = k >>> 0` (ToUint32 lấy đúng phần dư cho số nguyên < 2^53). C++: `uint32_t`.

### 2.3 Tag ngoài chưa có `sim`, trong Mô phỏng của Studio (FR-052)

| Kiểu Tag | Mặc định |
|---|---|
| số | `random`, `min`/`max` của Tag (thiếu thì 0–100, như `simRange` của 004), `periodMs` 2.000, `seed` = FNV-1a 32 bit của id Tag |
| BOOL | `square`, `periodMs` 10.000, `duty` 0,5 |
| STRING | `const ""` |

Tag nội bộ: `initial`. Tag tính toán: tính bằng `@mat/expression`.

### 2.4 `legacy` (chỉ từ nâng cấp 0.1)

- **BL335:** `MockTagProvider` của Sprint 1, giữ nguyên thuật toán và hằng số (chỉ đổi chỗ phát giá trị sang `EngineSink`): bồn đầy và cạn có trễ, bơm bật tắt, `tank.temp` BAD 5 s mỗi 20 s; tín hiệu lạ BAD `NO_SIGNAL`. Có trạng thái, chạy từ lúc runtime khởi động.
- **Studio:** bản port TS `legacy-mock.ts`, bước 250 ms từ lúc bật Mô phỏng, dùng cho project 0.1 mở chỉ đọc.
- Không thuộc yêu cầu giống từng bit: hàm này dùng `std::sin`/`Math.sin` như bản gốc. Vector `tests/sim-vectors/legacy.json` (sinh từ bản C++) kiểm bản TS với sai số tuyệt đối 1e-9.

## 3. Vector chung

**`tests/value-table-vectors/*.json`:**

```json
{ "table": { "name": "TrangThaiBom", "entries": [ { "value": 0, "text": "Dừng", "color": "#808080" },
                                                    { "from": 10, "to": 20, "text": "Bảo trì" } ],
             "default": { "text": "Không rõ" } },
  "cases": [ { "input": 0, "expect": { "text": "Dừng", "color": "#808080", "entry": 0 } },
             { "input": 20, "expect": { "text": "Không rõ", "color": null, "entry": "default" } },
             { "input": true, "expect": { "text": "Không rõ", "color": null, "entry": "default" } },
             { "input": "NaN", "expect": { "text": "Không rõ", "color": null, "entry": "default" } } ] }
```

Ca bắt buộc: biên dưới và trên của khoảng, khoảng một đầu, `-0`, BOOL, NaN, không mặc định, 256 mục.

**`tests/sim-vectors/*.json`:**

```json
{ "sim": { "kind": "sine", "center": 50, "amplitude": 25, "periodMs": 20000, "phase": 0.25 },
  "type": "FLOAT32",
  "cases": [ { "t": 0, "value": 75 }, { "t": 1791601205123, "value": 49.03419876098633 } ] }
```

Hai giá trị trên tính bằng bản thử của §2.1 (Node, scratchpad, 2026-10-11): `m` = 5.123, `f` = 0,50615, giá trị 64 bit 49,034200651727495, làm tròn 32 bit 49,03419876098633. Bản thử lệch so với `Math.sin` tối đa 6,9e-16 trên 2 triệu điểm ngẫu nhiên.

- `value` của bộ sinh có trạng thái (`manual`) cho bằng chuỗi lệnh ghi;
- `t` gồm 0, biên chu kỳ (m = 0, m = T − 1), năm 2026 và năm 2100;
- mỗi bộ sinh × mỗi kiểu Tag hợp lệ ít nhất 10 ca.

Số trong vector theo quy tắc của [expression-language.md](expression-language.md) §8; so từng bit, trừ `legacy.json`. **Sinh:** `node tests/sim-vectors/generate.mjs` dùng một bản tính tham chiếu viết riêng trong script, theo đúng công thức §2.
