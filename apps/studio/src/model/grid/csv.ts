// CSV và văn bản dạng bảng của lưới (feature 006, research R22; FR-045): RFC 4180, BOM, dấu phân cách `,` `;` tab, xuất
// UTF-8 có BOM, chống chèn công thức khi mở bằng Excel, nhận diện bảng mã. Hàm thuần.

export type Delimiter = ',' | ';' | '\t';

export interface ParsedTable {
  rows: string[][];
  delimiter: Delimiter;
}

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/** Dấu phân cách nhiều nhất ở dòng đầu (không tính trong ngoặc kép); hòa thì theo thứ tự `,`, `;`, tab. */
export function detectDelimiter(text: string): Delimiter {
  const first = stripBom(text);
  const count: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of first) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in count) count[ch as Delimiter]++;
  }
  let best: Delimiter = ',';
  for (const d of [',', ';', '\t'] as const) if (count[d] > count[best]) best = d;
  return best;
}

/**
 * Đọc văn bản phân cách bằng `delimiter` theo RFC 4180: ô trong ngoặc kép có thể chứa dấu phân cách, xuống dòng,
 * nháy kép lặp đôi. Dòng cuối không bắt buộc xuống dòng; dòng rỗng ở cuối bị bỏ. Nháy kép dở dang thì đọc tới hết.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let started = false; // dòng hiện tại đã có nội dung (kể cả ô rỗng đã ngăn bằng dấu phân cách)
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
    started = false;
  };
  const s = stripBom(text);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
      started = true;
    } else if (ch === delimiter) {
      endCell();
      started = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      if (started || cell !== '' || row.length) endRow();
    } else {
      cell += ch;
      started = true;
    }
  }
  if (started || cell !== '' || row.length) endRow();
  return rows;
}

/** Bỏ đúng một nháy đơn ở ô bắt đầu bằng nháy đơn rồi tới ký tự công thức (`'=SUM`, `''=x`). */
const FORMULA_ESCAPED = /^'+[=+\-@\t\r]/;
const unescapeFormula = (cell: string): string =>
  FORMULA_ESCAPED.test(cell) ? cell.slice(1) : cell;

/** Đọc CSV: tự nhận dấu phân cách khi không ép; bỏ BOM; bỏ nháy đơn chống công thức của lần xuất. */
export function parseCsv(text: string, delimiter?: Delimiter): ParsedTable {
  const d = delimiter ?? detectDelimiter(text);
  return { rows: parseDelimited(text, d).map((r) => r.map(unescapeFormula)), delimiter: d };
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const DECIMAL = /^-?\d+\.\d+$/;

/** Ô chữ bắt đầu bằng ký tự công thức (hoặc đã có nháy đơn trước ký tự đó) thì thêm nháy đơn; số thì không. */
function escapeFormula(cell: string): string {
  if (NUMBER.test(cell)) return cell;
  return /^[=+\-@\t\r]/.test(cell) || FORMULA_ESCAPED.test(cell) ? `'${cell}` : cell;
}

export interface CsvOptions {
  /** Dấu thập phân của người dùng: `,` thì dấu phân cách là `;` và số thập phân đổi `.` thành `,`. */
  decimal?: '.' | ',';
  /** Ép dấu phân cách (mặc định theo `decimal`). */
  delimiter?: Delimiter;
}

/** Xuất CSV: UTF-8 có BOM, dòng CRLF, ô cần thì bọc ngoặc kép, chống chèn công thức. */
export function toCsv(rows: readonly (readonly string[])[], opts: CsvOptions = {}): string {
  const decimal = opts.decimal ?? '.';
  const delimiter = opts.delimiter ?? (decimal === ',' ? ';' : ',');
  const render = (raw: string): string => {
    let cell = escapeFormula(raw);
    if (decimal === ',' && DECIMAL.test(cell)) cell = cell.replace('.', ',');
    return cell.includes(delimiter) || /["\n\r\t]/.test(cell)
      ? `"${cell.replace(/"/g, '""')}"`
      : cell;
  };
  const body = rows.map((r) => r.map(render).join(delimiter) + '\r\n').join('');
  return '﻿' + body;
}

export type CsvEncoding = 'utf-8' | 'windows-1258';

/**
 * Giải mã byte của file CSV (Rust trả byte gốc): BOM UTF-8 thì UTF-8; UTF-8 hợp lệ thì UTF-8; không thì Windows-1258
 * (bảng mã của file "CSV" Excel tiếng Việt lưu). `forced`: người dùng đổi ở bước xem trước.
 */
export function decodeCsvBytes(
  bytes: Uint8Array,
  forced?: CsvEncoding,
): { text: string; encoding: CsvEncoding } {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (forced) {
    const text = new TextDecoder(forced).decode(
      bom && forced === 'utf-8' ? bytes.subarray(3) : bytes,
    );
    return { text, encoding: forced };
  }
  if (bom) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1258').decode(bytes), encoding: 'windows-1258' };
  }
}
