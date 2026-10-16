// Scenario reload of tools/device-it.ps1 (specs/005-device-online T126; FR-025, SC-006 on x64):
// 10 tabs of headless Chrome (puppeteer-core, as the e2e of 004) show the viewer of rt1; a deploy
// of another project makes every tab reload and show the new project within 10 s.
// Runs on the host, not in the Docker client: rt1 publishes 8080 and 8443 on 127.0.0.1 through
// tests/device-it/compose.ports.yaml (18080, 18443). The password: MAT_IT_PW_KYSU2 (environment).
//   node tests/device-it/reload-tabs.mjs --fp <fingerprint> [--tabs 10]
// Prints one JSON object { scenario, checks, measures, pass } like client.mjs.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deployPackage,
  diagnostics,
  login,
  versions,
  waitOperation,
} from '../../tools/measure/device-api.mjs';
import { buildPackage, readProjectDir, variant } from './pack.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const root = fileURLToPath(new URL('../..', import.meta.url));

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const fp = opt('--fp', '');
const TABS = Number(opt('--tabs', '10'));
const BASE = 'https://127.0.0.1:18443';
const VIEW = 'http://127.0.0.1:18080/';

const checks = [];
const measures = {};
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail: detail === '' ? undefined : detail });
  return Boolean(pass);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round1 = (x) => Math.round(x * 10) / 10;

function chromePath() {
  const found = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p));
  if (!found) throw new Error('Chrome/Edge not found: set CHROME_PATH');
  return found;
}

let browser;
let error;
try {
  const pw = process.env.MAT_IT_PW_KYSU2;
  if (!pw) throw new Error('MAT_IT_PW_KYSU2 missing');
  const l = await login(BASE, fp, 'kysu2', pw);
  const token = l.json?.token;
  check('đăng nhập kysu2 qua cổng 18443', l.status === 200, l.status);
  const act = (await versions(BASE, fp, token)).json?.versions?.find((v) => v.state === 'active');

  browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const pages = [];
  for (let i = 0; i < TABS; i++) {
    const p = await browser.newPage();
    await p.goto(VIEW, { waitUntil: 'load', timeout: 20000 });
    await p.evaluate(() => {
      window.__mark = true;
    });
    pages.push(p);
  }
  // all tabs hold a live session
  let live = 0;
  for (let i = 0; i < 80 && live < TABS; i++) {
    live = (await diagnostics(BASE, fp, token)).json?.clients?.live ?? 0;
    if (live < TABS) await sleep(250);
  }
  check(`${TABS} tab đang xem, thiết bị đếm ${live} kết nối live`, live >= TABS, `live=${live}`);

  // The deploy of a project with another version (the digest changes: the tabs reload).
  const tank = readProjectDir(join(root, 'projects/tank-demo'));
  const pkg = buildPackage(variant(tank, { projectVersion: '7.0.0' }));
  const t0 = performance.now();
  const r = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, act?.digest ?? 'none');
  check('nạp xuống 202', r.status === 202, `${r.status} ${r.json?.error}`);
  const reloadedAt = new Array(TABS).fill(null);
  let committedAt = null;
  const waiter = waitOperation(BASE, fp, token, r.json?.opId, { timeoutMs: 60000 }).then((w) => {
    committedAt = performance.now();
    return w;
  });
  const deadline = performance.now() + 45000;
  while (performance.now() < deadline && reloadedAt.some((x) => x === null)) {
    await Promise.all(
      pages.map(async (p, i) => {
        if (reloadedAt[i] !== null) return;
        try {
          if ((await p.evaluate(() => window.__mark === true)) === false)
            reloadedAt[i] = performance.now();
        } catch {
          /* navigating */
        }
      }),
    );
    await sleep(100);
  }
  const w = await waiter;
  check(
    'nạp xuống committed',
    w.op?.result === 'committed',
    `${w.op?.result} ${w.op?.error?.code}`,
  );
  check(
    `cả ${TABS} tab đã tải lại`,
    reloadedAt.every((x) => x !== null),
    String(reloadedAt.filter(Boolean).length),
  );
  const lastReload = Math.max(...reloadedAt.map((x) => x ?? Infinity));
  const sinceCommit = (lastReload - committedAt) / 1000;
  check(
    'FR-025 / SC-006: tab cuối tải lại <= 10 s sau khi nạp xuống xong',
    sinceCommit <= 10,
    `${round1(sinceCommit)} s`,
  );
  // the new project is shown: what the page loaded says version 7.0.0
  let newOnes = 0;
  for (const p of pages) {
    try {
      await p.waitForFunction(() => document.readyState === 'complete', { timeout: 10000 });
      const v = await p.evaluate(
        async () => (await (await fetch('/api/v1/projects/active')).json()).project?.projectVersion,
      );
      if (v === '7.0.0') newOnes++;
    } catch {
      /* counted as not new */
    }
  }
  check(`${TABS} tab thấy project mới (7.0.0)`, newOnes === TABS, `${newOnes}/${TABS}`);
  let live2 = 0;
  for (let i = 0; i < 60 && live2 < TABS; i++) {
    live2 = (await diagnostics(BASE, fp, token)).json?.clients?.live ?? 0;
    if (live2 < TABS) await sleep(250);
  }
  check('sau khi tải lại, các tab kết nối live lại', live2 >= TABS, `live=${live2}`);
  measures.reload = {
    tabs: TABS,
    packageBytes: pkg.bytes.length,
    deployMs: round1(w.ms),
    deployToLastReloadS: round1((lastReload - t0) / 1000),
    committedToLastReloadS: round1(sinceCommit),
    firstReloadFromPostS: round1((Math.min(...reloadedAt.filter(Boolean)) - t0) / 1000),
    chrome: await browser.version(),
  };
} catch (e) {
  error = e.stack ?? String(e);
} finally {
  await browser?.close().catch(() => {});
}
process.stdout.write(
  `${JSON.stringify({ scenario: 'reload', checks, measures, error, pass: !error && checks.length > 0 && checks.every((c) => c.pass) })}\n`,
);
process.exit(0);
