// Hộp thoại Nhập SVG (feature 008, T058; mockup studio-svg.html cảnh 1): xem trước Trước/Sau bằng bản đã lọc, báo cáo ba tab,
// Tối ưu, Lưu báo cáo (Ctrl+S), từ chối đúng thông báo, Nhập một bước hoàn tác, Hủy không đổi project, phím Enter và Esc,
// khóa lệnh khi chỉ đọc hoặc chưa mở editor Màn hình. Máy trạng thái được test riêng ở model/import-flow.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { commandById } from '../../app/commands.ts';
import type { ScreenModel } from '@mat/project-schema';
import { dashboardDemo } from '../../model/test-fixtures.ts';
import { cleanup, mount, newApp02, press, settled } from '../test-helpers.ts';
import './import-svg.ts';
import type { MatImportSvgDialog } from './import-svg.ts';

afterEach(cleanup);

const NS = 'http://www.w3.org/2000/svg';
const enc = (s: string) => new TextEncoder().encode(s);
const GOOD = `<svg xmlns="${NS}" width="400" height="300" viewBox="0 0 400 300"><g id="Bon_nuoc"><rect id="Muc" x="10" y="10" width="50" height="80" fill="#08c"/></g><circle cx="200" cy="100" r="30"/></svg>`;
const EVIL = `<svg xmlns="${NS}" width="100" height="100" viewBox="0 0 100 100"><script>window.__pwned=1</script><rect width="10" height="10" onclick="window.__pwned=2"/></svg>`;
const DTD = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "x">]><svg xmlns="${NS}" width="10" height="10"/>`;

/** Chờ importSvg (có setTimeout 0 trước khi chạy trên luồng chính) và vẽ xong. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await settled();
  }
}

async function setup(
  file: { name: string; bytes: Uint8Array } | null | { error: 'too-large' | 'bad-extension' },
  opts: { screen?: boolean } = {},
) {
  const env = await newApp02({ files: dashboardDemo() });
  if (opts.screen !== false) env.app.openEditor('screen:bon-nuoc');
  env.platform.control.svgOpenResult = file;
  const el = await mount<MatImportSvgDialog>('mat-import-svg-dialog', env.app);
  return { ...env, el };
}

async function run(env: Awaited<ReturnType<typeof setup>>) {
  await env.app.run('import.svg');
  await flush();
}

const screenItems = (env: Awaited<ReturnType<typeof setup>>) =>
  (env.app.screenModel('bon-nuoc') as ScreenModel).items;
const q = <T extends Element = HTMLElement>(el: Element, sel: string) => el.querySelector<T>(sel)!;
const click = async (el: Element, sel: string) => {
  q(el, sel).click();
  await flush();
};

describe('lệnh Thêm đồ họa SVG…', () => {
  it('có phím Ctrl+Shift+I; bật khi mở editor Màn hình 0.3 sửa được', async () => {
    const env = await setup(null);
    const spec = commandById('import.svg')!;
    expect(spec.shortcut).toBe('Ctrl+Shift+I');
    expect(spec.enabled(env.app.store.commandContext())).toBe(true);
  });

  it('khóa khi chưa mở editor Màn hình hoặc project chỉ đọc', async () => {
    const closed = await setup(null, { screen: false });
    const spec = commandById('import.svg')!;
    expect(spec.enabled(closed.app.store.commandContext())).not.toBe(true);
    cleanup();
    const ro = await setup(null);
    expect(spec.enabled({ ...ro.app.store.commandContext(), readOnly: true })).toBe(
      'reason.readOnly',
    );
    expect(spec.enabled({ ...ro.app.store.commandContext(), version03: false })).not.toBe(true);
  });
});

describe('mat-import-svg-dialog', () => {
  it('hủy hộp thoại chọn file: đóng luôn, không đổi gì', async () => {
    const env = await setup(null);
    await run(env);
    expect(env.app.ui.dialog).toBeNull();
    expect(env.app.store.dirtyFiles()).toEqual([]);
  });

  it('xem trước: file, phần mềm, đích graphics/<slug>.svg, số liệu, hai khung xem trước dựng bản đã lọc', async () => {
    const env = await setup({ name: 'Sơ đồ Bồn.svg', bytes: enc(GOOD) });
    await run(env);
    const el = env.el;
    expect(env.app.ui.dialog).toEqual({ kind: 'importSvg' });
    const dlg = q(el, '[role="dialog"]');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-labelledby')).toBeTruthy();
    expect(el.textContent).toContain('Sơ đồ Bồn.svg');
    expect(q(el, '[data-role="target"]').textContent).toContain('graphics/so-do-bon.svg');
    expect(q(el, '[data-role="stats"]').textContent).toContain('0 0 400 300');
    for (const which of ['before', 'after']) {
      const host = q(el, `[data-pv="${which}"]`);
      expect(host.shadowRoot?.querySelector('svg rect'), which).toBeTruthy();
    }
    expect(q(el, '[data-role="ok"]').textContent).toContain('Enter');
    expect(q(el, '[data-role="cancel"]').textContent).toContain('Esc');
    expect(q(el, '[data-role="save-report"]').textContent).toContain('Ctrl+S');
  });

  it('SVG độc hại: báo cáo liệt kê script và onclick; không chạy gì ở cả hai khung', async () => {
    const env = await setup({ name: 'evil.svg', bytes: enc(EVIL) });
    await run(env);
    const el = env.el;
    const rows = () =>
      [...el.querySelectorAll('mat-import-report tbody tr')].map((r) => r.textContent);
    expect(rows().join(' ')).toContain('R_SCRIPT');
    expect(rows().join(' ')).toContain('R_EVENT_ATTR');
    for (const which of ['before', 'after']) {
      const root = q(el, `[data-pv="${which}"]`).shadowRoot!;
      expect(root.querySelector('script'), which).toBeNull();
      expect(root.querySelector('[onclick]'), which).toBeNull();
    }
    expect((globalThis as { __pwned?: unknown }).__pwned).toBeUndefined();
  });

  it('báo cáo: ba tab đổi bảng; tiêu đề cột bấm để sắp xếp (aria-sort)', async () => {
    const env = await setup({ name: 'evil.svg', bytes: enc(EVIL) });
    await run(env);
    const el = env.el;
    const rep = q(el, 'mat-import-report');
    expect(rep.querySelector('[data-tab="removed"]')?.getAttribute('aria-pressed')).toBe('true');
    await click(el, 'mat-import-report button[data-tab="warnings"]');
    expect(rep.querySelector('[data-tab="warnings"]')?.getAttribute('aria-pressed')).toBe('true');
    await click(el, 'mat-import-report button[data-tab="removed"]');
    const th = rep.querySelector('th[aria-sort]')!;
    expect(th.getAttribute('aria-sort')).toBe('none');
    await click(el, 'mat-import-report button.th-sort[data-col="code"]');
    expect(rep.querySelector('th:has(button[data-col="code"])')?.getAttribute('aria-sort')).toBe(
      'ascending',
    );
    await click(el, 'mat-import-report button.th-sort[data-col="code"]');
    expect(rep.querySelector('th:has(button[data-col="code"])')?.getAttribute('aria-sort')).toBe(
      'descending',
    );
  });

  it('đổi Tối ưu chạy lại và hiện kết quả Tối ưu', async () => {
    const env = await setup({ name: 'a.svg', bytes: enc(GOOD) });
    await run(env);
    const box = q<HTMLInputElement>(env.el, '[data-role="optimize"]');
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(q<HTMLInputElement>(env.el, '[data-role="optimize"]').checked).toBe(true);
    expect(q(env.el, '[data-role="optimize-help"]').textContent).toContain('Đã gộp');
  });

  it('Nhập: thêm item svg ở (0, 0), chọn item, đóng hộp thoại, MỘT bước hoàn tác', async () => {
    const env = await setup({ name: 'Sơ đồ Bồn.svg', bytes: enc(GOOD) });
    const before = screenItems(env).length;
    await run(env);
    await click(env.el, '[data-role="ok"]');
    expect(env.app.ui.dialog).toBeNull();
    const items = screenItems(env);
    expect(items).toHaveLength(before + 1);
    const added = items.at(-1)!;
    expect(added).toMatchObject({ type: 'svg', x: 0, y: 0, svgFile: 'graphics/so-do-bon.svg' });
    expect(env.app.selectedItems('bon-nuoc')).toEqual([added.id]);
    expect(env.app.store.dirtyFiles()).toContain('graphics/so-do-bon.svg');
    expect(env.platform.control.writes).toHaveLength(0);
    env.app.store.undo();
    expect(screenItems(env)).toHaveLength(before);
    expect(env.app.store.dirtyFiles()).toEqual([]);
  });

  it('Enter nhập khi focus không ở nút; Esc hủy không đổi project', async () => {
    const a = await setup({ name: 'a.svg', bytes: enc(GOOD) });
    const before = screenItems(a).length;
    await run(a);
    press(q(a.el, '.dlg-b'), 'Enter');
    await flush();
    expect(a.app.ui.dialog).toBeNull();
    expect(screenItems(a)).toHaveLength(before + 1);
    cleanup();
    const b = await setup({ name: 'a.svg', bytes: enc(GOOD) });
    const n = screenItems(b).length;
    await run(b);
    press(q(b.el, '[role="dialog"]'), 'Escape');
    await flush();
    expect(b.app.ui.dialog).toBeNull();
    expect(screenItems(b)).toHaveLength(n);
    expect(b.app.store.dirtyFiles()).toEqual([]);
    expect(b.app.store.commandContext().canUndo).toBe(false);
  });

  it('Ctrl+S lưu báo cáo .json bằng csv_save (không lưu project); chọn Markdown thì .md', async () => {
    const env = await setup({ name: 'Sơ đồ.svg', bytes: enc(EVIL) });
    await run(env);
    const ev = press(q(env.el, '[role="dialog"]'), 's', { ctrlKey: true });
    expect(ev).toBe(false); // đã chặn: không rơi xuống phím Lưu project
    await flush();
    const saved = env.platform.control.savedCsv;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Sơ đồ.import-report.json', extension: 'json' });
    expect(JSON.parse(saved[0]!.text).file.name).toBe('Sơ đồ.svg');
    expect(q(env.el, '[data-role="save-msg"]').textContent).toContain('import-report.json');
    const sel = q<HTMLSelectElement>(env.el, '[data-role="format"]');
    sel.value = 'md';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await click(env.el, '[data-role="save-report"]');
    expect(saved.at(-1)).toMatchObject({ name: 'Sơ đồ.import-report.md', extension: 'md' });
    expect(saved.at(-1)!.text).toContain('# Báo cáo nhập SVG');
    expect(env.app.ui.dialog).toEqual({ kind: 'importSvg' });
  });

  it('DTD: từ chối với mã E_IMPORT_DTD, câu hướng dẫn, "Đã thay đổi project: Không"; Chọn file khác chạy lại', async () => {
    const env = await setup({ name: 'cu.svg', bytes: enc(DTD) });
    await run(env);
    const el = env.el;
    expect(q(el, '[data-role="code"]').textContent).toBe('E_IMPORT_DTD');
    expect(q(el, '[data-role="hint"]').textContent).toContain('Plain SVG');
    expect(q(el, '[role="alert"]').textContent).toContain('DTD');
    expect(el.textContent).toContain('Không');
    expect(el.querySelector('[data-role="ok"]')).toBeNull();
    env.platform.control.svgOpenResult = { name: 'tot.svg', bytes: enc(GOOD) };
    await click(el, '[data-role="another"]');
    expect(el.querySelector('[data-role="ok"]')).toBeTruthy();
    expect(env.app.store.dirtyFiles()).toEqual([]);
  });

  it('file quá lớn và sai đuôi (lỗi của Rust): thông báo đúng mã', async () => {
    const a = await setup({ error: 'too-large' });
    await run(a);
    expect(q(a.el, '[data-role="code"]').textContent).toBe('E_IMPORT_LIMIT');
    expect(q(a.el, '[data-role="hint"]').textContent).toContain('5 MiB');
    cleanup();
    const b = await setup({ error: 'bad-extension' });
    await run(b);
    expect(q(b.el, '[data-role="code"]').textContent).toBe('E_IMPORT_EXT');
  });

  it('đủ trần item svg: báo lý do trong hộp thoại, giữ xem trước, không đổi project', async () => {
    const env = await setup({ name: 'a.svg', bytes: enc(GOOD) });
    const screen = env.app.screenModel('bon-nuoc') as ScreenModel;
    const filler = Array.from({ length: 8 }, (_, i) => ({
      id: `svg_x${i + 1}`,
      type: 'svg' as const,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      svgFile: `graphics/x${i}.svg`,
      bindingFile: `screens/bon-nuoc.svg_x${i + 1}.bindings.json`,
      viewBox: [0, 0, 10, 10] as [number, number, number, number],
      elements: [],
    }));
    env.app.store.edit([
      {
        kind: 'screenUpsert',
        screen: { ...screen, items: [...screen.items.filter((i) => i.type !== 'svg'), ...filler] },
      },
    ]);
    const dirty = env.app.store.dirtyFiles().length;
    await run(env);
    await click(env.el, '[data-role="ok"]');
    expect(q(env.el, '[data-role="plan-error"]').textContent).toContain('8');
    expect(env.app.ui.dialog).toEqual({ kind: 'importSvg' });
    expect(env.app.store.dirtyFiles()).toHaveLength(dirty);
  });
});
