import { describe, expect, it, vi } from 'vitest';
import { FakeActionHost, MemoryTagSource } from './memory-source.ts';

const info = (id: string) => ({
  id,
  type: 'FLOAT32' as const,
  access: 'RW' as const,
  kind: 'external' as const,
});

describe('MemoryTagSource', () => {
  it('get trả UNKNOWN cho Tag lạ, không ném lỗi', () => {
    const s = new MemoryTagSource();
    expect(s.get('x')).toEqual({ value: null, quality: 'UNKNOWN' });
    expect(s.info('x')).toBeUndefined();
  });

  it('đăng ký, nhận thay đổi đúng tập, hủy đăng ký', () => {
    const s = new MemoryTagSource({ tags: [info('a'), info('b'), info('c')] });
    const fn = vi.fn();
    const off = s.subscribe(['a', 'b'], fn);
    s.set('a', { value: 1, quality: 'GOOD' });
    s.set('c', { value: 2, quality: 'GOOD' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(['a']);
    expect(s.get('a')).toMatchObject({ value: 1, quality: 'GOOD' });
    off();
    s.set('a', { value: 3 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('batch gom thay đổi thành một lần gọi', () => {
    const s = new MemoryTagSource({ tags: [info('a'), info('b')] });
    const fn = vi.fn();
    s.subscribe(['a', 'b'], fn);
    s.batch(() => {
      s.set('a', { value: 1, quality: 'GOOD' });
      s.set('b', { value: 2, quality: 'GOOD' });
      s.set('a', { value: 5 });
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect([...fn.mock.calls[0]![0]].sort()).toEqual(['a', 'b']);
  });

  it('connection đổi thì báo mọi người đăng ký', () => {
    const s = new MemoryTagSource({ tags: [info('a')] });
    const fn = vi.fn();
    s.subscribe(['a'], fn);
    expect(s.connection).toBe('live');
    s.setConnection('stale');
    expect(s.connection).toBe('stale');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('giờ giả và bảng giá trị', () => {
    const s = new MemoryTagSource({
      now: 1000,
      tables: { T: { entries: [{ value: 1, text: 'Chạy' }] } },
    });
    expect(s.now()).toBe(1000);
    s.advance(500);
    expect(s.now()).toBe(1500);
    expect(s.valueTable('T')?.entries[0]?.text).toBe('Chạy');
    expect(s.valueTable('X')).toBeUndefined();
  });
});

describe('FakeActionHost', () => {
  it('ghi nhận write và trả kết quả đã hẹn qua onPhase', async () => {
    const h = new FakeActionHost({ session: { user: 'op', role: 'operator' } });
    const phases: string[] = [];
    const p = h.write(
      { kind: 'write', tag: 'a', value: 1, context: { screen: 's', widget: 'w' } },
      (o) => phases.push(o.status),
    );
    expect(h.writes).toHaveLength(1);
    h.resolve({ status: 'ACCEPTED' });
    h.resolve({ status: 'CONFIRMED' });
    const out = await p;
    expect(out.status).toBe('CONFIRMED');
    expect(phases).toEqual(['ACCEPTED']);
  });

  it('ghi lại navigate, popup, requestLogin', () => {
    const h = new FakeActionHost();
    h.navigate('a');
    h.openPopup('b');
    h.closePopup();
    h.requestLogin();
    expect(h.calls).toEqual(['navigate:a', 'popup:b', 'closePopup', 'login']);
    expect(h.session()).toBeNull();
    expect(h.writeBlocked()).toBeNull();
  });
});
