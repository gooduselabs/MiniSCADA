// E2E theo dõi thiết bị (feature 004, T069, US3, quickstart §4 bước 12–16) với runtime giả
// (fake-runtime.mjs: system/info + WebSocket live 1.0.0, Tag lạ, delta, chế độ đầy 4429, chế độ treo):
// - xem trước Mô phỏng khi không có thiết bị; phóng to, vừa khung; nhấp phần tử → binding chỉ đọc;
// - thiết bị không trả lời: báo trong ≤ 3 s (trang Thiết bị: Kiểm tra kết nối, Kết nối theo dõi);
// - kiểm kết nối đúng địa chỉ; gõ https:// thì báo ngay tại ô, gợi ý Online;
// - feature 005 (T085a, FR-031, FR-035): Ctrl+K khi project chưa gắn thiết bị mở Thiết bị trong mạng; chọn thiết
//   bị đã lưu trỏ tới runtime giả rồi Online → gắn với project; runtime giả là 0.3.0 nên rơi về theo dõi chỉ đọc
//   kèm "runtime cần cập nhật để nạp xuống"; lần Ctrl+K sau chạy thẳng luồng Online, không mở hộp thoại;
// - đang theo dõi: viền cam, thanh trạng thái, cột giá trị sống ngay sau cột tên, "không có trên thiết bị";
//   xem trước bằng dữ liệu thiết bị; Chẩn đoán; task card Công cụ online;
// - runtime giả tắt → mất kết nối (giá trị không còn tốt, xem trước về Mô phỏng) rồi tự có lại;
// - thiết bị đầy → báo, đếm ngược, "Thử lại ngay";
// - Ctrl+M → runtime giả thấy socket đóng trong ≤ 2 s; chỉ một WebSocket mở suốt kịch bản;
// - axe-core ở trang Thiết bị và tab Chẩn đoán, theme sáng và tối;
// - T085b: thiết bị runtime cũ có cổng HTTP khác 8080 (port-forward): Thêm theo địa chỉ `host:<cổng HTTP của runtime
//   giả>` rồi Ctrl+K → cổng đó thành cổng HTTP của thiết bị, theo dõi chỉ đọc kèm runtime-old; phần Nâng cao (cổng
//   HTTP) của Thêm theo địa chỉ qua axe-core.
import { startFakeRuntime } from './fake-runtime.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** In số đo ra log (thời gian báo lỗi, kết nối lại, trả phiên) để ghi vào báo cáo. */
const note = (label, value) => console.log(`    · đo: ${label}: ${value}`);
const text = (page, sel) =>
  page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');

async function ctrl(page, key) {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
}

async function clickTreeItem(page, label) {
  const ok = await page.evaluate((l) => {
    const item = [...document.querySelectorAll('mat-tree [role="treeitem"]')].find(
      (e) => e.querySelector('.lbl')?.textContent.trim() === l,
    );
    item?.click();
    return Boolean(item);
  }, label);
  if (!ok) throw new Error(`không thấy mục cây "${label}"`);
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

/** Chờ chữ trong `sel` khớp `re`; trả thời gian chờ (ms) hoặc -1 nếu quá hạn. */
async function waitText(page, sel, re, timeout = 5000) {
  const t0 = Date.now();
  try {
    await page.waitForFunction(
      (s, src, flags) =>
        new RegExp(src, flags).test(
          (document.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' '),
        ),
      { timeout, polling: 50 },
      sel,
      re.source,
      re.flags,
    );
    return Date.now() - t0;
  } catch {
    return -1;
  }
}

const svgText = (page, uid) =>
  page.evaluate(
    (u) =>
      document
        .querySelector('mat-screen-preview .svg-host')
        ?.shadowRoot?.querySelector(`[data-mat-uid="${u}"]`)?.textContent ?? null,
    uid,
  );

/** Nhấp chuột thật vào giữa một phần tử SVG (trong shadow root của màn hình). */
async function clickSvg(page, uid) {
  const box = await page.evaluate((u) => {
    const el = document
      .querySelector('mat-screen-preview .svg-host')
      ?.shadowRoot?.querySelector(`[data-mat-uid="${u}"]`);
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, uid);
  if (!box) throw new Error(`không thấy phần tử ${uid}`);
  await page.mouse.click(box.x, box.y);
}

/** Đặt theme bằng nút trên thanh trạng thái (vòng hệ thống → sáng → tối). */
async function setTheme(page, theme) {
  for (let i = 0; i < 3; i++) {
    const cur = await page.evaluate(() => document.documentElement.dataset.theme ?? 'system');
    if (cur === theme) return;
    await page.evaluate(() =>
      [...document.querySelectorAll('mat-statusbar button')]
        .find((b) => /Theo hệ thống|Sáng|Tối/.test(b.textContent))
        ?.click(),
    );
  }
}

/** Chọn dòng có chữ `needle` trong hộp thoại Thiết bị trong mạng. */
async function selectRow(page, needle) {
  const ok = await page.evaluate((n) => {
    const row = [...document.querySelectorAll('mat-devices-dialog tbody tr[data-key]')].find((r) =>
      r.textContent.includes(n),
    );
    row?.click();
    return Boolean(row);
  }, needle);
  if (!ok) throw new Error(`không thấy dòng "${needle}"`);
}

/** Mở Online › Thiết bị trong mạng… bằng menu (project đã gắn thiết bị thì Ctrl+K là Online). */
async function openDevicesMenu(page) {
  await page.click('mat-menubar .menubar-btn:nth-child(4)');
  await page.waitForSelector('.menu-pop [role="menuitem"]');
  await page.evaluate(() =>
    [...document.querySelectorAll('.menu-pop [role="menuitem"]')]
      .find((e) => e.textContent.includes('Thiết bị trong mạng'))
      ?.click(),
  );
  await page.waitForSelector('mat-devices-dialog [role="dialog"]', { timeout: 3000 });
}

/** Số lần gọi lệnh Rust `cmd` của DeviceLink giả. */
const calls = (page, cmd) =>
  page.evaluate((c) => window.__matMock.device.calls.filter((x) => x.cmd === c).length, cmd);

async function typeAddress(page, value) {
  const sel = 'mat-device-page input[name="device-address"]';
  await page.click(sel);
  // Chọn hết chữ đang có rồi xóa: `clickCount: 3` của Puppeteer bản này không chọn chữ (T085a gõ đè lên ô
  // đã có địa chỉ).
  await page.$eval(sel, (input) => input.select());
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value);
}

async function setMode(page, mode) {
  await page.click(`mat-screen-preview .seg [data-mode="${mode}"]`);
  await page.waitForFunction(
    (m) =>
      document
        .querySelector(`mat-screen-preview .seg [data-mode="${m}"]`)
        ?.getAttribute('aria-pressed') === 'true',
    { timeout: 3000 },
    mode,
  );
}

const pressed = (page, mode) =>
  page.$eval(`mat-screen-preview .seg [data-mode="${mode}"]`, (b) =>
    b.getAttribute('aria-pressed'),
  );

/** Chữ của ô "Giá trị sống" ở dòng có Tag `id` trong Bảng Tag. */
const liveCell = (page, id) =>
  page.evaluate((tag) => {
    const head = [...document.querySelectorAll('mat-tag-grid thead th')];
    const col = head.findIndex((th) => th.classList.contains('tg-live'));
    const row = [...document.querySelectorAll('mat-tag-grid tbody tr')].find((tr) =>
      [...tr.cells].some((td) => td.textContent.trim() === tag),
    );
    return col < 0 || !row ? null : row.cells[col]?.textContent.replace(/\s+/g, ' ').trim();
  }, id);

async function inspectorTab(page, id) {
  await page.click(`mat-inspector #insp-tab-${id}`);
  await page.waitForSelector(`mat-inspector #insp-tab-${id}[aria-selected="true"]`);
}

/** Thẻ số liệu của Chẩn đoán theo nhãn. */
const metric = (page, label) =>
  page.evaluate((l) => {
    const card = [...document.querySelectorAll('mat-inspector .metric')].find(
      (m) => m.querySelector('.l')?.textContent.trim() === l,
    );
    return card ? card.textContent.replace(/\s+/g, ' ').trim() : '';
  }, label);

export default async function monitor(ctx) {
  const rt = await startFakeRuntime();
  // Các kịch bản dùng chung localStorage của trình duyệt: trả theme như lúc đầu cho kịch bản sau.
  await ctx.page.waitForSelector('mat-statusbar');
  // DeviceLink giả chỉ gọi ra mạng thật cho địa chỉ đã khai (runtime giả); địa chỉ khác coi như không có gì nghe.
  await ctx.page.evaluate((a) => window.__matMock.device.realRuntime(a), rt.address);
  const theme = await ctx.page.evaluate(() => document.documentElement.dataset.theme ?? 'system');
  try {
    await scenario(ctx, rt);
  } finally {
    await rt.close();
    await setTheme(ctx.page, theme).catch(() => undefined);
  }
}

async function scenario({ page, check, shot, axe }, rt) {
  await page.waitForSelector('mat-start-page .start-hero');
  await setTheme(page, 'light');
  await page.click('mat-start-page .start-hero .btn.primary');
  await page.waitForSelector('mat-tree [role="treeitem"]');

  // 1. Xem trước Mô phỏng khi không có thiết bị (US3-1, bước 12)
  await clickTreeItem(page, 'Bồn nước + bơm');
  await page.waitForFunction(
    () => document.querySelector('mat-screen-preview .svg-host')?.shadowRoot?.querySelector('svg'),
    { timeout: 5000 },
  );
  check('xem trước mặc định là Mô phỏng', (await pressed(page, 'sim')) === 'true');
  await page
    .waitForFunction(
      () =>
        /%$/.test(
          document
            .querySelector('mat-screen-preview .svg-host')
            ?.shadowRoot?.querySelector('[data-mat-uid="el_txt_level"]')?.textContent ?? '',
        ),
      { timeout: 3000 },
    )
    .catch(() => undefined);
  const lv1 = await svgText(page, 'el_txt_level');
  await sleep(1500);
  const lv2 = await svgText(page, 'el_txt_level');
  check(
    'Mô phỏng: chữ mức có giá trị tự sinh, đổi theo thời gian',
    /^\d+\.\d %$/.test(lv1 ?? '') && /^\d+\.\d %$/.test(lv2 ?? '') && lv1 !== lv2,
    `${lv1} → ${lv2}`,
  );
  const devLocked = await page.$eval('mat-screen-preview .seg [data-mode="device"]', (b) => ({
    disabled: b.getAttribute('aria-disabled'),
    title: b.title,
  }));
  check(
    '"Thiết bị" khóa khi chưa theo dõi, kèm lý do',
    devLocked.disabled === 'true' && /Cần kết nối theo dõi/.test(devLocked.title),
    JSON.stringify(devLocked),
  );
  const zoom = () => text(page, 'mat-screen-preview .sp-zoom');
  const fitZoom = await zoom();
  await page.click('mat-screen-preview [data-act="zoom-in"]');
  const bigger = await zoom();
  await page.click('mat-screen-preview [data-act="fit"]');
  const refit = await zoom();
  const boardW = await page.$eval(
    'mat-screen-preview .board',
    (b) => b.getBoundingClientRect().width,
  );
  check(
    'phóng to rồi vừa khung (cả màn hình nằm trong vùng vẽ)',
    parseInt(bigger) > parseInt(fitZoom) &&
      refit === fitZoom &&
      Math.abs(boardW - (1280 * parseInt(refit)) / 100) < 1280 * 0.01,
    `${fitZoom} → ${bigger} → ${refit}, board ${Math.round(boardW)} px`,
  );
  await clickSvg(page, 'el_motor_lamp');
  await page.waitForFunction(
    () =>
      document.querySelector('mat-inspector .insp-ctx')?.textContent ===
      'Đèn trạng thái · el_motor_lamp',
    { timeout: 3000 },
  );
  const insp = await text(page, 'mat-inspector .insp-body');
  check(
    'nhấp phần tử: inspector hiện binding chỉ đọc (Màu nền ← MOTOR01.RUN, GĐ 3b)',
    /Màu nền/.test(insp) && /MOTOR01\.RUN/.test(insp) && /Sửa bằng giao diện: GĐ 3b/.test(insp),
    insp.slice(0, 200),
  );
  const selName = await page.$eval('mat-screen-preview .selbox', (b) =>
    b.hidden ? null : b.textContent.trim(),
  );
  check('phần tử chọn được tô trên màn hình', selName === 'Đèn trạng thái', String(selName));
  await shot('1-xem-truoc-mo-phong');
  await axe('xem trước màn hình, Mô phỏng');

  // 2. Thiết bị không trả lời: báo trong ≤ 3 s, giao diện không treo (US3-2, bước 13)
  await page.click('mat-statusbar button.sb');
  await page.waitForSelector('mat-device-page input[name="device-address"]');
  rt.setHang(true);
  await typeAddress(page, rt.address);
  let t0 = Date.now();
  await clickButton(page, 'mat-device-page', 'Kiểm tra kết nối');
  let dt = await waitText(page, 'mat-device-page', /Không kết nối được/, 6000);
  let ms = Date.now() - t0;
  const failText = await text(page, 'mat-device-page .dp-result');
  note('Kiểm tra kết nối, thiết bị không trả lời → báo lỗi', `${ms} ms`);
  check(
    'Kiểm tra kết nối, thiết bị không trả lời: báo trong ≤ 3 s, nói lý do',
    dt >= 0 && ms <= 3600 && /không trả lời trong 3 s/.test(failText),
    `${ms} ms: ${failText}`,
  );
  // Feature 005 (T085a): Ctrl+K là Online theo thiết bị gắn với project; theo dõi theo địa chỉ (004) là nút
  // "Kết nối theo dõi" của trang Thiết bị.
  t0 = Date.now();
  await clickButton(page, 'mat-device-page', 'Kết nối theo dõi');
  dt = await waitText(page, 'mat-statusbar', /Không kết nối được/, 6000);
  ms = Date.now() - t0;
  note('Kết nối theo dõi, thiết bị không trả lời → thanh trạng thái báo lỗi', `${ms} ms`);
  check(
    'Kết nối theo dõi (trang Thiết bị), thiết bị không trả lời: thanh trạng thái báo trong ≤ 3 s',
    dt >= 0 && ms <= 3600,
    `${ms} ms: ${await text(page, 'mat-statusbar')}`,
  );
  rt.setHang(false);

  // 3. Kiểm kết nối đúng địa chỉ: không chiếm phiên
  await clickButton(page, 'mat-device-page', 'Kiểm tra kết nối');
  await waitText(page, 'mat-device-page', /Kết nối được/, 4000);
  const ok = await text(page, 'mat-device-page');
  check(
    'Kiểm tra kết nối: runtime, giao thức, phiên/tối đa, project, lưu trữ',
    /0\.3\.0/.test(ok) &&
      /1\.0\.0/.test(ok) &&
      /\d+ \/ 10/.test(ok) &&
      /tank-demo 0\.1\.0, cùng phiên bản với máy này/.test(ok) &&
      /đang ghi · 15\.234 dòng · 12,0 MB \/ 2,0 GB/.test(ok) &&
      /kho-du-lieu: đang gửi/.test(ok),
    ok.slice(0, 400),
  );
  check('kiểm tra kết nối không chiếm phiên của thiết bị', rt.openCount() === 0, rt.openCount());
  await shot('2-thiet-bi');
  await axe('trang Thiết bị, theme sáng');
  await setTheme(page, 'dark');
  await axe('trang Thiết bị, theme tối');
  await setTheme(page, 'light');

  // 3b. Gõ https:// ở ô địa chỉ: báo ngay tại ô, gợi ý Online; không bỏ scheme rồi gọi HTTP (T085a)
  const monitorCalls = await calls(page, 'monitor_get');
  await typeAddress(page, `https://${rt.address}`);
  await clickButton(page, 'mat-device-page', 'Kiểm tra kết nối');
  await sleep(300);
  const httpsField = await page.evaluate(() => {
    const input = document.querySelector('mat-device-page input[name="device-address"]');
    const err = document.getElementById(input.getAttribute('aria-describedby'));
    return {
      value: input.value,
      invalid: input.getAttribute('aria-invalid'),
      text: (err?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    };
  });
  check(
    'gõ https:// ở trang Thiết bị: báo ngay tại ô, gợi ý Online (Ctrl+K) và Thiết bị trong mạng; không gọi thiết bị',
    httpsField.invalid === 'true' &&
      /Online \(Ctrl\+K\)/.test(httpsField.text) &&
      /Thiết bị trong mạng/.test(httpsField.text) &&
      (await calls(page, 'monitor_get')) === monitorCalls,
    JSON.stringify(httpsField),
  );
  await axe('trang Thiết bị, ô địa chỉ báo https://');
  await typeAddress(page, rt.address);

  // 4. Ctrl+K (feature 005, T085a, FR-031): project chưa gắn thiết bị → Thiết bị trong mạng. Thiết bị đã lưu
  //    (devices.json có sẵn) trỏ tới runtime giả ở cổng HTTP của nó; chọn rồi Online → gắn với project. Runtime
  //    giả là 0.3.0: HTTPS không trả lời, HTTP là runtime cũ → theo dõi chỉ đọc kèm runtime-old (FR-035).
  //    Viền cam, thanh trạng thái (US3-3, bước 14).
  await page.evaluate(
    (port) =>
      window.__matMock.device.addSaved({ host: '127.0.0.1', httpPort: port, name: 'BL335-LAB' }),
    rt.port,
  );
  await ctrl(page, 'KeyK');
  const dialog = await page
    .waitForSelector('mat-devices-dialog [role="dialog"]', { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  check(
    'Ctrl+K khi project chưa gắn thiết bị: mở Thiết bị trong mạng, chưa kết nối',
    dialog && rt.openCount() === 0 && (await calls(page, 'device_probe')) === 0,
    `hộp thoại ${dialog}, phiên ${rt.openCount()}`,
  );
  await waitText(page, 'mat-devices-dialog .scan', /Tìm xong/, 6000);
  await selectRow(page, 'BL335-LAB');
  await waitText(page, 'mat-devices-dialog tbody', /BL335-LAB.*0\.3\.0/, 3000);
  await shot('2b-thiet-bi-trong-mang');
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Online');
  dt = await waitText(page, 'mat-statusbar', /Đang theo dõi/, 5000);
  const online = await page.$('.win.online');
  const sb = await text(page, 'mat-statusbar');
  check(
    'Online thiết bị chạy runtime giả 0.3.0: theo dõi chỉ đọc (viền cam), báo "runtime cần cập nhật để nạp xuống"',
    dt >= 0 &&
      online !== null &&
      /runtime cần cập nhật để nạp xuống/.test(sb) &&
      /chỉ theo dõi chỉ đọc/.test(await text(page, 'mat-toast')),
    sb,
  );
  const binding = await page.evaluate(() => ({
    stored: localStorage.getItem('mat-studio.projectDevices') ?? '',
    id: window.__matMock.device.saved().find((d) => d.name === 'BL335-LAB')?.id ?? null,
    writes: window.__matMock.writes.length,
    page: (document.querySelector('mat-device-page .dp-bound')?.textContent ?? '').replace(
      /\s+/g,
      ' ',
    ),
  }));
  check(
    'chọn thiết bị trong hộp thoại: gắn với project (thiết lập cục bộ theo thư mục project, không ghi file project); trang Thiết bị hiện thiết bị đang gắn',
    binding.id !== null &&
      binding.stored.includes(binding.id) &&
      /tank-demo/.test(binding.stored) &&
      binding.writes === 0 &&
      /BL335-LAB/.test(binding.page) &&
      /Đổi thiết bị/.test(binding.page),
    JSON.stringify(binding),
  );
  check(
    'thanh trạng thái: tên, địa chỉ, phiên bản runtime, project trên thiết bị',
    /BL335/.test(sb) &&
      sb.includes(rt.address) &&
      /runtime 0\.3\.0/.test(sb) &&
      /tank-demo 0\.1\.0, cùng phiên bản với máy này/.test(sb),
    sb,
  );
  check('theo dõi chiếm đúng một phiên', rt.openCount() === 1, rt.openCount());

  // 5. Bảng Tag: cột giá trị sống ngay sau cột tên; Tag thiết bị không có (US3-3, US3-4)
  await clickTreeItem(page, 'Bảng Tag mặc định');
  await page.waitForSelector('mat-tag-grid thead th', { timeout: 5000 });
  const heads = await page.$$eval('mat-tag-grid thead th', (ths) =>
    ths.map((th) => th.textContent.trim()),
  );
  check(
    'Bảng Tag: cột giá trị sống và quality ngay sau cột tên',
    heads[1] === 'Tên' && heads[2] === 'Giá trị sống' && heads[3] === 'Quality',
    heads.join(' | '),
  );
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('mat-tag-grid tbody tr')].some((tr) =>
          /4[23]/.test(tr.textContent),
        ),
      { timeout: 3000 },
    )
    .catch(() => undefined);
  const levelCell = await liveCell(page, 'TANK01.LEVEL');
  const tempCell = await liveCell(page, 'TANK01.TEMP');
  check(
    'Bảng Tag: giá trị sống của Tag thiết bị có',
    /4[23]/.test(levelCell ?? ''),
    String(levelCell),
  );
  check(
    'Bảng Tag: Tag thiết bị không có ghi "không có trên thiết bị"',
    tempCell === 'không có trên thiết bị',
    String(tempCell),
  );
  await shot('3-bang-tag-song');

  // 6. Xem trước bằng dữ liệu thiết bị, chung một phiên (FR-030, FR-032)
  await clickTreeItem(page, 'Bồn nước + bơm');
  await page.waitForSelector('mat-screen-preview .seg [data-mode="device"]:not([aria-disabled])');
  await setMode(page, 'device');
  // Đổi chế độ thì dựng lại bản vẽ gốc ("--") rồi áp giá trị ở khung hình kế tiếp.
  const seen = new Set();
  const until = Date.now() + 4000;
  while (Date.now() < until && !(seen.has('42.0 %') && seen.has('43.0 %'))) {
    const v = await svgText(page, 'el_txt_level');
    if (v && v !== '--') seen.add(v);
    await sleep(100);
  }
  check(
    'xem trước chế độ Thiết bị: giá trị và delta của thiết bị (42.0 % ↔ 43.0 %)',
    [...seen].every((v) => v === '42.0 %' || v === '43.0 %') && seen.size === 2,
    [...seen].join(', '),
  );
  check(
    'chỉ một WebSocket mở dù Bảng Tag và xem trước cùng dùng dữ liệu sống',
    rt.openCount() === 1 && rt.maxConcurrent === 1,
    `mở ${rt.openCount()}, tối đa ${rt.maxConcurrent}`,
  );
  await clickSvg(page, 'el_txt_temp');
  dt = await waitText(page, 'mat-inspector .insp-body', /không có trên thiết bị/, 3000);
  check(
    'inspector phần tử: Tag thiết bị không có ghi "không có trên thiết bị"',
    dt >= 0,
    await text(page, 'mat-inspector .insp-body'),
  );
  await inspectorTab(page, 'diag');
  // system/info đầu tiên được hỏi cùng lúc mở WebSocket nên có thể chưa tính phiên của Studio; lần hỏi
  // lại sau ≤ 5 s (FR-029) thì có.
  dt = await waitText(page, 'mat-inspector .insp-body', /Phiên dữ liệu sống 1 \/ 10/, 7000);
  note('Chẩn đoán: chờ lần hỏi system/info kế tiếp', `${dt} ms`);
  check('Chẩn đoán tự làm mới theo system/info (≤ 5 s)', dt >= 0, `${dt} ms`);
  const runtime = await metric(page, 'Runtime');
  const sessions = await metric(page, 'Phiên dữ liệu sống');
  const storage = await metric(page, 'Lưu trữ trên thiết bị');
  const dest = await metric(page, 'DB ngoài kho-du-lieu');
  const cpu = await metric(page, 'CPU');
  check(
    'Chẩn đoán: runtime, giao thức, phiên/tối đa, lưu trữ, DB ngoài; CPU "chưa có"',
    /0\.3\.0/.test(runtime) &&
      /giao thức 1\.0\.0/.test(runtime) &&
      /1 \/ 10/.test(sessions) &&
      /đang ghi/.test(storage) &&
      /15\.234 dòng/.test(storage) &&
      /đang gửi/.test(dest) &&
      /chờ 0 dòng · trễ 0,4 s/.test(dest) &&
      /chưa có/.test(cpu),
    [runtime, sessions, storage, dest, cpu].join(' | '),
  );
  await shot('4-chan-doan');
  await axe('tab Chẩn đoán, đang theo dõi, theme sáng');
  await setTheme(page, 'dark');
  await axe('tab Chẩn đoán, đang theo dõi, theme tối');
  await shot('4b-chan-doan-toi');
  await setTheme(page, 'light');
  const card = await page.$eval('mat-taskcards [data-tc="online"]', (b) =>
    b.getAttribute('aria-selected'),
  );
  if (card !== 'true') await page.click('mat-taskcards [data-tc="online"]');
  await page.waitForSelector('mat-taskcards .tc-body .mini');
  const tc = await text(page, 'mat-taskcards .tc-body');
  check(
    'task card Công cụ online: runtime, client x/10, project; ghi xuống khóa (feature 005)',
    /0\.3\.0/.test(tc) &&
      /1 \/ 10/.test(tc) &&
      /tank-demo 0\.1\.0/.test(tc) &&
      /Ghi giá trị xuống thiết bị/.test(tc),
    tc.slice(0, 300),
  );

  // 7. Runtime giả tắt → mất kết nối rồi tự có lại (US3-5, bước 15)
  await rt.stop();
  dt = await waitText(page, 'mat-statusbar', /Mất kết nối/, 5000);
  const lost = await page.$('.win.online.lost');
  check(
    'runtime tắt: mất kết nối (viền cam nét đứt, thanh trạng thái)',
    dt >= 0 && lost !== null,
    await text(page, 'mat-statusbar'),
  );
  await sleep(150);
  check(
    'mất phiên: xem trước về Mô phỏng và báo',
    (await pressed(page, 'sim')) === 'true' &&
      /Mất phiên theo dõi thiết bị/.test(await text(page, 'mat-toast')),
    await text(page, 'mat-toast'),
  );
  // Bật lại trước lần thử lại đầu tiên của live-client (backoff 0,5–1 s): không có lần kết nối hỏng.
  await sleep(250);
  await rt.start();
  await clickTreeItem(page, 'Bảng Tag mặc định');
  await page.waitForSelector('mat-tag-grid tbody tr');
  dt = await waitText(page, 'mat-statusbar', /Đang theo dõi/, 15000);
  note('runtime bật lại → Studio theo dõi lại', `${dt} ms`);
  check('runtime bật lại: Studio tự kết nối lại', dt >= 0, `${dt} ms`);
  await page
    .waitForFunction(() => !document.querySelector('mat-tag-grid .tg-stale'), { timeout: 3000 })
    .catch(() => undefined);
  check(
    'có lại: giá trị sống tốt trở lại',
    /4[23]/.test((await liveCell(page, 'TANK01.LEVEL')) ?? '') &&
      (await page.$('mat-tag-grid .tg-stale')) === null,
    String(await liveCell(page, 'TANK01.LEVEL')),
  );

  // 8. Thiết bị đầy: báo, đếm ngược, thử lại (US3-6). Ctrl+K khi project đã gắn thiết bị (bước 4): chạy thẳng
  //    luồng Online (dò chứng chỉ, rơi về theo dõi chỉ đọc), không mở hộp thoại (T085a).
  await ctrl(page, 'KeyM');
  await waitText(page, 'mat-statusbar', /Không kết nối/, 3000);
  rt.setFull(true);
  const probes = await calls(page, 'device_probe');
  await ctrl(page, 'KeyK');
  dt = await waitText(page, 'mat-statusbar', /đã đủ số phiên, tự thử lại sau \d+ s/, 5000);
  check(
    'Ctrl+K khi project đã gắn thiết bị: chạy luồng Online (dò chứng chỉ, rơi về theo dõi chỉ đọc), không mở hộp thoại',
    (await calls(page, 'device_probe')) === probes + 1 &&
      (await page.$('mat-devices-dialog [role="dialog"]')) === null,
    `dò ${probes} → ${await calls(page, 'device_probe')}`,
  );
  const n1 = Number(/sau (\d+) s/.exec(await text(page, 'mat-statusbar'))?.[1]);
  await sleep(1300);
  const n2 = Number(/sau (\d+) s/.exec(await text(page, 'mat-statusbar'))?.[1]);
  check(
    'thiết bị đầy: báo và đếm ngược tới lần tự thử lại (30 s)',
    dt >= 0 && n1 <= 30 && n2 < n1,
    `${n1} → ${n2}`,
  );
  await shot('5-thiet-bi-day');
  rt.setFull(false);
  await clickButton(page, 'mat-statusbar', 'Thử lại ngay');
  dt = await waitText(page, 'mat-statusbar', /Đang theo dõi/, 5000);
  check(
    '"Thử lại ngay" khi thiết bị hết đầy: theo dõi lại',
    dt >= 0,
    await text(page, 'mat-statusbar'),
  );

  // 9. Ctrl+M: thiết bị nhận lại phiên trong ≤ 2 s (US3-7, SC-007)
  const before = rt.log.length;
  t0 = Date.now();
  await ctrl(page, 'KeyM');
  let closed = null;
  while (!closed && Date.now() - t0 < 3000) {
    closed = rt.log.slice(before).find((e) => e.type === 'close') ?? null;
    if (!closed) await sleep(20);
  }
  note('Ctrl+M → runtime giả thấy socket đóng', closed ? `${closed.at - t0} ms` : 'không thấy');
  check(
    'Ctrl+M: runtime giả thấy socket đóng trong ≤ 2 s',
    closed !== null && closed.at - t0 <= 2000 && rt.openCount() === 0,
    closed ? `${closed.at - t0} ms, code ${closed.code}` : 'không thấy đóng',
  );
  await page
    .waitForFunction(() => !document.querySelector('.win.online'), { timeout: 3000 })
    .catch(() => undefined);
  check('ngắt: hết viền cam', (await page.$('.win.online')) === null);

  // 10. T085b: thiết bị runtime cũ có cổng HTTP khác 8080 (port-forward). Thêm theo địa chỉ `host:<cổng HTTP của
  //     runtime giả>`: cổng ghi vào chỗ cổng HTTPS, thiết bị gắn với project. Ctrl+K: dò thấy cổng trả lời HTTP thường
  //     (not-tls), runtime giả là 0.3.0 nên cổng đó thành cổng HTTP của thiết bị → theo dõi chỉ đọc kèm runtime-old.
  await openDevicesMenu(page);
  await waitText(page, 'mat-devices-dialog .scan', /Tìm xong/, 6000);
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Thêm theo địa chỉ');
  await page.waitForSelector('mat-devices-dialog input[name="addr"]');
  await page.type('mat-devices-dialog input[name="addr"]', rt.address);
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-devices-dialog form button')]
      .find((b) => b.textContent.includes('Nâng cao'))
      ?.click(),
  );
  await page
    .waitForSelector('mat-devices-dialog input[name="http-port"]', { timeout: 3000 })
    .catch(() => undefined);
  const adv = await page.evaluate(() => {
    const input = document.querySelector('mat-devices-dialog input[name="http-port"]');
    if (!input) return null;
    return {
      label: document.querySelector(`label[for="${input.id}"]`)?.textContent.trim(),
      placeholder: input.placeholder,
      expanded: [...document.querySelectorAll('mat-devices-dialog form button')]
        .find((b) => b.textContent.includes('Nâng cao'))
        ?.getAttribute('aria-expanded'),
    };
  });
  check(
    'Thêm theo địa chỉ › Nâng cao: ô Cổng HTTP (để trống là 8080), nút mở có aria-expanded',
    adv?.label === 'Cổng HTTP' && adv.placeholder === '8080' && adv.expanded === 'true',
    JSON.stringify(adv),
  );
  await shot('6-them-theo-dia-chi-nang-cao');
  await axe('Thêm theo địa chỉ › Nâng cao, theme sáng');
  await setTheme(page, 'dark');
  await axe('Thêm theo địa chỉ › Nâng cao, theme tối');
  await setTheme(page, 'light');
  await page.focus('mat-devices-dialog input[name="addr"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (a) =>
      [...document.querySelectorAll('mat-devices-dialog tbody tr[data-key]')].some((r) =>
        r.textContent.includes(a),
      ),
    { timeout: 4000 },
    rt.address,
  );
  const old = await page.evaluate((port) => {
    const d = window.__matMock.device.saved().find((x) => x.httpsPort === port);
    return {
      host: d?.host,
      httpPort: d?.httpPort,
      bound: (localStorage.getItem('mat-studio.projectDevices') ?? '').includes(d?.id ?? '-'),
    };
  }, rt.port);
  check(
    'Thêm theo địa chỉ host:<cổng HTTP của runtime giả>: vào danh sách đã lưu (cổng ghi vào chỗ cổng HTTPS), gắn với project',
    old.host === '127.0.0.1' && old.httpPort === 8080 && old.bound,
    JSON.stringify(old),
  );
  await page.keyboard.press('Escape');
  await page
    .waitForFunction(() => !document.querySelector('mat-devices-dialog [role="dialog"]'), {
      timeout: 3000,
    })
    .catch(() => undefined);
  const probes10 = await calls(page, 'device_probe');
  await ctrl(page, 'KeyK');
  dt = await waitText(
    page,
    'mat-statusbar',
    /Đang theo dõi.*runtime cần cập nhật để nạp xuống/,
    6000,
  );
  const adopted = await page.evaluate(
    (port) => window.__matMock.device.saved().find((x) => x.httpsPort === port)?.httpPort,
    rt.port,
  );
  const sb10 = await text(page, 'mat-statusbar');
  check(
    'Ctrl+K: cổng đã lưu trả lời HTTP thường, runtime giả 0.3.0 → cổng đó thành cổng HTTP của thiết bị; theo dõi chỉ đọc kèm "runtime cần cập nhật để nạp xuống"',
    dt >= 0 &&
      adopted === rt.port &&
      sb10.includes(rt.address) &&
      (await calls(page, 'device_probe')) === probes10 + 1 &&
      (await page.$('.win.online')) !== null &&
      (await page.$('mat-devices-dialog [role="dialog"]')) === null &&
      rt.openCount() === 1,
    `${adopted}: ${sb10}`,
  );
  await shot('7-runtime-cu-cong-http');
  await ctrl(page, 'KeyM');
  await page
    .waitForFunction(() => !document.querySelector('.win.online'), { timeout: 3000 })
    .catch(() => undefined);
  check('suốt kịch bản chỉ có một WebSocket mở cùng lúc', rt.maxConcurrent === 1, rt.maxConcurrent);
}
