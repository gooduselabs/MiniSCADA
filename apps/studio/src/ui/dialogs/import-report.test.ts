// FR-020, US1-7: bảng báo cáo nêu tên thuộc tính bị loại và vị trí ví dụ; câu tóm tắt bằng tiếng Việt.
import { describe, expect, it } from 'vitest';
import { importSvg, makeSeededUid } from '@mat/svg-import';
import { attributeSummary, reportRows } from './import-report.ts';

const NS = 'http://www.w3.org/2000/svg';
const report = (body: string) => {
  const r = importSvg(
    `<svg xmlns="${NS}" width="10" height="10" viewBox="0 0 10 10">${body}</svg>`,
    {
      fileName: 'a.svg',
      uid: makeSeededUid(1),
    },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.report;
};

describe('báo cáo nhập: thuộc tính bị loại', () => {
  it('hàng có tên thuộc tính và vị trí ví dụ (không còn chữ "thuộc tính" trơn)', () => {
    const rows = reportRows(report('<g><rect width="1" height="1" onclick="x()"/></g>'), 'removed');
    const row = rows.find((r) => r.name === 'onclick');
    expect(row).toBeDefined();
    expect(row!.where).toBe('/svg/g[1]/rect[1]');
  });

  it('câu tóm tắt nêu tên và tối đa 3 vị trí ví dụ', () => {
    const body = Array.from({ length: 5 }, () => '<rect width="1" height="1" onclick="x()"/>').join(
      '',
    );
    const s = attributeSummary(report(body));
    expect(s).toContain('onclick');
    expect(s).toContain('/svg/rect[1]');
    expect(s).toContain('/svg/rect[3]');
    expect(s).not.toContain('/svg/rect[4]');
  });

  it('không có thuộc tính bị loại: không có câu tóm tắt', () => {
    expect(attributeSummary(report('<rect width="1" height="1"/>'))).toBeNull();
  });
});
