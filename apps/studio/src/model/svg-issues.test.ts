// Lỗi theo phần tử, dòng và ô của inspector Gắn Tag (feature 008, T064).
import { describe, expect, it } from 'vitest';
import type { BindingSet04, Issue } from '@mat/project-schema';
import {
  groupBySvgElement,
  issuesOfRow,
  itemIssues,
  locateSvgIssue,
  severityOfElement,
  severityOfSvgField,
  svgBindingFile,
  svgJumpTarget,
} from './svg-issues.ts';

const FILE = svgBindingFile('bon', 'svg_bon');
const set: BindingSet04 = {
  schemaVersion: '0.4.0',
  screenId: 'bon',
  itemId: 'svg_bon',
  elements: [
    {
      elementUid: 'el_a',
      bindings: [
        {
          id: 'colour',
          target: 'style.fill',
          source: { type: 'tag', tagId: 'X' },
          transform: { kind: 'rangeMap', ranges: [] },
        },
        {
          id: 'spin',
          target: 'transform.rotate',
          animation: 'spin',
          source: { type: 'tag', tagId: 'X' },
          transform: { kind: 'direct' },
        },
      ],
    },
    { elementUid: 'el_h', events: { click: { action: 'closePopup' } } },
  ],
};
const issue = (code: string, path: string, file = FILE): Issue =>
  ({ code, file, path, message: '' }) as Issue;

describe('locateSvgIssue', () => {
  it('lỗi ô Khoảng, Tag, tham số, phép biến đổi', () => {
    expect(
      locateSvgIssue(issue('E_RANGE', '/elements/0/bindings/0/transform/ranges/2'), set),
    ).toEqual({
      elementUid: 'el_a',
      bindingId: 'colour',
      rowId: 'fill',
      field: 'range:2',
    });
    expect(
      locateSvgIssue(issue('E_REF_TAG', '/elements/0/bindings/0/source/tagId'), set),
    ).toMatchObject({ field: 'tag' });
    expect(locateSvgIssue(issue('E_BIND_PARAM', '/elements/0/bindings/1/reverse'), set)).toEqual({
      elementUid: 'el_a',
      bindingId: 'spin',
      rowId: 'spin',
      field: 'param:reverse',
    });
    expect(
      locateSvgIssue(issue('E_BIND_PARAM', '/elements/0/bindings/0/format/decimals'), set)!.field,
    ).toBe('param:format');
    expect(
      locateSvgIssue(issue('E_BIND_TRANSFORM', '/elements/0/bindings/0/transform/kind'), set)!
        .field,
    ).toBe('transform');
    expect(
      locateSvgIssue(issue('E_DUP_BINDING', '/elements/0/bindings/1/target'), set)!.field,
    ).toBe('target');
  });

  it('lỗi sự kiện đúng ô; lỗi cả phần tử; đường dẫn lạ là null', () => {
    expect(locateSvgIssue(issue('E_EVENT_TAG', '/elements/1/events/click/tag'), set)).toEqual({
      elementUid: 'el_h',
      rowId: 'event',
      field: 'event:tag',
    });
    expect(locateSvgIssue(issue('E_EVENT_ACTION', '/elements/1/events/click'), set)!.field).toBe(
      'event:action',
    );
    expect(locateSvgIssue(issue('E_REF_UID', '/elements/0/elementUid'), set)).toEqual({
      elementUid: 'el_a',
      field: 'element',
    });
    expect(locateSvgIssue(issue('E_X', '/items/0'), set)).toBeNull();
    expect(locateSvgIssue(issue('E_X', '/elements/9/bindings/0'), set)).toBeNull();
  });
});

describe('nhóm và viền', () => {
  const issues = [
    issue('W_BLINK_ONLY', '/elements/0/bindings/1/target'),
    issue('E_RANGE', '/elements/0/bindings/0/transform/ranges/0'),
    issue('E_EVENT_TAG', '/elements/1/events/click/tag'),
    issue('E_JSON', '/x'),
    issue('E_OTHER', '/elements/0/bindings/0', 'screens/khac.json'),
  ];

  it('chỉ lấy Issue của file binding item; nhóm theo phần tử, ngoài ra vào other', () => {
    const mine = itemIssues(issues, 'bon', 'svg_bon');
    expect(mine).toHaveLength(4);
    const { byElement, other } = groupBySvgElement(mine, set);
    expect([...byElement.keys()]).toEqual(['el_a', 'el_h']);
    expect(other).toHaveLength(1);
    const a = byElement.get('el_a');
    expect(severityOfElement(a)).toBe('error');
    expect(severityOfElement(byElement.get('el_h'))).toBe('error');
    expect(severityOfElement(undefined)).toBeNull();
    expect(issuesOfRow(a, 'fill')).toHaveLength(1);
    expect(severityOfSvgField(a, 'fill', 'range:0')).toBe('error');
    expect(severityOfSvgField(a, 'spin', 'target')).toBe('warning');
    expect(severityOfSvgField(a, 'spin', 'tag')).toBeNull();
  });

  it('đích nhảy khi nhấp đúp', () => {
    expect(svgJumpTarget(issues[1]!, set)).toEqual({
      elementUid: 'el_a',
      rowId: 'fill',
      field: 'range:0',
    });
    expect(svgJumpTarget(issues[3]!, set)).toBeNull();
  });
});
