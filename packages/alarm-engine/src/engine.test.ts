// Test đơn vị: bảng ISA 40 ô (SC-005), compileAlarms, quy tắc nhỏ ngoài vector.
import { describe, expect, it } from 'vitest';
import {
  AlarmEngine,
  compileAlarms,
  ISA_EVENTS,
  ISA_STATES,
  isClockOk,
  transition,
} from './index.ts';
import type { AlarmClassJson, AlarmDefJson, AlarmState, IsaEvent, TagSample } from './index.ts';

type Expected = AlarmState | 'impossible' | 'NOT_ACTIVE' | 'ALREADY_ACKED';
const N = 'NORMAL';
const AU = 'ACTIVE_UNACK';
const AA = 'ACTIVE_ACK';
const RU = 'RTN_UNACK';

// Bảng viết tay từ data-model.md §5 (lớp requiresAck = R, ackReturn = AR); mỗi hàng = trạng thái, thứ tự cột = ISA_EVENTS.
// on, off, ack, ackReturn, shelve, unshelve, disable, enable, configRemoved, restartReconcile
const TABLE_R: Record<AlarmState, Expected[]> = {
  NORMAL: [AU, 'impossible', 'NOT_ACTIVE', 'NOT_ACTIVE', N, N, N, N, N, N],
  ACTIVE_UNACK: ['impossible', RU, AA, 'impossible', AU, AU, N, 'impossible', N, AU],
  ACTIVE_ACK: ['impossible', N, 'ALREADY_ACKED', 'impossible', AA, AU, N, 'impossible', N, AA],
  RTN_UNACK: [AU, 'impossible', 'impossible', N, RU, RU, N, 'impossible', N, RU],
};

describe('bảng chuyển trạng thái ISA: 40 ô', () => {
  it('có đủ 4 trạng thái × 10 sự kiện', () => {
    expect(ISA_STATES.length * ISA_EVENTS.length).toBe(40);
    for (const s of ISA_STATES) expect(TABLE_R[s].length).toBe(ISA_EVENTS.length);
  });

  for (const s of ISA_STATES) {
    ISA_EVENTS.forEach((ev: IsaEvent, k) => {
      it(`R, không AR: ${s} × ${ev}`, () => {
        const exp = TABLE_R[s][k];
        // unshelve của ACTIVE_ACK với điều kiện còn đúng quay lại AU (ô ghi AU ở bảng); ở đây điều kiện đúng.
        const t = transition(s, ev, { requiresAck: true, ackReturn: false, condTrue: true });
        if (exp === 'impossible') expect(t.kind).toBe('impossible');
        else if (exp === 'NOT_ACTIVE' || exp === 'ALREADY_ACKED')
          expect(t).toMatchObject({ kind: 'reject', result: exp, to: s });
        else expect(t).toMatchObject({ kind: 'move', to: exp });
      });
    });
  }

  it('AA off: ackReturn → RTN_UNACK; không requiresAck → NORMAL, đóng', () => {
    expect(transition(AA, 'off', { requiresAck: true, ackReturn: true })).toMatchObject({
      kind: 'move',
      to: RU,
      closes: false,
    });
    expect(transition(AA, 'off', { requiresAck: true, ackReturn: false })).toMatchObject({
      kind: 'move',
      to: N,
      closes: true,
    });
    expect(transition(AA, 'off', { requiresAck: false, ackReturn: true })).toMatchObject({
      kind: 'move',
      to: N,
      closes: true,
    });
  });
  it('NORMAL on: không requiresAck → ACTIVE_ACK', () => {
    expect(transition(N, 'on', { requiresAck: false, ackReturn: false })).toMatchObject({
      kind: 'move',
      to: AA,
      opens: true,
    });
  });
  it('AA unshelve: chỉ về AU khi requiresAck và điều kiện còn đúng', () => {
    expect(
      transition(AA, 'unshelve', { requiresAck: true, ackReturn: false, condTrue: true }),
    ).toMatchObject({ to: AU });
    expect(
      transition(AA, 'unshelve', { requiresAck: true, ackReturn: false, condTrue: false }),
    ).toMatchObject({ to: AA });
    expect(
      transition(AA, 'unshelve', { requiresAck: false, ackReturn: false, condTrue: true }),
    ).toMatchObject({ to: AA });
  });
  it('RU on: đóng hàng cũ và mở hàng mới', () => {
    expect(transition(RU, 'on', { requiresAck: true, ackReturn: false })).toMatchObject({
      kind: 'move',
      to: AU,
      closes: true,
      opens: true,
    });
  });
});

const CLASS: AlarmClassJson[] = [{ id: 'minor', name: 'Nhỏ', priority: 'minor', color: 'amber' }];

describe('compileAlarms', () => {
  const alarms: AlarmDefJson[] = [
    {
      id: 'LVL',
      type: 'limit',
      name: 'Mức',
      tag: 'T.L',
      limits: {
        LL: { value: 5, class: 'minor' },
        HH: { value: 90, class: 'minor', text: 'HH!' },
        H: { value: 80, class: 'minor' },
      },
      deadband: 2,
      text: 'chung',
    },
    {
      id: 'OFF',
      type: 'digital',
      name: 'Tắt',
      tag: 'T.X',
      trigger: true,
      class: 'minor',
      enabled: false,
    },
    { id: 'DIG', type: 'digital', name: 'Số', tag: 'T.L', trigger: false, class: 'minor' },
    { id: 'LINK', type: 'quality', name: 'Link', device: 'plc1', class: 'minor' },
  ];
  const defs = compileAlarms({
    alarms: { alarms },
    alarmClasses: { classes: CLASS },
    devices: { plc1: ['A', 'T.L', 'B'] },
  });

  it('bung theo thứ tự file và HH, H, L, LL; bỏ alarm enabled=false', () => {
    expect(defs.instances.map((i) => i.id)).toEqual(['LVL.HH', 'LVL.H', 'LVL.LL', 'DIG', 'LINK']);
  });
  it('chọn mẫu nội dung: ngưỡng > alarm > mặc định', () => {
    expect(defs.instances.map((i) => i.text)).toEqual(['HH!', 'chung', 'chung', null, null]);
  });
  it('tagIds khử trùng theo thứ tự xuất hiện đầu; deviceTags là chỉ số vào tagIds', () => {
    expect(defs.tagIds).toEqual(['T.L', 'A', 'B']);
    expect(defs.deviceTags['plc1']).toEqual([1, 0, 2]);
  });
  it('áp mặc định lớp', () => {
    expect(defs.classes[0]).toMatchObject({
      requiresAck: true,
      ackReturn: false,
      blink: false,
      sound: 'none',
      chatterLimit: 5,
    });
  });
  it('dấu vân tay không đổi khi đổi tên, lớp, trễ, deadband; đổi khi đổi ngưỡng', () => {
    const base = defs.instances[1].fingerprint;
    const alt = compileAlarms({
      alarms: {
        alarms: [
          {
            ...alarms[0],
            name: 'Khác',
            deadband: 9,
            onDelayMs: 5,
            limits: { ...alarms[0].limits, H: { value: 80, class: 'other' } },
          },
        ],
      },
      alarmClasses: { classes: CLASS },
    });
    expect(alt.instances.find((i) => i.id === 'LVL.H')?.fingerprint).toBe(base);
    const moved = compileAlarms({
      alarms: { alarms: [{ ...alarms[0], limits: { H: { value: 81, class: 'minor' } } }] },
      alarmClasses: { classes: CLASS },
    });
    expect(moved.instances[0].fingerprint).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('động cơ: tính chất chung', () => {
  const defs = compileAlarms({
    alarms: {
      alarms: [{ id: 'D', type: 'digital', name: 'D', tag: 'X', trigger: true, class: 'minor' }],
    },
    alarmClasses: { classes: CLASS },
  });
  const on: TagSample = { value: 1, quality: 'GOOD' };

  it('tất định: cùng chuỗi đầu vào cho cùng chuỗi sự kiện', () => {
    const run = (): string => {
      const e = new AlarmEngine();
      e.load(defs, {}, { nowMonoMs: 0, nowEpochMs: 1791600000000, processStart: true });
      const out = [];
      for (let t = 0; t <= 5000; t += 1000)
        out.push(e.step(t, 1791600000000 + t, [t >= 2000 ? on : { value: 0, quality: 'GOOD' }]));
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });

  it('lệnh ở hộp thư khi load chạy trả NOT_FOUND', () => {
    const e = new AlarmEngine();
    e.load(defs, {}, { nowMonoMs: 0, nowEpochMs: 1791600000000, processStart: true });
    e.submit({ kind: 'ack', id: 'D', occurrence: 1, user: 'u' });
    const ev = e.load(
      defs,
      {},
      { nowMonoMs: 1000, nowEpochMs: 1791600001000, processStart: false },
    );
    expect(ev[0]).toMatchObject({ kind: 'command', result: 'NOT_FOUND' });
  });

  it('view không có item khi chưa có gì; counts bằng 0', () => {
    const e = new AlarmEngine();
    e.load(defs, {}, { nowMonoMs: 0, nowEpochMs: 1791600000000, processStart: true });
    expect(e.view().items).toEqual([]);
    expect(e.view().counts).toMatchObject({
      active: 0,
      unacked: 0,
      rtnUnack: 0,
      shelved: 0,
      disabled: 0,
    });
  });

  it('clockJumpWhileOpen: bật khi giờ treo tường lệch quá 5 s so với đơn điệu lúc có lần xảy ra mở', () => {
    const e = new AlarmEngine();
    e.load(defs, {}, { nowMonoMs: 0, nowEpochMs: 1791600000000, processStart: true });
    e.step(0, 1791600000000, [on]);
    expect(e.view().items[0].state).toBe(AU);
    expect(e.view().clockJumpWhileOpen).toBe(false);
    e.step(1000, 1791600001000 - 3600000, [on]);
    expect(e.view().clockJumpWhileOpen).toBe(true);
  });

  it('isClockOk dùng ngưỡng tiêm vào', () => {
    expect(isClockOk(1577836800000)).toBe(true);
    expect(isClockOk(1577836799999)).toBe(false);
    expect(isClockOk(5, 5)).toBe(true);
  });
});
