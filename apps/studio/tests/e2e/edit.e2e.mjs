// E2E sửa project (feature 004, T059, T064, US2, quickstart §4 bước 5–11), lớp Tauri giả điều khiển qua
// window.__matMock: chỉ sửa tên project thì chỉ ghi project.json, giữ nguyên phần còn lại; Bảng Tag:
// nhấp đúp sửa đúng ô, Max < Min thì ô đỏ và "1 lỗi" trong ≤ 1 s; nhấp đúp lỗi ở tab Thông tin tới ô Max
// đang sửa; Ctrl+Z, Ctrl+Y; lưu khi còn lỗi (thông báo thiết bị sẽ từ chối, Nạp xuống khóa vì còn lỗi);
// file bị sửa ngoài Studio → Ghi đè / Tải lại / Hủy; đóng khi chưa lưu → Lưu / Không lưu / Hủy; dấu chưa
// lưu ở tab và tiêu đề cửa sổ; inspector của Tag ("Dùng ở đâu"); axe-core ở theme sáng và tối.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEMO = resolve(here, '../../../../projects/tank-demo');
const PROJECT_JSON = readFileSync(resolve(DEMO, 'project.json'), 'utf8');

const cell = (r, c) => `mat-tag-grid td[data-r="${r}"][data-c="${c}"]`;
const text = (page, sel) =>
  page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => null);
const activeTab = (page) => text(page, 'mat-tabs [role="tab"][aria-selected="true"] .tab-title');
const writes = (page) => page.evaluate(() => window.__matMock.writes.map((w) => w.rel));
const toast = (page) => text(page, 'mat-toast .toast');
const errorsInStatus = (page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('mat-statusbar button')]
        .find((b) => /lỗi/.test(b.textContent))
        ?.textContent.replace(/\s+/g, ' ')
        .trim() ?? '',
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function press(page, combo) {
  const keys = combo.split('+');
  for (const k of keys.slice(0, -1)) await page.keyboard.down(k);
  await page.keyboard.press(keys.at(-1));
  for (const k of keys.slice(0, -1).reverse()) await page.keyboard.up(k);
}

async function openProject(page) {
  await page.waitForSelector('mat-start-page .start-hero');
  await page.click('mat-start-page .start-hero .btn.primary');
  await page.waitForSelector('mat-tree [role="treeitem"]');
}

async function openTreeItem(page, label) {
  const ok = await page.evaluate((l) => {
    const item = [...document.querySelectorAll('mat-tree [role="treeitem"]')].find(
      (e) => e.querySelector('.lbl')?.textContent.trim() === l,
    );
    item?.click();
    return Boolean(item);
  }, label);
  if (!ok) throw new Error(`không thấy mục cây "${label}"`);
}

/** Đổi theme bằng nút trên thanh trạng thái (vòng hệ thống → sáng → tối). */
async function setTheme(page, theme) {
  for (let i = 0; i < 3; i++) {
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) === theme) return;
    await page.evaluate(() =>
      [...document.querySelectorAll('mat-statusbar button')]
        .find((b) => /Theo hệ thống|Sáng|Tối/.test(b.textContent))
        ?.click(),
    );
  }
}

async function axeBothThemes(page, axe, label) {
  await setTheme(page, 'light');
  await axe(`${label}, theme sáng`);
  await setTheme(page, 'dark');
  await axe(`${label}, theme tối`);
  await setTheme(page, 'light');
}

/** Hộp thoại đang mở: loại (lớp dlg-…) và nhãn các nút. */
const dialog = (page) =>
  page.evaluate(() => {
    const d = document.querySelector('mat-dialog [role="dialog"]');
    if (!d) return null;
    return {
      kind: [...d.classList].find((c) => c.startsWith('dlg-'))?.slice(4),
      buttons: [...d.querySelectorAll('.dlg-f button')].map((b) => b.textContent.trim()),
    };
  });

async function answer(page, choice) {
  await page.waitForSelector('mat-dialog [role="dialog"]');
  await page.click(`mat-dialog [data-choice="${choice}"]`);
  await page.waitForFunction(() => !document.querySelector('mat-dialog [role="dialog"]'));
}

export default async function edit({ page, url, check, shot, axe }) {
  // ---------- 1. Thiết lập project: chỉ sửa tên thì chỉ ghi project.json (US2-4, FR-022) ----------
  await openProject(page);
  await openTreeItem(page, 'Thiết lập project');
  await page.waitForSelector('#set-projectName');
  check('Thiết lập project mở trong tab', (await activeTab(page)) === 'Thiết lập project');
  const readonly = await page.evaluate(() => ({
    id: document.querySelector('#set-projectId')?.readOnly,
    min: document.querySelector('#set-minRuntimeVersion')?.readOnly,
  }));
  check(
    'mã project, runtime tối thiểu chỉ đọc',
    readonly.id && readonly.min,
    JSON.stringify(readonly),
  );
  await page.click('#set-projectName', { count: 3 });
  await press(page, 'Control+a');
  await page.keyboard.type('Trạm bơm A');
  const dirtyTitle = await page.title();
  check('tiêu đề cửa sổ có dấu chưa lưu', dirtyTitle.startsWith('● '), dirtyTitle);
  check(
    'tab có dấu chưa lưu',
    (await page.$('mat-tabs [role="tab"][aria-selected="true"] .dirty')) !== null,
  );
  await shot('1-thiet-lap');
  await axeBothThemes(page, axe, 'Thiết lập project');
  await press(page, 'Control+s');
  await page.waitForFunction(() => window.__matMock.writes.length > 0);
  const firstWrites = await page.evaluate(() => window.__matMock.writes);
  check(
    'chỉ sửa tên project: chỉ ghi project.json',
    firstWrites.map((w) => w.rel).join(',') === 'project.json',
    firstWrites.map((w) => w.rel).join(','),
  );
  const expected = PROJECT_JSON.replace(
    '"projectName": "Trạm bơm nước (demo Sprint 1)"',
    '"projectName": "Trạm bơm A"',
  );
  check(
    'project.json giữ thứ tự khóa và trường không sửa (diff chỉ dòng tên)',
    firstWrites[0]?.content === expected,
    firstWrites[0]?.content,
  );
  check(
    'sau khi lưu: hết dấu chưa lưu',
    !(await page.title()).startsWith('● '),
    await page.title(),
  );

  // ---------- 2. Bảng Tag: nhấp đúp sửa đúng ô; Max < Min → ô đỏ, "1 lỗi" trong ≤ 1 s (US2-1) ----------
  await openTreeItem(page, 'Bảng Tag mặc định');
  await page.waitForSelector(cell(0, 'max'));
  check('lưới role=grid', (await page.$('mat-tag-grid table[role="grid"]')) !== null);
  check('ban đầu: 0 lỗi', /^0 lỗi/.test(await errorsInStatus(page)), await errorsInStatus(page));
  // Nhấp đúp vào ô chưa chọn: lần nhấp đầu chọn ô (không vẽ lại dòng), lần hai vào sửa đúng ô đó.
  await page.click(cell(2, 'description'), { count: 2 });
  const editing = await page.evaluate(
    (sel) => {
      const input = document.querySelector(`${sel} input.tg-edit`);
      return { value: input?.value ?? null, focused: document.activeElement === input };
    },
    cell(2, 'description'),
  );
  check(
    'nhấp đúp vào ô chưa chọn: sửa đúng ô đó',
    editing.value === 'Tốc độ bơm' && editing.focused,
    JSON.stringify(editing),
  );
  await page.keyboard.press('Escape');
  await page.click(cell(0, 'max'), { count: 2 });
  await page.waitForSelector(`${cell(0, 'max')} input.tg-edit`);
  await press(page, 'Control+a');
  await page.keyboard.type('-1');
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  const shown = await page
    .waitForFunction(
      (a, b) =>
        document.querySelector(a)?.classList.contains('bad') &&
        document.querySelector(b)?.classList.contains('bad') &&
        [...document.querySelectorAll('mat-statusbar button')].some((x) =>
          /^\s*1 lỗi/.test(x.textContent.replace(/\s+/g, ' ')),
        ),
      { timeout: 1000, polling: 'mutation' },
      cell(0, 'min'),
      cell(0, 'max'),
    )
    .then(() => true)
    .catch(() => false);
  const elapsed = Date.now() - t0;
  check(`Max < Min: ô Min, Max viền đỏ và "1 lỗi" trong ≤ 1 s (đo được ${elapsed} ms)`, shown);
  const reason = await page.$eval(cell(0, 'max'), (td) => ({
    title: td.title,
    desc: document.getElementById(td.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
  }));
  check(
    'ô lỗi cho xem lý do (title, aria-describedby)',
    reason.title.startsWith('E_TAG_RANGE') && reason.desc.includes('E_TAG_RANGE'),
    JSON.stringify(reason),
  );
  await shot('2-o-loi');
  await axeBothThemes(page, axe, 'Bảng Tag có ô lỗi');

  // ---------- 3. Nhấp đúp lỗi ở tab Thông tin → ô Max đang sửa (US2-2, FR-018) ----------
  await openTreeItem(page, 'Thiết lập project');
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-statusbar button')]
      .find((b) => b.textContent.includes('lỗi'))
      ?.click(),
  );
  await page.waitForSelector('mat-inspector .issue');
  const issueSel = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('mat-inspector .issue')];
    const i = rows.findIndex((r) => r.textContent.includes('E_TAG_RANGE'));
    return i < 0 ? null : `mat-inspector .issue:nth-child(${i + 1})`;
  });
  check('tab Thông tin có lỗi E_TAG_RANGE', issueSel !== null);
  if (issueSel) await page.click(issueSel, { count: 2 });
  await page
    .waitForSelector(`${cell(0, 'max')} input.tg-edit`, { timeout: 2000 })
    .catch(() => null);
  const jumped = await page.evaluate(
    (sel) => {
      const input = document.querySelector(`${sel} input.tg-edit`);
      return {
        input: Boolean(input),
        focused: document.activeElement === input,
        value: input?.value,
      };
    },
    cell(0, 'max'),
  );
  check(
    'nhấp đúp lỗi: mở Bảng Tag, ô Max đang sửa',
    (await activeTab(page)) === 'Bảng Tag mặc định' && jumped.input && jumped.focused,
    JSON.stringify(jumped),
  );
  await shot('3-nhay-toi-loi');
  await axe('Bảng Tag, ô đang sửa');
  await page.keyboard.press('Escape');

  // ---------- 4. Hoàn tác, làm lại (US2-3) ----------
  await press(page, 'Control+z');
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.textContent.trim() === '100',
    {},
    cell(0, 'max'),
  );
  const undone = await page
    .waitForFunction(
      (sel) => !document.querySelector(sel)?.classList.contains('bad'),
      { timeout: 1000 },
      cell(0, 'max'),
    )
    .then(() => true)
    .catch(() => false);
  check('Ctrl+Z: Max về 100, hết viền đỏ', undone);
  await press(page, 'Control+y');
  const redone = await page
    .waitForFunction(
      (sel) =>
        document.querySelector(sel)?.textContent.trim() === '-1' &&
        document.querySelector(sel)?.classList.contains('bad'),
      { timeout: 1000 },
      cell(0, 'max'),
    )
    .then(() => true)
    .catch(() => false);
  check('Ctrl+Y: làm lại Max = -1, ô đỏ lại', redone);

  // ---------- 5. Inspector của Tag: "Dùng ở đâu" (FR-006) ----------
  await page.click(cell(0, 'id'));
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-inspector [role="tab"]')]
      .find((b) => b.textContent.includes('Thuộc tính'))
      ?.click(),
  );
  await page.waitForSelector('mat-inspector .tg-xref');
  const refs = await page.$$eval('mat-inspector .tg-xref', (bs) =>
    bs.map((b) => b.textContent.trim()),
  );
  check(
    'inspector của Tag: "Dùng ở đâu" có màn hình và nhóm lưu trữ',
    refs.length === 4 && refs.includes('Lưu trữ › Vận hành'),
    refs.join(' | '),
  );

  // ---------- 6. Lưu khi còn lỗi (US2-5, FR-023) ----------
  await page.focus('mat-tag-grid table[role="grid"]');
  const before = (await writes(page)).length;
  await press(page, 'Control+s');
  await page.waitForFunction((n) => window.__matMock.writes.length > n, {}, before);
  const savedFiles = (await writes(page)).slice(before);
  check(
    'lưu khi còn lỗi: ghi tags.json',
    savedFiles.join(',') === 'tags.json',
    savedFiles.join(','),
  );
  const savedToast = await toast(page);
  check(
    'thông báo: còn 1 lỗi, thiết bị sẽ từ chối',
    savedToast?.includes('Còn 1 lỗi: thiết bị sẽ từ chối project này.'),
    savedToast,
  );
  await page.click('mat-menubar .menubar-btn:nth-child(4)');
  const download = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.menu-pop [role="menuitem"]')].find((e) =>
      e.textContent.includes('Nạp xuống'),
    );
    return b ? { disabled: b.getAttribute('aria-disabled'), text: b.textContent } : null;
  });
  check(
    'còn lỗi: Nạp xuống khóa với lý do "Project còn lỗi"',
    download?.disabled === 'true' && /Project còn lỗi/.test(download.text),
    JSON.stringify(download),
  );
  await page.keyboard.press('Escape');

  // ---------- 7. File bị sửa ngoài Studio: Ghi đè / Tải lại / Hủy (US2-7, FR-025) ----------
  await page.evaluate(() =>
    window.__matMock.editOutside('tags.json', '{ "schemaVersion": "0.1.0", "tags": [] }\n'),
  );
  await page.click(cell(1, 'unit'));
  await page.keyboard.type('bar');
  await page.keyboard.press('Enter');
  await press(page, 'Control+s');
  await page.waitForSelector('mat-dialog [role="dialog"]');
  const conflict = await dialog(page);
  check(
    'xung đột: hộp thoại Ghi đè / Tải lại / Hủy',
    conflict?.kind === 'conflict' && conflict.buttons.join(',') === 'Ghi đè,Tải lại,Hủy',
    JSON.stringify(conflict),
  );
  await shot('4-xung-dot');
  await axe('hộp thoại xung đột');
  const beforeCancel = (await writes(page)).length;
  await answer(page, 'cancel');
  check(
    'Hủy: không ghi đè âm thầm, thay đổi vẫn giữ',
    (await writes(page)).length === beforeCancel && (await page.title()).startsWith('● '),
    await page.title(),
  );
  await press(page, 'Control+s');
  await answer(page, 'overwrite');
  await page.waitForFunction((n) => window.__matMock.writes.length > n, {}, beforeCancel);
  const forced = await page.evaluate(() => window.__matMock.writes.at(-1));
  check(
    'Ghi đè: ghi tags.json với nội dung trong Studio',
    forced.rel === 'tags.json' && forced.content.includes('"unit": "bar"'),
    forced.rel,
  );

  // ---------- 8. Đóng khi chưa lưu: Lưu / Không lưu / Hủy (US2-6, FR-024) ----------
  await page.click(cell(3, 'unit'));
  await page.keyboard.type('l/s');
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    window.__closeAsked = window.__matMock.requestClose();
  });
  await page.waitForSelector('mat-dialog [role="dialog"]');
  const unsaved = await dialog(page);
  check(
    'đóng khi chưa lưu: hộp thoại Lưu / Không lưu / Hủy',
    unsaved?.kind === 'unsaved' && unsaved.buttons.join(',') === 'Lưu,Không lưu,Hủy',
    JSON.stringify(unsaved),
  );
  await shot('5-dong-chua-luu');
  await axe('hộp thoại đóng khi chưa lưu');
  await answer(page, 'cancel');
  check('Hủy: cửa sổ không đóng', (await page.evaluate(() => window.__closeAsked)) === false);
  // Ô đang gõ dở cũng được hỏi (xác nhận ô trước khi hỏi)
  await page.click(cell(4, 'unit'), { count: 2 });
  await page.waitForSelector(`${cell(4, 'unit')} input.tg-edit`);
  await press(page, 'Control+a');
  await page.keyboard.type('K');
  await page.evaluate(() => {
    window.__closeAsked = window.__matMock.requestClose();
  });
  await page.waitForSelector('mat-dialog [role="dialog"]');
  const before2 = (await writes(page)).length;
  await answer(page, 'save');
  await sleep(50);
  const closed = await page.evaluate(() => window.__closeAsked);
  const last = await page.evaluate(() => window.__matMock.writes.at(-1));
  check(
    'Lưu: ghi cả ô đang gõ dở rồi cho đóng',
    closed === true &&
      (await writes(page)).length > before2 &&
      last.content.includes('"unit": "K"') &&
      last.content.includes('"unit": "l/s"'),
    JSON.stringify({ closed, rel: last?.rel }),
  );
  await page.goto(url, { waitUntil: 'networkidle0' });
}
