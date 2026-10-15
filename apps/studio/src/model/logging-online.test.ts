// T118 (feature 010, US7, FR-047, FR-049; contracts/device-010.md §1, studio-010.md §1.2 và §4): số đo thực của thiết bị cho
// editor Lưu trữ. `measureOf` đọc `historian.io.bytesPerDay` và `groupsInfo[].rows24h` từ system/info; `applyMeasure` điền
// `expectedRowsPerDay` cho nhóm Thay đổi/Kết hợp/Kích hoạt bằng MỘT sửa đổi (hoàn tác được), bỏ nhóm chu kỳ; `historianLines`
// là phần tóm tắt lưu trữ của tab Thiết bị. Phần giao diện (cột Đo thực, nút Dùng số đo, phiên giả) ở cuối tệp.
import type { LoggingConfig } from '@mat/project-schema';
import { render } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { newHistoryApp, loggingOf } from '../ui/history-test-helpers.ts';
import { fakeDevice, toMonitoring } from '../ui/device-test-helpers.ts';
import { renderEditor } from '../ui/registry.ts';
import { cleanup, settled } from '../ui/test-helpers.ts';
import '../ui/editors/logging-editor.ts';
import type { DeviceInfo } from './device.ts';
import { applyMeasure, historianLines, measureOf } from './logging-online.ts';

afterEach(cleanup);

const INFO = (h: object): DeviceInfo => ({
  runtimeVersion: '0.9.0',
  project: { status: 'active', projectId: 'history-demo' },
  historian: { enabled: true, state: 'running', rowsWritten: 100, dbBytes: 1_000_000, dbMaxBytes: 2_147_483_648, ...h },
});

const FULL = {
  groupsInfo: [
    { id: 'ap-suat', mode: 'onChange', rows24h: 18234, triggerState: null, aggregates: true },
    { id: 'me-tron', mode: 'trigger', rows24h: 480.4, triggerState: 'inactive', aggregates: false },
    { id: 'dien', mode: 'cyclic', rows24h: 1440, triggerState: null, aggregates: true },
    { id: 'khac', mode: 'onChange', rows24h: 7 },
  ],
  io: { source: 'proc-self-io', bytesPerDay: 540_000_000, estimateBytesPerDay: 565_002_240, coverageS: 86400 },
  query: { enabled: true, served: 1234, rejectedBusy: 3, rejectedLimit: 1, timeouts: 0, errors: 0, p95Ms: 85 },
  aggregates: { enabled: true, groups: 2, rows: { minute: 288000, hour: 4800 }, backfill: { active: true, group: 'ap-suat', progress: 0.42 } },
};

describe('measureOf', () => {
  it('đọc bytesPerDay và rows24h theo id nhóm', () => {
    const m = measureOf(INFO(FULL));
    expect(m?.bytesPerDay).toBe(540_000_000);
    expect(m?.estimateBytesPerDay).toBe(565_002_240);
    expect(m?.rows24h.get('ap-suat')).toBe(18234);
    expect(m?.rows24h.size).toBe(4);
  });

  it('thiếu số đo (runtime cũ, chưa đủ 600 s, /proc/self/io không đọc được): null hoặc rỗng, không ném', () => {
    expect(measureOf(null)).toBeNull();
    expect(measureOf(INFO({}))).toBeNull();
    expect(measureOf({ ...INFO({}), historian: undefined })).toBeNull();
    const young = measureOf(INFO({ io: { source: 'proc-self-io', bytesPerDay: null, coverageS: 120 } }));
    expect(young).toBeNull();
    const rowsOnly = measureOf(INFO({ groupsInfo: [{ id: 'a', rows24h: 5 }, { id: 'b', rows24h: 'x' }, { id: 'c', rows24h: -1 }] }));
    expect([...rowsOnly!.rows24h.keys()]).toEqual(['a']);
    expect(rowsOnly!.bytesPerDay).toBeNull();
  });
});

describe('applyMeasure', () => {
  const cfg = (): LoggingConfig => ({
    schemaVersion: '0.6.0',
    groups: [
      { id: 'ap-suat', name: 'A', mode: 'onChange', minIntervalMs: 1000, maxIntervalMs: 60000, retentionDays: 30, tags: [] },
      { id: 'me-tron', name: 'M', mode: 'trigger', trigger: { tagId: 'X', edge: 'rising' }, expectedRowsPerDay: 720, retentionDays: 30, tags: [] },
      { id: 'dien', name: 'D', mode: 'cyclic', periodMs: 60000, retentionDays: 30, tags: [] },
      { id: 'van-hanh', name: 'V', mode: 'onChange', retentionDays: 30, tags: [] },
    ],
  });

  it('điền expectedRowsPerDay (làm tròn) cho nhóm Thay đổi/Kết hợp/Kích hoạt; bỏ nhóm chu kỳ và nhóm thiết bị không báo', () => {
    const r = applyMeasure(cfg(), measureOf(INFO(FULL))!);
    expect(r.changed).toBe(2);
    expect(r.cfg.groups.map((g) => g.expectedRowsPerDay)).toEqual([18234, 480, undefined, undefined]);
  });

  it('không có nhóm khớp: không đổi (cùng tham chiếu)', () => {
    const c = cfg();
    const r = applyMeasure(c, { bytesPerDay: 1, estimateBytesPerDay: null, rows24h: new Map([['dien', 10]]) });
    expect(r.changed).toBe(0);
    expect(r.cfg).toBe(c);
  });
});

describe('historianLines (tab Thiết bị)', () => {
  it('ghi đo thực so với ước tính, truy vấn, bị từ chối, p95, tiến độ dựng bù, số hàng tổng hợp', () => {
    const lines = historianLines(INFO(FULL)).join('\n');
    expect(lines).toContain('Ghi đo 24 giờ');
    expect(lines).toContain('540');
    expect(lines).toContain('1.234');
    expect(lines).toContain('p95 85 ms');
    expect(lines).toContain('42 %');
    expect(lines).toContain('288.000');
  });

  it('runtime cũ không có khối mới: không dòng nào', () => {
    expect(historianLines(INFO({}))).toEqual([]);
    expect(historianLines({})).toEqual([]);
  });
});

describe('editor Lưu trữ khi Online (phiên giả)', () => {
  async function online(info: DeviceInfo | null) {
    const { device, session } = fakeDevice();
    if (info) device.info = info;
    const env = await newHistoryApp({ session });
    if (info) await toMonitoring(env.app, device, { 'PROC.PRESSURE': 1 }, []);
    const host = document.createElement('div');
    document.body.append(host);
    render(renderEditor(env.app, 'logging'), host);
    await settled(host);
    return { ...env, host, device };
  }

  it('Offline: không cột Đo thực, không nút Dùng số đo', async () => {
    const { host } = await online(null);
    expect(host.querySelector('.est-online')).toBeNull();
    expect(host.querySelector('button.est-use')).toBeNull();
  });

  it('Online có số đo: cột Đo thực; Dùng số đo là MỘT lệnh hoàn tác', async () => {
    const { app, host } = await online(INFO(FULL));
    expect(host.querySelector('.est-online')?.textContent).toContain('Đo thực');
    host.querySelector<HTMLButtonElement>('button.est-use')!.click();
    await settled(host);
    expect(loggingOf(app).groups.map((g) => g.expectedRowsPerDay)).toEqual([18234, 480, undefined, undefined]);
    app.store.undo();
    await settled(host);
    expect(loggingOf(app).groups.map((g) => g.expectedRowsPerDay)).toEqual([undefined, 720, undefined, undefined]);
  });

  it('Online nhưng thiết bị không có số đo: ẩn cột và nút', async () => {
    const { host } = await online(INFO({}));
    expect(host.querySelector('.est-online')).toBeNull();
    expect(host.querySelector('button.est-use')).toBeNull();
  });
});
