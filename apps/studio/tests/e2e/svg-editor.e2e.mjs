// E2E trình vẽ SVG (feature 011, T157; FR-097 đến FR-115; contracts/svg-editor.md §8, §9): project svg-demo (lớp Tauri giả):
// cây "Đồ họa SVG", mở tab, vẽ bằng chuột thật (rect, đa giác), chọn, kéo, tay nắm, phím §9 (Tab, mũi tên, Ctrl+G, Delete,
// Ctrl+Z/Y), inspector nhập số, Văn bản qua bộ gõ giả CDP (ADR-016), Sửa nút và lý do khóa của path cong, panel Lớp (mắt,
// khóa vào .mat-editor/svg-state.json), xóa có binding, dán SVG độc (báo đã loại), tự lưu rồi "tắt đột ngột" và khôi phục,
// tệp đổi bên ngoài, "Mới: SVG trống", "Sửa trong trình vẽ" (Ctrl+Alt+Enter), bảng lệnh; axe 0 critical/serious hai theme.
import { resolve } from 'node:path';
import {
  REPO,
  axeBoth,
  expandNode,
  openAndWait,
  press,
  readProject,
  setTheme,
  sleep,
  treeNode,
  waitFor,
} from './util.mjs';

const REL = 'graphics/tram-bom.svg';
const TARGET = 'Bơm nước số 1';
const STEPS = [
  'B',
  'Bo',
  'Bơ',
  'Bơm',
  'Bơm n',
  'Bơm nu',
  'Bơm nuo',
  'Bơm nướ',
  'Bơm nước',
  'Bơm nước s',
  'Bơm nước số',
  'Bơm nước số 1',
];

const project = () => readProject(resolve(REPO, 'projects/svg-demo'));

/** Điểm trên trang (clientX/Y) của điểm tài liệu. */
const docToClient = (page, x, y) =>
  page.evaluate(
    (px, py) => {
      const cv = document.querySelector('mat-svg-canvas');
      const r = cv.getBoundingClientRect();
      const m = cv.viewMap();
      return { x: r.left + m.x(px), y: r.top + m.y(py) };
    },
    x,
    y,
  );

/** Tâm (trên trang) của phần tử theo uid. */
const centerOf = (page, uid) =>
  page.evaluate((u) => {
    const app = window.__matApp;
    const ed = app.svg.editor(app.store.state.active.slice('svgdraw:'.length));
    const id = [...ed.doc.nodes.values()].find((n) => n.attrs.get('data-mat-uid') === u)?.id;
    const b = ed.boxOf(id);
    const cv = document.querySelector('mat-svg-canvas');
    const r = cv.getBoundingClientRect();
    const m = cv.viewMap();
    return { x: r.left + m.x(b.x + b.width / 2), y: r.top + m.y(b.y + b.height / 2) };
  }, uid);

const ed = (page, fn, arg) =>
  page.evaluate(
    (src, a) => {
      const app = window.__matApp;
      const rel = app.store.state.active.slice('svgdraw:'.length);
      const e = app.svg.editor(rel);
      // eslint-disable-next-line no-new-func
      return new Function('app', 'ed', 'rel', 'arg', src)(app, e, rel, a);
    },
    fn,
    arg,
  );

async function openFile(page, rel) {
  await expandNode(page, 'graphics');
  await treeNode(page, `svgfile:${rel}`);
  await page.waitForSelector('mat-svg-editor mat-svg-canvas');
  await waitFor(page, () =>
    document.querySelector('mat-svg-canvas')?.shadowRoot?.querySelector('svg.doc'),
  );
  await sleep(150);
}

const focusCanvas = (page) => page.$eval('mat-svg-canvas', (c) => c.focus());

export default async function svgEditor(ctx) {
  const { page, check, shot } = ctx;
  await setTheme(page, 'light');
  await openAndWait(page, project(), 'D:\\Projects\\svg-demo');

  // ---------- 1. Cây, tab, DOM trong Shadow DOM ----------
  check('cây có mục "Đồ họa SVG"', Boolean(await page.$('mat-tree [id="ti-graphics"]')));
  await openFile(page, REL);
  const dom = await page.evaluate(() => {
    const cv = document.querySelector('mat-svg-canvas');
    const svg = cv.shadowRoot.querySelector('svg.doc');
    return {
      inShadow: Boolean(svg),
      leaked: Boolean(document.querySelector('#pumpBody')),
      count: svg.querySelectorAll('*').length,
    };
  });
  check(
    'tài liệu dựng thành DOM thật trong Shadow DOM (không lọt ra trang)',
    dom.inShadow && !dom.leaked,
    JSON.stringify(dom),
  );
  check(
    'Toolbox dọc 8 công cụ',
    (await page.$$eval('mat-svg-editor [data-tool]', (e) => e.length)) === 8,
  );
  await shot('1-mo-tep');
  await axeBoth(page, ctx.axe, 'trình vẽ SVG');

  // ---------- 1c. Task card bên phải: "Công cụ vẽ" thay Toolbox widget của editor Màn hình (T163) ----------
  await page.evaluate(() => {
    const app = window.__matApp;
    if (!(app.workspace.taskCard === 'toolbox' && app.workspace.taskCardOpen))
      app.setTaskCard('toolbox');
  });
  await page.waitForSelector('mat-taskcards .tc-draw [data-tool="rect"]');
  const card = await page.evaluate(() => ({
    title: document.querySelector('mat-taskcards .tc-panel .pane-h')?.textContent ?? '',
    tools: document.querySelectorAll('mat-taskcards .tc-draw [data-tool]').length,
    swatches: document.querySelectorAll('mat-taskcards .tc-draw [data-swatch]').length,
    widgets: document.querySelectorAll('mat-taskcards [data-widget], mat-taskcards [data-symbol]')
      .length,
  }));
  check(
    'task card "Công cụ vẽ": 8 công cụ, bảng màu, không có widget hay ký hiệu',
    /Công cụ vẽ/.test(card.title) && card.tools === 8 && card.swatches >= 16 && card.widgets === 0,
    JSON.stringify(card),
  );
  await page.click('mat-taskcards .tc-draw [data-tool="rect"]');
  await waitFor(
    page,
    () =>
      document
        .querySelector('mat-svg-editor .sv-toolbox [data-tool="rect"]')
        ?.getAttribute('aria-pressed') === 'true',
  );
  check('chọn công cụ ở task card đổi công cụ của trình vẽ', true);
  await shot('1c-cong-cu-ve');
  await axeBoth(page, ctx.axe, 'task card Công cụ vẽ');
  await page.click('mat-taskcards .tc-draw [data-tool="select"]');

  // ---------- 2. Vẽ rect bằng chuột thật; hoàn tác/làm lại ----------
  await focusCanvas(page);
  await page.keyboard.press('r');
  const n0 = await ed(page, 'return ed.doc.elementCount');
  const a = await docToClient(page, 900, 600);
  const b = await docToClient(page, 1100, 760);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await sleep(100);
  const rect = await ed(
    page,
    'const n = ed.doc.nodes.get(ed.selection[0]); return { tag: n.tag, uid: n.attrs.get("data-mat-uid"), count: ed.doc.elementCount, w: Number(n.attrs.get("width")) }',
  );
  check(
    'R + kéo tạo rect có uid mới',
    rect.tag === 'rect' && /^el_/.test(rect.uid) && rect.count === n0 + 1,
    JSON.stringify(rect),
  );
  check(
    'tab có dấu chưa lưu',
    await page.evaluate((r) => window.__matApp.editorDirty(`svgdraw:${r}`), REL),
  );
  await press(page, 'Control+z');
  await sleep(80);
  check('Ctrl+Z bỏ rect', (await ed(page, 'return ed.doc.elementCount')) === n0);
  await press(page, 'Control+y');
  await sleep(80);
  check('Ctrl+Y làm lại', (await ed(page, 'return ed.doc.elementCount')) === n0 + 1);
  await page.keyboard.press('Delete');
  await sleep(80);

  // ---------- 3. Chọn, kéo, tay nắm ----------
  await page.keyboard.press('v');
  const body0 = await ed(
    page,
    'const id=[...ed.doc.nodes.values()].find(n=>n.attrs.get("data-mat-uid")==="el_zoha6du7vr").id; return ed.boxOf(id)',
  );
  await ed(
    page,
    'ed.select([[...ed.doc.nodes.values()].find(n=>n.attrs.get("data-mat-uid")==="el_zoha6du7vr").id]); app.requestRender()',
  );
  await sleep(80);
  const c = await centerOf(page, 'el_zoha6du7vr');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 20, c.y + 10, { steps: 6 });
  await page.mouse.up();
  await sleep(100);
  const body1 = await ed(
    page,
    'const id=[...ed.doc.nodes.values()].find(n=>n.attrs.get("data-mat-uid")==="el_zoha6du7vr").id; return { b: ed.boxOf(id), label: ed.session.undo.undoLabel }',
  );
  check(
    'kéo phần tử: dời và một bước "Di chuyển"',
    body1.b.x > body0.x && body1.label === 'Di chuyển',
    JSON.stringify(body1),
  );
  const se = await page.evaluate(() => {
    const h = document.querySelector('mat-svg-canvas').shadowRoot.querySelector('[data-h="se"]');
    const r = h.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(se.x, se.y);
  await page.mouse.down();
  await page.mouse.move(se.x + 30, se.y + 20, { steps: 6 });
  await page.mouse.up();
  await sleep(100);
  const body2 = await ed(
    page,
    'const id=[...ed.doc.nodes.values()].find(n=>n.attrs.get("data-mat-uid")==="el_zoha6du7vr").id; return { b: ed.boxOf(id), label: ed.session.undo.undoLabel }',
  );
  check(
    'tay nắm se đổi cỡ (một bước "Đổi cỡ")',
    body2.b.width > body1.b.width && body2.label === 'Đổi cỡ',
    JSON.stringify(body2),
  );

  // ---------- 4. Phím §9: Tab, mũi tên, Ctrl+G, Ctrl+Shift+G, Esc ----------
  await focusCanvas(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  const tabSel = await ed(page, 'return ed.selection.length');
  check('Tab chọn phần tử kế', tabSel === 1);
  const before = await ed(page, 'return ed.selectionBox().x');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await sleep(50);
  check(
    'mũi tên dịch 1, Shift 10',
    Math.abs((await ed(page, 'return ed.selectionBox().x')) - before - 11) < 0.01,
  );
  await press(page, 'Control+a');
  await press(page, 'Control+g');
  await sleep(50);
  const grouped = await ed(
    page,
    'return { n: ed.selection.length, tag: ed.doc.nodes.get(ed.selection[0]).tag }',
  );
  check('Ctrl+G nhóm vùng chọn', grouped.n === 1 && grouped.tag === 'g', JSON.stringify(grouped));
  await press(page, 'Control+Shift+G');
  await sleep(50);
  check('Ctrl+Shift+G bỏ nhóm', (await ed(page, 'return ed.selection.length')) >= 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // ---------- 5. Inspector: nhập số ----------
  await ed(
    page,
    'ed.select([[...ed.doc.nodes.values()].find(n=>n.attrs.get("data-mat-uid")==="el_zoha6du7vr").id]); app.svg.view(rel).ptab="geom"; app.requestRender()',
  );
  await page.waitForSelector('#svp-x');
  await page.$eval('#svp-x', (e) => {
    e.value = '400';
    e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(80);
  check(
    'inspector X = 400 dời phần tử',
    Math.abs((await ed(page, 'return ed.selectionBox().x')) - 400) < 0.01,
  );
  await page.$eval('#svp-w', (e) => {
    e.value = 'mười';
    e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(50);
  check(
    'ô số sai: aria-invalid và lời nhắn',
    (await page.$eval('#svp-w', (e) => e.getAttribute('aria-invalid'))) === 'true',
  );
  for (const tab of ['common', 'geom', 'paint', 'bind']) {
    await page.evaluate((x) => {
      const app = window.__matApp;
      app.svg.view(app.store.state.active.slice('svgdraw:'.length)).ptab = x;
      app.requestRender();
    }, tab);
    await sleep(60);
    await axeBoth(page, ctx.axe, `inspector tab ${tab} (có phần tử chọn)`);
  }
  await ed(
    page,
    'const id=[...ed.doc.nodes.values()].find(n=>n.tag==="text"&&ed.canvasSelectable(n.id)).id; ed.select([id]); app.svg.view(rel).ptab="text"; app.requestRender()',
  );
  await sleep(60);
  await axeBoth(page, ctx.axe, 'inspector tab Văn bản');
  await shot('1b-inspector');

  // ---------- 6. Văn bản qua bộ gõ giả (CDP, ADR-016) ----------
  await focusCanvas(page);
  await page.keyboard.press('t');
  const tp = await docToClient(page, 700, 700);
  await page.mouse.click(tp.x, tp.y);
  await page.waitForSelector('textarea.sv-text');
  check(
    'ô chữ là textarea có nhãn, giữ focus',
    await page.$eval(
      'textarea.sv-text',
      (e) => document.activeElement === e && Boolean(e.getAttribute('aria-label')),
    ),
  );
  const cdp = await page.createCDPSession();
  for (const part of STEPS)
    await cdp.send('Input.imeSetComposition', {
      text: part,
      selectionStart: part.length,
      selectionEnd: part.length,
    });
  check(
    'đang ghép chữ: tài liệu chưa có chữ mới',
    !(await ed(
      page,
      `return [...ed.doc.nodes.values()].some(n => n.tag === '#text' && n.text === ${JSON.stringify(TARGET)})`,
    )),
  );
  await cdp.send('Input.insertText', { text: TARGET });
  await page.keyboard.press('Enter');
  await sleep(100);
  check(
    'chốt bộ gõ rồi Enter tạo text đúng chuỗi',
    await ed(
      page,
      `return [...ed.doc.nodes.values()].some(n => n.tag === '#text' && n.text === ${JSON.stringify(TARGET)})`,
    ),
  );
  await shot('2-van-ban');

  // ---------- 7. Đa giác, Sửa nút, path cong bị khóa ----------
  await focusCanvas(page);
  await page.keyboard.press('p');
  const pts = [
    [100, 650],
    [250, 650],
    [250, 760],
  ];
  for (const [x, y] of pts) {
    const q = await docToClient(page, x, y);
    await page.mouse.click(q.x, q.y);
  }
  const first = await docToClient(page, 101, 651);
  await page.mouse.click(first.x, first.y);
  await sleep(80);
  check(
    'P: nhấp lại điểm đầu đóng thành polygon',
    (await ed(page, 'return ed.doc.nodes.get(ed.selection[0]).tag')) === 'polygon',
  );
  await page.keyboard.press('n');
  await sleep(50);
  const pointCount = await ed(page, 'return ed.points().length');
  const p2 = await page.evaluate(() => {
    const h = document.querySelector('mat-svg-canvas').shadowRoot.querySelector('[data-h="pt:2"]');
    const r = h.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(p2.x, p2.y);
  await page.mouse.down();
  await page.mouse.move(p2.x + 25, p2.y, { steps: 5 });
  await page.mouse.up();
  await sleep(60);
  check(
    'Sửa nút: kéo điểm đổi points (một bước)',
    pointCount === 3 && (await ed(page, 'return ed.session.undo.undoLabel')) === undefined,
  );
  const curve = await ed(
    page,
    'const id=[...ed.doc.nodes.values()].find(n=>n.attrs.get("id")==="flowArrow").id; ed.select([id]); app.svg.view(rel).ptab="common"; app.requestRender(); return ed.nodeLockReason()',
  );
  await sleep(80);
  check('path có đường cong: khóa sửa nút kèm lý do', /cong/.test(curve ?? ''), curve);
  check(
    'lý do hiện ở inspector',
    /đoạn cong/.test(await page.$eval('mat-svg-editor .sv-insp', (e) => e.textContent)),
  );
  await page.keyboard.press('v');

  // ---------- 8. Panel Lớp: thêm, khóa, ẩn (svg-state.json) ----------
  await page.click('mat-svg-editor [data-act="layer-add"]');
  await sleep(50);
  await page.click('mat-svg-editor [data-lock="Lớp 1"]');
  await page.click('mat-svg-editor [data-eye="Lớp 1"]');
  await sleep(150);
  const st = await page.evaluate(() =>
    JSON.parse(window.__matMock.fileText('.mat-editor/svg-state.json') ?? '{}'),
  );
  check(
    'khóa và ẩn lưu ở .mat-editor/svg-state.json',
    st.files?.[REL]?.layers?.['Lớp 1']?.locked === true &&
      st.files[REL].layers['Lớp 1'].hidden === true,
    JSON.stringify(st),
  );
  check(
    'tệp SVG trên đĩa không đổi vì mắt/khóa',
    !(await page.evaluate((r) => window.__matMock.writes.some((w) => w.rel === r), REL)),
  );
  await page.click('mat-svg-editor [data-eye="Lớp 1"]');
  await page.click('mat-svg-editor [data-lock="Lớp 1"]');

  // ---------- 9. Xóa phần tử có binding ----------
  await ed(
    page,
    'ed.select([[...ed.doc.nodes.values()].find(n=>n.attrs.get("data-mat-uid")==="el_zoha6du7vr").id]); app.requestRender()',
  );
  await focusCanvas(page);
  await page.keyboard.press('Delete');
  await page.waitForSelector('mat-svg-delete-dialog [role="dialog"]');
  check(
    'Delete phần tử có binding: hộp liệt kê binding',
    /el_zoha6du7vr/.test(
      await page.$eval('mat-svg-delete-dialog [role="dialog"]', (e) => e.textContent),
    ),
  );
  await axeBoth(page, ctx.axe, 'hộp xóa phần tử có binding');
  await page.click('mat-svg-delete-dialog [data-role="ok"]');
  await sleep(80);
  const bfile = 'screens/bon-nuoc.tram_bom.bindings.json';
  const bound = () =>
    page.evaluate(
      (f) => window.__matApp.store.state.docs[f].value.elements.map((e) => e.elementUid),
      bfile,
    );
  check('xóa: phần tử và bản ghi binding cùng mất', !(await bound()).includes('el_zoha6du7vr'));
  await focusCanvas(page);
  await press(page, 'Control+z');
  await sleep(80);
  check(
    'Ctrl+Z khôi phục phần tử và binding',
    (await bound()).includes('el_zoha6du7vr') &&
      (await ed(
        page,
        'return [...ed.doc.nodes.values()].some(n=>n.attrs.get("data-mat-uid")==="el_zoha6du7vr")',
      )),
  );

  // ---------- 10. Dán SVG độc từ clipboard hệ thống ----------
  await page.evaluate(() => {
    const cv = document.querySelector('mat-svg-canvas');
    cv.focus();
    const e = new Event('paste', { bubbles: true, cancelable: true });
    const txt =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><foreignObject/><rect width="5" height="5" onclick="x()"/></svg>';
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => txt } });
    cv.dispatchEvent(e);
  });
  await page.waitForSelector('mat-svg-paste-dialog [role="dialog"]');
  const pasted = await page.$eval('mat-svg-paste-dialog [role="dialog"]', (e) => e.textContent);
  check(
    'dán SVG độc: báo đã loại script, foreignObject, onclick',
    /script/.test(pasted) && /onclick/.test(pasted),
    pasted.slice(0, 200),
  );
  await axeBoth(page, ctx.axe, 'hộp dán SVG đã lọc');
  await page.click('mat-svg-paste-dialog [data-role="ok"]');

  // ---------- 11. Lưu ----------
  await press(page, 'Control+s');
  await sleep(150);
  const saved = await page.evaluate(
    (r) => window.__matMock.writes.filter((w) => w.rel === r).length,
    REL,
  );
  check(
    'Ctrl+S ghi tệp SVG',
    saved === 1 && !(await page.evaluate((r) => window.__matApp.svg.dirty(r), REL)),
  );

  // ---------- 12. Tệp đổi bên ngoài khi đang sửa ----------
  await ed(
    page,
    'ed.select([[...ed.doc.nodes.values()].find(n=>n.attrs.get("data-mat-uid")==="el_zoha6du7vr").id]); const r = ed.nudge(3,0); ed.endNudge(); app.svg.changed(rel, r.targets)',
  );
  await page.evaluate(
    (r) =>
      window.__matMock.editOutside(
        r,
        window.__matMock.fileText(r).replace('Thân bơm', 'Thân bơm (Inkscape)'),
      ),
    REL,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForSelector('mat-svg-external-dialog [role="dialog"]');
  check('đổi bên ngoài khi có sửa: hộp "Tệp đã đổi bên ngoài"', true);
  await axeBoth(page, ctx.axe, 'hộp tệp đổi bên ngoài');
  await page.click('mat-svg-external-dialog [data-role="keep"]');
  await sleep(50);
  await press(page, 'Control+s');
  await waitFor(page, () => window.__matApp.ui.dialog?.kind === 'conflict');
  check('Giữ bản đang sửa: lần Lưu sau hỏi trước khi ghi đè', true);
  await page.evaluate(() => window.__matApp.answer('cancel'));
  await sleep(80);
  check(
    'không ghi đè im lặng',
    /Inkscape/.test(await page.evaluate((r) => window.__matMock.fileText(r), REL)),
  );
  await page.evaluate((r) => window.__matApp.svg.reloadFromDisk(r), REL);
  await sleep(80);

  // ---------- 13. Tự lưu, "tắt đột ngột", khôi phục ----------
  await ed(
    page,
    'ed.select([[...ed.doc.nodes.values()].find(n=>n.attrs.get("data-mat-uid")==="el_zoha6du7vr").id]); const r = ed.nudge(0,7); ed.endNudge(); app.svg.changed(rel, r.targets); return app.svg.autosaver.tick(rel)',
  );
  await sleep(100);
  const auto = await page.evaluate(() => window.__matMock.fileList('.mat-editor/autosave/'));
  check('tự lưu ghi .mat-editor/autosave/', auto.length === 1, JSON.stringify(auto));
  const snapshot = await page.evaluate(() => window.__matMock.snapshot());
  await page.reload({ waitUntil: 'networkidle0' });
  await openAndWait(page, snapshot, 'D:\\Projects\\svg-demo');
  await page.waitForSelector('mat-svg-restore-dialog [role="dialog"]');
  check(
    'mở lại sau tắt đột ngột: hộp "Khôi phục bản tự lưu"',
    /tram-bom\.svg/.test(
      await page.$eval('mat-svg-restore-dialog [role="dialog"]', (e) => e.textContent),
    ),
  );
  await axeBoth(page, ctx.axe, 'hộp khôi phục bản tự lưu');
  await shot('3-khoi-phuc');
  await page.click('mat-svg-restore-dialog [data-role="ok"]');
  await page.waitForSelector('mat-svg-editor mat-svg-canvas');
  await sleep(150);
  const restored = await page.evaluate(
    (r) => ({ dirty: window.__matApp.svg.dirty(r), active: window.__matApp.store.state.active }),
    REL,
  );
  check(
    'khôi phục: tệp mở ở trạng thái chưa lưu',
    restored.dirty && restored.active === `svgdraw:${REL}`,
    JSON.stringify(restored),
  );

  // ---------- 14. Mới: SVG trống ----------
  await treeNode(page, 'svgnew');
  await page.waitForSelector('mat-svg-new #svn-name');
  await page.$eval('#svn-name', (e) => {
    e.value = 'van-bi';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(50);
  await axeBoth(page, ctx.axe, 'tab Mới: SVG trống');
  await shot('4-moi');
  await page.click('mat-svg-new [data-act="create"]');
  await page.waitForSelector('mat-svg-editor[data-rel], mat-svg-editor');
  await sleep(150);
  check(
    'Tạo và mở: tab trình vẽ của tệp mới (chưa lưu)',
    await page.evaluate(
      () =>
        window.__matApp.store.state.active === 'svgdraw:graphics/van-bi.svg' &&
        window.__matApp.svg.dirty('graphics/van-bi.svg'),
    ),
  );
  await press(page, 'Control+s');
  await sleep(150);
  check(
    'Lưu tệp mới ghi graphics/van-bi.svg',
    /viewBox="0 0 200 160"/.test(
      await page.evaluate(() => window.__matMock.fileText('graphics/van-bi.svg') ?? ''),
    ),
  );

  // ---------- 15. Sửa trong trình vẽ từ editor Màn hình; bảng lệnh ----------
  await treeNode(page, 'screen:bon-nuoc');
  await page.waitForSelector('mat-screen-canvas');
  await page.evaluate(() => window.__matApp.selectItems('bon-nuoc', ['tram_bom']));
  await sleep(50);
  await page.keyboard.down('Control');
  await page.keyboard.down('Alt');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Alt');
  await page.keyboard.up('Control');
  await sleep(150);
  check(
    'Ctrl+Alt+Enter trên item svg mở tệp trong trình vẽ',
    (await page.evaluate(() => window.__matApp.store.state.active)) === `svgdraw:${REL}`,
  );
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyP');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForSelector('mat-palette input');
  await page.keyboard.type('bo nhom');
  await sleep(80);
  const pal = await page.$$eval('mat-palette [role="option"] .pal-label', (e) =>
    e.map((x) => x.textContent.trim()),
  );
  check('bảng lệnh có lệnh của trình vẽ (tìm không dấu)', pal.includes('Bỏ nhóm'), pal.join(', '));
  await page.keyboard.press('Escape');
}
