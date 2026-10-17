// Test công cụ ký (feature 011, T088; FR-047, FR-048, SC-017; contract release-signing §1):
//   node --test tools/release/sign.test.mjs
// - Mọi script PowerShell của tools/release/ phân tích được, không dùng cú pháp chỉ có ở PowerShell 7 (Windows
//   PowerShell 5.1 là môi trường của máy ký), có BOM UTF-8 khi chứa chữ không phải ASCII (5.1 đọc tệp không BOM theo
//   bảng mã ANSI), và nạp tools/lib/platform.ps1.
// - sign.ps1: chế độ `command` chạy được ở mọi nơi (lệnh ký giả); `store`/`test` cần signtool (chỉ Windows, chạy thật
//   ở T091–T093, T102 trên máy Windows); bí mật không có trong log và đầu ra.
import assert from 'node:assert/strict';
import {
  chmodSync,
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
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findOpenssl, findPwsh, runPwsh } from './lib/pwsh.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pwsh = findPwsh();
const noPs = !pwsh ? 'không có PowerShell' : false;
const isWin = process.platform === 'win32';
const temps = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mat-sign-'));
  temps.push(d);
  return d;
};

const scripts = readdirSync(here)
  .filter((n) => n.endsWith('.ps1'))
  .map((n) => join(here, n))
  .concat([join(here, 'lib', 'signing.ps1')]);

test('có đủ script của US3', () => {
  for (const n of [
    'sign.ps1',
    'verify-release.ps1',
    'release.ps1',
    'keygen.ps1',
    'sign-sums.ps1',
  ]) {
    assert.ok(existsSync(join(here, n)), n);
  }
  const ts = JSON.parse(readFileSync(join(here, 'timestamp-urls.json'), 'utf8'));
  assert.ok(
    Array.isArray(ts.urls),
    'timestamp-urls.json có mảng urls (mặc định rỗng: người phát hành điền)',
  );
});

test('deployment/keys/ chỉ có khóa công khai (không có khóa riêng nào trong repo)', () => {
  const dir = join(here, '../../deployment/keys');
  for (const n of readdirSync(dir).filter((x) => x !== 'README.md')) {
    const text = readFileSync(join(dir, n), 'utf8');
    assert.doesNotMatch(text, /PRIVATE KEY/, `${n} là khóa riêng`);
    if (n.endsWith('.pem')) assert.match(n, /\.pub\.pem$/, n);
  }
});

test('BOM UTF-8 khi có chữ không phải ASCII; nạp platform.ps1', () => {
  for (const f of scripts) {
    const b = readFileSync(f);
    const bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
    const nonAscii = b.some((x) => x > 0x7f);
    assert.ok(!nonAscii || bom, `${f}: cần BOM cho Windows PowerShell 5.1`);
    if (!f.endsWith('signing.ps1')) {
      assert.match(b.toString('utf8'), /platform\.ps1/, `${f}: nạp tools/lib/platform.ps1`);
    }
  }
});

test(
  'PowerShell phân tích được mọi script, không có token chỉ của PowerShell 7',
  { skip: noPs },
  () => {
    const d = tmp();
    const probe = join(d, 'parse.ps1');
    writeFileSync(
      probe,
      [
        'param([string[]]$Files)',
        "$Files = @($Files | ForEach-Object { $_ -split ',' })",
        '$bad = @("AndAnd", "OrOr", "QuestionQuestion", "QuestionQuestionEquals", "QuestionDot", "QuestionLBracket", "QuestionMark")',
        '$fail = 0',
        'foreach ($f in $Files) {',
        '  $tokens = $null; $errors = $null',
        '  [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errors)',
        '  foreach ($e in $errors) { Write-Output ("PARSE " + $f + ": " + $e.Message); $fail++ }',
        '  foreach ($t in $tokens) { if ($bad -contains $t.Kind.ToString()) { Write-Output ("PS7 " + $f + ":" + $t.Extent.StartLineNumber + " " + $t.Kind); $fail++ } }',
        '}',
        'Write-Output ("FAIL=" + $fail)',
        '',
      ].join('\n'),
    );
    const r = runPwsh(pwsh, ['-File', probe, '-Files', scripts.join(',')]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /FAIL=0/, r.stdout);
  },
);

function fakeSigner(dir) {
  const p = join(dir, 'fake-sign.mjs');
  writeFileSync(
    p,
    [
      "import { appendFileSync } from 'node:fs';",
      'const secret = process.env.MAT_SIGN_TEST_SECRET ?? "";',
      "if (!secret) { console.error('no secret'); process.exit(9); }",
      "appendFileSync(process.argv[2], '\\nSIGNED-BY-FAKE');",
      // Trình ký "nói nhiều": in cả bí mật ra stdout. sign.ps1 phải che trước khi in hay ghi log.
      "console.log('fake signer using token ' + secret);",
      '',
    ].join('\n'),
  );
  return p;
}

test(
  'sign.ps1 -Mode command: thay {file}, ghi signing-log.json, không lộ bí mật',
  { skip: noPs },
  () => {
    const d = tmp();
    const signer = fakeSigner(d);
    const f1 = join(d, 'a b.exe');
    const f2 = join(d, 'c.exe');
    writeFileSync(f1, 'MZ-one');
    writeFileSync(f2, 'MZ-two');
    const log = join(d, 'signing-log.json');
    const secret = 's3cr3t-PIN-4711';
    const r = runPwsh(
      pwsh,
      [
        '-File',
        join(here, 'sign.ps1'),
        '-Mode',
        'command',
        '-Command',
        `"${process.execPath}" "${signer}" {file}`,
        '-Path',
        `${f1},${f2}`,
        '-LogPath',
        log,
      ],
      { env: { ...process.env, MAT_SIGN_TEST_SECRET: secret } },
    );
    const out = r.stdout + r.stderr;
    assert.ok(!out.includes(secret), 'bí mật lộ ra đầu ra');
    if (isWin) {
      // Trên Windows sign.ps1 kiểm lại bằng Get-AuthenticodeSignature: lệnh ký giả không tạo chữ ký thật.
      assert.equal(r.status, 1, out);
      assert.match(out, /VERIFY_AFTER_SIGN/);
      return;
    }
    assert.equal(r.status, 0, out);
    assert.match(out, /BẢN THỬ, KHÔNG PHÁT HÀNH/);
    assert.match(out, /BỎ QUA.*Authenticode/);
    assert.match(
      readFileSync(f1, 'utf8'),
      /SIGNED-BY-FAKE$/,
      'đường dẫn có dấu cách được trích dẫn đúng',
    );
    assert.match(readFileSync(f2, 'utf8'), /SIGNED-BY-FAKE$/);
    const logText = readFileSync(log, 'utf8');
    assert.ok(!logText.includes(secret), 'bí mật lộ vào signing-log.json');
    const entries = JSON.parse(logText);
    assert.equal(entries.length, 2);
    for (const e of entries) {
      assert.equal(e.mode, 'command');
      assert.equal(e.release, false);
      assert.match(e.sha256, /^[0-9a-f]{64}$/);
      assert.equal(e.verify.status, 'skipped');
      assert.ok(e.time && e.file);
    }
    assert.equal(entries[0].file, 'a b.exe');
  },
);

test(
  'sign.ps1 -Release -Mode command ngoài Windows: từ chối (không kiểm lại được chữ ký)',
  { skip: noPs || isWin },
  () => {
    const d = tmp();
    const signer = fakeSigner(d);
    const f = join(d, 'x.exe');
    writeFileSync(f, 'MZ');
    const r = runPwsh(
      pwsh,
      [
        '-File',
        join(here, 'sign.ps1'),
        '-Mode',
        'command',
        '-Command',
        `"${process.execPath}" "${signer}" {file}`,
        '-Path',
        f,
        '-LogPath',
        join(d, 'log.json'),
        '-Release',
      ],
      { env: { ...process.env, MAT_SIGN_TEST_SECRET: 'abcdef' } },
    );
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /VERIFY_AFTER_SIGN/);
  },
);

test(
  'sign.ps1: chế độ store/test cần signtool (chỉ Windows); command thiếu -Command là dùng sai',
  { skip: noPs || isWin },
  () => {
    const d = tmp();
    const f = join(d, 'x.exe');
    writeFileSync(f, 'MZ');
    for (const mode of ['store', 'test']) {
      const r = runPwsh(pwsh, [
        '-File',
        join(here, 'sign.ps1'),
        '-Mode',
        mode,
        '-Path',
        f,
        '-LogPath',
        join(d, 'l.json'),
      ]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stdout + r.stderr, /chỉ (chạy )?trên Windows/);
    }
    const r2 = runPwsh(pwsh, ['-File', join(here, 'sign.ps1'), '-Mode', 'command', '-Path', f]);
    assert.equal(r2.status, 2);
    assert.equal(readFileSync(f, 'utf8'), 'MZ', 'không ký khi dùng sai');
  },
);

// Rà soát T062 F3: -Verifier không được bỏ qua kiểm khóa thử. Bộ kiểm giả luôn trả 0: keyId vẫn phải được tính từ
// khóa công khai kiểm được chữ ký và đưa vào cổng (gate.mjs pha key).
test(
  'sign-sums.ps1 -Release -Verifier: vẫn từ chối khóa thử (CERT_TEST_KEY)',
  { skip: noPs || isWin || !findOpenssl() ? 'cần pwsh và openssl (không phải Windows)' : false },
  () => {
    const d = tmp();
    const vec = join(here, '../../tests/update-vectors');
    const key = join(d, 'k.pem');
    copyFileSync(join(vec, 'keys/test-ec-p256.pem'), key);
    const keys = join(d, 'keys');
    mkdirSync(keys);
    copyFileSync(join(vec, 'keys-trusted/test-ec-p256.pem'), join(keys, 'test.pem'));
    const sums = join(d, 'SHA256SUMS');
    writeFileSync(sums, `${'0'.repeat(64)}  a.bin\n`);
    const verifier = join(d, 'fake-verify.sh');
    writeFileSync(verifier, '#!/bin/sh\nexit 0\n');
    chmodSync(verifier, 0o755);
    const r = runPwsh(pwsh, [
      '-File',
      join(here, 'sign-sums.ps1'),
      '-Sums',
      sums,
      '-Key',
      key,
      '-Keys',
      keys,
      '-Verifier',
      verifier,
      '-Release',
    ]);
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 1, out);
    assert.match(out, /CERT_TEST_KEY/);
    assert.ok(!existsSync(`${sums}.sig`), 'chữ ký bằng khóa thử phải bị xóa');
  },
);
