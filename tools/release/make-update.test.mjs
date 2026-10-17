// Test công cụ tạo gói cập nhật (T106): phong bì tar đúng contract §1, chữ ký kiểm được bằng khóa công khai,
// manifest đúng §2, vector đủ ca của §6 và khớp cases.json. Chạy: node --test tools/release
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import {
  buildFromTree,
  buildKeyset,
  filesFromTree,
  keyIdOf,
  makePackage,
  publicPemOf,
  sha256,
  tarArchive,
  tarHeader,
} from './make-update.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VEC = join(root, 'tests/update-vectors');
const key = readFileSync(join(VEC, 'keys/test-ec-p256.pem'), 'utf8');

// Minimal ustar reader of the test: [{ name, type, size, data, sumOk }]
function readTar(b) {
  const out = [];
  let off = 0;
  while (off + 512 <= b.length) {
    const h = b.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(h.subarray(124, 136).toString('latin1'), 8);
    const stored = parseInt(h.subarray(148, 156).toString('latin1'), 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    const type = String.fromCharCode(h[156] || 48);
    const magic = h.subarray(257, 263).toString('latin1');
    out.push({
      name,
      type,
      size,
      magic,
      sumOk: sum === stored,
      data: b.subarray(off + 512, off + 512 + size),
    });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

test('tiêu đề ustar: tổng kiểm, magic, kích thước bát phân', () => {
  const h = tarHeader({ name: 'update.json', size: 1234 });
  const [e] = readTar(Buffer.concat([h, Buffer.alloc(1536)]));
  assert.equal(e.name, 'update.json');
  assert.equal(e.size, 1234);
  assert.equal(e.magic, 'ustar\0');
  assert.ok(e.sumOk);
  assert.equal(
    readTar(Buffer.concat([tarHeader({ name: 'a', checksum: 1 }), Buffer.alloc(1024)]))[0].sumOk,
    false,
  );
  assert.throws(() => tarHeader({ name: 'x'.repeat(101) }));
  const t = tarArchive([{ name: 'a', data: 'xyz' }]);
  assert.equal(t.length, 512 + 512 + 1024);
});

test('gói hợp lệ: đúng ba thành viên theo thứ tự, chữ ký DER kiểm được, băm payload và tệp khớp', () => {
  const files = [
    { path: 'bin/mat-runtime', data: 'bin', mode: '0755' },
    { path: 'web/index.html', data: '<p>' },
  ];
  const v = makePackage({
    files,
    key,
    manifest: { version: '1.0.1', releaseSeq: 2, arch: 'armhf' },
  });
  const members = readTar(v.pkg);
  assert.deepEqual(
    members.map((m) => m.name),
    ['update.json', 'update.sig', 'payload.tar.gz'],
  );
  assert.ok(members.every((m) => m.sumOk && m.type === '0'));
  const pub = createPublicKey(publicPemOf(key));
  assert.ok(verify('sha256', members[0].data, pub, members[1].data));
  assert.ok(
    members[1].data.length <= 128 && members[1].data[0] === 0x30,
    'DER SEQUENCE ≤ 128 byte',
  );
  const m = JSON.parse(members[0].data.toString('utf8'));
  assert.equal(m.format, '1.0.0');
  assert.equal(m.kind, 'runtime');
  assert.equal(m.payloadSha256, sha256(members[2].data));
  assert.equal(m.payloadSize, members[2].data.length);
  const inner = readTar(gunzipSync(members[2].data)).filter((e) => e.type === '0');
  assert.deepEqual(
    inner.map((e) => [e.name, sha256(e.data)]),
    m.files.map((f) => [f.path, f.sha256]),
  );
  assert.deepEqual(
    m.files.map((f) => f.mode),
    ['0755', '0644'],
  );
});

test('keyId là sha256 của DER SPKI và giống nhau cho khóa riêng và khóa công khai', () => {
  const id = keyIdOf(key);
  assert.match(id, /^sha256:[0-9a-f]{64}$/);
  assert.equal(keyIdOf(publicPemOf(key)), id);
});

test('cây cài: chỉ tiền tố cho phép vào payload; bin/ là 0755', () => {
  const d = mkdtempSync(join(tmpdir(), 'mku-'));
  for (const [p, t] of [
    ['bin/mat-runtime', 'b'],
    ['web/a.js', 'a'],
    ['schemas/s.json', '{}'],
    ['project/project.json', '{}'],
    ['deployment/deploy.sh', '#'],
    ['README-deploy.txt', 'r'],
    ['build-info.json', '{"version":"1.0.2","releaseSeq":5,"arch":"x64"}'],
  ]) {
    mkdirSync(dirname(join(d, p)), { recursive: true });
    writeFileSync(join(d, p), t);
  }
  assert.deepEqual(
    filesFromTree(d).map((f) => `${f.path}:${f.mode}`),
    [
      'README-deploy.txt:0644',
      'bin/mat-runtime:0755',
      'build-info.json:0644',
      'schemas/s.json:0644',
      'web/a.js:0644',
    ],
  );
  const k = join(d, 'k.pem');
  writeFileSync(k, key);
  // Rà soát T062 F3: khóa thử (tests/update-vectors/keys) chỉ ký được khi có --test.
  assert.throws(() => buildFromTree(['--from', d, '--key', k]), /khóa thử.*--test/);
  const v = buildFromTree(['--from', d, '--key', k, '--test']);
  assert.equal(v.manifest.version, '1.0.2');
  assert.equal(v.manifest.releaseSeq, 5);
  assert.equal(v.manifest.arch, 'x64');
  assert.throws(
    () => buildKeyset(['--key', k, '--version', '1.0.2', '--release-seq', '6']),
    /khóa thử.*--test/,
  );
  const real = join(d, 'real.pem');
  writeFileSync(
    real,
    generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }),
  );
  assert.equal(buildFromTree(['--from', d, '--key', real]).manifest.version, '1.0.2');
  const ks = buildKeyset([
    '--test',
    '--key',
    k,
    '--add',
    join(VEC, 'keys/test-ec-p256-other.pub.pem'),
    '--version',
    '1.0.2',
    '--release-seq',
    '6',
  ]);
  assert.equal(ks.manifest.kind, 'keyset');
  assert.deepEqual(ks.manifest.files, []);
  assert.equal(ks.manifest.keyset.add.length, 1);
});

test('vector: ≥ 30 ca của contract §6, tệp tồn tại, mã mong đợi có, khóa thử chỉ ở keys/', () => {
  const meta = JSON.parse(readFileSync(join(VEC, 'cases.json'), 'utf8'));
  const ids = meta.cases.map((c) => c.id);
  for (let i = 1; i <= 30; i++) assert.ok(ids.includes(i), `thiếu ca ${i}`);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of meta.cases) {
    assert.match(c.expect.code, /^[A-Z_]+$/);
    assert.ok([0, 3, 4, 5, 6].includes(c.expect.exit), `${c.name}: exit`);
    if (c.generated) continue; // out/: node tools/release/make-update.mjs --vectors --out --test
    assert.ok(existsSync(join(VEC, c.file)), c.file);
  }
  const valid = readTar(readFileSync(join(VEC, meta.valid.file)));
  const pub = createPublicKey(readFileSync(join(VEC, meta.trustedKeys, 'test-ec-p256.pem')));
  assert.ok(verify('sha256', valid[0].data, pub, valid[1].data));
  assert.equal(meta.valid.keyId, keyIdOf(key));
  // the unknown-key case is signed by the other test key, which is not trusted
  const other = readTar(readFileSync(join(VEC, 'bad/02-key-unknown.matupdate')));
  assert.equal(verify('sha256', other[0].data, pub, other[1].data), false);
  // SHA256SUMS
  const sums = readFileSync(join(VEC, 'sums/SHA256SUMS'));
  assert.ok(verify('sha256', sums, pub, readFileSync(join(VEC, 'sums/SHA256SUMS.sig'))));
});

test('CLI: --vectors và --it cần --test (chỉ ký bằng khóa thử)', () => {
  const r = spawnSync(
    process.execPath,
    [join(root, 'tools/release/make-update.mjs'), '--vectors', '--out'],
    {
      encoding: 'utf8',
    },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--test/);
});

// Rà soát T062 F4: khóa phát hành có mật khẩu (keygen.ps1): mật khẩu từ MAT_SIGN_PASSPHRASE hoặc hỏi trên terminal;
// không có cả hai thì dừng với thông báo rõ (không treo, không lộ mật khẩu).
test('CLI --from: khóa riêng có mật khẩu dùng MAT_SIGN_PASSPHRASE', () => {
  const d = mkdtempSync(join(tmpdir(), 'mku-enc-'));
  mkdirSync(join(d, 'tree/bin'), { recursive: true });
  writeFileSync(join(d, 'tree/bin/mat-runtime'), 'bin');
  const pass = 'mk-Ky-Phat-Hanh-7!';
  const kp = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: pass },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const k = join(d, 'release.key.pem');
  writeFileSync(k, kp.privateKey);
  const out = join(d, 'u.matupdate');
  const cli = [
    join(root, 'tools/release/make-update.mjs'),
    '--from',
    join(d, 'tree'),
    '--key',
    k,
    '--out',
    out,
    '--version',
    '1.0.1',
    '--release-seq',
    '3',
  ];
  const env = { ...process.env };
  delete env.MAT_SIGN_PASSPHRASE;
  const no = spawnSync(process.execPath, cli, { encoding: 'utf8', env, stdio: 'pipe' });
  assert.notEqual(no.status, 0);
  assert.match(no.stderr, /MAT_SIGN_PASSPHRASE/);
  const bad = spawnSync(process.execPath, cli, {
    encoding: 'utf8',
    env: { ...env, MAT_SIGN_PASSPHRASE: 'sai-mat-khau' },
  });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /mật khẩu/);
  assert.ok(!bad.stderr.includes('sai-mat-khau'), 'mật khẩu lộ ra đầu ra');
  const ok = spawnSync(process.execPath, cli, {
    encoding: 'utf8',
    env: { ...env, MAT_SIGN_PASSPHRASE: pass },
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(!(ok.stdout + ok.stderr).includes(pass), 'mật khẩu lộ ra đầu ra');
  const members = readTar(readFileSync(out));
  assert.ok(verify('sha256', members[0].data, createPublicKey(kp.publicKey), members[1].data));
});

test('release.ps1 bước 5 gọi make-update.mjs bằng --from (cây giải nén), không phải --runtime', () => {
  const text = readFileSync(join(root, 'tools/release/release.ps1'), 'utf8');
  const step = text.slice(
    text.indexOf('Invoke-ReleaseStep 5'),
    text.indexOf('Invoke-ReleaseStep 7'),
  );
  assert.doesNotMatch(step, /--runtime/);
  assert.match(step, /'--from'/);
  assert.match(step, /\.matupdate/);
});
