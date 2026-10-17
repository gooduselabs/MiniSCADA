// Test danh mục mã lỗi duy nhất (feature 011, T025; FR-006, SC-038): mọi mã mà mã nguồn dùng phải có trong
// `schemas/error-codes.json`, mỗi mã có thông điệp tiếng Việt, và `docs/user/error-codes.md` sinh từ danh mục không lệch.
//
// Phạm vi quét: `server/`, `core/`, `drivers/`, `packages/*/src`; chỉ `.cpp`, `.hpp`, `.h`, `.ts`. Bỏ thư mục `tests/`,
// `test/`, `bench/` (server/bench: đo, không đóng gói), `node_modules/`, `third_party/`, `dist/`, `out/`, thư mục bắt đầu bằng `poc` (server/poc, server/poc-drogon:
// bản thử 001, không chạy trên thiết bị), và file `*.test.ts`, `*_test.cpp`, `*.d.ts`. `apps/` (Studio, trang web) ngoài
// phạm vi: chúng đọc mã do thiết bị và các gói trả về, không sinh mã mới.
//
// Luật nhận mã (cố ý hẹp để ít báo nhầm):
//   A. Mọi nơi trong phạm vi (cả chú thích): từ `E_[A-Z0-9_]+` hoặc `W_[A-Z0-9_]+` đứng riêng (`\b`). Bỏ từ kết thúc
//      bằng `_` (tiền tố trong chú thích, như `E_PKG_*`).
//   B. Chỉ C++ (`server/`, `core/`, `drivers/`): chuỗi trong nháy kép dạng SCREAMING_SNAKE có ít nhất một gạch dưới,
//      `"[A-Z][A-Z0-9]*(_[A-Z0-9]+)+"`. Đây là cách runtime phát mã API, mã kết quả ghi, lý do quality, mã cảnh báo của
//      `system/info.warnings`, mã đóng WebSocket… (`{"error", "X"}`, `sendError(c, 409, "X")`, `refuse(403, "X")`,
//      `r.code = "X"`, bảng `{"X", "câu"}`). Chuỗi cùng dạng mà không phải mã nằm trong NOT_CODES dưới đây, kèm lý do.
//      Ở TS không áp luật này: hằng, khóa và trạng thái SCREAMING_SNAKE quá nhiều (ACTIVE_UNACK, R_SCRIPT, LIVE_LOST…),
//      và mã API do C++ phát nên đã bắt ở C++.
//   C. Chỉ C++: mã một từ (không gạch dưới) chỉ khi đứng ở chỗ phát lỗi: `{"error", "X"`, `"error":"X"` (JSON thô),
//      `sendError(…, NNN, "X"`, `refuse(NNN, "X"`, `fail(…, NNN, "X"`. Mã một từ ở chỗ khác (OK, TIMEOUT, REFUSED của
//      Thử kết nối, DISABLED của quality) không bắt được: một từ viết hoa quá dễ trùng chữ thường gặp.
//
// Mỗi mục của danh mục: `code`, `http` (số hoặc null khi mã không phải mã trả thẳng của một yêu cầu HTTP), `group`,
// `message` (tiếng Việt), `usedIn` (khu vực tìm thấy mã: `server` cho file ngay dưới server/, `server/http`,
// `core/<module>`, `drivers/<driver>`, `packages/<gói>`). `usedIn` phải đúng bằng khu vực quét được; mã trong danh mục
// mà mã nguồn không còn dùng cũng là lỗi (xóa khỏi danh mục, sinh lại tài liệu).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = join(root, 'schemas/error-codes.json');
const generator = join(root, 'tools/gen-error-codes.mjs');

/** Chuỗi khớp luật B mà không phải mã lỗi hay cảnh báo. */
const NOT_CODES = new Map([
  ['ACTIVE_ACK', 'trạng thái alarm (alarm-engine.md), không phải lỗi'],
  ['ACTIVE_UNACK', 'trạng thái alarm'],
  ['RTN_UNACK', 'trạng thái alarm'],
  ['TANK01_LEVEL', 'ví dụ tên cột trong chú thích (logging_config.hpp)'],
  ['SQL_ASCII', 'tên bảng mã của PostgreSQL (pg_destination.cpp)'],
  ['IP_PKTINFO', 'tên tùy chọn socket trong câu log (discovery_server.cpp)'],
]);

const GROUPS = [
  'format',
  'tags',
  'expression',
  'screens',
  'svg',
  'alarm',
  'history',
  'package',
  'deploy',
  'auth',
  'write',
  'quality',
  'driver',
  'live',
  'logic',
  'system',
  'update',
];

const SKIP_DIRS = new Set(['tests', 'test', 'bench', 'node_modules', 'third_party', 'dist', 'out']);

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('poc')) walk(p, acc);
    } else if (
      /\.(cpp|hpp|h|ts)$/.test(e.name) &&
      !/(\.test\.ts|_test\.cpp|\.d\.ts)$/.test(e.name)
    ) {
      acc.push(p);
    }
  }
  return acc;
}

function areaOf(file) {
  const parts = relative(root, file).split(/[\\/]/);
  if (parts[0] === 'packages') return `packages/${parts[1]}`;
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

const RULE_A = /\b([EW]_[A-Z0-9_]+)\b/g;
const RULE_B = /"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g;
const RULE_C =
  /(?:\{\s*"error"\s*,\s*|\\?"error\\?"\s*:\s*\\?|(?:sendError|refuse|fail)\s*\([^;]{0,40}?\b\d{3}\s*,\s*)"([A-Z][A-Z0-9]*)"/g;

/** Quét mã nguồn: Map mã → Set khu vực. */
function scanSource() {
  const areas = [
    'server',
    'core',
    'drivers',
    ...readdirSync(join(root, 'packages')).map((p) => `packages/${p}/src`),
  ];
  const found = new Map();
  const add = (code, file) => {
    if (code.endsWith('_')) return;
    if (!found.has(code)) found.set(code, new Set());
    found.get(code).add(areaOf(file));
  };
  for (const file of areas.flatMap((a) => walk(join(root, a)))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(RULE_A)) add(m[1], file);
    if (file.endsWith('.ts')) continue;
    for (const m of text.matchAll(RULE_B)) {
      if (!/^[EW]_/.test(m[1]) && !NOT_CODES.has(m[1])) add(m[1], file);
    }
    for (const m of text.matchAll(RULE_C)) add(m[1], file);
  }
  return found;
}

const found = scanSource();

function loadCatalog() {
  assert.ok(existsSync(catalogPath), 'thiếu schemas/error-codes.json');
  const doc = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.ok(Array.isArray(doc.codes), 'schemas/error-codes.json cần mảng `codes`');
  return doc.codes;
}

test('luật quét bắt đúng các mẫu đã biết và bỏ chuỗi không phải mã', () => {
  assert.ok(found.size >= 300, `chỉ quét được ${found.size} mã: luật quét có thể đã hỏng`);
  // A: mã kiểm tra project ở TS và C++; B: mã API do refuse()/sendError() phát; C: mã một từ ở chỗ phát lỗi.
  for (const code of ['E_ADDR_SYNTAX', 'W_BIT_RMW', 'E_PKG_DIGEST', 'E_IMPORT_DTD']) {
    assert.ok(found.has(code), code);
  }
  for (const code of ['AUTH_FAILED', 'CSRF_FAILED', 'NOT_SENT_QUEUE_FULL', 'TLS_NO_IP_SAN']) {
    assert.ok(found.has(code), code);
  }
  for (const code of ['FORBIDDEN', 'BUSY']) assert.ok(found.has(code), code);
  for (const code of [...NOT_CODES.keys(), 'E_PKG_', 'W_LOG_', 'OK']) {
    assert.ok(!found.has(code), `${code} không phải mã`);
  }
});

test('mọi mã mà mã nguồn dùng đều có trong danh mục', () => {
  const known = new Set(loadCatalog().map((e) => e.code));
  const missing = [...found.keys()].filter((c) => !known.has(c)).sort();
  assert.deepEqual(
    missing,
    [],
    `${missing.length}/${found.size} mã chưa có trong schemas/error-codes.json: ${missing.join(', ')}`,
  );
});

test('mọi mã của danh mục còn được mã nguồn dùng, và usedIn đúng nơi dùng', () => {
  const stale = [];
  const wrongUse = [];
  for (const e of loadCatalog()) {
    if (!found.has(e.code)) {
      stale.push(e.code);
      continue;
    }
    const want = [...found.get(e.code)].sort();
    if (JSON.stringify(e.usedIn) !== JSON.stringify(want)) {
      wrongUse.push(`${e.code}: ${JSON.stringify(want)}`);
    }
  }
  assert.deepEqual(stale, [], `mã không còn dùng: ${stale.join(', ')}`);
  assert.deepEqual(wrongUse, [], `usedIn lệch (giá trị đúng):\n${wrongUse.join('\n')}`);
});

test('mỗi mục đủ trường, đúng kiểu, mã không trùng và sắp theo mã', () => {
  const codes = loadCatalog();
  const vietnamese = /[À-ỹĐđ]/u;
  const problems = [];
  for (const e of codes) {
    const keys = Object.keys(e).sort().join(',');
    if (keys !== 'code,group,http,message,usedIn') problems.push(`${e.code}: trường ${keys}`);
    if (typeof e.code !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(e.code))
      problems.push(`mã sai: ${e.code}`);
    if (e.http !== null && !(Number.isInteger(e.http) && e.http >= 400 && e.http <= 599)) {
      problems.push(`${e.code}: http ${e.http}`);
    }
    if (!GROUPS.includes(e.group)) problems.push(`${e.code}: nhóm lạ ${e.group}`);
    if (typeof e.message !== 'string' || !vietnamese.test(e.message) || /[{}]/.test(e.message)) {
      problems.push(`${e.code}: thông điệp phải là câu tiếng Việt không có chỗ trống {…}`);
    }
    if (!Array.isArray(e.usedIn) || e.usedIn.length === 0) problems.push(`${e.code}: usedIn rỗng`);
  }
  assert.deepEqual(problems, []);
  const order = codes.map((e) => e.code);
  assert.deepEqual(order, [...new Set(order)].sort(), 'mã trùng hoặc chưa sắp theo thứ tự');
});

test('docs/user/error-codes.md đã sinh khớp danh mục (--check)', () => {
  assert.ok(existsSync(generator), 'thiếu tools/gen-error-codes.mjs');
  const r = spawnSync(process.execPath, [generator, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('tài liệu có một dòng cho mỗi mã và mục cho mỗi nhóm đang dùng', () => {
  const codes = loadCatalog();
  const text = readFileSync(join(root, 'docs/user/error-codes.md'), 'utf8');
  for (const e of codes) assert.ok(text.includes(`| \`${e.code}\` |`), e.code);
  for (const g of new Set(codes.map((e) => e.group))) {
    assert.ok(text.includes(`<a id="${g}"></a>`), g);
  }
});
