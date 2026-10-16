// Kiểm bộ sinh ca giới hạn (T036): chạy `node --test tests/fixtures/svg-import/`.
// Bộ quét thẻ độc lập với importer: chỉ để chứng minh các ca nằm đúng ở biên đã khai.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLimitCase, LIMIT_CASE_NAMES } from './limits.mjs';

const MIB = 1024 * 1024;

/** Quét thẻ (bỏ chú thích) và dựng cây { name, attrs, kids }. */
function scan(text) {
  const root = { name: '#root', attrs: '', kids: [] };
  const stack = [root];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) {
      i = text.indexOf('-->', lt) + 3;
      continue;
    }
    const gt = text.indexOf('>', lt);
    const tag = text.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith('/')) {
      stack.pop();
      continue;
    }
    const selfClose = tag.endsWith('/');
    const body = selfClose ? tag.slice(0, -1) : tag;
    const sp = body.search(/\s/);
    const node = { name: sp < 0 ? body : body.slice(0, sp), attrs: sp < 0 ? '' : body.slice(sp), kids: [] };
    stack[stack.length - 1].kids.push(node);
    if (!selfClose) stack.push(node);
  }
  return root.kids[0];
}

const count = (n) => 1 + n.kids.reduce((s, k) => s + count(k), 0);
const depth = (n) => 1 + Math.max(0, ...n.kids.map(depth));

function effective(svg) {
  const byId = new Map();
  (function index(n) {
    const m = / id="([^"]+)"/.exec(n.attrs);
    if (m) byId.set(m[1], n);
    n.kids.forEach(index);
  })(svg);
  const memo = new Map();
  const eff = (n) => {
    if (memo.has(n)) return memo.get(n);
    let e = 1;
    for (const k of n.kids) e += k.name === 'use' ? 1 + eff(byId.get(/href="#([^"]+)"/.exec(k.attrs)[1])) : eff(k);
    memo.set(n, e);
    return e;
  };
  // Với `use`: bản thân nó đã được đếm (1) trong eff(cha); cộng E(đích). Bỏ qua <defs> ở mức tài liệu.
  let e = 1;
  for (const k of svg.kids) {
    if (k.name === 'defs') e += count(k);
    else e += k.name === 'use' ? 1 + eff(byId.get(/href="#([^"]+)"/.exec(k.attrs)[1])) : eff(k);
  }
  return e;
}

test('có ít nhất 12 ca và mỗi ca dựng được', () => {
  assert.ok(LIMIT_CASE_NAMES.length >= 12);
  for (const n of LIMIT_CASE_NAMES) {
    const c = buildLimitCase(n);
    assert.ok(c.content.length > 0, n);
    assert.ok(['ok', 'rejected', 'sanitized'].includes(c.expect.outcome), n);
  }
});

test('kích thước byte ở biên 5 MiB', () => {
  assert.equal(Buffer.byteLength(buildLimitCase('bytes-5mib').content), 5 * MIB);
  assert.equal(Buffer.byteLength(buildLimitCase('bytes-5mib-plus-1').content), 5 * MIB + 1);
  assert.equal(Buffer.byteLength(buildLimitCase('bytes-6mib').content), 6 * MIB);
});

test('phần tử sau chuẩn hóa 20.000 / 20.001', () => {
  assert.equal(count(scan(buildLimitCase('elements-20000').content)), 20000);
  assert.equal(count(scan(buildLimitCase('elements-20001').content)), 20001);
});

test('độ sâu 32 / 33 / 100', () => {
  assert.equal(depth(scan(buildLimitCase('depth-32').content)), 32);
  assert.equal(depth(scan(buildLimitCase('depth-33').content)), 33);
  assert.equal(depth(scan(buildLimitCase('depth-100').content)), 100);
});

test('phần tử thô 100.000 / 100.001 / 200.000', () => {
  assert.equal(count(scan(buildLimitCase('raw-100000').content)), 100000);
  assert.equal(count(scan(buildLimitCase('raw-100001').content)), 100001);
  assert.equal(count(scan(buildLimitCase('raw-200000').content)), 200000);
});

test('phần tử hiệu dụng sau mở use: 100.000 / 100.001, và số phần tử trong tài liệu còn dưới 20.000', () => {
  for (const [name, want] of [
    ['use-effective-100000', 100000],
    ['use-effective-100001', 100001],
  ]) {
    const svg = scan(buildLimitCase(name).content);
    assert.equal(effective(svg), want, name);
    assert.ok(count(svg) < 20000, `${name}: không được đụng giới hạn 20.000`);
  }
});

test('filter 8 / 9, fe 64 / 65', () => {
  const nodes = (name, tag) => {
    let n = 0;
    (function walk(x) {
      if (x.name === tag) n++;
      x.kids.forEach(walk);
    })(scan(buildLimitCase(name).content));
    return n;
  };
  assert.equal(nodes('filters-8', 'filter'), 8);
  assert.equal(nodes('filters-9', 'filter'), 9);
  assert.equal(nodes('fe-64', 'feOffset'), 64);
  assert.equal(nodes('fe-65', 'feOffset'), 65);
});

test('ảnh: 16 / 17 ảnh; 2 MiB / 2 MiB + 1 sau giải mã', () => {
  const imgs = (name) => [...buildLimitCase(name).content.matchAll(/base64,([A-Za-z0-9+/=]+)"/g)].map((m) => Buffer.from(m[1], 'base64'));
  assert.equal(imgs('images-16').length, 16);
  assert.equal(imgs('images-17').length, 17);
  assert.ok(imgs('images-17').every((b) => b.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71]))));
  assert.equal(imgs('image-bytes-2mib')[0].length, 2 * MIB);
  assert.equal(imgs('image-bytes-2mib-plus-1')[0].length, 2 * MIB + 1);
});

test('nút chữ 4.096 / 4.097 ký tự; d 1 MiB / 1 MiB + 1', () => {
  const text = (n) => />(a+)</.exec(buildLimitCase(n).content)[1].length;
  assert.equal(text('text-4096'), 4096);
  assert.equal(text('text-4097'), 4097);
  const d = (n) => / d="([^"]+)"/.exec(buildLimitCase(n).content)[1].length;
  assert.equal(d('path-d-1mib'), MIB);
  assert.equal(d('path-d-1mib-plus-1'), MIB + 1);
});
