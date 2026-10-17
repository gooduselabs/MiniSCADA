// T052 (feature 011, FR-013; device-api-011 §1): thiết bị trả 421 HOST_NOT_ALLOWED khi được gọi bằng tên chưa khai
// trong allowedHosts; Studio nói cách xử lý thay vì chỉ "lỗi HTTP 421".
import { describe, expect, it } from 'vitest';
import { errorText } from './diagnostics.ts';

describe('errorText: 421', () => {
  it('421: hướng dẫn mở bằng IP hoặc thêm tên vào allowedHosts', () => {
    const s = errorText('http', '421');
    expect(s).toContain('421');
    expect(s).toContain('allowedHosts');
    expect(s).toContain('IP');
  });
  it('mã HTTP khác giữ câu cũ', () => {
    expect(errorText('http', '500')).toContain('500');
    expect(errorText('http', '500')).not.toContain('allowedHosts');
  });
});
