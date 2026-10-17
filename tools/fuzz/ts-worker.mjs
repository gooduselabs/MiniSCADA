// Worker của tools/fuzz/ts-fuzz.mjs: nạp mục tiêu, chạy ca tuần tự, ghi số ca đang chạy vào bộ nhớ chung để tiến trình
// chính phát hiện treo. Cũng xuất loadTarget/runOne cho chế độ chạy lại một ca.
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { caseRng } from './ts-lib.mjs';

export const SLOW_MS = 5000;

export async function loadTarget(name) {
  const mod = await import(`./targets/${name}.mjs`);
  const ctx = await mod.setup();
  return { mod, ctx };
}

/** Một ca: `{ problems, counters, ms }`. Ngoại lệ thoát ra khỏi `check` cũng là sự cố. */
export async function runOne(t, input) {
  const t0 = performance.now();
  let res;
  try {
    res = await t.mod.check(t.ctx, input);
  } catch (e) {
    res = { problems: ['ném ngoại lệ: ' + String(e?.stack ?? e).slice(0, 1500)] };
  }
  const ms = performance.now() - t0;
  const problems = res.problems ?? [];
  if (ms > SLOW_MS) problems.push(`chậm ${Math.round(ms)} ms`);
  return { problems, counters: res.counters ?? [], ms };
}

if (!isMainThread && workerData) {
  const { target, seed, startCase, maxCases, deadline, shared } = workerData;
  const t = await loadTarget(target);
  parentPort.postMessage({ type: 'ready' });
  let batch = { cases: 0, slow: 0, maxMs: 0, counters: {} };
  let lastPost = Date.now();
  const flush = () => {
    parentPort.postMessage({ type: 'stats', ...batch });
    batch = { cases: 0, slow: 0, maxMs: 0, counters: {} };
    lastPost = Date.now();
  };
  let c = startCase;
  for (; ; c++) {
    if ((maxCases > 0 && c >= maxCases) || Date.now() >= deadline) break;
    Atomics.store(shared, 0, c);
    let input;
    let res;
    try {
      input = t.mod.generate(t.ctx, caseRng(seed, c), c);
      res = await runOne(t, input);
    } catch (e) {
      res = {
        problems: ['sinh ca ném: ' + String(e?.stack ?? e).slice(0, 800)],
        counters: [],
        ms: 0,
      };
    }
    batch.cases++;
    Atomics.add(shared, 1, 1);
    batch.maxMs = Math.max(batch.maxMs, res.ms);
    if (res.ms > SLOW_MS) batch.slow++;
    if (res.ms > 1000) parentPort.postMessage({ type: 'slow', case: c, ms: Math.round(res.ms) });
    for (const k of res.counters) batch.counters[k] = (batch.counters[k] ?? 0) + 1;
    if (res.problems.length > 0)
      parentPort.postMessage({
        type: 'finding',
        finding: { seed, case: c, problems: res.problems.map((p) => String(p).slice(0, 600)) },
      });
    if (Date.now() - lastPost > 1000) flush();
  }
  flush();
  parentPort.postMessage({ type: 'end', next: c });
}
