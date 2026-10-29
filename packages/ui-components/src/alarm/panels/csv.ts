// Xuất CSV lịch sử alarm ngay ở trình duyệt (feature 009, FR-061; SC-013, SC-020; contracts/ui-alarm.md §12.1, D22):
// không tốn CPU BL335. UTF-8 có BOM, dấu phẩy, CRLF, RFC 4180, thời gian ISO 8601 kèm độ lệch múi giờ.
//  - Chống công thức: ô CHUỖI có ký tự đầu (sau khi bỏ khoảng trắng, BOM, ký tự điều khiển/định dạng Unicode) là `=`, `+`,
//    `-`, `@`, tab hoặc CR được thêm `'` ở đầu TRƯỚC khi trích dẫn. Ô SỐ (kiểu number, ví dụ -5.2) không bị gắn dấu nháy.
//  - Xử lý theo khối: ghép Blob từng trang 500 dòng, không giữ toàn bộ chuỗi một lần; tối đa 100.000 dòng.
import { priorityLabel } from '../alarm-format.ts';
import type { AlarmPriority } from '../../host/types.ts';
import { alarmPanelVi as P } from '../../i18n/alarm-panel-vi.ts';

export const CSV_BOM = '﻿';
export const CSV_MAX_ROWS = 100_000;
export const CSV_PAGE_SIZE = 500;

/** Một lần xảy ra do `GET /api/v1/alarms/history` trả (device-api-1.3.md §2.2). */
export interface HistoryItem {
  id: number;
  alarmId: string;
  name: string;
  class: string;
  priority: AlarmPriority;
  area: string | null;
  text: string;
  valueActive: boolean | number | string | null;
  qualityActive: string;
  reason: string | null;
  tsActive: number;
  clockOk: boolean;
  tsAck: number | null;
  ackUser: string | null;
  tsReturn: number | null;
  tsReturnAck: number | null;
  returnAckUser: string | null;
  flags: { startup: boolean; inputBad: boolean };
  closedBy: 'return' | 'config' | 'disabled' | 'restart-lost' | null;
  state: 'active' | 'closed';
}

export interface HistoryResult {
  items: HistoryItem[];
  hasMore: boolean;
  nextBeforeId: number | null;
}

export const CSV_HEADER: readonly string[] = P.csv.header;

const DANGER = new Set(['=', '+', '-', '@', '\t', '\r']);
const SKIP = /^[\s\p{Cc}\p{Cf}]$/u;

/** Thêm `'` đầu ô chuỗi nếu ký tự có nghĩa đầu tiên thuộc tập nguy hiểm (Excel có thể bỏ khoảng trắng và ký tự điều khiển). */
export function neutralizeFormula(s: string): string {
  for (const ch of s) {
    if (DANGER.has(ch)) return `'${s}`;
    if (!SKIP.test(ch)) return s;
  }
  return s;
}

/** Ô chuỗi: vô hiệu công thức, nhân đôi nháy kép, đặt trong nháy kép. */
export function csvString(s: string): string {
  return `"${neutralizeFormula(s).replaceAll('"', '""')}"`;
}

export const csvLine = (cells: readonly string[]): string => `${cells.join(',')}\r\n`;

const p2 = (n: number): string => String(n).padStart(2, '0');

/** ISO 8601 theo múi giờ của trình duyệt, kèm độ lệch (`+07:00`). */
export function isoWithOffset(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T` +
    `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}` +
    `${off < 0 ? '-' : '+'}${p2(Math.floor(a / 60))}:${p2(a % 60)}`
  );
}

const stamp = (ms: number): string =>
  `${new Date(ms).getFullYear()}${p2(new Date(ms).getMonth() + 1)}${p2(new Date(ms).getDate())}T${p2(
    new Date(ms).getHours(),
  )}${p2(new Date(ms).getMinutes())}`;

export const csvFileName = (from: number, to: number): string =>
  `alarm-history-${stamp(from)}-${stamp(to)}.csv`;

export interface CsvNames {
  area: (id: string | null) => string;
  cls: (id: string) => string;
}

const num = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' : String(v);
const ts = (v: number | null | undefined): string =>
  v === null || v === undefined ? csvString('') : csvString(isoWithOffset(v));

function statusText(i: HistoryItem): string {
  const c = P.csv;
  if (i.closedBy === 'config') return c.statusConfig;
  if (i.closedBy === 'disabled') return c.statusDisabled;
  if (i.closedBy === 'restart-lost') return c.statusRestart;
  return i.state === 'active' || i.tsReturn === null ? c.statusActive : c.statusReturned;
}

/** 20 ô của một dòng theo bảng §12.1 (đã trích dẫn và vô hiệu công thức). */
export function historyRowCells(i: HistoryItem, n: CsvNames): string[] {
  const v = i.valueActive;
  const value =
    typeof v === 'number' && Number.isFinite(v)
      ? String(v)
      : typeof v === 'boolean'
        ? String(v)
        : v === null
          ? csvString('')
          : csvString(String(v));
  const dur =
    i.tsReturn !== null && Number.isFinite(i.tsReturn)
      ? Math.max(0, Math.round((i.tsReturn - i.tsActive) / 1000))
      : null;
  return [
    String(i.id),
    csvString(i.alarmId),
    csvString(i.name),
    csvString(n.area(i.area)),
    csvString(n.cls(i.class)),
    csvString(priorityLabel(i.priority)),
    csvString(i.text),
    value,
    csvString(i.qualityActive),
    csvString(i.reason ?? ''),
    ts(i.tsActive),
    ts(i.tsAck),
    csvString(i.ackUser ?? ''),
    ts(i.tsReturn),
    ts(i.tsReturnAck),
    csvString(i.returnAckUser ?? ''),
    num(dur),
    csvString(statusText(i)),
    csvString(i.clockOk ? '' : P.csv.yes),
    csvString(i.flags.startup ? P.csv.yes : ''),
  ];
}

export class CsvCancelled extends Error {
  constructor() {
    super(P.csv.cancelled);
    this.name = 'CsvCancelled';
  }
}

export interface ExportOptions {
  names: CsvNames;
  /** Lấy một trang (mới nhất trước); `beforeId` = nextBeforeId của trang trước. */
  fetchPage: (beforeId: number | undefined) => Promise<HistoryResult>;
  signal?: AbortSignal;
  onProgress?: (rows: number) => void;
  maxRows?: number;
}

export interface ExportResult {
  blob: Blob;
  rows: number;
  /** Đã cắt ở `maxRows` mà thiết bị còn dòng. */
  truncated: boolean;
}

/** Lấy lần lượt các trang rồi ghép Blob từng khối. Hủy thì ném `CsvCancelled`; lỗi tải trang truyền lên. */
export async function exportHistoryCsv(o: ExportOptions): Promise<ExportResult> {
  const max = o.maxRows ?? CSV_MAX_ROWS;
  const parts: string[] = [CSV_BOM + csvLine(CSV_HEADER.map((h) => `"${h}"`))];
  let rows = 0;
  let before: number | undefined;
  let truncated = false;
  for (;;) {
    if (o.signal?.aborted) throw new CsvCancelled();
    const page = await o.fetchPage(before);
    if (o.signal?.aborted) throw new CsvCancelled();
    const room = max - rows;
    const take = page.items.length > room ? page.items.slice(0, room) : page.items;
    let chunk = '';
    for (const it of take) chunk += csvLine(historyRowCells(it, o.names));
    if (chunk) parts.push(chunk);
    rows += take.length;
    o.onProgress?.(rows);
    if (take.length < page.items.length || (rows >= max && page.hasMore)) {
      truncated = true;
      break;
    }
    if (!page.hasMore || page.nextBeforeId === null) break;
    before = page.nextBeforeId;
  }
  return { blob: new Blob(parts, { type: 'text/csv;charset=utf-8' }), rows, truncated };
}

/** Tải `blob` bằng thẻ `<a download>`. */
export function downloadBlob(blob: Blob, filename: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
