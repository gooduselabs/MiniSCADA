// E2E Nạp xuống và Khôi phục (feature 005, T125, US2, quickstart §5 bước 7–11) với DeviceLink giả
// (platform/mock-device.ts, điều khiển qua window.__matMock.device):
// - project còn lỗi: lệnh Nạp xuống khóa kèm lý do "Project còn lỗi";
// - xem trước đủ chín dòng (thêm dòng Kết nối và Tag giữ qua mất điện, feature 006); có cảnh báo thì phải đánh dấu "đã đọc" mới nạp xuống được;
// - nạp xuống: 6 bước và kết quả; Esc không đóng khi đang chạy; thiết bị chạy bản mới;
// - khôi phục: danh sách bản lưu, xác nhận, kết quả; Khôi phục bản trước từ kết quả Nạp xuống;
// - cờ gây lỗi ở từng bước: đúng lý do, bản đang chạy không đổi; rollback: bước thêm và "đã quay về bản";
// - DEVICE_BUSY: nói ai, từ đâu; BASE_CHANGED: thông báo;
// - axe-core ở xem trước, tiến trình, kết quả, Khôi phục, theme sáng và tối.
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

const role = (r) => `[data-role="${r}"]`;
const DL = 'mat-download-dialog';
const RS = 'mat-restore-dialog';

async function waitSel(page, sel, timeout = 8000) {
  await page.waitForSelector(sel, { timeout });
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

const dialogOpen = (page, tag) => page.$(`${tag} [role="dialog"]`).then(Boolean);
const steps = (page, tag) =>
  page.$$eval(`${tag} li[data-step]`, (lis) =>
    lis.map((l) => `${l.dataset.step}:${l.dataset.state}`),
  );
/** Chờ `fn` (chạy trong trang) trả truthy. */
async function waitFor(page, fn, arg, timeout = 8000) {
  await page.waitForFunction(fn, { timeout, polling: 50 }, arg);
}

export default async function download(ctx) {
  const { page } = ctx;
  await page.waitForSelector('mat-start-page .start-hero');
  const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? 'system');
  try {
    await scenario(ctx);
  } finally {
    await setTheme(page, theme).catch(() => undefined);
  }
}

/** Đóng hộp thoại bằng Esc khi được phép. */
async function closeByEsc(page, tag) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (t) => !document.querySelector(`${t} [role="dialog"]`),
    { timeout: 3000 },
    tag,
  );
}

async function scenario({ page, check, shot, axe }) {
  const pw = `thu-${randomBytes(12).toString('hex')}`;
  await page.evaluate((p) => {
    const c = window.__matMock.device;
    for (const u of ['kysu1', 'xem1', 'admin']) c.setPassword(u, `${p}-${u}`);
    c.deployStepMs = 120;
  }, pw);
  await setTheme(page, 'light');
  await page.click('mat-start-page .start-hero [data-cmd="project.open"]');
  await page.waitForSelector('mat-tree [role="treeitem"]');

  // Online BL335-01: Ctrl+K mở Thiết bị trong mạng (project chưa gắn), chọn, ghim, đăng nhập kysu1.
  await ctrl(page, 'KeyK');
  await waitSel(page, 'mat-devices-dialog [role="dialog"]');
  await page.waitForFunction(
    () => document.querySelectorAll('mat-devices-dialog tbody tr[data-key]').length >= 2,
    { timeout: 5000, polling: 50 },
  );
  await page.waitForFunction(
    () => /Tìm xong/.test(document.querySelector('mat-devices-dialog .scan')?.textContent ?? ''),
    { timeout: 6000, polling: 50 },
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-devices-dialog tbody tr[data-key]')]
      .find((r) => r.textContent.includes('BL335-01'))
      ?.click(),
  );
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Online');
  await waitSel(page, 'mat-pin-dialog [role="dialog"]');
  await clickButton(page, 'mat-pin-dialog .dlg-f', 'Ghim và tiếp tục');
  await waitSel(page, 'mat-login-dialog [role="dialog"]');
  await page.type('mat-login-dialog input[name="user"]', 'kysu1');
  await page.type('mat-login-dialog input[name="password"]', `${pw}-kysu1`);
  await clickButton(page, 'mat-login-dialog .dlg-f', 'Đăng nhập');
  await waitFor(page, () =>
    /kysu1 · engineer/.test(document.querySelector('mat-statusbar')?.textContent ?? ''),
  );

  // 1. Project còn lỗi: lệnh Nạp xuống khóa kèm lý do (FR-023 của 004).
  const tagsOk = sample('tags.json');
  const tagsBad = tagsOk.replace('"max": 100', '"max": -1');
  await page.evaluate((c) => window.__matMock.editOutside('tags.json', c), tagsBad);
  await page.keyboard.press('F7');
  await waitFor(page, () =>
    /\b[1-9]\d* lỗi/.test(
      (document.querySelector('mat-statusbar')?.textContent ?? '').replace(/\s+/g, ' '),
    ),
  );
  await ctrl(page, 'KeyL');
  await page.waitForFunction(
    () => /Project còn lỗi/.test(document.querySelector('mat-toast')?.textContent ?? ''),
    {
      timeout: 4000,
      polling: 50,
    },
  );
  check(
    'project còn lỗi: Ctrl+L không mở hộp thoại, báo "Project còn lỗi"',
    !(await dialogOpen(page, DL)),
    await text(page, 'mat-toast'),
  );
  await page.evaluate((c) => window.__matMock.editOutside('tags.json', c), tagsOk);
  await page.keyboard.press('F7');
  await waitFor(
    page,
    () => !/Project còn lỗi/.test(document.querySelector('mat-statusbar')?.textContent ?? ''),
  );

  // 2. Xem trước: chín dòng; có cảnh báo thì phải đánh dấu "đã đọc".
  const screenOk = sample('screens/tank-motor.screen.json');
  const screenWarn = screenOk.replace(
    '"elements": [',
    '"elements": [\n    { "elementUid": "el_thua", "name": "Thừa", "kind": "shape" },',
  );
  await page.evaluate(
    (c) => window.__matMock.editOutside('screens/tank-motor.screen.json', c),
    screenWarn,
  );
  await page.keyboard.press('F7');
  await new Promise((r) => setTimeout(r, 600));
  await ctrl(page, 'KeyL');
  await waitSel(page, `${DL} tr[data-row="device"]`);
  const rows = await page.$$eval(`${DL} tr[data-row]`, (r) => r.map((x) => x.dataset.row));
  check(
    'xem trước: đủ chín dòng theo thứ tự',
    rows.join(',') === 'check,runtime,replace,clients,size,logging,connections,retain,device',
    rows.join(','),
  );
  const warnRow = await text(page, `${DL} tr[data-row="check"]`);
  const lockedByAck = await page.$eval(`${DL} ${role('deploy')}`, (b) => b.disabled);
  check(
    'có cảnh báo: nút Nạp xuống khóa tới khi đánh dấu "đã đọc cảnh báo"',
    /0 lỗi, [1-9]\d* cảnh báo/.test(warnRow) &&
      lockedByAck &&
      /Đánh dấu đã đọc cảnh báo/.test(await text(page, `${DL} ${role('lock')}`)),
    warnRow,
  );
  await shot('1-xem-truoc-canh-bao');
  await axeBoth(page, axe, 'Nạp xuống, xem trước có cảnh báo');
  await page.click(`${DL} ${role('ack')}`);
  await waitFor(page, (s) => !document.querySelector(s)?.disabled, `${DL} ${role('deploy')}`);
  check(
    'đánh dấu "đã đọc": nút Nạp xuống mở',
    await page.$eval(`${DL} ${role('deploy')}`, (b) => !b.disabled),
  );
  await closeByEsc(page, DL);
  await page.evaluate(
    (c) => window.__matMock.editOutside('screens/tank-motor.screen.json', c),
    screenOk,
  );
  await page.keyboard.press('F7');
  await new Promise((r) => setTimeout(r, 600));

  // 3. Nạp xuống thành công: 6 bước, Esc không đóng khi đang chạy, kết quả.
  await ctrl(page, 'KeyL');
  await waitSel(page, `${DL} tr[data-row="device"]`);
  const info = {
    check: await text(page, `${DL} tr[data-row="check"]`),
    runtime: await text(page, `${DL} tr[data-row="runtime"]`),
    replace: await text(page, `${DL} tr[data-row="replace"]`),
    device: await text(page, `${DL} tr[data-row="device"]`),
  };
  check(
    'xem trước: kiểm tra, runtime, project giống thiết bị, đã đăng nhập',
    /0 lỗi, 0 cảnh báo/.test(info.check) &&
      /≥ 0\.3\.0, thiết bị 0\.4\.0/.test(info.runtime) &&
      /Giống máy này/.test(info.replace) &&
      /Đã đăng nhập kysu1 \(engineer\)/.test(info.device) &&
      (await page.$eval(`${DL} ${role('deploy')}`, (b) => !b.disabled)),
    JSON.stringify(info),
  );
  await shot('2-xem-truoc');
  await axeBoth(page, axe, 'Nạp xuống, xem trước');
  await page.click(`${DL} ${role('deploy')}`);
  await waitSel(page, `${DL} li[data-step]`);
  await waitFor(page, (s) => document.querySelector(s) !== null, `${DL} li[data-state="running"]`);
  const running = await steps(page, DL);
  check(
    'đang chạy: 6 bước theo thứ tự, có bước đang chạy',
    running.length === 6 &&
      running.map((s) => s.split(':')[0]).join(',') ===
        'receive,verify-package,validate,backup,activate,health' &&
      running.some((s) => s.endsWith(':running')),
    running.join(' '),
  );
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 150));
  check('Esc khi đang chạy không đóng hộp thoại', await dialogOpen(page, DL));
  await shot('3-dang-chay');
  await axe('Nạp xuống, đang chạy, theme sáng');
  await waitSel(page, `${DL} .result[data-outcome="committed"]`, 15000);
  const done = await text(page, `${DL} .result`);
  check(
    'kết quả: nạp xuống xong, thiết bị đang chạy, bản trước giữ để khôi phục',
    /Nạp xuống xong trong/.test(done) &&
      /BL335-01 đang chạy/.test(done) &&
      /Bản trước/.test(await text(page, `${DL} .dlg-b`)) &&
      (await steps(page, DL)).every((s) => s.endsWith(':ok')),
    done,
  );
  await shot('4-ket-qua');
  await axeBoth(page, axe, 'Nạp xuống, kết quả');

  // 4. Khôi phục bản trước ngay từ kết quả (kind = restore).
  await clickButton(page, DL, 'Khôi phục bản trước');
  await waitSel(page, `${DL} .result[data-outcome="committed"]`, 15000);
  await waitFor(
    page,
    () =>
      /Khôi phục xong/.test(
        document.querySelector('mat-download-dialog .result')?.textContent ?? '',
      ),
    null,
    15000,
  );
  const restored = await steps(page, DL);
  check(
    'Khôi phục bản trước từ kết quả: hai bước đầu bỏ qua, kết quả "Khôi phục xong"',
    restored.slice(0, 2).join(' ') === 'receive:skipped verify-package:skipped',
    restored.join(' '),
  );
  await closeByEsc(page, DL);

  // 5. Hộp thoại Khôi phục từ menu Online: danh sách bản lưu, xác nhận, kết quả.
  await openMenuItem(page, 'Khôi phục bản trước');
  await waitSel(page, `${RS} tr[data-seq]`);
  const versions = await page.$$eval(`${RS} tr[data-seq]`, (r) => r.map((x) => x.dataset.seq));
  const listText = await text(page, `${RS} .dlg-b`);
  check(
    'Khôi phục: danh sách bản lưu có phiên bản, digest, người nạp; bản đang chạy nằm trên cùng',
    versions.length === 2 &&
      /Đang chạy/.test(listText) &&
      /Bản lưu/.test(listText) &&
      /kysu1/.test(listText),
    versions.join(',') + ' ' + listText.slice(0, 200),
  );
  await shot('5-khoi-phuc-danh-sach');
  await axeBoth(page, axe, 'Khôi phục, danh sách');
  await page.evaluate(() =>
    document.querySelector('mat-restore-dialog tr[data-seq][data-active="false"]')?.click(),
  );
  await page.click(`${RS} ${role('restore')}`);
  await waitSel(page, `${RS} ${role('confirm')}`);
  check(
    'Khôi phục: bước xác nhận nói thiết bị chạy lại bản đã chọn',
    /Thiết bị chạy lại bản/.test(await text(page, `${RS} .dlg-b`)),
  );
  await axe('Khôi phục, xác nhận, theme sáng');
  await page.click(`${RS} ${role('confirm')}`);
  await waitSel(page, `${RS} .result[data-outcome="committed"]`, 15000);
  check(
    'Khôi phục xong',
    /Khôi phục xong/.test(await text(page, `${RS} .result`)),
    await text(page, `${RS} .result`),
  );
  await shot('6-khoi-phuc-ket-qua');
  await closeByEsc(page, RS);

  // 6. Cờ gây lỗi ở từng bước: đúng lý do, bản đang chạy không đổi.
  const expectations = [
    ['receive', /gửi gói quá 10 phút/],
    ['verify-package', /mã lỗi E_PKG_CHECKSUM/],
    ['validate', /thiết bị từ chối project/],
    ['backup', /không ghi được kho project/],
    ['activate', /runtime mới không khởi động được/],
  ];
  for (const [step, re] of expectations) {
    await page.evaluate((s) => window.__matMock.device.failDeploy(s), step);
    await ctrl(page, 'KeyL');
    await waitSel(page, `${DL} ${role('deploy')}`);
    await waitFor(page, (s) => !document.querySelector(s)?.disabled, `${DL} ${role('deploy')}`);
    await page.click(`${DL} ${role('deploy')}`);
    await waitSel(page, `${DL} .result[data-outcome="failed"]`, 15000);
    const failed = await text(page, `${DL} .result`);
    const st = await steps(page, DL);
    check(
      `lỗi ở bước ${step}: không thành công, đúng lý do, bước lỗi được đánh dấu`,
      /Nạp xuống không thành công\. Bản đang chạy không đổi\./.test(failed) &&
        re.test(failed) &&
        st.includes(`${step}:failed`),
      `${failed} | ${st.join(' ')}`,
    );
    if (step === 'validate') {
      await shot('7-loi-validate');
      await axe('Nạp xuống, lỗi ở validate, theme sáng');
    }
    await closeByEsc(page, DL);
  }

  // 7. Rollback: health lỗi → bước rollback, "đã tự quay về bản".
  await page.evaluate(() => window.__matMock.device.failDeploy('health'));
  await ctrl(page, 'KeyL');
  await waitFor(
    page,
    (s) => document.querySelector(s) && !document.querySelector(s).disabled,
    `${DL} ${role('deploy')}`,
  );
  await page.click(`${DL} ${role('deploy')}`);
  await waitSel(page, `${DL} .result[data-outcome="rolled-back"]`, 15000);
  const rb = await text(page, `${DL} .result`);
  const rbSteps = await steps(page, DL);
  check(
    'rollback: thêm bước rollback; kết quả nói đã tự quay về bản trước, kèm lý do health',
    /Thiết bị đã tự quay về bản/.test(rb) &&
      /runtime không trả lời sau 15 giây/.test(rb) &&
      rbSteps.length === 7 &&
      rbSteps[6] === 'rollback:ok',
    `${rb} | ${rbSteps.join(' ')}`,
  );
  await shot('8-rollback');
  await axeBoth(page, axe, 'Nạp xuống, rollback');
  await closeByEsc(page, DL);

  // 8. DEVICE_BUSY: ai, từ đâu; BASE_CHANGED: thông báo, xem trước làm lại.
  await ctrl(page, 'KeyL');
  await waitFor(
    page,
    (s) => document.querySelector(s) && !document.querySelector(s).disabled,
    `${DL} ${role('deploy')}`,
  );
  await page.evaluate(() =>
    window.__matMock.device.setBusy('BL335-01', { user: 'kysu2', source: '192.168.1.77' }),
  );
  await page.click(`${DL} ${role('deploy')}`);
  await waitSel(page, `${DL} ${role('notice')}`);
  const busy = await text(page, `${DL} ${role('notice')}`);
  check(
    'DEVICE_BUSY: về xem trước, nói ai và từ đâu',
    /kysu2/.test(busy) && /192\.168\.1\.77/.test(busy),
    busy,
  );
  await shot('9-busy');
  await axe('Nạp xuống, thiết bị bận, theme sáng');
  await page.evaluate(() => {
    const d = window.__matMock.device;
    d.setBusy('BL335-01', null);
    d.changeBase('BL335-01');
  });
  await waitFor(page, (s) => !document.querySelector(s)?.disabled, `${DL} ${role('deploy')}`);
  await page.click(`${DL} ${role('deploy')}`);
  await waitFor(page, () =>
    /Có người vừa nạp xuống/.test(
      document.querySelector('mat-download-dialog [data-role="notice"]')?.textContent ?? '',
    ),
  );
  check(
    'BASE_CHANGED: thông báo có người vừa nạp xuống, về bước xem trước',
    /Có người vừa nạp xuống/.test(await text(page, `${DL} ${role('notice')}`)) &&
      (await page.$(`${DL} tr[data-row="check"]`)) !== null,
  );
  await closeByEsc(page, DL);
}
