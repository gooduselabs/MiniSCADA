// Cổng `-Release` của sign.ps1 và release.ps1 (feature 011, T092, T098; FR-049; contract release-signing §2).
//
//   node tools/release/gate.mjs --info <info.json> [--release] [--phase pre|post|all] [--now <ISO>] [--json]
//   node tools/release/gate.mjs --tree <repo> [--build-info <tệp>] [--ignore <đường dẫn,...>]
//
// Logic cổng nằm ở đây (Node) để test được trên mọi máy; PowerShell (lib/signing.ps1) chỉ đọc chứng chỉ, chữ ký
// Authenticode và cây git rồi gọi script này. `info`:
//   cert       { thumbprint, subject, issuer, friendlyName, notBefore, notAfter, ekus[], keyAlgorithm, keySize,
//                signatureAlgorithm, chainTrusted (true|false|null: không dựng được chuỗi) }
//   signature  { status, timestamped, verified, digest } (sau khi ký; null nếu chưa ký)
//   tree       { dirty, commit, buildInfoCommit } (null nếu không đọc được)
//   releaseKey { keyId } (khóa ECDSA ký SHA256SUMS), testKeyIds [] (keyId của khóa thử trong tests/update-vectors/keys/)
// Pha `pre` xét điều kiện 1–5, 8 và khóa thử; `post` xét 6, 7; `all` xét hết. Chế độ không `-Release` bỏ 2, 3, 6, 8,
// cho phép chứng chỉ TEST và khóa thử, nhưng luôn in "BẢN THỬ, KHÔNG PHÁT HÀNH". Giá trị không biết (null) ở chế độ
// phát hành là từ chối: không chứng minh được thì không phát hành.
// Mã thoát: 0 qua, 1 từ chối, 2 dùng sai.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CODE_SIGNING_EKU = '1.3.6.1.5.5.7.3.3';
export const TEST_BANNER = 'BẢN THỬ, KHÔNG PHÁT HÀNH';

export const CODES = {
  CERT_TEST: 'chứng chỉ thử (chủ thể hoặc tên thân thiện chứa TEST)',
  CERT_SELF_SIGNED: 'chứng chỉ tự ký hoặc không dựng được chuỗi tới gốc tin cậy của Windows',
  CERT_EXPIRING: 'chứng chỉ hết hạn hoặc còn ≤ 30 ngày',
  CERT_EKU: `thiếu EKU Code Signing ${CODE_SIGNING_EKU}`,
  CERT_WEAK: 'khóa dưới RSA 3072 hoặc ECDSA P-256, hoặc băm dưới SHA-256',
  NO_TIMESTAMP: 'chữ ký không có dấu thời gian RFC 3161',
  VERIFY_AFTER_SIGN: 'chữ ký không kiểm lại được sau khi ký',
  DIRTY_TREE: 'cây git có thay đổi chưa commit hoặc mã commit không khớp build-info.json',
  CERT_TEST_KEY: 'khóa phát hành ECDSA là khóa thử (tests/update-vectors/keys/)',
};

const PHASES = {
  pre: new Set([1, 2, 3, 4, 5, 8, 'key']),
  post: new Set([6, 7]),
  all: new Set([1, 2, 3, 4, 5, 6, 7, 8, 'key']),
};

const norm = (dn) =>
  String(dn ?? '')
    .split(/,\s*/)
    .map((p) => p.trim().toLowerCase())
    .sort()
    .join(',');

/**
 * @param {object} info
 * @param {{ release?: boolean, phase?: 'pre'|'post'|'all', now?: Date }} [opt]
 */
export function evaluateGate(info, opt = {}) {
  const release = opt.release === true;
  const want = PHASES[opt.phase ?? 'all'];
  if (!want) throw new Error(`pha lạ: ${opt.phase}`);
  const now = opt.now ?? new Date();
  const failures = [];
  const warnings = [];
  const fail = (code, detail) =>
    failures.push({ code, message: `${CODES[code]}${detail ? `: ${detail}` : ''}` });
  const cert = info.cert ?? null;
  const sig = info.signature ?? null;
  let testBuild = !release;

  if (want.has(1) && cert) {
    const isTest = /test/i.test(cert.subject ?? '') || /test/i.test(cert.friendlyName ?? '');
    if (isTest) {
      if (release) fail('CERT_TEST', cert.subject);
      testBuild = true;
    }
  }
  if (want.has(2) && release) {
    if (!cert) fail('CERT_SELF_SIGNED', 'không có thông tin chứng chỉ');
    else if (norm(cert.subject) === norm(cert.issuer))
      fail('CERT_SELF_SIGNED', `người phát hành = chủ thể`);
    else if (cert.chainTrusted !== true) {
      fail(
        'CERT_SELF_SIGNED',
        cert.chainTrusted === false ? 'chuỗi không tới gốc tin cậy' : 'không kiểm được chuỗi',
      );
    }
  }
  if (want.has(3) && cert) {
    const left = (Date.parse(cert.notAfter) - now.getTime()) / 86400000;
    if (!Number.isFinite(left)) {
      if (release) fail('CERT_EXPIRING', 'không đọc được ngày hết hạn');
    } else if (left <= 30) {
      if (release) fail('CERT_EXPIRING', `còn ${Math.floor(left)} ngày (${cert.notAfter})`);
      else warnings.push(`chứng chỉ còn ${Math.floor(left)} ngày`);
    }
  }
  if (want.has(4) && cert) {
    if (!Array.isArray(cert.ekus) || !cert.ekus.includes(CODE_SIGNING_EKU)) {
      fail('CERT_EKU', `EKU: ${(cert.ekus ?? []).join(', ') || 'không có'}`);
    }
  }
  if (want.has(5) && cert) {
    const alg = String(cert.keyAlgorithm ?? '').toUpperCase();
    const size = Number(cert.keySize);
    const weakKey =
      alg === 'RSA' ? !(size >= 3072) : alg === 'ECDSA' || alg === 'EC' ? !(size >= 256) : true;
    const weakHash = /md5|sha1(?!\d)|md2/i.test(cert.signatureAlgorithm ?? '');
    if (weakKey) fail('CERT_WEAK', `${cert.keyAlgorithm} ${cert.keySize}`);
    else if (weakHash) fail('CERT_WEAK', `chứng chỉ ký bằng ${cert.signatureAlgorithm}`);
  }
  if (want.has(5) && sig?.digest && !/^sha(256|384|512)$/i.test(sig.digest)) {
    fail('CERT_WEAK', `chữ ký tệp dùng ${sig.digest}`);
  }
  if (want.has(6) && release && sig?.timestamped !== true) {
    fail('NO_TIMESTAMP', sig ? `timestamped = ${sig.timestamped}` : 'chưa ký');
  }
  if (want.has(7)) {
    const v = sig?.verified;
    if (v === false || (release && v !== true)) {
      fail('VERIFY_AFTER_SIGN', sig?.status ? `trạng thái ${sig.status}` : 'không kiểm được');
    } else if (v !== true) {
      warnings.push('chữ ký chưa được kiểm lại (không có Get-AuthenticodeSignature ngoài Windows)');
    }
  }
  if (want.has(8) && release) {
    const t = info.tree;
    if (!t) fail('DIRTY_TREE', 'không đọc được trạng thái git');
    else if (t.dirty) fail('DIRTY_TREE', 'có thay đổi chưa commit');
    else if (!t.commit) fail('DIRTY_TREE', 'không có mã commit');
    else if (t.buildInfoCommit && t.buildInfoCommit !== t.commit) {
      fail(
        'DIRTY_TREE',
        `HEAD ${t.commit.slice(0, 12)} ≠ build-info ${t.buildInfoCommit.slice(0, 12)}`,
      );
    }
  }
  if (want.has('key') && info.releaseKey?.keyId) {
    if ((info.testKeyIds ?? []).includes(info.releaseKey.keyId)) {
      if (release) fail('CERT_TEST_KEY', info.releaseKey.keyId);
      else testBuild = true;
    }
  }
  return { ok: failures.length === 0, release, testBuild, failures, warnings };
}

/** Trạng thái cây git (tệp chưa theo dõi cũng tính là bẩn; `ignore` bỏ vài đường dẫn như build-info.json mới sinh). */
export function readTreeState(repo, opt = {}) {
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  const head = git('rev-parse', 'HEAD');
  if (head.status !== 0) return null;
  const st = git('status', '--porcelain', '--untracked-files=all');
  if (st.status !== 0) return null;
  const ignore = new Set(opt.ignore ?? []);
  const changed = st.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ''))
    .filter((p) => !ignore.has(p));
  let buildInfoCommit = null;
  if (opt.buildInfo && existsSync(opt.buildInfo)) {
    try {
      buildInfoCommit = JSON.parse(readFileSync(opt.buildInfo, 'utf8')).commit ?? null;
    } catch {
      buildInfoCommit = 'không đọc được';
    }
  }
  return { dirty: changed.length > 0, commit: head.stdout.trim(), buildInfoCommit };
}

function main() {
  const argv = process.argv.slice(2);
  const o = { release: false, phase: 'all', json: false, ignore: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      if (i + 1 >= argv.length) {
        console.error(`gate: thiếu giá trị cho ${a}`);
        process.exit(2);
      }
      return argv[++i];
    };
    if (a === '--info') o.info = v();
    else if (a === '--release') o.release = true;
    else if (a === '--phase') o.phase = v();
    else if (a === '--now') o.now = new Date(v());
    else if (a === '--json') o.json = true;
    else if (a === '--tree') o.tree = v();
    else if (a === '--build-info') o.buildInfo = v();
    else if (a === '--ignore') o.ignore = v().split(',');
    else {
      console.error(`gate: tham số lạ ${a}`);
      process.exit(2);
    }
  }
  if (o.tree) {
    console.log(
      JSON.stringify(readTreeState(resolve(o.tree), { buildInfo: o.buildInfo, ignore: o.ignore })),
    );
    return;
  }
  if (!o.info) {
    console.error('gate: cần --info <tệp> hoặc --tree <repo>');
    process.exit(2);
  }
  const text = readFileSync(o.info, 'utf8');
  const info = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const r = evaluateGate(info, { release: o.release, phase: o.phase, now: o.now });
  if (o.json) {
    console.log(JSON.stringify(r));
  } else {
    for (const w of r.warnings) console.log(`CẢNH BÁO: ${w}`);
    for (const f of r.failures) console.error(`TỪ CHỐI ${f.code}: ${f.message}`);
    if (r.testBuild) console.log(TEST_BANNER);
    if (r.ok) console.log(`gate: qua (${o.release ? 'phát hành' : 'thử'}, pha ${o.phase})`);
  }
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
