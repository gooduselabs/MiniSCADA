// Kiểm tài liệu Markdown (feature 011, T177; FR-130, SC-038).
//
//   node tools/docs-check.mjs              kiểm cả repo; mã thoát 0 sạch, 1 có lỗi, 2 dùng sai
//   node tools/docs-check.mjs --json       in kết quả JSON
//   node tools/docs-check.mjs --root <dir> kiểm một cây khác (test dùng thư mục mẫu)
//
// Phạm vi và luật:
//   1. Liên kết (LINK, ANCHOR): mọi `docs/**/*.md`, `specs/**/*.md`, `README.md`. Liên kết Markdown tương đối
//      `[x](đường/dẫn#neo)` và định nghĩa `[x]: đường/dẫn` phải trỏ tới tệp hoặc thư mục có thật; neo `#…` trỏ tới
//      tệp `.md` phải có tiêu đề (cách đặt neo của GitHub) hoặc `<a id="…">` tương ứng. Bỏ qua `http:`, `https:`,
//      `mailto:` và nội dung trong khối mã, mã nội dòng.
//   2. Chỉ ở tài liệu người dùng (USER_SCOPE dưới đây; ADR, báo cáo, bàn giao và spec là hồ sơ lịch sử, có thể nhắc
//      cờ hay tệp đã bỏ hoặc chưa làm):
//      - FILE: mã nội dòng dạng đường dẫn repo có đuôi tệp (`tools/x.mjs`) hoặc kết thúc bằng `/` (thư mục,
//        `projects/training-demo/`) phải tồn tại; dạng không đuôi (`projects/active`) thường là tên API nên bỏ qua.
//      - CLI: trong khối mã và mã nội dòng, mỗi lệnh `mat-runtime …` chỉ dùng cờ `--…` mà runtime thật có (quét chuỗi
//        `"--…"` trong `server/` như chính bộ phân tích tham số của runtime; runtime không có `--help`); script
//        `*.ps1` chỉ dùng tham số có trong khối `param(…)` của script; script `*.sh` chỉ dùng cờ `--…` có trong
//        nội dung script; script phải có trong repo.
//      - CODE: mã lỗi trong mã nội dòng phải có trong `schemas/error-codes.json`: mọi `E_…`, `W_…`, và mã viết hoa
//        có gạch dưới đứng ngay sau mã HTTP (`403 \`HTTPS_REQUIRED\``) hoặc sau chữ "mã", "lỗi", "cảnh báo".
//      - HEADING: hai tiêu đề cùng neo trong một tệp (liên kết `#neo` sẽ mơ hồ).
//   Cờ, script, tệp và mã lỗi đã có trong contract nhưng chưa làm (các nhánh khác của 011) ghi ở
//   `tools/docs-check.cli.json` mục `planned` kèm task; tài liệu nhắc chúng phải ghi rõ "(có từ bản 1.0)".
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Thư mục (tính từ gốc) chứa tài liệu dành cho người dùng: áp đủ luật. */
export const USER_SCOPE = [
  'docs/user',
  'docs/training',
  'docs/pilot',
  'docs/deployment',
  'docs/guides',
  'docs/release',
];
const LINK_SCOPE = ['docs', 'specs'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'build',
  'dist',
  'out',
  'third_party',
  'docs-check-fixtures',
]);
/** Thư mục chỉ bỏ khi nằm ngay dưới gốc repo: `release/<ver>/` là đầu ra của release.ps1 (không commit), còn
 * `tools/release/` và `docs/release/` là mã và tài liệu. */
const SKIP_TOP_DIRS = new Set(['release']);
const TOP_DIRS =
  'apps|packages|server|core|drivers|tools|deployment|docs|specs|schemas|projects|tests|svg|third_party';
const PATH_RE = new RegExp(`^(?:${TOP_DIRS})/[^\\s<>{}*…|]+$`);
const PS_COMMON = new Set(
  [
    'Verbose',
    'Debug',
    'ErrorAction',
    'WarningAction',
    'InformationAction',
    'ErrorVariable',
    'OutVariable',
    'WhatIf',
    'Confirm',
  ].map((s) => s.toLowerCase()),
);

const toPosix = (p) => p.split(sep).join('/');

function walk(dir, pred, out = [], top = null) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(n) || n.startsWith('.')) continue;
    if (dir === top && SKIP_TOP_DIRS.has(n)) continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, pred, out, top);
    else if (pred(p)) out.push(p);
  }
  return out;
}

/** Neo kiểu GitHub: chữ thường, bỏ dấu câu (giữ chữ, số, `-`, `_`, khoảng trắng), khoảng trắng thành `-`. */
export function slugify(text) {
  return text
    .replace(/`/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Tách tệp thành dòng có cờ "trong khối mã"; trả cả danh sách khối mã (dòng đầu, các dòng). */
function splitMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const prose = []; // { n, text } ngoài khối mã
  const blocks = []; // { n, lines: [{ n, text }] }
  let fence = null;
  let cur = null;
  lines.forEach((line, i) => {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) {
        fence = null;
        blocks.push(cur);
        cur = null;
      } else cur.lines.push({ n: i + 1, text: line });
      return;
    }
    if (m) {
      fence = m[1];
      cur = { n: i + 1, lines: [] };
      return;
    }
    prose.push({ n: i + 1, text: line });
  });
  if (cur) blocks.push(cur);
  return { prose, blocks };
}

const inlineSpans = (line) => [...line.matchAll(/(`+)([^`]+?)\1/g)].map((m) => m[2].trim());
const stripInline = (line) => line.replace(/(`+)[^`]+?\1/g, '');

/** Neo của một tệp Markdown và các neo trùng. */
export function anchorsOf(text) {
  const { prose } = splitMarkdown(text);
  const seen = new Map();
  const anchors = new Set();
  const duplicates = [];
  for (const { n, text: line } of prose) {
    for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(m[1]);
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h) continue;
    const base = slugify(h[2]);
    const count = seen.get(base) ?? 0;
    if (count > 0) duplicates.push({ n, heading: h[2], slug: base });
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return { anchors, duplicates };
}

/** Cờ `--…` của mat-runtime: chuỗi trong nháy kép ở mã C++ của `server/` (bỏ test và bản thử poc). */
export function runtimeFlags(root) {
  const files = walk(join(root, 'server'), (p) => /\.(cpp|hpp|h)$/.test(p)).filter((p) => {
    const r = toPosix(relative(root, p));
    return !/\/(tests?|poc[^/]*)\//.test(r) && !/_test\.cpp$/.test(r);
  });
  const flags = new Set();
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/"(--[a-z][a-z0-9-]*)/g)) flags.add(m[1]);
  }
  return flags;
}

/** Tham số của một script PowerShell: tên biến trong khối `param(…)` đầu tiên. */
export function psParams(text) {
  const start = text.search(/\bparam\s*\(/i);
  if (start < 0) return new Set();
  let i = text.indexOf('(', start);
  let depth = 0;
  let end = i;
  for (; end < text.length; end++) {
    if (text[end] === '(') depth++;
    else if (text[end] === ')' && --depth === 0) break;
  }
  const body = text.slice(i, end);
  return new Set([...body.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1].toLowerCase()));
}

function tokenize(s) {
  const out = [];
  for (const m of s.matchAll(/"[^"]*"|'[^']*'|\S+/g)) out.push(m[0]);
  return out;
}

/** Các lệnh trong một dòng mã: tách theo `|`, `;`, `&&`, `||`, `$(`, sau khi bỏ chú thích. */
function segmentsOf(line) {
  const noComment = line.replace(/(^|\s)#.*$/, '');
  return noComment
    .split(/\|\||&&|\||;|\$\(|\)/)
    .map((s) => tokenize(s.trim()))
    .filter((t) => t.length > 0);
}

const clean = (tok) => tok.replace(/^["'[(]+|["'\]),]+$/g, '');
const SERVICE_WORDS = new Set([
  'systemctl',
  'journalctl',
  'pidof',
  'pgrep',
  'cd',
  'ls',
  'rm',
  'mkdir',
  'cat',
  '-u',
  '-p',
]);

/** Thông tin đối chiếu lệnh: cờ runtime, script trong repo, mục kế hoạch. */
export function loadCliInfo(root) {
  const cfgPath = join(root, 'tools/docs-check.cli.json');
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const planned = cfg.planned ?? {};
  const flags = runtimeFlags(root);
  for (const f of Object.keys(planned.runtimeFlags ?? {})) flags.add(f);
  const scripts = new Map(); // basename -> [relpath]
  for (const p of walk(root, (x) => /\.(ps1|sh)$/.test(x), [], root)) {
    const r = toPosix(relative(root, p));
    const b = basename(p);
    if (!scripts.has(b)) scripts.set(b, []);
    scripts.get(b).push(r);
  }
  return {
    flags,
    scripts,
    plannedScripts: planned.scripts ?? {},
    plannedFiles: new Set(Object.keys(planned.files ?? {})),
    plannedCodes: new Set(Object.keys(planned.codes ?? {})),
    extraCommands: planned.commands ?? {},
  };
}

function scriptParamsOf(root, info, name) {
  const b = basename(name.replace(/\\/g, '/'));
  const direct = name.includes('/') ? clean(name).replace(/^\.\//, '') : null;
  const candidates =
    direct && existsSync(join(root, direct)) ? [direct] : (info.scripts.get(b) ?? []);
  if (candidates.length > 0) {
    const text = readFileSync(join(root, candidates[0]), 'utf8');
    return {
      kind: b.endsWith('.ps1') ? 'ps1' : 'sh',
      text,
      params: psParams(text),
      path: candidates[0],
    };
  }
  if (info.plannedScripts[b]) {
    const params = new Set(
      (info.plannedScripts[b].params ?? []).map((p) => p.replace(/^-+/, '').toLowerCase()),
    );
    return {
      kind: b.endsWith('.ps1') ? 'ps1' : 'sh',
      text: '',
      params,
      planned: true,
      flags: params,
    };
  }
  return null;
}

/** Kiểm các lệnh của một dòng mã (đã nối dòng tiếp). */
function checkCommandLine(root, info, text, report) {
  let prevRuntime = false;
  for (const toks of segmentsOf(text)) {
    if (SERVICE_WORDS.has(clean(toks[0]))) {
      prevRuntime = false;
      continue;
    }
    let idx = -1;
    let kind = null;
    for (let i = 0; i < toks.length; i++) {
      const t = clean(toks[i]);
      const b = basename(t.replace(/\\/g, '/'));
      if (b === 'mat-runtime' && !SERVICE_WORDS.has(clean(toks[i - 1] ?? ''))) {
        idx = i;
        kind = 'runtime';
        break;
      }
      if (info.extraCommands[b]) {
        idx = i;
        kind = b;
        break;
      }
      if (/\.(ps1|sh)$/.test(b) && /^[\w./\\-]+$/.test(t)) {
        idx = i;
        kind = 'script';
        break;
      }
    }
    if (idx < 0 && prevRuntime && /^--/.test(toks[0])) {
      idx = -1;
      kind = 'runtime';
    } else if (idx < 0) {
      prevRuntime = false;
      continue;
    }
    const args = toks.slice(idx + 1).map(clean);
    if (kind === 'runtime') {
      prevRuntime = true;
      for (const a of args) {
        const m = /^(--[a-z][a-z0-9-]*)/.exec(a);
        if (m && !info.flags.has(m[1])) report('CLI', `mat-runtime không có cờ ${m[1]}`);
      }
      continue;
    }
    prevRuntime = false;
    if (kind !== 'script') {
      const allowed = new Set(info.extraCommands[kind].flags ?? []);
      for (const a of args) {
        const m = /^(--[a-z][a-z0-9-]*)/.exec(a);
        if (m && !allowed.has(m[1])) report('CLI', `${kind} không có cờ ${m[1]}`);
      }
      continue;
    }
    const name = clean(toks[idx]);
    const s = scriptParamsOf(root, info, name);
    if (!s) {
      report('CLI', `script ${name} không có trong repo`);
      continue;
    }
    for (const a of args) {
      if (s.kind === 'ps1') {
        const m = /^-([A-Za-z][A-Za-z0-9]*)(?::.*)?$/.exec(a);
        if (m && !s.params.has(m[1].toLowerCase()) && !PS_COMMON.has(m[1].toLowerCase()))
          report('CLI', `${name} không có tham số -${m[1]}`);
      } else {
        const m = /^(--[a-z][a-z0-9-]*)/.exec(a);
        if (!m) continue;
        const ok = s.planned ? s.flags.has(m[1].slice(2)) : s.text.includes(m[1]);
        if (!ok) report('CLI', `${name} không có cờ ${m[1]}`);
      }
    }
  }
}

function joinContinuations(lines) {
  const out = [];
  let buf = null;
  for (const l of lines) {
    const t = l.text;
    const cont = /(\\|`)\s*$/.test(t);
    const piece = cont ? t.replace(/(\\|`)\s*$/, ' ') : t;
    if (buf) buf.text += piece;
    else buf = { n: l.n, text: piece };
    if (!cont) {
      out.push(buf);
      buf = null;
    }
  }
  if (buf) out.push(buf);
  return out;
}

const looksLikeCommand = (s) => /(^|[\s/])mat-runtime(\s|$)|\.(ps1|sh)(\s|$)/.test(s);

/** Kiểm cả cây; trả danh sách phát hiện { file, line, kind, message }. */
export function checkTree(root = repoRoot) {
  root = resolve(root);
  const findings = [];
  const mdFiles = [
    ...LINK_SCOPE.flatMap((d) => walk(join(root, d), (p) => p.endsWith('.md'))),
    ...(existsSync(join(root, 'README.md')) ? [join(root, 'README.md')] : []),
  ];
  const anchorCache = new Map();
  const anchorsFor = (p) => {
    if (!anchorCache.has(p)) anchorCache.set(p, anchorsOf(readFileSync(p, 'utf8')));
    return anchorCache.get(p);
  };
  const catalogPath = join(root, 'schemas/error-codes.json');
  const codes = existsSync(catalogPath)
    ? new Set(JSON.parse(readFileSync(catalogPath, 'utf8')).codes.map((c) => c.code))
    : new Set();
  const info = loadCliInfo(root);

  for (const file of mdFiles) {
    const rel = toPosix(relative(root, file));
    const userDoc = USER_SCOPE.some((d) => rel === d || rel.startsWith(`${d}/`));
    const text = readFileSync(file, 'utf8');
    const { prose, blocks } = splitMarkdown(text);
    const add = (line, kind, message) => findings.push({ file: rel, line, kind, message });

    for (const { n, text: raw } of prose) {
      const line = stripInline(raw);
      const targets = [
        ...[...line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map(
          (m) => m[1],
        ),
        ...[...line.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/g)].map((m) => m[1]),
      ];
      for (const target of targets) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        const [pathPart, anchor] = target.split('#');
        let decoded = pathPart;
        try {
          decoded = decodeURIComponent(pathPart.split('?')[0]);
        } catch {
          // giữ nguyên
        }
        const dest =
          decoded === ''
            ? file
            : decoded.startsWith('/')
              ? join(root, decoded)
              : resolve(dirname(file), decoded);
        if (!existsSync(dest)) {
          add(n, 'LINK', `liên kết hỏng: ${target}`);
          continue;
        }
        if (
          anchor !== undefined &&
          anchor !== '' &&
          dest.endsWith('.md') &&
          statSync(dest).isFile()
        ) {
          let a = anchor;
          try {
            a = decodeURIComponent(anchor);
          } catch {
            // giữ nguyên
          }
          if (!anchorsFor(dest).anchors.has(a.toLowerCase()) && !anchorsFor(dest).anchors.has(a))
            add(
              n,
              'ANCHOR',
              `không có tiêu đề cho neo #${anchor} trong ${toPosix(relative(root, dest))}`,
            );
        }
      }
    }
    if (!userDoc) continue;

    for (const d of anchorsFor(file).duplicates)
      add(d.n, 'HEADING', `tiêu đề lặp: "${d.heading}" (#${d.slug})`);

    for (const { n, text: raw } of prose) {
      for (const span of inlineSpans(raw)) {
        const p = span.replace(/:\d+(-\d+)?$/, '');
        if (
          PATH_RE.test(p) &&
          (p.endsWith('/') || /\.[A-Za-z0-9]+$/.test(p)) &&
          !info.plannedFiles.has(p) &&
          !p.includes('...') &&
          !existsSync(join(root, p))
        )
          add(n, 'FILE', `tệp không có: ${p}`);
        if (looksLikeCommand(span)) checkCommandLine(root, info, span, (k, m) => add(n, k, m));
      }
      const re =
        /(?:\b([1-5]\d\d)\s+|\b(?:mã|lỗi|cảnh báo)\s+)?`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/gu;
      for (const m of raw.matchAll(re)) {
        const code = m[2];
        const strict = /^[EW]_/.test(code);
        const context = m[0] !== `\`${code}\``;
        if ((strict || context) && !codes.has(code) && !info.plannedCodes.has(code))
          add(n, 'CODE', `mã ${code} không có trong schemas/error-codes.json`);
      }
    }
    for (const b of blocks) {
      for (const l of joinContinuations(b.lines)) {
        if (looksLikeCommand(l.text))
          checkCommandLine(root, info, l.text, (k, m) => add(l.n, k, m));
      }
    }
  }
  return { files: mdFiles.length, findings };
}

function main(argv) {
  let root = repoRoot;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    else if (argv[i] === '--root' && argv[i + 1]) root = argv[++i];
    else {
      console.error('Dùng: node tools/docs-check.mjs [--root <thư mục>] [--json]');
      return 2;
    }
  }
  const { files, findings } = checkTree(root);
  if (json) console.log(JSON.stringify({ files, findings }, null, 2));
  else {
    for (const f of findings) console.log(`${f.file}:${f.line}: [${f.kind}] ${f.message}`);
    console.log(
      findings.length === 0
        ? `docs-check: ${files} tệp, không có lỗi`
        : `docs-check: ${files} tệp, ${findings.length} lỗi`,
    );
  }
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
