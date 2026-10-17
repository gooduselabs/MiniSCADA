// So ảnh dựng của fixture trình vẽ SVG trước/sau khi qua trình vẽ (feature 011, T154 phần còn lại; SC-030; FR-100, FR-102,
// FR-111): mỗi tệp của tests/svg-editor-fixtures (bỏ malicious/) được đọc bằng @mat/svg-edit (Node, không cổng DOM) rồi
// (1) lưu không sửa, (2) dời mọi phần tử vẽ được cấp trên cùng (13, 7) rồi dời ngược (bake vào thuộc tính hình học khi chính
// xác, ngược lại transform), (3) nhóm mọi phần tử cấp trên cùng rồi bỏ nhóm. Ảnh do Chrome dựng (thẻ <img>, 480 × 360) phải
// khác bản gốc ≤ 1 % điểm ảnh (kênh lệch > 48 tính là khác, để bỏ qua khử răng cưa).
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyCommand,
  elementChildren,
  groupNodes,
  isDrawable,
  moveNodes,
  parseDrawDoc,
  serialize,
  ungroupNode,
} from '@mat/svg-edit';
import { REPO } from './util.mjs';

const DIR = resolve(REPO, 'tests/svg-editor-fixtures');
const W = 480;
const H = 360;
const MAX_RATIO = 0.01;
const SHAPES = new Set([
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'use',
  'image',
  'svg',
]);

let seed = 0;
const uid = () => `el_rd${(seed++).toString(36).padStart(5, '0')}`;

function open(text) {
  const r = parseDrawDoc(text, { domCheck: false, uid });
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.doc;
}

/** Phần tử vẽ được ở cấp trên cùng (con của gốc và của các lớp). */
function topDrawables(doc) {
  const out = [];
  for (const c of elementChildren(doc, doc.root)) {
    const n = doc.nodes.get(c);
    if (n.tag === 'g' && n.attrs.has('data-mat-layer')) {
      for (const k of elementChildren(doc, c))
        if (isDrawable(doc, k) && SHAPES.has(doc.nodes.get(k).tag)) out.push(k);
    } else if (isDrawable(doc, c) && SHAPES.has(n.tag)) out.push(c);
  }
  return out;
}

function variants(text) {
  const out = { 'mở rồi lưu': serialize(open(text)) };
  {
    const doc = open(text);
    const ids = topDrawables(doc);
    if (ids.length) {
      applyCommand(doc, moveNodes(doc, ids, 13, 7).batch);
      applyCommand(doc, moveNodes(doc, topDrawables(doc), -13, -7).batch);
      out['dời rồi dời ngược'] = serialize(doc);
    }
  }
  {
    const doc = open(text);
    // nhóm theo từng cha (lớp, gốc): groupNodes giữ hiển thị khi các nút cùng cha
    const byParent = new Map();
    for (const id of topDrawables(doc)) {
      const p = doc.nodes.get(id).parent;
      byParent.set(p, [...(byParent.get(p) ?? []), id]);
    }
    let did = false;
    for (const ids of byParent.values()) {
      try {
        const g = groupNodes(doc, ids);
        applyCommand(doc, g.batch);
        const u = ungroupNode(doc, g.group);
        applyCommand(doc, u.batch);
        did = true;
      } catch {
        // nhóm hoặc bỏ nhóm bị từ chối có lý do (ví dụ phần tử bị tham chiếu): bỏ qua cha này
      }
    }
    if (did) out['nhóm rồi bỏ nhóm'] = serialize(doc);
  }
  return out;
}

/** Dựng hai SVG bằng Chrome (thẻ img vẽ vào canvas) và đếm điểm ảnh khác. */
const diff = (page, a, b) =>
  page.evaluate(
    async (sa, sb, w, h) => {
      const draw = async (s) => {
        const img = new Image(w, h);
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, w, h);
        g.drawImage(img, 0, 0, w, h);
        return g.getImageData(0, 0, w, h).data;
      };
      const [x, y] = [await draw(sa), await draw(sb)];
      let bad = 0;
      let ink = 0;
      for (let i = 0; i < x.length; i += 4) {
        const d = Math.max(
          Math.abs(x[i] - y[i]),
          Math.abs(x[i + 1] - y[i + 1]),
          Math.abs(x[i + 2] - y[i + 2]),
        );
        if (d > 48) bad++;
        if (x[i] < 250 || x[i + 1] < 250 || x[i + 2] < 250) ink++;
      }
      return { ratio: bad / (w * h), ink: ink / (w * h) };
    },
    a,
    b,
    W,
    H,
  );

export default async function svgRenderDiff({ page, check }) {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.svg'))
    .sort();
  check('có ≥ 20 fixture để so ảnh', files.length >= 20, String(files.length));
  let worst = { file: '', what: '', ratio: 0 };
  let compared = 0;
  let controls = 0;
  let sensitive = 0;
  for (const f of files) {
    const text = readFileSync(resolve(DIR, f), 'utf8');
    let vs;
    try {
      vs = variants(text);
    } catch (e) {
      check(`${f}: mở được`, false, String(e));
      continue;
    }
    for (const [what, out] of Object.entries(vs)) {
      const r = await diff(page, text, out);
      compared++;
      if (r.ratio > worst.ratio) worst = { file: f, what, ratio: r.ratio };
      if (r.ratio > MAX_RATIO)
        check(`${f} (${what}): ảnh khác ≤ 1 %`, false, `${(r.ratio * 100).toFixed(2)} %`);
    }
    // tệp gốc phải thật sự vẽ ra gì đó (không so hai ảnh trắng), trừ tệp trống của "Mới: SVG trống"
    const ink = (await diff(page, text, text)).ink;
    if (f !== 'blank-new.svg' && ink === 0) check(`${f}: có nét để so`, false, 'ảnh trắng');
    // đối chứng âm: chỉ dời (không dời ngược) thì phép so phải thấy khác
    const doc = open(text);
    const ids = topDrawables(doc);
    if (ids.length && f !== 'blank-new.svg') {
      applyCommand(doc, moveNodes(doc, ids, 40, 30).batch);
      const r = await diff(page, text, serialize(doc));
      controls++;
      if (r.ratio > MAX_RATIO) sensitive++;
    }
  }
  check(
    `đối chứng âm: dời 40, 30 không ngược lại thì thấy khác > 1 % (${sensitive}/${controls})`,
    sensitive >= controls * 0.8,
    `${sensitive}/${controls}`,
  );
  console.log(
    `    lệch lớn nhất: ${worst.file} (${worst.what}) ${(worst.ratio * 100).toFixed(3)} %`,
  );
  check(
    `ảnh dựng lại sai khác ≤ 1 % trên ${compared} phép so của ${files.length} fixture`,
    worst.ratio <= MAX_RATIO,
    `${worst.file} (${worst.what}) ${(worst.ratio * 100).toFixed(3)} %`,
  );
}
