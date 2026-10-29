// Câu tiếng Việt cho lỗi E_SCHEMA (sửa lỗi 039).
import { describe, expect, it } from 'vitest';
import { issueText, schemaText } from './code-text.ts';

describe('schemaText', () => {
  it('danh sách rỗng, trường lạ, thiếu trường: câu tiếng Việt kèm tên trường', () => {
    expect(schemaText('Array has too few items (0 < 1).', '/groups')).toBe(
      '"groups" đang trống: cần ít nhất 1 mục.',
    );
    expect(schemaText('Array has too few items (0 < 1).', '/groups/0/tags')).toContain('"tags"');
    expect(
      schemaText('Property "groups" does not match additional properties schema.', ''),
    ).toContain('"groups"');
    expect(schemaText('Instance does not have required property "id".', '/groups/0')).toContain(
      '"id"',
    );
  });
  it('issueText dùng schemaText cho E_SCHEMA, không còn câu tiếng Anh thô', () => {
    const s = issueText({
      code: 'E_SCHEMA',
      message: 'Array has too few items (0 < 1).',
      path: '/groups',
    });
    expect(s).not.toMatch(/too few/);
  });
});
