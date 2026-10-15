// Nội dung alarm có chèn giá trị (T070, FR-079): Xem trước, thẻ lạ báo lỗi, gợi ý thẻ khi gõ `{`.
import type { AlarmDef } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { defaultClasses, tagLiteOf, type AlarmDoc } from './alarm-doc.ts';
import {
  checkText,
  insertToken,
  previewText,
  sampleFor,
  tokenQuery,
  tokenSuggestions,
} from './alarm-text.ts';

const LEVEL = tagLiteOf({
  id: 'TANK01.LEVEL',
  kind: 'internal',
  type: 'FLOAT32',
  unit: '%',
  min: 0,
  max: 100,
});
const TAGS = new Map([[LEVEL.id, LEVEL]]);
const DEF = {
  id: 'TL',
  type: 'limit',
  name: 'Mức bồn 1',
  tag: 'TANK01.LEVEL',
  area: 'bom',
  limits: { H: { value: 80, class: 'minor' }, HH: { value: 90, class: 'critical' } },
} as AlarmDef;
const DOC: AlarmDoc = {
  areas: [{ id: 'bom', name: 'Trạm bơm' }],
  alarms: [DEF],
  classes: defaultClasses(),
};

describe('Xem trước nội dung', () => {
  it('chèn mẫu bằng cùng bộ định dạng với runtime', () => {
    const s = sampleFor(DEF, DOC, TAGS);
    expect(s.limitName).toBe('H');
    expect(previewText('{name} cao: {value:1} {unit} (ngưỡng {limit})', DEF, s)).toBe(
      'Mức bồn 1 cao: 84.0 % (ngưỡng 80)',
    );
    expect(previewText('{area}: {tag}', DEF, s)).toBe('Trạm bơm: TANK01.LEVEL');
  });

  it('nội dung trống dùng mẫu mặc định D9 theo ngưỡng', () => {
    expect(previewText('', DEF, sampleFor(DEF, DOC, TAGS, 'HH'))).toBe(
      'Mức bồn 1 rất cao: 94.5 % (ngưỡng 90)',
    );
    expect(previewText('', DEF, sampleFor(DEF, DOC, TAGS))).toContain('cao');
  });

  it('thẻ lạ, thiếu ngoặc và nội dung quá dài báo lỗi', () => {
    expect(checkText('{name} ok {value:2}')).toBe('ok');
    expect(checkText('{lạ}')).toBe('token');
    expect(checkText('{name')).toBe('token');
    expect(checkText('x}')).toBe('token');
    expect(checkText('a'.repeat(201))).toBe('length');
  });
});

describe('gợi ý thẻ khi gõ {', () => {
  it('nhận ra thẻ đang gõ dở và lọc theo chữ đã gõ', () => {
    const q = tokenQuery('Mức {va', 7);
    expect(q).toEqual({ start: 4, prefix: 'va' });
    expect(tokenSuggestions(q!).map((x) => x.token)).toEqual(['value', 'value:1']);
    expect(tokenSuggestions(tokenQuery('{', 1)!)).toHaveLength(9);
    expect(tokenQuery('{name} xong', 11)).toBeNull();
    expect(tokenQuery('không có', 8)).toBeNull();
  });

  it('chèn thẻ thay phần đang gõ và đặt con trỏ sau dấu đóng', () => {
    const q = tokenQuery('Mức {va rồi', 7)!;
    expect(insertToken('Mức {va rồi', 7, q, 'value:1')).toEqual({
      text: 'Mức {value:1} rồi',
      caret: 13,
    });
  });
});
