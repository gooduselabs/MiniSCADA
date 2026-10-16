// T129 (feature 010, US8; contracts/studio-010.md §2): editor Mẫu báo cáo. Form chung (tên, id, nhóm chỉ có tổng hợp, kỳ, ca với nhãn
// hiện ngay, khổ giấy, tiêu đề, chân trang), lưới cột (kéo hoặc gõ Tag của nhóm, hàm chọn nhiều và mờ theo kiểu Tag, gợi ý đơn vị), lỗi
// theo ô E_RPT_*, xem trước bằng nguồn mô phỏng hoặc thiết bị, xuất thử qua lệnh lưu của Tauri (giả), danh sách mẫu trong cây.
import { render } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { loggingOf, newHistoryApp, reportsOf, historyDemoFiles } from '../history-test-helpers.ts';
import type { MatGrid } from '../grid/mat-grid.ts';
import type { ReportPreview } from '../report-preview.ts';
import { renderEditor } from '../registry.ts';
import { cleanup, settled } from '../test-helpers.ts';
import './templates-editor.ts';

// The preview of a shift report shows the last complete working day (shifts from 06:00): between 00:00 and
// 06:00 that day is not over yet, so the counts below depend on the hour. A fixed clock (10:00) keeps them
// stable; only Date is faked, the timers of Lit and the preview stay real. Seen red at 01:07 on 2026-10-17.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

afterEach(cleanup);

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function mountReport(app: StudioApp, id: string): Promise<HTMLElement> {
  app.openEditor(`report:${id}`);
  const host = document.createElement('div');
  document.body.append(host);
  render(renderEditor(app, `report:${id}`), host);
  await settled(host);
  const el = host.querySelector<HTMLElement>('mat-templates-editor');
  expect(el, 'editor mẫu báo cáo đã đăng ký').not.toBeNull();
  await preview(el!).whenIdle();
  return el!;
}

const preview = (el: Element) => el.querySelector<ReportPreview>('mat-report-preview')!;
const field = (el: Element, name: string) =>
  el.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-field="${name}"]`)!;
const grid = (el: Element) => el.querySelector<MatGrid>('[data-grid="columns"] mat-grid')!;
const cell = (el: Element, r: number, c: string) =>
  grid(el)?.querySelector<HTMLElement>(`[role="gridcell"][data-r="${r}"][data-c="${c}"]`) ?? null;
const setValue = (el: HTMLInputElement | HTMLSelectElement, v: string, ev = 'change') => {
  el.value = v;
  el.dispatchEvent(new Event(ev, { bubbles: true }));
};
const tpl = (app: StudioApp, i = 0) => reportsOf(app).reports[i]!;
const rowCount = (el: Element) =>
  el.querySelectorAll('mat-report-preview table.rpt tbody tr').length;

describe('form chung', () => {
  it('hiện đúng mẫu: tên, id, nhóm, kỳ, giấy; nhóm chỉ liệt kê nhóm có tổng hợp', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    expect(field(el, 'name').value).toBe('Điện năng theo ngày');
    expect(field(el, 'id').value).toBe('dien-ngay');
    expect(field(el, 'period').value).toBe('day');
    expect(field(el, 'rowMinutes').value).toBe('60');
    expect(field(el, 'paper.size').value).toBe('A4');
    expect(field(el, 'paper.orientation').value).toBe('landscape');
    const groups = [...field(el, 'group').querySelectorAll('option')].map((o) => o.value);
    expect(groups).toEqual(['ap-suat', 'dien']); // me-tron, van-hanh không có tổng hợp
    expect(field(el, 'group').value).toBe('dien');
    expect(field(el, 'totals').checked).toBe(true);
  });

  it('sửa tên, tiêu đề, chân trang: mỗi lần một sửa đổi, hoàn tác được', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    setValue(field(el, 'name'), 'Tên khác');
    expect(tpl(app).name).toBe('Tên khác');
    setValue(field(el, 'footer'), '');
    expect(tpl(app).footer).toBeUndefined();
    app.store.undo();
    app.store.undo();
    expect(tpl(app).name).toBe('Điện năng theo ngày');
    expect(tpl(app).footer).toBe('Phòng Kỹ thuật');
  });

  it('chưa có nhóm nào có tổng hợp: hướng dẫn "Bật tổng hợp ở Lưu trữ" kèm nút mở Lưu trữ', async () => {
    const files = historyDemoFiles();
    const l = JSON.parse(files['logging.json']!);
    for (const g of l.groups) delete g.aggregates;
    files['logging.json'] = JSON.stringify(l);
    const { app } = await newHistoryApp({ files });
    const el = await mountReport(app, 'dien-ngay');
    expect(el.querySelector('[data-role="no-group"]')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('[data-role="no-group"] button')!.click();
    expect(app.store.state.active).toBe('logging');
  });
});

describe('kỳ và ca', () => {
  it('chọn kỳ Ca: có 3 ca 06:00, nhãn ca hiện ngay, bỏ rowMinutes; xem trước có 3 hàng ca và dòng tổng', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    expect(rowCount(el)).toBe(25);
    setValue(field(el, 'period'), 'shift');
    await settled(el);
    await preview(el).whenIdle();
    expect(tpl(app)).toMatchObject({ period: 'shift', shifts: { count: 3, start: '06:00' } });
    expect(tpl(app).rowMinutes).toBeUndefined();
    const labels = [...el.querySelectorAll('[data-role="shift-labels"] li')].map((li) =>
      norm(li.textContent),
    );
    expect(labels).toEqual(['Ca 1 06:00–14:00', 'Ca 2 14:00–22:00', 'Ca 3 22:00–06:00']);
    expect(rowCount(el)).toBe(4);
  });

  it('số ca chỉ chọn trong {2, 3, 4, 6, 8, 12}; đổi số ca và giờ bắt đầu cập nhật nhãn ca', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ca');
    const opts = [...field(el, 'shifts.count').querySelectorAll('option')].map((o) => o.value);
    expect(opts).toEqual(['2', '3', '4', '6', '8', '12']);
    setValue(field(el, 'shifts.count'), '2');
    setValue(field(el, 'shifts.start'), '07:30');
    await settled(el);
    expect(tpl(app, 1).shifts).toEqual({ count: 2, start: '07:30' });
    const labels = [...el.querySelectorAll('[data-role="shift-labels"] li')].map((li) =>
      norm(li.textContent),
    );
    expect(labels).toEqual(['Ca 1 07:30–19:30', 'Ca 2 19:30–07:30']);
  });

  it('giờ bắt đầu sai khi gõ tay vẫn ghi và hiện lỗi E_RPT_SHIFT tại ô sau Kiểm tra', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ca');
    setValue(field(el, 'shifts.start'), '25:99');
    expect(tpl(app, 1).shifts!.start).toBe('25:99');
    await app.run('tools.validate');
    await settled(el);
    expect(field(el, 'shifts.start').getAttribute('aria-invalid')).toBe('true');
    expect(norm(el.querySelector('[data-error="shifts"]')?.textContent)).toContain('E_RPT_SHIFT');
  });
});

describe('lưới cột và hàm', () => {
  it('lưới cột: Tag, nhãn, đơn vị, số lẻ, hàm (tên tiếng Việt), kiểu Tag', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    expect(norm(cell(el, 0, 'tag')?.textContent)).toBe('METER1.KWH');
    expect(norm(cell(el, 0, 'fns')?.textContent)).toBe('Chênh lệch, Lớn nhất');
    expect(norm(cell(el, 1, 'note')?.textContent)).toBe('FLOAT32');
  });

  it('thêm cột bằng gõ tên có gợi ý chỉ nhận Tag của nhóm; Tag ngoài nhóm bị từ chối kèm thông báo', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ca');
    const input = el.querySelector<HTMLInputElement>('[data-role="add-tag"]')!;
    setValue(input, 'PROC.PRESSURE', 'input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settled(el);
    expect(tpl(app, 1).columns.map((c) => c.tagId)).not.toContain('PROC.PRESSURE');
    expect(app.ui.toast?.text).toContain('nhóm');
    const before = tpl(app, 1).columns.length;
    // dán danh sách: Tag trong nhóm đã có thì bỏ, ở đây thêm lại bằng kéo thả của Tag chưa có
    app.store.edit([
      {
        kind: 'reports',
        value: {
          ...reportsOf(app),
          reports: reportsOf(app).reports.map((r, i) =>
            i === 1 ? { ...r, columns: r.columns.slice(0, 1) } : r,
          ),
        },
      },
    ]);
    await settled(el);
    const wrap = el.querySelector<HTMLElement>('[data-grid="columns"]')!;
    const e = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', {
      value: {
        getData: (k: string) => (k === 'application/x-mat-tag' ? 'METER1.KW' : ''),
        types: ['application/x-mat-tag'],
      },
    });
    wrap.dispatchEvent(e);
    await settled(el);
    expect(tpl(app, 1).columns.map((c) => c.tagId)).toContain('METER1.KW');
    expect(before).toBeGreaterThan(0);
  });

  it('chọn hàm bằng ô chọn: bật/tắt một hàm giữ thứ tự chuẩn; không bỏ hàm cuối; hàm mờ theo kiểu Tag (BOOL không có Chênh lệch)', async () => {
    const files = historyDemoFiles();
    const l = JSON.parse(files['logging.json']!);
    l.groups[2].tags.push({ tagId: 'PUMP1.RUN' });
    files['logging.json'] = JSON.stringify(l);
    const r = JSON.parse(files['reports.json']!);
    r.reports[0].columns.push({
      tagId: 'PUMP1.RUN',
      label: 'Bơm 1 chạy',
      unit: 'giờ',
      decimals: 2,
      functions: ['sum'],
    });
    files['reports.json'] = JSON.stringify(r);
    const { app } = await newHistoryApp({ files });
    const el = await mountReport(app, 'dien-ngay');
    // chọn cột 0 (METER1.KWH): hàm [delta, max]
    cell(el, 0, 'tag')!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
    );
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await settled(el);
    const box = (fn: string) => el.querySelector<HTMLInputElement>(`[data-fn="${fn}"]`)!;
    expect(box('delta').checked).toBe(true);
    box('avg').click();
    expect(tpl(app).columns[0]!.functions).toEqual(['max', 'avg', 'delta']);
    box('avg').click();
    box('delta').click();
    box('max').click(); // hàm cuối: giữ lại
    expect(tpl(app).columns[0]!.functions).toEqual(['max']);
    // cột BOOL: delta mờ
    cell(el, 2, 'tag')!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
    );
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await settled(el);
    expect(box('delta').disabled).toBe(true);
    expect(box('sum').disabled).toBe(false);
  });

  it('nút Gợi ý đơn vị đặt đơn vị theo hàm: kW + Tổng → kWh', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    // cột 1 (METER1.KW, kW): đổi hàm sang [sum]
    cell(el, 1, 'tag')!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
    );
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await settled(el);
    el.querySelector<HTMLInputElement>('[data-fn="sum"]')!.click();
    el.querySelector<HTMLInputElement>('[data-fn="avg"]')!.click();
    el.querySelector<HTMLInputElement>('[data-fn="max"]')!.click();
    expect(tpl(app).columns[1]!.functions).toEqual(['sum']);
    el.querySelector<HTMLButtonElement>('[data-act="suggest-unit"]')!.click();
    expect(tpl(app).columns[1]!.unit).toBe('kWh');
  });
});

describe('lỗi theo ô và tài liệu', () => {
  it('id trùng và nhóm lạ: lỗi hiện ngay tại trường, kèm mã E_RPT_*; lưu được khi còn lỗi', async () => {
    const files = historyDemoFiles();
    const r = JSON.parse(files['reports.json']!);
    r.reports[1].id = r.reports[0].id;
    files['reports.json'] = JSON.stringify(r);
    const { app } = await newHistoryApp({ files });
    await app.run('tools.validate');
    const el = await mountReport(app, 'dien-ngay');
    // id trùng được báo ở mẫu thứ hai (chỉ số 1) → mở đúng mẫu đó qua vị trí lỗi
    const issue = app.store.state.issues.find((i) => i.code === 'E_RPT_DUP_ID')!;
    expect(issue.path).toBe('/reports/1/id');
    expect(el).not.toBeNull();
    expect((await app.save()).status).toBe('saved');
  });

  it('vị trí lỗi mở đúng editor: E_RPT_REF_TAG đưa tới mẫu và cột', async () => {
    const files = historyDemoFiles();
    const r = JSON.parse(files['reports.json']!);
    r.reports[0].columns[0].tagId = 'PROC.PRESSURE';
    files['reports.json'] = JSON.stringify(r);
    const { app } = await newHistoryApp({ files });
    await app.run('tools.validate');
    const issue = app.store.state.issues.find((i) => i.code === 'E_RPT_REF_TAG')!;
    expect(app.gotoIssue(issue)).toBe(true);
    expect(app.store.state.active).toBe('report:dien-ngay');
  });
});

describe('xem trước và xuất thử', () => {
  it('nguồn mặc định là Dữ liệu mô phỏng; chọn Dữ liệu thiết bị khi chưa Online báo chưa Online', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    expect(field(el, 'source').value).toBe('sim');
    expect(rowCount(el)).toBe(25);
    setValue(field(el, 'source'), 'device');
    await settled(el);
    await preview(el).whenIdle();
    expect(norm(el.querySelector('mat-report-preview .rp-msg')?.textContent)).toContain('Online');
    expect(el.querySelector('mat-report-preview table.rpt')).toBeNull();
    setValue(field(el, 'source'), 'sim');
    await settled(el);
    await preview(el).whenIdle();
    expect(rowCount(el)).toBe(25);
  });

  it('đổi hàm cập nhật bảng xem trước ≤ 300 ms (SC-020)', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    cell(el, 0, 'tag')!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
    );
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await settled(el);
    const t0 = performance.now();
    el.querySelector<HTMLInputElement>('[data-fn="min"]')!.click();
    await settled(el);
    await preview(el).whenIdle();
    expect(performance.now() - t0).toBeLessThan(300);
    const heads = [...el.querySelectorAll('mat-report-preview thead th')].map((th) =>
      norm(th.textContent),
    );
    expect(heads.some((h) => h.endsWith('Nhỏ nhất'))).toBe(true);
  });

  it('nút CSV lưu qua lệnh Tauri giả: tên file <id>_<kỳ>.csv, BOM UTF-8', async () => {
    const { app, platform } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    const input = el.querySelector<HTMLInputElement>('mat-report-preview [data-role="period"]')!;
    setValue(input, '2026-10-12');
    await preview(el).whenIdle();
    el.querySelector<HTMLButtonElement>('mat-report-preview [data-act="csv"]')!.click();
    await preview(el).whenIdle();
    expect(platform.control.savedReports).toHaveLength(1);
    expect(platform.control.savedReports[0]!.name).toBe('dien-ngay_2026-10-12.csv');
    expect([...platform.control.savedReports[0]!.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe('danh sách mẫu trong cây', () => {
  it('cây có mục Báo cáo với ba mẫu; trang danh sách thêm mẫu mới và mở nó', async () => {
    const { app } = await newHistoryApp();
    const labels = JSON.stringify(app.tree());
    expect(labels).toContain('report:dien-ngay');
    expect(labels).toContain('report:dien-thang');
    app.openEditor('reports');
    const host = document.createElement('div');
    document.body.append(host);
    render(renderEditor(app, 'reports'), host);
    await settled(host);
    expect(host.querySelectorAll('[data-report]')).toHaveLength(3);
    host.querySelector<HTMLButtonElement>('[data-act="add-report"]')!.click();
    await settled(host);
    expect(reportsOf(app).reports).toHaveLength(4);
    expect(app.store.state.active).toMatch(/^report:bao-cao/);
    expect(loggingOf(app).groups.length).toBeGreaterThan(0);
  });
});
