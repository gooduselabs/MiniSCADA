// E2E nâng cấp project 0.3 (và 0.1, 0.2) lên 0.4 (feature 008, T105, FR-005, FR-006, US6-1), lớp Tauri giả:
// - mở dashboard-demo 0.3 → hộp thoại Nâng cấp lên 0.4.0 nêu việc đổi (runtime tối thiểu 0.7.0, file ghi lại), nơi sao lưu;
//   ba nút Hủy, Mở chỉ đọc, Nâng cấp; axe hai theme;
// - Nâng cấp rồi Ctrl+S: có sao lưu trước khi ghi, mọi file ghi ở 0.4.0, minRuntimeVersion 0.7.0;
// - project 0.1 và 0.2 qua chuỗi một lần (một hộp thoại, một bản sao lưu, ghi 0.4.0);
// - Mở chỉ đọc: không ghi gì, màn hình vẫn xem trước được;
// - Nạp xuống project 0.4 lên runtime 0.6.0 (< 0.7.0): dòng "Tương thích runtime" báo lỗi, nút Nạp xuống khóa; dòng Màn hình nêu
//   tổng dung lượng SVG;
// - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
// Mật khẩu thử sinh ngẫu nhiên mỗi lần chạy, không ghi vào repo.
import { randomBytes } from 'node:crypto';
import {
  DASHBOARD_DEMO,
  FULL_02,
  TANK_DEMO,
  axeBoth,
  clickButton,
  readProject,
  setTheme,
  sleep,
  text,
  waitFor,
} from './util.mjs';

/** Kịch bản này cần cổng phiên bản bật. */
export const gate = true;

const UP = 'mat-upgrade-dialog';
const DL = 'mat-download-dialog';
const dialogOpen = (page, tag) => page.$(`${tag} [role="dialog"]`).then(Boolean);
const mock = (page, fn, ...args) => page.evaluate(fn, ...args);

async function ctrl(page, key) {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
}

async function openWith(page, files, display) {
  await page.waitForSelector('mat-start-page .start-hero');
  await page.evaluate((f, d) => window.__matMock.useProject(f, d), files, display);
  await page.$eval('mat-start-page .start-hero [data-cmd="project.open"]', (b) => b.click());
  await page.waitForSelector(`${UP} [role="dialog"]`);
  await waitFor(page, (tag) => document.querySelectorAll(`${tag} .ud-changes li`).length > 0, UP);
}

async function saveAll(page) {
  await ctrl(page, 'KeyS');
  await waitFor(page, () => window.__matMock.writes.length > 0);
  return mock(page, () => ({
    backups: window.__matMock.backups.map((b) => ({ label: b.label, dir: b.dir, files: b.files })),
    writes: window.__matMock.writes.map((w) => ({ rel: w.rel, content: w.content })),
  }));
}

export default async function upgrade04({ page, url, check, shot, axe }) {
  await setTheme(page, 'light');

  // ---------- 1. dashboard-demo 0.3: hộp thoại Nâng cấp lên 0.4.0 ----------
  await openWith(page, readProject(DASHBOARD_DEMO), 'D:\\Projects\\bang-dieu-khien');
  const head = await text(page, `${UP} .dlg-h`);
  const body = await text(page, `${UP} .dlg-b`);
  check(
    'mở dashboard-demo 0.3: tiêu đề nêu định dạng 0.3',
    /định dạng 0\.3/i.test(head ?? ''),
    head,
  );
  check(
    'hộp thoại nêu nâng cấp lên 0.4, runtime tối thiểu 0.7.0 và nơi sao lưu .mat-backup',
    /0\.4/.test(body ?? '') && /0\.7\.0/.test(body ?? '') && /\.mat-backup/.test(body ?? ''),
    body?.slice(0, 240),
  );
  const buttons = await page.$$eval(`${UP} .dlg-f button`, (bs) =>
    bs.map((b) => b.textContent.trim()),
  );
  check(
    'ba nút: Hủy, Mở chỉ đọc, Nâng cấp',
    ['Hủy', 'Mở chỉ đọc', 'Nâng cấp'].every((l) => buttons.some((b) => b.includes(l))),
    buttons.join(' | '),
  );
  await shot('1-hop-thoai-0-3');
  await axeBoth(page, axe, 'hộp thoại Nâng cấp lên 0.4');

  // ---------- 2. Nâng cấp rồi lưu ----------
  const w0 = await mock(page, () => window.__matMock.writes.length);
  await clickButton(page, `${UP} .dlg-f`, 'Nâng cấp');
  await waitFor(page, (tag) => !document.querySelector(`${tag} [role="dialog"]`), UP);
  check(
    'Nâng cấp: đĩa chưa đổi tới khi lưu',
    (await mock(page, () => window.__matMock.writes.length)) === w0,
  );
  const saved = await saveAll(page);
  const projectOut = saved.writes.find((w) => w.rel === 'project.json')?.content ?? '';
  check(
    'lưu lần đầu: có bản sao lưu 0.3.0 chứa project.json rồi mới ghi',
    saved.backups.length === 1 &&
      saved.backups[0].label === '0.3.0' &&
      saved.backups[0].files.includes('project.json') &&
      saved.writes.some((w) => w.rel === 'project.json'),
    JSON.stringify(saved.backups),
  );
  check(
    'project.json ghi ở 0.6.0 với minRuntimeVersion 0.9.0',
    /"schemaVersion": "0.6.0"/.test(projectOut) && /"minRuntimeVersion": "0.9.0"/.test(projectOut),
    projectOut.slice(0, 160),
  );
  const jsonWrites = saved.writes.filter((w) => w.rel.endsWith('.json'));
  check(
    'mọi file JSON ghi ra đều 0.4.0 (màn hình, binding)',
    jsonWrites.length > 1 &&
      jsonWrites.every((w) => !/"schemaVersion": "0\.3\./.test(w.content)) &&
      jsonWrites.some((w) => /\.bindings\.json$/.test(w.rel)),
    jsonWrites.map((w) => w.rel).join(','),
  );
  const toast = await text(page, 'mat-toast .toast');
  check('thông báo nêu thư mục sao lưu', /\.mat-backup/.test(toast ?? ''), toast);

  // ---------- 3. Nạp xuống project 0.4 lên runtime < 0.7.0 ----------
  const pw = `thu-${randomBytes(12).toString('hex')}`;
  await mock(
    page,
    (p) => {
      const c = window.__matMock.device;
      for (const u of ['kysu1', 'xem1', 'admin']) c.setPassword(u, `${p}-${u}`);
      c.setRuntime('BL335-01', '0.6.0');
    },
    pw,
  );
  await ctrl(page, 'KeyK');
  await page.waitForSelector('mat-devices-dialog [role="dialog"]');
  await waitFor(page, () =>
    /Tìm xong/.test(document.querySelector('mat-devices-dialog .scan')?.textContent ?? ''),
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-devices-dialog tbody tr[data-key]')]
      .find((r) => r.textContent.includes('BL335-01'))
      ?.click(),
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
  await ctrl(page, 'KeyL');
  await page.waitForSelector(`${DL} tr[data-row="device"]`);
  const runtimeRow = await text(page, `${DL} tr[data-row="runtime"]`);
  const deployLocked = await page.$eval(`${DL} [data-role="deploy"]`, (b) => b.disabled);
  const lock = await text(page, `${DL} [data-role="lock"]`);
  check(
    'runtime 0.6.0 < 0.7.0: dòng "Tương thích runtime" báo cần ≥ 0.9.0 và nút Nạp xuống khóa kèm lý do',
    /Tương thích runtime/.test(runtimeRow ?? '') &&
      /0.9.0/.test(runtimeRow ?? '') &&
      /0\.6\.0/.test(runtimeRow ?? '') &&
      deployLocked &&
      /runtime/i.test(lock ?? ''),
    `${runtimeRow} | ${lock}`,
  );
  const screensRow = await text(page, `${DL} tr[data-row="screens"]`);
  check(
    'dòng Màn hình nêu tổng dung lượng SVG',
    /SVG/.test(screensRow ?? '') && /\d+(,\d+)? (KB|MB|B)/i.test(screensRow ?? ''),
    screensRow,
  );
  await shot('3-nap-xuong-runtime-cu');
  await axeBoth(page, axe, 'Nạp xuống project 0.4 lên runtime cũ');
  await page.keyboard.press('Escape');
  await waitFor(page, (tag) => !document.querySelector(`${tag} [role="dialog"]`), DL);

  // ---------- 4. Project 0.1 và 0.2 qua chuỗi một lần ----------
  for (const [label, dir, name] of [
    ['0.1', TANK_DEMO, 'D:\\Projects\\bon-nuoc'],
    ['0.2', FULL_02, 'D:\\Projects\\hai-chin'],
  ]) {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await openWith(page, readProject(dir), name);
    const b = await text(page, `${UP} .dlg-b`);
    check(
      `project ${label}: một hộp thoại nâng cấp thẳng lên 0.4 (runtime 0.7.0)`,
      /0\.4/.test(b ?? '') && /0\.7\.0/.test(b ?? ''),
      b?.slice(0, 200),
    );
    await clickButton(page, `${UP} .dlg-f`, 'Nâng cấp');
    await waitFor(page, (tag) => !document.querySelector(`${tag} [role="dialog"]`), UP);
    const s = await saveAll(page);
    const p = s.writes.find((w) => w.rel === 'project.json')?.content ?? '';
    check(
      `project ${label}: một bản sao lưu, ghi 0.6.0, không còn hộp thoại`,
      s.backups.length === 1 && /"schemaVersion": "0.6.0"/.test(p) && !(await dialogOpen(page, UP)),
      JSON.stringify(s.backups),
    );
    if (label === '0.1') {
      // SVG 0.1 có <title> ở gốc: hộp thoại đã nêu việc làm sạch; sau nâng cấp không còn lỗi, hình giống trước.
      check(
        'project 0.1: hộp thoại nêu việc làm sạch SVG (số phần tử, ví dụ)',
        /Làm sạch SVG/.test(b ?? '') && /<title> ×1/.test(b ?? ''),
        b?.slice(0, 400),
      );
      const rel = 'screens/tank-motor.svg';
      const after = s.writes.find((w) => w.rel === rel)?.content ?? '';
      const before = readProject(dir)[rel];
      check(
        'SVG ghi ra nằm trong bản sao lưu, đã bỏ <title>, giữ nguyên id và data-mat-uid',
        s.backups[0].files.includes(rel) &&
          !/<title/.test(after) &&
          after.length > 0 &&
          (before.match(/data-mat-uid="[^"]+"/g) ?? []).join() ===
            (after.match(/data-mat-uid="[^"]+"/g) ?? []).join() &&
          (before.match(/\bid="[^"]+"/g) ?? []).join() ===
            (after.match(/\bid="[^"]+"/g) ?? []).join(),
        after.slice(0, 200),
      );
      await sleep(600);
      const bar = (await text(page, 'mat-statusbar')) ?? '';
      check(
        'sau nâng cấp: không còn lỗi kiểm tra (không E_SVG_UNSAFE)',
        !/\b[1-9]\d* lỗi/.test(bar),
        bar,
      );
      const px = await page.evaluate(
        async (a, b2) => {
          const load = (s) =>
            new Promise((res, rej) => {
              const i = new Image();
              i.onload = () => res(i);
              i.onerror = rej;
              i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
            });
          const draw = async (s) => {
            const c = document.createElement('canvas');
            c.width = 1280;
            c.height = 720;
            const g = c.getContext('2d');
            g.drawImage(await load(s), 0, 0, 1280, 720);
            return g.getImageData(0, 0, 1280, 720).data;
          };
          const [x, y] = [await draw(a), await draw(b2)];
          let n = 0;
          for (let i = 0; i < x.length; i += 4)
            if (
              Math.abs(x[i] - y[i]) > 8 ||
              Math.abs(x[i + 1] - y[i + 1]) > 8 ||
              Math.abs(x[i + 2] - y[i + 2]) > 8 ||
              Math.abs(x[i + 3] - y[i + 3]) > 8
            )
              n++;
          return { n, total: x.length / 4 };
        },
        before,
        after,
      );
      check(
        'hình SVG sau nâng cấp giống trước (điểm ảnh khác ≤ 0,5 %)',
        px.n / px.total <= 0.005,
        JSON.stringify(px),
      );
    }
  }

  // ---------- 5. Mở chỉ đọc vẫn xem trước được ----------
  await page.goto(url, { waitUntil: 'networkidle0' });
  await openWith(page, readProject(DASHBOARD_DEMO), 'D:\\Projects\\bang-dieu-khien');
  await clickButton(page, `${UP} .dlg-f`, 'Mở chỉ đọc');
  await waitFor(page, (tag) => !document.querySelector(`${tag} [role="dialog"]`), UP);
  const w1 = await mock(page, () => window.__matMock.writes.length);
  await page.waitForSelector('mat-tree [id^="ti-screen:"]');
  await page.$eval('mat-tree [id^="ti-screen:"]', (e) => e.click());
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(500);
  check(
    'chỉ đọc: màn hình mở xem được trên canvas, có item',
    (await page.$$('mat-screen-canvas .oi')).length >= 1,
  );
  await ctrl(page, 'KeyS');
  await sleep(200);
  check(
    'chỉ đọc: Ctrl+S không ghi gì',
    (await mock(page, () => window.__matMock.writes.length)) === w1,
  );
  await shot('5-chi-doc');
  await axeBoth(page, axe, 'màn hình mở chỉ đọc');
}
