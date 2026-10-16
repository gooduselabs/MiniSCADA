// SC-020 trên runtime x64 thật (feature 010): mở trang báo cáo #/report/<id> bằng Chrome headless (viewer), dựng từng báo cáo,
// so từng ô với bản tham chiếu độc lập tools/history-ref (tính từ API history/aggregate của chính runtime), rồi tải CSV, XLSX, PDF
// và so với bảng trên màn hình. Ghi artefact vào --out-dir và kết quả JSON vào --out.
//   MAT_IT_PW_XEM1=... node tests/web-it/browser-sc020.mjs --base https://localhost:18453 --out-dir <dir> --out <json>
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import puppeteer from 'puppeteer-core';
import { formatVi, reportPeriod, reportTable } from '../../tools/history-ref/ref.mjs';
import { until } from '../../apps/runtime-web/tests/e2e/util.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const base = opt('--base', 'https://localhost:18453');
const outDir = resolve(opt('--out-dir', join(root, 'apps/studio/tests/e2e/out/sc020')));
const outJson = resolve(opt('--out', join(root, 'docs/reports/010-reports-x64.json')));
const projectDir = resolve(
  opt('--project', join(root, 'apps/studio/tests/e2e/out/010-reports-project')),
);
const user = process.env.MAT_IT_USER_XEM1 ?? 'xem1';
const secret = process.env.MAT_IT_PW_XEM1 ?? '';
mkdirSync(outDir, { recursive: true });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail: detail === '' ? undefined : String(detail) });
  return Boolean(pass);
};
const reports = [];

const chromePath = () =>
  [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p));

// ---- API ------------------------------------------------------------------------------------
const agent = new https.Agent({ rejectUnauthorized: false });
const u = new URL(base);
const call = (path, token, body) =>
  new Promise((ok, no) => {
    const r = https.request(
      {
        host: u.hostname,
        port: u.port,
        path,
        method: body ? 'POST' : 'GET',
        agent,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            : {}),
        },
      },
      (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () => ok({ status: res.statusCode, j: JSON.parse(s) }));
      },
    );
    r.on('error', no);
    if (body) r.write(body);
    r.end();
  });

const tzMs = (tz) => {
  const m = /^([+-])(\d\d):(\d\d)$/.exec(tz);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
};

/** Bucket cửa sổ theo hàng của kỳ, từ API aggregate (mỗi lô ≤ 16 Tag): { tagId: [bucket|null] }. */
async function windows(token, group, tags, period) {
  const q = new URLSearchParams({
    group,
    tags: tags.join(','),
    from: String(period.from),
    to: String(period.to),
    bucketMs: String(period.bucketMs),
    offsetMs: String(period.offsetMs),
    priority: 'user',
  });
  const r = await call(`/api/v1/history/aggregate?${q}`, token);
  if (r.status !== 200) throw new Error(`aggregate ${r.status} ${JSON.stringify(r.j)}`);
  const out = {};
  for (const s of r.j.series)
    out[s.tagId] = s.n.map((n, i) =>
      n === 0
        ? null
        : {
            n,
            min: s.min[i],
            max: s.max[i],
            first: s.first[i],
            last: s.last[i],
            sumw: s.sumw[i],
            wms: s.wms[i],
          },
    );
  return { buckets: out, source: r.j.source };
}

// ---- trang ------------------------------------------------------------------------------------
async function login(page) {
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.type('dialog[open] input[autocomplete="username"]', user);
  await page.type('dialog[open] input[autocomplete="current-password"]', secret);
  await page.keyboard.press('Enter');
  await until(async () => !(await page.$eval('#app-user', (b) => b.hidden)), 'đăng nhập', 20000);
}

const scrape = (page) =>
  page.evaluate(() => {
    const t = document.querySelector('table.rpt');
    if (!t) return null;
    const txt = (e) => e.textContent.replace(/\s+/g, ' ').trim();
    const heads = [...t.querySelectorAll('thead th')].map(txt);
    const rows = [...t.querySelectorAll('tbody tr')].map((tr) => ({
      total: tr.classList.contains('total'),
      cells: [...tr.children].map(txt),
      pending: Boolean(tr.querySelector('td.pending')),
    }));
    return {
      heads,
      rows,
      h2: txt(document.querySelector('h2') ?? t),
      note: [...document.querySelectorAll('.rpt-out p')].map(txt),
    };
  });

const now = Date.now();
const localDay = (tz) => {
  const d = new Date(now + tzMs(tz));
  const p2 = (n) => String(n).padStart(2, '0');
  return {
    d: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`,
    m: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`,
  };
};

const tplFile = JSON.parse(readFileSync(join(projectDir, 'reports.json'), 'utf8'));
const csvRows = (buf) => {
  let s = Buffer.from(buf)
    .toString('utf8')
    .replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
};

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  args: ['--no-first-run', '--lang=vi-VN', '--ignore-certificate-errors'],
  defaultViewport: { width: 1366, height: 900 },
});
let failed = false;
try {
  const apiLogin = await call(
    '/api/v1/auth/login',
    null,
    JSON.stringify({ user, password: secret }),
  );
  const token = apiLogin.j.token;
  const cat = await call('/api/v1/history/catalog', token);
  const grp = cat.j.groups.find((g) => g.id === 'dien');
  const tz = grp.timeZone;
  const sel = localDay(tz);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await page.createCDPSession();
  const dl = join(outDir, 'downloads');
  mkdirSync(dl, { recursive: true });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await page.goto(`${base}/#/report/${tplFile.reports[0].id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app-login-btn', { timeout: 20000 });
  await login(page);

  for (const tpl of tplFile.reports) {
    const rep = {
      id: tpl.id,
      name: tpl.name,
      period: tpl.period,
      cellsCompared: 0,
      cellsMatched: 0,
    };
    reports.push(rep);
    const month = tpl.period === 'month';
    const hash = `#/report/${tpl.id}?${month ? `m=${sel.m}` : `d=${sel.d}`}`;
    await page.evaluate((h) => {
      location.hash = h;
    }, hash);
    await page.waitForSelector('#rpt-period', { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 300));
    const t0 = Date.now();
    await page.click('button.view');
    try {
      await page.waitForSelector('table.rpt', { timeout: 30000 });
    } catch (e) {
      const msg = await page.evaluate(() => document.body.innerText.slice(0, 400));
      await page.screenshot({ path: join(outDir, `${tpl.id}-fail.png`) });
      throw new Error(`không có bảng báo cáo: ${msg}`, { cause: e });
    }
    rep.buildMs = Date.now() - t0;
    const screen = await scrape(page);
    rep.rows = screen.rows.length;
    rep.heads = screen.heads;
    rep.note = screen.note;

    // Chuẩn tham chiếu: kỳ + bucket từ API + reportTable (tools/history-ref, độc lập với @mat/history-math).
    const period = reportPeriod(tpl, month ? { m: sel.m } : { d: sel.d }, tz, 'Ca');
    const tags = [...new Set(tpl.columns.map((c) => c.tagId))];
    const w = await windows(token, tpl.group, tags, period);
    const tagInfo = {};
    for (const t of grp.tags) tagInfo[t.tagId] = { unit: t.unit };
    // thời điểm "bây giờ" của trang nằm trong ± vài giây; hàng chưa tới được chọn theo start >= now
    const ref = reportTable(tpl, period, w.buckets, Date.now(), tagInfo);
    rep.source = w.source;
    const refText = ref.rows.map((r) => ({
      label: r.label,
      pending: r.pending,
      cells: r.cells.map((v, i) => formatVi(v, ref.columns[i].decimals)),
    }));
    const refTotal = ref.totals
      ? ref.totals.map((v, i) => formatVi(v, ref.columns[i].decimals))
      : null;
    const body = screen.rows.filter((r) => !r.total);
    const totalRow = screen.rows.find((r) => r.total);
    check(
      `${tpl.id}: số hàng ${refText.length} + dòng tổng`,
      body.length === refText.length && Boolean(totalRow) === Boolean(refTotal),
      `${body.length}/${refText.length}`,
    );
    check(
      `${tpl.id}: số cột ${1 + ref.columns.length} (thời gian + (cột, hàm))`,
      screen.heads.length === 1 + ref.columns.length,
      screen.heads.join(' | '),
    );
    const mism = [];
    const cmp = (a, b, where) => {
      rep.cellsCompared++;
      if (a === b) rep.cellsMatched++;
      else mism.push(`${where}: màn hình "${a}" ≠ tham chiếu "${b}"`);
    };
    body.forEach((r, i) => {
      if (!refText[i]) return;
      cmp(r.cells[0], refText[i].label, `hàng ${i} nhãn`);
      if (refText[i].pending) {
        if (!r.pending) mism.push(`hàng ${i}: phải "chưa tới"`);
        return;
      }
      refText[i].cells.forEach((c, j) => cmp(r.cells[1 + j] ?? '', c, `hàng ${i} cột ${j}`));
    });
    if (totalRow && refTotal)
      refTotal.forEach((c, j) => cmp(totalRow.cells[1 + j] ?? '', c, `tổng cột ${j}`));
    rep.mismatches = mism.slice(0, 10);
    rep.dataRows = refText.filter((r) => !r.pending && r.cells.some((c) => c !== '')).length;
    check(
      `${tpl.id}: ${rep.cellsMatched}/${rep.cellsCompared} ô (nhãn, giá trị, tổng) khớp history-ref (${rep.dataRows} hàng có dữ liệu)`,
      rep.cellsCompared > 0 && mism.length === 0 && rep.dataRows > 0,
      mism.slice(0, 3).join(' ; '),
    );

    // Xuất tệp: CSV, CSV Excel vi-VN, XLSX, PDF
    const files = {};
    rep.exports = {};
    for (const cls of ['csv', 'csv-vi', 'xlsx', 'pdf']) {
      const before = new Set(readdirSync(dl));
      const t1 = Date.now();
      await page.click(`.rpt-bar button.${cls}`);
      let name = null;
      await until(
        async () => {
          const now2 = readdirSync(dl).filter((f) => !before.has(f) && !f.endsWith('.crdownload'));
          if (now2.length) name = now2[0];
          return Boolean(name);
        },
        `tải ${cls}`,
        30000,
      );
      await new Promise((r) => setTimeout(r, 200));
      rep.exports[cls] = {
        file: name,
        ms: Date.now() - t1,
        bytes: readFileSync(join(dl, name)).length,
      };
      files[cls] = readFileSync(join(dl, name));
    }
    // CSV: mọi ô dữ liệu bằng ô trên màn hình
    for (const cls of ['csv', 'csv-vi']) {
      const rows = csvRows(files[cls]);
      const flat = rows.map((r) => r.map((x) => x.trim()));
      // tìm hàng có nhãn của hàng đầu tiên
      const start = flat.findIndex((r) => r[0] === body[0].cells[0]);
      let ok = start >= 0;
      let n = 0;
      let bad = 0;
      if (ok) {
        const all = [...body.map((r) => r.cells), ...(totalRow ? [totalRow.cells] : [])];
        all.forEach((cells, i) => {
          const r = flat[start + i] ?? [];
          cells.forEach((c, j) => {
            if (cls === 'csv' && j > 0) return; // CSV chuẩn: số dạng máy (dấu chấm), so ở bước số thực bên dưới
            n++;
            if ((r[j] ?? '') !== c) bad++;
          });
        });
      }
      rep.exports[cls].rows = rows.length;
      rep.exports[cls].labelCellsCompared = n;
      rep.exports[cls].labelCellsMismatch = bad;
      check(
        `${tpl.id}: ${cls.toUpperCase()} có BOM và các hàng khớp màn hình`,
        files[cls][0] === 0xef && ok && bad === 0,
        `hàng đầu ở ${start}, lệch ${bad}`,
      );
    }
    // CSV máy: số thực so với giá trị làm tròn của màn hình
    {
      const flat = csvRows(files.csv).map((r) => r.map((x) => x.trim()));
      const start = flat.findIndex((r) => r[0] === body[0].cells[0]);
      let n = 0;
      let bad = 0;
      body.forEach((r, i) => {
        const cr = flat[start + i] ?? [];
        r.cells.slice(1).forEach((c, j) => {
          if (c === '' || r.pending) return;
          n++;
          const screenNum = Number(c.replace(/\./g, '').replace(',', '.'));
          if (!(Math.abs(Number(cr[1 + j]) - screenNum) <= 0.0051)) bad++;
        });
      });
      rep.exports.csv.numberCellsCompared = n;
      rep.exports.csv.numberCellsMismatch = bad;
      check(`${tpl.id}: CSV số thực khớp màn hình (${n - bad}/${n} ô)`, n > 0 && bad === 0);
    }
    // XLSX: giải nén, đọc sharedStrings + sheet1
    {
      const z = unzipSync(new Uint8Array(files.xlsx));
      const names = Object.keys(z);
      const sheet = Buffer.from(z['xl/worksheets/sheet1.xml']).toString('utf8');
      const sst = z['xl/sharedStrings.xml']
        ? Buffer.from(z['xl/sharedStrings.xml']).toString('utf8')
        : '';
      const strs = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''),
      );
      const dec = (s) =>
        s
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, '&');
      const cells = new Map();
      for (const m of sheet.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const t = /t="(\w+)"/.exec(m[3])?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(m[4] ?? '')?.[1];
        const is = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(m[4] ?? '')?.[1];
        let val = null;
        if (t === 's' && v !== undefined) val = dec(strs[Number(v)] ?? '');
        else if (t === 'inlineStr' && is !== undefined) val = dec(is);
        else if (v !== undefined) val = Number(v);
        cells.set(`${m[1]}${m[2]}`, val);
      }
      const col = (i) => String.fromCharCode(65 + i);
      const labelRow = [...new Set([...cells.keys()].map((k) => Number(k.slice(1))))]
        .sort((a, b) => a - b)
        .find((r) => cells.get(`A${r}`) === body[0].cells[0]);
      let n = 0;
      let bad = 0;
      if (labelRow !== undefined) {
        const all = [...body.map((r) => r), ...(totalRow ? [totalRow] : [])];
        all.forEach((r, i) => {
          if (cells.get(`A${labelRow + i}`) !== r.cells[0] && !r.total) bad++;
          if (r.pending) return;
          r.cells.slice(1).forEach((c, j) => {
            if (c === '') return;
            n++;
            const screenNum = Number(c.replace(/\./g, '').replace(',', '.'));
            const x = cells.get(`${col(1 + j)}${labelRow + i}`);
            if (!(typeof x === 'number' && Math.abs(x - screenNum) <= 0.0051)) bad++;
          });
        });
      }
      rep.exports.xlsx.entries = names.length;
      rep.exports.xlsx.cellsCompared = n;
      rep.exports.xlsx.cellsMismatch = bad;
      check(
        `${tpl.id}: XLSX khớp màn hình (${n - bad}/${n} ô số, nhãn hàng)`,
        labelRow !== undefined && n > 0 && bad === 0,
        `labelRow=${labelRow}`,
      );
    }
    // PDF: chữ trích ra phải chứa nhãn hàng và các ô
    {
      const pdf = files.pdf;
      rep.exports.pdf.header = Buffer.from(pdf.subarray(0, 5)).toString('latin1');
      const { getDocumentProxy, extractText } = await import('unpdf');
      const doc = await getDocumentProxy(new Uint8Array(pdf));
      const { text, totalPages } = await extractText(doc, { mergePages: true });
      rep.exports.pdf.pages = totalPages;
      const flatT = text.replace(/\s+/g, ' ');
      let n = 0;
      let bad = 0;
      const miss = [];
      for (const r of [...body, ...(totalRow ? [totalRow] : [])]) {
        if (r.pending) continue;
        for (const c of r.cells) {
          if (c === '') continue;
          n++;
          if (!flatT.includes(c)) {
            bad++;
            if (miss.length < 3) miss.push(c);
          }
        }
      }
      rep.exports.pdf.cellsCompared = n;
      rep.exports.pdf.cellsMissing = bad;
      check(
        `${tpl.id}: PDF (%PDF, ${totalPages} trang) chứa ${n - bad}/${n} ô của màn hình`,
        rep.exports.pdf.header === '%PDF-' && n > 0 && bad === 0,
        miss.join(' ; '),
      );
    }
    writeFileSync(
      join(outDir, `${tpl.id}.screen.json`),
      JSON.stringify({ screen, ref: { refText, refTotal } }, null, 2),
    );
  }
  check('0 lỗi JavaScript trên trang', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
} catch (e) {
  check('chạy hết kịch bản', false, e.stack ?? String(e));
  failed = true;
} finally {
  await browser.close();
}
const pass = !failed && checks.every((c) => c.pass);
const result = {
  note: 'Đo trên runtime x64 thật (container mat-armhf, binary x64), Chrome headless, viewer. Dữ liệu là mô phỏng của runtime; tham chiếu = tools/history-ref tính từ API history/aggregate của chính runtime.',
  date: new Date().toISOString(),
  base,
  reports,
  checks,
  pass,
};
mkdirSync(dirname(outJson), { recursive: true });
writeFileSync(outJson, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      pass,
      reports: reports.map((r) => ({
        id: r.id,
        buildMs: r.buildMs,
        match: `${r.cellsMatched}/${r.cellsCompared}`,
      })),
      failing: checks.filter((c) => !c.pass),
    },
    null,
    1,
  ),
);
process.exit(pass ? 0 : 1);
