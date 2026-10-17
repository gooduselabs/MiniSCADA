// Dựng tài liệu HTML tĩnh đi kèm bộ cài (feature 011, T178; FR-133).
//
//   node tools/build-docs.mjs                  docs/{user,training,guides}/**/*.md → release/docs/**/*.html
//   node tools/build-docs.mjs --out <thư mục>  ghi vào thư mục khác
//
// Không phụ thuộc mới: workspace không có `marked` (package-lock.json), nên dùng bộ chuyển tối giản dưới đây, đủ cho
// tập Markdown mà tài liệu người dùng đang dùng: tiêu đề (neo theo cách của GitHub, giống tools/docs-check.mjs), đoạn,
// danh sách lồng (có số, không số, ô đánh dấu), bảng GFM, khối mã, trích dẫn, đường kẻ, mã nội dòng, đậm, nghiêng,
// liên kết, ảnh, `<a id>`, `<br>`. HTML khác trong Markdown bị thoát (hiện dạng chữ), không chạy.
//
// Tài liệu đi kèm bộ cài phải đọc được khi không có mạng và không dẫn ra ngoài:
//   - liên kết `.md` trong tập dựng đổi thành `.html` (giữ neo); liên kết tới tệp ngoài tập (mã nguồn, spec) và
//     liên kết `http(s):` hiện thành chữ kèm địa chỉ, không có `href`;
//   - ảnh nội bộ nhúng thẳng (`data:` URI); ảnh ngoài bị bỏ, hiện chữ thay thế;
//   - CSS nhúng trong từng trang, không phông hay script ngoài.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { slugify } from './docs-check.mjs';

/** CSP của mọi trang dựng ra: chỉ CSS nhúng và ảnh data:. */
export const DOCS_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// docs/deployment không đi kèm bộ cài: đó là tài liệu nội bộ của đội (máy dev, thiết bị lab); admin-guide đủ cho khách.
export const SOURCES = ['docs/user', 'docs/training', 'docs/guides'];
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const toPosix = (p) => p.split(sep).join('/');
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
:root{color-scheme:light dark;--fg:#1d2329;--bg:#fff;--muted:#5b6670;--line:#d5dbe0;--code:#f3f5f7;--link:#0b5cad}
@media (prefers-color-scheme:dark){:root{--fg:#e3e7ea;--bg:#15191d;--muted:#9aa5ae;--line:#38424b;--code:#20262c;--link:#7ab8ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 "Segoe UI",Roboto,Arial,sans-serif}
main{max-width:920px;margin:0 auto;padding:16px 20px 64px}
nav.top{font-size:14px;color:var(--muted);border-bottom:1px solid var(--line);padding:8px 20px}
a{color:var(--link)}h1,h2,h3,h4{line-height:1.25;margin:1.6em 0 .5em}h1{margin-top:.6em}
code{background:var(--code);padding:1px 4px;border-radius:3px;font:14px Consolas,"Cascadia Mono",monospace}
pre{background:var(--code);padding:10px 12px;overflow-x:auto;border-radius:4px}pre code{padding:0;background:none}
table{border-collapse:collapse;margin:12px 0;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:5px 8px;vertical-align:top;text-align:left}
th{background:var(--code)}blockquote{margin:12px 0;padding:4px 14px;border-left:4px solid var(--line);color:var(--muted)}
img{max-width:100%}.ext{color:var(--muted)}hr{border:0;border-top:1px solid var(--line)}
@media print{nav.top{display:none}a{color:inherit;text-decoration:none}}
`;

/** Bối cảnh chuyển một tệp: đường dẫn nguồn, tập tệp được dựng, hàm đọc ảnh. */
function makeInline(ctx) {
  const resolveLink = (target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return { external: true };
    const [p, anchor] = target.split('#');
    if (p === '') return { href: `#${anchor ?? ''}` };
    const abs = resolve(dirname(ctx.file), decodeURIComponent(p));
    const rel = toPosix(relative(ctx.root, abs));
    if (ctx.built.has(rel)) {
      const relFromHere = toPosix(relative(dirname(ctx.file), abs))
        .replace(/README\.md$/, 'index.html')
        .replace(/\.md$/, '.html');
      return { href: relFromHere + (anchor ? `#${anchor}` : '') };
    }
    if (ctx.built.has(`${rel}/README.md`)) {
      const relFromHere = toPosix(relative(dirname(ctx.file), abs));
      return { href: `${relFromHere}/index.html` + (anchor ? `#${anchor}` : '') };
    }
    return { outside: rel };
  };
  // Rà soát T062 F7: chỉ nhúng ảnh nằm thật trong docs/ (sau khi giải liên kết tượng trưng): Markdown không đọc được
  // tệp bất kỳ của máy dựng (khóa, cấu hình) vào HTML đi kèm bộ cài.
  const docsRoot = realpathSync(join(ctx.root, 'docs'));
  const insideDocs = (p) => {
    const r = relative(docsRoot, p);
    return r !== '' && !r.startsWith('..') && !isAbsolute(r);
  };
  const image = (alt, target) => {
    const none = `<span class="ext">[ảnh: ${esc(alt)}]</span>`;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return none;
    const abs = resolve(dirname(ctx.file), decodeURIComponent(target));
    const type = IMAGE_TYPES[extname(abs).toLowerCase()];
    if (!type || !existsSync(abs)) return none;
    const real = realpathSync(abs);
    if (!insideDocs(real) || !statSync(real).isFile()) return none;
    const data = readFileSync(real).toString('base64');
    return `<img alt="${esc(alt)}" src="data:${type};base64,${data}">`;
  };

  return function inline(text) {
    const codes = [];
    let s = text.replace(/(`+)([^`]+?)\1/g, (_, __, c) => {
      codes.push(`<code>${esc(c.trim())}</code>`);
      return `\uE000${codes.length - 1}\uE000`;
    });
    const parts = [];
    const hold = (html) => {
      parts.push(html);
      return `\uE001${parts.length - 1}\uE001`;
    };
    s = s.replace(/<a\s+(?:id|name)="([^"]+)"\s*><\/a>/g, (_, id) =>
      hold(`<a id="${esc(id)}"></a>`),
    );
    s = s.replace(/<br\s*\/?>/g, () => hold('<br>'));
    s = s.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?\s*\)/g, (_, alt, t) => hold(image(alt, t)));
    s = s.replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_, label, t) => {
      const r = resolveLink(t);
      const lab = inline(label);
      if (r.href !== undefined) return hold(`<a href="${esc(r.href)}">${lab}</a>`);
      if (r.external) return hold(`${lab} <span class="ext">(${esc(t)})</span>`);
      return hold(
        `${lab} <span class="ext">(trong kho mã nguồn: <code>${esc(r.outside)}</code>)</span>`,
      );
    });
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    s = s.replace(/\uE001(\d+)\uE001/g, (_, i) => parts[Number(i)]);
    s = s.replace(/\uE000(\d+)\uE000/g, (_, i) => codes[Number(i)]);
    return s;
  };
}

const isTableSep = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

/** Markdown → HTML (phần thân). */
export function renderMarkdown(md, ctx) {
  const inline = makeInline(ctx);
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const out = [];
  const seen = new Map();
  let i = 0;
  let title = null;

  const headingId = (text) => {
    const base = slugify(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
  const listItem = (l) => /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);

  function renderList(start) {
    const first = listItem(lines[start]);
    const indent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const startNo = ordered ? parseInt(first[2], 10) : 1;
    const html = [ordered ? (startNo === 1 ? '<ol>' : `<ol start="${startNo}">`) : '<ul>'];
    let j = start;
    while (j < lines.length) {
      const m = listItem(lines[j]);
      if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
      let body = m[3];
      j++;
      // dòng tiếp của cùng mục (thụt vào, không phải mục mới)
      while (
        j < lines.length &&
        lines[j].trim() !== '' &&
        !listItem(lines[j]) &&
        /^\s+/.test(lines[j])
      ) {
        body += ` ${lines[j].trim()}`;
        j++;
      }
      let inner = '';
      if (j < lines.length) {
        const sub = listItem(lines[j]);
        if (sub && sub[1].length > indent) {
          const r = renderList(j);
          inner = r.html;
          j = r.next;
        }
      }
      const box = /^\[( |x|X)\]\s+(.*)$/.exec(body);
      const text = box
        ? `<input type="checkbox" disabled${box[1] === ' ' ? '' : ' checked'}> ${inline(box[2])}`
        : inline(body);
      html.push(`<li>${text}${inner}</li>`);
      // dòng trống giữa các mục cùng danh sách
      if (j < lines.length - 1 && lines[j].trim() === '') {
        const nx = listItem(lines[j + 1]);
        if (nx && nx[1].length === indent && /\d/.test(nx[2]) === ordered) j++;
      }
    }
    html.push(ordered ? '</ol>' : '</ul>');
    return { html: html.join(''), next: j };
  }

  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)\s*([\w-]*)/.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      const cls = fence[2] ? ` class="language-${esc(fence[2])}"` : '';
      out.push(`<pre><code${cls}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      if (level === 1 && title === null) title = h[2].replace(/`/g, '');
      out.push(`<h${level} id="${esc(headingId(h[2]))}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '')
        rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table>',
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), ctx).body}</blockquote>`);
      continue;
    }
    if (listItem(line)) {
      const r = renderList(i);
      out.push(r.html);
      i = r.next;
      continue;
    }
    const para = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*(```|~~~|>)/.test(lines[i]) &&
      !listItem(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))
    )
      para.push(lines[i++].trim());
    const onlyAnchor = para.length === 1 && /^<a\s+(?:id|name)="[^"]+"\s*><\/a>$/.test(para[0]);
    out.push(onlyAnchor ? inline(para[0]) : `<p>${inline(para.join('\n'))}</p>`);
  }
  return { body: out.join('\n'), title };
}

function walkMd(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walkMd(p, out);
    else if (n.endsWith('.md')) out.push(p);
  }
  return out;
}

/** Tệp đánh dấu thư mục ra do build-docs tạo (giữ qua các lần dựng vì bắt đầu bằng dấu chấm). */
export const OUT_MARKER = '.mat-build-docs';

/** Dựng mọi tệp của SOURCES; trả danh sách tệp đã ghi (tương đối thư mục ra). */
export function buildDocs({
  root = repoRoot,
  outDir = join(repoRoot, 'release/docs'),
  sources = SOURCES,
} = {}) {
  const files = sources.flatMap((s) => walkMd(join(root, s)));
  const built = new Set(files.map((f) => toPosix(relative(root, f))));
  // Xóa trang của lần dựng trước nhưng giữ tệp chấm: `apps/studio/src-tauri/docs-html/` có tệp bỏ qua của git để thư mục
  // tài nguyên của Tauri luôn tồn tại (`cargo build` báo lỗi khi `bundle.resources` trỏ tới thư mục không có).
  // Rà soát T062 F7: chỉ xóa khi thư mục là của build-docs (có tệp đánh dấu OUT_MARKER) hoặc chỉ có tệp chấm; `--out`
  // trỏ nhầm vào thư mục có dữ liệu khác thì từ chối, không xóa gì.
  if (existsSync(outDir)) {
    const names = readdirSync(outDir);
    const foreign = names.filter((n) => !n.startsWith('.'));
    if (foreign.length > 0 && !names.includes(OUT_MARKER))
      throw new Error(
        `${outDir} không phải thư mục do build-docs tạo (không có ${OUT_MARKER}) mà có ${foreign.length} mục: ` +
          'chọn thư mục trống hoặc tự xóa thư mục này trước',
      );
    for (const n of foreign) rmSync(join(outDir, n), { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, OUT_MARKER),
    'Thư mục do tools/build-docs.mjs dựng; mỗi lần dựng xóa mọi tệp không bắt đầu bằng dấu chấm.\n',
  );
  const written = [];
  for (const file of files) {
    const rel = toPosix(relative(join(root, 'docs'), file));
    const isIndex = rel.endsWith('README.md');
    const outRel = isIndex
      ? rel.replace(/README\.md$/, 'index.html')
      : rel.replace(/\.md$/, '.html');
    const { body, title } = renderMarkdown(readFileSync(file, 'utf8'), { root, file, built });
    const depth = outRel.split('/').length - 1;
    const home = `${'../'.repeat(depth)}user/index.html`;
    const page = [
      '<!doctype html>',
      '<html lang="vi">',
      '<head>',
      '<meta charset="utf-8">',
      // T202: không script, không tài nguyên ngoài (cửa sổ Trợ giúp của Studio mở file://).
      `<meta http-equiv="Content-Security-Policy" content="${DOCS_CSP}">`,
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${esc(title ?? rel)} · mAT SCADA</title>`,
      `<style>${CSS.trim()}</style>`,
      '</head>',
      '<body>',
      `<nav class="top"><a href="${home}">Mục lục tài liệu</a> · <code>docs/${esc(rel)}</code></nav>`,
      `<main>\n${body}\n</main>`,
      '</body>',
      '</html>',
      '',
    ].join('\n');
    const dest = join(outDir, outRel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, page);
    written.push(outRel);
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let outDir = join(repoRoot, 'release/docs');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) outDir = resolve(args[++i]);
    else {
      console.error('Dùng: node tools/build-docs.mjs [--out <thư mục>]');
      process.exit(2);
    }
  }
  let written;
  try {
    written = buildDocs({ outDir });
  } catch (e) {
    console.error(`build-docs: ${e.message}`);
    process.exit(1);
  }
  console.log(
    `build-docs: ${written.length} trang → ${toPosix(relative(process.cwd(), outDir)) || '.'}`,
  );
}
