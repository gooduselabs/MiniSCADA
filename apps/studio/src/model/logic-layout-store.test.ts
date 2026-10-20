// Tệp phụ vị trí của sơ đồ Logic trong store (feature 015, T006; spec D2): sửa đổi `logicLayoutSet` tạo
// `logic.layout.json` (một bước hoàn tác, gộp được với `logicSet` trong một batch), mở lại project đọc được, tệp không thuộc
// tập file project (không vào gói nạp xuống).
import { describe, expect, it } from 'vitest';
import { projectFiles } from '@mat/project-schema';
import { newLogicApp } from '../ui/logic/logic-test-helpers.ts';
import { addBlock } from './logic-doc.ts';
import { emptyLayout, placeNodes } from './logic-layout.ts';

describe('logicLayoutSet', () => {
  it('tạo logic.layout.json, outline đọc được, một bước hoàn tác', async () => {
    const { app } = await newLogicApp();
    expect(app.store.state.outline.logicLayout.nodes).toEqual({});
    const layout = placeNodes(emptyLayout(), { t_start: { x: 320, y: 96 } });
    app.store.edit([{ kind: 'logicLayoutSet', doc: layout }]);
    expect(app.store.state.outline.logicLayout.nodes.t_start).toEqual({ x: 320, y: 96 });
    expect(app.store.dirtyFiles()).toEqual(['logic.layout.json']);
    app.store.undo();
    expect(app.store.state.outline.logicLayout.nodes).toEqual({});
  });

  it('batch logicSet + logicLayoutSet: một bước hoàn tác bỏ cả khối và vị trí', async () => {
    const { app } = await newLogicApp();
    const before = app.store.state.outline.logic!;
    const r = addBlock(before, 'timer');
    app.store.edit([
      {
        kind: 'batch',
        edits: [
          { kind: 'logicSet', doc: r.doc },
          { kind: 'logicLayoutSet', doc: placeNodes(emptyLayout(), { [r.id]: { x: 0, y: 0 } }) },
        ],
      },
    ]);
    expect(app.store.state.outline.logic?.timers).toHaveLength(2);
    expect(app.store.state.outline.logicLayout.nodes[r.id]).toBeDefined();
    app.store.undo();
    expect(app.store.state.outline.logic?.timers).toHaveLength(1);
    expect(app.store.state.outline.logicLayout.nodes[r.id]).toBeUndefined();
  });

  it('lưu rồi mở lại: vị trí đọc từ đĩa; tệp phụ không thuộc tập file project', async () => {
    const { app, platform } = await newLogicApp();
    app.store.edit([
      { kind: 'logicLayoutSet', doc: placeNodes(emptyLayout(), { s_day: { x: 48, y: 16 } }) },
    ]);
    await app.store.save();
    const text = platform.control.fileText('logic.layout.json');
    expect(JSON.parse(text ?? '{}')).toEqual({
      kind: 'mat-logic-layout',
      version: 1,
      nodes: { s_day: { x: 48, y: 16 } },
    });
    await app.store.openPicked('D:/Projects/tram-bom');
    await app.store.idle();
    expect(app.store.state.outline.logicLayout.nodes.s_day).toEqual({ x: 48, y: 16 });
    const pj = JSON.parse(platform.control.fileText('project.json')!) as {
      logic: string;
      tagFile: string;
    };
    expect(pj.logic).toBe('logic.json');
    const files = projectFiles({ project: { ...pj, screens: [] }, screens: {} });
    expect(files).toContain('logic.json');
    expect(files).not.toContain('logic.layout.json');
  });
});
