// Tests for the power-cut controller tools/powercut/powercut.mjs (feature 011, T068; FR-041, FR-042, contract
// test-protocols §4). Fake devices only: a Tasmota HTTP server (node:http), a temp file as the tty of a USB relay,
// a fake stdin for the manual mode. The clock and sleep are virtual, so a round of minutes runs instantly.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { after, test } from 'node:test';

import {
  LCUS1,
  evaluateCheckData,
  extractRequestIds,
  main,
  manualDriver,
  parseAcceptedLog,
  parseHex,
  runCampaign,
  serialRelayDriver,
  tasmotaDriver,
  httpGet,
} from './powercut.mjs';

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'powercut-'));
  temps.push(d);
  return d;
};

const OK_CHECK = JSON.stringify({
  schema: 'mat-check-data/1',
  result: 'ok',
  exitCode: 0,
  durationMs: 120,
  checks: [
    { name: 'history.db', status: 'ok', detail: 'quick_check ok' },
    { name: 'audit.db', status: 'ok', detail: 'quick_check ok' },
    { name: 'pulse.journal', status: 'missing', detail: 'no journal' },
  ],
});
const checkJson = (result, exitCode, checks) =>
  JSON.stringify({ schema: 'mat-check-data/1', result, exitCode, durationMs: 5, checks });

/** Virtual clock: sleep advances time instantly. */
function vclock() {
  const c = { now: 0 };
  return {
    c,
    clock: { now: () => c.now },
    sleep: async (ms) => {
      c.now += ms;
    },
  };
}

/** A fake device: power state + boot time on the virtual clock. */
function fakeDevice(v, bootMs = 20_000) {
  const d = { power: true, onAt: -1e12, offCount: 0, onCount: 0, events: [] };
  d.ready = () => d.power && v.c.now - d.onAt >= bootMs;
  d.driver = {
    name: 'fake',
    off: async () => {
      d.power = false;
      d.offCount++;
      d.events.push(['off', v.c.now]);
    },
    on: async () => {
      d.power = true;
      d.onAt = v.c.now;
      d.onCount++;
      d.events.push(['on', v.c.now]);
    },
  };
  return d;
}

function baseDeps(v, dev, extra = {}) {
  return {
    driver: dev.driver,
    clock: v.clock,
    sleep: v.sleep,
    rng: () => 0.5,
    checkReady: async () => dev.ready(),
    runCheck: async () => ({ exitCode: 0, stdout: OK_CHECK }),
    readAccepted: async () => ['r-1', 'r-2'],
    exportAudit: async () => 'requestId=r-1\nrequestId=r-2\n',
    log: () => {},
    ...extra,
  };
}

test('LCUS-1 relay bytes: on A0 01 01 A2, off A0 01 00 A1 (contract §4)', () => {
  assert.deepEqual([...parseHex(LCUS1.on)], [0xa0, 0x01, 0x01, 0xa2]);
  assert.deepEqual([...parseHex(LCUS1.off)], [0xa0, 0x01, 0x00, 0xa1]);
  assert.deepEqual([...parseHex('a0:01:00:a1')], [0xa0, 1, 0, 0xa1]);
  assert.throws(() => parseHex('A0 0G'));
});

test('Tasmota driver sends Power Off then Power On to a fake plug', async () => {
  const seen = [];
  const srv = createServer((req, res) => {
    seen.push(req.url);
    res.setHeader('content-type', 'application/json');
    res.end(req.url.includes('Off') ? '{"POWER":"OFF"}' : '{"POWER":"ON"}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const d = tasmotaDriver({ baseUrl: `http://127.0.0.1:${srv.address().port}/` });
    await d.off();
    await d.on();
    assert.deepEqual(seen, ['/cm?cmnd=Power%20Off', '/cm?cmnd=Power%20On']);
  } finally {
    srv.close();
  }
});

test('Tasmota driver fails loudly when the plug does not confirm', async () => {
  const srv = createServer((req, res) => res.end('{"POWER":"ON"}'));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const d = tasmotaDriver({ baseUrl: `http://127.0.0.1:${srv.address().port}` });
    await assert.rejects(d.off(), /POWER/);
  } finally {
    srv.close();
  }
});

test('full cycle against a fake Tasmota plug + fake system/info: cut, 5 s, on, READY, check, audit', async () => {
  const v = vclock();
  const st = { power: true, onAt: -1e12, off: 0, on: 0 };
  const srv = createServer((req, res) => {
    if (req.url === '/cm?cmnd=Power%20Off') {
      st.power = false;
      st.off++;
      st.offAt = v.c.now;
      return res.end('{"POWER":"OFF"}');
    }
    if (req.url === '/cm?cmnd=Power%20On') {
      st.power = true;
      st.on++;
      st.onAt = v.c.now;
      return res.end('{"POWER":"ON"}');
    }
    if (req.url === '/api/v1/system/info') {
      const up = st.power && v.c.now - st.onAt >= 30_000;
      res.statusCode = up ? 200 : 503;
      return res.end(up ? '{"version":"1.0.0-rc"}' : '');
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const dir = tmp();
  try {
    const { exitCode, summary } = await runCampaign(
      {
        rounds: 2,
        mode: 'random',
        out: join(dir, 'r.json'),
        target: 'bl335',
        readyUrl: `${base}/api/v1/system/info`,
      },
      {
        driver: tasmotaDriver({ baseUrl: base }),
        clock: v.clock,
        sleep: v.sleep,
        rng: () => 0.25,
        runCheck: async () => ({ exitCode: 0, stdout: OK_CHECK }),
        readAccepted: async () => ['a', 'b'],
        exportAudit: async () =>
          JSON.stringify([{ requestId: 'a' }, { requestId: 'b' }, { requestId: 'c' }]),
        log: () => {},
      },
    );
    assert.equal(exitCode, 0);
    assert.equal(st.off, 2);
    assert.equal(st.on, 2);
    assert.equal(summary.roundsRun, 2);
    assert.equal(summary.result, 'pass');
    const r = summary.rounds[0];
    assert.equal(r.ok, true);
    assert.equal(r.cutDelayMs, 75_000); // rng 0.25 x 300 s
    assert.ok(r.stableMs >= 60_000);
    assert.equal(r.offMs, 5_000);
    assert.equal(r.readyAfter.ok, true);
    assert.equal(r.readyAfter.ms, 30_000);
    assert.equal(r.check.ok, true);
    assert.deepEqual(r.audit, { status: 'pass', accepted: 2, exported: 3, missing: [] });
    const rounds = readFileSync(join(dir, 'r.rounds.jsonl'), 'utf8').trim().split('\n');
    assert.equal(rounds.length, 2);
    assert.equal(JSON.parse(rounds[1]).round, 2);
    const saved = JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
    assert.equal(saved.schema, 'mat-powercut/1');
    assert.equal(saved.target, 'bl335');
    assert.equal(saved.driver, 'tasmota');
  } finally {
    srv.close();
  }
});

test('USB serial relay: the tty receives off bytes then on bytes', async () => {
  const dir = tmp();
  const tty = join(dir, 'ttyUSB0');
  writeFileSync(tty, '');
  const v = vclock();
  const dev = fakeDevice(v);
  const relay = serialRelayDriver({ tty });
  const driver = {
    name: relay.name,
    off: async () => {
      await relay.off();
      await dev.driver.off();
    },
    on: async () => {
      await relay.on();
      await dev.driver.on();
    },
  };
  const { exitCode } = await runCampaign(
    { rounds: 1, out: join(dir, 'r.json') },
    baseDeps(v, dev, { driver }),
  );
  assert.equal(exitCode, 0);
  assert.deepEqual([...readFileSync(tty)], [0xa0, 0x01, 0x00, 0xa1, 0xa0, 0x01, 0x01, 0xa2]);
});

test('serial relay bytes are configurable', async () => {
  const dir = tmp();
  const tty = join(dir, 'tty');
  writeFileSync(tty, '');
  const d = serialRelayDriver({ tty, onHex: 'FF 01 01', offHex: 'FF 01 00' });
  await d.off();
  assert.deepEqual([...readFileSync(tty)], [0xff, 1, 0]);
});

test('manual mode prompts on the stream and waits for Enter (fake stdin)', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (b) => (text += b));
  const v = vclock();
  const dev = fakeDevice(v);
  const m = manualDriver({ input, output, clock: v.clock });
  const driver = {
    name: 'manual',
    off: async () => {
      const r = await m.off();
      await dev.driver.off();
      return r;
    },
    on: async () => {
      const r = await m.on();
      await dev.driver.on();
      return r;
    },
  };
  input.write('\n\n');
  const dir = tmp();
  const { exitCode, summary } = await runCampaign(
    { rounds: 1, out: join(dir, 'r.json') },
    baseDeps(v, dev, { driver }),
  );
  m.close();
  assert.equal(exitCode, 0);
  assert.match(text, /RÚT NGUỒN/);
  assert.match(text, /CẮM NGUỒN/);
  assert.equal(summary.rounds[0].ok, true);
});

test('event round: cut on the D3 event (history.db-wal > 4 MB) read from a fake log', async () => {
  const v = vclock();
  const dev = fakeDevice(v);
  const lines = [
    'unrelated line',
    JSON.stringify({ t: '2026-11-01T00:00:00Z', dbSizes: { 'history.db-wal': 1_000_000 } }),
    JSON.stringify({ t: '2026-11-01T00:01:00Z', dbSizes: { 'history.db-wal': 5_000_000 } }),
    'after',
  ];
  let cutAfterEvent = null;
  const dir = tmp();
  const { exitCode, summary } = await runCampaign(
    { rounds: 1, mode: 'event', point: 'D3', out: join(dir, 'r.json') },
    baseDeps(v, dev, {
      eventLines: async function* () {
        // The consumer stops reading at the match (return()), so record the cut count as the line is handed over.
        for (const l of lines) {
          if (l.includes('5000000')) cutAfterEvent = dev.offCount;
          yield l;
        }
      },
    }),
  );
  assert.equal(exitCode, 0);
  assert.equal(cutAfterEvent, 0, 'the cut happens after the matching line, not before');
  const r = summary.rounds[0];
  assert.equal(r.mode, 'event');
  assert.equal(r.point, 'D3');
  assert.equal(r.event.line, lines[2]);
  assert.equal(dev.offCount, 1);
  assert.equal(summary.perPoint.D3.ok, 1);
});

test('event round D1 rotates the deploy step activate, restart, health', async () => {
  const v = vclock();
  const dev = fakeDevice(v);
  const lines = [
    'ops/42.json step=restart',
    'ops/42.json step=health',
    'ops/42.json step=activate',
    'ops/43.json step=restart',
    'ops/43.json step=health',
  ];
  const dir = tmp();
  const { summary } = await runCampaign(
    { rounds: 3, mode: 'event', point: 'D1', out: join(dir, 'r.json') },
    baseDeps(v, dev, {
      eventLines: async function* () {
        yield* lines;
      },
    }),
  );
  assert.deepEqual(
    summary.rounds.map((r) => r.event.line),
    ['ops/42.json step=activate', 'ops/42.json step=restart', 'ops/42.json step=health'],
  );
});

test('event round D5 cuts within 5 s before the next retain write', async () => {
  const v = vclock();
  const dev = fakeDevice(v);
  const dir = tmp();
  const { summary } = await runCampaign(
    { rounds: 1, mode: 'event', point: 'D5', retainPeriodS: 60, out: join(dir, 'r.json') },
    baseDeps(v, dev, {
      rng: () => 0.2,
      eventLines: async function* () {
        yield 'retain: flushed 12 values';
      },
    }),
  );
  assert.equal(summary.rounds[0].cutDelayMs, 59_000); // 60 s - 0.2 x 5 s
});

test('stops on the first failing check (check-data exit 2) and runs no further round', async () => {
  const v = vclock();
  const dev = fakeDevice(v);
  let checks = 0;
  const dir = tmp();
  const logs = [];
  const { exitCode, summary } = await runCampaign(
    { rounds: 5, out: join(dir, 'r.json') },
    baseDeps(v, dev, {
      log: (m) => logs.push(m),
      runCheck: async () => {
        checks++;
        return checks === 2
          ? {
              exitCode: 2,
              stdout: checkJson('damaged', 2, [
                { name: 'history.db', status: 'damaged', detail: 'quick_check: page 7' },
              ]),
            }
          : { exitCode: 0, stdout: OK_CHECK };
      },
    }),
  );
  assert.notEqual(exitCode, 0);
  assert.equal(summary.roundsRun, 2);
  assert.equal(dev.offCount, 2);
  assert.equal(dev.onCount, 2, 'power is restored before the check, never cut again');
  assert.equal(summary.stoppedOnFailure, true);
  assert.equal(summary.failure.round, 2);
  assert.match(summary.failure.reason, /check-data/);
  assert.ok(summary.failure.investigate.length > 0);
  assert.equal(summary.result, 'fail');
  assert.ok(logs.some((l) => /giữ nguyên/.test(l)));
  const rounds = readFileSync(join(dir, 'r.rounds.jsonl'), 'utf8').trim().split('\n');
  assert.equal(rounds.length, 2);
  assert.ok(existsSync(join(dir, 'r.json')));
});

test('stops when an ACCEPTED requestId is missing from --export-audit', async () => {
  const v = vclock();
  const dev = fakeDevice(v);
  const dir = tmp();
  const { exitCode, summary } = await runCampaign(
    { rounds: 3, out: join(dir, 'r.json') },
    baseDeps(v, dev, {
      readAccepted: async () => ['r-1', 'r-2', 'r-3'],
      exportAudit: async () => '{"requestId":"r-1"}\n{"requestId":"r-3"}\n',
    }),
  );
  assert.notEqual(exitCode, 0);
  assert.equal(summary.roundsRun, 1);
  assert.deepEqual(summary.rounds[0].audit.missing, ['r-2']);
  assert.match(summary.failure.reason, /audit/);
});

test('not READY within 90 s after power on is a failure', async () => {
  const v = vclock();
  const dev = fakeDevice(v, 120_000);
  const dir = tmp();
  const { exitCode, summary } = await runCampaign(
    { rounds: 2, out: join(dir, 'r.json') },
    baseDeps(v, dev),
  );
  assert.notEqual(exitCode, 0);
  assert.equal(summary.roundsRun, 1);
  assert.equal(summary.rounds[0].readyAfter.ok, false);
  assert.match(summary.failure.reason, /READY/);
});

test('without an audit source the audit is not-measured and the campaign is incomplete, never pass', async () => {
  const v = vclock();
  const dev = fakeDevice(v);
  const dir = tmp();
  const { exitCode, summary } = await runCampaign(
    { rounds: 1, out: join(dir, 'r.json') },
    baseDeps(v, dev, { readAccepted: null, exportAudit: null }),
  );
  assert.equal(summary.rounds[0].audit.status, 'not-measured');
  assert.equal(summary.result, 'incomplete');
  assert.equal(exitCode, 3);
});

test('evaluateCheckData: exit 1 is accepted only for pulse.journal entries or a WAL needing recovery', () => {
  const pulse = evaluateCheckData(
    checkJson('warning', 1, [
      { name: 'history.db', status: 'ok', detail: '' },
      { name: 'pulse.journal', status: 'warning', detail: '2 pending pulses' },
    ]),
    1,
  );
  assert.equal(pulse.ok, true);
  assert.deepEqual(pulse.acceptedWarnings, ['pulse.journal']);
  const wal = evaluateCheckData(
    checkJson('warning', 1, [
      { name: 'history.db', status: 'warning', detail: 'WAL needs recovery (2.1 MB)' },
    ]),
    1,
  );
  assert.equal(wal.ok, true);
  const project = evaluateCheckData(
    checkJson('warning', 1, [{ name: 'project', status: 'warning', detail: 'digest differs' }]),
    1,
  );
  assert.equal(project.ok, false);
  assert.equal(evaluateCheckData(OK_CHECK, 0).ok, true);
  assert.equal(evaluateCheckData('ssh: connect to host dev port 22: timed out', 255).ok, false);
  assert.equal(evaluateCheckData(OK_CHECK, 2).ok, false, 'exit code and JSON disagree');
  assert.equal(evaluateCheckData(checkJson('damaged', 2, []), 2).ok, false);
});

test('requestId extraction: export JSON, JSONL, text; ACCEPTED lines of the command log', () => {
  assert.deepEqual(
    [...extractRequestIds('{"records":[{"requestId":"a","x":{"requestId":"b"}}]}')].sort(),
    ['a', 'b'],
  );
  assert.deepEqual([...extractRequestIds('{"requestId":"a"}\n{"requestId":"c"}\n')].sort(), [
    'a',
    'c',
  ]);
  assert.deepEqual([...extractRequestIds('id requestId=x-1 ok\nrequestId: x-2')].sort(), [
    'x-1',
    'x-2',
  ]);
  const log = [
    '{"requestId":"q1","status":"ACCEPTED"}',
    '{"requestId":"q2","status":"REJECTED"}',
    '{"requestId":"q3","result":"ACCEPTED"}',
    '2026-11-01T00:00:00Z ACCEPTED requestId=q4',
    'sent requestId=q5 (no answer)',
  ].join('\n');
  assert.deepEqual(parseAcceptedLog(log), ['q1', 'q3', 'q4']);
});

test('default httpGet accepts a self-signed certificate setting and reports errors as status 0', async () => {
  const r = await httpGet('http://127.0.0.1:1/api/v1/system/info', { timeoutMs: 500 });
  assert.equal(r.status, 0);
});

test('CLI: usage error without a driver, --help works', async () => {
  const out = [];
  assert.equal(await main(['--help'], { log: (m) => out.push(m), error: () => {} }), 0);
  assert.ok(out.join('\n').includes('--driver'));
  assert.equal(await main(['--rounds', '1'], { log: () => {}, error: () => {} }), 64);
});
