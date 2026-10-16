// Sinh bộ cặp nhập lại (T097; FR-026, SC-009; research R18): tests/fixtures/svg-import/reimport/<cặp>/{v1.svg, v2.svg, answer.json}.
// Chạy từ gốc repo:  node tests/fixtures/svg-import/reimport/make-reimport.mjs
// - v1 = bản ĐANG DÙNG: bản vẽ nguồn đã qua `importSvg` (có `data-mat-uid`, bộ sinh theo seed => tất định).
// - v2 = bản MỚI do công cụ ngoài/người dùng tạo ra từ v1 (Inkscape thật, kịch bản biến đổi).
// - answer.json: `answers[]` theo thứ tự tài liệu của v2 SAU nhập (đường dẫn `/svg/g[2]/rect[1]`: chỉ số
//   trong các anh em cùng thẻ), `old` = UID trong v1.svg hoặc null (mới). `ambiguous: true` nghĩa là
//   không có đáp án đúng duy nhất: mọi phần tử giống hệt nhau, bộ đối chiếu phải hỏi, KHÔNG được tự gán.
// Đáp án lấy từ chính thao tác biến đổi (nút DOM giữ nguyên danh tính), không từ bộ đối chiếu.
// Không có `soffice` trên máy dev: cặp 3 là KỊCH BẢN BIẾN ĐỔI mô phỏng đặc trưng LibreOffice (mất id và
// data-*, viewBox đổi sang 1/100 mm, bọc chữ trong g, số làm tròn); ghi rõ ở "tool" của answer.json.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
const HERE = dirname(fileURLToPath(import.meta.url));
const { importSvg, makeSeededUid, isBindable, writeSvg, parseXml } = await import(
  '../../../../packages/svg-import/src/index.ts'
);

const INKSCAPE = process.env.INKSCAPE ?? 'C:/Program Files/Inkscape/bin/inkscape.exe';
const NS = 'http://www.w3.org/2000/svg';

function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bản vẽ nguồn: `units` cụm bồn (g gồm 5 phần tử) cộng 8 phần tử rời. */
function scene(seed, units) {
  const r = rngOf(seed);
  const jit = (n) => Math.round(r() * n);
  let s = '';
  for (let k = 0; k < units; k++) {
    const x = 40 + (k % 5) * 190;
    const y = 60 + Math.floor(k / 5) * 270;
    const w = 120 + jit(10);
    const lv = 60 + jit(30);
    s +=
      `<g id="unit${k}" data-name="Bồn ${k + 1}" transform="translate(${x} ${y})">` +
      `<rect id="body${k}" x="0" y="0" width="${w}" height="${180 + jit(8)}" rx="6" fill="#c8d0d8" stroke="#333333" stroke-width="2"/>` +
      `<rect id="rect${100 + k * 3}" x="6" y="${lv}" width="${w - 12}" height="${150 - lv}" fill="#2a7fd4"/>` +
      `<circle id="gauge${k}" cx="${Math.round(w / 2)}" cy="-20" r="${14 + jit(4)}" fill="#ffffff" stroke="#333333"/>` +
      `<text id="text${200 + k}" x="${Math.round(w / 2)}" y="205" font-size="14" text-anchor="middle" fill="#222222">T${k + 1}</text>` +
      `<path id="pipe${k}" d="M${Math.round(w / 2)} 184 v${14 + jit(6)} h${40 + jit(10)} v${24 + jit(8)}" fill="none" stroke="#555555" stroke-width="4"/>` +
      `</g>`;
  }
  s +=
    `<line id="line${300}" x1="20" y1="20" x2="${600 + jit(50)}" y2="20" stroke="#888888" stroke-width="3"/>` +
    `<polyline id="polyline${301}" points="30,560 120,${520 + jit(10)} 260,570 400,540" fill="none" stroke="#c0392b" stroke-width="3"/>` +
    `<polygon id="polygon${302}" points="700,500 760,${520 + jit(8)} 740,580 690,570" fill="#e67e22"/>` +
    `<ellipse id="ellipse${303}" cx="860" cy="${540 + jit(10)}" rx="${40 + jit(6)}" ry="${22 + jit(4)}" fill="#8e44ad"/>` +
    `<rect id="frame" x="10" y="10" width="980" height="580" fill="none" stroke="#000000" stroke-width="1"/>` +
    `<text id="title" x="500" y="45" font-size="22" text-anchor="middle" fill="#000000">Sơ đồ công nghệ ${seed}</text>` +
    `<path id="path${304}" d="M900 60 C920 ${100 + jit(10)} 940 ${140 + jit(10)} 960 200" fill="none" stroke="#16a085" stroke-width="5"/>` +
    `<circle id="circle${305}" cx="930" cy="${400 + jit(10)}" r="${25 + jit(5)}" fill="#f1c40f" stroke="#7f6000"/>`;
  return `<svg xmlns="${NS}" width="1000" height="600" viewBox="0 0 1000 600">${s}</svg>`;
}

function importV1(base, seed) {
  const r = importSvg(base, { fileName: 'v1.svg', uid: makeSeededUid(seed) });
  if (!r.ok) throw new Error('v1 không nhập được: ' + r.error.message);
  return r.svg;
}

const parse = (text) => {
  const p = parseXml(text);
  if (!p.ok) throw new Error(p.message);
  return p.root;
};
const bindables = (root) => [...root.querySelectorAll('*')].filter((e) => isBindable(e));
const uidMap = (root) => new Map(bindables(root).map((e) => [e, e.getAttribute('data-mat-uid')]));
function strip(root, { ids = true, uids = true, names = true } = {}) {
  for (const e of root.querySelectorAll('*')) {
    if (uids) e.removeAttribute('data-mat-uid');
    if (names) e.removeAttribute('data-mat-name');
    if (ids && !e.closest('defs')) e.removeAttribute('id');
  }
}

/** Đường dẫn `/svg/g[2]/rect[1]` của phần tử trong tài liệu đã nhập (cùng quy ước match.ts). */
function pathOf(el) {
  const parts = [];
  for (let e = el; e; e = e.parentElement) {
    let i = 1;
    for (let p = e.previousElementSibling; p; p = p.previousElementSibling)
      if (p.localName === e.localName) i++;
    parts.push(`${e.localName}[${i}]`);
  }
  return '/' + parts.reverse().join('/').replace('svg[1]', 'svg');
}

/** Ghép đáp án: `truth` theo thứ tự phần tử gắn được của v2 (mảng uid|null|'ambiguous'). */
function buildAnswer(name, tool, desc, v1, v2Text, truth) {
  const imp = importSvg(v2Text, { fileName: 'v2.svg', uid: makeSeededUid('chk') });
  if (!imp.ok) throw new Error(name + ': v2 không nhập được: ' + imp.error.message);
  const root = parse(imp.svg);
  const els = bindables(root);
  if (els.length !== truth.length)
    throw new Error(`${name}: số phần tử gắn được sau nhập ${els.length} khác đáp án ${truth.length}`);
  const oldUids = new Set(bindables(parse(v1)).map((e) => e.getAttribute('data-mat-uid')));
  const answers = els.map((e, i) => {
    const t = truth[i];
    if (t === 'ambiguous') return { new: pathOf(e), old: null, ambiguous: true };
    if (t !== null && !oldUids.has(t)) throw new Error(`${name}: UID đáp án ${t} không có trong v1`);
    return { new: pathOf(e), old: t };
  });
  return { pair: name, tool, description: desc, answers };
}

function emit(name, tool, desc, v1, v2Text, truth) {
  const dir = join(HERE, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'v1.svg'), v1);
  writeFileSync(join(dir, 'v2.svg'), v2Text);
  const ans = buildAnswer(name, tool, desc, v1, v2Text, truth);
  writeFileSync(join(dir, 'answer.json'), JSON.stringify(ans, null, 2) + '\n');
  const known = ans.answers.filter((a) => a.old !== null).length;
  const amb = ans.answers.filter((a) => a.ambiguous).length;
  console.log(`${name}: ${ans.answers.length} phần tử (khớp đáp án ${known}, mới ${ans.answers.length - known - amb}, mơ hồ ${amb})`);
}

function inkscape(v1Text, args, tmp, tag) {
  const input = join(tmp, tag + '-in.svg');
  const out = join(tmp, tag + '-out.svg');
  writeFileSync(input, v1Text);
  const r = spawnSync(INKSCAPE, [input, ...args, `--export-filename=${out}`], { encoding: 'utf8' });
  if (r.status !== 0 || !existsSync(out)) throw new Error('Inkscape lỗi: ' + (r.stderr || r.stdout));
  return readFileSync(out, 'utf8');
}

/** Truth theo thứ tự: v2 cùng số phần tử, cùng thẻ với v1 (Inkscape không thêm bớt phần tử gắn được). */
function truthByOrder(v1, v2Text) {
  const a = bindables(parse(v1));
  const b = bindables(parse(v2Text));
  if (a.length !== b.length) throw new Error(`Inkscape đổi số phần tử gắn được: ${a.length} -> ${b.length}`);
  b.forEach((e, i) => {
    if (e.localName !== a[i].localName) throw new Error('Inkscape đổi thẻ: ' + a[i].localName + ' -> ' + e.localName);
  });
  return a.map((e) => e.getAttribute('data-mat-uid'));
}

const tmp = mkdtempSync(join(tmpdir(), 'reimport-'));
const inkVersion = spawnSync(INKSCAPE, ['--version'], { encoding: 'utf8' }).stdout.trim().split('\n')[0];

// ---- 1. Inkscape lưu lại, giữ data-* (người dùng sửa nhẹ trước: dời 3 phần tử, đổi màu 2) ----
{
  const v1 = importV1(scene(11, 5), 'pair1');
  const root = parse(v1);
  const els = bindables(root).filter((e) => e.localName !== 'g');
  for (const e of [els[2], els[9], els[17]]) {
    if (e.localName === 'rect') e.setAttribute('x', String(Number(e.getAttribute('x')) + 4));
    else if (e.localName === 'circle') e.setAttribute('cx', String(Number(e.getAttribute('cx')) + 4));
    else e.setAttribute('transform', 'translate(4 3)');
  }
  els[5].setAttribute('fill', '#ff0000');
  els[12].setAttribute('fill', '#00aa00');
  const edited = writeSvg(root);
  const v2 = inkscape(edited, ['--export-type=svg'], tmp, 'p1');
  emit('01-inkscape-resave', inkVersion + ' --export-type=svg (giữ data-*)', 'Inkscape lưu lại bản đã nhập sau khi người dùng sửa nhẹ; giữ id và data-mat-uid.', v1, v2, truthByOrder(v1, v2));
}

// ---- 2. Inkscape "Plain SVG": bỏ data-* (nếu Inkscape còn giữ thì kịch bản bỏ nốt, ghi rõ) giữ id ----
{
  const v1 = importV1(scene(22, 5), 'pair2');
  let v2 = inkscape(v1, ['--export-plain-svg'], tmp, 'p2');
  const kept = v2.includes('data-mat-uid');
  if (kept) {
    const root = parse(v2);
    strip(root, { ids: false, uids: true, names: true });
    v2 = writeSvg(root);
  }
  emit('02-inkscape-plain', inkVersion + ' --export-plain-svg' + (kept ? ' (Inkscape giữ data-*, kịch bản bỏ data-* sau đó)' : ' (data-* tự mất)'), 'Inkscape Plain SVG: giữ id, mất data-mat-uid.', v1, v2, truthByOrder(v1, v2));
}

// ---- 3. Mô phỏng xuất qua LibreOffice: mất id và data-*, viewBox 1/100 mm, chữ bọc trong g, số làm tròn ----
{
  const v1 = importV1(scene(33, 5), 'pair3');
  const root = parse(v1);
  const map = uidMap(root);
  strip(root);
  const SCALE = 28;
  const rootEl = root;
  const kids = [...rootEl.childNodes];
  const wrap = rootEl.ownerDocument.createElementNS(NS, 'g');
  wrap.setAttribute('transform', `scale(${SCALE})`);
  for (const k of kids) wrap.appendChild(k);
  rootEl.appendChild(wrap);
  rootEl.setAttribute('viewBox', `0 0 ${1000 * SCALE} ${600 * SCALE}`);
  rootEl.setAttribute('width', String(1000 * SCALE));
  rootEl.setAttribute('height', String(600 * SCALE));
  for (const t of [...rootEl.querySelectorAll('text')]) {
    const g = rootEl.ownerDocument.createElementNS(NS, 'g');
    t.parentNode.insertBefore(g, t);
    g.appendChild(t);
  }
  for (const e of rootEl.querySelectorAll('*'))
    for (const a of ['x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'x1', 'x2', 'y1', 'y2'])
      if (e.hasAttribute(a) && e.localName !== 'svg') e.setAttribute(a, String(Math.round(Number(e.getAttribute(a)) * 10) / 10));
  const v2 = writeSvg(rootEl);
  const truth = bindables(rootEl).map((e) => map.get(e) ?? null);
  emit('03-libreoffice-like', 'kịch bản biến đổi (không có soffice): bỏ id/data-*, viewBox 1/100 mm + g scale, bọc text trong g, làm tròn 0,1', 'Mô phỏng xuất lại qua LibreOffice: mất id và data-*, đổi hệ tọa độ, thêm g bọc.', v1, v2, truth);
}

// ---- 4. Dời và nhóm lại (id và data-* mất) ----
{
  const v1 = importV1(scene(44, 5), 'pair4');
  const root = parse(v1);
  const map = uidMap(root);
  strip(root);
  const leaves = bindables(root).filter((e) => e.localName !== 'g');
  // dời 4 phần tử 15..45 px
  const moves = [[leaves[1], 30, 0], [leaves[8], 0, 25], [leaves[14], -20, 15], [leaves[22], 45, -10]];
  for (const [e, dx, dy] of moves) {
    const prev = e.getAttribute('transform') ?? '';
    e.setAttribute('transform', `translate(${dx} ${dy}) ${prev}`.trim());
  }
  // bỏ nhóm unit2: con ra ngoài, g mất (mồ côi)
  const unit2 = root.querySelectorAll(':scope > g')[2];
  const tr = unit2.getAttribute('transform');
  const m = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(tr);
  for (const k of [...unit2.children]) {
    const prev = k.getAttribute('transform');
    k.setAttribute('transform', `translate(${m[1]} ${m[2]})` + (prev ? ' ' + prev : ''));
    unit2.parentNode.insertBefore(k, unit2);
  }
  unit2.remove();
  // nhóm 4 phần tử rời liên tiếp thành một g mới
  const loose = [...root.querySelectorAll(':scope > line, :scope > polyline, :scope > polygon, :scope > ellipse')];
  const grp = root.ownerDocument.createElementNS(NS, 'g');
  loose[0].parentNode.insertBefore(grp, loose[0]);
  for (const e of loose.slice(0, 4)) grp.appendChild(e);
  const v2 = writeSvg(root);
  emit('04-move-regroup', 'kịch bản biến đổi: dời 4, bỏ nhóm 1, nhóm lại 4; bỏ id và data-*', 'Dời phần tử, bỏ một nhóm, thêm nhóm bao 4 phần tử rời; không còn id hay UID.', v1, v2, bindables(root).map((e) => map.get(e) ?? null));
}

// ---- 5. Đổi tên id (kể cả id tự sinh bị lệch số), thêm 3, xóa 2 ----
{
  const v1 = importV1(scene(55, 6), 'pair5');
  const root = parse(v1);
  const map = uidMap(root);
  strip(root, { ids: false, uids: true, names: true });
  // id có nghĩa đổi hậu tố; id tự sinh (rect/text + số) lệch +3 => id mới trùng id cũ của phần tử KHÁC
  for (const e of root.querySelectorAll('[id]')) {
    const id = e.getAttribute('id');
    const digits = id.replace(/^[a-z]+/, '');
    const word = id.slice(0, id.length - digits.length);
    if ((word === 'rect' || word === 'text') && digits !== '') e.setAttribute('id', word + (Number(digits) + 3));
    else e.setAttribute('id', id + '_v2');
  }
  const leaves = bindables(root).filter((e) => e.localName !== 'g');
  leaves[4].remove();
  leaves[19].remove();
  const mk = (tag, attrs) => {
    const e = root.ownerDocument.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const top = [...root.children];
  root.insertBefore(mk('rect', { id: 'rect500', x: '440', y: '300', width: '70', height: '40', fill: '#99ccff' }), top[1]);
  root.appendChild(mk('circle', { id: 'circle501', cx: '700', cy: '320', r: '18', fill: '#ff99cc' }));
  const t = mk('text', { id: 'text502', x: '520', y: '330', 'font-size': '14', fill: '#222222' });
  t.textContent = 'Mới';
  root.appendChild(t);
  const v2 = writeSvg(root);
  emit('05-rename-add-delete', 'kịch bản biến đổi: đổi id, thêm 3, xóa 2; mất data-*', 'Đổi tên id (id tự sinh lệch số nên trùng id cũ của phần tử khác), thêm 3 phần tử, xóa 2.', v1, v2, bindables(root).map((e) => map.get(e) ?? null));
}

// ---- 6. Lưới 12 hình chữ nhật giống hệt vẽ lại lệch nửa ô: phải ra "cần chọn" ----
{
  let s = '';
  for (let i = 0; i < 12; i++)
    s += `<rect id="slot${i}" x="${40 + (i % 4) * 110}" y="${120 + Math.floor(i / 4) * 90}" width="80" height="60" fill="#dddddd" stroke="#333333"/>`;
  s += `<text id="title" x="250" y="60" font-size="20" fill="#000000">Lưới ô</text>`;
  s += `<rect id="border" x="10" y="10" width="480" height="400" fill="none" stroke="#000000"/>`;
  const base = `<svg xmlns="${NS}" width="500" height="420" viewBox="0 0 500 420">${s}</svg>`;
  const v1 = importV1(base, 'pair6');
  const root = parse(v1);
  const map = uidMap(root);
  strip(root);
  // v2 vẽ lại lưới lệch nửa ô (55, 45): mỗi ô mới nằm giữa các ô cũ, không có cách phân biệt
  for (const e of root.querySelectorAll('rect')) {
    if (e.getAttribute('width') !== '80') continue;
    e.setAttribute('x', String(Number(e.getAttribute('x')) + 55));
    e.setAttribute('y', String(Number(e.getAttribute('y')) + 45));
  }
  const v2 = writeSvg(root);
  const truth = bindables(root).map((e) => {
    const w = e.getAttribute('width');
    return e.localName === 'rect' && w === '80' ? 'ambiguous' : map.get(e);
  });
  emit('06-identical-grid', 'kịch bản biến đổi: bỏ id và data-*, dời cả lưới 55x45 px (nửa ô)', '12 hình chữ nhật giống hệt xếp lưới được vẽ lại lệch nửa ô: không có cách phân biệt, phải hỏi.', v1, v2, truth);
}

// ---- 7. Hàng 10 hình giống nhau cách 40 px, chèn thêm một phần tử giữa hàng (lệch chỉ số) ----
{
  let s = '';
  for (let i = 0; i < 10; i++) s += `<rect id="r${i}" x="${30 + i * 40}" y="100" width="30" height="50" fill="#ccddee" stroke="#223344"/>`;
  for (let i = 0; i < 10; i++) s += `<circle id="c${i}" cx="${45 + i * 40}" cy="220" r="12" fill="#eeccdd" stroke="#442233"/>`;
  s += `<text id="cap" x="200" y="60" font-size="18" fill="#000000">Hàng</text>`;
  const base = `<svg xmlns="${NS}" width="480" height="300" viewBox="0 0 480 300">${s}</svg>`;
  const v1 = importV1(base, 'pair7');
  const root = parse(v1);
  const map = uidMap(root);
  strip(root);
  const rects = [...root.querySelectorAll('rect')];
  const extra = root.ownerDocument.createElementNS(NS, 'rect');
  for (const [k, v] of Object.entries({ x: '30', y: '300', width: '30', height: '20', fill: '#ccddee', stroke: '#223344' })) extra.setAttribute(k, v);
  rects[3].parentNode.insertBefore(extra, rects[4]);
  const circles = [...root.querySelectorAll('circle')];
  circles[6].remove();
  const v2 = writeSvg(root);
  emit('07-row-insert', 'kịch bản biến đổi: bỏ id và data-*, chèn 1 hình chữ nhật giữa hàng, xóa 1 hình tròn', 'Hàng hình giống nhau cách 40 px (dưới 5 % đường chéo), chèn thêm một phần tử làm lệch chỉ số anh em.', v1, v2, bindables(root).map((e) => map.get(e) ?? null));
}
