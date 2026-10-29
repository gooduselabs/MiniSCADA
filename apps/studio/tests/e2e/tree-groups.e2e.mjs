// E2E sửa lỗi 039: project mới tạo từ Studio (mẫu Trống, chưa có Bảng giá trị, Bảng theo dõi): bấm một lần vào từng mục trên
// cây (trừ gốc project) thì editor tương ứng mở và có nội dung; Bảng giá trị, Bảng theo dõi rỗng hiện trang nhóm có giải
// thích, ví dụ và nút "Thêm …"; bấm Thêm tạo bảng và mở editor. axe 0 critical/serious. Ảnh: tests/e2e/out/tree-groups-*.png.
import { axeBoth, press, setTheme, sleep, waitFor } from './util.mjs';

async function expandAll(page) {
  for (let i = 0; i < 8; i++) {
    const n = await page.evaluate(() => {
      const closed = [
        ...document.querySelectorAll('mat-tree [role="treeitem"][aria-expanded="false"]'),
      ];
      closed.forEach((e) => e.querySelector('.tw')?.click());
      return closed.length;
    });
    await sleep(120);
    if (!n) return;
  }
}

/** id nút → editor mong đợi, theo cây của app (mọi nút trừ gốc phải có editor). */
const treeEditors = (page) =>
  page.evaluate(() => {
    const out = [];
    const walk = (n, depth) => {
      if (depth > 0) out.push([n.id, n.label, n.editor]);
      for (const c of n.children ?? []) walk(c, depth + 1);
    };
    walk(window.__matApp.tree(), 0);
    return out;
  });

export default async function treeGroups({ page, check, shot, axe }) {
  await setTheme(page, 'light');
  await page.waitForSelector('mat-start-page .start-actions');
  await press(page, 'Control+n');
  await page.waitForSelector('mat-new-project-dialog [role="dialog"]');
  await waitFor(page, () => Boolean(document.querySelector('mat-new-project-dialog .np-parent')));
  await page.keyboard.type('Cây rỗng');
  await sleep(150);
  await page.click('mat-new-project-dialog [data-role="ok"]');
  await page.waitForSelector('mat-new-project-dialog [role="dialog"]', { hidden: true });
  await page.waitForSelector('mat-tree [role="treeitem"]');
  await sleep(400);
  await expandAll(page);

  const nodes = await treeEditors(page);
  const noEditor = nodes.filter(([, , ed]) => !ed).map(([, l]) => l);
  check('mọi mục trên cây (trừ gốc) có editor', noEditor.length === 0, noEditor.join(', '));

  const failed = [];
  for (const [id, label, editor] of nodes) {
    const ok = await page.evaluate((i) => {
      const item = document.querySelector(`mat-tree [id="ti-${i}"]`);
      item?.click();
      return Boolean(item);
    }, id);
    if (!ok) continue; // nút trong nhóm đã đóng lại hoặc ẩn
    await sleep(80);
    const st = await page.evaluate(() => ({ active: window.__matApp.store.state.active }));
    if (st.active !== editor) failed.push(`${label} (${id}): ${st.active} ≠ ${editor}`);
  }
  check('bấm từng mục trên cây: editor tương ứng mở', failed.length === 0, failed.join('; '));

  for (const [id, sel, sample] of [
    ['valueTables', 'group:valueTables', '0 = Dừng, 1 = Chạy, 2 = Lỗi'],
    ['watchTables', 'group:watchTables', 'nhiều Tag cùng lúc'],
  ]) {
    await page.evaluate((i) => document.querySelector(`mat-tree [id="ti-${i}"]`)?.click(), id);
    await page.waitForSelector(`mat-group-page [data-group="${id}"] .gp-add`);
    const body = await page.$eval('mat-group-page', (e) => e.textContent);
    check(`${id} rỗng: trang nhóm có giải thích, ví dụ`, body.includes(sample), body.slice(0, 200));
    check(`${id} rỗng: báo chưa có mục`, Boolean(await page.$('mat-group-page .gp-empty')));
    await shot(`${id}-rong`);
    if (id === 'valueTables') await axeBoth(page, axe, 'trang nhóm Bảng giá trị rỗng');
    await page.click('mat-group-page .gp-add');
    await sleep(300);
    const active = await page.evaluate(() => window.__matApp.store.state.active);
    check(
      `${id}: nút Thêm tạo mục và mở editor`,
      sel === 'group:valueTables' ? active.startsWith('vt:') : active.startsWith('watch:'),
      active,
    );
  }
}
