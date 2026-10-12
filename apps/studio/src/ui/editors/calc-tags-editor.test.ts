// Editor Tag tính toán (T184, ADR-016 điểm 4, FR-049, FR-047, mockup studio-tags.html v-vt): danh sách Tag tính toán, ô biểu thức
// có gợi ý và kiểm khi gõ, danh sách Tag đầu vào, xem trước kết quả (giá trị mô phỏng hoặc sống); kéo Tag từ Details vào ô biểu
// thức; thêm, đổi tên; một bước hoàn tác.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { FakeSession } from '../fake-session.ts';
import { cleanup, mount, newApp, newApp02, settled } from '../test-helpers.ts';
import './calc-tags-editor.ts';
import type { CalcTagsEditor } from './calc-tags-editor.ts';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const tags = (app: StudioApp) =>
  (app.store.state.outline.tags?.tags ?? []) as unknown as {
    id: string;
    kind: string;
    type: string;
    expression?: string;
  }[];
const expr = (app: StudioApp, id: string) => tags(app).find((x) => x.id === id)?.expression;
const ta = (el: Element) => el.querySelector<HTMLTextAreaElement>('textarea.ei-ta')!;
const items = (el: Element) => [...el.querySelectorAll('[data-role="calc-list"] [role="option"]')];

async function open(opts: Parameters<typeof newApp02>[0] = {}) {
  const env = await newApp02(opts);
  env.app.openEditor('calc');
  const el = await mount<CalcTagsEditor>('mat-calc-tags-editor', env.app);
  await settled(el);
  return { ...env, el };
}

async function typeExpr(el: Element, value: string) {
  ta(el).value = value;
  ta(el).setSelectionRange(value.length, value.length);
  ta(el).dispatchEvent(new InputEvent('input', { data: value.slice(-1), bubbles: true }));
  await settled(el);
}

describe('mat-calc-tags-editor: bố cục', () => {
  it('tiêu đề, danh sách Tag tính toán (id, kiểu), mục đầu được chọn, ô biểu thức hiện biểu thức của nó', async () => {
    const { app, el } = await open();
    expect(text(el.querySelector('h2'))).toBe('Tag tính toán');
    expect(el.querySelector('[data-role="calc-list"]')?.getAttribute('role')).toBe('listbox');
    expect(items(el).map((i) => text(i).split(' ')[0])).toEqual([
      'TANK01.VOLUME',
      'TANK01.HIGH',
      'PUMP01.STATE_TEXT',
    ]);
    expect(text(items(el)[1])).toContain('BOOL');
    expect(items(el)[0]!.getAttribute('aria-selected')).toBe('true');
    expect(ta(el).value).toBe('TANK01.LEVEL * 12.5');
    expect(text(el.querySelector('[data-role="count"]'))).toContain('3 Tag tính toán');
    // chọn mục đầu cũng chọn dòng trong Bảng Tag (Inspector theo đó)
    expect(app.store.state.selection).toEqual({ kind: 'tag', row: 8 });
  });

  it('chọn mục khác bằng chuột hoặc ↓ Enter: ô biểu thức đổi theo; danh sách là một điểm dừng Tab', async () => {
    const { app, el } = await open();
    (items(el)[1] as HTMLElement).click();
    await settled(el);
    expect(ta(el).value).toBe('TANK01.LEVEL > TANK01.SP_HI');
    expect(app.store.state.selection).toEqual({ kind: 'tag', row: 9 });
    const list = el.querySelector('[data-role="calc-list"]')!;
    expect(items(el).filter((i) => i.getAttribute('tabindex') === '0')).toHaveLength(1);
    list.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    await settled(el);
    expect(ta(el).value).toBe('text(PUMP01.STATE, TrangThaiBom)');
    list.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
    );
    await settled(el);
    expect(ta(el).value).toBe('TANK01.LEVEL * 12.5');
  });

  it('Tag đầu vào: liệt kê theo thứ tự xuất hiện; nhấp một Tag mở Bảng Tag ở dòng đó', async () => {
    const { app, el } = await open();
    (items(el)[1] as HTMLElement).click();
    await settled(el);
    const inputs = [...el.querySelectorAll('[data-role="inputs"] button')].map(text);
    expect(inputs).toEqual(['TANK01.LEVEL', 'TANK01.SP_HI']);
    (el.querySelector('[data-role="inputs"] button') as HTMLButtonElement).click();
    expect(app.store.state.active).toBe('tags');
    expect(app.takeReveal('tags')).toMatchObject({ row: 0 });
  });

  it('project chưa có Tag tính toán: báo trống, có nút thêm', async () => {
    const env = await newApp02();
    env.app.store.edit(
      tags(env.app)
        .map((x, i) => ({ x, i }))
        .filter(({ x }) => x.kind === 'calculated')
        .reverse()
        .map(({ i }) => ({ kind: 'tagRemove' as const, index: i })),
    );
    env.app.openEditor('calc');
    const el = await mount<CalcTagsEditor>('mat-calc-tags-editor', env.app);
    await settled(el);
    expect(el.querySelector('.empty')).not.toBeNull();
    expect(el.querySelector('button[data-act="add"]')).not.toBeNull();
  });
});

describe('mat-calc-tags-editor: sửa biểu thức', () => {
  it('gõ biểu thức mới: sau khi ngừng gõ ghi vào Tag (một bước hoàn tác, gộp các phím); Ctrl+Z trả lại', async () => {
    vi.useFakeTimers();
    const { app, el } = await open();
    const past = app.store.state.history.past.length;
    await typeExpr(el, 'TANK01.LEVEL * 2');
    await typeExpr(el, 'TANK01.LEVEL * 25');
    await vi.advanceTimersByTimeAsync(250);
    await settled(el);
    expect(expr(app, 'TANK01.VOLUME')).toBe('TANK01.LEVEL * 25');
    expect(app.store.state.history.past.length).toBe(past + 1);
    await app.run('edit.undo');
    await settled(el);
    expect(expr(app, 'TANK01.VOLUME')).toBe('TANK01.LEVEL * 12.5');
    expect(ta(el).value).toBe('TANK01.LEVEL * 12.5');
  });

  it('biểu thức sai: lỗi gạch tại ô kèm lý do, danh sách đánh dấu Tag có lỗi', async () => {
    vi.useFakeTimers();
    const { el } = await open();
    await typeExpr(el, 'TANK9.LEVEL * 2');
    await vi.advanceTimersByTimeAsync(250);
    await settled(el);
    expect(text(el.querySelector('[data-role="msg"]'))).toContain('Không có Tag “TANK9.LEVEL”');
    expect(items(el)[0]!.querySelector('.cx-bad')).not.toBeNull();
    expect(items(el)[1]!.querySelector('.cx-bad')).toBeNull();
  });

  it('vòng A ↔ B: lý do kèm đường vòng (SC-015)', async () => {
    vi.useFakeTimers();
    const { app, el } = await open();
    app.store.edit([
      {
        kind: 'tagUpsert',
        tag: { id: 'CA', kind: 'calculated', type: 'FLOAT64', expression: 'CB + 1' },
      },
      {
        kind: 'tagUpsert',
        tag: { id: 'CB', kind: 'calculated', type: 'FLOAT64', expression: '1' },
      },
    ]);
    await settled(el);
    const ids = items(el).map((i) => text(i).split(' ')[0]);
    (items(el)[ids.indexOf('CB')] as HTMLElement).click();
    await settled(el);
    await typeExpr(el, 'CA + 1');
    await vi.advanceTimersByTimeAsync(250);
    await settled(el);
    expect(text(el.querySelector('[data-role="msg"]'))).toContain('CB → CA → CB');
  });

  it('gợi ý tên Tag khi gõ trong ô biểu thức; Tag đang sửa không có trong gợi ý', async () => {
    const { el } = await open();
    await typeExpr(el, 'tank01.le');
    const opts = [...el.querySelectorAll('[role="option"]')]
      .filter((o) => o.closest('.ei'))
      .map(text);
    expect(opts[0]).toContain('TANK01.LEVEL');
    await typeExpr(el, 'tank01.vol');
    expect([...el.querySelectorAll('.ei [role="option"]')].map(text).join()).not.toContain(
      'TANK01.VOLUME',
    );
  });

  it('project 0.1 (chỉ đọc, chưa có Tag tính toán): báo cần nâng cấp, không có ô sửa', async () => {
    const env = await newApp();
    env.app.openEditor('calc');
    const el = await mount<CalcTagsEditor>('mat-calc-tags-editor', env.app);
    await settled(el);
    expect(text(el.querySelector('.empty'))).toContain('Nâng cấp lên 0.2');
    expect(el.querySelector('textarea')).toBeNull();
  });
});

describe('mat-calc-tags-editor: thêm, đổi tên, kéo Tag', () => {
  it('Thêm Tag tính toán: Tag mới (kind calculated, FLOAT64, biểu thức trống) được chọn, focus ở ô biểu thức; một bước hoàn tác', async () => {
    const { app, el } = await open();
    const n = tags(app).length;
    el.querySelector<HTMLButtonElement>('button[data-act="add"]')!.click();
    await settled(el);
    expect(tags(app)).toHaveLength(n + 1);
    const added = tags(app).at(-1)!;
    expect(added).toMatchObject({ kind: 'calculated', type: 'FLOAT64', expression: '' });
    expect(added.id).toBe('CALC_1');
    expect(app.store.state.selection).toEqual({ kind: 'tag', row: n });
    expect(items(el)).toHaveLength(4);
    await app.run('edit.undo');
    expect(tags(app)).toHaveLength(n);
  });

  it('nút Đổi tên Tag mở hộp thoại cho Tag đang chọn', async () => {
    const { app, el } = await open();
    el.querySelector<HTMLButtonElement>('button[data-act="rename"]')!.click();
    await settled(el);
    expect(app.ui.dialog).toEqual({ kind: 'renameTag', tagId: 'TANK01.VOLUME' });
  });

  it('kéo Tag từ Details thả vào ô biểu thức chèn tên tại con trỏ', async () => {
    const { app, el } = await open();
    await typeExpr(el, '2 * ');
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        getData: (t: string) => (t === 'application/x-mat-tag' ? 'TANK01.SP' : ''),
        types: ['application/x-mat-tag'],
      },
    });
    el.querySelector('.ei')!.dispatchEvent(drop);
    await settled(el);
    expect(ta(el).value).toBe('2 * TANK01.SP');
    void app;
  });
});

describe('mat-calc-tags-editor: xem trước kết quả', () => {
  it('chưa Online, chưa bật Mô phỏng: dùng giá trị mô phỏng (một lần); kết quả GOOD kèm giá trị từng đầu vào', async () => {
    const { el } = await open();
    expect(text(el.querySelector('[data-role="preview-source"]'))).toContain('giá trị mô phỏng');
    expect(text(el.querySelector('[data-role="preview-result"]'))).toContain('GOOD');
    const rows = [...el.querySelectorAll('[data-role="preview-inputs"] li')].map(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('TANK01.LEVEL');
  });

  it('đang Mô phỏng: kết quả theo giá trị của nguồn mô phỏng đang chạy', async () => {
    const { app, el } = await open();
    await app.run('tools.simulate');
    await settled(el);
    const level = app.readValue('TANK01.LEVEL')!.value as number;
    const result = text(el.querySelector('[data-role="preview-result"] b'));
    expect(Number(result.replace(',', '.'))).toBeCloseTo(level * 12.5, 2);
  });

  it('Online: dùng giá trị sống của thiết bị, có ghi nguồn; đầu vào BAD cho kết quả BAD kèm lý do tiếng Việt', async () => {
    const session = new FakeSession();
    const { el } = await open({ session });
    session.fakeValues.set('TANK01.LEVEL', { value: 40, quality: 'GOOD', ts: 1 });
    session.push({ type: 'values', tags: ['TANK01.LEVEL'] });
    await settled(el);
    expect(text(el.querySelector('[data-role="preview-source"]'))).toContain('giá trị sống');
    expect(text(el.querySelector('[data-role="preview-result"] b'))).toBe('500');
    session.fakeValues.set('TANK01.LEVEL', {
      value: null,
      quality: 'BAD',
      ts: 2,
      reason: 'TIMEOUT',
    });
    session.push({ type: 'values', tags: ['TANK01.LEVEL'] });
    await settled(el);
    expect(text(el.querySelector('[data-role="preview-result"]'))).toContain('BAD');
    expect(text(el.querySelector('[data-role="preview-result"]'))).toContain(
      'đầu vào của biểu thức không tốt',
    );
  });

  it('biểu thức lỗi: không tính, báo "chưa tính được"', async () => {
    vi.useFakeTimers();
    const { el } = await open();
    await typeExpr(el, 'KHONG.CO + 1');
    await vi.advanceTimersByTimeAsync(250);
    await settled(el);
    expect(text(el.querySelector('[data-role="preview-error"]'))).toContain('Chưa tính được');
    expect(el.querySelector('[data-role="preview-result"]')).toBeNull();
  });

  it('text() tra bảng giá trị: chữ theo giá trị đầu vào', async () => {
    const session = new FakeSession();
    const { el } = await open({ session });
    (items(el)[2] as HTMLElement).click();
    session.fakeValues.set('PUMP01.STATE', { value: 1, quality: 'GOOD', ts: 1 });
    session.push({ type: 'values', tags: ['PUMP01.STATE'] });
    await settled(el);
    expect(text(el.querySelector('[data-role="preview-result"] b'))).toBe('Chạy');
  });
});
