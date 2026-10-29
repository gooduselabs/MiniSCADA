// T134 (feature 010, US8; contracts/studio-010.md §3): widget lịch sử trong Studio. Toolbox có nhóm "Lịch sử" (bốn widget, biểu tượng
// riêng; chỉ ở project định dạng 0.6); inspector sinh từ danh mục 0.5.0 (thuộc tính `group` là danh sách nhóm lưu trữ của project);
// thả Tag ngoài nhóm hoặc Tag không có tổng hợp báo lỗi NGAY; xem trước màn hình dùng nguồn mô phỏng hoặc nguồn thiết bị.
import { afterEach, describe, expect, it } from 'vitest';
import { historyFor } from '../app/history-sources.ts';
import { bindTag } from '../app/screen-bind.ts';
import { groupBindCheck } from '../model/history-bind.ts';
import { loggingOf, newHistoryApp, historyDemoFiles } from './history-test-helpers.ts';
import './mat-taskcards.ts';
import './props-widget.ts';
import type { MatWidgetProps } from './props-widget.ts';
import { cleanup, mount, settled } from './test-helpers.ts';

afterEach(cleanup);

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const HISTORY = ['history-trend', 'history-table', 'history-bar', 'history-pie'];

async function toolbox(files?: Record<string, string>) {
  const { app } = await newHistoryApp(files ? { files } : {});
  app.openEditor('screen:ap-suat');
  const el = await mount('mat-taskcards', app);
  await settled(el);
  return { app, el };
}

describe('Toolbox nhóm Lịch sử', () => {
  it('project 0.6: nhóm "Lịch sử" có bốn widget, mỗi cái một biểu tượng riêng và nhãn tiếng Việt', async () => {
    const { el } = await toolbox();
    const head = [...el.querySelectorAll('.acc > button')].find((b) =>
      norm(b.textContent).startsWith('Lịch sử'),
    );
    expect(head, 'có tiêu đề nhóm Lịch sử').toBeDefined();
    expect(norm(head!.querySelector('.cnt')?.textContent)).toBe('4');
    const tools = HISTORY.map((id) => el.querySelector<HTMLElement>(`.tool[data-widget="${id}"]`));
    expect(tools.every(Boolean)).toBe(true);
    expect(tools.map((x) => x!.querySelector('use')?.getAttribute('href'))).toEqual([
      '#i-hist-trend',
      '#i-hist-table',
      '#i-hist-bar',
      '#i-hist-pie',
    ]);
    expect(norm(tools[0]!.textContent)).toContain('Lịch sử: biểu đồ đường');
    expect(tools.every((x) => x!.draggable)).toBe(true);
  });

  it('project chưa ở định dạng 0.6: không có nhóm Lịch sử (17 widget cũ, 6 widget dashboard của 014 — stat-tile đã gộp vào card ở 037 —, time-range của 029, 3 widget của 037)', async () => {
    const files = historyDemoFiles();
    const p = JSON.parse(files['project.json']!);
    p.schemaVersion = '0.3.0';
    files['project.json'] = JSON.stringify(p);
    const { el } = await toolbox(files);
    expect(el.querySelector('.tool[data-widget="history-trend"]')).toBeNull();
    expect(el.querySelectorAll('.tool[data-widget]').length).toBe(27); // vòng 2: Đèn báo gộp vào Đèn / trạng thái; 041: + Lịch sử alarm (preset của alarm-list)
    expect(el.querySelector('.tool[data-widget="stat-tile"]')).toBeNull();
  });
});

describe('Toolbox: ô tìm component (037)', () => {
  it('lọc theo tên hoặc mô tả, không dấu vẫn khớp; không khớp thì báo', async () => {
    const { el } = await toolbox();
    const input = el.querySelector<HTMLInputElement>('input.tc-toolsearch')!;
    expect(input).not.toBeNull();
    input.value = 'den thap';
    input.dispatchEvent(new Event('input'));
    await settled(el);
    expect(
      [...el.querySelectorAll<HTMLElement>('.tool[data-widget]')].map((b) => b.dataset['widget']),
    ).toEqual(['stack-light']);
    input.value = 'bơm';
    input.dispatchEvent(new Event('input'));
    await settled(el);
    const ids = [...el.querySelectorAll<HTMLElement>('.tool[data-widget]')].map(
      (b) => b.dataset['widget'],
    );
    expect(ids).toContain('equipment');
    expect(el.querySelector('.tool[data-widget="equipment"]')!.getAttribute('title')).toContain(
      'Motor',
    );
    input.value = 'zzzz';
    input.dispatchEvent(new Event('input'));
    await settled(el);
    expect(el.querySelectorAll('.tool[data-widget]').length).toBe(0);
    expect(el.textContent).toContain('Không có component khớp');
  });
});

describe('inspector của widget lịch sử', () => {
  async function props(item = 'trend') {
    const { app } = await newHistoryApp();
    app.openEditor('screen:ap-suat');
    app.selectItems('ap-suat', [item]);
    const el = await mount<MatWidgetProps>('mat-widget-props', app);
    el.screenId = 'ap-suat';
    await settled(el);
    return { app, el };
  }

  it('thuộc tính `group` là danh sách nhóm lưu trữ của project; chọn nhóm khác là một sửa đổi, hoàn tác được', async () => {
    const { app, el } = await props();
    const sel = el.querySelector<HTMLSelectElement>('#pf-group')!;
    expect(sel, 'ô nhóm lưu trữ').not.toBeNull();
    expect([...sel.options].map((o) => o.value)).toEqual([
      '',
      'ap-suat',
      'me-tron',
      'dien',
      'van-hanh',
    ]);
    expect(sel.value).toBe('ap-suat');
    sel.value = 'dien';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    const item = app.screenModel('ap-suat')!.items.find((i) => i.id === 'trend') as {
      props: Record<string, unknown>;
    };
    expect(item.props.group).toBe('dien');
    app.store.undo();
    const back = app.screenModel('ap-suat')!.items.find((i) => i.id === 'trend') as {
      props: Record<string, unknown>;
    };
    expect(back.props.group).toBe('ap-suat');
  });

  it('nhãn tiếng Việt cho thuộc tính và tùy chọn của danh mục 0.5.0 (không hiện khóa thô)', async () => {
    const { app, el } = await props();
    expect(norm(el.textContent)).toContain('Nhóm lưu trữ');
    app.screens.inspTab = 'display';
    el.requestUpdate();
    await settled(el);
    const text = norm(el.textContent);
    expect(text).toContain('Khoảng thời gian');
    expect(text).not.toMatch(/wprop\.|wopt\.|widget\.history/);
    const range = el.querySelector<HTMLSelectElement>('#pf-range')!;
    expect([...range.options].map((o) => norm(o.textContent))).toEqual([
      '1 giờ',
      '8 giờ',
      '24 giờ',
      '7 ngày',
      '30 ngày',
      'Hôm nay',
      'Hôm qua',
    ]);
  });
});

describe('gắn Tag vào widget lịch sử', () => {
  it('groupBindCheck: không nhóm, nhóm lạ, Tag ngoài nhóm, Tag không tổng hợp, hợp lệ', async () => {
    const { app } = await newHistoryApp();
    const logging = loggingOf(app);
    const slot = { inGroup: 'group', needsAggregate: true };
    expect(groupBindCheck(slot, {}, 'PROC.TEMP', logging, null)).toBe('no-group');
    expect(groupBindCheck(slot, { group: 'x' }, 'PROC.TEMP', logging, null)).toBe('group-gone');
    expect(groupBindCheck(slot, { group: 'ap-suat' }, 'PUMP1.RUN', logging, null)).toBe(
      'not-in-group',
    );
    expect(groupBindCheck(slot, { group: 'van-hanh' }, 'PUMP1.RUN', logging, null)).toBe(
      'no-aggregate',
    ); // nhóm không bật Tổng hợp
    expect(groupBindCheck(slot, { group: 'ap-suat' }, 'PROC.TEMP', logging, null)).toBeNull();
    expect(groupBindCheck({}, undefined, 'bất kỳ', logging, null)).toBeNull(); // khe thường: không kiểm nhóm
    expect(
      groupBindCheck({ inGroup: 'group' }, { group: 'van-hanh' }, 'PUMP1.RUN', logging, null),
    ).toBeNull(); // trend: không cần tổng hợp
  });

  it('thả Tag ngoài nhóm lên widget báo lỗi ngay và không đổi màn hình; Tag trong nhóm gắn được', async () => {
    const { app } = await newHistoryApp();
    app.openEditor('screen:ap-suat');
    const before = JSON.stringify(app.screenModel('ap-suat'));
    expect(bindTag(app, 'ap-suat', 'trend', 'PUMP1.RUN', 'series')).toBe(false);
    expect(app.ui.toast?.text).toContain('nhóm');
    expect(JSON.stringify(app.screenModel('ap-suat'))).toBe(before);
    app.store.edit([
      {
        kind: 'logging',
        value: {
          ...loggingOf(app),
          groups: loggingOf(app).groups.map((g) =>
            g.id === 'ap-suat' ? { ...g, tags: [...g.tags, { tagId: 'METER1.KW' }] } : g,
          ),
        },
      },
    ]);
    expect(bindTag(app, 'ap-suat', 'trend', 'METER1.KW', 'series')).toBe(true);
    const item = app.screenModel('ap-suat')!.items.find((i) => i.id === 'trend') as unknown as {
      tags: { series: string[] };
    };
    expect(item.tags.series).toContain('METER1.KW');
  });
});

describe('xem trước màn hình có widget lịch sử', () => {
  it('chế độ Mô phỏng dùng SimHistorySource, Thiết bị dùng nguồn thiết bị, Tắt không có nguồn; nguồn dùng chung giữa các lần gọi', async () => {
    const { app } = await newHistoryApp();
    expect(historyFor(app, 'off')).toBeUndefined();
    const sim = historyFor(app, 'sim')!;
    const dev = historyFor(app, 'device')!;
    expect(sim).toBe(historyFor(app, 'sim'));
    expect(dev).toBe(historyFor(app, 'device'));
    expect(sim).not.toBe(dev);
    const cat = await sim.catalog();
    expect(cat.groups.map((g) => g.id)).toEqual(['ap-suat', 'me-tron', 'dien', 'van-hanh']);
    await expect(dev.catalog()).rejects.toMatchObject({ code: 'NO_DEVICE' });
  });

  it('nguồn mô phỏng dựng lại khi cấu hình lưu trữ đổi (nhóm mới xuất hiện trong danh mục)', async () => {
    const { app } = await newHistoryApp();
    const a = historyFor(app, 'sim')!;
    app.store.edit([
      { kind: 'logging', value: { ...loggingOf(app), groups: loggingOf(app).groups.slice(0, 2) } },
    ]);
    const b = historyFor(app, 'sim')!;
    expect(b).not.toBe(a);
    expect((await b.catalog()).groups).toHaveLength(2);
  });
});
