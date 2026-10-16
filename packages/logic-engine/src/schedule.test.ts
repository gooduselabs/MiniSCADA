// Lịch (T126; FR-089; contracts/logic-engine.md §7): ≥ 40 ca: nửa mở [from, to), qua nửa đêm thuộc ngày bắt đầu,
// ngoại lệ, tzOffsetMin của khối và của thiết bị, timeSynced, ngày nhuận, đổi năm. 2026-10-19 là thứ Hai.
import { describe, expect, it } from 'vitest';
import { LogicEngine } from './engine.ts';
import type { LogicSchedule } from '@mat/project-schema';

type Want = boolean | 'BAD';
const DAY = { days: [1, 2, 3, 4, 5], from: '06:00', to: '18:00' };
const NIGHT = { days: [1], from: '22:00', to: '06:00' };
const ALL = [1, 2, 3, 4, 5, 6, 7];

function outAt(s: Partial<LogicSchedule>, wall: string | null, synced = true, tz = 420): Want {
  const e = new LogicEngine(
    { schemaVersion: '1.0.0', schedules: [{ id: 's', weekly: [DAY], out: 'L.S', ...s }] },
    { tags: {}, config: { tzOffsetMin: tz } },
  );
  e.step(0, () => ({ value: null, quality: 'BAD' }), {
    epochMs: wall === null ? null : Date.parse(wall),
    synced,
  });
  const o = e.output('L.S')!;
  if (o.quality !== 'GOOD') {
    expect(o.reason).toBe('TIME_NOT_SYNCED');
    return 'BAD';
  }
  return o.value as boolean;
}

const CASES: Array<[string, Partial<LogicSchedule>, string | null, Want, boolean?, number?]> = [
  ['thứ Hai 05:59 trước khung', {}, '2026-10-19T05:59:00+07:00', false],
  ['thứ Hai 06:00 biên đầu (đóng)', {}, '2026-10-19T06:00:00+07:00', true],
  ['thứ Hai 06:00:59', {}, '2026-10-19T06:00:59+07:00', true],
  ['thứ Hai 12:00', {}, '2026-10-19T12:00:00+07:00', true],
  ['thứ Hai 17:59:59 trước biên cuối', {}, '2026-10-19T17:59:59+07:00', true],
  ['thứ Hai 18:00 biên cuối (mở)', {}, '2026-10-19T18:00:00+07:00', false],
  ['thứ Sáu 10:00', {}, '2026-10-23T10:00:00+07:00', true],
  ['thứ Bảy 10:00 ngoài ngày', {}, '2026-10-24T10:00:00+07:00', false],
  ['Chủ nhật 10:00 ngoài ngày', {}, '2026-10-25T10:00:00+07:00', false],
  [
    'giờ UTC khác ngày địa phương (thứ Hai 06:30 +07 = Chủ nhật 23:30 UTC)',
    {},
    '2026-10-18T23:30:00Z',
    true,
  ],
  ['qua nửa đêm: thứ Hai 22:00', { weekly: [NIGHT] }, '2026-10-19T22:00:00+07:00', true],
  ['qua nửa đêm: thứ Hai 21:59', { weekly: [NIGHT] }, '2026-10-19T21:59:00+07:00', false],
  ['qua nửa đêm: thứ Hai 23:59', { weekly: [NIGHT] }, '2026-10-19T23:59:00+07:00', true],
  [
    'qua nửa đêm: thứ Ba 00:00 (đuôi của thứ Hai)',
    { weekly: [NIGHT] },
    '2026-10-20T00:00:00+07:00',
    true,
  ],
  ['qua nửa đêm: thứ Ba 05:59', { weekly: [NIGHT] }, '2026-10-20T05:59:00+07:00', true],
  ['qua nửa đêm: thứ Ba 06:00 (mở)', { weekly: [NIGHT] }, '2026-10-20T06:00:00+07:00', false],
  [
    'qua nửa đêm: thứ Ba 22:00 (thứ Ba không có khung)',
    { weekly: [NIGHT] },
    '2026-10-20T22:00:00+07:00',
    false,
  ],
  [
    'qua nửa đêm: thứ Hai 03:00 (đuôi của Chủ nhật, Chủ nhật không có)',
    { weekly: [NIGHT] },
    '2026-10-19T03:00:00+07:00',
    false,
  ],
  [
    'qua nửa đêm Chủ nhật → thứ Hai 01:00',
    { weekly: [{ days: [7], from: '23:00', to: '02:00' }] },
    '2026-10-19T01:00:00+07:00',
    true,
  ],
  [
    'qua nửa đêm Chủ nhật → thứ Hai 02:00 (mở)',
    { weekly: [{ days: [7], from: '23:00', to: '02:00' }] },
    '2026-10-19T02:00:00+07:00',
    false,
  ],
  [
    'khung 00:00–00:01: 00:00',
    { weekly: [{ days: ALL, from: '00:00', to: '00:01' }] },
    '2026-10-21T00:00:00+07:00',
    true,
  ],
  [
    'khung 00:00–00:01: 00:00:59',
    { weekly: [{ days: ALL, from: '00:00', to: '00:01' }] },
    '2026-10-21T00:00:59+07:00',
    true,
  ],
  [
    'khung 00:00–00:01: 00:01',
    { weekly: [{ days: ALL, from: '00:00', to: '00:01' }] },
    '2026-10-21T00:01:00+07:00',
    false,
  ],
  [
    'khung 23:59–00:00: 23:59 (to = 00:00 là qua nửa đêm)',
    { weekly: [{ days: [1], from: '23:59', to: '00:00' }] },
    '2026-10-19T23:59:30+07:00',
    true,
  ],
  [
    'khung 23:59–00:00: thứ Ba 00:00 (mở)',
    { weekly: [{ days: [1], from: '23:59', to: '00:00' }] },
    '2026-10-20T00:00:00+07:00',
    false,
  ],
  [
    'hai khung: khoảng giữa',
    {
      weekly: [
        { days: [1], from: '08:00', to: '11:00' },
        { days: [1], from: '13:00', to: '17:00' },
      ],
    },
    '2026-10-19T12:00:00+07:00',
    false,
  ],
  [
    'hai khung: khung sau',
    {
      weekly: [
        { days: [1], from: '08:00', to: '11:00' },
        { days: [1], from: '13:00', to: '17:00' },
      ],
    },
    '2026-10-19T13:00:00+07:00',
    true,
  ],
  [
    'khung chồng nhau',
    {
      weekly: [
        { days: [1], from: '08:00', to: '12:00' },
        { days: [1], from: '10:00', to: '14:00' },
      ],
    },
    '2026-10-19T13:00:00+07:00',
    true,
  ],
  ['không khung: luôn tắt', { weekly: [] }, '2026-10-19T12:00:00+07:00', false],
  [
    'ngoại lệ off đè khung',
    { exceptions: [{ date: '2026-12-25', mode: 'off' }] },
    '2026-12-25T10:00:00+07:00',
    false,
  ],
  [
    'ngoại lệ off ngày khác không ảnh hưởng',
    { exceptions: [{ date: '2026-12-25', mode: 'off' }] },
    '2026-12-24T10:00:00+07:00',
    true,
  ],
  [
    'ngoại lệ on: thứ Bảy cả ngày bật (00:00)',
    { exceptions: [{ date: '2026-10-24', mode: 'on' }] },
    '2026-10-24T00:00:00+07:00',
    true,
  ],
  [
    'ngoại lệ on: 23:59 cùng ngày',
    { exceptions: [{ date: '2026-10-24', mode: 'on' }] },
    '2026-10-24T23:59:59+07:00',
    true,
  ],
  [
    'ngoại lệ on: hết ngày',
    { exceptions: [{ date: '2026-10-24', mode: 'on' }] },
    '2026-10-25T00:00:00+07:00',
    false,
  ],
  [
    'ngoại lệ theo ngày địa phương, không theo UTC',
    { exceptions: [{ date: '2026-12-25', mode: 'off' }] },
    '2026-12-24T23:30:00Z',
    false,
  ],
  [
    'ngoại lệ off của thứ Hai hủy đuôi qua nửa đêm sang thứ Ba',
    { weekly: [NIGHT], exceptions: [{ date: '2026-10-19', mode: 'off' }] },
    '2026-10-20T02:00:00+07:00',
    false,
  ],
  [
    'ngoại lệ on của thứ Ba đè cả ngày thứ Ba',
    { weekly: [NIGHT], exceptions: [{ date: '2026-10-20', mode: 'on' }] },
    '2026-10-20T12:00:00+07:00',
    true,
  ],
  ['tzOffsetMin của khối (0) thay cho thiết bị', { tzOffsetMin: 0 }, '2026-10-19T05:30:00Z', false],
  ['tzOffsetMin của khối (0): 06:00 UTC', { tzOffsetMin: 0 }, '2026-10-19T06:00:00Z', true],
  ['tzOffsetMin null dùng của thiết bị', { tzOffsetMin: null }, '2026-10-19T06:00:00+07:00', true],
  ['tzOffsetMin âm (-300)', { tzOffsetMin: -300 }, '2026-10-19T11:00:00Z', true],
  ['tzOffsetMin âm (-300): 10:59 UTC', { tzOffsetMin: -300 }, '2026-10-19T10:59:00Z', false],
  ['tzOffsetMin của thiết bị 0', {}, '2026-10-19T06:00:00Z', true, true, 0],
  ['tzOffsetMin 345 (lẻ phút)', { tzOffsetMin: 345 }, '2026-10-19T00:15:00Z', true],
  ['tzOffsetMin 345: 00:14 UTC', { tzOffsetMin: 345 }, '2026-10-19T00:14:00Z', false],
  [
    'ngày nhuận 2028-02-29 là thứ Ba',
    { weekly: [{ days: [2], from: '00:00', to: '23:59' }] },
    '2028-02-29T12:00:00+07:00',
    true,
  ],
  [
    'ngoại lệ ngày nhuận',
    { exceptions: [{ date: '2028-02-29', mode: 'off' }] },
    '2028-02-29T12:00:00+07:00',
    false,
  ],
  [
    'đổi năm: 2027-01-01 là thứ Sáu',
    { weekly: [{ days: [5], from: '00:00', to: '01:00' }] },
    '2027-01-01T00:30:00+07:00',
    true,
  ],
  [
    'đổi năm: qua nửa đêm 31/12 thứ Năm',
    { weekly: [{ days: [4], from: '23:00', to: '01:00' }] },
    '2027-01-01T00:30:00+07:00',
    true,
  ],
  [
    'năm 2100 không nhuận: 2100-03-01 là thứ Hai',
    { weekly: [{ days: [1], from: '00:00', to: '23:59' }] },
    '2100-03-01T12:00:00+07:00',
    true,
  ],
  ['timeSynced = false ⇒ BAD', {}, '2026-10-19T12:00:00+07:00', 'BAD', false],
  ['không có giờ thực ⇒ BAD', {}, null, 'BAD'],
];

describe('schedule', () => {
  it('đủ ≥ 40 ca', () => expect(CASES.length).toBeGreaterThanOrEqual(40));
  for (const [name, s, wall, want, synced, tz] of CASES)
    it(name, () => expect(outAt(s, wall, synced ?? true, tz ?? 420)).toBe(want));

  it('đầu ra cập nhật tại biên (độ phân giải một quét) và trở lại GOOD khi đồng bộ', () => {
    const e = new LogicEngine(
      { schemaVersion: '1.0.0', schedules: [{ id: 's', weekly: [DAY], out: 'L.S' }] },
      { tags: {} },
    );
    const base = Date.parse('2026-10-19T05:59:59.900+07:00');
    const read = () => ({ value: null, quality: 'BAD' as const });
    e.step(0, read, { epochMs: base, synced: true });
    expect(e.output('L.S')!.value).toBe(false);
    e.step(100, read, { epochMs: base + 100, synced: true });
    expect(e.output('L.S')!.value).toBe(true);
    e.step(200, read, { epochMs: base + 200, synced: false });
    expect(e.output('L.S')!.quality).toBe('BAD');
    e.step(300, read, { epochMs: base + 300, synced: true });
    expect(e.output('L.S')).toEqual({ value: true, quality: 'GOOD' });
  });
});
