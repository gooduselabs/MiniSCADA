// T087: trang #/history: chọn nhóm, ≤ 16 Tag, khoảng; lựa chọn nằm trong đường dẫn; trạng thái; chữ thuần.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeActionHost,
  FakeHistorySource,
  HistoryError,
  MemoryTagSource,
  historyEnv,
  registerWidgets,
  type HistoryCatalog,
  type HistoryPlotFactory,
} from '@mat/ui-components';
import { HistoryPage } from './history-page.ts';

const NOW = 1_790_000_000_000;

const fakePlot: HistoryPlotFactory = () => ({
  setData: () => {},
  setSize: () => {},
  redraw: () => {},
  setSeriesShow: () => {},
  plotBox: () => ({ left: 0, top: 0, width: 400, height: 100 }),
  destroy: () => {},
});

function catalog(nTags = 6): HistoryCatalog {
  const tags = Array.from({ length: nTags }, (_, i) => ({
    tagId: `T${i + 1}`,
    column: `T${i + 1}`,
    type: i === 5 ? 'STRING' : 'FLOAT32',
    unit: 'bar',
    aggregated: i !== 5,
    orphan: false,
  }));
  const c = new FakeHistorySource().catalogData;
  c.groups = [
    { ...c.groups[0]!, id: 'ap-suat', name: 'Áp suất', tags },
    { ...c.groups[0]!, id: 'dien', name: 'Điện', tags: tags.slice(0, 2) },
  ];
  return c;
}

interface Ctx {
  root: HTMLElement;
  hist: FakeHistorySource;
  page: HistoryPage;
  urls: string[];
}

function setup(cat = catalog()): Ctx {
  registerWidgets();
  historyEnv.loadPlot = async () => fakePlot;
  const hist = new FakeHistorySource();
  hist.catalogData = cat;
  const root = document.createElement('div');
  document.body.append(root);
  const urls: string[] = [];
  const page = new HistoryPage({
    container: root,
    history: hist,
    tags: new MemoryTagSource({ now: NOW }),
    host: new FakeActionHost(),
    onUrl: (h) => urls.push(h),
  });
  return { root, hist, page, urls };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

const trend = (root: HTMLElement) =>
  root.querySelector('mat-w-history-trend') as HTMLElement & {
    item: { tags: { series: string[] }; props: Record<string, unknown> };
  };
const table = (root: HTMLElement) =>
  root.querySelector('mat-w-history-table') as HTMLElement & {
    item: { tags: { columns: string[] }; props: Record<string, unknown> };
  };
const boxes = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('HistoryPage: dựng trang', () => {
  it('liệt kê nhóm; mặc định nhóm đầu và 4 Tag đầu (số), biểu đồ và bảng nhận đúng Tag', async () => {
    const { root, page } = setup();
    await page.show(new URLSearchParams());
    await flush();
    const opts = [...root.querySelectorAll('select option')].map((o) => o.getAttribute('value'));
    expect(opts).toEqual(['ap-suat', 'dien']);
    expect(trend(root).item.tags.series).toEqual(['T1', 'T2', 'T3', 'T4']);
    expect(trend(root).item.props.group).toBe('ap-suat');
    expect(table(root).item.tags.columns).toEqual(['T1', 'T2', 'T3', 'T4']);
    expect(boxes(root).filter((b) => b.checked).length).toBe(4);
    expect(root.textContent).toContain('Đã chọn 4 / 16');
  });

  it('Tag kiểu chuỗi: có trong bảng nhưng không vào biểu đồ', async () => {
    const { root, page } = setup();
    await page.show(new URLSearchParams('t=T1,T6'));
    await flush();
    expect(trend(root).item.tags.series).toEqual(['T1']);
    expect(table(root).item.tags.columns).toEqual(['T1', 'T6']);
  });

  it('khôi phục từ đường dẫn (F5): nhóm, Tag, khoảng; Tag lạ và nhóm lạ bị bỏ', async () => {
    const { root, page } = setup();
    await page.show(new URLSearchParams('g=dien&t=T2,KHONG-CO,T1&r=7d'));
    await flush();
    expect(trend(root).item.props.group).toBe('dien');
    expect(trend(root).item.tags.series).toEqual(['T2', 'T1']);
    expect(trend(root).item.props.range).toBe('7d');
    root.replaceChildren();
    const b = setup();
    await b.page.show(new URLSearchParams('g=khong-co&r=xx'));
    await flush();
    expect(trend(b.root).item.props.group).toBe('ap-suat');
    expect(trend(b.root).item.props.range).toBe('24h');
  });

  it('đổi lựa chọn cập nhật widget và đường dẫn (replace, không thêm lịch sử)', async () => {
    const { root, page, urls } = setup();
    await page.show(new URLSearchParams());
    await flush();
    const cb = boxes(root).find((b) => b.value === 'T3')!;
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(trend(root).item.tags.series).toEqual(['T1', 'T2', 'T4']);
    expect(urls.at(-1)).toBe('#/history?g=ap-suat&t=T1%2CT2%2CT4&r=24h');
    const sel = root.querySelector('select') as HTMLSelectElement;
    sel.value = 'dien';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(trend(root).item.props.group).toBe('dien');
    expect(trend(root).item.tags.series).toEqual(['T1', 'T2']);
    expect(urls.at(-1)).toContain('g=dien');
  });

  it('chọn khoảng ở biểu đồ ghi vào đường dẫn', async () => {
    const { root, page, urls } = setup();
    await page.show(new URLSearchParams());
    await flush();
    trend(root).dispatchEvent(
      new CustomEvent('mat-history-range', {
        detail: { range: '8h' },
        bubbles: true,
        composed: true,
      }),
    );
    await flush();
    expect(urls.at(-1)).toContain('r=8h');
    expect(table(root).item.props.range).toBe('8h');
  });

  it('tối đa 16 Tag: Tag thứ 17 không chọn được', async () => {
    const { root, page } = setup(catalog(20));
    await page.show(
      new URLSearchParams(`t=${Array.from({ length: 16 }, (_, i) => `T${i + 1}`).join(',')}`),
    );
    await flush();
    expect(root.textContent).toContain('Đã chọn 16 / 16');
    const t17 = boxes(root).find((b) => b.value === 'T17')!;
    expect(t17.disabled).toBe(true);
    expect(trend(root).item.tags.series.length).toBe(8); // biểu đồ vẽ tối đa 8 đường
  });

  it('không chọn Tag nào: hướng dẫn thay vì biểu đồ trống', async () => {
    const { root, page } = setup();
    await page.show(new URLSearchParams());
    await flush();
    for (const b of boxes(root).filter((x) => x.checked)) {
      b.checked = false;
      b.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await flush();
    expect(root.textContent).toContain('Chọn ít nhất một Tag');
    expect(trend(root)).toBeNull();
  });

  it('tên nhóm và Tag chứa mã HTML hiện thành chữ', async () => {
    const cat = catalog();
    cat.groups[0]!.name = '<img src=x onerror=alert(1)>';
    cat.groups[0]!.tags[0]!.tagId = '<b>x</b>';
    const { root, page } = setup(cat);
    await page.show(new URLSearchParams());
    await flush();
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.querySelector('b')).toBeNull();
  });
});

describe('HistoryPage: trạng thái', () => {
  it('chưa đăng nhập: chữ + nút Đăng nhập; đăng nhập xong tự tải lại danh mục', async () => {
    const { root, page, hist } = setup();
    hist.state = 'login-required';
    hist.failWith = new HistoryError('AUTH_REQUIRED', 'x', 401);
    await page.show(new URLSearchParams());
    await flush();
    expect(root.textContent).toContain('Đăng nhập để xem lịch sử');
    (root.querySelector('button.login') as HTMLButtonElement).click();
    expect(hist.loginRequests).toBe(1);
    hist.failWith = null;
    hist.setState('ready');
    await flush();
    expect(root.querySelector('select')).not.toBeNull();
    expect(root.textContent).not.toContain('Đăng nhập để xem lịch sử');
  });

  it('chưa bật lưu trữ', async () => {
    const { root, page, hist } = setup();
    hist.catalogData.enabled = false;
    await page.show(new URLSearchParams());
    await flush();
    expect(root.textContent).toContain('Chưa bật lưu trữ');
  });

  it('không có nhóm nào', async () => {
    const cat = catalog();
    cat.groups = [];
    const { root, page } = setup(cat);
    await page.show(new URLSearchParams());
    await flush();
    expect(root.textContent).toContain('Chưa có nhóm lưu trữ');
  });

  it('lỗi tải danh mục: Thử lại', async () => {
    const { root, page, hist } = setup();
    hist.failWith = new HistoryError('HISTORY_UNAVAILABLE', 'x', 503);
    await page.show(new URLSearchParams());
    await flush();
    expect(root.textContent).toContain('Không tải được danh mục lịch sử');
    hist.failWith = null;
    (root.querySelector('button.retry') as HTMLButtonElement).click();
    await flush();
    expect(root.querySelector('select')).not.toBeNull();
  });

  it('hide/dispose: gỡ widget và hủy theo dõi trạng thái', async () => {
    const { root, page, hist } = setup();
    await page.show(new URLSearchParams());
    await flush();
    page.hide();
    expect(root.hidden).toBe(true);
    page.dispose();
    expect(root.childElementCount).toBe(0);
    hist.setState('busy'); // không ném lỗi sau dispose
  });
});
