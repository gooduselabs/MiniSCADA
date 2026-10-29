// E2E feature 044 (người dùng: "component nào hiện giá trị 2 lần, vd thanh tiến độ"): một màn hình lưới có mọi widget
// hiển thị số (mặc định danh mục và preset Studio), đọc chữ NHÌN THẤY thật của từng widget trên Chrome (bỏ phần tử ẩn,
// bảng sr-only 1 px) và kiểm không số nào (làm tròn) lặp ≥ 2 lần trong một widget. Ảnh: tests/e2e/out/no-dup-value.png
// (hoặc thư mục MAT_SHOTS_DIR, tên kèm MAT_SHOTS_TAG để so trước/sau).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboard } from './fixture-project.mjs';
import { deepEval, sleep, waitDeep } from './util.mjs';

const w = (id, widget, tags, props) => ({ id, type: 'widget', widget, props, tags });
const L = 'TANK01.LEVEL'; // %, 0–100 (giả lập dao động quanh 62,5)
const F = 'TANK01.INFLOW'; // m3/h, 0–20

/** [id item, widget, tags, props]; props = mặc định danh mục ({}) hoặc preset Studio (widget-presets.ts). */
const ITEMS = [
  w('card', 'card', { value: L }, { label: 'Thẻ (mặc định)' }),
  w(
    'card-p',
    'card',
    { value: F, status: F },
    {
      label: 'Thẻ preset + Trạng thái cùng Tag',
      fill: 'soft',
      accent: 'blue',
      flash: true,
      fontSize: 'l',
      trend: true,
      sparkline: true,
    },
  ),
  w('stat', 'stat-tile', { value: F }, { label: 'Ô chỉ số' }),
  w('kpi', 'kpi', { value: F }, { label: 'KPI', goal: 15 }),
  w('gauge', 'gauge', { value: L }, { label: 'Đồng hồ %' }),
  w('gauge-f', 'gauge', { value: F }, { label: 'Đồng hồ m3/h' }),
  w('level', 'level', { value: L }, { label: 'Mức (thanh) %' }),
  w('level-t', 'level', { value: F }, { label: 'Bồn preset m3/h', style: 'tank', wave: true }),
  w('level-h', 'level', { value: F }, { label: 'Mức ngang m3/h', orientation: 'horizontal' }),
  w('prog', 'progress', { value: L }, { label: 'Tiến độ %' }),
  w('prog-f', 'progress', { value: F }, { label: 'Tiến độ m3/h' }),
  w('prog-r', 'progress', { value: F }, { label: 'Vòng preset m3/h', shape: 'ring' }),
  w('label', 'label', { value: L }, {}),
  w('multi', 'multi-state', { value: 'MOTOR01.RUN' }, { label: 'Trạng thái' }),
  w('status', 'status-list', { items: [L, F] }, { title: 'Danh sách' }),
  w('table', 'tag-table', { rows: [L, F] }, { title: 'Bảng Tag' }),
  w('setpoint', 'setpoint', { target: 'TANK01.SP' }, { label: 'Đặt mức' }),
  w('slider', 'slider', { target: 'TANK01.SP' }, { label: 'Thanh trượt' }),
  w(
    'equip',
    'equipment',
    { state: 'MOTOR01.RUN', target: 'PUMP1.RUN_CMD' },
    { label: 'Bơm', kind: 'pump' },
  ),
  w('stack', 'stack-light', { green: 'MOTOR01.RUN' }, { label: 'Đèn tháp' }),
  w('line', 'line', { series: [L, F] }, { title: 'Xu hướng' }),
  w('bar', 'bar', { series: [L, F] }, { title: 'Cột' }),
  w('pie', 'pie', { series: [L, F] }, { title: 'Tròn' }),
];

/** Widget tự tính %: mặc định chỉ một số (phần trăm), giá trị thô chỉ khi bật tường minh. */
const PERCENT_ONLY = new Set(['level', 'progress']);

/** Ngoại lệ có chủ đích: id item → lý do (hiện tại không có). */
const ALLOW = {};

function fixture() {
  const base = dashboard();
  const rows = [];
  for (let i = 0; i < ITEMS.length; i += 4)
    rows.push({
      id: `r${i / 4}`,
      height: i >= 20 ? 260 : 170,
      cells: ITEMS.slice(i, i + 4).map((it, k) => ({ id: `c${i + k}`, span: 3, item: it.id })),
    });
  const screen = {
    schemaVersion: '1.1.0',
    id: 'dup',
    name: 'Kiểm lặp giá trị',
    kind: 'screen',
    size: { width: 1920, height: 1080 },
    layout: { mode: 'grid', columns: 12, gap: 12, padding: 16, rows },
    items: ITEMS,
  };
  base.files.set('screens/dup.screen.json', { json: screen });
  const a = base.active;
  a.project = { ...a.project, schemaVersion: '1.1.0', entryScreen: 'dup', theme: 'vivid' };
  a.screens = [
    { id: 'dup', name: screen.name, kind: 'screen', file: 'screens/dup.screen.json' },
    ...a.screens,
  ];
  a.navigation = {
    ...a.navigation,
    items: [{ label: 'Lặp', screen: 'dup', icon: 'home' }, ...a.navigation.items],
  };
  a.project.navigation = a.navigation;
  a.digest = 'sha256:e2e-dup044';
  return base;
}

export const options = { fixture };

/** Chữ nhìn thấy của mỗi item (theo data-item/id của ô), số lặp. */
const visibleTexts = (page) =>
  deepEval(
    page,
    'mat-screen',
    `const s = els[0].shadowRoot; const out = {};
     const vis = (n) => {
       let t = '';
       const kids = n.shadowRoot ? [...n.shadowRoot.childNodes] : [...n.childNodes];
       for (const c of kids) {
         if (c.nodeType === 3) {
           const p = c.parentElement ?? c.parentNode.host;
           const r = p && p.getBoundingClientRect ? p.getBoundingClientRect() : { width: 9, height: 9 };
           if (r.width > 2 && r.height > 2) t += c.textContent + ' ';
         } else if (c.nodeType === 1 && c.tagName !== 'STYLE') {
           const cs = getComputedStyle(c);
           if (cs.display === 'none' || cs.visibility === 'hidden') continue;
           // sr-only (bảng dữ liệu cho trình đọc màn hình) và hình ECharts (vạch trục là số tùy ý) không tính.
           if (c.classList.contains('sr-only') || cs.clip !== 'auto' || c.classList.contains('ec')) continue;
           const b = c.getBoundingClientRect();
           if (b.width <= 2 || b.height <= 2) continue;
           t += vis(c) + ' ';
           if ((c.tagName === 'INPUT' && c.type !== 'range' && c.type !== 'checkbox') || c.tagName === 'SELECT') t += c.value + ' ';
         }
       }
       return t;
     };
     for (const cell of s.querySelectorAll('.cell')) {
       const box = cell.querySelector('.item'); const it = box?.firstElementChild;
       if (it) out[box.dataset.itemId ?? cell.id] = vis(it).replace(/\\s+/g, ' ').trim();
     }
     return out;`,
  );

const numbers = (text) => [...text.matchAll(/(?<![\p{L}\d.,])\d+(?:[.,]\d+)?(?![\p{L}\d])/gu)];

/** Số (làm tròn về số nguyên) xuất hiện ≥ 2 lần; bỏ 0 và 100 (đầu thang) và chữ số trong đơn vị (m3/h). */
export function repeatedNumbers(text) {
  const seen = new Map();
  for (const m of numbers(text)) {
    const n = Math.round(Number(m[0].replace(',', '.')));
    if (n === 0 || n === 100) continue;
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  return [...seen].filter(([, c]) => c >= 2).map(([n]) => n);
}

export default async function run(ctx) {
  const { page } = ctx;
  await page.setViewport({ width: 1600, height: 1250 });
  await page.goto(ctx.url + '/#/dup', { waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'mat-w-pie', 1);
  await sleep(2500);
  const texts = await visibleTexts(page);
  const ids = Object.keys(texts);
  ctx.check('màn hình có đủ widget', ids.length === ITEMS.length, ids.join(','));
  for (const [id, text] of Object.entries(texts)) {
    const rep = repeatedNumbers(text);
    ctx.check(
      `${id}: không số nào hiện 2 lần${ALLOW[id] ? ` (ngoại lệ: ${ALLOW[id]})` : ''}`,
      ALLOW[id] !== undefined || rep.length === 0,
      `"${text}" lặp ${rep.join(',')}`,
    );
    const widget = ITEMS.find((i) => i.id === id)?.widget;
    if (PERCENT_ONLY.has(widget))
      ctx.check(
        `${id}: chỉ hiện phần trăm (không thêm giá trị thô)`,
        numbers(text).length === 1,
        text,
      );
  }
  const dir = process.env.MAT_SHOTS_DIR || join(dirname(fileURLToPath(import.meta.url)), 'out');
  const tag = process.env.MAT_SHOTS_TAG ? `-${process.env.MAT_SHOTS_TAG}` : '';
  await page.screenshot({ path: join(dir, `no-dup-value${tag}.png`), fullPage: true });
}
