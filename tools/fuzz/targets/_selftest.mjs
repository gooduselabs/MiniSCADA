// Mục tiêu giả cho tools/fuzz/ts-fuzz.test.mjs: kiểm bộ canh của ts-fuzz.mjs. Ca 3 treo (vòng lặp bận), ca 5 ném
// lỗi, ca 7 vi phạm bất biến; ca khác đạt.
export async function setup() {
  return {};
}

export function generate(_ctx, r, c) {
  return { c, x: r() };
}

export function check(_ctx, input) {
  if (input.c === 3) while (input.x >= 0);
  if (input.c === 5) throw new TypeError('ném thử');
  return { problems: input.c === 7 ? ['bất biến thử'] : [], counters: ['ok'] };
}
