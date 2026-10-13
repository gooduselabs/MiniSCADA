// Ánh xạ Issue của validator tới item và ô inspector (feature 007, T106; FR-068).
import { describe, expect, it } from 'vitest';
import type { Issue, ScreenModel } from '@mat/project-schema';
import {
  groupByItem,
  jumpTarget,
  locateIssue,
  parseItemPath,
  screenIssues,
  severityOfField,
  severityOfItem,
} from './screen-issues.ts';

const doc: ScreenModel = {
  schemaVersion: '0.3.0',
  id: 'main',
  name: 'Chính',
  kind: 'screen',
  size: { width: 1280, height: 720 },
  items: ['card_1', 'button_1', 'gauge_1', 'line_1'].map((id, i) => ({
    id,
    type: 'widget' as const,
    widget: id.split('_')[0]!,
    x: i,
    y: 0,
    width: 100,
    height: 50,
  })),
};
const issue = (code: string, path: string, file = 'screens/main.screen.json'): Issue =>
  ({ code, file, path, message: code }) as Issue;

describe('parseItemPath', () => {
  const cases: Array<[string, { itemIndex: number; field: string } | null]> = [
    ['/items/3', { itemIndex: 3, field: 'item' }],
    ['/items/3/id', { itemIndex: 3, field: 'item' }],
    ['/items/3/widget', { itemIndex: 3, field: 'item' }],
    ['/items/3/bindingFile', { itemIndex: 3, field: 'item' }],
    ['/items/3/x', { itemIndex: 3, field: 'rect' }],
    ['/items/3/width', { itemIndex: 3, field: 'rect' }],
    ['/items/3/props', { itemIndex: 3, field: 'item' }],
    ['/items/3/props/min', { itemIndex: 3, field: 'prop:min' }],
    ['/items/3/props/zones/1/from', { itemIndex: 3, field: 'prop:zones' }],
    ['/items/3/tags/value', { itemIndex: 3, field: 'tag:value' }],
    ['/items/3/tags/series/2', { itemIndex: 3, field: 'tag:series' }],
    ['/items/3/tags', { itemIndex: 3, field: 'item' }],
    ['/items/3/events/click', { itemIndex: 3, field: 'event' }],
    ['/items/3/events/click/screen', { itemIndex: 3, field: 'event' }],
    ['/items/3/security/minRole', { itemIndex: 3, field: 'security' }],
    ['/items/0/props/a~1b', { itemIndex: 0, field: 'prop:a/b' }],
    ['/items', null],
    ['/size/width', null],
    ['/fitMode', null],
    ['', null],
    ['/items/x/props/min', null],
    ['/items/-1', null],
  ];
  it.each(cases)('%s', (path, expected) => {
    expect(parseItemPath(path)).toEqual(expected);
  });
});

describe('locateIssue / jumpTarget', () => {
  it('đổi chỉ số thành id item', () => {
    expect(locateIssue(issue('E_WIDGET_PROP', '/items/3/props/min'), doc)).toEqual({
      itemIndex: 3,
      itemId: 'line_1',
      field: 'prop:min',
    });
    expect(jumpTarget(issue('E_WIDGET_SLOT', '/items/0/tags/value'), doc)).toEqual({
      itemId: 'card_1',
      field: 'tag:value',
    });
  });
  it('chỉ số ngoài phạm vi hoặc không phải đường dẫn item: null', () => {
    expect(locateIssue(issue('E_ITEM_ID', '/items/9/id'), doc)).toBeNull();
    expect(jumpTarget(issue('E_SCREEN_SIZE', '/size/width'), doc)).toBeNull();
  });
});

describe('screenIssues', () => {
  it('chỉ lấy Issue của file màn hình đó', () => {
    const all = [
      issue('E_A', '/items/0', 'screens/main.screen.json'),
      issue('E_B', '/items/0', 'screens/other.screen.json'),
      issue('E_C', '/tags/0', 'tags.json'),
    ];
    expect(screenIssues(all, 'main').map((i) => i.code)).toEqual(['E_A']);
  });
});

describe('groupByItem', () => {
  const issues = [
    issue('E_WIDGET_PROP', '/items/3/props/min'),
    issue('W_WRITE_NO_LIMITS', '/items/1/tags/target'),
    issue('E_REF_TAG', '/items/3/tags/series/0'),
    issue('W_ITEM_OUTSIDE', '/items/3'),
    issue('E_SCREEN_SIZE', '/size/width'),
    issue('E_ITEM_ID', '/items/42/id'),
  ];
  it('nhóm theo id item, giữ thứ tự; Issue khác vào danh sách riêng', () => {
    const g = groupByItem(issues, doc);
    expect([...g.byItem.keys()]).toEqual(['line_1', 'button_1']);
    expect(g.byItem.get('line_1')!.map((e) => e.field)).toEqual(['prop:min', 'tag:series', 'item']);
    expect(g.byItem.get('button_1')![0]).toMatchObject({
      field: 'tag:target',
      severity: 'warning',
    });
    expect(g.other.map((i) => i.code)).toEqual(['E_SCREEN_SIZE', 'E_ITEM_ID']);
  });
  it('severityOfItem: lỗi thắng cảnh báo; không có thì null', () => {
    const g = groupByItem(issues, doc);
    expect(severityOfItem(g.byItem.get('line_1'))).toBe('error');
    expect(severityOfItem(g.byItem.get('button_1'))).toBe('warning');
    expect(severityOfItem(undefined)).toBeNull();
    expect(severityOfItem([])).toBeNull();
  });
  it('severityOfField: viền theo từng ô', () => {
    const g = groupByItem(issues, doc);
    const line = g.byItem.get('line_1');
    expect(severityOfField(line, 'prop:min')).toBe('error');
    expect(severityOfField(line, 'item')).toBe('warning');
    expect(severityOfField(line, 'prop:max')).toBeNull();
    expect(severityOfField(undefined, 'rect')).toBeNull();
  });
});
