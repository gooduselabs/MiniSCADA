// Che địa chỉ kết nối (chuyển từ logging-view.test.ts của 004): tài khoản, mật khẩu, chuỗi truy vấn và fragment không bao giờ hiện lại.
import { describe, expect, it } from 'vitest';
import { maskAddress } from './address-mask.ts';

describe('maskAddress', () => {
  it('che tài khoản, mật khẩu và chuỗi truy vấn của địa chỉ', () => {
    expect(maskAddress('https://admin:S3cret@influx.local:8086')).toBe(
      'https://•••@influx.local:8086',
    );
    expect(maskAddress('http://u@10.0.0.7:8086/x')).toBe('http://•••@10.0.0.7:8086/x');
    expect(maskAddress('https://a:p/w@h')).toBe('https://•••@h');
    expect(maskAddress('http://10.0.0.7:8086?token=abc')).toBe('http://10.0.0.7:8086?•••');
    expect(maskAddress('http://h#tok')).toBe('http://h#•••');
    expect(maskAddress('db:pw@10.0.0.5')).toBe('•••@10.0.0.5');
    expect(maskAddress('u:a://b@h')).toBe('•••@h');
    expect(maskAddress('https://u:p?x@h')).toBe('https://•••');
    expect(maskAddress('https://influx.local:8086')).toBe('https://influx.local:8086');
    expect(maskAddress('10.0.0.5')).toBe('10.0.0.5');
  });
});
