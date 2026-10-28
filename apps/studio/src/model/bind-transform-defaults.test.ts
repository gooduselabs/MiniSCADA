// Feature 032: mọi tổ hợp mục × loại phần tử × kiểu Tag × cách đổi phải hợp lệ ngay khi vừa chọn (schema 1.0 + rules-04).
// Lỗi gốc: chọn "Rời rạc" cho Màu nền với Tag số sinh `cases: []` (schema minItems 1) → E_SCHEMA thô dưới dòng.
import { Validator, type Schema } from '@cfworker/json-schema';
import { bindingRules04, type BindingSet04, type TagV1 } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import bindingSchema from '../../../../schemas/binding.schema.json' with { type: 'json' };
import {
  ANIMATION_ROWS,
  defaultParams,
  defaultTransform,
  rowAcceptsKind,
  rowAcceptsTag,
  targetOf,
  transformChoices,
  transformsFor,
  type ElementKind,
} from './animation-catalog.ts';
import type { TagInfo } from './screen-catalog.ts';
import { rowIssueTexts } from './svg-issue-text.ts';

const validator = new Validator(bindingSchema as unknown as Schema, '7', false);
const TAGS: TagInfo[] = [
  { id: 'TAG_1', type: 'FLOAT32', access: 'R', kind: 'simulation' },
  { id: 'LVL', type: 'INT16', access: 'R', kind: 'simulation', min: 0, max: 200 },
  { id: 'RUN', type: 'BOOL', access: 'R', kind: 'simulation' },
  { id: 'NAME', type: 'STRING', access: 'R', kind: 'simulation' },
];
const KINDS: ElementKind[] = ['text', 'rect', 'shape', 'line', 'group'];
const TABLES = ['States'];

function check(set: BindingSet04): string[] {
  const out: string[] = [];
  const r = validator.validate(set);
  for (const e of r.errors) out.push(`E_SCHEMA ${e.instanceLocation} ${e.error}`);
  const tagInfo = new Map<string, TagV1>(
    TAGS.map((t) => [t.id, { id: t.id, kind: 'simulation', type: t.type } as TagV1]),
  );
  bindingRules04(
    set,
    'screens/s.svg_a.bindings.json',
    new Set(['el_abc']),
    {
      hasTags: true,
      tagType: new Map(TAGS.map((t) => [t.id, t.type as TagV1['type']])),
      tagTable: new Map(TAGS.map((t) => [t.id, undefined])),
      tableSet: new Set(TABLES),
      tagInfo,
      screens: ['s'],
      format10: true,
    },
    (code, _f, path, msg) => out.push(`${code} ${path} ${msg}`),
    () => {},
    () => undefined,
  );
  return out;
}

describe('mặc định của cách đổi hợp lệ ngay khi chọn', () => {
  for (const row of ANIMATION_ROWS)
    for (const tag of TAGS) {
      if (!rowAcceptsTag(row, tag)) continue;
      for (const k of transformsFor(row, tag))
        it(`${row.id} × ${tag.type} × ${k}`, () => {
          for (const ek of KINDS) {
            if (!rowAcceptsKind(row, ek)) continue;
            const set: BindingSet04 = {
              schemaVersion: '1.0.0',
              screenId: 's',
              itemId: 'svg_a',
              elements: [
                {
                  elementUid: 'el_abc',
                  bindings: [
                    {
                      id: 'b1',
                      target: targetOf(row, ek),
                      source: { type: 'tag', tagId: tag.id },
                      transform: defaultTransform(row, k, tag, TABLES),
                      ...defaultParams(row, tag),
                    },
                  ],
                },
              ],
            };
            expect(check(set), `${ek}`).toEqual([]);
          }
        });
    }

  it('Màu nền Rời rạc với Tag số: 0 = xám, 1 = xanh', () => {
    const fill = ANIMATION_ROWS.find((r) => r.id === 'fill')!;
    expect(defaultTransform(fill, 'discreteMap', TAGS[0])).toEqual({
      kind: 'discreteMap',
      cases: [
        { equals: 0, value: '#9aa5b1' },
        { equals: 1, value: '#2e9e44' },
      ],
      default: '#9aa5b1',
    });
  });

  it('Màu Khoảng: ba khoảng xanh, cam, đỏ theo min/max Tag', () => {
    const fill = ANIMATION_ROWS.find((r) => r.id === 'fill')!;
    const tr = defaultTransform(fill, 'rangeMap', TAGS[1]);
    expect(tr).toMatchObject({
      ranges: [
        { to: 120, value: '#2e9e44' },
        { from: 120, to: 170, value: '#f39c12' },
        { from: 170, value: '#d64541' },
      ],
    });
  });

  it('Bảng giá trị ẩn khi không có bảng nào', () => {
    const fill = ANIMATION_ROWS.find((r) => r.id === 'fill')!;
    expect(transformChoices(fill, TAGS[0], [])).not.toContain('valueTable');
    expect(transformChoices(fill, TAGS[0], TABLES)).toContain('valueTable');
    expect(transformChoices(fill, TAGS[0], [], 'valueTable')).toContain('valueTable');
  });

  it('lỗi schema thô gom thành một câu tiếng Việt', () => {
    const b = {
      id: 'b1',
      target: 'style.fill',
      source: { type: 'tag', tagId: 'TAG_1' },
      transform: { kind: 'discreteMap', cases: [] },
    } as unknown as Parameters<typeof rowIssueTexts>[1];
    const iss = (message: string) => ({
      elementUid: 'el_abc',
      rowId: 'fill',
      field: 'transform',
      severity: 'error' as const,
      issue: {
        code: 'E_SCHEMA',
        file: 'f',
        path: '/elements/0/bindings/0/transform',
        message,
      } as never,
    });
    const r = rowIssueTexts(
      [
        iss('Instance does not match "direct".'),
        iss('False boolean schema.'),
        iss('False boolean schema.'),
      ],
      b,
      'fill',
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.text).toContain('Rời rạc cần ít nhất một dòng giá trị → màu');
    expect(r[0]!.text).not.toContain('E_SCHEMA');
  });
});
