// Sinh bộ vector gói .matscada dùng chung C++ (core/package), Rust (Studio) và TS (chỉ phần digest):
// specs/005-device-online/contracts/matscada-package.md §9. Không thêm phụ thuộc (zlib, crypto của Node).
//
//   node tests/package-vectors/generate.mjs        sinh lại mọi vector của script này, kể cả out/
//   node tests/package-vectors/generate.mjs --out  chỉ sinh các gói lớn vào out/ (chạy trước test C++, Rust)
//
// Vector là thư mục con có expected.json (out/ không phải vector):
// - Gói: `package.matscada`, hoặc `"generated": "out/<tên>.matscada"` (đường dẫn so với thư mục này) với gói
//   lớn không commit. Thiếu file đó thì test phải báo lỗi và chỉ lệnh trên, không được bỏ qua.
//   - hợp lệ: { "ok": true, "digest": "sha256:…", "files"?: [mục files[] của manifest] }
//   - hỏng: { "code": "E_PKG_…", "path"?: "…" }. Có `path` thì so cả path của lỗi; không có thì chỉ so mã
//     (lỗi của cả gói, hoặc entry nào báo lỗi tùy thứ tự kiểm).
// - Digest (không có gói): { "digest", "text" (chuỗi đem băm), "files" (không theo thứ tự), "contents" }.
//
// Mỗi gói hỏng chỉ phạm một luật, phần còn lại hợp lệ (manifest, CRC, SHA-256, digest khớp nhau), để mã
// mong đợi không phụ thuộc thứ tự kiểm. Hai ngoại lệ không tránh được: path-directory (tên kết thúc bằng
// `/` phạm luật 1 và luật 6 của §5: luật 1–5 kiểm trước luật 6) và size-entries-1025 (manifest buộc phải
// liệt kê 1024 > 1023 file: số entry ở EOCD kiểm trước manifest).
// Script chỉ xóa thư mục có tên trong danh sách của nó: vector golden của bộ ghi C++, Rust (T094, T115)
// được giữ. Đổi tên hay bỏ một vector thì xóa thư mục cũ bằng tay.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const OUT = 'out';
const onlyOut = process.argv.includes('--out');

const KiB = 1024;
const MiB = 1024 * KiB;
const EMPTY = Buffer.alloc(0);
const buf = (x) => (Buffer.isBuffer(x) ? x : Buffer.from(x, 'utf8'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const byUtf8 = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const json = (v) => JSON.stringify(v, null, 2) + '\n';
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

// ---- Digest nội dung (contract §4) ----

const fileEntry = (path, data) => ({ path, size: data.length, sha256: sha256(data) });
const digestText = (files) =>
  [...files]
    .sort((a, b) => byUtf8(a.path, b.path))
    .map((f) => `${f.sha256} ${f.size} ${f.path}\n`)
    .join('');
const digestOf = (files) => 'sha256:' + sha256(Buffer.from(digestText(files), 'utf8'));

// ---- Bộ ghi ZIP tối thiểu (contract §2, §7) ----

const SIG = {
  local: 0x04034b50,
  central: 0x02014b50,
  eocd: 0x06054b50,
  zip64Eocd: 0x06064b50,
  zip64Locator: 0x07064b50,
  descriptor: 0x08074b50,
};
const FLAG_UTF8 = 0x0800;
const DOS_TIME = 0x0000;
const DOS_DATE = 0x0021; // 1980-01-01
const STORED = 0;
const DEFLATE = 8;

/** Số nguyên little-endian: [[số byte, giá trị], …]. */
function le(fields) {
  const b = Buffer.alloc(fields.reduce((n, [size]) => n + size, 0));
  let o = 0;
  for (const [size, v] of fields) {
    if (size === 2) b.writeUInt16LE(v, o);
    else if (size === 4) b.writeUInt32LE(v >>> 0, o);
    else b.writeBigUInt64LE(BigInt(v), o);
    o += size;
  }
  return b;
}

/**
 * Entry tất định theo contract §7: tên UTF-8 (cờ bit 11), giờ DOS 1980-01-01, "version made by" 20
 * (MS-DOS), thuộc tính 0, không extra, comment, data descriptor. `method`: 'stored', 'deflate', hoặc 'auto'
 * (như Studio: deflate mức 6, trừ khi bản nén không nhỏ hơn bản gốc).
 * Vector hỏng sửa các trường sau khi tạo; `local` chứa trường của header cục bộ khác central.
 */
function entry(path, content, method = 'auto') {
  const data = buf(content);
  let m = STORED;
  let body = data;
  if (method !== 'stored') {
    const d = deflateRawSync(data, { level: 6 });
    if (method === 'deflate' || d.length < data.length) {
      m = DEFLATE;
      body = d;
    }
  }
  return {
    name: Buffer.from(path, 'utf8'),
    method: m,
    flags: FLAG_UTF8,
    versionNeeded: 20,
    madeBy: 20,
    crc: crc32(data),
    csize: body.length,
    usize: data.length,
    body,
    extra: EMPTY,
    comment: EMPTY,
    attrs: 0,
    local: {},
    after: EMPTY, // byte ngay sau dữ liệu (data descriptor, khoảng trống)
  };
}

function localHeader(e) {
  const h = { ...e, ...e.local };
  return Buffer.concat([
    le([
      [4, SIG.local],
      [2, h.versionNeeded],
      [2, h.flags],
      [2, h.method],
      [2, DOS_TIME],
      [2, DOS_DATE],
      [4, h.crc],
      [4, h.csize],
      [4, h.usize],
      [2, h.name.length],
      [2, h.extra.length],
    ]),
    h.name,
    h.extra,
  ]);
}

function centralHeader(e, offset) {
  return Buffer.concat([
    le([
      [4, SIG.central],
      [2, e.madeBy],
      [2, e.versionNeeded],
      [2, e.flags],
      [2, e.method],
      [2, DOS_TIME],
      [2, DOS_DATE],
      [4, e.crc],
      [4, e.csize],
      [4, e.usize],
      [2, e.name.length],
      [2, e.extra.length],
      [2, e.comment.length],
      [2, 0], // disk number start
      [2, 0], // thuộc tính trong
      [4, e.attrs],
      [4, offset],
    ]),
    e.name,
    e.extra,
    e.comment,
  ]);
}

/**
 * Header cục bộ + dữ liệu của từng entry theo thứ tự, rồi central directory, rồi EOCD. Entry có
 * `overlay: { of, delta }` không ghi header cục bộ: offset của nó trỏ vào giữa entry `of` (Fifield).
 * `opt`: `before`, `after` (byte thừa trước entry đầu, sau EOCD; offset vẫn đúng), `comment` (của EOCD),
 * `zip64` (chèn bản ghi EOCD ZIP64 và locator trước EOCD).
 */
function zip(entries, opt = {}) {
  const parts = [];
  let pos = 0;
  const put = (b) => {
    parts.push(b);
    pos += b.length;
  };
  if (opt.before) put(opt.before);
  const offsets = [];
  entries.forEach((e, i) => {
    if (e.overlay) {
      offsets[i] = offsets[e.overlay.of] + e.overlay.delta;
      return;
    }
    offsets[i] = pos;
    put(localHeader(e));
    put(e.body);
    put(e.after);
  });
  const cdOffset = pos;
  entries.forEach((e, i) => put(centralHeader(e, offsets[i])));
  const cdSize = pos - cdOffset;
  if (opt.zip64) {
    const at = pos;
    put(
      le([
        [4, SIG.zip64Eocd],
        [8, 44],
        [2, 45],
        [2, 45],
        [4, 0],
        [4, 0],
        [8, entries.length],
        [8, entries.length],
        [8, cdSize],
        [8, cdOffset],
      ]),
    );
    put(
      le([
        [4, SIG.zip64Locator],
        [4, 0],
        [8, at],
        [4, 1],
      ]),
    );
  }
  const comment = opt.comment ?? EMPTY;
  put(
    le([
      [4, SIG.eocd],
      [2, 0],
      [2, 0],
      [2, entries.length],
      [2, entries.length],
      [4, cdSize],
      [4, cdOffset],
      [2, comment.length],
    ]),
  );
  put(comment);
  if (opt.after) put(opt.after);
  return Buffer.concat(parts);
}

// ---- Gói đúng contract (§3, §7) ----

function identity(files) {
  const p = JSON.parse(buf(files['project.json']).toString('utf8'));
  return {
    projectId: p.projectId,
    projectName: p.projectName,
    projectVersion: p.projectVersion,
    minRuntimeVersion: p.minRuntimeVersion,
  };
}

function manifestFor(files) {
  const list = Object.keys(files)
    .sort(byUtf8)
    .map((p) => fileEntry(p, buf(files[p])));
  return {
    format: 'matscada-package',
    formatVersion: '1.0.0',
    project: identity(files),
    createdAt: '2026-10-11T00:00:00Z',
    generator: { name: 'mAT package vectors', version: '1.0.0' },
    files: list,
    digest: digestOf(list),
  };
}

/**
 * Gói: manifest (stored) rồi các file sắp theo path (byte UTF-8). Sửa trước khi ghi:
 * `manifest(m)` sửa đối tượng manifest (tự tính lại `digest` nếu đổi `files`), `manifestBytes(m)` thay byte
 * của manifest, `entries(list)` sửa danh sách entry (entry 0 là manifest), `zip` tùy chọn của zip().
 */
function pack(files, opt = {}) {
  const m = manifestFor(files);
  if (opt.manifest) opt.manifest(m);
  const mbytes = opt.manifestBytes ? opt.manifestBytes(m) : Buffer.from(json(m), 'utf8');
  let list = [
    entry('matscada.json', mbytes, 'stored'),
    ...Object.keys(files)
      .sort(byUtf8)
      .map((p) => entry(p, files[p], (opt.methods ?? {})[p] ?? opt.method ?? 'auto')),
  ];
  if (opt.entries) list = opt.entries(list) ?? list;
  return { pkg: zip(list, opt.zip), manifest: m };
}

const find = (list, path) => {
  const e = list.find((x) => x.name.toString('utf8') === path);
  if (!e) throw new Error(`không có entry ${path}`);
  return e;
};
/** Chèn entry vào đúng chỗ theo thứ tự path (sau manifest). */
const insertSorted = (list, e) => {
  const i = list.findIndex((x, k) => k > 0 && Buffer.compare(x.name, e.name) > 0);
  list.splice(i < 0 ? list.length : i, 0, e);
  return list;
};

// ---- Project dùng làm nền ----

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect data-mat-uid="el_aaa" x="10" y="10" width="30" height="80" fill="#38bdf8"/>
  <text data-mat-uid="el_bbb" x="50" y="50">--</text>
</svg>
`;

function screenFiles(id, svgFile, bindingFile) {
  return {
    [`screens/${id}.screen.json`]: json({
      schemaVersion: '0.1.0',
      id,
      name: 'Main',
      svgFile,
      viewBox: [0, 0, 100, 100],
      fitMode: 'contain',
      bindingFile,
      elements: [{ elementUid: 'el_aaa' }, { elementUid: 'el_bbb' }],
    }),
    [bindingFile]: json({
      schemaVersion: '0.1.0',
      screenId: id,
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
              target: 'text.content',
              source: { type: 'tag', tagId: 'T.NAME' },
              transform: { kind: 'direct' },
            },
          ],
        },
      ],
    }),
    [svgFile]: SVG,
  };
}

const TAGS = () => ({
  schemaVersion: '0.1.0',
  tags: [
    {
      id: 'T.LEVEL',
      type: 'FLOAT32',
      min: 0,
      max: 100,
      source: { kind: 'mock', signal: 'tank.level' },
    },
    { id: 'T.NAME', type: 'STRING', source: { kind: 'mock', signal: 'x.name' } },
  ],
});

const PROJECT = (over = {}) => ({
  format: 'matscada-project',
  schemaVersion: '0.1.0',
  projectId: 'vector',
  projectName: 'Vector',
  projectVersion: '0.1.0',
  minRuntimeVersion: '0.3.0',
  entryScreen: 'main',
  screens: ['main'],
  tagFile: 'tags.json',
  maxClients: 10,
  ...over,
});

/** Project nhỏ hợp lệ: project.json, tags.json, một màn hình (3 file). */
const base = () => ({
  'project.json': json(PROJECT()),
  'tags.json': json(TAGS()),
  ...screenFiles('main', 'screens/main.svg', 'screens/main.bindings.json'),
});

/** Tên file tiếng Việt và chữ hoa: thứ tự byte UTF-8 khác localeCompare và khác thứ tự UTF-16. */
function vietnamese() {
  const n = (s) => s.normalize('NFC');
  const tagFile = n('Thẻ Tag.json');
  const svgFile = n('màn hình/Tổng quan.svg');
  const bindingFile = n('màn hình/gắn kết.json');
  return {
    'project.json': json(
      PROJECT({
        projectId: 'tram-bom',
        projectName: n('Trạm bơm Ánh Dương'),
        entryScreen: 'tong-quan',
        screens: ['tong-quan'],
        tagFile,
      }),
    ),
    [tagFile]: json(TAGS()),
    ...screenFiles('tong-quan', svgFile, bindingFile),
  };
}

/** Tập file của projects/tank-demo theo data-model §8 (đọc từ đĩa). */
function tankDemo() {
  const dir = resolve(root, 'projects/tank-demo');
  const read = (rel) => readFileSync(join(dir, rel));
  const parse = (rel) => JSON.parse(stripBom(read(rel).toString('utf8')));
  const p = parse('project.json');
  const set = new Set(['project.json', p.tagFile]);
  if (p.loggingFile !== undefined) set.add(p.loggingFile);
  for (const id of p.screens) {
    const s = parse(`screens/${id}.screen.json`);
    set.add(`screens/${id}.screen.json`).add(s.bindingFile).add(s.svgFile);
  }
  return Object.fromEntries([...set].map((rel) => [rel, read(rel)]));
}

/** SVG đúng `size` byte: chèn comment đệm (ký tự `fill` lặp lại) trước `</svg>`. */
function padSvg(size, fill = ' ', svg = SVG) {
  const open = Buffer.from(svg.slice(0, svg.lastIndexOf('</svg>')) + '<!--');
  const close = Buffer.from('--></svg>\n');
  const n = size - open.length - close.length;
  if (n < 0) throw new Error('SVG đệm quá nhỏ');
  return Buffer.concat([open, Buffer.alloc(n, fill), close]);
}

/** Byte giả ngẫu nhiên tất định (SHA-256 theo bộ đếm), đổi sang base64: không có `-` (comment XML). */
function pseudoRandomText(seed, length) {
  const parts = [];
  let total = 0;
  for (let c = 0; total < length; c++) {
    const h = createHash('sha256').update(`${seed}:${c}`).digest();
    parts.push(h);
    total += h.length;
  }
  return Buffer.from(Buffer.concat(parts).toString('base64').slice(0, length));
}

// ---- Danh sách vector ----

const CASES = [];
/** Vector gói; `large`: sinh vào out/, không commit. */
const vector = (name, build, large = false) => CASES.push({ name, build, large });
const ok = (files, opt) => {
  const { pkg, manifest } = pack(files, opt);
  return { pkg, expected: { ok: true, digest: manifest.digest, files: manifest.files } };
};
const fail = (code, path, files, opt) => {
  const { pkg } = pack(files, opt);
  return { pkg, expected: path === undefined ? { code } : { code, path } };
};
const T = 'tags.json';
const MAIN_SVG = 'screens/main.svg';

// Hợp lệ. tank-demo nén và không nén cho cùng digest (cũng bằng digest của tests/project-vectors/valid-tank-demo).
vector('valid-tank-demo-deflate', () => ok(tankDemo(), { method: 'auto' }));
vector('valid-tank-demo-stored', () => ok(tankDemo(), { method: 'stored' }));
vector('valid-vietnamese-names', () => ok(vietnamese()));
// MINOR mới hơn vẫn đọc được; khóa lạ ở cấp đầu, trong project và generator được bỏ qua (§3).
vector('valid-manifest-extensions', () =>
  ok(base(), {
    manifest: (m) => {
      m.formatVersion = '1.1.0';
      m.project.description = 'khóa của bản MINOR sau';
      m.generator.build = 'ci-42';
      m.extensions = { note: 'khóa lạ ở cấp đầu' };
    },
  }),
);

// ZIP bomb.
vector('bomb-ratio', () =>
  // 1 MiB khoảng trắng nén còn khoảng 1 KiB: tỉ lệ khoảng 1000 > 100 (entry > 64 KiB).
  fail('E_PKG_RATIO', MAIN_SVG, { ...base(), [MAIN_SVG]: padSvg(MiB) }, { method: 'deflate' }),
);
vector('bomb-declared-size', () => {
  // Header khai 4096 byte (CRC, manifest khớp 4096 byte đầu) nhưng dữ liệu nén giải ra 1 MiB: bộ đọc phải
  // dừng ngay khi vượt kích thước khai báo, và dòng deflate chưa kết thúc là lỗi định dạng.
  const real = padSvg(MiB);
  const declared = real.subarray(0, 4096);
  return fail(
    'E_PKG_FORMAT',
    MAIN_SVG,
    { ...base(), [MAIN_SVG]: declared },
    {
      entries: (list) => {
        const e = find(list, MAIN_SVG);
        e.method = DEFLATE;
        e.body = deflateRawSync(real, { level: 6 });
        e.csize = e.body.length;
        return list;
      },
    },
  );
});
vector('bomb-overlap', () => fifield());

// Đường dẫn và loại file (§5). Entry lạ có trong manifest, để chỉ luật đường dẫn bị phạm.
const withFile = (path, content = '{}\n') => ({ ...base(), [path]: content });
vector('path-dotdot', () => fail('E_PKG_PATH', '../x.json', withFile('../x.json')));
vector('path-absolute', () => fail('E_PKG_PATH', '/etc/x.json', withFile('/etc/x.json')));
vector('path-backslash', () => fail('E_PKG_PATH', 'a\\b.json', withFile('a\\b.json')));
vector('path-drive', () => fail('E_PKG_PATH', 'C:x.json', withFile('C:x.json')));
vector('path-device-name', () => fail('E_PKG_PATH', 'CON.json', withFile('CON.json')));
vector('path-trailing-dot', () => fail('E_PKG_PATH', 'a./b.json', withFile('a./b.json')));
vector('path-case-duplicate', () =>
  // Sắp theo byte: A.json đứng trước, a.json là bản trùng.
  fail('E_PKG_PATH', 'a.json', { ...withFile('A.json'), 'a.json': '{}\n' }),
);
vector('path-depth-9', () =>
  fail('E_PKG_PATH', 'a/b/c/d/e/f/g/h/i.json', withFile('a/b/c/d/e/f/g/h/i.json')),
);
vector('path-symlink', () =>
  // Symlink kiểu Info-ZIP: host Unix (3), S_IFLNK | 0777 trong 16 bit cao, dữ liệu là đích của link.
  // Thuộc tính symlink hay thư mục cho E_PKG_PATH (tasks T013, contract §9); loại file Unix khác: E_PKG_FORMAT.
  fail('E_PKG_PATH', 'screens/link.svg', withFile('screens/link.svg', '../../../etc/passwd'), {
    method: 'stored',
    entries: (list) => {
      const e = find(list, 'screens/link.svg');
      e.madeBy = (3 << 8) | 20;
      e.attrs = (0o120777 << 16) >>> 0;
      return list;
    },
  }),
);
vector('path-directory', () =>
  // Entry thư mục kiểu Windows: tên kết thúc bằng '/', thuộc tính MS-DOS 0x10, rỗng. Đoạn cuối rỗng (luật 1)
  // được kiểm trước đuôi file (luật 6), nên mã là E_PKG_PATH.
  fail('E_PKG_PATH', 'screens/', withFile('screens/', ''), {
    entries: (list) => {
      find(list, 'screens/').attrs = 0x10;
      return list;
    },
  }),
);
vector('type-js', () =>
  fail('E_PKG_TYPE', 'screens/main.js', withFile('screens/main.js', 'window.__pwned = 1;\n')),
);

// Cấu trúc ZIP (§2): E_PKG_FORMAT.
const editEntry = (path, edit, method) => ({
  methods: method ? { [path]: method } : undefined,
  entries: (list) => {
    edit(find(list, path), list);
    return list;
  },
});
vector('struct-zip64', () =>
  // Bản ghi EOCD ZIP64 + locator trước EOCD; mọi entry có version needed 45 và extra ZIP64 (0x0001) mang
  // kích thước thật. Kích thước trong header vẫn là số thật, để không lẫn với giới hạn kích thước.
  fail('E_PKG_FORMAT', undefined, base(), {
    zip: { zip64: true },
    entries: (list) => {
      for (const e of list) {
        e.versionNeeded = 45;
        e.extra = Buffer.concat([
          le([
            [2, 0x0001],
            [2, 16],
          ]),
          le([
            [8, e.usize],
            [8, e.csize],
          ]),
        ]);
      }
      return list;
    },
  }),
);
vector('struct-encrypted', () =>
  // Chỉ bật cờ mã hóa (bit 0); dữ liệu, CRC vẫn đúng: bộ đọc phải từ chối theo cờ.
  fail(
    'E_PKG_FORMAT',
    T,
    base(),
    editEntry(T, (e) => (e.flags |= 0x0001)),
  ),
);
vector('struct-data-descriptor', () =>
  // Bit 3: header cục bộ ghi CRC và kích thước 0, giá trị thật nằm trong data descriptor sau dữ liệu.
  fail(
    'E_PKG_FORMAT',
    undefined,
    base(),
    editEntry(
      T,
      (e) => {
        e.flags |= 0x0008;
        e.local = { crc: 0, csize: 0, usize: 0 };
        e.after = le([
          [4, SIG.descriptor],
          [4, e.crc],
          [4, e.csize],
          [4, e.usize],
        ]);
      },
      'deflate',
    ),
  ),
);
vector('struct-extra-field', () =>
  // Extra "UT" (0x5455, giờ Unix) như Info-ZIP thêm, ở cả hai header.
  fail(
    'E_PKG_FORMAT',
    'project.json',
    base(),
    editEntry('project.json', (e) => {
      e.extra = Buffer.concat([
        le([
          [2, 0x5455],
          [2, 5],
        ]),
        Buffer.from([1]),
        le([[4, 1760140800]]),
      ]);
    }),
  ),
);
vector('struct-archive-comment', () =>
  fail('E_PKG_FORMAT', undefined, base(), { zip: { comment: Buffer.from('mAT') } }),
);
vector('struct-entry-comment', () =>
  fail(
    'E_PKG_FORMAT',
    'project.json',
    base(),
    editEntry('project.json', (e) => (e.comment = Buffer.from('x'))),
  ),
);
vector('struct-junk-before', () =>
  // Dữ liệu thừa trước entry đầu; mọi offset vẫn trỏ đúng (kiểu file đa định dạng): entry đầu không ở 0.
  fail('E_PKG_FORMAT', undefined, base(), { zip: { before: Buffer.from('JUNK BEFORE ZIP\n') } }),
);
vector('struct-junk-after', () =>
  // EOCD không còn nằm ở 22 byte cuối.
  fail('E_PKG_FORMAT', undefined, base(), { zip: { after: Buffer.from('JUNK AFTER EOCD\n') } }),
);
vector('struct-gap', () =>
  // Khoảng trống 8 byte giữa hai entry (offset trong central directory vẫn đúng).
  fail(
    'E_PKG_FORMAT',
    undefined,
    base(),
    editEntry(MAIN_SVG, (e) => (e.after = Buffer.alloc(8))),
  ),
);
// Header cục bộ khác central directory (mỗi vector lệch một trường).
vector('struct-local-name', () =>
  fail(
    'E_PKG_FORMAT',
    T,
    base(),
    editEntry(T, (e) => (e.local = { name: Buffer.from('tagz.json') })),
  ),
);
vector('struct-local-method', () =>
  fail(
    'E_PKG_FORMAT',
    T,
    base(),
    editEntry(T, (e) => (e.local = { method: STORED }), 'deflate'),
  ),
);
vector('struct-local-crc', () =>
  fail(
    'E_PKG_FORMAT',
    T,
    base(),
    editEntry(T, (e) => (e.local = { crc: (e.crc ^ 1) >>> 0 })),
  ),
);
vector('struct-local-size', () =>
  fail(
    'E_PKG_FORMAT',
    T,
    base(),
    editEntry(T, (e) => (e.local = { usize: e.usize + 1 })),
  ),
);
vector('struct-version-needed', () =>
  fail(
    'E_PKG_FORMAT',
    T,
    base(),
    editEntry(T, (e) => (e.versionNeeded = 45)),
  ),
);
vector('struct-method', () =>
  // Phương thức 12 (bzip2) với dữ liệu không nén: bộ đọc phải từ chối theo phương thức.
  fail(
    'E_PKG_FORMAT',
    T,
    base(),
    editEntry(T, (e) => (e.method = 12), 'stored'),
  ),
);
vector('struct-deflate-corrupt', () =>
  // Block deflate kiểu 11 (dành riêng): dữ liệu deflate hỏng.
  fail(
    'E_PKG_FORMAT',
    T,
    base(),
    editEntry(
      T,
      (e) => {
        e.body = Buffer.from(e.body);
        e.body[0] |= 0x06;
      },
      'deflate',
    ),
  ),
);
vector('struct-deflate-trailing', () =>
  // Dòng deflate kết thúc trước khi hết dữ liệu nén khai báo (4 byte thừa).
  fail(
    'E_PKG_FORMAT',
    T,
    base(),
    editEntry(
      T,
      (e) => {
        e.body = Buffer.concat([e.body, Buffer.from('JUNK')]);
        e.csize = e.body.length;
      },
      'deflate',
    ),
  ),
);

// Nội dung (§3–§6).
vector('content-crc', () =>
  fail(
    'E_PKG_CHECKSUM',
    T,
    base(),
    editEntry(T, (e) => (e.crc = (e.crc ^ 0xffffffff) >>> 0)),
  ),
);
const editListed = (path, edit) => (m) => {
  edit(m.files.find((f) => f.path === path));
  m.digest = digestOf(m.files);
};
vector('content-sha256', () =>
  fail('E_PKG_CHECKSUM', T, base(), {
    manifest: editListed(T, (f) => (f.sha256 = sha256(Buffer.from('khác')))),
  }),
);
vector('content-size', () =>
  fail('E_PKG_CHECKSUM', T, base(), { manifest: editListed(T, (f) => (f.size += 1)) }),
);
vector('content-unlisted', () =>
  fail('E_PKG_UNLISTED', 'extra.json', base(), {
    entries: (list) => insertSorted(list, entry('extra.json', '{}\n')),
  }),
);
vector('content-missing', () =>
  fail('E_PKG_MISSING', MAIN_SVG, base(), {
    entries: (list) => list.filter((e) => e.name.toString('utf8') !== MAIN_SVG),
  }),
);
vector('content-digest', () =>
  fail('E_PKG_DIGEST', undefined, base(), {
    manifest: (m) => (m.digest = digestOf(m.files.slice(1))),
  }),
);
vector('content-identity', () =>
  fail('E_PKG_IDENTITY', undefined, base(), {
    manifest: (m) => (m.project.projectId = 'other-project'),
  }),
);
vector('content-format-version', () =>
  fail('E_PKG_FORMAT_VERSION', undefined, base(), {
    manifest: (m) => (m.formatVersion = '2.0.0'),
  }),
);
// Các vector bí mật nén deflate để gói không chứa nguyên văn chuỗi giống bí mật (công cụ quét bí mật của
// kho mã); bộ kiểm tra tìm sau khi giải nén.
vector('secret-password-key', () => {
  const tags = TAGS();
  tags.tags[0].source.password = 'not-a-real-password';
  return fail('E_PKG_SECRET', T, { ...base(), [T]: json(tags) }, { methods: { [T]: 'deflate' } });
});
// Ghép chuỗi để file nguồn này không chứa nguyên văn một khối khóa riêng PEM (công cụ quét bí mật).
const PEM = [
  '-----BEGIN ',
  'EC PRIVATE KEY-----',
  '\nTUFULVRFU1QtTk9ULUEtUkVBTC1LRVk=\n',
  '-----END ',
]
  .concat('EC PRIVATE KEY-----')
  .join('');
vector('secret-pem-svg', () =>
  fail(
    'E_PKG_SECRET',
    MAIN_SVG,
    { ...base(), [MAIN_SVG]: SVG.replace('</svg>', `<!-- ${PEM} -->\n</svg>`) },
    { methods: { [MAIN_SVG]: 'deflate' } },
  ),
);
vector('secret-url-credentials', () =>
  fail(
    'E_PKG_SECRET',
    'logging.json',
    {
      ...base(),
      'project.json': json(PROJECT({ loggingFile: 'logging.json' })),
      'logging.json': json({
        schemaVersion: '0.1.0',
        groups: [
          {
            id: 'fast',
            name: 'Fast',
            mode: 'cyclic',
            periodMs: 1000,
            retentionDays: 7,
            destinations: ['in1'],
            tags: [{ tagId: 'T.LEVEL' }],
          },
        ],
        connections: [
          {
            id: 'in1',
            type: 'influxdb',
            url: 'https://writer:not-a-real-password@influx.local:8086',
            org: 'atpro',
            bucket: 'scada',
          },
        ],
      }),
    },
    { methods: { 'logging.json': 'deflate' } },
  ),
);

// Manifest (§3, §6): E_PKG_MANIFEST.
vector('manifest-absent', () =>
  fail('E_PKG_MANIFEST', undefined, base(), { entries: (list) => list.slice(1) }),
);
vector('manifest-bad-json', () =>
  fail('E_PKG_MANIFEST', undefined, base(), {
    manifestBytes: (m) => Buffer.from(json(m).slice(0, -10), 'utf8'),
  }),
);
vector('manifest-bom', () =>
  fail('E_PKG_MANIFEST', undefined, base(), {
    manifestBytes: (m) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json(m))]),
  }),
);
vector('manifest-missing-digest', () =>
  fail('E_PKG_MANIFEST', undefined, base(), { manifest: (m) => delete m.digest }),
);
vector('manifest-file-extra-key', () =>
  fail('E_PKG_MANIFEST', undefined, base(), { manifest: (m) => (m.files[0].mode = 420) }),
);
vector('manifest-unsorted', () =>
  fail('E_PKG_MANIFEST', undefined, base(), { manifest: (m) => m.files.reverse() }),
);

// Kích thước (§2, §6): sinh vào out/, không commit.
vector(
  'size-too-large',
  () => {
    // Gói hợp lệ đúng 52.428.801 byte: 11 SVG stored khoảng 4,77 MB (mỗi file ≤ 5 MiB, tổng < 200 MiB).
    const TARGET = 50 * MiB + 1;
    let extra = 0;
    for (let round = 0; round < 8; round++) {
      const files = base();
      for (let i = 1; i <= 11; i++) {
        const size = 4_765_000 + (i === 11 ? extra : 0);
        files[`screens/pad-${String(i).padStart(2, '0')}.svg`] = padSvg(size);
      }
      const { pkg } = pack(files, { method: 'stored' });
      if (pkg.length === TARGET) return { pkg, expected: { code: 'E_PKG_TOO_LARGE' } };
      extra += TARGET - pkg.length;
    }
    throw new Error('size-too-large: không đạt đúng kích thước');
  },
  true,
);
const fillers = (files, n) => {
  for (let i = 1; i <= n; i++) files[`d/${String(i).padStart(4, '0')}.json`] = '{}\n';
  return files;
};
// manifest + 5 file của project + 1019 file = 1025 entry (manifest liệt kê 1024 > 1023, nhưng EOCD kiểm trước).
vector('size-entries-1025', () => fail('E_PKG_ENTRIES', undefined, fillers(base(), 1019)), true);
// Biên còn hợp lệ: đúng 1024 entry (manifest + 1023 file).
vector(
  'valid-entries-1024',
  () => {
    const r = ok(fillers(base(), 1018));
    delete r.expected.files; // 1023 mục: chỉ giữ digest
    return r;
  },
  true,
);
vector(
  'size-json-over-1mib',
  () => {
    const t = json(TAGS());
    const padded = t + ' '.repeat(MiB + 1 - Buffer.byteLength(t));
    return fail('E_PKG_SIZE', T, { ...base(), [T]: padded }, { method: 'stored' });
  },
  true,
);
vector(
  'size-svg-over-5mib',
  () =>
    fail(
      'E_PKG_SIZE',
      MAIN_SVG,
      { ...base(), [MAIN_SVG]: padSvg(5 * MiB + 1) },
      { method: 'stored' },
    ),
  true,
);
vector(
  'bomb-total-size',
  () => {
    // 40 SVG, mỗi file đúng 5 MiB, tỉ lệ nén khoảng 85 (≤ 100): tổng sau giải nén > 200 MiB, gói khoảng 2,5 MB.
    // Nội dung: một khối base64 giả ngẫu nhiên lặp lại ở khoảng cách < 32 KiB (cửa sổ deflate).
    const block = pseudoRandomText('bomb-total-size', 30000);
    const big = padSvg(5 * MiB, block);
    const body = deflateRawSync(big, { level: 6 });
    const ratio = big.length / body.length;
    if (!(ratio > 20 && ratio <= 100)) throw new Error(`bomb-total-size: tỉ lệ ${ratio}`);
    const files = base();
    const names = [];
    for (let i = 1; i <= 40; i++) {
      const name = `screens/big-${String(i).padStart(2, '0')}.svg`;
      files[name] = big;
      names.push(name);
    }
    return fail('E_PKG_SIZE', undefined, files, {
      methods: Object.fromEntries(names.map((n) => [n, 'stored'])),
      entries: (list) => {
        // Cùng nội dung: dùng lại một bản nén thay vì nén 40 lần.
        for (const n of names)
          Object.assign(find(list, n), { method: DEFLATE, body, csize: body.length });
        return list;
      },
    });
  },
  true,
);

/**
 * Zip bomb không đệ quy kiểu Fifield ("A better zip bomb", 2019), chồng lấn có trích dẫn: dữ liệu nén của
 * o1 bắt đầu bằng một block deflate stored chứa nguyên văn header cục bộ của o2, rồi tới dữ liệu của o2
 * (trích header của o3), rồi nhân chung. Mỗi entry có header riêng, tên, CRC, kích thước khớp central
 * directory; chỉ luật "entry liền nhau, không chồng" bắt được.
 */
function fifield() {
  const names = ['screens/o1.svg', 'screens/o2.svg', 'screens/o3.svg'];
  const kernelOut = padSvg(2 * KiB);
  let content = kernelOut;
  let body = deflateRawSync(kernelOut, { level: 9 });
  const made = [];
  for (let k = names.length - 1; k >= 0; k--) {
    const e = entry(names[k], content, 'stored');
    Object.assign(e, { method: DEFLATE, body, csize: body.length });
    if (!inflateRawSync(body).equals(content)) throw new Error('fifield: dữ liệu nén sai');
    made.unshift({ e, content });
    if (k > 0) {
      const hdr = localHeader(e);
      const quote = Buffer.concat([
        Buffer.from([0x00]), // BFINAL 0, BTYPE 00 (stored), đệm tới hết byte
        le([
          [2, hdr.length],
          [2, ~hdr.length & 0xffff],
        ]),
      ]);
      content = Buffer.concat([hdr, content]);
      body = Buffer.concat([quote, hdr, body]);
    }
  }
  const files = base();
  for (const { e, content: c } of made) files[e.name.toString('utf8')] = c;
  return fail('E_PKG_FORMAT', undefined, files, {
    entries: (list) => {
      const first = list.findIndex((x) => x.name.toString('utf8') === names[0]);
      let delta = 0;
      made.forEach(({ e }, k) => {
        if (k > 0) e.overlay = { of: first, delta };
        delta += localHeader(e).length + 5; // header của entry này + header block stored trích nó
        list[first + k] = e;
      });
      return list;
    },
  });
}

// ---- Vector digest (contract §4), dùng cho cả TS ----

function digestVector(contents, expectDigest) {
  const files = contents.map(([p, text]) => fileEntry(p, Buffer.from(text, 'utf8')));
  const digest = digestOf(files);
  if (expectDigest && digest !== expectDigest)
    throw new Error(`digest-basic: ${digest} khác contract ${expectDigest}`);
  return { digest, text: digestText(files), files, contents: Object.fromEntries(contents) };
}
const DIGESTS = {
  'digest-basic': () =>
    digestVector(
      [
        ['project.json', '{"projectId":"demo"}\n'],
        ['screens/main.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n'],
        ['tags.json', '{"schemaVersion":"0.1.0","tags":[]}\n'],
      ],
      'sha256:c337083b40dd7b12f8db0ace06bfb5fb8bb682931ef795cbf030dfcd0e14e119',
    ),
  // `files` cố ý không theo thứ tự. Thứ tự byte UTF-8 đúng: Z.json, "a b.json", a-b.json, a.json, a/b.json,
  // screens/10.svg, screens/9.svg, screens/z.svg, screens/ơ.svg, screens/ｆ.svg (U+FF46), screens/😀.svg
  // (U+1F600). localeCompare đặt a.json trước Z.json; thứ tự đơn vị UTF-16 đặt 😀 trước ｆ; sắp theo từng
  // đoạn đường dẫn đặt a/b.json trước a.json.
  'digest-order': () =>
    digestVector([
      ['a/b.json', '{"b":"ệ"}\n'],
      ['a.json', '{}\n'],
      ['screens/😀.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n'],
      ['screens/ｆ.svg', '<svg xmlns="http://www.w3.org/2000/svg"><text>ｆ</text></svg>\n'],
      ['screens/ơ.svg', '<svg xmlns="http://www.w3.org/2000/svg"><text>ơ</text></svg>\n'],
      ['screens/z.svg', '<svg xmlns="http://www.w3.org/2000/svg"><text>z</text></svg>\n'],
      ['screens/9.svg', '<svg xmlns="http://www.w3.org/2000/svg"><text>9</text></svg>\n'],
      ['screens/10.svg', '<svg xmlns="http://www.w3.org/2000/svg"><text>10</text></svg>\n'],
      ['a-b.json', '[]\n'],
      ['a b.json', ''],
      ['Z.json', '{"z":"Ž"}\n'],
    ]),
};

// ---- Ghi ----

const names = [...CASES.map((c) => c.name), ...Object.keys(DIGESTS)];
if (new Set(names).size !== names.length) throw new Error('tên vector trùng');
rmSync(join(here, OUT), { recursive: true, force: true });
mkdirSync(join(here, OUT), { recursive: true });

const writeExpected = (name, expected) => {
  const dir = join(here, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'expected.json'), json(expected));
  return dir;
};

let committed = 0;
let generated = 0;
for (const c of CASES) {
  if (onlyOut && !c.large) continue;
  const { pkg, expected } = c.build();
  if (pkg.includes('PRIVATE KEY') || pkg.includes('not-a-real-password'))
    throw new Error(`${c.name}: gói chứa nguyên văn chuỗi giống bí mật`);
  if (c.large) {
    const rel = `${OUT}/${c.name}.matscada`;
    writeFileSync(join(here, rel), pkg);
    if (!onlyOut) writeExpected(c.name, { ...expected, generated: rel });
    generated++;
  } else {
    writeFileSync(join(writeExpected(c.name, expected), 'package.matscada'), pkg);
    committed++;
  }
}
if (!onlyOut)
  for (const [name, make] of Object.entries(DIGESTS)) {
    writeExpected(name, make());
    committed++;
  }

const others = readdirSync(here, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== OUT && !names.includes(d.name))
  .map((d) => d.name);
console.log(
  `${committed} vector trong ${here}, ${generated} gói lớn trong ${OUT}/` +
    (others.length ? `; giữ nguyên: ${others.join(', ')}` : ''),
);
