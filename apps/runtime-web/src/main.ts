// Trang runtime (Sprint 1): chỉ ghép package dùng chung (Constitution II).
// /api/v1/projects/active → SVG của entry screen → Shadow DOM → binding → /api/v1/live.
import { DomApplier } from '@mat/binding-engine';
import { LiveConnection } from '@mat/live-client';
import type { LoadedProject } from '@mat/project-schema';
import { mountScreen } from '@mat/svg-renderer';
import { StatusView } from './status.ts';
import './style.css';

const MIN_CHROME = 120; // Constitution IV
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const debug = new URLSearchParams(location.search).get('debug') === '1';

declare global {
  interface Navigator {
    userAgentData?: { brands: Array<{ brand: string; version: string }> };
  }
}

function chromeMajor(): number | null {
  const hit = navigator.userAgentData?.brands.find(
    (b) => /Chrom(e|ium)/.test(b.brand) && !/Not/.test(b.brand),
  );
  if (hit) return Number(hit.version);
  const m = /Chrome\/(\d+)/.exec(navigator.userAgent);
  return m ? Number(m[1]) : null;
}

function showErrors(title: string, lines: string[]): void {
  const panel = $('app-errors');
  panel.hidden = false;
  $('app-errors-title').textContent = title;
  $('app-errors-list').replaceChildren(
    ...lines.map((l) => {
      const li = document.createElement('li');
      li.textContent = l;
      return li;
    }),
  );
}

async function loadProject(): Promise<LoadedProject | null> {
  const res = await fetch('/api/v1/projects/active', { cache: 'no-store' });
  if (res.status === 503) {
    const body = (await res.json()) as {
      errors?: Array<{ code: string; file: string; path: string; message: string }>;
    };
    showErrors(
      'Không có project hợp lệ trên thiết bị',
      (body.errors ?? []).map((e) => `${e.code} · ${e.file}${e.path} — ${e.message}`),
    );
    return null;
  }
  if (!res.ok) throw new Error(`Không tải được project (HTTP ${res.status})`);
  return (await res.json()) as LoadedProject;
}

async function main(): Promise<void> {
  const v = chromeMajor();
  if (v === null || v < MIN_CHROME)
    $('app-browser').textContent =
      `Cần Chrome/Chromium ≥ ${MIN_CHROME} (hiện tại: ${v ?? 'không phải Chrome'})`;

  const active = await loadProject();
  if (!active) return;
  const entry = active.screens[active.project.entryScreen];
  document.title = `${active.project.projectName} — mAT SCADA`;
  $('app-title').textContent = `${active.project.projectName} · ${entry.screen.name}`;

  // Mỗi đoạn đường dẫn được encode: tên file có #, ?, % hay dấu cách vẫn hợp lệ với validator.
  const svgUrl = '/project/' + entry.screen.svgFile.split('/').map(encodeURIComponent).join('/');
  const svgRes = await fetch(svgUrl, { cache: 'no-cache' });
  if (!svgRes.ok) throw new Error(`Không tải được ${entry.screen.svgFile} (HTTP ${svgRes.status})`);
  const mounted = mountScreen($('app-screen'), await svgRes.text(), entry.screen);
  const applier = new DomApplier({
    elements: mounted.elements,
    bindings: entry.bindings.elements,
    tagTypes: Object.fromEntries(active.tags.tags.map((t) => [t.id, t.type])),
  });
  if (mounted.missingUids.length || applier.missing.length)
    console.warn('elementUid không có trong SVG, bỏ binding:', [
      ...new Set([...mounted.missingUids, ...applier.missing]),
    ]);

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const conn = new LiveConnection({
    url: `${proto}://${location.host}/api/v1/live`,
    tags: applier.tagIds(),
  });
  let lastUpdate = 0;
  const status = new StatusView(
    {
      badge: $('app-live'),
      updated: $('app-updated'),
      banner: $('app-banner'),
      bannerText: $('app-banner-text'),
      bannerCount: $('app-banner-count'),
      retry: $('app-banner-retry') as HTMLButtonElement,
    },
    () => conn.retryNow(),
  );
  const render = () =>
    status.render({ state: conn.state, retryAt: conn.retryAt, now: Date.now(), lastUpdate });
  conn.onChange = (changes) => {
    // Bản tin STALE khi mất kết nối không phải dữ liệu mới: không đổi "Cập nhật cuối".
    if (changes.some((c) => c.quality !== 'STALE')) lastUpdate = Date.now();
    applier.update(changes);
  };
  conn.onState = render;
  setInterval(() => {
    render(); // đếm ngược khi đầy, thời điểm cập nhật
    if (debug) {
      const l = conn.live;
      $('app-debug').textContent =
        `seq ${l.sequence} · ${l.deltas} delta · mất ${l.seqGaps} · ${l.ids.length} Tag` +
        (l.unknown.length ? ` · không có: ${l.unknown.join(', ')}` : '');
    }
  }, 1000);
  $('app-debug').hidden = !debug;
  conn.start();
  render();
}

main().catch((e: unknown) => {
  showErrors('Lỗi khởi động trang', [e instanceof Error ? e.message : String(e)]);
});
