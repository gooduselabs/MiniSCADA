import { describe, expect, it } from 'vitest';
import { defaultEmailConfig, parseEmailSettings } from './api.ts';
import { emailConfigProblem, newRule, nextRuleId, splitList } from './email-model.ts';
import { userEditPlan, validEmail } from './model.ts';

describe('email-model (feature 023)', () => {
  it('splitList tách dấu phẩy, chấm phẩy, khoảng trắng và bỏ trùng', () => {
    expect(splitList(' a@example.com, b@example.com;a@example.com\n c ')).toEqual([
      'a@example.com',
      'b@example.com',
      'c',
    ]);
    expect(splitList('')).toEqual([]);
  });

  it('mã quy tắc mới không trùng', () => {
    const r1 = newRule([]);
    expect(r1.id).toBe('r1');
    expect(nextRuleId([r1, { ...r1, id: 'r3' }])).toBe('r2');
  });

  it('kiểm trước khi gửi: máy chủ, địa chỉ, người nhận', () => {
    const c = defaultEmailConfig();
    expect(emailConfigProblem(c)).toBeNull();
    c.enabled = true;
    expect(emailConfigProblem(c)).toMatch(/máy chủ SMTP/);
    c.smtp.host = 'smtp.example.com';
    c.smtp.from = 'scada@example.com';
    c.rules = [newRule([])];
    expect(emailConfigProblem(c)).toMatch(/Quy tắc 1/);
    c.rules[0]!.to = ['khong-hop-le'];
    expect(emailConfigProblem(c)).toMatch(/khong-hop-le/);
    c.rules[0]!.to = ['truc@example.com'];
    expect(emailConfigProblem(c)).toBeNull();
  });

  it('validEmail giống máy chủ', () => {
    expect(validEmail('a@example.com')).toBe(true);
    for (const bad of [
      'a@b',
      'a b@example.com',
      'á@example.com',
      'a@@example.com',
      'a<b>@example.com',
    ])
      expect(validEmail(bad)).toBe(false);
  });

  it('parseEmailSettings chịu được thiếu trường và không có mật khẩu', () => {
    const s = parseEmailSettings({
      rev: 3,
      passwordSet: true,
      config: { enabled: true, smtp: { host: 'smtp.example.com', security: 'smtps', port: 465 } },
      status: { queue: { count: 2 }, lastError: { message: 'x', at: 1 } },
      groups: [{ id: 'ca', members: 3, withEmail: 1 }],
    });
    expect(s.rev).toBe(3);
    expect(s.config.smtp.security).toBe('smtps');
    expect(s.config.quietHours.from).toBe('22:00');
    expect(s.status.queue.count).toBe(2);
    expect(s.status.lastError?.message).toBe('x');
    expect(s.groups[0]).toEqual({ id: 'ca', name: 'ca', members: 3, withEmail: 1 });
    expect(JSON.stringify(s)).not.toMatch(/password"/);
  });

  it('userEditPlan: đổi email không cần xác nhận lại, rỗng là xóa', () => {
    const u = {
      name: 'vh1',
      role: 'operator' as const,
      groups: [],
      enabled: true,
      locked: null,
      lastLoginAt: null,
      createdAt: null,
      updatedAt: null,
      sessions: 0,
      email: 'old@example.com',
    };
    const base = { role: 'operator' as const, groups: [], enabled: true };
    expect(userEditPlan(u, { ...base, email: 'old@example.com' }).empty).toBe(true);
    const p = userEditPlan(u, { ...base, email: ' new@example.com ' });
    expect(p.body).toEqual({ email: 'new@example.com' });
    expect(p.reauth).toBe(false);
    expect(userEditPlan(u, { ...base, email: '' }).body).toEqual({ email: null });
  });
});
