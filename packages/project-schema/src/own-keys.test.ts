import { describe, expect, it } from 'vitest';
import { canonicalItem } from './format-03.ts';

// Khóa `__proto__` là thuộc tính riêng khi đến từ JSON.parse: chép bằng `out[k] = v` sẽ đổi prototype
// và làm mất khóa khi định dạng lại (fuzz T058, cùng loại rà soát T062 F8). Luật project báo khóa lạ;
// bộ định dạng không được nuốt nó.
describe('định dạng giữ khóa __proto__ là dữ liệu', () => {
  it('props lạ của widget', () => {
    const item = JSON.parse(
      '{"type":"widget","id":"w1","widget":"no-such-widget","x":0,"y":0,"w":10,"h":10,' +
        '"props":{"__proto__":{"polluted":true},"a":1}}',
    ) as Record<string, unknown>;
    const out = canonicalItem(item);
    const props = out.props as Record<string, unknown>;
    expect(Object.hasOwn(props, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(props)).toBe(Object.prototype);
    expect((props as { polluted?: unknown }).polluted).toBeUndefined();
  });
  it('khóa lạ ở mức item', () => {
    const item = JSON.parse(
      '{"type":"widget","id":"w1","widget":"no-such-widget","x":0,"y":0,"w":10,"h":10,' +
        '"__proto__":{"polluted":true}}',
    ) as Record<string, unknown>;
    const out = canonicalItem(item);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect((out as { polluted?: unknown }).polluted).toBeUndefined();
  });
});
