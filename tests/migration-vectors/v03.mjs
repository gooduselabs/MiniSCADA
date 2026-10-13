// Cặp file nâng cấp 0.2 -> 0.3 (contracts/project-format-0.3.md §8; research R6), được generate.mjs nạp:
//   tests/migration-vectors/<ca>-0.2to0.3/before/…  nguồn 0.2 (hoặc 0.1 cho tank-demo: nâng cấp qua cả hai bước)
//   tests/migration-vectors/<ca>-0.2to0.3/after/…   do bộ biến đổi tham chiếu VIẾT RIÊNG ở đây (không import
//                                                    @mat/project-schema); tệp ghi theo định dạng §11
//   tests/migration-vectors/<ca>-0.2to0.3/expected-error.json  { code, file? } với ca không nâng cấp được
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const J = (v) => JSON.stringify(v);
const j2 = (v) => JSON.stringify(v, null, 2) + '\n';
const text = (b) => {
  const s = b.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
};
const ceil = Math.ceil;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const maxVer = (a, b) => {
  const p = (s) => s.split('.').map(Number);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? a : b;
  return a;
};

const NAME = 'Đồ họa';
const pick = (o, keys) =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** Màn hình 0.2 (đối tượng) -> { text, name, clamped } hoặc null nếu không chuyển được. */
function convertScreen(o) {
  const ok =
    typeof o?.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.svgFile === 'string' &&
    typeof o.bindingFile === 'string' &&
    Array.isArray(o.elements) &&
    ['contain', 'cover', 'stretch'].includes(o.fitMode) &&
    Array.isArray(o.viewBox) &&
    o.viewBox.length === 4 &&
    o.viewBox.every((n) => typeof n === 'number') &&
    o.viewBox[2] > 0 &&
    o.viewBox[3] > 0;
  if (!ok) return null;
  const rw = ceil(o.viewBox[2]);
  const rh = ceil(o.viewBox[3]);
  const width = clamp(rw, 64, 4096);
  const height = clamp(rh, 64, 2304);
  const item = {
    id: 'svg1',
    name: NAME,
    type: 'svg',
    x: 0,
    y: 0,
    width,
    height,
    svgFile: o.svgFile,
    bindingFile: o.bindingFile,
    viewBox: o.viewBox,
  };
  if (o.fitMode !== 'contain') item.fit = o.fitMode;
  item.elements = o.elements.map((e) => pick(e, ['elementUid', 'name', 'kind']));
  const head = [
    `  "schemaVersion": "0.3.0"`,
    `  "id": ${J(o.id)}`,
    `  "name": ${J(o.name)}`,
    `  "size": ${J({ width, height })}`,
  ];
  if (o.fitMode !== 'contain') head.push(`  "fitMode": ${J(o.fitMode)}`);
  if (typeof o.background === 'string') head.push(`  "background": ${J(o.background)}`);
  head.push(`  "items": [\n    ${J(item)}\n  ]`);
  return {
    text: `{\n${head.join(',\n')}\n}\n`,
    name: o.name,
    clamped: width !== rw || height !== rh,
  };
}

const bindingTo03 = (b) => {
  const out = {};
  for (const [k, v] of Object.entries(b)) {
    out[k] = k === 'schemaVersion' ? '0.3.0' : v;
    if (k === 'screenId') out.itemId = 'svg1';
  }
  return out;
};

const parse = (buf) => {
  try {
    const v = JSON.parse(text(buf));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

/** Bộ biến đổi tham chiếu 0.2 -> 0.3. Trả { files } hoặc { error }. */
export function reference03(before) {
  const project = before['project.json'] ? parse(before['project.json']) : null;
  if (!project) return { error: { code: 'UNREADABLE', file: 'project.json' } };
  const version = String(project.schemaVersion ?? '');
  if (/^0\.3\.\d+$/.test(version)) return { error: { code: 'ALREADY_03' } };
  if (!/^0\.2\.\d+$/.test(version)) return { error: { code: 'UNSUPPORTED_VERSION', version } };
  const after = { ...before };
  const ids = Array.isArray(project.screens)
    ? project.screens.filter((s) => typeof s === 'string')
    : [];
  const names = [];
  for (const id of ids) {
    const path = `screens/${id}.screen.json`;
    const o = before[path] ? parse(before[path]) : null;
    const c = o ? convertScreen(o) : null;
    if (!c) {
      names.push(id);
      continue;
    }
    names.push(c.name);
    after[path] = Buffer.from(c.text);
    const b =
      typeof o.bindingFile === 'string' && before[o.bindingFile]
        ? parse(before[o.bindingFile])
        : null;
    if (b) after[o.bindingFile] = Buffer.from(j2(bindingTo03(b)));
  }
  const only = new Set(
    [
      project.tagFile,
      project.connectionFile,
      project.loggingFile,
      ...(project.valueTables ?? []).map((n) => `value-tables/${n}.json`),
      ...(project.watchTables ?? []).map((n) => `watch-tables/${n}.json`),
    ].filter((f) => typeof f === 'string'),
  );
  for (const f of only)
    if (before[f])
      after[f] = Buffer.from(
        before[f].toString('utf8').replace(/("schemaVersion"\s*:\s*")0\.2\.\d+(")/, '$10.3.0$2'),
      );
  project.schemaVersion = '0.3.0';
  project.minRuntimeVersion = maxVer(project.minRuntimeVersion ?? '0.0.0', '0.6.0');
  if (ids.length >= 2 && project.navigation === undefined)
    project.navigation = {
      position: 'left',
      items: ids.map((id, i) => ({ label: [...names[i]].slice(0, 40).join(''), screen: id })),
    };
  // project.json: giữ thứ tự khóa, navigation ngay trước maxClients, mỗi mục menu một dòng
  const keys = Object.keys(project).filter((k) => k !== 'navigation');
  if (project.navigation) {
    const at = keys.indexOf('maxClients');
    keys.splice(at >= 0 ? at : keys.length, 0, 'navigation');
  }
  const navText = (n) => {
    const lines = [];
    if (n.position !== undefined) lines.push(`    "position": ${J(n.position)}`);
    const order = (it) => ({
      ...pick(it, ['label', 'screen', 'icon']),
      ...(it.items ? { items: it.items.map(order) } : {}),
    });
    const items = n.items.map((it) => `      ${J(order(it))}`);
    lines.push(items.length ? `    "items": [\n${items.join(',\n')}\n    ]` : '    "items": []');
    return `{\n${lines.join(',\n')}\n  }`;
  };
  const body = keys.map(
    (k) =>
      `  ${J(k)}: ${k === 'navigation' ? navText(project[k]) : JSON.stringify(project[k], null, 2).replace(/\n/g, '\n  ')}`,
  );
  after['project.json'] = Buffer.from(`{\n${body.join(',\n')}\n}\n`);
  return { files: after };
}

/** Các ca 0.2 -> 0.3: { tên: before (cây Buffer) }; `through01` = [tên, cây 0.1] đi qua bước 0.1 -> 0.2 của generate. */
export function cases03(root, reference01to02) {
  const readTree = (dir, rel = '') => {
    const out = {};
    for (const n of readdirSync(join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${n}` : n;
      if (statSync(join(dir, r)).isDirectory()) Object.assign(out, readTree(dir, r));
      else if (n !== 'expected.json' && n !== 'README.md') out[r] = readFileSync(join(dir, r));
    }
    return out;
  };
  const modbus = () => readTree(join(root, 'projects/modbus-demo'));
  const edit = (files, name, fn) => {
    const v = JSON.parse(text(files[name]));
    fn(v);
    files[name] = Buffer.from(j2(v));
  };
  const S = 'screens/main.screen.json';
  const cases = {};
  const through = {};

  through['tank-demo'] = readTree(join(root, 'tests/migration-vectors/valid-tank-demo/before'));
  cases['modbus-demo'] = modbus();
  {
    const f = modbus();
    edit(f, S, (v) => (v.viewBox = [50, -20, 200, 120]));
    cases['viewbox-offset'] = f;
  }
  {
    const f = modbus();
    edit(f, S, (v) => (v.viewBox = [0, 0, 200.2, 120.7]));
    cases['viewbox-fraction'] = f;
  }
  {
    const f = modbus();
    edit(f, S, (v) => (v.viewBox = [0, 0, 10000, 5000]));
    cases['viewbox-huge'] = f;
  }
  {
    const f = modbus();
    edit(f, S, (v) => (v.viewBox = [0, 0, 10, 10]));
    cases['viewbox-tiny'] = f;
  }
  {
    const f = modbus();
    edit(f, S, (v) => ((v.fitMode = 'cover'), (v.background = '#102030')));
    cases['fit-cover-background'] = f;
  }
  {
    const f = modbus();
    edit(f, S, (v) => (v.fitMode = 'stretch'));
    cases['fit-stretch'] = f;
  }
  {
    const f = modbus();
    edit(f, 'project.json', (v) => (v.minRuntimeVersion = '0.7.0'));
    cases['min-runtime-higher'] = f;
  }
  {
    // nhiều màn hình: nhãn menu theo tên, cắt ở 40 ký tự; một SVG dùng chung
    const f = modbus();
    const longName = 'Tên màn hình rất dài vượt quá bốn mươi ký tự để kiểm tra việc cắt nhãn menu';
    for (const [id, name] of [
      ['second', 'Màn hình thứ hai'],
      ['third', longName],
    ]) {
      f[`screens/${id}.screen.json`] = Buffer.from(
        j2({
          schemaVersion: '0.2.0',
          id,
          name,
          svgFile: 'screens/main.svg',
          viewBox: [0, 0, 100, 100],
          fitMode: 'contain',
          bindingFile: `screens/${id}.bindings.json`,
          elements: [{ elementUid: 'el_aaa', name: 'Bồn', kind: 'shape' }],
        }),
      );
      f[`screens/${id}.bindings.json`] = Buffer.from(
        j2({ schemaVersion: '0.2.0', screenId: id, elements: [] }),
      );
    }
    edit(f, 'project.json', (v) => (v.screens = ['main', 'second', 'third']));
    cases['multi-screen'] = f;
  }
  {
    // lỗi sẵn của bản gốc được mang sang: binding trỏ uid không khai (E_REF_UID)
    const f = modbus();
    edit(f, 'screens/main.bindings.json', (v) => (v.elements[0].elementUid = 'el_khong_co'));
    cases['screen-existing-error'] = f;
  }
  {
    // màn hình thứ hai hỏng JSON: mang nguyên văn, vẫn có trong menu theo id
    const f = modbus();
    f['screens/second.screen.json'] = Buffer.from('{ "schemaVersion": "0.2.0", ');
    edit(f, 'project.json', (v) => (v.screens = ['main', 'second']));
    cases['screen-broken-file'] = f;
  }
  {
    const f = modbus();
    f['tags.json'] = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), f['tags.json']]);
    f[S] = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), f[S]]);
    cases['edge-bom'] = f;
  }
  {
    const f = modbus();
    f['project.json'] = Buffer.from('not json');
    cases['unreadable-project'] = f;
  }
  {
    const f = readTree(join(root, 'tests/project-vectors/v03-valid-minimal'));
    cases['already-03'] = f;
  }
  {
    const f = modbus();
    edit(f, 'project.json', (v) => (v.schemaVersion = '0.4.0'));
    cases['unsupported-version'] = f;
  }

  const out = [];
  for (const [name, before] of Object.entries(cases))
    out.push([`${name}-0.2to0.3`, before, before]);
  for (const [name, before01] of Object.entries(through)) {
    const r = reference01to02(before01);
    if (r.error) throw new Error(`ca ${name}: ${JSON.stringify(r.error)}`);
    out.push([`${name}-0.2to0.3`, before01, r.files]);
  }
  return out.map(([name, before, via]) => ({ name, before, after03: reference03(via) }));
}
