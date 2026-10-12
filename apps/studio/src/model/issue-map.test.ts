// Ánh xạ lỗi tới editor và ô (feature 004, T008, data-model §5, FR-018): mỗi dòng của bảng.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Issue } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { issueCells, locate, severityOf } from './issue-map.ts';
import { outlineOf } from './project-doc.ts';

const DEMO = resolve(__dirname, '../../../../projects/tank-demo');
const read = (f: string) => JSON.parse(readFileSync(resolve(DEMO, f), 'utf8')) as unknown;
const demo = () =>
  outlineOf({
    'project.json': read('project.json'),
    'tags.json': read('tags.json'),
    'logging.json': read('logging.json'),
    'screens/tank-motor.screen.json': read('screens/tank-motor.screen.json'),
    'screens/tank-motor.bindings.json': read('screens/tank-motor.bindings.json'),
  });
const issue = (code: string, file: string, path: string): Issue =>
  ({ code, file, path, message: 'x' }) as Issue;

describe('locate', () => {
  const o = demo();

  it('file Tag /tags/{i}/{field} → ô của Bảng Tag', () => {
    expect(locate(issue('E_SCHEMA', 'tags.json', '/tags/3/max'), o)).toEqual({
      editor: 'tags',
      row: 3,
      column: 'max',
    });
    expect(locate(issue('E_DUP_TAG', 'tags.json', '/tags/1/id'), o)).toEqual({
      editor: 'tags',
      row: 1,
      column: 'id',
    });
    // trường lồng trong source → cột Nguồn
    expect(locate(issue('E_SCHEMA', 'tags.json', '/tags/2/source/signal'), o)).toEqual({
      editor: 'tags',
      row: 2,
      column: 'source',
    });
  });

  it('file Tag /tags/{i} (E_TAG_RANGE) → cột max', () => {
    expect(locate(issue('E_TAG_RANGE', 'tags.json', '/tags/5'), o)).toEqual({
      editor: 'tags',
      row: 5,
      column: 'max',
    });
  });

  it('lỗi cả dòng khác (ví dụ thiếu trường bắt buộc) → cột tên', () => {
    expect(locate(issue('E_SCHEMA', 'tags.json', '/tags/4'), o)).toEqual({
      editor: 'tags',
      row: 4,
      column: 'id',
    });
  });

  it('file Tag khác tên mặc định: theo tagFile của project', () => {
    const p = { ...(read('project.json') as object), tagFile: 'tags/main.json' };
    const o2 = outlineOf({ 'project.json': p });
    expect(locate(issue('E_SCHEMA', 'tags/main.json', '/tags/0/unit'), o2)).toEqual({
      editor: 'tags',
      row: 0,
      column: 'unit',
    });
    expect(locate(issue('E_SCHEMA', 'tags.json', '/tags/0/unit'), o2)).toEqual({ editor: null });
  });

  it('project.json /{field} → trường của Thiết lập project', () => {
    expect(locate(issue('E_MAX_CLIENTS', 'project.json', '/maxClients'), o)).toEqual({
      editor: 'settings',
      field: 'maxClients',
    });
    expect(locate(issue('E_SCREEN_ID', 'project.json', '/entryScreen'), o)).toEqual({
      editor: 'settings',
      field: 'entryScreen',
    });
    // đường dẫn sâu hơn: trường cấp đầu
    expect(locate(issue('E_SCHEMA', 'project.json', '/supportedBrowsers/0/minVersion'), o)).toEqual(
      { editor: 'settings', field: 'supportedBrowsers' },
    );
  });

  it('logging.json /groups/{g}/... → nhóm; /connections/{c}/... → kết nối', () => {
    expect(locate(issue('E_LOG_REF_TAG', 'logging.json', '/groups/1/tags/0/tagId'), o)).toEqual({
      editor: 'logging',
      group: 1,
    });
    expect(locate(issue('E_LOG_REF_TAG', 'logging.json', '/groups/1/tags/0'), o)).toEqual({
      editor: 'logging',
      group: 1,
    });
    expect(locate(issue('E_LOG_TLS', 'logging.json', '/connections/0/tls'), o)).toEqual({
      editor: 'logging',
      connection: 0,
    });
    expect(locate(issue('W_LOG_TLS_UNVERIFIED', 'logging.json', '/connections/2'), o)).toEqual({
      editor: 'logging',
      connection: 2,
    });
  });

  it('cảnh báo cả file logging.json (ước tính ghi) → mở Lưu trữ', () => {
    expect(locate(issue('W_LOG_WRITE_BUDGET', 'logging.json', ''), o)).toEqual({
      editor: 'logging',
    });
  });

  it('binding /elements/{k}/... → màn hình và phần tử', () => {
    const file = 'screens/tank-motor.bindings.json';
    expect(locate(issue('E_REF_TAG', file, '/elements/5/bindings/0/source/tagId'), o)).toEqual({
      editor: 'screen',
      screen: 'tank-motor',
      element: 'el_txt_level',
    });
    expect(locate(issue('E_DUP_UID', file, '/elements/0/elementUid'), o)).toEqual({
      editor: 'screen',
      screen: 'tank-motor',
      element: 'el_tank_level',
    });
  });

  it('không khớp → editor null (chỉ hiện trong tab Thông tin)', () => {
    const none = { editor: null };
    expect(locate(issue('E_JSON', 'tags.json', ''), o)).toEqual(none);
    expect(locate(issue('E_FILE_MISSING', 'project.json', ''), o)).toEqual(none);
    expect(locate(issue('E_JSON', 'logging.json', ''), o)).toEqual(none);
    expect(locate(issue('E_SCHEMA_VERSION', 'tags.json', '/schemaVersion'), o)).toEqual(none);
    expect(
      locate(issue('E_SCREEN_ID', 'screens/tank-motor.bindings.json', '/screenId'), o),
    ).toEqual(none);
    expect(
      locate(issue('E_REF_TAG', 'screens/tank-motor.bindings.json', '/elements/99/bindings/0'), o),
    ).toEqual(none);
    expect(
      locate(
        issue('W_UID_NOT_IN_SVG', 'screens/tank-motor.screen.json', '/elements/0/elementUid'),
        o,
      ),
    ).toEqual(none);
    expect(locate(issue('E_SCHEMA', 'khac.json', '/x'), o)).toEqual(none);
    expect(locate(issue('E_SCHEMA', 'tags.json', '/tags/abc/id'), o)).toEqual(none);
  });

  it('JSON pointer có ký tự thoát ~0 ~1', () => {
    expect(locate(issue('E_SCHEMA', 'project.json', '/a~1b~0c'), o)).toEqual({
      editor: 'settings',
      field: 'a/b~c',
    });
  });
});

describe('issueCells (ô có viền đỏ trong Bảng Tag)', () => {
  it('E_TAG_RANGE cả dòng tô đỏ cả Min và Max; lỗi một trường tô đúng ô đó', () => {
    const o = demo();
    const range = issue('E_TAG_RANGE', 'tags.json', '/tags/5');
    const dup = issue('E_DUP_TAG', 'tags.json', '/tags/1/id');
    const other = issue('E_MAX_CLIENTS', 'project.json', '/maxClients');
    const cells = issueCells([range, dup, other], o);
    expect([...cells.keys()].sort()).toEqual(['1:id', '5:max', '5:min']);
    expect(cells.get('5:min')).toEqual([range]);
    expect(cells.get('1:id')).toEqual([dup]);
  });

  it('nhiều lỗi cùng một ô gom lại', () => {
    const o = demo();
    const a = issue('E_SCHEMA', 'tags.json', '/tags/0/max');
    const b = issue('E_TAG_RANGE', 'tags.json', '/tags/0');
    expect(issueCells([a, b], o).get('0:max')).toEqual([a, b]);
  });
});

describe('severityOf', () => {
  it('E_ là lỗi, W_ là cảnh báo', () => {
    expect(severityOf({ code: 'E_TAG_RANGE' })).toBe('error');
    expect(severityOf({ code: 'W_LOG_WRITE_BUDGET' })).toBe('warning');
  });
});
