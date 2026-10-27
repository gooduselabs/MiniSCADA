// Phần thuần của tab "Thông báo email" (feature 023): tách danh sách nhập tay, kiểm trước khi gửi (máy chủ vẫn kiểm
// chặt lại), quy tắc mới mặc định, mã quy tắc không trùng.
import { adminText } from './text.ts';
import type { EmailConfig, EmailRule } from './api.ts';
import { validEmail } from './model.ts';

/** "a, b;c\n d" → ['a', 'b', 'c', 'd'], bỏ rỗng và trùng. */
export function splitList(s: string): string[] {
  const out: string[] = [];
  for (const p of s.split(/[,;\s]+/)) {
    const t = p.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Mã quy tắc mới chưa dùng: r1, r2, … */
export function nextRuleId(rules: readonly EmailRule[]): string {
  for (let i = 1; ; i++) {
    const id = `r${i}`;
    if (!rules.some((r) => r.id === id)) return id;
  }
}

export function newRule(rules: readonly EmailRule[]): EmailRule {
  return {
    id: nextRuleId(rules),
    name: '',
    enabled: true,
    priorities: [1, 2],
    classes: [],
    areas: [],
    events: ['active'],
    reminderMin: 30,
    to: [],
    groups: [],
  };
}

/** Lỗi đầu tiên (tiếng Việt) hoặc null. */
export function emailConfigProblem(c: EmailConfig): string | null {
  const B = adminText.emailBad;
  if (c.enabled && (!c.smtp.host.trim() || !c.smtp.from.trim())) return B.host;
  if (c.smtp.from && !validEmail(c.smtp.from)) return B.address(c.smtp.from);
  for (let i = 0; i < c.rules.length; i++) {
    const r = c.rules[i]!;
    for (const a of r.to) if (!validEmail(a)) return B.address(a);
    if (!r.to.length && !r.groups.length) return B.rule(i + 1);
  }
  return null;
}
