// Sinh các project đo của web-it cho feature 008 (T107, T108), ghi vào tests/web-it/out (không commit):
//   node tests/web-it/make-svg-projects.mjs
//   std-3b   màn hình chuẩn 3b (tools/svg-demo/generate.mjs --standard): ≈ 3.000 phần tử, 30 binding, 10 hoạt ảnh, 5 sự kiện, 103 Tag
//   load-3b  std-3b cộng 397 Tag mô phỏng (tổng 500 Tag, đổi mỗi giây) và 397 binding độ mờ trên 397 phần tử khác (SC-007)
//   svg-40   một màn hình 40 item `svg` (ký hiệu của svg-demo, đổi Tag sang Tag mô phỏng STD.*) (SC-005)
// Tất định: chạy lại cho cùng từng byte. Mỗi project được chạy qua tools/project-validator/validate.mjs.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatProject03, formatScreen03, formatTagsFile } from '@mat/project-schema';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(here, 'out');
const V = '0.4.0';
const json = (v) => JSON.stringify(v, null, 2) + '\n';
const read = (p) => readFileSync(p, 'utf8');

function run(args) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
function validate(dir) {
  const r = spawnSync(process.execPath, ['tools/project-validator/validate.mjs', dir], {
    cwd: root,
    encoding: 'utf8',
  });
  const res = JSON.parse(r.stdout);
  if (r.status !== 0 || res.ok === false)
    throw new Error(`${dir} không hợp lệ: ${JSON.stringify(res.errors ?? res).slice(0, 800)}`);
  console.log(`${dir}: hợp lệ (${(res.warnings ?? []).length} cảnh báo)`);
}

// ---------------------------------------------------------------- std-3b
const std = join(out, 'std-3b');
mkdirSync(out, { recursive: true });
run(['tools/svg-demo/generate.mjs', '--standard', '--out', std]);
validate(std);

// ---------------------------------------------------------------- load-3b
const load = join(out, 'load-3b');
rmSync(load, { recursive: true, force: true });
cpSync(std, load, { recursive: true });
{
  const tags = JSON.parse(read(join(load, 'tags.json'))).tags;
  const extra = 450; // + 50 Tag STD.* của std-3b = 500 Tag mô phỏng đổi mỗi giây
  for (let i = 1; i <= extra; i++)
    tags.push({
      id: `LD.T${String(i).padStart(3, '0')}`,
      kind: 'simulation',
      type: 'FLOAT32',
      min: 0,
      max: 100,
      sim: { kind: 'random', periodMs: 1000, min: 0, max: 100, seed: i },
    });
  writeFileSync(join(load, 'tags.json'), formatTagsFile({ schemaVersion: V, tags }));
  const svg = read(join(load, 'graphics/chuan-3b.svg'));
  const rects = [...svg.matchAll(/<rect[^>]*data-mat-uid="([^"]+)"/g)].map((m) => m[1]);
  const bindFile = join(load, 'screens/chuan-3b.chuan_3b.bindings.json');
  const set = JSON.parse(read(bindFile));
  const used = new Set(set.elements.map((e) => e.elementUid));
  const free = rects.filter((u) => !used.has(u));
  const step = Math.floor(free.length / extra);
  const screenFile = join(load, 'screens/chuan-3b.screen.json');
  const screen = JSON.parse(read(screenFile));
  const item = screen.items[0];
  for (let i = 0; i < extra; i++) {
    const uid = free[i * step];
    set.elements.push({
      elementUid: uid,
      bindings: [
        {
          id: `ld_${i + 1}`,
          target: 'style.opacity',
          source: { type: 'tag', tagId: `LD.T${String(i + 1).padStart(3, '0')}` },
          transform: {
            kind: 'linearScale',
            inMin: 0,
            inMax: 100,
            outMin: 0.2,
            outMax: 1,
            clamp: true,
          },
        },
      ],
    });
    item.elements.push({ elementUid: uid, name: `Tải ${i + 1}` });
  }
  writeFileSync(bindFile, json(set));
  writeFileSync(screenFile, formatScreen03(screen));
  const pj = JSON.parse(read(join(load, 'project.json')));
  pj.projectId = 'svg-load-3b';
  pj.projectName = 'Đo tải màn hình chuẩn 3b (500 Tag)';
  writeFileSync(join(load, 'project.json'), formatProject03(pj));
}
validate(load);

// ---------------------------------------------------------------- svg-40
const p40 = join(out, 'svg-40');
rmSync(p40, { recursive: true, force: true });
mkdirSync(p40, { recursive: true });
{
  const demo = join(root, 'projects/svg-demo');
  const stdTags = JSON.parse(read(join(std, 'tags.json'))).tags;
  const typeOf = new Map(stdTags.map((t) => [t.id, t.type]));
  const bools = stdTags
    .filter((t) => t.id.startsWith('STD.') && t.type === 'BOOL')
    .map((t) => t.id);
  const nums = stdTags.filter((t) => t.id.startsWith('STD.') && t.type !== 'BOOL').map((t) => t.id);
  const remap = new Map();
  let bi = 0;
  let ni = 0;
  const mapTag = (id) => {
    if (!remap.has(id))
      remap.set(
        id,
        typeOf.get(id) === 'BOOL' ? bools[bi++ % bools.length] : nums[ni++ % nums.length],
      );
    return remap.get(id);
  };
  const bon = JSON.parse(read(join(demo, 'screens/bon-nuoc.screen.json')));
  const templates = bon.items.filter((i) => i.type === 'svg' && i.svgFile.includes('symbols/'));
  const items = [];
  const files = {};
  for (let n = 0; n < 40; n++) {
    const t = templates[n % templates.length];
    const id = `${t.id.replace(/_\d+$/, '')}_${n + 1}`;
    const bindingFile = `screens/svg-40.${id}.bindings.json`;
    const b = JSON.parse(read(join(demo, t.bindingFile)));
    b.screenId = 'svg-40';
    b.itemId = id;
    for (const el of b.elements) {
      delete el.events;
      for (const bd of el.bindings ?? []) {
        // Tag có thể tính (STRING): chỉ đổi nguồn sang Tag mô phỏng cùng loại
        bd.source = { type: 'tag', tagId: mapTag(bd.source.tagId) };
      }
    }
    b.elements = b.elements.filter((el) => el.bindings?.length);
    files[bindingFile] = json(b);
    files[t.svgFile] = read(join(demo, t.svgFile));
    items.push({
      ...t,
      id,
      x: 20 + (n % 8) * 232,
      y: 20 + Math.floor(n / 8) * 200,
      width: 210,
      height: 170,
      bindingFile,
    });
  }
  files['screens/svg-40.screen.json'] = formatScreen03({
    schemaVersion: V,
    id: 'svg-40',
    name: '40 item svg',
    kind: 'screen',
    size: { width: 1920, height: 1080 },
    background: '#0f1b21',
    items,
  });
  files['project.json'] = formatProject03({
    format: 'matscada-project',
    schemaVersion: V,
    projectId: 'svg-40',
    projectName: 'Đo mở màn hình 40 item svg',
    projectVersion: '0.1.0',
    minRuntimeVersion: '0.7.0',
    entryScreen: 'svg-40',
    screens: ['svg-40'],
    tagFile: 'tags.json',
    connectionFile: 'connections.json',
    valueTables: ['TrangThaiBom'],
    maxClients: 10,
  });
  files['tags.json'] = read(join(std, 'tags.json'));
  files['connections.json'] = read(join(std, 'connections.json'));
  files['value-tables/TrangThaiBom.json'] = read(join(std, 'value-tables/TrangThaiBom.json'));
  for (const [rel, text] of Object.entries(files)) {
    const p = join(p40, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
}
validate(p40);

// ---------------------------------------------------------------- spin-tr
// Một phần tử có transform gốc và binding quay (ADR-024: quay phải GIỮ transform gốc), cho kịch bản svg (T107)
const ptr = join(out, 'spin-tr');
rmSync(ptr, { recursive: true, force: true });
{
  const files = {
    'graphics/spin-tr.svg':
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><g data-mat-uid="el_fan" transform="translate(200 150)"><circle cx="0" cy="0" r="60" fill="none" stroke="#94a3b8" stroke-width="3"/><line x1="0" y1="0" x2="50" y2="0" stroke="#e2e8f0" stroke-width="5"/></g></svg>\n',
    'screens/spin-tr.fan.bindings.json': json({
      schemaVersion: V,
      screenId: 'spin-tr',
      itemId: 'fan',
      elements: [
        {
          elementUid: 'el_fan',
          bindings: [
            {
              id: 'spin_1',
              target: 'transform.rotate',
              source: { type: 'tag', tagId: 'R.RUN' },
              transform: { kind: 'direct' },
              animation: 'spin',
            },
          ],
        },
      ],
    }),
    'screens/spin-tr.screen.json': formatScreen03({
      schemaVersion: V,
      id: 'spin-tr',
      name: 'Quay trên phần tử có transform',
      kind: 'screen',
      size: { width: 800, height: 600 },
      background: '#0f1b21',
      items: [
        {
          id: 'fan',
          name: 'Quạt',
          type: 'svg',
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          svgFile: 'graphics/spin-tr.svg',
          bindingFile: 'screens/spin-tr.fan.bindings.json',
          viewBox: [0, 0, 400, 300],
          fit: 'contain',
          elements: [{ elementUid: 'el_fan', name: 'Quạt' }],
        },
      ],
    }),
    'project.json': formatProject03({
      format: 'matscada-project',
      schemaVersion: V,
      projectId: 'spin-tr',
      projectName: 'Quay trên phần tử có transform gốc',
      projectVersion: '0.1.0',
      minRuntimeVersion: '0.7.0',
      entryScreen: 'spin-tr',
      screens: ['spin-tr'],
      tagFile: 'tags.json',
      connectionFile: 'connections.json',
      valueTables: ['TrangThaiBom'],
      maxClients: 10,
    }),
    'tags.json': read(join(std, 'tags.json')),
    'connections.json': read(join(std, 'connections.json')),
    'value-tables/TrangThaiBom.json': read(join(std, 'value-tables/TrangThaiBom.json')),
  };
  for (const [rel, text] of Object.entries(files)) {
    const p = join(ptr, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
}
validate(ptr);
