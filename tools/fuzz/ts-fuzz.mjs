// Fuzz tất định phía TypeScript (feature 011, T058, T142; FR-029, SC-009). Mỗi mục tiêu ở tools/fuzz/targets/:
//   project-json    validateProject (@mat/project-schema) trên project đột biến (mọi định dạng 0.1 đến 1.0)
//   expression      compile/evaluate/tokens của @mat/expression trên biểu thức đột biến, đầu vào hữu hạn
//   params          substituteParams/checkParamPlaces (template, faceplate) trên item và args đột biến
//   package-digest  digestText/packageDigest (phía TS của gói .matscada: không có bộ đọc gói TS)
//   logic-json      logic.schema.json + checkLogic + LogicHarness (@mat/logic-engine) trên logic.json đột biến
// Ca chạy trong worker; tiến trình chính canh: một ca quá 5 giây không xong là "treo" (ghi lại, chạy tiếp từ ca sau).
// Sự cố = ném ngoại lệ không phải lỗi kiểm tra, ca > 5 giây, hoặc vi phạm bất biến của mục tiêu.
// Dùng:
//   node tools/fuzz/ts-fuzz.mjs --target <tên> [--seconds 3600] [--max-cases N] [--seed 20261017] [--out r.json]
//                               [--report docs/reports/011-fuzz-x64.json]   (gộp vào khóa ts.targets.<tên>)
//   node tools/fuzz/ts-fuzz.mjs --target <tên> --seed S --case C [--dump ca.json]   (chạy lại một ca, in đầu vào)
//   node tools/fuzz/ts-fuzz.mjs --target <tên> --check ca.json                      (kiểm một đầu vào đã rút gọn)
// Mã thoát: 0 = 0 sự cố, 1 = có sự cố, 2 = sai tham số.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

export const TARGETS = ['project-json', 'expression', 'params', 'package-digest', 'logic-json'];
export const HANG_MS = 5000;

const args = process.argv.slice(2);
const opt = (n, d = '') => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const target = opt('--target');
// `_selftest`: mục tiêu giả của ts-fuzz.test.mjs (không tính là mục tiêu fuzz).
if (!TARGETS.includes(target) && target !== '_selftest') {
  console.error(`--target phải là một trong: ${TARGETS.join(', ')}`);
  process.exit(2);
}
const SEED = Number(opt('--seed', '20261017'));
const SECONDS = Number(opt('--seconds', '0'));
const MAX_CASES = Number(opt('--max-cases', SECONDS > 0 ? '0' : '2000'));
const out = opt('--out');
const report = opt('--report');
const single = opt('--case');
const dump = opt('--dump');
const checkFile = opt('--check');
const workerUrl = new URL('./ts-worker.mjs', import.meta.url);

if (single !== '' || checkFile !== '') {
  // Chạy lại một ca trong chính tiến trình này (không canh treo).
  const { loadTarget, runOne } = await import('./ts-worker.mjs');
  const t = await loadTarget(target);
  const input =
    checkFile !== ''
      ? JSON.parse(readFileSync(resolve(checkFile), 'utf8'))
      : t.mod.generate(
          t.ctx,
          (await import('./ts-lib.mjs')).caseRng(SEED, Number(single)),
          Number(single),
        );
  if (dump) writeFileSync(resolve(dump), JSON.stringify(input, null, 1) + '\n');
  const res = await runOne(t, input);
  console.log(JSON.stringify({ target, seed: SEED, case: single, ...res }, null, 2));
  process.exit(res.problems.length === 0 ? 0 : 1);
}

const started = Date.now();
const deadline = SECONDS > 0 ? started + SECONDS * 1000 : Infinity;
const stats = {
  cases: 0,
  slowOver5s: 0,
  hangs: 0,
  maxMs: 0,
  counters: {},
  findings: [],
  slowOver1s: 0,
  slowSamples: [],
};
let findingsTotal = 0;

function runWorker(startCase) {
  return new Promise((done) => {
    // [0] ca đang chạy, [1] số ca xong của worker này (để không mất số ca khi worker bị dừng vì treo)
    const shared = new Int32Array(new SharedArrayBuffer(8));
    shared[0] = startCase;
    let reported = 0;
    const addUnreported = () => (stats.cases += Atomics.load(shared, 1) - reported);
    const w = new Worker(workerUrl, {
      workerData: { target, seed: SEED, startCase, maxCases: MAX_CASES, deadline, shared },
    });
    let last = startCase;
    let lastChange = Date.now();
    let ended = false;
    let setupDone = false;
    const timer = setInterval(() => {
      const cur = Atomics.load(shared, 0);
      if (cur !== last || !setupDone) {
        last = cur;
        lastChange = Date.now();
        return;
      }
      if (!ended && Date.now() - lastChange > HANG_MS) {
        ended = true;
        clearInterval(timer);
        stats.hangs++;
        findingsTotal++;
        addUnreported();
        if (stats.findings.length < 50)
          stats.findings.push({ seed: SEED, case: cur, problems: [`treo > ${HANG_MS} ms`] });
        w.terminate().then(() => done({ next: cur + 1 }));
      }
    }, 250);
    w.on('message', (m) => {
      if (m.type === 'ready') {
        setupDone = true;
        lastChange = Date.now();
      } else if (m.type === 'stats') {
        stats.cases += m.cases;
        reported += m.cases;
        stats.slowOver5s += m.slow;
        stats.maxMs = Math.max(stats.maxMs, m.maxMs);
        for (const [k, v] of Object.entries(m.counters))
          stats.counters[k] = (stats.counters[k] ?? 0) + v;
      } else if (m.type === 'slow') {
        stats.slowOver1s++;
        if (stats.slowSamples.length < 20) stats.slowSamples.push({ case: m.case, ms: m.ms });
      } else if (m.type === 'finding') {
        findingsTotal++;
        if (stats.findings.length < 50) stats.findings.push(m.finding);
      } else if (m.type === 'end') {
        ended = true;
        clearInterval(timer);
        done({ next: m.next, finished: true });
      }
    });
    w.on('error', (e) => {
      if (ended) return;
      ended = true;
      clearInterval(timer);
      findingsTotal++;
      addUnreported();
      stats.findings.push({
        seed: SEED,
        case: Atomics.load(shared, 0),
        problems: ['worker: ' + (e?.stack ?? e)],
      });
      done({ next: Atomics.load(shared, 0) + 1 });
    });
  });
}

let next = 0;
for (;;) {
  const r = await runWorker(next);
  next = r.next;
  if (r.finished) break;
  if (Date.now() >= deadline || (MAX_CASES > 0 && next >= MAX_CASES)) break;
}

const seconds = Math.round((Date.now() - started) / 1000);
const result = {
  tool: 'tools/fuzz/ts-fuzz.mjs',
  target,
  date: new Date(started).toISOString().slice(0, 10),
  seed: SEED,
  seconds,
  cases: stats.cases,
  casesPerSecond: Math.round(stats.cases / Math.max(1, (Date.now() - started) / 1000)),
  crashes: findingsTotal,
  hangs: stats.hangs,
  slowOver5s: stats.slowOver5s,
  slowOver1s: stats.slowOver1s,
  slowSamples: stats.slowSamples,
  maxMs: Math.round(stats.maxMs),
  counters: stats.counters,
  findingSamples: stats.findings,
  machine: `${process.platform} ${process.arch}, ${cpus()[0]?.model ?? '?'}, Node ${process.version}`,
};
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify(result, null, 2) + '\n');
}
if (report) {
  const p = resolve(report);
  const j = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  j.ts ??= { description: '', targets: {} };
  j.ts.targets[target] = result;
  writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}
console.log(
  JSON.stringify({ ...result, findingSamples: result.findingSamples.slice(0, 3) }, null, 2),
);
process.exit(findingsTotal === 0 && stats.slowOver5s === 0 ? 0 : 1);
