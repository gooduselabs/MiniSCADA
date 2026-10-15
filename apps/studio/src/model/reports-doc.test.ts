// T128 (feature 010, US8, FR-040…FR-044; contracts/templates-config.md §2, §3; studio-010.md §2): mô hình tài liệu của editor Mẫu báo
// cáo. Mẫu, cột, hàm trong `project-doc`; chỉ nhóm có `aggregates` và Tag có `aggregate ≠ false` (số hoặc BOOL); hàm mờ theo kiểu
// Tag; ca (số ca trong {2, 3, 4, 6, 8, 12}, nhãn ca, từ chối số ca không chia đều); gợi ý đơn vị theo hàm; lỗi theo ô (E_RPT_*) từ
// bộ kiểm tra; kéo Tag từ cây vào lưới cột; hoàn tác.
import {
  MemorySource,
  validateProject,
  type LoggingConfig,
  type ReportsConfig,
} from '@mat/project-schema';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyDocEdits,
  filesOf,
  loadDoc,
  restoreSnapshot,
  snapshotOf,
  withEditable,
  writtenText,
  type ProjectDoc,
} from './project-doc.ts';
import {
  addColumns,
  addReport,
  columnsAdapter,
  duplicateReport,
  eligibleGroups,
  eligibleTags,
  fnApplicable,
  moveColumn,
  parseShiftCount,
  removeColumns,
  removeReport,
  reportsEdit,
  setColumnField,
  setColumnFunctions,
  setPeriod,
  setReportField,
  setRowMinutes,
  setShifts,
  shiftLabels,
  suggestUnit,
  toggleFunction,
} from './reports-doc.ts';
import { bucketReportIssues } from './reports-issues.ts';
import { readProjectDir, REPO } from './test-fixtures.ts';
import { tagTypesOf } from './logging-doc.ts';

const demo = () => readProjectDir(resolve(REPO, 'projects/history-demo'));
const logging = (): LoggingConfig => JSON.parse(demo()['logging.json']!) as LoggingConfig;
const types = () => tagTypesOf(JSON.parse(demo()['tags.json']!));
const reports0 = (): ReportsConfig => JSON.parse(demo()['reports.json']!) as ReportsConfig;

function open(files: Record<string, string> = demo()) {
  const docs: Record<string, ProjectDoc> = {};
  for (const [rel, text] of Object.entries(files))
    docs[rel] = loadDoc(
      rel,
      text,
      `hash:${rel}`,
      false,
      rel === 'tags.json' ? 'tags02' : undefined,
    );
  return withEditable(docs);
}

describe('mẫu báo cáo: thêm, nhân bản, xóa, trường chung', () => {
  it('addReport: nhóm đầu có tổng hợp, id duy nhất, kỳ ngày 60 phút, có tổng; chưa có reports.json thì tạo', () => {
    const r = addReport(null, logging());
    expect(r.schemaVersion).toBe('0.1.0');
    expect(r.reports).toHaveLength(1);
    expect(r.reports[0]).toMatchObject({
      id: 'bao-cao',
      group: 'ap-suat',
      period: 'day',
      rowMinutes: 60,
      totals: true,
      columns: [],
    });
    const r2 = addReport(r, logging());
    expect(r2.reports.map((x) => x.id)).toEqual(['bao-cao', 'bao-cao-2']);
  });

  it('duplicateReport chèn ngay sau, đổi id và tên; removeReport; setReportField', () => {
    const c = reports0();
    const d = duplicateReport(c, 0);
    expect(d.reports).toHaveLength(4);
    expect(d.reports[1]!.id).not.toBe(c.reports[0]!.id);
    expect(d.reports[1]!.name).toContain('bản sao');
    expect(d.reports[1]!.columns).toEqual(c.reports[0]!.columns);
    expect(removeReport(d, 1).reports.map((x) => x.id)).toEqual(c.reports.map((x) => x.id));
    expect(setReportField(c, 0, 'name', 'Tên mới').reports[0]!.name).toBe('Tên mới');
    expect(setReportField(c, 0, 'footer', '').reports[0]!.footer).toBeUndefined();
    expect(c.reports[0]!.name).toBe('Điện năng theo ngày'); // không sửa tại chỗ
  });

  it('chỉ nhóm có tổng hợp được chọn; Tag phải có aggregate ≠ false và không phải chuỗi', () => {
    const l = logging();
    expect(eligibleGroups(l).map((g) => g.id)).toEqual(['ap-suat', 'dien']);
    expect(eligibleGroups({ ...l, groups: l.groups.filter((g) => !g.aggregates) })).toEqual([]);
    expect(eligibleTags(l, 'dien', types())).toEqual(['METER1.KW', 'METER1.KWH']);
    const off = structuredClone(l);
    off.groups[2]!.tags[0]!.aggregate = false;
    expect(eligibleTags(off, 'dien', types())).toEqual(['METER1.KWH']);
    expect(eligibleTags(l, 'khong-co', types())).toEqual([]);
  });
});

describe('kỳ và ca', () => {
  it('setPeriod chuyển trường: shift có shifts mặc định 3 ca 06:00, bỏ rowMinutes; day có rowMinutes; month không có cả hai', () => {
    const c = reports0();
    const shift = setPeriod(c, 0, 'shift').reports[0]!;
    expect(shift).toMatchObject({ period: 'shift', shifts: { count: 3, start: '06:00' } });
    expect(shift.rowMinutes).toBeUndefined();
    const monthCfg = setPeriod(setPeriod(c, 0, 'shift'), 0, 'month');
    expect(monthCfg.reports[0]!.shifts).toBeUndefined();
    expect(monthCfg.reports[0]!.rowMinutes).toBeUndefined();
    const day = setPeriod(monthCfg, 0, 'day').reports[0]!;
    expect(day).toMatchObject({ period: 'day', rowMinutes: 60 });
    expect(day.shifts).toBeUndefined();
    expect(setRowMinutes(c, 0, 15).reports[0]!.rowMinutes).toBe(15);
  });

  it('số ca chỉ trong {2, 3, 4, 6, 8, 12}; từ chối số ca không chia đều 24 giờ', () => {
    for (const n of [2, 3, 4, 6, 8, 12]) expect(parseShiftCount(String(n))).toBe(n);
    for (const bad of ['5', '7', '24', '0', 'abc', '3,5', ''])
      expect(parseShiftCount(bad)).toBeNull();
  });

  it('nhãn ca hiện ngay: 3 ca bắt đầu 06:00 → 06:00–14:00, 14:00–22:00, 22:00–06:00', () => {
    expect(shiftLabels(3, '06:00')).toEqual([
      'Ca 1 06:00–14:00',
      'Ca 2 14:00–22:00',
      'Ca 3 22:00–06:00',
    ]);
    expect(shiftLabels(2, '07:30')).toEqual(['Ca 1 07:30–19:30', 'Ca 2 19:30–07:30']);
    expect(shiftLabels(12, '00:00')).toHaveLength(12);
    expect(shiftLabels(5, '06:00')).toEqual([]);
    expect(shiftLabels(3, 'xx')).toEqual([]);
  });

  it('setShifts ghi đúng giá trị; nhập tay sai vẫn ghi để bộ kiểm tra báo E_RPT_SHIFT theo ô', () => {
    const c = setPeriod(reports0(), 0, 'shift');
    expect(setShifts(c, 0, { count: 4 }).reports[0]!.shifts).toEqual({ count: 4, start: '06:00' });
    expect(setShifts(c, 0, { start: '22:00' }).reports[0]!.shifts).toEqual({
      count: 3,
      start: '22:00',
    });
    const bad = setShifts(c, 0, { count: 5 });
    expect(bad.reports[0]!.shifts!.count).toBe(5);
    const files = { ...demo(), 'reports.json': JSON.stringify(bad) };
    return validateProject(new MemorySource(files)).then((r) => {
      const issues = [...r.errors, ...r.warnings];
      expect(issues.some((i) => i.code === 'E_RPT_SHIFT' && i.path === '/reports/0/shifts')).toBe(
        true,
      );
    });
  });
});

describe('cột và hàm', () => {
  it('addColumns: Tag thuộc nhóm có tổng hợp; mặc định hàm avg (BOOL: sum); bỏ trùng, Tag ngoài nhóm và Tag không tổng hợp', () => {
    const l = logging();
    const base: ReportsConfig = {
      schemaVersion: '0.1.0',
      reports: [{ id: 'a', name: 'A', group: 'dien', period: 'day', columns: [] }],
    };
    const r = addColumns(base, 0, ['METER1.KW', 'METER1.KW', 'PROC.PRESSURE', 'NOPE'], l, types());
    expect(r.cfg.reports[0]!.columns.map((c) => [c.tagId, c.functions])).toEqual([
      ['METER1.KW', ['avg']],
    ]);
    expect(r.rejected.map((x) => [x.tagId, x.reason])).toEqual([
      ['METER1.KW', 'dup'],
      ['PROC.PRESSURE', 'notInGroup'],
      ['NOPE', 'notInGroup'],
    ]);
    const bool = structuredClone(l);
    bool.groups[2]!.tags.push({ tagId: 'PUMP1.RUN' });
    const b = addColumns(base, 0, ['PUMP1.RUN'], bool, types());
    expect(b.cfg.reports[0]!.columns[0]!.functions).toEqual(['sum']);
  });

  it('giới hạn 24 cột: cột thừa bị bỏ kèm lý do limit', () => {
    const l = logging();
    const many = structuredClone(l);
    many.groups[2]!.tags = Array.from({ length: 30 }, (_, i) => ({ tagId: `T${i}` }));
    const t = new Map(many.groups[2]!.tags.map((x) => [x.tagId, 'FLOAT32'])) as never;
    const base: ReportsConfig = {
      schemaVersion: '0.1.0',
      reports: [{ id: 'a', name: 'A', group: 'dien', period: 'day', columns: [] }],
    };
    const r = addColumns(
      base,
      0,
      many.groups[2]!.tags.map((x) => x.tagId),
      many,
      t,
    );
    expect(r.cfg.reports[0]!.columns).toHaveLength(24);
    expect(r.rejected.filter((x) => x.reason === 'limit')).toHaveLength(6);
  });

  it('hàm mờ theo kiểu Tag: BOOL không có delta; số có đủ tám hàm', () => {
    expect(fnApplicable('FLOAT64', 'delta')).toBe(true);
    expect(fnApplicable('BOOL', 'delta')).toBe(false);
    expect(fnApplicable('BOOL', 'sum')).toBe(true);
    expect(fnApplicable(undefined, 'delta')).toBe(true);
    for (const f of ['min', 'max', 'avg', 'sum', 'first', 'last', 'delta', 'count'] as const)
      expect(fnApplicable('FLOAT32', f)).toBe(true);
  });

  it('toggleFunction giữ thứ tự chuẩn, không bỏ hàm cuối; setColumnFunctions; sửa nhãn, đơn vị, số lẻ; xóa, di chuyển cột', () => {
    const c = reports0();
    const t1 = toggleFunction(c, 0, 0, 'avg'); // cột 0 đang [delta, max]
    expect(t1.reports[0]!.columns[0]!.functions).toEqual(['max', 'avg', 'delta']);
    expect(
      toggleFunction(toggleFunction(c, 0, 0, 'delta'), 0, 0, 'max').reports[0]!.columns[0]!
        .functions,
    ).toEqual(['max']); // không bỏ hàm cuối
    expect(setColumnFunctions(c, 0, 1, ['min', 'last']).reports[0]!.columns[1]!.functions).toEqual([
      'min',
      'last',
    ]);
    const f = setColumnField(
      setColumnField(setColumnField(c, 0, 0, 'label', 'Điện'), 0, 0, 'unit', ''),
      0,
      0,
      'decimals',
      3,
    );
    expect(f.reports[0]!.columns[0]).toMatchObject({ label: 'Điện', decimals: 3 });
    expect(f.reports[0]!.columns[0]!.unit).toBeUndefined();
    expect(removeColumns(c, 0, [0]).reports[0]!.columns.map((x) => x.tagId)).toEqual(['METER1.KW']);
    expect(moveColumn(c, 0, 0, 1).reports[0]!.columns.map((x) => x.tagId)).toEqual([
      'METER1.KW',
      'METER1.KWH',
    ]);
  });

  it('gợi ý đơn vị theo hàm: kW + tích phân → kWh; BOOL + tích phân → giờ; còn lại giữ đơn vị', () => {
    expect(suggestUnit('sum', 'kW')).toBe('kWh');
    expect(suggestUnit('sum', 'MW')).toBe('MWh');
    expect(suggestUnit('sum', 'W')).toBe('Wh');
    expect(suggestUnit('sum', 'm3/h')).toBe('m3');
    expect(suggestUnit('sum', undefined, 'BOOL')).toBe('giờ');
    expect(suggestUnit('avg', 'kW')).toBe('kW');
    expect(suggestUnit('count', 'kW')).toBe('');
    expect(suggestUnit('delta', 'kWh')).toBe('kWh');
  });
});

describe('lỗi theo ô và tài liệu', () => {
  const run = async (files: Record<string, string>) => {
    const r = await validateProject(new MemorySource(files));
    return [...r.errors, ...r.warnings];
  };

  it('E_RPT_* gắn đúng ô: id trùng, nhóm không có, Tag ngoài nhóm, hàm lặp, quá giới hạn', async () => {
    const c = reports0();
    c.reports[1]!.id = c.reports[0]!.id; // E_RPT_DUP_ID
    c.reports[2]!.group = 'khong-co'; // E_RPT_REF_GROUP
    c.reports[0]!.columns[0]!.tagId = 'PROC.PRESSURE'; // E_RPT_REF_TAG (không thuộc nhóm dien)
    c.reports[0]!.columns[1]!.functions = ['avg', 'avg']; // E_RPT_FN
    const issues = await run({ ...demo(), 'reports.json': JSON.stringify(c) });
    const b = bucketReportIssues(issues, 'reports.json');
    expect(b.hasErrors).toBe(true);
    expect(b.fields.get(1)?.get('id')?.[0]?.code).toBe('E_RPT_DUP_ID');
    expect(b.fields.get(2)?.get('group')?.[0]?.code).toBe('E_RPT_REF_GROUP');
    expect(b.cells.get(0)?.get('0:tag')?.[0]?.code).toBe('E_RPT_REF_TAG');
    expect(b.cells.get(0)?.get('1:fns')?.[0]?.code).toBe('E_RPT_FN');
  });

  it('lỗi hình dạng lạ và lỗi cả file không rơi mất: nằm ở `file`', async () => {
    const issues = await run({
      ...demo(),
      'reports.json': '{"schemaVersion":"0.6.0","reports":"x"}',
    });
    const b = bucketReportIssues(issues, 'reports.json');
    expect(b.hasErrors).toBe(true);
    expect(b.file.length).toBeGreaterThan(0);
  });

  it('một sửa đổi { kind: reports } mỗi thao tác: hoàn tác từng bước; tạo reports.json khi chưa có (thêm reportsFile)', () => {
    const files = demo();
    delete files['reports.json'];
    const p = JSON.parse(files['project.json']!) as Record<string, unknown>;
    delete p.reportsFile;
    delete p.navigation;
    files['project.json'] = JSON.stringify(p);
    let docs = open(files);
    const s0 = snapshotOf(docs);
    docs = applyDocEdits(docs, [reportsEdit(addReport(null, logging()))]);
    expect(filesOf(docs)['project.json']).toMatchObject({ reportsFile: 'reports.json' });
    expect(JSON.parse(writtenText(docs['reports.json']!)).reports).toHaveLength(1);
    const s1 = snapshotOf(docs);
    docs = applyDocEdits(docs, [
      reportsEdit(setReportField(JSON.parse(writtenText(docs['reports.json']!)), 0, 'name', 'X')),
    ]);
    docs = restoreSnapshot(docs, s1);
    expect(JSON.parse(writtenText(docs['reports.json']!)).reports[0].name).not.toBe('X');
    docs = restoreSnapshot(docs, s0);
    expect(filesOf(docs)['project.json']).not.toHaveProperty('reportsFile');
  });
});

describe('lưới cột (adapter của mat-grid)', () => {
  const ctx = () => ({
    cfg: reports0(),
    index: 0,
    logging: logging(),
    types: types(),
    readOnly: false,
  });

  it('cột và chữ ô: Tag, nhãn, đơn vị, số lẻ, hàm (tên tiếng Việt), ghi chú theo kiểu Tag', () => {
    const a = columnsAdapter(ctx());
    expect(a.columns.map((c) => c.key)).toEqual([
      'tag',
      'label',
      'unit',
      'decimals',
      'fns',
      'note',
    ]);
    expect(a.rowCount()).toBe(2);
    expect(a.text(0, 'tag')).toBe('METER1.KWH');
    expect(a.text(0, 'label')).toBe('Điện năng');
    expect(a.text(0, 'unit')).toBe('kWh');
    expect(a.text(0, 'decimals')).toBe('1');
    expect(a.text(0, 'fns')).toBe('Chênh lệch, Lớn nhất');
    expect(a.text(0, 'note')).toBe('FLOAT64');
  });

  it('gõ hàm bằng tên hoặc mã; hàm không áp dụng cho kiểu Tag bị từ chối; hàm lạ bị từ chối', () => {
    const a = columnsAdapter(ctx());
    const ok = a.apply([{ row: 0, col: 'fns', text: 'avg, Nhỏ nhất ; sum' }]);
    expect(ok.rejected).toEqual([]);
    expect(
      (ok.edits[0] as { value: ReportsConfig }).value.reports[0]!.columns[0]!.functions,
    ).toEqual(['avg', 'min', 'sum']);
    expect(a.apply([{ row: 0, col: 'fns', text: 'trung vị' }]).rejected).toHaveLength(1);
    const c = ctx();
    c.cfg.reports[0]!.columns[0]!.tagId = 'PUMP1.RUN'; // BOOL
    c.logging.groups[2]!.tags.push({ tagId: 'PUMP1.RUN' });
    const b = columnsAdapter(c);
    expect(b.apply([{ row: 0, col: 'fns', text: 'delta' }]).rejected).toHaveLength(1);
  });

  it('số lẻ 0–6 nguyên; điền xuống và dán là một sửa đổi; chỉ đọc từ chối mọi thay đổi', () => {
    const a = columnsAdapter(ctx());
    expect(a.apply([{ row: 0, col: 'decimals', text: '7' }]).rejected).toHaveLength(1);
    expect(a.apply([{ row: 0, col: 'decimals', text: '1,5' }]).rejected).toHaveLength(1);
    const two = a.apply([
      { row: 0, col: 'decimals', text: '3' },
      { row: 1, col: 'decimals', text: '3' },
    ]);
    expect(two.edits).toHaveLength(1);
    const v = (two.edits[0] as { value: ReportsConfig }).value.reports[0]!.columns;
    expect(v.map((c) => c.decimals)).toEqual([3, 3]);
    const ro = columnsAdapter({ ...ctx(), readOnly: true });
    expect(ro.apply([{ row: 0, col: 'label', text: 'x' }]).rejected).toHaveLength(1);
    expect(ro.editable(0, 'label')).toBe(false);
  });

  it('kéo Tag từ cây: đổi ô Tag chỉ nhận Tag thuộc nhóm có tổng hợp', () => {
    const a = columnsAdapter(ctx());
    expect(a.apply([{ row: 0, col: 'tag', text: 'METER1.KW' }]).rejected).toEqual([]);
    expect(a.apply([{ row: 0, col: 'tag', text: 'PROC.PRESSURE' }]).rejected).toHaveLength(1);
    expect(a.apply([{ row: 0, col: 'tag', text: '' }]).rejected).toHaveLength(1);
  });
});
