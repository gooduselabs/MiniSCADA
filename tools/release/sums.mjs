// SHA256SUMS của bản phát hành và chữ ký ECDSA P-256 (feature 011, T094, T097; FR-052, FR-053).
//
//   node tools/release/sums.mjs make --dir <thư mục> [--out <tệp>]          ghi SHA256SUMS (mọi tệp trừ SUMS và .sig)
//   node tools/release/sums.mjs sign --key <khóa riêng PEM> --in <tệp> [--out <tệp.sig>]
//   node tools/release/sums.mjs verify <SHA256SUMS> --sig <tệp> --keys <thư mục> [--expect-key-id <id>] [--json]
//   node tools/release/sums.mjs keyid <PEM>                                in keyId (sha256:<hex> của SPKI DER)
//   node tools/release/sums.mjs genkey --out-dir <thư mục ngoài repo> --name <tên>   khóa thử cho chạy thử
//
// `sign` chỉ nhận khóa không mã hóa (khóa thử, chạy thử); khóa phát hành thật có mật khẩu hoặc nằm trên token: ký bằng
// `openssl dgst -sha256 -sign` qua tools/release/sign-sums.ps1 (openssl tự hỏi mật khẩu, không qua dòng lệnh).
// `verify` là bản Node của `mat-update-verify SHA256SUMS --sig … --keys …`, cùng mã thoát: 0 hợp lệ, 3 chữ ký sai,
// 4 khóa lạ (không có khóa tin cậy, hoặc khóa ký theo build-info không nằm trong khóa tin cậy), 5 định dạng sai,
// 2 dùng sai.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUMS,
  VERIFY,
  isNamedP256,
  keyIdOf,
  loadTrustedKeys,
  makeSums,
  parseSums,
  verifySignature,
} from './lib/release-crypto.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Kiểm SHA256SUMS và chữ ký; trả { code, keyId, reason }. */
export function verifySumsFile({ sumsPath, sigPath, keysDir, expectKeyId = null }) {
  let data;
  let sig;
  try {
    data = readFileSync(sumsPath);
    sig = readFileSync(sigPath);
    parseSums(data.toString('utf8'));
  } catch (e) {
    return { code: VERIFY.FORMAT, keyId: null, reason: e.message };
  }
  if (sig.length < 8 || sig.length > 128 || sig[0] !== 0x30) {
    // Không phải DER SEQUENCE: vẫn là "chữ ký sai" (người tấn công sửa .sig), không phải định dạng SUMS sai.
    return { code: VERIFY.SIG_INVALID, keyId: null, reason: 'chữ ký không phải DER ECDSA' };
  }
  const { keys } = loadTrustedKeys(keysDir);
  return verifySignature({ data, signature: sig, keys, expectKeyId });
}

function usage(msg) {
  console.error(`sums: ${msg}`);
  process.exit(2);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = {};
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json') opt.json = true;
    else if (rest[i].startsWith('--')) {
      if (i + 1 >= rest.length) usage(`thiếu giá trị cho ${rest[i]}`);
      opt[rest[i].slice(2)] = rest[++i];
    } else pos.push(rest[i]);
  }
  if (cmd === 'make') {
    if (!opt.dir) usage('make cần --dir');
    const out = resolve(opt.out ?? join(opt.dir, SUMS));
    const text = makeSums(resolve(opt.dir));
    writeFileSync(out, text);
    console.log(`sums: ${text.split('\n').length - 1} tệp → ${out}`);
  } else if (cmd === 'sign') {
    if (!opt.key || !opt.in) usage('sign cần --key và --in');
    let key;
    try {
      key = createPrivateKey(readFileSync(opt.key));
    } catch (e) {
      usage(
        `không đọc được khóa riêng (${e.code ?? e.message}); khóa có mật khẩu hay trên token: dùng sign-sums.ps1 (openssl)`,
      );
    }
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      usage('khóa không phải ECDSA P-256');
    }
    const out = resolve(opt.out ?? `${opt.in}.sig`);
    writeFileSync(out, sign('sha256', readFileSync(opt.in), { key, dsaEncoding: 'der' }));
    console.log(`sums: đã ký ${opt.in} bằng ${keyIdOf(key)} → ${out}`);
  } else if (cmd === 'verify') {
    if (pos.length !== 1 || !opt.sig || !opt.keys)
      usage('verify <SHA256SUMS> --sig <tệp> --keys <thư mục>');
    const r = verifySumsFile({
      sumsPath: pos[0],
      sigPath: opt.sig,
      keysDir: opt.keys,
      expectKeyId: opt['expect-key-id'] ?? null,
    });
    if (opt.json) console.log(JSON.stringify(r));
    else if (r.code === 0) console.log(`hợp lệ, khóa ${r.keyId}`);
    else console.error(`từ chối (${r.code}): ${r.reason}`);
    process.exit(r.code);
  } else if (cmd === 'genkey') {
    // Chỉ cho chạy thử (release.ps1 không -Release): khóa không mã hóa, ngoài repo. Khóa phát hành thật: keygen.ps1.
    if (!opt['out-dir'] || !opt.name) usage('genkey --out-dir <thư mục ngoài repo> --name <tên>');
    const outDir = resolve(opt['out-dir']);
    const rel = relative(repoRoot, outDir);
    if (!rel.startsWith('..') && !isAbsolute(rel))
      usage(`không ghi khóa riêng vào repo (${outDir})`);
    mkdirSync(outDir, { recursive: true });
    const k = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    writeFileSync(
      join(outDir, `${opt.name}.key.pem`),
      k.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      {
        mode: 0o600,
      },
    );
    writeFileSync(
      join(outDir, `${opt.name}.pub.pem`),
      k.publicKey.export({ type: 'spki', format: 'pem' }),
    );
    console.log(keyIdOf(k.publicKey));
  } else if (cmd === 'keyid') {
    if (pos.length !== 1) usage('keyid <PEM>');
    const text = readFileSync(pos[0], 'utf8');
    let pub;
    try {
      pub = /PRIVATE KEY/.test(text)
        ? createPublicKey(createPrivateKey(text))
        : createPublicKey(text);
    } catch (e) {
      usage(
        `không đọc được khóa (${e.code ?? e.message}); khóa có mật khẩu: dùng khóa công khai .pub.pem`,
      );
    }
    // Khóa sinh với tham số đường cong tường minh (LibreSSL genpkey mặc định) có SPKI khác và không có
    // namedCurve: keyId sẽ khác thiết bị tính, Mbed TLS có thể không nhận. Bắt sinh lại với ec_param_enc:named_curve.
    if (!isNamedP256(pub)) {
      console.error('sums: khóa không phải ECDSA P-256 dạng named curve (prime256v1)');
      process.exit(1);
    }
    console.log(keyIdOf(pub));
  } else {
    usage('lệnh: make | sign | verify | keyid | genkey');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
