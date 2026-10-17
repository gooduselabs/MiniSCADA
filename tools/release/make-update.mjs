// Gói cập nhật runtime `.matupdate` (feature 011, contracts/update-package.md; FR-057, FR-061; T106, T117).
// Chỉ dùng Node (`crypto`, `zlib`), không phụ thuộc mới.
//
//   node tools/release/make-update.mjs --vectors --test        sinh lại tests/update-vectors/ (gói hợp lệ, ca xấu, out/)
//   node tools/release/make-update.mjs --vectors --out --test  chỉ sinh vector lớn vào tests/update-vectors/out/
//   node tools/release/make-update.mjs --from <cây cài> --key <khóa riêng.pem> --out <gói.matupdate>
//        [--version 1.0.1] [--release-seq 12] [--arch armhf] [--min-from 0.6.0] [--project-format-max 1.0.0]
//        [--notes "…"] [--build-info <build-info.json>] [--verify <mat-update-verify> --keys <thư mục khóa>] [--test]
//        (khóa có mật khẩu: MAT_SIGN_PASSPHRASE, hoặc hỏi trên terminal khi biến trống)
//   node tools/release/make-update.mjs --it <thư mục> --bin <mat-runtime> --arch <a> [--count 20] --test   (update-it.ps1)
//   node tools/release/make-update.mjs --keyset --key <khóa ký.pem> --add <pub.pem>… --remove sha256:<id>…
//        --release-seq N --version V --arch A --out <gói.matupdate> [--test]
//
// Khóa thử (rà soát T062 F3): ký bằng khóa có keyId của tests/update-vectors/keys/*.pem chỉ được khi có --test; --vectors
// và --it (luôn dùng khóa thử) cũng cần --test. Khóa riêng có mật khẩu: MAT_SIGN_PASSPHRASE hoặc hỏi trên terminal.
//
// Cây cài (`--from`): đầu ra của deployment/package-runtime.ps1 (build/pkg) hoặc cây tương tự; chỉ các tệp thuộc
// tiền tố cho phép (bin/, web/, schemas/, README-deploy.txt, build-info.json) vào payload; project/ và deployment/
// ở lại (mat-updater chép chúng từ bản đang chạy). `version`, `releaseSeq` đọc từ build-info.json của cây nếu
// không truyền. Khóa thử (tests/update-vectors/keys/) chỉ cho test (--test); release.ps1 -Release từ chối chúng.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  sign,
} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
// The version the runtime of this tree reports (RUNTIME_VERSION of @mat/project-schema, same as kRuntimeVersion):
// mat-updater's health check wants runtimeVersion == the manifest version, so the update-it packages use it.
export function runtimeVersion() {
  const src = readFileSync(join(root, 'packages/project-schema/src/codes.ts'), 'utf8');
  const m = /export const RUNTIME_VERSION = '([^']+)'/.exec(src);
  if (!m) throw new Error('RUNTIME_VERSION not found in packages/project-schema/src/codes.ts');
  return m[1];
}
const KiB = 1024;
const MiB = 1024 * KiB;
const BLOCK = 512;

export const ALLOWED_PREFIXES = ['bin/', 'web/', 'schemas/'];
export const ALLOWED_FILES = ['README-deploy.txt', 'build-info.json'];
export const FORMAT = '1.0.0';

const buf = (x) => (Buffer.isBuffer(x) ? x : Buffer.from(x, 'utf8'));
export const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------- tar (ustar)

function octal(n, width) {
  // width bytes: width-1 octal digits then NUL
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

// One ustar header block. `type`: '0' file, '5' directory, '1' hard link, '2' symlink, '3'/'4' device,
// '6' FIFO, 'x' pax, … `checksum`: a value to write instead of the right one (bad vectors).
export function tarHeader({
  name,
  size = 0,
  type = '0',
  mode = 0o644,
  linkname = '',
  prefix = '',
  checksum,
}) {
  const h = Buffer.alloc(BLOCK, 0);
  const nameBytes = buf(name);
  if (nameBytes.length > 100) throw new Error(`tar name too long: ${name}`);
  nameBytes.copy(h, 0);
  h.write(octal(mode, 8), 100, 'latin1');
  h.write(octal(0, 8), 108, 'latin1');
  h.write(octal(0, 8), 116, 'latin1');
  h.write(octal(size, 12), 124, 'latin1');
  h.write(octal(0, 12), 136, 'latin1');
  h.write('        ', 148, 'latin1');
  h.write(type, 156, 'latin1');
  buf(linkname).copy(h, 157);
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  h.write('root', 265, 'latin1');
  h.write('root', 297, 'latin1');
  buf(prefix).copy(h, 345);
  let sum = 0;
  for (const b of h) sum += b;
  const value = checksum ?? sum;
  h.write(value.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
  return h;
}

const pad = (n) => Buffer.alloc((BLOCK - (n % BLOCK)) % BLOCK, 0);

// entries: [{ name, data?, type?, mode?, linkname?, size? }]; ends with two zero blocks unless `noEnd`.
export function tarArchive(entries, { noEnd = false } = {}) {
  const parts = [];
  for (const e of entries) {
    const data = e.data === undefined ? Buffer.alloc(0) : buf(e.data);
    const size = e.size ?? data.length;
    parts.push(tarHeader({ ...e, size }));
    parts.push(data, pad(data.length));
  }
  if (!noEnd) parts.push(Buffer.alloc(2 * BLOCK, 0));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- keys and signatures

// keyId = "sha256:" + SHA-256 of the DER SubjectPublicKeyInfo (contract §2).
export function keyIdOf(keyPem) {
  const pub = createPublicKey(keyPem);
  return 'sha256:' + sha256(pub.export({ type: 'spki', format: 'der' }));
}
export const publicPemOf = (keyPem) =>
  createPublicKey(keyPem).export({ type: 'spki', format: 'pem' });

export function signBytes(bytes, privPem) {
  const key = privPem instanceof KeyObject ? privPem : createPrivateKey(privPem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new Error('khóa ký phải là ECDSA P-256 (prime256v1)');
  return sign('sha256', bytes, { key, dsaEncoding: 'der' });
}

// ---------------------------------------------------------------- package

// files: [{ path, data, mode? ('0644' | '0755') }] → { payload (tar.gz), list (files[] of the manifest) }.
// Directories of the paths are added before their files, like GNU tar.
export function buildPayload(files, { extraEntries = [], dirs = true } = {}) {
  const entries = [];
  const seen = new Set();
  for (const f of files) {
    if (dirs) {
      const segs = f.path.split('/');
      for (let i = 1; i < segs.length; i++) {
        const d = segs.slice(0, i).join('/') + '/';
        if (!seen.has(d)) {
          seen.add(d);
          entries.push({ name: d, type: '5', mode: 0o755 });
        }
      }
    }
    entries.push({ name: f.path, data: f.data, mode: f.mode === '0755' ? 0o755 : 0o644 });
  }
  entries.push(...extraEntries);
  const payload = gzipSync(tarArchive(entries), { level: 9 });
  const list = files.map((f) => ({
    path: f.path,
    sha256: sha256(buf(f.data)),
    size: buf(f.data).length,
    mode: f.mode ?? '0644',
  }));
  return { payload, list };
}

export function makeManifest(o) {
  return {
    format: o.format ?? FORMAT,
    kind: o.kind ?? 'runtime',
    product: o.product ?? 'mat-runtime',
    version: o.version,
    releaseSeq: o.releaseSeq,
    arch: o.arch,
    minFromVersion: o.minFromVersion ?? '0.6.0',
    projectFormatMax: o.projectFormatMax ?? '1.0.0',
    updaterRequired: o.updaterRequired ?? 1,
    createdAt: o.createdAt ?? new Date().toISOString(),
    payloadSha256: sha256(o.payload),
    payloadSize: o.payload.length,
    files: o.files,
    notes: o.notes ?? '',
    keyset: o.keyset ?? null,
  };
}

export const manifestBytes = (m) => Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8');

// The envelope: tar of exactly three members (contract §1); `members` may be changed for bad vectors.
export function envelope(members, opts) {
  return tarArchive(
    members.map((m) => ({
      name: m.name,
      data: m.data,
      size: m.size,
      type: m.type ?? '0',
      mode: 0o644,
      checksum: m.checksum,
    })),
    opts,
  );
}

// Everything at once: { pkg, manifest, manifestBytes, sig, payload }.
export function makePackage({ files, key, payloadOpts, manifestPatch, manifest: base }) {
  const { payload, list } = buildPayload(files, payloadOpts);
  let manifest = makeManifest({ ...base, payload, files: base.kind === 'keyset' ? [] : list });
  if (manifestPatch) manifest = manifestPatch(manifest) ?? manifest;
  const mbytes = manifestBytes(manifest);
  const sig = signBytes(mbytes, key);
  const pkg = envelope([
    { name: 'update.json', data: mbytes },
    { name: 'update.sig', data: sig },
    { name: 'payload.tar.gz', data: payload },
  ]);
  return { pkg, manifest, manifestBytes: mbytes, sig, payload };
}

// ---------------------------------------------------------------- package from an install tree (T117)

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new Error(`liên kết trong cây cài: ${relative(base, p)}`);
    if (st.isDirectory()) walk(p, base, out);
    else if (st.isFile())
      out.push({ rel: relative(base, p).split(sep).join('/'), abs: p, mode: st.mode });
    else throw new Error(`tệp đặc biệt trong cây cài: ${relative(base, p)}`);
  }
  return out;
}

export const allowedPath = (p) =>
  ALLOWED_FILES.includes(p) || ALLOWED_PREFIXES.some((x) => p.startsWith(x));

export function filesFromTree(dir) {
  return walk(dir)
    .filter((f) => allowedPath(f.rel))
    .map((f) => ({
      path: f.rel,
      data: readFileSync(f.abs),
      // executables: bin/* and anything with an x bit
      mode: f.rel.startsWith('bin/') || (f.mode & 0o111) !== 0 ? '0755' : '0644',
    }));
}

// ---------------------------------------------------------------- vectors (T106)

const VEC = join(root, 'tests/update-vectors');
const KEYS = join(VEC, 'keys');

function ensureKey(name) {
  const p = join(KEYS, name);
  if (!existsSync(p)) {
    mkdirSync(KEYS, { recursive: true });
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    writeFileSync(p, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  }
  const pem = readFileSync(p, 'utf8');
  writeFileSync(p.replace(/\.pem$/, '.pub.pem'), publicPemOf(pem));
  return pem;
}

// The device the vectors are checked against (cases.json `device`); a case may change one field.
export const VECTOR_DEVICE = {
  arch: 'armhf',
  version: '1.0.0',
  releaseSeq: 10,
  projectFormat: '1.0.0',
  maxPackageBytes: 64 * MiB,
};

const BASE = {
  version: '1.0.1',
  releaseSeq: 11,
  arch: 'armhf',
  minFromVersion: '0.9.0',
  projectFormatMax: '1.0.0',
  createdAt: '2026-10-17T09:00:00+07:00',
  notes: 'Gói thử của tests/update-vectors (khóa thử, không phát hành).',
};

const sampleFiles = () => [
  { path: 'bin/mat-runtime', data: '#!/bin/sh\necho "mat-runtime 1.0.1 (vector)"\n', mode: '0755' },
  { path: 'web/index.html', data: '<!doctype html><title>mAT</title>\n' },
  { path: 'schemas/project.schema.json', data: '{"$id":"vector"}\n' },
  { path: 'build-info.json', data: '{"version":"1.0.1","releaseSeq":11,"release":false}\n' },
  { path: 'README-deploy.txt', data: 'mat-runtime 1.0.1 (vector)\n' },
];

// Replace member `i` of the envelope of `v` by `data` (and keep the rest).
function rebuild(v, patch) {
  const members = [
    { name: 'update.json', data: v.manifestBytes },
    { name: 'update.sig', data: v.sig },
    { name: 'payload.tar.gz', data: v.payload },
  ];
  return envelope(patch(members) ?? members);
}

// Signs a manifest that is not made by makeManifest (bad payload, files[] kept as given).
function signed(manifest, payload, key, extra) {
  const mbytes = manifestBytes(manifest);
  const sig = signBytes(mbytes, key);
  const members = [
    { name: 'update.json', data: mbytes },
    { name: 'update.sig', data: sig },
    { name: 'payload.tar.gz', data: payload },
  ];
  return envelope(extra ? extra(members) : members);
}

// expect: { code, detailCode?, http, exit } — exit of mat-update-verify: 0 ok, 3 signature, 4 keys missing,
// 5 package invalid, 6 refused for this device (arch, releaseSeq, versions, project, updater).
function cases(
  key,
  other,
  base = BASE,
  { otherArch = 'x64', lowFormat = '0.6.0', files: mkFiles = sampleFiles, zerosMiB = 4 } = {},
) {
  const ok = makePackage({ files: mkFiles(), key, manifest: base });
  const inv = (detailCode, exit = 5) => ({
    code: 'UPDATE_PACKAGE_INVALID',
    detailCode,
    http: 400,
    exit,
  });
  const sigBad = { code: 'UPDATE_SIGNATURE_INVALID', http: 403, exit: 3 };
  const withFiles = (files, patch, payloadOpts) =>
    makePackage({ files, key, manifest: base, manifestPatch: patch, payloadOpts }).pkg;
  const flip = (b, at) => {
    const c = Buffer.from(b);
    c[at] ^= 0x01;
    return c;
  };
  const list = [];
  const add = (id, name, expect, pkg, extra = {}) => list.push({ id, name, expect, pkg, ...extra });

  add(
    1,
    'sig-byte',
    sigBad,
    rebuild(ok, (m) => ((m[1].data = flip(m[1].data, 20)), m)),
  );
  add(2, 'key-unknown', sigBad, makePackage({ files: mkFiles(), key: other, manifest: base }).pkg);
  add(
    3,
    'manifest-edited',
    sigBad,
    rebuild(ok, (m) => {
      m[0].data = manifestBytes({ ...ok.manifest, notes: ok.manifest.notes + ' (sửa)' });
      return m;
    }),
  );
  add(
    4,
    'payload-byte',
    inv('PAYLOAD_DIGEST'),
    rebuild(ok, (m) => ((m[2].data = flip(m[2].data, 40)), m)),
  );
  add(
    5,
    'file-digest',
    inv('FILE_DIGEST'),
    withFiles(mkFiles(), (m) => {
      m.files[1].sha256 = sha256('khác');
    }),
  );
  {
    // files[] lists a file the payload does not have
    const { payload, list: l } = buildPayload(mkFiles().slice(0, 4));
    const files = [...l, { path: 'web/app.js', sha256: sha256('x'), size: 1, mode: '0644' }];
    add(
      6,
      'file-missing',
      inv('FILE_MISSING'),
      signed(makeManifest({ ...base, payload, files }), payload, key),
    );
  }
  {
    // the payload has a file that files[] does not list
    const { payload, list: l } = buildPayload(mkFiles());
    add(
      7,
      'file-extra',
      inv('FILE_EXTRA'),
      signed(makeManifest({ ...base, payload, files: l.slice(0, 4) }), payload, key),
    );
  }
  add(
    8,
    'path-traversal',
    inv('PATH_TRAVERSAL'),
    withFiles(mkFiles(), (m) => {
      m.files[1].path = 'web/../../etc/passwd';
    }),
  );
  add(
    9,
    'path-absolute',
    inv('PATH_ABSOLUTE'),
    withFiles(mkFiles(), (m) => {
      m.files[1].path = '/etc/passwd';
    }),
  );
  add(
    10,
    'link',
    inv('LINK_FORBIDDEN'),
    withFiles(mkFiles(), null, {
      extraEntries: [{ name: 'web/shadow', type: '2', linkname: '/etc/shadow', mode: 0o777 }],
    }),
  );
  add(
    11,
    'fifo',
    inv('SPECIAL_FORBIDDEN'),
    withFiles(mkFiles(), null, { extraEntries: [{ name: 'web/pipe', type: '6', mode: 0o644 }] }),
  );
  // 12 (tar bomb, > 128 MiB unpacked) is generated into out/: see bigCases().
  add(
    13,
    'ratio',
    inv('RATIO_TOO_HIGH'),
    withFiles([...mkFiles(), { path: 'web/zeros.bin', data: Buffer.alloc(zerosMiB * MiB, 0) }]),
  );
  add(14, 'too-large', { code: 'UPDATE_TOO_LARGE', http: 413, exit: 5 }, ok.pkg, {
    device: { maxPackageBytes: 4 * KiB },
  });
  add(
    15,
    'arch',
    { code: 'UPDATE_ARCH_MISMATCH', http: 422, exit: 6 },
    makePackage({ files: mkFiles(), key, manifest: { ...base, arch: otherArch } }).pkg,
  );
  add(
    16,
    'downgrade',
    { code: 'UPDATE_DOWNGRADE', http: 409, exit: 6 },
    makePackage({ files: mkFiles(), key, manifest: { ...base, releaseSeq: 10 } }).pkg,
  );
  add(
    17,
    'from-version',
    inv('FROM_VERSION', 6),
    makePackage({ files: mkFiles(), key, manifest: { ...base, minFromVersion: '1.0.1' } }).pkg,
  );
  add(
    18,
    'project-format',
    { code: 'UPDATE_PROJECT_INCOMPATIBLE', http: 409, exit: 6 },
    makePackage({ files: mkFiles(), key, manifest: { ...base, projectFormatMax: lowFormat } }).pkg,
  );
  add(
    19,
    'truncated',
    inv('ENVELOPE_TRUNCATED'),
    ok.pkg.subarray(0, ok.pkg.length - 2 * BLOCK - 700),
  );
  add(
    20,
    'fourth-member',
    inv('ENVELOPE_EXTRA_MEMBER'),
    rebuild(ok, (m) => [...m, { name: 'extra.txt', data: 'thừa\n' }]),
  );
  add(
    21,
    'order',
    inv('ENVELOPE_ORDER'),
    rebuild(ok, (m) => [m[1], m[0], m[2]]),
  );
  add(
    22,
    'pax-header',
    inv('ENVELOPE_HEADER'),
    rebuild(ok, (m) => [{ name: 'update.json', type: 'x', data: '30 path=update.json\n' }, ...m]),
  );
  add(
    23,
    'updater-dir',
    { code: 'UPDATER_MANUAL_ONLY', http: 422, exit: 6 },
    withFiles([...mkFiles(), { path: 'updater/mat-updater', data: '#!/bin/sh\n', mode: '0755' }]),
  );
  add(
    24,
    'format-2',
    inv('FORMAT_UNSUPPORTED'),
    makePackage({ files: mkFiles(), key, manifest: { ...base, format: '2.0.0' } }).pkg,
  );
  add(
    25,
    'keyset-self-revoke',
    inv('KEYSET_SELF_REVOKE'),
    makePackage({
      files: [],
      key,
      manifest: {
        ...base,
        kind: 'keyset',
        keyset: { add: [publicPemOf(other)], remove: [keyIdOf(key)] },
      },
    }).pkg,
  );
  add(
    26,
    'path-duplicate',
    inv('PATH_DUPLICATE'),
    withFiles([...mkFiles(), { path: 'web/INDEX.html', data: '<!doctype html>\n' }]),
  );
  add(
    27,
    'mode-setuid',
    inv('MODE_FORBIDDEN'),
    withFiles(mkFiles(), (m) => {
      m.files[0].mode = '4755';
    }),
  );
  add(
    28,
    'path-control',
    inv('PATH_INVALID'),
    withFiles([...mkFiles(), { path: 'web/té\u0007st.txt', data: 'x\n' }]),
  );
  // 29 (the same updateId sent again while it is applied: 409 DEVICE_BUSY) and 30 (Content-Length larger than
  // what is sent: 408 UPDATE_RECEIVE_ABORTED) are requests, not packages: server/tests/update_api_test.cpp.
  add(29, 'busy', { code: 'DEVICE_BUSY', http: 409, exit: 0 }, ok.pkg, { api: 'apply-twice' });
  add(30, 'receive-aborted', { code: 'UPDATE_RECEIVE_ABORTED', http: 408, exit: 0 }, ok.pkg, {
    api: 'short-body',
  });
  // Beyond the 30 of contract §6.
  add(
    31,
    'updater-required',
    { code: 'UPDATER_MANUAL_ONLY', http: 422, exit: 6 },
    makePackage({ files: mkFiles(), key, manifest: { ...base, updaterRequired: 2 } }).pkg,
  );
  add(
    32,
    'product',
    inv('PRODUCT'),
    makePackage({ files: mkFiles(), key, manifest: { ...base, product: 'other' } }).pkg,
  );
  add(
    33,
    'header-checksum',
    inv('ENVELOPE_HEADER'),
    rebuild(ok, (m) => ((m[0].checksum = 1), m)),
  );
  add(
    34,
    'manifest-too-big',
    inv('ENVELOPE_SIZE'),
    rebuild(ok, (m) => ((m[0].size = 257 * KiB), m)),
  );
  add(
    35,
    'keyset-bad-key',
    inv('KEYSET_KEY'),
    makePackage({
      files: [],
      key,
      manifest: {
        ...base,
        kind: 'keyset',
        keyset: {
          add: ['-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n'],
          remove: [],
        },
      },
    }).pkg,
  );
  return { ok, list };
}

// Packages of the mat-updater shell test (deployment/device/tests/updater_test.sh, T108) and of
// tools/update-it.ps1: a fake runtime (sh) whose answers the test's fake `systemctl`/fetch read.
// `marker`: BROKEN (health fails after the switch), SELFCHECK_FAIL (--self-check exits 1).
export function fakeRuntimeFiles(version, releaseSeq, marker = '') {
  const bin = [
    '#!/bin/sh',
    `# fake mat-runtime ${version} ${marker}`,
    `case "$1" in --self-check) [ "${marker}" = SELFCHECK_FAIL ] && exit 1; exit 0 ;; esac`,
    `echo "mat-runtime ${version}"`,
    '',
  ].join('\n');
  return [
    { path: 'bin/mat-runtime', data: bin, mode: '0755' },
    { path: 'web/index.html', data: `<!doctype html><title>mAT ${version}</title>\n` },
    { path: 'schemas/project.schema.json', data: '{"$id":"fake"}\n' },
    { path: 'build-info.json', data: JSON.stringify({ version, releaseSeq, marker }) + '\n' },
    { path: 'README-deploy.txt', data: `mat-runtime ${version}\n` },
  ];
}

function updaterFixtures(key, other, arch) {
  const m = (version, releaseSeq, marker) =>
    makePackage({
      files: fakeRuntimeFiles(version, releaseSeq, marker),
      key,
      manifest: { ...BASE, version, releaseSeq, arch, minFromVersion: '0.9.0' },
    }).pkg;
  return {
    'v101.matupdate': m('1.0.1', 11),
    'v102.matupdate': m('1.0.2', 12),
    'broken.matupdate': m('1.0.3', 13, 'BROKEN'),
    'selfcheck-fail.matupdate': m('1.0.4', 14, 'SELFCHECK_FAIL'),
    // a file name that is not ASCII (UTF-8): mat-updater compares its tar listing with files[]
    'utf8.matupdate': makePackage({
      files: [
        ...fakeRuntimeFiles('1.0.5', 15),
        { path: 'web/sơ-đồ.svg', data: '<svg xmlns="http://www.w3.org/2000/svg"/>\n' },
      ],
      key,
      manifest: { ...BASE, version: '1.0.5', releaseSeq: 15, arch, minFromVersion: '0.9.0' },
    }).pkg,
    'keyset-add.matupdate': makePackage({
      files: [],
      key,
      manifest: {
        ...BASE,
        kind: 'keyset',
        arch,
        releaseSeq: 15,
        keyset: { add: [publicPemOf(other)], remove: [] },
      },
    }).pkg,
  };
}

function bigCases(key) {
  // 12: 129 MiB of zeros, listed in files[] with its right digest: the total unpacked size is over 128 MiB.
  const zeros = Buffer.alloc(129 * MiB, 0);
  const pkg = makePackage({
    files: [...sampleFiles(), { path: 'web/bomb.bin', data: zeros }],
    key,
    manifest: BASE,
  }).pkg;
  return [
    {
      id: 12,
      name: 'unpacked-too-large',
      expect: {
        code: 'UPDATE_PACKAGE_INVALID',
        detailCode: 'UNPACKED_TOO_LARGE',
        http: 400,
        exit: 5,
      },
      pkg,
      generated: true,
    },
  ];
}

const fileName = (c) => `${String(c.id).padStart(2, '0')}-${c.name}.matupdate`;

export function writeVectors({ onlyOut = false } = {}) {
  const key = ensureKey('test-ec-p256.pem');
  const other = ensureKey('test-ec-p256-other.pem');
  // the trusted-keys directory of the tests: only the public key of the first test key
  const trustedDir = join(VEC, 'keys-trusted');
  rmSync(trustedDir, { recursive: true, force: true });
  mkdirSync(trustedDir, { recursive: true });
  writeFileSync(join(trustedDir, 'test-ec-p256.pem'), publicPemOf(key));
  // an RSA public key: never a trusted key (signature_test)
  if (!existsSync(join(KEYS, 'test-rsa.pub.pem'))) {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(
      join(KEYS, 'test-rsa.pub.pem'),
      publicKey.export({ type: 'spki', format: 'pem' }),
    );
  }
  const outDir = join(VEC, 'out');
  mkdirSync(outDir, { recursive: true });
  const big = bigCases(key);
  for (const c of big) writeFileSync(join(outDir, fileName(c)), c.pkg);
  // packages of the updater test, for the architectures its container may have
  for (const arch of ['x64', 'arm64', 'armhf']) {
    const dir = join(outDir, 'updater', arch);
    mkdirSync(dir, { recursive: true });
    for (const [name, pkg] of Object.entries(updaterFixtures(key, other, arch)))
      writeFileSync(join(dir, name), pkg);
  }
  if (onlyOut) return { written: big.length };

  const { ok, list } = cases(key, other);
  const badDir = join(VEC, 'bad');
  rmSync(badDir, { recursive: true, force: true });
  mkdirSync(badDir, { recursive: true });
  writeFileSync(join(VEC, 'valid.matupdate'), ok.pkg);
  // a keyset package: adds the second test key, signed by the first
  const keyset = makePackage({
    files: [],
    key,
    manifest: { ...BASE, kind: 'keyset', keyset: { add: [publicPemOf(other)], remove: [] } },
  });
  writeFileSync(join(VEC, 'keyset-add.matupdate'), keyset.pkg);
  // SHA256SUMS signed by the test key, with two files
  const sums = join(VEC, 'sums');
  rmSync(sums, { recursive: true, force: true });
  mkdirSync(sums, { recursive: true });
  const a = 'tệp a\n';
  const b = 'tệp b\n';
  writeFileSync(join(sums, 'a.txt'), a);
  writeFileSync(join(sums, 'b.txt'), b);
  const text = `${sha256(a)}  a.txt\n${sha256(b)}  b.txt\n`;
  writeFileSync(join(sums, 'SHA256SUMS'), text);
  writeFileSync(join(sums, 'SHA256SUMS.sig'), signBytes(Buffer.from(text), key));

  const all = [...list, ...big];
  all.sort((x, y) => x.id - y.id);
  for (const c of list) writeFileSync(join(badDir, fileName(c)), c.pkg);
  const meta = {
    description:
      'Vector gói .matupdate (contracts/update-package.md §6), sinh bằng node tools/release/make-update.mjs --vectors --test. Khóa thử, không phát hành.',
    device: VECTOR_DEVICE,
    trustedKeys: 'keys-trusted',
    valid: {
      file: 'valid.matupdate',
      keyId: keyIdOf(key),
      version: ok.manifest.version,
      releaseSeq: ok.manifest.releaseSeq,
      files: ok.manifest.files,
    },
    keyset: { file: 'keyset-add.matupdate', adds: [keyIdOf(other)] },
    cases: all.map((c) => ({
      id: c.id,
      name: c.name,
      file: c.generated ? `out/${fileName(c)}` : `bad/${fileName(c)}`,
      ...(c.generated ? { generated: true } : {}),
      ...(c.api ? { api: c.api } : {}),
      ...(c.device ? { device: c.device } : {}),
      expect: c.expect,
    })),
  };
  writeFileSync(join(VEC, 'cases.json'), JSON.stringify(meta, null, 2) + '\n');
  return { written: all.length + 2 };
}

// ---------------------------------------------------------------- CLI

function arg(args, name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
}
function args(all, name) {
  const out = [];
  all.forEach((a, i) => a === name && out.push(all[i + 1]));
  return out;
}

// keyId của khóa thử trong tests/update-vectors/keys/ (khóa riêng và khóa công khai).
export function testKeyIds() {
  const dir = join(root, 'tests/update-vectors/keys');
  const ids = new Set();
  if (!existsSync(dir)) return ids;
  for (const n of readdirSync(dir).filter((x) => x.endsWith('.pem'))) {
    try {
      ids.add(keyIdOf(readFileSync(join(dir, n), 'utf8')));
    } catch {
      // khóa RSA hay khóa hỏng của vector: không ký được bằng nó
    }
  }
  return ids;
}

// Khóa riêng PEM (KeyObject). Khóa có mật khẩu (keygen.ps1, rà soát T062 F4): mật khẩu từ MAT_SIGN_PASSPHRASE hoặc
// mật khẩu đã hỏi trên terminal (main); không bao giờ qua tham số dòng lệnh, không in ra.
let promptedPassphrase = null;
const isEncryptedPem = (pem) => /ENCRYPTED/.test(pem);
function readPrivateKey(path) {
  const pem = readFileSync(path, 'utf8');
  if (!isEncryptedPem(pem)) return createPrivateKey(pem);
  const passphrase = process.env.MAT_SIGN_PASSPHRASE || promptedPassphrase;
  if (!passphrase)
    throw new Error(
      `khóa ${path} có mật khẩu: đặt MAT_SIGN_PASSPHRASE hoặc chạy trên terminal để nhập mật khẩu`,
    );
  try {
    return createPrivateKey({ key: pem, format: 'pem', passphrase });
  } catch (e) {
    throw new Error(
      `không mở được khóa ${path}: sai mật khẩu hoặc khóa hỏng (${e.code ?? 'lỗi'})`,
      {
        cause: e,
      },
    );
  }
}

// Hỏi mật khẩu trên terminal, không hiện ký tự gõ (stderr, để stdout chỉ có kết quả).
async function promptHidden(question) {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  process.stderr.write(question);
  rl._writeToOutput = () => {};
  try {
    return await new Promise((res) => rl.question('', res));
  } finally {
    rl.close();
    process.stderr.write('\n');
  }
}

// Đọc khóa riêng ký gói: từ chối khóa thử khi không có --test.
function signingKey(argv) {
  const key = readPrivateKey(arg(argv, '--key'));
  if (!argv.includes('--test') && testKeyIds().has(keyIdOf(key)))
    throw new Error(
      `khóa thử ${keyIdOf(key)} (tests/update-vectors/keys/): chỉ ký bằng khóa thử khi có --test`,
    );
  return key;
}

export function buildFromTree(argv) {
  const from = resolve(arg(argv, '--from'));
  const keyPem = signingKey(argv);
  const infoPath = arg(argv, '--build-info', join(from, 'build-info.json'));
  const info = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, 'utf8')) : {};
  const version = arg(argv, '--version', info.version);
  const releaseSeq = Number(arg(argv, '--release-seq', info.releaseSeq));
  if (!version || !Number.isInteger(releaseSeq) || releaseSeq < 1)
    throw new Error('cần --version và --release-seq (hoặc build-info.json có version, releaseSeq)');
  const files = filesFromTree(from);
  if (!files.some((f) => f.path === 'bin/mat-runtime'))
    throw new Error('cây cài thiếu bin/mat-runtime');
  const v = makePackage({
    files,
    key: keyPem,
    manifest: {
      version,
      releaseSeq,
      arch: arg(argv, '--arch', info.arch ?? 'armhf'),
      minFromVersion: arg(argv, '--min-from', '0.6.0'),
      projectFormatMax: arg(argv, '--project-format-max', '1.0.0'),
      notes: arg(argv, '--notes', ''),
    },
  });
  return { ...v, keyId: keyIdOf(keyPem) };
}

export function buildKeyset(argv) {
  const keyPem = signingKey(argv);
  const add = args(argv, '--add').map((p) => publicPemOf(readFileSync(p, 'utf8')));
  const remove = args(argv, '--remove');
  const v = makePackage({
    files: [],
    key: keyPem,
    manifest: {
      kind: 'keyset',
      version: arg(argv, '--version'),
      releaseSeq: Number(arg(argv, '--release-seq')),
      arch: arg(argv, '--arch', 'armhf'),
      keyset: { add, remove },
      notes: arg(argv, '--notes', ''),
    },
  });
  return { ...v, keyId: keyIdOf(keyPem) };
}

// tools/update-it.ps1 (T120): packages around a real mat-runtime binary for the x64 lab. `bin` is the binary
// (the container's architecture `arch`), the schemas come from the repo. ok-<seq>: version runtimeVersion() (the binary's) with
// releaseSeq 11..10+count; broken: a binary that exits at once (health check fails); keyset; downgrade (releaseSeq 5);
// bad/: the cases of contract §6 for this device (arch, project format 0.1.0 of tank-demo).
export function itTree(binPath, releaseSeq, { broken = false, version = runtimeVersion() } = {}) {
  const files = [];
  const bin = broken
    ? Buffer.from(
        '#!/bin/sh\n# passes --self-check, then never serves: the health check fails\ncase "$1" in --self-check) exit 0 ;; esac\necho broken >&2\nexit 3\n',
      )
    : readFileSync(binPath);
  files.push({ path: 'bin/mat-runtime', data: bin, mode: '0755' });
  const schemas = join(root, 'schemas');
  for (const f of walk(schemas))
    files.push({ path: 'schemas/' + f.rel, data: readFileSync(f.abs) });
  files.push({ path: 'web/index.html', data: `<!doctype html><title>mAT ${releaseSeq}</title>\n` });
  files.push({
    path: 'build-info.json',
    data: JSON.stringify({ version, releaseSeq, arch: 'it' }) + '\n',
  });
  files.push({ path: 'README-deploy.txt', data: `update-it ${releaseSeq}\n` });
  return files;
}

export function writeItPackages(outDir, binPath, arch, count = 20) {
  const key = ensureKey('test-ec-p256.pem');
  const other = ensureKey('test-ec-p256-other.pem');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'bad'), { recursive: true });
  const base = { ...BASE, version: runtimeVersion(), arch, minFromVersion: '0.9.0' };
  const pkg = (seq, opts, extra = {}) =>
    makePackage({
      files: itTree(binPath, seq, opts),
      key,
      manifest: { ...base, releaseSeq: seq, ...extra },
    }).pkg;
  for (let i = 0; i < count; i++)
    writeFileSync(join(outDir, `ok-${11 + i}.matupdate`), pkg(11 + i));
  writeFileSync(join(outDir, 'broken.matupdate'), pkg(900, { broken: true }));
  writeFileSync(join(outDir, 'downgrade.matupdate'), pkg(5));
  // the releaseSeq of the base tree of tools/update-it/run.py (10): "the release that runs now, sent again"
  writeFileSync(join(outDir, 'same-10.matupdate'), pkg(10));
  writeFileSync(
    join(outDir, 'keyset.matupdate'),
    makePackage({
      files: [],
      key,
      manifest: {
        ...base,
        kind: 'keyset',
        releaseSeq: 950,
        keyset: { add: [publicPemOf(other)], remove: [] },
      },
    }).pkg,
  );
  const { list } = cases(
    key,
    other,
    { ...base, releaseSeq: 800 },
    {
      otherArch: arch === 'x64' ? 'armhf' : 'x64',
      lowFormat: '0.0.1',
      zerosMiB: 100, // a real binary compresses 2-3 times: the zeros must bring the ratio over 20
      files: () => itTree(binPath, 800),
    },
  );
  const meta = [];
  for (const c of list) {
    if (c.api || c.device) continue;
    // device-relative cases: releaseSeq 10 and minFromVersion 1.0.1 are relative to the installed 1.0.0 / 10
    writeFileSync(join(outDir, 'bad', fileName(c)), c.pkg);
    meta.push({ id: c.id, name: c.name, file: `bad/${fileName(c)}`, expect: c.expect });
  }
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta.length;
}

async function main(argv) {
  if ((argv.includes('--it') || argv.includes('--vectors')) && !argv.includes('--test')) {
    console.error('make-update.mjs: --vectors và --it ký bằng khóa thử: cần --test');
    return 64;
  }
  if (argv.includes('--it')) {
    const n = writeItPackages(
      resolve(arg(argv, '--it')),
      resolve(arg(argv, '--bin')),
      arg(argv, '--arch', 'x64'),
      Number(arg(argv, '--count', '20')),
    );
    console.log(`update-it: ${n} gói xấu và các gói hợp lệ trong ${arg(argv, '--it')}`);
    return 0;
  }
  if (argv.includes('--vectors')) {
    const r = writeVectors({ onlyOut: argv.includes('--out') });
    console.log(`${r.written} gói trong ${relative(root, VEC)}`);
    return 0;
  }
  if (!argv.includes('--out')) {
    console.error(
      'dùng: make-update.mjs --vectors [--out] --test | --from <cây> --key <pem> --out <gói> [--test] | --keyset …',
    );
    return 64;
  }
  const keyPath = arg(argv, '--key');
  if (
    keyPath &&
    existsSync(keyPath) &&
    isEncryptedPem(readFileSync(keyPath, 'utf8')) &&
    !process.env.MAT_SIGN_PASSPHRASE &&
    process.stdin.isTTY
  ) {
    promptedPassphrase = await promptHidden(`Mật khẩu của khóa ${keyPath}: `);
  }
  const v = argv.includes('--keyset') ? buildKeyset(argv) : buildFromTree(argv);
  const out = resolve(arg(argv, '--out'));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, v.pkg);
  console.log(
    `${relative(process.cwd(), out)}: ${v.pkg.length} B, ${v.manifest.kind} ${v.manifest.version} ` +
      `releaseSeq ${v.manifest.releaseSeq}, ${v.manifest.files.length} tệp, khóa ${v.keyId}`,
  );
  // Self-check with mat-update-verify (T117): the device's reader must accept what was written.
  const verify = arg(argv, '--verify');
  if (verify) {
    const keys = arg(argv, '--keys');
    if (!keys) throw new Error('--verify cần --keys <thư mục khóa công khai>');
    const r = spawnSync(verify, [out, '--keys', keys, '--json'], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(
        `mat-update-verify từ chối gói vừa tạo (mã ${r.status}): ${r.stdout}${r.stderr}`,
      );
      return 1;
    }
    console.log('mat-update-verify: hợp lệ');
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (e) => {
      console.error(String(e?.message ?? e));
      process.exitCode = 1;
    },
  );
}
