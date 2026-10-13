import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem } from './test-util.ts';

afterEach(cleanup);

const card = (props?: Record<string, string | number | boolean>, tag = 't1') =>
  widgetItem('card', { value: tag }, props);

describe('mat-w-card (FR-026)', () => {
  it('giá trị theo decimals và đơn vị của Tag', async () => {
    const src = makeSource([tagInfo('t1', { unit: 'bar' })]);
    src.set('t1', { value: 12.345, quality: 'GOOD' });
    const el = await mount(card({ decimals: 2, label: 'Áp suất' }), src);
    expect(textOf(el, '.value')).toBe('12.35');
    expect(textOf(el, '.unit')).toBe('bar');
    expect(textOf(el, '.label')).toBe('Áp suất');
  });

  it('decimals vắng: kiểu thực 1 số lẻ, kiểu nguyên 0', async () => {
    const src = makeSource([tagInfo('f'), tagInfo('i', { type: 'INT16' })]);
    src.set('f', { value: 3.14159, quality: 'GOOD' });
    src.set('i', { value: 7, quality: 'GOOD' });
    expect(textOf(await mount(card(undefined, 'f'), src), '.value')).toBe('3.1');
    expect(textOf(await mount(card(undefined, 'i'), src), '.value')).toBe('7');
  });

  it('thuộc tính unit ghi đè đơn vị của Tag', async () => {
    const src = makeSource([tagInfo('t1', { unit: 'bar' })]);
    src.set('t1', { value: 1, quality: 'GOOD' });
    const el = await mount(card({ unit: 'kPa' }), src);
    expect(textOf(el, '.unit')).toBe('kPa');
  });

  it('cập nhật khi giá trị đổi', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 1, quality: 'GOOD' });
    const el = await mount(card(), src);
    src.set('t1', { value: 2, quality: 'GOOD' });
    await el.updateComplete;
    expect(textOf(el, '.value')).toBe('2.0');
  });

  it('bảng giá trị: chữ và màu của bảng', async () => {
    const src = makeSource([tagInfo('t1', { type: 'UINT16', valueTable: 'run' })], {
      run: { entries: [{ value: 1, text: 'Chạy', color: '#15703a' }] },
    });
    src.set('t1', { value: 1, quality: 'GOOD' });
    const el = await mount(card(), src);
    expect(textOf(el, '.value')).toBe('Chạy');
    const v = el.shadowRoot!.querySelector<HTMLElement>('.value')!;
    expect(v.style.color).toMatch(/#15703a|rgb\(21, 112, 58\)/);
  });

  it('valueColor đặt tay thắng màu bảng; màu sai bị bỏ', async () => {
    const src = makeSource([tagInfo('t1', { valueTable: 'run' })], {
      run: { entries: [{ value: 1, text: 'Chạy', color: '#15703a' }] },
    });
    src.set('t1', { value: 1, quality: 'GOOD' });
    const el = await mount(card({ valueColor: '#aa0000' }), src);
    expect(el.shadowRoot!.querySelector<HTMLElement>('.value')!.style.color).toMatch(
      /#aa0000|rgb\(170, 0, 0\)/,
    );
    const bad = await mount(card({ valueColor: 'red; background:url(x)' }), src);
    expect(
      bad.shadowRoot!.querySelector<HTMLElement>('.value')!.getAttribute('style') ?? '',
    ).not.toContain('url');
  });

  it('background đặt tay áp lên khung', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 1, quality: 'GOOD' });
    const el = await mount(card({ background: '#112233' }), src);
    expect(el.shadowRoot!.querySelector<HTMLElement>('.w')!.style.background).toMatch(
      /#112233|rgb\(17, 34, 51\)/,
    );
  });

  it('STRING và BOOL hiển thị đúng', async () => {
    const src = makeSource([tagInfo('s', { type: 'STRING' }), tagInfo('b', { type: 'BOOL' })]);
    src.set('s', { value: 'Xin chào', quality: 'GOOD' });
    src.set('b', { value: true, quality: 'GOOD' });
    expect(textOf(await mount(card(undefined, 's'), src), '.value')).toBe('Xin chào');
    expect(textOf(await mount(card(undefined, 'b'), src), '.value')).toBe('Bật');
  });

  describe('quality (FR-018): luôn có chữ hoặc biểu tượng', () => {
    const cases = [
      ['BAD', 'BAD', 'q-bad'],
      ['STALE', 'STALE', 'q-stale'],
      ['UNCERTAIN', '●', 'q-uncertain'],
    ] as const;
    for (const [q, badge, cls] of cases) {
      it(q, async () => {
        const src = makeSource([tagInfo('t1')]);
        src.set('t1', { value: 5, quality: q, reason: 'TIMEOUT' });
        const el = await mount(card(), src);
        expect(textOf(el, '.badge')).toBe(badge);
        expect(el.shadowRoot!.querySelector('.w')!.classList.contains(cls)).toBe(true);
        expect(el.shadowRoot!.querySelector('.badge')!.getAttribute('title')).toContain(
          'Hết thời gian',
        );
        const dim = el.shadowRoot!.querySelector('.value')!.classList.contains('dim');
        expect(dim).toBe(q !== 'UNCERTAIN');
      });
    }
    it('UNKNOWN: "?" cả ở giá trị và nhãn', async () => {
      const src = makeSource([]);
      const el = await mount(card(undefined, 'lạ'), src);
      expect(textOf(el, '.value')).toBe('?');
      expect(textOf(el, '.badge')).toBe('?');
    });
    it('showQuality=false chỉ ẩn nhãn của GOOD/UNCERTAIN, lỗi nặng vẫn hiện nhãn', async () => {
      const src = makeSource([tagInfo('a'), tagInfo('b'), tagInfo('c')]);
      src.set('a', { value: 1, quality: 'UNCERTAIN' });
      src.set('b', { value: 1, quality: 'BAD' });
      src.set('c', { value: 1, quality: 'GOOD' });
      const p = { showQuality: false };
      expect((await mount(card(p, 'a'), src)).shadowRoot!.querySelector('.badge')).toBeNull();
      expect(textOf(await mount(card(p, 'b'), src), '.badge')).toBe('BAD');
      expect((await mount(card(p, 'c'), src)).shadowRoot!.querySelector('.badge')).toBeNull();
    });
  });

  it('không có khe value: hiện dấu gạch, không ném lỗi', async () => {
    const src = makeSource([]);
    const el = await mount(widgetItem('card', {}), src);
    expect(textOf(el, '.value')).toBe('—');
  });

  it('ARIA: role=group, aria-label gồm nhãn và giá trị', async () => {
    const src = makeSource([tagInfo('t1', { unit: 'bar' })]);
    src.set('t1', { value: 4.2, quality: 'GOOD' });
    const el = await mount(card({ label: 'Áp suất' }), src);
    const w = el.shadowRoot!.querySelector('.w')!;
    expect(w.getAttribute('role')).toBe('group');
    expect(w.getAttribute('aria-label')).toBe('Áp suất: 4.2 bar');
  });

  it('aria-label của quality xấu có thêm chữ quality', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 4.2, quality: 'BAD' });
    const el = await mount(card({ label: 'X' }), src);
    expect(el.shadowRoot!.querySelector('.w')!.getAttribute('aria-label')).toContain('BAD');
  });

  it('XSS (SC-020): tên Tag và nhãn chứa HTML hiện dạng chữ', async () => {
    const evil = '<script>window.__x=1</script>';
    const src = makeSource([tagInfo(evil)]);
    src.set(evil, { value: 1, quality: 'GOOD' });
    const el = await mount(card({ label: '"><img src=x onerror=window.__y=1>' }, evil), src);
    const root = el.shadowRoot!;
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(textOf(el, '.label')).toBe('"><img src=x onerror=window.__y=1>');
    const noLabel = await mount(card(undefined, evil), src);
    expect(noLabel.shadowRoot!.querySelector('.w')!.getAttribute('aria-label')).toContain(evil);
    expect(noLabel.shadowRoot!.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__x).toBeUndefined();
  });

  it('chế độ edit: khóa chuột bằng thuộc tính mode', async () => {
    const src = makeSource([tagInfo('t1')]);
    const el = await mount(card(), src, 'edit');
    expect(el.getAttribute('mode')).toBe('edit');
  });
});
