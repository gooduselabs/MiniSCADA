// Mô phỏng "Thử logic" (feature 011, T132/T143; FR-094; mockup studio-logic.html cảnh 2): chạy @mat/logic-engine (bản TS,
// cùng vector với core/logic) trên Tag mô phỏng của 006 bằng đồng hồ ảo; đặt tay giá trị và quality; giờ thực giả lập cho
// lịch; tua ×1/×10/×100 vẫn quét đủ từng chu kỳ; lệnh ghi chỉ áp vào Tag mô phỏng và ghi nhật ký (không gửi thiết bị).
import { describe, expect, it } from 'vitest';
import { addAction, addBlock, updateBlock } from './logic-doc.ts';
import { LOGIC_TAGS, pumpLogic } from './logic-fixtures.ts';
import { LOGIC_SIM_SPEEDS, LogicSim } from './logic-sim.ts';

/** Thứ Năm 2026-10-15 08:00 giờ thiết bị (UTC+07:00): trong khung lịch s_day. */
const THU_8H = Date.UTC(2026, 9, 15, 1, 0, 0);

function sim(doc = pumpLogic(), extra: Partial<ConstructorParameters<typeof LogicSim>[0]> = {}) {
  return new LogicSim({ doc, tags: LOGIC_TAGS, epoch0: THU_8H, ...extra });
}

const scansFor = (ms: number) => Math.round(ms / 100);

describe('LogicSim: chạy engine trên Tag mô phỏng', () => {
  it('mức xuống 15 %: giữ 10 s rồi luật bơm tự bật ghi true (chỉ vào Tag mô phỏng, có nhật ký)', () => {
    const s = sim();
    expect(s.error).toBeNull();
    expect(s.inputs).toEqual(['FLOW01', 'PUMP01.RUN', 'PUMP01.RUN_CMD', 'TANK01.LEVEL']);
    s.setManual('TANK01.LEVEL', { value: 50, quality: 'GOOD' });
    s.run(scansFor(1000));
    expect(s.value('LOGIC.DAY.Q')).toEqual({ value: true, quality: 'GOOD' });
    s.setManual('TANK01.LEVEL', { value: 15, quality: 'GOOD' });
    s.run(scansFor(9900));
    expect(s.log).toEqual([]);
    s.run(scansFor(300));
    expect(s.log).toHaveLength(1);
    expect(s.log[0]).toMatchObject({
      rule: 'pump_low_level',
      do: 'write',
      write: 'w_pump_run',
      tag: 'PUMP01.RUN_CMD',
      value: true,
      result: 'QUEUED',
      edge: 'rise',
    });
    expect(s.stats).toEqual({ writes: 1, rejected: 0, suppressed: 0 });
    expect(s.value('PUMP01.RUN_CMD')).toEqual({ value: true, quality: 'GOOD' });
    // timer ton t_start: PUMP01.RUN_CMD giữ 5 s thì q = true.
    s.run(scansFor(5100));
    expect(s.value('LOGIC.T_START.Q')?.value).toBe(true);
  });

  it('quality BAD của đầu vào: luật SUSPENDED (INPUT_BAD), không bắn cạnh giả khi trở lại', () => {
    const s = sim();
    s.setManual('TANK01.LEVEL', { value: 50, quality: 'GOOD' });
    s.run(10);
    s.setManual('TANK01.LEVEL', { value: 50, quality: 'BAD' });
    s.run(1);
    expect(s.state('pump_high_level')).toMatchObject({ state: 'SUSPENDED', reason: 'INPUT_BAD' });
    s.setManual('TANK01.LEVEL', { value: 50, quality: 'GOOD' });
    s.run(5);
    expect(s.state('pump_high_level').state).toBe('OK');
    expect(s.log).toEqual([]);
  });

  it('giờ chưa đồng bộ: lịch BAD TIME_NOT_SYNCED, luật phụ thuộc SUSPENDED; nhảy giờ thực không đổi đồng hồ monotonic', () => {
    const s = sim();
    s.setManual('TANK01.LEVEL', { value: 15, quality: 'GOOD' });
    s.setSynced(false);
    s.run(2);
    expect(s.value('LOGIC.DAY.Q')).toMatchObject({ quality: 'BAD', reason: 'TIME_NOT_SYNCED' });
    expect(s.state('pump_low_level')).toMatchObject({
      state: 'SUSPENDED',
      reason: 'TIME_NOT_SYNCED',
    });
    s.setSynced(true);
    const t = s.t;
    s.jumpWall(Date.UTC(2026, 9, 15, 12, 0, 0)); // 19:00 giờ thiết bị: ngoài khung
    expect(s.t).toBe(t);
    s.run(1);
    expect(s.value('LOGIC.DAY.Q')).toEqual({ value: false, quality: 'GOOD' });
  });

  it('chạm giới hạn minIntervalMs 30 s: lệnh thứ hai REJECTED RATE_LIMITED, luật THROTTLED', () => {
    const s = sim();
    s.setManual('TANK01.LEVEL', { value: 50, quality: 'GOOD' });
    s.run(10);
    s.setManual('TANK01.LEVEL', { value: 85, quality: 'GOOD' });
    s.run(scansFor(5100));
    s.setManual('TANK01.LEVEL', { value: 50, quality: 'GOOD' });
    s.run(scansFor(5100));
    s.setManual('TANK01.LEVEL', { value: 85, quality: 'GOOD' });
    s.run(scansFor(5100));
    expect(s.log.map((l) => l.result)).toEqual(['RATE_LIMITED', 'QUEUED']);
    expect(s.stats).toMatchObject({ writes: 1, rejected: 1 });
    expect(s.state('pump_high_level').state).toBe('THROTTLED');
  });

  it('logic.writes = off: hành động write thành SUPPRESSED, Tag mô phỏng không đổi', () => {
    const s = sim(pumpLogic(), { writes: 'off' });
    s.setManual('TANK01.LEVEL', { value: 50, quality: 'GOOD' });
    s.run(10);
    s.setManual('TANK01.LEVEL', { value: 85, quality: 'GOOD' });
    s.run(scansFor(5100));
    expect(s.log[0]).toMatchObject({ result: 'SUPPRESSED' });
    expect(s.stats).toEqual({ writes: 0, rejected: 0, suppressed: 1 });
  });

  it('setTag vào Tag nội bộ: có hiệu lực ở quét sau trên Tag mô phỏng', () => {
    let doc = addBlock(pumpLogic(), 'rule', { id: 'mode_latch' }).doc;
    doc = updateBlock(doc, 'rule', 'mode_latch', { when: 'INT.MODE_REQ', hold: 0 });
    doc = addAction(doc, 'mode_latch', 'onRise', {
      do: 'setTag',
      tag: 'INT.MODE_AUTO',
      value: true,
    });
    const s = sim(doc);
    s.setManual('INT.MODE_REQ', { value: false, quality: 'GOOD' });
    s.run(2);
    s.setManual('INT.MODE_REQ', { value: true, quality: 'GOOD' });
    s.run(1);
    expect(s.log[0]).toMatchObject({ rule: 'mode_latch', do: 'setTag', result: 'OK' });
    s.run(1);
    expect(s.value('INT.MODE_AUTO')?.value).toBe(true);
  });

  it('tua ×1/×10/×100: mỗi 100 ms thật chạy đúng `speed` lần quét 100 ms (không gộp bước)', () => {
    expect(LOGIC_SIM_SPEEDS).toEqual([1, 10, 100]);
    const s = sim();
    expect(s.advanceRealMs(250)).toBe(2);
    expect(s.advanceRealMs(50)).toBe(1);
    s.speed = 10;
    expect(s.advanceRealMs(100)).toBe(10);
    s.speed = 100;
    expect(s.advanceRealMs(100)).toBe(100);
    expect(s.scans).toBe(113);
    expect(s.t).toBe(11200);
  });

  it('đường thời gian: mẫu theo nhịp của tốc độ, có giá trị đầu vào, đầu ra, trạng thái luật và dấu lệnh ghi', () => {
    const s = sim();
    s.setManual('TANK01.LEVEL', { value: 50, quality: 'GOOD' });
    s.run(10);
    s.setManual('TANK01.LEVEL', { value: 85, quality: 'GOOD' });
    s.run(scansFor(6000));
    expect(s.history.length).toBeGreaterThan(10);
    const last = s.history[s.history.length - 1]!;
    expect(last.values['TANK01.LEVEL']).toEqual({ value: 85, quality: 'GOOD' });
    expect(last.rules['pump_high_level']).toMatchObject({ state: 'OK', cond: true });
    expect(s.marks).toEqual([expect.objectContaining({ kind: 'write', write: 'w_pump_run' })]);
  });

  it('đặt lại về t = 0: xóa nhật ký, giá trị đặt tay, mẫu', () => {
    const s = sim();
    s.setManual('TANK01.LEVEL', { value: 85, quality: 'GOOD' });
    s.run(100);
    s.reset();
    expect(s.t).toBe(0);
    expect(s.scans).toBe(0);
    expect(s.log).toEqual([]);
    expect(s.manualOf('TANK01.LEVEL')).toBeUndefined();
    expect(s.history.length).toBe(1);
  });

  it('logic còn lỗi (vòng phụ thuộc): không chạy, báo lý do', () => {
    const doc = updateBlock(pumpLogic(), 'timer', 't_start', { in: 'LOGIC.T_START.Q' });
    const s = sim(doc);
    expect(s.error).not.toBeNull();
    expect(s.run(10)).toBe(0);
  });

  it('Lưu kịch bản: tệp dạng ca vector (doc, tags, config, steps có set theo thời điểm đặt tay)', () => {
    const s = sim();
    s.setManual('TANK01.LEVEL', { value: 50, quality: 'GOOD' });
    s.run(10);
    s.setManual('TANK01.LEVEL', { value: 15, quality: 'BAD' });
    s.run(5);
    const v = s.scenario('tram-bom');
    expect(v.id).toBe('tram-bom');
    expect(v.doc).toEqual(pumpLogic());
    expect(v.tags['PUMP01.RUN_CMD']).toEqual({ type: 'BOOL', writable: true });
    expect(v.config).toEqual({ scanMs: 100, tzOffsetMin: 420, writes: 'on', maxWritesPerMin: 20 });
    // Bước đầu có giờ thực và mọi đầu vào; sau đó chỉ đầu vào đổi (giá trị mô phỏng hoặc đặt tay); cuối là expect.
    expect(v.steps[0]).toMatchObject({ t: 0, wall: '2026-10-15T08:00:00+07:00' });
    expect(Object.keys(v.steps[0]!.set ?? {}).sort()).toEqual(s.inputs);
    expect(v.steps[0]!.set!['TANK01.LEVEL']).toBe(50);
    expect(v.steps.find((x) => x.t === 1000)?.set?.['TANK01.LEVEL']).toEqual({
      value: 15,
      quality: 'BAD',
    });
    const ts = v.steps.map((x) => x.t);
    expect(ts.every((t, i) => t % 100 === 0 && (i === 0 || t > ts[i - 1]!))).toBe(true);
    expect(v.steps.at(-1)).toMatchObject({ t: 1400, expect: { actions: [] } });
  });
});
