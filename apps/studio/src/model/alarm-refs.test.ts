// Đổi tên Tag, "Dùng ở đâu", xóa Tag đang có alarm (T083, FR-082): alarm đổi theo trong cùng một bước hoàn tác với các nơi
// đã có; chỗ dùng liệt kê id và ngưỡng, nhấp nhảy tới ô Tag của dòng.
import { describe, expect, it } from 'vitest';
import { whereUsed, xrefLocation, xrefText } from './xref.ts';
import { planRename } from './rename-flow.ts';
import { full05WithAlarms } from './alarm-fixtures.ts';
import { filesOf, loadDoc, outlineOf, type ProjectDocs } from './project-doc.ts';

async function outline() {
  const files = await full05WithAlarms();
  const docs: Record<string, ReturnType<typeof loadDoc>> = {};
  for (const [rel, text] of Object.entries(files)) docs[rel] = loadDoc(rel, text, null, false);
  return outlineOf(filesOf(docs as ProjectDocs));
}

describe('"Dùng ở đâu" của Tag có alarm', () => {
  it('liệt kê alarm (id, loại, ngưỡng) và nhảy tới ô Tag của dòng', async () => {
    const o = await outline();
    const uses = whereUsed(o, 'TANK01.LEVEL').filter((e) => e.kind === 'alarm');
    expect(uses).toHaveLength(1);
    expect(xrefText(uses[0]!)).toBe('Alarm › TANK01_LEVEL (Ngưỡng: H, HH)');
    expect(xrefLocation(uses[0]!)).toEqual({ editor: 'alarms', row: 0, column: 'tag' });
    expect(xrefText(whereUsed(o, 'PUMP01.FAULT').find((e) => e.kind === 'alarm')!)).toBe(
      'Alarm › PUMP01_FAULT (Số)',
    );
  });
});

describe('đổi tên Tag cập nhật alarm', () => {
  it('kế hoạch đổi gồm sửa đổi alarms.json cùng các nơi khác và liệt kê alarm trong danh sách chỗ đổi', async () => {
    const o = await outline();
    const plan = planRename(o, 'TANK01.LEVEL', 'TANK01.MUC');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const set = plan.change.edits.find((e) => e.kind === 'alarmsSet');
    expect(set && set.kind === 'alarmsSet' && (set.doc!.alarms[0] as { tag: string }).tag).toBe(
      'TANK01.MUC',
    );
    expect(plan.items.some((i) => i.text.startsWith('Alarm › TANK01_LEVEL'))).toBe(true);
  });

  it('Tag không có alarm: không có sửa đổi alarm', async () => {
    const o = await outline();
    const plan = planRename(o, 'TANK01.SP', 'TANK01.DAT');
    expect(plan.ok && plan.change.edits.some((e) => e.kind === 'alarmsSet')).toBe(false);
  });
});
