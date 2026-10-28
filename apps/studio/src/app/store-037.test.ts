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

// Vòng 2 (review): mở project thật qua StudioStore — dải báo, chưa lưu, không vào hoàn tác, lưu thì hết báo.
import { resolve as resolvePath } from 'node:path';
import { readProjectDir } from '../model/test-fixtures.ts';
import { createMockPlatform } from '../platform/mock.ts';
import { StudioStore } from './store.ts';

describe('mở project có stat-tile (StudioStore)', () => {
  const ROOT = resolvePath(__dirname, '../../../..');
  function files(): Record<string, string> {
    const f = readProjectDir(resolvePath(ROOT, 'tests/project-vectors/v11-valid-full'));
    delete f['expected.json'];
    const rel = Object.keys(f).find((k) => /^screens\/.+\.screen\.json$/.test(k))!;
    const s = JSON.parse(f[rel]!);
    s.items.push(
      {
        id: 'tile_a',
        type: 'widget',
        widget: 'stat-tile',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        props: { color: 'rose' },
      },
      { id: 'tile_b', type: 'widget', widget: 'stat-tile', x: 0, y: 120, width: 200, height: 100 },
    );
    f[rel] = JSON.stringify(s, null, 2);
    return f;
  }
  it('đổi 2 thẻ, báo N=2, chưa lưu; hoàn tác không đưa thẻ cũ lại; lưu xong hết báo', async () => {
    const platform = createMockPlatform();
    platform.control.useProject(files());
    const store = new StudioStore({ platform });
    expect(await store.openProject()).toBe(true);
    expect(store.state.legacyConverted).toBe(2);
    expect(store.dirtyFiles().length).toBe(1);
    expect(store.commandContext().canUndo).toBe(false);
    store.undo();
    expect(store.dirtyFiles().length).toBe(1);
    store.dismissLegacyNotice();
    expect(store.state.legacyConverted).toBe(0);
    expect(store.dirtyFiles().length).toBe(1);
    expect((await store.save()).status).toBe('saved');
    expect(platform.control.writes.some((w) => w.content.includes('"stat-tile"'))).toBe(false);
  });
  it('project cũ hơn 1.1 (chờ nâng cấp/chỉ đọc): không tự đổi', async () => {
    const f = files();
    const p = JSON.parse(f['project.json']!);
    p.schemaVersion = '1.0.0';
    f['project.json'] = JSON.stringify(p);
    const platform = createMockPlatform();
    platform.control.useProject(f);
    const store = new StudioStore({ platform });
    await store.openProject();
    expect(store.state.legacyConverted).toBe(0);
    store.openReadOnly();
    expect(store.dirtyFiles()).toEqual([]);
  });
});
