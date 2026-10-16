// Test phần thuần của công cụ so ảnh (feature 008, T051): diffImages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffImages } from './chrome-util.mjs';

const img = (w, h, fill) => {
  const px = Buffer.alloc(w * h * 3, fill);
  return { w, h, bpp: 3, px };
};

test('hai ảnh giống nhau: 0 % khác', () => {
  const r = diffImages(img(10, 10, 255), img(10, 10, 255));
  assert.equal(r.differing, 0);
  assert.equal(r.counted, 100);
});

test('lệch kênh > ngưỡng mới tính; <= ngưỡng thì không', () => {
  const a = img(10, 10, 255);
  const b = img(10, 10, 255);
  b.px[0] = 255 - 64; // lệch đúng 64: không tính ở ngưỡng 64
  b.px[3] = 255 - 65; // lệch 65: tính
  const r = diffImages(a, b, [], 64);
  assert.equal(r.differing, 1);
  assert.equal(diffImages(a, b, [], 0).differing, 2);
});

test('vùng khai báo khác biệt không tính vào mẫu số lẫn tử số', () => {
  const a = img(10, 10, 255);
  const b = img(10, 10, 0);
  const r = diffImages(a, b, [[0, 0, 5, 10]], 64);
  assert.equal(r.counted, 50);
  assert.equal(r.differing, 50);
  assert.equal(r.pct, 100);
});

test('khác cỡ thì ném lỗi', () => {
  assert.throws(() => diffImages(img(2, 2, 0), img(3, 3, 0)));
});
