// Hàm dùng chung của các kịch bản e2e feature 006 (tags, connections, grid-perf, upgrade, watch): nạp project vào lớp Tauri giả,
// chọn mục cây, đổi theme, axe ở hai theme, Online + đăng nhập qua thiết bị giả. File này không phải kịch bản (run.mjs chỉ chạy
// *.e2e.mjs).
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, '../../../..');
export const FULL_02 = resolve(REPO, 'tests/project-vectors/v02-valid-full');
export const TANK_DEMO = resolve(REPO, 'projects/tank-demo');
export const TAGS_2000 = resolve(REPO, 'tests/fixtures/studio/tags-2000-v02');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mọi file .json và .svg của một thư mục project, khóa theo đường dẫn tương đối dùng `/`. */
export function readProject(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(json|svg)$/.test(name) && name !== 'expected.json')
        out[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

export const text = (page, sel) =>
  page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => null);

export async function press(page, combo) {
  const keys = combo.split('+');
  for (const k of keys.slice(0, -1)) await page.keyboard.down(k);
  await page.keyboard.press(keys.at(-1));
  for (const k of keys.slice(0, -1).reverse()) await page.keyboard.up(k);
}

/** Nạp bộ file làm project cho lần Mở project kế tiếp rồi mở nó ở tab Bắt đầu. */
export async function openProject(page, files, display = 'D:\\Projects\\e2e') {
  await page.waitForSelector('mat-start-page .start-hero');
  await page.evaluate((f, d) => window.__matMock.useProject(f, d), files, display);
  await page.$eval('mat-start-page .start-hero .btn.primary', (b) => b.click());
}

/** Mở project rồi chờ cây dựng xong. */
export async function openAndWait(page, files, display) {
  await openProject(page, files, display);
  await page.waitForSelector('mat-tree [role="treeitem"]');
}

/** Chọn mục cây theo nhãn (mở editor của mục). */
export async function treeItem(page, label) {
  const ok = await page.evaluate((l) => {
    const item = [...document.querySelectorAll('mat-tree [role="treeitem"]')].find(
      (e) => e.querySelector('.lbl')?.textContent.trim() === l,
    );
    item?.click();
    return Boolean(item);
  }, label);
  if (!ok) throw new Error(`không thấy mục cây "${label}"`);
}

/** Chọn mục cây theo id nút (ví dụ `channel:plc1`, `watch:van-hanh`). */
export async function treeNode(page, id) {
  const ok = await page.evaluate((i) => {
    const item = document.querySelector(`mat-tree [id="ti-${i}"]`);
    item?.click();
    return Boolean(item);
  }, id);
  if (!ok) throw new Error(`không thấy nút cây "${id}"`);
}

/** Mở nút nhóm trên cây (nhấp mũi tên) nếu đang đóng. */
export async function expandNode(page, id) {
  await page.evaluate((i) => {
    const item = document.querySelector(`mat-tree [id="ti-${i}"]`);
    if (item?.getAttribute('aria-expanded') === 'false') item.querySelector('.tw')?.click();
  }, id);
}

export async function setTheme(page, theme) {
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

export async function axeBoth(page, axe, label) {
  await setTheme(page, 'light');
  await axe(`${label}, theme sáng`);
  await setTheme(page, 'dark');
  await axe(`${label}, theme tối`);
  await setTheme(page, 'light');
}

export async function clickButton(page, scope, label) {
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

export const waitFor = (page, fn, arg, timeout = 8000) =>
  page.waitForFunction(fn, { timeout, polling: 50 }, arg);

/** Ô của lưới mat-grid theo dòng gốc và cột, trong phần tử `host`. */
export const gridCell = (host, r, c) => `${host} [role="gridcell"][data-r="${r}"][data-c="${c}"]`;

/** Chữ của ô lưới (bỏ mô tả ẩn và dấu Lit). */
export const gridText = (page, sel) =>
  page
    .$eval(sel, (e) =>
      [...e.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join('')
        .trim(),
    )
    .catch(() => null);

/** Nhấp ô lưới (chọn ô) bằng chuột thật. */
export async function clickCell(page, host, r, c) {
  await page.waitForSelector(gridCell(host, r, c));
  await page.click(gridCell(host, r, c));
}

/** Gõ thẳng vào ô đang chọn rồi Enter (không F2): ký tự đầu vào sửa luôn. */
export async function typeInCell(page, textToType) {
  await page.keyboard.type(textToType);
  await page.keyboard.press('Enter');
}

/** Dán văn bản vào ô nhập dùng chung của lưới (sự kiện paste có clipboardData). */
export async function pasteInto(page, host, textToPaste) {
  await page.evaluate(
    (h, txt) => {
      const ta = document.querySelector(`${h} textarea.mg-input`);
      ta.focus();
      const e = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: () => txt } });
      ta.dispatchEvent(e);
    },
    host,
    textToPaste,
  );
}

/**
 * Online BL335-01 và đăng nhập `user` qua thiết bị giả: đặt mật khẩu thử ngẫu nhiên, runtime 0.5.0 (có ghi Tag và Thử kết nối),
 * Ctrl+K → chọn → ghim → đăng nhập. Trả mật khẩu đã dùng.
 */
export async function goOnline(page, user = 'kysu1', files = null) {
  const pw = `thu-${randomBytes(12).toString('hex')}`;
  await page.evaluate(
    (p, f) => {
      const c = window.__matMock.device;
      for (const u of ['kysu1', 'xem1', 'admin']) c.setPassword(u, `${p}-${u}`);
      c.setRuntime('BL335-01', '0.5.0');
      if (f) for (const [rel, content] of Object.entries(f)) c.editStored('BL335-01', rel, content);
    },
    pw,
    files,
  );
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await page.waitForSelector('mat-devices-dialog [role="dialog"]');
  await waitFor(
    page,
    () => document.querySelectorAll('mat-devices-dialog tbody tr[data-key]').length >= 2,
  );
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
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Online');
  await page.waitForSelector('mat-pin-dialog [role="dialog"]');
  await clickButton(page, 'mat-pin-dialog .dlg-f', 'Ghim và tiếp tục');
  await page.waitForSelector('mat-login-dialog [role="dialog"]');
  await page.type('mat-login-dialog input[name="user"]', user);
  await page.type('mat-login-dialog input[name="password"]', `${pw}-${user}`);
  await clickButton(page, 'mat-login-dialog .dlg-f', 'Đăng nhập');
  await waitFor(
    page,
    (u) => new RegExp(`${u} · `).test(document.querySelector('mat-statusbar')?.textContent ?? ''),
    user,
  );
  return pw;
}

/** Gõ vào ô (thay nội dung cũ nếu có). */
export async function typeInto(page, sel, value) {
  await page.click(sel);
  await page.$eval(sel, (i) => i.select());
  await page.keyboard.type(value);
}

export const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    n: s.length,
    avg: +avg.toFixed(1),
    p95: +s[Math.floor(s.length * 0.95)].toFixed(1),
    max: +s.at(-1).toFixed(1),
  };
};

/** Chạy lệnh bằng bảng lệnh (Ctrl+Shift+P, gõ tên, Enter): đường chỉ dùng bàn phím (FR-053). */
export async function runCommand(page, label) {
  await press(page, 'Control+Shift+p');
  await page.waitForSelector('mat-palette input');
  await page.keyboard.type(label);
  await sleep(120);
  await page.keyboard.press('Enter');
  await sleep(120);
}
