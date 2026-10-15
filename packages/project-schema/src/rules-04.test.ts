// Luật 0.4 (T014; contracts/project-format-0.4.md §5, §6; binding-animation.md §2; svg-events.md §2): ca nhỏ dựng từ vector
// `v04-valid-full` bằng hàm trợ giúp, kiểm bảng đích x phép biến đổi x tham số theo từng ô của contract, nhóm đích,
// khoảng của rangeMap, sự kiện, đếm hoạt ảnh. Mã chỉ ở bản TS cần nội dung SVG (E_SVG_*, W_SVG_HEAVY, W_BIND_*) có test ở
// rules-04-svg.test.ts. Vector đầy đủ chạy chung với C++: vectors-04.test.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIMITS_04,
  LIMITS_03,
  MemorySource,
  MIN_RUNTIME_04,
  RUNTIME_VERSION,
  validateProject,
  type ScreenModel,
} from './index.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors/v04-valid-full');
const MAIN = 'screens/main.screen.json';
const MB = 'screens/main.svg1.bindings.json';

function tree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) Object.assign(out, tree(dir, r));
    else if (n !== 'expected.json') out[r] = readFileSync(join(dir, r), 'utf8');
  }
  return out;
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON tùy ý của project

interface Seen {
  errors: string[];
  warnings: string[];
}
const fmt = (i: { code: string; file: string; path: string }) => `${i.code} ${i.file}${i.path}`;

/** Sửa các file của vector hợp lệ (`mutate` nhận bản đồ file đã parse), kiểm project, trả mã lỗi và cảnh báo. */
async function run(mutate: (f: Record<string, Json>) => void): Promise<Seen> {
  const raw = tree(DIR);
  const f: Record<string, Json> = {};
  for (const [k, v] of Object.entries(raw)) f[k] = k.endsWith('.json') ? JSON.parse(v) : v;
  mutate(f);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  const r = await validateProject(new MemorySource(out), { checkSvg: false });
  return { errors: r.errors.map(fmt).sort(), warnings: r.warnings.map(fmt).sort() };
}
const codesOf = (xs: string[]) => [...new Set(xs.map((x) => x.split(' ')[0]!))].sort();

/** Chạy một binding `el_aaa` và trả lỗi/cảnh báo của file binding. */
const withBinding = (binding: Json | Json[], extra?: (f: Record<string, Json>) => void) =>
  run((f) => {
    f[MB].elements = [
      { elementUid: 'el_aaa', bindings: Array.isArray(binding) ? binding : [binding] },
    ];
    extra?.(f);
  });
const bd = (
  id: string,
  target: string,
  tagId: string,
  transform: Json,
  extra: Json = {},
): Json => ({
  id,
  target,
  source: { type: 'tag', tagId },
  transform,
  ...extra,
});
const hasCode = (xs: string[], code: string) => xs.some((x) => x.startsWith(`${code} `));

describe('nền: v04-valid-full hợp lệ', () => {
  it('không lỗi, không cảnh báo', async () => {
    const r = await run(() => {});
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  it('hằng của 0.4', () => {
    expect(MIN_RUNTIME_04).toBe('0.7.0');
    expect(RUNTIME_VERSION).toBe('0.7.0');
    expect(LIMITS_04.svgItems).toBe(64);
    expect(LIMITS_03.svgItems).toBe(8); // 0.3 giữ trần cũ
    expect(LIMITS_04.animations).toBe(256);
    expect(LIMITS_04.animWarn).toBe(64);
  });
});

/** Đích mà `direct` chỉ nhận Tag BOOL hoặc STRING: Tag INT16 của ca ma trận là lỗi kiểu, không phải lỗi phép biến đổi. */
const DIRECT_TYPED = new Set(['style.fill', 'style.stroke', 'style.visibility']);

// Bảng của contract §5: đích -> phép biến đổi cho phép
const ALLOWED_KINDS: Record<string, string[]> = {
  'text.content': ['direct', 'discreteMap', 'valueTable', 'rangeMap'],
  'style.fill': ['direct', 'discreteMap', 'valueTable', 'rangeMap'],
  'style.stroke': ['direct', 'discreteMap', 'valueTable', 'rangeMap'],
  'style.opacity': ['direct', 'linearScale', 'discreteMap', 'rangeMap'],
  'style.visibility': ['direct', 'discreteMap', 'rangeMap'],
  'transform.rotate': ['direct', 'linearScale', 'discreteMap', 'rangeMap'],
  'transform.translateX': ['direct', 'linearScale', 'discreteMap', 'rangeMap'],
  'transform.translateY': ['direct', 'linearScale', 'discreteMap', 'rangeMap'],
  'transform.scale': ['direct', 'linearScale', 'discreteMap', 'rangeMap'],
  'geometry.levelPercent': ['direct', 'linearScale'],
  'geometry.clipLevel': ['direct', 'linearScale'],
  'effect.blink': ['direct', 'discreteMap', 'rangeMap'],
  'effect.flow': ['direct', 'linearScale', 'discreteMap', 'rangeMap'],
};
const KINDS = ['direct', 'discreteMap', 'linearScale', 'valueTable', 'rangeMap'];
const sampleTransform = (kind: string, target: string): Json =>
  ({
    direct: { kind: 'direct' },
    discreteMap: { kind: 'discreteMap', cases: [{ equals: 1, value: 1 }] },
    linearScale: { kind: 'linearScale', inMin: 0, inMax: 100, outMin: 0, outMax: 1 },
    valueTable: {
      kind: 'valueTable',
      table: 'TrangThaiBom',
      output: target === 'style.fill' || target === 'style.stroke' ? 'color' : 'text',
    },
    rangeMap: { kind: 'rangeMap', ranges: [{ from: 0, value: 1 }] },
  })[kind];

describe('E_BIND_TRANSFORM: từng ô của bảng đích x phép biến đổi (contract §5)', () => {
  for (const [target, allowed] of Object.entries(ALLOWED_KINDS))
    for (const kind of KINDS)
      it(`${target} + ${kind}: ${allowed.includes(kind) ? 'nhận' : 'E_BIND_TRANSFORM'}`, async () => {
        // Tag INT16 `PUMP01.STATE` (số, có bảng giá trị): hợp mọi phép biến đổi số
        const r = await withBinding(
          bd('b1', target, 'PUMP01.STATE', sampleTransform(kind, target)),
        );
        expect(hasCode(r.errors, 'E_BIND_TRANSFORM'), JSON.stringify(r.errors)).toBe(
          !allowed.includes(kind),
        );
        if (allowed.includes(kind) && !(kind === 'direct' && DIRECT_TYPED.has(target)))
          expect(r.errors).toEqual([]);
      });
});

// Bảng tham số: đích -> khóa tham số của đích (contract §5)
const PARAMS_OF: Record<string, string[]> = {
  'text.content': ['format'],
  'transform.rotate': ['pivot', 'animation', 'reverse'],
  'transform.scale': ['axis', 'pivot'],
  'geometry.levelPercent': ['direction'],
  'geometry.clipLevel': ['direction'],
  'effect.blink': ['period', 'mode', 'minOpacity', 'color'],
  'effect.flow': ['dash', 'speed', 'reverse', 'byValueSign'],
};
const SAMPLE_PARAM: Record<string, Json> = {
  format: { decimals: 1 },
  pivot: [0.5, 0.5],
  animation: 'spin',
  reverse: true,
  axis: 'x',
  direction: 'up',
  period: 1000,
  mode: 'opacity',
  minOpacity: 0.2,
  color: '#ff0000',
  dash: '12 8',
  speed: 60,
  byValueSign: true,
};
describe('E_BIND_PARAM: tham số chỉ thuộc đích của nó', () => {
  for (const target of Object.keys(ALLOWED_KINDS))
    for (const [param, value] of Object.entries(SAMPLE_PARAM))
      it(`${target} + ${param}`, async () => {
        const allowedHere = (PARAMS_OF[target] ?? []).includes(param);
        // `reverse` của quay chỉ có nghĩa với `animation: spin`
        const extra: Json = { [param]: value };
        if (param === 'reverse' && target === 'transform.rotate') extra.animation = 'spin';
        const r = await withBinding(
          bd(
            'b1',
            target,
            'PUMP01.STATE',
            sampleTransform(ALLOWED_KINDS[target]![0]!, target),
            extra,
          ),
        );
        expect(hasCode(r.errors, 'E_BIND_PARAM'), JSON.stringify(r.errors)).toBe(!allowedHere);
      });
});

describe('E_BIND_PARAM: miền giá trị', () => {
  const flow = (extra: Json) =>
    bd('b1', 'effect.flow', 'PUMP01.RUN_CMD', { kind: 'direct' }, extra);
  const blink = (extra: Json) => [
    bd('b1', 'effect.blink', 'PUMP01.FAULT', { kind: 'direct' }, extra),
    bd('b2', 'text.content', 'PUMP01.FAULT', { kind: 'direct' }),
  ];
  const rot = (extra: Json) =>
    bd('b1', 'transform.rotate', 'TANK01.LEVEL', { kind: 'direct' }, extra);
  const txt = (extra: Json) => bd('b1', 'text.content', 'TANK01.LEVEL', { kind: 'direct' }, extra);
  const cases: Array<[string, () => Promise<Seen>, boolean]> = [
    ['period 399', () => withBinding(blink({ period: 399 })), false],
    ['period 400', () => withBinding(blink({ period: 400 })), true],
    ['period 5000', () => withBinding(blink({ period: 5000 })), true],
    ['period 5001', () => withBinding(blink({ period: 5001 })), false],
    ['speed 0', () => withBinding(flow({ speed: 0 })), true],
    ['speed 300', () => withBinding(flow({ speed: 300 })), true],
    ['speed 301', () => withBinding(flow({ speed: 301 })), false],
    ['pivot -0.01', () => withBinding(rot({ pivot: [-0.01, 0.5] })), false],
    ['pivot 0,1', () => withBinding(rot({ pivot: [0, 1] })), true],
    ['pivot 1.01', () => withBinding(rot({ pivot: [0.5, 1.01] })), false],
    ['minOpacity 0.9', () => withBinding(blink({ minOpacity: 0.9 })), true],
    ['minOpacity 0.91', () => withBinding(blink({ minOpacity: 0.91 })), false],
    ['decimals 6', () => withBinding(txt({ format: { decimals: 6 } })), true],
    ['decimals 7', () => withBinding(txt({ format: { decimals: 7 } })), false],
    ['prefix 16', () => withBinding(txt({ format: { prefix: 'x'.repeat(16) } })), true],
    ['prefix 17', () => withBinding(txt({ format: { prefix: 'x'.repeat(17) } })), false],
    [
      'prefix 16 ký tự Unicode (> 16 byte)',
      () => withBinding(txt({ format: { prefix: 'ế'.repeat(16) } })),
      true,
    ],
    ['dash "12 8"', () => withBinding(flow({ dash: '12 8' })), true],
    ['dash "12x8"', () => withBinding(flow({ dash: '12x8' })), false],
    ['blink mode fill cần color', () => withBinding(blink({ mode: 'fill' })), false],
    ['blink mode fill có color', () => withBinding(blink({ mode: 'fill', color: 'red' })), true],
    ['blink color #12', () => withBinding(blink({ mode: 'fill', color: '#12' })), false],
    [
      'axis x',
      () =>
        withBinding(bd('b1', 'transform.scale', 'TANK01.LEVEL', { kind: 'direct' }, { axis: 'x' })),
      true,
    ],
    [
      'axis z',
      () =>
        withBinding(bd('b1', 'transform.scale', 'TANK01.LEVEL', { kind: 'direct' }, { axis: 'z' })),
      false,
    ],
  ];
  for (const [name, fn, valid] of cases)
    it(name, async () => {
      const r = await fn();
      expect(hasCode(r.errors, 'E_BIND_PARAM'), JSON.stringify(r.errors)).toBe(!valid);
    });
});

describe('E_DUP_BINDING: nhóm đích', () => {
  const groups: Array<[string, string[]]> = [
    ['chữ', ['text.content']],
    ['màu nền', ['style.fill']],
    ['màu viền', ['style.stroke']],
    ['độ mờ', ['style.opacity']],
    ['hiện ẩn', ['style.visibility']],
    ['quay (tĩnh và spin)', ['transform.rotate', 'transform.rotate:spin']],
    ['di chuyển X', ['transform.translateX']],
    ['di chuyển Y', ['transform.translateY']],
    ['co giãn', ['transform.scale']],
    ['mức', ['geometry.levelPercent', 'geometry.clipLevel']],
    ['nhấp nháy', ['effect.blink']],
    ['dòng chảy', ['effect.flow']],
  ];
  const mk = (id: string, spec: string): Json => {
    const [target, mode] = spec.split(':');
    const transform =
      target === 'style.fill' || target === 'style.stroke'
        ? { kind: 'rangeMap', ranges: [{ from: 0, value: '#fff' }] }
        : { kind: 'direct' };
    const tag =
      target === 'style.visibility' || target === 'effect.blink' || target === 'effect.flow'
        ? 'PUMP01.RUN_CMD'
        : 'TANK01.LEVEL';
    return bd(id, target!, tag, transform, mode === 'spin' ? { animation: 'spin' } : {});
  };
  for (const [name, targets] of groups) {
    it(`${name}: hai binding cùng nhóm là E_DUP_BINDING`, async () => {
      const all = targets.length === 1 ? [targets[0]!, targets[0]!] : targets;
      const r = await withBinding(all.map((t, i) => mk(`b${i + 1}`, t)));
      expect(r.errors).toContain(`E_DUP_BINDING ${MB}/elements/0/bindings/1/target`);
    });
  }
  it('khác nhóm thì không trùng (12 nhóm trên một phần tử)', async () => {
    const r = await withBinding(groups.map(([, t], i) => mk(`b${pad(i)}`, t[0]!)));
    expect(hasCode(r.errors, 'E_DUP_BINDING')).toBe(false);
  });
  it('id trùng trong file (giữa hai phần tử) vẫn là E_DUP_BINDING', async () => {
    const r = await run((f) => {
      f[MB].elements = [
        {
          elementUid: 'el_aaa',
          bindings: [bd('same', 'text.content', 'TANK01.LEVEL', { kind: 'direct' })],
        },
        {
          elementUid: 'el_bbb',
          bindings: [bd('same', 'text.content', 'TANK01.LEVEL', { kind: 'direct' })],
        },
      ];
    });
    expect(r.errors).toContain(`E_DUP_BINDING ${MB}/elements/1/bindings/0/id`);
  });
});
const pad = (i: number) => String(i).padStart(2, '0');

describe('E_RANGE: khoảng của rangeMap (nửa mở [from, to))', () => {
  const rm = (ranges: Json[]) =>
    withBinding(bd('b1', 'text.content', 'TANK01.LEVEL', { kind: 'rangeMap', ranges }));
  const only = (r: Seen) => r.errors.filter((e) => e.startsWith('E_RANGE'));
  const P = `${MB}/elements/0/bindings/0/transform/ranges`;
  it('chạm đầu (to = from kế) không chồng', async () => {
    expect(
      (
        await rm([
          { to: 5, value: 'a' },
          { from: 5, value: 'b' },
        ])
      ).errors,
    ).toEqual([]);
  });
  it('chồng báo ở khoảng đứng sau trong file', async () => {
    expect(
      only(
        await rm([
          { from: 0, to: 10, value: 'a' },
          { from: 9.5, to: 20, value: 'b' },
        ]),
      ),
    ).toEqual([`E_RANGE ${P}/1`]);
    expect(
      only(
        await rm([
          { from: 9.5, to: 20, value: 'b' },
          { from: 0, to: 10, value: 'a' },
        ]),
      ),
    ).toEqual([`E_RANGE ${P}/1`]);
  });
  it('from >= to và thiếu cả from lẫn to', async () => {
    expect(only(await rm([{ from: 5, to: 5, value: 'a' }]))).toEqual([`E_RANGE ${P}/0`]);
    expect(only(await rm([{ from: 6, to: 5, value: 'a' }]))).toEqual([`E_RANGE ${P}/0`]);
    expect(only(await rm([{ value: 'a' }]))).toEqual([`E_RANGE ${P}/0`]);
  });
  it('số khoảng 0 và 65 là lỗi; 1 và 64 hợp lệ', async () => {
    const n = (k: number) =>
      Array.from({ length: k }, (_, i) => ({ from: i, to: i + 1, value: `v${i}` }));
    expect(only(await rm([]))).toEqual([`E_RANGE ${P}`]);
    expect(only(await rm(n(65)))).toEqual([`E_RANGE ${P}`]);
    expect(only(await rm(n(1)))).toEqual([]);
    expect(only(await rm(n(64)))).toEqual([]);
  });
  it('rangeMap cần Tag số (BOOL, STRING: E_TYPE_MISMATCH)', async () => {
    const bad = (tag: string) =>
      withBinding(
        bd('b1', 'text.content', tag, { kind: 'rangeMap', ranges: [{ from: 0, value: 'a' }] }),
      );
    expect(hasCode((await bad('PUMP01.FAULT')).errors, 'E_TYPE_MISMATCH')).toBe(true);
    expect(hasCode((await bad('PUMP01.NAME')).errors, 'E_TYPE_MISMATCH')).toBe(true);
    expect(hasCode((await bad('PUMP01.STATE')).errors, 'E_TYPE_MISMATCH')).toBe(false);
  });
});

describe('E_TYPE_MISMATCH: Tag STRING chỉ vào chữ, màu và hiện ẩn (discreteMap)', () => {
  const str = (target: string, transform: Json) =>
    withBinding(bd('b1', target, 'PUMP01.NAME', transform));
  const dm = { kind: 'discreteMap', cases: [{ equals: 'a', value: 1 }] };
  for (const target of [
    'style.opacity',
    'transform.rotate',
    'transform.translateX',
    'transform.scale',
    'effect.blink',
    'effect.flow',
  ])
    it(`STRING -> ${target}`, async () => {
      expect(hasCode((await str(target, dm)).errors, 'E_TYPE_MISMATCH')).toBe(true);
    });
  it('STRING -> text.content, style.fill, style.visibility qua discreteMap hợp lệ', async () => {
    expect((await str('text.content', dm)).errors).toEqual([]);
    expect(
      (await str('style.fill', { kind: 'discreteMap', cases: [{ equals: 'a', value: '#fff' }] }))
        .errors,
    ).toEqual([]);
    expect(
      (
        await str('style.visibility', {
          kind: 'discreteMap',
          cases: [{ equals: 'a', value: 'hidden' }],
        })
      ).errors,
    ).toEqual([]);
  });
});

describe('E_LIMIT, W_ANIM_MANY, W_BLINK_ONLY', () => {
  /** n item svg ở `main` (mỗi item một file binding riêng, dùng chung SVG). */
  const manyItems = (n: number) => (f: Record<string, Json>) => {
    const screen = f[MAIN] as ScreenModel;
    const first = screen.items[0]!;
    screen.items = [];
    for (let i = 0; i < n; i++) {
      const id = `svg${String(i + 1).padStart(3, '0')}`;
      const bf = `screens/main.${id}.bindings.json`;
      screen.items.push({ ...JSON.parse(JSON.stringify(first)), id, bindingFile: bf, x: 0, y: 0 });
      f[bf] = {
        schemaVersion: '0.4.0',
        screenId: 'main',
        itemId: id,
        elements: [{ elementUid: 'el_aaa', events: { click: { action: 'closePopup' } } }],
      };
    }
  };
  it('64 item svg hợp lệ, 65 là E_LIMIT', async () => {
    expect(hasCode((await run(manyItems(64))).errors, 'E_LIMIT')).toBe(false);
    expect((await run(manyItems(65))).errors).toContain(`E_LIMIT ${MAIN}/items`);
  });
  const anims =
    (n: number, hidden = false) =>
    (f: Record<string, Json>) => {
      const els: Json[] = [];
      const uids: Json[] = [];
      for (let i = 0; i < n; i++) {
        const uid = `el_a${String(i + 1).padStart(4, '0')}`;
        uids.push({ elementUid: uid });
        els.push({
          elementUid: uid,
          bindings: [
            bd(
              `b${i + 1}`,
              'transform.rotate',
              'TANK01.LEVEL',
              { kind: 'direct' },
              { animation: 'spin' },
            ),
          ],
        });
      }
      f[MB].elements = els;
      f[MAIN].items[0].elements = uids;
      if (hidden) f[MAIN].items[0].hidden = true;
    };
  it('64 hoạt ảnh không cảnh báo; 65 W_ANIM_MANY; 256 chưa lỗi; 257 E_LIMIT', async () => {
    const w = (r: Seen) => hasCode(r.warnings, 'W_ANIM_MANY');
    const e = (r: Seen) => r.errors.includes(`E_LIMIT ${MAIN}/items`);
    expect(w(await run(anims(64)))).toBe(false);
    expect(w(await run(anims(65)))).toBe(true);
    const r256 = await run(anims(256));
    expect(w(r256)).toBe(true);
    expect(e(r256)).toBe(false);
    expect(e(await run(anims(257)))).toBe(true);
  });
  it('item ẩn không tính', async () => {
    const r = await run(anims(300, true));
    expect(hasCode(r.errors, 'E_LIMIT')).toBe(false);
    expect(hasCode(r.warnings, 'W_ANIM_MANY')).toBe(false);
  });
  it('chỉ spin, blink, flow tính là hoạt ảnh vô hạn; rotate tĩnh thì không', async () => {
    const make = (target: string, extra: Json, tag: string) => (f: Record<string, Json>) => {
      const els: Json[] = [];
      const uids: Json[] = [];
      for (let i = 0; i < 65; i++) {
        const uid = `el_a${String(i + 1).padStart(4, '0')}`;
        uids.push({ elementUid: uid });
        els.push({
          elementUid: uid,
          bindings: [
            bd('b1', target, tag, { kind: 'direct' }, extra),
            ...(target === 'effect.blink'
              ? [bd('b2', 'text.content', tag, { kind: 'direct' })]
              : []),
          ],
        });
      }
      // binding id chỉ cần khác nhau trong một file: làm id duy nhất
      els.forEach((e, i) => e.bindings.forEach((b: Json, j: number) => (b.id = `b${i}_${j}`)));
      f[MB].elements = els;
      f[MAIN].items[0].elements = uids;
    };
    const w = async (m: (f: Record<string, Json>) => void) =>
      hasCode((await run(m)).warnings, 'W_ANIM_MANY');
    expect(await w(make('transform.rotate', { animation: 'spin' }, 'TANK01.LEVEL'))).toBe(true);
    expect(await w(make('effect.blink', {}, 'PUMP01.FAULT'))).toBe(true);
    expect(await w(make('effect.flow', {}, 'PUMP01.RUN_CMD'))).toBe(true);
    expect(await w(make('transform.rotate', {}, 'TANK01.LEVEL'))).toBe(false);
    expect(await w(make('style.opacity', {}, 'TANK01.LEVEL'))).toBe(false);
  });
  it('W_BLINK_ONLY: nhấp nháy là tín hiệu duy nhất; có chữ, màu nền, màu viền cùng Tag thì không', async () => {
    const blink = bd('b1', 'effect.blink', 'PUMP01.FAULT', { kind: 'direct' });
    const warn = async (...others: Json[]) =>
      hasCode((await withBinding([blink, ...others])).warnings, 'W_BLINK_ONLY');
    const map = { kind: 'discreteMap', cases: [{ equals: true, value: '#f00' }], default: '#000' };
    expect(await warn()).toBe(true);
    expect(await warn(bd('b2', 'style.fill', 'PUMP01.FAULT', map))).toBe(false);
    expect(await warn(bd('b2', 'style.stroke', 'PUMP01.FAULT', map))).toBe(false);
    expect(await warn(bd('b2', 'text.content', 'PUMP01.FAULT', { kind: 'direct' }))).toBe(false);
    expect(await warn(bd('b2', 'style.fill', 'TANK01.HIGH', map))).toBe(true);
    expect(await warn(bd('b2', 'style.opacity', 'TANK01.LEVEL', { kind: 'direct' }))).toBe(true);
  });
});

describe('sự kiện click của phần tử', () => {
  const click = (c: Json, mutate?: (f: Record<string, Json>) => void) =>
    run((f) => {
      f[MB].elements = [{ elementUid: 'el_aaa', events: { click: c } }];
      mutate?.(f);
    });
  const P = `${MB}/elements/0/events/click`;

  it('6 hành động hợp lệ', async () => {
    for (const c of [
      { action: 'write', tag: 'TANK01.SP', value: 10 },
      { action: 'toggle', tag: 'PUMP01.RUN_CMD' },
      { action: 'pulse', tag: 'PUMP01.RUN_CMD', value: true, durationMs: 500 },
      { action: 'navigate', screen: 'main' },
      { action: 'popup', screen: 'pump' },
      { action: 'closePopup' },
    ])
      expect((await click(c)).errors, JSON.stringify(c)).toEqual([]);
  });
  it('E_EVENT_ACTION: khóa lạ, hành động lạ, trường thừa hoặc thiếu', async () => {
    const r = await run((f) => {
      f[MB].elements = [{ elementUid: 'el_aaa', events: { dblclick: { action: 'closePopup' } } }];
    });
    expect(r.errors).toContain(`E_EVENT_ACTION ${MB}/elements/0/events/dblclick`);
    expect((await click({ action: 'drag' })).errors).toContain(`E_EVENT_ACTION ${P}/action`);
    expect((await click({ action: 'navigate', screen: 'main', tag: 'X' })).errors).toContain(
      `E_EVENT_ACTION ${P}/tag`,
    );
    expect((await click({ action: 'pulse', tag: 'PUMP01.RUN_CMD', value: true })).errors).toContain(
      `E_EVENT_ACTION ${P}`,
    );
    expect((await click({ action: 'closePopup', label: 'x'.repeat(81) })).errors).toContain(
      `E_EVENT_ACTION ${P}/label`,
    );
    expect((await click({ action: 'closePopup', label: 'x'.repeat(80) })).errors).toEqual([]);
    for (const d of [99, 10001])
      expect(
        (await click({ action: 'pulse', tag: 'PUMP01.RUN_CMD', value: true, durationMs: d }))
          .errors,
      ).toContain(`E_EVENT_ACTION ${P}/durationMs`);
  });
  it('E_EVENT_TAG: Tag không có, không ghi được, sai kiểu, ngoài limits', async () => {
    const t = async (c: Json, sub: string) =>
      expect((await click(c)).errors).toContain(`E_EVENT_TAG ${P}${sub}`);
    await t({ action: 'toggle', tag: 'NO.SUCH' }, '/tag');
    await t({ action: 'toggle', tag: 'PUMP01.FAULT' }, '/tag'); // chỉ đọc
    await t({ action: 'toggle', tag: 'TANK01.HIGH' }, '/tag'); // tính toán
    await t({ action: 'write', tag: 'DEMO.WAVE', value: 1 }, '/tag'); // mô phỏng không nhập tay
    await t({ action: 'toggle', tag: 'TANK01.SP' }, '/tag'); // không phải BOOL
    await t({ action: 'pulse', tag: 'TANK01.SP', value: true, durationMs: 500 }, '/tag');
    await t({ action: 'write', tag: 'PUMP01.RUN_CMD', value: 1 }, '/value');
    await t({ action: 'write', tag: 'TANK01.SP', value: 91 }, '/value');
    await t({ action: 'write', tag: 'DEMO.SET', value: 1.5 }, '/value');
    expect((await click({ action: 'write', tag: 'DEMO.SET', value: 5 })).errors).toEqual([]); // mô phỏng nhập tay
  });
  it('E_EVENT_TARGET: navigate tới màn hình thường, popup tới popup', async () => {
    const t = async (c: Json) =>
      expect((await click(c)).errors).toContain(`E_EVENT_TARGET ${P}/screen`);
    await t({ action: 'navigate', screen: 'pump' });
    await t({ action: 'navigate', screen: 'nowhere' });
    await t({ action: 'popup', screen: 'main' });
    await t({ action: 'popup', screen: 'nowhere' });
  });
  it('E_EVENT_CONFIRM, W_EVENT_CONFIRM_NONE: none chỉ cho Tag BOOL', async () => {
    expect(
      (await click({ action: 'write', tag: 'TANK01.SP', value: 1, confirm: 'none' })).errors,
    ).toContain(`E_EVENT_CONFIRM ${P}/confirm`);
    const r = await click({ action: 'toggle', tag: 'PUMP01.RUN_CMD', confirm: 'none' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toContain(`W_EVENT_CONFIRM_NONE ${P}/confirm`);
    expect(
      (await click({ action: 'toggle', tag: 'PUMP01.RUN_CMD', confirm: 'always' })).warnings,
    ).toEqual([]);
  });
  it('E_EVENT_MINROLE: viewer và giá trị lạ', async () => {
    for (const m of ['viewer', 'root'])
      expect(
        (await click({ action: 'toggle', tag: 'PUMP01.RUN_CMD', minRole: m })).errors,
      ).toContain(`E_EVENT_MINROLE ${P}/minRole`);
    for (const m of ['operator', 'engineer', 'administrator'])
      expect((await click({ action: 'toggle', tag: 'PUMP01.RUN_CMD', minRole: m })).errors).toEqual(
        [],
      );
  });
  it('W_EVENT_PULSE_READBACK: pulse trên Tag đọc lại', async () => {
    const r = await click({ action: 'pulse', tag: 'PUMP02.CMD', value: true, durationMs: 500 });
    expect(r.warnings).toContain(`W_EVENT_PULSE_READBACK ${P}`);
    expect(
      (await click({ action: 'pulse', tag: 'PUMP01.RUN_CMD', value: true, durationMs: 500 }))
        .warnings,
    ).toEqual([]);
  });
  it('E_REF_UID: sự kiện của phần tử không khai trong item', async () => {
    const r = await run((f) => {
      f[MB].elements = [{ elementUid: 'el_zzz', events: { click: { action: 'closePopup' } } }];
    });
    expect(r.errors).toContain(`E_REF_UID ${MB}/elements/0/elementUid`);
  });
  it('elementUid quá ngắn (`el_go`, dưới 3 ký tự sau tiền tố) không bị bỏ im lặng: lỗi schema ở binding và ở khai báo của item', async () => {
    const r = await run((f) => {
      f[MB].elements = [{ elementUid: 'el_go', events: { click: { action: 'closePopup' } } }];
    });
    expect(r.errors.some((e) => e.startsWith('E_SCHEMA ') && e.includes(MB))).toBe(true);
    const r2 = await run((f) => {
      const items = (f[MAIN] as { items: Array<{ elements?: Array<{ elementUid: string }> }> })
        .items;
      const svg = items.find((i) => Array.isArray(i.elements))!;
      svg.elements![0]!.elementUid = 'el_go';
    });
    expect(r2.errors.some((e) => e.includes(MAIN))).toBe(true);
  });
  it('phần tử có cả binding và sự kiện; Tag của sự kiện tính vào Tag của màn hình', async () => {
    const r = await run((f) => {
      f[MB].elements = [
        {
          elementUid: 'el_aaa',
          bindings: [bd('b1', 'style.opacity', 'TANK01.LEVEL', { kind: 'direct' })],
          events: { click: { action: 'toggle', tag: 'PUMP01.RUN_CMD' } },
        },
      ];
    });
    expect(r.errors).toEqual([]);
  });
});

describe('phiên bản', () => {
  it('E_MIN_RUNTIME với minRuntimeVersion < 0.7.0', async () => {
    const r = await run((f) => (f['project.json'].minRuntimeVersion = '0.6.0'));
    expect(r.errors).toContain('E_MIN_RUNTIME project.json/minRuntimeVersion');
  });
  it('E_SCHEMA_VERSION khi một file khác 0.4.x', async () => {
    const r = await run((f) => (f[MB].schemaVersion = '0.3.0'));
    expect(r.errors).toContain(`E_SCHEMA_VERSION ${MB}/schemaVersion`);
  });
  it('0.4.9 (PATCH) được nhận', async () => {
    const r = await run((f) => {
      for (const v of Object.values(f))
        if (typeof v === 'object' && v.schemaVersion) v.schemaVersion = '0.4.9';
    });
    expect(r.errors).toEqual([]);
  });
  it('chọn bộ schema 0.4: khóa 0.4 bị 0.3 từ chối, và ngược lại 0.3 không nhận target mới', async () => {
    const r = await run((f) => {
      f['project.json'].schemaVersion = '0.3.0';
      for (const [k, v] of Object.entries(f))
        if (k !== 'project.json' && typeof v === 'object' && v.schemaVersion)
          v.schemaVersion = '0.3.0';
      f[MB].elements = [
        {
          elementUid: 'el_aaa',
          bindings: [bd('b1', 'effect.blink', 'PUMP01.FAULT', { kind: 'direct' })],
        },
      ];
    });
    expect(codesOf(r.errors)).toContain('E_SCHEMA');
  });
});
