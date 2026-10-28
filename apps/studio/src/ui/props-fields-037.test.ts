// Feature 037: gợi ý dưới ô thuộc tính khó hiểu; trình sửa bảng trạng thái của Đèn / trạng thái.
import { render } from 'lit';
import { describe, expect, it } from 'vitest';
import type { PropValue } from '@mat/project-schema';
import { inspectorModelOf } from '../model/screen-catalog.ts';
import { renderField, type FieldEnv } from './props-fields.ts';

const env = (value: PropValue | undefined, commit: FieldEnv['commit'] = () => true): FieldEnv => ({
  value,
  mixed: false,
  issue: null,
  commit,
  tables: [],
});
const field = (w: string, n: string) =>
  inspectorModelOf(w)!.groups.display.find((f) => f.name === n)!;
const draw = (w: string, n: string, e: FieldEnv) => {
  const host = document.createElement('div');
  render(
    renderField(field(w, n), e, { error: null }, () => {}),
    host,
  );
  return host;
};

describe('props-fields 037', () => {
  it('gợi ý cho runValue, faultValue, flash', () => {
    expect(
      draw('equipment', 'runValue', env(undefined)).querySelector('.pf-hint')?.textContent,
    ).toContain('đang chạy');
    expect(draw('equipment', 'faultValue', env(undefined)).textContent).toContain('báo Lỗi');
    expect(draw('card', 'flash', env(undefined)).textContent).toContain('0,6 giây');
  });
  it('bảng trạng thái: thêm dòng đặt giá trị kế tiếp và màu gợi ý', () => {
    let got: PropValue | undefined;
    const host = draw(
      'multi-state',
      'states',
      env([{ value: 0, text: 'Dừng', color: '#6f7f88' }], (v) => ((got = v), true)),
    );
    host.querySelector<HTMLButtonElement>('[data-act="state-add"]')!.click();
    expect(got).toEqual([
      { value: 0, text: 'Dừng', color: '#6f7f88' },
      { value: 1, text: '', color: '#268426' },
    ]);
  });
});
