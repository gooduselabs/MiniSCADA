// Tài liệu alarm của Studio (T067, FR-074, FR-075, FR-082, FR-084; US2 kịch bản 3, 4, 10): đọc và ghi ổn định, sửa ô, điền xuống,
// dán, thêm, xóa, nhân bản, "Tạo alarm cho Tag…", đổi tên Tag, chỗ dùng lớp và khu vực, ánh xạ lỗi → ô, 500 dòng dán.
import {
  formatAlarmClassesFile,
  formatAlarmsFile,
  type AlarmDef,
  type Issue,
} from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  addArea,
  addAlarm,
  alarmDocOf,
  alarmFromCells,
  applyCell,
  cellText,
  changeAreaId,
  ctxOf,
  defaultClasses,
  docEdits,
  duplicateAlarms,
  fillDown,
  incrementName,
  insertAlarms,
  instanceCount,
  issueCell,
  issuesByCell,
  newAlarm,
  quickCreate,
  quickDefaults,
  removeAlarms,
  removeArea,
  removeClass,
  renameTagRefs,
  setCells,
  suggestAreaId,
  suggestThreshold,
  tagFits,
  tagLiteOf,
  usageOfArea,
  usageOfClass,
  usageOfTag,
  type AlarmDoc,
} from './alarm-doc.ts';
import {
  applyDocEdits,
  loadDoc,
  outlineOf,
  filesOf,
  snapshotOf,
  type ProjectDocs,
} from './project-doc.ts';

const CLASSES = defaultClasses();
const base = (alarms: AlarmDef[] = [], areas: AlarmDoc['areas'] = []): AlarmDoc => ({
  areas,
  alarms,
  classes: CLASSES,
});
const LEVEL = tagLiteOf({
  id: 'TANK01.LEVEL',
  kind: 'internal',
  type: 'FLOAT32',
  unit: '%',
  min: 0,
  max: 100,
});
const FAULT = tagLiteOf({ id: 'PUMP1.FAULT', kind: 'internal', type: 'BOOL' });
const CTX = ctxOf(
  [
    { id: 'TANK01.LEVEL', kind: 'internal', type: 'FLOAT32', min: 0, max: 100 },
    { id: 'PUMP1.FAULT', kind: 'internal', type: 'BOOL' },
  ],
  ['plc1'],
);
const limitAlarm = (id = 'TL'): AlarmDef => ({
  id,
  type: 'limit',
  name: 'Mức bồn',
  tag: 'TANK01.LEVEL',
  limits: { H: { value: 80, class: 'minor' }, HH: { value: 90, class: 'critical' } },
  deadband: 2,
  onDelayMs: 3000,
});
const digitalAlarm = (id = 'PF'): AlarmDef => ({
  id,
  type: 'digital',
  name: 'Bơm lỗi',
  tag: 'PUMP1.FAULT',
  trigger: true,
  class: 'major',
});

describe('đọc và ghi ổn định', () => {
  it('không có file thì tài liệu rỗng; docEdits không tạo file rỗng', () => {
    const empty = alarmDocOf({});
    expect(empty).toEqual({ areas: [], alarms: [], classes: [] });
    expect(docEdits(empty, empty, '0.5.0', { alarms: false, classes: false })).toEqual([]);
  });

  it('thêm alarm đầu tiên: tạo alarms.json và alarm-classes.json kèm bốn lớp mặc định', () => {
    const empty = alarmDocOf({});
    const next = addAlarm(empty, digitalAlarm());
    const edits = docEdits(empty, next, '0.5.0', { alarms: false, classes: false });
    expect(edits.map((e) => e.kind)).toEqual(['alarmsSet', 'alarmClassesSet']);
    const cls = edits[1];
    expect(cls?.kind === 'alarmClassesSet' && cls.doc?.classes.map((c) => c.id)).toEqual([
      'critical',
      'major',
      'minor',
      'advisory',
    ]);
  });

  it('bốn lớp mặc định khớp data-model §2', () => {
    expect(
      CLASSES.map((c) => [c.id, c.color, !!c.blink, c.requiresAck !== false, c.sound]),
    ).toEqual([
      ['critical', 'red', true, true, 'siren'],
      ['major', 'orange', true, true, 'double'],
      ['minor', 'amber', false, true, 'beep'],
      ['advisory', 'blue', false, false, 'none'],
    ]);
  });

  it('ghi ổn định: thứ tự khóa chuẩn, không ghi mặc định, mỗi alarm một dòng; vòng đọc ghi giữ nguyên byte', () => {
    const doc = base(
      [limitAlarm(), { ...digitalAlarm(), enabled: true, onDelayMs: 0 } as AlarmDef],
      [{ id: 'bom', name: 'Trạm bơm' }],
    );
    const edits = docEdits(alarmDocOf({}), doc, '0.5.0', { alarms: false, classes: false });
    const file = edits[0];
    const text = formatAlarmsFile((file as unknown as { doc: never }).doc);
    expect(text).toBe(formatAlarmsFile(JSON.parse(text)));
    expect(text).not.toMatch(/"enabled"/);
    expect(text).not.toMatch(/"onDelayMs":0/);
    expect(text.split('\n').filter((l) => l.includes('"id":"')).length).toBe(3); // 1 khu vực + 2 alarm
    const cls = formatAlarmClassesFile((edits[1] as unknown as { doc: never }).doc);
    expect(cls).not.toMatch(/"chatterLimit"/);
    expect(cls).not.toMatch(/"ackReturn"/);
  });

  it('applyDocEdits nạp hai file vào tài liệu project 0.5 và hoàn tác bằng snapshot bỏ file mới', () => {
    const project = JSON.stringify({ schemaVersion: '0.5.0', tagFile: 'tags.json' });
    const docs: ProjectDocs = {
      'project.json': { ...loadDoc('project.json', project, 'h1', true), editable: true },
      'tags.json': loadDoc(
        'tags.json',
        JSON.stringify({ schemaVersion: '0.5.0', tags: [] }),
        'h2',
        true,
      ),
    };
    const before = snapshotOf(docs);
    const next = applyDocEdits(
      docs,
      docEdits(alarmDocOf({}), base([digitalAlarm()]), '0.5.0', { alarms: false, classes: false }),
    );
    const pj = next['project.json']?.value as { alarmFile?: string; alarmClassFile?: string };
    expect(pj.alarmFile).toBe('alarms.json');
    expect(pj.alarmClassFile).toBe('alarm-classes.json');
    expect(Object.keys(next)).toContain('alarms.json');
    expect(next['alarms.json']?.created).toBe(true);
    const outline = outlineOf(filesOf(next));
    expect(outline.v05).toBe(true);
    expect(outline.alarms?.alarms).toHaveLength(1);
    expect(outline.alarmClasses?.classes).toHaveLength(4);
    expect(snapshotOf(next)).not.toBe(before);
  });
});

describe('ô của lưới', () => {
  it('chữ của ô: loại, điều kiện, ngưỡng, trễ theo giây, lớp theo tên', () => {
    const d = base([limitAlarm(), digitalAlarm()]);
    expect(cellText(d.alarms[0], 'type', d)).toBe('Ngưỡng');
    expect(cellText(d.alarms[0], 'H', d)).toBe('80');
    expect(cellText(d.alarms[0], 'LL', d)).toBe('');
    expect(cellText(d.alarms[0], 'onDelay', d)).toBe('3');
    expect(cellText(d.alarms[0], 'class', d)).toBe('HH: Khẩn cấp, H: Nhỏ');
    expect(cellText(d.alarms[1], 'cond', d)).toBe('Khi bật');
    expect(cellText(d.alarms[1], 'class', d)).toBe('Quan trọng');
    expect(cellText(d.alarms[1], 'H', d)).toBe('');
  });

  it('sửa ô số: ngưỡng, trễ giây lưu mili-giây, dấu phẩy, chữ sai kiểu vẫn giữ để thấy lỗi', () => {
    const d = base([limitAlarm()]);
    let r = applyCell(d.alarms[0]!, 'L', '15,5', d, CTX);
    expect(r.def).toMatchObject({ limits: { L: { value: 15.5, class: 'minor' } } });
    r = applyCell(d.alarms[0]!, 'onDelay', '1,5', d, CTX);
    expect(r.def).toMatchObject({ onDelayMs: 1500 });
    r = applyCell(d.alarms[0]!, 'H', 'abc', d, CTX);
    expect(r.def).toMatchObject({ limits: { H: { value: 'abc' } } });
    r = applyCell(d.alarms[0]!, 'H', '', d, CTX);
    expect((r.def as { limits: object }).limits).not.toHaveProperty('H');
  });

  it('ô không áp dụng bị từ chối; đổi loại xóa trường không áp dụng và báo mất gì', () => {
    const d = base([digitalAlarm()]);
    expect(applyCell(d.alarms[0]!, 'HH', '90', d, CTX).error).toBe('alarm.err.notApplicable');
    const r = applyCell(limitAlarm(), 'type', 'Số', d, CTX);
    expect(r.def).toMatchObject({ type: 'digital', trigger: true });
    expect(r.def).not.toHaveProperty('limits');
    expect(r.lost).toEqual(expect.arrayContaining(['limits', 'deadband']));
  });

  it('lớp của alarm ngưỡng: một lớp đặt cho mọi ngưỡng, "HH: x, H: y" đặt riêng', () => {
    const d = base([limitAlarm()]);
    let r = applyCell(d.alarms[0]!, 'class', 'Quan trọng', d, CTX);
    expect(r.def).toMatchObject({ limits: { H: { class: 'major' }, HH: { class: 'major' } } });
    r = applyCell(d.alarms[0]!, 'class', 'HH: critical, H: advisory', d, CTX);
    expect(r.def).toMatchObject({
      limits: { H: { class: 'advisory' }, HH: { class: 'critical' } },
    });
  });

  it('Tag / Thiết bị của alarm quality: Tag thắng thiết bị trùng tên; thiết bị thì bỏ tag', () => {
    const d = base([{ id: 'Q1', type: 'quality', name: 'q', tag: 'TANK01.LEVEL', class: 'minor' }]);
    const r = applyCell(d.alarms[0]!, 'tag', 'plc1', d, CTX);
    expect(r.def).toMatchObject({ device: 'plc1' });
    expect(r.def).not.toHaveProperty('tag');
    expect(applyCell(d.alarms[0]!, 'cond', 'BAD hoặc UNCERTAIN', d, CTX).def).toMatchObject({
      on: 'notGood',
    });
  });

  it('khu vực: "Chung" bỏ khóa, tên hoặc id đều nhận', () => {
    const d = base(
      [{ ...digitalAlarm(), area: 'bom' } as AlarmDef],
      [{ id: 'bom', name: 'Trạm bơm' }],
    );
    expect(cellText(d.alarms[0], 'area', d)).toBe('Trạm bơm');
    expect(applyCell(d.alarms[0]!, 'area', 'Chung', d, CTX).def).not.toHaveProperty('area');
    expect(applyCell(d.alarms[0]!, 'area', 'tram bom', d, CTX).def).toMatchObject({ area: 'bom' });
  });
});

describe('thao tác: điền xuống, dán, thêm, xóa, nhân bản', () => {
  it('Id điền xuống tăng dần; ô không áp dụng bị bỏ qua và đếm', () => {
    const d = base([
      { ...digitalAlarm('TANK_01') },
      digitalAlarm('B'),
      limitAlarm('C'),
      digitalAlarm('D'),
    ]);
    const r = fillDown(d, 'id', 0, [1, 2, 3], CTX);
    expect(r.doc.alarms.map((a) => a.id)).toEqual(['TANK_01', 'TANK_02', 'TANK_03', 'TANK_04']);
    const f = fillDown(
      base([{ ...limitAlarm('A') }, digitalAlarm('B'), limitAlarm('C')]),
      'HH',
      0,
      [1, 2],
      CTX,
    );
    expect(f.skipped).toBe(1);
    expect(f.doc.alarms[2]).toMatchObject({ limits: { HH: { value: 90 } } });
    expect(incrementName('TANK_09', 1)).toBe('TANK_10');
  });

  it('dán nhiều dòng: loại theo ô ngưỡng, giá trị sai kiểu vẫn vào', () => {
    const d = base();
    const a = alarmFromCells(
      d,
      { id: 'X1', name: 'X', tag: 'TANK01.LEVEL', H: '80', class: 'minor' },
      CTX,
    );
    expect(a.def).toMatchObject({ type: 'limit', limits: { H: { value: 80, class: 'minor' } } });
    const b = alarmFromCells(
      d,
      { type: 'Số', tag: 'PUMP1.FAULT', cond: 'Khi tắt', class: 'major' },
      CTX,
    );
    expect(b.def).toMatchObject({ type: 'digital', trigger: false, class: 'major' });
    const c = alarmFromCells(
      d,
      { type: 'Quality', tag: 'TANK01.LEVEL', class: 'minor', onDelay: 'xyz' },
      CTX,
    );
    expect(c.def).toMatchObject({ type: 'quality', onDelayMs: 'xyz' });
  });

  it('500 dòng dán: vượt 500 instance thì dừng và đếm số dòng bỏ; một lần thao tác', () => {
    let d = base();
    const defs: AlarmDef[] = [];
    for (let i = 0; i < 520; i++) defs.push({ ...digitalAlarm(`A${String(i).padStart(3, '0')}`) });
    const t0 = performance.now();
    const r = insertAlarms(d, defs);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.added).toBe(500);
    expect(r.dropped).toBe(20);
    expect(instanceCount(r.doc.alarms)).toBe(500);
    d = r.doc;
    expect(insertAlarms(d, [digitalAlarm('MORE')]).dropped).toBe(1);
  });

  it('instance: mỗi ngưỡng một; alarm tắt không tính', () => {
    expect(
      instanceCount([
        limitAlarm(),
        digitalAlarm(),
        { ...digitalAlarm('Z'), enabled: false } as AlarmDef,
      ]),
    ).toBe(3);
  });

  it('thêm: id gợi ý không trùng; xóa; nhân bản có id mới', () => {
    let d = base([newAlarm(base())]);
    d = addAlarm(d);
    expect(d.alarms.map((a) => a.id)).toEqual(['ALARM_001', 'ALARM_002']);
    expect(removeAlarms(d, [0]).alarms.map((a) => a.id)).toEqual(['ALARM_002']);
    const dup = duplicateAlarms(d, [0, 1]);
    expect(dup.doc.alarms.map((a) => a.id)).toEqual([
      'ALARM_001',
      'ALARM_002',
      'ALARM_001_COPY',
      'ALARM_002_COPY',
    ]);
    expect(dup.added).toEqual([2, 3]);
  });

  it('nhiều ô một lần (setCells): đổi loại trước, rồi các ô cùng dòng', () => {
    const d = base([digitalAlarm()]);
    const r = setCells(
      d,
      [
        { row: 0, col: 'H', text: '70' },
        { row: 0, col: 'type', text: 'Ngưỡng' },
        { row: 9, col: 'name', text: 'x' },
      ],
      CTX,
    );
    expect(r.doc.alarms[0]).toMatchObject({ type: 'limit', limits: { H: { value: 70 } } });
    expect(r.rejected.map((x) => x.reason)).toEqual(['alarm.err.row']);
  });
});

describe('Tạo alarm cho Tag (FR-075)', () => {
  it('Tag 0 đến 100: H = 80, HH = 90, deadband 2 %, trễ 3 s, lớp gợi ý', () => {
    const q = quickDefaults(LEVEL, CLASSES);
    expect(q.kind).toBe('limit');
    expect(q.thresholds?.H).toEqual({ value: 80, class: 'minor' });
    expect(q.thresholds?.HH).toEqual({ value: 90, class: 'critical' });
    expect(q.thresholds?.L).toBeNull();
    expect(q.deadband).toBe(2);
    expect(suggestThreshold(LEVEL, 'LL')).toBe(10);
    expect(
      suggestThreshold(tagLiteOf({ id: 'X', kind: 'internal', type: 'FLOAT32' }), 'H'),
    ).toBeUndefined();
  });

  it('tạo một alarm ngưỡng từ Tag, id chuẩn hóa, thêm bốn lớp khi project chưa có lớp', () => {
    const empty: AlarmDoc = { areas: [], alarms: [], classes: [] };
    const r = quickCreate(empty, [quickDefaults(LEVEL, [])]);
    expect(r.added).toEqual([0]);
    expect(r.doc.classes).toHaveLength(4);
    expect(r.doc.alarms[0]).toMatchObject({
      id: 'TANK01_LEVEL',
      type: 'limit',
      tag: 'TANK01.LEVEL',
      deadband: 2,
      onDelayMs: 3000,
      offDelayMs: 3000,
      limits: { H: { value: 80, class: 'minor' }, HH: { value: 90, class: 'critical' } },
    });
  });

  it('nhiều Tag: id trùng thêm _2; quality thêm _COMM; loại không hợp Tag bị chặn', () => {
    const a = quickDefaults(LEVEL, CLASSES);
    const r = quickCreate(base(), [
      a,
      a,
      { ...quickDefaults(LEVEL, CLASSES), kind: 'quality', class: 'minor' },
    ]);
    expect(r.doc.alarms.map((x) => x.id)).toEqual([
      'TANK01_LEVEL',
      'TANK01_LEVEL_2',
      'TANK01_LEVEL_COMM',
    ]);
    const bad = quickCreate(base(), [{ ...quickDefaults(FAULT, CLASSES), kind: 'limit' }]);
    expect(bad.added).toEqual([]);
    expect(bad.skipped[0]?.reason).toBe('alarm.quick.err.type.limit');
    expect(tagFits(FAULT, 'digital')).toBe(true);
    expect(tagFits(FAULT, 'limit')).toBe(false);
  });

  it('vượt 500 instance thì chặn cả đợt', () => {
    const many = Array.from({ length: 500 }, (_, i) => digitalAlarm(`A${i}`));
    const r = quickCreate(base(many), [quickDefaults(LEVEL, CLASSES)]);
    expect(r.blocked).toBe('alarm.quick.err.over500');
    expect(r.doc.alarms).toHaveLength(500);
  });
});

describe('tham chiếu chéo (FR-082)', () => {
  it('đổi tên Tag cập nhật mọi alarm; chỗ dùng Tag, lớp, khu vực liệt kê', () => {
    const d = base(
      [limitAlarm(), digitalAlarm(), { ...digitalAlarm('PF2'), area: 'bom' } as AlarmDef],
      [{ id: 'bom', name: 'Bơm' }],
    );
    const r = renameTagRefs(d, 'TANK01.LEVEL', 'TANK01.MUC');
    expect(r.count).toBe(1);
    expect(r.doc.alarms[0]).toMatchObject({ tag: 'TANK01.MUC' });
    expect(usageOfTag(d, 'PUMP1.FAULT').map((u) => u.id)).toEqual(['PF', 'PF2']);
    expect(usageOfClass(d, 'critical')).toEqual([
      { row: 0, id: 'TL', type: 'limit', threshold: 'HH' },
    ]);
    expect(usageOfArea(d, 'bom').map((u) => u.id)).toEqual(['PF2']);
  });

  it('xóa lớp đang dùng để lại chỗ dùng tham chiếu mất (E_ALARM_CLASS_REF do bộ kiểm tra); xóa khu vực đưa alarm về Chung', () => {
    const d = base(
      [digitalAlarm(), { ...digitalAlarm('PF2'), area: 'bom' } as AlarmDef],
      [{ id: 'bom', name: 'Bơm' }],
    );
    expect(removeClass(d, 'major').classes.map((c) => c.id)).not.toContain('major');
    expect(usageOfClass(removeClass(d, 'major'), 'major')).toHaveLength(2);
    const a = removeArea(d, 'bom');
    expect(a.areas).toEqual([]);
    expect(a.alarms[1]).not.toHaveProperty('area');
  });

  it('khu vực: id gợi ý bỏ dấu; đổi id cập nhật alarm', () => {
    expect(suggestAreaId('Trạm bơm số 1', new Set())).toBe('tram-bom-so-1');
    expect(suggestAreaId('Trạm bơm số 1', new Set(['tram-bom-so-1']))).toBe('tram-bom-so-1-2');
    const r = addArea(base(), 'Khu A');
    expect('doc' in r && r.doc.areas[0]).toEqual({ id: 'khu-a', name: 'Khu A' });
    const d = base([{ ...digitalAlarm(), area: 'bom' } as AlarmDef], [{ id: 'bom', name: 'Bơm' }]);
    expect(changeAreaId(d, 'bom', 'bom-1').alarms[0]).toMatchObject({ area: 'bom-1' });
  });
});

describe('Issue → ô (issueCell, issuesByCell)', () => {
  const cases: Array<[string, unknown]> = [
    ['/alarms/3/id', { kind: 'cell', row: 3, col: 'id' }],
    ['/alarms/3/tag', { kind: 'cell', row: 3, col: 'tag' }],
    ['/alarms/3/device', { kind: 'cell', row: 3, col: 'tag' }],
    ['/alarms/3/trigger', { kind: 'cell', row: 3, col: 'cond' }],
    ['/alarms/3/on', { kind: 'cell', row: 3, col: 'cond' }],
    ['/alarms/3/limits/H/value', { kind: 'cell', row: 3, col: 'H', threshold: 'H' }],
    ['/alarms/3/limits/HH/class', { kind: 'cell', row: 3, col: 'class', threshold: 'HH' }],
    ['/alarms/3/limits/L/text', { kind: 'cell', row: 3, col: 'text', threshold: 'L' }],
    ['/alarms/3/limits', { kind: 'cell', row: 3, col: 'H' }],
    ['/alarms/3/deadband', { kind: 'cell', row: 3, col: 'deadband' }],
    ['/alarms/3/onDelayMs', { kind: 'cell', row: 3, col: 'onDelay' }],
    ['/alarms/3/offDelayMs', { kind: 'cell', row: 3, col: 'offDelay' }],
    ['/alarms/3/area', { kind: 'cell', row: 3, col: 'area' }],
    ['/alarms/3/class', { kind: 'cell', row: 3, col: 'class' }],
    ['/alarms/3/text', { kind: 'cell', row: 3, col: 'text' }],
    ['/alarms/3', { kind: 'row', row: 3 }],
    ['/classes/1/color', { kind: 'class', row: 1, field: 'color' }],
    ['/areas/2/id', { kind: 'area', row: 2, field: 'id' }],
    ['/alarms', { kind: 'status' }],
    ['', { kind: 'status' }],
  ];
  it.each(cases)('%s', (path, expected) => {
    expect(issueCell({ path })).toEqual(expected);
  });

  it('gom lỗi và cảnh báo theo ô và dòng', () => {
    const issues: Issue[] = [
      {
        code: 'E_ALARM_LIMIT_ORDER',
        file: 'alarms.json',
        path: '/alarms/0/limits/H/value',
        message: 'm',
      },
      { code: 'W_ALARM_CHATTER_RISK', file: 'alarms.json', path: '/alarms/1', message: 'm' },
      { code: 'E_ALARM_COUNT', file: 'alarms.json', path: '/alarms', message: 'm' },
      { code: 'E_TAG_RANGE', file: 'tags.json', path: '/tags/0', message: 'm' },
    ];
    const r = issuesByCell(issues, 'alarms.json', (i) => i.code);
    expect(r.errors.get('0:H')).toEqual(['E_ALARM_LIMIT_ORDER']);
    expect(r.warns.get('1:id')).toEqual(['W_ALARM_CHATTER_RISK']);
    expect(r.status.map((i) => i.code)).toEqual(['E_ALARM_COUNT']);
    expect(r.rows.get(0)).toBe('error');
    expect(r.rows.get(1)).toBe('warn');
  });
});
