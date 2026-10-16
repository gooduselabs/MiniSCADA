// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mountScreen, type ScreenLayout } from './mount.ts';

const DEMO = resolve(__dirname, '../../../projects/tank-demo/screens');
const svgText = readFileSync(resolve(DEMO, 'tank-motor.svg'), 'utf8');
const screen = JSON.parse(readFileSync(resolve(DEMO, 'tank-motor.screen.json'), 'utf8'));
const layout = (over: Partial<ScreenLayout>): ScreenLayout => ({
  viewBox: [0, 0, 10, 10],
  fitMode: 'contain',
  elements: [{ elementUid: 'el_aaa' }],
  ...over,
});

describe('mountScreen', () => {
  it('dựng SVG trong Shadow DOM và lập bản đồ elementUid', () => {
    const host = document.createElement('div');
    const m = mountScreen(host, svgText, screen);
    expect(host.shadowRoot).toBe(m.root);
    expect(m.root.querySelector('svg')).toBe(m.svg);
    expect(document.querySelector('svg')).toBeNull(); // không lọt ra DOM của trang
    expect([...m.elements.keys()].sort()).toEqual(
      screen.elements.map((e: { elementUid: string }) => e.elementUid).sort(),
    );
    expect(m.missingUids).toEqual([]);
    expect(m.svg.getAttribute('viewBox')).toBe('0 0 1280 720');
    expect(m.svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(m.svg.hasAttribute('width')).toBe(false);
  });

  it('lọc SVG trước khi chèn và báo UID khai báo nhưng thiếu trong SVG', () => {
    const host = document.createElement('div');
    const bad =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script>' +
      '<rect data-mat-uid="el_aaa" onclick="x()"/></svg>';
    const m = mountScreen(
      host,
      bad,
      layout({
        fitMode: 'stretch',
        elements: [{ elementUid: 'el_aaa' }, { elementUid: 'el_zzz' }],
      }),
    );
    expect(m.root.querySelector('script')).toBeNull();
    expect(m.elements.get('el_aaa')!.hasAttribute('onclick')).toBe(false);
    expect(m.missingUids).toEqual(['el_zzz']);
    expect(m.svg.getAttribute('preserveAspectRatio')).toBe('none');
    expect(m.report.removedElements.script).toBe(1);
  });

  it('chỉ nhận phần tử đã khai báo trong screen (UID lạ trong SVG bị bỏ qua)', () => {
    const host = document.createElement('div');
    const m = mountScreen(
      host,
      '<svg xmlns="http://www.w3.org/2000/svg"><rect data-mat-uid="el_aaa"/><rect data-mat-uid="el_bbb"/></svg>',
      layout({ fitMode: 'cover' }),
    );
    expect([...m.elements.keys()]).toEqual(['el_aaa']);
    expect(m.svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
  });

  it('hai màn hình cùng id/class không ảnh hưởng nhau; unmount xóa sạch', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    const doc = (color: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg"><rect id="same" fill="${color}" data-mat-uid="el_aaa"/></svg>`;
    const ma = mountScreen(a, doc('red'), layout({}));
    const mb = mountScreen(b, doc('blue'), layout({}));
    expect(ma.root.getElementById('same')).toBe(ma.elements.get('el_aaa'));
    expect(mb.root.getElementById('same')).toBe(mb.elements.get('el_aaa'));
    expect(ma.root.querySelector('#same')!.getAttribute('fill')).toBe('red');
    expect(mb.root.querySelector('#same')!.getAttribute('fill')).toBe('blue');
    ma.unmount();
    expect(ma.root.childNodes.length).toBe(0);
    expect(mb.root.querySelector('svg')).not.toBeNull();
    a.remove();
    b.remove();
  });

  it('ném lỗi rõ ràng khi SVG hỏng', () => {
    const host = document.createElement('div');
    expect(() => mountScreen(host, '<svg', layout({}))).toThrow();
  });

  // T112 (rà soát bảo mật): gói bị sửa tay vẫn có thể mang bom `use` (10 tầng x 10 = 10^10 phần tử); bản m17 làm tab Chrome
  // treo mãi. Trang tự chặn ở mountScreen, không dựa vào bộ nhập.
  const bomb = (levels: number, fan: number): string => {
    let defs = '<g id="l0"><rect width="1" height="1"/></g>';
    for (let i = 1; i <= levels; i++)
      defs += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(fan)}</g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs>${defs}</defs><use href="#l${levels}"/></svg>`;
  };

  it('từ chối bom use (10 tầng x 10) thay vì dựng', () => {
    const host = document.createElement('div');
    expect(() => mountScreen(host, bomb(9, 10), layout({}))).toThrow(/use/);
    expect(host.shadowRoot).toBeNull();
  });

  it('use hợp lệ nhiều tầng nhưng dưới ngưỡng vẫn dựng được', () => {
    const host = document.createElement('div');
    const m = mountScreen(host, bomb(3, 10), layout({}));
    expect(m.root.querySelectorAll('use').length).toBe(31);
  });

  it('vòng tham chiếu use không treo và không bị coi là bom', () => {
    const host = document.createElement('div');
    const cyc =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="a"><use href="#a"/></g><use href="#a"/></svg>';
    expect(() => mountScreen(host, cyc, layout({}))).not.toThrow();
  });
});
