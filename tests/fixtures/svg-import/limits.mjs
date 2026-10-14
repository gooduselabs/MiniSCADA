// Ca giới hạn của SVG importer (feature 008, T036, SC-010; contract §10).
// Không commit file sinh ra: `node tests/fixtures/svg-import/limits.mjs` ghi vào out/ (đã ignore);
// harness và test gọi trực tiếp buildLimitCase(name) / LIMIT_CASE_NAMES, không cần ghi đĩa.
//
// Quy ước đếm (importer T0xx phải khớp; nếu khác biệt ±1 thì chỉnh ở đây VÀ ghi vào ghi chú task):
//  - độ sâu: phần tử gốc <svg> có độ sâu 1;
//  - phần tử (thô và sau chuẩn hóa): mọi phần tử, kể cả <svg> gốc; chú thích không tính;
//  - phần tử hiệu dụng: E(tài liệu) = số phần tử (kể cả <defs>, <use>) + tổng E(đích) của mọi <use> nằm
//    ngoài <defs>; E(cây con) = số phần tử + tổng E(đích) của mọi <use> trong cây con (đệ quy);
//  - ảnh: tổng byte SAU giải mã base64.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIB = 1024 * 1024;
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const HEAD = `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100" viewBox="0 0 100 100">`;
const TAIL = '</svg>\n';

// PNG 48 x 32 hợp lệ (ô bàn cờ), CC0.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAASElEQVR4nO3OMQ0AMAwDwcAJpqILuuIogXisPPgljy/5qs+su9PrfvcFCBCgOJDrWPWAAAHKA7mOVQ8IEKA8kOtY9YAAAYoDPV9kcHlY3QypAAAAAElFTkSuQmCC';
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const rep = (s, n) => s.repeat(n);
const doc = (body) => `${HEAD}\n${body}\n${TAIL}`;

/** Tài liệu đúng `bytes` byte: đệm bằng một chú thích. */
function sizedDoc(bytes) {
  const base = `${HEAD}\n<rect width="10" height="10"/>\n<!--`;
  const end = `-->\n${TAIL}`;
  const pad = bytes - Buffer.byteLength(base) - Buffer.byteLength(end);
  return base + rep('x', pad) + end;
}

/** `n` phần tử tổng cộng (gồm <svg> gốc); phần còn lại là <rect/>. */
const elementsDoc = (n) => doc(rep('<rect width="1" height="1"/>', n - 1));

/** Độ sâu `d`: gốc + (d-2) <g> + 1 <rect>. */
const depthDoc = (d) => doc(rep('<g>', d - 2) + '<rect width="1" height="1"/>' + rep('</g>', d - 2));

/** `n` phần tử thô gồm gốc và `n-1` <desc/> (bị loại khi chuẩn hóa, nên không đụng giới hạn 20.000). */
const rawDoc = (n) => doc(rep('<desc/>', n - 1));

/**
 * Bom `use` có số phần tử hiệu dụng đúng `effective` (quy ước ở đầu file).
 * l0 = g + rect (2 phần tử); li = g + 10 use(l(i-1)) (11 phần tử); 3 use cấp l4 ở ngoài <defs>; còn lại là rect đệm.
 * Hiệu dụng E(l0) = 2, E(li) = 11 + 10 * E(l(i-1)) => E(l4) = 32.221; chỉ tính use ngoài <defs>.
 */
function useDoc(effective) {
  const defs = ['<g id="l0"><rect width="1" height="1"/></g>'];
  for (let i = 1; i <= 4; i++) defs.push(`<g id="l${i}">${rep(`<use href="#l${i - 1}"/>`, 10)}</g>`);
  const eff = [2];
  for (let i = 1; i <= 4; i++) eff.push(11 + 10 * eff[i - 1]);
  const topUses = 3;
  const docElements = 1 /* svg */ + 1 /* defs */ + 2 + 4 * 11 + topUses;
  const pad = effective - (docElements + topUses * eff[4]);
  if (pad < 0) throw new Error('effective quá nhỏ');
  return doc(`<defs>${defs.join('')}</defs>${rep('<use href="#l4"/>', topUses)}${rep('<rect width="1" height="1"/>', pad)}`);
}

const filterDoc = (n) =>
  doc(
    `<defs>${Array.from({ length: n }, (_, i) => `<filter id="f${i}"><feGaussianBlur stdDeviation="2"/></filter>`).join('')}</defs>` +
      '<rect width="10" height="10" filter="url(#f0)"/>',
  );

const feDoc = (n) => doc(`<defs><filter id="f0">${rep('<feOffset dx="1" dy="1"/>', n)}</filter></defs><rect width="10" height="10" filter="url(#f0)"/>`);

const imagesDoc = (n) =>
  doc(
    Array.from(
      { length: n },
      (_, i) => `<image x="${i}" y="0" width="5" height="5" href="data:image/png;base64,${PNG_B64}"/>`,
    ).join(''),
  );

/** Một ảnh có đúng `bytes` byte sau giải mã: chữ ký PNG rồi số 0. */
function imageBytesDoc(bytes) {
  const buf = Buffer.alloc(bytes);
  PNG_SIG.copy(buf);
  return doc(`<image x="0" y="0" width="50" height="50" href="data:image/png;base64,${buf.toString('base64')}"/>`);
}

const textDoc = (n) => doc(`<text x="1" y="10">${rep('a', n)}</text>`);

/** Thuộc tính `d` dài đúng `n` ký tự. */
function pathDoc(n) {
  const head = 'M0 0';
  const unit = 'L1 1 ';
  const count = Math.floor((n - head.length) / unit.length);
  let d = head + rep(unit, count);
  d += rep('1', n - d.length); // đệm chữ số vào số cuối cho đủ độ dài
  return doc(`<path d="${d}"/>`);
}

/** Bảng ca: tên -> { build, expect }. `expect.outcome`: ok (nhập được), rejected, sanitized (nhập, kèm mã). */
const CASES = {
  'bytes-5mib': { build: () => sizedDoc(5 * MIB), expect: { outcome: 'ok', codes: [] }, limit: 'byte 5 MiB (5.242.880)' },
  'bytes-5mib-plus-1': { build: () => sizedDoc(5 * MIB + 1), expect: { outcome: 'rejected', codes: ['E_IMPORT_LIMIT'] }, limit: 'byte 5 MiB' },
  'bytes-6mib': { build: () => sizedDoc(6 * MIB), expect: { outcome: 'rejected', codes: ['E_IMPORT_LIMIT'] }, limit: 'byte 5 MiB (ca m29)' },
  'elements-20000': { build: () => elementsDoc(20000), expect: { outcome: 'ok', codes: [] }, limit: '20.000 phần tử sau chuẩn hóa' },
  'elements-20001': { build: () => elementsDoc(20001), expect: { outcome: 'rejected', codes: ['E_IMPORT_LIMIT'] }, limit: '20.000 phần tử sau chuẩn hóa' },
  'depth-32': { build: () => depthDoc(32), expect: { outcome: 'ok', codes: [] }, limit: 'độ sâu 32' },
  'depth-33': { build: () => depthDoc(33), expect: { outcome: 'rejected', codes: ['E_IMPORT_LIMIT'] }, limit: 'độ sâu 32' },
  'depth-100': { build: () => depthDoc(100), expect: { outcome: 'rejected', codes: ['E_IMPORT_LIMIT'] }, limit: 'độ sâu 32 (ca m30a)' },
  'raw-100000': { build: () => rawDoc(100000), expect: { outcome: 'sanitized', codes: ['R_META'] }, limit: '100.000 phần tử thô' },
  'raw-100001': { build: () => rawDoc(100001), expect: { outcome: 'rejected', codes: ['E_IMPORT_LIMIT'] }, limit: '100.000 phần tử thô' },
  'raw-200000': { build: () => rawDoc(200000), expect: { outcome: 'rejected', codes: ['E_IMPORT_LIMIT'] }, limit: '100.000 phần tử thô (ca m30b)' },
  'use-effective-100000': { build: () => useDoc(100000), expect: { outcome: 'ok', codes: [] }, limit: '100.000 phần tử hiệu dụng sau mở use' },
  'use-effective-100001': { build: () => useDoc(100001), expect: { outcome: 'rejected', codes: ['E_IMPORT_USE_BOMB'] }, limit: '100.000 phần tử hiệu dụng sau mở use' },
  'filters-8': { build: () => filterDoc(8), expect: { outcome: 'ok', codes: [] }, limit: '8 filter' },
  'filters-9': { build: () => filterDoc(9), expect: { outcome: 'sanitized', codes: ['R_FILTER_LIMIT'] }, limit: '8 filter' },
  'fe-64': { build: () => feDoc(64), expect: { outcome: 'ok', codes: [] }, limit: '64 phần tử fe*' },
  'fe-65': { build: () => feDoc(65), expect: { outcome: 'sanitized', codes: ['R_FILTER_LIMIT'] }, limit: '64 phần tử fe*' },
  'images-16': { build: () => imagesDoc(16), expect: { outcome: 'ok', codes: [] }, limit: '16 ảnh' },
  'images-17': { build: () => imagesDoc(17), expect: { outcome: 'sanitized', codes: ['R_IMAGE_LIMIT'] }, limit: '16 ảnh' },
  'image-bytes-2mib': { build: () => imageBytesDoc(2 * MIB), expect: { outcome: 'ok', codes: [] }, limit: '2 MiB ảnh (sau giải mã)' },
  'image-bytes-2mib-plus-1': { build: () => imageBytesDoc(2 * MIB + 1), expect: { outcome: 'sanitized', codes: ['R_IMAGE_LIMIT'] }, limit: '2 MiB ảnh (sau giải mã)' },
  'text-4096': { build: () => textDoc(4096), expect: { outcome: 'ok', codes: [] }, limit: '4.096 ký tự mỗi nút chữ' },
  'text-4097': { build: () => textDoc(4097), expect: { outcome: 'sanitized', codes: ['R_TEXT_LONG'] }, limit: '4.096 ký tự mỗi nút chữ' },
  'path-d-1mib': { build: () => pathDoc(MIB), expect: { outcome: 'ok', codes: [] }, limit: 'd 1 MiB' },
  'path-d-1mib-plus-1': { build: () => pathDoc(MIB + 1), expect: { outcome: 'sanitized', codes: ['R_VALUE_INVALID'] }, limit: 'd 1 MiB' },
};

export const LIMIT_CASE_NAMES = Object.keys(CASES);

/** Dựng một ca: { name, content (chuỗi UTF-8), expect, limit }. */
export function buildLimitCase(name) {
  const c = CASES[name];
  if (!c) throw new Error(`Không có ca giới hạn: ${name}`);
  return { name, content: c.build(), expect: c.expect, limit: c.limit };
}

const here = dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(here, 'out');
  mkdirSync(out, { recursive: true });
  const index = [];
  for (const name of LIMIT_CASE_NAMES) {
    const c = buildLimitCase(name);
    writeFileSync(join(out, `${name}.svg`), c.content);
    index.push({ name, bytes: Buffer.byteLength(c.content), limit: c.limit, expect: c.expect });
  }
  writeFileSync(join(out, 'limits-index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`ghi ${index.length} ca vào ${out}`);
}
