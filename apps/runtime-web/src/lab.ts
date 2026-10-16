// Trang LAB (chỉ dev, KHÔNG đóng gói lên thiết bị): đo thời gian hiển thị các fixture SVG của
// Sprint 0 và gắn thử Tag SIM.* theo thuộc tính data-tag. Runtime thật ở main.ts.
import { LiveConnection, type TagChange } from '@mat/live-client';
import { inspectSvg, parseSvg, sanitizeSvg, type InspectWarning } from '@mat/svg-renderer';
import './lab.css';
import { applyValue, collectBindings } from './lab-binding.ts';

const BUDGET_MS = 2000; // SC-005
const MIN_CHROME = 120; // Constitution IV

declare global {
  interface Window {
    __svgLoadReport?: unknown;
  }
  interface Navigator {
    userAgentData?: { brands: Array<{ brand: string; version: string }> };
  }
}

interface ScreenEntry {
  name: string;
  title: string;
  bytes: number;
}

interface LoadSample {
  fetchMs: number;
  parseMs: number;
  renderMs: number;
  totalMs: number;
}

interface LoadResult {
  name: string;
  bytes: number;
  transferBytes: number;
  encoding: string;
  samples: LoadSample[];
  medianTotalMs: number;
  maxTotalMs: number;
  elements: number;
  maxDepth: number;
  removedElements: Record<string, number>;
  removedAttributes: number;
  bindings: number;
  generator: string;
  warnings: InspectWarning[];
  pass: boolean;
  error?: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('app-stage');
// Shadow DOM: CSS (<style>, class .cls-N/.fil0…) và id của SVG không lan ra trang, trang không lan vào SVG.
const stageRoot = stage.attachShadow({ mode: 'open' });
let conn: LiveConnection | null = null;
let subscribedKey = '';
let bindings = new Map<string, Element[]>();
let busy = false;

// ---------- Trình duyệt ----------
function chromeMajor(): number | null {
  const hit = navigator.userAgentData?.brands.find(
    (b) => /Chrom(e|ium)/.test(b.brand) && !/Not/.test(b.brand),
  );
  if (hit) return Number(hit.version);
  const m = /Chrome\/(\d+)/.exec(navigator.userAgent);
  return m ? Number(m[1]) : null;
}

function showBrowser(): void {
  const v = chromeMajor();
  const el = $('app-browser');
  if (v === null) {
    el.textContent = 'Trình duyệt không phải Chrome/Chromium';
    el.className = 'badge bad';
  } else if (v < MIN_CHROME) {
    el.textContent = `Chrome ${v} < ${MIN_CHROME} — không được hỗ trợ`;
    el.className = 'badge bad';
  } else {
    el.textContent = `Chrome ${v} (≥ ${MIN_CHROME}) ✓`;
    el.className = 'badge ok';
  }
}

// ---------- Binding ----------
const asNumber = (v: TagChange['value']) => (typeof v === 'number' ? v : Number.NaN);

function applyChanges(changes: TagChange[]): void {
  for (const c of changes) {
    const els = bindings.get(c.id);
    if (els) for (const el of els) applyValue(el, asNumber(c.value), c.quality);
  }
}

// ---------- WebSocket (protocol 1.0.0, @mat/live-client) ----------
function setLive(text: string, cls: 'ok' | 'warn' | 'bad' | ''): void {
  const el = $('app-live');
  el.textContent = 'WebSocket: ' + text;
  el.className = 'badge ' + cls;
}

/** Đăng ký đúng các Tag data-tag của màn hình đang xem (lab: SIM.Txxxx). */
function subscribeScreenTags(): void {
  const tags = [...bindings.keys()].sort();
  const key = tags.join(',');
  if (key === subscribedKey) return;
  subscribedKey = key;
  conn?.stop();
  conn = null;
  if (!tags.length) {
    setLive('màn hình không gắn Tag', '');
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const c = new LiveConnection({ url: `${proto}://${location.host}/api/v1/live`, tags });
  c.onChange = applyChanges;
  c.onState = (st) => {
    const l = c.live;
    if (st === 'live') setLive(`đang nhận · seq ${l.sequence} · ${tags.length} Tag`, 'ok');
    else if (st === 'full') setLive('đã đủ số client tối đa (4429) — tự thử lại sau 30 s', 'bad');
    else if (st === 'offline') setLive('mất kết nối, dữ liệu đang hiển thị là cũ', 'warn');
    else setLive(st, 'warn');
  };
  conn = c;
  c.start();
}

// ---------- Tải và hiển thị SVG ----------
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Fixture thô của phần mềm vẽ (Illustrator, CorelDRAW, LibreOffice) có DOCTYPE mà parseSvg từ chối (F12): trang LAB bỏ
 * DOCTYPE và thay entity chuỗi đã khai như importer làm, để vẫn đo được. Chỉ cho fixture tin cậy của LAB.
 */
function withoutDoctype(text: string): string {
  const start = text.indexOf('<!DOCTYPE');
  if (start < 0) return text;
  let depth = 0;
  for (let i = start + 9; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const e = text.indexOf(c, i + 1);
      if (e < 0) break;
      i = e;
    } else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '>' && depth <= 0) {
      let rest = text.slice(0, start) + text.slice(i + 1);
      const dtd = text.slice(start, i + 1);
      for (let k = dtd.indexOf('<!ENTITY'); k >= 0; k = dtd.indexOf('<!ENTITY', k + 8)) {
        const parts = dtd
          .slice(k + 8)
          .trimStart()
          .split('"');
        const name = parts[0].trim();
        if (parts.length > 2 && name !== '') rest = rest.split(`&${name};`).join(parts[1]);
      }
      return rest;
    }
  }
  return text;
}
const UNIT_PX: Record<string, number> = {
  '': 1,
  px: 1,
  pt: 4 / 3,
  pc: 16,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
};

/** SVG không có viewBox: tạo viewBox từ width/height trước khi gỡ chúng, để co giãn mà không bị cắt. */
function ensureViewBox(svg: SVGSVGElement): void {
  if (svg.hasAttribute('viewBox')) return;
  const toPx = (v: string | null) => {
    const m = /^\s*([\d.]+)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(v ?? '');
    return m ? Number(m[1]) * UNIT_PX[(m[2] ?? '').toLowerCase()] : Number.NaN;
  };
  const w = toPx(svg.getAttribute('width'));
  const h = toPx(svg.getAttribute('height'));
  if (w > 0 && h > 0) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
}

async function loadOnce(entry: ScreenEntry) {
  const url = new URL(`screens/${entry.name}`, location.href).href;
  const t0 = performance.now();
  const res = await fetch(url, { cache: 'no-store' }); // đo lần tải đầu, không dùng cache
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const t1 = performance.now();

  const svg = parseSvg(withoutDoctype(text));
  const inspection = inspectSvg(svg, text); // trước khi lọc: còn thấy foreignObject, ảnh liên kết…
  const report = sanitizeSvg(svg, { keepDataAttributes: ['data-mat-uid', 'data-tag'] });
  const t2 = performance.now();

  ensureViewBox(svg);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.cssText += ';display:block;width:100%;height:100%';
  stageRoot.replaceChildren(document.adoptNode(svg));
  await nextFrame();
  await nextFrame(); // khung thứ hai: trình duyệt đã dựng xong khung đầu
  const t3 = performance.now();

  const timing = performance.getEntriesByName(url).at(-1) as PerformanceResourceTiming | undefined;
  return {
    sample: {
      fetchMs: round1(t1 - t0),
      parseMs: round1(t2 - t1),
      renderMs: round1(t3 - t2),
      totalMs: round1(t3 - t0),
    } satisfies LoadSample,
    report,
    inspection,
    svg,
    decoded: timing?.decodedBodySize || text.length,
    transfer: timing?.transferSize || 0,
    encoding: res.headers.get('content-encoding') ?? 'identity',
  };
}

async function loadScreen(entry: ScreenEntry, runs: number): Promise<LoadResult> {
  const result: LoadResult = {
    name: entry.name,
    bytes: entry.bytes,
    transferBytes: 0,
    encoding: '',
    samples: [],
    medianTotalMs: 0,
    maxTotalMs: 0,
    elements: 0,
    maxDepth: 0,
    removedElements: {},
    removedAttributes: 0,
    bindings: 0,
    generator: '',
    warnings: [],
    pass: false,
  };
  try {
    let last: Awaited<ReturnType<typeof loadOnce>> | undefined;
    for (let i = 0; i < runs; i++) {
      last = await loadOnce(entry);
      result.samples.push(last.sample);
    }
    const totals = result.samples.map((s) => s.totalMs);
    result.medianTotalMs = median(totals);
    result.maxTotalMs = Math.max(...totals);
    result.pass = result.maxTotalMs <= BUDGET_MS;
    if (last) {
      result.bytes = last.decoded;
      result.transferBytes = last.transfer;
      result.encoding = last.encoding;
      result.elements = last.report.elementCount;
      result.maxDepth = last.report.maxDepth;
      result.removedElements = last.report.removedElements;
      result.removedAttributes = last.report.removedAttributes;
      result.generator = `${last.inspection.generator} (${last.inspection.certainty})`;
      result.warnings = last.inspection.warnings;
      bindings = collectBindings(last.svg);
      result.bindings = bindings.size;
      subscribeScreenTags();
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}

// ---------- Giao diện ----------
const kb = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;

function removedText(r: LoadResult): string {
  const parts = Object.entries(r.removedElements).map(([k, v]) => `${k}×${v}`);
  if (r.removedAttributes) parts.push(`thuộc tính×${r.removedAttributes}`);
  return parts.join(', ') || '—';
}

function renderRow(r: LoadResult): void {
  const tbody = document.querySelector('#app-results tbody')!;
  let tr = tbody.querySelector<HTMLTableRowElement>(`tr[data-name="${CSS.escape(r.name)}"]`);
  if (!tr) {
    tr = document.createElement('tr');
    tr.dataset.name = r.name;
    tbody.append(tr);
  }
  const last = r.samples.at(-1);
  const cells: Array<[string, string]> = r.error
    ? [[r.name, ''], ...Array<[string, string]>(8).fill(['', '']), [`Lỗi: ${r.error}`, 'bad']]
    : [
        [r.name, ''],
        [kb(r.bytes), ''],
        [r.transferBytes ? `${kb(r.transferBytes)} (${r.encoding})` : r.encoding, ''],
        [String(last?.fetchMs ?? ''), ''],
        [String(last?.parseMs ?? ''), ''],
        [String(last?.renderMs ?? ''), ''],
        [
          r.samples.length > 1
            ? `${r.medianTotalMs} (max ${r.maxTotalMs})`
            : String(r.medianTotalMs),
          '',
        ],
        [String(r.elements), ''],
        [removedText(r), ''],
        [r.pass ? '✓ Đạt' : '✗ Không đạt', r.pass ? 'ok' : 'bad'],
      ];
  tr.replaceChildren(
    ...cells.map(([text, cls]) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      return td;
    }),
  );
}

function renderWarnings(r: LoadResult): void {
  const list = $('app-stage-warnings');
  list.replaceChildren(
    ...r.warnings.map((w) => {
      const li = document.createElement('li');
      li.textContent = w.message;
      return li;
    }),
  );
}

function setBusy(on: boolean): void {
  busy = on;
  document
    .querySelectorAll('button, #app-runs')
    .forEach((el) => ((el as HTMLButtonElement).disabled = on));
}

async function showScreen(entry: ScreenEntry): Promise<LoadResult | undefined> {
  if (busy) return;
  setBusy(true);
  try {
    $('app-stage-title').textContent = `${entry.title} — ${entry.name}`;
    document
      .querySelectorAll('#app-screens button')
      .forEach((b) =>
        b.setAttribute('aria-current', String((b as HTMLElement).dataset.name === entry.name)),
      );
    const runs = Math.max(1, Math.min(20, Number(($('app-runs') as HTMLInputElement).value) || 1));
    const r = await loadScreen(entry, runs);
    renderRow(r);
    renderWarnings(r);
    $('app-stage-note').textContent = r.error
      ? `Không hiển thị được: ${r.error}`
      : `Nguồn: ${r.generator} · ${r.elements} phần tử, sâu ${r.maxDepth}, ${r.bindings} Tag gắn · bị lọc: ${removedText(r)}`;
    return r;
  } finally {
    setBusy(false);
  }
}

async function runAll(screens: ScreenEntry[]): Promise<LoadResult[]> {
  const out: LoadResult[] = [];
  for (const entry of screens) {
    const r = await showScreen(entry);
    if (r) out.push(r);
  }
  return out;
}

async function main(): Promise<void> {
  showBrowser();
  performance.setResourceTimingBufferSize(5000); // --runs 20 × nhiều file vẫn đọc được timing
  const res = await fetch('screens/index.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Không tải được screens/index.json (HTTP ${res.status})`);
  const manifest = (await res.json()) as { screens: ScreenEntry[] };
  const list = $('app-screens');
  for (const s of manifest.screens) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.name = s.name;
    const label = document.createElement('span');
    label.textContent = s.name.replace(/\.svg$/, '');
    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = kb(s.bytes);
    b.append(label, size);
    b.addEventListener('click', () => void showScreen(s));
    li.append(b);
    list.append(li);
  }
  $('app-run-all').addEventListener('click', () => void runAll(manifest.screens));

  const params = new URLSearchParams(location.search);
  if (params.get('auto') === '1') {
    if (params.get('runs')) ($('app-runs') as HTMLInputElement).value = params.get('runs')!;
    const results = await runAll(manifest.screens);
    window.__svgLoadReport = {
      userAgent: navigator.userAgent,
      chromeMajor: chromeMajor(),
      budgetMs: BUDGET_MS,
      results,
    };
    document.body.dataset.done = '1';
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  $('app-stage-note').textContent = `Lỗi khởi động trang: ${message}`;
  window.__svgLoadReport = { error: message };
  document.body.dataset.done = 'error'; // để công cụ đo không chờ tới hết thời gian
});
