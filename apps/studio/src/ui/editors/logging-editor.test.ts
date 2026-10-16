// T116 (feature 010, US7, FR-046, FR-047, FR-054; contracts/studio-010.md §1): editor Lưu trữ sửa được. Lưới nhóm và lưới Tag
// dùng chung mat-grid (đổi chữ → MỘT sửa đổi, hoàn tác như Bảng Tag), ô mờ theo kiểu Tag, lỗi theo ô từ bộ kiểm tra, inspector
// theo chế độ, kéo Tag từ cây, form kết nối không mật khẩu, khung Ước tính cập nhật theo sửa đổi, băng Nâng cấp khi chưa phải
// định dạng 0.6. Dự án mẫu: projects/history-demo (4 nhóm, 6 Tag).
import { render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { loggingOf, newHistoryApp } from '../history-test-helpers.ts';
import '../mat-inspector.ts';
import { renderEditor, renderProps } from '../registry.ts';
import { cleanup, newApp, settled } from '../test-helpers.ts';
import type { MatGrid } from '../grid/mat-grid.ts';
import './logging-editor.ts';

afterEach(cleanup);

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function mountEditor(app: StudioApp): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  render(renderEditor(app, 'logging'), host);
  await settled(host);
  const el = host.querySelector<HTMLElement>('mat-logging-editor');
  expect(el, 'editor logging đã đăng ký').not.toBeNull();
  return el!;
}

const grid = (el: Element, which: 'groups' | 'tags') =>
  el.querySelector<MatGrid>(`[data-grid="${which}"] mat-grid`)!;
const cell = (el: Element, which: 'groups' | 'tags', r: number, c: string) =>
  grid(el, which)?.querySelector<HTMLElement>(`[role="gridcell"][data-r="${r}"][data-c="${c}"]`) ??
  null;
const cellText = (el: Element, which: 'groups' | 'tags', r: number, c: string) =>
  norm(cell(el, which, r, c)?.textContent);
const btn = (el: Element, act: string) =>
  el.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);

/** Gửi sửa đổi như lưới làm khi người dùng gõ vào ô: `adapter.apply` → sự kiện `grid-edit`. */
function typeInto(el: Element, which: 'groups' | 'tags', row: number, col: string, text: string) {
  const g = grid(el, which);
  const r = g.adapter.apply([{ row, col, text }]);
  g.dispatchEvent(new CustomEvent('grid-edit', { detail: { edits: r.edits } }));
  return r;
}

async function props(app: StudioApp): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const view = renderProps(app);
  expect(view, 'inspector có nội dung cho nhóm').not.toBeNull();
  render(view!.body as never, host);
  await settled(host);
  return host;
}

describe('lưới nhóm và lưới Tag', () => {
  it('lưới nhóm: 4 nhóm, chế độ hiển thị (Kết hợp = thay đổi có khoảng tối đa), khoảng ghi theo chế độ, ghi MB/ngày', async () => {
    const { app } = await newHistoryApp();
    const el = await mountEditor(app);
    expect(cellText(el, 'groups', 0, 'id')).toBe('ap-suat');
    expect(cellText(el, 'groups', 0, 'mode')).toBe('Kết hợp');
    expect(cellText(el, 'groups', 0, 'interval')).toBe('1 s – 1 phút');
    expect(cellText(el, 'groups', 1, 'mode')).toBe('Kích hoạt');
    expect(cellText(el, 'groups', 1, 'interval')).toContain('BATCH.DONE');
    expect(cellText(el, 'groups', 2, 'mode')).toBe('Chu kỳ');
    expect(cellText(el, 'groups', 2, 'agg')).toBe('Bật');
    expect(cellText(el, 'groups', 3, 'agg')).toBe('Tắt');
    expect(cellText(el, 'groups', 2, 'mb')).not.toBe('');
  });

  it('lưới Tag theo nhóm đang chọn; ô deadband mờ cho Tag BOOL, ô tổng hợp cho phép', async () => {
    const { app } = await newHistoryApp();
    app.select({ kind: 'group', index: 3 });
    const el = await mountEditor(app);
    expect(cellText(el, 'tags', 0, 'tag')).toBe('PUMP1.RUN');
    expect(cell(el, 'tags', 0, 'deadband')?.getAttribute('aria-readonly')).toBe('true');
    expect(cell(el, 'tags', 0, 'agg')?.getAttribute('aria-readonly')).toBeNull();
    expect(norm(el.querySelector('[data-role="tags-title"]')?.textContent)).toContain(
      'Vận hành bơm',
    );
    app.select({ kind: 'group', index: 0 });
    await settled(el);
    expect(cellText(el, 'tags', 0, 'tag')).toBe('PROC.PRESSURE');
    expect(cell(el, 'tags', 0, 'deadband')?.getAttribute('aria-readonly')).toBeNull();
  });

  it('chọn dòng của lưới nhóm đổi nhóm đang chọn (inspector theo nhóm đó)', async () => {
    const { app } = await newHistoryApp();
    const el = await mountEditor(app);
    cell(el, 'groups', 2, 'name')!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
    );
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await settled(el);
    expect(app.store.state.selection).toEqual({ kind: 'group', index: 2 });
  });

  it('gõ vào ô là MỘT sửa đổi, hoàn tác được; ước tính cập nhật ngay', async () => {
    const { app } = await newHistoryApp();
    const el = await mountEditor(app);
    const before = norm(el.querySelector('.est-big')?.textContent);
    const r = typeInto(el, 'groups', 2, 'interval', '100 ms');
    expect(r.rejected).toEqual([]);
    await settled(el);
    expect(loggingOf(app).groups[2]!.periodMs).toBe(100);
    expect(norm(el.querySelector('.est-big')?.textContent)).not.toBe(before);
    app.store.undo();
    await settled(el);
    expect(loggingOf(app).groups[2]!.periodMs).toBe(60_000);
    expect(norm(el.querySelector('.est-big')?.textContent)).toBe(before);
  });

  it('chữ không đọc được bị từ chối theo ô; giá trị sai luật vẫn ghi và hiện lỗi tại ô từ bộ kiểm tra (FR-054)', async () => {
    const { app } = await newHistoryApp();
    const el = await mountEditor(app);
    const bad = typeInto(el, 'groups', 2, 'interval', 'abc');
    expect(bad.rejected).toHaveLength(1);
    expect(loggingOf(app).groups[2]!.periodMs).toBe(60_000);
    typeInto(el, 'groups', 0, 'id', 'Nhóm Sai!');
    expect(loggingOf(app).groups[0]!.id).toBe('Nhóm Sai!');
    await app.run('tools.validate');
    await settled(el);
    expect(cell(el, 'groups', 0, 'id')?.getAttribute('aria-invalid')).toBe('true');
    expect(norm(el.querySelector('.ed-head .chip.err')?.textContent)).toContain('Còn lỗi');
    // Lưu được khi còn lỗi.
    expect((await app.save()).status).toBe('saved');
  });

  it('ô tổng hợp bật/tắt, chế độ chuyển đúng trường (Kết hợp ↔ Thay đổi), một sửa đổi mỗi lần', async () => {
    const { app } = await newHistoryApp();
    const el = await mountEditor(app);
    typeInto(el, 'groups', 3, 'agg', 'Bật');
    expect(loggingOf(app).groups[3]!.aggregates).toEqual({});
    typeInto(el, 'groups', 0, 'mode', 'Thay đổi');
    expect(loggingOf(app).groups[0]!.maxIntervalMs).toBeUndefined();
    typeInto(el, 'groups', 0, 'mode', 'Kết hợp');
    expect(loggingOf(app).groups[0]!.maxIntervalMs).toBe(60_000);
    app.store.undo();
    app.store.undo();
    expect(loggingOf(app).groups[0]!.maxIntervalMs).toBe(60_000);
    expect(loggingOf(app).groups[3]!.aggregates).toEqual({});
  });
});

describe('nút Thêm, Nhân bản, Xóa nhóm; thêm Tag bằng kéo thả', () => {
  it('thêm, nhân bản, xóa nhóm đi qua mô hình tài liệu và hoàn tác được', async () => {
    const { app } = await newHistoryApp();
    const el = await mountEditor(app);
    btn(el, 'add-group')!.click();
    await settled(el);
    expect(loggingOf(app).groups).toHaveLength(5);
    expect(app.store.state.selection).toEqual({ kind: 'group', index: 4 });
    btn(el, 'dup-group')!.click();
    await settled(el);
    expect(loggingOf(app).groups).toHaveLength(6);
    btn(el, 'del-group')!.click();
    await settled(el);
    expect(loggingOf(app).groups).toHaveLength(5);
    app.store.undo();
    app.store.undo();
    app.store.undo();
    expect(loggingOf(app).groups).toHaveLength(4);
  });

  it('thả Tag từ cây vào lưới Tag thêm Tag của nhóm đang chọn, bỏ trùng', async () => {
    const { app } = await newHistoryApp();
    app.select({ kind: 'group', index: 3 });
    const el = await mountEditor(app);
    const wrap = el.querySelector<HTMLElement>('[data-grid="tags"]')!;
    const drop = (name: string) => {
      const e = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', {
        value: {
          getData: (k: string) => (k === 'application/x-mat-tag' ? name : ''),
          types: ['application/x-mat-tag'],
        },
      });
      wrap.dispatchEvent(e);
    };
    drop('METER1.KW');
    drop('METER1.KW');
    await settled(el);
    expect(loggingOf(app).groups[3]!.tags.map((t) => t.tagId)).toEqual(['PUMP1.RUN', 'METER1.KW']);
  });

  it('chỉ đọc khi chưa phải 0.6: băng Nâng cấp, lưới không sửa được; nâng cấp xong sửa được', async () => {
    const { app } = await newApp();
    const el = await mountEditor(app);
    const up = el.querySelector<HTMLButtonElement>('[data-role="upgrade"]');
    expect(up).not.toBeNull();
    expect(grid(el, 'groups').adapter.editable(0, 'name')).toBe(false);
    expect(btn(el, 'add-group')?.getAttribute('aria-disabled')).toBe('true');
    up!.click();
    await vi.waitFor(() => expect(app.store.state.outline.format06).toBe(true));
    await settled(el);
    expect(app.store.state.outline.format06).toBe(true);
    expect(el.querySelector('[data-role="upgrade"]')).toBeNull();
    expect(grid(el, 'groups').adapter.editable(0, 'name')).toBe(true);
  });
});

describe('inspector theo chế độ', () => {
  it('nhóm chu kỳ: chu kỳ, không có khoảng tối thiểu; có thời hạn lưu, tổng hợp, đích', async () => {
    const { app } = await newHistoryApp();
    app.select({ kind: 'group', index: 2 });
    await mountEditor(app);
    const p = await props(app);
    expect(p.querySelector('[data-field="periodMs"]')).not.toBeNull();
    expect(p.querySelector('[data-field="minIntervalMs"]')).toBeNull();
    expect(p.querySelector('[data-field="retentionDays"]')).not.toBeNull();
    expect(p.querySelector('[data-field="aggregates"]')).not.toBeNull();
    expect(p.querySelector('[data-field="expectedRowsPerDay"]')).toBeNull();
  });

  it('nhóm kích hoạt: Tag kích hoạt, cạnh, ngưỡng; có số dòng/ngày dự kiến kèm chú thích dùng cho ước tính', async () => {
    const { app } = await newHistoryApp();
    app.select({ kind: 'group', index: 1 });
    await mountEditor(app);
    const p = await props(app);
    expect((p.querySelector('[data-field="trigger.tagId"]') as HTMLInputElement).value).toBe(
      'BATCH.DONE',
    );
    expect(p.querySelector('[data-field="trigger.edge"]')).not.toBeNull();
    expect(p.querySelector('[data-field="expectedRowsPerDay"]')).not.toBeNull();
    expect(norm(p.textContent)).toContain('ước tính');
  });

  it('sửa trường trong inspector là một sửa đổi (chu kỳ, thời hạn lưu, bật tổng hợp kèm thời hạn)', async () => {
    const { app } = await newHistoryApp();
    app.select({ kind: 'group', index: 2 });
    await mountEditor(app);
    let p = await props(app);
    const set = (name: string, value: string) => {
      const input = p.querySelector<HTMLInputElement>(`[data-field="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('retentionDays', '45');
    expect(loggingOf(app).groups[2]!.retentionDays).toBe(45);
    p.remove();
    p = await props(app);
    set('aggregates.minuteRetentionDays', '10');
    expect(loggingOf(app).groups[2]!.aggregates).toEqual({ minuteRetentionDays: 10 });
    app.store.undo();
    expect(loggingOf(app).groups[2]!.aggregates).toEqual({});
  });

  it('dòng "Tag được tổng hợp: n / m" đếm Tag có aggregate khác false', async () => {
    const { app } = await newHistoryApp();
    app.select({ kind: 'group', index: 0 });
    await mountEditor(app);
    const p = await props(app);
    expect(norm(p.querySelector('[data-role="agg-count"]')?.textContent)).toContain('2 / 2');
  });
});

describe('form Kết nối DB ngoài', () => {
  it('thêm kết nối: không có ô mật khẩu, có chú thích --set-secret; đích của nhóm chọn từ danh sách kết nối', async () => {
    const { app } = await newHistoryApp();
    const el = await mountEditor(app);
    btn(el, 'add-conn')!.click();
    await settled(el);
    expect(loggingOf(app).connections).toHaveLength(1);
    expect(el.querySelector('input[type="password"]')).toBeNull();
    expect(norm(el.textContent)).toContain('--set-secret');
    const id = loggingOf(app).connections![0]!.id;
    app.select({ kind: 'group', index: 0 });
    await settled(el);
    const p = await props(app);
    const dest = p.querySelector<HTMLInputElement>(`[data-dest="${id}"]`);
    expect(dest).not.toBeNull();
    dest!.click();
    expect(loggingOf(app).groups[0]!.destinations).toEqual([id]);
  });
});
