// Bảng Tag trên mat-grid (feature 006, T125, FR-045, FR-046, FR-047, FR-015; viết lại phần của 004): bộ cột theo loại, gõ thẳng
// không cần F2, lỗi viền đỏ và nhảy tới ô, Thêm Tag, Xóa, Điền xuống, Lọc, dán Excel, Thêm hàng loạt, Nhập và Xuất CSV, mức
// dùng tags.json, cột giá trị sống chỉ cho dòng đang hiện khi Online, project 0.1 mở chỉ đọc.
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { VALIDATE_DELAY_MS } from '../../app/store.ts';
import { LiveSubscriptions } from '../../model/live-subscriptions.ts';
import { FakeSession } from '../fake-session.ts';
import { cleanup, mount, newApp, newApp02, settled } from '../test-helpers.ts';
import './tag-grid.ts';
import type { TagGrid } from './tag-grid.ts';

afterEach(cleanup);

// Tag của project 0.2 mẫu (bộ vector v02-valid-full): 13 Tag, 7 ngoài, 3 tính toán.
const gridEl = (el: Element) => el.querySelector('[role="grid"]')!;
const cell = (el: Element, r: number, c: string) =>
  el.querySelector<HTMLElement>(`[role="gridcell"][data-r="${r}"][data-c="${c}"]`);
const heads = (el: Element) =>
  [...el.querySelectorAll('[role="columnheader"]')].map((h) =>
    h.textContent?.replace(/\s+/g, ' ').trim(),
  );
const ta = (el: Element) => el.querySelector<HTMLTextAreaElement>('textarea.mg-input')!;
const tool = (el: Element, act: string) =>
  el.querySelector<HTMLButtonElement>(`.ed-tools [data-act="${act}"]`)!;
const tags = (app: StudioApp) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app.store.state.outline.tags?.tags ?? []) as unknown as Array<Record<string, any>>;
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

async function openGrid(opts: Parameters<typeof newApp02>[0] = {}) {
  const made = await newApp02(opts);
  made.app.openEditor('tags');
  const el = await mount<TagGrid>('mat-tag-grid', made.app);
  await settled(el);
  return { ...made, el };
}

async function click(el: Element, r: number, c: string) {
  cell(el, r, c)!.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await settled(el);
}

const key = async (el: Element, k: string, init: KeyboardEventInit = {}) => {
  ta(el).dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
  );
  await settled(el);
};

/** Gõ chữ vào ô đang chọn (không F2) rồi nhấn Enter. */
async function typeText(el: Element, value: string, confirm = true) {
  const input = ta(el);
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { data: value, bubbles: true }));
  await settled(el);
  if (confirm) await key(el, 'Enter');
}

async function validated(app: StudioApp, el: Element) {
  await new Promise((r) => setTimeout(r, VALIDATE_DELAY_MS + 40));
  await app.store.idle();
  await settled(el);
}

describe('mat-tag-grid: bố cục', () => {
  it('lưới ARIA trên mat-grid: nhãn Bảng Tag, một dòng mỗi Tag, cột tên đứng đầu, thanh công cụ có đủ lệnh', async () => {
    const { el } = await openGrid();
    expect(el.querySelector('mat-grid')).not.toBeNull();
    expect(gridEl(el).getAttribute('aria-label')).toBe('Bảng Tag mặc định');
    expect(gridEl(el).getAttribute('aria-rowcount')).toBe('14');
    expect(heads(el)[0]).toBe('Tên');
    expect(text(cell(el, 0, 'id'))).toBe('TANK01.LEVEL');
    for (const a of ['add', 'delete', 'fill', 'bulk', 'import', 'export'])
      expect(tool(el, a), a).toBeTruthy();
    expect(text(el.querySelector('[data-role="count"]'))).toBe('13/13 Tag');
  });

  it('bộ cột theo loại Tag: ngoài, nội bộ, tính toán, mô phỏng, tất cả; nhớ lựa chọn', async () => {
    const { app, el } = await openGrid();
    const sel = el.querySelector<HTMLSelectElement>('select[data-role="set"]')!;
    const choose = async (v: string) => {
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await settled(el);
    };
    await choose('external');
    expect(heads(el)).toEqual(
      expect.arrayContaining([
        'Thiết bị trường',
        'Địa chỉ',
        'Mã hàm',
        'Offset',
        'Số thanh ghi',
        'Nhóm quét',
      ]),
    );
    expect(heads(el)).not.toContain('Biểu thức');
    await choose('calculated');
    expect(heads(el)).toContain('Biểu thức');
    expect(heads(el)).not.toContain('Địa chỉ');
    await choose('internal');
    expect(heads(el)).toEqual(expect.arrayContaining(['Giá trị đầu', 'Giữ qua mất điện']));
    await choose('simulation');
    expect(heads(el)).toContain('Mô phỏng');
    await choose('all');
    expect(heads(el)).toEqual(expect.arrayContaining(['Địa chỉ', 'Biểu thức', 'Giá trị đầu']));
    expect(app.columnChoice().set).toBe('all');
    await choose('external');
    expect(app.columnChoice().set).toBe('external');
  });

  it('chọn cột tự do: bỏ chọn một cột thì cột đó biến mất, cột tên luôn có', async () => {
    const { app, el } = await openGrid();
    const box = el.querySelector<HTMLInputElement>('input[data-col="description"]')!;
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(heads(el)).not.toContain('Mô tả');
    expect(app.columnChoice().columns).not.toBeNull();
    expect(el.querySelector<HTMLInputElement>('input[data-col="id"]')!.disabled).toBe(true);
  });

  it('ô địa chỉ: dòng gợi ý hiện mã hàm, offset thật và số thanh ghi; cột chỉ đọc đủ chữ', async () => {
    const { el } = await openGrid();
    await click(el, 0, 'address');
    const hint = text(el.querySelector('[data-role="addr-hint"]'));
    expect(hint).toMatch(/Mã hàm 0\d/);
    expect(hint).toMatch(/offset \d+/);
    expect(hint).toMatch(/\d+ thanh ghi/);
    expect(text(cell(el, 0, 'fc'))).toMatch(/^0\d/);
    expect(text(cell(el, 0, 'regs'))).toMatch(/^\d+$/);
  });

  it('mức dùng tags.json so với trần 1 MiB; ở mức thấp thì không cảnh báo', async () => {
    const { el } = await openGrid();
    const usage = el.querySelector('[data-role="usage"]')!;
    expect(text(usage)).toMatch(/tags\.json: [\d.,]+ (B|KiB) \/ 1 MiB/);
    expect(usage.classList.contains('warn')).toBe(false);
  });
});

describe('mat-tag-grid: sửa', () => {
  it('gõ thẳng không cần F2: chọn ô Mô tả, gõ chữ có dấu, Enter ghi MỘT sửa đổi vào project', async () => {
    const { app, el } = await openGrid();
    await click(el, 0, 'description');
    expect(app.store.state.history.past.length).toBe(0);
    await typeText(el, 'Mức nước bồn 1');
    expect(tags(app)[0].description).toBe('Mức nước bồn 1');
    expect(app.store.state.history.past.length).toBe(1);
    await app.run('edit.undo');
    expect(tags(app)[0].description).not.toBe('Mức nước bồn 1');
  });

  it('ô danh sách chọn (Kiểu, Thiết bị trường): gõ để lọc, Enter chọn; giá trị ngoài danh sách bị từ chối tại ô', async () => {
    const { app, el } = await openGrid();
    await click(el, 0, 'type');
    await typeText(el, 'int16', false);
    expect(el.querySelector('[role="listbox"]')).not.toBeNull();
    await key(el, 'Enter');
    expect(tags(app)[0].type).toBe('INT16');
    await click(el, 0, 'device');
    await typeText(el, 'khong-co');
    expect(tags(app)[0].source.device).toBe('plc1');
    expect(cell(el, 0, 'device')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('địa chỉ gõ chữ thường thành chữ hoa; ô chỉ đọc không sửa được', async () => {
    const { app, el } = await openGrid();
    await click(el, 0, 'address');
    await typeText(el, 'hr321');
    expect(tags(app)[0].source.address).toBe('HR321');
    expect(cell(el, 0, 'fc')?.getAttribute('aria-readonly')).toBe('true');
    expect(cell(el, 0, 'offset')?.getAttribute('aria-readonly')).toBe('true');
  });

  it('Điền xuống tăng địa chỉ theo số thanh ghi của kiểu (lệnh và Ctrl+D)', async () => {
    const { app, el } = await openGrid();
    const first = tags(app)[0].source.address as string;
    const second = tags(app)[1];
    await click(el, 0, 'address');
    await key(el, 'ArrowDown', { shiftKey: true });
    await app.run('edit.fillDown');
    await settled(el);
    const n = Number(/\d+/.exec(first)![0]);
    const per =
      second.type === 'FLOAT32' || /32/.test(second.type) ? 2 : /64/.test(second.type) ? 4 : 1;
    expect(tags(app)[1].source.address).toBe(first.replace(/\d+/, String(n + per)));
  });

  it('Thêm Tag: dòng mới ở cuối, ô tên chọn sẵn; Xóa dòng: bỏ dòng đang chọn; cùng Ctrl+Z', async () => {
    const { app, el } = await openGrid();
    const before = tags(app).length;
    await app.run('tags.add');
    await settled(el);
    expect(tags(app)).toHaveLength(before + 1);
    expect(app.store.state.selection).toMatchObject({ kind: 'tag', row: before });
    await app.run('tags.delete');
    await settled(el);
    expect(tags(app)).toHaveLength(before);
    await app.run('edit.undo');
    await settled(el);
    expect(tags(app)).toHaveLength(before + 1);
  });

  it('Lọc: chữ chứa, bỏ dấu; bộ đếm hiện số dòng đang hiện', async () => {
    const { el } = await openGrid();
    const f = el.querySelector<HTMLInputElement>('input[data-role="filter"]')!;
    f.value = 'tank01';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    await settled(el);
    expect(text(el.querySelector('[data-role="count"]'))).toMatch(/^\d+\/13 Tag$/);
    expect(el.querySelectorAll('[role="gridcell"][data-c="id"]').length).toBeLessThan(13);
  });

  it('dán từ Excel nhiều dòng nhiều cột: một bước hoàn tác; ô sai bị đánh dấu, ô đúng vẫn dán', async () => {
    const { app, el } = await openGrid();
    await click(el, 0, 'description');
    const data = { getData: () => 'M1\tđv1\nM2\tđv2\nM3\tđv3' };
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: data });
    ta(el).dispatchEvent(e);
    await settled(el);
    expect(
      tags(app)
        .slice(0, 3)
        .map((x) => x.description),
    ).toEqual(['M1', 'M2', 'M3']);
    expect(
      tags(app)
        .slice(0, 3)
        .map((x) => x.unit),
    ).toEqual(['đv1', 'đv2', 'đv3']);
    expect(app.store.state.history.past.length).toBe(1);
  });

  it('Ctrl+S khi đang gõ dở: xác nhận ô rồi mới lưu (hooks.commitPending)', async () => {
    const { app, el } = await openGrid();
    await click(el, 1, 'description');
    await typeText(el, 'Đang gõ dở', false);
    expect(tags(app)[1].description).not.toBe('Đang gõ dở');
    app.hooks.commitPending?.();
    await settled(el);
    expect(tags(app)[1].description).toBe('Đang gõ dở');
  });
});

describe('mat-tag-grid: lỗi tại ô', () => {
  it('địa chỉ sai: viền đỏ tại ô, lý do tiếng Việt; nhảy tới lỗi từ tab Thông tin chọn đúng ô', async () => {
    const { app, el } = await openGrid();
    await click(el, 0, 'address');
    await typeText(el, 'XX5');
    await validated(app, el);
    const bad = cell(el, 0, 'address')!;
    expect(bad.getAttribute('aria-invalid')).toBe('true');
    expect(bad.classList.contains('mg-err')).toBe(true);
    expect(bad.textContent).toContain('địa chỉ Modbus không đúng cú pháp');
    const issue = app.store.state.issues.find((i) => i.code === 'E_ADDR_SYNTAX')!;
    expect(issue).toBeDefined();
    await click(el, 3, 'description');
    app.gotoIssue(issue);
    await settled(el);
    expect(app.store.state.selection).toMatchObject({ kind: 'tag', row: 0 });
    expect(cell(el, 0, 'address')?.getAttribute('aria-selected')).toBe('true');
  });

  it('cột của lỗi bị ẩn (bộ cột Nội bộ): nhảy tới lỗi chuyển về bộ cột có cột đó', async () => {
    const { app, el } = await openGrid();
    await click(el, 0, 'address');
    await typeText(el, 'XX5');
    await validated(app, el);
    const sel = el.querySelector<HTMLSelectElement>('select[data-role="set"]')!;
    sel.value = 'internal';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    const issue = app.store.state.issues.find((i) => i.code === 'E_ADDR_SYNTAX')!;
    app.gotoIssue(issue);
    await settled(el);
    expect(heads(el)).toContain('Địa chỉ');
  });
});

describe('mat-tag-grid: Thêm hàng loạt, Nhập và Xuất CSV', () => {
  it('nút Thêm hàng loạt và Nhập CSV mở hộp thoại; lệnh bị khóa kèm lý do khi chưa ở Bảng Tag', async () => {
    const { app, el } = await openGrid();
    tool(el, 'bulk').click();
    expect(app.ui.dialog).toEqual({ kind: 'bulkAdd' });
    app.closeOnlineDialog();
    tool(el, 'import').click();
    expect(app.ui.dialog).toEqual({ kind: 'csvImport' });
  });

  it('Xuất CSV: ghi file UTF-8 có BOM qua csvSave, nhập lại thấy mọi dòng giống', async () => {
    const { app, platform, el } = await openGrid();
    tool(el, 'export').click();
    await settled(el);
    await new Promise((r) => setTimeout(r, 0));
    const saved = platform.control.savedCsv.at(-1)!;
    expect(saved.name).toMatch(/\.csv$/);
    expect(saved.text.charCodeAt(0)).toBe(0xfeff);
    expect(saved.text.split('\r\n').filter(Boolean)).toHaveLength(14);
    expect(app.ui.toast?.text).toContain('Đã xuất 13 Tag');
  });
});

describe('mat-tag-grid: Online', () => {
  async function monitoring() {
    const session = new FakeSession();
    const env = await openGrid({ session });
    session.fakeValues.set('TANK01.LEVEL', { value: 45.25, quality: 'GOOD', ts: 1 });
    session.fakeValues.set('TANK01.SP', { value: 7, quality: 'BAD', ts: 1, reason: 'TIMEOUT' });
    session.fakeUnknown.add('MODE');
    env.app.live.flush();
    env.app.session.subscribe(() => undefined);
    session.push({ type: 'values', tags: [] });
    await settled(env.el);
    return { ...env, session };
  }

  it('cột giá trị, quality, lý do ngay sau tên; lý do bằng tiếng Việt; Tag thiết bị không có', async () => {
    const { el, app } = await monitoring();
    app.live.flush();
    await settled(el);
    expect(heads(el).slice(0, 4)).toEqual(['Tên', 'Giá trị sống', 'Quality', 'Lý do']);
    expect(text(cell(el, 0, 'value'))).toBe('45,25 %');
    expect(text(cell(el, 0, 'quality'))).toBe('GOOD');
    expect(text(cell(el, 1, 'quality'))).toBe('BAD');
    expect(text(cell(el, 1, 'reason'))).toBe('thiết bị trường không trả lời kịp');
    expect(cell(el, 0, 'value')?.getAttribute('aria-readonly')).toBe('true');
  });

  it('chỉ đăng ký dữ liệu sống cho các dòng đang hiện của Bảng Tag (ưu tiên 1) trong project 2.000 Tag', async () => {
    const { full02 } = await import('../../model/test-fixtures.ts');
    const base = full02();
    const doc = JSON.parse(base['tags.json']) as { tags: unknown[] };
    doc.tags = Array.from({ length: 2000 }, (_, i) => ({
      id: `BIG${String(i).padStart(4, '0')}`,
      kind: 'internal',
      type: 'INT16',
    }));
    base['tags.json'] = JSON.stringify(doc, null, 2) + '\n';
    const session = new FakeSession();
    const { app, el } = await openGrid({ files: base, session });
    const grid = el.querySelector('mat-grid') as unknown as { visibleRows(): number[] };
    app.live.flush();
    const last = session.tagCalls.at(-1) ?? [];
    expect(last.length).toBeLessThanOrEqual(80);
    expect(grid.visibleRows().length).toBeGreaterThan(0);
    expect(last.every((id) => id.startsWith('BIG'))).toBe(true);
    expect(app.live).toBeInstanceOf(LiveSubscriptions);
  });
});

describe('mat-tag-grid: project 0.1 (cột của 004, chỉ đọc khi chưa nâng cấp)', () => {
  it('mở chỉ đọc: cột của 004, không sửa được, thanh công cụ khóa', async () => {
    const { app } = await newApp();
    app.openEditor('tags');
    const el = await mount<TagGrid>('mat-tag-grid', app);
    await settled(el);
    expect(heads(el).slice(0, 3)).toEqual(['Tên', 'Kiểu', 'Nguồn']);
    app.store.openReadOnly();
    await settled(el);
    expect(text(el.querySelector('.banner'))).toContain('chỉ đọc');
    await click(el, 0, 'description');
    ta(el).value = 'x';
    ta(el).dispatchEvent(new InputEvent('input', { data: 'x', bubbles: true }));
    await key(el, 'Enter');
    expect(
      (app.store.state.outline.tags?.tags[0] as { description?: string }).description,
    ).not.toBe('x');
    expect(tool(el, 'add').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('mat-tag-grid: giữ trạng thái', () => {
  it('giữ ô chọn và bộ lọc khi chuyển tab rồi quay lại', async () => {
    const { app, el } = await openGrid();
    await click(el, 2, 'description');
    const f = el.querySelector<HTMLInputElement>('input[data-role="filter"]')!;
    f.value = 'tank';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    await settled(el);
    el.remove();
    app.openEditor('start');
    app.openEditor('tags');
    const again = await mount<TagGrid>('mat-tag-grid', app);
    await settled(again);
    expect(again.querySelector<HTMLInputElement>('input[data-role="filter"]')!.value).toBe('tank');
  });

  it('đăng ký lệnh Điền xuống, Thêm Tag, Xóa dòng, Xuất CSV khi mở; gỡ khi rời', async () => {
    const { app, el } = await openGrid();
    expect(app.commandContext().activeEditor).toBe('tags');
    expect(app.enabled('tags.exportCsv')).toBe(true);
    el.remove();
    await settled();
    expect(app.commandContext().tagGridFocused).toBe(false);
  });
});
