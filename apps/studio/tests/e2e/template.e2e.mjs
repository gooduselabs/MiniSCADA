// E2E template và faceplate (feature 011, T171; FR-119 đến FR-127; SC-037): project 1.0 (vector v10-valid-full + Tag
// PUMP01..PUMP20): mục Template trên cây, thêm 20 bản sao bằng hộp tham số, khung tím của bản sao trên canvas, "Cập nhật mọi
// bản sao", tạo faceplate từ popup `pump`, hộp `args` của Mở popup, menu ngữ cảnh "Tạo template…" của vùng chọn, xóa
// template còn bản sao (bung rồi xóa), kiểm tra (F7) không lỗi; axe 0 critical/serious ở hai theme.
import { resolve } from 'node:path';
import {
  REPO,
  axeScopedBoth,
  openAndWait,
  readProject,
  setTheme,
  sleep,
  treeNode,
  waitFor,
} from './util.mjs';

function project() {
  const files = readProject(resolve(REPO, 'tests/project-vectors/v10-valid-full'));
  const tags = JSON.parse(files['tags.json']);
  const have = new Set(tags.tags.map((t) => t.id));
  for (let i = 1; i <= 20; i++) {
    const p = `PUMP${String(i).padStart(2, '0')}`;
    for (const [s, t] of [
      ['RUN', { type: 'BOOL', initial: false }],
      ['FLOW', { type: 'FLOAT32', initial: 0 }],
      ['RUN_CMD', { type: 'BOOL', access: 'RW', initial: false }],
      ['NAME', { type: 'STRING', initial: `Bơm ${i}` }],
    ])
      if (!have.has(`${p}.${s}`)) tags.tags.push({ id: `${p}.${s}`, kind: 'internal', ...t });
  }
  files['tags.json'] = JSON.stringify(tags, null, 2) + '\n';
  return files;
}

const dialogOpen = (page, tag) =>
  page.waitForSelector(`${tag} [role="dialog"]`, { visible: true, timeout: 5000 });
const dialogClosed = (page, tag) =>
  waitFor(page, (t) => !document.querySelector(`${t} [role="dialog"]`), tag);

async function setInput(page, sel, value) {
  await page.$eval(
    sel,
    (e, v) => {
      e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );
}

/** Lỗi (E_) của lần kiểm mới nhất, sau khi kiểm lại ngay. */
const errorCount = (page) =>
  page.evaluate(async () => {
    const app = window.__matApp;
    await app.store.validateNow();
    return app.store.state.issues.filter((x) => x.code.startsWith('E_')).map((x) => x.code);
  });

export default async function template(ctx) {
  const { page, check } = ctx;
  await setTheme(page, 'light');
  await openAndWait(page, project(), 'D:\\Projects\\vector10');

  // ---------- 1. Cây: mục Template, trang template ----------
  check('cây có mục Template', Boolean(await page.$('mat-tree [id="ti-templates"]')));
  await treeNode(page, 'templates');
  await page.waitForSelector('mat-template-library [data-tid="bom"]');
  check(
    'thư viện template: thẻ bom có tham số và số bản sao',
    await page.$eval(
      'mat-template-library [data-tid="bom"]',
      (e) => /prefix \(tagPrefix\)/.test(e.textContent) && /2 bản sao/.test(e.textContent),
    ),
  );
  await page.$eval('mat-template-library [data-tid="bom"] .tpl-open', (b) => b.click());
  await page.waitForSelector('mat-template-editor tbody tr');

  // ---------- 2. 20 bản sao bằng hộp tham số ----------
  const t0 = Date.now();
  for (let i = 1; i <= 20; i++) {
    await page.$eval('mat-template-editor [data-act="add-instance"]', (b) => b.click());
    await dialogOpen(page, 'mat-template-instance-dialog');
    if (i === 1) {
      check(
        'hộp Thêm bản sao: id bản sao kế tiếp điền sẵn',
        (await page.$eval('input[name="inst"]', (e) => e.value)) === 'bom1',
      );
      await setInput(page, 'input[name="v-prefix"]', '9X');
      check(
        'giá trị tiền tố sai kiểu báo ngay tại ô',
        await page.$eval(
          'input[name="v-prefix"]',
          (e) => e.getAttribute('aria-invalid') === 'true',
        ),
      );
      await axeScopedBoth(ctx, 'hộp Thêm bản sao');
    }
    await setInput(page, 'input[name="inst"]', `bom${i}`);
    await setInput(page, 'input[name="v-prefix"]', `PUMP${String(i).padStart(2, '0')}`);
    await setInput(page, 'input[name="v-title"]', `Bơm ${i}`);
    await setInput(page, 'input[name="x"]', String(((i - 1) % 5) * 240));
    await setInput(page, 'input[name="y"]', String(440 + Math.floor((i - 1) / 5) * 150));
    await page.$eval('mat-template-instance-dialog [data-role="ok"]', (b) => b.click());
    await sleep(50);
    const err = await page.evaluate(
      () => document.querySelector('mat-template-instance-dialog [role="alert"]')?.textContent,
    );
    if (err) throw new Error(`bản sao ${i}: ${err}`);
    await dialogClosed(page, 'mat-template-instance-dialog');
    await treeNode(page, 'template:bom');
    await page.waitForSelector('mat-template-editor tbody tr');
  }
  const rows = await page.$$eval('mat-template-editor tbody tr', (r) => r.length);
  check('20 bản sao thêm qua hộp tham số: danh sách có 22 bản sao', rows === 22, String(rows));
  check('thời gian dựng 20 bản sao (ms)', true, String(Date.now() - t0));
  check(
    'cây: chữ phụ "22 bản sao"',
    await page.$eval('mat-tree [id="ti-template:bom"]', (e) => /22 bản sao/.test(e.textContent)),
  );
  await axeScopedBoth(ctx, 'trang template');

  // ---------- 3. Canvas: khung tím của bản sao ----------
  await treeNode(page, 'screen:main');
  await page.waitForSelector('mat-screen-canvas .tplbox');
  const boxes = await page.$$eval('mat-screen-canvas .tplbox', (b) => b.length);
  check('canvas: mỗi bản sao một khung tím kèm nhãn', boxes === 22, String(boxes));
  check(
    'nhãn bản sao có biểu tượng và chữ',
    await page.$eval(
      'mat-screen-canvas .tplbox[data-inst="bom20"] .tplnm',
      (e) => Boolean(e.querySelector('svg, .ic')) && /bom20 · bom/.test(e.textContent),
    ),
  );

  // ---------- 4. Cập nhật mọi bản sao ----------
  await treeNode(page, 'template:bom');
  await page.waitForSelector('mat-template-editor [data-act="update-all"]');
  await page.$eval('mat-template-editor [data-act="update-all"]', (b) => b.click());
  await dialogOpen(page, 'mat-template-confirm-dialog');
  check(
    'hộp Cập nhật mọi bản sao nêu 22 bản sao',
    await page.$eval('mat-template-confirm-dialog [data-k="count"]', (e) =>
      /22 bản sao/.test(e.textContent),
    ),
  );
  await axeScopedBoth(ctx, 'hộp Cập nhật mọi bản sao');
  await page.$eval('mat-template-confirm-dialog [data-role="ok"]', (b) => b.click());
  await dialogClosed(page, 'mat-template-confirm-dialog');

  // ---------- 5. Faceplate từ popup `pump` và args của Mở popup ----------
  await treeNode(page, 'screen:pump');
  await page.waitForSelector('mat-widget-props [data-act="faceplate"]');
  await page.$eval('mat-widget-props [data-act="faceplate"]', (b) => b.click());
  await sleep(300);
  check(
    'Tạo faceplate: popup pump có tham số prefix',
    await page.evaluate(() =>
      /prefix/.test(document.querySelector('mat-widget-props')?.textContent ?? ''),
    ),
  );
  await treeNode(page, 'screen:main');
  await page.waitForSelector('mat-screen-canvas');
  await page.evaluate(() => {
    const app = window.__matApp;
    app.selectItems('main', ['btn_pump']);
    app.screens.inspTab = 'events';
    app.requestRender();
  });
  await page.waitForSelector('mat-widget-props [data-act="args"]');
  await page.$eval('mat-widget-props [data-act="args"]', (b) => b.click());
  await dialogOpen(page, 'mat-args-dialog');
  check(
    'hộp args: đúng bộ tham số của popup (prefix)',
    (await page.$$eval('mat-args-dialog tbody tr', (r) => r.map((x) => x.dataset.param))).join() ===
      'prefix',
  );
  await setInput(page, 'input[name="a-prefix"]', 'PUMP05');
  check(
    'hộp args: xem trước Tag bung tĩnh',
    await page.$eval('mat-args-dialog [data-k="tags"]', (e) =>
      /PUMP05\.RUN_CMD/.test(e.textContent),
    ),
  );
  await axeScopedBoth(ctx, 'hộp args của Mở popup');
  await page.$eval('mat-args-dialog [data-role="ok"]', (b) => b.click());
  await dialogClosed(page, 'mat-args-dialog');
  check(
    'args lưu vào hành động',
    await page.evaluate(() => {
      const app = window.__matApp;
      const it = app.screenModel('main').items.find((i) => i.id === 'btn_pump');
      return it.events.click.args?.prefix === 'PUMP05';
    }),
  );

  // ---------- 6. Menu ngữ cảnh "Tạo template…" của vùng chọn ----------
  await page.evaluate(() => {
    const app = window.__matApp;
    app.selectItems('main', ['lamp_fault', 'btn_run']);
  });
  await sleep(150);
  const oi = await page.$('mat-screen-canvas .oi[data-item="lamp_fault"]');
  const box = await oi.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.waitForSelector('mat-screen-editor .se-ctx [data-cmd="screen.createTemplate"]');
  check(
    'menu ngữ cảnh có "Tạo template…"',
    await page.$eval('mat-screen-editor .se-ctx [data-cmd="screen.createTemplate"]', (e) =>
      e.textContent.includes('Tạo template'),
    ),
  );
  await page.$eval('mat-screen-editor .se-ctx [data-cmd="screen.createTemplate"]', (b) =>
    b.click(),
  );
  await dialogOpen(page, 'mat-template-create-dialog');
  check(
    'hộp Tạo template: phát hiện tham số prefix',
    Boolean(await page.$('mat-template-create-dialog [data-param="prefix"]')),
  );
  await axeScopedBoth(ctx, 'hộp Tạo template');
  await setInput(page, 'input[name="tid"]', 'loi-bom');
  await page.$eval('mat-template-create-dialog [data-role="ok"]', (b) => b.click());
  await dialogClosed(page, 'mat-template-create-dialog');
  check('template mới trên cây', Boolean(await page.$('mat-tree [id="ti-template:loi-bom"]')));

  // ---------- 7. Kiểm tra: không lỗi ----------
  const errs = await errorCount(page);
  check('kiểm tra: 0 lỗi sau khi dựng bản sao và faceplate', errs.length === 0, errs.join(', '));

  // ---------- 8. Xóa template còn bản sao ----------
  await treeNode(page, 'template:bom');
  await page.waitForSelector('mat-template-editor [data-act="delete"]');
  await page.$eval('mat-template-editor [data-act="delete"]', (b) => b.click());
  await dialogOpen(page, 'mat-template-confirm-dialog');
  check(
    'xóa template: chỉ hai nút (Hủy, Bung rồi xóa)',
    await page.$$eval(
      'mat-template-confirm-dialog .dlg-f button',
      (b) => b.length === 2 && /Bung 22 bản sao và xóa template/.test(b[1].textContent),
    ),
  );
  await axeScopedBoth(ctx, 'hộp Xóa template');
  await page.$eval('mat-template-confirm-dialog [data-role="cancel"]', (b) => b.click());
  await dialogClosed(page, 'mat-template-confirm-dialog');
  await ctx.shot('template');
}
