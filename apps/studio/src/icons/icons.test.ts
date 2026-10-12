// Sprite icon của Studio (feature 004, T039, research R4): icon Fluent nạp lúc build, thêm vài ký hiệu
// công nghiệp tự vẽ. Sprite nằm trong document; thành phần Studio render ở light DOM nên <use href="#i-…">
// tham chiếu được.
import { describe, expect, it } from 'vitest';
import { ICON_NAMES, buildSprite, iconHref, type IconName } from './icons.ts';

// Icon khung Studio cần (theo mockup bản 1).
const REQUIRED: IconName[] = [
  'save',
  'undo',
  'redo',
  'check',
  'download',
  'upload',
  'compare',
  'online',
  'offline',
  'play',
  'search',
  'project',
  'home',
  'gear',
  'device',
  'connection',
  'tag',
  'table',
  'fx',
  'list',
  'bell',
  'db',
  'screen',
  'report',
  'users',
  'library',
  'chev-r',
  'chev-d',
  'x',
  'plus',
  'minus',
  'paste',
  'filldown',
  'import',
  'export',
  'ok',
  'warn',
  'err',
  'info',
  'zoomin',
  'zoomout',
  'fit',
  'grid',
  'snap',
  'sun',
  'moon',
  'contrast',
  'toolbox',
  'pulse',
  'lamp',
  'gauge',
  'card',
  'button',
  'switch',
  'input',
  'slider',
  'line',
  'bar',
  'pie',
  'lock',
  'ext',
  'refresh',
  'link',
  'menu',
  'sidebar',
  'shield',
  'restore',
  'text',
  'group',
  'shape',
  'eye',
  'collapse',
  'pump',
  'valve',
  'tank',
  'motor',
  'pipe',
];

const ALLOWED = new Set([
  'svg',
  'symbol',
  'path',
  'circle',
  'rect',
  'g',
  'line',
  'polyline',
  'polygon',
  'ellipse',
]);

describe('sprite icon', () => {
  const sprite = buildSprite(document);

  it('có đủ icon khung Studio cần', () => {
    expect(ICON_NAMES).toEqual(expect.arrayContaining(REQUIRED));
  });

  it('mỗi icon là một <symbol id="i-…"> có viewBox và có hình', () => {
    for (const name of ICON_NAMES) {
      const sym = sprite.querySelector(`symbol[id="i-${name}"]`);
      expect(sym, name).not.toBeNull();
      expect(sym!.getAttribute('viewBox'), name).toMatch(/^0 0 (16|20) (16|20)$/);
      expect(sym!.children.length, name).toBeGreaterThan(0);
    }
    expect(iconHref('save')).toBe('#i-save');
  });

  it('chỉ có phần tử hình học, không script, không thuộc tính sự kiện hay liên kết ngoài', () => {
    for (const el of [sprite, ...sprite.querySelectorAll('*')]) {
      expect(ALLOWED.has(el.localName), el.localName).toBe(true);
      for (const a of el.attributes) {
        expect(a.name.startsWith('on'), `${el.localName}[${a.name}]`).toBe(false);
        expect(/href/i.test(a.name), `${el.localName}[${a.name}]`).toBe(false);
      }
    }
  });

  it('sprite ẩn, không chiếm chỗ, không đọc bởi trình đọc màn hình', () => {
    expect(sprite.getAttribute('aria-hidden')).toBe('true');
    expect(sprite.getAttribute('width')).toBe('0');
    expect(sprite.getAttribute('height')).toBe('0');
  });

  it('ký hiệu tự vẽ dùng nét (stroke), không bị tô kín bởi fill: currentColor của icon Fluent', () => {
    for (const name of ['pump', 'valve', 'tank', 'motor', 'pipe'] as IconName[]) {
      const sym = sprite.querySelector(`symbol[id="i-${name}"]`)!;
      for (const el of sym.querySelectorAll('*')) {
        if (el.localName === 'g') continue;
        expect(el.getAttribute('fill') ?? el.closest('g')?.getAttribute('fill'), name).toBe('none');
      }
    }
  });
});
