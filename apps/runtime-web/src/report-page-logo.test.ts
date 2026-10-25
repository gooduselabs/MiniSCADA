// Feature 024 (T090 của 015): logo của đơn vị (reports.json `logo`) trên dải tiêu đề của trang, trong PDF (chuỗi SVG hoặc
// data URL PNG) và XLSX (byte PNG; SVG được vẽ sang PNG). Tệp không đọc được: xuất vẫn chạy, không có logo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeHistorySource } from '@mat/ui-components';
import type { ExportMeta } from '@mat/report-export';
import { ReportPage, type ReportsFile } from './report-page.ts';

const NOW = Date.UTC(2026, 9, 21, 8, 30, 0);
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20"/></svg>';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function setup(logo: string | undefined, load: (rel: string) => Promise<Uint8Array>) {
  const hist = new FakeHistorySource();
  hist.catalogData.groups[0]!.id = 'dien';
  const file: ReportsFile = {
    ...(logo ? { logo } : {}),
    reports: [
      {
        id: 'dien-ngay',
        name: 'Điện ngày',
        group: 'dien',
        period: 'day',
        rowMinutes: 60,
        columns: [{ tagId: 'KWH', label: 'Điện', unit: 'kWh', functions: ['max'] }],
      },
    ],
  };
  const root = document.createElement('div');
  document.body.append(root);
  const metas: Array<{ kind: string; meta: ExportMeta }> = [];
  const loads: string[] = [];
  const page = new ReportPage({
    container: root,
    history: hist,
    now: () => NOW,
    loadReports: async () => file,
    userName: () => 'vh1',
    onUrl: () => {},
    download: () => {},
    projectUrl: (rel) => `/project/${rel}`,
    loadFile: (rel) => {
      loads.push(rel);
      return load(rel);
    },
    svgToPng: async () => PNG,
    exporter: {
      csv: () => new Uint8Array(),
      xlsx: async (_t, meta) => {
        metas.push({ kind: 'xlsx', meta });
        return new Uint8Array();
      },
      pdf: async (_t, meta) => {
        metas.push({ kind: 'pdf', meta });
        return new Uint8Array();
      },
    },
  });
  return { root, page, metas, loads };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}
const btn = (root: HTMLElement, cls: string) =>
  root.querySelector<HTMLButtonElement>(`button.${cls}`)!;

async function ready(c: ReturnType<typeof setup>) {
  await c.page.show('dien-ngay', new URLSearchParams('d=2026-10-20'));
  await flush();
  btn(c.root, 'view').click();
  await flush();
  for (const k of ['xlsx', 'pdf']) {
    btn(c.root, k).click();
    await flush();
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('logo báo cáo (024)', () => {
  it('SVG: ảnh trên dải tiêu đề; PDF nhận chuỗi SVG, XLSX nhận PNG đã vẽ', async () => {
    const c = setup('graphics/logo.svg', async () => new TextEncoder().encode(SVG));
    await ready(c);
    const view = c.root.querySelector('mat-report-view') as HTMLElement & { logo: string };
    expect(view.logo).toBe('/project/graphics/logo.svg');
    const x = c.metas.find((m) => m.kind === 'xlsx')!.meta;
    const p = c.metas.find((m) => m.kind === 'pdf')!.meta;
    expect(x.logoPng).toEqual(PNG);
    expect(x.logo).toBeUndefined();
    expect(p.logo).toBe(SVG);
    expect(c.loads).toEqual(['graphics/logo.svg', 'graphics/logo.svg']);
  });

  it('PNG: XLSX nhận byte, PDF nhận data URL base64', async () => {
    const c = setup('graphics/logo.png', async () => PNG);
    await ready(c);
    expect(c.metas.find((m) => m.kind === 'xlsx')!.meta.logoPng).toEqual(PNG);
    expect(c.metas.find((m) => m.kind === 'pdf')!.meta.logo).toBe(
      `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`,
    );
  });

  it('không có logo: không đọc tệp; tệp lỗi: vẫn xuất, không có logo', async () => {
    const none = setup(undefined, async () => PNG);
    await ready(none);
    expect(none.loads).toEqual([]);
    expect(none.metas).toHaveLength(2);
    expect(none.metas.every((m) => m.meta.logo === undefined && !m.meta.logoPng)).toBe(true);
    document.body.replaceChildren();
    const broken = setup('graphics/logo.png', async () => {
      throw new Error('404');
    });
    await ready(broken);
    expect(broken.metas).toHaveLength(2);
    expect(broken.metas.every((m) => m.meta.logo === undefined && !m.meta.logoPng)).toBe(true);
  });
});
