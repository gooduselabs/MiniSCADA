// Luật 0.3 (T013; contracts/project-format-0.3.md §7): ca nhỏ dựng từ vector `v03-valid-full` bằng hàm trợ giúp,
// và các hàm thuần của rules-03 (đếm Tag theo màn hình-popup, hình học item). Vector đầy đủ: vectors-03.test.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIMITS_03,
  MemorySource,
  isOutside,
  itemCovers,
  popupTargets,
  screenTagIds,
  validateProject,
  type BindingSet03,
  type ScreenModel,
} from './index.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors/v03-valid-full');
const MAIN = 'screens/main.screen.json';
const POP = 'screens/pump.screen.json';

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

/** Sửa file JSON `file` của vector hợp lệ, kiểm project, trả `{ code, path }` của lỗi và cảnh báo ở file đó. */
async function issuesAfter(
  file: string,
  mutate: (j: Json) => void,
): Promise<{ errors: string[]; warnings: string[] }> {
  const files = tree(DIR);
  const j = JSON.parse(files[file]!);
  mutate(j);
  files[file] = JSON.stringify(j);
  const r = await validateProject(new MemorySource(files), { checkSvg: false });
  const fmt = (i: { code: string; file: string; path: string }) => `${i.code} ${i.file}${i.path}`;
  return { errors: r.errors.map(fmt).sort(), warnings: r.warnings.map(fmt).sort() };
}
const errorsAfter = async (file: string, mutate: (j: Json) => void) =>
  (await issuesAfter(file, mutate)).errors;
const mainItem = (j: Json, id: string): Json => j.items.find((i: Json) => i.id === id);

describe('nền: v03-valid-full hợp lệ', () => {
  it('không lỗi, không cảnh báo, có project03', async () => {
    const r = await validateProject(new MemorySource(tree(DIR)), { checkSvg: false });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(Object.keys(r.project03?.screens ?? {})).toEqual(['main', 'pump']);
    expect(r.project03?.screens.main!.bindings.svg1).toBeDefined();
  });
});

describe('màn hình', () => {
  it('id khác tên file là E_SCREEN_ID ở /id', async () =>
    expect(await errorsAfter(MAIN, (j) => (j.id = 'khac'))).toEqual([
      'E_SCREEN_ID screens/main.bindings.json/screenId', // binding khai screenId 'main'
      `E_SCREEN_ID ${MAIN}/id`,
    ]));
  it('kind lạ là E_SCREEN_KIND ở /kind', async () =>
    expect(await errorsAfter(MAIN, (j) => (j.kind = 'modal'))).toEqual([
      `E_SCREEN_KIND ${MAIN}/kind`,
    ]));
  it('entryScreen là popup: E_SCREEN_KIND ở /entryScreen', async () =>
    expect(await errorsAfter('project.json', (j) => (j.entryScreen = 'pump'))).toEqual([
      'E_SCREEN_KIND project.json/entryScreen',
    ]));
  for (const [w, h, want] of [
    [64, 64, []],
    [63, 64, ['/size/width']],
    [64, 63, ['/size/height']],
    [4096, 2304, []],
    [4097, 2304, ['/size/width']],
    [4096, 2305, ['/size/height']],
  ] as const)
    it(`size ${w} x ${h}`, async () =>
      expect(
        (
          await errorsAfter(MAIN, (j) => ((j.size = { width: w, height: h }), (j.items = [])))
        ).sort(),
      ).toEqual(want.map((p) => `E_SCREEN_SIZE ${MAIN}${p}`)));
  it('đủ 250 item hợp lệ, 251 là E_LIMIT', async () => {
    const make = (n: number) => (j: Json) => {
      j.items = Array.from({ length: n }, (_, i) => ({
        id: `p${String(i + 1).padStart(3, '0')}`,
        type: 'widget',
        widget: 'panel',
        x: i,
        y: i,
        width: 100,
        height: 100,
      }));
    };
    expect(await errorsAfter(MAIN, make(250))).toEqual([]);
    expect(await errorsAfter(MAIN, make(251))).toEqual([`E_LIMIT ${MAIN}/items`]);
  });
  it('màn hình rỗng: W_SCREEN_EMPTY ở file; stretch kèm widget: W_STRETCH_WIDGETS', async () => {
    expect((await issuesAfter(MAIN, (j) => (j.items = []))).warnings).toEqual([
      `W_SCREEN_EMPTY ${MAIN}`,
    ]);
    expect((await issuesAfter(MAIN, (j) => (j.fitMode = 'stretch'))).warnings).toEqual([
      `W_STRETCH_WIDGETS ${MAIN}/fitMode`,
    ]);
  });
});

describe('item', () => {
  it('id sai dạng và trùng: E_ITEM_ID', async () => {
    expect(await errorsAfter(MAIN, (j) => (mainItem(j, 'tbl').id = 'Tbl'))).toEqual([
      `E_ITEM_ID ${MAIN}/items/9/id`,
    ]);
    expect(await errorsAfter(MAIN, (j) => (mainItem(j, 'tbl').id = 'trend'))).toEqual([
      `E_ITEM_ID ${MAIN}/items/9/id`,
    ]);
  });
  it('cỡ nhỏ hơn minSize: E_ITEM_SIZE ở /width, /height', async () => {
    expect(
      await errorsAfter(MAIN, (j) => {
        const c = mainItem(j, 'card_level');
        c.width = 95;
        c.height = 55;
      }),
    ).toEqual([`E_ITEM_SIZE ${MAIN}/items/2/height`, `E_ITEM_SIZE ${MAIN}/items/2/width`]);
  });
  it('cỡ 0 và âm: E_ITEM_SIZE (không phải E_SCHEMA)', async () =>
    expect(
      await errorsAfter(MAIN, (j) => {
        const c = mainItem(j, 'panel_1');
        c.width = 0;
        c.height = -4;
      }),
    ).toEqual([`E_ITEM_SIZE ${MAIN}/items/1/height`, `E_ITEM_SIZE ${MAIN}/items/1/width`]));
  it('loại widget lạ: E_WIDGET_UNKNOWN và bỏ qua các luật khác của item', async () =>
    expect(
      await errorsAfter(MAIN, (j) => {
        const c = mainItem(j, 'card_level');
        c.widget = 'gizmo';
        c.props = { bất: 'kỳ' };
      }),
    ).toEqual([`E_WIDGET_UNKNOWN ${MAIN}/items/2/widget`]));
});

describe('item svg', () => {
  it('uid trùng trong elements: E_DUP_UID', async () =>
    expect(
      await errorsAfter(MAIN, (j) => mainItem(j, 'svg1').elements.push({ elementUid: 'el_aaa' })),
    ).toEqual([`E_DUP_UID ${MAIN}/items/0/elements/3/elementUid`]));
  it('binding trỏ uid không khai: E_REF_UID', async () =>
    expect(
      await errorsAfter(MAIN, (j) => {
        mainItem(j, 'svg1').elements.pop();
      }),
    ).toEqual(['E_REF_UID screens/main.bindings.json/elements/2/elementUid']));
  it('itemId của binding khác id item: E_SCHEMA ở /itemId', async () =>
    expect(await errorsAfter('screens/main.bindings.json', (j) => (j.itemId = 'svg7'))).toEqual([
      'E_SCHEMA screens/main.bindings.json/itemId',
    ]));
  it('hai item chung file binding: E_SCHEMA ở item sau', async () =>
    expect(
      await errorsAfter(MAIN, (j) =>
        j.items.push({ ...mainItem(j, 'svg1'), id: 'svg2', x: 500, y: 500, width: 50, height: 50 }),
      ),
    ).toEqual(expect.arrayContaining([`E_SCHEMA ${MAIN}/items/10/bindingFile`])));
  it('quá 8 item svg: E_LIMIT', async () => {
    expect(
      (
        await errorsAfter(MAIN, (j) => {
          j.items = Array.from({ length: 9 }, (_, i) => ({
            ...mainItem(j, 'svg1'),
            id: `s${i + 1}0`,
            bindingFile: `screens/b${i + 1}.bindings.json`,
            x: i * 10,
          }));
        })
      ).filter((e) => e.startsWith('E_LIMIT')),
    ).toEqual([`E_LIMIT ${MAIN}/items`]);
  });
});

describe('widget', () => {
  it('E_WIDGET_PROP: khóa lạ, sai kiểu, ngoài khoảng', async () => {
    expect(await errorsAfter(MAIN, (j) => (mainItem(j, 'card_level').props.zzz = 1))).toEqual([
      `E_WIDGET_PROP ${MAIN}/items/2/props/zzz`,
    ]);
    expect(
      await errorsAfter(MAIN, (j) => (mainItem(j, 'card_level').props.decimals = '1')),
    ).toEqual([`E_WIDGET_PROP ${MAIN}/items/2/props/decimals`]);
    expect(await errorsAfter(MAIN, (j) => (mainItem(j, 'card_level').props.decimals = 7))).toEqual([
      `E_WIDGET_PROP ${MAIN}/items/2/props/decimals`,
    ]);
  });
  it('E_WIDGET_SLOT: khe lạ và khe bắt buộc thiếu', async () => {
    expect(
      await errorsAfter(MAIN, (j) => (mainItem(j, 'card_level').tags.other = 'TANK01.SP')),
    ).toEqual([`E_WIDGET_SLOT ${MAIN}/items/2/tags/other`]);
    expect(await errorsAfter(MAIN, (j) => delete mainItem(j, 'card_level').tags.value)).toEqual([
      `E_WIDGET_SLOT ${MAIN}/items/2/tags`,
    ]);
  });
  it('E_REF_TAG, E_WIDGET_TAG_TYPE, E_TAG_ACCESS', async () => {
    expect(
      await errorsAfter(MAIN, (j) => (mainItem(j, 'card_level').tags.value = 'NO.TAG')),
    ).toEqual([`E_REF_TAG ${MAIN}/items/2/tags/value`]);
    expect(
      await errorsAfter(MAIN, (j) => (mainItem(j, 'gauge_level').tags.value = 'PUMP01.FAULT')),
    ).toEqual([`E_WIDGET_TAG_TYPE ${MAIN}/items/4/tags/value`]);
    expect(
      await errorsAfter(MAIN, (j) => (mainItem(j, 'sp_level').tags.target = 'TANK01.LEVEL')),
    ).toEqual([`E_TAG_ACCESS ${MAIN}/items/5/tags/target`]);
  });
  it('E_WIDGET_LIMITS: nới rộng giới hạn của Tag', async () => {
    expect(await errorsAfter(MAIN, (j) => (mainItem(j, 'sp_level').props.max = 91))).toEqual([
      `E_WIDGET_LIMITS ${MAIN}/items/5/props/max`,
    ]);
    expect(await errorsAfter(MAIN, (j) => (mainItem(j, 'sp_level').props.min = -1))).toEqual([
      `E_WIDGET_LIMITS ${MAIN}/items/5/props/min`,
    ]);
  });
  it('E_WIDGET_MINROLE: viewer và giá trị lạ', async () => {
    for (const role of ['viewer', 'root'])
      expect(
        await errorsAfter(MAIN, (j) => (mainItem(j, 'sp_level').security.minRole = role)),
      ).toEqual([`E_WIDGET_MINROLE ${MAIN}/items/5/security/minRole`]);
  });
  it('E_ACTION: durationMs ở biên 100, 99, 10000, 10001', async () => {
    const pulse = (ms: number) => (j: Json) => {
      const b = mainItem(j, 'btn_run');
      b.events.click = { action: 'pulse', value: true, durationMs: ms };
    };
    expect(await errorsAfter(MAIN, pulse(100))).toEqual([]);
    expect(await errorsAfter(MAIN, pulse(10000))).toEqual([]);
    for (const ms of [99, 10001])
      expect(await errorsAfter(MAIN, pulse(ms))).toEqual([
        `E_ACTION ${MAIN}/items/6/events/click/durationMs`,
      ]);
  });
  it('E_ACTION_TARGET: navigate tới popup, popup tới màn hình thường', async () => {
    expect(
      await errorsAfter(MAIN, (j) => (mainItem(j, 'btn_pump').events.click.action = 'navigate')),
    ).toEqual([`E_ACTION_TARGET ${MAIN}/items/7/events/click/screen`]);
    expect(
      await errorsAfter(MAIN, (j) => (mainItem(j, 'btn_pump').events.click.screen = 'main')),
    ).toEqual([`E_ACTION_TARGET ${MAIN}/items/7/events/click/screen`]);
  });
  it('W_ACTION_NOOP: closePopup ở màn hình thường; không cảnh báo trong popup', async () => {
    expect(
      (
        await issuesAfter(
          MAIN,
          (j) => (mainItem(j, 'btn_pump').events.click = { action: 'closePopup' }),
        )
      ).warnings,
    ).toEqual([`W_ACTION_NOOP ${MAIN}/items/7/events/click`]);
    expect((await issuesAfter(POP, () => {})).warnings).toEqual([]);
  });
  it('W_ITEM_COVERED và W_ITEM_OUTSIDE', async () => {
    expect(
      (
        await issuesAfter(MAIN, (j) => {
          j.items.push({
            id: 'cover',
            type: 'widget',
            widget: 'panel',
            x: 430,
            y: 50,
            width: 430,
            height: 130,
          });
        })
      ).warnings,
    ).toEqual([`W_ITEM_COVERED ${MAIN}/items/2`, `W_ITEM_COVERED ${MAIN}/items/3`]);
    expect(
      (
        await issuesAfter(MAIN, (j) => {
          mainItem(j, 'tbl').x = 5000;
        })
      ).warnings,
    ).toEqual([`W_ITEM_OUTSIDE ${MAIN}/items/9`]);
  });
});

describe('điều hướng', () => {
  const nav = async (items: unknown) =>
    errorsAfter('project.json', (j) => (j.navigation.items = items));
  it('đích không có hoặc là popup: E_NAV ở /screen', async () => {
    expect(await nav([{ label: 'A', screen: 'nope' }])).toEqual([
      'E_NAV project.json/navigation/items/0/screen',
    ]);
    expect(await nav([{ label: 'A', screen: 'pump' }])).toEqual([
      'E_NAV project.json/navigation/items/0/screen',
    ]);
  });
  it('nhóm lồng nhóm, nhóm rỗng, mục không đích: E_NAV', async () => {
    expect(
      await nav([{ label: 'G', items: [{ label: 'H', items: [{ label: 'X', screen: 'main' }] }] }]),
    ).toEqual(['E_NAV project.json/navigation/items/0/items/0']);
    expect(await nav([{ label: 'G', items: [] }])).toEqual([
      'E_NAV project.json/navigation/items/0',
    ]);
    expect(await nav([{ label: 'G' }])).toEqual(['E_NAV project.json/navigation/items/0']);
  });
  it('32 mục lá hợp lệ, 33 là E_LIMIT', async () => {
    const leaves = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ label: `m${i}`, screen: 'main' }));
    expect(await nav(leaves(32))).toEqual([]);
    expect(await nav(leaves(33))).toEqual(['E_LIMIT project.json/navigation/items']);
  });
});

describe('phiên bản', () => {
  it('minRuntimeVersion < 0.6.0: E_MIN_RUNTIME', async () =>
    expect(await errorsAfter('project.json', (j) => (j.minRuntimeVersion = '0.5.0'))).toEqual([
      'E_MIN_RUNTIME project.json/minRuntimeVersion',
    ]));
  it('file trộn phiên bản: E_SCHEMA_VERSION ở file đó', async () =>
    expect(await errorsAfter(POP, (j) => (j.schemaVersion = '0.2.0'))).toEqual([
      `E_SCHEMA_VERSION ${POP}/schemaVersion`,
    ]));
});

// ---- Hàm thuần ----
const screenOf = (
  items: ScreenModel['items'],
  kind: ScreenModel['kind'] = 'screen',
): ScreenModel => ({
  schemaVersion: '0.3.0',
  id: 's',
  name: 'S',
  kind,
  size: { width: 1000, height: 1000 },
  items,
});
const w = (
  id: string,
  widget: string,
  extra: Record<string, unknown> = {},
): ScreenModel['items'][number] =>
  ({ id, type: 'widget', widget, x: 0, y: 0, width: 100, height: 100, ...extra }) as never;

describe('screenTagIds / popupTargets', () => {
  it('gom Tag của mọi khe, không trùng, bỏ item hidden', () => {
    const s = screenOf([
      w('a1', 'card', { tags: { value: 'A' } }),
      w('a2', 'line', { tags: { series: ['A', 'B', 'C'] } }),
      w('a3', 'card', { tags: { value: 'HIDDEN' }, hidden: true }),
      w('a4', 'button', { tags: { target: 'D' } }),
    ]);
    expect([...screenTagIds(s, () => undefined)].sort()).toEqual(['A', 'B', 'C', 'D']);
  });
  it('gom Tag của binding của item svg không ẩn', () => {
    const b: BindingSet03 = {
      schemaVersion: '0.3.0',
      screenId: 's',
      elements: [
        {
          elementUid: 'el_a',
          bindings: [
            {
              id: 'b1',
              target: 'style.fill',
              source: { type: 'tag', tagId: 'E' },
              transform: { kind: 'direct' },
            },
          ],
        },
      ],
    };
    const svg = (hidden: boolean) =>
      ({
        id: 'svg1',
        type: 'svg',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        svgFile: 'a.svg',
        bindingFile: 'a.json',
        viewBox: [0, 0, 1, 1],
        elements: [],
        hidden,
      }) as never;
    expect([...screenTagIds(screenOf([svg(false)]), () => b)]).toEqual(['E']);
    expect([...screenTagIds(screenOf([svg(true)]), () => b)]).toEqual([]);
  });
  it('popupTargets: chỉ nút không ẩn có hành động popup', () => {
    const s = screenOf([
      w('b1', 'button', { events: { click: { action: 'popup', screen: 'p1' } } }),
      w('b2', 'button', { events: { click: { action: 'popup', screen: 'p2' } }, hidden: true }),
      w('b3', 'button', { events: { click: { action: 'navigate', screen: 'p3' } } }),
      w('b4', 'button', { events: { click: { action: 'popup', screen: 'p1' } } }),
    ]);
    expect(popupTargets(s)).toEqual(['p1']);
  });
  it('giới hạn', () => {
    expect(LIMITS_03).toMatchObject({
      screens: 32,
      items: 250,
      svgItems: 8,
      charts: 16,
      navLeaves: 32,
      screenTags: 1000,
    });
  });
});

describe('hình học', () => {
  const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  it('isOutside: hoàn toàn ngoài khung, chạm cạnh là ngoài, giao 1 đơn vị là trong', () => {
    const size = { width: 100, height: 100 };
    expect(isOutside(r(100, 0, 10, 10), size)).toBe(true);
    expect(isOutside(r(99, 0, 10, 10), size)).toBe(false);
    expect(isOutside(r(-10, 0, 10, 10), size)).toBe(true);
    expect(isOutside(r(-9, 0, 10, 10), size)).toBe(false);
    expect(isOutside(r(0, 100, 10, 10), size)).toBe(true);
    expect(isOutside(r(0, -10, 10, 10), size)).toBe(true);
  });
  it('itemCovers: a che hoàn toàn b khi b nằm trong a (kể cả bằng nhau)', () => {
    expect(itemCovers(r(0, 0, 100, 100), r(10, 10, 20, 20))).toBe(true);
    expect(itemCovers(r(0, 0, 100, 100), r(0, 0, 100, 100))).toBe(true);
    expect(itemCovers(r(0, 0, 100, 100), r(90, 90, 20, 20))).toBe(false);
    expect(itemCovers(r(10, 10, 20, 20), r(0, 0, 100, 100))).toBe(false);
  });
});
