// FR-020, US1-7: báo cáo nhập nêu TÊN thuộc tính bị loại và tối đa 3 vị trí ví dụ (đường dẫn phần tử).
import { describe, expect, it } from 'vitest';
import { importSvg, makeSeededUid } from './index.ts';
import { doc } from './test-helpers.ts';

const run = (body: string) => {
  const r = importSvg(doc(body), { fileName: 'a.svg', uid: makeSeededUid(1) });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.report;
};

describe('báo cáo nhập: tên thuộc tính bị loại và vị trí ví dụ', () => {
  it('onclick và onload có dòng riêng theo tên, kèm đường dẫn phần tử', () => {
    const rep = run(
      '<g><rect width="5" height="5" onclick="x()"/></g><g><circle r="2" onclick="y()" onload="z()"/></g>',
    );
    const rows = rep.removed.filter((x) => x.kind === 'attribute');
    const click = rows.find((x) => x.name === 'onclick');
    const load = rows.find((x) => x.name === 'onload');
    expect(click, JSON.stringify(rows)).toBeDefined();
    expect(load).toBeDefined();
    expect(click!.code).toBe('R_EVENT_ATTR');
    expect(click!.count).toBe(2);
    expect(click!.examples).toEqual(['/svg/g[1]/rect[1]', '/svg/g[2]/circle[1]']);
    expect(load!.examples).toEqual(['/svg/g[2]/circle[1]']);
    expect(rows.some((x) => x.name === 'thuộc tính')).toBe(false);
  });

  it('tối đa 3 vị trí ví dụ, số lượng vẫn đủ', () => {
    const body = Array.from({ length: 6 }, () => '<rect width="1" height="1" onclick="x()"/>').join(
      '',
    );
    const row = run(body).removed.find((x) => x.name === 'onclick')!;
    expect(row.count).toBe(6);
    expect(row.examples).toEqual(['/svg/rect[1]', '/svg/rect[2]', '/svg/rect[3]']);
  });

  it('thuộc tính ngoài danh sách có tên đúng (không phải chữ "thuộc tính")', () => {
    const rep = run(
      '<rect width="1" height="1" foo="1" inkscape:label="x" xmlns:inkscape="urn:i"/>',
    );
    const names = rep.removed.filter((x) => x.kind === 'attribute').map((x) => x.name);
    expect(names).toContain('foo');
    expect(names).not.toContain('thuộc tính');
  });
});
