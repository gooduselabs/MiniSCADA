// Lấy mẫu CPU và RSS của mat-runtime từ trong container `client` (chung PID namespace với rt; feature 008, T108, SC-007).
//   node proc-sample.mjs --seconds <N> [--interval 5]
// Đọc /proc/<pid>/stat (utime + stime, đơn vị 1/100 s) và VmRSS. CPU tính theo % của MỘT lõi (BL335 là Cortex-A7 một lõi: 100 % là hết
// lõi). In đúng một dòng JSON khi hết thời gian: { samples, cpuAvgPct, cpuMaxWindowPct, rssStartMB, rssAvgMB, rssMaxMB, rssEndMB, ... }.
import { readFileSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const seconds = Number(opt('--seconds', '60'));
const interval = Number(opt('--interval', '5')) * 1000;
const TICKS = 100;

function runtimePid() {
  for (const d of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      if (readFileSync(`/proc/${d}/cmdline`, 'utf8').startsWith('/build/x64/bin/mat-runtime'))
        return Number(d);
    } catch {
      // đã thoát
    }
  }
  return 0;
}
function read(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const cpu = (Number(f[11]) + Number(f[12])) / TICKS; // utime, stime (giây CPU)
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
  const threads = Number(/Threads:\s+(\d+)/.exec(status)?.[1] ?? 0);
  return { cpu, rss, threads, t: Date.now() };
}

const pid = runtimePid();
if (!pid) {
  console.log(JSON.stringify({ error: 'không thấy mat-runtime' }));
  process.exit(0);
}
const first = read(pid);
const samples = [first];
const end = first.t + seconds * 1000;
let restarts = 0;
while (Date.now() < end) {
  await new Promise((r) => setTimeout(r, Math.min(interval, Math.max(0, end - Date.now()))));
  try {
    samples.push(read(pid));
  } catch {
    restarts++;
    break;
  }
}
const last = samples.at(-1);
const wall = (last.t - first.t) / 1000;
const windows = [];
for (let i = 1; i < samples.length; i++)
  windows.push(
    ((samples[i].cpu - samples[i - 1].cpu) / ((samples[i].t - samples[i - 1].t) / 1000)) * 100,
  );
const rss = samples.map((s) => s.rss);
const r1 = (x) => Math.round(x * 10) / 10;
console.log(
  JSON.stringify({
    pid,
    samples: samples.length,
    wallSeconds: r1(wall),
    cpuAvgPct: r1(((last.cpu - first.cpu) / wall) * 100),
    cpuMaxWindowPct: r1(Math.max(0, ...windows)),
    cpuSecondsTotal: r1(last.cpu - first.cpu),
    rssStartMB: r1(first.rss),
    rssAvgMB: r1(rss.reduce((a, b) => a + b, 0) / rss.length),
    rssMaxMB: r1(Math.max(...rss)),
    rssEndMB: r1(last.rss),
    threads: last.threads,
    runtimeGone: restarts > 0,
  }),
);
