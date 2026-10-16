// T116 (khung Ước tính): thành phần mat-estimate-panel: mức màu kèm nhãn chữ, thanh, bảng nhóm với nhãn cơ sở, dung lượng,
// cảnh báo kèm nhóm lớn nhất và gợi ý, "chưa tính n Tag", văn bản tương đương cho trình đọc màn hình, cột "Đo thực" và
// nút Dùng số đo, cập nhật ≤ 100 ms với 32 nhóm × 200 Tag.
import { LOG_BUDGET_BYTES, type LoggingConfig, type TagDataType } from '@mat/project-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateView } from '../model/estimate-view.ts';
import './estimate-panel.ts';
import type { EstimatePanel } from './estimate-panel.ts';

const T = (n: number): Map<string, TagDataType> =>
  new Map(Array.from({ length: n }, (_, i) => [`T${i}`, 'FLOAT32' as TagDataType]));
const group = (id: string, n: number, periodMs: number, extra: object = {}) => ({
  id,
  name: `Nhóm ${id}`,
  mode: 'cyclic' as const,
  periodMs,
  retentionDays: 30,
  tags: Array.from({ length: n }, (_, i) => ({ tagId: `T${i}` })),
  ...extra,
});
const cfg = (groups: LoggingConfig['groups']): LoggingConfig => ({
  schemaVersion: '0.6.0',
  groups,
});

async function mount(props: Partial<EstimatePanel>): Promise<EstimatePanel> {
  const el = document.createElement('mat-estimate-panel') as EstimatePanel;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const q = (el: Element, s: string) => el.querySelector(s);
const text = (el: Element, s: string) => (q(el, s)?.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => document.body.replaceChildren());

describe('mat-estimate-panel', () => {
  it('mức xanh: số GB/ngày, nhãn chữ, thanh có aria, văn bản cho trình đọc màn hình', async () => {
    const view = estimateView(cfg([group('a', 2, 60000)]), T(2));
    const el = await mount({ view });
    const root = q(el, '.est')!;
    expect(root.classList.contains('lv-ok')).toBe(true);
    expect(text(el, '.est-badge')).toContain('trong ngân sách');
    expect(q(el, '[role="img"].est-meter')?.getAttribute('aria-label')).toContain('GB');
    expect(text(el, '.est-sr')).toMatch(/Ước tính .* GB mỗi ngày/);
    expect(q(el, '.est-warn')).toBeNull();
  });

  it('mức cam/đỏ có nhãn chữ riêng, không chỉ màu; đỏ ghi "cực lớn"', async () => {
    const hot = estimateView(cfg([group('a', 200, 100), group('b', 200, 100)]), T(200));
    const el = await mount({ view: hot });
    expect(['lv-hot', 'lv-extreme'].some((c) => q(el, '.est')!.classList.contains(c))).toBe(true);
    const ext = estimateView(
      cfg(Array.from({ length: 8 }, (_, i) => group(`g${i}`, 200, 100))),
      T(200),
    );
    const el2 = await mount({ view: ext });
    expect(q(el2, '.est')!.classList.contains('lv-extreme')).toBe(true);
    expect(text(el2, '.est-badge')).toContain('cực lớn');
    expect(el2.querySelectorAll('.est-warn').length).toBeGreaterThan(0);
  });

  it('bảng nhóm có nhãn cơ sở chính xác / theo dự kiến / cận trên', async () => {
    const view = estimateView(
      cfg([
        group('c', 3, 5000),
        {
          id: 'e',
          name: 'E',
          mode: 'onChange',
          minIntervalMs: 1000,
          expectedRowsPerDay: 1000,
          retentionDays: 30,
          tags: [{ tagId: 'T0' }],
        },
        {
          id: 'u',
          name: 'U',
          mode: 'onChange',
          minIntervalMs: 1000,
          retentionDays: 30,
          tags: [{ tagId: 'T0' }],
        },
      ]),
      T(3),
    );
    const el = await mount({ view });
    const rows = [...el.querySelectorAll('.est-groups tbody tr')].map((r) =>
      r.textContent!.replace(/\s+/g, ' '),
    );
    expect(rows[0]).toContain('chính xác');
    expect(rows[1]).toContain('theo dự kiến');
    expect(rows[2]).toContain('cận trên');
  });

  it('dung lượng và số ngày giữ được; "chưa tính n Tag"', async () => {
    const view = estimateView(
      cfg([group('a', 5, 1000)]),
      new Map([['T0', 'FLOAT32' as TagDataType]]),
    );
    const el = await mount({ view });
    expect(text(el, '.est-storage')).toMatch(/Giữ được khoảng \d+ ngày|Đầy sau/);
    expect(text(el, '.est-unknown')).toContain('chưa tính 4 Tag');
  });

  it('cảnh báo ngân sách nêu nhóm đóng góp lớn nhất và gợi ý', async () => {
    const view = estimateView(
      cfg([
        group('nho', 2, 60000),
        {
          id: 'lon',
          name: 'Lớn',
          mode: 'onChange',
          minIntervalMs: 100,
          retentionDays: 30,
          tags: Array.from({ length: 200 }, (_, i) => ({ tagId: `T${i}` })),
        },
      ]),
      T(200),
    );
    const el = await mount({ view });
    expect(text(el, '.est-warn')).toContain('Lớn');
    const tips = [...el.querySelectorAll('.est-tips li')].map((l) => l.textContent!);
    expect(tips.some((s) => s.includes('Kết hợp'))).toBe(true);
    expect(tips.some((s) => s.includes('dòng/ngày dự kiến'))).toBe(true);
  });

  it('trạng thái blocked / noTags hiện hướng dẫn, không số', async () => {
    const a = await mount({ view: { state: 'blocked' } });
    expect(text(a, '.est-state')).toContain('Sửa lỗi');
    expect(q(a, '.est-big')).toBeNull();
    const b = await mount({ view: { state: 'noTags' } });
    expect(text(b, '.est-state')).toContain('Tag');
  });

  it('cột Đo thực và nút Dùng số đo (ẩn khi thiếu số đo)', async () => {
    const view = estimateView(cfg([group('a', 2, 60000)]), T(2));
    const el = await mount({ view });
    expect(q(el, '.est-online')).toBeNull();
    const fn = vi.fn();
    el.addEventListener('use-measure', fn);
    el.online = { bytesPerDay: 480_000_000, rows24h: new Map([['a', 1440]]) };
    await el.updateComplete;
    expect(text(el, '.est-online')).toContain('Đo thực');
    (q(el, 'button.est-use') as HTMLButtonElement).click();
    expect(fn).toHaveBeenCalledOnce();
    el.online = { bytesPerDay: null, rows24h: new Map() };
    await el.updateComplete;
    expect(q(el, 'button.est-use')).toBeNull();
  });

  it('số đo đếm ở lớp SQLite: khung ghi chú nguồn (không gồm dịch vụ khác)', async () => {
    const view = estimateView(cfg([group('a', 2, 60000)]), T(2));
    const el = await mount({ view });
    el.online = { bytesPerDay: 480_000_000, rows24h: new Map(), source: 'sqlite-vfs' };
    await el.updateComplete;
    expect(text(el, '.est-online')).toContain('SQLite');
    el.online = { bytesPerDay: 480_000_000, rows24h: new Map(), source: 'proc-self-io' };
    await el.updateComplete;
    expect(text(el, '.est-online')).not.toContain('SQLite');
  });

  it('SC-019: 32 nhóm × 200 Tag: tính và vẽ lại ≤ 100 ms', async () => {
    const groups = Array.from({ length: 32 }, (_, i) =>
      group(`g${i}`, 200, 1000 + i, { aggregates: {} }),
    );
    const types = T(200);
    const el = await mount({ view: estimateView(cfg(groups), types) });
    const t0 = performance.now();
    el.view = estimateView(
      cfg(groups.map((g, i) => (i === 0 ? { ...g, periodMs: 100 } : g))),
      types,
    );
    await el.updateComplete;
    expect(performance.now() - t0).toBeLessThan(100);
    expect(LOG_BUDGET_BYTES).toBeGreaterThan(0);
  });
});
