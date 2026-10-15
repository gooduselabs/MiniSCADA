// @vitest-environment jsdom
// T112 (rà soát bảo mật): giới hạn CÔNG VIỆC của bộ nhập, ngoài giới hạn kích thước. Hai đường bậc hai đo được trên file
// vài trăm KB: (1) nhiều luật `*{…}` x nhiều phần tử (19.000 x 19.000 = 26 giây), (2) nhập lại với hàng nghìn hình trùng
// vị trí (6.000 hình = 31 giây; 20.000 hình khoảng 6 phút). Bộ nhập phải từ chối `E_IMPORT_LIMIT` thay vì treo.
import { describe, expect, it } from 'vitest';
import { importSvg, makeSeededUid } from './index.ts';

const H = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">';

describe('giới hạn công việc của đối chiếu nhập lại', () => {
  const stack = (n: number): string =>
    `${H}${'<rect x="10" y="10" width="20" height="20"/>'.repeat(n)}</svg>`;

  it('8.000 hình trùng vị trí: E_IMPORT_LIMIT trong dưới 10 giây (trước T112: 55 giây)', () => {
    const first = importSvg(stack(8000), { uid: makeSeededUid(1) });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const t0 = Date.now();
    const r = importSvg(stack(8000), {
      uid: makeSeededUid(2),
      previous: { svg: first.svg },
    });
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_IMPORT_LIMIT');
  }, 120_000);

  it('hình trùng vị trí ít (200) vẫn đối chiếu được, không bị chạm ngưỡng', () => {
    const first = importSvg(stack(200), { uid: makeSeededUid(1) });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const r = importSvg(stack(200), { uid: makeSeededUid(2), previous: { svg: first.svg } });
    expect(r.ok).toBe(true);
  }, 60_000);
});

describe('giới hạn công việc CSS', () => {
  it('9.000 luật * x 9.000 phần tử: E_IMPORT_LIMIT trong dưới 8 giây', () => {
    let css = '';
    let body = '';
    for (let i = 0; i < 9000; i++) {
      css += `*{stroke:#${(i % 4096).toString(16).padStart(3, '0')}}\n`;
      body += `<rect x="${i % 90}" y="${i % 70}" width="5" height="5"/>`;
    }
    const t0 = Date.now();
    const r = importSvg(`${H}<style>${css}</style>${body}</svg>`, { uid: makeSeededUid(1) });
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_IMPORT_LIMIT');
  }, 30_000);

  it('file Inkscape điển hình (ít luật mỗi lớp) không bị chạm ngưỡng', () => {
    let css = '';
    let body = '';
    for (let i = 0; i < 3000; i++) {
      css += `.c${i}{fill:#${(i % 4096).toString(16).padStart(3, '0')}}\n`;
      body += `<rect class="c${i}" x="${i % 90}" y="${i % 70}" width="5" height="5"/>`;
    }
    const r = importSvg(`${H}<style>${css}</style>${body}</svg>`, { uid: makeSeededUid(1) });
    expect(r.ok).toBe(true);
  }, 30_000);
});
