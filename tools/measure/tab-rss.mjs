// RSS tab Chrome cho L5 (feature 011, T079; contracts/test-protocols.md §1 L5 "FPS animation, RSS tab"): mở N trang
// của một URL (trang runtime-web của thiết bị, ví dụ màn hình L5) trong chrome-headless-shell, mỗi trang một ngữ cảnh
// trình duyệt riêng (tiến trình renderer riêng), giữ S giây và lấy mẫu mỗi --interval giây:
//   - RSS của tiến trình renderer của từng tab (`ps`, KB -> MB), pid gán cho tab lúc mở (pid renderer mới xuất hiện);
//   - JSHeapUsedSize của từng tab (CDP Performance.getMetrics, không ép GC);
//   - tổng RSS mọi renderer (không phụ thuộc phép gán pid).
// Báo cáo mỗi tab: đầu, cuối, tối đa, độ dốc MB/giờ (bình phương tối thiểu, cả chuỗi và sau --warmup giây).
//
//   node tools/measure/tab-rss.mjs --url <URL> [--pages 10] [--seconds 600] [--interval 10] [--warmup 60]
//        [--fingerprint <sha256> | --insecure] [--wait-js <biểu thức>] [--load-timeout 60]
//        [--chrome <đường dẫn>] [--out f.json] [--keep-samples]
//
// Chứng chỉ (URL https): --fingerprint ghim SHA-256 chứng chỉ thiết bị (dòng "SHA256 Fingerprint=" của
// `mat-runtime --cert-fingerprint`; có hoặc không có ":"): công cụ tự bắt tay TLS, so fingerprint (sai thì dừng, mã 3),
// rồi chỉ cho Chrome bỏ qua lỗi chứng chỉ của đúng khóa đó (`--ignore-certificate-errors-spki-list=<SHA-256 SPKI>`).
// --insecure: Chrome bỏ qua mọi lỗi chứng chỉ (ghi `tls.verify: "insecure"` trong JSON). URL https thiếu cả hai hoặc có
// cả hai: dùng sai (mã 2). URL http: không cần.
// --wait-js: đợi biểu thức (chạy trong trang) trả truthy trước khi tính tab là đã mở, ví dụ
//   "document.querySelector('mat-screen')?.animationCount?.() >= 50".
// Chrome: --chrome, rồi CHROME_PATH, rồi ~/.cache/mat-chrome/chrome-headless-shell/* (bản mới nhất), rồi Chrome hệ thống.
// Điều khiển Chrome bằng CDP thô qua WebSocket có sẵn của Node (≥ 22), không phụ thuộc gói nào.
// In JSON ra stdout (và --out). Mã thoát: 0 đã đo (không có ngưỡng: L5 không đặt ngưỡng RSS tab), 2 dùng sai hoặc lỗi
// chạy, 3 sai fingerprint.
import { spawn, execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeFingerprint, pinnedConnect } from './device-api.mjs';

const r1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Đối số dòng lệnh -> cấu hình; ném Error khi sai. */
export function parseArgs(argv) {
  const cfg = {
    url: '',
    pages: 10,
    seconds: 600,
    intervalS: 10,
    warmupS: 60,
    loadTimeoutS: 60,
    waitJs: '',
    chrome: '',
    out: '',
    keepSamples: false,
    fingerprint: '',
    insecure: false,
    tls: 'none',
  };
  const num = (name, v, min) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min) throw new Error(`${name}: cần số ≥ ${min}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      if (i + 1 >= argv.length) throw new Error(`${a}: thiếu giá trị`);
      return argv[++i];
    };
    switch (a) {
      case '--url':
        cfg.url = v();
        break;
      case '--pages':
        cfg.pages = num(a, v(), 1);
        break;
      case '--seconds':
        cfg.seconds = num(a, v(), 1);
        break;
      case '--interval':
        cfg.intervalS = num(a, v(), 0.5);
        break;
      case '--warmup':
        cfg.warmupS = num(a, v(), 0);
        break;
      case '--load-timeout':
        cfg.loadTimeoutS = num(a, v(), 1);
        break;
      case '--wait-js':
        cfg.waitJs = v();
        break;
      case '--chrome':
        cfg.chrome = v();
        break;
      case '--out':
        cfg.out = v();
        break;
      case '--keep-samples':
        cfg.keepSamples = true;
        break;
      case '--fingerprint': {
        const raw = v();
        cfg.fingerprint = normalizeFingerprint(raw);
        if (!cfg.fingerprint)
          throw new Error(`--fingerprint ${raw}: cần SHA-256 của chứng chỉ (64 hex)`);
        break;
      }
      case '--insecure':
        cfg.insecure = true;
        break;
      default:
        throw new Error(`đối số lạ: ${a}`);
    }
  }
  if (!cfg.url) throw new Error('thiếu --url');
  const u = new URL(cfg.url);
  if (cfg.fingerprint && cfg.insecure)
    throw new Error('--fingerprint và --insecure loại trừ nhau (exclude each other)');
  if (u.protocol === 'https:') {
    if (!cfg.fingerprint && !cfg.insecure)
      throw new Error('URL https cần --fingerprint <sha256> (hoặc --insecure, tường minh)');
    cfg.tls = cfg.fingerprint ? 'pinned' : 'insecure';
  } else if (cfg.fingerprint || cfg.insecure) {
    throw new Error('--fingerprint/--insecure chỉ dùng với URL https');
  }
  return cfg;
}

/** Độ dốc (MB/giờ) theo bình phương tối thiểu của các điểm [giây, MB]; null khi < 2 điểm hoặc cùng thời điểm. */
export function linearSlopePerHour(points) {
  const p = points.filter(([, y]) => y !== null && y !== undefined);
  if (p.length < 2) return null;
  const n = p.length;
  const mx = p.reduce((s, [x]) => s + x, 0) / n;
  const my = p.reduce((s, [, y]) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of p) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
  }
  if (sxx === 0) return null;
  return Math.round((sxy / sxx) * 3600 * 100) / 100;
}

/** Chuỗi [giây, MB|null] -> { start, end, max, samples, slopeMBPerHour, slopeAfterWarmupMBPerHour }. */
export function seriesStats(points, warmupS) {
  const p = points.filter(([, y]) => y !== null && y !== undefined);
  const ys = p.map(([, y]) => y);
  return {
    start: p.length ? r1(ys[0]) : null,
    end: p.length ? r1(ys[ys.length - 1]) : null,
    max: p.length ? r1(Math.max(...ys)) : null,
    samples: p.length,
    slopeMBPerHour: linearSlopePerHour(p),
    slopeAfterWarmupMBPerHour: linearSlopePerHour(p.filter(([t]) => t >= warmupS)),
  };
}

/** Kết quả `ps -A -o pid=,ppid=,rss=,command=` -> [{ pid, ppid, rssKB, command }]. */
export function parsePs(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], rssKB: +m[3], command: m[4].trim() });
  }
  return rows;
}

/** Pid các tiến trình `--type=renderer` là con cháu của `rootPid` (tiến trình Chrome của công cụ). */
export function rendererPids(rows, rootPid) {
  const children = new Map();
  for (const r of rows) {
    if (!children.has(r.ppid)) children.set(r.ppid, []);
    children.get(r.ppid).push(r);
  }
  const out = [];
  const stack = [...(children.get(rootPid) ?? [])];
  while (stack.length) {
    const r = stack.pop();
    if (/--type=renderer(\s|$)/.test(r.command)) out.push(r.pid);
    stack.push(...(children.get(r.pid) ?? []));
  }
  return out;
}

/**
 * Pid renderer của tab vừa mở: pid trong `now` chưa có trong `known`. Nhiều pid mới (ví dụ renderer dự phòng): lấy pid
 * RSS lớn nhất và đánh dấu mơ hồ; không có pid mới: null (mơ hồ).
 */
export function assignNewRenderer(now, known, rssKB) {
  const candidates = now.filter((p) => !known.has(p)).sort((a, b) => a - b);
  if (candidates.length === 0) return { pid: null, ambiguous: true, candidates };
  const pid = candidates.reduce((best, p) =>
    (rssKB.get(p) ?? 0) > (rssKB.get(best) ?? 0) ? p : best,
  );
  return { pid, ambiguous: candidates.length > 1, candidates };
}

function psSnapshot() {
  const text = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
  return parsePs(text);
}

function chromePath(given) {
  const cache = join(homedir(), '.cache/mat-chrome/chrome-headless-shell');
  const shells = existsSync(cache)
    ? readdirSync(cache)
        .sort()
        .reverse()
        .flatMap((v) =>
          ['mac-arm64', 'mac-x64', 'linux64', 'win64'].map((p) =>
            join(cache, v, `chrome-headless-shell-${p}`, 'chrome-headless-shell'),
          ),
        )
    : [];
  return [
    given,
    process.env.CHROME_PATH,
    ...shells,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p));
}

/** SHA-256 (base64) của SPKI chứng chỉ máy chủ, sau khi so fingerprint đã ghim (sai thì PinError). */
async function pinnedSpki(url, fingerprint) {
  const { socket } = await pinnedConnect(url, fingerprint);
  try {
    const cert = new X509Certificate(socket.getPeerCertificate().raw);
    const spki = cert.publicKey.export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(spki).digest('base64');
  } finally {
    socket.destroy();
  }
}

/** CDP thô trên WebSocket của Node: send(method, params, sessionId), waitEvent(method, sessionId, ms). */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.waiters = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (p && m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
        else if (p) p.resolve(m.result);
        return;
      }
      this.waiters = this.waiters.filter((w) => {
        if (w.method !== m.method || w.sessionId !== m.sessionId) return true;
        w.resolve(m.params);
        return false;
      });
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)), { once: true });
      ws.addEventListener('error', () => reject(new Error(`CDP: không nối được ${url}`)), {
        once: true,
      });
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  waitEvent(method, sessionId, ms) {
    return new Promise((resolve, reject) => {
      const w = { method, sessionId, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        if (!this.waiters.includes(w)) return;
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`${method}: quá ${ms} ms`));
      }, ms);
    });
  }

  close() {
    this.ws.close();
  }
}

function launchChrome(path, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(path, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => reject(new Error(`Chrome không mở cổng CDP: ${err}`)), 30000);
    proc.stderr.on('data', (d) => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, wsUrl: m[1] });
      }
    });
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome thoát (${code}): ${err.slice(0, 500)}`));
    });
  });
}

async function run(cfg) {
  const executable = chromePath(cfg.chrome);
  if (!executable) throw new Error('Không tìm thấy Chrome: --chrome hoặc CHROME_PATH');
  const tls = { verify: cfg.tls === 'pinned' ? 'pinned-spki' : cfg.tls };
  const args = [
    '--headless',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1366,768',
    '--lang=vi-VN',
  ];
  if (cfg.tls === 'pinned') {
    const spki = await pinnedSpki(cfg.url, cfg.fingerprint);
    Object.assign(tls, { fingerprint: cfg.fingerprint, spkiSha256: spki });
    args.push(`--ignore-certificate-errors-spki-list=${spki}`);
  } else if (cfg.tls === 'insecure') {
    args.push('--ignore-certificate-errors');
  }
  const userDir = mkdtempSync(join(tmpdir(), 'mat-tab-rss-'));
  args.push(`--user-data-dir=${userDir}`, 'about:blank');
  const { proc, wsUrl } = await launchChrome(executable, args);
  const exited = new Promise((r) => proc.once('exit', r));
  const startedAt = new Date().toISOString();
  let cdp;
  try {
    cdp = await Cdp.connect(wsUrl);
    const version = (await cdp.send('Browser.getVersion')).product;
    const known = new Set(rendererPids(psSnapshot(), proc.pid));
    const tabs = [];
    for (let i = 0; i < cfg.pages; i++) {
      const { browserContextId } = await cdp.send('Target.createBrowserContext');
      const { targetId } = await cdp.send('Target.createTarget', {
        url: 'about:blank',
        browserContextId,
      });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Performance.enable', {}, sessionId);
      const loaded = cdp.waitEvent('Page.loadEventFired', sessionId, cfg.loadTimeoutS * 1000);
      const nav = await cdp.send('Page.navigate', { url: cfg.url }, sessionId);
      if (nav.errorText) throw new Error(`tab ${i + 1}: ${cfg.url}: ${nav.errorText}`);
      await loaded;
      if (cfg.waitJs) {
        const t0 = Date.now();
        for (;;) {
          const r = await cdp.send(
            'Runtime.evaluate',
            { expression: cfg.waitJs, returnByValue: true },
            sessionId,
          );
          if (r.result?.value) break;
          if (Date.now() - t0 > cfg.loadTimeoutS * 1000)
            throw new Error(`tab ${i + 1}: --wait-js chưa đúng sau ${cfg.loadTimeoutS} s`);
          await sleep(250);
        }
      }
      await sleep(500); // renderer cũ (about:blank) thoát sau khi đổi tiến trình
      const rows = psSnapshot();
      const now = rendererPids(rows, proc.pid);
      const rss = new Map(rows.map((r) => [r.pid, r.rssKB]));
      const a = assignNewRenderer(now, known, rss);
      for (const p of now) known.add(p);
      tabs.push({ index: i + 1, targetId, sessionId, ...a, rss: [], heap: [] });
    }
    const pids = tabs.map((t) => t.pid).filter((p) => p !== null);
    const mappingOk = tabs.every((t) => !t.ambiguous) && new Set(pids).size === tabs.length;
    const total = [];
    const t0 = performance.now();
    const deadline = t0 + cfg.seconds * 1000;
    for (;;) {
      const t = Math.round((performance.now() - t0) / 100) / 10;
      const rows = psSnapshot();
      const rss = new Map(rows.map((r) => [r.pid, r.rssKB]));
      const all = rendererPids(rows, proc.pid);
      total.push([t, r1(all.reduce((s, p) => s + (rss.get(p) ?? 0), 0) / 1024), all.length]);
      for (const tab of tabs) {
        const kb = tab.pid === null ? undefined : rss.get(tab.pid);
        tab.rss.push([t, kb === undefined ? null : r1(kb / 1024)]);
        const m = await cdp
          .send('Performance.getMetrics', {}, tab.sessionId)
          .then((x) => x.metrics.find((k) => k.name === 'JSHeapUsedSize')?.value ?? null)
          .catch(() => null);
        tab.heap.push([t, m === null ? null : r1(m / 1048576)]);
      }
      if (performance.now() + cfg.intervalS * 1000 > deadline) break;
      await sleep(cfg.intervalS * 1000 - ((performance.now() - t0) % (cfg.intervalS * 1000)));
    }
    const result = {
      format: 'mat-tab-rss',
      formatVersion: 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      url: cfg.url,
      config: {
        pages: cfg.pages,
        seconds: cfg.seconds,
        intervalS: cfg.intervalS,
        warmupS: cfg.warmupS,
        waitJs: cfg.waitJs || null,
      },
      chrome: { path: executable, version },
      tls,
      method:
        'RSS: ps của tiến trình renderer gán cho tab (pid mới khi mở tab, mỗi tab một ngữ cảnh); jsHeap: CDP Performance.getMetrics JSHeapUsedSize, không ép GC; độ dốc: bình phương tối thiểu MB/giờ',
      mapping: {
        ok: mappingOk,
        note: mappingOk
          ? 'mỗi tab một renderer riêng'
          : 'có tab không gán được pid chắc chắn: xem candidates; dùng renderersTotal',
      },
      tabs: tabs.map((tab) => ({
        index: tab.index,
        pid: tab.pid,
        ambiguous: tab.ambiguous,
        candidates: tab.candidates,
        rssMB: seriesStats(tab.rss, cfg.warmupS),
        jsHeapMB: seriesStats(tab.heap, cfg.warmupS),
        ...(cfg.keepSamples ? { samples: tab.rss.map(([t, r], k) => [t, r, tab.heap[k][1]]) } : {}),
      })),
      renderersTotal: {
        count: total.length ? total[total.length - 1][2] : 0,
        rssMB: seriesStats(
          total.map(([t, v]) => [t, v]),
          cfg.warmupS,
        ),
      },
    };
    const rssMax = result.tabs.map((x) => x.rssMB.max).filter((v) => v !== null);
    result.summary = {
      tabRssMaxMB: rssMax.length ? Math.max(...rssMax) : null,
      tabRssEndMB: result.tabs.map((x) => x.rssMB.end),
      tabRssSlopeMaxMBPerHour: Math.max(
        ...result.tabs.map((x) => x.rssMB.slopeAfterWarmupMBPerHour ?? -Infinity),
      ),
      jsHeapMaxMB: Math.max(...result.tabs.map((x) => x.jsHeapMB.max ?? -Infinity)),
    };
    for (const k of ['tabRssSlopeMaxMBPerHour', 'jsHeapMaxMB'])
      if (!Number.isFinite(result.summary[k])) result.summary[k] = null;
    return result;
  } finally {
    try {
      await cdp?.send('Browser.close');
    } catch {
      /* đã đóng */
    }
    cdp?.close();
    const killer = setTimeout(() => proc.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(killer);
    rmSync(userDir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let cfg;
  try {
    cfg = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(2);
  }
  try {
    const result = await run(cfg);
    const text = JSON.stringify(result, null, 2);
    if (cfg.out) writeFileSync(cfg.out, text + '\n');
    console.log(text);
    process.exit(0);
  } catch (e) {
    console.error(String(e.stack ?? e));
    process.exit(e?.code === 'cert-mismatch' ? 3 : 2);
  }
}
