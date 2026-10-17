// Kiểm thư mục phát hành, phần không phụ thuộc Windows (feature 011, T094; FR-051, FR-052; contract release-signing
// §5, §7, §8). verify-release.ps1 gọi script này sau khi kiểm Authenticode.
//
//   node tools/release/verify-release.mjs --dir release/<ver> --keys deployment/keys
//        [--verifier <mat-update-verify>] [--allow-missing installer,matupdate,...] [--release]
//        [--break-cases [--other-keys <thư mục>]] [--json]
//
// Kiểm: đủ mục của FR-052, chữ ký SHA256SUMS.sig (bằng `mat-update-verify` nếu truyền --verifier, không thì bản Node
// cùng mã thoát), băm từng tệp, tệp thừa/thiếu, `.sha256` của gói runtime, chữ ký manifest của `.matupdate`, SBOM,
// build-info.json. `--break-cases` chạy ca hỏng 6–12 của contract §8 trên bản sao tạm (ca 1–5 là Authenticode, chỉ
// verify-release.ps1 trên Windows chạy được). `--allow-missing` chỉ có hiệu lực khi không `--release`.
// Mã thoát: 0 đạt, 1 có lỗi (hoặc ca hỏng không bị từ chối), 2 dùng sai.
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvelope } from './lib/envelope.mjs';
import {
  SUMS,
  SUMS_SIG,
  VERIFY,
  loadTrustedKeys,
  parseSums,
  releaseFiles,
  sha256File,
  verifySignature,
} from './lib/release-crypto.mjs';
import { verifySumsFile } from './sums.mjs';

/** Chín mục của FR-052 (SHA256SUMS và .sig tính chung một mục ở spec, tách ra ở đây). */
export const ARTIFACTS = [
  ['installer', 'bộ cài Studio (*-setup.exe)', (n) => /-setup\.exe$/i.test(n)],
  ['runtime', 'mat-runtime-armhf.tar.gz', (n) => n === 'mat-runtime-armhf.tar.gz'],
  ['runtimeSha', 'mat-runtime-armhf.tar.gz.sha256', (n) => n === 'mat-runtime-armhf.tar.gz.sha256'],
  ['matupdate', '*.matupdate', (n) => n.endsWith('.matupdate')],
  ['sums', SUMS, (n) => n === SUMS],
  ['sig', SUMS_SIG, (n) => n === SUMS_SIG],
  ['sbom', 'sbom.cdx.json', (n) => n === 'sbom.cdx.json'],
  ['licenses', 'licenses.md', (n) => n === 'licenses.md'],
  ['notes', 'RELEASE-NOTES.md', (n) => n === 'RELEASE-NOTES.md'],
  ['buildInfo', 'build-info.json', (n) => n === 'build-info.json'],
];

const VERIFY_CODE = { 3: 'SIG_INVALID', 4: 'KEY_UNKNOWN', 5: 'SUMS_FORMAT' };

function runVerifier(verifier, args) {
  const r = spawnSync(verifier, args, { encoding: 'utf8' });
  if (r.error) return { code: -1, reason: r.error.message };
  return { code: r.status, reason: (r.stderr || r.stdout || '').trim().split('\n').pop() };
}

/**
 * @param {string} dir
 * @param {{ keysDir: string, verifier?: string|null, allowMissing?: string[], release?: boolean }} opt
 */
export function verifyRelease(dir, opt) {
  const failures = [];
  const checks = [];
  const warnings = [];
  const fail = (code, message) => failures.push({ code, message });
  const allow = new Set(opt.release ? [] : (opt.allowMissing ?? []));
  const names = existsSync(dir) ? readdirSync(dir) : [];

  for (const [id, label, match] of ARTIFACTS) {
    if (names.some(match)) continue;
    if (allow.has(id)) warnings.push(`BỎ QUA: thiếu ${label} (được phép ở chế độ thử)`);
    else fail('ARTIFACT_MISSING', `thiếu ${label}`);
  }

  let buildInfo = null;
  if (names.includes('build-info.json')) {
    try {
      buildInfo = JSON.parse(readFileSync(join(dir, 'build-info.json'), 'utf8'));
      if (typeof buildInfo.version !== 'string' || typeof buildInfo.release !== 'boolean') {
        fail('BUILD_INFO_INVALID', 'thiếu version hoặc release');
      } else if (opt.release && buildInfo.release !== true) {
        fail(
          'BUILD_INFO_INVALID',
          'build-info.json.release = false trong khi kiểm chế độ phát hành',
        );
      } else checks.push(`build-info.json: ${buildInfo.version}, release = ${buildInfo.release}`);
    } catch (e) {
      fail('BUILD_INFO_INVALID', e.message);
    }
  }
  const expectKeyId = buildInfo?.signing?.releaseKeyId ?? null;

  const sumsPath = join(dir, SUMS);
  const sigPath = join(dir, SUMS_SIG);
  if (existsSync(sumsPath) && existsSync(sigPath)) {
    const r = opt.verifier
      ? runVerifier(opt.verifier, [sumsPath, '--sig', sigPath, '--keys', opt.keysDir])
      : verifySumsFile({ sumsPath, sigPath, keysDir: opt.keysDir, expectKeyId });
    if (r.code === VERIFY.OK) {
      checks.push(
        `${SUMS_SIG}: hợp lệ${r.keyId ? `, khóa ${r.keyId}` : ''} (${opt.verifier ? 'mat-update-verify' : 'Node'})`,
      );
    } else fail(VERIFY_CODE[r.code] ?? 'VERIFIER_ERROR', `${SUMS_SIG} (mã ${r.code}): ${r.reason}`);

    let entries = null;
    try {
      entries = parseSums(readFileSync(sumsPath, 'utf8'));
    } catch (e) {
      if (!failures.some((f) => f.code === 'SUMS_FORMAT')) fail('SUMS_FORMAT', e.message);
    }
    if (entries) {
      const listed = new Set(entries.map((e) => e.name));
      let okCount = 0;
      for (const e of entries) {
        const p = join(dir, e.name);
        if (!existsSync(p))
          fail('MISSING_FILE', `${e.name} có trong ${SUMS} mà không có trong thư mục`);
        else if (sha256File(p) !== e.sha256)
          fail('HASH_MISMATCH', `${e.name}: băm không khớp ${SUMS}`);
        else okCount++;
      }
      for (const n of releaseFiles(dir)) {
        if (!listed.has(n)) fail('EXTRA_FILE', `${n} không có trong ${SUMS}`);
      }
      checks.push(`${SUMS}: ${okCount}/${entries.length} tệp khớp băm`);
    }
  }

  const tgz = join(dir, 'mat-runtime-armhf.tar.gz');
  const tgzSha = `${tgz}.sha256`;
  if (existsSync(tgz) && existsSync(tgzSha)) {
    const want = readFileSync(tgzSha, 'utf8').trim().split(/\s+/)[0];
    if (want !== sha256File(tgz))
      fail('RUNTIME_SHA_MISMATCH', 'mat-runtime-armhf.tar.gz.sha256 không khớp');
    else checks.push('mat-runtime-armhf.tar.gz.sha256: khớp');
  }

  const { keys } = loadTrustedKeys(opt.keysDir);
  for (const n of names.filter((x) => x.endsWith('.matupdate')).sort()) {
    const p = join(dir, n);
    if (opt.verifier) {
      const r = runVerifier(opt.verifier, [p, '--keys', opt.keysDir]);
      if (r.code !== 0)
        fail('MATUPDATE_SIG_INVALID', `${n} (mat-update-verify mã ${r.code}): ${r.reason}`);
      else checks.push(`${n}: mat-update-verify hợp lệ`);
      continue;
    }
    try {
      const env = readEnvelope(readFileSync(p));
      const r = verifySignature({
        data: env.manifest,
        signature: env.signature,
        keys,
        expectKeyId,
      });
      if (r.code !== 0) fail('MATUPDATE_SIG_INVALID', `${n} (mã ${r.code}): ${r.reason}`);
      else checks.push(`${n}: chữ ký manifest hợp lệ (Node; kiểm đầy đủ bằng mat-update-verify)`);
    } catch (e) {
      fail('MATUPDATE_FORMAT', `${n}: ${e.message}`);
    }
  }

  if (names.includes('sbom.cdx.json')) {
    try {
      const bom = JSON.parse(readFileSync(join(dir, 'sbom.cdx.json'), 'utf8'));
      if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.5' || !bom.components?.length) {
        fail('SBOM_INVALID', 'không phải CycloneDX 1.5 có thành phần');
      } else checks.push(`sbom.cdx.json: CycloneDX 1.5, ${bom.components.length} thành phần`);
    } catch (e) {
      fail('SBOM_INVALID', e.message);
    }
  }
  return { ok: failures.length === 0, checks, failures, warnings };
}

export const BREAK_CASES = [
  [1, 'sửa 1 byte của bộ cài', 'HashMismatch'],
  [2, 'sửa 1 byte của mat-studio.exe', 'HashMismatch'],
  [3, 'gỡ chữ ký của bộ cài', 'NotSigned'],
  [4, 'thay chữ ký bằng chữ ký của chứng chỉ khác', 'THUMBPRINT'],
  [5, 'bỏ dấu thời gian', 'NO_TIMESTAMP'],
  [6, `sửa 1 dòng của ${SUMS}`, 'SIG_INVALID'],
  [7, `sửa 1 byte của ${SUMS_SIG}`, 'SIG_INVALID'],
  [8, 'dùng khóa công khai khác', 'KEY_UNKNOWN'],
  [9, `sửa 1 byte của tệp có trong ${SUMS}`, 'HASH_MISMATCH'],
  [10, `thêm tệp không có trong ${SUMS}`, 'EXTRA_FILE'],
  [11, `xóa tệp có trong ${SUMS}`, 'MISSING_FILE'],
  [12, '.matupdate đổi releaseSeq', 'MATUPDATE_SIG_INVALID'],
];

const flip = (p, at = null) => {
  const b = readFileSync(p);
  const i = at ?? Math.floor(b.length / 2);
  b[i] ^= 0x01;
  writeFileSync(p, b);
};

/** Chạy ca hỏng 6–12 trên bản sao của `dir`; ca 1–5 trả `skipped`. */
export function runBreakCases(dir, opt) {
  const work = mkdtempSync(join(tmpdir(), 'mat-break-'));
  try {
    let otherKeys = opt.otherKeysDir;
    if (!otherKeys) {
      otherKeys = join(work, 'other-keys');
      mkdirSync(otherKeys);
      const k = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      writeFileSync(
        join(otherKeys, 'other.pub.pem'),
        k.publicKey.export({ type: 'spki', format: 'pem' }),
      );
    }
    const entries = parseSums(readFileSync(join(dir, SUMS), 'utf8'));
    const pick = (pref) => entries.find((e) => pref.test(e.name))?.name ?? entries[0].name;
    const mutations = {
      6: (d) => {
        const p = join(d, SUMS);
        const t = readFileSync(p, 'utf8');
        writeFileSync(p, (t[0] === '0' ? '1' : '0') + t.slice(1));
      },
      7: (d) => flip(join(d, SUMS_SIG)),
      8: () => ({ keysDir: otherKeys }),
      9: (d) => flip(join(d, pick(/\.(tar\.gz|md)$/))),
      10: (d) => writeFileSync(join(d, 'extra.bin'), 'không có trong SHA256SUMS'),
      11: (d) => unlinkSync(join(d, pick(/RELEASE-NOTES\.md$/))),
      12: (d) => {
        const n = readdirSync(d).find((x) => x.endsWith('.matupdate'));
        if (!n) return { skip: 'không có .matupdate (make-update.mjs: T106, T117)' };
        const p = join(d, n);
        const b = readFileSync(p);
        const m = /"releaseSeq"\s*:\s*(\d+)/.exec(b.toString('latin1'));
        if (!m) return { skip: 'manifest không có releaseSeq' };
        const pos = m.index + m[0].length - 1;
        b[pos] = b[pos] === 0x39 ? 0x38 : b[pos] + 1;
        writeFileSync(p, b);
        return null;
      },
    };
    const out = [];
    for (const [id, name, expected] of BREAK_CASES) {
      if (id <= 5) {
        out.push({
          id,
          name,
          expected,
          skipped: 'Authenticode: chỉ verify-release.ps1 trên Windows',
        });
        continue;
      }
      const d = join(work, `case-${id}`);
      cpSync(dir, d, { recursive: true });
      const extra = mutations[id](d) ?? {};
      if (extra.skip) {
        out.push({ id, name, expected, skipped: extra.skip });
        continue;
      }
      const r = verifyRelease(d, { ...opt, keysDir: extra.keysDir ?? opt.keysDir });
      const codes = [...new Set(r.failures.map((f) => f.code))];
      out.push({
        id,
        name,
        expected,
        codes,
        rejected: !r.ok,
        codeMatches: codes.includes(expected),
      });
    }
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  const argv = process.argv.slice(2);
  const o = { allowMissing: [], release: false, json: false, breakCases: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      if (i + 1 >= argv.length) {
        console.error(`verify-release: thiếu giá trị cho ${a}`);
        process.exit(2);
      }
      return argv[++i];
    };
    if (a === '--dir') o.dir = resolve(v());
    else if (a === '--keys') o.keysDir = resolve(v());
    else if (a === '--other-keys') o.otherKeysDir = resolve(v());
    else if (a === '--verifier') o.verifier = v();
    else if (a === '--allow-missing') o.allowMissing = v().split(',').filter(Boolean);
    else if (a === '--release') o.release = true;
    else if (a === '--break-cases') o.breakCases = true;
    else if (a === '--json') o.json = true;
    else {
      console.error(`verify-release: tham số lạ ${a}`);
      process.exit(2);
    }
  }
  if (!o.dir || !o.keysDir) {
    console.error('verify-release: cần --dir và --keys');
    process.exit(2);
  }
  const r = verifyRelease(o.dir, o);
  const breakCases = o.breakCases ? runBreakCases(o.dir, o) : [];
  const ran = breakCases.filter((c) => !c.skipped);
  const allRejected = ran.every((c) => c.rejected);
  const ok = r.ok && allRejected;
  if (o.json) {
    console.log(JSON.stringify({ ...r, ok, breakCases }, null, 2));
  } else {
    for (const c of r.checks) console.log(`OK  ${c}`);
    for (const w of r.warnings) console.log(w);
    for (const c of breakCases) {
      if (c.skipped) console.log(`ca ${c.id} BỎ QUA: ${c.name} (${c.skipped})`);
      else {
        const tag = c.rejected ? 'từ chối' : 'KHÔNG bị từ chối';
        const note = c.codeMatches ? '' : ` (mong ${c.expected})`;
        console.log(`ca ${c.id} ${tag}: ${c.name} → ${c.codes.join(', ') || 'không lỗi'}${note}`);
      }
    }
    if (o.breakCases) {
      console.log(`ca hỏng: ${ran.filter((c) => c.rejected).length}/${ran.length} bị từ chối`);
    }
  }
  for (const f of r.failures) console.error(`LỖI ${f.code}: ${f.message}`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
