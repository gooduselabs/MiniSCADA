// Sửa lỗi 042: câu lỗi của logging.json nêu tên bảng và cách sửa (không còn "Trường groups không hợp lệ").
import { describe, expect, it } from 'vitest';
import { loggingIssueText } from './code-text.ts';

const cfg = { groups: [{ id: 'nhom', name: 'Nhóm 1' }] };

describe('loggingIssueText', () => {
  it('bảng 0 Tag: nêu tên bảng và cách thêm Tag', () => {
    const s = loggingIssueText(
      { code: 'E_SCHEMA', path: '/groups/0/tags', message: 'Array has too few items (0 < 1).' },
      cfg,
    );
    expect(s).toContain('“Nhóm 1” chưa có Tag nào');
    expect(s).toMatch(/kéo Tag từ cây/);
  });

  it('lỗi trường con khác: tiền tố tên bảng + câu tiếng Việt', () => {
    const s = loggingIssueText(
      { code: 'E_SCHEMA', path: '/groups/0/periodMs', message: '5 is less than 100.' },
      cfg,
    );
    expect(s.startsWith('Bảng lưu trữ “Nhóm 1”: ')).toBe(true);
    expect(s).toContain('periodMs');
  });

  it('đường dẫn ngoài nhóm: câu thường', () => {
    expect(
      loggingIssueText(
        { code: 'E_SCHEMA', path: '', message: 'Array has too few items (0 < 1).' },
        cfg,
      ),
    ).not.toContain('Bảng lưu trữ');
  });
});
