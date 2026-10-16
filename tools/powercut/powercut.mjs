#!/usr/bin/env node
// Power-cut controller (feature 011, T073; FR-041, FR-042, contract test-protocols.md §4).
//
// Each round runs the six steps of contract §4:
//   1. wait until the device is READY (HTTPS GET /api/v1/system/info answers 2xx; self-signed cert accepted) and has
//      stayed READY for --stable-s (60 s);
//   2. choose the cut time: uniform random in [0, --max-delay-s] (300 s), or an event of the device / command
//      generator log (D1 deploy step, D3 history.db-wal > 4 MiB, D4 pulse journal not empty, D5 retain write);
//   3. cut the power (Tasmota plug, USB serial relay, or manual prompt); wait 5 s; power on;
//   4. wait READY at most --ready-timeout-s (90 s), time recorded;
//   5. run --check-cmd (e.g. `ssh root@dev mat-runtime --check-data --json`) and the audit cross-check: every
//      requestId the command generator logged as ACCEPTED before the cut must be in the --audit-cmd export;
//   6. append the round JSON to <out>.rounds.jsonl; on the first failure stop, keep the device as it is (no fix, no
//      further cut) and print what to investigate.
// The summary goes to --out (docs/reports/011-powercut-<x64|bl335>.json).
//
// Exit code: 0 every round passed and every criterion was measured; 1 a round failed; 3 incomplete (no failure, but
// something not measured, e.g. no audit source); 64 usage error.
//
// Usage (BL335, Tasmota plug):
//   node tools/powercut/powercut.mjs --driver tasmota --tasmota-url http://<tasmota-ip> \
//     --base-url https://<bl335-ip>:8443 --rounds 100 \
//     --check-cmd "ssh root@<bl335-ip> /opt/mat-runtime/bin/mat-runtime --check-data --json" \
//     --audit-cmd "ssh root@<bl335-ip> /opt/mat-runtime/bin/mat-runtime --export-audit --json" \
//     --accepted-log out/cmdgen.jsonl --target bl335 --out docs/reports/011-powercut-bl335.json
// USB relay (LCUS-1): --driver serial --tty /dev/ttyUSB0 (set the line first: stty -F /dev/ttyUSB0 9600 raw -echo).
// Event rounds: --mode event --point D3 --event-cmd "ssh root@dev tail -F /run/mat-sample/samples-*.jsonl"
//               or --event-log <file> (tailed), optional --event-pattern <regex> instead of the preset matcher.
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { appendFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

/**
 * LCUS-1 USB relay frames: start 0xA0, channel 0x01, state (0x01 closed = on, 0x00 open = off), checksum = sum.
 * Contract §4 names `A0 01 01 A2`; with the BL335 supply on the normally-open contact that frame powers it on.
 */
export const LCUS1 = { on: 'A0 01 01 A2', off: 'A0 01 00 A1' };

const MiB = 1024 * 1024;

export function parseHex(text) {
  const parts = String(text)
    .trim()
    .split(/[\s:,]+/)
    .filter(Boolean);
  if (!parts.length) throw new Error('chuỗi hex rỗng');
  return Buffer.from(
    parts.map((p) => {
      if (!/^(0x)?[0-9a-fA-F]{2}$/.test(p)) throw new Error(`byte hex không hợp lệ: ${p}`);
      return parseInt(p.replace(/^0x/, ''), 16);
    }),
  );
}

/** GET with a timeout; https accepts the self-signed device certificate. Never throws: status 0 on error. */
export function httpGet(url, { timeoutMs = 5000, insecure = true } = {}) {
  return new Promise((done) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      done({ status: 0, body: '', error: e.message });
      return;
    }
    const mod = u.protocol === 'https:' ? https : http;
    const opts = u.protocol === 'https:' ? { rejectUnauthorized: !insecure } : {};
    const req = mod.get(u, opts, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        if (body.length < 1_000_000) body += c;
      });
      res.on('end', () => done({ status: res.statusCode ?? 0, body }));
      res.on('error', (e) => done({ status: 0, body, error: e.message }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${timeoutMs} ms`)));
    req.on('error', (e) => done({ status: 0, body: '', error: e.message }));
  });
}

// ---------- drivers ----------

export function tasmotaDriver({ baseUrl, get = httpGet }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const send = async (state) => {
    const r = await get(`${base}/cm?cmnd=Power%20${state}`);
    if (r.status !== 200)
      throw new Error(`Tasmota Power ${state}: HTTP ${r.status} ${r.error ?? ''}`.trim());
    let j;
    try {
      j = JSON.parse(r.body);
    } catch {
      throw new Error(`Tasmota Power ${state}: trả lời không phải JSON (POWER?)`);
    }
    const got = j.POWER ?? j.POWER1;
    if (String(got).toUpperCase() !== state.toUpperCase()) {
      throw new Error(`Tasmota Power ${state}: ổ cắm báo POWER=${got}`);
    }
    return { reply: j };
  };
  return { name: 'tasmota', off: () => send('Off'), on: () => send('On') };
}

export function serialRelayDriver({
  tty,
  onHex = LCUS1.on,
  offHex = LCUS1.off,
  write = (p, b) => appendFile(p, b),
}) {
  const on = parseHex(onHex);
  const off = parseHex(offHex);
  return {
    name: 'serial',
    off: async () => {
      await write(tty, off);
      return { bytes: off.toString('hex') };
    },
    on: async () => {
      await write(tty, on);
      return { bytes: on.toString('hex') };
    },
  };
}

/** Manual mode: prompts the operator and waits for Enter on `input`. */
export function manualDriver({
  input = process.stdin,
  output = process.stdout,
  clock = Date,
} = {}) {
  const rl = createInterface({ input, terminal: false });
  const it = rl[Symbol.asyncIterator]();
  const ask = async (text) => {
    output.write(`\n>>> ${text}\n`);
    const t0 = clock.now();
    const r = await it.next();
    if (r.done) throw new Error('chế độ tay: đầu vào đã đóng');
    return { manualMs: clock.now() - t0 };
  };
  return {
    name: 'manual',
    off: () => ask('RÚT NGUỒN BL335 ngay bây giờ, rồi nhấn Enter'),
    on: () => ask('CẮM NGUỒN BL335 lại, rồi nhấn Enter'),
    close: () => rl.close(),
  };
}

// ---------- check-data and audit ----------

/**
 * Judges `mat-runtime --check-data --json`. Exit 0 with result ok passes. Exit 1 (warning) passes only when every
 * warning is a pulse.journal with entries or a database whose WAL needs recovery (contract §4). Anything else fails.
 */
export function evaluateCheckData(stdout, exitCode) {
  const base = { exitCode, result: null, acceptedWarnings: [], problems: [] };
  let j;
  try {
    j = JSON.parse(String(stdout).trim());
  } catch {
    return { ...base, ok: false, reason: `check-data: đầu ra không phải JSON (mã ${exitCode})` };
  }
  if (!j || j.schema !== 'mat-check-data/1') {
    return { ...base, ok: false, reason: `check-data: schema không đúng (${j?.schema})` };
  }
  const checks = Array.isArray(j.checks) ? j.checks : [];
  const out = { ...base, result: j.result, durationMs: j.durationMs ?? null };
  out.problems = checks.filter((c) => c.status === 'warning' || c.status === 'damaged');
  if (j.exitCode !== exitCode) {
    return {
      ...out,
      ok: false,
      reason: `check-data: mã thoát ${exitCode} khác exitCode ${j.exitCode} trong JSON`,
    };
  }
  if (exitCode === 0 && j.result === 'ok') return { ...out, ok: true };
  if (exitCode === 1 && j.result === 'warning') {
    const acceptable = (c) =>
      c.status === 'warning' &&
      (c.name === 'pulse.journal' || (/\.db$/.test(c.name) && /\bwal\b/i.test(c.detail ?? '')));
    const bad = out.problems.filter((c) => !acceptable(c));
    if (!bad.length) {
      return { ...out, ok: true, acceptedWarnings: out.problems.map((c) => c.name) };
    }
    return {
      ...out,
      ok: false,
      reason: `check-data: cảnh báo không được chấp nhận: ${bad.map((c) => `${c.name} (${c.detail ?? ''})`).join(', ')}`,
    };
  }
  return {
    ...out,
    ok: false,
    reason: `check-data: mã ${exitCode}, ${j.result}: ${out.problems.map((c) => `${c.name} ${c.status}`).join(', ')}`,
  };
}

const ID_RE = /requestId["']?\s*[=:]\s*["']?([A-Za-z0-9._-]+)/g;

function walkIds(v, out) {
  if (Array.isArray(v)) for (const x of v) walkIds(x, out);
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'requestId' && typeof x === 'string' && x) out.add(x);
      else walkIds(x, out);
    }
  }
}

/** Every requestId of an audit export: JSON document, JSON lines, or `requestId=...` text. */
export function extractRequestIds(text) {
  const out = new Set();
  const t = String(text ?? '');
  try {
    walkIds(JSON.parse(t), out);
    return out;
  } catch {
    // not one JSON document
  }
  for (const line of t.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    try {
      walkIds(JSON.parse(l), out);
      continue;
    } catch {
      // text line
    }
    for (const m of l.matchAll(ID_RE)) out.add(m[1]);
  }
  return out;
}

/** requestIds the command generator logged as ACCEPTED (JSON lines with status/result ACCEPTED, or text lines). */
export function parseAcceptedLog(text) {
  const ids = [];
  const seen = new Set();
  const add = (id) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    let j = null;
    try {
      j = JSON.parse(l);
    } catch {
      // text line
    }
    if (j && typeof j === 'object') {
      if (
        typeof j.requestId === 'string' &&
        [j.status, j.result, j.state, j.outcome].includes('ACCEPTED')
      ) {
        add(j.requestId);
      }
      continue;
    }
    if (!/\bACCEPTED\b/.test(l)) continue;
    const m =
      /requestId["']?\s*[=:]\s*["']?([A-Za-z0-9._-]+)/.exec(l) ??
      /\bACCEPTED\s+([A-Za-z0-9._-]+)/.exec(l);
    if (m) add(m[1]);
  }
  return ids;
}

// ---------- event points ----------

const D1_STEPS = ['activate', 'restart', 'health'];

function sampleJson(line) {
  try {
    const j = JSON.parse(line);
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

/**
 * Preset matchers. The device log formats are not fixed yet: D3 and D4 read mat-sample lines (dbSizes) or a text
 * line naming the file; D1 a line naming ops/<id>.json and the step; D5 a retain write/flush line. Override with
 * --event-pattern when the real log differs.
 */
export const EVENT_POINTS = {
  D1: {
    describe: (round) => `nạp xuống: ops/<id>.json ghi bước ${D1_STEPS[(round - 1) % 3]}`,
    match: (line, round) =>
      /ops\/[^\s"']+\.json/.test(line) &&
      new RegExp(`\\b${D1_STEPS[(round - 1) % 3]}\\b`).test(line),
    delayMs: () => 0,
  },
  D3: {
    describe: () => 'history.db-wal > 4 MiB',
    match: (line) => {
      const j = sampleJson(line);
      const v = j?.dbSizes?.['history.db-wal'];
      if (typeof v === 'number') return v > 4 * MiB;
      const m = /history\.db-wal\D{0,20}?(\d+)/.exec(line);
      return !!m && Number(m[1]) > 4 * MiB;
    },
    delayMs: () => 0,
  },
  D4: {
    describe: () => 'pulse.journal có mục chờ',
    match: (line) => {
      const j = sampleJson(line);
      const v = j?.dbSizes?.['pulse.journal'];
      if (typeof v === 'number') return v > 0;
      return (
        /pulse[._ -]?journal/i.test(line) &&
        /(pending|entries?\s*[=:]\s*[1-9]|non-empty|chờ)/i.test(line)
      );
    },
    delayMs: () => 0,
  },
  D5: {
    describe: () => 'trong 5 s trước lần ghi retain kế tiếp',
    match: (line) => /retain/i.test(line) && /(flush|write|wrote|saved|lưu)/i.test(line),
    // next write at event + period; cut at a uniform point of the last 5 s before it
    delayMs: (rng, opts) => opts.retainPeriodS * 1000 - rng() * 5000,
  },
};

/** Tails a file from its current end (poll). */
export async function* tailFile(
  path,
  { pollMs = 500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  let pos = existsSync(path) ? statSync(path).size : 0;
  let rest = '';
  for (;;) {
    const size = existsSync(path) ? statSync(path).size : 0;
    if (size < pos) pos = 0; // truncated or rotated
    if (size > pos) {
      const fd = openSync(path, 'r');
      const buf = Buffer.alloc(size - pos);
      readSync(fd, buf, 0, buf.length, pos);
      closeSync(fd);
      pos = size;
      const parts = (rest + buf.toString('utf8')).split('\n');
      rest = parts.pop();
      for (const p of parts) yield p;
    } else await sleep(pollMs);
  }
}

/** Lines of a long-running command (e.g. ssh ... tail -F). The process is killed when the reader stops. */
export async function* commandLines(cmd) {
  const child = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const rl = createInterface({ input: child.stdout });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
    child.kill();
  }
}

/** Runs a shell command, returns its exit code and output. */
export function runCommand(cmd, { timeoutMs = 300_000 } = {}) {
  return new Promise((done) => {
    const child = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (e) => {
      clearTimeout(timer);
      done({ exitCode: 127, stdout, stderr: `${stderr}${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ exitCode: code ?? 128, stdout, stderr });
    });
  });
}

// ---------- the campaign ----------

const DEFAULTS = {
  rounds: 1,
  mode: 'random',
  point: null,
  maxDelayS: 300,
  stableS: 60,
  offS: 5,
  readyTimeoutS: 90,
  preReadyTimeoutS: 900,
  pollMs: 2000,
  eventTimeoutS: 3600,
  retainPeriodS: 60,
  target: 'bl335',
  readyUrl: null,
  eventPattern: null,
  out: null,
  roundsLog: null,
};

const X64_LIMITATION =
  'docker kill -s KILL chỉ giết tiến trình; nhân Linux của máy chủ vẫn ghi page cache xuống đĩa, nên không mô phỏng mất dữ liệu chưa fsync ở tầng đĩa; không thay thế cắt điện thật trên BL335 (FR-043)';

function investigateList(round, reason) {
  const list = [
    'Thiết bị giữ nguyên trạng thái: không khởi động lại, không sửa, không cắt thêm.',
    `Xem bản ghi vòng ${round.round} trong tệp .rounds.jsonl (check, audit, thời gian READY).`,
  ];
  if (/READY/.test(reason)) {
    list.push(
      'Không READY: kiểm nguồn và console UART; `systemctl status mat-runtime`; `journalctl -b -u mat-runtime`.',
    );
  }
  if (/check-data/.test(reason)) {
    list.push(
      'Chạy lại tay `mat-runtime --check-data --json` (chỉ đọc) để xác nhận; chép history.db, -wal, audit.db ra máy dev trước khi đụng tới.',
    );
    list.push(
      '`journalctl -b -1 -u mat-runtime` (lần chạy bị cắt) và `ls -la` thư mục dữ liệu, staging/, ops/.',
    );
  }
  if (/audit/.test(reason)) {
    list.push(
      `requestId ACCEPTED thiếu trong audit: ${(round.audit?.missing ?? []).join(', ')}; đối chiếu nhật ký bộ phát lệnh với --export-audit.`,
    );
  }
  return list;
}

/**
 * Runs `opts.rounds` rounds. deps: driver {name, off, on}, clock {now}, sleep(ms), rng(), checkReady(),
 * runCheck() -> {exitCode, stdout}, readAccepted() -> ids | null, exportAudit() -> text | null,
 * eventLines(point, round) -> async iterable of lines, timer(ms) -> {promise, cancel}, log(msg).
 */
export async function runCampaign(options, deps) {
  const opts = { ...DEFAULTS, ...options };
  const clock = deps.clock ?? Date;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const rng = deps.rng ?? Math.random;
  const log = deps.log ?? console.log;
  const checkReady =
    deps.checkReady ??
    (async () => {
      if (!opts.readyUrl) throw new Error('cần readyUrl hoặc checkReady');
      const r = await httpGet(opts.readyUrl);
      return r.status >= 200 && r.status < 300;
    });
  const runCheck = deps.runCheck;
  if (!deps.driver || !runCheck) throw new Error('cần driver và runCheck');
  const roundsLog =
    opts.roundsLog ?? (opts.out ? opts.out.replace(/\.json$/, '') + '.rounds.jsonl' : null);
  if (opts.out) mkdirSync(dirname(resolve(opts.out)), { recursive: true });
  if (roundsLog) mkdirSync(dirname(resolve(roundsLog)), { recursive: true });
  const preset = opts.mode === 'event' ? EVENT_POINTS[opts.point] : null;
  if (opts.mode === 'event' && !preset) throw new Error(`điểm sự kiện không biết: ${opts.point}`);
  const customRe = opts.eventPattern ? new RegExp(opts.eventPattern) : null;

  const waitReady = async (timeoutMs) => {
    const start = clock.now();
    for (;;) {
      if (await checkReady()) return { ok: true, ms: clock.now() - start };
      if (clock.now() - start >= timeoutMs) return { ok: false, ms: clock.now() - start };
      await sleep(opts.pollMs);
    }
  };
  const waitStable = async () => {
    const start = clock.now();
    let since = null;
    for (;;) {
      if (await checkReady()) {
        since ??= clock.now();
        if (clock.now() - since >= opts.stableS * 1000)
          return { ok: true, ms: clock.now() - since };
      } else since = null;
      if (clock.now() - start >= opts.preReadyTimeoutS * 1000) return { ok: false, ms: 0 };
      await sleep(opts.pollMs);
    }
  };
  const waitEvent = async (round) => {
    if (!deps.eventLines)
      throw new Error('vòng sự kiện cần nguồn nhật ký (--event-log hoặc --event-cmd)');
    const match = customRe ? (l) => customRe.test(l) : (l) => preset.match(l, round);
    let timer;
    const timeout = new Promise((r) => {
      timer = setTimeout(() => r(null), opts.eventTimeoutS * 1000);
      timer.unref?.();
    });
    const source = deps.eventLines(opts.point, round)[Symbol.asyncIterator]();
    const seen = (async () => {
      for (;;) {
        const { value, done } = await source.next();
        if (done) return null;
        if (match(value)) return { line: value, at: clock.now() };
      }
    })();
    try {
      return await Promise.race([seen, timeout]);
    } finally {
      clearTimeout(timer);
      // Stop the source (kills an `--event-cmd` process); not awaited: a pending read may never resolve.
      source.return?.()?.catch?.(() => {});
    }
  };

  const startedAt = new Date(clock.now()).toISOString();
  const rounds = [];
  let failure = null;
  for (let n = 1; n <= opts.rounds && !failure; n++) {
    const r = { round: n, mode: opts.mode, point: opts.mode === 'event' ? opts.point : 'random' };
    r.startedAt = new Date(clock.now()).toISOString();
    let fail = null;
    let powered = true;
    try {
      // 1. READY and stable
      const st = await waitStable();
      r.stableMs = st.ms;
      if (!st.ok) fail = `thiết bị không READY ổn định ${opts.stableS} s trước khi cắt`;
      // 2. cut time
      if (!fail) {
        if (opts.mode === 'event') {
          r.eventDescription = customRe ? `pattern ${opts.eventPattern}` : preset.describe(n);
          const ev = await waitEvent(n);
          if (!ev) fail = `không thấy sự kiện ${opts.point} (${r.eventDescription})`;
          else {
            r.event = ev;
            r.cutDelayMs = Math.max(0, Math.round(customRe ? 0 : preset.delayMs(rng, opts)));
          }
        } else r.cutDelayMs = Math.round(rng() * opts.maxDelayS * 1000);
      }
      if (!fail) {
        await sleep(r.cutDelayMs);
        // 3. cut, 5 s, power on
        r.cutAt = new Date(clock.now()).toISOString();
        powered = false;
        r.offReply = (await deps.driver.off()) ?? null;
        const accepted = deps.readAccepted ? await deps.readAccepted() : null;
        const tOff = clock.now();
        await sleep(opts.offS * 1000);
        r.offMs = clock.now() - tOff;
        r.onReply = (await deps.driver.on()) ?? null;
        powered = true;
        // 4. READY <= 90 s
        r.readyAfter = await waitReady(opts.readyTimeoutS * 1000);
        if (!r.readyAfter.ok)
          fail = `thiết bị không READY trong ${opts.readyTimeoutS} s sau khi cấp nguồn`;
        // 5. check-data and audit
        if (!fail) {
          const c = await runCheck();
          r.check = evaluateCheckData(c.stdout, c.exitCode);
          if (!r.check.ok) fail = r.check.reason;
        }
        if (!fail) {
          if (accepted && deps.exportAudit) {
            const exported = extractRequestIds(await deps.exportAudit());
            const missing = accepted.filter((id) => !exported.has(id));
            r.audit = {
              status: missing.length ? 'fail' : 'pass',
              accepted: accepted.length,
              exported: exported.size,
              missing,
            };
            if (missing.length)
              fail = `audit: ${missing.length} requestId ACCEPTED thiếu trong audit.db`;
          } else {
            r.audit = {
              status: 'not-measured',
              detail: 'không có nhật ký bộ phát lệnh hoặc --export-audit',
            };
          }
        }
      }
    } catch (e) {
      fail = `lỗi: ${e.message}`;
    } finally {
      // Power is always restored once cut (step 3); the data stays untouched for the investigation.
      if (!powered) {
        try {
          r.onReply = (await deps.driver.on()) ?? null;
        } catch (e) {
          fail = `${fail ?? ''}; không cấp lại nguồn được: ${e.message}`;
        }
      }
    }
    r.ok = !fail;
    if (fail) r.failure = fail;
    r.finishedAt = new Date(clock.now()).toISOString();
    rounds.push(r);
    if (roundsLog) appendFileSync(roundsLog, `${JSON.stringify(r)}\n`);
    log(
      `vòng ${n}/${opts.rounds}: ${r.ok ? 'đạt' : 'HỎNG'}${r.readyAfter ? `, READY sau ${r.readyAfter.ms} ms` : ''}`,
    );
    if (fail) failure = { round: n, reason: fail, investigate: investigateList(r, fail) };
  }

  const readyMs = rounds.filter((r) => r.readyAfter?.ok).map((r) => r.readyAfter.ms);
  const sorted = [...readyMs].sort((a, b) => a - b);
  const perPoint = {};
  for (const r of rounds) {
    const p = (perPoint[r.point] ??= { run: 0, ok: 0 });
    p.run++;
    if (r.ok) p.ok++;
  }
  const auditNotMeasured = rounds.filter((r) => r.audit?.status === 'not-measured').length;
  const result = failure
    ? 'fail'
    : auditNotMeasured > 0 || rounds.length < opts.rounds
      ? 'incomplete'
      : 'pass';
  const limitations = [];
  if (opts.target === 'x64') limitations.push(X64_LIMITATION);
  if (deps.driver.name === 'manual')
    limitations.push('chế độ tay: thời điểm cắt do người thao tác, sai số vài giây');
  const summary = {
    schema: 'mat-powercut/1',
    target: opts.target,
    driver: deps.driver.name,
    mode: opts.mode,
    point: opts.point,
    startedAt,
    finishedAt: new Date(clock.now()).toISOString(),
    roundsPlanned: opts.rounds,
    roundsRun: rounds.length,
    roundsOk: rounds.filter((r) => r.ok).length,
    stoppedOnFailure: !!failure,
    failure,
    result,
    criteria: {
      readyWithinTimeout: rounds.some((r) => r.readyAfter && !r.readyAfter.ok)
        ? 'fail'
        : readyMs.length
          ? 'pass'
          : 'not-measured',
      checkData: rounds.some((r) => r.check && !r.check.ok)
        ? 'fail'
        : rounds.some((r) => r.check)
          ? 'pass'
          : 'not-measured',
      audit: rounds.some((r) => r.audit?.status === 'fail')
        ? 'fail'
        : auditNotMeasured || !rounds.some((r) => r.audit)
          ? 'not-measured'
          : 'pass',
    },
    readyAfterMs: {
      max: sorted.length ? sorted[sorted.length - 1] : null,
      median: sorted.length ? sorted[sorted.length >> 1] : null,
      limit: opts.readyTimeoutS * 1000,
    },
    perPoint,
    audit: {
      acceptedTotal: rounds.reduce((a, r) => a + (r.audit?.accepted ?? 0), 0),
      missingTotal: rounds.reduce((a, r) => a + (r.audit?.missing?.length ?? 0), 0),
      notMeasuredRounds: auditNotMeasured,
    },
    acceptedWarnings: rounds.flatMap((r) =>
      r.check?.acceptedWarnings?.length
        ? [{ round: r.round, checks: r.check.acceptedWarnings }]
        : [],
    ),
    limitations,
    rounds,
  };
  if (opts.out) writeFileSync(opts.out, `${JSON.stringify(summary, null, 2)}\n`);
  if (failure) {
    log(`DỪNG: vòng ${failure.round} hỏng: ${failure.reason}`);
    log('Thiết bị giữ nguyên trạng thái để điều tra (không tự sửa, không cắt thêm). Cần xem:');
    for (const i of failure.investigate) log(`  - ${i}`);
  }
  return { exitCode: result === 'pass' ? 0 : result === 'fail' ? 1 : 3, summary };
}

// ---------- CLI ----------

const HELP = `node tools/powercut/powercut.mjs --driver tasmota|serial|manual --base-url https://dev:8443
  --check-cmd "<ssh ... mat-runtime --check-data --json>" --out docs/reports/011-powercut-bl335.json
  [--tasmota-url http://plug] [--tty /dev/ttyUSB0 --on-hex "${LCUS1.on}" --off-hex "${LCUS1.off}"]
  [--rounds 100] [--mode random|event --point D1|D3|D4|D5 (--event-log file | --event-cmd cmd) [--event-pattern re]]
  [--audit-cmd "<ssh ... mat-runtime --export-audit --json>" --accepted-log cmdgen.jsonl]
  [--target bl335|x64] [--stable-s 60] [--max-delay-s 300] [--ready-timeout-s 90] [--retain-period-s 60]
Exit: 0 pass, 1 a round failed (stopped, device kept as is), 3 incomplete (something not measured), 64 usage.`;

export async function main(argv, { log = console.log, error = console.error } = {}) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      log(HELP);
      return 0;
    }
    if (!a.startsWith('--') || i + 1 >= argv.length) {
      error(`tham số không hợp lệ: ${a}`);
      return 64;
    }
    o[a.slice(2)] = argv[++i];
  }
  const need = ['driver', 'base-url', 'check-cmd', 'out'].filter((k) => !o[k]);
  if (need.length) {
    error(`thiếu --${need.join(', --')}\n${HELP}`);
    return 64;
  }
  let driver;
  if (o.driver === 'tasmota') {
    if (!o['tasmota-url']) return (error('thiếu --tasmota-url'), 64);
    driver = tasmotaDriver({ baseUrl: o['tasmota-url'] });
  } else if (o.driver === 'serial') {
    if (!o.tty) return (error('thiếu --tty'), 64);
    driver = serialRelayDriver({
      tty: o.tty,
      onHex: o['on-hex'] ?? LCUS1.on,
      offHex: o['off-hex'] ?? LCUS1.off,
    });
    log(`rơ-le nối tiếp ${o.tty}: đặt tốc độ trước (ví dụ: stty -F ${o.tty} 9600 raw -echo)`);
  } else if (o.driver === 'manual') {
    driver = manualDriver({});
  } else {
    error(`--driver không biết: ${o.driver}`);
    return 64;
  }
  const num = (k, d) => (o[k] === undefined ? d : Number(o[k]));
  const options = {
    rounds: num('rounds', 1),
    mode: o.mode ?? 'random',
    point: o.point ?? null,
    stableS: num('stable-s', 60),
    maxDelayS: num('max-delay-s', 300),
    readyTimeoutS: num('ready-timeout-s', 90),
    retainPeriodS: num('retain-period-s', 60),
    target: o.target ?? 'bl335',
    readyUrl: `${o['base-url'].replace(/\/+$/, '')}/api/v1/system/info`,
    eventPattern: o['event-pattern'] ?? null,
    out: o.out,
  };
  const deps = {
    driver,
    runCheck: () => runCommand(o['check-cmd']),
    readAccepted: o['accepted-log']
      ? async () => parseAcceptedLog(readFileSync(o['accepted-log'], 'utf8'))
      : null,
    exportAudit: o['audit-cmd'] ? async () => (await runCommand(o['audit-cmd'])).stdout : null,
    eventLines: o['event-log']
      ? () => tailFile(o['event-log'])
      : o['event-cmd']
        ? () => commandLines(o['event-cmd'])
        : null,
    log,
  };
  try {
    const { exitCode } = await runCampaign(options, deps);
    return exitCode;
  } catch (e) {
    error(e.message);
    return 64;
  } finally {
    driver.close?.();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
