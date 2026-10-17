// Hồi quy từ fuzz phía TS (feature 011, T058; FR-029; tools/fuzz/targets/project-json.mjs). Mỗi ca là đầu vào đã rút
// gọn từ một phát hiện của bản chạy dài.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, substituteParams, validateProject } from './index.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors');

function filesOf(name: string): Record<string, string> {
  const root = join(DIR, name);
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(root);
  delete out['expected.json'];
  return out;
}

/** Một project mỗi định dạng (0.1 đến 1.0). */
const BASES = [
  'valid-minimal',
  'v02-valid-full',
  'v03-valid-access-setpoint-internal',
  'v04-valid-blink-discrete',
  'v05-bad-alarmfile-missing',
  'v06-valid-full',
  'v10-valid-full',
];
/** Tên khóa của Object.prototype khớp mẫu id màn hình. */
const PROTO_NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'];

describe('fuzz project-json: id màn hình trùng tên khóa của Object.prototype', () => {
  // Phát hiện: seed 20261017 ca 42167 (v05-bad-alarmfile-missing, entryScreen "constructor"): validateProject ném
  // TypeError ở runRules03 (`screens[id]` của đối tượng thường trả Object.prototype.constructor).
  for (const base of BASES)
    for (const name of PROTO_NAMES)
      it(`${base}: entryScreen '${name}' và screens có '${name}': không ném, không hợp lệ`, async () => {
        const files = filesOf(base);
        const p = JSON.parse(files['project.json']!.replace(/^\uFEFF/, ''));
        for (const variant of ['entry', 'list'] as const) {
          const q = structuredClone(p);
          q.entryScreen = name;
          if (variant === 'list' && Array.isArray(q.screens)) q.screens = [...q.screens, name];
          const res = await validateProject(
            new MemorySource({ ...files, 'project.json': JSON.stringify(q, null, 2) }),
          );
          expect(res.valid, `${variant}`).toBe(false);
          expect(res.errors.length).toBeGreaterThan(0);
        }
      });
});

describe('fuzz params: khóa "__proto__" riêng của item (JSON.parse)', () => {
  // Phát hiện: seed 20261017 ca 19273091, 53343922 (9 ca / 129 triệu): item có khóa riêng "__proto__" (JSON.parse
  // tạo khóa riêng) và có chỗ cần thay; bản sao dựng bằng `out[k] = y` nên "__proto__" thành prototype của bản sao
  // thay vì khóa: khóa biến mất, giá trị của nó được thừa kế (không qua bước kiểm từng khóa).
  const params = [{ name: 'p', kind: 'tagPrefix' as const }];
  it('khóa "__proto__" giữ là khóa riêng, được thay như khóa khác; prototype không đổi', () => {
    const item = JSON.parse(
      '{"id":"w","type":"widget","widget":"card","tags":{"__proto__":"{p}.RUN","value":"{p}.FLOW"}}',
    );
    const r = substituteParams(item, params, { p: 'PUMP01' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tags = (r.value as { tags: Record<string, unknown> }).tags;
    expect(Object.getPrototypeOf(tags)).toBe(Object.prototype);
    expect(Object.keys(tags)).toEqual(['__proto__', 'value']);
    expect(Object.getOwnPropertyDescriptor(tags, '__proto__')?.value).toBe('PUMP01.RUN');
    expect(tags.value).toBe('PUMP01.FLOW');
  });

  it('khóa "__proto__" là đối tượng: không thành prototype của bản sao', () => {
    const item = JSON.parse(
      '{"id":"w","type":"widget","widget":"card","props":{"label":"{p}"},"__proto__":{"evil":"x"}}',
    );
    const r = substituteParams(item, [{ name: 'p', kind: 'string' }], { p: 'A' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect('evil' in v).toBe(false);
    expect(Object.keys(v)).toContain('__proto__');
  });
});
