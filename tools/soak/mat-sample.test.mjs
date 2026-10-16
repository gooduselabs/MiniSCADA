// Tests for the soak sampler deployment/device/mat-sample.sh (feature 011, T067; FR-037, contract test-protocols §2).
//
// The script runs against a fake /proc (MAT_PROC_ROOT) and a fake /sys (MAT_SYS_ROOT) inside a temp dir, with fake
// `pidof`, `systemctl`, `dmesg` and `mmc` first on PATH. It must write one JSON line per sample with every field of the
// contract, rotate 8 files x MAT_SAMPLE_MAX_BYTES, write nothing outside the sample dir, and give null (never an
// invented value) when a source is missing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
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
import { dirname, join, relative, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'deployment/device/mat-sample.sh');
const fixtures = join(root, 'tools/soak/fixtures');
// dash is the closest to the device /bin/sh (Ubuntu); fall back to the system sh.
const SHELL = existsSync('/bin/dash') ? '/bin/dash' : '/bin/sh';

const FIELDS = [
  't',
  'boot',
  'rssKb',
  'hwmKb',
  'utime',
  'stime',
  'fd',
  'threads',
  'ioRead',
  'ioWrite',
  'blkSectorsWritten',
  'dbSizes',
  'dfData',
  'dfTmp',
  'memAvailKb',
  'tempMilliC',
  'emmc',
  'restarts',
  'dmesgErr',
];

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function fakeBin(dir, name, body) {
  write(join(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
}

/** Builds a fake device tree; returns the paths and the env for the script. */
function makeTree({ io = true, pid = '4242', mmcFixture = null, sysfsLife = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'mat-sample-'));
  temps.push(base);
  const proc = join(base, 'proc');
  const sys = join(base, 'sys');
  const data = join(base, 'data');
  const tmpfs = join(base, 'run');
  const sampleDir = join(tmpfs, 'mat-sample');
  const bin = join(base, 'bin');
  const p = join(proc, pid);
  write(join(proc, 'sys/kernel/random/boot_id'), 'b1c2d3e4-0000-4000-8000-000000000001\n');
  write(
    join(proc, 'meminfo'),
    'MemTotal:         508000 kB\nMemFree:           12000 kB\nMemAvailable:     321456 kB\n',
  );
  write(
    join(p, 'status'),
    'Name:\tmat-runtime\nState:\tS (sleeping)\nVmHWM:\t   61234 kB\nVmRSS:\t   54321 kB\nThreads:\t27\n',
  );
  // comm with a space and a parenthesis: the script must split after the last ") ".
  write(
    join(p, 'stat'),
    `${pid} (mat (rt) x) S 1 ${pid} ${pid} 0 -1 4194560 100 0 0 0 1234 567 0 0 20 0 27 0 100 1000 200\n`,
  );
  mkdirSync(join(p, 'fd'), { recursive: true });
  for (let i = 0; i < 9; i++) write(join(p, 'fd', String(i)), '');
  if (io) {
    write(
      join(p, 'io'),
      'rchar: 1\nwchar: 2\nsyscr: 3\nsyscw: 4\nread_bytes: 4096\nwrite_bytes: 81920\ncancelled_write_bytes: 0\n',
    );
  }
  write(join(sys, 'block/mmcblk0/stat'), '  100 0 2000 10 300 0 77777 50 0 60 60 0 0 0 0\n');
  write(join(sys, 'block/mmcblk0boot0/stat'), '  1 0 8 0 0 0 0 0 0 0 0 0 0 0 0\n');
  if (sysfsLife) {
    write(join(sys, 'block/mmcblk0/device/life_time'), '0x02 0x03\n');
    write(join(sys, 'block/mmcblk0/device/pre_eol_info'), '0x01\n');
  }
  write(join(sys, 'class/thermal/thermal_zone0/temp'), '48500\n');
  write(join(data, 'history.db'), 'x'.repeat(1000));
  write(join(data, 'history.db-wal'), 'x'.repeat(300));
  write(join(data, 'audit.db'), 'x'.repeat(200));
  write(join(data, 'alarm.db'), 'x'.repeat(100));
  write(join(data, 'retain/a.json'), 'x'.repeat(40));
  write(join(data, 'retain/sub/b.json'), 'x'.repeat(2));
  mkdirSync(tmpfs, { recursive: true });
  const dmesgFile = join(base, 'dmesg.txt');
  write(
    dmesgFile,
    '[1.0] booting\n[2.0] mmc0: new HS200 MMC card at address 0001\n[3.0] EXT4-fs (mmcblk0p2): mounted filesystem\n' +
      '[4.0] usb 1-1: new device\n[5.0] EXT4-fs error (device mmcblk0p2): ext4_find_entry:1455: comm x\n',
  );
  fakeBin(bin, 'pidof', `[ "$1" = mat-runtime ] && echo ${pid} 1 || exit 1`);
  fakeBin(
    bin,
    'systemctl',
    'case "$*" in *NRestarts*) echo NRestarts=3;; *MainPID*) echo MainPID=0;; *) exit 1;; esac',
  );
  fakeBin(bin, 'dmesg', `cat '${dmesgFile}'`);
  if (mmcFixture) {
    fakeBin(
      bin,
      'mmc',
      `[ "$1 $2" = "extcsd read" ] || { echo refused >&2; exit 9; }\ncat '${join(fixtures, mmcFixture)}'`,
    );
  }
  const env = {
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    MAT_PROC_ROOT: proc,
    MAT_SYS_ROOT: sys,
    MAT_DATA_DIR: data,
    MAT_TMP_DIR: tmpfs,
    MAT_SAMPLE_DIR: sampleDir,
    MAT_SAMPLE_PERIOD_S: '0',
  };
  return { base, proc, sys, data, sampleDir, bin, dmesgFile, env };
}

function run(tree, args, extraEnv = {}) {
  const r = spawnSync(SHELL, [script, ...args], {
    env: { ...tree.env, ...extraEnv },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return r;
}

function lines(dir) {
  const out = [];
  const files = readdirSync(dir)
    .filter((f) => /^samples-\d+\.jsonl$/.test(f))
    .sort();
  for (const f of files) {
    for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) if (l) out.push(JSON.parse(l));
  }
  return out;
}

/** Snapshot of every file outside the sample dir: path -> size and mtime. */
function snapshot(base, sampleDir) {
  const m = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (p === sampleDir) continue;
      if (e.isDirectory()) walk(p);
      else {
        const s = statSync(p);
        m.set(relative(base, p), `${s.size}:${s.mtimeMs}`);
      }
    }
  };
  walk(base);
  return m;
}

test('the script exists and is POSIX sh (sh -n)', () => {
  assert.ok(existsSync(script), 'deployment/device/mat-sample.sh is missing');
  const r = spawnSync(SHELL, ['-n', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(script, 'utf8');
  assert.match(text, /^#!\/bin\/sh\n/);
  // A few bash-only constructs that dash/busybox do not run.
  for (const bad of [/\[\[/, /\bfunction\s+\w+/, /\$\{[A-Za-z_]+\/\//, /<<</, /\blocal\s/]) {
    assert.doesNotMatch(text, bad, `bash-ism ${bad}`);
  }
  // Never an mmc write command.
  assert.doesNotMatch(
    text,
    /mmc\s+(extcsd\s+write|bkops|writeprotect|sanitize|ffu|rpmb|gp|enh_area|write_reliability)/,
  );
});

test('--once writes one JSON line with every field of the contract', () => {
  const tree = makeTree();
  const r = run(tree, ['--once'], { MAT_PID: '4242' });
  assert.equal(r.status, 0, r.stderr);
  const got = lines(tree.sampleDir);
  assert.equal(got.length, 1);
  const s = got[0];
  assert.deepEqual(Object.keys(s).sort(), [...FIELDS].sort());
  assert.match(s.t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(s.boot, 'b1c2d3e4-0000-4000-8000-000000000001');
  assert.equal(s.rssKb, 54321);
  assert.equal(s.hwmKb, 61234);
  assert.equal(s.utime, 1234);
  assert.equal(s.stime, 567);
  assert.equal(s.fd, 9);
  assert.equal(s.threads, 27);
  assert.equal(s.ioRead, 4096);
  assert.equal(s.ioWrite, 81920);
  assert.deepEqual(s.blkSectorsWritten, { mmcblk0: 77777, mmcblk0boot0: 0 });
  assert.deepEqual(s.dbSizes, {
    'history.db': 1000,
    'history.db-wal': 300,
    'audit.db': 200,
    'alarm.db': 100,
    'pulse.journal': null,
    retain: 42,
  });
  for (const k of ['dfData', 'dfTmp']) {
    assert.equal(typeof s[k].totalKb, 'number', k);
    assert.equal(typeof s[k].usedKb, 'number', k);
    assert.equal(typeof s[k].availKb, 'number', k);
  }
  assert.equal(s.memAvailKb, 321456);
  assert.equal(s.tempMilliC, 48500);
  assert.deepEqual(s.emmc, { source: 'sysfs', lifeA: 2, lifeB: 3, preEol: 1 });
  assert.equal(s.restarts, 3);
  // Only the EXT4-fs error line: plain mmc/ext4 boot lines are not errors. The first sample counts the ring buffer.
  assert.equal(s.dmesgErr, 1);
});

test('the pid is found with pidof when MAT_PID is not set', () => {
  const tree = makeTree({ pid: '777' });
  const r = run(tree, ['--once']);
  assert.equal(r.status, 0, r.stderr);
  const [s] = lines(tree.sampleDir);
  assert.equal(s.rssKb, 54321);
  assert.equal(s.threads, 27);
});

test('no /proc/<pid>/io (BL335 kernel without task io accounting) gives null, not 0', () => {
  const tree = makeTree({ io: false });
  const r = run(tree, ['--once'], { MAT_PID: '4242' });
  assert.equal(r.status, 0, r.stderr);
  const [s] = lines(tree.sampleDir);
  assert.equal(s.ioRead, null);
  assert.equal(s.ioWrite, null);
  assert.equal(s.rssKb, 54321);
});

test('missing process, sysfs, systemctl and dmesg give null for each field', () => {
  const tree = makeTree({ sysfsLife: false });
  rmSync(join(tree.sys, 'block'), { recursive: true });
  rmSync(join(tree.sys, 'class'), { recursive: true });
  // Failing fakes shadow any real tool of the host (dmesg needs root, no unit, no process).
  fakeBin(tree.bin, 'systemctl', 'exit 1');
  fakeBin(
    tree.bin,
    'dmesg',
    'echo "dmesg: read kernel buffer failed: Operation not permitted" >&2; exit 1',
  );
  fakeBin(tree.bin, 'pidof', 'exit 1');
  rmSync(join(tree.data, 'history.db-wal'));
  const r = run(tree, ['--once']);
  assert.equal(r.status, 0, r.stderr);
  const [s] = lines(tree.sampleDir);
  for (const k of [
    'rssKb',
    'hwmKb',
    'utime',
    'stime',
    'fd',
    'threads',
    'ioRead',
    'ioWrite',
    'blkSectorsWritten',
    'tempMilliC',
    'emmc',
    'restarts',
    'dmesgErr',
  ]) {
    assert.equal(s[k], null, k);
  }
  assert.equal(s.dbSizes['history.db-wal'], null);
  assert.equal(s.dbSizes['history.db'], 1000);
});

test('dmesgErr counts only the new matching lines since the last sample', () => {
  const tree = makeTree();
  let r = run(tree, ['--once'], { MAT_PID: '4242' });
  assert.equal(r.status, 0, r.stderr);
  r = run(tree, ['--once'], { MAT_PID: '4242' });
  assert.equal(r.status, 0, r.stderr);
  writeFileSync(
    tree.dmesgFile,
    readFileSync(tree.dmesgFile, 'utf8') +
      '[9.0] blk_update_request: I/O error, dev mmcblk0, sector 1\n[9.1] random line\n' +
      '[9.2] mmc0: Timeout waiting for hardware interrupt.\n[9.3] EXT4-fs (mmcblk0p3): mounted filesystem\n',
  );
  r = run(tree, ['--once'], { MAT_PID: '4242' });
  assert.equal(r.status, 0, r.stderr);
  const got = lines(tree.sampleDir);
  assert.deepEqual(
    got.map((s) => s.dmesgErr),
    [1, 0, 2],
  );
});

test('a period loop writes one line per sample (MAT_SAMPLE_COUNT)', () => {
  const tree = makeTree();
  const r = run(tree, [], { MAT_PID: '4242', MAT_SAMPLE_COUNT: '3' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lines(tree.sampleDir).length, 3);
});

test('rotation keeps 8 files of at most MAT_SAMPLE_MAX_BYTES each', () => {
  const tree = makeTree();
  const max = 1300; // two lines of about 620 bytes per file
  const r = run(tree, [], {
    MAT_PID: '4242',
    MAT_SAMPLE_COUNT: '20',
    MAT_SAMPLE_MAX_BYTES: String(max),
  });
  assert.equal(r.status, 0, r.stderr);
  const files = readdirSync(tree.sampleDir).filter((f) => f.endsWith('.jsonl'));
  assert.deepEqual(files.sort(), [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `samples-${n}.jsonl`).sort());
  for (const f of files) assert.ok(statSync(join(tree.sampleDir, f)).size <= max, f);
  const got = lines(tree.sampleDir);
  assert.ok(got.length < 20 && got.length >= 8, `kept ${got.length}`);
  // Only the sample files and the hidden state file in the sample dir.
  for (const f of readdirSync(tree.sampleDir)) assert.match(f, /^(samples-[0-7]\.jsonl|\.state)$/);
});

test('nothing is written outside the sample dir', () => {
  const tree = makeTree({ mmcFixture: 'extcsd-worn.txt' });
  const before = snapshot(tree.base, tree.sampleDir);
  const r = run(tree, [], { MAT_PID: '4242', MAT_SAMPLE_COUNT: '3', MAT_SAMPLE_MMC: '1' });
  assert.equal(r.status, 0, r.stderr);
  const afterSnap = snapshot(tree.base, tree.sampleDir);
  assert.deepEqual([...afterSnap.entries()].sort(), [...before.entries()].sort());
});

test('MAT_SAMPLE_MMC=1 reads EXT_CSD with `mmc extcsd read` and parses the health lines', () => {
  const tree = makeTree({ mmcFixture: 'extcsd-worn.txt' });
  const r = run(tree, ['--once'], { MAT_PID: '4242', MAT_SAMPLE_MMC: '1' });
  assert.equal(r.status, 0, r.stderr);
  const [s] = lines(tree.sampleDir);
  assert.deepEqual(s.emmc, { source: 'mmc-extcsd', extCsdRev: 8, lifeA: 9, lifeB: 10, preEol: 2 });
});

test('EXT_CSD without health lines (eMMC 4.5) gives the rev and null health values', () => {
  const tree = makeTree({ mmcFixture: 'extcsd-emmc45-no-health.txt', sysfsLife: false });
  const r = run(tree, ['--once'], { MAT_PID: '4242', MAT_SAMPLE_MMC: '1' });
  assert.equal(r.status, 0, r.stderr);
  const [s] = lines(tree.sampleDir);
  assert.deepEqual(s.emmc, {
    source: 'mmc-extcsd',
    extCsdRev: 6,
    lifeA: null,
    lifeB: null,
    preEol: null,
  });
});
