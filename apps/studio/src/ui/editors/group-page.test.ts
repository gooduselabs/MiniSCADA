// Trang nhóm trên cây (sửa lỗi 039): bấm vào mục nhóm (Bảng giá trị, Bảng theo dõi, …) mở trang nhóm; danh sách rỗng thì
// trang giải thích mục dùng để làm gì, có ví dụ và nút "Thêm …" lớn; bấm Thêm thì tạo mục mới và mở editor của nó.
import { afterEach, describe, expect, it } from 'vitest';
import { full02 } from '../../model/test-fixtures.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './group-page.ts';
import type { GroupPageEl } from './group-page.ts';
import type { GroupKey } from '../../model/tree.ts';

afterEach(cleanup);

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** Project 0.2 không có Bảng giá trị, Bảng theo dõi (như project mới tạo). */
function emptyFiles(): Record<string, string> {
  const files = { ...full02() };
  for (const k of Object.keys(files)) if (/^(value-tables|watch-tables)\//.test(k)) delete files[k];
  const project = JSON.parse(files['project.json']!) as Record<string, unknown>;
  files['project.json'] = JSON.stringify({ ...project, valueTables: [], watchTables: [] });
  return files;
}

async function open(key: GroupKey, files?: Record<string, string>) {
  const env = await newApp02(files ? { files } : {});
  env.app.selectNode(key, true);
  const el = await mount<GroupPageEl>('mat-group-page', env.app);
  el.groupKey = key;
  await settled(el);
  return { ...env, el };
}

describe('mat-group-page', () => {
  it('project rỗng: bấm Bảng giá trị mở trang nhóm có giải thích, ví dụ, nút Thêm; Thêm tạo bảng và mở editor', async () => {
    const { app, el } = await open('valueTables', emptyFiles());
    expect(app.store.state.outline.valueTables).toHaveLength(0);
    expect(app.store.state.active).toBe('group:valueTables');
    expect(app.editorTitle('group:valueTables')).toBe('Bảng giá trị');
    expect(text(el.querySelector('.gp-example'))).toContain('0 = Dừng, 1 = Chạy, 2 = Lỗi');
    expect(el.querySelector('.gp-empty')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('.gp-add')!.click();
    await app.store.idle();
    expect(app.store.state.outline.valueTables).toHaveLength(1);
    expect(app.store.state.active).toBe('vt:BangGiaTri1');
  });

  it('project rỗng: Bảng theo dõi mở trang nhóm, Thêm tạo bảng và mở editor', async () => {
    const { app, el } = await open('watchTables', emptyFiles());
    expect(app.store.state.outline.watchTables).toHaveLength(0);
    expect(app.store.state.active).toBe('group:watchTables');
    expect(text(el.querySelector('.gp-what'))).toContain('nhiều Tag cùng lúc');
    el.querySelector<HTMLButtonElement>('.gp-add')!.click();
    await app.store.idle();
    expect(app.store.state.outline.watchTables).toHaveLength(1);
    expect(app.store.state.active.startsWith('watch:')).toBe(true);
  });

  it('nhóm có mục: liệt kê mục con, bấm mở editor của mục', async () => {
    const { app, el } = await open('valueTables');
    const item = el.querySelector<HTMLButtonElement>(
      '.gp-item[data-node="valuetable:TrangThaiBom"]',
    )!;
    item.click();
    expect(app.store.state.active).toBe('vt:TrangThaiBom');
  });

  it('mọi mục nhóm trên cây đều mở được editor', async () => {
    const { app } = await newApp02({ files: emptyFiles() });
    for (const key of ['tagsFolder', 'alarm', 'screens', 'users'] as const) {
      app.selectNode(key, true);
      expect(app.store.state.active).toBe(`group:${key}`);
    }
  });
});
