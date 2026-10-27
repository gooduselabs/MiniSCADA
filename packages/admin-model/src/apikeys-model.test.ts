// Mô hình tab API key (feature 025): IP/CIDR như máy chủ nhận, kiểm form, khi nào cần xác nhận mật khẩu, ngày hạn.
import { describe, expect, it } from 'vitest';
import {
  canWrite,
  curlExample,
  dateFromExpiry,
  draftProblem,
  emptyDraft,
  expiryFromDate,
  needsReauth,
  splitAllowFrom,
  validIpNet,
} from './apikeys-model.ts';

const NOW = Date.parse('2026-10-25T00:00:00Z');

describe('apikeys-model', () => {
  it('địa chỉ và mạng IPv4/IPv6 như máy chủ nhận', () => {
    for (const ok of [
      '192.0.2.7',
      '192.0.2.0/24',
      '0.0.0.0/0',
      '2001:db8::/32',
      '2001:db8::1',
      '::1',
      '::ffff:192.0.2.1',
      'fe80:0:0:0:0:0:0:1/128',
    ])
      expect(validIpNet(ok), ok).toBe(true);
    for (const bad of [
      '',
      '192.0.2',
      '192.0.2.0/33',
      '192.0.2.0/',
      '192.0.2.256',
      '2001:db8::/129',
      '2001:db8:::1',
      'host.example.com',
      '192.0.2.0/24/1',
      '1:2:3:4:5:6:7:8:9',
    ])
      expect(validIpNet(bad), bad).toBe(false);
  });

  it('tách danh sách nguồn, bỏ trùng', () => {
    expect(splitAllowFrom(' 192.0.2.0/24,\n198.51.100.7  192.0.2.0/24;')).toEqual([
      '192.0.2.0/24',
      '198.51.100.7',
    ]);
    expect(splitAllowFrom('')).toEqual([]);
  });

  it('kiểm form: tên, nguồn, giới hạn, hạn', () => {
    const d = { ...emptyDraft(), name: 'ERP kho' };
    expect(draftProblem(d, NOW)).toBeNull();
    expect(draftProblem({ ...d, name: '  ' }, NOW)).toEqual({ field: 'name' });
    expect(draftProblem({ ...d, name: 'x'.repeat(65) }, NOW)).toEqual({ field: 'name' });
    expect(draftProblem({ ...d, allowFrom: ['192.0.2.0/99'] }, NOW)).toEqual({
      field: 'allowFrom',
      value: '192.0.2.0/99',
    });
    expect(draftProblem({ ...d, allowFrom: Array(17).fill('192.0.2.1') }, NOW)).toEqual({
      field: 'allowFromCount',
    });
    expect(draftProblem({ ...d, ratePerMin: 9 }, NOW)).toEqual({ field: 'rate' });
    expect(draftProblem({ ...d, ratePerMin: 6001 }, NOW)).toEqual({ field: 'rate' });
    expect(draftProblem({ ...d, expiresAt: '2026-10-24T00:00:00Z' }, NOW)).toEqual({
      field: 'expires',
    });
    expect(draftProblem({ ...d, expiresAt: '2027-01-01T00:00:00Z' }, NOW)).toBeNull();
  });

  it('xác nhận mật khẩu chỉ khi key thành ghi được', () => {
    const ro = { role: 'operator' as const, readOnly: true };
    const rw = { role: 'operator' as const, readOnly: false };
    expect(canWrite(rw)).toBe(true);
    expect(canWrite({ role: 'viewer', readOnly: false })).toBe(false);
    expect(needsReauth(rw)).toBe(true);
    expect(needsReauth(ro)).toBe(false);
    expect(needsReauth(rw, ro)).toBe(true);
    expect(needsReauth(rw, rw)).toBe(false);
    expect(needsReauth(ro, rw)).toBe(false);
  });

  it('ngày hạn: cuối ngày địa phương, đi và về', () => {
    expect(expiryFromDate('')).toBeNull();
    const iso = expiryFromDate('2026-12-31')!;
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(dateFromExpiry(iso)).toBe('2026-12-31');
    expect(dateFromExpiry(null)).toBe('');
  });

  it('ví dụ curl', () => {
    expect(curlExample('https://192.0.2.10:8443')).toBe(
      'curl --cacert device.crt -H "Authorization: Bearer matk_…" https://192.0.2.10:8443/api/v1/data/values',
    );
  });
});
