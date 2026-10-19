// Test các đường ký chỉ chạy được trên Windows (feature 011, T088, T091, T092; SC-017): make-test-cert.ps1, sign.ps1 ở
// ba chế độ store/command/test bằng chứng chỉ thử THẬT trong Cert:\CurrentUser\My (không đụng kho tin cậy), đường `.cmd`
// của chế độ command. Ngoài Windows mọi ca bị bỏ qua (phần không phụ thuộc hệ điều hành nằm ở sign.test.mjs).
// Chứng chỉ thử do test tạo được gỡ ở `after` (kể cả khi test đỏ).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findPwsh, runPwsh } from './lib/pwsh.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';
const pwsh = findPwsh();
const skip = !isWin ? 'chỉ Windows' : !pwsh ? 'không có PowerShell' : false;
const SUBJECT = 'CN=mAT SCADA TEST - NOT FOR RELEASE';

const temps = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mat-signwin-'));
  temps.push(d);
  return d;
};

/** Chạy một đoạn PowerShell ngắn, trả stdout đã cắt. */
function ps(script) {
  const r = runPwsh(pwsh, ['-Command', script]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout.trim();
}

/** Số chứng chỉ trong một kho theo dấu vân tay. */
function inStore(store, thumbprint) {
  return Number(
    ps(`@(Get-ChildItem '${store}' | Where-Object Thumbprint -eq '${thumbprint}').Count`),
  );
}

let fixtureExe = null;
/** Tệp .exe nhỏ KHÔNG có chữ ký (biên dịch bằng csc.exe của .NET Framework có sẵn trên Windows). */
function makeExe(dir, name) {
  if (!fixtureExe) {
    const src = join(tmp(), 'f.cs');
    writeFileSync(src, 'class P { static int Main() { return 0; } }');
    const csc = join(
      process.env.WINDIR ?? 'C:\\Windows',
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe',
    );
    fixtureExe = join(dirname(src), 'f.exe');
    const r = spawnSync(csc, ['/nologo', `/out:${fixtureExe}`, src], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  const p = join(dir, name);
  copyFileSync(fixtureExe, p);
  return p;
}

function signRun(args, env = {}) {
  return runPwsh(pwsh, ['-File', join(here, 'sign.ps1'), ...args], {
    env: { ...process.env, ...env },
  });
}

function certScript(...args) {
  return runPwsh(pwsh, ['-File', join(here, 'make-test-cert.ps1'), ...args]);
}

/** Dòng JSON cuối cùng trên stdout. */
const lastJson = (r) => JSON.parse(r.stdout.trim().split(/\r?\n/).pop());

let cert = null;
before(() => {
  if (skip) return;
  certScript('-Remove'); // sạch trước khi bắt đầu
});
after(() => {
  if (!skip) certScript('-Remove');
  temps.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

test('make-test-cert.ps1: tạo chứng chỉ thử đúng yêu cầu, không vào kho tin cậy', { skip }, () => {
  const r = certScript('-Json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  cert = lastJson(r);
  assert.match(cert.thumbprint, /^[0-9A-F]{40}$/);
  assert.equal(cert.subject, SUBJECT);
  assert.equal(cert.keyAlgorithm, 'RSA');
  assert.ok(cert.keySize >= 3072, `khóa ${cert.keySize} bit`);
  assert.ok(cert.ekus.includes('1.3.6.1.5.5.7.3.3'), 'có EKU Code Signing');
  assert.equal(inStore('Cert:\\CurrentUser\\My', cert.thumbprint), 1);
  for (const s of ['Root', 'TrustedPublisher', 'CA']) {
    assert.equal(inStore(`Cert:\\CurrentUser\\${s}`, cert.thumbprint), 0, `không có trong ${s}`);
    assert.equal(
      inStore(`Cert:\\LocalMachine\\${s}`, cert.thumbprint),
      0,
      `không có trong LM\\${s}`,
    );
  }
  // Chạy lại: dùng lại chứng chỉ còn hạn (không đẻ thêm chứng chỉ).
  const again = lastJson(certScript('-Json'));
  assert.equal(again.thumbprint, cert.thumbprint);
});

test(
  'sign.ps1 -Mode test: ký .exe, dấu vân tay đúng, log đủ trường, sửa 1 byte → HashMismatch',
  { skip },
  () => {
    assert.ok(cert, 'cần chứng chỉ từ ca trước');
    const d = tmp();
    const exe = makeExe(d, 'a b.exe');
    const log = join(d, 'log.json');
    const r = signRun(['-Mode', 'test', '-Path', exe, '-LogPath', log]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /BẢN THỬ, KHÔNG PHÁT HÀNH/);
    assert.match(r.stdout, new RegExp(cert.thumbprint));
    const entries = JSON.parse(readFileSync(log, 'utf8'));
    assert.equal(entries.length, 1);
    const e = entries[0];
    assert.equal(e.mode, 'test');
    assert.equal(e.release, false);
    assert.equal(e.thumbprint, cert.thumbprint);
    assert.equal(e.file, 'a b.exe');
    // NotTrusted hoặc UnknownError (gốc chưa tin cậy) đều là "chữ ký toán học đúng" với chứng chỉ thử.
    assert.match(e.verify.status, /^(NotTrusted|UnknownError)$/);
    assert.equal(e.gate.ok, true);
    const sigThumb = ps(
      `(Get-AuthenticodeSignature -LiteralPath '${exe}').SignerCertificate.Thumbprint`,
    );
    assert.equal(sigThumb, cert.thumbprint);
    // Sửa một byte: HashMismatch.
    const buf = readFileSync(exe);
    buf[1000] ^= 1; // trong phần ảnh PE (byte cuối nằm trong khối chữ ký, cho lỗi khác)
    writeFileSync(exe, buf);
    assert.equal(ps(`(Get-AuthenticodeSignature -LiteralPath '${exe}').Status`), 'HashMismatch');
  },
);

test('sign.ps1 -Mode store: cần -Thumbprint; có thì ký bằng đúng chứng chỉ đó', { skip }, () => {
  assert.ok(cert);
  const d = tmp();
  const exe = makeExe(d, 's.exe');
  const bad = signRun(['-Mode', 'store', '-Path', exe, '-LogPath', join(d, 'l.json')]);
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /Thumbprint|chứng chỉ/);
  const none = signRun([
    '-Mode',
    'store',
    '-Thumbprint',
    'A'.repeat(40),
    '-Path',
    exe,
    '-LogPath',
    join(d, 'l.json'),
  ]);
  assert.equal(none.status, 2, none.stdout + none.stderr);
  const ok = signRun([
    '-Mode',
    'store',
    '-Thumbprint',
    cert.thumbprint,
    '-Path',
    exe,
    '-LogPath',
    join(d, 'l.json'),
  ]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(readFileSync(join(d, 'l.json'), 'utf8'))[0].thumbprint, cert.thumbprint);
});

test(
  'sign.ps1 -Release với chứng chỉ thử: cổng từ chối (TEST, tự ký, hạn, không dấu thời gian), không ký',
  { skip },
  () => {
    assert.ok(cert);
    const d = tmp();
    const exe = makeExe(d, 'r.exe');
    const before = readFileSync(exe);
    const r = signRun(['-Mode', 'test', '-Release', '-Path', exe, '-LogPath', join(d, 'l.json')], {
      MAT_SIGN_THUMBPRINT: cert.thumbprint,
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /TỪ CHỐI (CERT_TEST|CERT_SELF_SIGNED)/);
    assert.deepEqual(readFileSync(exe), before, 'tệp không bị ký khi cổng từ chối');
    assert.ok(!existsSync(join(d, 'l.json')), 'không ghi log khi bị từ chối trước khi ký');
  },
);

test('sign.ps1 -CheckOnly: tìm chứng chỉ và chạy cổng pre, không ký', { skip }, () => {
  const r = signRun(['-Mode', 'test', '-CheckOnly']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /qua/);
});

// ---- chế độ command: đường .cmd (Windows PowerShell 5.1 và %MAT_SIGN_FILE%)
function fakeSigner(dir) {
  const p = join(dir, 'fake-sign.mjs');
  writeFileSync(
    p,
    [
      "import { appendFileSync } from 'node:fs';",
      'const secret = process.env.MAT_SIGN_TEST_PIN ?? "";',
      "if (!secret) { console.error('no secret'); process.exit(9); }",
      "appendFileSync(process.argv[2], '\\nSIGNED-BY-FAKE');",
      "console.log('fake signer using pin ' + secret);",
      '',
    ].join('\n'),
  );
  return p;
}

test(
  'sign.ps1 -Mode command trên Windows: tệp có dấu cách và dấu ngoặc ký đúng, PIN 4 ký tự bị che',
  { skip },
  () => {
    const d = tmp();
    const signer = fakeSigner(d);
    const sub = join(d, 'R (1) é');
    mkdirSync(sub);
    const f = join(sub, 'x y.exe');
    writeFileSync(f, 'MZ');
    const log = join(d, 'log.json');
    const r = signRun(
      [
        '-Mode',
        'command',
        '-Command',
        `"${process.execPath}" "${signer}" "{file}"`,
        '-Path',
        f,
        '-LogPath',
        log,
      ],
      { MAT_SIGN_TEST_PIN: '4821' },
    );
    assert.match(readFileSync(f, 'utf8'), /SIGNED-BY-FAKE$/, r.stdout + r.stderr);
    assert.ok(!r.stdout.includes('4821'), 'PIN không lộ ở stdout');
    assert.match(r.stdout, /pin \*\*\*/);
    assert.ok(!readFileSync(log, 'utf8').includes('4821'), 'PIN không lộ trong log');
    const e = JSON.parse(readFileSync(log, 'utf8'))[0];
    assert.equal(e.command, 'node.exe');
    assert.doesNotMatch(JSON.stringify(e), /fake-sign/);
  },
);

test(
  'sign.ps1 -Mode command trên Windows: từ chối tên tệp có ký tự đặc biệt của cmd',
  { skip },
  () => {
    const d = tmp();
    const signer = fakeSigner(d);
    const marker = join(d, 'PWNED.txt');
    for (const name of ['a&b.exe', 'a^b.exe', 'a%PATH%b.exe', 'a!b.exe']) {
      const f = join(d, name);
      writeFileSync(f, 'MZ');
      const r = signRun(
        [
          '-Mode',
          'command',
          '-Command',
          `"${process.execPath}" "${signer}" {file}`,
          '-Path',
          f,
          '-LogPath',
          join(d, 'l.json'),
        ],
        { MAT_SIGN_TEST_PIN: '4821' },
      );
      assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /ký tự đặc biệt của cmd/);
      assert.doesNotMatch(readFileSync(f, 'utf8'), /SIGNED-BY-FAKE/);
    }
    assert.ok(!existsSync(marker));
    assert.ok(readdirSync(d).length > 0);
  },
);

test('make-test-cert.ps1 -Remove: gỡ chứng chỉ thử khỏi Cert:\\CurrentUser\\My', { skip }, () => {
  assert.ok(cert);
  const r = certScript('-Remove');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(inStore('Cert:\\CurrentUser\\My', cert.thumbprint), 0);
  // Gỡ khi không còn gì vẫn xong (idempotent).
  assert.equal(certScript('-Remove').status, 0);
});
