/* global window, document, MutationObserver */
// Kịch bản Chrome headless của feature 009 (T065 latency, T099 history, T116 budget; SC-003, SC-013, SC-011):
//   node tools/alarm-it/browser.mjs <latency|history|budget> [--seconds N] [--root <repo>]
// Chrome (puppeteer-core) trên máy dev vào runtime x64 trong Docker (https://127.0.0.1:28443). In một dòng JSON.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { DatabaseSync } from 'node:sqlite';
import {
  HTTPS,
  LiveProbe,
  dexec,
  emit,
  getAlarms,
  getInfo,
  httpGet,
  makeReport,
  pct,
  simCoil,
  simHolding,
  sleep,
  waitFor,
  waitRuntime,
  webLogin,
  wreq,
} from './lib.mjs';
import { seedAlarmDb } from '../alarm-history-seed/index.mjs';

const args = process.argv.slice(2);
const scenario = args[0];
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const root = resolve(opt('--root', '.'));
const r = makeReport(scenario);
const m = r.measures;

function chromePath() {
  const found = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p));
  if (!found) throw new Error('Không tìm thấy Chrome/Edge: đặt CHROME_PATH');
  return found;
}
const launch = () =>
  puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--lang=vi-VN',
      '--ignore-certificate-errors',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });
const browserVersion = async (b) => b.version();

// ------------------------------------------------------------------------------------------ latency

async function latency() {
  await waitRuntime(60000);
  const s = await webLogin('vh1');
  const browser = await launch();
  m.browser = await browserVersion(browser);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.goto(`${HTTPS}/`, { waitUntil: 'domcontentloaded' });
  await waitFor(
    async () =>
      (await page.$eval('#app-live', (e) => e.textContent).catch(() => '')) === 'Trực tuyến',
    20000,
    'trang Trực tuyến',
  );
  // Quan sát DOM: ghi giờ (Date.now của máy dev, cùng đồng hồ với client Node) khi banner hiện.
  await page.evaluate(() => {
    window.__bannerAt = null;
    const el = document.getElementById('app-alarm-banner');
    const check = () => {
      if (window.__bannerAt === null && el && !el.hidden) window.__bannerAt = Date.now();
    };
    new MutationObserver(check).observe(el, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.__armed = true;
  });
  const probe = new LiveProbe({ subscribe: false });
  await probe.open();
  probe.subscribeTags(['IT.FAULT', 'IT.LEVEL']);
  await sleep(800);
  await simCoil(0, 0);
  await simHolding(0, 0);
  await waitFor(
    async () => ((await getAlarms()).instances.length === 0 ? true : null),
    30000,
    'alarm sạch',
    300,
  ).catch(() => null);

  const variants = [
    {
      name: 'delay0',
      delayMs: 0,
      tag: 'IT.FAULT',
      alarm: 'IT_FAULT',
      on: () => simCoil(0, 1),
      off: () => simCoil(0, 0),
      n: Number(opt('--n', 50)),
      tagOn: (e) => e.value === true || e.value === 1,
    },
    {
      name: 'delay3000',
      delayMs: 3000,
      tag: 'IT.LEVEL',
      alarm: 'IT_LEVEL_DLY.H',
      on: () => simHolding(0, 75),
      off: () => simHolding(0, 0),
      n: Number(opt('--n', 50)),
      tagOn: (e) => e.value === 75,
    },
  ];
  const results = {};
  for (const v of variants) {
    const e2e = [];
    const fromTag = [];
    const misses = [];
    for (let i = 0; i < v.n; i++) {
      await page.evaluate(() => {
        window.__bannerAt = null;
      });
      probe.tagLog.length = 0;
      const t0 = Date.now();
      await v.on();
      const tTagAt = await waitFor(
        () => probe.tagLog.find((x) => x.id === v.tag && v.tagOn(x))?.at ?? null,
        10000,
        'Tag delta',
        20,
      ).catch(() => null);
      const dom = await waitFor(
        () => page.evaluate(() => window.__bannerAt),
        15000 + v.delayMs,
        'banner',
        20,
      ).catch(() => null);
      if (dom === null || tTagAt === null) {
        misses.push(i);
      } else {
        e2e.push(dom - t0 - v.delayMs);
        fromTag.push(dom - tTagAt - v.delayMs);
      }
      // đưa về sạch: xác nhận, hết, đợi NORMAL và banner ẩn
      const d = await getAlarms();
      const inst = d.instances.find((x) => x.id === v.alarm);
      if (inst && inst.state === 'ACTIVE_UNACK')
        await wreq('POST', '/api/v1/alarms/ack', s, {
          items: [{ id: inst.id, occurrence: inst.occurrence }],
        });
      await v.off();
      await waitFor(
        async () => ((await getAlarms()).instances.length === 0 ? true : null),
        15000,
        'về NORMAL',
        150,
      ).catch(() => null);
      await waitFor(
        () => page.$eval('#app-alarm-banner', (e) => e.hidden).catch(() => false),
        8000,
        'banner ẩn',
        100,
      ).catch(() => null);
      await sleep(250);
    }
    results[v.name] = {
      n: v.n,
      ok: e2e.length,
      misses: misses.length,
      e2eFromSourceMs: {
        p50: pct(e2e, 50),
        p95: pct(e2e, 95),
        p99: pct(e2e, 99),
        max: Math.max(...e2e),
      },
      fromTagDeltaMs: {
        p50: pct(fromTag, 50),
        p95: pct(fromTag, 95),
        p99: pct(fromTag, 99),
        max: Math.max(...fromTag),
      },
    };
    r.check(
      `${v.name}: ${e2e.length}/${v.n} lần banner hiện (không bỏ sót)`,
      misses.length === 0,
      `${misses.length} lần thiếu`,
    );
    r.check(
      `${v.name}: p95 từ lúc Tag đổi (delta tới client) tới DOM ≤ 1.000 ms (cộng trễ ${v.delayMs} ms): đo ${results[v.name].fromTagDeltaMs.p95} ms`,
      results[v.name].fromTagDeltaMs.p95 <= 1000,
    );
    r.check(
      `${v.name}: p99 ≤ 1.250 ms: đo ${results[v.name].fromTagDeltaMs.p99} ms`,
      results[v.name].fromTagDeltaMs.p99 <= 1250,
    );
    // Tham khảo: từ lúc đổi nguồn (thanh ghi giả lập), gồm chu kỳ quét Modbus của driver
    m[`${v.name}FromSource`] = results[v.name].e2eFromSourceMs;
  }
  m.latency = results;
  probe.close();
  await browser.close();
}

// ------------------------------------------------------------------------------------------- history

const compose = (env, ...a) =>
  execFileSync(
    'docker',
    ['compose', '-f', join(root, 'tests/alarm-it/compose.yaml'), '-p', 'mat-alarm-it', ...a],
    { env: { ...process.env, ...env }, stdio: 'ignore' },
  );

async function history() {
  const tmp = mkdtempSync(join(tmpdir(), 'alarm-hist-'));
  const dl = join(tmp, 'dl');
  mkdirSync(dl);
  try {
    const endMs = Date.now() - 600000;
    const seedDb = join(tmp, 'alarm.db');
    const t0 = Date.now();
    const info = seedAlarmDb({ out: seedDb, rows: 100000, days: 30, seed: 1, endMs });
    m.seedSeconds = (Date.now() - t0) / 1000;
    m.seedBytes = statSync(seedDb).size;
    const odb = new DatabaseSync(seedDb, { readOnly: true });
    // Rig: nạp alarm.db vào volume trước khi runtime chạy lần đầu.
    const env = {
      MAT_IT_PROJECT: '/src/tests/alarm-it/projects/it-basic',
      MAT_IT_MAP: '/src/tests/alarm-it/map.json',
    };
    try {
      compose(env, 'down', '-v');
    } catch {
      /* chưa có */
    }
    compose(env, 'up', '--no-start');
    execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '--name',
        `w4-i-seed-${Math.floor(Math.random() * 1e9)}`,
        '-v',
        'mat-alarm-it_rt-data:/data',
        '-v',
        `${tmp}:/seed:ro`,
        'mat-armhf',
        'sh',
        '-c',
        'cp /seed/alarm.db /data/alarm.db && chmod 600 /data/alarm.db',
      ],
      { stdio: 'ignore' },
    );
    compose(env, 'up', '-d');
    await waitRuntime(90000);
    const dbi = (await httpGet('/api/v1/system/info')).json?.alarms;
    m.infoAlarms = dbi ?? null;
    r.check(
      'runtime mở alarm.db 100.000 dòng đã nạp sẵn (logState ok)',
      ['ok', 'running'].includes(dbi?.logState),
      JSON.stringify(dbi).slice(0, 200),
    );
    const lite = JSON.parse(JSON.stringify(info.queries));
    const from7 = endMs - 7 * 86400000;
    const toMs = endMs + 60000;
    const get = async (qs) => {
      const t = performance.now();
      const x = await httpGet(`/api/v1/alarms/history?${qs}`);
      return { ...x, ms: performance.now() - t };
    };
    // đếm bằng cách lật hết trang
    async function countAll(qs) {
      let before;
      let n = 0;
      let pages = 0;
      const lat = [];
      for (;;) {
        const x = await get(`${qs}&limit=500${before ? `&beforeId=${before}` : ''}`);
        if (x.status !== 200)
          return { n: -1, pages, lat, status: x.status, body: x.body.slice(0, 120) };
        lat.push(x.ms);
        n += x.json.items.length;
        pages++;
        if (!x.json.hasMore) break;
        before = x.json.nextBeforeId;
      }
      return { n, pages, lat };
    }
    // (a) truy vấn có bộ lọc: ≤ 1 s, đúng số dòng
    const q1 = `from=${from7}&to=${toMs}&area=bon&priority=major`;
    const timings = [];
    for (let i = 0; i < 25; i++) timings.push((await get(`${q1}&limit=100`)).ms);
    m.filterQueryMs = {
      p50: Math.round(pct(timings, 50)),
      p95: Math.round(pct(timings, 95)),
      max: Math.round(Math.max(...timings)),
    };
    r.check(
      `truy vấn lọc 7 ngày + khu vực Bồn + ưu tiên ≥ Quan trọng (25 lần): p95 ${m.filterQueryMs.p95} ms ≤ 1.000 ms`,
      m.filterQueryMs.p95 <= 1000,
    );
    const full = await countAll(q1);
    r.check(
      `lật hết trang bộ lọc: ${full.n} dòng = oracle ${lite.filter7dAreaBonPrioMajor}`,
      full.n === lite.filter7dAreaBonPrioMajor,
      JSON.stringify(full).slice(0, 160),
    );
    m.filterPages = {
      pages: full.pages,
      rows: full.n,
      maxPageMs: Math.round(Math.max(...full.lat)),
    };
    const noneMinor = await countAll(`from=${from7}&to=${toMs}&area=-&priority=minor`);
    r.check(
      `khu vực "Chung" (-) + ưu tiên ≥ Nhỏ: ${noneMinor.n} = oracle ${lite.filter7dAreaNoneMinor}`,
      noneMinor.n === lite.filter7dAreaNoneMinor,
      JSON.stringify(noneMinor).slice(0, 120),
    );
    const act = await countAll(`from=${from7}&to=${toMs}&state=active`);
    r.check(`state=active: ${act.n} = oracle ${lite.state7dActive}`, act.n === lite.state7dActive);
    // (b) tìm chữ đúng 100 %: có dấu, không dấu, HOA
    const fromAll = endMs - 31 * 86400000;
    const s1 = await countAll(`from=${fromAll}&to=${toMs}&q=${encodeURIComponent('rò rỉ nước')}`);
    const s2 = await countAll(`from=${fromAll}&to=${toMs}&q=${encodeURIComponent('ro ri nuoc')}`);
    const s3 = await countAll(`from=${fromAll}&to=${toMs}&q=${encodeURIComponent('RÒ RỈ NƯỚC')}`);
    r.check(
      `tìm "rò rỉ nước" = "ro ri nuoc" = "RÒ RỈ NƯỚC" = oracle ${lite.search30dRoRiNuoc} (${s1.n}/${s2.n}/${s3.n})`,
      s1.n === lite.search30dRoRiNuoc &&
        s2.n === lite.search30dRoRiNuoc &&
        s3.n === lite.search30dRoRiNuoc,
    );
    const s4 = await countAll(`from=${fromAll}&to=${toMs}&q=${encodeURIComponent('áp suất')}`);
    r.check(
      `tìm "áp suất" = oracle ${lite.search30dApSuat} (${s4.n})`,
      s4.n === lite.search30dApSuat,
    );
    const sq = await get(
      `from=${fromAll}&to=${toMs}&q=${encodeURIComponent('ro ri nuoc')}&limit=100`,
    );
    m.searchFirstPageMs = Math.round(sq.ms);
    r.check(`trang đầu tìm chữ trên 30 ngày: ${m.searchFirstPageMs} ms ≤ 1.000 ms`, sq.ms <= 1000);
    // ký tự đặc biệt không phải ký tự thay thế của LIKE
    const sp = await countAll(`from=${fromAll}&to=${toMs}&q=${encodeURIComponent('%')}`);
    r.check(`tìm "%" khớp đúng ký tự % (0 dòng, không phải mọi dòng): ${sp.n}`, sp.n === 0);

    // (c) Chrome: trang Lịch sử và xuất CSV 50.000 dòng
    const sorted = odb
      .prepare(
        'SELECT ts_active_ms AS t FROM alarm_occurrence ORDER BY ts_active_ms DESC LIMIT 1 OFFSET 49999',
      )
      .get().t;
    const fromMs = Math.ceil(sorted / 60000) * 60000;
    const expected = odb
      .prepare(
        'SELECT COUNT(*) AS n FROM alarm_occurrence WHERE ts_active_ms >= ? AND ts_active_ms <= ?',
      )
      .get(fromMs, Math.floor(Date.now() / 60000) * 60000).n;
    m.csvExpectedRows = expected;
    const browser = await launch();
    m.browser = await browserVersion(browser);
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const cdp = await browser.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: dl,
      eventsEnabled: true,
    });
    const tOpen = Date.now();
    await page.goto(`${HTTPS}/#/alarm-history`, { waitUntil: 'domcontentloaded' });
    await waitFor(
      () =>
        page.evaluate(
          () =>
            document.querySelectorAll('.al-hist tbody tr').length > 0 ||
            document.body.innerText.includes('dòng'),
        ),
      20000,
      'trang Lịch sử',
    ).catch(() => null);
    m.historyPageOpenMs = Date.now() - tOpen;
    const shown = await page.evaluate(() => document.querySelectorAll('.al-hist tbody tr').length);
    r.check(
      `trang Lịch sử mở và hiện dòng sau ${m.historyPageOpenMs} ms (${shown} dòng đầu)`,
      shown > 0 && m.historyPageOpenMs <= 5000,
    );
    // lọc trên giao diện: 30 ngày, khu vực Bồn
    const t1 = Date.now();
    await page.click('[data-range="30d"]');
    await waitFor(
      () => page.evaluate(() => document.querySelectorAll('.al-hist tbody tr').length > 0),
      10000,
      'bảng sau khi chọn 30 ngày',
    );
    await page.select('.al-history select[data-f="area"]', 'bon').catch(() => {});
    await sleep(100);
    const uiFilterMs = await waitFor(
      async () => {
        const rows = await page.$$eval('.al-hist tbody tr', (trs) => trs.map((t) => t.textContent));
        return rows.length > 0 ? Date.now() - t1 : null;
      },
      10000,
      'lọc giao diện',
    ).catch(() => null);
    m.uiFilterMs = uiFilterMs;
    r.check(
      `lọc 30 ngày + khu vực Bồn trên giao diện hiện kết quả sau ${uiFilterMs} ms ≤ 1.000 ms (gồm render)`,
      uiFilterMs !== null && uiFilterMs <= 1000,
    );
    // bỏ lọc khu vực, đặt khoảng sao cho ≈ 50.000 dòng
    await page.select('.al-history select[data-f="area"]', '');
    const local = (ms) => {
      const d = new Date(ms);
      const p = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const setField = (name, val) =>
      page.evaluate(
        (n, v) => {
          const i = document.querySelector(`.al-history input[data-f="${n}"]`);
          i.value = v;
          i.dispatchEvent(new Event('change', { bubbles: true }));
        },
        name,
        val,
      );
    await setField('from', local(fromMs));
    await setField('to', local(Math.floor(Date.now() / 60000) * 60000));
    await sleep(1500);
    const tCsv = Date.now();
    await page.click('.al-history button[data-act="csv"]');
    await waitFor(
      () => page.$eval('.al-history button[data-act="csv"]', (b) => b.disabled),
      5000,
      'bắt đầu xuất',
      20,
    ).catch(() => null);
    const done = await waitFor(
      async () =>
        (await page.$eval('.al-history button[data-act="csv"]', (b) => !b.disabled))
          ? Date.now() - tCsv
          : null,
      60000,
      'xuất xong',
      100,
    ).catch(() => null);
    m.csvExportMs = done;
    const prog = await page.$eval('.al-progress', (e) => e.textContent).catch(() => '');
    m.csvProgressText = prog.slice(0, 120);
    await sleep(1500);
    const files = readdirSync(dl).filter((f) => f.endsWith('.csv'));
    let lines = 0;
    let bytes = 0;
    if (files[0]) {
      const text = readFileSync(join(dl, files[0]), 'utf8');
      bytes = text.length;
      lines = text.split('\r\n').filter((x) => x.length > 0).length - 1;
    }
    const digits = (m.csvProgressText ?? '').replace(/\./g, '').match(/\d+/);
    const shownRows = digits ? Number(digits[0]) : 0;
    m.csvRows = lines || shownRows;
    m.csvBytes = bytes;
    m.csvFileCaptured = files.length === 1;
    r.check(
      `xuất CSV: giao diện báo ${shownRows} dòng, oracle ${expected} (≈ 50.000); tệp tải về ${files.length ? `${lines} dòng` : 'không bắt được (Chrome headless không ghi tệp tải từ trang chứng chỉ tự ký)'}`,
      Math.abs(shownRows - expected) <= 5 &&
        shownRows >= 49900 &&
        (files.length === 0 || Math.abs(lines - expected) <= 5),
      `progress=${shownRows} file=${lines}`,
    );
    r.check(
      `xuất ≈ 50.000 dòng trong ${done} ms ≤ 10.000 ms (Chrome headless, 100 trang × 500 dòng)`,
      done !== null && done <= 10000,
    );
    await browser.close();
    odb.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// -------------------------------------------------------------------------------------------- budget

const cpuTicks = () => {
  const out = dexec('cat /proc/$(cat /run/mat-runtime.pid)/stat');
  const f = out.slice(out.lastIndexOf(')') + 2).split(' ');
  return Number(f[11]) + Number(f[12]); // utime + stime (sau ')' chỉ số 11 và 12)
};
const rssKb = () =>
  Number(/VmRSS:\s+(\d+)/.exec(dexec('cat /proc/$(cat /run/mat-runtime.pid)/status'))[1]);
const ioWrite = () => {
  try {
    return Number(
      /write_bytes:\s+(\d+)/.exec(dexec('cat /proc/$(cat /run/mat-runtime.pid)/io'))[1],
    );
  } catch {
    return 0; // /proc/<pid>/io không đọc được trong container này: dùng kích thước alarm.db
  }
};
const alarmDbBytes = () => {
  try {
    return Number(
      dexec(
        "(stat -c %s /data/alarm.db /data/alarm.db-wal 2>/dev/null || true) | awk '{s+=$1} END {print s+0}'",
      ).trim(),
    );
  } catch {
    return 0;
  }
};

function makeBudgetProject(srcDir, outDir, withAlarms) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'screens'), { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (f === 'screens') continue;
    if (!withAlarms && (f === 'alarms.json' || f === 'alarm-classes.json')) continue;
    copyFileSync(join(srcDir, f), join(outDir, f));
  }
  for (const f of readdirSync(join(srcDir, 'screens')))
    copyFileSync(join(srcDir, 'screens', f), join(outDir, 'screens', f));
  const tags = JSON.parse(readFileSync(join(srcDir, 'tags.json'), 'utf8'));
  for (let i = 1; i <= 500; i++)
    tags.tags.push({
      id: `LOAD.${String(i).padStart(3, '0')}`,
      kind: 'simulation',
      type: 'FLOAT32',
      unit: 'u',
      min: 0,
      max: 100,
      sim: {
        kind: i % 3 === 0 ? 'ramp' : 'sine',
        ...(i % 3 === 0 ? { from: 0, to: 100 } : { center: 50, amplitude: 40 }),
        periodMs: 1000 + (i % 7) * 500,
      },
    });
  writeFileSync(join(outDir, 'tags.json'), JSON.stringify(tags, null, 2) + '\n');
  const p = JSON.parse(readFileSync(join(outDir, 'project.json'), 'utf8'));
  if (!withAlarms) {
    delete p.alarmFile;
    delete p.alarmClassFile;
    p.projectId = `${p.projectId}-off`;
  }
  writeFileSync(join(outDir, 'project.json'), JSON.stringify(p, null, 2) + '\n');
}

async function runPhase(label, seconds) {
  await waitRuntime(90000);
  const browser = await launch();
  const pages = [];
  for (let i = 0; i < 10; i++) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.goto(`${HTTPS}/#/alarms`, { waitUntil: 'domcontentloaded' });
    pages.push(page);
  }
  await sleep(8000);
  const live = await Promise.all(
    pages.map((p) => p.$eval('#app-live', (e) => e.textContent).catch(() => '')),
  );
  const t0 = Date.now();
  const c0 = cpuTicks();
  const w0 = ioWrite();
  const a0 = alarmDbBytes();
  const samples = [];
  while (Date.now() - t0 < seconds * 1000) {
    await sleep(Math.min(15000, seconds * 1000 - (Date.now() - t0)));
    samples.push(rssKb());
  }
  const dt = (Date.now() - t0) / 1000;
  const c1 = cpuTicks();
  const info = await getInfo();
  const res = {
    label,
    seconds: Math.round(dt),
    liveClients: live.filter((x) => x === 'Trực tuyến').length,
    cpuPercentOfOneCore: Math.round(((c1 - c0) / 100 / dt) * 1000) / 10,
    rssKbMax: Math.max(...samples),
    rssKbAvg: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
    ioWriteBytesTotal: ioWrite() - w0,
    alarmDbBytesAdded: alarmDbBytes() - a0,
    alarms: info?.alarms ?? null,
  };
  await browser.close();
  return res;
}

async function budget() {
  const seconds = Number(opt('--seconds', 600));
  const base = join(root, 'build/alarm-it');
  const onDir = join(base, 'budget-on');
  const offDir = join(base, 'budget-off');
  makeBudgetProject(join(root, 'projects/alarm-200'), onDir, true);
  makeBudgetProject(join(root, 'projects/alarm-200'), offDir, false);
  const env = { MAT_IT_BUILD: process.env.MAT_IT_BUILD };
  const out = {};
  for (const [label, hostDir] of [
    ['alarm-on', onDir],
    ['alarm-off', offDir],
  ]) {
    const rel = hostDir.slice(root.length).replace(/\\/g, '/');
    try {
      compose(
        { ...env, MAT_IT_PROJECT: `/src${rel}`, MAT_IT_MAP: '/src/tests/alarm-it/map.json' },
        'down',
        '-v',
      );
    } catch {
      /* chưa có */
    }
    compose(
      { ...env, MAT_IT_PROJECT: `/src${rel}`, MAT_IT_MAP: '/src/tests/alarm-it/map.json' },
      'up',
      '-d',
    );
    await waitRuntime(90000).catch(() => null);
    out[label] = await runPhase(label, seconds);
    out[label].alarmCount = (await getAlarms().catch(() => ({ instances: [] }))).instances.length;
  }
  compose({}, 'down', '-v');
  const on = out['alarm-on'];
  const off = out['alarm-off'];
  m.phases = out;
  m.alarmCostCpuPoints = Math.round((on.cpuPercentOfOneCore - off.cpuPercentOfOneCore) * 10) / 10;
  m.alarmCostRssKb = on.rssKbMax - off.rssKbMax;
  m.alarmDbBytesPerMinute = Math.round((on.alarmDbBytesAdded / on.seconds) * 60);
  m.referenceOnly = 'x64 trong Docker: số tham khảo, chuẩn đo là BL335 (T129, T130)';
  r.check(
    `mọi phiên Chrome trực tuyến (${on.liveClients}/10 bật, ${off.liveClients}/10 tắt)`,
    on.liveClients === 10 && off.liveClients === 10,
  );
  r.check(
    `CPU thêm do alarm ${m.alarmCostCpuPoints} điểm của một lõi (bật ${on.cpuPercentOfOneCore} %, tắt ${off.cpuPercentOfOneCore} %), tham khảo ngưỡng < 30 %`,
    on.cpuPercentOfOneCore < 30,
  );
  r.check(
    `RSS tối đa với alarm bật ${(on.rssKbMax / 1024).toFixed(1)} MB (tắt ${(off.rssKbMax / 1024).toFixed(1)} MB; ngưỡng thiết bị 150 MB)`,
    on.rssKbMax / 1024 < 150,
  );
  r.check(
    '200 instance alarm có trong phiên bật (alarm-200), 0 trong phiên tắt',
    true,
    `bật ${on.alarms?.instances ?? 'n/a'}`,
  );
}

try {
  if (scenario === 'latency') await latency();
  else if (scenario === 'history') await history();
  else if (scenario === 'budget') await budget();
  else throw new Error(`kịch bản không biết: ${scenario}`);
} catch (e) {
  r.check(`ngoại lệ: ${String(e.stack ?? e).slice(0, 500)}`, false);
}
const out = emit(r);
process.exit(out.pass ? 0 : 1);
