// 036: dòng lỗi bố cục lưới ở tab Thông tin là thông điệp tiếng Việt có tên màn hình, không phải mã thô.
import { describe, expect, it } from 'vitest';
import type { StudioApp } from '../app/app.ts';
import { issueText } from './issue-text.ts';

const app = {
  store: { state: { outline: { screens: [{ id: 'tong-quan', model: { name: 'Tổng quan' } }] } } },
} as unknown as StudioApp;
const issue = (code: string, path: string, message = 'raw') =>
  ({ code, file: 'screens/tong-quan.screen.json', path, message }) as never;

describe('issueText', () => {
  it('E_LAYOUT_LIMIT: quá số hàng và hàng sai số ô', () => {
    expect(issueText(app, issue('E_LAYOUT_LIMIT', '/layout/rows'))).toBe(
      "Màn hình 'Tổng quan' vượt giới hạn 100 hàng: xóa bớt hàng.",
    );
    expect(issueText(app, issue('E_LAYOUT_LIMIT', '/layout/rows/2/cells'))).toContain(
      "Màn hình 'Tổng quan', hàng 3: một hàng cần từ 1 đến 12 ô",
    );
  });
  it('E_LAYOUT_SPAN có hàng và ô; mã khác giữ thông điệp gốc', () => {
    expect(issueText(app, issue('E_LAYOUT_SPAN', '/layout/rows/0/cells/1/span'))).toContain(
      'hàng 1, ô 2',
    );
    expect(issueText(app, issue('E_TAG_X', '/x', 'gốc'))).toBe('gốc');
  });
});
