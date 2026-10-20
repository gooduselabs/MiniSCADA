// Trình thiết kế báo cáo (feature 010 US8; feature 015 US2, T032): ba vùng Cấu trúc | Xem trước trực tiếp | Thuộc tính. Chọn
// mục ở Cấu trúc hoặc bấm vào phần của báo cáo ở xem trước, sửa ở Thuộc tính (một bước hoàn tác mỗi lần), kéo Tag để thêm cột,
// lỗi E_RPT_* tại trường, tùy chọn của định dạng 1.1 (loại, tuần, thẻ, biểu đồ) khóa ở project cũ, thư viện mẫu có sẵn.
import { render } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setEChartsLoader } from '@mat/ui-components';
import type { StudioApp } from '../../app/app.ts';
import { historyDemoFiles, newHistoryApp, reportsOf } from '../history-test-helpers.ts';
import type { ReportPreview } from '../report-preview.ts';
import { renderEditor } from '../registry.ts';
import { cleanup, settled } from '../test-helpers.ts';
import './templates-editor.ts';

// Xem trước báo cáo ca hiện ngày làm việc đã xong gần nhất (ca từ 06:00): đồng hồ cố định 10:00 giữ số hàng ổn định; chỉ
// Date bị giả, timer của Lit và xem trước vẫn thật. ECharts thật nạp chậm trong jsdom: bộ nạp giả.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0, 0));
  setEChartsLoader(async () => ({ init: () => ({ setOption() {}, resize() {}, dispose() {} }) }));
});
afterEach(() => {
  vi.useRealTimers();
  setEChartsLoader(null);
});
afterEach(cleanup);

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** history-demo nâng lên định dạng 1.1 (mọi tệp cùng phiên bản, runtime tối thiểu 1.1.0). */
function files11(): Record<string, string> {
  const files = historyDemoFiles();
  for (const [k, v] of Object.entries(files)) {
    if (!k.endsWith('.json')) continue;
    const j = JSON.parse(v);
    if (j && typeof j === 'object' && typeof j.schemaVersion === 'string') {
      j.schemaVersion = '1.1.0';
      if (k === 'project.json') j.minRuntimeVersion = '1.1.0';
      files[k] = JSON.stringify(j);
    }
  }
  return files;
}

async function mountReport(app: StudioApp, id: string): Promise<HTMLElement> {
  app.openEditor(`report:${id}`);
  const host = document.createElement('div');
  document.body.append(host);
  render(renderEditor(app, `report:${id}`), host);
  await settled(host);
  const el = host.querySelector<HTMLElement>('mat-templates-editor');
  expect(el, 'trình thiết kế báo cáo đã đăng ký').not.toBeNull();
  await preview(el!).whenIdle();
  return el!;
}

const preview = (el: Element) => el.querySelector<ReportPreview>('mat-report-preview')!;
const view = (el: Element): ParentNode =>
  el.querySelector('mat-report-view')?.shadowRoot ?? document.createDocumentFragment();
const field = (el: Element, name: string) =>
  el.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-field="${name}"]`)!;
const node = (el: Element, part: string) =>
  el.querySelector<HTMLButtonElement>(`.rd-outline [data-node="${part}"]`);
const setValue = (el: HTMLInputElement | HTMLSelectElement, v: string, ev = 'change') => {
  el.value = v;
  el.dispatchEvent(new Event(ev, { bubbles: true }));
};
const tpl = (app: StudioApp, i = 0) => reportsOf(app).reports[i]!;
const rowCount = (el: Element) => view(el).querySelectorAll('table.rpt tbody tr').length;
async function pick(el: HTMLElement, part: string): Promise<void> {
  node(el, part)!.click();
  await settled(el);
}
async function idle(el: HTMLElement): Promise<void> {
  await settled(el);
  await preview(el).whenIdle();
}
function dropTag(target: HTMLElement, tag: string): void {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', {
    value: {
      getData: (k: string) => (k === 'application/x-mat-tag' ? tag : ''),
      types: ['application/x-mat-tag'],
    },
  });
  target.dispatchEvent(e);
}

describe('ba vùng: Cấu trúc, Xem trước trực tiếp, Thuộc tính', () => {
  it('Cấu trúc có các mục và một mục cho mỗi cột; mặc định chọn Thông tin chung', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    for (const p of ['general', 'period', 'tiles', 'chart', 'col:0', 'col:1', 'page'])
      expect(node(el, p), p).not.toBeNull();
    expect(node(el, 'general')!.getAttribute('aria-current')).toBe('true');
    expect(norm(node(el, 'col:0')!.textContent)).toContain('METER1.KWH');
    expect(el.querySelector('.rd-canvas mat-report-preview')).not.toBeNull();
    expect(el.querySelector('.rd-props')!.getAttribute('data-part')).toBe('general');
    expect(rowCount(el)).toBe(25);
  });

  it('Thông tin chung: tên, id, nhóm chỉ nhóm có tổng hợp; loại khác Bảng bị khóa ở project 0.6 kèm biểu ngữ', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    expect(field(el, 'name').value).toBe('Điện năng theo ngày');
    expect(field(el, 'id').value).toBe('dien-ngay');
    const groups = [...field(el, 'group').querySelectorAll('option')].map((o) => o.value);
    expect(groups).toEqual(['ap-suat', 'dien']);
    const kinds = [...field(el, 'kind').querySelectorAll('option')].map((o) => [
      o.value,
      o.disabled,
    ]);
    expect(kinds).toEqual([
      ['table', false],
      ['equipment', true],
      ['alarm', true],
      ['logic', true],
    ]);
    expect(el.querySelector('.rd-banner')).not.toBeNull();
  });

  it('sửa tên (Thông tin chung) và chân trang (Trang in): mỗi lần một bước hoàn tác', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    setValue(field(el, 'name'), 'Tên khác');
    expect(tpl(app).name).toBe('Tên khác');
    await pick(el, 'page');
    expect(field(el, 'paper.orientation').value).toBe('landscape');
    setValue(field(el, 'footer'), '');
    expect(tpl(app).footer).toBeUndefined();
    app.store.undo();
    app.store.undo();
    expect(tpl(app).name).toBe('Điện năng theo ngày');
    expect(tpl(app).footer).toBe('Phòng Kỹ thuật');
  });

  it('chưa có nhóm nào có tổng hợp: hướng dẫn kèm nút mở Lưu trữ', async () => {
    const files = historyDemoFiles();
    const l = JSON.parse(files['logging.json']!);
    for (const g of l.groups) delete g.aggregates;
    files['logging.json'] = JSON.stringify(l);
    const { app } = await newHistoryApp({ files });
    const el = await mountReport(app, 'dien-ngay');
    el.querySelector<HTMLButtonElement>('[data-role="no-group"] button')!.click();
    expect(app.store.state.active).toBe('logging');
  });
});

describe('kỳ và ca', () => {
  it('chọn Ca: 3 ca 06:00, nhãn ca hiện ngay, nhóm hàng theo ca; xem trước 3 hàng và dòng tổng', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    await pick(el, 'period');
    expect(norm(el.querySelector('[data-role="grouping"]')?.textContent)).toContain('60 phút');
    setValue(field(el, 'period'), 'shift');
    await idle(el);
    expect(tpl(app)).toMatchObject({ period: 'shift', shifts: { count: 3, start: '06:00' } });
    const labels = [...el.querySelectorAll('[data-role="shift-labels"] li')].map((li) =>
      norm(li.textContent),
    );
    expect(labels).toEqual(['Ca 1 06:00–14:00', 'Ca 2 14:00–22:00', 'Ca 3 22:00–06:00']);
    expect(rowCount(el)).toBe(4);
    // tuần và khoảng: chỉ ở định dạng 1.1
    const off = [...field(el, 'period').querySelectorAll('option')]
      .filter((o) => o.disabled)
      .map((o) => o.value);
    expect(off).toEqual(['week', 'range']);
  });

  it('giờ bắt đầu sai vẫn ghi và hiện lỗi E_RPT_SHIFT tại trường sau Kiểm tra; mục Kỳ có dấu lỗi', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ca');
    await pick(el, 'period');
    setValue(field(el, 'shifts.start'), '25:99');
    expect(tpl(app, 1).shifts!.start).toBe('25:99');
    await app.run('tools.validate');
    await settled(el);
    expect(field(el, 'shifts.start').getAttribute('aria-invalid')).toBe('true');
    expect(norm(el.querySelector('[data-error="shifts"]')?.textContent)).toContain('E_RPT_SHIFT');
    expect(node(el, 'period')!.querySelector('.rd-bad')).not.toBeNull();
  });
});

describe('cột: chọn, sửa, thêm bằng gõ hoặc kéo Tag', () => {
  it('chọn cột ở Cấu trúc: Tag, nhãn, hàm; bật/tắt hàm giữ thứ tự, không bỏ hàm cuối', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    await pick(el, 'col:0');
    expect(field(el, 'col.tag').value).toBe('METER1.KWH');
    expect(field(el, 'col.label').value).toBe('Điện năng');
    const box = (fn: string) => el.querySelector<HTMLInputElement>(`[data-fn="${fn}"]`)!;
    expect(box('delta').checked).toBe(true);
    // thời gian ON: chỉ Tag BOOL và định dạng 1.1
    expect(box('onTime').disabled).toBe(true);
    box('avg').click();
    expect(tpl(app).columns![0]!.functions).toEqual(['max', 'avg', 'delta']);
    box('avg').click();
    box('delta').click();
    box('max').click(); // hàm cuối: giữ lại
    expect(tpl(app).columns![0]!.functions).toEqual(['max']);
  });

  it('bấm tiêu đề cột ở xem trước chọn cột đó; Gợi ý đơn vị: kW + Tổng → kWh; Lên/Xuống, Bỏ cột', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    const th = [...view(el).querySelectorAll<HTMLElement>('table.rpt thead th')].find((h) =>
      norm(h.textContent).startsWith('Công suất'),
    )!;
    th.click();
    await settled(el);
    expect(el.querySelector('.rd-props')!.getAttribute('data-part')).toBe('col:1');
    el.querySelector<HTMLInputElement>('[data-fn="sum"]')!.click();
    el.querySelector<HTMLInputElement>('[data-fn="avg"]')!.click();
    el.querySelector<HTMLInputElement>('[data-fn="max"]')!.click();
    el.querySelector<HTMLButtonElement>('[data-act="suggest-unit"]')!.click();
    expect(tpl(app).columns![1]!.unit).toBe('kWh');
    await settled(el);
    el.querySelector<HTMLButtonElement>('[data-act="col-up"]')!.click();
    expect(tpl(app).columns!.map((c) => c.tagId)).toEqual(['METER1.KW', 'METER1.KWH']);
    await settled(el);
    el.querySelector<HTMLButtonElement>('[data-act="col-remove"]')!.click();
    expect(tpl(app).columns!.map((c) => c.tagId)).toEqual(['METER1.KWH']);
  });

  it('thêm cột: gõ Tag ngoài nhóm bị từ chối kèm thông báo; kéo Tag thả vào xem trước thêm cột và chọn nó', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ca');
    const input = el.querySelector<HTMLInputElement>('[data-role="add-tag"]')!;
    setValue(input, 'PROC.PRESSURE', 'input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settled(el);
    expect(tpl(app, 1).columns!.map((c) => c.tagId)).not.toContain('PROC.PRESSURE');
    expect(app.ui.toast?.text).toContain('nhóm');
    app.store.edit([
      {
        kind: 'reports',
        value: {
          ...reportsOf(app),
          reports: reportsOf(app).reports.map((r, i) =>
            i === 1 ? { ...r, columns: r.columns!.slice(0, 1) } : r,
          ),
        },
      },
    ]);
    await settled(el);
    dropTag(el.querySelector<HTMLElement>('.rd-canvas')!, 'METER1.KW');
    await settled(el);
    expect(tpl(app, 1).columns!.map((c) => c.tagId)).toEqual(['METER1.KWH', 'METER1.KW']);
    expect(el.querySelector('.rd-props')!.getAttribute('data-part')).toBe('col:1');
  });
});

describe('định dạng 1.1: loại báo cáo, thẻ, biểu đồ, tuần', () => {
  it('đổi loại sang Sự kiện alarm: bỏ nhóm và cột, xem trước sự kiện mô phỏng có bảng phụ', async () => {
    const { app } = await newHistoryApp({ files: files11() });
    const el = await mountReport(app, 'dien-ngay');
    expect(el.querySelector('.rd-banner')).toBeNull();
    setValue(field(el, 'kind'), 'alarm');
    await idle(el);
    expect(tpl(app).kind).toBe('alarm');
    expect(tpl(app).group).toBeUndefined();
    expect(tpl(app).columns).toBeUndefined();
    expect(node(el, 'col:0')).toBeNull();
    expect(view(el).querySelectorAll('figure.section').length).toBe(4);
    app.store.undo();
    await idle(el);
    expect(tpl(app).kind).toBeUndefined();
    expect(tpl(app).columns!.length).toBe(2);
  });

  it('thẻ tắt được, biểu đồ chọn được (không vẽ), kỳ tuần 7 hàng', async () => {
    const { app } = await newHistoryApp({ files: files11() });
    const el = await mountReport(app, 'dien-ngay');
    expect(view(el).querySelectorAll('.tile').length).toBeGreaterThan(0);
    await pick(el, 'tiles');
    field(el, 'tiles').click();
    await idle(el);
    expect(tpl(app).tiles).toBe(false);
    expect(view(el).querySelectorAll('.tile')).toHaveLength(0);
    await pick(el, 'chart');
    el.querySelector<HTMLInputElement>('[data-chart="none"]')!.click();
    el.querySelector<HTMLInputElement>('[data-chart="none"]')!.dispatchEvent(new Event('change'));
    await idle(el);
    expect(tpl(app).chart).toBe('none');
    expect(view(el).querySelector('.chart')).toBeNull();
    await pick(el, 'period');
    setValue(field(el, 'period'), 'week');
    await idle(el);
    expect(rowCount(el)).toBe(8); // 7 ngày + tổng
  });
});

describe('lỗi và xem trước', () => {
  it('vị trí lỗi mở đúng editor: E_RPT_REF_TAG đưa tới mẫu; lưu được khi còn lỗi', async () => {
    const files = historyDemoFiles();
    const r = JSON.parse(files['reports.json']!);
    r.reports[0].columns[0].tagId = 'PROC.PRESSURE';
    files['reports.json'] = JSON.stringify(r);
    const { app } = await newHistoryApp({ files });
    await app.run('tools.validate');
    const issue = app.store.state.issues.find((i) => i.code === 'E_RPT_REF_TAG')!;
    expect(app.gotoIssue(issue)).toBe(true);
    expect(app.store.state.active).toBe('report:dien-ngay');
    const el = await mountReport(app, 'dien-ngay');
    expect(node(el, 'col:0')!.querySelector('.rd-bad')).not.toBeNull();
    expect((await app.save()).status).toBe('saved');
  });

  it('nguồn mặc định Dữ liệu mô phỏng; Dữ liệu thiết bị khi chưa Online báo chưa Online', async () => {
    const { app } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    expect(field(el, 'source').value).toBe('sim');
    setValue(field(el, 'source'), 'device');
    await idle(el);
    expect(norm(el.querySelector('mat-report-preview .rp-msg')?.textContent)).toContain('Online');
    setValue(field(el, 'source'), 'sim');
    await idle(el);
    expect(rowCount(el)).toBe(25);
  });

  it('đổi hàm cập nhật xem trước ≤ 300 ms (SC-020); CSV lưu qua lệnh Tauri giả', async () => {
    const { app, platform } = await newHistoryApp();
    const el = await mountReport(app, 'dien-ngay');
    await pick(el, 'col:0');
    const t0 = performance.now();
    el.querySelector<HTMLInputElement>('[data-fn="min"]')!.click();
    await idle(el);
    expect(performance.now() - t0).toBeLessThan(300);
    const heads = [...view(el).querySelectorAll('thead th')].map((th) => norm(th.textContent));
    expect(heads.some((h) => h.endsWith('nhỏ nhất'))).toBe(true);
    setValue(
      el.querySelector<HTMLInputElement>('mat-report-preview [data-role="period"]')!,
      '2026-10-12',
    );
    await idle(el);
    el.querySelector<HTMLButtonElement>('mat-report-preview [data-act="csv"]')!.click();
    await idle(el);
    expect(platform.control.savedReports[0]!.name).toBe('dien-ngay_2026-10-12.csv');
  });
});

describe('thư viện mẫu (trang Báo cáo, lệnh Thêm báo cáo)', () => {
  async function mountList(app: StudioApp): Promise<HTMLElement> {
    app.openEditor('reports');
    const host = document.createElement('div');
    document.body.append(host);
    render(renderEditor(app, 'reports'), host);
    await settled(host);
    return host;
  }

  it('7 mẫu; ở project 0.6 mẫu alarm/thiết bị/logic bị khóa; thêm mẫu ngày mở trình thiết kế', async () => {
    const { app } = await newHistoryApp();
    await app.run('report.add');
    expect(app.store.state.active).toBe('reports');
    const host = await mountList(app);
    expect(host.querySelectorAll('[data-preset]')).toHaveLength(7);
    expect(host.querySelector('[data-preset="alarm"]')!.getAttribute('aria-disabled')).toBe('true');
    expect(host.querySelectorAll('[data-report]')).toHaveLength(3);
    host.querySelector<HTMLButtonElement>('[data-preset="day"]')!.click();
    expect(reportsOf(app).reports).toHaveLength(4);
    expect(app.store.state.active).toBe('report:bao-cao-ngay');
    expect(reportsOf(app).reports[3]!.columns!.length).toBeGreaterThan(0);
  });

  it('project 1.1: thêm mẫu vận hành thiết bị (Tag BOOL, giờ chạy và số lần bật)', async () => {
    const files = files11();
    const l = JSON.parse(files['logging.json']!);
    l.groups.find((g: { id: string }) => g.id === 'ap-suat').tags.push({ tagId: 'PUMP1.RUN' });
    files['logging.json'] = JSON.stringify(l);
    const { app } = await newHistoryApp({ files });
    const host = await mountList(app);
    expect(
      host.querySelector('[data-preset="equipment"]')!.getAttribute('aria-disabled'),
    ).toBeNull();
    host.querySelector<HTMLButtonElement>('[data-preset="equipment"]')!.click();
    const t = reportsOf(app).reports.at(-1)!;
    expect(t.kind).toBe('equipment');
    expect(t.columns![0]).toMatchObject({ tagId: 'PUMP1.RUN', functions: ['onTime', 'starts'] });
  });
});
