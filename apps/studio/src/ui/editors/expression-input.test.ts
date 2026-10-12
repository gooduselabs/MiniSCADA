// Ô nhập biểu thức (T184, ADR-016 điểm 4, FR-049, R22): `textarea` phủ lên lớp `pre` tô màu; chữ nhận qua bộ gõ (composition
// trên textarea); gạch dưới đúng span sau 200 ms ngừng gõ; danh sách gợi ý dùng được bằng bàn phím (↑, ↓, Enter, Tab, Esc);
// ARIA combobox.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistContext } from '../../model/expression-assist.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './expression-input.ts';
import type { ExpressionInput } from './expression-input.ts';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const ASSIST: AssistContext = {
  tags: [
    { id: 'TANK01.LEVEL', type: 'FLOAT32' },
    { id: 'TANK01.SP_HI', type: 'FLOAT32' },
    { id: 'TANK02.LEVEL', type: 'FLOAT32' },
    { id: 'PUMP01.STATE', type: 'UINT16' },
    { id: 'MODE', type: 'STRING' },
  ],
  tables: ['TrangThaiBom'],
  target: 'FLOAT64',
};

async function setup(
  value = '',
  assist: AssistContext = ASSIST,
  extra: Partial<ExpressionInput> = {},
) {
  const { app } = await newApp02();
  const el = await mount<ExpressionInput>('mat-expression-input', app);
  el.assist = assist;
  el.value = value;
  Object.assign(el, extra);
  await el.updateComplete;
  return { app, el };
}

const ta = (el: Element) => el.querySelector<HTMLTextAreaElement>('textarea.ei-ta')!;
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const options = (el: Element) => [...el.querySelectorAll('[role="option"]')].map(text);

/** Gõ chữ: đặt giá trị, đặt con trỏ ở cuối (hoặc `caret`), phát input. */
async function type(el: ExpressionInput, value: string, caret = value.length) {
  const area = ta(el);
  area.value = value;
  area.setSelectionRange(caret, caret);
  area.dispatchEvent(new InputEvent('input', { data: value.slice(-1), bubbles: true }));
  await settled(el);
}
const key = async (el: Element, k: string, init: KeyboardEventInit = {}) => {
  ta(el).dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
  );
  await settled(el);
};

describe('mat-expression-input: cấu trúc', () => {
  it('textarea phủ lên lớp pre tô màu; pre ẩn khỏi trình đọc màn hình; chữ thuộc về textarea', async () => {
    const { el } = await setup('text(PUMP01.STATE, TrangThaiBom) + 12');
    const pre = el.querySelector('pre.ei-hl')!;
    expect(pre.getAttribute('aria-hidden')).toBe('true');
    expect(pre.compareDocumentPosition(ta(el)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ta(el).value).toBe('text(PUMP01.STATE, TrangThaiBom) + 12');
    expect(ta(el).getAttribute('spellcheck')).toBe('false');
    expect(text(pre)).toBe('text(PUMP01.STATE, TrangThaiBom) + 12');
  });

  it('tô màu theo loại token: hàm, Tag, bảng giá trị, số', async () => {
    const { el } = await setup('text(PUMP01.STATE, TrangThaiBom) + 12');
    const cls = (c: string) => text(el.querySelector(`.ei-hl .${c}`));
    expect(cls('t-fn')).toBe('text');
    expect(cls('t-tag')).toBe('PUMP01.STATE');
    expect(cls('t-tab')).toBe('TrangThaiBom');
    expect(cls('t-num')).toBe('12');
  });

  it('có nhãn truy cập, không phủ lên nhau: textarea chiếm đúng khung của pre', async () => {
    const { el } = await setup('A', ASSIST, { label: 'Biểu thức' });
    expect(ta(el).getAttribute('aria-label')).toBe('Biểu thức');
    expect(ta(el).getAttribute('role')).toBe('combobox');
    expect(ta(el).getAttribute('aria-autocomplete')).toBe('list');
    expect(ta(el).getAttribute('aria-expanded')).toBe('false');
    expect(ta(el).getAttribute('aria-controls')).toBeTruthy();
  });

  it('chỉ đọc: không sửa được, không gợi ý', async () => {
    const { el } = await setup('A', ASSIST, { disabled: true });
    expect(ta(el).readOnly || ta(el).disabled).toBe(true);
    await type(el, 'tank');
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe('mat-expression-input: gợi ý bằng bàn phím', () => {
  it('gõ tank01.le: danh sách combobox mở, aria-expanded true, mục đầu là TANK01.LEVEL', async () => {
    const { el } = await setup();
    await type(el, 'tank01.le');
    expect(ta(el).getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('[role="listbox"]')?.id).toBe(ta(el).getAttribute('aria-controls'));
    expect(options(el)[0]).toContain('TANK01.LEVEL');
    expect(options(el)).toHaveLength(1);
  });

  it('↓ ↑ chọn mục (aria-activedescendant, aria-selected); Enter nhận: thay đúng từ đang gõ, con trỏ đặt sau tên', async () => {
    const { el } = await setup();
    const seen: string[] = [];
    el.addEventListener('expr-input', (e) =>
      seen.push((e as CustomEvent<{ value: string }>).detail.value),
    );
    await type(el, 'X + tank0', 9);
    expect(options(el)).toHaveLength(3);
    await key(el, 'ArrowDown');
    await key(el, 'ArrowDown');
    const active = ta(el).getAttribute('aria-activedescendant')!;
    expect(el.querySelector(`#${active}`)?.getAttribute('aria-selected')).toBe('true');
    expect(text(el.querySelector(`#${active}`))).toContain('TANK01.SP_HI');
    await key(el, 'ArrowUp');
    await key(el, 'Enter');
    expect(ta(el).value).toBe('X + TANK01.LEVEL');
    expect(ta(el).selectionStart).toBe('X + TANK01.LEVEL'.length);
    expect(el.querySelector('[role="listbox"]')).toBeNull();
    expect(seen.at(-1)).toBe('X + TANK01.LEVEL');
  });

  it('Tab nhận mục sáng (mặc định mục đầu); Esc đóng danh sách và giữ nguyên chữ', async () => {
    const { el } = await setup();
    await type(el, 'pump');
    await key(el, 'Tab');
    expect(ta(el).value).toBe('PUMP01.STATE');
    await type(el, 'PUMP01.STATE + tank02', 21);
    expect(options(el).length).toBeGreaterThan(0);
    await key(el, 'Escape');
    expect(el.querySelector('[role="listbox"]')).toBeNull();
    expect(ta(el).value).toBe('PUMP01.STATE + tank02');
    expect(ta(el).getAttribute('aria-expanded')).toBe('false');
  });

  it('Enter khi chưa có danh sách là xuống dòng (biểu thức nhiều dòng), không nhận gợi ý', async () => {
    const { el } = await setup('A');
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    ta(el).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('nhấp chuột vào một mục nhận mục đó; hàm chèn kèm dấu mở ngoặc; tên bảng trong text(', async () => {
    const { el } = await setup();
    await type(el, 'cla');
    (el.querySelector('[role="option"]') as HTMLElement).dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    await settled(el);
    expect(ta(el).value).toBe('clamp(');
    await type(el, 'text(PUMP01.STATE, tr');
    expect(options(el)[0]).toContain('TrangThaiBom');
  });

  it('mục hàm hiện cú pháp; con trỏ giữa chuỗi chữ không gợi ý', async () => {
    const { el } = await setup();
    await type(el, 'ro');
    expect(options(el).some((o) => o.includes('round(x) | round(x, n)'))).toBe(true);
    await type(el, 'MODE == "tan');
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe('mat-expression-input: bộ gõ (IME)', () => {
  it('đang ghép: chưa gợi ý, Enter không nhận; compositionend rồi mới gợi ý', async () => {
    const { el } = await setup();
    ta(el).dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    ta(el).value = 'tank0';
    ta(el).setSelectionRange(5, 5);
    ta(el).dispatchEvent(new InputEvent('input', { data: 'k', isComposing: true, bubbles: true }));
    await settled(el);
    expect(el.querySelector('[role="listbox"]')).toBeNull();
    // chữ vẫn được tô màu ngay (lớp pre theo textarea)
    expect(text(el.querySelector('.ei-hl'))).toBe('tank0');
    ta(el).dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'tank0' }));
    await settled(el);
    expect(options(el).length).toBeGreaterThan(0);
    ta(el).dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settled(el);
    expect(ta(el).value).toBe('tank0');
  });

  it('Esc khi đang ghép thuộc về bộ gõ: không đóng danh sách của mình', async () => {
    const { el } = await setup();
    await type(el, 'tank');
    ta(el).dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    ta(el).dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settled(el);
    expect(el.querySelector('[role="listbox"]')).not.toBeNull();
  });
});

describe('mat-expression-input: kiểm sau 200 ms ngừng gõ (SC-015)', () => {
  beforeEach(() => vi.useFakeTimers());

  it('lỗi hiện đúng span sau 200 ms; chưa đủ 200 ms thì chưa có; lý do nói rõ; aria-invalid, aria-describedby', async () => {
    const { el } = await setup();
    const checks: string[] = [];
    el.addEventListener('expr-check', (e) =>
      checks.push(
        (e as CustomEvent<{ problem: { code: string } | null }>).detail.problem?.code ?? 'ok',
      ),
    );
    await type(el, 'TANK9.LEVEL * 2');
    await vi.advanceTimersByTimeAsync(150);
    await settled(el);
    expect(el.querySelector('.ei-hl .t-err')).toBeNull();
    expect(checks).toEqual([]);
    await vi.advanceTimersByTimeAsync(60);
    await settled(el);
    expect(text(el.querySelector('.ei-hl .t-err'))).toBe('TANK9.LEVEL');
    const msg = el.querySelector('[data-role="msg"]')!;
    expect(msg.getAttribute('role')).toBe('alert');
    expect(text(msg)).toContain('Không có Tag “TANK9.LEVEL”');
    expect(ta(el).getAttribute('aria-invalid')).toBe('true');
    expect(ta(el).getAttribute('aria-describedby')).toBe(msg.id);
    expect(checks).toEqual(['E_EXPR_UNKNOWN_TAG']);
  });

  it('sửa đúng thì hết gạch và báo hợp lệ (role status); mỗi phím đặt lại hẹn giờ, chỉ kiểm bản cuối', async () => {
    const { el } = await setup();
    const checks: string[] = [];
    el.addEventListener('expr-check', () => checks.push('check'));
    await type(el, 'TANK9');
    await vi.advanceTimersByTimeAsync(150);
    await type(el, 'TANK01.LEVEL');
    await vi.advanceTimersByTimeAsync(150);
    expect(checks).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(80);
    await settled(el);
    expect(checks).toHaveLength(1);
    expect(el.querySelector('.ei-hl .t-err')).toBeNull();
    expect(el.querySelector('[data-role="msg"]')?.getAttribute('role')).toBe('status');
    expect(ta(el).getAttribute('aria-invalid')).toBe('false');
  });

  it('vòng tham chiếu: lý do kèm đường vòng', async () => {
    const { el } = await setup('', {
      ...ASSIST,
      tags: [...ASSIST.tags, { id: 'A', type: 'FLOAT64' }, { id: 'B', type: 'FLOAT64' }],
      self: 'A',
      calcs: [{ id: 'B', inputs: ['A'] }],
    });
    await type(el, 'B + 1');
    await vi.advanceTimersByTimeAsync(210);
    await settled(el);
    expect(text(el.querySelector('[data-role="msg"]'))).toContain('A → B → A');
  });

  it('blur xác nhận ngay (expr-commit) và kiểm ngay không đợi 200 ms', async () => {
    const { el } = await setup();
    const commits: string[] = [];
    el.addEventListener('expr-commit', (e) =>
      commits.push((e as CustomEvent<{ value: string }>).detail.value),
    );
    await type(el, 'TANK9 + 1');
    ta(el).dispatchEvent(new FocusEvent('blur'));
    await settled(el);
    expect(commits).toEqual(['TANK9 + 1']);
    expect(el.querySelector('.ei-hl .t-err')).not.toBeNull();
  });
});

describe('mat-expression-input: kéo Tag từ Details', () => {
  it('thả application/x-mat-tag chèn tên Tag tại con trỏ', async () => {
    const { el } = await setup('A +  * 2');
    ta(el).setSelectionRange(4, 4);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        getData: (t: string) => (t === 'application/x-mat-tag' ? 'TANK01.LEVEL' : ''),
        types: ['application/x-mat-tag'],
      },
    });
    el.querySelector('.ei')!.dispatchEvent(drop);
    await settled(el);
    expect(ta(el).value).toBe('A + TANK01.LEVEL * 2');
  });
});
