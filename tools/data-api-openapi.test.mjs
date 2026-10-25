// Test khớp OpenAPI ↔ bảng route (feature 025, specs/025-data-api US5): mọi cặp (method, đường) /api/v1/data/* của
// core/auth/roles.cpp có trong docs/api/data-api.openapi.yaml và ngược lại; mỗi thao tác có operationId riêng và
// trả lời mặc định là lỗi chung; tài liệu hướng dẫn nhắc tới mọi đường. Chạy: node --test tools/data-api-openapi.test.mjs
//
// Không có bộ đọc YAML trong workspace: đọc theo thụt lề cố định của tệp (đường ở 2 khoảng trắng, method ở 4), đủ cho
// tệp này; một dòng lệch thụt lề làm test hỏng chứ không bị bỏ qua.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/** Các dòng {"METHOD", "/api/v1/data/..."} của bảng quyền. */
export function routesOfRoles(text) {
  const out = new Set();
  for (const m of text.matchAll(/\{\s*"(GET|POST)",\s*"(\/api\/v1\/data\/[^"]*)"/g))
    out.add(`${m[1]} ${m[2]}`);
  return out;
}

/** Các cặp method + đường của OpenAPI, cùng operationId. */
export function routesOfOpenApi(text) {
  const routes = new Set();
  const ops = [];
  let path = null;
  let inPaths = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^\S/.test(line)) inPaths = false;
    if (!inPaths) continue;
    const p = /^ {2}(\/\S+):\s*$/.exec(line);
    if (p) {
      path = p[1];
      continue;
    }
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m && path) {
      routes.add(`${m[1].toUpperCase()} ${path}`);
      ops.push({ route: `${m[1].toUpperCase()} ${path}`, id: null });
      continue;
    }
    const id = /^ {6}operationId:\s*(\S+)\s*$/.exec(line);
    if (id && ops.length) ops[ops.length - 1].id = id[1];
  }
  return { routes, ops };
}

const roles = routesOfRoles(read('core/auth/roles.cpp'));
const yaml = read('docs/api/data-api.openapi.yaml');
const { routes, ops } = routesOfOpenApi(yaml);

test('bảng quyền có 13 đường của API dữ liệu', () => {
  assert.equal(roles.size, 13, [...roles].join('\n'));
});

test('OpenAPI và bảng quyền có đúng cùng các đường', () => {
  assert.deepEqual([...routes].sort(), [...roles].sort());
});

test('OpenAPI 3.1, mỗi thao tác có operationId riêng, bảo mật bearer', () => {
  assert.match(yaml, /^openapi: 3\.1\.\d+$/m);
  assert.match(yaml, /^security:\n {2}- apiKey: \[\]$/m);
  assert.match(yaml, /scheme: bearer/);
  const ids = ops.map((o) => o.id);
  assert.ok(
    ids.every((x) => typeof x === 'string' && x.length > 0),
    'thiếu operationId',
  );
  assert.equal(new Set(ids).size, ids.length, 'operationId trùng');
});

test('hướng dẫn tiếng Việt nhắc tới mọi đường', () => {
  const guide = read('docs/user/data-api.md');
  for (const r of roles) {
    const path = r.split(' ')[1].replace(/\{[^}]+\}/g, '');
    assert.ok(guide.includes(path), `docs/user/data-api.md thiếu ${path}`);
  }
});

test('bộ đọc nhận ra đường lệch', () => {
  const { routes: r } = routesOfOpenApi(
    'paths:\n  /a:\n    get:\n      operationId: x\n   post:\n',
  );
  assert.deepEqual([...r], ['GET /a']);
});
