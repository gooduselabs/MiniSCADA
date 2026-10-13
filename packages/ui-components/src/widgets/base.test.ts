import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WidgetItem } from '@mat/project-schema';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import { MatWidget, safeColor } from './base.ts';

class TestWidget extends MatWidget {
  renders = 0;
  get actionable(): boolean {
    return this.canAct;
  }
  decimalsFor(id: string): number {
    return this.decimals(this.source.info(id));
  }
  propOf(n: string, d: string | number | boolean): string | number | boolean {
    return this.prop(n, d);
  }
  protected override renderWidget() {
    this.renders++;
    const id = this.tagOf('value');
    return html`<span class="v">${id ? String(this.source.get(id).value) : 'none'}</span>`;
  }
}
customElements.define('mat-w-test-base', TestWidget);

const item = (tags: WidgetItem['tags'], props?: WidgetItem['props']): WidgetItem => ({
  type: 'widget',
  id: 'w1',
  widget: 'card',
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  tags,
  props,
});
const tag = (id: string, type: 'FLOAT32' | 'INT16' = 'FLOAT32') => ({
  id,
  type,
  access: 'R' as const,
  kind: 'external' as const,
});

function make(src: MemoryTagSource, it: WidgetItem, mode: 'run' | 'edit' = 'run') {
  const el = document.createElement('mat-w-test-base') as TestWidget;
  el.item = it;
  el.source = src;
  el.host = new FakeActionHost();
  el.mode = mode;
  el.context = { screen: 's', widget: 'w1' };
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('MatWidget: vòng đời đăng ký', () => {
  it('đăng ký đúng tập Tag khi gắn vào DOM, hủy khi gỡ', async () => {
    const src = new MemoryTagSource({ tags: [tag('a')] });
    const off = vi.fn();
    const sub = vi.spyOn(src, 'subscribe').mockImplementation(() => off);
    const el = make(src, item({ value: 'a' }));
    expect(sub).not.toHaveBeenCalled();
    document.body.append(el);
    await el.updateComplete;
    expect(sub).toHaveBeenCalledTimes(1);
    expect(sub.mock.calls[0]![0]).toEqual(['a']);
    el.remove();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('gắn lại thì đăng ký lại, không đăng ký trùng', async () => {
    const src = new MemoryTagSource({ tags: [tag('a')] });
    const offs: Array<ReturnType<typeof vi.fn>> = [];
    vi.spyOn(src, 'subscribe').mockImplementation(() => {
      const f = vi.fn();
      offs.push(f);
      return f;
    });
    const el = make(src, item({ value: 'a' }));
    document.body.append(el);
    await el.updateComplete;
    el.remove();
    document.body.append(el);
    await el.updateComplete;
    expect(offs).toHaveLength(2);
    expect(offs[0]).toHaveBeenCalledTimes(1);
    expect(offs[1]).not.toHaveBeenCalled();
  });

  it('đổi item sang Tag khác thì hủy đăng ký cũ và đăng ký mới', async () => {
    const src = new MemoryTagSource({ tags: [tag('a'), tag('b')] });
    const offs: Array<ReturnType<typeof vi.fn>> = [];
    const sub = vi.spyOn(src, 'subscribe').mockImplementation(() => {
      const f = vi.fn();
      offs.push(f);
      return f;
    });
    const el = make(src, item({ value: 'a' }));
    document.body.append(el);
    await el.updateComplete;
    el.item = item({ value: 'b' });
    await el.updateComplete;
    expect(sub).toHaveBeenCalledTimes(2);
    expect(sub.mock.calls[1]![0]).toEqual(['b']);
    expect(offs[0]).toHaveBeenCalledTimes(1);
  });

  it('đổi item nhưng cùng tập Tag thì giữ đăng ký', async () => {
    const src = new MemoryTagSource({ tags: [tag('a')] });
    const sub = vi.spyOn(src, 'subscribe');
    const el = make(src, item({ value: 'a' }));
    document.body.append(el);
    await el.updateComplete;
    el.item = item({ value: 'a' }, { label: 'x' });
    await el.updateComplete;
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it('giá trị đổi thì vẽ lại; Tag ngoài tập không làm vẽ lại', async () => {
    const src = new MemoryTagSource({ tags: [tag('a'), tag('z')] });
    src.set('a', { value: 1, quality: 'GOOD' });
    const el = make(src, item({ value: 'a' }));
    document.body.append(el);
    await el.updateComplete;
    const n = el.renders;
    src.set('z', { value: 9, quality: 'GOOD' });
    await el.updateComplete;
    expect(el.renders).toBe(n);
    src.set('a', { value: 2, quality: 'GOOD' });
    await el.updateComplete;
    expect(el.renders).toBe(n + 1);
    expect(el.shadowRoot!.querySelector('.v')!.textContent).toBe('2');
  });

  it('tab ẩn: không vẽ lại; hiện lại thì áp giá trị cuối một lần', async () => {
    const src = new MemoryTagSource({ tags: [tag('a')] });
    src.set('a', { value: 1, quality: 'GOOD' });
    const el = make(src, item({ value: 'a' }));
    document.body.append(el);
    await el.updateComplete;
    const n = el.renders;
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    src.set('a', { value: 2, quality: 'GOOD' });
    src.set('a', { value: 3, quality: 'GOOD' });
    await el.updateComplete;
    expect(el.renders).toBe(n);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await el.updateComplete;
    expect(el.renders).toBe(n + 1);
    expect(el.shadowRoot!.querySelector('.v')!.textContent).toBe('3');
    hidden.mockRestore();
  });

  it('không có item hoặc source: không ném lỗi, không đăng ký', async () => {
    const el = document.createElement('mat-w-test-base') as TestWidget;
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.v')).toBeNull();
  });
});

describe('MatWidget: chế độ và thuộc tính', () => {
  it('edit: canAct sai, thuộc tính mode phản chiếu để CSS khóa chuột', async () => {
    const src = new MemoryTagSource();
    const el = make(src, item(undefined), 'edit');
    document.body.append(el);
    await el.updateComplete;
    expect(el.actionable).toBe(false);
    expect(el.getAttribute('mode')).toBe('edit');
  });
  it('run có host: canAct đúng; không có host: sai', async () => {
    const src = new MemoryTagSource();
    const el = make(src, item(undefined));
    expect(el.actionable).toBe(true);
    (el as unknown as { host: unknown }).host = undefined;
    expect(el.actionable).toBe(false);
  });
  it('prop: lấy từ item.props khi đúng kiểu, ngược lại dùng mặc định', () => {
    const el = make(new MemoryTagSource(), item(undefined, { label: 'L', n: 'sai kiểu', k: 3 }));
    expect(el.propOf('label', '')).toBe('L');
    expect(el.propOf('n', 5)).toBe(5);
    expect(el.propOf('k', 0)).toBe(3);
    expect(el.propOf('vắng', true)).toBe(true);
  });
  it('decimals: prop thắng; vắng thì kiểu nguyên 0, kiểu thực 1', () => {
    const src = new MemoryTagSource({ tags: [tag('f'), tag('i', 'INT16')] });
    expect(make(src, item(undefined)).decimalsFor('f')).toBe(1);
    expect(make(src, item(undefined)).decimalsFor('i')).toBe(0);
    expect(make(src, item(undefined, { decimals: 3 })).decimalsFor('i')).toBe(3);
  });
});

describe('safeColor', () => {
  it('chỉ nhận #RRGGBB hoặc #RGB', () => {
    expect(safeColor('#12abEF')).toBe('#12abEF');
    expect(safeColor('#fff')).toBe('#fff');
    expect(safeColor('red')).toBeUndefined();
    expect(safeColor('#12345')).toBeUndefined();
    expect(safeColor('#fff; background:url(x)')).toBeUndefined();
    expect(safeColor('auto')).toBeUndefined();
    expect(safeColor(42)).toBeUndefined();
  });
});
