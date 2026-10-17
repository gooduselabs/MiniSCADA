// Kịch bản `host-rebind` của web-it (feature 011, T053, SC-002; contracts/device-api-011.md §1): DNS rebinding với Chrome
// thật (puppeteer-core) trên máy dev, runtime x64 của tests/web-it/compose.yaml qua cổng loopback.
// "DNS thử": cờ --host-resolver-rules của Chrome trả 127.0.0.1 (cổng của runtime) cho evil.test, other.test và
// scada.nhamay.test, như một máy chủ DNS do kẻ tấn công điều khiển trả IP của runtime. Lần tải trang đầu của evil.test
// do kịch bản trả thay (chặn bằng request interception: câu trả lời DNS đầu tiên trỏ về máy của kẻ tấn công); mọi yêu
// cầu sau đó của trang (fetch cùng origin, WebSocket) đi thật tới runtime với `Host: evil.test` ⇒ 421 HOST_NOT_ALLOWED,
// trang không đọc được gì. IP, localhost và tên trong `allowedHosts` (scada.nhamay.test, tools/web-it.ps1 ghi vào
// runtime.json trước) ⇒ 200.
//   node tests/web-it/host-rebind.mjs   (cổng: MAT_IT_HTTP_PORT, MAT_IT_HTTPS_PORT; Chrome: CHROME_PATH)
// In đúng một dòng JSON { scenario, checks, measures, pass }.
import { existsSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import puppeteer from 'puppeteer-core';

const HTTP = Number(process.env.MAT_IT_HTTP_PORT ?? 18080);
const HTTPS = Number(process.env.MAT_IT_HTTPS_PORT ?? 18443);
const ALLOWED = 'scada.nhamay.test';
const checks = [];
const measures = {};
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail: detail === '' ? undefined : String(detail) });
  return Boolean(pass);
};

function chromePath() {
  const found = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p));
  if (!found) throw new Error('Không tìm thấy Chrome: đặt CHROME_PATH');
  return found;
}

const ATTACKER_PAGE = '<!doctype html><title>evil</title><p>trang của kẻ tấn công</p>';

/** Trong trang: fetch cùng origin, trả { status, code, readable } (readable: đọc được dữ liệu của thiết bị). */
const probe = (page, path) =>
  page.evaluate(async (p) => {
    try {
      const r = await fetch(p, { cache: 'no-store' });
      const text = await r.text();
      let code = null;
      try {
        code = JSON.parse(text)?.error?.code ?? JSON.parse(text)?.error ?? null;
      } catch {
        /* không phải JSON */
      }
      return { status: r.status, code, readable: /runtimeVersion|deviceId/.test(text) };
    } catch (e) {
      return { status: -1, code: String(e), readable: false };
    }
  }, path);

/** Yêu cầu HTTPS từ Node tới runtime qua loopback (chứng chỉ tự ký của giàn thử: không kiểm); thân JSON hoặc null. */
function requestOverTls(method, path, json, token) {
  return new Promise((resolve) => {
    const body = json ? JSON.stringify(json) : undefined;
    const headers = { Host: `127.0.0.1:${HTTPS}` };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = httpsRequest(
      { host: '127.0.0.1', port: HTTPS, path, method, headers, rejectUnauthorized: false },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (text += d));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            /* không phải JSON */
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', (e) => resolve({ status: -1, body: null, error: String(e) }));
    if (body) req.write(body);
    req.end();
  });
}

const identityOverTls = (token) => requestOverTls('GET', '/api/v1/device/identity', null, token);

/** WebSocket cùng origin: true khi mở được. */
const wsOpens = (page, url) =>
  page.evaluate(
    (u) =>
      new Promise((resolve) => {
        const ws = new WebSocket(u);
        const t = setTimeout(() => resolve('timeout'), 5000);
        ws.onopen = () => {
          clearTimeout(t);
          ws.close();
          resolve('open');
        };
        ws.onerror = () => {
          clearTimeout(t);
          resolve('error');
        };
      }),
    url,
  );

async function main() {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    acceptInsecureCerts: true,
    args: [
      `--host-resolver-rules=MAP evil.test 127.0.0.1, MAP other.test 127.0.0.1, MAP ${ALLOWED} 127.0.0.1`,
      // Chrome's own Private Network Access would already block the http page of evil.test (the page is
      // "public", the runtime local): off here, so that the defence of the runtime itself is what is tested.
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  try {
    // 1. Rebinding: trang của kẻ tấn công ở evil.test, rồi tên đó trỏ về runtime.
    for (const [scheme, port] of [
      ['http', HTTP],
      ['https', HTTPS],
    ]) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      const origin = `${scheme}://evil.test:${port}`;
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.isNavigationRequest() && req.url() === `${origin}/`)
          void req.respond({ status: 200, contentType: 'text/html', body: ATTACKER_PAGE });
        else void req.continue();
      });
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      const info = await probe(page, '/api/v1/system/info');
      check(
        `${scheme}: fetch /api/v1/system/info từ trang evil.test (Host: evil.test): 421 HOST_NOT_ALLOWED, không đọc được dữ liệu`,
        info.status === 421 && info.code === 'HOST_NOT_ALLOWED' && !info.readable,
        JSON.stringify(info),
      );
      const ident = await probe(page, '/api/v1/device/identity');
      check(
        `${scheme}: /api/v1/device/identity từ evil.test: 421`,
        ident.status === 421,
        JSON.stringify(ident),
      );
      const root = await probe(page, '/');
      check(`${scheme}: trang / từ evil.test: 421`, root.status === 421, JSON.stringify(root));
      const ws = await wsOpens(
        page,
        `${scheme === 'https' ? 'wss' : 'ws'}://evil.test:${port}/api/v1/live`,
      );
      check(`${scheme}: WebSocket /api/v1/live từ evil.test không mở được`, ws !== 'open', ws);
      measures[`${scheme}Rebind`] = { info, ident, root, ws };
      await ctx.close();
    }

    // 2. Mở thẳng bằng tên lạ (không chặn): Chrome nhận 421.
    {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      const r = await page.goto(`http://other.test:${HTTP}/`, { waitUntil: 'domcontentloaded' });
      check('mở http://other.test (tên lạ): 421', r?.status() === 421, String(r?.status()));
      await ctx.close();
    }

    // 3. IP, localhost, tên trong allowedHosts: 200 và đọc được system/info.
    for (const host of ['127.0.0.1', 'localhost', ALLOWED]) {
      for (const [scheme, port] of [
        ['http', HTTP],
        ['https', HTTPS],
      ]) {
        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        const r = await page.goto(`${scheme}://${host}:${port}/`, {
          waitUntil: 'domcontentloaded',
        });
        const info = await probe(page, '/api/v1/system/info');
        check(
          `${scheme}://${host}: trang 200, system/info 200 đọc được`,
          r?.status() === 200 && info.status === 200 && info.readable,
          `${r?.status()} ${JSON.stringify(info)}`,
        );
        await ctx.close();
      }
    }
    // 4. acceptedHosts của device/identity có tên đã khai, chỉ cho request có phiên (rà soát bảo mật 011, L6):
    //    không phiên thì vắng khóa; đăng nhập xem1 (MAT_IT_PW_XEM1) rồi đọc lại bằng token.
    {
      const anon = await identityOverTls();
      check(
        'device/identity không phiên: không có acceptedHosts',
        anon.status === 200 && anon.body && !('acceptedHosts' in anon.body),
        JSON.stringify(anon),
      );
      const pw = process.env.MAT_IT_PW_XEM1;
      const login = pw
        ? await requestOverTls('POST', '/api/v1/auth/login', { user: 'xem1', password: pw })
        : { status: 0, body: null };
      const token = login.body?.token;
      const accepted = token ? ((await identityOverTls(token)).body?.acceptedHosts ?? null) : null;
      check(
        'device/identity có phiên: acceptedHosts có scada.nhamay.test, ips ["*"]',
        Array.isArray(accepted?.names) &&
          accepted.names.includes(ALLOWED) &&
          JSON.stringify(accepted.ips) === '["*"]',
        token ? JSON.stringify(accepted) : `đăng nhập xem1: ${login.status}`,
      );
      measures.acceptedHosts = accepted;
    }
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (e) {
  check('chạy hết kịch bản', false, e.stack ?? String(e));
}
console.log(
  JSON.stringify({
    scenario: 'host-rebind',
    checks,
    measures,
    pass: checks.length > 0 && checks.every((c) => c.pass),
  }),
);
