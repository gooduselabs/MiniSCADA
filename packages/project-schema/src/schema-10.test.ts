// Schema 1.0.0 (feature 011, T017; contracts/project-format-1.0.md §2-§5, §7; contracts/logic-engine.md §1): ví dụ của
// contract hợp lệ, khóa mới (`logic`, `templates`, `tpl`, `params`, `args`) được nhận, khung sai bị từ chối. Schema chỉ kiểm
// khung; chỗ đặt `{param}`, khớp `args` với `params`, Tag sau khi thay do luật (rules-10.ts, E_TEMPLATE_*, E_POPUP_ARGS).
// Biến môi trường MAT_SCHEMA_DIR (mặc định `schemas`) để kiểm bước đỏ trên bản schema cũ.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Validator, type Schema } from '@cfworker/json-schema';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const SDIR = process.env.MAT_SCHEMA_DIR ?? 'schemas';
const load = (dir: string, f: string) =>
  JSON.parse(readFileSync(resolve(ROOT, dir, f), 'utf8')) as Schema;
const make = (f: string, dir = SDIR) => new Validator(load(dir, f), '7', false);

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON tùy ý của project
const ok = (v: Validator, doc: unknown) => {
  const r = v.validate(doc);
  expect(r.errors.map((e) => `${e.instanceLocation}: ${e.error}`)).toEqual([]);
};
const bad = (v: Validator, doc: unknown) => expect(v.validate(doc).valid).toBe(false);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Template của contract §3 (cỡ theo `width`/`height` như màn hình và item của 007). */
const template = (): Json => ({
  schemaVersion: '1.0.0',
  id: 'bom',
  name: 'Bơm có đèn và lưu lượng',
  size: { width: 220, height: 140 },
  params: [
    { name: 'prefix', kind: 'tagPrefix', default: 'PUMP01' },
    { name: 'title', kind: 'string', default: 'Bơm' },
  ],
  items: [
    {
      id: 'lamp',
      type: 'widget',
      widget: 'lamp',
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      tags: { state: '{prefix}.RUN' },
    },
    {
      id: 'flow',
      type: 'widget',
      widget: 'card',
      x: 60,
      y: 10,
      width: 150,
      height: 60,
      props: { label: '{title} (lưu lượng)' },
      tags: { value: '{prefix}.FLOW' },
    },
    {
      id: 'detail',
      type: 'widget',
      widget: 'button',
      x: 10,
      y: 90,
      width: 120,
      height: 40,
      props: { label: 'Chi tiết' },
      events: {
        click: { action: 'popup', screen: 'bom-chi-tiet', args: { prefix: '{prefix}' } },
      },
    },
  ],
});

/** Màn hình popup có tham số của contract §5 và một item sinh từ template (§4). */
const popup = (): Json => ({
  schemaVersion: '1.0.0',
  id: 'bom-chi-tiet',
  name: 'Chi tiết bơm',
  kind: 'popup',
  size: { width: 640, height: 420 },
  params: [
    { name: 'prefix', kind: 'tagPrefix' },
    { name: 'title', kind: 'string', default: 'Bơm' },
  ],
  items: [
    {
      id: 'run',
      type: 'widget',
      widget: 'switch',
      x: 20,
      y: 20,
      width: 120,
      height: 48,
      tags: { target: '{prefix}.RUN_CMD' },
      props: { label: '{title}' },
    },
  ],
});
const screenWithInstance = (): Json => ({
  schemaVersion: '1.0.0',
  id: 'main',
  name: 'Main',
  kind: 'screen',
  size: { width: 1280, height: 720 },
  items: [
    {
      id: 'pump7.lamp',
      type: 'widget',
      widget: 'lamp',
      x: 400,
      y: 300,
      width: 40,
      height: 40,
      tags: { state: 'PUMP07.RUN' },
      tpl: { inst: 'pump7', tid: 'bom', rid: 'lamp', params: { prefix: 'PUMP07', title: 'Bơm 7' } },
    },
    {
      id: 'btn',
      type: 'widget',
      widget: 'button',
      x: 0,
      y: 0,
      width: 120,
      height: 48,
      events: {
        click: { action: 'popup', screen: 'bom-chi-tiet', args: { prefix: 'PUMP07' } },
      },
    },
  ],
});

/** logic.json của contracts/logic-engine.md §1. */
const logic = (): Json => ({
  schemaVersion: '1.0.0',
  writes: [
    {
      id: 'w_pump_run',
      tag: 'PUMP01.RUN_CMD',
      allowed: { values: [true, false] },
      minIntervalMs: 30000,
      maxPerHour: 20,
    },
  ],
  rules: [
    {
      id: 'pump_low_level',
      name: 'Bơm tự bật khi mức thấp',
      enabled: true,
      when: 'TANK01.LEVEL < 20',
      hold: 10000,
      fireOnStart: false,
      repeatMs: 0,
      onRise: [{ do: 'write', write: 'w_pump_run', value: true }],
      onFall: [],
    },
    {
      id: 'pump_high_level',
      when: 'TANK01.LEVEL > 80',
      hold: 5000,
      onRise: [
        { do: 'write', write: 'w_pump_run', value: false },
        { do: 'pulse', write: 'w_pump_run', value: true, ms: 500 },
        { do: 'setTag', tag: 'MODE.AUTO', value: { expr: 'TANK01.SP + 5' } },
        { do: 'toggle', tag: 'MODE.FLAG' },
      ],
    },
  ],
  timers: [
    {
      id: 't_start',
      kind: 'ton',
      in: 'PUMP01.RUN_CMD',
      pt: 5000,
      q: 'LOGIC.T_START.Q',
      et: 'LOGIC.T_START.ET',
    },
  ],
  counters: [
    {
      id: 'c_starts',
      up: 'PUMP01.RUN',
      down: null,
      reset: 'LOGIC.RESET_DAILY.Q',
      preset: 1000,
      value: 'LOGIC.C_STARTS.VALUE',
      reached: 'LOGIC.C_STARTS.REACHED',
      retain: true,
    },
  ],
  totalizers: [
    {
      id: 'z_flow',
      source: 'FLOW01',
      rateUnit: 'h',
      factor: 1.0,
      cutoff: 0.05,
      maxGapMs: 5000,
      reset: 'LOGIC.RESET_DAILY.Q',
      total: 'LOGIC.FLOW01.TOTAL',
      gapSeconds: 'LOGIC.FLOW01.GAP_S',
      retain: true,
      rolloverAt: 99999.9,
    },
  ],
  runhours: [
    {
      id: 'h_pump',
      run: 'PUMP01.RUN',
      reset: null,
      serviceEveryHours: 500,
      hours: 'LOGIC.PUMP01.HOURS',
      starts: 'LOGIC.PUMP01.STARTS',
      due: 'LOGIC.PUMP01.DUE',
      retain: true,
    },
  ],
  schedules: [
    {
      id: 's_day',
      tzOffsetMin: null,
      weekly: [{ days: [1, 2, 3, 4, 5, 6], from: '06:00', to: '18:00' }],
      exceptions: [{ date: '2026-12-25', mode: 'off' }],
      out: 'LOGIC.DAY.Q',
    },
    {
      id: 's_midnight',
      weekly: [{ days: [1, 2, 3, 4, 5, 6, 7], from: '00:00', to: '00:01' }],
      out: 'LOGIC.RESET_DAILY.Q',
    },
  ],
});

describe('schemas/template.schema.json 1.0', () => {
  const v = make('template.schema.json');
  it('ví dụ của contract §3 hợp lệ (cả args có {param} của hành động popup)', () =>
    ok(v, template()));
  it('không có params cũng được; tham số không default được', () => {
    const t = template();
    delete t.params;
    ok(v, t);
    const u = template();
    delete u.params[0].default;
    ok(v, u);
  });
  it('kind lạ, tên tham số sai dạng, default không phải chuỗi, quá 16 tham số bị từ chối', () => {
    const t1 = template();
    t1.params[0].kind = 'expr';
    bad(v, t1);
    const t2 = template();
    t2.params[0].name = 'Prefix';
    bad(v, t2);
    const t3 = template();
    t3.params[0].default = 5;
    bad(v, t3);
    const t4 = template();
    t4.params = Array.from({ length: 17 }, (_, i) => ({ name: `p${i}`, kind: 'string' }));
    bad(v, t4);
    const t5 = template();
    t5.params[0].extra = 1;
    bad(v, t5);
  });
  it('id sai dạng, cỡ 0, quá 120 item, khóa lạ bị từ chối', () => {
    const t1 = template();
    t1.id = 'Bom';
    bad(v, t1);
    const t2 = template();
    t2.size.width = 0;
    bad(v, t2);
    const t3 = template();
    t3.items = Array.from({ length: 121 }, (_, i) => ({ ...t3.items[0], id: `l${i}` }));
    bad(v, t3);
    const t4 = template();
    t4.loop = true;
    bad(v, t4);
    const t5 = template();
    t5.items[0].tpl = { inst: 'a', tid: 'bom', rid: 'lamp' };
    bad(v, t5);
  });
});

describe('schemas/screen.schema.json 1.0', () => {
  const v = make('screen.schema.json');
  it('popup có params, item có tpl, hành động popup có args', () => {
    ok(v, popup());
    ok(v, screenWithInstance());
  });
  it('tpl sai dạng bị từ chối', () => {
    const s1 = screenWithInstance();
    s1.items[0].tpl.inst = 'Pump7';
    bad(v, s1);
    const s2 = screenWithInstance();
    delete s2.items[0].tpl.rid;
    bad(v, s2);
    const s3 = screenWithInstance();
    s3.items[0].tpl.params.prefix = 7;
    bad(v, s3);
    const s4 = screenWithInstance();
    s4.items[0].tpl.extra = 1;
    bad(v, s4);
  });
  it('args không phải đối tượng chuỗi bị từ chối; params sai khung bị từ chối', () => {
    const s1 = screenWithInstance();
    s1.items[1].events.click.args = { prefix: 7 };
    bad(v, s1);
    const s2 = screenWithInstance();
    s2.items[1].events.click.args = ['PUMP07'];
    bad(v, s2);
    const p = popup();
    p.params[0].kind = 'list';
    bad(v, p);
  });
  it('bản 0.6 đóng băng giữ kết luận: tpl, params bị từ chối', () => {
    const v06 = make('screen.schema.json', 'schemas/0.6');
    bad(v06, popup());
    bad(v06, screenWithInstance());
  });
});

describe('schemas/binding.schema.json 1.0', () => {
  const v = make('binding.schema.json');
  const doc = (args: unknown): Json => ({
    schemaVersion: '1.0.0',
    screenId: 'main',
    itemId: 'svg1',
    elements: [
      {
        elementUid: 'el_aaa',
        events: { click: { action: 'popup', screen: 'bom-chi-tiet', args } },
      },
    ],
  });
  it('sự kiện click popup có args chuỗi', () => ok(v, doc({ prefix: 'PUMP07' })));
  it('args sai kiểu bị từ chối', () => {
    bad(v, doc({ prefix: 7 }));
    bad(v, doc('PUMP07'));
  });
});

describe('schemas/project.schema.json 1.0', () => {
  const v = make('project.schema.json');
  const p = (): Json => ({
    format: 'matscada-project',
    schemaVersion: '1.0.0',
    projectId: 'demo',
    projectName: 'Demo',
    projectVersion: '1.0.0',
    minRuntimeVersion: '1.0.0',
    entryScreen: 'main',
    screens: ['main'],
    tagFile: 'tags.json',
    maxClients: 10,
    logic: 'logic.json',
    templates: ['templates/bom.template.json'],
  });
  it('logic, templates của contract §2', () => ok(v, p()));
  it('đường dẫn template sai dạng, trùng; logic không phải .json bị từ chối', () => {
    const a = p();
    a.templates = ['bom.json'];
    bad(v, a);
    const b = p();
    b.templates = ['templates/bom.template.json', 'templates/bom.template.json'];
    bad(v, b);
    const c = p();
    c.logic = 'logic.txt';
    bad(v, c);
  });
  it('bản 0.6 đóng băng giữ kết luận: logic, templates bị từ chối', () =>
    bad(make('project.schema.json', 'schemas/0.6'), p()));
});

describe('schemas/logic.schema.json 1.0', () => {
  const v = make('logic.schema.json');
  it('ví dụ của contracts/logic-engine.md §1 hợp lệ; tệp rỗng hợp lệ', () => {
    ok(v, logic());
    ok(v, { schemaVersion: '1.0.0' });
  });
  it('khung sai bị từ chối', () => {
    const muts: Array<(l: Json) => void> = [
      (l) => (l.extra = []),
      (l) => delete l.rules[0].when,
      (l) => (l.rules[0].onRise[0].extra = 1),
      (l) => (l.rules[0].hold = '10s'),
      (l) => (l.rules[0].onRise[0].value = { expression: 'A' }),
      (l) => (l.timers[0].pt = '5000'),
      (l) => (l.counters[0].retain = 'yes'),
      (l) => (l.writes[0].allowed = { values: 'x' }),
      (l) => (l.writes[0].allowed = { min: 0, step: 1 }),
      (l) => (l.schedules[0].weekly[0].days = 1),
      (l) => delete l.schedules[0].out,
    ];
    for (const m of muts) {
      const l = clone(logic());
      m(l);
      bad(v, l);
    }
  });
  it('miền giá trị (dạng id, kind, rateUnit, giờ, chế độ, do) là luật E_LOGIC_* (T135), không phải schema', () => {
    const l = clone(logic());
    l.rules[0].id = 'Pump';
    l.rules[0].onRise[0].do = 'script';
    l.timers[0].kind = 'rto';
    l.totalizers[0].rateUnit = 'w';
    l.schedules[0].weekly[0].from = '6:00';
    l.schedules[0].exceptions[0].mode = 'maybe';
    ok(v, l);
  });
});
