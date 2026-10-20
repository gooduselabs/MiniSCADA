// Sửa logic.json từ sơ đồ (feature 015, T005; spec D4): nối dây thay đúng đoạn nguồn, bọc cổng, xóa dây (gộp toán hạng của
// AND/OR, ô tùy chọn thành null), dây hành động, nhân bản khối (đầu ra theo id mới). Hàm thuần: tài liệu cũ không đổi.
import { describe, expect, it } from 'vitest';
import type { LogicDoc } from '@mat/project-schema';
import { LOGIC_TAGS, pumpLogic } from './logic-fixtures.ts';
import { buildLogicGraph, type LogicGraph } from './logic-graph.ts';
import {
  connectAction,
  duplicateBlock,
  removeWire,
  setSlot,
  slotText,
  wrapSlot,
} from './logic-graph-edit.ts';
import { emptyLayout } from './logic-layout.ts';

const g = (doc: LogicDoc): LogicGraph =>
  buildLogicGraph(doc, { tags: LOGIC_TAGS, layout: emptyLayout() });
const when = (doc: LogicDoc, i: number) => doc.rules![i]!.when;

describe('nối dây', () => {
  it('cả ô: thay biểu thức bằng id Tag; tài liệu cũ không đổi', () => {
    const doc = pumpLogic();
    const next = setSlot(doc, { kind: 'timer', id: 't_start', field: 'in' }, 'PUMP01.RUN');
    expect(next.timers![0]!.in).toBe('PUMP01.RUN');
    expect(doc.timers![0]!.in).toBe('PUMP01.RUN_CMD');
  });

  it('chân của cổng: thay đúng đoạn nguồn (code point)', () => {
    const doc = pumpLogic();
    const slot = {
      kind: 'rule' as const,
      id: 'pump_low_level',
      field: 'when',
      span: [21, 32] as [number, number],
    };
    expect(slotText(doc, slot)).toBe('LOGIC.DAY.Q');
    expect(when(setSlot(doc, slot, 'INT.MODE_AUTO'), 1)).toBe('TANK01.LEVEL < 20 && INT.MODE_AUTO');
    doc.rules![1]!.when = '😀.X || B';
    expect(when(setSlot(doc, { ...slot, span: [0, 3] }, 'C'), 1)).toBe('C || B');
  });
});

describe('bọc cổng từ palette', () => {
  const s = { kind: 'rule' as const, id: 'pump_high_level', field: 'when' };
  it('AND, OR, NOT, so sánh trên cả ô', () => {
    const doc = pumpLogic();
    expect(when(wrapSlot(doc, s, 'and'), 0)).toBe('(TANK01.LEVEL > 80) && true');
    expect(when(wrapSlot(doc, s, 'or'), 0)).toBe('(TANK01.LEVEL > 80) || false');
    expect(when(wrapSlot(doc, s, 'not'), 0)).toBe('!(TANK01.LEVEL > 80)');
    doc.rules![0]!.when = '';
    expect(when(wrapSlot(doc, s, 'cmp'), 0)).toBe('0 > 0');
    expect(when(wrapSlot(doc, s, 'and'), 0)).toBe('false && true');
  });
  it('đoạn trong biểu thức: kết quả trong ngoặc; Tag đơn không thêm ngoặc thừa', () => {
    const doc = pumpLogic();
    const pin = { ...s, id: 'pump_low_level', span: [21, 32] as [number, number] };
    expect(when(wrapSlot(doc, pin, 'not'), 1)).toBe('TANK01.LEVEL < 20 && (!LOGIC.DAY.Q)');
    expect(when(wrapSlot(doc, { ...pin, span: [0, 12] }, 'cmp'), 1)).toBe(
      '(TANK01.LEVEL > 0) < 20 && LOGIC.DAY.Q',
    );
  });
});

describe('xóa dây', () => {
  it('AND hai chân: còn chân kia thay cả cổng', () => {
    const doc = pumpLogic();
    const gr = g(doc);
    const w = gr.wires.find((x) => x.from.node === 's_day')!;
    expect(when(removeWire(doc, gr, w), 1)).toBe('TANK01.LEVEL < 20');
  });
  it('AND ba chân: bỏ một toán hạng', () => {
    const doc = pumpLogic();
    doc.rules![1]!.when = 'PUMP01.RUN && LOGIC.DAY.Q && INT.MODE_AUTO';
    const gr = g(doc);
    const w = gr.wires.find((x) => x.from.node === 's_day')!;
    expect(when(removeWire(doc, gr, w), 1)).toBe('PUMP01.RUN && INT.MODE_AUTO');
  });
  it('chân của so sánh, NOT: thay bằng hằng giữ chỗ', () => {
    const doc = pumpLogic();
    const gr = g(doc);
    const w = gr.wires.find(
      (x) => x.tag === 'TANK01.LEVEL' && x.to.node.startsWith('g:pump_high_level'),
    )!;
    expect(when(removeWire(doc, gr, w), 0)).toBe('0 > 80');
    doc.rules![0]!.when = '!PUMP01.RUN';
    const g2 = g(doc);
    const w2 = g2.wires.find((x) => x.tag === 'PUMP01.RUN' && x.to.node.startsWith('g:'))!;
    expect(when(removeWire(doc, g2, w2), 0)).toBe('!false');
  });
  it('dây vào thẳng cổng của khối: ô bắt buộc thành rỗng, ô tùy chọn thành null', () => {
    const doc = pumpLogic();
    doc.counters![0]!.reset = 'INT.MODE_REQ';
    const gr = g(doc);
    const up = gr.wires.find((x) => x.to.node === 'c_starts' && x.to.port === 'up')!;
    const rs = gr.wires.find((x) => x.to.node === 'c_starts' && x.to.port === 'reset')!;
    expect(removeWire(doc, gr, up).counters![0]!.up).toBe('');
    expect(removeWire(doc, gr, rs).counters![0]!.reset).toBeNull();
  });
  it('dây hành động: bỏ hành động', () => {
    const doc = pumpLogic();
    const gr = g(doc);
    const w = gr.wires.find((x) => x.kind === 'action' && x.from.node === 'pump_high_level')!;
    expect(removeWire(doc, gr, w).rules![0]!.onRise).toEqual([]);
  });
});

describe('hành động và nhân bản', () => {
  it('↑ tới Ghi PLC: write với giá trị cho phép đầu tiên; ↓ tới Tag: setTag true', () => {
    const doc = pumpLogic();
    const a = connectAction(doc, 'pump_high_level', 'onFall', { writes: 'w_pump_run' });
    expect(a.rules![0]!.onFall).toEqual([{ do: 'write', write: 'w_pump_run', value: true }]);
    const b = connectAction(doc, 'pump_high_level', 'onRise', { tag: 'INT.MODE_AUTO' });
    expect(b.rules![0]!.onRise?.[1]).toEqual({ do: 'setTag', tag: 'INT.MODE_AUTO', value: true });
    doc.writes![0]!.allowed = { min: 10, max: 50 };
    expect(
      connectAction(doc, 'pump_high_level', 'onFall', { writes: 'w_pump_run' }).rules![0]!.onFall,
    ).toEqual([{ do: 'write', write: 'w_pump_run', value: 10 }]);
  });

  it('nhân bản: id mới sau khối gốc, đầu ra theo id mới (không trùng Tag)', () => {
    const doc = pumpLogic();
    const r = duplicateBlock(doc, 'timer', 't_start');
    expect(r.id).toBe('t_start_2');
    expect(r.doc.timers?.map((t) => t.id)).toEqual(['t_start', 't_start_2']);
    expect(r.doc.timers![1]).toMatchObject({
      in: 'PUMP01.RUN_CMD',
      pt: 5000,
      q: 'LOGIC.T_START_2.Q',
      et: 'LOGIC.T_START_2.ET',
    });
    const r2 = duplicateBlock(r.doc, 'timer', 't_start');
    expect(r2.id).toBe('t_start_3');
    const w = duplicateBlock(doc, 'rule', 'pump_low_level');
    expect(w.doc.rules![2]!.onRise).toEqual(doc.rules![1]!.onRise);
  });
});
