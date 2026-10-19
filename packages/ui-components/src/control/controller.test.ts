import type { WidgetItem } from '@mat/project-schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import type { TagInfo, WriteOutcome } from '../host/types.ts';
import { ControlController } from './controller.ts';
import { ModalRegistry } from './modal-registry.ts';

const SP: TagInfo = {
  id: 'SP',
  type: 'FLOAT32',
  access: 'RW',
  kind: 'external',
  unit: 'bar',
  description: 'Áp suất đặt',
  limits: { min: 0, max: 100 },
  deviceName: 'PLC1',
};
const RUN: TagInfo = { id: 'RUN', type: 'BOOL', access: 'RW', kind: 'external' };
const NAME: TagInfo = {
  id: 'NAME',
  type: 'STRING',
  access: 'RW',
  kind: 'internal',
  limits: { maxLength: 5 },
};
const I16: TagInfo = { id: 'I16', type: 'INT16', access: 'RW', kind: 'external' };

function mkItem(over: Partial<WidgetItem> = {}, tag = 'SP'): WidgetItem {
  return {
    id: 'w1',
    type: 'widget',
    widget: 'setpoint',
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    tags: { target: tag },
    ...over,
  };
}

interface Rig {
  source: MemoryTagSource;
  host: FakeActionHost;
  modal: ModalRegistry;
  make(item?: WidgetItem): ControlController;
  ctl: ControlController;
  ids: string[];
}

function rig(item: WidgetItem = mkItem()): Rig {
  const source = new MemoryTagSource({ tags: [SP, RUN, NAME, I16], now: 1000 });
  source.set('SP', { value: 10, quality: 'GOOD' });
  source.set('RUN', { value: false, quality: 'GOOD' });
  source.set('NAME', { value: 'abc', quality: 'GOOD' });
  source.set('I16', { value: 1, quality: 'GOOD' });
  const host = new FakeActionHost({ session: { user: 'an', role: 'operator' } });
  const modal = new ModalRegistry();
  const ids: string[] = [];
  let n = 0;
  const make = (it: WidgetItem = item) =>
    new ControlController({
      item: it,
      source,
      host,
      modal,
      now: () => Date.now(),
      uuid: () => {
        const id = `uuid-${++n}`;
        ids.push(id);
        return id;
      },
      context: { screen: 's1', widget: it.id },
    });
  return { source, host, modal, make, ctl: make(), ids };
}

const lockCode = (c: ControlController) => (c.state.phase === 'locked' ? c.state.code : null);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('lockOf: mọi điều kiện và thứ tự', () => {
  it('đủ điều kiện thì ready', () => {
    expect(rig().ctl.state).toEqual({ phase: 'ready' });
  });

  it('INSECURE/HTTPS_DOWN/SESSION_EXPIRED/PROJECT_CHANGING từ host.writeBlocked', () => {
    for (const code of ['INSECURE', 'HTTPS_DOWN', 'SESSION_EXPIRED', 'PROJECT_CHANGING'] as const) {
      const r = rig();
      r.host.blocked = { code, message: 'x' };
      expect(lockCode(r.ctl)).toBe(code);
    }
  });

  it('HTTP không phiên: INSECURE chứ không phải NO_SESSION', () => {
    const r = rig();
    r.host.sessionInfo = null;
    r.host.blocked = { code: 'INSECURE', message: 'http' };
    expect(lockCode(r.ctl)).toBe('INSECURE');
  });

  it('NO_SESSION khi chưa đăng nhập', () => {
    const r = rig();
    r.host.sessionInfo = null;
    expect(r.ctl.state).toMatchObject({
      phase: 'locked',
      code: 'NO_SESSION',
      message: 'Đăng nhập để điều khiển',
    });
  });

  it('ROLE: viewer, hoặc role thấp hơn security.minRole', () => {
    const r = rig();
    r.host.sessionInfo = { user: 'v', role: 'viewer' };
    expect(lockCode(r.ctl)).toBe('ROLE');
    const r2 = rig(mkItem({ security: { minRole: 'engineer' } }));
    expect(lockCode(r2.ctl)).toBe('ROLE');
    expect(r2.ctl.state).toMatchObject({ message: 'Cần quyền engineer' });
    r2.host.sessionInfo = { user: 'e', role: 'administrator' };
    expect(r2.ctl.state.phase).toBe('ready');
  });

  it('LIVE_LOST khi connection khác live', () => {
    const r = rig();
    r.source.setConnection('stale');
    expect(lockCode(r.ctl)).toBe('LIVE_LOST');
    r.source.setConnection('offline');
    expect(lockCode(r.ctl)).toBe('LIVE_LOST');
  });

  it('TAG_UNKNOWN: không gán Tag, Tag lạ, quality UNKNOWN', () => {
    const r = rig(mkItem({ tags: {} }));
    expect(lockCode(r.ctl)).toBe('TAG_UNKNOWN');
    const r2 = rig(mkItem({}, 'NOPE'));
    expect(lockCode(r2.ctl)).toBe('TAG_UNKNOWN');
    const r3 = rig();
    r3.source.set('SP', { quality: 'UNKNOWN' });
    expect(lockCode(r3.ctl)).toBe('TAG_UNKNOWN');
  });

  it('TAG_READONLY: access R hoặc calculated', () => {
    const r = rig();
    r.source.define({ ...SP, access: 'R' });
    expect(lockCode(r.ctl)).toBe('TAG_READONLY');
    r.source.define({ ...SP, kind: 'calculated' });
    expect(lockCode(r.ctl)).toBe('TAG_READONLY');
  });

  it('QUALITY_BAD: BAD và STALE kèm lý do; UNCERTAIN không khóa', () => {
    const r = rig();
    r.source.set('SP', { quality: 'BAD' });
    expect(r.ctl.state).toMatchObject({ code: 'QUALITY_BAD', message: 'Quality BAD' });
    r.source.set('SP', { quality: 'STALE' });
    expect(lockCode(r.ctl)).toBe('QUALITY_BAD');
    r.source.set('SP', { quality: 'UNCERTAIN' });
    expect(r.ctl.state.phase).toBe('ready');
  });

  it('NO_VALUE khi value null', () => {
    const r = rig();
    r.source.set('SP', { value: null });
    expect(lockCode(r.ctl)).toBe('NO_VALUE');
  });

  it('thứ tự ưu tiên: mỗi điều kiện đứng trước điều kiện sau', () => {
    const r = rig();
    // Dựng tất cả điều kiện cùng lúc rồi gỡ dần theo thứ tự.
    r.host.blocked = { code: 'HTTPS_DOWN', message: 'x' };
    r.host.sessionInfo = null;
    r.source.setConnection('stale');
    r.source.define({ ...SP, access: 'R' });
    r.source.set('SP', { quality: 'BAD' });
    expect(lockCode(r.ctl)).toBe('HTTPS_DOWN');
    r.host.blocked = null;
    expect(lockCode(r.ctl)).toBe('NO_SESSION');
    r.host.sessionInfo = { user: 'v', role: 'viewer' };
    expect(lockCode(r.ctl)).toBe('ROLE');
    r.host.sessionInfo = { user: 'an', role: 'operator' };
    expect(lockCode(r.ctl)).toBe('LIVE_LOST');
    r.source.setConnection('live');
    expect(lockCode(r.ctl)).toBe('TAG_READONLY');
    r.source.define(SP);
    expect(lockCode(r.ctl)).toBe('QUALITY_BAD');
    r.source.set('SP', { quality: 'GOOD', value: null });
    expect(lockCode(r.ctl)).toBe('NO_VALUE');
  });

  it('TAG_UNKNOWN đứng trước TAG_READONLY và QUALITY_BAD', () => {
    const r = rig(mkItem({}, 'NOPE'));
    r.source.setConnection('live');
    expect(lockCode(r.ctl)).toBe('TAG_UNKNOWN');
  });

  it('OTHER_DIALOG qua ModalRegistry, và nhả khi hộp kia đóng', () => {
    const r = rig();
    const other = r.make(mkItem({ id: 'w2' }));
    expect(r.ctl.propose('write', 50)).toBe(true);
    expect(r.ctl.state.phase).toBe('confirming');
    expect(lockCode(other)).toBe('OTHER_DIALOG');
    expect(other.propose('write', 20)).toBe(false);
    r.ctl.cancel();
    expect(other.state.phase).toBe('ready');
    expect(r.ctl.state.phase).toBe('ready');
  });

  it('onChange được gọi khi hộp ở widget khác mở/đóng', () => {
    const r = rig();
    const other = r.make(mkItem({ id: 'w2' }));
    const fn = vi.fn();
    other.onChange = fn;
    r.ctl.propose('write', 50);
    expect(fn).toHaveBeenCalled();
  });
});

describe('propose: kiểm giá trị', () => {
  it('trả false và để lỗi khi đang khóa', () => {
    const r = rig();
    r.host.sessionInfo = null;
    expect(r.ctl.propose('write', 5)).toBe(false);
    expect(r.host.writes).toHaveLength(0);
  });

  it('ngoài giới hạn Tag', () => {
    const r = rig();
    expect(r.ctl.propose('write', 101)).toBe(false);
    expect(r.ctl.error).toBe('Ngoài giới hạn 0–100');
    expect(r.ctl.state.phase).toBe('ready');
    expect(r.ctl.propose('write', -1)).toBe(false);
  });

  it('giới hạn = giao của widget và Tag', () => {
    const r = rig(mkItem({ props: { min: 20, max: 200 } }));
    expect(r.ctl.limits()).toEqual({ min: 20, max: 100 });
    expect(r.ctl.propose('write', 10)).toBe(false);
    expect(r.ctl.error).toBe('Ngoài giới hạn 20–100');
    expect(r.ctl.propose('write', 20)).toBe(true);
  });

  it('chuỗi số: dấu phẩy bị từ chối, chấm được nhận', () => {
    const r = rig();
    expect(r.ctl.propose('write', '12,5')).toBe(false);
    expect(r.ctl.error).toBe('Dùng dấu chấm thập phân');
    expect(r.ctl.propose('write', 'abc')).toBe(false);
    expect(r.ctl.error).toBe('Giá trị không phải số hợp lệ');
    expect(r.ctl.propose('write', '')).toBe(false);
    expect(r.ctl.propose('write', ' 12.5 ')).toBe(true);
    const st = r.ctl.state;
    expect(st.phase === 'confirming' && st.draft.spec.value).toBe(12.5);
  });

  it('số không hữu hạn bị từ chối', () => {
    const r = rig();
    expect(r.ctl.propose('write', NaN)).toBe(false);
    expect(r.ctl.propose('write', Infinity)).toBe(false);
  });

  it('INT16 cần số nguyên và nằm trong dải kiểu', () => {
    const r = rig(mkItem({}, 'I16'));
    expect(r.ctl.propose('write', 1.5)).toBe(false);
    expect(r.ctl.error).toBe('Cần số nguyên');
    expect(r.ctl.propose('write', 40000)).toBe(false);
    expect(r.ctl.propose('write', 300)).toBe(true);
  });

  it('BOOL cần boolean; STRING cần chuỗi trong maxLength', () => {
    const r = rig(mkItem({}, 'RUN'));
    expect(r.ctl.propose('write', 1)).toBe(false);
    expect(r.ctl.propose('write', true)).toBe(true);
    const s = rig(mkItem({}, 'NAME'));
    expect(s.ctl.propose('write', 'abcdef')).toBe(false);
    expect(s.ctl.error).toBe('Chuỗi tối đa 5 ký tự');
    expect(s.ctl.propose('write', 5 as never)).toBe(false);
    expect(s.ctl.propose('write', 'abcde')).toBe(true);
  });

  it('lỗi cũ xóa khi propose đúng', () => {
    const r = rig();
    r.ctl.propose('write', 500);
    expect(r.ctl.error).not.toBeNull();
    r.ctl.propose('write', 5);
    expect(r.ctl.error).toBeNull();
  });

  it('toggle: giá trị đối lập kèm expect; chỉ BOOL', () => {
    const r = rig(mkItem({ widget: 'switch' }, 'RUN'));
    expect(r.ctl.propose('toggle', true)).toBe(true);
    const st = r.ctl.state;
    expect(st.phase === 'confirming' && st.draft.spec).toMatchObject({
      kind: 'toggle',
      tag: 'RUN',
      value: true,
      expect: false,
      context: { screen: 's1', widget: 'w1' },
    });
    const n = rig();
    expect(n.ctl.propose('toggle', true)).toBe(false);
  });

  it('pulse: kèm pulseMs hợp lệ 100–10000, chỉ BOOL', () => {
    const r = rig(mkItem({ widget: 'button' }, 'RUN'));
    expect(r.ctl.propose('pulse', true, { pulseMs: 50 })).toBe(false);
    expect(r.ctl.error).toBe('Thời gian xung phải từ 100 đến 10000 ms');
    expect(r.ctl.propose('pulse', true)).toBe(false);
    expect(r.ctl.propose('pulse', true, { pulseMs: 500 })).toBe(true);
    const st = r.ctl.state;
    expect(st.phase === 'confirming' && st.draft.spec).toMatchObject({
      kind: 'pulse',
      value: true,
      pulseMs: 500,
    });
    expect(st.phase === 'confirming' && st.draft.spec.expect).toBeUndefined();
  });

  it('draft có info, current, confirm và text', () => {
    const r = rig(mkItem({ props: { confirmText: 'Chắc chưa?' } }));
    r.ctl.propose('write', 55);
    const st = r.ctl.state;
    expect(st.phase).toBe('confirming');
    if (st.phase !== 'confirming') return;
    expect(st.draft.info.id).toBe('SP');
    expect(st.draft.current).toMatchObject({ value: 10, quality: 'GOOD' });
    expect(st.draft.confirm).toBe('always');
    expect(st.draft.text).toBe('Chắc chưa?');
  });
});

describe('confirm, sending, kết quả', () => {
  it('propose → confirming; confirm sinh requestId và gọi host.write đúng một lần', () => {
    const r = rig();
    r.ctl.propose('write', 55);
    expect(r.host.writes).toHaveLength(0);
    r.ctl.confirm();
    expect(r.host.writes).toHaveLength(1);
    expect(r.host.writes[0]).toMatchObject({
      kind: 'write',
      tag: 'SP',
      value: 55,
      requestId: 'uuid-1',
    });
    const st = r.ctl.state;
    expect(st).toMatchObject({ phase: 'sending', requestId: 'uuid-1' });
    // Gọi lại confirm không gửi lần hai.
    r.ctl.confirm();
    r.ctl.confirm();
    expect(r.host.writes).toHaveLength(1);
    expect(r.ids).toEqual(['uuid-1']);
  });

  it('đang sending: BUSY, propose bị từ chối', () => {
    const r = rig();
    r.ctl.propose('write', 55);
    r.ctl.confirm();
    expect(r.ctl.propose('write', 60)).toBe(false);
    expect(r.host.writes).toHaveLength(1);
    expect(r.ctl.busyLock()).toBe('BUSY');
  });

  it('ACCEPTED rồi CONFIRMED: sending(accepted) → result → tự về ready sau 4 s', async () => {
    const r = rig();
    r.ctl.propose('write', 55);
    r.ctl.confirm();
    r.host.resolve({ status: 'ACCEPTED' });
    const st = r.ctl.state;
    expect(st.phase === 'sending' && st.accepted).toBe(true);
    r.host.resolve({ status: 'CONFIRMED', readback: 55 });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.ctl.state).toMatchObject({ phase: 'result', outcome: { status: 'CONFIRMED' } });
    await vi.advanceTimersByTimeAsync(3900);
    expect(r.ctl.state.phase).toBe('result');
    await vi.advanceTimersByTimeAsync(200);
    expect(r.ctl.state.phase).toBe('ready');
  });

  it.each(['REJECTED', 'TIMEOUT', 'FAILED'] as const)(
    '%s ở lại tới dismissResult',
    async (status) => {
      const r = rig();
      r.ctl.propose('write', 55);
      r.ctl.confirm();
      r.host.resolve({ status, code: 'CONNECTION_BAD' });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(r.ctl.state).toMatchObject({ phase: 'result', outcome: { status } });
      r.ctl.dismissResult();
      expect(r.ctl.state.phase).toBe('ready');
    },
  );

  it('UNKNOWN giữ BUSY 10 s rồi cho đóng', async () => {
    const r = rig();
    r.ctl.propose('write', 55);
    r.ctl.confirm();
    r.host.resolve({ status: 'UNKNOWN' });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.ctl.state.phase).toBe('result');
    expect(r.ctl.busyLock()).toBe('BUSY');
    r.ctl.dismissResult();
    expect(r.ctl.state.phase).toBe('result');
    await vi.advanceTimersByTimeAsync(10_001);
    expect(r.ctl.busyLock()).toBeNull();
    r.ctl.dismissResult();
    expect(r.ctl.state.phase).toBe('ready');
  });

  it('host.write ném lỗi → FAILED', async () => {
    const r = rig();
    vi.spyOn(r.host, 'write').mockRejectedValue(new Error('boom'));
    r.ctl.propose('write', 55);
    r.ctl.confirm();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.ctl.state).toMatchObject({ phase: 'result', outcome: { status: 'FAILED' } });
  });

  it('kết quả cũ không ghi đè sau dispose', async () => {
    const r = rig();
    r.ctl.propose('write', 55);
    r.ctl.confirm();
    r.ctl.dispose();
    r.host.resolve({ status: 'CONFIRMED' } as WriteOutcome);
    await vi.advanceTimersByTimeAsync(5000);
    expect(r.modal.holder).toBeNull();
  });

  it('result chưa đóng: propose bị từ chối cho tới khi dismissResult', async () => {
    const r = rig();
    r.ctl.propose('write', 55);
    r.ctl.confirm();
    r.host.resolve({ status: 'FAILED', code: 'DEVICE_EXCEPTION' });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.ctl.propose('write', 60)).toBe(false);
    r.ctl.dismissResult();
    expect(r.ctl.propose('write', 60)).toBe(true);
  });

  it('cancel: confirming → ready, nhả modal, không gọi host', () => {
    const r = rig();
    r.ctl.propose('write', 55);
    expect(r.modal.holder).not.toBeNull();
    r.ctl.cancel();
    expect(r.ctl.state.phase).toBe('ready');
    expect(r.modal.holder).toBeNull();
    expect(r.host.writes).toHaveLength(0);
  });

  it('đổi khóa giữa confirming: confirmLock báo, confirm không gửi và về locked', () => {
    const r = rig();
    r.ctl.propose('write', 55);
    expect(r.ctl.confirmLock()).toBeNull();
    r.source.set('SP', { quality: 'BAD' });
    expect(r.ctl.confirmLock()?.code).toBe('QUALITY_BAD');
    r.ctl.confirm();
    expect(r.host.writes).toHaveLength(0);
    expect(r.ctl.state).toMatchObject({ phase: 'locked', code: 'QUALITY_BAD' });
    expect(r.modal.holder).toBeNull();
  });

  it('hết phiên giữa confirming cũng chặn gửi', () => {
    const r = rig();
    r.ctl.propose('write', 55);
    r.host.blocked = { code: 'SESSION_EXPIRED', message: 'x' };
    r.ctl.confirm();
    expect(r.host.writes).toHaveLength(0);
    expect(lockCode(r.ctl)).toBe('SESSION_EXPIRED');
  });

  it('dòng "hiện tại" của draft cập nhật theo Tag', () => {
    const r = rig();
    r.ctl.propose('write', 55);
    r.source.set('SP', { value: 12 });
    const st = r.ctl.state;
    expect(st.phase === 'confirming' && st.draft.current.value).toBe(12);
  });

  it('UNCERTAIN không khóa; draft.current giữ quality để hộp cảnh báo', () => {
    const r = rig();
    r.source.set('SP', { quality: 'UNCERTAIN' });
    expect(r.ctl.propose('write', 55)).toBe(true);
    const st = r.ctl.state;
    expect(st.phase === 'confirming' && st.draft.current.quality).toBe('UNCERTAIN');
  });

  it('confirm: none với BOOL đi thẳng tới sending, không hộp', () => {
    const r = rig(mkItem({ widget: 'button', props: { confirm: 'none' } }, 'RUN'));
    expect(r.ctl.propose('write', true)).toBe(true);
    expect(r.ctl.state.phase).toBe('sending');
    expect(r.host.writes).toHaveLength(1);
    expect(r.modal.holder).toBeNull();
  });

  it('confirm: none bị bỏ qua khi Tag không phải BOOL', () => {
    const r = rig(mkItem({ widget: 'button', props: { confirm: 'none' } }));
    expect(r.ctl.propose('write', 5)).toBe(true);
    expect(r.ctl.state.phase).toBe('confirming');
    expect(r.host.writes).toHaveLength(0);
  });

  it('onChange được gọi mỗi lần đổi trạng thái', () => {
    const r = rig();
    const fn = vi.fn();
    r.ctl.onChange = fn;
    r.ctl.propose('write', 5);
    r.ctl.recompute();
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// Feature 013 (US4 AC2): item điều khiển trong `lockedItems` → khóa "Cần quyền thao tác"; xem trước của trang Quản trị.
describe('lockOf: quyền thao tác theo item (013)', () => {
  it('host.itemBlocked nhận màn hình và id item, NO_PERMISSION có chữ mặc định', () => {
    const r = rig();
    const seen: Array<{ screen: string; item: string }> = [];
    r.host.itemBlock = (ctx) => {
      seen.push(ctx);
      return { code: 'NO_PERMISSION', message: '' };
    };
    expect(r.ctl.state).toMatchObject({
      phase: 'locked',
      code: 'NO_PERMISSION',
      message: 'Cần quyền thao tác',
    });
    expect(seen.at(-1)).toEqual({ screen: 's1', item: 'w1' });
  });

  it('đứng sau NO_SESSION và ROLE, trước LIVE_LOST', () => {
    const r = rig();
    r.host.itemBlock = () => ({ code: 'NO_PERMISSION', message: 'Cần quyền thao tác' });
    r.source.setConnection('stale');
    expect(lockCode(r.ctl)).toBe('NO_PERMISSION');
    r.host.sessionInfo = { user: 'v', role: 'viewer' };
    expect(lockCode(r.ctl)).toBe('ROLE');
    r.host.sessionInfo = null;
    expect(lockCode(r.ctl)).toBe('NO_SESSION');
  });

  it('PREVIEW: khóa với chữ của host; null thì không khóa', () => {
    const r = rig();
    r.host.itemBlock = () => ({ code: 'PREVIEW', message: 'Chỉ xem' });
    expect(r.ctl.state).toMatchObject({ code: 'PREVIEW', message: 'Chỉ xem' });
    r.host.itemBlock = () => null;
    expect(r.ctl.state.phase).toBe('ready');
  });

  it('accessItem thay id item khi kiểm (phần tử SVG: context.widget là elementUid)', () => {
    const source = new MemoryTagSource({ tags: [SP], now: 1000 });
    source.set('SP', { value: 1, quality: 'GOOD' });
    const host = new FakeActionHost({ session: { user: 'an', role: 'operator' } });
    const seen: string[] = [];
    host.itemBlock = (c) => {
      seen.push(`${c.screen}/${c.item}`);
      return null;
    };
    const c = new ControlController({
      item: mkItem({ id: 'el_x' }),
      source,
      host,
      now: () => 0,
      uuid: () => 'u',
      context: { screen: 's1', widget: 'el_x' },
      accessItem: 'svg1',
    });
    void c.state;
    expect(seen.at(-1)).toBe('s1/svg1');
  });
});
