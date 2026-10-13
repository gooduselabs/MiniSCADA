import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, makeSource, mount, textOf, widgetItem } from './test-util.ts';

afterEach(cleanup);

describe('mat-w-panel (FR-027)', () => {
  it('hiện tiêu đề dạng chữ, role=group với nhãn là tiêu đề', async () => {
    const el = await mount(
      widgetItem('panel', {}, { title: 'Khu vực <b>bơm</b>' }),
      makeSource([]),
    );
    expect(textOf(el, '.title')).toBe('Khu vực <b>bơm</b>');
    expect(el.shadowRoot!.querySelector('b')).toBeNull();
    const w = el.shadowRoot!.querySelector('.w')!;
    expect(w.getAttribute('role')).toBe('group');
    expect(w.getAttribute('aria-label')).toBe('Khu vực <b>bơm</b>');
  });

  it('showTitle=false ẩn tiêu đề nhưng vẫn có nhãn truy cập', async () => {
    const el = await mount(
      widgetItem('panel', {}, { title: 'A', showTitle: false }),
      makeSource([]),
    );
    expect(el.shadowRoot!.querySelector('.title')).toBeNull();
    expect(el.shadowRoot!.querySelector('.w')!.getAttribute('aria-label')).toBe('A');
  });

  it('không đăng ký Tag, không nhận sự kiện (pointer-events none)', async () => {
    const src = makeSource([]);
    const sub = vi.spyOn(src, 'subscribe');
    const el = await mount(widgetItem('panel', {}, { title: 'A' }), src);
    expect(sub).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector('button, input, select, a')).toBeNull();
    const css = [
      ...(el.constructor as unknown as { elementStyles: Array<{ cssText: string }> }).elementStyles,
    ]
      .map((s) => s.cssText)
      .join('');
    expect(css).toContain('pointer-events: none');
  });

  it('nền và viền tùy chọn', async () => {
    const el = await mount(
      widgetItem('panel', {}, { background: '#102030', border: false }),
      makeSource([]),
    );
    const w = el.shadowRoot!.querySelector<HTMLElement>('.w')!;
    expect(w.style.background).toMatch(/#102030|rgb\(16, 32, 48\)/);
    expect(w.classList.contains('no-border')).toBe(true);
    const bordered = await mount(widgetItem('panel', {}, {}), makeSource([]));
    expect(bordered.shadowRoot!.querySelector('.w')!.classList.contains('no-border')).toBe(false);
  });

  it('nền sai bị bỏ', async () => {
    const el = await mount(
      widgetItem('panel', {}, { background: 'red;position:fixed' }),
      makeSource([]),
    );
    expect(
      el.shadowRoot!.querySelector<HTMLElement>('.w')!.getAttribute('style') ?? '',
    ).not.toContain('fixed');
  });
});
