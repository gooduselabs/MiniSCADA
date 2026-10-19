// Thư mục phát hành mẫu cho test (feature 011, T088, T094): dùng chung bởi verify-release.test.mjs và
// verify-release-windows.test.mjs.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyIdOf, makeSums } from './release-crypto.mjs';
import { packEnvelope } from './envelope.mjs';

/**
 * Thư mục phát hành mẫu đủ 9 mục của FR-052 trừ bộ cài (Windows), ký bằng khóa thử sinh tại chỗ. `extraFiles`
 * (tên → nội dung) là các tệp thêm vào thư mục trước khi lập SHA256SUMS (ví dụ bộ cài đã ký).
 */
export function makeRelease(root, extraFiles = {}) {
  const dir = join(root, '1.0.0-rc.0');
  const keys = join(root, 'keys');
  const other = join(root, 'other-keys');
  mkdirSync(dir);
  mkdirSync(keys);
  mkdirSync(other);
  const k = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const k2 = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  writeFileSync(
    join(keys, 'release-test.pub.pem'),
    k.publicKey.export({ type: 'spki', format: 'pem' }),
  );
  writeFileSync(join(other, 'other.pub.pem'), k2.publicKey.export({ type: 'spki', format: 'pem' }));

  const tgz = Buffer.from('payload-' + 'x'.repeat(4000));
  writeFileSync(join(dir, 'mat-runtime-armhf.tar.gz'), tgz);
  writeFileSync(
    join(dir, 'mat-runtime-armhf.tar.gz.sha256'),
    `${createHash('sha256').update(tgz).digest('hex')}  mat-runtime-armhf.tar.gz\n`,
  );
  const manifest = Buffer.from(
    JSON.stringify({ format: '1.0.0', kind: 'runtime', releaseSeq: 12 }, null, 2),
  );
  const sig = sign('sha256', manifest, { key: k.privateKey, dsaEncoding: 'der' });
  writeFileSync(
    join(dir, 'mat-runtime-1.0.0-rc.0.matupdate'),
    packEnvelope([
      ['update.json', manifest],
      ['update.sig', sig],
      ['payload.tar.gz', Buffer.from('gz')],
    ]),
  );
  writeFileSync(
    join(dir, 'sbom.cdx.json'),
    JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', components: [{ name: 'x' }] }),
  );
  writeFileSync(join(dir, 'licenses.md'), '# License\n');
  writeFileSync(join(dir, 'RELEASE-NOTES.md'), '# 1.0.0-rc.0\n');
  writeFileSync(
    join(dir, 'build-info.json'),
    JSON.stringify({
      version: '1.0.0-rc.0',
      releaseSeq: 12,
      commit: 'c'.repeat(40),
      release: false,
      signing: { releaseKeyId: keyIdOf(k.publicKey) },
    }),
  );
  for (const [name, data] of Object.entries(extraFiles)) writeFileSync(join(dir, name), data);
  const sums = makeSums(dir);
  writeFileSync(join(dir, 'SHA256SUMS'), sums);
  writeFileSync(
    join(dir, 'SHA256SUMS.sig'),
    sign('sha256', Buffer.from(sums), { key: k.privateKey, dsaEncoding: 'der' }),
  );
  return { dir, keys, other, privateKey: k.privateKey };
}
