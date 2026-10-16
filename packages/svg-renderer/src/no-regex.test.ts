// Test cấu trúc (T020, FR-013): mã quyết định giữ/bỏ của allowlist không dùng biểu thức chính quy và
// cả gói không dùng API DOM nguy hiểm. Môi trường dùng TypeScript native (không có API cây cú pháp),
// nên test quét từ vựng: bỏ bình luận, chuỗi, mẫu; nhận diện literal regex theo ngữ cảnh toán hạng.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Scan {
  regexes: string[];
  idents: Set<string>;
}

const OPERAND_PREV = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const KEYWORD_PREV = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'else']);

function isIdStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
}
function isIdPart(c: string): boolean {
  return isIdStart(c) || (c >= '0' && c <= '9');
}

export function scanSource(text: string): Scan {
  const out: Scan = { regexes: [], idents: new Set() };
  let prev = '';
  let prevWord = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < n && text[i] !== c) i += text[i] === '\\' ? 2 : 1;
      i++;
      prev = 'a';
      prevWord = '';
    } else if (c === '/') {
      const regexAllowed = prev === '' || OPERAND_PREV.has(prev) || KEYWORD_PREV.has(prevWord);
      if (regexAllowed) {
        let j = i + 1;
        let inClass = false;
        while (j < n && text[j] !== '\n') {
          if (text[j] === '\\') j++;
          else if (text[j] === '[') inClass = true;
          else if (text[j] === ']') inClass = false;
          else if (text[j] === '/' && !inClass) break;
          j++;
        }
        out.regexes.push(text.slice(i, j + 1));
        i = j + 1;
        prev = 'a';
        prevWord = '';
      } else {
        i++;
        prev = '/';
        prevWord = '';
      }
    } else if (isIdStart(c)) {
      let j = i;
      while (j < n && isIdPart(text[j])) j++;
      const word = text.slice(i, j);
      out.idents.add(word);
      prevWord = word;
      prev = 'a';
      i = j;
    } else {
      if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
        prev = c;
        prevWord = '';
      }
      i++;
    }
  }
  return out;
}

const FORBIDDEN = [
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'eval',
  'unsafeHTML',
  'RegExp',
  'Function',
];

describe('bộ quét từ vựng của test', () => {
  it('nhận diện literal regex nhưng không nhầm phép chia, bình luận, chuỗi', () => {
    expect(
      scanSource('const a = /ab+c/g.test(x); // /x/\nconst s = "/y/"; const q = a / b / c;')
        .regexes,
    ).toEqual(['/ab+c/']);
    expect(scanSource('x = a / b; return /[/]x/;').regexes).toEqual(['/[/]x/']);
    expect(scanSource('new RegExp("a")').idents.has('RegExp')).toBe(true);
  });
});

describe('cấu trúc mã nguồn: không regex, không API DOM nguy hiểm (FR-013)', () => {
  const FILES = [
    'allowlist.ts',
    'css-value.ts',
    'scan.ts',
    'transform-parse.ts',
    'sanitize.ts',
    'mount.ts',
    'usecount.ts',
  ];
  it.each(FILES)('%s', (file) => {
    const scan = scanSource(readFileSync(resolve(__dirname, file), 'utf8'));
    expect(scan.regexes).toEqual([]);
    expect(FORBIDDEN.filter((w) => scan.idents.has(w))).toEqual([]);
  });
});

// T112: bộ nhập đưa ra quyết định giữ/bỏ trước bộ lọc (CSS thành thuộc tính, tiền xử lý DTD, đối chiếu UID): cũng không regex
// và không API HTML nguy hiểm. `inspect.ts` (nhận diện phần mềm, chỉ để báo cáo) nằm ngoài danh sách.
// F10 (feature 011, T214): binding-engine quyết định giá trị áp lên `fill`/`stroke`, `transform`, `clip-path` của
// phần tử SVG: cũng không regex, không API HTML nguy hiểm (mọi file, kể cả anim/).
describe('cấu trúc mã nguồn của @mat/binding-engine: không regex, không API DOM nguy hiểm (T214)', () => {
  const DIR = resolve(__dirname, '../../binding-engine/src');
  const files = readdirSync(DIR, { recursive: true, encoding: 'utf8' }).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  it('có file để quét', () => {
    expect(files).toContain('transforms.ts');
    expect(files.length).toBeGreaterThan(5);
  });
  it.each(files)('%s', (file) => {
    const scan = scanSource(readFileSync(resolve(DIR, file), 'utf8'));
    expect(scan.regexes).toEqual([]);
    expect(FORBIDDEN.filter((w) => scan.idents.has(w))).toEqual([]);
  });
});

describe('cấu trúc mã nguồn của @mat/svg-import: không regex, không API DOM nguy hiểm (T112)', () => {
  const DIR = resolve(__dirname, '../../svg-import/src');
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  it('có file để quét', () => {
    expect(files.length).toBeGreaterThan(10);
  });
  it.each(files)('%s', (file) => {
    const scan = scanSource(readFileSync(resolve(DIR, file), 'utf8'));
    expect(scan.regexes).toEqual([]);
    expect(FORBIDDEN.filter((w) => scan.idents.has(w))).toEqual([]);
  });
});
