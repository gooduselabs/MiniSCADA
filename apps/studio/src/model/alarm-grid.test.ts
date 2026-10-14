// Adapter lưới alarm và CSV (T070, T084; FR-074, FR-077, FR-078): cột, chữ ô, sửa, dán, thêm dòng, 500 instance, lọc nhanh,
// nhập và xuất CSV vòng tròn, chống công thức, ca lỗi theo dòng.
import type { AlarmDef } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { alarmGrid, FILTER_ERRORS, FILTER_UNUSED, statusLine } from './alarm-grid.ts';
import { alarmsToCsv, applyAlarmCsv, parseAlarmCsv } from './alarm-csv.ts';
import { ctxOf, defaultClasses, type AlarmDoc } from './alarm-doc.ts';
import { buildView, initialGrid } from './grid/index.ts';
import type { ProjectEdit } from './project-doc.ts';

const CTX = ctxOf(
  [
    { id: 'TANK01.LEVEL', kind: 'internal', type: 'FLOAT32', min: 0, max: 100 },
    { id: 'PUMP1.FAULT', kind: 'internal', type: 'BOOL' },
  ],
  ['plc1'],
);
const DOC: AlarmDoc = {
  areas: [{ id: 'bom', name: 'Trạm bơm' }],
  classes: defaultClasses(),
  alarms: [
    {
      id: 'TL',
      type: 'limit',
      name: 'Mức bồn',
      tag: 'TANK01.LEVEL',
      limits: {
        H: { value: 80, class: 'minor', text: 'cao' },
        HH: { value: 90, class: 'critical' },
      },
      deadband: 2,
      onDelayMs: 3000,
    },
    {
      id: 'PF',
      type: 'digital',
      name: 'Bơm lỗi',
      tag: 'PUMP1.FAULT',
      trigger: true,
      class: 'major',
      area: 'bom',
    },
  ] as AlarmDef[],
};
const make = (doc = DOC, over: Partial<Parameters<typeof alarmGrid>[0]> = {}) =>
  alarmGrid({
    doc,
    ctx: CTX,
    version: '0.5.0',
    hadFiles: { alarms: true, classes: true },
    readOnly: false,
    ...over,
  });
const alarmsOf = (edits: ProjectEdit[]) => {
  const e = edits.find((x) => x.kind === 'alarmsSet');
  return e && e.kind === 'alarmsSet' ? e.doc!.alarms : null;
};

describe('AlarmGrid: cột và ô', () => {
  it('16 cột theo §3.1, cột sống chỉ khi Online', () => {
    expect(make().columns.map((c) => c.key)).toEqual([
      'id',
      'name',
      'type',
      'tag',
      'cond',
      'HH',
      'H',
      'L',
      'LL',
      'deadband',
      'onDelay',
      'offDelay',
      'class',
      'area',
      'text',
      'enabled',
    ]);
    const live = make(DOC, { live: true, liveText: () => 'x' });
    expect(live.columns.at(-1)?.kind).toBe('live');
    expect(live.text(0, 'live')).toBe('x');
    expect(live.editable(0, 'live')).toBe(false);
  });

  it('ô không áp dụng khóa; chỉ đọc khóa tất cả; chọn có danh sách', () => {
    const g = make();
    expect(g.editable(1, 'HH')).toBe(false);
    expect(g.editable(0, 'cond')).toBe(false);
    expect(g.editable(1, 'cond')).toBe(true);
    expect(make(DOC, { readOnly: true }).editable(1, 'name')).toBe(false);
    expect(g.options(1, 'cond')).toEqual(['Khi bật', 'Khi tắt']);
    expect(g.options(0, 'type')).toEqual(['Số', 'Ngưỡng', 'Quality']);
    expect(g.options(0, 'area')).toEqual(['Chung', 'Trạm bơm']);
  });

  it('sửa ô thành alarmsSet; không đổi thì không có sửa đổi', () => {
    const g = make();
    const r = g.apply([{ row: 0, col: 'H', text: '85' }]);
    expect(alarmsOf(r.edits)?.[0]).toMatchObject({ limits: { H: { value: 85 } } });
    expect(g.apply([{ row: 1, col: 'name', text: 'Bơm lỗi' }]).edits).toEqual([]);
    const bad = g.apply([{ row: 1, col: 'HH', text: '5' }]);
    expect(bad.rejected[0]).toMatchObject({ row: 1, col: 'HH', reason: 'alarm.err.notApplicable' });
  });

  it('dán dòng mới: giá trị sai kiểu vẫn vào; id không trùng trong cùng đợt', () => {
    const g = make();
    const r = g.apply([
      { row: null, newIndex: 0, col: 'tag', text: 'TANK01.LEVEL' },
      { row: null, newIndex: 0, col: 'H', text: 'abc' },
      { row: null, newIndex: 1, col: 'tag', text: 'PUMP1.FAULT' },
    ]);
    const list = alarmsOf(r.edits)!;
    expect(list).toHaveLength(4);
    expect(list[2]).toMatchObject({ type: 'limit', limits: { H: { value: 'abc' } } });
    expect(new Set(list.map((a) => (a as { id: string }).id)).size).toBe(4);
  });

  it('500 dòng dán ≤ 1 s; vượt 500 instance thì dừng và báo', () => {
    const g = make({ areas: [], classes: defaultClasses(), alarms: [] });
    const changes = [];
    for (let i = 0; i < 520; i++) {
      changes.push({ row: null, newIndex: i, col: 'id', text: `A${String(i).padStart(3, '0')}` });
      changes.push({ row: null, newIndex: i, col: 'tag', text: 'PUMP1.FAULT' });
    }
    const t0 = performance.now();
    const r = g.apply(changes);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(alarmsOf(r.edits)).toHaveLength(500);
    expect(r.rejected.at(-1)?.reason).toContain('20');
  });

  it('thêm và xóa dòng; thêm khi đã đủ 500 instance thì từ chối', () => {
    const g = make();
    const add = g.append();
    expect(add.row).toBe(2);
    expect(alarmsOf(add.edits)).toHaveLength(3);
    expect(alarmsOf(g.remove([0]))?.map((a) => (a as { id: string }).id)).toEqual(['PF']);
    const full = make({
      ...DOC,
      alarms: Array.from({ length: 500 }, (_, i) => ({
        id: `A${i}`,
        type: 'digital',
        name: 'n',
        tag: 'PUMP1.FAULT',
        trigger: true,
        class: 'major',
      })) as AlarmDef[],
    });
    expect(full.append().edits).toEqual([]);
  });

  it('lọc nhanh qua ô tìm: chỉ dòng lỗi, chỉ dòng chưa dùng ngưỡng, tìm không dấu', () => {
    const g = make(DOC, { errorRows: new Set([1]) });
    expect(buildView(g, { ...initialGrid, filter: FILTER_ERRORS }).rows).toEqual([1]);
    expect(buildView(g, { ...initialGrid, filter: FILTER_UNUSED }).rows).toEqual([0]);
    expect(buildView(g, { ...initialGrid, filter: 'bom loi' }).rows).toEqual([1]);
    expect(buildView(g, { ...initialGrid, filter: 'cao' }).rows).toEqual([0]);
  });

  it('thanh trạng thái đếm instance, không đếm dòng', () => {
    expect(statusLine(DOC, 3, 1)).toBe('3 instance / 500 · 3 lỗi · 1 cảnh báo (cảnh báo trên 200)');
  });
});

describe('CSV alarm', () => {
  it('xuất rồi nhập lại: vòng tròn giữ id, loại, Tag, ngưỡng, trễ, lớp, khu vực, nội dung theo ngưỡng', () => {
    const text = alarmsToCsv(DOC);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.split('\r\n')[0]).toContain('Tag / Thiết bị');
    const p = parseAlarmCsv(text, { ...DOC, alarms: [] }, CTX);
    expect(p.fatal).toBeNull();
    expect(p.issues).toEqual([]);
    const r = applyAlarmCsv({ ...DOC, alarms: [] }, p, 'replace');
    expect(r.doc.alarms).toEqual(DOC.alarms.map((a) => ({ ...a })));
  });

  it('nhận khóa tiếng Anh, dấu ; và dấu phẩy thập phân; không có BOM', () => {
    const csv =
      'id;name;type;tag;H;deadband;onDelayS;class\nA1;Mức;limit;TANK01.LEVEL;80,5;1,5;2;minor\n';
    const p = parseAlarmCsv(csv, DOC, CTX);
    expect(p.rows[0]?.def).toMatchObject({
      id: 'A1',
      type: 'limit',
      limits: { H: { value: 80.5, class: 'minor' } },
      deadband: 1.5,
      onDelayMs: 2000,
    });
  });

  it('ca lỗi báo theo dòng: thiếu cột id, loại lạ, thừa cột, id lặp', () => {
    expect(parseAlarmCsv('name,type\nx,y\n', DOC, CTX).fatal).toMatch(/id/);
    expect(parseAlarmCsv('id,name\n', DOC, CTX).fatal).not.toBeNull();
    const p = parseAlarmCsv(
      'id,name,type\nA,x,limit\nB,y,wat\nC,z,digital,extra,more\nA,dup,digital\n',
      DOC,
      CTX,
    );
    expect(p.rows.map((r) => r.line)).toEqual([2, 4]);
    expect(p.issues.map((i) => [i.line, i.severity])).toEqual([
      [3, 'error'],
      [4, 'warning'],
      [5, 'error'],
    ]);
  });

  it('"Thêm vào" gộp theo id: trùng thì bỏ qua hoặc thay; "Thay thế" thay hết', () => {
    const p = parseAlarmCsv(
      'id,name,type,tag,class\nPF,mới,digital,PUMP1.FAULT,minor\nNEW,n,digital,PUMP1.FAULT,minor\n',
      DOC,
      CTX,
    );
    const skip = applyAlarmCsv(DOC, p, 'append', 'skip');
    expect(skip).toMatchObject({ added: 1, skipped: 1, duplicates: ['PF'] });
    expect((skip.doc.alarms[1] as { name: string }).name).toBe('Bơm lỗi');
    const rep = applyAlarmCsv(DOC, p, 'append', 'replace');
    expect(rep.replaced).toBe(1);
    expect((rep.doc.alarms[1] as { name: string }).name).toBe('mới');
    expect(applyAlarmCsv(DOC, p, 'replace').doc.alarms).toHaveLength(2);
  });

  it('ô chuỗi chống công thức khi xuất; nhập bỏ nháy đã thêm', () => {
    const doc: AlarmDoc = {
      ...DOC,
      alarms: [{ ...(DOC.alarms[1] as object), name: '=HYPERLINK("x")', text: '+cmd' } as AlarmDef],
    };
    const text = alarmsToCsv(doc);
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("'+cmd");
    const back = parseAlarmCsv(text, doc, CTX).rows[0]!.def as { name: string; text: string };
    expect(back.name).toBe('=HYPERLINK("x")');
    expect(back.text).toBe('+cmd');
  });

  it('xuất chỉ các dòng chọn; dấu thập phân phẩy dùng ; làm phân cách', () => {
    const text = alarmsToCsv(DOC, [1], ',');
    expect(text.trim().split('\r\n')).toHaveLength(2);
    expect(alarmsToCsv(DOC, [0], ',').split('\r\n')[0]).toContain(';');
  });
});
