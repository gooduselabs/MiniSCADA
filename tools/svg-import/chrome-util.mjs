// Phần dùng chung của công cụ nghiệm thu nhập SVG (feature 008, T051/T053/T113): tìm Chrome, dựng DOM cho
// importSvg chạy ngoài trình duyệt, chụp ảnh SVG ở 1200 x 800, so điểm ảnh.
import { existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import puppeteer from 'puppeteer-core';
import { decodePng } from './png-decode.mjs';

export const W = 1200;
export const H = 800;

/** importSvg cần DOMParser (Studio/CLI/test dùng jsdom); gọi một lần trước khi import gói. */
export function installDom() {
  if (!globalThis.DOMParser) globalThis.DOMParser = new JSDOM('').window.DOMParser;
}

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const p = candidates.find((c) => existsSync(c));
  if (!p) throw new Error('Không tìm thấy Chrome; đặt CHROME_PATH.');
  return p;
}

export async function launchChrome() {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  return { browser, version: await browser.version() };
}

export const dataUrl = (bytes, mime = 'image/svg+xml') =>
  `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

/**
 * Chụp một ảnh (SVG hoặc PNG) vào khung 1200 x 800 nền trắng, hiển thị qua <img> (không chạy script, không tải
 * tài nguyên ngoài). Trả về { px, w, h, bpp } đã giải mã. Hết hạn sau `timeout` ms.
 */
export async function shoot(page, src, timeout = 20000) {
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}` +
      `img{position:absolute;left:0;top:0;width:${W}px;height:${H}px}</style><img id="i">`,
    { waitUntil: 'load' },
  );
  const ok = await page.evaluate(
    (s, t) =>
      new Promise((res) => {
        const img = document.getElementById('i');
        const timer = setTimeout(() => res('timeout'), t);
        img.onload = () => {
          clearTimeout(timer);
          res('ok');
        };
        img.onerror = () => {
          clearTimeout(timer);
          res('error');
        };
        img.src = s;
      }),
    src,
    timeout,
  );
  if (ok !== 'ok') throw new Error(`Chrome không dựng được ảnh: ${ok}`);
  const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
  return decodePng(Buffer.from(buf));
}

/**
 * So hai ảnh cùng cỡ. Điểm ảnh "khác" khi kênh lệch lớn nhất > `tol` (0..255). `skip` là các hình chữ nhật
 * [x, y, rộng, cao] không tính (vùng khai báo khác biệt). Trả về { counted, differing, pct }.
 */
export function diffImages(a, b, skip = [], tol = 64) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('Hai ảnh khác cỡ');
  const skipped = new Uint8Array(a.w * a.h);
  for (const r of skip) {
    if (!r) continue;
    const [rx, ry, rw, rh] = r;
    for (let y = Math.max(0, ry); y < Math.min(a.h, ry + rh); y++)
      for (let x = Math.max(0, rx); x < Math.min(a.w, rx + rw); x++) skipped[y * a.w + x] = 1;
  }
  let counted = 0;
  let differing = 0;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      if (skipped[y * a.w + x]) continue;
      counted++;
      const ia = (y * a.w + x) * a.bpp;
      const ib = (y * b.w + x) * b.bpp;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.px[ia + c] - b.px[ib + c]));
      if (d > tol) differing++;
    }
  }
  return { counted, differing, pct: counted ? (differing / counted) * 100 : 0 };
}
