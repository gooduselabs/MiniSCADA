// Mô hình logic.json của Studio (feature 011, T132/T143; FR-094; contracts/logic-engine.md §1, §11): thêm/sửa/xóa khối,
// đổi id cập nhật mọi tham chiếu, hành động của luật, kiểm khi gõ bằng validator TS (`checkLogic` của @mat/project-schema),
// chỉ lỗi về đúng khối và ô, gợi ý biểu thức có Tag logic; sửa đổi `logicSet` của project-doc tạo logic.json.
import type { LogicDoc } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  LOGIC_KINDS,
  addAction,
  addBlock,
  blockCounts,
  blocksOf,
  checkLogicDoc,
  emptyLogic,
  issueTarget,
  kindOfId,
  logicAssist,
  moveBlock,
  removeAction,
  removeBlock,
  renameBlock,
  retainBytesPerDay,
  suggestId,
  updateAction,
  updateBlock,
  writesUsage,
} from './logic-doc.ts';
import { LOGIC_TAGS, pumpLogic } from './logic-fixtures.ts';
import {
  applyDocEdits,
  filesOf,
  loadDoc,
  outlineOf,
  withEditable,
  type ProjectDoc,
} from './project-doc.ts';

const codes = (doc: LogicDoc) => {
  const r = checkLogicDoc(doc, { tags: LOGIC_TAGS });
  return [...r.errors, ...r.warnings].map((i) => i.code);
};

describe('logic-doc: khối', () => {
  it('logic.json mẫu của trạm bơm không lỗi; bảy nhóm theo thứ tự cây', () => {
    expect(LOGIC_KINDS).toEqual([
      'rule',
      'timer',
      'counter',
      'totalizer',
      'runhours',
      'schedule',
      'writes',
    ]);
    const r = checkLogicDoc(pumpLogic(), { tags: LOGIC_TAGS });
    expect(r.errors).toEqual([]);
    expect(emptyLogic()).toEqual({ schemaVersion: '1.0.0' });
  });

  it('thêm khối: id gợi ý theo tiền tố, không trùng với mọi loại khối; đầu ra mặc định LOGIC.<ID>.*', () => {
    let doc = emptyLogic();
    expect(suggestId(doc, 'rule')).toBe('rule_1');
    const a = addBlock(doc, 'rule');
    doc = a.doc;
    expect(a.id).toBe('rule_1');
    expect(suggestId(doc, 'rule')).toBe('rule_2');
    const t = addBlock(doc, 'timer');
    expect(t.id).toBe('t_1');
    expect(blocksOf(t.doc, 'timer')[0]).toMatchObject({
      id: 't_1',
      kind: 'ton',
      pt: 1000,
      q: 'LOGIC.T_1.Q',
      et: 'LOGIC.T_1.ET',
    });
    const c = addBlock(t.doc, 'counter');
    expect(blocksOf(c.doc, 'counter')[0]).toMatchObject({
      id: 'c_1',
      value: 'LOGIC.C_1.VALUE',
      reached: 'LOGIC.C_1.REACHED',
      retain: true,
    });
    const z = addBlock(c.doc, 'totalizer');
    expect(blocksOf(z.doc, 'totalizer')[0]).toMatchObject({
      id: 'z_1',
      rateUnit: 'h',
      total: 'LOGIC.Z_1.TOTAL',
      gapSeconds: 'LOGIC.Z_1.GAP_S',
    });
    const h = addBlock(z.doc, 'runhours');
    expect(blocksOf(h.doc, 'runhours')[0]).toMatchObject({
      hours: 'LOGIC.H_1.HOURS',
      starts: 'LOGIC.H_1.STARTS',
      due: 'LOGIC.H_1.DUE',
    });
    const s = addBlock(h.doc, 'schedule');
    expect(blocksOf(s.doc, 'schedule')[0]).toMatchObject({
      id: 's_1',
      weekly: [{ days: [1, 2, 3, 4, 5], from: '08:00', to: '17:00' }],
      out: 'LOGIC.S_1.Q',
    });
    const w = addBlock(s.doc, 'writes');
    expect(blocksOf(w.doc, 'writes')[0]).toMatchObject({
      id: 'w_1',
      allowed: { values: [true, false] },
      minIntervalMs: 30000,
      maxPerHour: 20,
    });
    // Id đã có (kể cả loại khác) thì bỏ qua số đó.
    const taken = addBlock(emptyLogic(), 'rule', { id: 't_1' }).doc;
    expect(suggestId(taken, 'timer')).toBe('t_2');
    expect(blockCounts(w.doc)).toEqual({
      rule: 1,
      timer: 1,
      counter: 1,
      totalizer: 1,
      runhours: 1,
      schedule: 1,
      writes: 1,
    });
    // Không đổi tài liệu gốc.
    expect(emptyLogic()).toEqual({ schemaVersion: '1.0.0' });
    expect(blocksOf(doc, 'timer')).toEqual([]);
  });

  it('sửa trường (undefined thì bỏ khóa), xóa khối, chuyển thứ tự; tài liệu cũ giữ nguyên', () => {
    const doc = pumpLogic();
    const next = updateBlock(doc, 'rule', 'pump_low_level', { hold: 2000, name: undefined });
    const r = blocksOf(next, 'rule').find((x) => x.id === 'pump_low_level')!;
    expect(r.hold).toBe(2000);
    expect('name' in r).toBe(false);
    expect(blocksOf(doc, 'rule')[1]!.hold).toBe(10000);
    const gone = removeBlock(next, 'rule', 'pump_high_level');
    expect(blocksOf(gone, 'rule').map((x) => x.id)).toEqual(['pump_low_level']);
    const moved = moveBlock(doc, 'rule', 'pump_low_level', -1);
    expect(blocksOf(moved, 'rule').map((x) => x.id)).toEqual(['pump_low_level', 'pump_high_level']);
    expect(kindOfId(doc, 'z_flow')).toBe('totalizer');
    expect(kindOfId(doc, 'w_pump_run')).toBe('writes');
    expect(kindOfId(doc, 'nope')).toBeNull();
  });

  it('xóa mục Ghi PLC đang được luật dùng: validator báo E_LOGIC_WRITE_UNDECLARED ở hành động', () => {
    const doc = removeBlock(pumpLogic(), 'writes', 'w_pump_run');
    const r = checkLogicDoc(doc, { tags: LOGIC_TAGS });
    expect(r.errors.map((i) => i.code)).toContain('E_LOGIC_WRITE_UNDECLARED');
    const e = r.errors.find((i) => i.code === 'E_LOGIC_WRITE_UNDECLARED')!;
    expect(issueTarget(doc, e.path)).toMatchObject({ kind: 'rule', field: 'onRise', index: 0 });
  });
});

describe('logic-doc: đổi id cập nhật tham chiếu', () => {
  it('đổi id mục writes: mọi hành động write/pulse trỏ theo', () => {
    const r = renameBlock(pumpLogic(), 'w_pump_run', 'w_pump');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const rule of r.doc.rules ?? [])
      for (const a of [...(rule.onRise ?? []), ...(rule.onFall ?? [])])
        expect(a.write).toBe('w_pump');
    expect(codes(r.doc).filter((c) => c.startsWith('E_'))).toEqual([]);
  });

  it('đổi id khối có đầu ra mặc định: đổi Tag đầu ra và mọi biểu thức đọc chúng; đầu ra tự đặt giữ nguyên', () => {
    const r = renameBlock(pumpLogic(), 's_day', 's_work');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // LOGIC.DAY.Q không theo mẫu LOGIC.S_DAY.Q nên giữ nguyên.
    expect(r.tags).toEqual({});
    expect(blocksOf(r.doc, 'schedule')[0]).toMatchObject({ id: 's_work', out: 'LOGIC.DAY.Q' });

    let doc = addBlock(pumpLogic(), 'timer').doc; // t_1, đầu ra LOGIC.T_1.Q
    doc = updateBlock(doc, 'rule', 'pump_low_level', { when: 'LOGIC.T_1.Q && TANK01.LEVEL < 20' });
    const r2 = renameBlock(doc, 't_1', 't_fill');
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.tags).toEqual({ 'LOGIC.T_1.Q': 'LOGIC.T_FILL.Q', 'LOGIC.T_1.ET': 'LOGIC.T_FILL.ET' });
    expect(blocksOf(r2.doc, 'timer').find((x) => x.id === 't_fill')).toMatchObject({
      q: 'LOGIC.T_FILL.Q',
      et: 'LOGIC.T_FILL.ET',
    });
    expect(blocksOf(r2.doc, 'rule').find((x) => x.id === 'pump_low_level')!.when).toBe(
      'LOGIC.T_FILL.Q && TANK01.LEVEL < 20',
    );
  });

  it('id sai dạng, trùng id khác (mọi loại), hoặc không có: từ chối, tài liệu không đổi', () => {
    const doc = pumpLogic();
    expect(renameBlock(doc, 'pump_low_level', 'Bơm')).toEqual({ ok: false, reason: 'format' });
    expect(renameBlock(doc, 'pump_low_level', 't_start')).toEqual({
      ok: false,
      reason: 'duplicate',
    });
    expect(renameBlock(doc, 'nope', 'x_1')).toEqual({ ok: false, reason: 'missing' });
    expect(renameBlock(doc, 'pump_low_level', 'pump_low_level')).toMatchObject({ ok: true });
  });
});

describe('logic-doc: hành động của luật', () => {
  it('thêm, sửa, xóa hành động; đếm ≤ 8 mỗi luật (E_LOGIC_LIMIT)', () => {
    let doc = addAction(pumpLogic(), 'pump_low_level', 'onFall', {
      do: 'setTag',
      tag: 'INT.MODE_AUTO',
      value: false,
    });
    expect(blocksOf(doc, 'rule')[1]!.onFall).toEqual([
      { do: 'setTag', tag: 'INT.MODE_AUTO', value: false },
    ]);
    doc = updateAction(doc, 'pump_low_level', 'onFall', 0, { value: true });
    expect((blocksOf(doc, 'rule')[1]!.onFall as unknown[])[0]).toEqual({
      do: 'setTag',
      tag: 'INT.MODE_AUTO',
      value: true,
    });
    doc = removeAction(doc, 'pump_low_level', 'onFall', 0);
    expect(blocksOf(doc, 'rule')[1]!.onFall).toEqual([]);
    for (let i = 0; i < 8; i++)
      doc = addAction(doc, 'pump_high_level', 'onFall', {
        do: 'setTag',
        tag: 'INT.MODE_REQ',
        value: true,
      });
    expect(codes(doc)).toContain('E_LOGIC_LIMIT');
  });

  it('đổi loại hành động bỏ trường không hợp (write → setTag)', () => {
    const doc = updateAction(pumpLogic(), 'pump_low_level', 'onRise', 0, {
      do: 'setTag',
      tag: 'INT.MODE_AUTO',
      write: undefined,
    });
    expect((blocksOf(doc, 'rule')[1]!.onRise as unknown[])[0]).toEqual({
      do: 'setTag',
      tag: 'INT.MODE_AUTO',
      value: true,
    });
  });

  it('writesUsage: mục writes nào được luật nào dùng', () => {
    expect([...writesUsage(pumpLogic())]).toEqual([
      ['w_pump_run', ['pump_high_level', 'pump_low_level']],
    ]);
  });
});

describe('logic-doc: kiểm khi gõ', () => {
  it('mỗi lần sửa chạy validator TS: Tag lạ, kiểu sai, vòng, tự kích, đầu ra trùng Tag có sẵn', () => {
    const doc = pumpLogic();
    expect(
      codes(updateBlock(doc, 'rule', 'pump_low_level', { when: 'TANK9.LEVEL < 20' })),
    ).toContain('E_LOGIC_TAG_REF');
    expect(
      codes(updateBlock(doc, 'rule', 'pump_low_level', { when: 'TANK01.LEVEL + 1' })),
    ).toContain('E_LOGIC_TYPE');
    expect(codes(updateBlock(doc, 'timer', 't_start', { in: 'LOGIC.T_START.Q' }))).toContain(
      'E_LOGIC_CYCLE',
    );
    const self = addAction(
      updateBlock(doc, 'rule', 'pump_low_level', { when: 'INT.MODE_REQ && !INT.MODE_AUTO' }),
      'pump_low_level',
      'onRise',
      { do: 'setTag', tag: 'INT.MODE_AUTO', value: true },
    );
    expect(codes(self)).toContain('E_LOGIC_SELF_TRIGGER');
    expect(codes(updateBlock(doc, 'timer', 't_start', { q: 'TANK01.LEVEL' }))).toContain(
      'E_LOGIC_TAG_COLLISION',
    );
    expect(codes(updateBlock(doc, 'timer', 't_start', { pt: 80 }))).toContain('W_LOGIC_PT_ROUNDED');
    expect(codes(updateBlock(doc, 'rule', 'pump_low_level', { enabled: false }))).toContain(
      'W_LOGIC_DISABLED',
    );
  });

  it('thiết bị đích đang tắt ghi PLC mà project có writes: W_LOGIC_WRITES_OFF', () => {
    const r = checkLogicDoc(pumpLogic(), { tags: LOGIC_TAGS, deviceWrites: 'off' });
    expect(r.warnings.map((i) => i.code)).toContain('W_LOGIC_WRITES_OFF');
    const on = checkLogicDoc(pumpLogic(), { tags: LOGIC_TAGS, deviceWrites: 'on' });
    expect(on.warnings.map((i) => i.code)).not.toContain('W_LOGIC_WRITES_OFF');
  });

  it('issueTarget: đường dẫn của lỗi → nhóm, id khối, ô (và chỉ số hành động)', () => {
    const doc = pumpLogic();
    expect(issueTarget(doc, '/rules/1/when')).toEqual({
      kind: 'rule',
      id: 'pump_low_level',
      field: 'when',
    });
    expect(issueTarget(doc, '/rules/0/onRise/0/value')).toEqual({
      kind: 'rule',
      id: 'pump_high_level',
      field: 'onRise',
      index: 0,
    });
    expect(issueTarget(doc, '/writes/0/tag')).toEqual({
      kind: 'writes',
      id: 'w_pump_run',
      field: 'tag',
    });
    expect(issueTarget(doc, '/schedules/0/weekly/0/from')).toEqual({
      kind: 'schedule',
      id: 's_day',
      field: 'weekly',
      index: 0,
    });
    expect(issueTarget(doc, '/timers')).toEqual({ kind: 'timer', id: null, field: null });
    expect(issueTarget(doc, '/schemaVersion')).toBeNull();
  });

  it('logicAssist: gợi ý biểu thức có Tag của project và Tag logic (kiểu theo trường đầu ra)', () => {
    const a = logicAssist(LOGIC_TAGS, pumpLogic(), 'BOOL');
    expect(a.target).toBe('BOOL');
    expect(a.tags).toContainEqual({ id: 'TANK01.LEVEL', type: 'FLOAT32' });
    expect(a.tags).toContainEqual({ id: 'LOGIC.DAY.Q', type: 'BOOL' });
    expect(a.tags).toContainEqual({ id: 'LOGIC.C_STARTS.VALUE', type: 'INT64' });
    expect(a.tags).toContainEqual({ id: 'LOGIC.FLOW01.TOTAL', type: 'FLOAT64' });
  });

  it('ước tính ghi retain (contract §9, cùng công thức với validator): (mục × 24 + 512 + 4 KiB) × 86400/flushS', () => {
    // 2 luật (edgeId) + 3 khối retain (counter, totalizer, giờ chạy), flushS 60.
    expect(retainBytesPerDay(pumpLogic(), 60)).toBe((5 * 24 + 512 + 4096) * 1440);
    expect(retainBytesPerDay(emptyLogic(), 60)).toBe(0);
  });
});

describe('project-doc: sửa đổi logicSet', () => {
  const base = (): Record<string, ProjectDoc> => {
    const files: Record<string, string> = {
      'project.json': JSON.stringify({
        format: 'matscada-project',
        schemaVersion: '1.0.0',
        projectId: 'p',
        projectName: 'P',
        projectVersion: '1.0.0',
        minRuntimeVersion: '1.0.0',
        entryScreen: 'main',
        screens: [],
        tagFile: 'tags.json',
        maxClients: 5,
      }),
      'tags.json': JSON.stringify({ schemaVersion: '0.2.0', tags: LOGIC_TAGS }),
    };
    const docs: Record<string, ProjectDoc> = {};
    for (const [rel, text] of Object.entries(files))
      docs[rel] = loadDoc(rel, text, `h:${rel}`, false, rel === 'tags.json' ? 'tags02' : undefined);
    return withEditable(docs);
  };

  it('lần đầu tạo logic.json và thêm `logic` vào project.json; lần sau thay nội dung; outline đọc được', () => {
    const docs = base();
    const once = applyDocEdits(docs, [{ kind: 'logicSet', doc: pumpLogic() }]);
    expect(once['logic.json']?.value).toEqual(pumpLogic());
    expect((once['project.json']?.value as Record<string, unknown>).logic).toBe('logic.json');
    const o = outlineOf(filesOf(once));
    expect(o.logicFile).toBe('logic.json');
    expect(o.logic?.rules?.length).toBe(2);
    const docs2 = withEditable(once);
    expect(docs2['logic.json']?.editable).toBe(true);
    const doc = removeBlock(pumpLogic(), 'rule', 'pump_high_level');
    const twice = applyDocEdits(docs2, [{ kind: 'logicSet', doc }]);
    expect((twice['logic.json']?.value as LogicDoc).rules?.length).toBe(1);
  });
});
