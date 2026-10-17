// Scenarios deploy, packages, busy, health, kill of tools/device-it.ps1 (specs/005-device-online
// T126; quickstart section 3). Loaded by client.mjs, which passes its helpers in `ctx`:
//   deploy:   3 projects x 10 rounds of deploy then read back (SC-002, SC-006), a change of the
//             logging file keeps history.db and adds the new column (FR-026);
//   packages: every bad vector of tests/package-vectors is refused with its code, nothing changes,
//             each refusal is audited (SC-003);
//   busy:     a second deploy while one receives its body gets 409 DEVICE_BUSY (US2-7);
//   health:   the version being tried dies or hangs: rolled back (US2-5; --test-health);
//   kill:     SIGKILL at each of the 6 steps, 4 times each (SC-004 on x64, FR-023; --test-kill-at).
// health and kill need a runtime built with -DMAT_TEST_HOOKS=ON. The runtime is restarted through
// supervise.sh, which reads /data/extra-args (the volume rt1-data, mounted here at /rt1-data).
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  audit,
  deployPackage,
  diagnostics,
  fetchPackage,
  login,
  pinnedConnect,
  pinnedRequest,
  restoreVersion,
  versions,
  waitOperation,
} from '../../tools/measure/device-api.mjs';
import { buildPackage, manifestOf, readProjectDir, variant } from './pack.mjs';

const DATA = '/rt1-data';
const STORE = `${DATA}/projects`;
const VECTORS = '/src/tests/package-vectors';
const STEPS = ['receive', 'verify-package', 'validate', 'backup', 'activate', 'health'];

export function deployScenarios(ctx) {
  const { check, measures, fp, BASE, RT1, sleep, round1, auditRows, runtimePid, httpGet } = ctx;
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };

  // ------------------------------------------------------------------------------- helpers

  async function signIn(user = 'kysu2') {
    const pw = process.env[`MAT_IT_PW_${user.toUpperCase()}`];
    if (!pw) throw new Error(`MAT_IT_PW_${user.toUpperCase()} missing`);
    for (let i = 0; i < 20; i++) {
      try {
        const r = await login(BASE, fp, user, pw);
        if (r.status === 200) return r.json.token;
        throw new Error(`login ${user}: ${r.status} ${r.json?.error}`);
      } catch (e) {
        if (i === 19 || /login /.test(e.message)) throw e;
        await sleep(500); // the runtime is still starting
      }
    }
    return '';
  }

  async function activeInfo(token) {
    const r = await versions(BASE, fp, token);
    const a = r.json?.versions?.find((v) => v.state === 'active');
    return a
      ? {
          seq: a.seq,
          digest: a.digest,
          version: a.projectVersion,
          id: a.projectId,
          count: r.json.versions.length,
        }
      : { seq: null, digest: 'none', count: 0 };
  }

  async function waitUp(timeoutMs = 40000) {
    const end = performance.now() + timeoutMs;
    while (performance.now() < end) {
      const r = await pinnedRequest(BASE, fp, 'GET', '/api/v1/device/identity', {
        timeoutMs: 2000,
      }).catch(() => null);
      if (r?.status === 200) return true;
      await sleep(300);
    }
    return false;
  }

  const setArgs = (args) => writeFileSync(`${DATA}/extra-args`, args.map((a) => `${a}\n`).join(''));

  /** SIGTERM, then wait for the supervised runtime to answer again under a new pid. */
  async function restartRuntime() {
    const old = runtimePid();
    if (old) process.kill(old, 'SIGTERM');
    const end = performance.now() + 30000;
    while (performance.now() < end) {
      await sleep(300);
      const now = runtimePid();
      if (now && now !== old) break;
    }
    return waitUp();
  }

  async function resetRuntime() {
    setArgs([]);
    return restartRuntime();
  }

  const readState = () => JSON.parse(readFileSync(`${STORE}/state.json`, 'utf8'));
  const listDir = (d) => (existsSync(d) ? readdirSync(d) : []);

  /** Seconds until state.json has no pending operation (0 if there is none now); -1 on timeout. */
  async function pendingClearedS(limitS = 40) {
    const t0 = performance.now();
    while ((performance.now() - t0) / 1000 < limitS) {
      let st = null;
      try {
        st = readState();
      } catch {
        /* being written */
      }
      if (st && !st.pending) return round1((performance.now() - t0) / 1000);
      await sleep(250);
    }
    return -1;
  }

  async function servedDigest() {
    const r = await httpGet(RT1, 8080, '/api/v1/projects/active').catch(() => null);
    return r?.json?.digest ?? null;
  }

  const projectFiles = () => {
    const tank = readProjectDir('/src/projects/tank-demo');
    const bench = readProjectDir('/src/tests/historian-it/bench-500');
    // A Vietnamese file name must be a referenced one (an unreferenced extra file is in the package
    // digest but not in the digest the runtime computes from the project: it would roll back).
    const viet = { ...tank };
    const p = JSON.parse(viet['project.json'].toString('utf8'));
    p.projectId = 'tank-viet';
    p.projectName = 'Trạm bơm (tên file tiếng Việt)';
    p.tagFile = 'thẻ-tag-trạm-bơm.json';
    viet[p.tagFile] = viet['tags.json'];
    delete viet['tags.json'];
    viet['project.json'] = Buffer.from(`${JSON.stringify(p, null, 2)}
`);
    return { 'tank-demo': tank, 'bench-500': bench, 'tank-viet': viet };
  };

  /** Rows and columns of the log_* tables of history.db (a copy: the runtime's file is untouched). */
  async function historyShape() {
    const { DatabaseSync } = await import('node:sqlite');
    const dir = mkdtempSync(join(tmpdir(), 'hist-'));
    try {
      for (const f of readdirSync(DATA).filter((n) => n.startsWith('history.db')))
        copyFileSync(join(DATA, f), join(dir, f));
      const db = new DatabaseSync(join(dir, 'history.db'));
      try {
        const tables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'log\\_%' ESCAPE '\\'",
          )
          .all()
          .map((r) => r.name);
        let rows = 0;
        let columns = 0;
        for (const t of tables) {
          rows += Number(db.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n);
          columns += db.prepare(`PRAGMA table_info("${t}")`).all().length;
        }
        return { tables: tables.length, rows, columns };
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ----------------------------------------------------------------------------------- deploy

  async function scenarioDeploy() {
    let token = await signIn();
    let cur = await activeInfo(token);
    check(
      'có project đang chạy trong kho (nhận từ thư mục cũ)',
      cur.seq !== null,
      JSON.stringify(cur),
    );
    const projects = projectFiles();
    // T140 (US3-2): the device installed the old way (a project directory of 0.3.0, no store) was
    // taken into the store at the first start: reading it up gives every file of that directory.
    const legacy = await fetchPackage(BASE, fp, token);
    const onDisk = Object.keys(projects['tank-demo']).sort().join(',');
    const inPackage =
      legacy.status === 200
        ? manifestOf(legacy.bodyBytes)
            .files.map((f) => f.path)
            .sort()
            .join(',')
        : '';
    check(
      'đọc lên project cài theo cách cũ (0.3.0): đủ file của thư mục project',
      legacy.status === 200 && inPackage === onDisk,
      `${legacy.status} ${inPackage}`,
    );
    check(
      'project cũ được nhận vào kho từ lần chạy đầu (nguồn runtime-package)',
      cur.version === '0.1.0' && cur.seq === 1,
      JSON.stringify(cur),
    );
    measures.deploy = {};
    let identical = 0;
    let total = 0;
    let worstMs = 0;
    for (const [name, files] of Object.entries(projects)) {
      const times = [];
      let same = 0;
      let committed = 0;
      let lastDetail = '';
      for (let i = 1; i <= 10; i++) {
        const pkg = buildPackage(variant(files, { projectVersion: `1.0.${i}` }));
        const t0 = performance.now();
        const r = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, cur.digest);
        if (r.status !== 202) {
          lastDetail = `${r.status} ${r.json?.error}`;
          break;
        }
        const w = await waitOperation(BASE, fp, token, r.json.opId, { timeoutMs: 90000 });
        const ms = performance.now() - t0;
        if (w.op?.result !== 'committed') {
          lastDetail = `${w.op?.result} ${w.op?.error?.code} ${JSON.stringify(w.op?.error?.issues ?? [])}`;
          break;
        }
        committed++;
        times.push(ms);
        total++;
        const back = await fetchPackage(BASE, fp, token);
        if (
          back.status === 200 &&
          back.headers['x-mat-digest'] === pkg.digest &&
          manifestOf(back.bodyBytes).digest === pkg.digest &&
          Buffer.compare(back.bodyBytes, pkg.bytes) === 0
        ) {
          same++;
          identical++;
        } else lastDetail = `đọc lên khác: ${back.status} ${back.headers['x-mat-digest']}`;
        cur = await activeInfo(token);
        if (cur.digest !== pkg.digest) lastDetail = `active ${cur.digest} != ${pkg.digest}`;
        if (i === 1) measures.deploy[name] = { packageBytes: pkg.bytes.length };
      }
      check(`${name}: 10 lần nạp xuống đều committed`, committed === 10, lastDetail);
      check(`${name}: đọc lên digest và byte giống hệt 10/10 (SC-002)`, same === 10, lastDetail);
      Object.assign((measures.deploy[name] ??= {}), {
        deployMs: { median: round1(median(times)), max: round1(Math.max(0, ...times)) },
        committed,
        identical: same,
      });
      worstMs = Math.max(worstMs, ...times);
    }
    check('SC-002: digest đọc lên giống hệt 30/30', identical === 30, `${identical}/30`);
    check(
      'SC-006 (x64): mỗi lần nạp xuống project < 1 MB xong trong 15 s',
      worstMs <= 15000,
      `${round1(worstMs)} ms`,
    );
    measures.deploy.identical = `${identical}/${total}`;
    measures.deploy.worstMs = round1(worstMs);

    // FR-026: the logging file changes (a new column, another retention): history.db stays.
    const tank = projects['tank-demo'];
    let before = await historyShape();
    for (let i = 0; i < 30 && before.rows === 0; i++) {
      await sleep(1000);
      before = await historyShape();
    }
    const logging = JSON.parse(tank['logging.json'].toString('utf8'));
    const shift = logging.groups.find((g) => g.id === 'bao-cao-ca');
    shift.tags.push({ tagId: 'TANK01.TEMP' });
    shift.retentionDays = 400;
    const pkg = buildPackage(
      variant(tank, {
        projectVersion: '1.1.0',
        replace: { 'logging.json': Buffer.from(`${JSON.stringify(logging, null, 2)}\n`) },
      }),
    );
    token = await signIn();
    cur = await activeInfo(token);
    const r = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, cur.digest);
    const w = r.status === 202 ? await waitOperation(BASE, fp, token, r.json.opId) : { op: null };
    check(
      'đổi nhóm/cột lưu trữ: nạp xuống committed',
      w.op?.result === 'committed',
      `${r.status} ${w.op?.result} ${w.op?.error?.code}`,
    );
    await sleep(3000);
    const after = await historyShape();
    check(
      'FR-026: history.db giữ dữ liệu cũ (số dòng không giảm, > 0)',
      before.rows > 0 && after.rows >= before.rows,
      `${before.rows} -> ${after.rows}`,
    );
    check(
      'FR-026: cột mới được thêm',
      after.columns > before.columns,
      `${before.columns} -> ${after.columns}`,
    );
    measures.history = { before, after };
  }

  // --------------------------------------------------------------------------------- packages

  async function scenarioPackages() {
    const token = await signIn();
    const cur = await activeInfo(token);
    const stateBefore = readFileSync(`${STORE}/state.json`, 'utf8');
    const versionDirs = listDir(`${STORE}/v`).join(',');
    const sinceId = (await auditRows()).at(-1)?.id ?? 0;
    const vectors = [];
    for (const d of readdirSync(VECTORS).sort()) {
      const exp = join(VECTORS, d, 'expected.json');
      if (!existsSync(exp)) continue;
      const e = JSON.parse(readFileSync(exp, 'utf8'));
      if (!e.code) continue;
      const file = e.generated ? join(VECTORS, e.generated) : join(VECTORS, d, 'package.matscada');
      if (!existsSync(file)) {
        check(
          `vector ${d}: có file gói`,
          false,
          `${file}: chạy node tests/package-vectors/generate.mjs --out`,
        );
        continue;
      }
      vectors.push({ name: d, code: e.code, file });
    }
    check('có vector độc để thử (>= 40)', vectors.length >= 40, String(vectors.length));
    let refused = 0;
    const wrong = [];
    let deployFailedRows = 0;
    for (const v of vectors) {
      const bytes = readFileSync(v.file);
      let digest = `sha256:${'0'.repeat(64)}`;
      try {
        digest = manifestOf(bytes).digest ?? digest;
      } catch {
        /* the vector has no readable manifest */
      }
      if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest))
        digest = `sha256:${'0'.repeat(64)}`;
      const r = await deployPackage(BASE, fp, token, bytes, digest, cur.digest, {
        timeoutMs: 60000,
      });
      let got;
      if (r.status === 202) {
        const w = await waitOperation(BASE, fp, token, r.json.opId, { timeoutMs: 60000 });
        got = w.op?.result === 'failed' ? w.op.error?.code : `result ${w.op?.result}`;
        if (w.op?.result === 'failed') deployFailedRows++;
      } else {
        got = r.json?.error ?? String(r.status);
        if (r.status === 413) got = v.code; // PACKAGE_TOO_LARGE is the API form of E_PKG_TOO_LARGE
      }
      if (got === v.code) refused++;
      else wrong.push(`${v.name}: ${got} (đợi ${v.code})`);
    }
    measures.packages = { vectors: vectors.length, refusedWithTheRightCode: refused };
    check(
      'SC-003: 100% vector độc bị từ chối đúng mã',
      refused === vectors.length,
      wrong.join('; '),
    );
    check('state.json không đổi', readFileSync(`${STORE}/state.json`, 'utf8') === stateBefore);
    check('bản đang chạy không đổi', (await activeInfo(token)).digest === cur.digest);
    check('kho không có thêm bản nào', listDir(`${STORE}/v`).join(',') === versionDirs);
    check(
      'staging rỗng',
      listDir(`${STORE}/staging`).length === 0,
      listDir(`${STORE}/staging`).join(','),
    );
    const rows = await auditRows("id > ? AND action = 'project.deploy' AND result = 'failed'", [
      sinceId,
    ]);
    check(
      'mỗi lần từ chối có audit project.deploy failed',
      rows.length >= deployFailedRows && rows.length >= vectors.length - 1,
      `${rows.length} dòng cho ${vectors.length} gói`,
    );
    check('đường dẫn đang phục vụ vẫn là bản cũ', (await servedDigest()) === cur.digest);
  }

  // --------------------------------------------------------------------------- deploy-extra-file

  /**
   * Feature 011 (T023, T054; SC-006, FR-024, research R9): 30 deploys of tank-demo. Every third one
   * carries a file the project does not reference (validate: E_PACKAGE_EXTRA_FILE, nothing
   * activated), every third one a file of an excluded folder (verify-package: E_PACKAGE_EXTRA_FILE),
   * the rest are clean: committed, and the digest the runtime serves is the package digest. Before 011
   * the first kind was committed with a digest the runtime never served, and the health check ended
   * HEALTH_TIMEOUT then rolled back: 0 HEALTH_TIMEOUT is the criterion.
   */
  async function scenarioDeployExtraFile() {
    let token = await signIn();
    let cur = await activeInfo(token);
    const tank = readProjectDir('/src/projects/tank-demo');
    const kinds = { extra: 0, excluded: 0, clean: 0 };
    const ok = { extra: 0, excluded: 0, clean: 0 };
    let healthTimeouts = 0;
    const times = [];
    const wrong = [];
    for (let i = 1; i <= 30; i++) {
      const kind = i % 3 === 1 ? 'extra' : i % 3 === 2 ? 'excluded' : 'clean';
      kinds[kind]++;
      const add =
        kind === 'extra'
          ? { 'notes.json': Buffer.from(`{"round":${i}}\n`) }
          : kind === 'excluded'
            ? { '.mat-editor/state.json': Buffer.from(`{"round":${i}}\n`) }
            : {};
      const pkg = buildPackage(variant(tank, { projectVersion: `2.0.${i}`, add }));
      const t0 = performance.now();
      const r = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, cur.digest, {
        timeoutMs: 60000,
      });
      if (r.status === 401) {
        token = await signIn();
        i--;
        kinds[kind]--;
        continue;
      }
      if (r.status !== 202) {
        wrong.push(`${i} ${kind}: ${r.status} ${r.json?.error}`);
        continue;
      }
      const w = await waitOperation(BASE, fp, token, r.json.opId, { timeoutMs: 90000 });
      times.push(performance.now() - t0);
      const op = w.op;
      if (op?.error?.code === 'HEALTH_TIMEOUT' || /HEALTH_TIMEOUT/.test(JSON.stringify(op ?? {})))
        healthTimeouts++;
      const failedStep = (op?.steps ?? []).find((s) => s.state === 'failed')?.id;
      if (kind === 'clean') {
        const served = await servedDigest();
        if (op?.result === 'committed' && served === pkg.digest) ok.clean++;
        else wrong.push(`${i} clean: ${op?.result} ${op?.error?.code} served ${served}`);
        cur = await activeInfo(token);
      } else {
        const step = kind === 'extra' ? 'validate' : 'verify-package';
        const named = kind === 'extra' ? /notes\.json/ : /\.mat-editor\/state\.json/;
        if (
          op?.result === 'failed' &&
          op.error?.code === 'E_PACKAGE_EXTRA_FILE' &&
          failedStep === step &&
          named.test(JSON.stringify(op.error))
        )
          ok[kind]++;
        else
          wrong.push(
            `${i} ${kind}: ${op?.result} ${op?.error?.code} step ${failedStep} ${JSON.stringify(op?.error?.issues ?? [])}`,
          );
        const now = await activeInfo(token);
        if (now.digest !== cur.digest) wrong.push(`${i} ${kind}: bản đang chạy đổi ${now.digest}`);
      }
    }
    check('30 lần nạp xuống đều kết thúc (không treo)', times.length === 30, wrong.join('; '));
    check(
      'tệp không được tham chiếu: 100% failed E_PACKAGE_EXTRA_FILE ở validate, nêu tên tệp',
      ok.extra === kinds.extra,
      `${ok.extra}/${kinds.extra}`,
    );
    check(
      'tệp trong .mat-editor/: 100% failed E_PACKAGE_EXTRA_FILE ở verify-package',
      ok.excluded === kinds.excluded,
      `${ok.excluded}/${kinds.excluded}`,
    );
    check(
      'gói sạch: committed, digest runtime phục vụ = digest gói',
      ok.clean === kinds.clean,
      `${ok.clean}/${kinds.clean}`,
    );
    check(
      'SC-006: 0 lần HEALTH_TIMEOUT trong 30 lần nạp xuống',
      healthTimeouts === 0,
      String(healthTimeouts),
    );
    check(
      'staging rỗng sau cùng',
      listDir(`${STORE}/staging`).length === 0,
      listDir(`${STORE}/staging`).join(','),
    );
    measures.extraFile = {
      deploys: times.length,
      kinds,
      refusedOrCommittedAsExpected: ok,
      healthTimeouts,
      deployMs: { median: round1(median(times)), max: round1(Math.max(0, ...times)) },
      mismatches: wrong,
    };
  }

  // ------------------------------------------------------------------------------- persist-slow

  /**
   * Feature 011 (T054; SC-007, FR-023, research R8): the records of an operation are written outside the mutex
   * of the pipeline. With every fsync of the store 500 ms slow (--test-persist-delay-ms, MAT_TEST_HOOKS), a deploy
   * runs while GET /api/v1/projects/active is asked every 20 ms: p99 ≤ 50 ms (x64). Then every fsync of the store
   * fails ENOSPC (--test-persist-fail): the deploy fails PERSIST_FAILED, nothing is activated, the old version runs.
   */
  async function scenarioPersistSlow() {
    const tank = readProjectDir('/src/projects/tank-demo');
    setArgs(['--test-persist-delay-ms', '500']);
    check('chạy lại với fsync chậm 500 ms', await restartRuntime());
    let token = await signIn();
    let cur = await activeInfo(token);
    const pkg = buildPackage(variant(tank, { projectVersion: '3.0.1' }));
    const lat = [];
    let polling = true;
    let pollErrors = 0;
    const poller = (async () => {
      while (polling) {
        const t = performance.now();
        const r = await httpGet(RT1, 8080, '/api/v1/projects/active').catch(() => null);
        if (r?.status === 200) lat.push(performance.now() - t);
        else pollErrors++;
        await sleep(20);
      }
    })();
    const t0 = performance.now();
    const r = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, cur.digest, {
      timeoutMs: 60000,
    });
    // the operation runs while the old process serves, until the restart into the new version
    const w =
      r.status === 202
        ? await waitOperation(BASE, fp, token, r.json.opId, { timeoutMs: 180000 })
        : { op: null };
    polling = false;
    await poller;
    const sorted = [...lat].sort((a, b) => a - b);
    const p99 = sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]
      : -1;
    check(
      'fsync chậm: nạp xuống vẫn committed',
      w.op?.result === 'committed',
      `${r.status} ${w.op?.result} ${w.op?.error?.code ?? ''}`,
    );
    check(
      'SC-007 (x64): GET projects/active p99 ≤ 50 ms trong lúc nạp xuống với fsync 500 ms',
      sorted.length >= 20 && p99 >= 0 && p99 <= 50,
      `p99 ${round1(p99)} ms trên ${sorted.length} lần (${pollErrors} lần không trả lời: lúc chạy lại)`,
    );
    measures.persist = {
      fsyncDelayMs: 500,
      reads: sorted.length,
      readsWithoutAnswer: pollErrors,
      p50Ms: round1(sorted[Math.floor(sorted.length / 2)] ?? -1),
      p99Ms: round1(p99),
      maxMs: round1(sorted.at(-1) ?? -1),
      deployMs: round1(performance.now() - t0),
    };

    setArgs(['--test-persist-fail']);
    check('chạy lại với fsync lỗi ENOSPC', await restartRuntime());
    token = await signIn();
    cur = await activeInfo(token);
    const pkg2 = buildPackage(variant(tank, { projectVersion: '3.0.2' }));
    const r2 = await deployPackage(BASE, fp, token, pkg2.bytes, pkg2.digest, cur.digest, {
      timeoutMs: 60000,
    });
    let code = r2.json?.error;
    if (r2.status === 202) {
      const w2 = await waitOperation(BASE, fp, token, r2.json.opId, { timeoutMs: 60000 });
      code = w2.op?.result === 'failed' ? w2.op.error?.code : `result ${w2.op?.result}`;
    }
    check(
      'ENOSPC: nạp xuống thất bại PERSIST_FAILED',
      code === 'PERSIST_FAILED',
      `${r2.status} ${code}`,
    );
    check('ENOSPC: bản đang chạy không đổi', (await activeInfo(token)).digest === cur.digest);
    check('ENOSPC: digest đang phục vụ không đổi', (await servedDigest()) === cur.digest);
    measures.persist.enospc = { status: r2.status, code };
    check('kết thúc: bỏ cờ test, runtime chạy lại', await resetRuntime());
  }

  // -------------------------------------------------------------------------------------- busy

  async function scenarioBusy() {
    const token = await signIn();
    const cur = await activeInfo(token);
    const pkg = buildPackage(
      variant(readProjectDir('/src/projects/tank-demo'), { projectVersion: '4.0.0' }),
    );
    // First deploy: headers and 1000 bytes of the body, then silence: the device is receiving.
    const conn = await pinnedConnect(BASE, fp);
    conn.socket.on('error', () => {});
    conn.socket.write(
      `POST /api/v1/project/deployments HTTP/1.1\r\nHost: ${RT1}:8443\r\n` +
        `Content-Type: application/zip\r\nContent-Length: ${pkg.bytes.length}\r\n` +
        `X-Mat-Digest: ${pkg.digest}\r\nX-Mat-Base-Digest: ${cur.digest}\r\n` +
        `Authorization: Bearer ${token}\r\nConnection: close\r\n\r\n`,
    );
    conn.socket.write(pkg.bytes.subarray(0, 1000));
    await sleep(800);
    const second = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, cur.digest);
    check(
      'lần nạp xuống thứ hai: 409 DEVICE_BUSY',
      second.status === 409 && second.json?.error === 'DEVICE_BUSY',
      `${second.status} ${second.json?.error}`,
    );
    const j = second.json ?? {};
    check(
      'DEVICE_BUSY kèm opId, loại, người, nguồn, thời điểm',
      Boolean(j.opId && j.kind === 'deploy' && j.user === 'kysu2' && j.source && j.since),
      JSON.stringify(j),
    );
    const rest = await restoreVersion(BASE, fp, token, cur.seq, cur.digest);
    check(
      'khôi phục khi đang bận: 409 DEVICE_BUSY',
      rest.status === 409 && rest.json?.error === 'DEVICE_BUSY',
      `${rest.status} ${rest.json?.error}`,
    );
    const op = await pinnedRequest(BASE, fp, 'GET', '/api/v1/project/operation', { token });
    check(
      'operation: thao tác đang nhận (running)',
      op.json?.result === 'running',
      op.json?.result,
    );
    conn.socket.destroy(); // network drops during the upload
    let last = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      last = (await pinnedRequest(BASE, fp, 'GET', '/api/v1/project/operation', { token })).json;
      if (last?.result && last.result !== 'running') break;
    }
    check(
      'mạng rớt giữa lúc gửi: failed RECEIVE_ABORTED',
      last?.result === 'failed' && last?.error?.code === 'RECEIVE_ABORTED',
      `${last?.result} ${last?.error?.code}`,
    );
    check('staging rỗng, khóa nhả', listDir(`${STORE}/staging`).length === 0);
    const again = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, cur.digest);
    const w =
      again.status === 202 ? await waitOperation(BASE, fp, token, again.json.opId) : { op: null };
    check(
      'sau đó nạp xuống bình thường',
      w.op?.result === 'committed',
      `${again.status} ${w.op?.result}`,
    );
    measures.busy = { busyBody: second.json };
  }

  // ------------------------------------------------------------------------------------ health

  async function scenarioHealth() {
    const tank = readProjectDir('/src/projects/tank-demo');
    measures.health = {};
    for (const [mode, code, ver] of [
      ['die', 'HEALTH_CRASH', '5.0.0'],
      ['hang', 'HEALTH_TIMEOUT', '5.0.1'],
    ]) {
      setArgs(['--test-health', mode]);
      check(`--test-health ${mode}: runtime chạy lại`, await restartRuntime());
      const token = await signIn();
      const cur = await activeInfo(token);
      const pkg = buildPackage(variant(tank, { projectVersion: ver }));
      const sinceId = (await auditRows()).at(-1)?.id ?? 0;
      const r = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, cur.digest);
      const w =
        r.status === 202
          ? await waitOperation(BASE, fp, token, r.json.opId, {
              timeoutMs: 120000,
              reauth: () => signIn(),
            })
          : { op: null, ms: 0 };
      check(
        `${mode}: kết quả rolled-back, mã ${code}`,
        w.op?.result === 'rolled-back' && w.op?.error?.code === code,
        `${r.status} ${w.op?.result} ${w.op?.error?.code}`,
      );
      await sleep(1000);
      const token2 = await signIn();
      const now = await activeInfo(token2);
      check(
        `${mode}: chạy lại bản cũ`,
        now.digest === cur.digest,
        `${now.version} (đợi ${cur.version})`,
      );
      check(`${mode}: pending hết`, (await pendingClearedS(20)) >= 0);
      check(
        `${mode}: audit project.deploy rolled-back`,
        (
          await auditRows("id > ? AND action = 'project.deploy' AND result = 'rolled-back'", [
            sinceId,
          ])
        ).length >= 1,
      );
      measures.health[mode] = { rolledBackAfterS: round1(w.ms / 1000), code: w.op?.error?.code };
    }
    check('kết thúc: bỏ cờ test, runtime chạy lại', await resetRuntime());
  }

  // -------------------------------------------------------------------------------------- kill

  async function scenarioKill() {
    const rounds = Number(ctx.opt('--rounds', '24'));
    const perStep = Math.ceil(rounds / STEPS.length);
    const tank = readProjectDir('/src/projects/tank-demo');
    const tally = { total: 0, oldVersion: 0, newVersion: 0, bad: [] };
    const clearTimes = [];
    let n = 0;
    for (const step of STEPS) {
      if (n >= rounds) break;
      setArgs(
        step === 'health'
          ? ['--test-health', 'hang']
          : step === 'receive'
            ? []
            : ['--test-kill-at', step],
      );
      if (!(await restartRuntime())) {
        check(`${step}: runtime chạy lại sau khi đặt cờ`, false);
        continue;
      }
      for (let k = 0; k < perStep && n < rounds; k++, n++) {
        const token = await signIn();
        const pre = await activeInfo(token);
        const pkg = buildPackage(variant(tank, { projectVersion: `6.${n}.0` }));
        const name = `${step} #${k + 1}`;
        if (step === 'receive') {
          const conn = await pinnedConnect(BASE, fp);
          conn.socket.on('error', () => {});
          conn.socket.write(
            `POST /api/v1/project/deployments HTTP/1.1\r\nHost: ${RT1}:8443\r\n` +
              `Content-Type: application/zip\r\nContent-Length: ${pkg.bytes.length}\r\n` +
              `X-Mat-Digest: ${pkg.digest}\r\nX-Mat-Base-Digest: ${pre.digest}\r\n` +
              `Authorization: Bearer ${token}\r\nConnection: close\r\n\r\n`,
          );
          conn.socket.write(pkg.bytes.subarray(0, 2000));
          await sleep(300 + Math.floor(Math.random() * 500));
          process.kill(runtimePid(), 'SIGKILL');
          conn.socket.destroy();
        } else if (step === 'health') {
          const r = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, pre.digest);
          if (r.status !== 202) {
            tally.bad.push(`${name}: POST ${r.status}`);
            continue;
          }
          // wait for the new version to be pending and the runtime to be up again (health hangs)
          let ok = false;
          for (let i = 0; i < 60 && !ok; i++) {
            await sleep(250);
            try {
              ok = Boolean(readState().pending) && (await waitUp(1000)) && runtimePid() > 0;
            } catch {
              /* restarting */
            }
          }
          setArgs([]); // the restart after the kill has no hang flag
          await sleep(200 + Math.floor(Math.random() * 1500));
          process.kill(runtimePid(), 'SIGKILL');
        } else {
          // the runtime may be killed before it answers: a reset is not a refusal
          const r = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, pre.digest).catch(
            () => ({ status: 202 }),
          );
          if (r.status !== 202) {
            tally.bad.push(`${name}: POST ${r.status} ${r.json?.error}`);
            continue;
          }
          // the runtime kills itself before `step` (SIGKILL); wait for the pid to go
          const old = runtimePid();
          for (let i = 0; i < 80 && runtimePid() === old; i++) await sleep(100);
        }
        const up = await waitUp(60000);
        const cleared = await pendingClearedS(40);
        if (cleared >= 0) clearTimes.push(cleared);
        tally.total++;
        let line = `${name}: `;
        if (!up || cleared < 0) {
          tally.bad.push(`${line}runtime không lên lại (${up}) hoặc pending còn (${cleared})`);
          continue;
        }
        await sleep(500);
        const t2 = await signIn();
        const now = await activeInfo(t2);
        const served = await servedDigest();
        const isOld = now.digest === pre.digest;
        const isNew = now.digest === pkg.digest;
        const op = (
          await pinnedRequest(BASE, fp, 'GET', '/api/v1/project/operation', { token: t2 })
        ).json;
        const failedStep = op?.steps?.find((s) => s.state === 'failed')?.id;
        line += `${isOld ? 'bản cũ' : isNew ? 'bản mới' : 'LẠ'}, op ${op?.result}${failedStep ? ` tại ${failedStep}` : ''}`;
        const expectOld = step !== 'health';
        let good = (isOld || isNew) && served === now.digest;
        if (expectOld) good = good && isOld && op?.result === 'interrupted' && failedStep === step;
        else good = good && ['committed', 'rolled-back'].includes(op?.result);
        if (step === 'receive') good = good && listDir(`${STORE}/staging`).length === 0;
        if (isOld) tally.oldVersion++;
        if (isNew) tally.newVersion++;
        if (!good) tally.bad.push(line);
        if (n < 3 || !good) measures[`kill:${name}`] = line;
      }
    }
    check(
      `kill: ${tally.total}/${rounds} vòng chạy đủ`,
      tally.total === rounds,
      tally.bad.join('; '),
    );
    check(
      'kill: mọi lần khởi động sau chạy bản cũ hoặc bản mới hoàn chỉnh, đúng bước, hết pending',
      tally.bad.length === 0,
      tally.bad.join('; '),
    );
    check(
      'kill: --project-status hết pending sau <= 20 s (FR-023)',
      clearTimes.length > 0 && Math.max(...clearTimes) <= 20,
      `max ${Math.max(0, ...clearTimes)} s`,
    );
    measures.kill = {
      rounds: tally.total,
      stepsTested: STEPS,
      endedOnOldVersion: tally.oldVersion,
      endedOnNewVersion: tally.newVersion,
      pendingClearedS: { median: median(clearTimes), max: Math.max(0, ...clearTimes) },
    };
    check('kết thúc: bỏ cờ test, runtime chạy lại', await resetRuntime());
  }

  return {
    deploy: scenarioDeploy,
    'deploy-extra-file': scenarioDeployExtraFile,
    'persist-slow': scenarioPersistSlow,
    packages: scenarioPackages,
    busy: scenarioBusy,
    health: scenarioHealth,
    kill: scenarioKill,
    helpers: { signIn, activeInfo, audit, diagnostics },
  };
}
