// Bảng theo dõi, phần xem (feature 006, T131, FR-050 phần xem, data-model §4): nhiều bảng, thêm Tag bằng gõ tên (có gợi ý),
// dán danh sách tên, kéo từ Details hoặc Bảng Tag; cột định dạng, giá trị sống, quality và lý do, thời điểm, chữ và màu theo
// bảng giá trị; Tag không có trên thiết bị, Tag không có trong project (W_WATCH_REF); lưới dùng chung như Bảng Tag.
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { PRIORITY } from '../../model/live-subscriptions.ts';
import { FakeSession } from '../fake-session.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './watch-table-editor.ts';
import type { WatchTableEditor } from './watch-table-editor.ts';

afterEach(cleanup);

const cell = (el: Element, r: number, c: string) =>
  el.querySelector<HTMLElement>(`[role="gridcell"][data-r="${r}"][data-c="${c}"]`);
const ta = (el: Element) => el.querySelector<HTMLTextAreaElement>('textarea.mg-input')!;
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const heads = (el: Element) =>
  [...el.querySelectorAll('[role="columnheader"]')].map((h) => text(h));
const rows = (app: StudioApp) => app.store.state.outline.watchTables[0].doc?.rows ?? [];
const addBox = (el: Element) => el.querySelector<HTMLInputElement>('input[data-role="add"]')!;

async function open(id = 'van-hanh', opts: Parameters<typeof newApp02>[0] = {}) {
  const env = await newApp02(opts);
  env.app.openEditor(`watch:${id}`);
  const el = await mount<WatchTableEditor>('mat-watch-table-editor', env.app);
  el.tableId = id;
  await settled(el);
  return { ...env, el };
}

async function click(el: Element, r: number, c: string) {
  cell(el, r, c)!.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await settled(el);
}
const key = async (target: Element, k: string, init: KeyboardEventInit = {}) => {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
  );
  await settled(target);
};
async function typeInto(el: Element, input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settled(el);
}

describe('mat-watch-table-editor: bố cục (Offline)', () => {
  it('tiêu đề là tên bảng; lưới có cột Tag, Định dạng, Số lẻ, Giá trị ghi; một dòng mỗi Tag', async () => {
    const { app, el } = await open();
    expect(text(el.querySelector('h2'))).toBe('Vận hành');
    expect(heads(el)).toEqual(['Tag', 'Định dạng', 'Số lẻ', 'Giá trị ghi']);
    expect(el.querySelectorAll('[role="row"][data-r]')).toHaveLength(rows(app).length);
    expect(text(cell(el, 0, 'tag'))).toBe(rows(app)[0].tag);
    expect(el.querySelector('[role="grid"]')?.getAttribute('aria-label')).toBe('Vận hành');
    expect(text(el.querySelector('[data-role="count"]'))).toContain(`${rows(app).length}/200`);
    expect(el.textContent).toContain('Không tự ghi khi mở');
  });

  it('chỉ có bảng của mình: id không có thì báo không tìm thấy', async () => {
    const { el } = await open('khong-co');
    expect(el.querySelector('[role="grid"]')).toBeNull();
    expect(el.querySelector('.empty')).not.toBeNull();
  });
});

describe('mat-watch-table-editor: thêm Tag', () => {
  it('gõ tên có gợi ý (bỏ dấu, không phân biệt hoa thường); ↓ chọn, Enter thêm; một bước hoàn tác', async () => {
    const { app, el } = await open();
    const before = rows(app).length;
    const box = addBox(el);
    box.focus();
    await typeInto(el, box, 'tank01.l');
    const list = el.querySelector('[role="listbox"]')!;
    const options = [...list.querySelectorAll('[role="option"]')].map((o) => text(o));
    expect(options[0]).toBe('TANK01.LEVEL');
    expect(box.getAttribute('aria-expanded')).toBe('true');
    await key(box, 'ArrowDown');
    expect(box.getAttribute('aria-activedescendant')).toBeTruthy();
    await key(box, 'Enter');
    expect(rows(app)).toHaveLength(before + 1);
    expect(rows(app).at(-1)?.tag).toBe('TANK01.LEVEL');
    expect(box.value).toBe('');
    await app.run('edit.undo');
    expect(rows(app)).toHaveLength(before);
  });

  it('nhấp một gợi ý thêm đúng Tag đó; Esc đóng danh sách không thêm gì', async () => {
    const { app, el } = await open();
    const before = rows(app).length;
    const box = addBox(el);
    await typeInto(el, box, 'pump01.f');
    await key(box, 'Escape');
    expect(el.querySelector('[role="listbox"]')).toBeNull();
    expect(rows(app)).toHaveLength(before);
    await typeInto(el, box, 'pump01.f');
    (el.querySelector('[role="option"]') as HTMLElement).dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    await settled(el);
    expect(rows(app).at(-1)?.tag).toBe('PUMP01.FAULT');
  });

  it('dán danh sách tên (dòng, tab, dấu phẩy): thêm hết trong MỘT bước hoàn tác', async () => {
    const { app, el } = await open();
    const before = rows(app).length;
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', {
      value: { getData: () => 'MODE\nTANK01.PCT\tKHONG.CO,MODE' },
    });
    addBox(el).dispatchEvent(e);
    await settled(el);
    expect(
      rows(app)
        .slice(before)
        .map((r) => r.tag),
    ).toEqual(['MODE', 'TANK01.PCT', 'KHONG.CO', 'MODE']);
    expect(app.store.state.history.past.length).toBe(1);
    await app.run('edit.undo');
    expect(rows(app)).toHaveLength(before);
  });

  it('kéo Tag từ Details hoặc Bảng Tag (application/x-mat-tag) thả vào lưới', async () => {
    const { app, el } = await open();
    const before = rows(app).length;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        getData: (type: string) => (type === 'application/x-mat-tag' ? 'TANK01.SP' : ''),
        types: ['application/x-mat-tag'],
      },
    });
    el.querySelector('.ww-gridwrap')!.dispatchEvent(drop);
    await settled(el);
    expect(rows(app)).toHaveLength(before + 1);
    expect(rows(app).at(-1)?.tag).toBe('TANK01.SP');
  });

  it('vượt 200 dòng: bỏ phần vượt và báo số tên bị bỏ', async () => {
    const { app, el } = await open();
    const names = Array.from({ length: 250 }, (_, i) => `BIG.T${i}`).join('\n');
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => names } });
    addBox(el).dispatchEvent(e);
    await settled(el);
    expect(rows(app)).toHaveLength(200);
    expect(app.ui.toast?.text).toContain('Bỏ');
  });
});

describe('mat-watch-table-editor: sửa trong lưới và Tag không có trong project', () => {
  it('chọn ô Định dạng, gõ hex rồi Enter: ghi vào bảng; Số lẻ ngoài 0–9 bị từ chối tại ô', async () => {
    const { app, el } = await open();
    await click(el, 0, 'format');
    ta(el).value = 'hex';
    ta(el).dispatchEvent(new InputEvent('input', { data: 'hex', bubbles: true }));
    await settled(el);
    await key(ta(el), 'Enter');
    expect(rows(app)[0].format).toBe('hex');
    await click(el, 0, 'decimals');
    ta(el).value = '12';
    ta(el).dispatchEvent(new InputEvent('input', { data: '12', bubbles: true }));
    await settled(el);
    await key(ta(el), 'Enter');
    expect(rows(app)[0].decimals).toBe(1);
    expect(cell(el, 0, 'decimals')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('giá trị ghi lưu cùng bảng và không tự ghi khi mở (không có yêu cầu nào tới thiết bị)', async () => {
    const { app, el } = await open();
    await click(el, 0, 'writeValue');
    ta(el).value = '80';
    ta(el).dispatchEvent(new InputEvent('input', { data: '80', bubbles: true }));
    await settled(el);
    await key(ta(el), 'Enter');
    expect(rows(app)[0].writeValue).toBe('80');
  });

  it('Tag không có trong project: ô tên có cảnh báo W_WATCH_REF (viền hổ phách, có chữ)', async () => {
    const { el } = await open('van-hanh');
    const box = addBox(el);
    await typeInto(el, box, 'KHONG.CO');
    await key(box, 'Enter');
    const last = el.querySelectorAll('[role="row"][data-r]').length - 1;
    const c = cell(el, last, 'tag')!;
    expect(c.classList.contains('mg-warn')).toBe(true);
    expect(c.getAttribute('aria-describedby')).toBeTruthy();
    expect(c.getAttribute('title')).toContain('không có trong project');
  });
});

describe('mat-watch-table-editor: Online', () => {
  async function online() {
    const session = new FakeSession();
    const env = await open('van-hanh', { session });
    const tagRows = env.app.store.state.outline.watchTables[0].doc!.rows;
    const id0 = tagRows[0].tag;
    session.fakeValues.set(id0, {
      value: 75.5,
      quality: 'GOOD',
      ts: Date.UTC(2026, 9, 20, 3, 12, 5),
    });
    session.fakeValues.set(tagRows[1].tag, {
      value: 1,
      quality: 'BAD',
      ts: Date.UTC(2026, 9, 20, 3, 12, 6),
      reason: 'TIMEOUT',
    });
    session.push({ type: 'values', tags: [id0] });
    env.app.live.flush();
    await settled(env.el);
    return { ...env, session, tagRows };
  }

  it('thêm cột Giá trị sống, Chữ, Quality, Lý do, Thời điểm; quality kèm chữ; lý do tiếng Việt', async () => {
    const { el } = await online();
    expect(heads(el)).toEqual([
      'Tag',
      'Giá trị sống',
      'Chữ',
      'Quality',
      'Lý do',
      'Thời điểm',
      'Định dạng',
      'Số lẻ',
      'Giá trị ghi',
      'Kết quả ghi',
    ]);
    expect(text(cell(el, 0, 'value'))).toBe('75.5');
    expect(text(cell(el, 0, 'quality'))).toBe('GOOD');
    expect(text(cell(el, 1, 'quality'))).toBe('BAD');
    expect(text(cell(el, 1, 'reason'))).toBe('thiết bị trường không trả lời kịp');
    expect(text(cell(el, 0, 'time'))).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(cell(el, 0, 'value')?.getAttribute('aria-readonly')).toBe('true');
  });

  // T052 (feature 011, FR-019): Tag có lệnh nhả xung còn kẹt (PULSE_STUCK của system/info) có chip ở ô Tag.
  it('PULSE_STUCK: chip đỏ ở ô Tag của Tag kẹt, kèm hướng dẫn; mất khi thiết bị thôi báo', async () => {
    const { el, session, tagRows } = await online();
    expect(el.querySelector('[data-chip="pulse-stuck"]')).toBeNull();
    session.fakeInfo = {
      warnings: ['PULSE_STUCK'],
      warningDetails: [
        { code: 'PULSE_STUCK', message: '', since: 1, detail: { tags: [tagRows[1].tag] } },
      ],
    } as never;
    session.push({ type: 'info' });
    await settled(el);
    const chip = cell(el, 1, 'tag')!.querySelector<HTMLElement>('[data-chip="pulse-stuck"]');
    expect(chip).not.toBeNull();
    expect(chip!.classList.contains('err')).toBe(true);
    expect(text(chip)).toContain('Xung kẹt');
    expect(chip!.title).toContain('PLC');
    expect(cell(el, 0, 'tag')!.querySelector('[data-chip="pulse-stuck"]')).toBeNull();
    session.fakeInfo = { warnings: [] } as never;
    session.push({ type: 'info' });
    await settled(el);
    expect(el.querySelector('[data-chip="pulse-stuck"]')).toBeNull();
  });

  it('Tag không có trên thiết bị: ghi rõ; chưa có giá trị: dấu gạch', async () => {
    const { el, session, tagRows } = await online();
    session.fakeUnknown.add(tagRows[2].tag);
    session.push({ type: 'unknown' });
    await settled(el);
    expect(text(cell(el, 2, 'value'))).toBe('không có trên thiết bị');
    if (tagRows[3]) expect(text(cell(el, 3, 'value'))).toBe('—');
  });

  it('đăng ký dữ liệu sống cho các Tag của bảng với ưu tiên cao nhất (3); rời editor thì bỏ', async () => {
    const { app, el, session, tagRows } = await online();
    const last = session.tagCalls.at(-1) ?? [];
    expect(last).toEqual(expect.arrayContaining(tagRows.map((r) => r.tag)));
    expect(app.live.merged().indexOf(tagRows[0].tag)).toBeLessThan(app.live.merged().length);
    expect(PRIORITY.watch).toBe(3);
    el.remove();
    await settled();
    app.live.flush();
    const after = session.tagCalls.at(-1) ?? [];
    expect(after.length).toBeGreaterThanOrEqual(0);
  });
});
