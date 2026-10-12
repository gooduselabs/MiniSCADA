// Bảng Tag (feature 004, T056, T061, T063, T066, FR-018, FR-020, FR-028, contracts/commands.md "Phím
// trong từng vùng"): mẫu ARIA grid; phím; nhấp đúp sửa đúng ô (chọn ô chỉ đổi lớp, không vẽ lại dòng);
// gõ thẳng đặt con trỏ ở cuối; ô lỗi viền đỏ kèm lý do; cột giá trị sống ngay sau tên khi theo dõi;
// thanh công cụ; lệnh của editor; nhảy tới lỗi; giữ ô chọn khi chuyển tab; inspector của Tag.
import type { LiveValue, SessionEvent, SessionState } from '../../model/device-session.ts';
import { render } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioApp } from '../../app/app.ts';
import { VALIDATE_DELAY_MS } from '../../app/store.ts';
import { t } from '../../i18n/index.ts';
import { DeviceSession } from '../../model/device-session.ts';
import { createMockPlatform } from '../../platform/mock.ts';
import { renderProps } from '../registry.ts';
import { cleanup, mount, newApp, press, settled } from '../test-helpers.ts';
import './tag-grid.ts';
import type { TagGrid } from './tag-grid.ts';

// Tag của project mẫu: 0 TANK01.LEVEL, 1 MOTOR01.RUN, 2 MOTOR01.SPEED, 3 TANK01.INFLOW, 4 TANK01.TEMP

const grid = (el: Element) => el.querySelector<HTMLTableElement>('table[role="grid"]')!;
const cell = (el: Element, r: number, c: string) =>
  el.querySelector<HTMLTableCellElement>(`td[data-r="${r}"][data-c="${c}"]`);
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();
const heads = (el: Element) => [...el.querySelectorAll('thead th')].map((th) => text(th));
const bodyRows = (el: Element) => [...el.querySelectorAll<HTMLTableRowElement>('tbody tr')];
const editor = (el: Element) =>
  el.querySelector<HTMLInputElement | HTMLSelectElement>('td.cur .tg-edit');
const tool = (el: Element, act: string) =>
  el.querySelector<HTMLButtonElement>(`.ed-tools [data-act="${act}"]`)!;
const tags = (app: StudioApp) => app.store.state.outline.tags?.tags ?? [];
const isCur = (el: Element, r: number, c: string) => !!cell(el, r, c)?.classList.contains('cur');

async function openGrid(app?: StudioApp) {
  const made = app ? { app, platform: null } : await newApp();
  made.app.openEditor('tags');
  const el = await mount<TagGrid>('mat-tag-grid', made.app);
  await settled(el);
  return { ...made, el };
}

async function key(el: Element, k: string, init: KeyboardEventInit = {}) {
  const notCancelled = press(grid(el), k, init);
  await settled(el);
  return notCancelled;
}

async function click(el: Element, r: number, c: string) {
  cell(el, r, c)!.click();
  await settled(el);
}

async function dblclick(el: Element, r: number, c: string) {
  const td = cell(el, r, c)!;
  td.click();
  td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await settled(el);
}

/** Gõ vào ô đang sửa rồi nhấn phím (Enter, Tab, Escape). */
async function type(el: Element, value: string, k: string) {
  const inp = editor(el)!;
  inp.value = value;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  press(inp, k);
  await settled(el);
}

/** Chờ kiểm tra liên tục (250 ms sau lần sửa cuối) chạy xong rồi vẽ lại. */
async function validated(app: StudioApp, el: Element) {
  await new Promise((r) => setTimeout(r, VALIDATE_DELAY_MS + 30));
  await app.store.idle();
  await settled(el);
}

describe('mat-tag-grid', () => {
  afterEach(cleanup);

  it('mẫu ARIA grid: role=grid nhận focus, cột theo FR-020, mỗi Tag một dòng, Nguồn chỉ đọc', async () => {
    const { el } = await openGrid();
    const g = grid(el);
    expect(g.getAttribute('role')).toBe('grid');
    expect(g.tabIndex).toBe(0);
    expect(g.getAttribute('aria-label')).toBe('Bảng Tag mặc định');
    expect(heads(el)).toEqual(['#', 'Tên', 'Kiểu', 'Nguồn', 'Đơn vị', 'Min', 'Max', 'Mô tả']);
    expect(bodyRows(el)).toHaveLength(5);
    expect(cell(el, 0, 'id')?.getAttribute('role')).toBe('gridcell');
    expect(text(cell(el, 0, 'id'))).toBe('TANK01.LEVEL');
    expect(text(cell(el, 2, 'source'))).toBe('Mô phỏng · motor.speed');
    expect(cell(el, 2, 'source')?.getAttribute('aria-readonly')).toBe('true');
    expect(text(cell(el, 2, 'max'))).toBe('1500');
    expect(text(el.querySelector('.tg-count'))).toBe('5/5 Tag');
    expect(text(el.querySelector('.ed-head h2'))).toBe('Bảng Tag mặc định');
  });

  it('phím theo contract: focus chọn ô đầu, mũi tên, Tab/Shift+Tab, Home/End; aria-activedescendant theo ô', async () => {
    const { el } = await openGrid();
    const g = grid(el);
    g.focus();
    await settled(el);
    expect(isCur(el, 0, 'id')).toBe(true);
    expect(g.getAttribute('aria-activedescendant')).toBe(cell(el, 0, 'id')?.id);
    expect(await key(el, 'ArrowDown')).toBe(false); // đã xử lý: preventDefault
    expect(isCur(el, 1, 'id')).toBe(true);
    await key(el, 'ArrowRight');
    expect(isCur(el, 1, 'type')).toBe(true);
    await key(el, 'Tab');
    expect(isCur(el, 1, 'source')).toBe(true);
    await key(el, 'Tab', { shiftKey: true });
    expect(isCur(el, 1, 'type')).toBe(true);
    await key(el, 'End');
    expect(isCur(el, 1, 'description')).toBe(true);
    expect(g.getAttribute('aria-activedescendant')).toBe(cell(el, 1, 'description')?.id);
    // Tab ở cột cuối không bị giữ: focus rời lưới (không bẫy bàn phím)
    expect(await key(el, 'Tab')).toBe(true);
    await key(el, 'Home', { ctrlKey: true });
    expect(isCur(el, 0, 'id')).toBe(true);
    expect(el.querySelectorAll('td.cur')).toHaveLength(1);
    expect(bodyRows(el)[0].getAttribute('aria-selected')).toBe('true');
  });

  it('Enter/F2 vào sửa (chọn hết nội dung); Enter xác nhận rồi xuống dòng; Esc hủy', async () => {
    const { app, el } = await openGrid();
    await click(el, 0, 'unit');
    await key(el, 'F2');
    const inp = editor(el) as HTMLInputElement;
    expect(inp.value).toBe('%');
    expect(document.activeElement).toBe(inp);
    expect([inp.selectionStart, inp.selectionEnd]).toEqual([0, 1]);
    await type(el, 'kPa', 'Enter');
    expect(tags(app)[0].unit).toBe('kPa');
    expect(editor(el)).toBeNull();
    expect(isCur(el, 1, 'unit')).toBe(true);
    expect(document.activeElement).toBe(grid(el));
    await key(el, 'Enter');
    expect(editor(el)).not.toBeNull();
    await type(el, 'zzz', 'Escape');
    expect(editor(el)).toBeNull();
    expect(tags(app)[1].unit).toBeUndefined();
    expect(isCur(el, 1, 'unit')).toBe(true);
    expect(document.activeElement).toBe(grid(el));
    // Hoàn tác của project (Ctrl+Z khi focus ở lưới) trả lại ô cũ
    app.store.undo();
    await settled(el);
    expect(text(cell(el, 0, 'unit'))).toBe('%');
  });

  it('gõ một ký tự: ô vào sửa với đúng ký tự đó, con trỏ ở cuối', async () => {
    const { el } = await openGrid();
    await click(el, 2, 'unit');
    expect(await key(el, 'k')).toBe(false);
    const inp = editor(el) as HTMLInputElement;
    expect(inp.value).toBe('k');
    expect(document.activeElement).toBe(inp);
    expect([inp.selectionStart, inp.selectionEnd]).toEqual([1, 1]);
  });

  it('cột Kiểu sửa bằng danh sách chọn; Enter xác nhận', async () => {
    const { app, el } = await openGrid();
    await click(el, 1, 'type');
    await key(el, 'Enter');
    const sel = editor(el) as HTMLSelectElement;
    expect(sel.tagName).toBe('SELECT');
    expect(sel.value).toBe('BOOL');
    expect([...sel.options].map((o) => o.value)).toContain('FLOAT64');
    sel.value = 'INT16';
    press(sel, 'Enter');
    await settled(el);
    expect(tags(app)[1].type).toBe('INT16');
  });

  it('Delete xóa ô, trừ tên (báo lý do); Ctrl+D điền xuống', async () => {
    const { app, el } = await openGrid();
    await click(el, 0, 'description');
    await key(el, 'Delete');
    expect(tags(app)[0].description).toBeUndefined();
    await click(el, 0, 'id');
    await key(el, 'Delete');
    expect(tags(app)[0].id).toBe('TANK01.LEVEL');
    expect(app.ui.toast?.text).toBe(t('grid.notice.required'));
    await click(el, 1, 'unit');
    expect(await key(el, 'd', { ctrlKey: true })).toBe(false);
    expect(tags(app)[1].unit).toBe('%');
  });

  it('nhấp chọn ô chỉ đổi lớp CSS, không vẽ lại dòng; nhấp đúp sửa đúng ô đó', async () => {
    const { app, el } = await openGrid();
    const rows = bodyRows(el);
    const td = cell(el, 3, 'max')!;
    td.click();
    await settled(el);
    expect(cell(el, 3, 'max')).toBe(td);
    expect(bodyRows(el).every((tr, i) => tr === rows[i])).toBe(true);
    expect(td.classList.contains('cur')).toBe(true);
    expect(td.closest('tr')?.classList.contains('rsel')).toBe(true);
    expect(app.store.state.selection).toEqual({ kind: 'tag', row: 3 });
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await settled(el);
    expect(cell(el, 3, 'max')).toBe(td);
    const inp = td.querySelector<HTMLInputElement>('input.tg-edit');
    expect(inp?.value).toBe('20');
    expect(document.activeElement).toBe(inp);
    // nhấp đúp một ô khác (chưa chọn) cũng sửa đúng ô đó; ô đang sửa được xác nhận khi rời
    inp!.value = '25';
    await dblclick(el, 0, 'unit');
    expect(tags(app)[3].max).toBe(25);
    expect((editor(el) as HTMLInputElement).value).toBe('%');
    expect(cell(el, 0, 'unit')?.contains(editor(el))).toBe(true);
  });

  it('ô lỗi: viền đỏ (lớp bad, aria-invalid), có icon, lý do qua title và aria-describedby', async () => {
    const { app, el } = await openGrid();
    await dblclick(el, 0, 'max');
    await type(el, '-1', 'Enter');
    await validated(app, el);
    for (const c of ['min', 'max']) {
      const td = cell(el, 0, c)!;
      expect(td.classList.contains('bad'), c).toBe(true);
      expect(td.getAttribute('aria-invalid')).toBe('true');
      expect(td.title).toMatch(/^E_TAG_RANGE: /);
      const desc = document.getElementById(td.getAttribute('aria-describedby') ?? '');
      expect(desc?.textContent).toContain('E_TAG_RANGE');
      expect(td.querySelector('svg.ic')).not.toBeNull();
    }
    expect(cell(el, 1, 'max')?.classList.contains('bad')).toBe(false);
    expect(cell(el, 1, 'max')?.hasAttribute('aria-invalid')).toBe(false);
  });

  it('thanh công cụ: Thêm Tag (vào sửa tên), Xóa dòng, Điền xuống, Lọc; Dán/Nhập/Xuất CSV khóa "Có ở GĐ 2"', async () => {
    const { app, el } = await openGrid();
    tool(el, 'add').click();
    await settled(el);
    expect(tags(app)).toHaveLength(6);
    expect(tags(app)[5].id).toBe('TANK02.TEMP');
    const inp = editor(el) as HTMLInputElement;
    expect(inp.value).toBe('TANK02.TEMP');
    expect(document.activeElement).toBe(inp);
    await type(el, 'TANK02.TEMP', 'Escape');
    tool(el, 'delete').click();
    await settled(el);
    expect(tags(app)).toHaveLength(5);
    expect(app.ui.toast?.text).toBe('Đã xóa TANK02.TEMP (Ctrl+Z để hoàn tác)');
    await click(el, 1, 'unit');
    tool(el, 'fill').click();
    await settled(el);
    expect(tags(app)[1].unit).toBe('%');
    const filter = el.querySelector<HTMLInputElement>('.ed-tools input[type="search"]')!;
    filter.value = 'bom';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    await settled(el);
    expect(bodyRows(el).map((tr) => tr.dataset.r)).toEqual(['1', '2']);
    expect(text(el.querySelector('.tg-count'))).toBe('2/5 Tag');
    const before = JSON.stringify(tags(app));
    for (const act of ['paste', 'import', 'export']) {
      const b = tool(el, act);
      expect(b.getAttribute('aria-disabled'), act).toBe('true');
      expect(b.title).toContain('Có ở GĐ 2');
      b.click();
      expect(app.ui.toast?.text).toContain('Có ở GĐ 2');
    }
    expect(JSON.stringify(tags(app))).toBe(before);
  });

  it('đăng ký lệnh Điền xuống, Thêm Tag, Xóa dòng; báo focus và dòng chọn; gỡ khi rời', async () => {
    const { app, el } = await openGrid();
    expect(app.enabled('tags.delete')).toBe('reason.noRow');
    grid(el).focus();
    await settled(el);
    expect(app.commandContext()).toMatchObject({ tagGridFocused: true, cellRow: 0 });
    expect(app.enabled('edit.fillDown')).toBe('reason.firstRow');
    await key(el, 'ArrowDown');
    await key(el, 'ArrowRight');
    expect(app.commandContext().cellRow).toBe(1);
    expect(app.enabled('edit.fillDown')).toBe(true);
    await app.run('edit.fillDown');
    expect(tags(app)[1].type).toBe('FLOAT32');
    await app.run('tags.add');
    await settled(el);
    expect(tags(app)).toHaveLength(6);
    press(editor(el)!, 'Escape');
    await settled(el);
    await app.run('tags.delete');
    await settled(el);
    expect(tags(app)).toHaveLength(5);
    // khi lọc, cellRow là vị trí trong các dòng đang hiện
    await click(el, 2, 'unit');
    const filter = el.querySelector<HTMLInputElement>('.ed-tools input[type="search"]')!;
    filter.value = 'motor';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    await settled(el);
    expect(app.commandContext().cellRow).toBe(1);
    el.remove();
    expect(app.commandContext()).toMatchObject({ tagGridFocused: false, cellRow: null });
    await app.run('tags.add');
    expect(tags(app)).toHaveLength(5);
  });

  it('Ctrl+S khi đang gõ trong ô: xác nhận ô rồi mới lưu (hooks.commitPending)', async () => {
    const { app, platform, el } = await openGrid();
    await dblclick(el, 0, 'unit');
    (editor(el) as HTMLInputElement).value = 'kPa';
    await app.run('project.save');
    expect(platform!.control.writes.map((w) => w.rel)).toEqual(['tags.json']);
    expect(platform!.control.writes[0].content).toContain('"unit": "kPa"');
  });

  it('nhảy tới lỗi (tab Thông tin): mở đúng ô và vào sửa, bỏ lọc nếu dòng bị ẩn', async () => {
    const { app, el } = await openGrid();
    app.store.edit([{ kind: 'tagField', index: 2, field: 'max', value: -5 }]);
    await app.store.validateNow();
    const filter = el.querySelector<HTMLInputElement>('.ed-tools input[type="search"]')!;
    filter.value = 'tank';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    await settled(el);
    expect(cell(el, 2, 'max')).toBeNull();
    const issue = app.store.state.issues.find((i) => i.code === 'E_TAG_RANGE')!;
    app.gotoIssue(issue);
    await settled(el);
    const td = cell(el, 2, 'max')!;
    expect(td.classList.contains('cur')).toBe(true);
    const inp = td.querySelector<HTMLInputElement>('input.tg-edit')!;
    expect(inp.value).toBe('-5');
    expect(document.activeElement).toBe(inp);
    expect(filter.value).toBe('');
    // Lưới chưa gắn (tab khác đang mở): vị trí chờ tới lần vẽ đầu của lưới
    press(inp, 'Escape');
    await settled(el);
    el.remove();
    app.openEditor('settings');
    app.gotoIssue(issue);
    const el2 = await mount<TagGrid>('mat-tag-grid', app);
    await settled(el2);
    expect(isCur(el2, 2, 'max')).toBe(true);
    expect(editor(el2)).not.toBeNull();
  });

  it('chọn Tag từ Details, Tìm (revealTag): chọn ô tên, không vào sửa', async () => {
    const { app, el } = await openGrid();
    app.revealTag(4);
    await settled(el);
    expect(isCur(el, 4, 'id')).toBe(true);
    expect(editor(el)).toBeNull();
    expect(document.activeElement).toBe(grid(el));
    expect(app.store.state.selection).toEqual({ kind: 'tag', row: 4 });
  });

  it('giữ ô chọn và bộ lọc khi chuyển tab; lựa chọn của store theo ô chọn', async () => {
    const { app, el } = await openGrid();
    const filter = el.querySelector<HTMLInputElement>('.ed-tools input[type="search"]')!;
    filter.value = 'motor';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    await settled(el);
    await click(el, 2, 'unit');
    el.remove();
    app.openEditor('settings');
    expect(app.store.state.selection).toEqual({ kind: 'project' });
    app.openEditor('tags');
    const el2 = await mount<TagGrid>('mat-tag-grid', app);
    await settled(el2);
    expect(el2.querySelector<HTMLInputElement>('.ed-tools input[type="search"]')?.value).toBe(
      'motor',
    );
    expect(isCur(el2, 2, 'unit')).toBe(true);
    expect(app.store.state.selection).toEqual({ kind: 'tag', row: 2 });
  });

  it('chuyển tab: lần vẽ còn chờ của lưới đã gỡ không ghi đè lựa chọn và ngữ cảnh của tab mới', async () => {
    const { app, el } = await openGrid();
    await click(el, 3, 'unit');
    expect(app.store.state.selection).toEqual({ kind: 'tag', row: 3 });
    // Như khung khi đổi tab: app báo đổi (lưới xếp lịch vẽ lại) rồi lưới bị gỡ trong cùng lượt.
    app.openEditor('settings');
    el.remove();
    await new Promise((r) => setTimeout(r, 0));
    expect(app.store.state.selection).toEqual({ kind: 'project' });
    expect(app.commandContext()).toMatchObject({ cellRow: null, tagGridFocused: false });
  });

  it('đóng tab khi đang gõ dở (Ctrl+W): giữ nội dung đã gõ, không chọn lại Tag cho editor khác', async () => {
    const { app, el } = await openGrid();
    await dblclick(el, 0, 'unit');
    (editor(el) as HTMLInputElement).value = 'kPa';
    app.closeTab('tags'); // tab bên trái (Bắt đầu) thành tab đang chọn, bỏ lựa chọn Tag
    el.remove();
    await new Promise((r) => setTimeout(r, 0));
    expect(tags(app)[0].unit).toBe('kPa');
    expect(app.store.state.active).toBe('start');
    expect(app.store.state.selection).toBeNull();
  });

  it('file Tag hỏng: báo lỗi, không sửa được', async () => {
    const { app, platform, el } = await openGrid();
    // Bản giả nạp lại project mẫu mỗi lần mở: làm hỏng file sau khi mở rồi F7 đọc lại đĩa.
    platform!.control.editOutside('tags.json', '{ "tags": [ hỏng');
    await app.store.validateNow();
    await settled(el);
    expect(text(el.querySelector('.banner.err'))).toContain('tags.json');
    expect(bodyRows(el)).toHaveLength(0);
    expect(tool(el, 'add').getAttribute('aria-disabled')).toBe('true');
  });
});

/** Phiên thiết bị giả: trạng thái, giá trị và Tag lạ đặt tay; phát sự kiện như phiên thật. */
class FakeSession extends DeviceSession {
  fakeState: SessionState = 'monitoring';
  readonly fakeValues = new Map<string, LiveValue>();
  readonly fakeUnknown = new Set<string>();
  private readonly fakeListeners = new Set<(e: SessionEvent) => void>();

  override get state(): SessionState {
    return this.fakeState;
  }

  override get values(): ReadonlyMap<string, LiveValue> {
    return this.fakeValues;
  }

  override get unknown(): ReadonlySet<string> {
    return this.fakeUnknown;
  }

  override subscribe(listener: (e: SessionEvent) => void): () => void {
    this.fakeListeners.add(listener);
    return () => void this.fakeListeners.delete(listener);
  }

  override setTags(): void {}

  push(e: SessionEvent): void {
    for (const l of [...this.fakeListeners]) l(e);
  }
}

describe('mat-tag-grid khi theo dõi thiết bị (FR-028)', () => {
  afterEach(cleanup);

  async function monitoring() {
    const session = new FakeSession();
    const app = new StudioApp({
      platform: createMockPlatform(),
      storage: null,
      windowWidth: 1400,
      session,
    });
    await app.start();
    await app.run('project.open');
    await app.store.idle();
    session.fakeValues.set('TANK01.LEVEL', { value: 45.25, quality: 'GOOD', ts: 1 });
    session.fakeValues.set('MOTOR01.RUN', { value: true, quality: 'BAD', ts: 1 });
    session.fakeValues.set('TANK01.INFLOW', { value: 3.5, quality: 'STALE', ts: 1 });
    session.fakeUnknown.add('TANK01.TEMP');
    const { el } = await openGrid(app);
    return { app, session, el };
  }

  it('giá trị sống và quality ngay sau cột tên; Tag thiết bị không có; STALE không hiện như GOOD', async () => {
    const { el } = await monitoring();
    expect(heads(el).slice(0, 5)).toEqual(['#', 'Tên', 'Giá trị sống', 'Quality', 'Kiểu']);
    expect(text(cell(el, 0, 'value'))).toBe('45,25 %');
    expect(text(cell(el, 0, 'quality'))).toBe('GOOD');
    expect(cell(el, 0, 'quality')?.querySelector('.chip.ok')).not.toBeNull();
    expect(text(cell(el, 1, 'value'))).toBe('TRUE');
    expect(text(cell(el, 1, 'quality')?.querySelector('.chip.err'))).toBe('BAD');
    expect(text(cell(el, 4, 'value'))).toBe('không có trên thiết bị');
    const stale = cell(el, 3, 'quality')!;
    expect(text(stale)).toBe('mất kết nối');
    expect(stale.querySelector('.chip.ok, .chip.err, .chip.warn')).toBeNull();
    expect(text(cell(el, 2, 'value'))).toBe('—'); // chưa nhận giá trị
    expect(cell(el, 0, 'value')?.getAttribute('aria-readonly')).toBe('true');
  });

  it('cập nhật khi có giá trị mới; mất kết nối thì mọi giá trị không còn tốt', async () => {
    const { session, el } = await monitoring();
    session.fakeValues.set('TANK01.LEVEL', { value: 50, quality: 'GOOD', ts: 2 });
    session.push({ type: 'values', tags: ['TANK01.LEVEL'] });
    await settled(el);
    expect(text(cell(el, 0, 'value'))).toBe('50 %');
    session.fakeState = 'lost';
    session.push({ type: 'state', state: 'lost' });
    await settled(el);
    expect(heads(el)[2]).toBe('Giá trị sống');
    expect(text(cell(el, 0, 'quality'))).toBe('mất kết nối');
    expect(el.querySelector('td[data-c="quality"] .chip.ok')).toBeNull();
  });

  it('ô giá trị sống chỉ đọc: sửa thì báo ghi Tag có ở GĐ 2', async () => {
    const { app, el } = await monitoring();
    await click(el, 0, 'value');
    await key(el, 'Enter');
    expect(editor(el)).toBeNull();
    expect(app.ui.toast?.text).toBe(t('grid.notice.liveReadonly'));
  });

  it('ngắt theo dõi: bỏ cột giá trị sống, ô đang chọn ở cột đó về cột tên', async () => {
    const { session, el } = await monitoring();
    await click(el, 2, 'quality');
    session.fakeState = 'idle';
    session.push({ type: 'state', state: 'idle' });
    await settled(el);
    expect(heads(el)).toEqual(['#', 'Tên', 'Kiểu', 'Nguồn', 'Đơn vị', 'Min', 'Max', 'Mô tả']);
    expect(isCur(el, 2, 'id')).toBe(true);
  });
});

describe('inspector của Tag (T066, FR-006)', () => {
  afterEach(cleanup);

  it('trường của Tag, "Dùng ở đâu"; nhấp một mục thì mở editor tương ứng', async () => {
    const { app } = await newApp();
    app.openEditor('tags');
    app.select({ kind: 'tag', row: 0 });
    const view = renderProps(app)!;
    expect(view.ctx).toBe('Tag TANK01.LEVEL · sửa trong lưới');
    const host = document.createElement('div');
    document.body.append(host);
    render(view.body, host);
    const rows = [...host.querySelectorAll('.prow')].map((r) => [
      text(r.querySelector('.pl')),
      text(r.querySelector('.pv')),
    ]);
    expect(rows).toEqual([
      ['Tên', 'TANK01.LEVEL'],
      ['Kiểu dữ liệu', 'FLOAT32'],
      ['Nguồn', 'Mô phỏng · tank.level'],
      ['Đơn vị', '%'],
      ['Phạm vi', '0 – 100'],
      ['Mô tả', 'Mức nước bồn'],
    ]);
    expect(text(host.querySelector('.psec'))).toBe('Dùng ở đâu 4');
    const links = [...host.querySelectorAll<HTMLButtonElement>('.xref button')];
    expect(links.map((b) => text(b))).toEqual([
      'Bồn nước + bơm › Mức nước (Mức chất lỏng)',
      'Bồn nước + bơm › Chữ mức (Chữ)',
      'Lưu trữ › Vận hành',
      'Lưu trữ › Báo cáo ca',
    ]);
    links[3].click();
    expect(app.store.state.active).toBe('logging');
    expect(app.takeReveal('logging')).toEqual({ editor: 'logging', group: 1 });
    links[0].click();
    expect(app.store.state.active).toBe('screen:tank-motor');
    expect(app.takeReveal('screen')).toEqual({
      editor: 'screen',
      screen: 'tank-motor',
      element: 'el_tank_level',
    });
  });

  it('Tag không dùng ở đâu; thiếu Min/Max; lựa chọn không phải Tag thì không nhận', async () => {
    const { app } = await newApp();
    app.store.edit([
      {
        kind: 'tagUpsert',
        tag: { id: 'NEW.TAG', type: 'INT16', max: 5, source: { kind: 'mock', signal: 'x' } },
      },
    ]);
    app.select({ kind: 'tag', row: 5 });
    const host = document.createElement('div');
    document.body.append(host);
    render(renderProps(app)!.body, host);
    expect(text(host)).toContain('… – 5');
    expect(text(host)).toContain('Chưa dùng ở màn hình hay nhóm lưu trữ nào.');
    app.select({ kind: 'project' });
    expect(renderProps(app)).toBeNull();
  });

  it('khi theo dõi: thêm dòng giá trị sống (cập nhật theo giá trị mới)', async () => {
    const session = new FakeSession();
    const app = new StudioApp({
      platform: createMockPlatform(),
      storage: null,
      windowWidth: 1400,
      session,
    });
    await app.start();
    await app.run('project.open');
    await app.store.idle();
    session.fakeValues.set('TANK01.LEVEL', { value: 12.5, quality: 'GOOD', ts: 1 });
    app.select({ kind: 'tag', row: 0 });
    const host = document.createElement('div');
    document.body.append(host);
    render(renderProps(app)!.body, host);
    await settled(host);
    expect(text(host)).toContain('Giá trị sống');
    expect(text(host)).toContain('12,5 % · GOOD');
    session.fakeValues.set('TANK01.LEVEL', { value: 13, quality: 'GOOD', ts: 2 });
    session.push({ type: 'values', tags: ['TANK01.LEVEL'] });
    await settled(host);
    expect(text(host)).toContain('13 % · GOOD');
  });
});
