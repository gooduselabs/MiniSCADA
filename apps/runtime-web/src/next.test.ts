// Địa chỉ quay lại sau đăng nhập (feature 013, FR-002; admin-api §7): chỉ hash nội bộ, 20+ dạng độc hại bị bỏ.
import { describe, expect, it } from 'vitest';
import { afterLogin, loginUrl, nextFromLocation, nextOf, safeNext } from './next.ts';

/** Dạng độc hại sau khi URLSearchParams đã giải mã một lần (đúng như trang /login nhận). */
const EVIL = [
  '//evil.example',
  'https://evil.example',
  'http://evil.example/#/x',
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'data:text/html,x',
  '#/../admin',
  '#/./x',
  '#/a//b',
  '#/%2e%2e/x',
  '#%2F%2Fevil.example',
  '%23/bom1',
  '\\\\evil.example',
  '/\\evil.example',
  '#/bom1 ',
  ' #/bom1',
  '#/bom1\n',
  '#/bom1\r\nSet-Cookie: x=1',
  '#/' + 'a'.repeat(201),
  '#//evil.example',
  '#/bom1?x=1',
  '#/bóm',
  '/#/bom1',
  '',
];

describe('safeNext', () => {
  it.each([
    '#/',
    '#/bom1',
    '#/tong-quan',
    '#/report/dien-ngay',
    '#/quan-tri/nguoi-dung',
    '#/a_b.c',
  ])('nhận %s', (v) => expect(safeNext(v)).toBe(v));
  it('nhận đúng 200 ký tự sau #/', () => expect(safeNext('#/' + 'a'.repeat(200))).not.toBeNull());
  it.each(EVIL)('bỏ %j', (v) => expect(safeNext(v)).toBeNull());
  it('null, undefined → null', () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });
});

describe('afterLogin', () => {
  it('hợp lệ → /#/…; khác → /', () => {
    expect(afterLogin('#/bom1')).toBe('/#/bom1');
    for (const e of EVIL) expect(afterLogin(e)).toBe('/');
  });
});

describe('nextOf, loginUrl', () => {
  it('bỏ phần truy vấn của trang', () => {
    expect(nextOf('#/history?g=ap-suat&r=1h')).toBe('#/history');
    expect(loginUrl('#/report/dien?d=2026-10-01')).toBe('/login?next=%23%2Freport%2Fdien');
  });
  it('hash rỗng hoặc lạ → /login', () => {
    expect(loginUrl('')).toBe('/login');
    expect(loginUrl('#/../x')).toBe('/login');
  });
  it('hash hợp lệ → /login?next=<mã hóa>', () =>
    expect(loginUrl('#/bom1')).toBe('/login?next=%23%2Fbom1'));
});

describe('nextFromLocation', () => {
  it('ưu tiên ?next, giải mã một lần', () =>
    expect(nextFromLocation('?next=%23%2Fbom1', '#/khac')).toBe('#/bom1'));
  it('?next độc hại thì bỏ, không dùng hash thay', () =>
    expect(nextFromLocation('?next=https%3A%2F%2Fevil', '#/bom1')).toBeNull());
  it('mã hóa kép không được giải mã lần hai', () =>
    expect(nextFromLocation('?next=%2523%252Fbom1', '')).toBeNull());
  it('không có ?next: dùng fragment giữ lại sau 302', () =>
    expect(nextFromLocation('', '#/bom1')).toBe('#/bom1'));
  it('không có gì → null', () => expect(nextFromLocation('', '')).toBeNull());
});
