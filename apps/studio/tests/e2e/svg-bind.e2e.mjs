// E2E canvas vào item SVG, cây phần tử, inspector Gắn Tag (feature 008, T070 đến T074, T076, T081, T085). Lớp Tauri giả, Chrome headless.
import { UIDS, bonProject } from './svg-fixture.mjs';
import {
  axeBoth,
  designToPage,
  goOnline,
  openAndWait,
  runCommand,
  setTheme,
  sleep,
  treeItem,
  treeNode,
  waitFor,
} from './util.mjs';

/** Hộp bao (toạ độ client) của phần tử SVG `uid` trong item `svg1` của canvas. */
const rectOf = (page, uid) =>
  page.evaluate((u) => {
    const ms = document.querySelector('mat-screen-canvas mat-screen');
    const root = ms?.shadowRoot?.querySelector('.item[data-item-id="svg1"] .svg-host')?.shadowRoot;
    const r = root?.querySelector(`[data-mat-uid="${u}"]`)?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }, uid);

/** Khung chọn của lớp phủ (toạ độ client) theo UID. */
const selBoxes = (page) =>
  page.$$eval('mat-svg-overlay .svo-sel', (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { uid: e.dataset.uid, x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );

const near = (a, b, tol = 2.5) =>
  a !== null &&
  b !== null &&
  Math.abs(a.x - b.x) <= tol &&
  Math.abs(a.y - b.y) <= tol &&
  Math.abs(a.w - b.w) <= tol &&
  Math.abs(a.h - b.h) <= tol;

const clickEl = async (page, uid, opts = {}) => {
  const r = await rectOf(page, uid);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2, opts);
  return r;
};

const entered = (page) => page.$('mat-screen-canvas .vp.entered').then((e) => e !== null);

export default async function svgBind({ page, check, shot, axe }) {
  void axe;
  // Máy dev có `prefers-reduced-motion: reduce` mặc định: bỏ để hoạt ảnh (quay liên tục, nhấp nháy, dòng chảy) chạy thật.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await setTheme(page, 'light');
  // Item chỉ khai báo một phần tử (như nhập SVG: chỉ phần tử có tên): gắn Tag cho phần tử khác phải tự khai báo thêm vào `elements`.
  await openAndWait(page, bonProject({ uids: [UIDS.tank] }), 'D:\\Projects\\bon-nuoc');
  await treeItem(page, 'Bồn nước');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(600);
  await shot('1-man-hinh');

  // ---------- T070: nhấp đúp vào item, khung chọn, Esc ----------
  const at = await designToPage(page, 440, 340);
  await page.mouse.click(at.x, at.y);
  await page.mouse.click(at.x, at.y, { count: 2 });
  await waitFor(page, () => document.querySelector('mat-screen-canvas .vp.entered') !== null);
  check('nhấp đúp item svg: canvas vào đồ họa', true);
  const cursor = await page.$eval('mat-screen-canvas .vp', (e) => getComputedStyle(e).cursor);
  check('đang vào: con trỏ chuột chữ thập', cursor === 'crosshair', cursor);
  await waitFor(page, () => document.querySelector('mat-svg-overlay .svo-item') !== null);
  const crumb = await page.$eval('mat-screen-status [data-role="crumb"]', (e) =>
    e.textContent.trim(),
  );
  check(
    'thanh trạng thái hiện đường dẫn Màn hình › Item',
    crumb.includes('Bồn nước') && crumb.includes('Sơ đồ bồn'),
    crumb,
  );
  await sleep(500);
  await shot('2-da-vao');

  await clickEl(page, UIDS.liquid);
  await waitFor(page, () => document.querySelector('mat-svg-overlay .svo-sel') !== null);
  let boxes = await selBoxes(page);
  check(
    'nhấp phần tử: khung chọn bám phần tử có UID',
    boxes.length === 1 &&
      boxes[0].uid === UIDS.liquid &&
      near(boxes[0], await rectOf(page, UIDS.liquid)),
    JSON.stringify(boxes),
  );
  const crumb2 = await page.$eval('mat-screen-status [data-role="crumb"]', (e) =>
    e.textContent.trim(),
  );
  check('đường dẫn thêm tên phần tử đang chọn', crumb2.includes('Nước'), crumb2);
  await shot('3-chon-phan-tu');

  // Khung chọn bám theo zoom (phím + khi canvas có focus).
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('=');
  await sleep(300);
  boxes = await selBoxes(page);
  check(
    'phóng to: khung chọn vẫn bám phần tử',
    boxes.length === 1 && near(boxes[0], await rectOf(page, UIDS.liquid)),
    JSON.stringify([boxes[0], await rectOf(page, UIDS.liquid)]),
  );
  await page.keyboard.press('-');
  await sleep(300);

  // Shift+nhấp thêm phần tử; Alt+nhấp chọn cha.
  await clickEl(page, UIDS.value);
  await page.keyboard.down('Shift');
  await clickEl(page, UIDS.lamp);
  await page.keyboard.up('Shift');
  await sleep(200);
  boxes = await selBoxes(page);
  check(
    'Shift+nhấp: thêm phần tử vào vùng chọn',
    boxes.map((b) => b.uid).join() === `${UIDS.value},${UIDS.lamp}`,
    boxes.map((b) => b.uid).join(),
  );
  await clickEl(page, UIDS.liquid);
  await sleep(150);
  await page.keyboard.down('Alt');
  await clickEl(page, UIDS.liquid);
  await page.keyboard.up('Alt');
  await sleep(200);
  boxes = await selBoxes(page);
  check(
    'Alt+nhấp: chọn phần tử cha (nhóm Bồn)',
    boxes.length === 1 && boxes[0].uid === UIDS.tank,
    boxes.map((b) => b.uid).join(),
  );
  // T114 (SC-015): chọn cha chỉ bằng bàn phím, Alt+↑ khi canvas có focus.
  await clickEl(page, UIDS.liquid);
  await sleep(150);
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.down('Alt');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('Alt');
  await sleep(200);
  boxes = await selBoxes(page);
  check(
    'Alt+↑ (bàn phím): chọn phần tử cha của phần tử đang chọn',
    boxes.length === 1 && boxes[0].uid === UIDS.tank,
    boxes.map((b) => b.uid).join(),
  );

  // ---------- T071: cây phần tử ----------
  const tab = await page.$eval('mat-shell #dt-tab-elements', (e) =>
    e.getAttribute('aria-selected'),
  );
  check('vào item: tab Phần tử của Details mở sẵn', tab === 'true', tab);
  const tree = await page.$eval('mat-svg-tree [role="tree"]', (e) => ({
    items: e.querySelectorAll('[role="treeitem"]').length,
    level1: e.querySelectorAll('[role="treeitem"][aria-level="1"]').length,
  }));
  check(
    'cây phần tử: role=tree có treeitem, cấp trên cùng đủ 7 phần tử',
    tree.items >= 7 && tree.level1 === 7,
    JSON.stringify(tree),
  );
  const selRow = await page.$eval('mat-svg-tree [aria-selected="true"]', (e) => e.dataset.uid);
  check('chọn trên canvas đồng bộ sang cây', selRow === UIDS.tank, selRow);
  // Nhấp dòng cây chọn phần tử trên canvas.
  await page.click(`mat-svg-tree [data-uid="${UIDS.value}"]`);
  await sleep(200);
  boxes = await selBoxes(page);
  check(
    'nhấp dòng của cây: canvas chọn phần tử đó',
    boxes.length === 1 &&
      boxes[0].uid === UIDS.value &&
      near(boxes[0], await rectOf(page, UIDS.value)),
    JSON.stringify(boxes),
  );
  // Gập bằng phím ←, mở lại bằng →; → lần nữa vào con đầu, ↓ sang con kế.
  await page.click(`mat-svg-tree [data-uid="${UIDS.tank}"]`);
  await page.keyboard.press('ArrowLeft');
  await sleep(150);
  const folded = await page.$$eval(
    'mat-svg-tree [role="treeitem"][aria-level="2"]',
    (e) => e.length,
  );
  check('phím ←: gập nhóm (con biến mất khỏi cây)', folded === 0, folded);
  await page.keyboard.press('ArrowRight');
  await sleep(150);
  const kids = await page.$$eval(`mat-svg-tree [role="treeitem"][aria-level="2"]`, (e) =>
    e.map((x) => x.dataset.uid).join(),
  );
  check('phím →: mở nhóm, hiện hai phần tử con', kids === `${UIDS.shell},${UIDS.liquid}`, kids);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await sleep(150);
  boxes = await selBoxes(page);
  check(
    'phím ↓ trong cây: chọn phần tử kế (đồng bộ canvas)',
    boxes.length === 1 && boxes[0].uid === UIDS.liquid,
    boxes.map((b) => b.uid).join(),
  );
  // Lọc theo tên không dấu.
  await page.type('mat-svg-tree .filt input', 'bon');
  await sleep(150);
  const filtered = await page.$$eval('mat-svg-tree [role="treeitem"]', (e) =>
    e.map((x) => x.dataset.uid).join(),
  );
  check(
    'lọc "bon" (không dấu): Bồn và Vỏ bồn',
    filtered === `${UIDS.tank},${UIDS.shell}`,
    filtered,
  );
  await page.$eval('mat-svg-tree .filt input', (e) => {
    e.value = '';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(100);
  // T114 (SC-015): F2 đổi tên phần tử trong cây chỉ bằng bàn phím; Ctrl+Z trả tên cũ.
  await page.click(`mat-svg-tree [data-uid="${UIDS.value}"]`);
  await sleep(150);
  const nameOld = await page.$eval(`mat-svg-tree [data-uid="${UIDS.value}"] .lbl`, (e) =>
    e.textContent.trim(),
  );
  await page.keyboard.press('F2');
  await page.waitForSelector('mat-svg-tree .et-rename');
  await sleep(100);
  const renameFocus = await page.evaluate(
    () => document.activeElement?.classList.contains('et-rename') === true,
  );
  check('F2 trong cây: focus vào ô tên ngay (gõ được không cần chuột)', renameFocus);
  await page.keyboard.type('Gia tri muc');
  await page.keyboard.press('Enter');
  await sleep(250);
  const nameNew = await page.$eval(`mat-svg-tree [data-uid="${UIDS.value}"] .lbl`, (e) =>
    e.textContent.trim(),
  );
  check(
    'F2 trong cây (bàn phím): đổi tên phần tử',
    nameNew === 'Gia tri muc' && nameNew !== nameOld,
    `${nameOld} -> ${nameNew}`,
  );
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(250);
  const nameBack = await page.$eval(`mat-svg-tree [data-uid="${UIDS.value}"] .lbl`, (e) =>
    e.textContent.trim(),
  );
  check('Ctrl+Z sau F2: trả tên cũ', nameBack === nameOld, nameBack);
  // F2 từ canvas (focus ở vùng vẽ, phần tử đang chọn): mở ô tên ở cây, gõ, Enter; Ctrl+Z trả tên cũ.
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('F2');
  await page.waitForSelector('mat-svg-tree .et-rename', { timeout: 3000 }).catch(() => null);
  await sleep(100);
  const canvasRenameFocus = await page.evaluate(
    () => document.activeElement?.classList.contains('et-rename') === true,
  );
  check('F2 từ canvas: focus vào ô tên của phần tử đang chọn', canvasRenameFocus);
  if (canvasRenameFocus) {
    await page.keyboard.type('Muc tu canvas');
    await page.keyboard.press('Enter');
    await sleep(250);
  }
  const nameCanvas = await page.$eval(`mat-svg-tree [data-uid="${UIDS.value}"] .lbl`, (e) =>
    e.textContent.trim(),
  );
  check(
    'F2 từ canvas (bàn phím): đổi tên phần tử đang chọn',
    nameCanvas === 'Muc tu canvas',
    `${nameOld} -> ${nameCanvas}`,
  );
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(250);
  const nameBack2 = await page.$eval(`mat-svg-tree [data-uid="${UIDS.value}"] .lbl`, (e) =>
    e.textContent.trim(),
  );
  check('Ctrl+Z sau F2 từ canvas: trả tên cũ', nameBack2 === nameOld, nameBack2);
  await shot('4-cay-phan-tu');
  await axeBoth(page, axe, 'vào item, canvas, cây phần tử');

  // ---------- T072: inspector Gắn Tag (13 dòng) ----------
  await clickEl(page, UIDS.liquid);
  await waitFor(page, () => document.querySelector('mat-svg-props mat-svg-bind') !== null);
  const rowIds = await page.$$eval('mat-svg-bind [data-row]', (e) => e.map((x) => x.dataset.row));
  check('inspector: đủ 13 dòng theo animation-catalog', rowIds.length === 13, rowIds.join());
  const blocked = await page.$$eval('mat-svg-bind .brow.dis', (e) => e.map((x) => x.dataset.row));
  check(
    'phần tử hình chữ nhật: dòng Chữ mờ kèm lý do (không hợp loại)',
    blocked.includes('text') && !blocked.includes('level'),
    blocked.join(),
  );
  const reason = await page.$eval('[data-row="text"] .reason', (e) => e.textContent.trim());
  check('dòng mờ nêu lý do', reason.includes('Không hợp loại'), reason);
  await shot('5-inspector-gan-tag');

  // Kéo Tag sai kiểu (chuỗi vào Mức chất lỏng): bị từ chối, không gắn.
  await dropTag(page, rowSel('level'), 'PUMP01.NAME');
  await sleep(150);
  const rej = await page.$eval(`${rowSel('level')} + .berrs, ${rowSel('level')} ~ .berrs`, (e) =>
    e.textContent.replace(/\s+/g, ' ').trim(),
  );
  check(
    'kéo Tag sai kiểu: báo E_TYPE_MISMATCH tại dòng, không gắn',
    rej.includes('E_TYPE_MISMATCH') && (await bound(page, 'level')) === false,
    rej,
  );

  // Kéo Tag đúng kiểu vào Mức chất lỏng.
  await dropTag(page, rowSel('level'), 'TANK01.LEVEL');
  await waitFor(page, () => document.querySelector('[data-row="level"]')?.dataset.bound === 'true');
  const target = await page.$eval('[data-row="level"] .nm i', (e) => e.textContent.trim());
  check(
    'gắn Mức chất lỏng: đích geometry.levelPercent (phần tử rect), phép Trực tiếp',
    target === 'geometry.levelPercent',
    target,
  );
  const xf = await page.$eval(
    '[data-row="level"] select.xf',
    (s) => s.selectedOptions[0].textContent,
  );
  check('phép biến đổi mặc định hợp Tag số', xf.trim() === 'Trực tiếp', xf);
  const tagBtn = await page.$eval('[data-row="level"] .tagbtn', (e) => e.textContent.trim());
  check(
    'ô Tag hiện tên Tag và kiểu',
    tagBtn.includes('TANK01.LEVEL') && tagBtn.includes('FLOAT32'),
    tagBtn,
  );
  await shot('6-da-gan-muc');

  // ---------- T073: thanh Thử giá trị ----------
  await page.focus('[data-row="level"] .tagbtn');
  await waitFor(page, () => document.querySelector('mat-test-strip .ts-range') !== null);
  check('dòng đã gắn Tag số: thanh Thử giá trị có thanh trượt', true);
  const h0 = (await rectOf(page, UIDS.liquid)).h;
  const ms = await page.evaluate(
    (uid) =>
      new Promise((done) => {
        const root = document
          .querySelector('mat-screen-canvas mat-screen')
          .shadowRoot.querySelector('.item[data-item-id="svg1"] .svg-host').shadowRoot;
        const el = root.querySelector(`[data-mat-uid="${uid}"]`);
        const h0 = el.getBoundingClientRect().height;
        const slider = document.querySelector('mat-test-strip .ts-range');
        const t0 = performance.now();
        slider.value = '50';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        const poll = () => {
          if (Math.abs(el.getBoundingClientRect().height - h0) > 1) done(performance.now() - t0);
          else if (performance.now() - t0 > 2000) done(-1);
          else requestAnimationFrame(poll);
        };
        poll();
      }),
    UIDS.liquid,
  );
  const h1 = (await rectOf(page, UIDS.liquid)).h;
  check(
    'Thử giá trị 50: mực nước (canvas) đổi theo',
    h1 > 0 && Math.abs(h1 / h0 - 0.5) < 0.05,
    `${h0} -> ${h1}`,
  );
  check('Thử giá trị: canvas đổi ≤ 100 ms', ms >= 0 && ms <= 100, `${ms.toFixed(1)} ms`);
  const live = await page.$eval('[data-row="level"] .val', (e) => e.textContent.trim());
  check('cột giá trị hiện giá trị đang thử', live.includes('50'), live);
  await shot('7-thu-gia-tri');
  await axeBoth(page, axe, 'thanh Thử giá trị đang thử (T114)');
  // SC-015: Thử giá trị dùng được chỉ bằng bàn phím (thanh trượt gốc nhận mũi tên, nút Đặt lại nhận Tab và Enter).
  await page.focus('mat-test-strip .ts-range');
  const k0 = await page.$eval('mat-test-strip .ts-range', (e) => Number(e.value));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await sleep(200);
  const k1 = await page.$eval('mat-test-strip .ts-range', (e) => Number(e.value));
  const kh = (await rectOf(page, UIDS.liquid)).h;
  check(
    'Thử giá trị bằng bàn phím: mũi tên đổi giá trị và mực nước (canvas) đổi theo',
    k1 > k0 && Math.abs(kh - h1) > 0.2,
    `${k0} -> ${k1}, h ${h1} -> ${kh}`,
  );
  // Đặt lại: canvas trở về, dòng hết thử.
  await clickBtn(page, 'mat-test-strip .ts-reset');
  await sleep(250);
  const h2 = (await rectOf(page, UIDS.liquid)).h;
  check('Đặt lại: mực nước trở về như chưa thử', Math.abs(h2 - h0) <= 1.5, `${h0} -> ${h2}`);
  // Thử giá trị không ghi project và không chạm thiết bị: chưa có lần ghi nào ra đĩa.
  const writes0 = await page.evaluate(() => window.__matMock.writes.length);
  check('Thử giá trị không ghi gì ra đĩa', writes0 === 0, String(writes0));

  // ---------- Hoàn tác: một thao tác một bước ----------
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(300);
  check('Ctrl+Z: bỏ binding vừa gắn (một bước)', (await bound(page, 'level')) === false);
  await page.keyboard.down('Control');
  await page.keyboard.press('y');
  await page.keyboard.up('Control');
  await sleep(300);
  check('Ctrl+Y: làm lại binding', (await bound(page, 'level')) === true);

  // ---------- T074: Gợi ý (chữ hiển thị giá trị) ----------
  await clickEl(page, UIDS.value);
  await waitFor(page, () =>
    document.querySelector('[data-row="level"]')?.classList.contains('dis'),
  );
  await clickBtn(page, 'mat-svg-bind [data-act="suggest"]');
  await page.waitForSelector('mat-svg-bind mat-tag-chooser input');
  await page.keyboard.type('TANK01.LEVEL');
  await page.keyboard.press('Enter');
  await page.waitForSelector('mat-svg-bind .sugg .sugg-r');
  const sugg = await page.$$eval('mat-svg-bind .sugg .sugg-r', (e) =>
    e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  );
  check(
    'Gợi ý chữ + Tag số: đề nghị Chữ hiển thị giá trị, chưa tự áp dụng',
    sugg.length === 1 &&
      sugg[0].includes('Chữ hiển thị giá trị') &&
      (await bound(page, 'text')) === false,
    sugg.join(' | '),
  );
  await axeBoth(page, axe, 'Gợi ý binding đang chờ chấp nhận (T114)');
  await clickBtn(page, 'mat-svg-bind .sugg .btn.primary');
  await waitFor(page, () => document.querySelector('[data-row="text"]')?.dataset.bound === 'true');
  check('chấp nhận Gợi ý: dòng Chữ đã gắn TANK01.LEVEL', true);
  await page.focus('[data-row="text"] .tagbtn');
  await waitFor(page, () => document.querySelector('mat-test-strip .ts-range') !== null);
  await setRange(page, 42);
  await sleep(200);
  const txt = await page.evaluate(() => {
    const root = document
      .querySelector('mat-screen-canvas mat-screen')
      .shadowRoot.querySelector('.item[data-item-id="svg1"] .svg-host').shadowRoot;
    return root.querySelector('[data-mat-uid="el_value"]').textContent;
  });
  check(
    'Thử giá trị 42: chữ trên canvas hiện 42 kèm đơn vị',
    txt.includes('42') && txt.includes('%'),
    txt,
  );
  await clickBtn(page, 'mat-test-strip .ts-reset');

  // Gợi ý bảng giá trị: đèn bơm + PUMP01.STATE (Tag có bảng TrangThaiBom).
  await clickEl(page, UIDS.lamp);
  await waitFor(page, () => document.querySelector('[data-row="fill"]') !== null);
  await clickBtn(page, 'mat-svg-bind [data-act="suggest"]');
  await page.waitForSelector('mat-svg-bind mat-tag-chooser input');
  await page.keyboard.type('PUMP01.STATE');
  await page.keyboard.press('Enter');
  await page.waitForSelector('mat-svg-bind .sugg .sugg-r');
  await clickBtn(page, 'mat-svg-bind .sugg .btn.primary');
  await waitFor(page, () => document.querySelector('[data-row="fill"]')?.dataset.bound === 'true');
  const fillXf = await page.$eval('[data-row="fill"] select.xf', (s) =>
    s.selectedOptions[0].textContent.trim(),
  );
  check('Gợi ý Tag có bảng giá trị: Màu nền theo Bảng giá trị', fillXf === 'Bảng giá trị', fillXf);
  await page.focus('[data-row="fill"] .tagbtn');
  await page.waitForSelector('mat-test-strip .ts-sel');
  await page.select('mat-test-strip .ts-sel', '1');
  await sleep(250);
  const fill = await page.evaluate(() => {
    const root = document
      .querySelector('mat-screen-canvas mat-screen')
      .shadowRoot.querySelector('.item[data-item-id="svg1"] .svg-host').shadowRoot;
    return getComputedStyle(root.querySelector('[data-mat-uid="el_lamp"]')).fill;
  });
  check(
    'Thử giá trị 1 (Chạy): đèn đổi sang màu của bảng giá trị',
    fill === 'rgb(74, 222, 128)',
    fill,
  );
  await clickBtn(page, 'mat-test-strip .ts-reset');

  // Gợi ý quay liên tục: cánh quạt (nhóm có UID, hình con không UID) + Tag BOOL.
  await clickEl(page, UIDS.rotor);
  await waitFor(page, () => document.querySelector('mat-svg-bind [data-row="spin"]') !== null);
  await clickBtn(page, 'mat-svg-bind [data-act="suggest"]');
  await page.waitForSelector('mat-svg-bind mat-tag-chooser input');
  await page.keyboard.type('PUMP01.RUN_CMD');
  await page.keyboard.press('Enter');
  await page.waitForSelector('mat-svg-bind .sugg .sugg-r');
  const spinSug = await page.$eval('mat-svg-bind .sugg', (e) => e.textContent);
  check(
    'tên "Cánh quạt" + Tag BOOL: gợi ý Quay liên tục',
    spinSug.includes('Quay khi chạy'),
    spinSug,
  );
  await clickBtn(page, 'mat-svg-bind .sugg .btn.primary');
  await waitFor(page, () => document.querySelector('[data-row="spin"]')?.dataset.bound === 'true');
  const rotateRow = await page.$eval('[data-row="rotate"]', (e) => e.className);
  check(
    'đã có Quay liên tục: dòng Quay cùng nhóm đích bị mờ',
    rotateRow.includes('dis'),
    rotateRow,
  );

  // ---------- Khoảng chồng báo lỗi tại ô ----------
  await page.click(`mat-svg-tree [data-uid="${UIDS.shell}"]`);
  await waitFor(page, () => document.querySelector('[data-row="fill"]')?.dataset.bound === 'false');
  await dropTag(page, rowSel('fill'), 'TANK01.LEVEL');
  await waitFor(page, () => document.querySelector('[data-row="fill"]')?.dataset.bound === 'true');
  await page.select('[data-row="fill"] select.xf', 'rangeMap');
  await page.waitForSelector('[data-params="fill"] .rtab');
  const okRows = await page.$$eval('[data-params="fill"] .rtab tr.bad', (e) => e.length);
  check('phép Khoảng mặc định hợp lệ: không ô nào đỏ', okRows === 0, String(okRows));
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-params="fill"] .btn')]
      .find((b) => b.textContent.includes('Thêm khoảng'))
      .click(),
  );
  await waitFor(page, () => document.querySelector('[data-params="fill"] .rtab tr.bad') !== null);
  const rangeErr = await page.$eval('[data-params="fill"] .rtab tr.rerr', (e) =>
    e.textContent.trim(),
  );
  const badCell = await page.$eval('[data-params="fill"] tr.bad input[data-field^="range:"]', (e) =>
    e.getAttribute('aria-invalid'),
  );
  check(
    'Khoảng chồng: lỗi E_RANGE hiện tại dòng và ô (aria-invalid)',
    rangeErr.includes('E_RANGE') && badCell === 'true',
    `${rangeErr} / ${badCell}`,
  );
  await shot('8-khoang-chong');
  await axeBoth(page, axe, 'khoảng chồng, ô lỗi aria-invalid (T114)');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-row="fill"] ~ .berrs, [data-row="fill"] + .berrs') !== null ||
      document.querySelectorAll('mat-inspector .issue').length >= 0,
    { timeout: 3000 },
  );
  await sleep(500);
  const issueCodes = await page.evaluate(
    () => document.querySelector('mat-statusbar')?.textContent ?? '',
  );
  check(
    'bộ kiểm tra của project cũng báo lỗi (thanh trạng thái có lỗi)',
    /[1-9]\d* lỗi/.test(issueCodes),
    issueCodes.slice(-80),
  );
  // Nhấp đúp lỗi ở tab Thông tin: chọn lại phần tử, mở dòng và đưa focus tới ô lỗi.
  await clickEl(page, UIDS.value);
  await sleep(200);
  await page.$$eval('mat-inspector [role="tab"]', (tabs) =>
    tabs.find((x) => /Thông tin/.test(x.textContent))?.click(),
  );
  await waitFor(page, () =>
    [...document.querySelectorAll('mat-inspector .issue .code')].some(
      (c) => c.textContent.trim() === 'E_RANGE',
    ),
  );
  await axeBoth(page, axe, 'tab Thông tin có lỗi binding (T114)');
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('mat-inspector .issue')].find(
      (r) => r.querySelector('.code')?.textContent.trim() === 'E_RANGE',
    );
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await sleep(700);
  const jumped = await page.evaluate(() => ({
    uid: document.querySelector('mat-svg-overlay .svo-sel')?.dataset.uid,
    focus: document.activeElement?.dataset?.field ?? '',
    row: document.activeElement?.closest('[data-params]')?.dataset.params ?? '',
  }));
  check(
    'nhấp đúp lỗi E_RANGE ở tab Thông tin: chọn phần tử, mở dòng Màu nền, focus tới ô khoảng',
    jumped.uid === UIDS.shell && jumped.row === 'fill' && jumped.focus.startsWith('range:'),
    JSON.stringify(jumped),
  );
  // Sửa lại: xóa khoảng vừa thêm.
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-params="fill"] .rtab tbody tr')]
      .filter((r) => r.querySelector('input[data-field^="range:"]'))
      .at(-1)
      .querySelector('button')
      .click(),
  );
  await sleep(300);
  const okAgain = await page.$$eval('[data-params="fill"] .rtab tr.bad', (e) => e.length);
  check('xóa khoảng thừa: hết lỗi', okAgain === 0, String(okAgain));

  // ---------- Nhấp nháy: chu kỳ 300 ms bị từ chối ----------
  await clickEl(page, UIDS.alarm);
  await waitFor(
    page,
    () => document.querySelector('[data-row="blink"]')?.dataset.bound === 'false',
  );
  await dropTag(page, rowSel('blink'), 'PUMP01.FAULT');
  await waitFor(page, () => document.querySelector('[data-row="blink"]')?.dataset.bound === 'true');
  await page.waitForSelector('#svp-blink-period');
  await setField(page, '#svp-blink-period', '300');
  await sleep(150);
  const per = await page.$eval('#svp-blink-period', (e) => ({
    bad: e.getAttribute('aria-invalid'),
    msg: e.closest('.field').textContent,
  }));
  check(
    'chu kỳ nhấp nháy 300 ms: bị từ chối tại ô (400 đến 5000)',
    per.bad === 'true' && per.msg.includes('400') && per.msg.includes('5000'),
    JSON.stringify(per),
  );
  await axeBoth(page, axe, 'chu kỳ nhấp nháy ngoài khoảng, ô lỗi (T114)');
  await setField(page, '#svp-blink-period', '450');
  await sleep(150);
  const per2 = await page.$eval('#svp-blink-period', (e) => e.getAttribute('aria-invalid'));
  check('chu kỳ 450 ms: hợp lệ', per2 === null, String(per2));
  // T114, US2-8: Studio nhắc nhấp nháy không được là tín hiệu duy nhất (và giảm chuyển động hiện đậm thay vì nhấp nháy).
  const blinkNote = await page
    .$eval('[data-params="blink"] [data-role="blink-note"]', (e) => e.textContent.trim())
    .catch(() => '');
  check(
    'dòng Nhấp nháy: có lời nhắc "không được là tín hiệu duy nhất" và giảm chuyển động',
    blinkNote.includes('tín hiệu duy nhất') && blinkNote.includes('giảm chuyển động'),
    blinkNote,
  );

  // ---------- Áp nhiều phần tử một bước hoàn tác ----------
  await clickEl(page, UIDS.value);
  await page.keyboard.down('Shift');
  await clickEl(page, UIDS.lamp);
  await page.keyboard.up('Shift');
  await waitFor(
    page,
    () =>
      document.querySelector('mat-svg-bind .svb-tools') !== null &&
      document.querySelector('mat-svg-props')?.textContent.includes('2 phần tử'),
  );
  await dropTag(page, rowSel('opacity'), 'TANK01.LEVEL');
  await sleep(300);
  await clickEl(page, UIDS.value);
  await sleep(200);
  const opV = await bound(page, 'opacity');
  await clickEl(page, UIDS.lamp);
  await sleep(200);
  const opL = await bound(page, 'opacity');
  check(
    'Shift+nhấp hai phần tử rồi kéo Tag vào Độ mờ: cả hai đều có binding',
    opV === true && opL === true,
    `${opV} ${opL}`,
  );
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(300);
  const opV2 = await bound(page, 'opacity');
  await clickEl(page, UIDS.value);
  await sleep(200);
  const opL2 = await bound(page, 'opacity');
  check(
    'một Ctrl+Z gỡ binding Độ mờ ở cả hai phần tử',
    opV2 === false && opL2 === false,
    `${opV2} ${opL2}`,
  );
  // Sao chép và dán: sao chép bộ binding của đèn (Màu nền), dán cho chữ không hợp loại bị bỏ qua.
  await clickEl(page, UIDS.lamp);
  await sleep(200);
  await clickBtn(page, 'mat-svg-bind [data-act="copy"]');
  await clickEl(page, UIDS.shell === undefined ? UIDS.tank : UIDS.hit);
  await sleep(200);
  await clickBtn(page, 'mat-svg-bind [data-act="paste"]');
  await waitFor(page, () => document.querySelector('[data-row="fill"]')?.dataset.bound === 'true');
  const pasted = await page.$eval('[data-row="fill"] .tagbtn', (e) => e.textContent);
  check(
    'Sao chép rồi Dán: nút Nước bơm nhận binding Màu nền của đèn',
    pasted.includes('PUMP01.STATE'),
    pasted,
  );

  // T114 (SC-015): Ctrl+C và Ctrl+V bộ binding chỉ bằng bàn phím (focus trong inspector Gắn Tag).
  await clickEl(page, UIDS.hit);
  await sleep(200);
  await page.focus('[data-row="fill"] .tagbtn');
  await page.keyboard.down('Control');
  await page.keyboard.press('c');
  await page.keyboard.up('Control');
  await clickEl(page, UIDS.shell);
  await sleep(200);
  const shellFillBefore = await bound(page, 'fill');
  await page.focus('[data-row="fill"] .tagbtn');
  await page.keyboard.down('Control');
  await page.keyboard.press('v');
  await page.keyboard.up('Control');
  await sleep(300);
  const shellFill = await page.$eval('[data-row="fill"] .tagbtn', (e) => e.textContent);
  check(
    'Ctrl+C rồi Ctrl+V (bàn phím): phần tử đích nhận binding Màu nền đã chép',
    shellFillBefore === false && shellFill.includes('PUMP01.STATE'),
    `${shellFillBefore} ${shellFill}`,
  );
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(200);

  // ---------- Chỉ bàn phím: bộ chọn Tag ----------
  await clickEl(page, UIDS.hit);
  await page.focus('[data-row="translateX"] .tagbtn');
  await page.keyboard.press('Enter');
  await page.waitForSelector('mat-svg-bind mat-tag-chooser input');
  await page.keyboard.type('TANK01.SP');
  await page.keyboard.press('Enter');
  await waitFor(
    page,
    () => document.querySelector('[data-row="translateX"]')?.dataset.bound === 'true',
  );
  const kbFocus = await page.evaluate(
    () => document.activeElement?.closest('[data-row]')?.dataset.row,
  );
  check(
    'bàn phím: Enter mở bộ chọn, gõ tên, Enter gắn; focus về ô Tag của dòng',
    kbFocus === 'translateX',
    String(kbFocus),
  );

  // ---------- 13 loại động hóa qua giao diện: gắn, Thử giá trị, kiểm DOM của <mat-screen> ----------
  const fx = (uid) =>
    page.evaluate((u) => {
      const root = document
        .querySelector('mat-screen-canvas mat-screen')
        .shadowRoot.querySelector('.item[data-item-id="svg1"] .svg-host').shadowRoot;
      const el = root.querySelector(`[data-mat-uid="${u}"]`);
      const cs = getComputedStyle(el);
      return {
        transform: cs.transform,
        opacity: cs.opacity,
        visibility: cs.visibility,
        stroke: cs.stroke,
        fill: cs.fill,
        dash: cs.strokeDasharray,
        anims: el.getAnimations().length,
        text: el.textContent,
      };
    }, uid);
  const FX = [
    ['text', UIDS.value, 'TANK01.LEVEL', 42, (f) => f.text.includes('42'), 'Chữ hiển thị giá trị'],
    [
      'fill',
      UIDS.lamp,
      'SIM.FAN_ON',
      true,
      (f) => f.fill !== 'rgb(154, 165, 177)',
      'Màu nền (rời rạc, BOOL bật)',
    ],
    [
      'stroke',
      UIDS.pipe,
      'SIM.FAN_ON',
      true,
      (f) => f.stroke === 'rgb(46, 158, 68)',
      'Màu viền (đường chỉ có nét)',
    ],
    ['rotate', UIDS.hit, 'TANK01.SP', 90, (f) => f.transform !== 'none', 'Quay (90)'],
    ['spin', UIDS.rotor, 'PUMP01.RUN_CMD', true, (f) => f.anims > 0, 'Quay khi chạy (có hoạt ảnh)'],
    ['translateX', UIDS.hit, 'TANK01.SP', 40, (f) => f.transform !== 'none', 'Di chuyển X'],
    ['translateY', UIDS.alarm, 'TANK01.SP', 30, (f) => f.transform !== 'none', 'Di chuyển Y'],
    ['scale', UIDS.alarm, 'TANK01.SP', 2, (f) => f.transform !== 'none', 'Co giãn (2)'],
    ['blink', UIDS.alarm, 'PUMP01.FAULT', true, (f) => f.anims > 0, 'Nhấp nháy (có hoạt ảnh)'],
    [
      'flow',
      UIDS.pipe,
      'PUMP01.RUN_CMD',
      true,
      (f) => f.dash !== 'none' && f.anims > 0,
      'Dòng chảy (nét đứt và hoạt ảnh)',
    ],
    [
      'visibility',
      UIDS.value,
      'SIM.FAN_ON',
      false,
      (f) => f.visibility === 'hidden',
      'Ẩn/hiện (tắt thì ẩn)',
    ],
    ['opacity', UIDS.lamp, 'TANK01.LEVEL', 0, (f) => f.opacity === '0', 'Độ mờ (0)'],
  ];
  const done = [];
  for (const [row, uid, tag, val, pred, label] of FX) {
    await page.click(`mat-svg-tree [data-uid="${uid}"]`);
    await page.click('#svp-tab-bind');
    await page.waitForSelector(`[data-row="${row}"]`);
    const has = await page.$eval(`[data-row="${row}"] .tagbtn`, (b) => b.textContent);
    if (!has.includes(tag)) {
      await dropTag(page, rowSel(row), tag);
      await waitFor(
        page,
        (a) => document.querySelector(`[data-row="${a[0]}"] .tagbtn`)?.textContent.includes(a[1]),
        [row, tag],
      );
    }
    await page.focus(`[data-row="${row}"] .tagbtn`);
    await page.waitForSelector('mat-test-strip');
    if (typeof val === 'number') await setRange(page, val);
    else {
      await page.click(`mat-test-strip .ts-seg [data-v="${val ? 'on' : 'off'}"]`);
    }
    await sleep(350);
    const f = await fx(uid);
    const ok = pred(f);
    done.push(ok);
    check(`${label}: gắn qua giao diện, Thử giá trị đổi DOM của canvas`, ok, JSON.stringify(f));
    await clickBtn(page, 'mat-test-strip .ts-reset');
    await sleep(250);
  }
  // Quay khi chạy với Tag số (FLOAT, tốc độ preset: rời rạc 0 → 0, còn lại → rpm): phải THỰC SỰ xoay (góc đổi theo
  // thời gian) và quay quanh tâm của chính phần tử (tâm hộp bao trên màn hình đứng yên). Windows tắt "Hiệu ứng hoạt ảnh"
  // thì WebView2 báo prefers-reduced-motion: reduce; canvas Studio vẫn phải quay (lỗi người dùng báo).
  {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.click(`mat-svg-tree [data-uid="${UIDS.rotor}"]`);
    await page.click('#svp-tab-bind');
    await page.waitForSelector('[data-row="spin"]');
    await dropTag(page, rowSel('spin'), 'TANK01.LEVEL');
    await waitFor(page, () =>
      document.querySelector('[data-row="spin"] .tagbtn')?.textContent.includes('TANK01.LEVEL'),
    );
    // Đổi Tag BOOL → FLOAT: tốc độ preset giữ nguyên (phép rời rạc dựng lại theo Tag số, không thành "Tự thiết lập").
    const spd = await page.$eval('[data-row="spin"] select.spd', (s) => s.value);
    check('Quay khi chạy: đổi Tag BOOL → FLOAT giữ tốc độ Vừa', spd === 'medium', spd);
    await page.focus('[data-row="spin"] .tagbtn');
    await page.waitForSelector('mat-test-strip .ts-range');
    await setRange(page, 44);
    await sleep(400);
    const sample = () =>
      page.evaluate((u) => {
        const root = document
          .querySelector('mat-screen-canvas mat-screen')
          .shadowRoot.querySelector('.item[data-item-id="svg1"] .svg-host').shadowRoot;
        const el = root.querySelector(`[data-mat-uid="${u}"]`);
        const r = el.getBoundingClientRect();
        return {
          t: getComputedStyle(el).transform,
          cx: r.x + r.width / 2,
          cy: r.y + r.height / 2,
          anims: el.getAnimations().map((a) => `${a.playState}@${a.playbackRate}`),
        };
      }, UIDS.rotor);
    const s1 = await sample();
    await sleep(370);
    const s2 = await sample();
    check(
      'Quay khi chạy, Tag FLOAT = 44 (rời rạc → 300 rpm): góc thay đổi theo thời gian',
      s1.t !== s2.t && s1.anims.some((a) => a.startsWith('running')),
      JSON.stringify([s1, s2]),
    );
    check(
      'Quay khi chạy: xoay quanh tâm của phần tử (tâm hộp bao đứng yên)',
      Math.abs(s1.cx - s2.cx) < 3 && Math.abs(s1.cy - s2.cy) < 3,
      JSON.stringify([s1, s2]),
    );
    await clickBtn(page, 'mat-test-strip .ts-reset');
    await sleep(250);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  }
  check(
    'đủ 12 mục (cộng Mức chất lỏng ở trên là 13 loại) đều thấy hiệu ứng trên canvas',
    done.length === 12 && done.every(Boolean),
    String(done.filter(Boolean).length),
  );

  // ---------- T081: nhóm Sự kiện ----------
  await page.click(`mat-svg-tree [data-uid="${UIDS.hit}"]`);
  await page.click('#svp-tab-events');
  await page.waitForSelector('mat-svg-events #sve-action');
  await shot('9-su-kien');
  await page.select('#sve-action', 'pulse');
  await page.waitForSelector('#sve-tag');
  // Thả Tag chỉ đọc: bị từ chối đúng ô.
  await dropTag(page, '#sve-tag', 'TANK01.LEVEL');
  await sleep(150);
  const evErr = await page.$eval('mat-svg-events .sv-row.bad', (e) =>
    e.textContent.replace(/\s+/g, ' ').trim(),
  );
  check('Sự kiện Xung với Tag chỉ đọc: từ chối tại ô Tag', evErr.includes('ghi được'), evErr);
  await axeBoth(page, axe, 'Sự kiện, Tag chỉ đọc bị từ chối tại ô (T114)');
  await page.click('#sve-tag');
  await page.waitForSelector('mat-svg-events mat-tag-chooser input');
  const offered = await page.$$eval('mat-svg-events mat-tag-chooser [role="option"]', (e) =>
    e.map((x) => x.dataset.tag),
  );
  check(
    'bộ chọn Tag của sự kiện chỉ liệt kê Tag BOOL ghi được',
    offered.length > 0 &&
      !offered.includes('TANK01.LEVEL') &&
      !offered.includes('TANK01.SP') &&
      offered.includes('R.RUN'),
    offered.slice(0, 6).join(),
  );
  await page.keyboard.type('R.RUN');
  await page.keyboard.press('Enter');
  await waitFor(page, () => document.querySelector('#sve-tag')?.textContent.includes('R.RUN'));
  const note = await page.$eval('mat-svg-events .sv-note.w', (e) => e.textContent).catch(() => '');
  check(
    'Xung trên Tag bật đọc lại: nhắc W_EVENT_PULSE_READBACK',
    note.includes('W_EVENT_PULSE_READBACK'),
    note,
  );
  await setField(page, '#sve-dur', '50');
  await sleep(150);
  const durErr = await page
    .$eval('mat-svg-events .sv-row.bad', (e) => e.textContent)
    .catch(() => '');
  check('thời gian xung 50 ms: từ chối tại ô (100 đến 10000)', durErr.includes('100'), durErr);
  await axeBoth(page, axe, 'Sự kiện, cảnh báo đọc lại và thời gian xung sai (T114)');
  await setField(page, '#sve-dur', '500');
  await sleep(150);
  await page.select('#sve-role', 'engineer');
  await sleep(150);
  await page.click('#svp-tab-security');
  await page.waitForSelector('#svp-minrole');
  const role = await page.$eval('#svp-minrole', (e) => e.value);
  check('quyền tối thiểu ở nhóm Sự kiện và Bảo mật là cùng một giá trị', role === 'engineer', role);
  await page.click('#svp-tab-events');
  await page.waitForSelector('#sve-action');
  // Chuyển màn hình / popup đúng loại.
  await page.select('#sve-action', 'popup');
  await page.waitForSelector('#sve-screen');
  const popups = await page.$$eval('#sve-screen option', (e) =>
    e.map((x) => x.value).filter(Boolean),
  );
  check('Mở popup: chỉ liệt kê màn hình loại popup', popups.join() === 'chi-tiet', popups.join());
  await page.select('#sve-screen', 'chi-tiet');
  await sleep(200);
  await axeBoth(page, axe, 'Sự kiện, Mở popup đã chọn đích (T114)');

  // ---------- Lưu: file binding đúng theo hợp đồng ----------
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.down('Control');
  await page.keyboard.press('s');
  await page.keyboard.up('Control');
  await sleep(700);
  const file = await page.evaluate(
    () =>
      window.__matMock.writes.filter((w) => w.rel === 'screens/bon.svg1.bindings.json').at(-1)
        ?.content ?? null,
  );
  const set = file ? JSON.parse(file) : null;
  const el = (uid) => set?.elements.find((e) => e.elementUid === uid);
  // Mọi phần tử có binding hoặc sự kiện đều được khai báo trong `elements` của item (cùng bước với binding).
  const screenFile = await page.evaluate(
    () =>
      window.__matMock.writes.filter((w) => w.rel === 'screens/bon.screen.json').at(-1)?.content ??
      null,
  );
  const declared = new Set(
    (screenFile ? JSON.parse(screenFile).items[0].elements : []).map((e) => e.elementUid),
  );
  const undeclared = (set?.elements ?? []).map((e) => e.elementUid).filter((u) => !declared.has(u));
  check(
    'Lưu: phần tử có binding hoặc sự kiện đều có trong `elements` của item (không E_REF_UID)',
    set !== null && undeclared.length === 0 && declared.size >= 7,
    `${declared.size} khai báo; thiếu: ${undeclared.join()}`,
  );
  check(
    'Lưu: file binding schemaVersion 0.4.0',
    set?.schemaVersion === '0.4.0',
    set?.schemaVersion,
  );
  check(
    'file binding: Mức chất lỏng của Nước (levelPercent, TANK01.LEVEL)',
    el(UIDS.liquid)?.bindings?.[0]?.target === 'geometry.levelPercent' &&
      el(UIDS.liquid)?.bindings?.[0]?.source.tagId === 'TANK01.LEVEL',
    JSON.stringify(el(UIDS.liquid)),
  );
  check(
    'file binding: chữ có định dạng 1 số lẻ kèm đơn vị Tag',
    el(UIDS.value)?.bindings?.[0]?.target === 'text.content' &&
      el(UIDS.value)?.bindings?.[0]?.format?.decimals === 1,
    JSON.stringify(el(UIDS.value)?.bindings),
  );
  check(
    'file binding: quay liên tục (transform.rotate + animation spin)',
    el(UIDS.rotor)?.bindings?.[0]?.animation === 'spin',
    JSON.stringify(el(UIDS.rotor)?.bindings),
  );
  check(
    'file binding: nhấp nháy chu kỳ 450',
    el(UIDS.alarm)?.bindings?.[0]?.period === 450,
    JSON.stringify(el(UIDS.alarm)?.bindings),
  );
  check(
    'file binding: sự kiện popup chi-tiet',
    el(UIDS.hit)?.events?.click?.action === 'popup' &&
      el(UIDS.hit)?.events?.click?.screen === 'chi-tiet',
    JSON.stringify(el(UIDS.hit)?.events),
  );

  // ---------- Đổi tên Tag: binding đi theo trong một bước ----------
  await treeNode(page, 'tags');
  await page.waitForSelector('mat-tag-grid [role="gridcell"][data-r="0"][data-c="id"]');
  await page.click('mat-tag-grid [role="gridcell"][data-r="0"][data-c="id"]');
  await runCommand(page, 'Đổi tên Tag');
  await page.waitForSelector('mat-rename-tag-dialog input[name="to"]');
  await page.$eval('mat-rename-tag-dialog input[name="to"]', (i) => i.select());
  await page.keyboard.type('TANK01.MUC');
  await page.waitForSelector('mat-rename-tag-dialog [data-role="hits"] li');
  const places = await page.$$eval('mat-rename-tag-dialog [data-role="hits"] li', (l) =>
    l.map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
  );
  check(
    'đổi tên TANK01.LEVEL: liệt kê binding SVG (Dùng ở đâu)',
    places.some((p) => p.includes('Bồn nước') && p.includes('Sơ đồ bồn')),
    places.join(' | '),
  );
  await page.keyboard.press('Enter');
  await waitFor(page, () => !document.querySelector('mat-rename-tag-dialog [role="dialog"]'));
  await treeItem(page, 'Bồn nước');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(500);
  const at2 = await designToPage(page, 440, 340);
  await page.mouse.click(at2.x, at2.y);
  await page.mouse.click(at2.x, at2.y, { count: 2 });
  await waitFor(page, () => document.querySelector('mat-screen-canvas .vp.entered') !== null);
  await sleep(600);
  await clickEl(page, UIDS.liquid);
  await page.waitForSelector('#svp-tab-bind');
  await page.click('#svp-tab-bind');
  await waitFor(page, () => document.querySelector('[data-row="level"] .tagbtn') !== null);
  const renamedTag = await page.$eval('[data-row="level"] .tagbtn', (e) => e.textContent);
  check('sau khi đổi tên: binding SVG dùng tên mới', renamedTag.includes('TANK01.MUC'), renamedTag);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(400);
  const tagBack = await page
    .$eval('[data-row="level"] .tagbtn', (e) => e.textContent)
    .catch(() => '');
  check('một Ctrl+Z trả tên cũ ở binding SVG', tagBack.includes('TANK01.LEVEL'), tagBack);

  // ---------- T085: xem trước chạy sự kiện của phần tử ----------
  await clickEl(page, UIDS.alarm);
  await page.click('#svp-tab-bind');
  await page.waitForSelector('[data-row="stroke"]');
  await dropTag(page, rowSel('stroke'), 'SIM.FAN_ON');
  await waitFor(
    page,
    () => document.querySelector('[data-row="stroke"]')?.dataset.bound === 'true',
  );
  await page.click('#svp-tab-events');
  await page.waitForSelector('#sve-action');
  await page.select('#sve-action', 'toggle');
  await page.click('#sve-tag');
  await page.waitForSelector('mat-svg-events mat-tag-chooser input');
  await page.keyboard.type('SIM.FAN_ON');
  await page.keyboard.press('Enter');
  await waitFor(page, () => document.querySelector('#sve-tag')?.textContent.includes('SIM.FAN_ON'));
  const strokeOf = (uid) =>
    page.evaluate((u) => {
      const root = document
        .querySelector('mat-screen-canvas mat-screen')
        .shadowRoot.querySelector('.item[data-item-id="svg1"] .svg-host').shadowRoot;
      return getComputedStyle(root.querySelector(`[data-mat-uid="${u}"]`)).stroke;
    }, uid);
  const confirmOpen = () =>
    page.evaluate(() =>
      Boolean(
        document
          .querySelector('mat-confirm-dialog')
          ?.shadowRoot?.querySelector('[role="alertdialog"]'),
      ),
    );
  const confirmPress = (which) =>
    page.evaluate((w) => {
      const b = document.querySelector('mat-confirm-dialog')?.shadowRoot?.querySelector(`[${w}]`);
      b?.click();
      return Boolean(b);
    }, which);
  const modeBtn = (mode) => `mat-screen-toolbar [data-mode="${mode}"]`;
  // Chế độ chỉnh sửa: nhấp là chọn, không phải thi hành sự kiện.
  await clickEl(page, UIDS.alarm);
  await sleep(250);
  check(
    'chế độ chỉnh sửa: nhấp phần tử có sự kiện chỉ chọn, không hỏi xác nhận',
    !(await confirmOpen()) && (await selBoxes(page)).at(-1)?.uid === UIDS.alarm,
  );
  // Mô phỏng: nhấp thi hành sự kiện, qua hộp xác nhận, ghi vào mô phỏng.
  await page.$eval(modeBtn('sim'), (b) => b.click());
  await sleep(1000);
  const s0 = await strokeOf(UIDS.alarm);
  const rp = await rectOf(page, UIDS.alarm);
  await page.mouse.click(rp.x + rp.w / 2, rp.y + rp.h / 2);
  await waitFor(page, () =>
    document.querySelector('mat-confirm-dialog')?.shadowRoot?.querySelector('[role="alertdialog"]'),
  );
  check('Mô phỏng: nhấp phần tử mở hộp xác nhận (chưa ghi)', (await strokeOf(UIDS.alarm)) === s0);
  await confirmPress('data-cancel');
  await sleep(250);
  check('Hủy xác nhận: không ghi', !(await confirmOpen()) && (await strokeOf(UIDS.alarm)) === s0);
  await page.mouse.click(rp.x + rp.w / 2, rp.y + rp.h / 2);
  await waitFor(page, () =>
    document.querySelector('mat-confirm-dialog')?.shadowRoot?.querySelector('[data-ok]'),
  );
  await confirmPress('data-ok');
  await sleep(900);
  const s1 = await strokeOf(UIDS.alarm);
  check(
    'Mô phỏng: xác nhận xong, ghi vào mô phỏng và màu viền ống đổi theo SIM.FAN_ON',
    s1 !== s0 && s1 === 'rgb(46, 158, 68)',
    `${s0} -> ${s1}`,
  );
  await shot('10-xem-truoc-su-kien');
  await page.$eval(modeBtn('off'), (b) => b.click());
  await sleep(600);
  // Thiết bị (Online): đi qua API của Studio (WriteFlow, kênh studio), một lệnh ghi.
  await goOnline(page, 'kysu1', bonProject());
  await treeItem(page, 'Bồn nước');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(600);
  await page.$eval(modeBtn('device'), (b) => b.click());
  await sleep(1200);
  const rd = await rectOf(page, UIDS.alarm);
  await page.mouse.click(rd.x + rd.w / 2, rd.y + rd.h / 2);
  await waitFor(page, () =>
    document.querySelector('mat-confirm-dialog')?.shadowRoot?.querySelector('[data-ok]'),
  );
  await confirmPress('data-ok');
  await sleep(1500);
  const log = await page.evaluate(() =>
    window.__matMock.device.writeLog('BL335-01').map((x) => ({ tag: x.tag, user: x.user })),
  );
  check(
    'Thiết bị: nhấp phần tử đi qua thiết bị giả đúng một lệnh ghi SIM.FAN_ON của kysu1',
    log.length === 1 && log[0].tag === 'SIM.FAN_ON' && log[0].user === 'kysu1',
    JSON.stringify(log),
  );
  await page.$eval(modeBtn('off'), (b) => b.click());
  await sleep(500);

  // ---------- Trợ năng ----------
  await page.click('#svp-tab-bind');
  await page.waitForSelector('mat-svg-bind');
  await page.click('[data-row="level"] .tw');
  await sleep(200);
  await axeBoth(page, axe, 'inspector Gắn Tag, tham số mở');
  await page.click('#svp-tab-events');
  await sleep(200);
  await axeBoth(page, axe, 'inspector nhóm Sự kiện');
  await page.click('#svp-tab-bind');

  // ---------- Feature 032: mọi đích × cách đổi hợp lệ ngay khi chọn, không lỗi schema thô ----------
  const matrix = [
    [UIDS.shell, 'TANK01.LEVEL'],
    [UIDS.shell, 'PUMP01.RUN_CMD'],
    [UIDS.value, 'TANK01.LEVEL'],
    [UIDS.pipe, 'PUMP01.RUN_CMD'],
  ];
  const bad = [];
  let combos = 0;
  for (const [uid, tagId] of matrix) {
    await clickEl(page, uid);
    await waitFor(page, () => document.querySelector('mat-svg-bind [data-row]') !== null);
    const ids = await page.$$eval('mat-svg-bind [data-row]', (rs) => rs.map((r) => r.dataset.row));
    for (const id of ids) {
      const dis = await page.$eval(rowSel(id), (e) => e.classList.contains('dis'));
      if (dis) continue;
      await dropTag(page, rowSel(id), tagId);
      await sleep(250);
      if (!(await bound(page, id))) continue;
      const opts = await page.$$eval(`${rowSel(id)} select.xf option`, (os) =>
        os.map((o) => o.value),
      );
      for (const k of opts) {
        await page.select(`${rowSel(id)} select.xf`, k);
        await sleep(450);
        combos++;
        const st = await page.evaluate((r) => {
          const row = document.querySelector(`mat-svg-bind [data-row="${r}"]`);
          const errs = row?.parentElement?.querySelector(`ul.berrs[id="svb-err-${r}"]`);
          return {
            err: errs ? [...errs.querySelectorAll('li.e')].map((l) => l.textContent.trim()) : [],
            raw: (errs?.textContent ?? '').includes('E_SCHEMA'),
            open: document.querySelector(`[data-params="${r}"]`) !== null,
          };
        }, id);
        if (st.err.length > 0 || st.raw || (k !== 'direct' && !st.open))
          bad.push(`${uid}/${tagId}/${id}/${k}: ${JSON.stringify(st)}`);
      }
      await page.$eval(`${rowSel(id)} .rm`, (b) => b.click());
      await sleep(150);
    }
  }
  check(
    `đích × cách đổi (${combos} tổ hợp): chọn xong là hợp lệ, mở sẵn chi tiết, không lỗi E_SCHEMA`,
    combos >= 30 && bad.length === 0,
    bad.slice(0, 5).join(' | ') || String(combos),
  );

  // Esc thoát item.
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc: thoát item', !(await entered(page)));
  const tab2 = await page.$('mat-shell #dt-tab-elements');
  check('thoát item: tab Phần tử biến mất', tab2 === null);
}

/** Đặt thanh trượt của thanh Thử giá trị. */
const setRange = (page, v) =>
  page.$eval(
    'mat-test-strip .ts-range',
    (s, x) => {
      s.value = String(x);
      s.dispatchEvent(new Event('input', { bubbles: true }));
    },
    v,
  );

/** Gõ giá trị vào ô rồi báo `change` (như rời ô). */
const setField = (page, sel, v) =>
  page.$eval(
    sel,
    (e, x) => {
      e.value = x;
      e.dispatchEvent(new Event('change', { bubbles: true }));
    },
    v,
  );

const rowSel = (id) => `mat-svg-bind [data-row="${id}"]`;
const bound = (page, id) =>
  page.$eval(rowSel(id), (e) => e.dataset.bound === 'true').catch(() => null);
const clickBtn = (page, sel) => page.$eval(sel, (b) => b.click());

/** Thả một Tag lên phần tử bằng sự kiện kéo thả (DataTransfer mang Tag như Details). */
const dropTag = (page, sel, tagId) =>
  page.evaluate(
    (s, tg) => {
      const el = document.querySelector(s);
      const dt = new DataTransfer();
      dt.setData('application/x-mat-tag', tg);
      const o = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt };
      el.dispatchEvent(new DragEvent('dragenter', o));
      el.dispatchEvent(new DragEvent('dragover', o));
      el.dispatchEvent(new DragEvent('drop', o));
    },
    sel,
    tagId,
  );
