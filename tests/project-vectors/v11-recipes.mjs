// Ca `v11-recipe-*` và `v11-report-logo-*` (feature 024, specs/024-recipes/plan.md mục Hợp đồng; README-024.md):
// recipes.json (khai bởi recipesFile của project 1.1), luật E_RECIPE_*, và logo của reports.json (E_RPT_LOGO). Kết quả
// viết tay.
import { withReports } from './v11-reports.mjs';

const PJ = 'project.json';
const RF = 'recipes.json';
const R = 'reports.json';

/** Loại `lo-say` với 5 tham số trên Tag RW của base11 và hai bản. */
const TYPE = () => ({
  id: 'lo-say',
  name: 'Lò sấy',
  description: 'Thông số mẻ sấy',
  security: { view: 'viewer', operate: 'operator', edit: 'engineer' },
  params: [
    { tagId: 'TANK01.SP', label: 'Mức đặt', unit: '%', min: 10, max: 80, decimals: 1 },
    { tagId: 'PUMP01.RUN_CMD', label: 'Chạy bơm' },
    { tagId: 'NOTE.TEXT', label: 'Ghi chú' },
    { tagId: 'CNT.U16', label: 'Số mẻ', min: 0, max: 1000 },
    { tagId: 'DEMO.SET', label: 'Đặt mô phỏng' },
  ],
  recipes: [
    {
      id: 'mua-he',
      name: 'Mùa hè',
      values: {
        'TANK01.SP': 55.5,
        'PUMP01.RUN_CMD': true,
        'NOTE.TEXT': 'he',
        'CNT.U16': 12,
        'DEMO.SET': -40,
      },
    },
    {
      id: 'mua-dong',
      name: 'Mùa đông',
      values: {
        'TANK01.SP': 70,
        'PUMP01.RUN_CMD': false,
        'NOTE.TEXT': '',
        'CNT.U16': 0,
        'DEMO.SET': 100,
      },
    },
  ],
});

/** Thêm recipes.json (một loại) theo phiên bản của project; `mutate(type, doc, files)`. */
export function withRecipes(f, mutate) {
  f[PJ].recipesFile = RF;
  f[RF] = { schemaVersion: f[PJ].schemaVersion, types: [TYPE()] };
  if (mutate) mutate(f[RF].types[0], f[RF], f);
}

const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" rx="6" fill="#0b7285"/><text x="60" y="26" font-size="16" text-anchor="middle" fill="#fff">ATPRO</text></svg>\n';
/** PNG 1x1 hợp lệ. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
/** SVG hợp lệ lớn hơn 256 KiB (chú thích đệm). */
const bigSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- ${'x'.repeat(270000)} --><rect width="10" height="10"/></svg>\n`;

const at = (code, path, file = RF) => ({ code, file, path });
const iss = (...issues) => ({ issues });
const rec = (t, k) => t.recipes[k].values;

/** `to10`: hạ project về 1.0 (như ca v11-version-*). */
export function recipeCases(ok, bad, to10) {
  // ---------- hợp lệ ----------
  ok('v11-recipe-valid', (f) => withRecipes(f));
  ok('v11-recipe-valid-no-recipes', (f) =>
    withRecipes(f, (t, doc) => {
      t.recipes = [];
      delete t.security;
      doc.types.push({
        id: 'trong',
        name: 'Chỉ tham số',
        params: [{ tagId: 'SEL.TAB' }],
        recipes: [],
      });
    }),
  );
  ok('v11-recipe-valid-empty-types', (f) => withRecipes(f, (_t, doc) => (doc.types = [])));
  ok('v11-recipe-valid-float-integral', (f) =>
    withRecipes(f, (t) => {
      rec(t, 0)['TANK01.SP'] = 80; // biên max của tham số
      rec(t, 1)['TANK01.SP'] = 10; // biên min
    }),
  );
  ok('v11-report-logo-valid-svg', (f) =>
    withReports(f, (_r, doc, files) => {
      doc.logo = 'graphics/logo.svg';
      files['graphics/logo.svg'] = LOGO_SVG;
    }),
  );
  ok('v11-report-logo-valid-png', (f) =>
    withReports(f, (_r, doc, files) => {
      doc.logo = 'graphics/logo-don-vi.png';
      files['graphics/logo-don-vi.png'] = LOGO_PNG;
    }),
  );

  // ---------- phiên bản ----------
  bad(
    'v11-recipe-version-in-1.0',
    (f) => {
      withRecipes(f);
      to10(f);
    },
    ['E_RECIPE_VERSION'],
    undefined,
    { ...iss(at('E_RECIPE_VERSION', '/recipesFile', PJ)), runtimeVersion: '1.1.0' },
  );
  bad(
    'v11-recipe-version-in-1.0-file-not-read',
    (f) => {
      withRecipes(f, (_t, _d, files) => delete files[RF]);
      to10(f);
    },
    ['E_RECIPE_VERSION'],
    undefined,
    { ...iss(at('E_RECIPE_VERSION', '/recipesFile', PJ)), runtimeVersion: '1.1.0' },
  );
  bad(
    'v11-recipe-version-mixed',
    (f) => withRecipes(f, (_t, doc) => (doc.schemaVersion = '1.1.1')),
    ['E_SCHEMA_VERSION'],
    undefined,
    iss(at('E_SCHEMA_VERSION', '/schemaVersion')),
  );

  // ---------- tệp, schema ----------
  bad('v11-recipe-file-missing', (f) => withRecipes(f, (_t, _d, files) => delete files[RF]), [
    'E_FILE_MISSING',
  ]);
  bad('v11-recipe-schema-no-params', (f) => withRecipes(f, (t) => (t.params = [])), ['E_SCHEMA']);
  bad(
    'v11-recipe-schema-operate-viewer',
    (f) => withRecipes(f, (t) => (t.security.operate = 'viewer')),
    ['E_SCHEMA'],
  );
  bad('v11-recipe-schema-unknown-key', (f) => withRecipes(f, (t) => (t.params[0].scale = 2)), [
    'E_SCHEMA',
  ]);

  // ---------- E_RECIPE_DUP_ID ----------
  bad(
    'v11-recipe-dup-type',
    (f) => withRecipes(f, (t, doc) => doc.types.push({ ...TYPE(), name: 'Bản sao' })),
    ['E_RECIPE_DUP_ID'],
    undefined,
    iss(at('E_RECIPE_DUP_ID', '/types/1/id')),
  );
  bad(
    'v11-recipe-dup-param',
    (f) => withRecipes(f, (t) => t.params.push({ tagId: 'CNT.U16', label: 'Lặp' })),
    ['E_RECIPE_DUP_ID'],
    undefined,
    iss(at('E_RECIPE_DUP_ID', '/types/0/params/5/tagId')),
  );
  bad(
    'v11-recipe-dup-recipe',
    (f) => withRecipes(f, (t) => (t.recipes[1].id = 'mua-he')),
    ['E_RECIPE_DUP_ID'],
    undefined,
    iss(at('E_RECIPE_DUP_ID', '/types/0/recipes/1/id')),
  );

  // ---------- E_RECIPE_TAG, E_RECIPE_TAG_RW ----------
  bad(
    'v11-recipe-tag-missing',
    (f) =>
      withRecipes(f, (t) => {
        t.params[3].tagId = 'KHONG.CO';
        for (const r of t.recipes) {
          r.values['KHONG.CO'] = r.values['CNT.U16'];
          delete r.values['CNT.U16'];
        }
      }),
    ['E_RECIPE_TAG'],
    undefined,
    iss(at('E_RECIPE_TAG', '/types/0/params/3/tagId')),
  );
  bad(
    'v11-recipe-tag-missing-no-values',
    (f) =>
      withRecipes(f, (t) => {
        t.params.push({ tagId: 'tank01.sp' });
      }),
    ['E_RECIPE_TAG'],
    undefined,
    iss(at('E_RECIPE_TAG', '/types/0/params/5/tagId')),
  );
  bad(
    'v11-recipe-tag-read-only',
    (f) =>
      withRecipes(f, (t) => {
        t.params.push({ tagId: 'TANK01.LEVEL' });
        for (const r of t.recipes) r.values['TANK01.LEVEL'] = 1;
      }),
    ['E_RECIPE_TAG_RW'],
    undefined,
    iss(at('E_RECIPE_TAG_RW', '/types/0/params/5/tagId')),
  );
  bad(
    'v11-recipe-tag-calculated',
    (f) =>
      withRecipes(f, (t) => {
        t.params.push({ tagId: 'TANK01.VOLUME' });
        for (const r of t.recipes) r.values['TANK01.VOLUME'] = 1;
      }),
    ['E_RECIPE_TAG_RW'],
    undefined,
    iss(at('E_RECIPE_TAG_RW', '/types/0/params/5/tagId')),
  );

  // ---------- E_RECIPE_LIMIT ----------
  bad(
    'v11-recipe-limit-min-gt-max',
    (f) => withRecipes(f, (t) => (t.params[3].max = -1)),
    ['E_RECIPE_LIMIT'],
    undefined,
    iss(
      at('E_RECIPE_LIMIT', '/types/0/params/3/max'),
      at('E_RECIPE_LIMIT', '/types/0/recipes/0/values/CNT.U16'),
    ),
  );
  bad(
    'v11-recipe-limit-on-bool',
    (f) => withRecipes(f, (t) => (t.params[1].min = 0)),
    ['E_RECIPE_LIMIT'],
    undefined,
    iss(at('E_RECIPE_LIMIT', '/types/0/params/1/min')),
  );
  bad(
    'v11-recipe-limit-value-above-param',
    (f) => withRecipes(f, (t) => (rec(t, 1)['TANK01.SP'] = 80.5)),
    ['E_RECIPE_LIMIT'],
    undefined,
    iss(at('E_RECIPE_LIMIT', '/types/0/recipes/1/values/TANK01.SP')),
  );
  bad(
    'v11-recipe-limit-value-outside-tag-limits',
    (f) =>
      withRecipes(f, (t) => {
        delete t.params[4].min;
        rec(t, 0)['DEMO.SET'] = -101; // Tag DEMO.SET: limits -100..100
      }),
    ['E_RECIPE_LIMIT'],
    undefined,
    iss(at('E_RECIPE_LIMIT', '/types/0/recipes/0/values/DEMO.SET')),
  );

  // ---------- E_RECIPE_VALUE ----------
  bad(
    'v11-recipe-value-missing',
    (f) => withRecipes(f, (t) => delete rec(t, 0)['NOTE.TEXT']),
    ['E_RECIPE_VALUE'],
    undefined,
    iss(at('E_RECIPE_VALUE', '/types/0/recipes/0/values')),
  );
  bad(
    'v11-recipe-value-not-param',
    (f) => withRecipes(f, (t) => (rec(t, 1)['SEL.TAB'] = 1)),
    ['E_RECIPE_VALUE'],
    undefined,
    iss(at('E_RECIPE_VALUE', '/types/0/recipes/1/values/SEL.TAB')),
  );
  bad(
    'v11-recipe-value-type-string-for-float',
    (f) => withRecipes(f, (t) => (rec(t, 0)['TANK01.SP'] = '55')),
    ['E_RECIPE_VALUE'],
    undefined,
    iss(at('E_RECIPE_VALUE', '/types/0/recipes/0/values/TANK01.SP')),
  );
  bad(
    'v11-recipe-value-fraction-for-uint16',
    (f) => withRecipes(f, (t) => (rec(t, 1)['CNT.U16'] = 2.5)),
    ['E_RECIPE_VALUE'],
    undefined,
    iss(at('E_RECIPE_VALUE', '/types/0/recipes/1/values/CNT.U16')),
  );
  bad(
    'v11-recipe-value-bool-for-string',
    (f) => withRecipes(f, (t) => (rec(t, 1)['NOTE.TEXT'] = false)),
    ['E_RECIPE_VALUE'],
    undefined,
    iss(at('E_RECIPE_VALUE', '/types/0/recipes/1/values/NOTE.TEXT')),
  );
  bad(
    'v11-recipe-value-number-for-bool',
    (f) => withRecipes(f, (t) => (rec(t, 0)['PUMP01.RUN_CMD'] = 1)),
    ['E_RECIPE_VALUE'],
    undefined,
    iss(at('E_RECIPE_VALUE', '/types/0/recipes/0/values/PUMP01.RUN_CMD')),
  );

  // ---------- E_RPT_LOGO ----------
  bad(
    'v11-report-logo-missing',
    (f) => withReports(f, (_r, doc) => (doc.logo = 'graphics/khong-co.svg')),
    ['E_RPT_LOGO'],
    undefined,
    iss(at('E_RPT_LOGO', '/logo', R)),
  );
  bad(
    'v11-report-logo-svg-too-large',
    (f) =>
      withReports(f, (_r, doc, files) => {
        doc.logo = 'graphics/lon.svg';
        files['graphics/lon.svg'] = bigSvg();
      }),
    ['E_RPT_LOGO'],
    undefined,
    iss(at('E_RPT_LOGO', '/logo', R)),
  );
  bad(
    'v11-report-logo-png-too-large',
    (f) =>
      withReports(f, (_r, doc, files) => {
        doc.logo = 'graphics/lon.png';
        files['graphics/lon.png'] = Buffer.concat([LOGO_PNG, Buffer.alloc(270000, 0xff)]);
      }),
    ['E_RPT_LOGO'],
    undefined,
    iss(at('E_RPT_LOGO', '/logo', R)),
  );
  bad(
    'v11-report-logo-in-1.0',
    (f) => {
      withReports(f, (_r, doc, files) => {
        doc.logo = 'graphics/logo.svg';
        files['graphics/logo.svg'] = LOGO_SVG;
      });
      to10(f);
    },
    ['E_RPT_LOGO'],
    undefined,
    { ...iss(at('E_RPT_LOGO', '/logo', R)), runtimeVersion: '1.1.0' },
  );
  bad(
    'v11-report-logo-bad-path',
    (f) => withReports(f, (_r, doc) => (doc.logo = 'screens/main.svg')),
    ['E_SCHEMA'],
  );
}
