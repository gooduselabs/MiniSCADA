# Contract: ngôn ngữ biểu thức của Tag tính toán

**Feature**: [spec.md](../spec.md) FR-019, FR-020, SC-008, SC-015 · **Research**: R17 · **ADR**: [015](../../../docs/adr/015-expression-language.md)

Một ngữ pháp, một ngữ nghĩa, hai bản cài đặt: `packages/expression` (TS: Studio, bộ kiểm tra TS) và `core/expression` (C++: Tag Engine, bộ kiểm tra C++). Hai bản phải cho cùng giá trị (từng bit), cùng kiểu, cùng quality, cùng lý do và cùng mã lỗi kèm vị trí trên bộ vector chung (§8). Không có script (Constitution V, D4).

## 1. Ví dụ

```text
TANK01.LEVEL * 12.5
TANK01.LEVEL > TANK01.SP_HI
text(PUMP01.STATE, TrangThaiBom)
OK1 ? PLC1.TEMP : PLC2.TEMP
round((FLOW_A + FLOW_B) / 2, 1)
clamp(TANK01.LEVEL - 5, 0, 100)
PUMP01.RUN && !PUMP01.FAULT
MODE == "AUTO" ? SP_AUTO : SP_MAN
```

## 2. Ngữ pháp (EBNF, ISO 14977)

```ebnf
expression     = conditional ;
conditional    = logical or , [ "?" , expression , ":" , expression ] ;      (* kết hợp phải *)
logical or     = logical and , { "||" , logical and } ;
logical and    = equality , { "&&" , equality } ;
equality       = relational , [ ( "==" | "!=" ) , relational ] ;          (* không kết hợp *)
relational     = additive , [ ( "<" | "<=" | ">" | ">=" ) , additive ] ;  (* không kết hợp *)
additive       = multiplicative , { ( "+" | "-" ) , multiplicative } ;
multiplicative = unary , { ( "*" | "/" | "%" ) , unary } ;
unary          = ( "-" | "!" ) , unary | primary ;
primary        = number | "true" | "false" | string | call | tag ref | "(" , expression , ")" ;
call           = function name , "(" , [ expression , { "," , expression } ] , ")" ;
function name  = "min" | "max" | "abs" | "round" | "clamp" | "text" ;
tag ref        = word , { "." , word part } ;
word           = letter , { letter | digit | "_" } ;
word part      = ( letter | digit | "_" ) , { letter | digit | "_" } ;
number         = digit , { digit } , [ "." , digit , { digit } ] ,
                 [ ( "e" | "E" ) , [ "+" | "-" ] , digit , { digit } ] ;
string         = '"' , { string char | '\"' | '\\' } , '"' ;
letter         = "A" … "Z" | "a" … "z" ;
digit          = "0" … "9" ;
```

- **Khoảng trắng:** dấu cách, tab, CR, LF, đặt giữa token tùy ý.
- **`string char`:** mọi ký tự Unicode trừ `"`, `\` và ký tự điều khiển (< U+0020).
- **Từ khóa:** `true`, `false` luôn là giá trị BOOL. Tag có tên đúng bằng hai từ này không tham chiếu được trong biểu thức.
- **Gọi hàm:** một `word` theo sau là `(` là gọi hàm. Tên khác 6 hàm trên là `E_EXPR_UNKNOWN_FUNC`.
- **`text(x, B)`:** tham số thứ hai phải là tên một bảng giá trị (`word`, không có dấu chấm), không phải biểu thức.
- **`round(x, n)`:** `n` phải là số nguyên viết thẳng 0–9.
- **Số viết thẳng** phải hữu hạn khi đọc thành số thực 64 bit (`1e400` là `E_EXPR_SYNTAX`). Không có `.5`, `5.`, số hex.
- **Không kết hợp:** `a < b < c` và `a == b == c` là `E_EXPR_SYNTAX` ("viết rõ bằng && hoặc ngoặc").

## 3. Kiểu

Ba kiểu: `number`, `bool`, `string`. Tag: 8 kiểu số là `number`, `BOOL` là `bool`, `STRING` là `string`.

| Phép | Toán hạng | Kết quả |
|---|---|---|
| `+ - * / %`, `-x` một ngôi | `number` hoặc `bool` (BOOL là 1/0) | `number` |
| `!x` | `bool` | `bool` |
| `< <= > >=` | `number` hoặc `bool` | `bool` |
| `== !=` | hai `number`/`bool`; hoặc hai `string` | `bool` |
| `&& \|\|` | `bool`, `bool` | `bool` |
| `c ? a : b` | `c`: `bool`; `a`, `b` cùng kiểu, hoặc trộn `number` với `bool` | kiểu chung (trộn thì `number`) |
| `min(a, b, …)`, `max(…)` | 2–16 tham số `number`/`bool` | `number` |
| `abs(x)` | `number`/`bool` | `number` |
| `round(x)`, `round(x, n)` | `x`: `number`/`bool` | `number` |
| `clamp(x, lo, hi)` | 3 tham số `number`/`bool` | `number` |
| `text(x, B)` | `x`: `number`/`bool` | `string` |

Trái bảng này là `E_EXPR_TYPE`, ví dụ: cộng chuỗi với số; `&&` với số; so `<` hai chuỗi; `text` với Tag STRING.

**Gán kết quả vào Tag tính toán** (theo `type` của Tag):

| Kết quả \ `type` | Số nguyên (INT16…UINT64) | FLOAT32 | FLOAT64 | BOOL | STRING |
|---|---|---|---|---|---|
| `number` | `round(x)`; ngoài khoảng → BAD `OUT_OF_RANGE` | làm tròn 32 bit; vượt → BAD `OVERFLOW` | `x` | `E_EXPR_TYPE` | `E_EXPR_TYPE` |
| `bool` | 1/0 | 1/0 | 1/0 | giữ nguyên | `E_EXPR_TYPE` |
| `string` | `E_EXPR_TYPE` | `E_EXPR_TYPE` | `E_EXPR_TYPE` | `E_EXPR_TYPE` | giữ nguyên (> 1.024 byte → BAD `OUT_OF_RANGE`) |

`-0` được chuẩn hóa thành `0` trước khi gán.

## 4. Ngữ nghĩa số và hàm

- **Số thực nhị phân 64 bit IEEE 754**, làm tròn về gần nhất (chẵn khi đúng giữa). Không gộp nhân-cộng: bản C++ build với `-ffp-contract=off`. Đọc số viết thẳng bằng `strtod` (C++) và `Number` (TS), cả hai đều làm tròn đúng.
- **Thứ tự tính:** trái sang phải; tham số của hàm trái sang phải.
- **`a / b`:** `b == 0` (kể cả `-0`) thì BAD `DIV_ZERO`, kiểm trước khi chia.
- **`a % b`:** như `fmod` của C (dấu của số bị chia, kết quả chính xác); `b == 0` thì BAD `MOD_ZERO`.
- **Kết quả ±∞** của bất kỳ phép nào: BAD `OVERFLOW`. **NaN:** BAD `NOT_A_NUMBER`.
- **`round(x)`:** nửa ra xa số 0:

  ```text
  r = trunc(x)
  nếu |x − r| ≥ 0.5 thì r = r + (x > 0 ? 1 : −1)
  ```

  `x − trunc(x)` chính xác với mọi số thực 64 bit. Ví dụ: `round(2.5)` = 3, `round(-2.5)` = −3, `round(0.49999999999999994)` = 0.
- **`round(x, n)`** = `round(x × 10ⁿ) / 10ⁿ`, tính bằng số thực 64 bit (10ⁿ chính xác với n ≤ 9). Hệ quả có chủ ý: `round(1.005, 2)` = 1, vì `1.005 × 100` = 100,49999999999999.
- **`min`, `max`:** so bằng `<`, `>` của số thực, lấy tham số đầu tiên khi bằng nhau.
- **`abs(x)`:** đổi dấu khi âm.
- **`clamp(x, lo, hi)`:** `lo > hi` thì BAD `CLAMP_RANGE`; ngược lại `min(max(x, lo), hi)`.
- **`text(x, B)`:** tra bảng giá trị B ([value-tables-simulation.md](value-tables-simulation.md) §1). Không khớp thì chữ của `default`, không có thì chuỗi rỗng.
- **Chuỗi:** `==` so từng byte UTF-8, không chuẩn hóa Unicode.

## 5. Quality và lỗi khi tính

- **Chỉ đầu vào được nạp mới tính:** `c ? a : b` chỉ nạp `c` và nhánh được chọn; `a && b` không nạp `b` khi `a` là `false`; `a || b` không nạp `b` khi `a` là `true`.
- **Quality** = xấu nhất (GOOD < UNCERTAIN < BAD) của các đầu vào đã nạp.
- **Gặp đầu vào BAD thì dừng ngay**, kết quả BAD:
  - lý do `NO_VALUE` nếu đầu vào đó có lý do `NO_VALUE` (chưa có giá trị);
  - lý do `INPUT_BAD` trong các trường hợp còn lại.

  Chi tiết (cho chẩn đoán) ghi id đầu vào BAD đầu tiên.
- **Đầu vào UNCERTAIN:** tính bình thường; kết quả UNCERTAIN, lý do là lý do của đầu vào UNCERTAIN đầu tiên.
- **Khi kết quả BAD**, Tag giữ giá trị cuối (FR-010); vector ghi `"value": null` nghĩa là "không có giá trị mới".

| Lý do | Khi |
|---|---|
| `NO_VALUE`, `INPUT_BAD` | §5 ở trên |
| `DIV_ZERO`, `MOD_ZERO` | chia, chia lấy dư cho 0 |
| `OVERFLOW` | ±∞; FLOAT32 vượt khoảng |
| `NOT_A_NUMBER` | NaN |
| `OUT_OF_RANGE` | ngoài khoảng của kiểu số nguyên; chuỗi > 1.024 byte |
| `CLAMP_RANGE` | `clamp` với `lo > hi` |

## 6. Lỗi khi kiểm (Studio khi gõ, bộ kiểm tra hai bản)

Mỗi lỗi có `code`, `span: [đầu, cuối)` (chỉ số ký tự Unicode trong chuỗi biểu thức) và `message` tiếng Việt. Vector so `code` và `span`, không so `message`.

| Mã | Ví dụ | `span` |
|---|---|---|
| `E_EXPR_SYNTAX` | `(A + B` (thiếu ngoặc); `A +`; `A < B < C`; `1e400`; `"abc` | token gây lỗi; hết chuỗi thì `[len, len]` |
| `E_EXPR_UNKNOWN_TAG` | `TANK9.LEVEL` | tên Tag |
| `E_EXPR_UNKNOWN_TABLE` | `text(A, KhongCo)` | tên bảng |
| `E_EXPR_UNKNOWN_FUNC` | `sqrt(A)` | tên hàm |
| `E_EXPR_ARITY` | `abs(A, B)`; `min(A)`; `round(A, 1, 2)` | cả lời gọi |
| `E_EXPR_TYPE` | `"a" + 1`; `A && B` với A là số; `round(A, B)`; kết quả số cho Tag BOOL | toán hạng hoặc biểu thức con sai kiểu; kết quả sai kiểu thì cả biểu thức |
| `E_EXPR_LIMIT` | > 1.000 ký tự, > 4.096 byte, lồng > 32, > 32 Tag | phần vượt (ký tự thứ 1.001; mức lồng thứ 33; Tag thứ 33) |
| `E_EXPR_CYCLE` | A dùng B, B dùng A | cả biểu thức; `message` có đường vòng |
| `E_EXPR_DEPTH` | chuỗi phụ thuộc > 16 tầng | cả biểu thức |

Cảnh báo: `W_EXPR_INT64` (dùng Tag INT64/UINT64: mất chính xác ngoài ±2^53).

Mỗi biểu thức báo lỗi đầu tiên theo thứ tự: cú pháp → tên → số tham số → kiểu → giới hạn. `E_EXPR_CYCLE` và `E_EXPR_DEPTH` là luật mức project, chạy sau cùng.

## 7. Giới hạn (FR-020)

| Giới hạn | Giá trị | Ghi chú |
|---|---|---|
| Độ dài | ≤ 1.000 ký tự và ≤ 4.096 byte UTF-8 | |
| Mức lồng | ≤ 32 | Đếm theo độ sâu đệ quy của parser: ngoặc, gọi hàm, nhánh `?:`, toán tử một ngôi. Chuỗi phép hai ngôi parse bằng vòng lặp, không tính |
| Tag đầu vào khác nhau | ≤ 32 | |
| Chuỗi phụ thuộc | ≤ 16 tầng | Tag tính toán không phụ thuộc Tag tính toán nào ở tầng 1 |
| Ngăn xếp khi chạy | ≤ 64 | hệ quả của mức lồng; bytecode kiểm lúc biên dịch |

## 8. Bộ vector chung (`tests/expression-vectors/`)

**File** theo nhóm, mỗi file `{ "group": "…", "cases": [ … ] }`:

```json
{
  "name": "ternary-dead-branch-bad",
  "expr": "OK1 ? PLC1.TEMP : PLC2.TEMP",
  "inputs": {
    "OK1": { "type": "BOOL", "value": false, "quality": "GOOD" },
    "PLC1.TEMP": { "type": "FLOAT32", "value": null, "quality": "BAD", "reason": "DISCONNECTED" },
    "PLC2.TEMP": { "type": "FLOAT32", "value": 25.5, "quality": "GOOD" }
  },
  "tables": {},
  "target": "FLOAT32",
  "expect": { "value": 25.5, "quality": "GOOD" }
}
```

- **Lỗi kiểm:** `"expect": { "error": "E_EXPR_TYPE", "span": [0, 3] }`.
- **Số:** dạng ngắn nhất đọc lại đúng (`JSON.stringify` của JS). Giá trị đặc biệt là chuỗi `"NaN"`, `"Infinity"`, `"-Infinity"`. INT64/UINT64 là chuỗi thập phân.
- **So sánh:** giá trị bằng từng bit sau khi đọc; `quality`, `reason`, `error`, `span` bằng nhau.

**Số ca tối thiểu** (tổng ≥ 300, SC-008):

| Nhóm (file) | Ca |
|---|---|
| `arith` (+ − × ÷, một ngôi, BOOL là 1/0, thứ tự ưu tiên) | 50 |
| `mod-round` (`%` theo dấu, `round` nửa, `round(x, n)`, 1.005) | 40 |
| `compare` (số, BOOL, chuỗi, `-0`, không kết hợp) | 30 |
| `logic-quality` (`&&`, `\|\|`, `!`, tính lười, quality theo nhánh) | 50 |
| `ternary` (kiểu chung, nhánh xấu không dùng, lồng, kết hợp phải) | 25 |
| `functions` (`min`, `max`, `abs`, `clamp`, số tham số) | 35 |
| `text` (khớp, khoảng, mặc định, không mặc định, BOOL) | 20 |
| `strings` (`==` byte, ký tự tiếng Việt, chuỗi thoát) | 15 |
| `assign` (gán vào 10 kiểu, tràn, làm tròn, FLOAT32) | 25 |
| `syntax-errors` (kèm `span`) | 30 |
| `type-errors` (kèm `span`) | 25 |
| `limits` (1.000 ký tự, lồng 32/33, 32/33 Tag) | 10 |

Vòng tham chiếu và độ sâu nằm ở `tests/project-vectors/v02-invalid-expr-cycle*`, `v02-invalid-expr-depth`.

**Sinh vector:** `node tests/expression-vectors/generate.mjs`:

- ca sinh tự động (tổ hợp phép × kiểu × giá trị biên) có kết quả do **bộ tính tham chiếu viết riêng trong script** (duyệt cây, không import `@mat/expression`);
- ca viết tay nằm trong `handwritten/*.json`, kết quả ghi sẵn;
- kết quả được commit; Vitest (`packages/expression`) và GoogleTest (`core/expression`) đọc thẳng các file.

## 9. Giao diện lập trình

**TS** (`@mat/expression`):

```ts
export interface CompileEnv {
  tagType(id: string): TagDataType | undefined;  // undefined: Tag không có
  hasTable(name: string): boolean;
  target: TagDataType;                           // kiểu của Tag tính toán
}
export type CompileResult =
  | { ok: true; program: Program; inputs: string[]; warnings: ExprIssue[] }
  | { ok: false; errors: ExprIssue[] };           // Studio dùng errors[0] để gạch dưới
export interface ExprIssue { code: string; span: [number, number]; message: string }
export function compile(src: string, env: CompileEnv): CompileResult;
export function evaluate(p: Program, input: (i: number) => InputValue, tables: TableSet): EvalResult;
export function tokens(src: string): Token[];   // tô màu cú pháp, gợi ý, đổi tên Tag (FR-047)
```

**C++** (`mat::expr`, `core/expression/`): `compile(std::string_view, const CompileEnv&)`, `evaluate(const Program&, InputFn, const TableSet&)`, cùng kiểu kết quả. Build với `-ffp-contract=off`.
