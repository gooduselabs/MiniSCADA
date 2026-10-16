// T116 (khung Ước tính): mô hình hiển thị của khung Ước tính ghi: dùng đúng estimateLogging (không công thức riêng),
// mức xanh/vàng/cam/đỏ, nhãn cơ sở, "chưa tính n Tag", gợi ý theo cảnh báo, ≤ 100 ms với 32 nhóm × 200 Tag.
import {
  estimateLogging,
  LOG_BUDGET_BYTES,
  type LoggingConfig,
  type TagDataType,
} from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { estimateView, levelOf } from './estimate-view.ts';

const T = (n: number): Map<string, TagDataType> =>
  new Map(Array.from({ length: n }, (_, i) => [`T${i}`, 'FLOAT32' as TagDataType]));

function cfgOf(groups: LoggingConfig['groups']): LoggingConfig {
  return { schemaVersion: '0.6.0', groups, connections: [] };
}
const cyc = (
  id: string,
  n: number,
  periodMs: number,
  extra: object = {},
): LoggingConfig['groups'][number] => ({
  id,
  name: id,
  mode: 'cyclic',
  periodMs,
  retentionDays: 30,
  tags: Array.from({ length: n }, (_, i) => ({ tagId: `T${i}` })),
  ...extra,
});

describe('levelOf', () => {
  const GB = LOG_BUDGET_BYTES;
  it('ranh giới 50 %, 100 %, 400 %', () => {
    expect(levelOf(0)).toBe('ok');
    expect(levelOf(GB * 0.49)).toBe('ok');
    expect(levelOf(GB * 0.5)).toBe('warn');
    expect(levelOf(GB)).toBe('warn');
    expect(levelOf(GB + 1)).toBe('hot');
    expect(levelOf(GB * 4)).toBe('hot');
    expect(levelOf(GB * 4 + 1)).toBe('extreme');
  });
});

describe('estimateView', () => {
  it('con số lấy đúng từ estimateLogging', () => {
    const cfg = cfgOf([cyc('a', 10, 1000), cyc('b', 4, 60000, { aggregates: {} })]);
    const types = T(10);
    const v = estimateView(cfg, types);
    expect(v.state).toBe('ok');
    if (v.state !== 'ok') return;
    const e = estimateLogging(cfg, types);
    expect(v.estimate).toEqual(e);
    expect(v.bytesPerDay).toBe(e.writeBytesPerDay);
    expect(v.percent).toBeCloseTo((e.writeBytesPerDay / LOG_BUDGET_BYTES) * 100, 9);
    expect(v.groups.map((g) => g.id)).toEqual(['a', 'b']);
    expect(v.groups[1]!.aggBytes).toBe(e.groups[1]!.aggWrite);
    expect(v.groups[0]!.totalBytes).toBe(e.groups[0]!.rawWrite + e.groups[0]!.aggWrite);
    expect(v.daysToFillCap).toBe(e.daysToFillCap);
    expect(v.storagePercent).toBeCloseTo((e.storageBytes / LOG_BUDGET_BYTES) * 100, 9);
  });

  it('mức theo số ước tính và nhãn cơ sở mỗi nhóm (chính xác/theo dự kiến/cận trên)', () => {
    const cfg = cfgOf([
      cyc('exact', 3, 5000),
      {
        id: 'exp',
        name: 'exp',
        mode: 'onChange',
        minIntervalMs: 1000,
        expectedRowsPerDay: 1000,
        retentionDays: 30,
        tags: [{ tagId: 'T0' }],
      },
      {
        id: 'upper',
        name: 'upper',
        mode: 'onChange',
        minIntervalMs: 1000,
        retentionDays: 30,
        tags: [{ tagId: 'T0' }],
      },
    ]);
    const v = estimateView(cfg, T(3));
    if (v.state !== 'ok') throw new Error('state');
    expect(v.groups.map((g) => g.basis)).toEqual(['exact', 'expected', 'upper']);
    expect(v.level).toBe(levelOf(v.bytesPerDay));
  });

  it('Tag chưa biết kiểu: "chưa tính n Tag" (đếm Tag không có trong danh sách kiểu)', () => {
    const cfg = cfgOf([cyc('a', 5, 1000)]);
    const types = new Map<string, TagDataType>([
      ['T0', 'FLOAT32'],
      ['T1', 'FLOAT32'],
    ]);
    const v = estimateView(cfg, types);
    if (v.state !== 'ok') throw new Error('state');
    expect(v.unknownTags).toBe(3);
  });

  it('chưa có danh sách Tag hoặc file lỗi: trạng thái noTags / blocked, không ném', () => {
    expect(estimateView(cfgOf([cyc('a', 1, 1000)]), null).state).toBe('noTags');
    expect(estimateView(null, T(1)).state).toBe('blocked');
    expect(estimateView({ schemaVersion: '0.6.0', groups: 'x' } as never, T(1)).state).toBe(
      'blocked',
    );
  });

  it('cảnh báo nêu nhóm đóng góp lớn nhất và gợi ý phù hợp', () => {
    const cfg = cfgOf([
      cyc('nho', 2, 60000),
      {
        id: 'lon',
        name: 'Lớn',
        mode: 'onChange',
        minIntervalMs: 100,
        retentionDays: 30,
        tags: Array.from({ length: 200 }, (_, i) => ({ tagId: `T${i}` })),
      },
    ]);
    const v = estimateView(cfg, T(200));
    if (v.state !== 'ok') throw new Error('state');
    expect(v.warnings).toContain('W_LOG_WRITE_BUDGET');
    expect(v.topGroup?.id).toBe('lon');
    expect(v.suggestions).toEqual(
      expect.arrayContaining(['raiseInterval', 'useCombined', 'fewerTags', 'setExpected']),
    );
  });

  it('không cảnh báo: không gợi ý', () => {
    const v = estimateView(cfgOf([cyc('a', 2, 60000)]), T(2));
    if (v.state !== 'ok') throw new Error('state');
    expect(v.warnings).toEqual([]);
    expect(v.suggestions).toEqual([]);
    expect(v.level).toBe('ok');
  });

  it('nhóm Chu kỳ không gợi ý "dùng Kết hợp" hay "đặt dòng/ngày dự kiến"', () => {
    const v = estimateView(cfgOf([cyc('a', 200, 100)]), T(200));
    if (v.state !== 'ok') throw new Error('state');
    expect(v.warnings.length).toBeGreaterThan(0);
    expect(v.suggestions).toContain('raiseInterval');
    expect(v.suggestions).not.toContain('useCombined');
    expect(v.suggestions).not.toContain('setExpected');
  });

  it('cực lớn (> 8 GiB/ngày) báo mức extreme và cảnh báo W_LOG_WRITE_EXTREME', () => {
    const groups = Array.from({ length: 8 }, (_, i) => cyc(`g${i}`, 200, 100));
    const v = estimateView(cfgOf(groups), T(200));
    if (v.state !== 'ok') throw new Error('state');
    expect(v.level).toBe('extreme');
    expect(v.warnings).toContain('W_LOG_WRITE_EXTREME');
  });

  it('SC-019: 32 nhóm × 200 Tag tính ≤ 100 ms', () => {
    const groups = Array.from({ length: 32 }, (_, i) =>
      cyc(`g${i}`, 200, 1000 + i, { aggregates: {} }),
    );
    const types = T(200);
    const cfg = cfgOf(groups);
    estimateView(cfg, types); // khởi động
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) estimateView(cfg, types);
    const per = (performance.now() - t0) / 5;
    expect(per).toBeLessThan(100);
  });
});
