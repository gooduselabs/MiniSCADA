// "Dùng ở đâu" của Tag (feature 004, T012, FR-006) trên project mẫu.
// Màn hình của project mẫu tên "Bồn nước + bơm" (mockup gọi là "Tổng quan").
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { outlineOf, type ProjectOutline } from './project-doc.ts';
import { targetLabel, whereUsed, xrefLocation, xrefText } from './xref.ts';

const DEMO = resolve(__dirname, '../../../../projects/tank-demo');
const read = (f: string) => JSON.parse(readFileSync(resolve(DEMO, f), 'utf8')) as unknown;
const demo = (): ProjectOutline =>
  outlineOf({
    'project.json': read('project.json'),
    'tags.json': read('tags.json'),
    'logging.json': read('logging.json'),
    'screens/tank-motor.screen.json': read('screens/tank-motor.screen.json'),
    'screens/tank-motor.bindings.json': read('screens/tank-motor.bindings.json'),
  });

describe('whereUsed', () => {
  it('TANK01.LEVEL: hai phần tử màn hình và hai nhóm lưu trữ', () => {
    const refs = whereUsed(demo(), 'TANK01.LEVEL');
    expect(refs.map(xrefText)).toEqual([
      'Bồn nước + bơm › Mức nước (Mức chất lỏng)',
      'Bồn nước + bơm › Chữ mức (Chữ)',
      'Lưu trữ › Vận hành',
      'Lưu trữ › Báo cáo ca',
    ]);
    expect(refs[0]).toEqual({
      kind: 'binding',
      screen: 'tank-motor',
      screenName: 'Bồn nước + bơm',
      element: 'el_tank_level',
      elementName: 'Mức nước',
      target: 'geometry.levelPercent',
      bindingId: 'level',
    });
    expect(refs[2]).toEqual({
      kind: 'logging',
      group: 0,
      groupId: 'van-hanh',
      groupName: 'Vận hành',
    });
  });

  it('MOTOR01.RUN: ba binding, hai nhóm', () => {
    expect(whereUsed(demo(), 'MOTOR01.RUN').map(xrefText)).toEqual([
      'Bồn nước + bơm › Vỏ bồn (Màu viền)',
      'Bồn nước + bơm › Thân bơm (Màu nền)',
      'Bồn nước + bơm › Đèn trạng thái (Màu nền)',
      'Lưu trữ › Vận hành',
      'Lưu trữ › Báo cáo ca',
    ]);
  });

  it('Tag không dùng ở đâu trả danh sách rỗng', () => {
    expect(whereUsed(demo(), 'KHONG.CO')).toEqual([]);
  });

  it('một phần tử gắn cùng Tag cho hai thuộc tính thì có hai dòng', () => {
    const o = demo();
    const b = o.screens[0].bindings!;
    const el = b.elements[0];
    o.screens[0].bindings = {
      ...b,
      elements: [
        {
          ...el,
          bindings: [...el.bindings, { ...el.bindings[0], id: 'x', target: 'style.opacity' }],
        },
      ],
    };
    expect(whereUsed(o, 'TANK01.LEVEL').map(xrefText).slice(0, 2)).toEqual([
      'Bồn nước + bơm › Mức nước (Mức chất lỏng)',
      'Bồn nước + bơm › Mức nước (Độ mờ)',
    ]);
  });

  it('thiếu tên: dùng mã; file thiếu hoặc sai hình dạng không ném lỗi', () => {
    const o = demo();
    o.screens[0].screen = null; // screen.json hỏng: tên màn hình, phần tử theo mã
    const refs = whereUsed(o, 'TANK01.LEVEL');
    expect(xrefText(refs[0])).toBe('tank-motor › el_tank_level (Mức chất lỏng)');
    const broken = {
      screens: [
        {
          ...o.screens[0],
          bindings: {
            elements: [null, { elementUid: 'a' }, { elementUid: 'b', bindings: [null] }],
          },
        },
      ],
      logging: { groups: [null, { id: 'g', tags: 'x' }] },
    } as unknown as ProjectOutline;
    expect(whereUsed(broken, 'TANK01.LEVEL')).toEqual([]);
    expect(whereUsed({ ...demo(), logging: null, screens: [] }, 'TANK01.LEVEL')).toEqual([]);
  });
});

describe('nhãn và chỗ tới', () => {
  it('nhãn thuộc tính theo đích binding; đích lạ giữ nguyên', () => {
    expect(targetLabel('style.fill')).toBe('Màu nền');
    expect(targetLabel('transform.rotate')).toBe('Góc quay');
    expect(targetLabel('khong.co')).toBe('khong.co');
  });

  it('nhấp một dòng mở editor tương ứng', () => {
    const [bind, , log] = whereUsed(demo(), 'TANK01.LEVEL');
    expect(xrefLocation(bind)).toEqual({
      editor: 'screen',
      screen: 'tank-motor',
      element: 'el_tank_level',
    });
    expect(xrefLocation(log)).toEqual({ editor: 'logging', group: 0 });
  });
});
