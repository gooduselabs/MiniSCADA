// Feature 037: mở project có widget loại cũ (stat-tile) thì Studio tự chuyển sang Thẻ giá trị (card), chưa lưu đĩa.
import { describe, expect, it } from 'vitest';
import { isDirty, loadDoc } from '../model/project-doc.ts';
import { upgradeLegacyDocs } from './store.ts';

const screen = (widget: string) =>
  JSON.stringify({
    schemaVersion: '1.1.0',
    id: 'm',
    name: 'M',
    kind: 'screen',
    size: { width: 800, height: 600 },
    items: [
      {
        id: 't1',
        type: 'widget',
        widget,
        props: { color: 'rose', icon: 'bolt' },
        tags: { value: 'A' },
      },
    ],
  });

describe('upgradeLegacyDocs', () => {
  it('stat-tile thành card nền đặc, màn hình thành chưa lưu', () => {
    const rel = 'screens/m.screen.json';
    const docs = { [rel]: loadDoc(rel, screen('stat-tile'), 'h', true) };
    const out = upgradeLegacyDocs(docs);
    expect(out).not.toBe(docs);
    const it0 = (out[rel]!.value as { items: Array<{ widget: string; props: object }> }).items[0]!;
    expect(it0.widget).toBe('card');
    expect(it0.props).toMatchObject({ fill: 'solid', accent: 'rose', icon: 'bolt' });
    expect(isDirty(out[rel]!)).toBe(true);
  });
  it('không có loại cũ, hoặc tài liệu chỉ đọc: giữ nguyên', () => {
    const rel = 'screens/m.screen.json';
    const clean = { [rel]: loadDoc(rel, screen('card'), 'h', true) };
    expect(upgradeLegacyDocs(clean)).toBe(clean);
    const ro = { [rel]: loadDoc(rel, screen('stat-tile'), 'h', false) };
    expect(upgradeLegacyDocs(ro)).toBe(ro);
  });
});
