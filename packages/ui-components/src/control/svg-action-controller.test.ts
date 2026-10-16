// T079: widget ảo của sự kiện phần tử SVG dùng cùng ControlController (contract svg-events.md §3, §8).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import type { TagInfo } from '../host/types.ts';
import { CONFIRMED_AUTOCLEAR_MS, type ControlController } from './controller.ts';
import { ModalRegistry } from './modal-registry.ts';
import {
  proposeSvgAction,
  svgActionController,
  type SvgWriteAction,
} from './svg-action-controller.ts';

const RUN: TagInfo = { id: 'RUN', type: 'BOOL', access: 'RW', kind: 'external' };
const CMD: TagInfo = { id: 'CMD', type: 'BOOL', access: 'RW', kind: 'external' };
const SP: TagInfo = {
  id: 'SP',
  type: 'FLOAT32',
  access: 'RW',
  kind: 'external',
  limits: { min: 0, max: 100 },
};

interface Rig {
  source: MemoryTagSource;
  host: FakeActionHost;
  modal: ModalRegistry;
  make(a: SvgWriteAction): ControlController;
}

function rig(): Rig {
  const source = new MemoryTagSource({ tags: [RUN, CMD, SP], now: 1000 });
  source.set('RUN', { value: false, quality: 'GOOD' });
  source.set('CMD', { value: false, quality: 'GOOD' });
  source.set('SP', { value: 10, quality: 'GOOD' });
  const host = new FakeActionHost({ session: { user: 'an', role: 'operator' } });
  const modal = new ModalRegistry();
  let n = 0;
  const make = (a: SvgWriteAction) =>
    svgActionController(
      a,
      { screen: 'bon-nuoc', uid: 'el_pump_hit', label: a.label ?? 'Bơm' },
      { source, host, modal, now: () => Date.now(), uuid: () => `uuid-${++n}` },
    );
  return { source, host, modal, make };
}

const pulse: SvgWriteAction = {
  action: 'pulse',
  tag: 'CMD',
  value: true,
  durationMs: 500,
  confirm: 'always',
  label: 'Khởi động bơm 1',
};
const toggle: SvgWriteAction = { action: 'toggle', tag: 'RUN', confirm: 'always' };
const write: SvgWriteAction = { action: 'write', tag: 'SP', value: 42, confirm: 'always' };
const lockCode = (c: ControlController) => (c.state.phase === 'locked' ? c.state.code : null);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('svgActionController: khóa (13 LockCode)', () => {
  it('đủ điều kiện: ready', () => {
    expect(rig().make(toggle).state).toEqual({ phase: 'ready' });
  });

  it('NO_SESSION, ROLE (minRole mặc định operator và minRole khai báo)', () => {
    const r = rig();
    r.host.sessionInfo = null;
    expect(lockCode(r.make(toggle))).toBe('NO_SESSION');
    r.host.sessionInfo = { user: 'v', role: 'viewer' };
    expect(lockCode(r.make(toggle))).toBe('ROLE');
    r.host.sessionInfo = { user: 'o', role: 'operator' };
    expect(lockCode(r.make({ ...toggle, minRole: 'engineer' }))).toBe('ROLE');
    r.host.sessionInfo = { user: 'e', role: 'engineer' };
    expect(r.make({ ...toggle, minRole: 'engineer' }).state.phase).toBe('ready');
  });

  it('INSECURE, HTTPS_DOWN, SESSION_EXPIRED, PROJECT_CHANGING từ host', () => {
    for (const code of ['INSECURE', 'HTTPS_DOWN', 'SESSION_EXPIRED', 'PROJECT_CHANGING'] as const) {
      const r = rig();
      r.host.blocked = { code, message: 'x' };
      expect(lockCode(r.make(toggle))).toBe(code);
    }
  });

  it('LIVE_LOST, TAG_UNKNOWN, TAG_READONLY, QUALITY_BAD, NO_VALUE', () => {
    const r = rig();
    r.source.setConnection('stale');
    expect(lockCode(r.make(toggle))).toBe('LIVE_LOST');
    r.source.setConnection('live');
    expect(lockCode(r.make({ ...toggle, tag: 'NOPE' }))).toBe('TAG_UNKNOWN');
    r.source.define({ ...RUN, access: 'R' });
    expect(lockCode(r.make(toggle))).toBe('TAG_READONLY');
    r.source.define(RUN);
    r.source.set('RUN', { quality: 'BAD' });
    expect(lockCode(r.make(toggle))).toBe('QUALITY_BAD');
    r.source.set('RUN', { quality: 'GOOD', value: null });
    expect(lockCode(r.make(toggle))).toBe('NO_VALUE');
  });

  it('BUSY khi đang gửi; OTHER_DIALOG khi hộp khác đang mở', () => {
    const r = rig();
    const a = r.make({ ...toggle, confirm: 'none' });
    expect(proposeSvgAction(a, { ...toggle, confirm: 'none' })).toBe(true);
    expect(a.state.phase).toBe('sending');
    expect(a.busyLock()).toBe('BUSY');
    const b = r.make(pulse);
    const c = r.make(write);
    expect(proposeSvgAction(b, pulse)).toBe(true); // b giữ hộp
    expect(b.state.phase).toBe('confirming');
    expect(lockCode(c)).toBe('OTHER_DIALOG');
  });
});

describe('svgActionController: xác nhận và kết quả', () => {
  it('confirm always: hộp xác nhận rồi mới gửi; context = { screen, widget: elementUid }', () => {
    const r = rig();
    const c = r.make(pulse);
    expect(proposeSvgAction(c, pulse)).toBe(true);
    expect(c.state.phase).toBe('confirming');
    expect(r.host.writes).toHaveLength(0);
    c.confirm();
    expect(r.host.writes).toHaveLength(1);
    expect(r.host.writes[0]?.context).toEqual({ screen: 'bon-nuoc', widget: 'el_pump_hit' });
    expect(c.state.phase).toBe('sending');
  });

  it('confirm none (Tag BOOL): gửi ngay không hộp; Tag không phải BOOL vẫn hỏi', () => {
    const r = rig();
    const t = { ...toggle, confirm: 'none' as const };
    const c = r.make(t);
    expect(proposeSvgAction(c, t)).toBe(true);
    expect(c.state.phase).toBe('sending');
    expect(r.host.writes).toHaveLength(1);
    const w = { ...write, confirm: 'none' as const };
    const c2 = r.make(w);
    expect(proposeSvgAction(c2, w)).toBe(true);
    expect(c2.state.phase).toBe('confirming');
  });

  it('toggle kèm expect; pulse kèm pulseMs; write kèm giá trị', () => {
    const r = rig();
    const a = r.make(toggle);
    proposeSvgAction(a, toggle);
    a.confirm();
    expect(r.host.writes[0]).toMatchObject({
      kind: 'toggle',
      tag: 'RUN',
      value: true,
      expect: false,
    });
    const b = r.make(pulse);
    expect(proposeSvgAction(b, pulse)).toBe(true);
    b.confirm();
    expect(r.host.writes[1]).toMatchObject({
      kind: 'pulse',
      tag: 'CMD',
      value: true,
      pulseMs: 500,
    });
  });

  it('write gửi giá trị đã khai báo, kiểm giới hạn của Tag', () => {
    const r = rig();
    const c = r.make(write);
    proposeSvgAction(c, write);
    c.confirm();
    expect(r.host.writes[0]).toMatchObject({ kind: 'write', tag: 'SP', value: 42 });
    const r2 = rig();
    const bad: SvgWriteAction = { ...write, value: 500 };
    const c2 = r2.make(bad);
    expect(proposeSvgAction(c2, bad)).toBe(false);
    expect(c2.error).not.toBeNull();
    expect(r2.host.writes).toHaveLength(0);
  });

  it('ACCEPTED -> CONFIRMED rồi tự về ready', () => {
    const r = rig();
    const c = r.make(toggle);
    proposeSvgAction(c, toggle);
    c.confirm();
    r.host.resolve({ status: 'ACCEPTED' });
    expect(c.state).toMatchObject({ phase: 'sending', accepted: true });
    r.host.resolve({ status: 'CONFIRMED' });
    return Promise.resolve().then(() => {
      expect(c.state).toMatchObject({ phase: 'result', outcome: { status: 'CONFIRMED' } });
      vi.advanceTimersByTime(CONFIRMED_AUTOCLEAR_MS + 1);
      expect(c.state.phase).toBe('ready');
    });
  });

  it.each(['REJECTED', 'TIMEOUT', 'FAILED', 'UNKNOWN'] as const)('kết quả %s', async (status) => {
    const r = rig();
    const c = r.make(toggle);
    proposeSvgAction(c, toggle);
    c.confirm();
    r.host.resolve({ status, code: 'X' });
    await Promise.resolve();
    expect(c.state).toMatchObject({ phase: 'result', outcome: { status } });
    // Không bao giờ gửi lại
    expect(r.host.writes).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(r.host.writes).toHaveLength(1);
  });

  it('đang gửi thì propose lần nữa không gửi thêm', () => {
    const r = rig();
    const c = r.make(toggle);
    proposeSvgAction(c, toggle);
    c.confirm();
    expect(proposeSvgAction(c, toggle)).toBe(false);
    expect(r.host.writes).toHaveLength(1);
  });
});
