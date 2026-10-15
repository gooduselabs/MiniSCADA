// T134 (feature 010, US8; contracts/studio-010.md §3): mục menu loại Báo cáo của editor Điều hướng. Mô hình: thêm lá `report`, đổi mẫu
// (bỏ `screen`), từ chối mẫu không có; giao diện: nút Thêm mục báo cáo, ô chọn mẫu, lá báo cáo không bị coi là hỏng, `E_NAV_REPORT`
// hiện lỗi tại ô khi mẫu không còn.
import type { Navigation } from '@mat/project-schema';
import { render } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addReportLeaf,
  setReportAt,
  setScreenAt,
  type ScreenRef,
} from '../../model/navigation-doc.ts';
import { historyDemoFiles, newHistoryApp } from '../history-test-helpers.ts';
import { renderEditor } from '../registry.ts';
import { cleanup, settled } from '../test-helpers.ts';
import './navigation-editor.ts';

afterEach(cleanup);

const SCREENS: ScreenRef[] = [{ id: 'tong-quan', kind: 'screen' }];
const REPORTS = ['dien-ngay', 'dien-ca'];
const nav0 = (): Navigation => ({
  position: 'left',
  items: [{ label: 'Tổng quan', screen: 'tong-quan' }],
});

describe('mô hình: mục báo cáo', () => {
  it('addReportLeaf thêm lá `report` không có `screen`; mẫu lạ bị từ chối; nhãn sai bị từ chối', () => {
    const r = addReportLeaf(
      nav0(),
      { label: 'Điện theo ca', report: 'dien-ca', icon: 'doc' },
      REPORTS,
    );
    expect(r.rejected).toBeUndefined();
    expect(r.nav.items[1]).toEqual({ label: 'Điện theo ca', report: 'dien-ca', icon: 'doc' });
    expect(addReportLeaf(nav0(), { label: 'X', report: 'khong-co' }, REPORTS).rejected).toBe(
      'bad-report',
    );
    expect(addReportLeaf(nav0(), { label: '', report: 'dien-ca' }, REPORTS).rejected).toBe(
      'bad-label',
    );
  });

  it('setReportAt đổi lá màn hình thành lá báo cáo (bỏ screen); setScreenAt đổi ngược lại (bỏ report); nhóm bị từ chối', () => {
    const a = setReportAt(nav0(), [0], 'dien-ngay', REPORTS);
    expect(a.nav.items[0]).toEqual({ label: 'Tổng quan', report: 'dien-ngay' });
    const b = setScreenAt(a.nav, [0], 'tong-quan', SCREENS);
    expect(b.nav.items[0]).toEqual({ label: 'Tổng quan', screen: 'tong-quan' });
    expect(setReportAt(nav0(), [0], 'khong-co', REPORTS).rejected).toBe('bad-report');
    const group: Navigation = {
      items: [{ label: 'G', items: [{ label: 'L', screen: 'tong-quan' }] }],
    };
    expect(setReportAt(group, [0], 'dien-ca', REPORTS).rejected).toBe('is-group');
  });

  it('lá báo cáo tính vào giới hạn 32 lá', () => {
    let nav: Navigation = { items: [] };
    for (let i = 0; i < 32; i++)
      nav = addReportLeaf(nav, { label: `B${i}`, report: 'dien-ca' }, REPORTS).nav;
    expect(addReportLeaf(nav, { label: 'thừa', report: 'dien-ca' }, REPORTS).rejected).toBe(
      'max-leaves',
    );
  });
});

describe('editor Điều hướng với mục báo cáo', () => {
  async function open(files?: Record<string, string>) {
    const { app } = await newHistoryApp(files ? { files } : {});
    const host = document.createElement('div');
    document.body.append(host);
    app.openEditor('navigation');
    render(renderEditor(app, 'navigation'), host);
    await settled(host);
    return { app, host };
  }
  const row = (host: Element, path: string) =>
    host.querySelector<HTMLElement>(`[data-path="${path}"]`)!;
  const nav = (app: Awaited<ReturnType<typeof open>>['app']) => app.store.state.outline.navigation!;

  it('lá báo cáo hiện tên mẫu và không bị coi là hỏng', async () => {
    const { host } = await open();
    const r = row(host, '3');
    expect(r.classList.contains('bad')).toBe(false);
    expect(r.textContent).toContain('Điện năng theo ngày');
  });

  it('chọn lá báo cáo: ô chọn mẫu thay ô màn hình; đổi mẫu là một sửa đổi, hoàn tác được', async () => {
    const { app, host } = await open();
    row(host, '3').click();
    await settled(host);
    expect(host.querySelector('#ne-screen')).toBeNull();
    const sel = host.querySelector<HTMLSelectElement>('#ne-report')!;
    expect([...sel.options].map((o) => o.value)).toEqual(['dien-ngay', 'dien-ca', 'dien-thang']);
    sel.value = 'dien-thang';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(host);
    expect(nav(app).items[3]!.report).toBe('dien-thang');
    app.store.undo();
    expect(nav(app).items[3]!.report).toBe('dien-ngay');
  });

  it('nút Thêm mục báo cáo thêm lá trỏ tới mẫu chưa có trong menu', async () => {
    const files = historyDemoFiles();
    const p = JSON.parse(files['project.json']!);
    p.navigation.items = p.navigation.items.slice(0, 4); // chỉ còn báo cáo "ngày" trong menu
    files['project.json'] = JSON.stringify(p);
    const { app, host } = await open(files);
    host.querySelector<HTMLButtonElement>('[data-act="add-report"]')!.click();
    await settled(host);
    const last = nav(app).items.at(-1)!;
    expect(last.report).toBe('dien-ca');
    expect(last.screen).toBeUndefined();
  });

  it('mẫu không còn: lá hiện lỗi tại ô (E_NAV_REPORT) và viền đỏ', async () => {
    const files = historyDemoFiles();
    const p = JSON.parse(files['project.json']!);
    p.navigation.items[3].report = 'khong-con';
    files['project.json'] = JSON.stringify(p);
    const { app, host } = await open(files);
    await app.run('tools.validate');
    expect(app.store.state.issues.some((i) => i.code === 'E_NAV_REPORT')).toBe(true);
    row(host, '3').click();
    await settled(host);
    expect(row(host, '3').classList.contains('bad')).toBe(true);
    expect(host.querySelector('.ne-form .pf-err')?.textContent).toContain('mẫu');
  });
});
