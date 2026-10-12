// Thiết bị gắn với project (feature 005, T085a, FR-031): `id` của thiết bị đã lưu, giữ trong thiết lập cục bộ
// của Studio (localStorage, như bố cục của 004), khóa theo thư mục project; không ghi vào file project.
import { describe, expect, it } from 'vitest';
import { BINDINGS_KEY, DeviceBindings, MAX_BINDINGS, projectKey } from './device-binding.ts';
import type { StorageLike } from './workspace.ts';

const ID1 = '4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10';
const ID2 = '7d3e9b21-5a4c-4f8e-b1d2-3c6a9e0f7b52';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

describe('thiết bị gắn với project', () => {
  it('khóa theo thư mục project: không phân biệt hoa thường, dấu gạch, gạch cuối, khoảng trắng hai đầu (Windows)', () => {
    const k = projectKey('D:\\Projects\\tank-demo');
    expect(projectKey('d:/projects/TANK-DEMO/')).toBe(k);
    expect(projectKey('  D:\\Projects\\tank-demo\\\\ ')).toBe(k);
    expect(projectKey('D:\\Projects\\tank-demo2')).not.toBe(k);
  });

  it('gắn, đọc, gỡ theo project; project khác không bị ảnh hưởng', () => {
    const b = new DeviceBindings(memory());
    expect(b.get('D:\\P\\a')).toBeNull();
    b.set('D:\\P\\a', ID1);
    b.set('D:\\P\\b', ID2);
    expect(b.get('d:/p/a/')).toBe(ID1);
    expect(b.get('D:\\P\\b')).toBe(ID2);
    b.set('D:\\P\\a', ID2);
    expect(b.get('D:\\P\\a')).toBe(ID2);
    b.set('D:\\P\\a', null);
    expect(b.get('D:\\P\\a')).toBeNull();
    expect(b.get('D:\\P\\b')).toBe(ID2);
  });

  it('lưu trong thiết lập cục bộ (một khóa), lần mở Studio sau đọc lại; chỉ có thư mục và id thiết bị', () => {
    const s = memory();
    new DeviceBindings(s).set('D:\\Projects\\tank-demo', ID1);
    expect([...s.data.keys()]).toEqual([BINDINGS_KEY]);
    expect(JSON.parse(s.data.get(BINDINGS_KEY)!)).toEqual([
      [projectKey('D:\\Projects\\tank-demo'), ID1],
    ]);
    expect(new DeviceBindings(s).get('D:\\Projects\\tank-demo')).toBe(ID1);
  });

  it(`mới nhất trước, tối đa ${MAX_BINDINGS} project: project cũ nhất bị bỏ; gắn lại thì lên đầu`, () => {
    const s = memory();
    const b = new DeviceBindings(s);
    for (let i = 0; i <= MAX_BINDINGS; i++) b.set(`D:\\P\\${i}`, uuid(i));
    const saved = JSON.parse(s.data.get(BINDINGS_KEY)!) as Array<[string, string]>;
    expect(saved).toHaveLength(MAX_BINDINGS);
    expect(saved[0]).toEqual([projectKey(`D:\\P\\${MAX_BINDINGS}`), uuid(MAX_BINDINGS)]);
    expect(new DeviceBindings(s).get('D:\\P\\0')).toBeNull();
    b.set('D:\\P\\1', uuid(1));
    expect((JSON.parse(s.data.get(BINDINGS_KEY)!) as Array<[string, string]>)[0][1]).toBe(uuid(1));
  });

  it('dữ liệu hỏng hoặc lạ trong thiết lập cục bộ: bỏ qua mục sai, không lỗi; lần ghi sau ghi lại sạch', () => {
    for (const bad of ['không phải JSON', '{}', '"x"', '[1,2]', '[["a"]]', '[["", "x"]]']) {
      const s = memory();
      s.data.set(BINDINGS_KEY, bad);
      expect(new DeviceBindings(s).get('a'), bad).toBeNull();
    }
    const s = memory();
    s.data.set(
      BINDINGS_KEY,
      JSON.stringify([
        [projectKey('D:\\A'), 'không-phải-uuid'],
        [projectKey('D:\\B'), ID2],
        [42, ID1],
      ]),
    );
    const b = new DeviceBindings(s);
    expect(b.get('D:\\A')).toBeNull();
    expect(b.get('D:\\B')).toBe(ID2);
    b.set('D:\\C', ID1);
    expect(JSON.parse(s.data.get(BINDINGS_KEY)!)).toEqual([
      [projectKey('D:\\C'), ID1],
      [projectKey('D:\\B'), ID2],
    ]);
    // `id` không phải UUID của thiết bị đã lưu: không gắn.
    b.set('D:\\D', 'abc');
    expect(b.get('D:\\D')).toBeNull();
  });

  it('không có thiết lập cục bộ (null, hoặc bị chặn): vẫn gắn được trong phiên này, không lỗi', () => {
    const none = new DeviceBindings(null);
    none.set('D:\\A', ID1);
    expect(none.get('D:\\A')).toBe(ID1);
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const b = new DeviceBindings(blocked);
    expect(b.get('D:\\A')).toBeNull();
    b.set('D:\\A', ID1);
    expect(b.get('D:\\A')).toBe(ID1);
  });
});
