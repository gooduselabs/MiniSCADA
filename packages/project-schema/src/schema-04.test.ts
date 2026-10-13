// Schema 0.4.0 (T012; contracts/project-format-0.4.md §3-§5): ví dụ của contract hợp lệ, đích, phép biến đổi
// (kể cả rangeMap) và khóa tham số mới được nhận, `events` là khóa mới, phần tử cần `bindings` hoặc `events`,
// khóa lạ bị từ chối. Schema chỉ kiểm khung (tên khóa, kiểu của khung); miền tham số và ngữ nghĩa do rules-04.
// Biến môi trường MAT_SCHEMA_DIR (mặc định `schemas`) để kiểm bước đỏ trên bản schema cũ.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Validator, type Schema } from '@cfworker/json-schema';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const SDIR = process.env.MAT_SCHEMA_DIR ?? 'schemas';
const load = (f: string) => JSON.parse(readFileSync(resolve(ROOT, SDIR, f), 'utf8')) as Schema;
const make = (f: string) => new Validator(load(f), '7', false);
const project = make('project.schema.json');
const screen = make('screen.schema.json');
const binding = make('binding.schema.json');

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON tùy ý của project
const ok = (v: Validator, doc: unknown) => {
  const r = v.validate(doc);
  expect(r.errors.map((e) => `${e.instanceLocation}: ${e.error}`)).toEqual([]);
};
const bad = (v: Validator, doc: unknown) => expect(v.validate(doc).valid).toBe(false);

/** Ví dụ của contract §4. */
const contractDoc = (): Json => ({
  schemaVersion: '0.4.0',
  screenId: 'bon-nuoc',
  itemId: 'svg_bon',
  elements: [
    {
      elementUid: 'el_tank_liquid',
      bindings: [
        {
          id: 'level',
          target: 'geometry.clipLevel',
          source: { type: 'tag', tagId: 'TANK01.LEVEL' },
          transform: {
            kind: 'linearScale',
            inMin: 0,
            inMax: 100,
            outMin: 0,
            outMax: 100,
            clamp: true,
          },
          direction: 'up',
        },
        {
          id: 'colour',
          target: 'style.fill',
          source: { type: 'tag', tagId: 'TANK01.LEVEL' },
          transform: {
            kind: 'rangeMap',
            ranges: [
              { to: 20, value: '#d32f2f' },
              { from: 20, to: 80, value: '#1e88e5' },
              { from: 80, value: '#d32f2f' },
            ],
            default: '#9e9e9e',
          },
        },
      ],
    },
    {
      elementUid: 'el_tank_text',
      bindings: [
        {
          id: 'value',
          target: 'text.content',
          source: { type: 'tag', tagId: 'TANK01.LEVEL' },
          transform: { kind: 'direct' },
          format: { decimals: 1, unitFromTag: true },
        },
      ],
    },
    {
      elementUid: 'el_pipe_in',
      bindings: [
        {
          id: 'flow',
          target: 'effect.flow',
          source: { type: 'tag', tagId: 'PUMP01.RUN' },
          transform: { kind: 'direct' },
          dash: '12 8',
          speed: 80,
        },
      ],
    },
    {
      elementUid: 'el_pump_hit',
      events: {
        click: {
          action: 'pulse',
          tag: 'PUMP01.RUN_CMD',
          value: true,
          durationMs: 500,
          confirm: 'always',
          minRole: 'operator',
          label: 'Khởi động bơm 1',
        },
      },
    },
  ],
});

const one = (extra: Json = {}, over: Json = {}): Json => ({
  schemaVersion: '0.4.0',
  screenId: 'main',
  elements: [
    {
      elementUid: 'el_aaa',
      bindings: [
        {
          id: 'b1',
          target: 'style.opacity',
          source: { type: 'tag', tagId: 'T.LEVEL' },
          transform: { kind: 'direct' },
          ...extra,
        },
      ],
      ...over,
    },
  ],
});

describe('schemas/*.schema.json 0.4', () => {
  it('`$id` của 8 file project theo 0.4', () => {
    const files = readdirSync(resolve(ROOT, SDIR)).filter(
      (f) => f.endsWith('.schema.json') && f !== 'package-manifest.schema.json',
    );
    expect(files.length).toBe(8);
    for (const f of files) expect((load(f) as { $id: string }).$id, f).toMatch(/\/0\.4\.json$/);
  });

  it('project.json 0.4.0 và màn hình 0.4.0 (khung như 0.3) hợp lệ', () => {
    ok(project, {
      format: 'matscada-project',
      schemaVersion: '0.4.0',
      projectId: 'svg-demo',
      projectName: 'SVG',
      projectVersion: '1.0.0',
      minRuntimeVersion: '0.7.0',
      entryScreen: 'bon-nuoc',
      screens: ['bon-nuoc'],
      tagFile: 'tags.json',
      maxClients: 10,
    });
    ok(screen, {
      schemaVersion: '0.4.0',
      id: 'bon-nuoc',
      name: 'Bồn nước',
      kind: 'screen',
      size: { width: 1280, height: 720 },
      items: [
        {
          id: 'svg_bom1',
          name: 'Bơm 1',
          type: 'svg',
          x: 320,
          y: 400,
          width: 160,
          height: 160,
          svgFile: 'graphics/symbols/pump-centrifugal.svg',
          bindingFile: 'screens/bon-nuoc.svg_bom1.bindings.json',
          viewBox: [0, 0, 100, 100],
          fit: 'contain',
          elements: [
            { elementUid: 'el_pump_impeller', name: 'Cánh bơm' },
            { elementUid: 'el_pump_body' },
          ],
        },
      ],
    });
  });
});

describe('binding.schema.json 0.4', () => {
  it('ví dụ của contract §4 hợp lệ', () => ok(binding, contractDoc()));

  it('nhận mọi đích mới và đích 0.3', () => {
    for (const t of [
      'style.fill',
      'style.stroke',
      'style.opacity',
      'style.visibility',
      'text.content',
      'transform.rotate',
      'transform.translateX',
      'transform.translateY',
      'transform.scale',
      'geometry.levelPercent',
      'geometry.clipLevel',
      'effect.blink',
      'effect.flow',
      'component.state', // vẫn nhận ở schema; luật báo E_TARGET_UNSUPPORTED
    ])
      ok(binding, one({ target: t }));
    bad(binding, one({ target: 'effect.glow' }));
  });

  it('nhận rangeMap (không còn là phép biến đổi chưa hỗ trợ); `format`, `expression` vẫn là unsupported', () => {
    ok(binding, one({ transform: { kind: 'rangeMap', ranges: [{ from: 0, to: 5, value: 1 }] } }));
    ok(
      binding,
      one({
        transform: {
          kind: 'rangeMap',
          ranges: [
            { to: 5, value: 'a' },
            { from: 5, value: 'b' },
          ],
          default: 'c',
        },
      }),
    );
    ok(binding, one({ transform: { kind: 'expression', source: 'x' } })); // unsupportedTransform
    ok(binding, one({ transform: { kind: 'format' } }));
    // rangeMap thiếu `ranges`, khoảng thiếu `value`, khóa lạ trong khoảng hoặc trong rangeMap
    bad(binding, one({ transform: { kind: 'rangeMap' } }));
    bad(binding, one({ transform: { kind: 'rangeMap', ranges: [{ from: 0, to: 5 }] } }));
    bad(binding, one({ transform: { kind: 'rangeMap', ranges: [{ from: 0, value: 1, x: 1 }] } }));
    bad(binding, one({ transform: { kind: 'rangeMap', ranges: [{ from: 'a', value: 1 }] } }));
    bad(binding, one({ transform: { kind: 'rangeMap', ranges: [], extra: 1 } }));
  });

  it('nhận khóa tham số mới (giá trị do rules-04 kiểm)', () => {
    for (const p of [
      { animation: 'spin', reverse: true, pivot: [0.5, 0.5] },
      { axis: 'x' },
      { direction: 'left' },
      { format: { decimals: 2, prefix: 'P=', suffix: ' m', unitFromTag: true } },
      { period: 1000, mode: 'fill', minOpacity: 0.2, color: '#ff0000' },
      { dash: '12 8', speed: 60, reverse: false, byValueSign: true },
      // ngoài miền hoặc sai kiểu vẫn qua schema: luật báo E_BIND_PARAM (project-format-0.4.md §6)
      { period: 399, pivot: [2, 2], axis: 'z', speed: 'x', format: 'x' },
    ])
      ok(binding, one(p));
    bad(binding, one({ unknownParam: 1 }));
  });

  it('phần tử cần ít nhất một trong `bindings`, `events`; `events` nhận một đối tượng', () => {
    bad(binding, {
      schemaVersion: '0.4.0',
      screenId: 'main',
      elements: [{ elementUid: 'el_aaa' }],
    });
    bad(binding, {
      schemaVersion: '0.4.0',
      screenId: 'main',
      elements: [{ elementUid: 'el_aaa', bindings: [] }],
    });
    ok(binding, {
      schemaVersion: '0.4.0',
      screenId: 'main',
      elements: [{ elementUid: 'el_aaa', events: { click: { action: 'closePopup' } } }],
    });
    // nội dung `events` do rules-04 kiểm (E_EVENT_*): schema chỉ đòi đối tượng
    ok(binding, {
      schemaVersion: '0.4.0',
      screenId: 'main',
      elements: [{ elementUid: 'el_aaa', events: { dblclick: { action: 'x' } } }],
    });
    bad(binding, {
      schemaVersion: '0.4.0',
      screenId: 'main',
      elements: [{ elementUid: 'el_aaa', events: 'click' }],
    });
    ok(binding, one({}, { events: { click: { action: 'navigate', screen: 'pump' } } }));
  });

  it('khóa lạ bị từ chối ở phần tử và ở gốc; tối đa 16 binding mỗi phần tử', () => {
    bad(binding, one({}, { extra: 1 }));
    bad(binding, { ...one(), extra: 1 });
    const many = one();
    many.elements[0].bindings = Array.from({ length: 17 }, (_, i) => ({
      ...one().elements[0].bindings[0],
      id: `b${i}`,
    }));
    bad(binding, many);
    many.elements[0].bindings.pop();
    ok(binding, many);
  });
});
