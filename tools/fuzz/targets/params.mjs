// Mục tiêu fuzz `params` (T058): substituteParams và checkParamPlaces của @mat/project-schema (tham số template và
// faceplate, contracts/project-format-1.0.md §3, §5) trên item, khai báo tham số và args đột biến. Kho mầm
// tests/fuzz-corpus/params.json (item thật của vector v10) cộng item tổng hợp từ danh mục widget. Bất biến:
//  - không ném; không sửa item đầu vào; tất định;
//  - lỗi chỗ đặt (`place`) của substituteParams trùng với checkParamPlaces (dù args sai hay đúng);
//  - thay được và mọi giá trị tham số (args, default) không chứa `{`/`}`: kết quả không còn `{` hay `}` ở bất kỳ chuỗi
//    hay khóa nào;
//  - thay được và khai báo đúng (checkParamDecls rỗng): chỗ khác item gốc trong `/tags/...` khớp TAG_PREFIX_RE (tên
//    Tag hợp lệ); đầu vào toàn số hữu hạn thì kết quả toàn số hữu hạn.
import { dictionaryOf, firstNonFinite, int, loadCorpus, mutateJson, pick } from '../ts-lib.mjs';

const ps = await import('../../../packages/project-schema/src/index.ts');

const NAMES = ['prefix', 'title', 'p', 'a1', 'n', 'c', 'level', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'x'.repeat(32), 'Bad', '_x', 'x-y']; // prettier-ignore
const KINDS = ['tagPrefix', 'string', 'number', 'color'];
const VALUES = {
  tagPrefix: ['PUMP01', 'A', 'TANK_1.SUB', 'a'.repeat(64), 'a'.repeat(65), '1A', 'A..B', 'A.', ''],
  string: [
    'Bơm',
    '',
    'x'.repeat(128),
    'Đ'.repeat(43),
    'Đ'.repeat(42),
    'a\u0001b',
    '{x}',
    '}',
    'ok',
  ],
  number: ['0', '-1', '1.5', '1e3', '1e400', '01', '-0', 'NaN', '.5', '1.', ' 1'],
  color: ['#00FF00', '#abcdef', '#abc', 'red', '#GGGGGG', '#00FF00 '],
};

function syntheticItem(r, names, template) {
  const w = pick(r, ps.WIDGET_CATALOG.widgets);
  const ph = () => `{${pick(r, names)}}`;
  const item = {
    id: 'w' + int(r, 0, 99),
    type: 'widget',
    widget: w.id,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
  };
  const props = {};
  for (const p of w.props) {
    if (r() < 0.5) continue;
    if (p.kind === 'string')
      props[p.name] = pick(r, [ph(), `A ${ph()} B`, `${ph()}${ph()}`, 'x', '{', '{}']);
    else if (p.kind === 'number' || p.kind === 'int')
      props[p.name] = r() < 0.7 ? ph() : `${ph()}${ph()}`;
    else if (p.kind === 'color') props[p.name] = r() < 0.8 ? ph() : `#${ph()}`;
    else if (p.kind === 'array') props[p.name] = [ph(), 'x', { a: ph() }];
    else if (r() < 0.3) props[p.name] = ph();
  }
  item.props = props;
  const tags = {};
  for (const s of w.slots) {
    if (r() < 0.3) continue;
    const v = pick(r, [
      ph(),
      `${ph()}.RUN`,
      `${ph()}.A.B`,
      `X.${ph()}`,
      `${ph()}${ph()}`,
      `${ph()}.`,
      `${ph()}.a-b`,
    ]);
    tags[s.name] = s.multi && r() < 0.5 ? [v, ph()] : r() < 0.15 ? { tag: v } : v;
  }
  item.tags = tags;
  if (r() < 0.5)
    item.events = {
      click: {
        action: 'popup',
        target: 'pump',
        args: { [pick(r, names)]: pick(r, [ph(), `x${ph()}`, 'y', ph() + ph()]) },
      },
    };
  if (r() < 0.1) item[ph()] = 1;
  if (template && r() < 0.1) item.id = ph();
  return item;
}

export async function setup() {
  const seeds = loadCorpus('params.json');
  const dict = dictionaryOf([...seeds.items.map((s) => s.item), ...seeds.args]);
  dict.strings.push(
    '{prefix}',
    '{title}',
    '{prefix}.RUN',
    'Bơm {title}',
    '{p}',
    '{constructor}',
    '{toString}',
  );
  return { seeds, dict };
}

export function generate(ctx, r) {
  const template = r() < 0.5;
  let params;
  let item;
  if (r() < 0.5) {
    const s = pick(r, ctx.seeds.items);
    params = structuredClone(s.params);
    item = mutateJson(s.item, r, ctx.dict, undefined, int(r, 0, 3));
  } else {
    params = [];
    for (let i = int(r, 0, 4); i > 0; i--) {
      const kind = pick(r, KINDS);
      const d = { name: pick(r, NAMES), kind };
      if (r() < 0.6) d.default = pick(r, VALUES[kind]);
      params.push(d);
    }
    const names = params.length ? params.map((p) => p.name) : ['prefix'];
    item = syntheticItem(r, r() < 0.9 ? names : NAMES, template);
  }
  if (r() < 0.2 && params.length) params[int(r, 0, params.length - 1)].kind = pick(r, KINDS);
  let args;
  const a = r();
  if (a < 0.1) args = undefined;
  else if (a < 0.2) args = pick(r, [null, [], 'x', 1, ctx.seeds.args[0]]);
  else if (a < 0.35) args = structuredClone(pick(r, ctx.seeds.args));
  else {
    args = {};
    for (const p of params)
      if (r() < 0.8)
        args[p.name] = r() < 0.9 ? pick(r, VALUES[p.kind]) : pick(r, [1, null, {}, true]);
    if (r() < 0.1) args[pick(r, NAMES)] = 'PUMP02';
    if (r() < 0.05) args = JSON.parse('{"__proto__":"x","prefix":"P1"}');
  }
  return { template, params, item, args: args === undefined ? '__undefined__' : args };
}

const hasBrace = (v) => {
  if (typeof v === 'string') return v.includes('{') || v.includes('}');
  if (Array.isArray(v)) return v.some(hasBrace);
  if (v !== null && typeof v === 'object')
    return Object.entries(v).some(([k, x]) => hasBrace(k) || hasBrace(x));
  return false;
};

/** Các cặp (đường dẫn, gốc, mới) ở lá chuỗi mà kết quả khác gốc. */
function changedLeaves(a, b, path = [], out = []) {
  if (typeof a === 'string') {
    if (a !== b) out.push({ path, before: a, after: b });
  } else if (Array.isArray(a) && Array.isArray(b))
    a.forEach((x, i) => changedLeaves(x, b[i], [...path, String(i)], out));
  else if (a !== null && typeof a === 'object' && b !== null && typeof b === 'object')
    for (const k of Object.keys(a)) changedLeaves(a[k], b[k], [...path, k], out);
  return out;
}

export function check(_ctx, input) {
  const problems = [];
  const counters = [];
  const { template, params, item } = input;
  const args = input.args === '__undefined__' ? undefined : input.args;
  const before = JSON.stringify(item);
  const opts = { template };
  const res = ps.substituteParams(item, params, args, opts);
  const places = ps.checkParamPlaces(item, params, opts);
  if (JSON.stringify(item) !== before) problems.push('substituteParams sửa item đầu vào');
  const again = ps.substituteParams(item, params, args, opts);
  if (JSON.stringify(again) !== JSON.stringify(res)) problems.push('không tất định');
  const resPlaces = res.ok ? [] : res.problems.filter((p) => p.kind === 'place');
  if (JSON.stringify(resPlaces) !== JSON.stringify(places))
    problems.push(
      `lỗi chỗ đặt lệch checkParamPlaces: ${JSON.stringify(resPlaces)} != ${JSON.stringify(places)}`,
    );
  if (!res.ok) {
    counters.push('rejected', ...new Set(res.problems.map((p) => 'kind:' + p.kind)));
    return { problems, counters };
  }
  counters.push('substituted');
  const values = [];
  for (const p of params) {
    if (args && typeof args === 'object' && Object.prototype.hasOwnProperty.call(args, p.name))
      values.push(args[p.name]);
    else if (p.default !== undefined) values.push(p.default);
  }
  if (!values.some(hasBrace)) {
    counters.push('brace-free-args');
    if (hasBrace(res.value))
      problems.push(`còn '{' hoặc '}' sau khi thay: ${JSON.stringify(res.value).slice(0, 300)}`);
  }
  // Khai báo sai (default sai kiểu, tên trùng) là lỗi riêng (checkParamDecls, E_TEMPLATE_PARAM); hàm thay không kiểm
  // lại default, nên bất biến về giá trị thay chỉ đòi khi khai báo đúng.
  const declsOk = ps.checkParamDecls(params).length === 0;
  if (!declsOk) counters.push('bad-decls');
  for (const c of changedLeaves(item, res.value)) {
    if (
      declsOk &&
      c.path[0] === 'tags' &&
      !(typeof c.after === 'string' && ps.TAG_PREFIX_RE.test(c.after))
    )
      problems.push(
        `khe Tag sau khi thay không phải tên Tag: ${c.path.join('/')} = ${JSON.stringify(c.after)}`,
      );
    if (declsOk && typeof c.after === 'number' && !Number.isFinite(c.after))
      problems.push(`số không hữu hạn sau khi thay: ${c.path.join('/')}`);
  }
  if (declsOk && firstNonFinite(item) === null && firstNonFinite(res.value) !== null)
    problems.push(`số không hữu hạn sau khi thay: ${firstNonFinite(res.value)}`);
  return { problems, counters };
}
