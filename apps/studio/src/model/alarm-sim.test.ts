// Thử alarm (T068, FR-080; SC-017): đồng hồ ảo tiêm vào SimEngine + AlarmEngine; 1×/5×/20× cho cùng chuỗi chuyển trạng thái;
// ack, shelve, bật/tắt thử; nhật ký; kết quả khớp bộ vector chung (nạp tests/alarm-vectors qua cùng runner).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runVector, type AlarmVector } from '@mat/alarm-engine';
import type { AlarmClassDef, AlarmDef, TagV1 } from '@mat/project-schema';
import { ALARM_SIM_TICK_MS, AlarmSim, deviceTagsOf, tagInfoOf } from './alarm-sim.ts';

const VECTORS = resolve(__dirname, '../../../../tests/alarm-vectors');

const CLASSES: AlarmClassDef[] = [
  { id: 'minor', name: 'Nhỏ', priority: 'minor', color: 'amber', sound: 'beep' },
  { id: 'advisory', name: 'Lưu ý', priority: 'advisory', color: 'blue', requiresAck: false },
];

const tag = (id: string, o: Partial<TagV1> = {}): TagV1 => ({
  id,
  kind: 'internal',
  type: 'FLOAT32',
  access: 'RW',
  initial: 0,
  ...o,
});

// Mức bồn ramp 0→100 trong 20 s (tag-sim ramp: min, max, periodS), H = 80 trễ bật 1 s, L = 20.
const LEVEL = tag('TANK01.LEVEL', {
  kind: 'simulation',
  unit: '%',
  sim: { kind: 'ramp', from: 0, to: 100, periodMs: 20000 },
});
const FAULT = tag('P.F', { type: 'BOOL', initial: false });
const ALARMS: AlarmDef[] = [
  {
    id: 'TL',
    type: 'limit',
    name: 'Mức bồn',
    tag: 'TANK01.LEVEL',
    limits: { H: { value: 80, class: 'minor' }, L: { value: 20, class: 'minor' } },
    deadband: 2,
    onDelayMs: 1000,
  },
  { id: 'DA', type: 'digital', name: 'Bơm lỗi', tag: 'P.F', trigger: true, class: 'minor' },
];

function make(o: Partial<ConstructorParameters<typeof AlarmSim>[0]> = {}) {
  return new AlarmSim({
    project: { alarms: ALARMS, classes: CLASSES, areas: [] },
    tags: [LEVEL, FAULT],
    ...o,
  });
}

const trace = (s: AlarmSim) =>
  s.log
    .filter((l) => l.from !== l.to)
    .map((l) => `${l.t}:${l.instance}:${l.from}>${l.to}:${l.reason}`);

describe('AlarmSim: đồng hồ ảo', () => {
  it('SimEngine nhận thời gian tiêm vào: giá trị Tag mô phỏng phụ thuộc giờ ảo, không Date.now', () => {
    const s = make();
    expect(s.virtualNowMs).toBe(0);
    s.step();
    expect(s.virtualNowMs).toBe(ALARM_SIM_TICK_MS);
    const a = s.sampleOf('TANK01.LEVEL').value;
    s.run(4);
    const b = s.sampleOf('TANK01.LEVEL').value;
    expect(s.virtualNowMs).toBe(ALARM_SIM_TICK_MS * 5);
    expect(b).toBeGreaterThan(a);
    expect(s.epochNowMs).toBe(s.epoch0 + s.virtualNowMs);
  });

  it('ramp vượt H sau trễ bật 1 s; nhật ký on-delay rồi deadband khi về', () => {
    const s = make();
    s.run(4 * 20); // 20 s ảo: ramp đi hết một chu kỳ 0→100
    const t = trace(s);
    expect(t.some((x) => x.includes('TL.H:NORMAL>ACTIVE_UNACK:on-delay'))).toBe(true);
    const on = s.log.find((l) => l.instance === 'TL.H' && l.reason === 'on-delay')!;
    // ramp 0→100/20 s: 80 % tại 16 s; trễ 1 s → bật tại 17 s (hoặc tick kế).
    expect(on.t).toBeGreaterThanOrEqual(17000);
    expect(on.t).toBeLessThanOrEqual(17250);
    expect(on.detail).toMatch(/\/ 80 · 1000 ms · #[0-9]+$/);
  });

  it('1×, 5×, 20× cho cùng chuỗi chuyển trạng thái (chỉ khác số tick mỗi 250 ms thật)', () => {
    const runs = ([1, 5, 20] as const).map((speed) => {
      const s = make();
      s.speed = speed;
      while (s.virtualNowMs < 40_000) s.advanceRealMs(250);
      return trace(s);
    });
    expect(runs[0].length).toBeGreaterThan(2);
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });

  it('advanceRealMs gom phần dư: 100 ms + 150 ms = một tick ở 1×', () => {
    const s = make();
    s.advanceRealMs(100);
    expect(s.virtualNowMs).toBe(0);
    s.advanceRealMs(150);
    expect(s.virtualNowMs).toBe(250);
    s.speed = 20;
    s.advanceRealMs(250);
    expect(s.virtualNowMs).toBe(250 + 20 * 250);
  });
});

describe('AlarmSim: nhập tay, quality, hành động thử', () => {
  it('nhập tay BOOL bật digital; quality BAD giữ nguyên (input-bad); ack thử áp ngay tại giờ ảo', async () => {
    const s = make();
    s.setManual('P.F', { value: 1, quality: 'GOOD' });
    s.step();
    expect(s.view().items.find((i) => i.id === 'DA')?.state).toBe('ACTIVE_UNACK');
    expect(await s.ack('DA', 1)).toBe('ACKED');
    expect(s.view().items.find((i) => i.id === 'DA')?.state).toBe('ACTIVE_ACK');
    expect(s.log.at(-1)).toMatchObject({ instance: 'DA', reason: 'ack', t: s.virtualNowMs });
    s.setManual('P.F', { value: 0, quality: 'BAD', reason: 'TIMEOUT' });
    s.step();
    expect(s.view().items.find((i) => i.id === 'DA')).toMatchObject({
      state: 'ACTIVE_ACK',
      inputBad: true,
    });
    expect(s.log.at(-1)?.reason).toBe('input-bad');
    s.setManual('P.F', { value: 0, quality: 'GOOD' });
    s.step();
    expect(s.view().items.find((i) => i.id === 'DA')).toBeUndefined();
    expect(trace(s).at(-1)).toBe(`${s.virtualNowMs}:DA:ACTIVE_ACK>NORMAL:off-delay`);
    expect(await s.ack('DA', 1)).toBe('NOT_ACTIVE');
  });

  it('shelve thử hết hạn theo đồng hồ ảo; unshelve; bật/tắt từng alarm', async () => {
    const s = make();
    s.setManual('P.F', { value: 1, quality: 'GOOD' });
    s.step();
    expect(await s.shelve('DA', 'thử', 60)).toBe('OK');
    expect(s.snapshot().instances.find((i) => i.id === 'DA')?.shelved).toMatchObject({
      reason: 'thử',
      system: false,
    });
    expect(s.snapshot().counts).toMatchObject({ active: 0, shelved: 1 });
    s.run(60 * 4);
    expect(s.snapshot().instances.find((i) => i.id === 'DA')?.shelved).toBeUndefined();
    expect(s.log.some((l) => l.reason === 'shelve-expired')).toBe(true);
    expect(await s.shelve('DA', 'thử', 60)).toBe('OK');
    expect(await s.unshelve('DA')).toBe('OK');
    expect(await s.unshelve('DA')).toBe('NOT_SHELVED');
    expect(await s.setEnabled('DA', false)).toBe('OK');
    expect(s.snapshot().instances.find((i) => i.id === 'DA')).toMatchObject({
      disabled: true,
      state: 'NORMAL',
    });
    s.run(4);
    expect(s.snapshot().counts.disabled).toBe(1);
    expect(await s.setEnabled('DA', true)).toBe('OK');
    expect(s.snapshot().instances.find((i) => i.id === 'DA')?.state).toBe('ACTIVE_UNACK');
    expect(s.snapshot().instances.find((i) => i.id === 'DA')?.occurrence).toBeGreaterThan(1);
  });

  it('alarmActions: ack theo mục, ack tất cả với upToRevision, shelve lỗi SHELVE_RANGE', async () => {
    const s = make();
    s.setManual('P.F', { value: 1, quality: 'GOOD' });
    s.setManual('TANK01.LEVEL', { value: 10, quality: 'GOOD' });
    s.run(5);
    const rev = s.snapshot().revision;
    expect(s.snapshot().counts.unack).toBe(2);
    const host = s.alarmActions();
    const all = await host.ackAlarms({ all: true, upToRevision: rev, filter: {} });
    expect(all.acked).toBe(2);
    expect(all.results.map((r) => r.result)).toEqual(['ACKED', 'ACKED']);
    expect(s.snapshot().counts.unack).toBe(0);
    const again = await host.ackAlarms({ items: [{ id: 'DA', occurrence: 1 }] });
    expect(again.results[0].result).toBe('ALREADY_ACKED');
    const bad = await host.shelveAlarm({ id: 'DA', reason: '', durationS: 60 });
    expect(bad).toMatchObject({ ok: false, error: { code: 'SHELVE_RANGE' } });
    expect(await host.shelveAlarm({ id: 'DA', reason: 'x', durationS: 60 })).toMatchObject({
      ok: true,
    });
    expect(await host.unshelveAlarm('DA')).toMatchObject({ ok: true, changed: true });
  });

  it('AlarmSource: snapshot cùng đối tượng tới khi đổi; subscribe báo id đổi', async () => {
    const s = make();
    const src = s.source();
    expect(src.status()).toBe('live');
    const a = src.snapshot();
    expect(src.snapshot()).toBe(a);
    const seen: (readonly string[] | 'all')[] = [];
    src.subscribe((c) => seen.push(c));
    s.setManual('P.F', { value: 1, quality: 'GOOD' });
    s.step();
    await Promise.resolve();
    expect(seen).toEqual([['DA']]);
    expect(src.snapshot()).not.toBe(a);
    expect(src.snapshot().instances[0]).toMatchObject({
      id: 'DA',
      alarmId: 'DA',
      type: 'digital',
      state: 'ACTIVE_UNACK',
      text: 'Bơm lỗi',
      valueActive: 1,
    });
    expect(src.now()).toBe(s.epochNowMs);
  });

  it('khởi động lại engine giữ lần xảy ra mở (không mã mới); đặt lại về 0', () => {
    const s = make();
    s.setManual('P.F', { value: 1, quality: 'GOOD' });
    s.run(2);
    const before = s.snapshot().instances.find((i) => i.id === 'DA')!;
    s.restart();
    s.run(2);
    const after = s.snapshot().instances.find((i) => i.id === 'DA')!;
    expect(after.occurrence).toBe(before.occurrence);
    expect(after.state).toBe('ACTIVE_UNACK');
    expect(s.log.some((l) => l.reason === 'restart')).toBe(true);
    s.reset();
    expect(s.virtualNowMs).toBe(0);
    expect(s.snapshot().instances).toEqual([]);
    expect(s.log).toEqual([]);
    s.step();
    expect(s.snapshot().instances).toEqual([]); // nhập tay đã xóa: P.F về initial false
  });

  it('alarm bị bỏ qua (skip) không tạo instance; không alarm → status none', () => {
    const s = make({ skip: ['TL'] });
    expect(s.skipped).toEqual(['TL']);
    expect(s.instanceCount).toBe(1);
    expect(
      make({ project: { alarms: [], classes: CLASSES, areas: [] } })
        .source()
        .status(),
    ).toBe('none');
  });

  it('deviceTagsOf và tagInfoOf', () => {
    const ext = tag('X', { kind: 'external', source: { device: 'plc1', address: '40001' } });
    const calc = tag('C', { kind: 'calculated', expression: 'X * 2' });
    expect(deviceTagsOf([ext, calc, FAULT])).toEqual({ plc1: ['X'] });
    const info = tagInfoOf(
      [LEVEL, tag('M', { type: 'BOOL', valueTable: 'mode' })],
      [
        {
          name: 'mode',
          entries: [
            { value: true, text: 'Chạy' },
            { value: false, text: 'Dừng' },
          ],
        },
      ],
    );
    expect(info['TANK01.LEVEL']).toEqual({ unit: '%' });
    expect(info['M']).toEqual({ isBool: true, labels: { '1': 'Chạy', '0': 'Dừng' } });
  });
});

describe('AlarmSim: kết quả khớp bộ vector chung (SC-017)', () => {
  // Cùng runner và cùng bản động cơ TS mà AlarmSim dùng; đây là bộ vector mà bản C++ cũng chạy.
  for (const file of ['digital', 'delay', 'deadband', 'shelve', 'chatter', 'text']) {
    it(`tests/alarm-vectors/${file}.json`, () => {
      const { cases } = JSON.parse(readFileSync(resolve(VECTORS, `${file}.json`), 'utf8')) as {
        cases: AlarmVector[];
      };
      expect(cases.length).toBeGreaterThan(0);
      for (const c of cases) expect(runVector(c).errors, c.name).toEqual([]);
    });
  }
});
