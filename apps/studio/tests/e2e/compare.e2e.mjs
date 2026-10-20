// E2E Đọc lên và So sánh (feature 005, T139, US3, quickstart §5 bước 12–14) với DeviceLink giả
// (platform/mock-device.ts, điều khiển qua window.__matMock.device); bản đang chạy trên thiết bị giả là project mẫu
// `projects/tank-demo` đã sửa một Tag (đổi max), bỏ một Tag, thêm một Tag:
// - Online (kysu1): tự so; chip "khác thiết bị" ở thanh trạng thái, ký hiệu trên cây;
// - So sánh: bảng hiện đúng "+" (chỉ trên máy), "≠" (khác), "-" (chỉ trên thiết bị), "="; chọn dòng hiện khác biệt
//   từng trường; lọc theo trạng thái; cây có cùng ký hiệu;
// - Đọc lên phần chọn: thành sửa đổi chưa lưu (tiêu đề cửa sổ có ●, không ghi đĩa), Ctrl+Z hoàn tác;
// - Đọc lên thành project mới vào thư mục rỗng giả: mở project, kết luận kiểm tra, digest giống thiết bị; hủy hộp
//   thoại chọn thư mục thì giữ nguyên; thư mục không rỗng thì báo lý do;
// - axe-core ở So sánh và hộp thoại Đọc lên, theme sáng và tối.
// Mật khẩu thử sinh ngẫu nhiên mỗi lần chạy, không ghi vào repo.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = resolve(here, '../../../../projects/tank-demo');
const sample = (rel) => readFileSync(resolve(SAMPLE, rel), 'utf8');

const text = (page, sel) =>
  page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');

async function ctrl(page, key) {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
}

async function setTheme(page, theme) {
  for (let i = 0; i < 3; i++) {
    if ((await page.evaluate(() => document.documentElement.dataset.theme ?? 'system')) === theme)
      return;
    await page.evaluate(() =>
      [...document.querySelectorAll('mat-statusbar button')]
        .find((b) => /Theo hệ thống|Sáng|Tối/.test(b.textContent))
        ?.click(),
    );
  }
}

async function axeBoth(page, axe, label) {
  await setTheme(page, 'light');
  await axe(`${label}, theme sáng`);
  await setTheme(page, 'dark');
  await axe(`${label}, theme tối`);
  await setTheme(page, 'light');
}

async function clickButton(page, scope, label) {
  const ok = await page.evaluate(
    (s, l) => {
      const b = [...document.querySelectorAll(`${s} button`)].find((x) =>
        x.textContent.includes(l),
      );
      b?.click();
      return Boolean(b);
    },
    scope,
    label,
  );
  if (!ok) throw new Error(`không thấy nút "${label}" trong ${scope}`);
}

async function waitFor(page, fn, arg, timeout = 8000) {
  await page.waitForFunction(fn, { timeout, polling: 50 }, arg);
}

async function openMenuItem(page, label) {
  await page.click('mat-menubar .menubar-btn:nth-child(4)');
  await page.waitForSelector('.menu-pop [role="menuitem"]');
  const ok = await page.evaluate((l) => {
    const item = [...document.querySelectorAll('.menu-pop [role="menuitem"]')].find((e) =>
      e.textContent.includes(l),
    );
    item?.click();
    return Boolean(item);
  }, label);
  if (!ok) throw new Error(`không thấy mục menu "${label}"`);
}

const CE = 'mat-compare-editor';
const role = (r) => `[data-role="${r}"]`;
const rowSel = (key) => `${CE} tr[data-key="${key}"]`;
const symbolOf = (page, key) => page.$eval(rowSel(key), (r) => r.dataset.status).catch(() => null);
const treeMark = (page, id) =>
  page.$eval(`mat-tree [id="ti-${id}"] .cmp-sym`, (e) => e.textContent).catch(() => null);
const title = (page) => page.title();

const FILES = [
  'project.json',
  'tags.json',
  'logging.json',
  'screens/tank-motor.screen.json',
  'screens/tank-motor.bindings.json',
  'screens/tank-motor.svg',
];

/** Project trên máy: project mẫu thêm một Tag chỉ có trên máy (LOCAL.ONLY). */
function localFiles() {
  const files = Object.fromEntries(FILES.map((f) => [f, sample(f)]));
  const tags = JSON.parse(files['tags.json']);
  tags.tags.push({
    id: 'LOCAL.ONLY',
    type: 'BOOL',
    description: 'Chỉ có trên máy',
    source: { kind: 'mock', signal: 'motor.run' },
  });
  files['tags.json'] = JSON.stringify(tags, null, 2) + '\n';
  return files;
}

/** Bản của thiết bị: project mẫu, Tag đầu đổi max, thêm DEV.ONLY (hai project đều hợp lệ). */
function deviceTags() {
  const tags = JSON.parse(sample('tags.json'));
  tags.tags[0].max = 120;
  tags.tags.push({
    id: 'DEV.ONLY',
    type: 'BOOL',
    description: 'Chỉ có trên thiết bị',
    source: { kind: 'mock', signal: 'motor.run' },
  });
  return JSON.stringify(tags, null, 2) + '\n';
}

export default async function compare(ctx) {
  const { page } = ctx;
  await page.waitForSelector('mat-start-page .start-hero');
  const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? 'system');
  try {
    await scenario(ctx);
  } finally {
    await setTheme(page, theme).catch(() => undefined);
  }
}

async function scenario({ page, check, shot, axe }) {
  const pw = `thu-${randomBytes(12).toString('hex')}`;
  await page.evaluate(
    (p, tags, local) => {
      const c = window.__matMock.device;
      for (const u of ['kysu1', 'xem1', 'admin']) c.setPassword(u, `${p}-${u}`);
      c.editStored('BL335-01', 'tags.json', tags);
      window.__matMock.useProject(local);
    },
    pw,
    deviceTags(),
    localFiles(),
  );
  await setTheme(page, 'light');
  await page.click('mat-start-page .start-hero [data-cmd="project.open"]');
  await page.waitForSelector('mat-tree [role="treeitem"]');

  // Online BL335-01 (Ctrl+K mở Thiết bị trong mạng), ghim, đăng nhập kysu1.
  await ctrl(page, 'KeyK');
  await page.waitForSelector('mat-devices-dialog [role="dialog"]');
  await waitFor(
    page,
    () => /Tìm xong/.test(document.querySelector('mat-devices-dialog .scan')?.textContent ?? ''),
    undefined,
    6000,
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-devices-dialog tbody tr[data-key]')]
      .find((r) => r.textContent.includes('BL335-01'))
      ?.click(),
  );
  // Hộp thoại có hai nút Đọc lên cạnh Online.
  const upBtns = await page.$$eval('mat-devices-dialog .dlg-f button[data-role^="upload-"]', (bs) =>
    bs.map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
  );
  check(
    'Thiết bị trong mạng: có "Đọc lên thành project mới" và "Đọc lên để so sánh"',
    upBtns.length === 2 &&
      upBtns.some((t) => t.includes('thành project mới')) &&
      upBtns.some((t) => t.includes('để so sánh')),
    upBtns.join(' | '),
  );
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Online');
  await page.waitForSelector('mat-pin-dialog [role="dialog"]');
  await clickButton(page, 'mat-pin-dialog .dlg-f', 'Ghim và tiếp tục');
  await page.waitForSelector('mat-login-dialog [role="dialog"]');
  await page.type('mat-login-dialog input[name="user"]', 'kysu1');
  await page.type('mat-login-dialog input[name="password"]', `${pw}-kysu1`);
  await clickButton(page, 'mat-login-dialog .dlg-f', 'Đăng nhập');
  await waitFor(page, () =>
    /kysu1 · engineer/.test(document.querySelector('mat-statusbar')?.textContent ?? ''),
  );

  // 1. Tự so: chip trên thanh trạng thái và ký hiệu trên cây.
  await waitFor(page, () =>
    /khác thiết bị/.test(
      document.querySelector('mat-statusbar [data-role="compare"]')?.textContent ?? '',
    ),
  );
  check(
    'tự so khi vào Online: thanh trạng thái báo "khác thiết bị"',
    /khác thiết bị/.test(await text(page, 'mat-statusbar [data-role="compare"]')),
    await text(page, 'mat-statusbar [data-role="compare"]'),
  );
  const marks = {
    tags: await treeMark(page, 'tags'),
    logging: await treeMark(page, 'logging'),
    settings: await treeMark(page, 'settings'),
    screen: await treeMark(page, 'screen:tank-motor'),
  };
  check(
    'cây project khi Online: Bảng Tag "≠", Lưu trữ, Thiết lập, màn hình "="',
    marks.tags === '≠' && marks.logging === '=' && marks.settings === '=' && marks.screen === '=',
    JSON.stringify(marks),
  );

  // 2. So sánh: bảng đúng ký hiệu; cây cùng ký hiệu; khác biệt từng trường.
  await openMenuItem(page, 'So sánh với thiết bị');
  await page.waitForSelector(`${CE} table[data-table="objects"]`);
  const sym = {
    level: await symbolOf(page, 'TANK01.LEVEL'),
    temp: await symbolOf(page, 'LOCAL.ONLY'),
    dev: await symbolOf(page, 'DEV.ONLY'),
    run: await symbolOf(page, 'MOTOR01.RUN'),
    group: await symbolOf(page, 'van-hanh'),
  };
  check(
    'So sánh: "≠" Tag đổi, "+" Tag chỉ trên máy, "-" Tag chỉ trên thiết bị, "=" Tag giống, nhóm lưu trữ "="',
    sym.level === '≠' &&
      sym.temp === '+' &&
      sym.dev === '-' &&
      sym.run === '=' &&
      sym.group === '=',
    JSON.stringify(sym),
  );
  const marksAfter = await treeMark(page, 'tags');
  check('cây và bảng cùng ký hiệu cho Tag ("≠")', marksAfter === sym.level, `${marksAfter}`);
  check(
    'có chữ kèm ký hiệu (không chỉ màu): dòng "+" nói "chỉ có trên máy"',
    /chỉ có trên máy/.test(await text(page, rowSel('LOCAL.ONLY'))),
    await text(page, rowSel('LOCAL.ONLY')),
  );
  await page.click(rowSel('TANK01.LEVEL'));
  await waitFor(
    page,
    (s) => document.querySelector(s)?.getAttribute('aria-selected') === 'true',
    rowSel('TANK01.LEVEL'),
  );
  const field = await text(page, `${CE} [data-table="fields"] tbody tr`);
  check(
    'chọn dòng hiện khác biệt từng trường (/max: 100 → 120)',
    /\/max/.test(field) && /100/.test(field) && /120/.test(field),
    field,
  );
  await shot('1-so-sanh');
  await axeBoth(page, axe, 'So sánh');

  // Lọc theo trạng thái.
  await page.click(`${CE} ${role('status-+')}`);
  await waitFor(page, (s) => document.querySelectorAll(s).length === 1, `${CE} tr[data-key]`);
  check(
    'lọc "+": chỉ còn Tag chỉ có trên máy',
    (await page.$$eval(`${CE} tr[data-key]`, (r) => r.map((x) => x.dataset.key))).join() ===
      'LOCAL.ONLY',
  );
  await page.click(`${CE} ${role('status-all')}`);
  await page.click(rowSel('LOCAL.ONLY'));
  const lockedPlus = await page.$eval(`${CE} ${role('take')}`, (b) =>
    b.getAttribute('aria-disabled'),
  );
  check('dòng "+" : Đọc lên phần chọn khóa', lockedPlus === 'true');

  // 3. Đọc lên phần chọn: chưa lưu (tiêu đề ●), không ghi đĩa; Ctrl+Z hoàn tác.
  await page.click(rowSel('TANK01.LEVEL'));
  const writesBefore = await page.evaluate(() => window.__matMock.writes.length);
  await page.click(`${CE} ${role('take')}`);
  await waitFor(page, () => document.title.startsWith('● '));
  check(
    'Đọc lên phần chọn: thành sửa đổi chưa lưu (●), không ghi đĩa, báo cách hoàn tác',
    (await page.evaluate(() => window.__matMock.writes.length)) === writesBefore &&
      /Ctrl\+Z/.test(await text(page, 'mat-toast')),
    `${await title(page)} | ${await text(page, 'mat-toast')}`,
  );
  await shot('2-doc-len-phan-chon');
  await page.evaluate(() => document.activeElement?.blur?.());
  await ctrl(page, 'KeyZ');
  await waitFor(page, () => !document.title.startsWith('● '));
  check('Ctrl+Z hoàn tác phần vừa đọc lên: hết chưa lưu', !(await title(page)).startsWith('● '));

  // 4. Nạp xuống phần khác mở hộp thoại Nạp xuống.
  await page.click(`${CE} ${role('download')}`);
  await page.waitForSelector('mat-download-dialog [role="dialog"]');
  check('Nạp xuống phần khác: mở hộp thoại Nạp xuống', true);
  await page.keyboard.press('Escape');
  await waitFor(page, () => !document.querySelector('mat-download-dialog [role="dialog"]'));

  // 5. Đọc lên thành project mới: hủy, thư mục không rỗng, rồi thư mục rỗng giả.
  await openMenuItem(page, 'Đọc lên');
  await page.waitForSelector('mat-upload-dialog [role="dialog"]');
  await shot('3-doc-len');
  await axeBoth(page, axe, 'Hộp thoại Đọc lên');
  await page.evaluate(() => window.__matMock.device.setExtractFolder('cancel'));
  const projectBefore = await title(page);
  await clickButton(page, 'mat-upload-dialog .dlg-f', 'Đọc lên');
  await waitFor(page, () => !document.querySelector('mat-upload-dialog [role="dialog"]'));
  await new Promise((r) => setTimeout(r, 400));
  check(
    'hủy hộp thoại chọn thư mục: giữ nguyên project, không báo lỗi',
    (await title(page)) === projectBefore &&
      !/Không đọc lên được/.test(await text(page, 'mat-toast')),
    await text(page, 'mat-toast'),
  );
  await page.evaluate(() => window.__matMock.device.setExtractFolder('not-empty'));
  await openMenuItem(page, 'Đọc lên');
  await page.waitForSelector('mat-upload-dialog [role="dialog"]');
  await clickButton(page, 'mat-upload-dialog .dlg-f', 'Đọc lên');
  await waitFor(page, () =>
    /thư mục đã chọn không rỗng/.test(document.querySelector('mat-toast')?.textContent ?? ''),
  );
  check('thư mục không rỗng: báo lý do', true, await text(page, 'mat-toast'));
  await page.evaluate(() => window.__matMock.device.setExtractFolder('empty'));
  await openMenuItem(page, 'Đọc lên');
  await page.waitForSelector('mat-upload-dialog [role="dialog"]');
  await clickButton(page, 'mat-upload-dialog .dlg-f', 'Đọc lên');
  await waitFor(page, () =>
    /Đã đọc lên/.test(document.querySelector('mat-toast')?.textContent ?? ''),
  );
  const done = await text(page, 'mat-toast');
  check(
    'Đọc lên thành project mới: giải nén vào thư mục rỗng giả, mở project, kiểm tra không lỗi, digest giống thiết bị',
    /doc-len-BL335-01/.test(done) &&
      /Kiểm tra: không có lỗi/.test(done) &&
      /Digest giống thiết bị/.test(done),
    done,
  );
  await shot('4-project-moi');
  // Project mới chính là bản trên thiết bị: So sánh nói giống hệt.
  await openMenuItem(page, 'So sánh với thiết bị');
  await page.waitForSelector(`${CE} ${role('same')}`, { timeout: 8000 });
  check(
    'sau khi đọc lên thành project mới: So sánh nói "giống hệt"',
    /giống hệt/.test(await text(page, `${CE} ${role('same')}`)),
  );
  await axeBoth(page, axe, 'So sánh, giống hệt');
}
