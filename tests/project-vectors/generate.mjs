// Sinh bộ test vector dùng chung TS ↔ C++ (contracts/project-format.md).
// Mỗi case: một thư mục project + expected.json {valid, errors: [mã]}. Chạy lại khi đổi luật:
//   node tests/project-vectors/generate.mjs
// Kết quả được commit; Vitest và GoogleTest đọc thẳng các thư mục này.
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect data-mat-uid="el_aaa" x="10" y="10" width="30" height="80" fill="#38bdf8"/>
  <circle data-mat-uid="el_bbb" cx="70" cy="50" r="20" fill="#64748b"/>
  <text data-mat-uid="el_ccc" x="10" y="98">--</text>
</svg>
`;

function base() {
  return {
    'project.json': {
      format: 'matscada-project',
      schemaVersion: '0.1.0',
      projectId: 'vector',
      projectName: 'Vector',
      projectVersion: '0.1.0',
      minRuntimeVersion: '0.2.0',
      entryScreen: 'main',
      screens: ['main'],
      tagFile: 'tags.json',
      maxClients: 10,
    },
    'tags.json': {
      schemaVersion: '0.1.0',
      tags: [
        { id: 'T.LEVEL', type: 'FLOAT32', min: 0, max: 100, source: { kind: 'mock', signal: 'tank.level' } },
        { id: 'T.RUN', type: 'BOOL', source: { kind: 'mock', signal: 'motor.run' } },
        { id: 'T.NAME', type: 'STRING', source: { kind: 'mock', signal: 'x.name' } },
      ],
    },
    'screens/main.screen.json': {
      schemaVersion: '0.1.0',
      id: 'main',
      name: 'Main',
      svgFile: 'screens/main.svg',
      viewBox: [0, 0, 100, 100],
      fitMode: 'contain',
      bindingFile: 'screens/main.bindings.json',
      elements: [{ elementUid: 'el_aaa' }, { elementUid: 'el_bbb' }, { elementUid: 'el_ccc' }],
    },
    'screens/main.bindings.json': {
      schemaVersion: '0.1.0',
      screenId: 'main',
      elements: [
        {
          elementUid: 'el_aaa',
          bindings: [
            {
              id: 'b1',
              target: 'geometry.levelPercent',
              source: { type: 'tag', tagId: 'T.LEVEL' },
              transform: { kind: 'direct' },
            },
          ],
        },
        {
          elementUid: 'el_bbb',
          bindings: [
            {
              id: 'b2',
              target: 'style.fill',
              source: { type: 'tag', tagId: 'T.RUN' },
              transform: {
                kind: 'discreteMap',
                cases: [
                  { equals: true, value: '#22c55e' },
                  { equals: false, value: '#64748b' },
                ],
              },
            },
          ],
        },
      ],
    },
    'screens/main.svg': SVG,
  };
}

const B = 'screens/main.bindings.json';
const S = 'screens/main.screen.json';
const bindingOf = (f, i = 0, j = 0) => f[B].elements[i].bindings[j];

/** [tên, hàm sửa base, mã lỗi mong đợi] */
const CASES = [
  ['valid-minimal', () => {}, []],
  [
    'valid-all-targets',
    (f) => {
      f[B].elements.push({
        elementUid: 'el_ccc',
        bindings: [
          { id: 'c1', target: 'text.content', source: { type: 'tag', tagId: 'T.LEVEL' }, transform: { kind: 'direct' }, format: { decimals: 1, suffix: ' %' } },
          { id: 'c2', target: 'style.opacity', source: { type: 'tag', tagId: 'T.LEVEL' }, transform: { kind: 'linearScale', inMin: 0, inMax: 100, outMin: 0.2, outMax: 1, clamp: true } },
          { id: 'c3', target: 'style.visibility', source: { type: 'tag', tagId: 'T.RUN' }, transform: { kind: 'direct' } },
          { id: 'c4', target: 'style.stroke', source: { type: 'tag', tagId: 'T.NAME' }, transform: { kind: 'direct' }, onBadQuality: { mode: 'override', value: '#8d99a3' } },
          { id: 'c5', target: 'transform.rotate', source: { type: 'tag', tagId: 'T.RUN' }, transform: { kind: 'direct' }, animation: 'spin' },
          { id: 'c6', target: 'transform.rotate', source: { type: 'tag', tagId: 'T.LEVEL' }, transform: { kind: 'linearScale', inMin: 0, inMax: 100, outMin: 0, outMax: 270 } },
          { id: 'c7', target: 'style.fill', source: { type: 'tag', tagId: 'T.LEVEL' }, transform: { kind: 'discreteMap', cases: [{ equals: 0, value: '#000000' }], default: '#ffffff' }, onBadQuality: { mode: 'hold' } },
        ],
      });
    },
    [],
  ],
  [
    'valid-script-svg',
    (f) => {
      f['screens/main.svg'] = SVG.replace(
        '</svg>',
        '  <script>window.__pwned = 1</script>\n  <rect data-mat-uid="el_ddd" onload="window.__pwned = 2" width="1" height="1"/>\n</svg>',
      );
    },
    [],
  ],
  ['invalid-json', (f) => (f['tags.json'] = '{ "schemaVersion": "0.1.0", "tags": [ '), ['E_JSON']],
  ['invalid-schema', (f) => (f['project.json'].projectName = 42), ['E_SCHEMA']],
  ['invalid-schema-target', (f) => (bindingOf(f).target = 'attr.href'), ['E_SCHEMA']],
  ['invalid-schema-version', (f) => (f['tags.json'].schemaVersion = '0.2.0'), ['E_SCHEMA_VERSION']],
  ['invalid-runtime-too-old', (f) => (f['project.json'].minRuntimeVersion = '9.0.0'), ['E_RUNTIME_TOO_OLD']],
  ['invalid-file-missing', (f) => delete f['screens/main.svg'], ['E_FILE_MISSING']],
  ['invalid-file-missing-screen', (f) => delete f[S], ['E_FILE_MISSING']],
  ['invalid-path-dotdot', (f) => (f[S].svgFile = '../main.svg'), ['E_PATH']],
  ['invalid-path-absolute', (f) => (f[S].svgFile = '/etc/passwd.svg'), ['E_PATH']],
  ['invalid-path-drive', (f) => (f[S].svgFile = 'C:\\x.svg'), ['E_PATH']],
  ['invalid-path-tagfile', (f) => (f['project.json'].tagFile = '../tags.json'), ['E_PATH']],
  ['invalid-entry-screen', (f) => (f['project.json'].entryScreen = 'other'), ['E_SCREEN_ID']],
  ['invalid-screen-id', (f) => (f[S].id = 'other'), ['E_SCREEN_ID']],
  ['invalid-binding-screen-id', (f) => (f[B].screenId = 'other'), ['E_SCREEN_ID']],
  ['invalid-dup-tag', (f) => f['tags.json'].tags.push({ ...f['tags.json'].tags[0] }), ['E_DUP_TAG']],
  ['invalid-tag-range', (f) => Object.assign(f['tags.json'].tags[0], { min: 10, max: 5 }), ['E_TAG_RANGE']],
  ['invalid-tag-range-bool', (f) => Object.assign(f['tags.json'].tags[1], { min: 0 }), ['E_TAG_RANGE']],
  ['invalid-dup-uid', (f) => f[S].elements.push({ elementUid: 'el_aaa' }), ['E_DUP_UID']],
  [
    'invalid-dup-uid-bindings',
    (f) => f[B].elements.push({ elementUid: 'el_aaa', bindings: [{ ...bindingOf(f), id: 'b9' }] }),
    ['E_DUP_UID'],
  ],
  ['invalid-dup-binding', (f) => (bindingOf(f, 1).id = 'b1'), ['E_DUP_BINDING']],
  ['invalid-ref-uid', (f) => (f[B].elements[0].elementUid = 'el_zzz'), ['E_REF_UID']],
  ['invalid-ref-tag', (f) => (bindingOf(f).source.tagId = 'T.LEVL'), ['E_REF_TAG']],
  ['invalid-target-unsupported', (f) => (bindingOf(f).target = 'transform.scale'), ['E_TARGET_UNSUPPORTED']],
  [
    'invalid-transform-unsupported',
    (f) => (bindingOf(f).transform = { kind: 'expression', expr: 'T.LEVEL * 2' }),
    ['E_TRANSFORM_UNSUPPORTED'],
  ],
  [
    'invalid-type-scale-bool',
    (f) => (bindingOf(f, 1).transform = { kind: 'linearScale', inMin: 0, inMax: 1, outMin: 0, outMax: 1 }),
    ['E_TYPE_MISMATCH'],
  ],
  ['invalid-type-equals', (f) => (bindingOf(f, 1).transform.cases[0].equals = 'yes'), ['E_TYPE_MISMATCH']],
  ['invalid-type-level-bool', (f) => (bindingOf(f).source.tagId = 'T.RUN'), ['E_TYPE_MISMATCH']],
  [
    'invalid-scale-range',
    (f) => (bindingOf(f).transform = { kind: 'linearScale', inMin: 5, inMax: 5, outMin: 0, outMax: 100 }),
    ['E_SCALE_RANGE'],
  ],
  ['invalid-max-clients', (f) => (f['project.json'].maxClients = 11), ['E_MAX_CLIENTS']],
  ['invalid-max-clients-zero', (f) => (f['project.json'].maxClients = 0), ['E_MAX_CLIENTS']],
  // Review M2: 2^32 + 1 must not wrap to 1 in the C++ validator
  [
    'invalid-max-clients-overflow',
    (f) => (f['project.json'].maxClients = 4294967297),
    ['E_MAX_CLIENTS'],
  ],
  // Review M3: nesting deeper than 64 is refused before the (recursive) parser
  [
    'invalid-json-deep',
    (f) =>
      (f['tags.json'] =
        '{"schemaVersion":"0.1.0","tags":[],"x":' + '['.repeat(100) + ']'.repeat(100) + '}\n'),
    ['E_JSON'],
  ],
  // Review M1: strings longer than 1024 UTF-8 bytes are refused before regex matching
  [
    'invalid-schema-longstring',
    (f) => (f['project.json'].projectVersion = '0.1.0-' + 'a'.repeat(100000)),
    ['E_SCHEMA'],
  ],
  // Review minor-5: path length is counted in UTF-8 bytes on both sides
  [
    'invalid-path-utf8-length',
    (f) => (f[S].svgFile = 'screens/' + 'ệ'.repeat(40) + '.svg'),
    ['E_PATH'],
  ],
];

for (const d of readdirSync(here)) {
  const p = join(here, d);
  if (statSync(p).isDirectory()) rmSync(p, { recursive: true });
}

const write = (dir, files, expected) => {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  }
  writeFileSync(join(dir, 'expected.json'), JSON.stringify(expected) + '\n');
};

for (const [name, mutate, errors] of CASES) {
  const files = base();
  mutate(files);
  write(join(here, name), files, { valid: errors.length === 0, errors });
}

// Project mẫu thật cũng là một vector hợp lệ.
const demo = join(here, 'valid-tank-demo');
cpSync(resolve(root, 'projects/tank-demo'), demo, { recursive: true, filter: (s) => !s.endsWith('README.md') });
writeFileSync(join(demo, 'expected.json'), JSON.stringify({ valid: true, errors: [] }) + '\n');

console.log(`${CASES.length + 1} vector trong ${here}`);
