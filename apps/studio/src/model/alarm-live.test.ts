// Nguồn alarm sống của Studio (T082, FR-074, FR-081; contract studio-alarm-editor §8): snapshot thay hoàn toàn, delta thay theo id,
// trạng thái nguồn (offline, live, stale, unsupported), đăng ký chỉ khi cần, gom trạng thái theo định nghĩa cho cột sống.
import type { AlarmDeltaMsg, AlarmSnapshotMsg, LiveConnection } from '@mat/live-client';
import { describe, expect, it, vi } from 'vitest';
import { StudioAlarmSource, liveByDef } from './alarm-live.ts';

const counts = (active = 0) => ({
  active,
  unack: active,
  rtnUnack: 0,
  shelved: 0,
  disabled: 0,
  byPriority: {
    critical: { active: 0, unack: 0 },
    major: { active: 0, unack: 0 },
    minor: { active: 0, unack: 0 },
    advisory: { active: 0, unack: 0 },
  },
});
const inst = (id: string, alarmId: string, state: string, priority: string, over: object = {}) => ({
  id,
  alarmId,
  name: id,
  type: 'limit',
  occurrence: 1,
  rev: 1,
  state,
  class: 'minor',
  priority,
  area: null,
  text: id,
  valueActive: 1,
  qualityActive: 'GOOD',
  tsActive: 1,
  clockOk: true,
  disabled: false,
  inputBad: false,
  startup: false,
  ...over,
});
const snap = (instances: object[], revision = 1) =>
  ({
    subscriptionId: 's',
    sequence: 1,
    ts: 1,
    revision,
    instances,
    classes: [],
    areas: [],
    counts: counts(instances.length),
  }) as unknown as AlarmSnapshotMsg;
const delta = (changed: object[], removed: string[] = [], revision = 2) =>
  ({
    subscriptionId: 's',
    sequence: 2,
    ts: 2,
    revision,
    changed,
    removed,
    counts: counts(changed.length),
  }) as unknown as AlarmDeltaMsg;

function fakeConn() {
  const c = {
    onAlarmSupport: null as unknown,
    onAlarmSnapshot: null as unknown,
    onAlarmDelta: null as unknown,
    onAlarmResync: null as unknown,
    subscribeAlarms: vi.fn(),
    unsubscribeAlarms: vi.fn(),
  };
  return c as unknown as LiveConnection & typeof c;
}

describe('StudioAlarmSource', () => {
  it('chưa có dữ liệu: offline; snapshot đầy đủ thay hoàn toàn; delta thay theo id và xóa removed', () => {
    const s = new StudioAlarmSource();
    expect(s.status()).toBe('offline');
    s.applySnapshot(
      snap([inst('A.H', 'A', 'ACTIVE_UNACK', 'minor'), inst('B', 'B', 'NORMAL', 'major')]),
    );
    expect(s.status()).toBe('live');
    expect(s.snapshot().instances.map((i) => i.id)).toEqual(['A.H', 'B']);
    const before = s.snapshot();
    s.applyDelta(delta([inst('A.H', 'A', 'ACTIVE_ACK', 'minor', { rev: 5 })], ['B']));
    expect(s.snapshot()).not.toBe(before);
    expect(s.snapshot().instances.map((i) => [i.id, i.state])).toEqual([['A.H', 'ACTIVE_ACK']]);
    s.applySnapshot(snap([inst('C', 'C', 'NORMAL', 'minor')]));
    expect(s.snapshot().instances.map((i) => i.id)).toEqual(['C']);
  });

  it('mất kết nối hoặc thiếu mảnh thì stale; thiết bị cũ thì unsupported; project không alarm thì none', () => {
    const s = new StudioAlarmSource();
    s.applySnapshot(snap([inst('A', 'A', 'NORMAL', 'minor')]));
    s.markResync();
    expect(s.status()).toBe('stale');
    s.applySnapshot(snap([inst('A', 'A', 'NORMAL', 'minor')]));
    s.onConnState('offline');
    expect(s.status()).toBe('stale');
    s.setSupport('unsupported');
    expect(s.status()).toBe('unsupported');
    expect(s.snapshot().instances).toEqual([]);
    s.setSupport('none');
    expect(s.status()).toBe('none');
  });

  it('chỉ đăng ký nhận alarm khi cần (want); gắn lại kết nối mới thì đăng ký lại; chỉ đọc (không có ack)', () => {
    const s = new StudioAlarmSource();
    const c1 = fakeConn();
    s.attach(c1);
    expect(c1.subscribeAlarms).not.toHaveBeenCalled();
    s.want(true);
    expect(c1.subscribeAlarms).toHaveBeenCalledTimes(1);
    const c2 = fakeConn();
    s.attach(c2);
    expect(c1.onAlarmSnapshot).toBeNull();
    expect(c2.subscribeAlarms).toHaveBeenCalledTimes(1);
    s.want(false);
    expect(c2.unsubscribeAlarms).toHaveBeenCalledTimes(1);
    expect('ack' in s).toBe(false);
  });

  it('thông báo gộp ở cuối microtask; clear() về offline', async () => {
    const s = new StudioAlarmSource();
    const seen: unknown[] = [];
    s.subscribe((c) => seen.push(c));
    s.applySnapshot(snap([inst('A', 'A', 'NORMAL', 'minor')]));
    s.applyDelta(delta([inst('A', 'A', 'ACTIVE_UNACK', 'minor', { rev: 3 })]));
    await Promise.resolve();
    expect(seen).toEqual(['all']);
    s.clear();
    expect(s.status()).toBe('offline');
  });
});

describe('liveByDef: dòng lưới gom bốn ngưỡng', () => {
  it('trạng thái nặng nhất (ưu tiên cao nhất, chưa xác nhận trước) và số ngưỡng đang có', () => {
    const s = new StudioAlarmSource();
    s.applySnapshot(
      snap([
        inst('TL.LL', 'TL', 'NORMAL', 'critical'),
        inst('TL.L', 'TL', 'ACTIVE_ACK', 'minor'),
        inst('TL.H', 'TL', 'ACTIVE_UNACK', 'minor'),
        inst('TL.HH', 'TL', 'ACTIVE_UNACK', 'critical'),
        inst('PF', 'PF', 'NORMAL', 'major'),
      ]),
    );
    const m = liveByDef(s.snapshot());
    const tl = m.get('TL')!;
    expect(tl.top?.id).toBe('TL.HH');
    expect(tl.active).toBe(3);
    expect(tl.total).toBe(4);
    expect(m.get('PF')?.active).toBe(0);
    expect(m.get('KHONG')).toBeUndefined();
  });
});
