// Ca `v10-*` của bộ vector project (feature 011, T018; contracts/project-format-1.0.md §2-§5, §7; FR-119 đến FR-124).
// Được generate.mjs nạp; mô tả ở tests/project-vectors/README-011.md. Dùng chung TS (vectors-10.test.ts) và C++
// (core/project-manager/tests/vectors_10_test.cpp, T020).
//
// Mỗi ca: [tên, hàm sửa base10, mã lỗi (tập), cảnh báo (tập), thêm { issues }]. Mọi ca có `runtimeVersion` 1.0.0 trong
// expected.json (bộ chạy truyền cho validator; RUNTIME_VERSION của bản dựng hiện tại vẫn là 0.9.0).
import { base06 } from './v06.mjs';

export const V10 = '1.0.0';
export const RUNTIME_10 = '1.0.0';
const PJ = 'project.json';
const TAGS = 'tags.json';
const MS = 'screens/main.screen.json';
const MB = 'screens/main.bindings.json';
const FS = 'screens/bom-chi-tiet.screen.json';
const TB = 'templates/bom.template.json';
const LG = 'logic.json';
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Tag nội bộ của một bơm: `<P>.RUN` (BOOL), `<P>.FLOW` (FLOAT32), `<P>.RUN_CMD` (BOOL RW). */
export function pumpTags(f, p, { flow = true, cmd = true } = {}) {
  const t = f[TAGS].tags;
  t.push({ id: `${p}.RUN`, kind: 'internal', type: 'BOOL', initial: false });
  if (flow) t.push({ id: `${p}.FLOW`, kind: 'internal', type: 'FLOAT32', initial: 0 });
  if (cmd)
    t.push({ id: `${p}.RUN_CMD`, kind: 'internal', type: 'BOOL', access: 'RW', initial: false });
}

/** Template `bom` (contract §3): đèn, thẻ lưu lượng, nút mở faceplate với `args` có `{param}`. */
export const template = () => ({
  schemaVersion: V10,
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
      props: { label: 'Chi tiết', variant: 'neutral' },
      events: {
        click: {
          action: 'popup',
          screen: 'bom-chi-tiet',
          args: { prefix: '{prefix}', title: '{title}' },
        },
      },
    },
  ],
});

/**
 * Bung một bản sao `inst` của template `bom` ở (dx, dy) như Studio (contract §4): id `<inst>.<rid>`, Tag và nhãn đã thay,
 * `tpl` trên mọi item, `params` chỉ trên item đầu (hoặc mọi item khi `everyItem`).
 */
export function instance(inst, dx, dy, params, { everyItem = false, tpl = template() } = {}) {
  const values = Object.fromEntries(tpl.params.map((p) => [p.name, p.default]));
  Object.assign(values, params ?? {});
  const sub = (s) => s.replace(/\{([a-z][A-Za-z0-9]*)\}/g, (_, n) => values[n]);
  const walk = (v) =>
    typeof v === 'string'
      ? sub(v)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return tpl.items.map((it, i) => {
    const out = walk(clone(it));
    out.id = `${inst}.${it.id}`;
    out.x = it.x + dx;
    out.y = it.y + dy;
    out.tpl = { inst, tid: tpl.id, rid: it.id };
    if (params !== undefined && (everyItem || i === 0)) out.tpl.params = { ...params };
    return out;
  });
}

/** Faceplate `bom-chi-tiet` (contract §5): popup có tham số `prefix` (tagPrefix), `title` (string, default). */
export const faceplate = () => ({
  schemaVersion: V10,
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
      id: 'panel_f',
      type: 'widget',
      widget: 'panel',
      x: 0,
      y: 0,
      width: 640,
      height: 420,
      props: { title: '{title}' },
    },
    {
      id: 'flow_f',
      type: 'widget',
      widget: 'card',
      x: 20,
      y: 60,
      width: 220,
      height: 110,
      props: { label: 'Lưu lượng {title}' },
      tags: { value: '{prefix}.FLOW' },
    },
    {
      id: 'run_f',
      type: 'widget',
      widget: 'switch',
      x: 20,
      y: 200,
      width: 160,
      height: 48,
      props: { label: '{title}' },
      tags: { target: '{prefix}.RUN_CMD' },
    },
    {
      id: 'close_f',
      type: 'widget',
      widget: 'button',
      x: 460,
      y: 350,
      width: 160,
      height: 48,
      props: { label: 'Đóng', variant: 'neutral' },
      events: { click: { action: 'closePopup' } },
    },
  ],
});

/**
 * Project 1.0 hợp lệ, không cảnh báo: base 0.6 với mọi `schemaVersion` 1.0.0, `minRuntimeVersion` 1.0.0, `logic.json`
 * tối thiểu, template `bom` có hai bản sao trên `main` (pump7, pump8), faceplate `bom-chi-tiet` được mở từ nút của hai
 * bản sao và từ sự kiện click của phần tử SVG `el_ccc` (args PUMP01).
 */
export function base10() {
  const f = base06();
  for (const v of Object.values(f))
    if (v !== null && typeof v === 'object' && v.schemaVersion !== undefined) v.schemaVersion = V10;
  f[PJ].projectId = 'vector10';
  f[PJ].projectName = 'Vector 1.0';
  f[PJ].minRuntimeVersion = RUNTIME_10;
  f[PJ].screens.push('bom-chi-tiet');
  f[PJ].logic = LG;
  f[PJ].templates = [TB];
  f[LG] = { schemaVersion: V10 };
  f[TB] = template();
  f[FS] = faceplate();
  pumpTags(f, 'PUMP07');
  pumpTags(f, 'PUMP08');
  pumpTags(f, 'PUMP01', { cmd: false }); // PUMP01.RUN_CMD có sẵn (Tag thiết bị RW)
  f[MS].items.push(
    ...instance('pump7', 1060, 20, { prefix: 'PUMP07', title: 'Bơm 7' }),
    ...instance('pump8', 1060, 170, { prefix: 'PUMP08', title: 'Bơm 8' }),
  );
  ccc(f).events = {
    click: { action: 'popup', screen: 'bom-chi-tiet', args: { prefix: 'PUMP01' } },
  };
  return f;
}

// ---- trợ giúp ----
/** Phần tử `el_ccc` của binding main (có sẵn binding chữ ở base03; base10 thêm sự kiện click mở faceplate). */
function ccc(f) {
  return f[MB].elements.find((e) => e.elementUid === 'el_ccc');
}
const at = (code, path, file = MS) => ({ code, file, path });
const iss = (...issues) => ({ issues });
const mainItems = (f) => f[MS].items;
/** Item của bản sao `inst` (theo thứ tự) và chỉ số của chúng trong main. */
const instItems = (f, inst) => mainItems(f).filter((i) => i.tpl?.inst === inst);
const idx = (f, id) => mainItems(f).findIndex((i) => i.id === id);
const fp = (f) => f[FS];
/** Nút mở faceplate với `args` thêm vào main. */
const caller = (id, args, extra = {}) => ({
  id,
  type: 'widget',
  widget: 'button',
  x: 880,
  y: 350,
  width: 160,
  height: 48,
  props: { label: 'Mở', variant: 'neutral' },
  events: {
    click: { action: 'popup', screen: 'bom-chi-tiet', ...(args === undefined ? {} : { args }) },
  },
  ...extra,
});
const addCaller = (f, id, args, extra) => {
  mainItems(f).push(caller(id, args, extra));
  return mainItems(f).length - 1;
};

export function cases10() {
  const C = [];
  const ok = (name, mutate, warnings = [], extra) => C.push([name, mutate, [], warnings, extra]);
  const bad = (name, mutate, errors, warnings, extra) =>
    C.push([name, mutate, errors, warnings, extra]);

  // ================= hợp lệ =================
  ok('v10-valid-full', () => {});
  ok('v10-valid-minimal', (f) => {
    // khung 0.6 lên 1.0: không logic, không template, không faceplate
    delete f[PJ].logic;
    delete f[PJ].templates;
    delete f[LG];
    delete f[TB];
    delete f[FS];
    f[PJ].screens = f[PJ].screens.filter((s) => s !== 'bom-chi-tiet');
    f[MS].items = mainItems(f).filter((i) => i.tpl === undefined);
    delete ccc(f).events;
  });
  ok('v10-valid-no-logic', (f) => {
    delete f[PJ].logic;
    delete f[LG];
  });
  ok('v10-template-args-param-valid', (f) => {
    // `{prefix}` trong args của template (thay khi bung): nút pump7.detail mở faceplate với PUMP07
    const d = mainItems(f)[idx(f, 'pump7.detail')];
    if (d.events.click.args.prefix !== 'PUMP07') throw new Error('bung sai');
  });
  ok('v10-valid-instance-defaults', (f) => {
    // bản sao không ghi params: dùng default (PUMP01, Bơm)
    mainItems(f).push(...instance('pump1', 1060, 320, undefined));
  });
  ok('v10-valid-instance-params-every-item', (f) => {
    f[MS].items = mainItems(f).filter((i) => i.tpl?.inst !== 'pump8');
    mainItems(f).push(
      ...instance('pump8', 1060, 170, { prefix: 'PUMP08', title: 'Bơm 8' }, { everyItem: true }),
    );
  });
  ok('v10-valid-instance-moved-resized', (f) => {
    // vị trí, cỡ, khóa, ẩn là của riêng bản sao: không lệch
    const it = mainItems(f)[idx(f, 'pump7.flow')];
    it.x += 3;
    it.width = 160;
    it.locked = true;
  });
  ok('v10-valid-template-no-params', (f) => {
    // template không có tham số
    f[TB].params = [];
    f[TB].items = [f[TB].items[0]];
    f[TB].items[0].tags = { state: 'PUMP01.FAULT' };
    f[MS].items = mainItems(f).filter((i) => i.tpl === undefined);
    mainItems(f).push(...instance('lone', 1060, 20, undefined, { tpl: f[TB] }));
  });
  ok('v10-valid-popup-defaults-only', (f) => {
    // popup chỉ có tham số có default; nút gọi không có args
    const p = fp(f);
    p.params = [{ name: 'title', kind: 'string', default: 'Bơm' }];
    p.items = p.items.filter((i) => i.id !== 'flow_f' && i.id !== 'run_f');
    f[MS].items = mainItems(f).filter((i) => i.tpl === undefined);
    ccc(f).events.click.args = { title: 'SVG' };
    addCaller(f, 'open_plain', undefined);
  });
  ok('v10-valid-popup-no-caller', (f) => {
    // popup có tham số bắt buộc nhưng không ai mở: không có tổ hợp để bung
    f[MS].items = mainItems(f).filter((i) => i.tpl === undefined);
    delete ccc(f).events;
  });
  ok('v10-valid-popup-number-color', (f) => {
    const p = fp(f);
    p.params.push(
      { name: 'max', kind: 'number', default: '100' },
      { name: 'tone', kind: 'color', default: '#22c55e' },
    );
    p.items.push({
      id: 'gauge_f',
      type: 'widget',
      widget: 'gauge',
      x: 260,
      y: 60,
      width: 240,
      height: 160,
      props: { min: 0, max: '{max}' },
      tags: { value: '{prefix}.FLOW' },
    });
    p.items[1].props.valueColor = '{tone}';
    addCaller(f, 'open_num', { prefix: 'PUMP07', max: '250.5', tone: '#FF0000' });
  });
  ok('v10-valid-popup-multi-slot', (f) => {
    fp(f).items.push({
      id: 'bar_f',
      type: 'widget',
      widget: 'bar',
      x: 260,
      y: 240,
      width: 300,
      height: 120,
      props: { labels: ['{title} chạy', 'Lưu lượng'] },
      tags: { series: ['{prefix}.RUN', '{prefix}.FLOW'] },
    });
  });
  ok('v10-valid-popup-20-callers', (f) => {
    // một faceplate cho 20 bơm (story US7): 20 tổ hợp args, mỗi tổ hợp kiểm đủ Tag
    for (let n = 1; n <= 20; n++) {
      const p = `P${String(n).padStart(2, '0')}`;
      pumpTags(f, p);
      f[MB].elements.push({
        elementUid: `el_p${String(n).padStart(3, '0')}`,
        events: {
          click: {
            action: 'popup',
            screen: 'bom-chi-tiet',
            args: { prefix: p, title: `Bơm ${n}` },
          },
        },
      });
      mainItems(f)[0].elements.push({ elementUid: `el_p${String(n).padStart(3, '0')}` });
    }
  });
  ok('v10-valid-popup-same-args-twice', (f) => {
    // hai chỗ gọi cùng args: một tổ hợp
    addCaller(f, 'open_a', { prefix: 'PUMP07' });
    addCaller(f, 'open_b', { prefix: 'PUMP07' }, { x: 700, y: 350 });
  });
  ok('v10-popup-args-svg-event-valid', (f) => {
    ccc(f).events.click.args = { prefix: 'PUMP08', title: 'SVG 8' };
  });
  ok('v10-popup-args-1000-valid', (f) => withCombos(f, 1000));

  // ================= template (file) =================
  const tplBad = (name, mutate, errors = ['E_TEMPLATE_PARAM'], issues) =>
    bad(name, mutate, errors, undefined, issues ? iss(...issues) : undefined);
  const tItem = (f, rid) => f[TB].items.find((i) => i.id === rid);
  tplBad(
    'v10-template-param-undeclared',
    (f) => (tItem(f, 'lamp').tags.state = '{x}.RUN'),
    undefined,
    [at('E_TEMPLATE_PARAM', '/items/0/tags/state', TB)],
  );
  tplBad(
    'v10-template-param-stray-brace',
    (f) => (tItem(f, 'flow').props.label = 'Bơm }'),
    undefined,
    [at('E_TEMPLATE_PARAM', '/items/1/props/label', TB)],
  );
  tplBad('v10-template-param-nested', (f) => (tItem(f, 'flow').props.label = '{{title}}'));
  tplBad(
    'v10-template-param-wrong-place',
    (f) => (tItem(f, 'flow').props.label = '{prefix}'),
    undefined,
    [at('E_TEMPLATE_PARAM', '/items/1/props/label', TB)],
  );
  tplBad(
    'v10-template-param-tag-not-prefix',
    (f) => (tItem(f, 'lamp').tags.state = 'PUMP.{prefix}'),
  );
  tplBad('v10-template-param-in-name', (f) => (tItem(f, 'lamp').name = 'Đèn {title}'), undefined, [
    at('E_TEMPLATE_PARAM', '/items/0/name', TB),
  ]);
  tplBad(
    'v10-template-param-default-invalid',
    (f) => (f[TB].params[0].default = 'PUMP 01'),
    undefined,
    [at('E_TEMPLATE_PARAM', '/params/0/default', TB)],
  );
  tplBad('v10-template-param-default-65-bytes', (f) => (f[TB].params[0].default = 'P'.repeat(65)));
  tplBad(
    'v10-template-param-dup-name',
    (f) => f[TB].params.push({ name: 'title', kind: 'string' }),
    undefined,
    [at('E_TEMPLATE_PARAM', '/params/2/name', TB)],
  );
  tplBad('v10-template-param-kind-unknown', (f) => (f[TB].params[1].kind = 'list'), ['E_SCHEMA']);
  tplBad(
    'v10-template-param-too-many',
    (f) =>
      f[TB].params.push(
        ...Array.from({ length: 15 }, (_, i) => ({ name: `p${i}`, kind: 'string' })),
      ),
    ['E_SCHEMA'],
  );
  tplBad(
    'v10-template-args-param-undeclared',
    (f) => (tItem(f, 'detail').events.click.args.prefix = '{x}'),
    undefined,
    [at('E_TEMPLATE_PARAM', '/items/2/events/click/args/prefix', TB)],
  );
  tplBad(
    'v10-template-id-mismatch',
    (f) => (f[TB].id = 'bom2'),
    ['E_TEMPLATE_ID'],
    [at('E_TEMPLATE_ID', '/id', TB)],
  );
  tplBad(
    'v10-template-item-id-dup',
    (f) => (tItem(f, 'flow').id = 'lamp'),
    ['E_TEMPLATE_ID', 'E_TEMPLATE_REF'],
    [at('E_TEMPLATE_ID', '/items/1/id', TB)],
  );
  tplBad('v10-template-item-id-bad', (f) => (tItem(f, 'flow').id = 'Flow'), [
    'E_TEMPLATE_ID',
    'E_TEMPLATE_REF',
  ]);
  tplBad(
    'v10-template-file-missing',
    (f) => {
      delete f[TB];
    },
    ['E_FILE_MISSING'],
  );
  tplBad('v10-template-path-bad', (f) => (f[PJ].templates = ['templates/../bom.template.json']), [
    'E_SCHEMA',
  ]);
  tplBad(
    'v10-template-version-mismatch',
    (f) => (f[TB].schemaVersion = '0.6.0'),
    ['E_SCHEMA_VERSION'],
    [at('E_SCHEMA_VERSION', '/schemaVersion', TB)],
  );
  tplBad('v10-template-loop-key', (f) => (f[TB].repeat = 20), ['E_SCHEMA']);

  // ================= bản sao (tpl) =================
  bad(
    'v10-tpl-tid-missing',
    (f) => instItems(f, 'pump7').forEach((i) => (i.tpl.tid = 'van')),
    ['E_TEMPLATE_REF'],
    undefined,
    iss(at('E_TEMPLATE_REF', `/items/${idx(base10(), 'pump7.lamp')}/tpl/tid`)),
  );
  bad(
    'v10-tpl-no-templates-declared',
    (f) => {
      delete f[PJ].templates;
      delete f[TB];
    },
    ['E_TEMPLATE_REF'],
  );
  bad('v10-tpl-rid-missing', (f) => (instItems(f, 'pump7')[1].tpl.rid = 'gauge'), [
    'E_TEMPLATE_REF',
  ]);
  bad(
    'v10-tpl-id-mismatch',
    (f) => (instItems(f, 'pump7')[1].id = 'pump7.flow_x'),
    ['E_TEMPLATE_REF'],
    undefined,
    iss(at('E_TEMPLATE_REF', `/items/${idx(base10(), 'pump7.flow')}/id`)),
  );
  bad(
    'v10-tpl-inst-dup',
    (f) => mainItems(f).push(...instance('pump7', 1060, 320, { prefix: 'PUMP07', title: 'Bơm 7' })),
    ['E_ITEM_ID'],
  );
  bad(
    'v10-tpl-inst-two-templates',
    (f) => {
      f[PJ].templates.push('templates/van.template.json');
      f['templates/van.template.json'] = { ...template(), id: 'van' };
      instItems(f, 'pump7')[2].tpl.tid = 'van';
    },
    ['E_TEMPLATE_REF'],
  );
  bad('v10-tpl-inst-bad-pattern', (f) => (instItems(f, 'pump7')[0].tpl.inst = 'Pump7'), [
    'E_SCHEMA',
  ]);
  bad(
    'v10-tpl-params-wrong-kind',
    (f) => (instItems(f, 'pump7')[0].tpl.params.prefix = 'PUMP 07'),
    ['E_TEMPLATE_PARAM'],
    undefined,
    iss(at('E_TEMPLATE_PARAM', `/items/${idx(base10(), 'pump7.lamp')}/tpl/params/prefix`)),
  );
  bad(
    'v10-tpl-params-65-bytes',
    (f) => (instItems(f, 'pump7')[0].tpl.params.prefix = 'P'.repeat(65)),
    ['E_TEMPLATE_PARAM'],
  );
  bad('v10-tpl-params-extra', (f) => (instItems(f, 'pump7')[0].tpl.params.color = '#ffffff'), [
    'E_TEMPLATE_PARAM',
  ]);
  bad(
    'v10-tpl-params-missing-required',
    (f) => {
      delete f[TB].params[0].default;
      delete instItems(f, 'pump8')[0].tpl.params;
    },
    ['E_TEMPLATE_PARAM'],
  );
  bad(
    'v10-tpl-params-differ',
    (f) => (instItems(f, 'pump7')[1].tpl.params = { prefix: 'PUMP08', title: 'Bơm 7' }),
    ['E_TEMPLATE_PARAM'],
    undefined,
    iss(at('E_TEMPLATE_PARAM', `/items/${idx(base10(), 'pump7.flow')}/tpl/params`)),
  );
  bad(
    'v10-tpl-tag-missing',
    (f) => {
      // bản sao nhất quán với tham số PUMP99, nhưng Tag PUMP99.* không có
      f[MS].items = mainItems(f).filter((i) => i.tpl?.inst !== 'pump8');
      mainItems(f).push(...instance('pump99', 1060, 170, { prefix: 'PUMP99', title: 'Bơm 99' }));
    },
    ['E_TEMPLATE_TAG_REF'],
    undefined,
    iss(at('E_TEMPLATE_TAG_REF', `/items/${idx(base10(), 'pump8.lamp')}/tags/state`)),
  );
  bad(
    'v10-tpl-tag-wrong-type',
    (f) => {
      f[TAGS].tags.push(
        { id: 'STR01.RUN', kind: 'internal', type: 'STRING', initial: '' },
        { id: 'STR01.FLOW', kind: 'internal', type: 'FLOAT32', initial: 0 },
        { id: 'STR01.RUN_CMD', kind: 'internal', type: 'BOOL', access: 'RW', initial: false },
      );
      f[MS].items = mainItems(f).filter((i) => i.tpl?.inst !== 'pump8');
      mainItems(f).push(...instance('str1', 1060, 170, { prefix: 'STR01', title: 'S' }));
    },
    ['E_TEMPLATE_TAG_REF'],
  );
  ok(
    'v10-tpl-drift',
    (f) => (instItems(f, 'pump7')[1].props.label = 'Nhãn sửa tay'),
    ['W_TEMPLATE_DRIFT'],
    iss({ code: 'W_TEMPLATE_DRIFT', file: MS, path: `/items/${idx(base10(), 'pump7.flow')}` }),
  );
  ok(
    'v10-tpl-drift-missing-item',
    (f) => (f[MS].items = mainItems(f).filter((i) => i.id !== 'pump8.detail')),
    ['W_TEMPLATE_DRIFT'],
  );
  ok('v10-tpl-drift-template-changed', (f) => (tItem(f, 'lamp').props = { shape: 'square' }), [
    'W_TEMPLATE_DRIFT',
  ]);

  // ================= faceplate: args =================
  const argsAt = (i, sub = '') => `/items/${i}/events/click/args${sub}`;
  bad(
    'v10-popup-args-missing',
    (f) => {
      const i = addCaller(f, 'open_x', undefined);
      if (i < 0) throw new Error();
    },
    ['E_POPUP_ARGS'],
  );
  bad(
    'v10-popup-args-missing-required',
    (f) => addCaller(f, 'open_x', { title: 'X' }),
    ['E_POPUP_ARGS'],
    undefined,
    iss(at('E_POPUP_ARGS', argsAt(mainItems(base10()).length, '/prefix'))),
  );
  bad(
    'v10-popup-args-extra',
    (f) => addCaller(f, 'open_x', { prefix: 'PUMP07', color: 'red' }),
    ['E_POPUP_ARGS'],
    undefined,
    iss(at('E_POPUP_ARGS', argsAt(mainItems(base10()).length, '/color'))),
  );
  bad('v10-popup-args-wrong-kind', (f) => addCaller(f, 'open_x', { prefix: 'PUMP-07' }), [
    'E_POPUP_ARGS',
  ]);
  bad('v10-popup-args-65-bytes', (f) => addCaller(f, 'open_x', { prefix: 'P'.repeat(65) }), [
    'E_POPUP_ARGS',
  ]);
  bad(
    'v10-popup-args-string-129-bytes',
    (f) => addCaller(f, 'open_x', { prefix: 'PUMP07', title: 'x'.repeat(129) }),
    ['E_POPUP_ARGS'],
  );
  bad(
    'v10-popup-args-control-char',
    (f) => addCaller(f, 'open_x', { prefix: 'PUMP07', title: 'a\u0007b' }),
    ['E_POPUP_ARGS'],
  );
  bad(
    'v10-popup-args-plain-popup',
    (f) => {
      // popup không có params: args thừa
      const i = mainItems(f).findIndex((x) => x.id === 'btn_pump');
      mainItems(f)[i].events.click.args = { prefix: 'PUMP07' };
    },
    ['E_POPUP_ARGS'],
  );
  ok('v10-popup-args-plain-popup-empty', (f) => {
    const i = mainItems(f).findIndex((x) => x.id === 'btn_pump');
    mainItems(f)[i].events.click.args = {};
  });
  bad('v10-popup-args-not-string', (f) => addCaller(f, 'open_x', { prefix: 7 }), ['E_SCHEMA']);
  bad(
    'v10-popup-args-svg-event-missing',
    (f) => delete ccc(f).events.click.args,
    ['E_POPUP_ARGS'],
    undefined,
    iss(
      at(
        'E_POPUP_ARGS',
        `/elements/${base10()[MB].elements.length - 1}/events/click/args/prefix`,
        MB,
      ),
    ),
  );
  bad(
    'v10-popup-args-svg-event-wrong-kind',
    (f) => (ccc(f).events.click.args = { prefix: '1PUMP' }),
    ['E_POPUP_ARGS'],
  );
  bad(
    'v10-popup-args-1001-too-many',
    (f) => withCombos(f, 1001),
    ['E_POPUP_ARGS'],
    undefined,
    iss(at('E_POPUP_ARGS', '/params', FS)),
  );
  bad(
    'v10-popup-args-key-in-0.6',
    (f) => {
      // định dạng 0.6 giữ kết luận: `args` không phải tham số của hành động popup
      for (const v of Object.values(f))
        if (v !== null && typeof v === 'object' && v.schemaVersion !== undefined)
          v.schemaVersion = '0.6.0';
      f[PJ].minRuntimeVersion = '0.9.0';
      delete f[PJ].logic;
      delete f[PJ].templates;
      delete f[LG];
      delete f[TB];
      delete f[FS];
      f[PJ].screens = f[PJ].screens.filter((s) => s !== 'bom-chi-tiet');
      f[MS].items = mainItems(f).filter((i) => i.tpl === undefined);
      delete ccc(f).events;
      const i = mainItems(f).findIndex((x) => x.id === 'btn_pump');
      mainItems(f)[i].events.click.args = {};
    },
    ['E_ACTION'],
  );
  bad(
    'v10-tpl-key-in-0.6',
    (f) => {
      for (const v of Object.values(f))
        if (v !== null && typeof v === 'object' && v.schemaVersion !== undefined)
          v.schemaVersion = '0.6.0';
      f[PJ].minRuntimeVersion = '0.9.0';
      delete f[PJ].logic;
      delete f[PJ].templates;
      delete f[LG];
      delete f[TB];
      delete f[FS];
      f[PJ].screens = f[PJ].screens.filter((s) => s !== 'bom-chi-tiet');
      delete ccc(f).events;
      f[MS].items = mainItems(f).filter((i) => i.tpl === undefined || i.tpl.rid === 'lamp');
    },
    ['E_SCHEMA'],
  );

  // ================= faceplate: bung tĩnh =================
  bad(
    'v10-popup-expanded-tag-missing',
    (f) => addCaller(f, 'open_x', { prefix: 'PUMP99' }),
    ['E_TEMPLATE_TAG_REF'],
    undefined,
    iss(
      at('E_TEMPLATE_TAG_REF', '/items/1/tags/value', FS),
      at('E_TEMPLATE_TAG_REF', '/items/2/tags/target', FS),
    ),
  );
  bad(
    'v10-popup-expanded-tag-type',
    (f) => {
      f[TAGS].tags.push(
        { id: 'S01.FLOW', kind: 'internal', type: 'FLOAT32', initial: 0 },
        { id: 'S01.RUN_CMD', kind: 'internal', type: 'STRING', access: 'RW', initial: '' },
      );
      addCaller(f, 'open_x', { prefix: 'S01' });
    },
    ['E_TEMPLATE_TAG_REF'],
    undefined,
    iss(at('E_TEMPLATE_TAG_REF', '/items/2/tags/target', FS)),
  );
  bad(
    'v10-popup-expanded-not-writable',
    (f) => {
      f[TAGS].tags.push(
        { id: 'RO01.FLOW', kind: 'internal', type: 'FLOAT32', initial: 0 },
        { id: 'RO01.RUN_CMD', kind: 'internal', type: 'BOOL', initial: false },
      );
      addCaller(f, 'open_x', { prefix: 'RO01' });
    },
    ['E_TAG_ACCESS'],
    undefined,
    iss(at('E_TAG_ACCESS', '/items/2/tags/target', FS)),
  );
  bad(
    'v10-popup-expanded-prop-range',
    (f) => {
      fp(f).params.push({ name: 'dec', kind: 'number', default: '1' });
      fp(f).items[1].props.decimals = '{dec}';
      addCaller(f, 'open_x', { prefix: 'PUMP07', dec: '9' });
    },
    ['E_WIDGET_PROP'],
    undefined,
    iss(at('E_WIDGET_PROP', '/items/1/props/decimals', FS)),
  );
  bad(
    'v10-popup-two-callers-one-bad',
    (f) => {
      addCaller(f, 'open_a', { prefix: 'PUMP07' });
      addCaller(f, 'open_b', { prefix: 'PUMP98' }, { x: 700, y: 350 });
    },
    ['E_TEMPLATE_TAG_REF'],
  );
  bad(
    'v10-popup-instance-caller-bad',
    (f) => {
      // nút của bản sao (args đã thay khi bung) trỏ Tag không có: lỗi ở faceplate, không ở template
      f[TAGS].tags = f[TAGS].tags.filter((t) => t.id !== 'PUMP08.RUN_CMD');
    },
    ['E_TEMPLATE_TAG_REF'],
  );

  // ================= faceplate: khai báo và chỗ đặt =================
  bad(
    'v10-popup-params-on-screen',
    (f) => (f[MS].params = [{ name: 'a', kind: 'string' }]),
    ['E_TEMPLATE_PARAM'],
    undefined,
    iss(at('E_TEMPLATE_PARAM', '/params')),
  );
  bad(
    'v10-popup-param-undeclared',
    (f) => (fp(f).items[1].tags.value = '{pfx}.FLOW'),
    ['E_TEMPLATE_PARAM'],
    undefined,
    iss(at('E_TEMPLATE_PARAM', '/items/1/tags/value', FS)),
  );
  bad('v10-popup-param-stray-brace', (f) => (fp(f).items[1].props.label = 'Lưu lượng {'), [
    'E_TEMPLATE_PARAM',
  ]);
  bad(
    'v10-popup-param-in-args',
    (f) => {
      // args có {param} chỉ được trong template, không trong popup có tham số
      fp(f).items.push({
        id: 'sub_f',
        type: 'widget',
        widget: 'button',
        x: 260,
        y: 350,
        width: 160,
        height: 48,
        props: { label: 'Khác' },
        events: { click: { action: 'popup', screen: 'pump', args: { prefix: '{prefix}' } } },
      });
    },
    ['E_TEMPLATE_PARAM'],
  );
  bad(
    'v10-popup-param-default-invalid',
    (f) => (fp(f).params[1].default = 'a\u0001'),
    ['E_TEMPLATE_PARAM'],
    undefined,
    iss(at('E_TEMPLATE_PARAM', '/params/1/default', FS)),
  );
  bad(
    'v10-popup-param-number-embedded',
    (f) => {
      fp(f).params.push({ name: 'max', kind: 'number', default: '1' });
      fp(f).items[1].props.label = 'Tối đa {max}';
    },
    ['E_TEMPLATE_PARAM'],
  );

  // ================= khung 1.0 =================
  bad('v10-logic-file-missing', (f) => delete f[LG], ['E_FILE_MISSING']);
  bad(
    'v10-logic-path-unsafe',
    (f) => (f[PJ].logic = '../logic.json'),
    ['E_PATH'],
    undefined,
    iss(at('E_PATH', '/logic', PJ)),
  );
  bad('v10-logic-schema', (f) => (f[LG].rules = [{ id: 'r1' }]), ['E_SCHEMA']);
  bad(
    'v10-logic-version-mismatch',
    (f) => (f[LG].schemaVersion = '0.6.0'),
    ['E_SCHEMA_VERSION'],
    undefined,
    iss(at('E_SCHEMA_VERSION', '/schemaVersion', LG)),
  );
  // luật logic (T135; tests/logic-vectors kiểm từng mã, ở đây kiểm móc vào bộ kiểm project và Tag logic)
  const logicTimer = (f) => {
    f[LG].timers = [
      {
        id: 't_run',
        kind: 'ton',
        in: 'PUMP07.RUN',
        pt: 5000,
        q: 'LOGIC.T_RUN.Q',
        et: 'LOGIC.T_RUN.ET',
      },
    ];
  };
  ok('v10-logic-valid-widget-on-logic-tag', (f) => {
    // Tag logic là Tag nội bộ chỉ đọc: widget đọc được
    logicTimer(f);
    mainItems(f).push({
      id: 'logic_lamp',
      type: 'widget',
      widget: 'lamp',
      x: 10,
      y: 600,
      width: 40,
      height: 40,
      tags: { state: 'LOGIC.T_RUN.Q' },
    });
  });
  bad(
    'v10-logic-tag-ref',
    (f) => (f[LG].rules = [{ id: 'r1', when: 'NO.SUCH' }]),
    ['E_LOGIC_TAG_REF'],
    undefined,
    iss(at('E_LOGIC_TAG_REF', '/rules/0/when', LG)),
  );
  bad(
    'v10-logic-tag-collision',
    (f) => {
      logicTimer(f);
      f[LG].timers[0].q = 'PUMP07.FLOW';
    },
    ['E_LOGIC_TAG_COLLISION'],
    undefined,
    iss(at('E_LOGIC_TAG_COLLISION', '/timers/0/q', LG)),
  );
  bad(
    'v10-logic-version-newer',
    (f) => (f[LG].schemaVersion = '1.1.0'),
    ['E_LOGIC_VERSION'],
    undefined,
    iss(at('E_LOGIC_VERSION', '/schemaVersion', LG)),
  );
  ok(
    'v10-logic-warning-disabled',
    (f) => (f[LG].rules = [{ id: 'r1', when: 'PUMP07.RUN', enabled: false }]),
    ['W_LOGIC_DISABLED'],
  );
  bad(
    'v10-logic-widget-missing-logic-tag',
    (f) => {
      // Tag logic chỉ có khi khối khai nó: không có khối thì widget tham chiếu Tag không có
      mainItems(f).push({
        id: 'logic_lamp',
        type: 'widget',
        widget: 'lamp',
        x: 10,
        y: 600,
        width: 40,
        height: 40,
        tags: { state: 'LOGIC.T_RUN.Q' },
      });
    },
    ['E_REF_TAG'],
  );
  bad('v10-version-mismatch-screen', (f) => (f[FS].schemaVersion = '0.6.0'), ['E_SCHEMA_VERSION']);
  bad('v10-min-runtime-low', (f) => (f[PJ].minRuntimeVersion = '0.9.0'), ['E_MIN_RUNTIME']);
  bad('v10-runtime-too-old', (f) => (f[PJ].minRuntimeVersion = '1.0.1'), ['E_RUNTIME_TOO_OLD']);
  bad('v10-item-id-dot-bad', (f) => (mainItems(f)[1].id = 'pump7.'), ['E_ITEM_ID']);
  ok('v10-valid-expanded-no-tpl', (f) => {
    // "Bung thành item thường": bỏ tpl, giữ id <inst>.<rid>
    for (const i of instItems(f, 'pump7')) delete i.tpl;
  });
  return C;
}

/**
 * `n` tổ hợp args khác nhau cho một faceplate chỉ có tham số `title` (string): n phần tử SVG của `el_ccc`… mỗi phần tử
 * mở faceplate với `title` riêng. JSON gọn để nhẹ repo.
 */
function withCombos(f, n) {
  const p = fp(f);
  p.params = [{ name: 'title', kind: 'string' }];
  p.items = p.items.filter((i) => i.id === 'panel_f' || i.id === 'close_f');
  f[MS].items = mainItems(f).filter((i) => i.tpl === undefined);
  delete ccc(f).events;
  for (let k = 1; k <= n; k++) {
    const uid = `el_t${String(k).padStart(4, '0')}`;
    mainItems(f)[0].elements.push({ elementUid: uid });
    f[MB].elements.push({
      elementUid: uid,
      events: { click: { action: 'popup', screen: 'bom-chi-tiet', args: { title: `T${k}` } } },
    });
  }
  f[MS] = JSON.stringify(f[MS]) + '\n';
  f[MB] = JSON.stringify(f[MB]) + '\n';
}
