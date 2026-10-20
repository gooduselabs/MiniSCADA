/* global window, document, location */
// Ảnh chụp màn hình cho tài liệu người dùng (feature 011, T203; SC-038): chụp giao diện web của mAT Studio và trang vận hành
// trên Chrome headless, dùng lại khung e2e có sẵn (lớp Tauri giả và thiết bị giả của Studio: apps/studio/tests/e2e; runtime
// giả của trang vận hành: apps/runtime-web/tests/e2e). Dữ liệu tất định: project mẫu trong projects/ (dashboard-demo,
// svg-demo) và project mẫu của e2e trang vận hành; không cần Docker, không cần thiết bị.
//
// Dùng:   node tools/docs-screenshots.mjs [lọc] [--build] [--headful] [--out=<thư mục>] [--theme=<chủ đề>]
//   lọc       khớp một phần tên cảnh (ví dụ `web-quyen`): chỉ chạy các cảnh đó, chụp mọi ảnh của chúng; không khớp tên
//             cảnh nào thì là lọc theo tên ảnh (mọi cảnh vẫn chạy, chỉ ghi ảnh có tên chứa chuỗi lọc).
//   --build   dựng lại hai bản build e2e (apps/studio/dist-e2e, apps/runtime-web/dist-e2e) trước khi chụp; thiếu thì tự dựng.
//   --out     thư mục ảnh (tương đối theo gốc repo), mặc định docs/user/img.
//   --theme   ép chủ đề của mọi project mẫu (vivid | industrial | dark; feature 012): trang vận hành nhận `theme` của project,
//             Studio mở project đã nâng lên định dạng 1.1 có `theme` (chỉ trong bộ nhớ). Dùng cho bảng trước/sau
//             (docs/reports/012-ui-before-after.md). Cảnh studio-logic dừng ở hộp Nạp xuống khi ép chủ đề (project
//             nâng 1.1 trong bộ nhớ); không ép thì chạy đủ.
// Biến môi trường: CHROME_PATH (Chrome/Edge/chrome-headless-shell); không đặt thì tìm ~/.cache/mat-chrome rồi Chrome cài sẵn.
// Kết quả: docs/user/img/<tên>.png, khung 1366 × 768, theme sáng, giao diện tiếng Việt. Ảnh là giao diện web trong Chrome;
// Studio trên Windows (WebView2) có thể khác chút ở phông chữ và khung cửa sổ.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const optArg = (name) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || undefined;
const OUT = resolve(ROOT, optArg('out') ?? 'docs/user/img');
const THEME = optArg('theme');
if (THEME && !['vivid', 'industrial', 'dark'].includes(THEME))
  throw new Error(`--theme không hợp lệ: ${THEME}`);
const STUDIO = join(ROOT, 'apps/studio');
const WEB = join(ROOT, 'apps/runtime-web');
const STUDIO_DIST = join(STUDIO, 'dist-e2e');
const WEB_DIST = join(WEB, 'dist-e2e');
const VIEWPORT = { width: 1366, height: 768, deviceScaleFactor: 1 };
/** Ngân sách mỗi ảnh (byte): vượt thì báo để chụp vùng nhỏ hơn. */
const MAX_BYTES = 200 * 1024;

const filter = args.find((a) => !a.startsWith('--'));
const headful = args.includes('--headful');

const studioE2e = await import(pathToFileURL(join(STUDIO, 'tests/e2e/util.mjs')).href);
const webE2e = await import(pathToFileURL(join(WEB, 'tests/e2e/util.mjs')).href);
const { startFakeRuntime } = await import(
  pathToFileURL(join(WEB, 'tests/e2e/fake-runtime.mjs')).href
);
const { dashboard } = await import(pathToFileURL(join(WEB, 'tests/e2e/fixture-project.mjs')).href);
const { historyProject } = await import(
  pathToFileURL(join(WEB, 'tests/e2e/history-fake.mjs')).href
);
const { reportsProject } = await import(
  pathToFileURL(join(WEB, 'tests/e2e/history-projects.mjs')).href
);
const { gridDemo } = await import(pathToFileURL(join(WEB, 'tests/e2e/grid-fixture.mjs')).href);
const { PASS, accessDemo, accessSeed, loginPage } = await import(
  pathToFileURL(join(WEB, 'tests/e2e/access-fixture.mjs')).href
);
/** Đổi tên hiển thị của project mẫu e2e (bỏ chữ "e2e" trên thanh trên). */
const renamed = (make, name) => () => {
  const p = make();
  p.active.project.projectName = name;
  return p;
};
const { clickButton, expandNode, openAndWait, setTheme, sleep, treeItem, treeNode, waitFor } =
  studioE2e;
const { deepEval, until, waitDeep } = webE2e;

/** Đọc project mẫu cho Studio; có --theme thì project.json lên định dạng 1.1 kèm `theme` (chỉ trong bộ nhớ). */
function readProject(dir) {
  const files = studioE2e.readProject(dir);
  if (THEME) {
    const project = JSON.parse(files['project.json']);
    if (project.schemaVersion === '1.0.0') project.schemaVersion = '1.1.0';
    project.theme = THEME;
    files['project.json'] = JSON.stringify(project, null, 2) + '\n';
  }
  return files;
}
/** Project của runtime giả cho trang vận hành; có --theme thì ép `theme` của project. */
const themedFixture = (make) =>
  THEME && make
    ? () => {
        const p = make();
        p.active.project = { ...p.active.project, theme: THEME };
        return p;
      }
    : make;

function chromePath() {
  const cache = join(homedir(), '.cache/mat-chrome/chrome-headless-shell');
  const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
  // ~/.cache/mat-chrome/chrome-headless-shell/<nền>-<phiên bản>/chrome-headless-shell-<nền>/chrome-headless-shell[.exe]
  const cached = isDir(cache)
    ? readdirSync(cache)
        .filter((v) => isDir(join(cache, v)))
        .sort()
        .reverse()
        .flatMap((v) =>
          readdirSync(join(cache, v))
            .filter((d) => isDir(join(cache, v, d)))
            .flatMap((d) => [
              join(cache, v, d, 'chrome-headless-shell'),
              join(cache, v, d, 'chrome-headless-shell.exe'),
            ]),
        )
    : [];
  const found = [
    process.env.CHROME_PATH,
    ...cached,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p) && statSync(p).isFile());
  if (!found) throw new Error('Không tìm thấy Chrome: đặt CHROME_PATH');
  return found;
}

function buildIfNeeded() {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // Trang vận hành: thêm lượt `e2e-login` (trang /login của feature 013, chạy sau `e2e`, như `npm run e2e`).
  for (const [dir, dist, modes, files] of [
    [STUDIO, STUDIO_DIST, ['e2e'], ['index.html']],
    [WEB, WEB_DIST, ['e2e', 'e2e-login'], ['index.html', 'login.html']],
  ]) {
    if (args.includes('--build') || files.some((f) => !existsSync(join(dist, f)))) {
      console.log(`dựng bản e2e: ${dir}`);
      for (const mode of modes)
        execFileSync(npx, ['vite', 'build', '--mode', mode, '--logLevel', 'error'], {
          cwd: dir,
          stdio: 'inherit',
          shell: process.platform === 'win32',
        });
    }
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
};
/** Máy chủ tĩnh cho bản build e2e của Studio (như apps/studio/tests/e2e/run.mjs). */
function serveStudio() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(STUDIO_DIST, path === '/' ? 'index.html' : path));
    if (!file.startsWith(STUDIO_DIST) || !existsSync(file)) file = join(STUDIO_DIST, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

const clickSel = (page, sel) =>
  page
    .$eval(sel, (e) => e.click())
    .then(
      () => true,
      () => false,
    );
async function ctrl(page, code, shift = false) {
  await page.keyboard.down('Control');
  if (shift) await page.keyboard.down('Shift');
  await page.keyboard.press(code);
  if (shift) await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
}

/** Thu task card bên phải (Toolbox) để vùng editor rộng hơn. */
const closeTaskCard = (page) =>
  page.evaluate(() => {
    const app = window.__matApp;
    if (app.workspace.taskCardOpen) app.setTaskCard(app.workspace.taskCard);
  });

// ---------------------------------------------------------------- PNG bảng màu (giảm dung lượng)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Giải PNG 8 bit RGB/RGBA không xen kẽ (ảnh của Chrome) thành RGB; null nếu kiểu khác. */
function decodePng(buf) {
  let pos = 8;
  let w = 0;
  let h = 0;
  let type = -1;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const t = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (t === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) return null;
      type = data[9];
    } else if (t === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!bpp) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const cur = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      rgb[(y * w + x) * 3] = cur[x * bpp];
      rgb[(y * w + x) * 3 + 1] = cur[x * bpp + 1];
      rgb[(y * w + x) * 3 + 2] = cur[x * bpp + 2];
    }
    cur.copy(prev);
  }
  return { w, h, rgb };
}

/**
 * Ảnh giao diện có ít màu: đổi PNG truecolor thành PNG bảng màu 256 màu (median cut trên lược đồ 15 bit, không dither) để
 * mỗi ảnh nhỏ hơn khoảng 200 KB. Ảnh ≤ 256 màu thì giữ đúng màu. Trả null nếu không giải được.
 */
function toPalettePng(png) {
  const img = decodePng(png);
  if (!img) return null;
  const { w, h, rgb } = img;
  const n = w * h;
  const exact = new Map();
  for (let i = 0; i < n && exact.size <= 256; i++)
    exact.set((rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2], 0);
  let palette;
  let indexOf;
  if (exact.size <= 256) {
    palette = [...exact.keys()].map((c) => [c >> 16, (c >> 8) & 255, c & 255]);
    palette.forEach((p, i) => exact.set((p[0] << 16) | (p[1] << 8) | p[2], i));
    indexOf = (i) => exact.get((rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2]);
  } else {
    const hist = new Map();
    for (let i = 0; i < n; i++) {
      const k = ((rgb[i * 3] >> 3) << 10) | ((rgb[i * 3 + 1] >> 3) << 5) | (rgb[i * 3 + 2] >> 3);
      const e = hist.get(k);
      if (e) {
        e[0] += rgb[i * 3];
        e[1] += rgb[i * 3 + 1];
        e[2] += rgb[i * 3 + 2];
        e[3]++;
      } else hist.set(k, [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 1]);
    }
    // Mỗi ô lược đồ: màu trung bình và số điểm ảnh.
    const cells = [...hist.values()].map(([r, g, b, c]) => [r / c, g / c, b / c, c]);
    let boxes = [cells];
    while (boxes.length < 256) {
      // Tách hộp có (số điểm × độ trải lớn nhất) lớn nhất theo kênh trải nhất.
      let best = -1;
      let bestScore = 0;
      let bestCh = 0;
      boxes.forEach((box, bi) => {
        if (box.length < 2) return;
        let count = 0;
        for (const c of box) count += c[3];
        for (let ch = 0; ch < 3; ch++) {
          let lo = 255;
          let hi = 0;
          for (const c of box) {
            if (c[ch] < lo) lo = c[ch];
            if (c[ch] > hi) hi = c[ch];
          }
          const score = (hi - lo) * Math.sqrt(count);
          if (score > bestScore) {
            bestScore = score;
            best = bi;
            bestCh = ch;
          }
        }
      });
      if (best < 0) break;
      const box = boxes[best].sort((a, b) => a[bestCh] - b[bestCh]);
      let total = 0;
      for (const c of box) total += c[3];
      let acc = 0;
      let cut = 1;
      for (; cut < box.length - 1; cut++) {
        acc += box[cut - 1][3];
        if (acc >= total / 2) break;
      }
      boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
    }
    palette = boxes.map((box) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let c = 0;
      for (const x of box) {
        r += x[0] * x[3];
        g += x[1] * x[3];
        b += x[2] * x[3];
        c += x[3];
      }
      return [Math.round(r / c), Math.round(g / c), Math.round(b / c)];
    });
    // Màu có nhiều điểm ảnh (nền, viền phẳng) giữ đúng: thay màu bảng gần nhất bằng màu thật.
    const cache = new Map();
    indexOf = (i) => {
      const r = rgb[i * 3];
      const g = rgb[i * 3 + 1];
      const b = rgb[i * 3 + 2];
      const k = (r << 16) | (g << 8) | b;
      let v = cache.get(k);
      if (v === undefined) {
        let bd = Infinity;
        for (let p = 0; p < palette.length; p++) {
          const dr = palette[p][0] - r;
          const dg = palette[p][1] - g;
          const db = palette[p][2] - b;
          const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
          if (d < bd) {
            bd = d;
            v = p;
          }
        }
        cache.set(k, v);
      }
      return v;
    };
  }
  const lines = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) lines[y * (w + 1) + 1 + x] = indexOf(y * w + x);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  return Buffer.concat([
    png.subarray(0, 8),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(palette.flat())),
    chunk('IDAT', deflateSync(lines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- Dữ liệu tất định

const DASHBOARD_DEMO = join(ROOT, 'projects/dashboard-demo');
const SVG_DEMO = join(ROOT, 'projects/svg-demo');
const GRID_DEMO = join(ROOT, 'projects/grid-demo');
const PW = 'mat-docs-screenshots';

/** logic.json mẫu cho projects/dashboard-demo (chỉ trong bộ nhớ, không ghi vào project mẫu). */
const LOGIC = {
  schemaVersion: '1.0.0',
  writes: [
    {
      id: 'w_bom1',
      tag: 'PUMP01.RUN_CMD',
      allowed: { values: [true, false] },
      minIntervalMs: 30000,
      maxPerHour: 20,
    },
  ],
  rules: [
    {
      id: 'bom1_tat_muc_cao',
      name: 'Bơm 1 tự tắt khi bồn đầy',
      enabled: true,
      when: 'TANK01.LEVEL > 80',
      hold: 5000,
      onRise: [{ do: 'write', write: 'w_bom1', value: false }],
      onFall: [],
    },
    {
      id: 'bom1_bat_muc_thap',
      name: 'Bơm 1 tự bật khi bồn cạn (giờ làm việc)',
      enabled: true,
      when: 'TANK01.LEVEL < 20 && LOGIC.CA_NGAY.Q',
      hold: 10000,
      onRise: [{ do: 'write', write: 'w_bom1', value: true }],
      onFall: [],
    },
  ],
  timers: [
    {
      id: 't_khoi_dong',
      kind: 'ton',
      in: 'PUMP01.RUN_CMD',
      pt: 5000,
      q: 'LOGIC.T_KHOI_DONG.Q',
      et: 'LOGIC.T_KHOI_DONG.ET',
    },
  ],
  counters: [
    {
      id: 'c_so_lan_chay',
      up: 'PUMP01.RUN',
      down: null,
      reset: null,
      preset: 1000,
      value: 'LOGIC.C_SO_LAN_CHAY.VALUE',
      reached: 'LOGIC.C_SO_LAN_CHAY.REACHED',
      retain: true,
    },
  ],
  totalizers: [
    {
      id: 'z_luu_luong_bom1',
      source: 'PUMP01.FLOW',
      rateUnit: 'h',
      factor: 1,
      cutoff: 0.05,
      maxGapMs: 5000,
      reset: null,
      total: 'LOGIC.BOM1.TONG',
      gapSeconds: 'LOGIC.BOM1.GIAY_TRONG',
      retain: true,
    },
  ],
  runhours: [
    {
      id: 'h_bom1',
      run: 'PUMP01.RUN',
      reset: null,
      serviceEveryHours: 500,
      hours: 'LOGIC.BOM1.GIO_CHAY',
      starts: 'LOGIC.BOM1.SO_LAN',
      due: 'LOGIC.BOM1.DEN_HAN',
      retain: true,
    },
  ],
  schedules: [
    {
      id: 'ca_ngay',
      weekly: [{ days: [1, 2, 3, 4, 5, 6], from: '06:00', to: '18:00' }],
      exceptions: [{ date: '2026-12-25', mode: 'off' }],
      out: 'LOGIC.CA_NGAY.Q',
    },
  ],
};

function dashboardWithLogic() {
  const files = readProject(DASHBOARD_DEMO);
  files['logic.json'] = JSON.stringify(LOGIC, null, 2) + '\n';
  const project = JSON.parse(files['project.json']);
  project.logic = 'logic.json';
  files['project.json'] = JSON.stringify(project, null, 2) + '\n';
  return files;
}

/** Online BL335-01 qua thiết bị giả (như goOnline của e2e), chụp hộp Thiết bị trong mạng nếu có `shot`. */
async function online(page, user, shot) {
  await page.evaluate((p) => {
    const c = window.__matMock.device;
    for (const u of ['kysu1', 'xem1', 'admin']) c.setPassword(u, `${p}-${u}`);
    c.setRuntime('BL335-01', '1.0.0');
  }, PW);
  await ctrl(page, 'KeyK');
  await page.waitForSelector('mat-devices-dialog [role="dialog"]');
  await waitFor(
    page,
    () => /Tìm xong/.test(document.querySelector('mat-devices-dialog .scan')?.textContent ?? ''),
    undefined,
    8000,
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-devices-dialog tbody tr[data-key]')]
      .find((r) => r.textContent.includes('BL335-01'))
      ?.click(),
  );
  if (shot) await shot();
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Online');
  await page.waitForSelector('mat-pin-dialog [role="dialog"]');
  await clickButton(page, 'mat-pin-dialog .dlg-f', 'Ghim và tiếp tục');
  await page.waitForSelector('mat-login-dialog [role="dialog"]');
  await page.type('mat-login-dialog input[name="user"]', user);
  await page.type('mat-login-dialog input[name="password"]', `${PW}-${user}`);
  await clickButton(page, 'mat-login-dialog .dlg-f', 'Đăng nhập');
  await waitFor(
    page,
    (u) => new RegExp(`${u} · `).test(document.querySelector('mat-statusbar')?.textContent ?? ''),
    user,
  );
}

// ---------------------------------------------------------------- Cảnh của Studio

/** Mỗi cảnh: tên nhóm, hàm nhận { page, shot(name) }. Ảnh tên `<tiền tố>-<tên>.png`. */
const studioScenes = [
  {
    name: 'studio-tong-quan',
    async run({ page, shot }) {
      await openAndWait(page, readProject(DASHBOARD_DEMO), 'D:\\Projects\\dashboard-demo');
      await treeNode(page, 'screen:bom');
      await page.waitForSelector('mat-screen-canvas .world');
      // Xem trước Mô phỏng: Tag mô phỏng của 20 bơm có giá trị thay vì "?".
      await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .find((b) => b.textContent.trim() === 'Mô phỏng' && b.closest('mat-screen-editor'))
          ?.click(),
      );
      await sleep(1200);
      await shot('eng-giao-dien-studio');
      await closeTaskCard(page);
      await treeItem(page, 'Bảng Tag mặc định');
      await page.waitForSelector('mat-tag-grid [role="gridcell"]');
      await sleep(300);
      await shot('eng-bang-tag');
      await treeNode(page, 'connections');
      await page.waitForSelector('mat-connections-editor, [data-act="add-channel"]');
      await sleep(300);
      await shot('eng-ket-noi');
      await expandNode(page, 'templates');
      await waitFor(page, () => document.querySelector('mat-tree [id="ti-template:bom"]') !== null);
      await treeNode(page, 'template:bom');
      await page.waitForSelector('mat-template-editor tbody tr');
      await sleep(300);
      await shot('eng-template');
      await page.$eval('mat-template-editor [data-act="add-instance"]', (b) => b.click());
      await page.waitForSelector('mat-template-instance-dialog [role="dialog"]');
      await sleep(300);
      await shot('eng-template-ban-sao');
    },
  },
  {
    // feature 012: trình soạn bố cục lưới (hàng, cột, ô) trên project 1.1 chủ đề vivid
    name: 'studio-luoi',
    async run({ page, shot }) {
      await openAndWait(page, readProject(GRID_DEMO), 'D:\\Projects\\grid-demo');
      await treeNode(page, 'screen:bang-dieu-khien');
      await page.waitForSelector('mat-grid-editor .ge-cell');
      await page.$eval('mat-grid-editor .ge-cell[data-cell="c5"]', (e) => e.click());
      await sleep(900);
      await shot('eng-bo-cuc-luoi');
      // Xem trước Mô phỏng trên lưới (bảng trước/sau 012): widget có giá trị thay vì "?".
      const preview = (label) =>
        page.evaluate(
          (l) =>
            [...document.querySelectorAll('button')]
              .find((b) => b.textContent.trim() === l && b.closest('mat-screen-editor'))
              ?.click(),
          label,
        );
      await preview('Mô phỏng');
      await sleep(2500);
      await shot('eng-luoi-mo-phong');
      await preview('Tắt');
      await sleep(300);
      await page.$eval('mat-grid-editor [data-act="add-row"]', (b) => b.click());
      await page.waitForSelector('mat-grid-editor [data-preset]');
      await sleep(300);
      await shot('eng-them-hang');
    },
  },
  {
    name: 'studio-svg',
    async run({ page, shot }) {
      await openAndWait(page, readProject(SVG_DEMO), 'D:\\Projects\\svg-demo');
      await expandNode(page, 'graphics');
      await treeNode(page, 'svgfile:graphics/tram-bom.svg');
      await page.waitForSelector('mat-svg-editor mat-svg-canvas');
      await waitFor(page, () =>
        document.querySelector('mat-svg-canvas')?.shadowRoot?.querySelector('svg.doc'),
      );
      await page.evaluate(() => {
        const app = window.__matApp;
        if (!(app.workspace.taskCard === 'toolbox' && app.workspace.taskCardOpen))
          app.setTaskCard('toolbox');
      });
      await page.waitForSelector('mat-taskcards .tc-draw [data-tool="rect"]');
      // Chọn một phần tử để Inspector có nội dung.
      await page.evaluate(() => {
        const app = window.__matApp;
        const rel = app.store.state.active.slice('svgdraw:'.length);
        const ed = app.svg.editor(rel);
        const n = [...ed.doc.nodes.values()].find(
          (x) => x.attrs.get('data-mat-uid') && ['rect', 'path', 'circle'].includes(x.name),
        );
        if (n && typeof ed.select === 'function') ed.select([n.id]);
      });
      await sleep(500);
      await shot('eng-trinh-ve-svg');
    },
  },
  {
    name: 'studio-logic',
    async run({ page, shot }) {
      await openAndWait(page, dashboardWithLogic(), 'D:\\Projects\\dashboard-demo');
      await treeNode(page, 'logic');
      await page.waitForSelector('mat-logic-editor table.lg-grid');
      await expandNode(page, 'logic');
      await page.evaluate(() => {
        const app = window.__matApp;
        if (!(app.workspace.taskCard === 'toolbox' && app.workspace.taskCardOpen))
          app.setTaskCard('toolbox');
      });
      await page.waitForSelector('mat-taskcards .tc-logic [data-block="rule"]');
      await page.click('mat-logic-editor tr[data-id="bom1_bat_muc_thap"] td.rn');
      await sleep(400);
      await shot('eng-logic');
      await clickSel(page, 'mat-logic-editor .lg-seg button[data-kind="timer"]');
      await sleep(300);
      await clickSel(page, 'mat-logic-dock [data-tab="test"]');
      await page.waitForSelector('mat-logic-test [data-act="play"]');
      await clickSel(page, 'mat-logic-test [data-speed="100"]');
      await clickSel(page, 'mat-logic-test [data-act="play"]');
      await sleep(1500);
      await clickSel(page, 'mat-logic-test [data-act="play"]');
      await sleep(300);
      await shot('eng-thu-logic');
      await clickSel(page, 'mat-logic-dock [data-tab="info"]');
      await online(page, 'kysu1', () => shot('eng-thiet-bi-trong-mang'));
      await page.evaluate(() => {
        const c = window.__matMock.device;
        c.setLogic('BL335-01', {
          writes: 'on',
          blocks: [
            {
              id: 'bom1_bat_muc_thap',
              kind: 'rule',
              state: 'OK',
              lastFired: '2026-10-16T08:12:03+07:00',
              fired: 14,
              reason: null,
            },
            { id: 'bom1_tat_muc_cao', kind: 'rule', state: 'OK', fired: 15, reason: null },
          ],
        });
      });
      await clickSel(page, 'mat-logic-editor .lg-seg button[data-kind="rule"]');
      await waitFor(
        page,
        () => /Ghi PLC: bật/.test(document.querySelector('mat-logic-chip')?.textContent ?? ''),
        undefined,
        12000,
      );
      await waitFor(
        page,
        () => document.querySelector('mat-logic-editor td.live-col .chip') !== null,
        undefined,
        8000,
      );
      await closeTaskCard(page);
      await sleep(300);
      await shot('eng-logic-online');
      await ctrl(page, 'KeyL');
      await page.waitForSelector('mat-download-dialog tr[data-row="logic"]', { timeout: 15000 });
      await sleep(400);
      await shot('eng-nap-xuong');
    },
  },
  {
    name: 'studio-ota',
    async run({ page, shot }) {
      await openAndWait(page, dashboardWithLogic(), 'D:\\Projects\\dashboard-demo');
      await online(page, 'admin');
      await page.evaluate(() => {
        const c = window.__matMock.device;
        c.setUpdate('BL335-01', { enabled: true, previous: { version: '0.9.5', available: true } });
        c.setWarnings('BL335-01', [
          { code: 'SSH_ROOT_PASSWORD' },
          { code: 'TIME_NOT_SYNCED' },
          { code: 'LOGIC_WRITES_OFF' },
        ]);
      });
      await treeNode(page, 'device');
      await waitFor(
        page,
        () => document.querySelector('mat-device-page [data-act="ota-open"]') !== null,
        undefined,
        15000,
      );
      await waitFor(
        page,
        () => /SSH/.test(document.querySelector('mat-device-page')?.textContent ?? ''),
        undefined,
        15000,
      );
      await closeTaskCard(page);
      await page.$eval('mat-device-page .dp-warn', (e) => e.scrollIntoView({ block: 'start' }));
      await sleep(400);
      await shot('adm-trang-thiet-bi');
      await clickSel(page, 'mat-device-page [data-act="ota-open"]');
      await page.waitForSelector('mat-update-wizard [role="dialog"]');
      await waitFor(page, () =>
        Boolean(document.querySelector('mat-update-wizard [data-step="pick"]')),
      );
      await clickSel(page, 'mat-update-wizard [data-act="pick"]');
      await waitFor(page, () =>
        /matupdate/.test(
          document.querySelector('mat-update-wizard [data-role="file"]')?.textContent,
        ),
      );
      await sleep(200);
      await shot('adm-ota-chon-tep');
      await clickSel(page, 'mat-update-wizard [data-act="upload"]');
      await waitFor(page, () =>
        Boolean(document.querySelector('mat-update-wizard [data-step="plan"]')),
      );
      await page.type('mat-update-wizard input[type="password"]', `${PW}-admin`);
      await sleep(200);
      await shot('adm-ota-ke-hoach');
      await clickSel(page, 'mat-update-wizard [data-act="apply"]');
      await waitFor(page, () =>
        Boolean(document.querySelector('mat-update-wizard [data-step="following"]')),
      );
      await sleep(1200);
      await shot('adm-ota-theo-doi');
      await waitFor(
        page,
        () => Boolean(document.querySelector('mat-update-wizard [data-step="result"]')),
        undefined,
        25000,
      );
      await sleep(400);
      await shot('adm-ota-ket-qua');
    },
  },
];

// ---------------------------------------------------------------- Cảnh của trang vận hành

const login = async (page, user, pass) => {
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.$eval('dialog[open] input[autocomplete="username"]', (e) => (e.value = ''));
  await page.type('dialog[open] input[autocomplete="username"]', user);
  await page.type('dialog[open] input[autocomplete="current-password"]', pass);
};
const submitLogin = async (page) => {
  await page.keyboard.press('Enter');
  await until(async () => !(await page.$eval('#app-user', (b) => b.hidden)), 'đăng nhập');
};
const live = (page) =>
  until(
    async () => (await page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'Trực tuyến',
  );

/**
 * Project của trang vận hành: project mẫu e2e (apps/runtime-web/tests/e2e/fixture-project.mjs) bỏ các item chỉ để thử bảo
 * mật (chuỗi XSS, Tag lạ, màn hình hỏng), tên hiển thị gọn.
 */
const tramBom = () => pruneDemo(dashboard());
function pruneDemo(p) {
  p.active.project.projectName = 'Trạm bơm';
  const drop = { 'tong-quan': ['ghost', 'xss'], bom1: ['xssbtn'] };
  for (const [id, items] of Object.entries(drop)) {
    const f = p.files.get(`screens/${id}.screen.json`);
    f.json = { ...f.json, items: f.json.items.filter((i) => !items.includes(i.id)) };
  }
  const prune = (nav) =>
    nav && Array.isArray(nav.items)
      ? {
          ...nav,
          items: nav.items
            .filter((i) => i.screen !== 'hong')
            .map((i) => (Array.isArray(i.items) ? prune(i) : i)),
        }
      : nav;
  p.active.navigation = prune(p.active.navigation);
  p.active.project.navigation = prune(p.active.project.navigation);
  p.active.screens = p.active.screens.filter((x) => x.id !== 'hong');
  return p;
}

/**
 * Project của cảnh phân quyền (feature 013): project mẫu e2e của 013 (access-fixture.mjs) bỏ item thử bảo mật như trên;
 * hàng nút đầu màn hình Bơm 1 cao hơn để thấy đủ dòng lý do khóa ("Cần quyền thao tác").
 */
const tramBomQuyen = () => {
  const p = pruneDemo(accessDemo());
  const f = p.files.get('screens/bom1.screen.json');
  const tall = new Set(['run', 'start', 'auto', 'back']);
  f.json = {
    ...f.json,
    items: f.json.items.map((i) => (tall.has(i.id) ? { ...i, height: 72 } : i)),
  };
  return p;
};

const ALARMS = () => [
  [
    'TANK_B1_LEVEL.HH',
    {
      class: 'critical',
      area: 'bon',
      name: 'Mức bồn B1',
      text: 'Bồn B1 mức rất cao: 91,2 % (ngưỡng 90)',
      tsActive: Date.now() - 95_000,
    },
  ],
  [
    'PUMP1_FAULT',
    {
      class: 'major',
      area: null,
      name: 'Bơm 1 lỗi',
      text: 'Bơm 1 lỗi',
      tsActive: Date.now() - 260_000,
    },
  ],
  [
    'MINOR1',
    {
      class: 'minor',
      area: 'dien',
      name: 'Điện áp thấp',
      text: 'Điện áp thấp',
      tsActive: Date.now() - 610_000,
    },
  ],
];

const webScenes = [
  {
    // feature 012: màn hình bố cục lưới trên trang vận hành, rộng và hẹp
    name: 'web-luoi',
    options: { fixture: gridDemo },
    async run({ page, rt, shot }) {
      await page.goto(`${rt.httpUrl}/#/luoi`, { waitUntil: 'domcontentloaded' });
      await live(page);
      // Biểu đồ đường thời gian thực cần vài chục giây dữ liệu để không trống gần hết khung.
      await sleep(20000);
      await shot('op-bo-cuc-luoi');
    },
  },
  {
    // feature 013: đăng nhập bắt buộc, component khóa do quyền, trang Quản trị. Runtime giả phân quyền của e2e
    // (apps/runtime-web/tests/e2e/access-fake.mjs), kho mẫu accessSeed: vh1 nhóm Ca A, nút Chạy bơm chỉ Quản đốc thao tác.
    name: 'web-quyen',
    options: {
      fixture: tramBomQuyen,
      access: accessSeed(),
      config: { viewerLogin: 'required' },
      drift: false,
    },
    async run({ page, rt, shot }) {
      const path = () => page.evaluate(() => location.pathname).catch(() => '?');
      const tab = async (id) => {
        await page.evaluate((h) => (location.hash = h), `#/quan-tri/${id}`);
        await page.waitForSelector(`#ad-tab-${id}[aria-selected="true"]`);
        await sleep(300);
      };
      const inPreview = (host, id) =>
        page.waitForFunction(
          (h, i) =>
            Boolean(
              document
                .querySelector(h + ' mat-screen')
                ?.shadowRoot?.querySelector('.item[data-item-id="' + i + '"]'),
            ),
          { timeout: 10000 },
          host,
          id,
        );
      // Liên kết trực tiếp khi chưa đăng nhập → trang đăng nhập (sẽ mở lại /bom1).
      await page.goto(`${rt.httpsUrl}/#/bom1`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.login-card form');
      await until(
        async () => (await page.evaluate(() => document.body.innerText)).includes('Trạm bơm'),
        'tên project',
        5000,
      ).catch(() => undefined);
      await page.type('input[autocomplete="username"]', 'vh1');
      await page.type('input[autocomplete="current-password"]', PASS.vh1);
      await sleep(300);
      await shot('op-dang-nhap-trang');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.keyboard.press('Enter'),
      ]);
      await waitDeep(page, 'mat-w-setpoint', 1, 10000);
      await live(page);
      await until(
        async () =>
          (await deepEval(
            page,
            '.item[data-item-id="run"] > *',
            'const l = els[0] && els[0].shadowRoot.querySelector("[data-lock]"); return l ? l.getAttribute("data-lock") : null;',
          )) === 'NO_PERMISSION',
        'nút Chạy bơm khóa vì quyền',
      );
      await sleep(800);
      await shot('op-can-quyen');
      // Quản trị viên: đăng xuất vh1, đăng nhập quantri.
      await page.click('#app-logout-btn');
      await until(async () => (await path()) === '/login', 'về trang đăng nhập', 8000);
      await loginPage(page, 'quantri', PASS.quantri);
      await page.evaluate(() => (location.hash = '#/quan-tri/nguoi-dung'));
      await page.waitForSelector('[data-user="vh1"]');
      await sleep(600);
      await shot('adm-quan-tri-nguoi-dung');
      // Các tab quyền dài: khung cao hơn (1366 × 1100) để thấy đủ ma trận, khung "Ai được xem / thao tác".
      await page.setViewport({ ...VIEWPORT, height: 1100 });
      await tab('quyen-trang');
      await page.waitForSelector('tr[data-resource="screen:bon-nuoc"]');
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(300);
      await shot('adm-quyen-theo-trang');
      await tab('quyen-thanh-phan');
      await page.waitForSelector('#ad-comp-screen');
      await page.select('#ad-comp-screen', 'bom1');
      await inPreview('.ad-comp', 'run');
      await page.waitForSelector('.ad-pick[data-pick="run"]');
      await page.$eval('.ad-pick[data-pick="run"]', (e) => e.click());
      await page.waitForSelector('.ad-inspector [data-level="operate"]');
      await page.waitForSelector('.ad-who [data-who="vh1"]');
      await page.$eval('.ad-inspector', (e) => e.scrollIntoView({ block: 'start' }));
      await sleep(600);
      await shot('adm-quyen-component');
      await tab('xem-voi-tu-cach');
      await page.select('#ad-viewas-user', 'vh1');
      await page.$eval('[data-viewas-start]', (e) => e.click());
      await page.waitForSelector('[data-banner="view-as"]');
      await page.waitForSelector('.ad-viewas-screens [data-screen="bom1"]');
      await page.$eval('.ad-viewas-screens [data-screen="bom1"]', (e) => e.click());
      await inPreview('.ad-viewas-main', 'run');
      await page.$eval('[role="tablist"]', (e) => e.scrollIntoView({ block: 'start' }));
      await sleep(800);
      await shot('adm-xem-voi-tu-cach');
      await page.setViewport(VIEWPORT);
    },
  },
  {
    name: 'web-man-hinh',
    options: { fixture: tramBom, config: { alarms: true }, drift: false },
    async run({ page, rt, shot }) {
      rt.alarm.reset(ALARMS());
      await page.goto(`${rt.httpUrl}/#/tong-quan`, { waitUntil: 'domcontentloaded' });
      await live(page);
      await sleep(800);
      await shot('op-chi-xem');
      await page.goto('about:blank');
      await page.goto(`${rt.httpsUrl}/#/tong-quan`, { waitUntil: 'domcontentloaded' });
      await live(page);
      await login(page, 'vanhanh1', 'op-pass');
      await sleep(200);
      await shot('op-dang-nhap');
      await submitLogin(page);
      await sleep(800);
      await shot('op-man-hinh');
      await page.goto('about:blank');
      await page.goto(`${rt.httpsUrl}/#/bom1`, { waitUntil: 'domcontentloaded' });
      await waitDeep(page, 'mat-w-setpoint', 1);
      await live(page);
      await deepEval(
        page,
        '.item[data-item-id="sp"] > *',
        'const w = els[0]; const i = w.shadowRoot.querySelector("[data-main]"); i.value = "42.5"; i.dispatchEvent(new Event("input", { bubbles: true })); w.shadowRoot.querySelector("[data-write]").click(); return true;',
      );
      await waitDeep(page, '[role="alertdialog"]', 1);
      await sleep(300);
      await shot('op-xac-nhan-ghi');
      await page.keyboard.press('Escape');
      await page.goto('about:blank');
      await page.goto(`${rt.httpsUrl}/#/alarms`, { waitUntil: 'domcontentloaded' });
      await live(page);
      await until(
        async () => (await page.evaluate(() => location.hash)) === '#/alarms',
        'trang Alarm',
      );
      await waitDeep(page, 'tr[data-id]', 3);
      await sleep(1000);
      await shot('op-alarm');
    },
  },
  {
    name: 'web-lich-su',
    options: { fixture: renamed(historyProject, 'Trạm bơm'), history: {} },
    async run({ page, rt, shot }) {
      await page.goto(`${rt.httpsUrl}/#/ap-suat`, { waitUntil: 'domcontentloaded' });
      await waitDeep(page, 'mat-w-history-trend', 1);
      await login(page, 'xem1', 'view-pass');
      await submitLogin(page);
      await page.goto('about:blank');
      await page.goto(`${rt.httpsUrl}/#/history?g=ap-suat&t=LINE1.PRESS,PUMP1.RUN&r=8h`, {
        waitUntil: 'domcontentloaded',
      });
      await waitDeep(page, 'mat-w-history-trend', 1, 15000);
      await sleep(2500);
      await shot('op-lich-su');
    },
  },
  {
    name: 'web-bao-cao',
    options: { fixture: renamed(reportsProject, 'Trạm điện'), history: {} },
    async run({ page, rt, shot }) {
      const d = new Date(Date.now() - 86_400_000);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await page.goto(`${rt.httpsUrl}/#/report/dien-ngay?d=${day}`, {
        waitUntil: 'domcontentloaded',
      });
      await waitDeep(page, 'h2', 1).catch(() => undefined);
      await login(page, 'xem1', 'view-pass');
      await submitLogin(page);
      await until(
        async () =>
          page.evaluate(
            () =>
              Boolean(document.querySelector('table.rpt')) &&
              !document.querySelector('.rpt-out [role="status"]'),
          ),
        'bảng báo cáo',
        30000,
      );
      await sleep(500);
      await shot('op-bao-cao');
    },
  },
];

// ---------------------------------------------------------------- Chạy

buildIfNeeded();
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: !headful,
  args: [
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=vi-VN',
    '--ignore-certificate-errors',
    '--hide-scrollbars',
    '--font-render-hinting=none',
  ],
  defaultViewport: VIEWPORT,
});
const written = [];
const errors = [];

async function newPage() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'light' },
    // Alarm nhấp nháy và hoạt ảnh dừng ở một khung cố định: ảnh lặp lại được.
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);
  page.on('pageerror', (e) => console.warn(`  (lỗi trang) ${e}`));
  return { context, page };
}
/** Bộ lọc khớp tên cảnh: chỉ chạy cảnh đó và chụp mọi ảnh của nó. */
const sceneFilter =
  filter && [...studioScenes, ...webScenes].some((s) => s.name.includes(filter)) ? filter : null;
const wanted = (scene) => !sceneFilter || scene.name.includes(sceneFilter);
const shooter = (page) => async (name) => {
  if (filter && !sceneFilter && !name.includes(filter)) return;
  const file = join(OUT, `${name}.png`);
  const raw = Buffer.from(await page.screenshot({ type: 'png' }));
  const small = toPalettePng(raw);
  const buf = small && small.length < raw.length ? small : raw;
  writeFileSync(file, buf);
  written.push({ name, bytes: buf.length });
  console.log(`  ✔ ${name}.png ${(buf.length / 1024).toFixed(0)} KB`);
};

const server = await serveStudio();
const studioUrl = `http://127.0.0.1:${server.address().port}/?gate=off`;
for (const scene of studioScenes.filter(wanted)) {
  console.log(`▶ ${scene.name}`);
  const { context, page } = await newPage();
  try {
    await page.goto(studioUrl, { waitUntil: 'networkidle0' });
    await setTheme(page, 'light');
    await scene.run({ page, shot: shooter(page) });
  } catch (e) {
    errors.push(`${scene.name}: ${e?.stack ?? e}`);
    await page.screenshot({ path: join(ROOT, `docs-screenshots-${scene.name}-loi.png`) });
  }
  await context.close();
}
server.close();

for (const scene of webScenes.filter(wanted)) {
  console.log(`▶ ${scene.name}`);
  const rt = await startFakeRuntime({
    staticDir: WEB_DIST,
    ...scene.options,
    fixture: themedFixture(scene.options.fixture),
  });
  if (!rt.httpsUrl) {
    errors.push(`${scene.name}: cần openssl để sinh chứng chỉ thử`);
    await rt.close();
    continue;
  }
  const { context, page } = await newPage();
  try {
    await scene.run({ page, rt, shot: shooter(page) });
  } catch (e) {
    errors.push(`${scene.name}: ${e?.stack ?? e}`);
    await page.screenshot({ path: join(ROOT, `docs-screenshots-${scene.name}-loi.png`) });
  }
  await context.close();
  await rt.close();
}
await browser.close();

const total = written.reduce((s, w) => s + w.bytes, 0);
const big = written.filter((w) => w.bytes > MAX_BYTES);
console.log(`\n${written.length} ảnh, tổng ${(total / 1024 / 1024).toFixed(2)} MB → ${OUT}`);
for (const b of big) console.warn(`  ⚠ ${b.name}.png lớn hơn ${MAX_BYTES / 1024} KB`);
for (const e of errors) console.error(`✘ ${e}`);
process.exit(errors.length ? 1 : 0);
