// Feature 037 vòng 2: Đèn báo (lamp) gộp vào Nhãn đa trạng thái kiểu đèn. Sau khi Studio đổi item bằng
// upgradeLegacyItem, multi-state phải hiện cùng chữ và cùng trạng thái sáng/tắt như lamp cũ ở mọi tình huống.
import { upgradeLegacyItem, type WidgetItem } from '@mat/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem } from './test-util.ts';

afterEach(cleanup);

type P = Record<string, string | number | boolean>;
const cases: Array<[string, string, unknown, P, Record<string, unknown>?]> = [
  ['BOOL bật', 'BOOL', true, {}],
  ['BOOL tắt', 'BOOL', false, {}],
  ['BOOL đảo', 'BOOL', true, { invert: true }],
  ['số khác 0', 'UINT16', 3, {}],
  ['số 0', 'UINT16', 0, {}],
  ['bảng giá trị', 'UINT16', 2, {}, { valueTable: 'st' }],
  ['bỏ bảng', 'UINT16', 2, { useValueTable: false }, { valueTable: 'st' }],
  ['vuông, không chữ', 'BOOL', true, { shape: 'square', showText: false }],
];
const tables = {
  st: {
    entries: [
      { value: 0, text: 'Dừng', color: '#777777' },
      { value: 2, text: 'Sự cố', color: '#c42b2b' },
    ],
  },
};

describe('lamp → multi-state (shape lamp): cùng hiển thị', () => {
  for (const [name, type, value, props, extra] of cases) {
    it(name, async () => {
      const src = makeSource([tagInfo('t', { type, ...(extra ?? {}) } as never)], tables);
      src.set('t', { value: value as never, quality: 'GOOD' });
      const lamp = widgetItem('lamp', { state: 't' }, { label: 'Đèn', ...props });
      const ms = upgradeLegacyItem(lamp) as WidgetItem;
      expect(ms.widget).toBe('multi-state');
      const a = await mount(lamp, src);
      const b = await mount(ms, src);
      expect(textOf(b, '.state-text')).toBe(textOf(a, '.state-text'));
      expect(textOf(b, '.label')).toBe('Đèn');
      const dotA = a.shadowRoot!.querySelector('.dot')!.classList;
      const dotB = b.shadowRoot!.querySelector('.dot')!.classList;
      for (const k of ['on', 'off', 'square']) expect(dotB.contains(k), k).toBe(dotA.contains(k));
    });
  }
});
