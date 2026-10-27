// Sinh project mẫu projects/svg-showcase (feature 026): sơ đồ công nghệ trạm bơm nước sạch vẽ tay bằng SVG (viewBox
// 1600 × 900, nền sáng kiểu giao diện ATSCADA FastWeb (feature 029), màu chỉ cho trạng thái và môi chất), Tag mô phỏng, binding hoạt ảnh, màn hình SVG toàn trang,
// màn hình lưới kết hợp và popup faceplate của bơm. Toạ độ, uid và binding sinh cùng một chỗ nên luôn khớp nhau.
//
// Dùng:   node tools/svg-showcase/generate.mjs        (ghi đè các tệp của project; tệp khác trong thư mục giữ nguyên)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'projects/svg-showcase');
const SVG_FILE = 'graphics/so-do-cong-nghe.svg';
const VERSION = '1.1.0';

// ---- Bảng màu (feature 029: nền sáng hợp giao diện ATSCADA; màu chỉ dùng cho trạng thái và loại môi chất) ----------------------------------
const C = {
  bg: '#f4f6f8',
  grid: '#e9edf0',
  panel: '#ffffff',
  panelStroke: '#d5dbe0',
  zoneLabel: '#56616b',
  accent: '#008181',
  text: '#2d353c',
  muted: '#56616b',
  dim: '#6d757a',
  box: '#f2f3f4',
  boxStroke: '#c5ced5',
  metalStroke: '#56616b',
  run: '#1fa34a',
  stop: '#929ba1',
  fault: '#e5403b',
  warn: '#f59c1a',
  pillRun: '#007272',
  pillStop: '#6d757a',
  pillFault: '#b13f3c',
  outline: '#2d353c',
};
const PIPE = {
  raw: { core: '#a7825a', flow: '#f4e2c8' },
  clean: { core: '#2b8bd3', flow: '#dff3ff' },
  chem: { core: '#d6aa1c', flow: '#fff5c4' },
};
const FONT = 'Inter, Segoe UI, sans-serif';

// ---- Bộ dựng SVG --------------------------------------------------------------------------------------------------
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const n = (v) => String(Math.round(v * 100) / 100);
const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => ` ${k}="${esc(typeof v === 'number' ? n(v) : v)}"`)
    .join('');

/** Phần tử gắn được: uid → tên hiển thị (thứ tự xuất hiện). */
const elements = new Map();
/** uid → { bindings: [], events } */
const bound = new Map();
const uid = (id, name) => {
  const u = `el_${id}`;
  if (elements.has(u)) throw new Error(`uid trùng: ${u}`);
  elements.set(u, name);
  return { 'data-mat-uid': u, 'data-mat-name': name };
};

const layers = { bg: [], pipes: [], flow: [], arrows: [], equip: [], text: [] };
const put = (layer, s) => layers[layer].push(s);
const tag = (name, a, inner) =>
  inner === undefined ? `<${name}${attrs(a)}/>` : `<${name}${attrs(a)}>${inner}</${name}>`;

function text(layer, x, y, s, o = {}) {
  put(
    layer,
    tag(
      'text',
      {
        ...(o.uid ?? {}),
        x,
        y,
        'font-family': FONT,
        'font-size': o.size ?? 12,
        'font-weight': o.weight,
        'letter-spacing': o.ls,
        'text-anchor': o.anchor,
        fill: o.fill ?? C.text,
        'fill-opacity': o.opacity,
      },
      esc(s),
    ),
  );
}

// ---- Binding ------------------------------------------------------------------------------------------------------
let bindSeq = 0;
function bind(u, b) {
  const key = u['data-mat-uid'];
  const e = bound.get(key) ?? { elementUid: key };
  bound.set(key, e);
  (e.bindings ??= []).push({ id: `${b.target.split('.')[1]}_${++bindSeq}`, ...b });
}
function onClick(u, click) {
  const key = u['data-mat-uid'];
  const e = bound.get(key) ?? { elementUid: key };
  bound.set(key, e);
  e.events = { click };
}
const src = (tagId) => ({ type: 'tag', tagId });
const STATE_CASES = (stop, run, fault) => ({
  kind: 'discreteMap',
  cases: [
    { equals: 0, value: stop },
    { equals: 1, value: run },
    { equals: 2, value: fault },
  ],
  default: stop,
});
const B = {
  value: (u, tagId, decimals, suffix) =>
    bind(u, {
      target: 'text.content',
      source: src(tagId),
      transform: { kind: 'direct' },
      format: { decimals, ...(suffix ? { suffix } : {}) },
    }),
  stateText: (u, tagId) =>
    bind(u, {
      target: 'text.content',
      source: src(tagId),
      transform: { kind: 'valueTable', table: 'TrangThaiBom', output: 'text' },
    }),
  stateFill: (u, tagId, stop = C.pillStop, run = C.pillRun, fault = C.pillFault) =>
    bind(u, {
      target: 'style.fill',
      source: src(tagId),
      transform: STATE_CASES(stop, run, fault),
    }),
  stateStroke: (u, tagId) =>
    bind(u, {
      target: 'style.stroke',
      source: src(tagId),
      transform: STATE_CASES(C.stop, C.run, C.fault),
    }),
  boolFill: (u, tagId, on, off) =>
    bind(u, {
      target: 'style.fill',
      source: src(tagId),
      transform: {
        kind: 'discreteMap',
        cases: [
          { equals: true, value: on },
          { equals: false, value: off },
        ],
      },
    }),
  spin: (u, stateTag) =>
    bind(u, {
      target: 'transform.rotate',
      source: src(stateTag),
      transform: { kind: 'discreteMap', cases: [{ equals: 1, value: 900 }], default: 0 },
      animation: 'spin',
    }),
  /** Dòng chảy theo trạng thái bơm (1 = chạy): chạy thì hiện vạch và cho chạy. */
  flowState: (u, stateTag) => {
    bind(u, {
      target: 'effect.flow',
      source: src(stateTag),
      transform: { kind: 'discreteMap', cases: [{ equals: 1, value: 45 }], default: 0 },
    });
    bind(u, {
      target: 'style.opacity',
      source: src(stateTag),
      transform: { kind: 'discreteMap', cases: [{ equals: 1, value: 0.9 }], default: 0 },
    });
  },
  /** Dòng chảy theo lưu lượng (m³/h): tốc độ tỉ lệ lưu lượng, không có lưu lượng thì ẩn vạch. */
  flowRate: (u, flowTag, max = 150) => {
    bind(u, {
      target: 'effect.flow',
      source: src(flowTag),
      transform: { kind: 'linearScale', inMin: 0, inMax: max, outMin: 0, outMax: 80, clamp: true },
    });
    bind(u, {
      target: 'style.opacity',
      source: src(flowTag),
      transform: {
        kind: 'rangeMap',
        ranges: [
          { to: 0.5, value: 0 },
          { from: 0.5, value: 0.9 },
        ],
      },
    });
  },
  /** Nhấp nháy khi trạng thái = 2 (lỗi). */
  blink: (u, stateTag) =>
    bind(u, {
      target: 'effect.blink',
      source: src(stateTag),
      transform: { kind: 'discreteMap', cases: [{ equals: 2, value: 1 }], default: 0 },
      period: 800,
      mode: 'opacity',
      minOpacity: 0.25,
    }),
  visible: (u, tagId) =>
    bind(u, {
      target: 'style.visibility',
      source: src(tagId),
      transform: {
        kind: 'discreteMap',
        cases: [
          { equals: true, value: 'visible' },
          { equals: false, value: 'hidden' },
        ],
      },
    }),
  level: (u, tagId) =>
    bind(u, { target: 'geometry.levelPercent', source: src(tagId), transform: { kind: 'direct' } }),
  clipLevel: (u, tagId) =>
    bind(u, { target: 'geometry.clipLevel', source: src(tagId), transform: { kind: 'direct' } }),
};

// ---- Khối dựng ---------------------------------------------------------------------------------------------------
function zone(x, y, w, h, label) {
  put(
    'bg',
    tag('rect', { x, y, width: w, height: h, rx: 10, fill: C.panel, stroke: C.panelStroke }),
  );
  put('bg', tag('rect', { x: x + 14, y: y + 13, width: 3, height: 13, rx: 1.5, fill: C.accent }));
  text('bg', x + 24, y + 24, label, { size: 11, weight: 700, ls: 1.2, fill: C.zoneLabel });
}

/** Ô số liệu: nhãn trên trái, giá trị dưới phải (gắn Tag). */
function dataBox(x, y, w, label, id, name, tagId, decimals, suffix, h = 38) {
  put('equip', tag('rect', { x, y, width: w, height: h, rx: 6, fill: C.box, stroke: C.boxStroke }));
  text('equip', x + 9, y + 14, label, { size: 10, weight: 500, fill: C.muted });
  const u = uid(id, name);
  text('equip', x + w - 9, y + h - 8, '--', {
    uid: u,
    size: 15,
    weight: 700,
    anchor: 'end',
    fill: C.text,
  });
  B.value(u, tagId, decimals, suffix);
}

function pipe(d, kind, flow) {
  put(
    'pipes',
    tag('path', {
      d,
      fill: 'none',
      stroke: C.outline,
      'stroke-width': 12,
      'stroke-linejoin': 'round',
    }),
  );
  put(
    'pipes',
    tag('path', {
      d,
      fill: 'none',
      stroke: PIPE[kind].core,
      'stroke-width': 7,
      'stroke-linejoin': 'round',
    }),
  );
  put(
    'pipes',
    tag('path', {
      d,
      fill: 'none',
      stroke: '#ffffff',
      'stroke-opacity': 0.14,
      'stroke-width': 2,
      'stroke-linejoin': 'round',
    }),
  );
  if (!flow) return;
  const u = uid(flow.id, flow.name);
  put(
    'flow',
    tag('path', {
      ...u,
      d,
      fill: 'none',
      stroke: PIPE[kind].flow,
      'stroke-width': 3,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-dasharray': '8 14',
      opacity: 0,
    }),
  );
  if (flow.state) B.flowState(u, flow.state);
  else B.flowRate(u, flow.rate, flow.max);
}

/** Mũi tên chiều chảy trên ống. */
function arrow(x, y, dir, kind) {
  const rot = { right: 0, down: 90, left: 180, up: 270 }[dir];
  put(
    'arrows',
    tag('path', {
      d: `M${n(x - 5)} ${n(y - 6)} L${n(x + 6)} ${n(y)} L${n(x - 5)} ${n(y + 6)} Z`,
      fill: PIPE[kind].flow,
      stroke: C.outline,
      'stroke-width': 1,
      transform: rot ? `rotate(${rot} ${n(x)} ${n(y)})` : undefined,
    }),
  );
}

const bowtie = (cx, cy, w = 13, h = 9) =>
  `M${n(cx - w)} ${n(cy - h)} L${n(cx + w)} ${n(cy + h)} V${n(cy - h)} L${n(cx - w)} ${n(cy + h)} Z`;

function gateValve(cx, cy) {
  put(
    'equip',
    tag('path', {
      d: bowtie(cx, cy),
      fill: 'url(#g-metal)',
      stroke: C.metalStroke,
      'stroke-width': 1.2,
      'stroke-linejoin': 'round',
    }),
  );
  put(
    'equip',
    tag('path', {
      d: `M${cx} ${cy} V${cy - 15} M${cx - 6} ${cy - 15} H${cx + 6}`,
      stroke: C.metalStroke,
      'stroke-width': 2,
      'stroke-linecap': 'round',
      fill: 'none',
    }),
  );
}
function checkValve(cx, cy) {
  put(
    'equip',
    tag('path', {
      d: bowtie(cx, cy),
      fill: '#e9edf0',
      stroke: C.metalStroke,
      'stroke-width': 1.2,
      'stroke-linejoin': 'round',
    }),
  );
  put(
    'equip',
    tag('path', {
      d: `M${cx - 13} ${cy - 9} L${cx} ${cy} L${cx - 13} ${cy + 9} Z`,
      fill: C.metalStroke,
    }),
  );
  put(
    'equip',
    tag('path', {
      d: `M${cx + 4} ${cy - 13} L${cx + 13} ${cy - 13}`,
      stroke: C.metalStroke,
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      fill: 'none',
    }),
  );
}
function motorValve(cx, cy, id, label, openTag) {
  const g = uid(id, `Van ${label}`);
  put('equip', `<g${attrs(g)}>`);
  const body = uid(`${id}_than`, `Thân van ${label}`);
  put(
    'equip',
    tag('path', {
      ...body,
      d: bowtie(cx, cy),
      fill: C.stop,
      stroke: C.metalStroke,
      'stroke-width': 1.2,
      'stroke-linejoin': 'round',
    }),
  );
  put(
    'equip',
    tag('path', {
      d: `M${cx} ${cy} V${cy - 14}`,
      stroke: C.metalStroke,
      'stroke-width': 2,
      fill: 'none',
    }),
  );
  put(
    'equip',
    tag('rect', {
      x: cx - 10,
      y: cy - 28,
      width: 20,
      height: 14,
      rx: 3,
      fill: 'url(#g-metal)',
      stroke: C.metalStroke,
      'stroke-width': 1.2,
    }),
  );
  text('equip', cx, cy - 17.5, 'M', { size: 9, weight: 700, anchor: 'middle', fill: '#2d353c' });
  put('equip', '</g>');
  text('text', cx, cy + 25, label, { size: 10, weight: 600, anchor: 'middle', fill: C.muted });
  B.boolFill(body, openTag, C.run, C.stop);
}

/** Bóng đo lường kiểu ISA (FT, PT, LT, AIT) kèm đường dẫn tới điểm đo. */
function bubble(cx, cy, code, num, lead) {
  if (lead)
    put(
      'equip',
      tag('path', {
        d: lead,
        stroke: C.dim,
        'stroke-width': 1.2,
        'stroke-dasharray': '3 3',
        fill: 'none',
      }),
    );
  put(
    'equip',
    tag('circle', { cx, cy, r: 15, fill: C.box, stroke: C.metalStroke, 'stroke-width': 1.4 }),
  );
  put(
    'equip',
    tag('path', { d: `M${cx - 15} ${cy} H${cx + 15}`, stroke: C.metalStroke, 'stroke-width': 1 }),
  );
  text('equip', cx, cy - 3.5, code, { size: 8.5, weight: 700, anchor: 'middle', fill: C.text });
  text('equip', cx, cy + 10, num, { size: 8.5, weight: 600, anchor: 'middle', fill: C.muted });
}
/** Đồng hồ lưu lượng lắp trên ống ngang. */
function flowMeter(cx, cy) {
  put(
    'equip',
    tag('rect', {
      x: cx - 13,
      y: cy - 11,
      width: 26,
      height: 22,
      rx: 4,
      fill: 'url(#g-metal)',
      stroke: C.metalStroke,
      'stroke-width': 1.2,
    }),
  );
  put(
    'equip',
    tag('circle', { cx, cy, r: 6, fill: C.box, stroke: C.metalStroke, 'stroke-width': 1.2 }),
  );
}

/** Biểu tượng cảnh báo (tam giác cam), ẩn/hiện theo Tag. */
function warnIcon(cx, cy, id, name, tagId, color = C.warn) {
  const u = uid(id, name);
  put('text', `<g${attrs({ ...u, visibility: 'hidden' })}>`);
  put(
    'text',
    tag('path', {
      d: `M${cx} ${cy - 10} L${cx + 11} ${cy + 9} H${cx - 11} Z`,
      fill: color,
      stroke: C.outline,
      'stroke-width': 1.2,
      'stroke-linejoin': 'round',
    }),
  );
  put(
    'text',
    tag('path', {
      d: `M${cx} ${cy - 3} V${cy + 3}`,
      stroke: '#1a1204',
      'stroke-width': 2.2,
      'stroke-linecap': 'round',
    }),
  );
  put('text', tag('circle', { cx, cy: cy + 6.5, r: 1.3, fill: '#1a1204' }));
  put('text', '</g>');
  B.visible(u, tagId);
}

/**
 * Bơm ly tâm: vỏ tròn kim loại, miệng xả tiếp tuyến bên phải phía trên (ống xả ở cy - 20), cánh bơm quay khi chạy.
 * Nhấp mở popup faceplate. Nhãn, ô trạng thái, ô dòng điện, biểu tượng lỗi.
 */
function pump(cx, cy, p, title, opts = {}) {
  const r = opts.r ?? 26;
  const id = p.toLowerCase();
  const pre = p.replace('-', '');
  const g = uid(`${id.replace('-', '')}`, `Bơm ${p}`);
  put('equip', `<g${attrs({ ...g, filter: 'url(#f-shadow)' })}>`);
  // bệ
  put(
    'equip',
    tag('path', {
      d: `M${cx - 15} ${cy + r - 4} L${cx + 15} ${cy + r - 4} L${cx + 23} ${cy + r + 8} H${cx - 23} Z`,
      fill: '#e9edf0',
      stroke: '#b6c2c9',
      'stroke-width': 1.2,
      'stroke-linejoin': 'round',
    }),
  );
  // miệng xả
  put(
    'equip',
    tag('rect', {
      x: cx,
      y: cy - r,
      width: r + 4,
      height: 12,
      fill: 'url(#g-metal)',
      stroke: C.metalStroke,
      'stroke-width': 1.2,
    }),
  );
  // vỏ
  const body = uid(`${pre.toLowerCase()}_vo`, `Vỏ bơm ${p}`);
  put(
    'equip',
    tag('circle', { ...body, cx, cy, r, fill: 'url(#g-pump)', stroke: C.stop, 'stroke-width': 3 }),
  );
  // cánh
  const imp = uid(`${pre.toLowerCase()}_canh`, `Cánh bơm ${p}`);
  const blades = [0, 90, 180, 270]
    .map((a) =>
      tag('path', {
        d: `M${cx} ${cy} q ${n(r * 0.42)} ${n(-r * 0.08)} ${n(r * 0.5)} ${n(-r * 0.52)}`,
        transform: a ? `rotate(${a} ${cx} ${cy})` : undefined,
      }),
    )
    .join('');
  put(
    'equip',
    `<g${attrs({ ...imp, fill: 'none', stroke: '#56616b', 'stroke-width': 2.6, 'stroke-linecap': 'round' })}>` +
      tag('circle', { cx, cy, r: r * 0.62, 'stroke-opacity': 0.18, 'stroke-width': 1.2 }) +
      blades +
      tag('circle', { cx, cy, r: 4, fill: '#56616b', stroke: 'none' }) +
      '</g>',
  );
  put('equip', '</g>');
  const state = `${pre}.STATE`;
  B.stateStroke(body, state);
  B.spin(imp, state);
  B.blink(body, state);
  if (opts.popup !== false)
    onClick(g, {
      action: 'popup',
      screen: 'faceplate-bom',
      args: { prefix: pre, title: `${p} · ${title}` },
      label: `Bảng điều khiển ${p}`,
    });

  if (opts.small) return;
  // nhãn + ô trạng thái
  text('text', cx - 6, cy - 38, p, { size: 12, weight: 700, anchor: 'end', fill: C.text });
  const pill = uid(`${pre.toLowerCase()}_tt_nen`, `Nền trạng thái ${p}`);
  put(
    'text',
    tag('rect', { ...pill, x: cx + 2, y: cy - 51, width: 60, height: 18, rx: 9, fill: C.pillStop }),
  );
  const pillText = uid(`${pre.toLowerCase()}_tt`, `Trạng thái ${p}`);
  text('text', cx + 32, cy - 38.5, '--', {
    uid: pillText,
    size: 10.5,
    weight: 700,
    anchor: 'middle',
    fill: '#ffffff',
  });
  B.stateFill(pill, state);
  B.stateText(pillText, state);
  // dòng điện
  dataBox(
    cx - 58,
    cy + 40,
    116,
    'Dòng điện',
    `${pre.toLowerCase()}_dong`,
    `Dòng điện ${p}`,
    `${pre}.CURRENT`,
    1,
    ' A',
  );
  warnIcon(cx + 42, cy + 16, `${pre.toLowerCase()}_loi`, `Báo lỗi ${p}`, `${pre}.FAULT`, C.fault);
}

/** Bồn đứng có thang mức, vạch HH/H/L/LL, chất lỏng gắn mức. */
function tank(x, y, w, h, id, name, levelTag, liquid, marks) {
  const g = { filter: 'url(#f-shadow)' };
  put('equip', `<g${attrs(g)}>`);
  put(
    'equip',
    tag('rect', {
      x,
      y,
      width: w,
      height: h,
      rx: 14,
      fill: 'url(#g-tank)',
      stroke: '#b6c2c9',
      'stroke-width': 2,
    }),
  );
  put('equip', '</g>');
  const ix = x + 4;
  const iy = y + 4;
  const iw = w - 8;
  const ih = h - 8;
  const liq = uid(`${id}_long`, `Chất lỏng ${name}`);
  put(
    'equip',
    tag('rect', { ...liq, x: ix, y: iy, width: iw, height: ih, rx: 10, fill: `url(#${liquid})` }),
  );
  B.level(liq, levelTag);
  // bóng trụ tròn
  put('equip', tag('rect', { x: ix, y: iy, width: iw, height: ih, rx: 10, fill: 'url(#g-shade)' }));
  put(
    'equip',
    tag('rect', {
      x,
      y,
      width: w,
      height: h,
      rx: 14,
      fill: 'none',
      stroke: '#929ba1',
      'stroke-width': 2,
    }),
  );
  // vạch mức
  const yOf = (p) => iy + ih - (ih * p) / 100;
  for (const [lab, p, col] of marks) {
    const yy = yOf(p);
    put(
      'equip',
      tag('path', {
        d: `M${n(ix)} ${n(yy)} H${n(ix + iw)}`,
        stroke: col,
        'stroke-width': 1.2,
        'stroke-dasharray': '5 4',
        'stroke-opacity': 0.85,
      }),
    );
    text('text', x - 6, yy + 3.5, lab, { size: 9.5, weight: 700, anchor: 'end', fill: col });
  }
  // thang mức bên phải
  const sx = x + w + 8;
  put(
    'equip',
    tag('path', { d: `M${sx} ${n(iy)} V${n(iy + ih)}`, stroke: C.dim, 'stroke-width': 1 }),
  );
  let ticks = '';
  for (let p = 0; p <= 100; p += 10) {
    const major = p % 25 === 0 || p === 100;
    ticks += `M${sx} ${n(yOf(p))} h${major ? 7 : 4}`;
  }
  for (const p of [0, 25, 50, 75, 100])
    text('text', sx + 10, yOf(p) + 3.5, String(p), { size: 9.5, fill: C.dim });
  put('equip', tag('path', { d: ticks, stroke: C.dim, 'stroke-width': 1 }));
  // giá trị mức lớn giữa bồn
  const big = uid(`${id}_muc_lon`, `Mức ${name} (giữa bồn)`);
  text('text', x + w / 2, y + h / 2 + 10, '--', {
    uid: big,
    size: 28,
    weight: 800,
    anchor: 'middle',
    fill: '#ffffff',
  });
  B.value(big, levelTag, 1, ' %');
}

// ---- Bản vẽ -------------------------------------------------------------------------------------------------------
const W = 1600;
const H = 900;

// Nền + lưới mờ
put('bg', tag('rect', { width: W, height: H, fill: C.bg }));
put('bg', tag('rect', { width: W, height: H, fill: 'url(#p-grid)' }));

// Tiêu đề
put('bg', tag('rect', { width: W, height: 64, fill: 'url(#g-header)' }));
put('bg', tag('path', { d: `M0 64.5 H${W}`, stroke: '#d5dbe0', 'stroke-width': 1 }));
put('bg', tag('rect', { x: 20, y: 14, width: 36, height: 36, rx: 9, fill: 'url(#g-logo)' }));
put(
  'bg',
  tag('path', {
    d: 'M38 21 C38 21 29 31.5 29 37 a9 9 0 0 0 18 0 C47 31.5 38 21 38 21 Z',
    fill: '#ffffff',
    'fill-opacity': 0.95,
  }),
);
text('bg', 68, 33, 'TRẠM BƠM NƯỚC SẠCH', { size: 19, weight: 800, ls: 0.6, fill: C.text });
text('bg', 68, 52, 'Sơ đồ công nghệ · Công suất thiết kế 3.000 m³/ngày đêm', {
  size: 12,
  fill: C.muted,
});

function chip(x, w, label, id, name, tagId, decimals, suffix, fillBinding) {
  const r = uid(`${id}_nen`, `Nền ${name}`);
  put(
    'bg',
    tag('rect', {
      ...r,
      x,
      y: 13,
      width: w,
      height: 38,
      rx: 8,
      fill: '#ffffff',
      stroke: '#d5dbe0',
    }),
  );
  if (fillBinding) fillBinding(r);
  text('bg', x + 12, 27, label, { size: 10, weight: 500, fill: C.muted });
  const v = uid(id, name);
  text('bg', x + w - 12, 44, '--', { uid: v, size: 15, weight: 700, anchor: 'end', fill: C.text });
  B.value(v, tagId, decimals, suffix);
}
chip(1100, 150, 'Bơm đang chạy', 'hdr_bom_chay', 'Số bơm đang chạy', 'RUN.COUNT', 0, ' / 6');
chip(1262, 120, 'Cảnh báo', 'hdr_canh_bao', 'Số cảnh báo', 'ALARM.COUNT', 0, '', (r) =>
  bind(r, {
    target: 'style.fill',
    source: src('ALARM.COUNT'),
    transform: {
      kind: 'rangeMap',
      ranges: [
        { to: 1, value: '#ffffff' },
        { from: 1, value: '#7c2d12' },
      ],
    },
  }),
);
chip(1394, 186, 'Sản lượng hôm nay', 'hdr_san_luong', 'Sản lượng hôm nay', 'TOTAL.TODAY', 0, ' m³');

// Vùng
zone(20, 84, 150, 608, 'NGUỒN NƯỚC THÔ');
zone(182, 84, 400, 608, 'CỤM BƠM CẤP');
zone(594, 84, 250, 608, 'BỂ LẮNG');
zone(856, 84, 170, 608, 'LỌC');
zone(1038, 84, 230, 608, 'BỒN NƯỚC SẠCH');
zone(1280, 84, 300, 608, 'BƠM ĐẨY · MẠNG');
zone(20, 704, 824, 176, 'CHÚ THÍCH');
zone(856, 704, 412, 176, 'TRẠM CHÂM CLO');
zone(1280, 704, 300, 176, 'TỦ ĐIỆN MCC-01');

// ---- Đường ống (vẽ trước thiết bị) ----
const FEED = [
  ['P-101', 240],
  ['P-102', 400],
  ['P-103', 560],
];
const DIST = [
  ['P-201', 440],
  ['P-202', 580],
];
const PX = 320; // tâm bơm cấp
const DX = 1390; // tâm bơm đẩy

pipe('M143 560 H206 V240', 'raw', {
  id: 'ong_hut_chung',
  name: 'Dòng chảy ống hút chung',
  rate: 'FIT101.FLOW',
});
for (const [p, y] of FEED) {
  const pre = p.replace('-', '');
  pipe(`M206 ${y} H${PX - 26}`, 'raw', {
    id: `ong_hut_${pre.toLowerCase()}`,
    name: `Dòng chảy ống hút ${p}`,
    state: `${pre}.STATE`,
  });
  pipe(`M${PX + 30} ${y - 20} H500`, 'raw', {
    id: `ong_xa_${pre.toLowerCase()}`,
    name: `Dòng chảy ống xả ${p}`,
    state: `${pre}.STATE`,
  });
}
pipe('M500 540 V160 H660 V200', 'raw', {
  id: 'ong_vao_be_lang',
  name: 'Dòng chảy vào bể lắng',
  rate: 'FIT101.FLOW',
});
pipe('M790 610 H870 V222 H941 V252', 'raw', {
  id: 'ong_vao_loc',
  name: 'Dòng chảy vào bể lọc',
  rate: 'F101.FLOW',
});
pipe('M941 558 V600 H1030 V170 H1100 V200', 'clean', {
  id: 'ong_ra_loc',
  name: 'Dòng chảy sau lọc',
  rate: 'F101.FLOW',
});
pipe('M1220 600 H1300 V440', 'clean', {
  id: 'ong_hut_day',
  name: 'Dòng chảy ống hút bơm đẩy',
  rate: 'FIT201.FLOW',
});
for (const [p, y] of DIST) {
  const pre = p.replace('-', '');
  pipe(`M1300 ${y} H${DX - 26}`, 'clean', {
    id: `ong_hut_${pre.toLowerCase()}`,
    name: `Dòng chảy ống hút ${p}`,
    state: `${pre}.STATE`,
  });
  pipe(`M${DX + 30} ${y - 20} H1490`, 'clean', {
    id: `ong_xa_${pre.toLowerCase()}`,
    name: `Dòng chảy ống xả ${p}`,
    state: `${pre}.STATE`,
  });
}
pipe('M1490 560 V170 H1572', 'clean', {
  id: 'ong_ra_mang',
  name: 'Dòng chảy ra mạng',
  rate: 'FIT201.FLOW',
});
pipe('M944 838 H994', 'chem', {
  id: 'ong_hut_clo',
  name: 'Dòng hóa chất vào bơm định lượng',
  state: 'P301.STATE',
});
pipe('M1010 822 V606', 'chem', {
  id: 'ong_chau_clo',
  name: 'Dòng hóa chất châm vào ống',
  state: 'P301.STATE',
});

// Mũi tên chiều chảy
arrow(176, 560, 'right', 'raw');
arrow(206, 480, 'up', 'raw');
for (const [, y] of FEED) arrow(478, y - 20, 'right', 'raw');
arrow(500, 300, 'up', 'raw');
arrow(590, 160, 'right', 'raw');
arrow(830, 610, 'right', 'raw');
arrow(870, 420, 'up', 'raw');
arrow(975, 600, 'right', 'clean');
arrow(1030, 400, 'up', 'clean');
arrow(1066, 170, 'right', 'clean');
arrow(1262, 600, 'right', 'clean');
arrow(1300, 520, 'up', 'clean');
arrow(1490, 330, 'up', 'clean');
put(
  'arrows',
  tag('path', {
    d: 'M1570 158 L1590 170 L1570 182 Z',
    fill: PIPE.clean.core,
    stroke: C.outline,
    'stroke-width': 1.2,
  }),
);
arrow(1010, 700, 'up', 'chem');

// ---- Nguồn nước thô ----
dataBox(32, 128, 126, 'Mức hồ', 'lt001_muc', 'Mức hồ chứa', 'LT001.M', 2, ' m');
dataBox(32, 174, 126, 'Độ đục', 'ait001_duc', 'Độ đục nước thô', 'AIT001.NTU', 1, ' NTU');
dataBox(32, 220, 126, 'pH', 'ait002_ph', 'pH nước thô', 'AIT002.PH', 2);
text('text', 95, 316, 'Hồ chứa nước thô', {
  size: 11,
  weight: 600,
  anchor: 'middle',
  fill: C.muted,
});
{
  // bờ hồ hình thang, nước cắt theo mức
  const wallL = (y) => 36 + (16 * (y - 330)) / 270;
  const wallR = (y) => 156 - (16 * (y - 330)) / 270;
  const water = uid('ho_nuoc', 'Nước hồ chứa');
  put(
    'equip',
    tag('path', {
      ...water,
      d: `M${n(wallL(336))} 336 L${n(wallL(596))} 596 H${n(wallR(596))} L${n(wallR(336))} 336 Z`,
      fill: 'url(#g-raw)',
    }),
  );
  B.clipLevel(water, 'LT001.LEVEL');
  put(
    'equip',
    tag('path', {
      d: `M36 330 L52 600 H140 L156 330`,
      fill: 'none',
      stroke: '#929ba1',
      'stroke-width': 4,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }),
  );
  for (const yy of [452, 470])
    put(
      'equip',
      tag('path', {
        d: `M56 ${yy} q 8 -5 16 0 t 16 0 t 16 0 t 16 0`,
        fill: 'none',
        stroke: '#f4e2c8',
        'stroke-opacity': 0.35,
        'stroke-width': 1.5,
        'stroke-linecap': 'round',
      }),
    );
  text('text', 96, 530, 'NƯỚC THÔ', {
    size: 10,
    weight: 700,
    ls: 1,
    anchor: 'middle',
    fill: '#fbeedd',
    opacity: 0.75,
  });
  text('text', 96, 630, 'Cửa thu có lưới chắn rác', { size: 10, anchor: 'middle', fill: C.dim });
}

// ---- Cụm bơm cấp ----
for (const [p, y] of FEED) {
  gateValve(244, y);
  checkValve(398, y - 20);
  gateValve(448, y - 20);
  pump(PX, y, p, `Bơm cấp ${p.slice(-1)}`);
}
flowMeter(540, 160);
bubble(540, 118, 'FT', '101', 'M540 133 V149');
dataBox(
  392,
  99,
  126,
  'Lưu lượng vào',
  'fit101_ll',
  'Lưu lượng nước thô',
  'FIT101.FLOW',
  1,
  ' m³/h',
);
motorValve(616, 160, 'xv101', 'XV-101', 'XV101.OPEN');

// ---- Bể lắng ----
const MARKS = [
  ['HH', 90, C.fault],
  ['H', 80, C.warn],
  ['L', 20, C.warn],
  ['LL', 10, C.fault],
];
tank(640, 200, 150, 440, 't101', 'bể lắng T-101', 'LIT101.LEVEL', 'g-raw', MARKS);
text('text', 676, 190, 'T-101 · 450 m³', { size: 11, weight: 600, fill: C.muted });
dataBox(640, 648, 150, 'Mức bể lắng', 'lit101_muc', 'Mức bể lắng', 'LIT101.LEVEL', 1, ' %', 36);
warnIcon(822, 186, 'lit101_cao', 'Cảnh báo mức cao bể lắng', 'LIT101.HI');

// ---- Lọc ----
{
  put('equip', `<g${attrs({ filter: 'url(#f-shadow)' })}>`);
  put(
    'equip',
    tag('rect', {
      x: 900,
      y: 252,
      width: 82,
      height: 306,
      rx: 41,
      fill: 'url(#g-tank)',
      stroke: '#929ba1',
      'stroke-width': 2,
    }),
  );
  put('equip', '</g>');
  put(
    'equip',
    tag('rect', { x: 904, y: 300, width: 74, height: 116, fill: '#3b6e94', 'fill-opacity': 0.55 }),
  );
  put('equip', tag('rect', { x: 904, y: 416, width: 74, height: 70, fill: '#c7a46a' }));
  put('equip', tag('rect', { x: 904, y: 486, width: 74, height: 26, fill: '#6d7a86' }));
  put('equip', tag('rect', { x: 904, y: 300, width: 74, height: 212, fill: 'url(#g-shade)' }));
  put(
    'equip',
    tag('path', {
      d: 'M904 416 H978 M904 486 H978 M904 512 H978',
      stroke: '#2d353c',
      'stroke-opacity': 0.5,
      'stroke-width': 1,
    }),
  );
  put(
    'equip',
    tag('path', {
      d: 'M914 290 H968',
      stroke: C.metalStroke,
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-dasharray': '3 4',
    }),
  );
  text('equip', 941, 455, 'CÁT', {
    size: 9.5,
    weight: 800,
    ls: 1,
    anchor: 'middle',
    fill: '#3b2a10',
  });
  text('equip', 941, 503, 'SỎI', {
    size: 9,
    weight: 800,
    ls: 1,
    anchor: 'middle',
    fill: '#e2e8ee',
  });
  put(
    'equip',
    tag('rect', {
      x: 900,
      y: 252,
      width: 82,
      height: 306,
      rx: 41,
      fill: 'none',
      stroke: '#929ba1',
      'stroke-width': 2,
    }),
  );
  text('text', 941, 206, 'F-101 · Lọc nhanh', {
    size: 11,
    weight: 600,
    anchor: 'middle',
    fill: C.muted,
  });
  dataBox(
    866,
    648,
    110,
    'Chênh áp lọc',
    'pdt101_dp',
    'Chênh áp bể lọc',
    'FILTER.DP',
    2,
    ' bar',
    36,
  );
}

// ---- Bồn nước sạch ----
tank(1080, 200, 140, 440, 't201', 'bồn nước sạch T-201', 'LIT201.LEVEL', 'g-clean', MARKS);
text('text', 1116, 190, 'T-201 · 300 m³', { size: 11, weight: 600, fill: C.muted });
dataBox(
  1080,
  648,
  140,
  'Mức bồn sạch',
  'lit201_muc',
  'Mức bồn nước sạch',
  'LIT201.LEVEL',
  1,
  ' %',
  36,
);
warnIcon(1252, 186, 'lit201_thap', 'Cảnh báo mức thấp bồn sạch', 'LIT201.LO');

// ---- Bơm đẩy và mạng ----
for (const [p, y] of DIST) {
  gateValve(1330, y);
  checkValve(1456, y - 20);
  pump(DX, y, p, `Bơm đẩy ${p.slice(-1)}`);
}
dataBox(
  1296,
  118,
  160,
  'Lưu lượng ra mạng',
  'fit201_ll',
  'Lưu lượng ra mạng',
  'FIT201.FLOW',
  1,
  ' m³/h',
);
dataBox(1296, 164, 160, 'Áp suất mạng', 'pit201_ap', 'Áp suất mạng', 'PIT201.PRESS', 2, ' bar');
flowMeter(1532, 170);
bubble(1532, 126, 'FT', '201', 'M1532 141 V159');
bubble(1540, 262, 'PT', '201', 'M1496 262 H1525');
text('text', 1578, 202, 'Ra mạng', { size: 10.5, weight: 600, anchor: 'end', fill: C.muted });

// ---- Trạm châm Clo ----
{
  const x = 884;
  const y = 752;
  const w = 60;
  const h = 110;
  put(
    'equip',
    tag('rect', {
      x,
      y,
      width: w,
      height: h,
      rx: 8,
      fill: 'url(#g-tank)',
      stroke: '#929ba1',
      'stroke-width': 2,
    }),
  );
  const liq = uid('t301_long', 'Hóa chất trong bồn T-301');
  put(
    'equip',
    tag('rect', {
      ...liq,
      x: x + 3,
      y: y + 3,
      width: w - 6,
      height: h - 6,
      rx: 6,
      fill: 'url(#g-chem)',
    }),
  );
  B.level(liq, 'LIT301.LEVEL');
  put(
    'equip',
    tag('rect', { x: x + 3, y: y + 3, width: w - 6, height: h - 6, rx: 6, fill: 'url(#g-shade)' }),
  );
  put(
    'equip',
    tag('rect', {
      x,
      y,
      width: w,
      height: h,
      rx: 8,
      fill: 'none',
      stroke: '#929ba1',
      'stroke-width': 2,
    }),
  );
  text('equip', x + w / 2, y + 60, 'NaOCl', {
    size: 10,
    weight: 800,
    anchor: 'middle',
    fill: '#2b2203',
  });
  pump(1010, 838, 'P-301', 'Bơm định lượng Clo', { r: 16, small: true, popup: false });
  text('text', 988, 868, 'P-301', { size: 11, weight: 700, anchor: 'end', fill: C.text });
  dataBox(1050, 732, 128, 'Clo dư (sau lọc)', 'ait301_clo', 'Clo dư', 'AIT301.CL', 2, ' mg/L', 36);
  dataBox(
    1050,
    776,
    128,
    'Mức NaOCl',
    'lit301_muc',
    'Mức bồn hóa chất',
    'LIT301.LEVEL',
    0,
    ' %',
    36,
  );
  dataBox(
    1050,
    820,
    128,
    'Định lượng',
    'p301_ll',
    'Lưu lượng châm Clo',
    'P301.RATE',
    2,
    ' L/h',
    36,
  );
  bubble(1226, 770, 'AIT', '301', 'M1250 607 V700 M1226 755 V704');
  warnIcon(1226, 830, 'ait301_thap', 'Cảnh báo Clo dư thấp', 'AIT301.LO');
}

// ---- Tủ MCC ----
{
  const u = uid('mcc_u', 'Điện áp MCC');
  text('text', 1470, 728, '--', { uid: u, size: 12, weight: 700, anchor: 'end', fill: C.text });
  B.value(u, 'MCC.U', 0, ' V');
  const pw = uid('mcc_p', 'Công suất MCC');
  text('text', 1566, 728, '--', { uid: pw, size: 12, weight: 700, anchor: 'end', fill: C.text });
  B.value(pw, 'MCC.P', 1, ' kW');
  put(
    'equip',
    tag('rect', {
      x: 1294,
      y: 740,
      width: 272,
      height: 126,
      rx: 6,
      fill: '#ffffff',
      stroke: '#d5dbe0',
    }),
  );
  const FEEDERS = ['P-101', 'P-102', 'P-103', 'P-201', 'P-202', 'P-301'];
  FEEDERS.forEach((p, i) => {
    const cx = 1302 + (i % 3) * 88;
    const cy = 748 + Math.floor(i / 3) * 60;
    const pre = p.replace('-', '');
    put(
      'equip',
      tag('rect', { x: cx, y: cy, width: 80, height: 52, rx: 4, fill: C.box, stroke: C.boxStroke }),
    );
    const lamp = uid(`q${i + 1}_den`, `Đèn ngăn Q${i + 1}`);
    put(
      'equip',
      tag('circle', { ...lamp, cx: cx + 13, cy: cy + 15, r: 5, fill: C.stop, stroke: C.outline }),
    );
    B.stateFill(lamp, `${pre}.STATE`, C.stop, C.run, C.fault);
    text('equip', cx + 24, cy + 19, `Q${i + 1} · ${p}`, { size: 10, weight: 600, fill: C.muted });
    const cur = uid(`q${i + 1}_dong`, `Dòng điện ngăn Q${i + 1}`);
    text('equip', cx + 72, cy + 42, '--', {
      uid: cur,
      size: 13,
      weight: 700,
      anchor: 'end',
      fill: C.text,
    });
    B.value(cur, `${pre}.CURRENT`, 1, ' A');
  });
}

// ---- Chú thích ----
{
  const y0 = 752;
  const dy = 32;
  const rows = [
    ['raw', 'Nước thô, nước lắng'],
    ['clean', 'Nước sạch'],
    ['chem', 'Hóa chất (NaOCl)'],
  ];
  rows.forEach(([k, label], i) => {
    const y = y0 + i * dy;
    const d = `M40 ${y} H100`;
    put('equip', tag('path', { d, stroke: C.outline, 'stroke-width': 12 }));
    put('equip', tag('path', { d, stroke: PIPE[k].core, 'stroke-width': 7 }));
    text('equip', 114, y + 4, label, { size: 11.5, fill: C.text });
  });
  {
    const y = y0 + 3 * dy;
    const d = `M40 ${y} H100`;
    put('equip', tag('path', { d, stroke: C.outline, 'stroke-width': 12 }));
    put('equip', tag('path', { d, stroke: PIPE.clean.core, 'stroke-width': 7 }));
    put(
      'equip',
      tag('path', {
        d,
        stroke: PIPE.clean.flow,
        'stroke-width': 3,
        'stroke-dasharray': '8 14',
        'stroke-linecap': 'round',
        opacity: 0.9,
      }),
    );
    text('equip', 114, y + 4, 'Dòng chảy (khi có lưu lượng)', { size: 11.5, fill: C.text });
  }
  const states = [
    [C.pillRun, 'Chạy', 'Thiết bị đang chạy'],
    [C.pillStop, 'Dừng', 'Thiết bị dừng'],
    [C.pillFault, 'Lỗi', 'Lỗi thiết bị (nhấp nháy)'],
  ];
  states.forEach(([col, s, label], i) => {
    const y = y0 + i * dy;
    put('equip', tag('rect', { x: 316, y: y - 9, width: 52, height: 18, rx: 9, fill: col }));
    text('equip', 342, y + 3.5, s, { size: 10.5, weight: 700, anchor: 'middle', fill: '#ffffff' });
    text('equip', 380, y + 4, label, { size: 11.5, fill: C.text });
  });
  {
    const y = y0 + 3 * dy;
    put(
      'equip',
      tag('path', {
        d: `M342 ${y - 10} L353 ${y + 9} H331 Z`,
        fill: C.warn,
        stroke: C.outline,
        'stroke-width': 1.2,
        'stroke-linejoin': 'round',
      }),
    );
    put(
      'equip',
      tag('path', {
        d: `M342 ${y - 3} V${y + 3}`,
        stroke: '#1a1204',
        'stroke-width': 2.2,
        'stroke-linecap': 'round',
      }),
    );
    put('equip', tag('circle', { cx: 342, cy: y + 6.5, r: 1.3, fill: '#1a1204' }));
    text('equip', 380, y + 4, 'Cảnh báo quá trình (mức, Clo)', { size: 11.5, fill: C.text });
  }
  // ký hiệu
  const sx = 600;
  {
    const y = y0;
    put(
      'equip',
      tag('circle', {
        cx: sx,
        cy: y,
        r: 10,
        fill: 'url(#g-pump)',
        stroke: C.run,
        'stroke-width': 2,
      }),
    );
    put(
      'equip',
      tag('path', {
        d: `M${sx} ${y} q 4 -1 5 -5 M${sx} ${y} q -1 4 -5 5`,
        stroke: '#56616b',
        'stroke-width': 1.6,
        'stroke-linecap': 'round',
        fill: 'none',
      }),
    );
    text('equip', sx + 32, y + 4, 'Bơm (nhấp để mở bảng điều khiển)', { size: 11.5, fill: C.text });
  }
  {
    const y = y0 + dy;
    put(
      'equip',
      tag('path', {
        d: bowtie(sx - 8, y, 9, 7),
        fill: 'url(#g-metal)',
        stroke: C.metalStroke,
        'stroke-width': 1,
      }),
    );
    put(
      'equip',
      tag('path', {
        d: bowtie(sx + 14, y, 9, 7),
        fill: '#e9edf0',
        stroke: C.metalStroke,
        'stroke-width': 1,
      }),
    );
    put(
      'equip',
      tag('path', {
        d: `M${sx + 5} ${y - 7} L${sx + 14} ${y} L${sx + 5} ${y + 7} Z`,
        fill: C.metalStroke,
      }),
    );
    text('equip', sx + 32, y + 4, 'Van chặn · van một chiều', { size: 11.5, fill: C.text });
  }
  {
    const y = y0 + 2 * dy;
    put(
      'equip',
      tag('path', {
        d: bowtie(sx, y + 3, 9, 6),
        fill: C.run,
        stroke: C.metalStroke,
        'stroke-width': 1,
      }),
    );
    put(
      'equip',
      tag('rect', {
        x: sx - 7,
        y: y - 12,
        width: 14,
        height: 9,
        rx: 2,
        fill: 'url(#g-metal)',
        stroke: C.metalStroke,
        'stroke-width': 1,
      }),
    );
    text('equip', sx + 32, y + 4, 'Van điện: xanh mở, xám đóng', { size: 11.5, fill: C.text });
  }
  {
    const y = y0 + 3 * dy;
    put(
      'equip',
      tag('circle', {
        cx: sx,
        cy: y,
        r: 11,
        fill: C.box,
        stroke: C.metalStroke,
        'stroke-width': 1.2,
      }),
    );
    put(
      'equip',
      tag('path', { d: `M${sx - 11} ${y} H${sx + 11}`, stroke: C.metalStroke, 'stroke-width': 1 }),
    );
    text('equip', sx + 32, y + 4, 'Thiết bị đo (FT, PT, AIT)', { size: 11.5, fill: C.text });
  }
}

// ---- Ghép tệp ----
const defs = `<defs>
<pattern id="p-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${C.grid}" stroke-width="1"/></pattern>
<linearGradient id="g-header" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f2f3f4"/></linearGradient>
<linearGradient id="g-logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00acac"/><stop offset="1" stop-color="#348fe2"/></linearGradient>
<linearGradient id="g-tank" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e9edf0"/><stop offset="0.42" stop-color="#ffffff"/><stop offset="1" stop-color="#dde3e8"/></linearGradient>
<linearGradient id="g-shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000000" stop-opacity="0.38"/><stop offset="0.3" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.42"/></linearGradient>
<linearGradient id="g-raw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b48d5f"/><stop offset="1" stop-color="#6a4c2e"/></linearGradient>
<linearGradient id="g-clean" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4cb4f2"/><stop offset="1" stop-color="#0f4f8a"/></linearGradient>
<linearGradient id="g-chem" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d34e"/><stop offset="1" stop-color="#a27c0b"/></linearGradient>
<linearGradient id="g-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef1f4"/><stop offset="0.5" stop-color="#c5ced5"/><stop offset="1" stop-color="#9aa6b0"/></linearGradient>
<radialGradient id="g-pump" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#d5dbe0"/><stop offset="1" stop-color="#aab5be"/></radialGradient>
<filter id="f-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.55"/></filter>
</defs>`;

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
  defs,
  `<g data-mat-layer="Nền">`,
  ...layers.bg,
  `</g>`,
  `<g data-mat-layer="Đường ống" filter="url(#f-shadow)">`,
  ...layers.pipes,
  `</g>`,
  `<g data-mat-layer="Dòng chảy">`,
  ...layers.flow,
  ...layers.arrows,
  `</g>`,
  `<g data-mat-layer="Thiết bị">`,
  ...layers.equip,
  `</g>`,
  `<g data-mat-layer="Nhãn và cảnh báo">`,
  ...layers.text,
  `</g>`,
  `</svg>`,
  '',
].join('\n');

// ---- Project ------------------------------------------------------------------------------------------------------
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
const files = {};
files[SVG_FILE] = svg;

const elementList = [...elements.entries()]
  .filter(([u]) => bound.has(u))
  .map(([elementUid, name]) => ({ elementUid, name }));
const bindingSet = (screenId, itemId) => ({
  schemaVersion: VERSION,
  screenId,
  itemId,
  elements: [...bound.values()],
});

const svgItem = (id, name, screenId, extra) => ({
  id,
  name,
  type: 'svg',
  ...extra,
  svgFile: SVG_FILE,
  bindingFile: `screens/${screenId}.${id}.bindings.json`,
  viewBox: [0, 0, W, H],
  elements: elementList,
});

files['screens/so-do-cong-nghe.screen.json'] = json({
  schemaVersion: VERSION,
  id: 'so-do-cong-nghe',
  name: 'Sơ đồ công nghệ',
  size: { width: 1920, height: 1080 },
  background: C.bg,
  items: [
    svgItem('so_do', 'Sơ đồ công nghệ', 'so-do-cong-nghe', {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    }),
  ],
});
files['screens/so-do-cong-nghe.so_do.bindings.json'] = json(bindingSet('so-do-cong-nghe', 'so_do'));

files['screens/tong-quan.screen.json'] = json({
  schemaVersion: VERSION,
  id: 'tong-quan',
  name: 'Tổng quan',
  size: { width: 1920, height: 1080 },
  layout: {
    mode: 'grid',
    columns: 12,
    gap: 12,
    padding: 16,
    rows: [
      {
        id: 'r1',
        height: 116,
        cells: [
          { id: 'c1', span: 3, item: 'the_ll_vao' },
          { id: 'c2', span: 3, item: 'the_ll_ra' },
          { id: 'c3', span: 3, item: 'the_ap_suat' },
          { id: 'c4', span: 3, item: 'the_clo' },
        ],
      },
      {
        id: 'r2',
        height: 630,
        cells: [
          { id: 'c5', span: 8, item: 'so_do' },
          { id: 'c6', span: 4, item: 'xu_huong' },
        ],
      },
      {
        id: 'r3',
        height: 190,
        cells: [
          { id: 'c7', span: 6, item: 'dong_dien' },
          { id: 'c8', span: 6, item: 'bang_tag' },
        ],
      },
    ],
  },
  items: [
    {
      id: 'the_ll_vao',
      type: 'widget',
      widget: 'stat-tile',
      props: { label: 'Lưu lượng nước thô', color: 'cyan', icon: 'wave', trend: true },
      tags: { value: 'FIT101.FLOW' },
    },
    {
      id: 'the_ll_ra',
      type: 'widget',
      widget: 'stat-tile',
      props: { label: 'Lưu lượng ra mạng', color: 'blue', icon: 'droplet', trend: true },
      tags: { value: 'FIT201.FLOW' },
    },
    {
      id: 'the_ap_suat',
      type: 'widget',
      widget: 'stat-tile',
      props: { label: 'Áp suất mạng', decimals: 2, color: 'violet', icon: 'pressure', trend: true },
      tags: { value: 'PIT201.PRESS' },
    },
    {
      id: 'the_clo',
      type: 'widget',
      widget: 'stat-tile',
      props: { label: 'Clo dư', decimals: 2, color: 'orange', icon: 'gas' },
      tags: { value: 'AIT301.CL', alarm: 'AIT301.LO' },
    },
    svgItem('so_do', 'Sơ đồ công nghệ', 'tong-quan', {}),
    {
      id: 'xu_huong',
      type: 'widget',
      widget: 'line',
      props: {
        title: 'Xu hướng mức bồn',
        windowSec: 60,
        labels: ['Bể lắng T-101', 'Bồn sạch T-201'],
        yMin: 0,
        yMax: 100,
        highLimit: 80,
        lowLimit: 25,
        xLabel: 'Thời gian',
        yLabel: '%',
      },
      tags: { series: ['LIT101.LEVEL', 'LIT201.LEVEL'] },
    },
    {
      id: 'dong_dien',
      type: 'widget',
      widget: 'bar',
      props: {
        title: 'Dòng điện động cơ (A)',
        labels: ['P-101', 'P-102', 'P-103', 'P-201', 'P-202', 'P-301'],
      },
      tags: {
        series: [
          'P101.CURRENT',
          'P102.CURRENT',
          'P103.CURRENT',
          'P201.CURRENT',
          'P202.CURRENT',
          'P301.CURRENT',
        ],
      },
    },
    {
      id: 'bang_tag',
      type: 'widget',
      widget: 'tag-table',
      props: { title: 'Giá trị quá trình', dense: true },
      tags: {
        rows: [
          'FIT101.FLOW',
          'FIT201.FLOW',
          'PIT201.PRESS',
          'LIT101.LEVEL',
          'LIT201.LEVEL',
          'AIT301.CL',
          'FILTER.DP',
        ],
      },
    },
  ],
});
files['screens/tong-quan.so_do.bindings.json'] = json(bindingSet('tong-quan', 'so_do'));

files['screens/faceplate-bom.screen.json'] = json({
  schemaVersion: VERSION,
  id: 'faceplate-bom',
  name: 'Bảng điều khiển bơm',
  kind: 'popup',
  size: { width: 560, height: 400 },
  params: [
    { name: 'prefix', kind: 'tagPrefix' },
    { name: 'title', kind: 'string', default: 'Bơm' },
  ],
  items: [
    {
      id: 'khung',
      name: 'Khung',
      type: 'widget',
      widget: 'panel',
      x: 0,
      y: 0,
      width: 560,
      height: 400,
      props: { title: '{title}' },
    },
    {
      id: 'den_chay',
      name: 'Đèn chạy',
      type: 'widget',
      widget: 'lamp',
      x: 20,
      y: 60,
      width: 250,
      height: 40,
      props: { label: 'Đang chạy', onColor: C.run },
      tags: { state: '{prefix}.RUN' },
    },
    {
      id: 'den_loi',
      name: 'Đèn lỗi',
      type: 'widget',
      widget: 'lamp',
      x: 290,
      y: 60,
      width: 250,
      height: 40,
      props: { label: 'Lỗi', onColor: C.fault },
      tags: { state: '{prefix}.FAULT' },
    },
    {
      id: 'dong_dien',
      name: 'Dòng điện',
      type: 'widget',
      widget: 'card',
      x: 20,
      y: 116,
      width: 250,
      height: 100,
      props: { label: 'Dòng điện động cơ', decimals: 1 },
      tags: { value: '{prefix}.CURRENT' },
    },
    {
      id: 'gio_chay',
      name: 'Giờ chạy',
      type: 'widget',
      widget: 'card',
      x: 290,
      y: 116,
      width: 250,
      height: 100,
      props: { label: 'Giờ chạy tích lũy', decimals: 0 },
      tags: { value: '{prefix}.HOURS' },
    },
    {
      id: 'che_do',
      name: 'Chế độ',
      type: 'widget',
      widget: 'select',
      x: 20,
      y: 232,
      width: 250,
      height: 72,
      props: { label: 'Chế độ' },
      tags: { target: '{prefix}.MODE' },
    },
    {
      id: 'lenh_chay',
      name: 'Lệnh chạy',
      type: 'widget',
      widget: 'switch',
      x: 290,
      y: 244,
      width: 250,
      height: 48,
      props: { label: 'Lệnh chạy (chế độ tay)', onText: 'Chạy', offText: 'Dừng' },
      tags: { target: '{prefix}.CMD' },
    },
    {
      id: 'dong',
      name: 'Đóng',
      type: 'widget',
      widget: 'button',
      x: 360,
      y: 330,
      width: 180,
      height: 48,
      props: { label: 'Đóng', variant: 'neutral' },
      events: { click: { action: 'closePopup' } },
    },
  ],
});

// ---- Tag ----
const sim = (id, type, desc, s, extra = {}) => ({
  id,
  kind: 'simulation',
  type,
  description: desc,
  ...extra,
  sim: s,
});
const calc = (id, type, desc, expression, extra = {}) => ({
  id,
  kind: 'calculated',
  type,
  description: desc,
  ...extra,
  expression,
});
const tags = [
  sim('SIM.NOISE', 'FLOAT32', 'Nhiễu đo nhỏ (mô phỏng)', {
    kind: 'sine',
    center: 0,
    amplitude: 1,
    periodMs: 7000,
  }),
  sim('SIM.NOISE2', 'FLOAT32', 'Nhiễu đo nhỏ thứ hai (mô phỏng)', {
    kind: 'sine',
    center: 0,
    amplitude: 1,
    periodMs: 11000,
    phase: 0.3,
  }),
];
const PUMPS = [
  ['P101', 'Bơm cấp 1', { periodMs: 240000, duty: 0.8 }, 'feed', 1242],
  ['P102', 'Bơm cấp 2', { periodMs: 240000, duty: 0.7, phase: 0.35 }, 'feed', 1187],
  ['P103', 'Bơm cấp 3', { periodMs: 240000, duty: 0.45, phase: 0.6 }, 'feed', 865],
  ['P201', 'Bơm đẩy 1', { periodMs: 300000, duty: 0.75 }, 'dist', 2310],
  ['P202', 'Bơm đẩy 2', { periodMs: 300000, duty: 0.5, phase: 0.5 }, 'dist', 2096],
];
for (const [p, name, sq, kind, hours] of PUMPS) {
  tags.push(
    sim(`${p}.RUN`, 'BOOL', `${name} đang chạy (mô phỏng luân phiên)`, { kind: 'square', ...sq }),
  );
  tags.push(
    p === 'P102'
      ? sim(`${p}.FAULT`, 'BOOL', `${name} lỗi (mô phỏng, thỉnh thoảng)`, {
          kind: 'square',
          periodMs: 150000,
          duty: 0.12,
          phase: 0.5,
        })
      : sim(`${p}.FAULT`, 'BOOL', `${name} lỗi`, { kind: 'const', value: false }),
  );
  tags.push(
    calc(
      `${p}.STATE`,
      'INT16',
      `Trạng thái ${name}: 0 dừng, 1 chạy, 2 lỗi`,
      `${p}.FAULT ? 2 : (${p}.RUN ? 1 : 0)`,
      { valueTable: 'TrangThaiBom' },
    ),
  );
  tags.push(
    calc(
      `${p}.CURRENT`,
      'FLOAT32',
      `Dòng điện động cơ ${name}`,
      kind === 'feed'
        ? `${p}.STATE == 1 ? 24.5 + 0.8 * SIM.NOISE : 0`
        : `${p}.STATE == 1 ? 31.2 + 1.1 * SIM.NOISE2 : 0`,
      { unit: 'A' },
    ),
  );
  tags.push(
    sim(
      `${p}.HOURS`,
      'FLOAT32',
      `Giờ chạy tích lũy ${name}`,
      { kind: 'ramp', from: hours, to: hours + 24, periodMs: 86400000 },
      { unit: 'h' },
    ),
  );
  tags.push(
    sim(
      `${p}.MODE`,
      'INT16',
      `Chế độ ${name}`,
      { kind: 'manual', initial: 1 },
      { access: 'RW', limits: { min: 0, max: 1 }, valueTable: 'CheDo' },
    ),
  );
  tags.push(
    sim(
      `${p}.CMD`,
      'BOOL',
      `Lệnh chạy tay ${name}`,
      { kind: 'manual', initial: false },
      { access: 'RW' },
    ),
  );
}
const isRun = (p) => `(${p}.STATE == 1 ? 1 : 0)`;
tags.push(
  calc('P301.RUN', 'BOOL', 'Bơm định lượng Clo chạy khi có nước vào', 'FIT101.FLOW > 1'),
  sim('P301.FAULT', 'BOOL', 'Bơm định lượng Clo lỗi', { kind: 'const', value: false }),
  calc(
    'P301.STATE',
    'INT16',
    'Trạng thái bơm định lượng Clo',
    'P301.FAULT ? 2 : (P301.RUN ? 1 : 0)',
    { valueTable: 'TrangThaiBom' },
  ),
  calc(
    'P301.CURRENT',
    'FLOAT32',
    'Dòng điện bơm định lượng Clo',
    'P301.STATE == 1 ? 1.6 + 0.05 * SIM.NOISE : 0',
    { unit: 'A' },
  ),
  calc(
    'P301.RATE',
    'FLOAT32',
    'Lưu lượng châm NaOCl',
    'P301.STATE == 1 ? FIT101.FLOW * 0.042 : 0',
    { unit: 'L/h' },
  ),
  calc(
    'FIT101.FLOW',
    'FLOAT32',
    'Lưu lượng nước thô vào bể lắng',
    `(${isRun('P101')} + ${isRun('P102')} + ${isRun('P103')}) * (48 + 1.5 * SIM.NOISE)`,
    { unit: 'm³/h', min: 0, max: 160 },
  ),
  calc('XV101.OPEN', 'BOOL', 'Van XV-101 mở', 'FIT101.FLOW > 1'),
  sim(
    'F101.FLOW',
    'FLOAT32',
    'Lưu lượng qua bể lọc (tự chảy)',
    { kind: 'sine', center: 92, amplitude: 6, periodMs: 45000 },
    { unit: 'm³/h' },
  ),
  calc(
    'FIT201.FLOW',
    'FLOAT32',
    'Lưu lượng ra mạng',
    `(${isRun('P201')} + ${isRun('P202')}) * (62 + 2 * SIM.NOISE2)`,
    { unit: 'm³/h', min: 0, max: 160 },
  ),
  calc(
    'PIT201.PRESS',
    'FLOAT32',
    'Áp suất mạng',
    'FIT201.FLOW > 1 ? 2.6 + 0.012 * FIT201.FLOW + 0.08 * SIM.NOISE : 0.4',
    { unit: 'bar', min: 0, max: 6 },
  ),
  sim(
    'LIT101.LEVEL',
    'FLOAT32',
    'Mức bể lắng T-101',
    { kind: 'sine', center: 64, amplitude: 22, periodMs: 200000 },
    { unit: '%', min: 0, max: 100 },
  ),
  calc('LIT101.HI', 'BOOL', 'Mức bể lắng cao (H)', 'LIT101.LEVEL > 80'),
  sim(
    'LIT201.LEVEL',
    'FLOAT32',
    'Mức bồn nước sạch T-201',
    { kind: 'sine', center: 52, amplitude: 30, periodMs: 260000, phase: 0.4 },
    { unit: '%', min: 0, max: 100 },
  ),
  calc('LIT201.LO', 'BOOL', 'Mức bồn nước sạch thấp (L)', 'LIT201.LEVEL < 25'),
  sim(
    'LT001.LEVEL',
    'FLOAT32',
    'Mức hồ chứa nước thô (%)',
    { kind: 'sine', center: 70, amplitude: 6, periodMs: 600000 },
    { unit: '%', min: 0, max: 100 },
  ),
  calc('LT001.M', 'FLOAT32', 'Mức hồ chứa nước thô (m)', 'LT001.LEVEL * 0.05', { unit: 'm' }),
  sim(
    'AIT001.NTU',
    'FLOAT32',
    'Độ đục nước thô',
    { kind: 'sine', center: 14, amplitude: 4, periodMs: 90000 },
    { unit: 'NTU' },
  ),
  sim('AIT002.PH', 'FLOAT32', 'pH nước thô', {
    kind: 'sine',
    center: 7.2,
    amplitude: 0.15,
    periodMs: 120000,
  }),
  sim(
    'FILTER.DP',
    'FLOAT32',
    'Chênh áp bể lọc F-101',
    { kind: 'sine', center: 0.34, amplitude: 0.06, periodMs: 150000 },
    { unit: 'bar' },
  ),
  sim(
    'AIT301.CL',
    'FLOAT32',
    'Clo dư sau lọc',
    { kind: 'sine', center: 0.55, amplitude: 0.2, periodMs: 100000 },
    { unit: 'mg/L', min: 0, max: 2 },
  ),
  calc('AIT301.LO', 'BOOL', 'Clo dư thấp', 'AIT301.CL < 0.3'),
  sim(
    'LIT301.LEVEL',
    'FLOAT32',
    'Mức bồn NaOCl T-301',
    { kind: 'sine', center: 62, amplitude: 8, periodMs: 400000 },
    { unit: '%', min: 0, max: 100 },
  ),
  sim(
    'MCC.U',
    'FLOAT32',
    'Điện áp thanh cái MCC-01',
    { kind: 'sine', center: 399, amplitude: 3, periodMs: 20000 },
    { unit: 'V' },
  ),
  calc(
    'MCC.P',
    'FLOAT32',
    'Công suất MCC-01',
    '(P101.CURRENT + P102.CURRENT + P103.CURRENT + P201.CURRENT + P202.CURRENT + P301.CURRENT) * 0.56',
    { unit: 'kW' },
  ),
  calc(
    'RUN.COUNT',
    'INT16',
    'Số bơm đang chạy',
    `${isRun('P101')} + ${isRun('P102')} + ${isRun('P103')} + ${isRun('P201')} + ${isRun('P202')} + ${isRun('P301')}`,
  ),
  calc(
    'ALARM.COUNT',
    'INT16',
    'Số cảnh báo đang có',
    '(P101.FAULT ? 1 : 0) + (P102.FAULT ? 1 : 0) + (P103.FAULT ? 1 : 0) + (P201.FAULT ? 1 : 0) + (P202.FAULT ? 1 : 0) + (LIT101.HI ? 1 : 0) + (LIT201.LO ? 1 : 0) + (AIT301.LO ? 1 : 0)',
  ),
  sim(
    'TOTAL.TODAY',
    'FLOAT32',
    'Sản lượng nước ra mạng hôm nay',
    { kind: 'ramp', from: 1180, to: 3000, periodMs: 86400000 },
    { unit: 'm³' },
  ),
);
// ---- Thư viện component (màn hình lưới "thu-vien"): mọi loại widget của catalog và mọi ký hiệu SVG của thư viện ------
// Tag DEMO.* là Tag mô phỏng chỉ dùng cho trang này; widget điều khiển ghi vào Tag nội bộ (mô phỏng thủ công, RW).
tags.push(
  sim(
    'DEMO.TEMP',
    'FLOAT32',
    'Nhiệt độ mẫu (mô phỏng)',
    { kind: 'sine', center: 55, amplitude: 25, periodMs: 90000 },
    { unit: '°C', min: 0, max: 100 },
  ),
  sim(
    'DEMO.LEVEL',
    'FLOAT32',
    'Mức mẫu (mô phỏng)',
    { kind: 'sine', center: 55, amplitude: 35, periodMs: 60000, phase: 0.2 },
    { unit: '%', min: 0, max: 100 },
  ),
  sim(
    'DEMO.PRESS',
    'FLOAT32',
    'Áp suất mẫu (mô phỏng)',
    { kind: 'sine', center: 4.2, amplitude: 1.3, periodMs: 45000 },
    { unit: 'bar', min: 0, max: 8 },
  ),
  sim(
    'DEMO.POS',
    'FLOAT32',
    'Vị trí mẫu 0–100 % (mô phỏng)',
    { kind: 'sine', center: 50, amplitude: 50, periodMs: 12000 },
    { unit: '%', min: 0, max: 100 },
  ),
  sim('DEMO.RUN', 'BOOL', 'Thiết bị mẫu đang chạy (mô phỏng)', {
    kind: 'square',
    periodMs: 40000,
    duty: 0.7,
  }),
  sim('DEMO.FAN', 'BOOL', 'Quạt mẫu đang chạy (mô phỏng)', {
    kind: 'square',
    periodMs: 30000,
    duty: 0.6,
    phase: 0.3,
  }),
  sim(
    'DEMO.CMD',
    'BOOL',
    'Lệnh mẫu (Tag nội bộ, ghi được)',
    { kind: 'manual', initial: true },
    { access: 'RW' },
  ),
  sim(
    'DEMO.SP',
    'FLOAT32',
    'Giá trị đặt mẫu (Tag nội bộ, ghi được)',
    { kind: 'manual', initial: 45 },
    { access: 'RW', unit: '°C', limits: { min: 0, max: 100 } },
  ),
  sim(
    'DEMO.SPEED',
    'FLOAT32',
    'Tốc độ đặt mẫu (Tag nội bộ, ghi được)',
    { kind: 'manual', initial: 60 },
    { access: 'RW', unit: '%', limits: { min: 0, max: 100 } },
  ),
  sim(
    'DEMO.MODE',
    'INT16',
    'Chế độ mẫu (Tag nội bộ, ghi được)',
    { kind: 'manual', initial: 1 },
    { access: 'RW', limits: { min: 0, max: 1 }, valueTable: 'CheDo' },
  ),
  // feature 029: hẹn giờ Từ–Đến (phút trong ngày)
  sim(
    'DEMO.T_START',
    'INT16',
    'Giờ bắt đầu mẫu (phút trong ngày)',
    { kind: 'manual', initial: 360 },
    { access: 'RW', limits: { min: 0, max: 1439 } },
  ),
  sim(
    'DEMO.T_END',
    'INT16',
    'Giờ kết thúc mẫu (phút trong ngày)',
    { kind: 'manual', initial: 1080 },
    { access: 'RW', limits: { min: 0, max: 1439 } },
  ),
);

const LIB = 'thu-vien';
/** Ký hiệu mẫu của tools/symbol-data (dữ liệu riêng của bộ sinh, Studio không có thư viện ký hiệu): tệp SVG sao nguyên vào graphics/symbols/. */
const SYMBOL_DIR = join(ROOT, 'tools/symbol-data');
const manifest = JSON.parse(readFileSync(join(SYMBOL_DIR, 'manifest.json'), 'utf8'));
const lin = (inMin, inMax, outMin, outMax) => ({
  kind: 'linearScale',
  inMin,
  inMax,
  outMin,
  outMax,
  clamp: true,
});
const disc = (cases, dflt) => ({
  kind: 'discreteMap',
  cases: cases.map(([equals, value]) => ({ equals, value })),
  ...(dflt !== undefined ? { default: dflt } : {}),
});
const stateFillT = disc(
  [
    [0, C.stop],
    [1, C.run],
    [2, C.fault],
  ],
  C.stop,
);
const boolFillT = (on, off = C.stop) =>
  disc([
    [true, on],
    [false, off],
  ]);
const SPIN = (tagId, on) => ({
  target: 'transform.rotate',
  source: src(tagId),
  transform: disc([[on, 900]], 0),
  animation: 'spin',
});
const TEXT = (tagId, decimals, suffix) => ({
  target: 'text.content',
  source: src(tagId),
  transform: { kind: 'direct' },
  format: { decimals, suffix },
});
const LEVEL = (tagId) => ({
  target: 'geometry.levelPercent',
  source: src(tagId),
  transform: { kind: 'direct' },
});
const FILL = (tagId, transform) => ({ target: 'style.fill', source: src(tagId), transform });
const FLOW = (tagId) => [
  { target: 'effect.flow', source: src(tagId), transform: lin(0, 150, 0, 80) },
  {
    target: 'style.opacity',
    source: src(tagId),
    transform: {
      kind: 'rangeMap',
      ranges: [
        { to: 0.5, value: 0.15 },
        { from: 0.5, value: 1 },
      ],
    },
  },
];
const BLINK = (tagId) => ({
  target: 'effect.blink',
  source: src(tagId),
  transform: disc([[2, 1]], 0),
  period: 800,
  mode: 'opacity',
  minOpacity: 0.25,
});
/** Binding theo bộ phận (role) của từng ký hiệu. */
const SYMBOL_BIND = {
  'tank-vertical': { liquid: [LEVEL('DEMO.LEVEL')], text: [TEXT('DEMO.LEVEL', 0, ' %')] },
  'tank-horizontal': { liquid: [LEVEL('LIT201.LEVEL')], text: [TEXT('LIT201.LEVEL', 0, ' %')] },
  'pump-centrifugal': {
    impeller: [SPIN('P101.STATE', 1)],
    lamp: [FILL('P101.STATE', stateFillT), BLINK('P101.STATE')],
  },
  'pump-dosing': {
    plunger: [
      { target: 'transform.translateX', source: src('DEMO.POS'), transform: lin(0, 100, -8, 8) },
    ],
    lamp: [FILL('P301.STATE', stateFillT)],
  },
  'valve-gate': {
    handwheel: [
      { target: 'transform.rotate', source: src('DEMO.POS'), transform: lin(0, 100, 0, 360) },
    ],
    body: [FILL('XV101.OPEN', boolFillT(C.run))],
  },
  'valve-control': {
    stem: [
      { target: 'transform.translateY', source: src('DEMO.POS'), transform: lin(0, 100, 0, -10) },
    ],
    actuator: [
      FILL('DEMO.POS', {
        kind: 'rangeMap',
        ranges: [
          { to: 50, value: C.stop },
          { from: 50, value: C.run },
        ],
      }),
    ],
  },
  'valve-check': {
    arrow: [
      {
        target: 'style.visibility',
        source: src('DEMO.RUN'),
        transform: disc([
          [true, 'visible'],
          [false, 'hidden'],
        ]),
      },
    ],
    body: [FILL('DEMO.RUN', boolFillT(C.run))],
  },
  'motor-ac': {
    rotor: [SPIN('DEMO.RUN', true)],
    lamp: [FILL('DEMO.RUN', boolFillT(C.run))],
  },
  fan: { blades: [SPIN('DEMO.FAN', true)], lamp: [FILL('DEMO.FAN', boolFillT(C.run))] },
  'pipe-h': { flow: FLOW('FIT101.FLOW') },
  'pipe-v': { flow: FLOW('FIT201.FLOW') },
  'pipe-elbow': { flow: FLOW('FIT101.FLOW') },
};
const libItems = [];
const symbolCells = [];
const symbolLabelCells = [];
let bseq = 0;
for (const s of manifest.symbols) {
  const map = SYMBOL_BIND[s.id];
  if (!map) throw new Error(`Thiếu binding cho ký hiệu ${s.id}`);
  const itemId = `kh_${s.id.replace(/-/g, '_')}`;
  const svgFile = `graphics/symbols/${s.id}.svg`;
  files[svgFile] = readFileSync(join(SYMBOL_DIR, s.file), 'utf8');
  const els = [];
  for (const p of s.parts) {
    const bs = map[p.role];
    if (!bs) continue;
    els.push({
      elementUid: p.uid,
      bindings: bs.map((b) => ({ id: `${b.target.split('.')[1]}_${++bseq}`, ...b })),
    });
  }
  files[`screens/${LIB}.${itemId}.bindings.json`] = json({
    schemaVersion: VERSION,
    screenId: LIB,
    itemId,
    elements: els,
  });
  libItems.push({
    id: itemId,
    name: s.name,
    type: 'svg',
    svgFile,
    bindingFile: `screens/${LIB}.${itemId}.bindings.json`,
    viewBox: s.viewBox,
    elements: els.map((e) => ({
      elementUid: e.elementUid,
      name: s.parts.find((p) => p.uid === e.elementUid).label,
    })),
  });
  symbolCells.push(itemId);
  const labelId = `ten_${itemId}`;
  libItems.push({
    id: labelId,
    type: 'widget',
    widget: 'label',
    props: { text: s.name, fontSize: 14, align: 'center' },
  });
  symbolLabelCells.push(labelId);
}

const w = (id, widget, props, tagsMap, extra = {}) => ({
  id,
  type: 'widget',
  widget,
  props,
  ...(tagsMap ? { tags: tagsMap } : {}),
  ...extra,
});
const heading = (id, text) => w(id, 'label', { text, fontSize: 20, bold: true });
/** Mục: [tiêu đề, hàng[]]; mỗi hàng { height, cells: [span, item][] } (các ô cùng hàng cao bằng nhau). */
const SECTIONS = [
  [
    'Hiển thị',
    [
      {
        height: 240,
        cells: [
          [
            3,
            w(
              'w_gauge',
              'gauge',
              { title: 'Đồng hồ (gauge)', label: 'Nhiệt độ', decimals: 1 },
              { value: 'DEMO.TEMP' },
            ),
          ],
          [
            2,
            w('w_level', 'level', { label: 'Mức (level)', decimals: 0 }, { value: 'DEMO.LEVEL' }),
          ],
          [
            2,
            w(
              'w_progress_ring',
              'progress',
              { label: 'Tiến độ', shape: 'ring', decimals: 0 },
              { value: 'DEMO.POS' },
            ),
          ],
          [
            3,
            w(
              'w_status',
              'status-list',
              {
                title: 'Danh sách trạng thái',
                labels: [
                  'Bơm cấp P-101',
                  'Bơm cấp P-102',
                  'Bơm đẩy P-201',
                  'Thiết bị mẫu',
                  'Quạt mẫu',
                ],
                onText: 'Chạy',
                offText: 'Dừng',
              },
              { items: ['P101.RUN', 'P102.RUN', 'P201.RUN', 'DEMO.RUN', 'DEMO.FAN'] },
            ),
          ],
          [
            2,
            w('w_image', 'image', {
              title: 'Hình ảnh (image)',
              src: SVG_FILE,
              fit: 'contain',
              alt: 'Sơ đồ công nghệ thu nhỏ',
            }),
          ],
        ],
      },
      {
        height: 116,
        cells: [
          [
            3,
            w(
              'w_card',
              'card',
              { label: 'Thẻ giá trị (card)', decimals: 2 },
              { value: 'DEMO.PRESS' },
            ),
          ],
          [
            3,
            w(
              'w_label',
              'label',
              { text: 'Nhãn (label): ', fontSize: 18, decimals: 1 },
              { value: 'DEMO.TEMP' },
            ),
          ],
          [
            3,
            w(
              'w_lamp',
              'lamp',
              { label: 'Đèn (lamp): thiết bị mẫu chạy', onColor: C.run },
              { state: 'DEMO.RUN' },
            ),
          ],
          [3, w('w_clock', 'clock', { label: 'Đồng hồ thời gian (clock)', format: 'datetime' })],
        ],
      },
      {
        height: 140,
        cells: [
          [4, w('w_panel', 'panel', { title: 'Khung (panel)', variant: 'card' })],
          [
            8,
            w('w_text', 'text', {
              title: 'Văn bản (text)',
              text: 'Trang này trưng bày mọi loại component của mAT Studio: hiển thị, thẻ chỉ số, biểu đồ, bảng, điều khiển, alarm, lịch sử và thư viện ký hiệu SVG. Mọi giá trị lấy từ Tag mô phỏng; widget điều khiển chỉ ghi vào Tag nội bộ.',
            }),
          ],
        ],
      },
    ],
  ],
  [
    'Thẻ & KPI',
    [
      {
        height: 116,
        cells: [
          [
            3,
            w(
              'w_tile1',
              'stat-tile',
              {
                label: 'Thẻ chỉ số (stat-tile)',
                color: 'orange',
                icon: 'thermometer',
                trend: true,
              },
              { value: 'DEMO.TEMP' },
            ),
          ],
          [
            3,
            w(
              'w_tile2',
              'stat-tile',
              {
                label: 'Thẻ chỉ số có cảnh báo',
                decimals: 2,
                color: 'violet',
                icon: 'pressure',
                sparkline: true,
              },
              { value: 'DEMO.PRESS', alarm: 'LIT101.HI' },
            ),
          ],
          [
            3,
            w(
              'w_kpi',
              'kpi',
              { label: 'KPI sản lượng hôm nay', decimals: 0, goal: 3000 },
              { value: 'TOTAL.TODAY' },
            ),
          ],
          [
            3,
            w(
              'w_progress_bar',
              'progress',
              { label: 'Thanh tiến độ (progress)', shape: 'bar', decimals: 0 },
              { value: 'DEMO.LEVEL' },
            ),
          ],
        ],
      },
    ],
  ],
  [
    'Biểu đồ',
    [
      {
        height: 280,
        cells: [
          [
            5,
            w(
              'w_line',
              'line',
              {
                title: 'Biểu đồ đường (line)',
                windowSec: 60,
                labels: ['Nhiệt độ', 'Mức'],
                yMin: 0,
                yMax: 100,
                highLimit: 85,
              },
              { series: ['DEMO.TEMP', 'DEMO.LEVEL'] },
            ),
          ],
          [
            4,
            w(
              'w_bar',
              'bar',
              {
                title: 'Biểu đồ cột (bar)',
                labels: ['P-101', 'P-102', 'P-103', 'P-201', 'P-202'],
                decimals: 1,
                showValues: true,
              },
              {
                series: [
                  'P101.CURRENT',
                  'P102.CURRENT',
                  'P103.CURRENT',
                  'P201.CURRENT',
                  'P202.CURRENT',
                ],
              },
            ),
          ],
          [
            3,
            w(
              'w_pie',
              'pie',
              {
                title: 'Biểu đồ tròn (pie)',
                labels: ['Nước thô vào', 'Nước sạch ra'],
                decimals: 0,
              },
              { series: ['FIT101.FLOW', 'FIT201.FLOW'] },
            ),
          ],
        ],
      },
    ],
  ],
  [
    'Bảng và Alarm',
    [
      {
        height: 260,
        captions: [
          'Bảng Tag (tag-table)',
          'Danh sách alarm (alarm-list)',
          'Số alarm (alarm-count)',
        ],
        cells: [
          [
            5,
            w(
              'w_table',
              'tag-table',
              { dense: true },
              {
                rows: [
                  'DEMO.TEMP',
                  'DEMO.PRESS',
                  'DEMO.LEVEL',
                  'FIT101.FLOW',
                  'FIT201.FLOW',
                  'AIT301.CL',
                ],
              },
            ),
          ],
          [5, w('w_alarm_list', 'alarm-list', { maxRows: 6 })],
          [2, w('w_alarm_count', 'alarm-count', { mode: 'active' })],
        ],
      },
    ],
  ],
  [
    'Điều khiển',
    [
      {
        height: 84,
        cells: [
          [
            2,
            w(
              'w_button',
              'button',
              { label: 'Nút bấm: đảo lệnh', variant: 'primary', confirm: 'none' },
              { target: 'DEMO.CMD' },
              {
                events: { click: { action: 'toggle' } },
              },
            ),
          ],
          [
            2,
            w(
              'w_switch',
              'switch',
              { label: 'Công tắc (switch)', onText: 'Bật', offText: 'Tắt', confirm: 'none' },
              { target: 'DEMO.CMD' },
            ),
          ],
          [
            3,
            w(
              'w_setpoint',
              'setpoint',
              { label: 'Giá trị đặt (setpoint)', step: 0.5, decimals: 1 },
              { target: 'DEMO.SP' },
            ),
          ],
          [
            3,
            w(
              'w_slider',
              'slider',
              { label: 'Thanh trượt (slider)', step: 5, decimals: 0 },
              { target: 'DEMO.SPEED' },
            ),
          ],
          [2, w('w_select', 'select', { label: 'Chọn chế độ (select)' }, { target: 'DEMO.MODE' })],
        ],
      },
      {
        height: 84,
        cells: [
          [
            6,
            w(
              'w_time_range',
              'time-range',
              { label: 'Hẹn giờ chạy (time-range)', format: 'minutes' },
              { start: 'DEMO.T_START', end: 'DEMO.T_END' },
            ),
          ],
        ],
      },
    ],
  ],
  [
    'Lịch sử',
    [
      {
        height: 300,
        captions: ['Xu hướng lịch sử (history-trend)', 'Bảng lịch sử (history-table)'],
        cells: [
          [
            6,
            w(
              'w_h_trend',
              'history-trend',
              { group: LIB, range: '1h', labels: ['Nhiệt độ', 'Áp suất'] },
              { series: ['DEMO.TEMP', 'DEMO.PRESS'] },
            ),
          ],
          [
            6,
            w(
              'w_h_table',
              'history-table',
              {
                group: LIB,
                range: '1h',
                pageSize: 50,
                labels: ['Nhiệt độ', 'Áp suất', 'Lưu lượng vào'],
              },
              { columns: ['DEMO.TEMP', 'DEMO.PRESS', 'FIT101.FLOW'] },
            ),
          ],
        ],
      },
      {
        height: 280,
        captions: ['Cột lịch sử theo giờ (history-bar)', 'Tròn lịch sử hôm nay (history-pie)'],
        cells: [
          [
            8,
            w(
              'w_h_bar',
              'history-bar',
              {
                group: LIB,
                fn: 'avg',
                bucket: 'hour',
                period: 'today',
                decimals: 1,
                showValues: true,
                labels: ['Nhiệt độ trung bình'],
              },
              { series: ['DEMO.TEMP'] },
            ),
          ],
          [
            4,
            w(
              'w_h_pie',
              'history-pie',
              {
                group: LIB,
                fn: 'avg',
                period: 'today',
                decimals: 0,
                labels: ['Nước thô vào', 'Nước sạch ra'],
              },
              { series: ['FIT101.FLOW', 'FIT201.FLOW'] },
            ),
          ],
        ],
      },
    ],
  ],
];
const libRows = [];
let rowSeq = 0;
let cellSeq = 0;
const addLibRow = (height, cells) =>
  libRows.push({
    id: `r${++rowSeq}`,
    height,
    cells: cells.map(([span, item]) => ({ id: `c${++cellSeq}`, span, item })),
  });
SECTIONS.forEach(([title, rows], i) => {
  const h = heading(`muc_${i + 1}`, title);
  libItems.push(h);
  addLibRow(36, [[12, h.id]]);
  for (const r of rows) {
    // Hàng chú thích cho widget không có thuộc tính tiêu đề (alarm, lịch sử)
    if (r.captions) {
      const caps = r.cells.map(([span, item], k) => {
        const c = w(`ten_${item.id}`, 'label', { text: r.captions[k], fontSize: 14, bold: true });
        libItems.push(c);
        return [span, c.id];
      });
      addLibRow(24, caps);
    }
    for (const [, item] of r.cells) libItems.push(item);
    addLibRow(
      r.height,
      r.cells.map(([span, item]) => [span, item.id]),
    );
  }
});
const symHead = heading('muc_ky_hieu', 'Ký hiệu SVG');
libItems.push(symHead);
addLibRow(36, [[12, symHead.id]]);
for (let i = 0; i < symbolCells.length; i += 6) {
  addLibRow(
    150,
    symbolCells.slice(i, i + 6).map((id) => [2, id]),
  );
  addLibRow(
    28,
    symbolLabelCells.slice(i, i + 6).map((id) => [2, id]),
  );
}
const libHeight = 32 + libRows.reduce((s, r) => s + r.height, 0) + 12 * (libRows.length - 1);
files[`screens/${LIB}.screen.json`] = json({
  schemaVersion: VERSION,
  id: LIB,
  name: 'Thư viện component',
  size: { width: 1920, height: Math.min(2304, Math.max(1080, libHeight)) },
  layout: { mode: 'grid', columns: 12, gap: 12, padding: 16, rows: libRows },
  items: libItems,
});

files['alarm-classes.json'] = json({
  schemaVersion: VERSION,
  classes: [
    {
      id: 'critical',
      name: 'Khẩn cấp',
      priority: 'critical',
      color: 'red',
      blink: true,
      sound: 'siren',
    },
    {
      id: 'major',
      name: 'Quan trọng',
      priority: 'major',
      color: 'orange',
      blink: true,
      sound: 'double',
    },
    { id: 'minor', name: 'Nhỏ', priority: 'minor', color: 'amber', sound: 'beep' },
    { id: 'advisory', name: 'Lưu ý', priority: 'advisory', color: 'blue', requiresAck: false },
  ],
});
files['alarms.json'] = json({
  schemaVersion: VERSION,
  areas: [
    { id: 'bon', name: 'Bồn' },
    { id: 'bom', name: 'Bơm' },
    { id: 'chat-luong', name: 'Chất lượng nước' },
  ],
  alarms: [
    {
      id: 'DEMO_TEMP',
      type: 'limit',
      name: 'Nhiệt độ mẫu',
      area: 'bom',
      tag: 'DEMO.TEMP',
      limits: { H: { value: 70, class: 'minor' }, HH: { value: 78, class: 'major' } },
      deadband: 1,
    },
    {
      id: 'LIT101_LEVEL',
      type: 'limit',
      name: 'Mức bể lắng T-101',
      area: 'bon',
      tag: 'LIT101.LEVEL',
      limits: { H: { value: 80, class: 'minor' } },
      deadband: 1,
    },
    {
      id: 'LIT201_LEVEL',
      type: 'limit',
      name: 'Mức bồn nước sạch T-201',
      area: 'bon',
      tag: 'LIT201.LEVEL',
      limits: { L: { value: 25, class: 'major' } },
      deadband: 1,
    },
    {
      id: 'AIT301_CL',
      type: 'limit',
      name: 'Clo dư',
      area: 'chat-luong',
      tag: 'AIT301.CL',
      limits: { L: { value: 0.3, class: 'major' } },
      deadband: 0.02,
    },
    {
      id: 'P102_FAULT',
      type: 'digital',
      name: 'Bơm cấp P-102 lỗi',
      area: 'bom',
      tag: 'P102.FAULT',
      trigger: true,
      class: 'critical',
    },
  ],
});
files['logging.json'] = json({
  schemaVersion: VERSION,
  timeZone: '+07:00',
  groups: [
    {
      id: LIB,
      name: 'Thư viện component',
      mode: 'cyclic',
      periodMs: 60000,
      retentionDays: 30,
      tags: [
        { tagId: 'DEMO.TEMP' },
        { tagId: 'DEMO.PRESS' },
        { tagId: 'FIT101.FLOW' },
        { tagId: 'FIT201.FLOW' },
      ],
      aggregates: {},
    },
  ],
});

files['tags.json'] = json({ schemaVersion: VERSION, tags });

files['value-tables/TrangThaiBom.json'] = json({
  schemaVersion: VERSION,
  name: 'TrangThaiBom',
  entries: [
    { value: 0, text: 'Dừng', color: C.stop },
    { value: 1, text: 'Chạy', color: C.run },
    { value: 2, text: 'Lỗi', color: C.fault },
  ],
  default: { text: '?', color: C.warn },
});
files['value-tables/CheDo.json'] = json({
  schemaVersion: VERSION,
  name: 'CheDo',
  entries: [
    { value: 0, text: 'Tay' },
    { value: 1, text: 'Tự động' },
  ],
});

files['project.json'] = json({
  format: 'matscada-project',
  schemaVersion: VERSION,
  projectId: 'svg-showcase',
  projectName: 'Trạm bơm nước sạch – Sơ đồ công nghệ',
  projectVersion: '0.1.0',
  minRuntimeVersion: '1.1.0',
  entryScreen: 'so-do-cong-nghe',
  screens: ['so-do-cong-nghe', 'tong-quan', 'thu-vien', 'faceplate-bom'],
  tagFile: 'tags.json',
  valueTables: ['TrangThaiBom', 'CheDo'],
  alarmFile: 'alarms.json',
  alarmClassFile: 'alarm-classes.json',
  loggingFile: 'logging.json',
  navigation: {
    position: 'left',
    items: [
      { label: 'Sơ đồ công nghệ', screen: 'so-do-cong-nghe', icon: 'pump' },
      { label: 'Tổng quan', screen: 'tong-quan', icon: 'home' },
      { label: 'Thư viện component', screen: 'thu-vien', icon: 'list' },
    ],
  },
  maxClients: 10,
});

for (const [rel, content] of Object.entries(files)) {
  const p = join(DIR, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}
console.log(
  `svg-showcase: ${Object.keys(files).length} tệp, SVG ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB, ` +
    `${elementList.length} phần tử gắn Tag, ${[...bound.values()].reduce((s, e) => s + (e.bindings?.length ?? 0), 0)} binding`,
);
