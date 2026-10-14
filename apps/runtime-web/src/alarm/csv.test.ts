// Xuất CSV an toàn (feature 009, FR-061; SC-020; US4 kịch bản 3, 4; contracts/ui-alarm.md §12.1).
import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  CSV_HEADER,
  CsvCancelled,
  csvFileName,
  csvLine,
  csvString,
  exportHistoryCsv,
  historyRowCells,
  isoWithOffset,
  neutralizeFormula,
  type HistoryItem,
} from './csv.ts';

const item = (over: Partial<HistoryItem> = {}): HistoryItem => ({
  id: 4412,
  alarmId: 'TANK_B1_LEVEL.HH',
  name: 'Mức bồn B1',
  class: 'critical',
  priority: 'critical',
  area: 'bon',
  text: 'Mức bồn B1 rất cao: 91,2 % (ngưỡng 90)',
  valueActive: 91.2,
  qualityActive: 'GOOD',
  reason: null,
  tsActive: Date.UTC(2026, 9, 12, 19, 10, 3),
  clockOk: true,
  tsAck: Date.UTC(2026, 9, 12, 19, 10, 30),
  ackUser: 'vanhanh1',
  tsReturn: Date.UTC(2026, 9, 12, 19, 20, 0),
  tsReturnAck: null,
  returnAckUser: null,
  flags: { startup: false, inputBad: false },
  closedBy: 'return',
  state: 'closed',
  ...over,
});
const names = {
  area: (id: string | null) => (id === 'bon' ? 'Bồn' : (id ?? 'Chung')),
  cls: (id: string) => (id === 'critical' ? 'Khẩn cấp' : id),
};

describe('quy tắc chống công thức (SC-020)', () => {
  const danger = [
    '=1+1',
    '=HYPERLINK("http://x","y")',
    '+1',
    '+cmd|" /C calc"!A0',
    '-2+3',
    '-1',
    '@SUM(A1)',
    '\t=1',
    '\r=1',
    '\t',
    '\r\n=1',
    ' =1',
    '  +1',
    '﻿=1',
    '​=1',
    '‎@x',
    '‮=1',
    '⁠-1',
    '\u0001=1',
    '\u0007+1',
    ' \t =x',
    ' =1',
    '=',
    '+',
    '-',
    '@',
    "=cmd|' /C calc'!A0",
    '=-1',
    '-@x',
    '+=1',
    '＝1'.replace('＝', '='),
    '=1\n=2',
    '@=1',
  ];
  it(`bộ mẫu ${danger.length} (≥ 30) chuỗi nguy hiểm đều được thêm ' ở đầu`, () => {
    expect(danger.length).toBeGreaterThanOrEqual(30);
    for (const s of danger) {
      const out = neutralizeFormula(s);
      expect(out.startsWith("'"), JSON.stringify(s)).toBe(true);
      expect(out.slice(1)).toBe(s);
    }
  });
  const safe = [
    'Bơm 1',
    '',
    'a=1',
    'a+b',
    '1-2',
    'x@y',
    "'=1",
    ' Bơm',
    '91,2',
    '(=1)',
    '50%',
    'ĐÈN',
    '日本',
  ];
  it('chuỗi an toàn giữ nguyên', () => {
    for (const s of safe) expect(neutralizeFormula(s), JSON.stringify(s)).toBe(s);
  });
  it('sau neutralize, ô chuỗi được đặt trong nháy kép: ô bắt đầu bằng "\'" không còn là công thức', () => {
    expect(csvString('=1+1')).toBe(`"'=1+1"`);
  });
  it('số âm là kiểu number: KHÔNG thêm dấu nháy; chuỗi "-5" (kiểu string) thì có', () => {
    const cells = historyRowCells(item({ valueActive: -5.2 }), names);
    expect(cells[7]).toBe('-5.2');
    const s = historyRowCells(item({ valueActive: '-5' }), names);
    expect(s[7]).toBe(`"'-5"`);
  });
  it('mọi ô chuỗi của một dòng có nội dung nguy hiểm đều được vô hiệu', () => {
    const e = '=HYPERLINK("http://evil","x")';
    const cells = historyRowCells(
      item({
        alarmId: e,
        name: e,
        text: e,
        ackUser: e,
        returnAckUser: e,
        reason: e,
        valueActive: e,
        class: e,
        area: e,
      }),
      { area: (id) => id ?? '', cls: (id) => id },
    );
    for (const i of [1, 2, 3, 4, 6, 7, 9, 12, 15])
      expect(cells[i]!.startsWith(`"'=`), `cột ${i}`).toBe(true);
  });
});

describe('RFC 4180', () => {
  it('nháy kép nhân đôi, dấu phẩy và xuống dòng giữ trong ô được trích dẫn', () => {
    expect(csvString('a "b", c\r\nd')).toBe('"a ""b"", c\r\nd"');
    expect(csvString('')).toBe('""');
  });
  it('dòng ghép bằng dấu phẩy, kết thúc CRLF', () => {
    expect(csvLine(['1', '"a"', ''])).toBe('1,"a",\r\n');
  });
  it('dòng dữ liệu có 20 ô khớp tiêu đề; giá trị bool không nháy; số không nháy', () => {
    const cells = historyRowCells(item({ valueActive: true }), names);
    expect(cells).toHaveLength(20);
    expect(CSV_HEADER).toHaveLength(20);
    expect(cells[0]).toBe('4412');
    expect(cells[7]).toBe('true');
    expect(cells[16]).toBe('597'); // 20:00 − 19:10:03 = 597 s
  });
  it('tiêu đề tiếng Việt đúng thứ tự', () => {
    expect(CSV_HEADER[0]).toBe('Mã lần xảy ra');
    expect(CSV_HEADER[10]).toBe('Bật lúc');
    expect(CSV_HEADER[16]).toBe('Thời lượng (giây)');
    expect(CSV_HEADER[19]).toBe('Sau khởi động');
  });
  it('tên khu vực, lớp, mức ưu tiên bằng chữ; khu vực trống là "Chung"', () => {
    const c = historyRowCells(item({ area: null }), names);
    expect(c[3]).toBe('"Chung"');
    expect(c[4]).toBe('"Khẩn cấp"');
    expect(c[5]).toBe('"Khẩn cấp"');
  });
  it('trạng thái: Đang có, Đã hết, Đóng do đổi cấu hình, vô hiệu, khởi động lại', () => {
    const st = (over: Partial<HistoryItem>) => historyRowCells(item(over), names)[17];
    expect(st({ state: 'active', closedBy: null, tsReturn: null })).toBe('"Đang có"');
    expect(st({})).toBe('"Đã hết"');
    expect(st({ closedBy: 'config', tsReturn: null })).toBe('"Đóng do đổi cấu hình"');
    expect(st({ closedBy: 'disabled', tsReturn: null })).toBe('"Đóng do vô hiệu"');
    expect(st({ closedBy: 'restart-lost', tsReturn: null })).toBe('"Đóng do khởi động lại"');
  });
  it('thời lượng trống khi chưa hết; cờ clockOk và startup', () => {
    const c = historyRowCells(
      item({
        tsReturn: null,
        clockOk: false,
        flags: { startup: true, inputBad: false },
        state: 'active',
        closedBy: null,
      }),
      names,
    );
    expect(c[16]).toBe('');
    expect(c[18]).toBe('"Có"');
    expect(c[19]).toBe('"Có"');
    const d = historyRowCells(item(), names);
    expect(d[18]).toBe('""');
  });
});

describe('thời gian ISO 8601 có độ lệch', () => {
  it('khớp múi giờ trình duyệt', () => {
    const ms = Date.UTC(2026, 9, 12, 19, 10, 3, 45);
    const s = isoWithOffset(ms);
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(new Date(s).getTime()).toBe(ms);
  });
  it('tên tệp alarm-history-<từ>-<đến>.csv dạng yyyyMMddTHHmm giờ trình duyệt', () => {
    const from = new Date(2026, 9, 12, 8, 5).getTime();
    const to = new Date(2026, 9, 13, 8, 5).getTime();
    expect(csvFileName(from, to)).toBe('alarm-history-20261012T0805-20261013T0805.csv');
  });
});

const page = (from: number, n: number, hasMore: boolean) => ({
  items: Array.from({ length: n }, (_, i) => item({ id: from - i, text: `dòng ${from - i}` })),
  hasMore,
  nextBeforeId: hasMore ? from - n + 1 : null,
});

describe('exportHistoryCsv', () => {
  const run = async (total: number, opt: Partial<Parameters<typeof exportHistoryCsv>[0]> = {}) => {
    const calls: Array<number | undefined> = [];
    const progress: number[] = [];
    const r = await exportHistoryCsv({
      names,
      fetchPage: (beforeId) => {
        calls.push(beforeId);
        const done = calls.length * 500 - 500;
        const left = total - done;
        const n = Math.min(500, left);
        return Promise.resolve(page(total - done, n, left > n));
      },
      onProgress: (n) => progress.push(n),
      ...opt,
    });
    return { r, calls, progress };
  };
  const text = (b: Blob) => b.text();

  it('BOM UTF-8 ở đầu, tiêu đề, CRLF, kiểu text/csv;charset=utf-8', async () => {
    const { r } = await run(3);
    expect(r.blob.type).toBe('text/csv;charset=utf-8');
    const t = await text(r.blob);
    const bytes = new Uint8Array(await r.blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(CSV_BOM).toBe('﻿');
    const lines = t.replace('﻿', '').split('\r\n');
    expect(lines[0]).toBe(CSV_HEADER.map((h) => `"${h}"`).join(','));
    expect(lines).toHaveLength(1 + 3 + 1); // tiêu đề + 3 dòng + phần rỗng sau CRLF cuối
    expect(r.rows).toBe(3);
    expect(r.truncated).toBe(false);
  });
  it('lấy lần lượt trang 500 dòng bằng beforeId; báo tiến độ', async () => {
    const { r, calls, progress } = await run(1200);
    expect(calls).toEqual([undefined, 701, 201]);
    expect(progress).toEqual([500, 1000, 1200]);
    expect(r.rows).toBe(1200);
  });
  it('cắt ở 100.000 dòng, đánh dấu truncated, không lấy thêm trang', async () => {
    const { r, calls } = await run(150_000);
    expect(r.rows).toBe(100_000);
    expect(r.truncated).toBe(true);
    expect(calls).toHaveLength(200);
    const t = await text(r.blob);
    expect(t.split('\r\n')).toHaveLength(100_000 + 2);
  }, 60_000);
  it('50.000 dòng ≤ 10 s (SC-013)', async () => {
    const t0 = Date.now();
    const { r } = await run(50_000);
    expect(r.rows).toBe(50_000);
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 30_000);
  it('hủy giữa chừng: ném CsvCancelled, không có blob', async () => {
    const ac = new AbortController();
    const p = exportHistoryCsv({
      names,
      signal: ac.signal,
      fetchPage: (b) => {
        if (b !== undefined) ac.abort();
        return Promise.resolve(page(1000, 500, true));
      },
    });
    await expect(p).rejects.toBeInstanceOf(CsvCancelled);
  });
  it('lỗi tải trang truyền lên cho nơi gọi', async () => {
    await expect(
      exportHistoryCsv({ names, fetchPage: () => Promise.reject(new Error('mạng')) }),
    ).rejects.toThrow('mạng');
  });
  it('nội dung độc hại trong dữ liệu được vô hiệu trong tệp', async () => {
    const r = await exportHistoryCsv({
      names,
      fetchPage: () =>
        Promise.resolve({
          items: [item({ text: '=cmd|"/c calc"!A1', name: '+1' })],
          hasMore: false,
          nextBeforeId: null,
        }),
    });
    const t = await text(r.blob);
    expect(t).toContain(`"'=cmd|""/c calc""!A1"`);
    expect(t).toContain(`"'+1"`);
  });
});
