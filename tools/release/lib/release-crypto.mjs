// SHA256SUMS và chữ ký ECDSA P-256 của bản phát hành (feature 011, T094, T097; FR-051, FR-053; contract
// release-signing §5, update-package §2–3). Chỉ dùng `node:crypto`.
//
// keyId = "sha256:" + SHA-256 của DER SubjectPublicKeyInfo (như mat-update-verify). Mã kết quả kiểm chữ ký giống mã
// thoát của mat-update-verify (contract device-api-011 §7): 0 hợp lệ, 3 chữ ký sai, 4 khóa lạ, 5 định dạng sai.
import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const SUMS = 'SHA256SUMS';
export const SUMS_SIG = 'SHA256SUMS.sig';
export const VERIFY = { OK: 0, SIG_INVALID: 3, KEY_UNKNOWN: 4, FORMAT: 5 };

/** keyId của khóa (KeyObject công khai hoặc riêng, hay PEM). */
export function keyIdOf(key) {
  let k = key;
  if (typeof key === 'string' || Buffer.isBuffer(key)) {
    const text = key.toString();
    k = /PRIVATE KEY/.test(text) ? createPublicKey(createPrivateKey(text)) : createPublicKey(text);
  } else if (key.type === 'private') {
    k = createPublicKey(key);
  }
  const der = k.export({ type: 'spki', format: 'der' });
  return 'sha256:' + createHash('sha256').update(der).digest('hex');
}

/**
 * Khóa công khai ECDSA P-256 mã hóa theo OID đường cong (named curve). Khóa sinh với tham số tường minh (LibreSSL
 * `genpkey` mặc định) Node vẫn báo `prime256v1`, nhưng SPKI dài hơn 91 byte: keyId khác cách thiết bị tính và
 * Mbed TLS có thể không nhận, nên từ chối.
 */
export function isNamedP256(key) {
  const k = key.type === 'private' ? createPublicKey(key) : key;
  if (k.asymmetricKeyType !== 'ec' || k.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    return false;
  return k.export({ type: 'spki', format: 'der' }).length === 91;
}

/** Khóa công khai P-256 trong thư mục (`*.pem`); tệp không đọc được hoặc không phải P-256 bị bỏ, kèm lý do. */
export function loadTrustedKeys(dir) {
  const keys = [];
  const skipped = [];
  if (!dir || !existsSync(dir)) return { keys, skipped };
  for (const n of readdirSync(dir).sort()) {
    if (!n.endsWith('.pem')) continue;
    try {
      const text = readFileSync(join(dir, n), 'utf8');
      if (/PRIVATE KEY/.test(text)) {
        skipped.push(`${n}: là khóa riêng, không đặt vào thư mục khóa tin cậy`);
        continue;
      }
      const key = createPublicKey(text);
      if (!isNamedP256(key)) {
        skipped.push(`${n}: không phải ECDSA P-256 dạng named curve`);
        continue;
      }
      keys.push({ file: n, key, keyId: keyIdOf(key) });
    } catch (e) {
      skipped.push(`${n}: ${e.message}`);
    }
  }
  return { keys, skipped };
}

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/** Tệp của thư mục phát hành cần có trong SHA256SUMS (mọi tệp trừ SHA256SUMS và chữ ký của nó). */
export function releaseFiles(dir) {
  return listFiles(dir)
    .filter((n) => n !== SUMS && n !== SUMS_SIG)
    .sort();
}

export const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Nội dung SHA256SUMS (định dạng `sha256sum`: băm, hai dấu cách, tên; theo thứ tự tên). */
export function makeSums(dir) {
  return releaseFiles(dir)
    .map((n) => `${sha256File(join(dir, n))}  ${n}\n`)
    .join('');
}

/** Đọc SHA256SUMS; ném Error có `code = 5` khi sai định dạng. */
export function parseSums(text) {
  const entries = [];
  const seen = new Set();
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length) throw Object.assign(new Error('SHA256SUMS rỗng'), { code: VERIFY.FORMAT });
  for (const [i, line] of lines.entries()) {
    const m = /^([0-9a-f]{64}) [ *]([^\r\n]+)$/.exec(line);
    if (!m || m[2].startsWith('/') || m[2].split('/').includes('..')) {
      throw Object.assign(new Error(`SHA256SUMS dòng ${i + 1} sai định dạng`), {
        code: VERIFY.FORMAT,
      });
    }
    if (seen.has(m[2])) {
      throw Object.assign(new Error(`SHA256SUMS trùng tên ${m[2]}`), { code: VERIFY.FORMAT });
    }
    seen.add(m[2]);
    entries.push({ sha256: m[1], name: m[2] });
  }
  return entries;
}

/**
 * Kiểm chữ ký DER trên `data` bằng khóa tin cậy.
 * 4 khi không có khóa tin cậy nào, hoặc khi biết keyId của khóa ký (`expectKeyId`, từ build-info.json) mà khóa đó
 * không nằm trong khóa tin cậy; 3 khi có khóa để thử mà không khóa nào khớp.
 */
export function verifySignature({ data, signature, keys, expectKeyId = null }) {
  if (!keys.length)
    return { code: VERIFY.KEY_UNKNOWN, keyId: null, reason: 'không có khóa tin cậy' };
  for (const k of keys) {
    let ok;
    try {
      ok = verify('sha256', data, { key: k.key, dsaEncoding: 'der' }, signature);
    } catch {
      ok = false;
    }
    if (ok) return { code: VERIFY.OK, keyId: k.keyId, reason: null };
  }
  if (expectKeyId && !keys.some((k) => k.keyId === expectKeyId)) {
    return {
      code: VERIFY.KEY_UNKNOWN,
      keyId: null,
      reason: `khóa ký ${expectKeyId} không nằm trong khóa tin cậy`,
    };
  }
  return { code: VERIFY.SIG_INVALID, keyId: null, reason: 'chữ ký không khớp khóa tin cậy nào' };
}
