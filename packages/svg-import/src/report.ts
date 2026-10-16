// Báo cáo nhập (contract svg-import §6): bộ dựng tất định, bản `.md` sinh từ cùng dữ liệu, SHA-256 đồng bộ.
// Báo cáo KHÔNG chứa nội dung SVG gốc: chỉ tên thẻ, tên thuộc tính và đường dẫn kiểu /svg/g[2]/path[5].
import { viMessage } from './i18n/vi-import.ts';
import type { ImportReport, RemovedKind } from './types.ts';

export const TOOL_NAME = 'mat-svg-import 0.1.0';
const MAX_EXAMPLES = 3;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface RemovedEntry {
  kind: RemovedKind;
  name: string;
  code: string;
  count: number;
  examples: string[];
}

export interface ReportInit {
  file: ImportReport['file'];
  generator: ImportReport['generator'];
  counts: ImportReport['counts'];
  viewBox: ImportReport['viewBox'];
  optimize: ImportReport['optimize'];
  match?: ImportReport['match'];
}

/** Tên tệp của đường dẫn (cắt thư mục; `file:///` và `\` đều được); giải %-mã hóa nếu hợp lệ. */
export function fileNameOf(path: string): string {
  let cut = -1;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === 47 || c === 92) cut = i;
  }
  const name = path.slice(cut + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export class ReportBuilder {
  private rem = new Map<string, RemovedEntry>();
  private conv = new Map<string, { what: string; code: string; note: string; count: number }>();
  private warns = new Map<string, { code: string; message: string; count: number }>();
  private fontUsed = new Set<string>();
  private fontMapped = new Map<string, string>();
  private fontFallback = new Set<string>();

  removed(kind: RemovedKind, code: string, name: string, example?: string, count = 1): void {
    const key = code + '\u0000' + name;
    let e = this.rem.get(key);
    if (!e) {
      e = { kind, name, code, count: 0, examples: [] };
      this.rem.set(key, e);
    }
    e.count += count;
    if (example !== undefined && e.examples.length < MAX_EXAMPLES && !e.examples.includes(example))
      e.examples.push(example);
  }

  converted(code: string, what: string, note = '', count = 1): void {
    const key = code + '\u0000' + what;
    const e = this.conv.get(key);
    if (e) e.count += count;
    else this.conv.set(key, { what, code, note, count });
  }

  warn(code: string, message = '', count = 1): void {
    const e = this.warns.get(code);
    if (e) e.count += count;
    else this.warns.set(code, { code, message: message || viMessage(code), count });
  }

  font(used: string, mappedTo?: string, fallback = false): void {
    this.fontUsed.add(used);
    if (mappedTo !== undefined && mappedTo !== used) this.fontMapped.set(used, mappedTo);
    if (fallback) this.fontFallback.add(used);
  }

  /** Mọi mã đã ghi (loại bỏ, chuyển đổi, cảnh báo). */
  codes(): Set<string> {
    const s = new Set<string>();
    for (const e of this.rem.values()) s.add(e.code);
    for (const e of this.conv.values()) s.add(e.code);
    for (const e of this.warns.values()) s.add(e.code);
    return s;
  }

  build(init: ReportInit): ImportReport {
    const removed = [...this.rem.values()]
      .sort((a, b) => cmp(a.code, b.code) || cmp(a.name, b.name))
      .map((e) => ({
        kind: e.kind,
        name: e.name,
        count: e.count,
        code: e.code,
        reason: viMessage(e.code),
        examples: e.examples,
      }));
    const converted = [...this.conv.values()]
      .sort((a, b) => cmp(a.code, b.code) || cmp(a.what, b.what))
      .map((e) => ({ what: e.what, count: e.count, code: e.code, note: e.note }));
    const warnings = [...this.warns.values()]
      .sort((a, b) => cmp(a.code, b.code))
      .map((e) => ({ code: e.code, count: e.count, message: e.message }));
    return {
      tool: TOOL_NAME,
      file: init.file,
      generator: init.generator,
      counts: init.counts,
      viewBox: init.viewBox,
      removed,
      converted,
      warnings,
      optimize: init.optimize,
      fonts: {
        used: [...this.fontUsed].sort(cmp),
        mapped: [...this.fontMapped]
          .sort((a, b) => cmp(a[0], b[0]))
          .map(([from, to]) => ({ from, to })),
        fallback: [...this.fontFallback].sort(cmp),
      },
      match: init.match ?? null,
    };
  }
}

const cell = (s: string): string => s.split('|').join('\\|').split('\n').join(' ');

/** Bản `.md` cho người đọc, sinh từ cùng dữ liệu với `.json`. */
export function reportToMarkdown(r: ImportReport): string {
  const L: string[] = [];
  L.push(`# Báo cáo nhập SVG: ${r.file.name}`, '');
  L.push(`- Công cụ: ${r.tool}`);
  L.push(`- Kích thước: ${r.file.bytes} byte, SHA-256 ${r.file.sha256}`);
  L.push(`- Phần mềm nhận diện: ${r.generator.name} (${r.generator.certainty})`);
  if (r.generator.evidence.length > 0)
    L.push(`- Dấu hiệu: ${r.generator.evidence.map(cell).join('; ')}`);
  L.push(`- viewBox: ${r.viewBox ? r.viewBox.join(' ') : 'không có'}`);
  L.push(
    `- Phần tử: ${r.counts.elementsBefore} trước, ${r.counts.elementsAfter} sau; độ sâu ${r.counts.depth}; UID đã gán ${r.counts.uidAssigned}; có tên ${r.counts.named}`,
  );
  L.push(
    `- Tối ưu: ${r.optimize.enabled ? `bật, gộp ${r.optimize.merged} nhóm, bớt ${r.optimize.elementsSaved} phần tử` : 'tắt'}`,
  );
  L.push('');
  L.push('## Đã loại', '');
  if (r.removed.length === 0) L.push('Không có.', '');
  else {
    L.push('| Mã | Loại | Tên | Số lần | Lý do | Ví dụ |', '| --- | --- | --- | --- | --- | --- |');
    for (const e of r.removed)
      L.push(
        `| ${e.code} | ${e.kind} | ${cell(e.name)} | ${e.count} | ${cell(e.reason)} | ${cell(e.examples.join(', '))} |`,
      );
    L.push('');
  }
  L.push('## Đã chuyển đổi', '');
  if (r.converted.length === 0) L.push('Không có.', '');
  else {
    L.push('| Mã | Nội dung | Số lần | Ghi chú |', '| --- | --- | --- | --- |');
    for (const e of r.converted)
      L.push(`| ${e.code} | ${cell(e.what)} | ${e.count} | ${cell(e.note || viMessage(e.code))} |`);
    L.push('');
  }
  L.push('## Cảnh báo', '');
  if (r.warnings.length === 0) L.push('Không có.', '');
  else {
    L.push('| Mã | Số lần | Thông báo |', '| --- | --- | --- |');
    for (const e of r.warnings) L.push(`| ${e.code} | ${e.count} | ${cell(e.message)} |`);
    L.push('');
  }
  L.push('## Font', '');
  L.push(`- Đã dùng: ${r.fonts.used.map(cell).join(', ') || 'không'}`);
  L.push(
    `- Đã đổi: ${r.fonts.mapped.map((m) => `${cell(m.from)} -> ${cell(m.to)}`).join('; ') || 'không'}`,
  );
  L.push(`- Dự phòng sans-serif: ${r.fonts.fallback.map(cell).join(', ') || 'không'}`);
  L.push('');
  return L.join('\n');
}

// --- SHA-256 đồng bộ (importSvg thuần, không dùng crypto.subtle bất đồng bộ) ---------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(data: Uint8Array): string {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = data.length;
  const total = (((len + 9 + 63) >> 6) << 6) >>> 0;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(len / 0x20000000), false);
  dv.setUint32(total - 4, (len << 3) >>> 0, false);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]; // prettier-ignore
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0; // prettier-ignore
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh; // prettier-ignore
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += h[i].toString(16).padStart(8, '0');
  return out;
}
