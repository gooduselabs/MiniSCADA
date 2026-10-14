// Trang vận hành (feature 007): shell + `<mat-screen>` của @mat/ui-components, nguồn dữ liệu sống LiveTagSource,
// route theo hash, popup, phiên web và điều khiển có kiểm soát.
// Giữ hành vi của 004/005/006 (FR-021): cảnh báo Chrome < 120, không mở WebSocket khi thiết bị chưa có project hợp lệ
// (chỉ hỏi lại projects/active, T104a), banner 4429, tự tải lại khi project đổi (hash giữ nguyên qua reload.ts).
import '../../../packages/ui-components/src/styles/tokens.css';
import { MatScreen, registerScreen, registerWidgets } from '@mat/ui-components';
import { WebActionHost } from './action-host.ts';
import { vi } from './i18n/vi.ts';
import { HistoryPage } from './history-page.ts';
import { ReportPage } from './report-page.ts';
import { HttpHistorySource } from './history-source.ts';
import { viHist } from './i18n/vi-history.ts';
import { LiveTagSource } from './live-source.ts';
import { LoginDialog } from './login-dialog.ts';
import { buildMenu } from './menu.ts';
import { PopupHost } from './popup-host.ts';
import { ProjectStore, type ApiIssue } from './project-store.ts';
import {
  ProjectPoller,
  ReloadWatcher,
  WAIT_BADGE,
  WAIT_MESSAGE,
  watchProject,
  type ActiveResponse,
} from './reload.ts';
import { Router, pageKey, type PageRoute, type ResolvedRoute } from './route.ts';
import { WebSession } from './session.ts';
import { Shell, type ViewOnly } from './shell.ts';
import { StatusView, statusModel } from './status.ts';
import './style.css';
import './history.css';

const MIN_CHROME = 120; // Constitution IV
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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

function showReload(text: string): void {
  const el = $('app-reload');
  el.textContent = text;
  el.hidden = false;
}

/** Một lượt hỏi lại project khi thiết bị chưa có project hợp lệ (T104a); thân không đọc được thì `null`. */
async function fetchActive(signal: AbortSignal): Promise<ActiveResponse> {
  const res = await fetch('/api/v1/projects/active', { cache: 'no-store', signal });
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body };
}

const issueLines = (errors: ApiIssue[]) =>
  errors.map((e) => `${e.code} · ${e.file}${e.path} — ${e.message}`);

/** `https://<host>:<httpsPort>/<đường dẫn hiện tại>` từ `system/info.web`; null khi thiết bị không báo. */
async function lookupHttps(): Promise<{ url: string | null; down: boolean }> {
  try {
    const res = await fetch('/api/v1/system/info', { cache: 'no-store' });
    if (!res.ok) return { url: null, down: false };
    const info = (await res.json()) as {
      web?: { https?: boolean; httpsPort?: number };
      warnings?: unknown;
    };
    const down = Array.isArray(info.warnings) && info.warnings.includes('HTTPS_DOWN');
    const port = info.web?.httpsPort;
    const url =
      info.web?.https && typeof port === 'number'
        ? `https://${location.hostname}:${port}${location.pathname}${location.search}${location.hash}`
        : null;
    return { url, down };
  } catch {
    return { url: null, down: false };
  }
}

async function main(): Promise<void> {
  const v = chromeMajor();
  if (v === null || v < MIN_CHROME) $('app-browser').textContent = vi.chromeTooOld(MIN_CHROME, v);

  const query = new URLSearchParams(location.search);
  const theme = query.get('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  const debug = query.get('debug') === '1';
  const https = location.protocol === 'https:';

  const session = new WebSession({ https });
  const store = new ProjectStore();
  let loginDialog: LoginDialog | null = null;
  let router: Router | null = null;
  const shell = new Shell({
    onLogin: () => loginDialog?.open(),
    onLogout: () => void logout(),
    onSelect: (id) => router?.go(id),
  });
  loginDialog = new LoginDialog(shell.modalRoot, session);
  session.watchActivity(document);

  // Cookie phiên và danh sách project đi cùng lúc (HTTP: không có phiên, restore không gọi mạng).
  const [opened] = await Promise.all([store.open(), session.restore()]);
  if (opened.status === 'no-project') {
    shell.showError(vi.noProjectTitle, issueLines(opened.errors));
    // Chưa có project hợp lệ: không mở WebSocket, để không chiếm 1 trong 10 phiên dữ liệu sống (Constitution IV,
    // T104a). Hỏi lại /api/v1/projects/active mỗi 5 s (+0–1 s ngẫu nhiên); có project thì tải lại trang một lần.
    $('app-live').textContent = WAIT_BADGE;
    showReload(WAIT_MESSAGE);
    new ProjectPoller({ fetchActive, reload: () => location.reload(), show: showReload }).start();
    return;
  }
  if (opened.status === 'login-required') {
    shell.showError(vi.loginRequiredTitle, [vi.loginRequiredBody]);
    shell.setUser(null, https);
    session.subscribe(() => {
      if (session.info) location.reload();
    });
    return;
  }
  const summary = opened.summary;

  // ---- Nguồn dữ liệu, phiên, hành động ----
  const proto = https ? 'wss' : 'ws';
  const source = new LiveTagSource({
    url: `${proto}://${location.host}/api/v1/live`,
    tags: summary.tags,
    valueTables: summary.valueTables,
  });
  const conn = source.conn;
  const nav = {
    navigate: (id: string) => router?.go(id),
    openPopup: (id: string) => router?.openPopup(id),
    closePopup: () => router?.closePopup(),
  };
  const host = new WebActionHost({ session, nav, requestLogin: () => loginDialog?.open() });
  // Lịch sử (feature 010): cùng cookie phiên, HTTPS; hàng đợi chung của trang.
  const histSource = new HttpHistorySource({
    https,
    onUnauthorized: () => session.expire(),
    requestLogin: () => loginDialog?.open(),
  });
  const watcher = new ReloadWatcher(summary.stamp, {
    reload: () => location.reload(),
    show: showReload,
  });
  watchProject(conn, watcher);
  const chained = conn.onSubscribed;
  conn.onSubscribed = (c) => {
    chained?.(c);
    host.setProjectChanging(watcher.pending);
  };

  // Phiên hết hạn trên live (4401): khóa điều khiển, rồi nối lại không cookie để vẫn xem được.
  conn.onSessionEnded = () => {
    session.expire();
    conn.start();
  };
  let hadSession = session.info !== null;
  const refreshSession = () => {
    shell.setUser(session.info, https);
    shell.setSessionExpired(session.expired);
    source.refresh(); // widget tính lại khóa
    const has = session.info !== null;
    // Đăng xuất chủ động: bỏ socket gắn cookie cũ.
    if (hadSession && !has && !session.expired) {
      conn.stop();
      conn.start();
    }
    hadSession = has;
  };
  session.subscribe(refreshSession);
  host.onChange(() => source.refresh());
  async function logout(): Promise<void> {
    await session.logout();
  }
  shell.setUser(session.info, https);
  shell.setSessionExpired(session.expired);

  // Trang mở bằng HTTP: chỉ xem (cookie Secure không có); dải kèm liên kết HTTPS từ system/info.web.
  if (!https) {
    let httpsView: ViewOnly = { kind: 'insecure', httpsUrl: null };
    shell.setViewOnly(httpsView);
    void lookupHttps().then((r) => {
      if (r.down) {
        host.setHttpsDown(true);
        httpsView = { kind: 'https-down' };
      } else httpsView = { kind: 'insecure', httpsUrl: r.url };
      shell.setViewOnly(httpsView);
    });
  }

  // ---- Màn hình ----
  registerWidgets();
  registerScreen();
  const screenEl = document.createElement('mat-screen') as MatScreen;
  screenEl.tags = source;
  screenEl.host = host;
  screenEl.mode = 'run';
  screenEl.history = histSource;
  screenEl.viewport = 'auto';
  screenEl.loadSvg = (p) => store.loadSvg(p);
  screenEl.loadBindings = (p) => store.loadBindings(p);
  screenEl.hidden = true;
  const failed = document.createElement('div');
  failed.className = 'screen-failed';
  failed.hidden = true;
  shell.screenHost.append(screenEl, failed);
  const histRoot = document.createElement('div');
  histRoot.className = 'page-pane';
  histRoot.hidden = true;
  shell.screenHost.append(histRoot);
  const reportRoot = document.createElement('div');
  reportRoot.className = 'page-pane';
  reportRoot.hidden = true;
  shell.screenHost.append(reportRoot);
  const tagById = new Map(summary.tags.map((t) => [t.id, t]));
  const reportPage = new ReportPage({
    container: reportRoot,
    history: histSource,
    now: () => source.now(),
    loadReports: () => store.reports(),
    userName: () => session.info?.user ?? '',
    tagInfo: (id) => {
      const t = tagById.get(id);
      return t ? { description: t.description, unit: t.unit } : undefined;
    },
    onUrl: (h) => window.history.replaceState(window.history.state, '', h),
    download: (name, mime, bytes) => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });
  const histPage = new HistoryPage({
    container: histRoot,
    history: histSource,
    tags: source,
    host,
    onUrl: (h) => window.history.replaceState(window.history.state, '', h),
  });

  // Tập Tag của màn hình (và popup) đăng ký một lần trên socket duy nhất.
  let tagsOff: (() => void) | null = null;
  const registerTags = () => {
    tagsOff?.();
    tagsOff = source.subscribe(screenEl.tagIds(), () => undefined);
  };
  screenEl.addEventListener('mat-tags', registerTags);

  const popups = new PopupHost({
    load: (id) => store.screen(id),
    target: screenEl,
    onError: (id, message) => {
      const name = summary.screens.find((s) => s.id === id)?.name ?? id;
      shell.setNotice(`${vi.screenFailedTitle(name)}: ${message}`);
    },
    onFail: () => router?.closePopup(),
  });

  const routable = summary.screens.filter((s) => s.kind === 'screen').map((s) => s.id);
  const entry = routable.includes(summary.entry) ? summary.entry : (routable[0] ?? summary.entry);
  shell.setProject(summary.name);
  // Menu: mục Lịch sử hiện khi lưu trữ bật và có phiên (HTTPS).
  let historyOn = false;
  let reportList: { id: string; name: string }[] = [];
  const rebuildMenu = () =>
    shell.setMenu(
      buildMenu(summary.navigation, summary.screens, { history: historyOn, reports: reportList }),
      router?.current ?? entry,
    );
  const probeHistory = async () => {
    historyOn = false;
    if (https && session.info) {
      try {
        historyOn = (await histSource.catalog()).enabled;
      } catch {
        historyOn = false;
      }
    }
    rebuildMenu();
  };
  rebuildMenu();
  void store
    .reports()
    .then((f) => {
      reportList = (f?.reports ?? []).map((r) => ({ id: r.id, name: r.name }));
      rebuildMenu();
    })
    .catch(() => undefined);
  void probeHistory();
  session.subscribe(() => void probeHistory());
  shell.setKiosk(query.get('kiosk') === '1');

  let routeSeq = 0;
  const showRoute = async (r: ResolvedRoute): Promise<void> => {
    const seq = ++routeSeq;
    histRoot.hidden = true;
    reportRoot.hidden = true;
    shell.setNotice(r.notice ? vi.unknownScreen(r.notice.id) : null);
    shell.setCurrent(r.screen);
    const label = summary.screens.find((s) => s.id === r.screen)?.name ?? r.screen;
    try {
      const model = await store.screen(r.screen);
      if (seq !== routeSeq) return;
      failed.hidden = true;
      screenEl.hidden = false;
      screenEl.screen = model;
      shell.setScreenName(model.name);
      document.title = `${vi.screenTitle(summary.name, model.name)} — ${vi.appName}`;
      await screenEl.updateComplete;
      if (seq === routeSeq) registerTags();
    } catch (e) {
      if (seq !== routeSeq) return;
      showScreenError(r, label, e instanceof Error ? e.message : String(e));
    }
  };
  const showPage = async (p: PageRoute): Promise<void> => {
    routeSeq++;
    shell.setNotice(null);
    shell.setCurrent(pageKey(p));
    screenEl.hidden = true;
    failed.hidden = true;
    if (p.kind === 'history') {
      reportRoot.hidden = true;
      shell.setScreenName(viHist.pageTitle);
      document.title = `${viHist.pageTitle} — ${vi.appName}`;
      await histPage.show(p.params);
    } else {
      histRoot.hidden = true;
      const name = reportList.find((r) => r.id === p.id)?.name ?? p.id;
      shell.setScreenName(name);
      document.title = `${name} — ${vi.appName}`;
      await reportPage.show(p.id, p.params);
    }
  };
  const showScreenError = (r: ResolvedRoute, name: string, message: string) => {
    screenEl.hidden = true;
    shell.setScreenName(name);
    const h = document.createElement('h2');
    h.textContent = vi.screenFailedTitle(name);
    const p = document.createElement('p');
    p.textContent = message;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn';
    retry.textContent = vi.screenRetry;
    retry.addEventListener('click', () => void showRoute(r));
    failed.replaceChildren(h, p, retry);
    failed.hidden = false;
  };

  router = new Router({
    screens: routable,
    entry,
    onRoute: (r) => void showRoute(r),
    onPage: (p) => void showPage(p),
    onPopup: (id) => {
      if (id !== null && summary.screens.find((s) => s.id === id)?.kind !== 'popup') {
        router?.closePopup();
        return;
      }
      void popups.sync(id);
    },
  });

  // ---- Trạng thái kết nối ----
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
  const dot = $('app-kiosk-dot');
  const render = () => {
    const err = conn.live.lastError;
    const input = {
      state: conn.state,
      retryAt: conn.retryAt,
      now: Date.now(),
      lastUpdate: source.lastUpdate,
      message: err?.code === 'MAX_CLIENTS_REACHED' ? err.message : undefined,
    };
    status.render(input);
    // Kiosk (?kiosk=1): thanh trên ẩn, chỉ còn chấm trạng thái (màu kèm nhãn đọc được cho trình đọc màn hình).
    const m = statusModel(input);
    dot.className = `kiosk-dot ${m.tone}`;
    dot.setAttribute('aria-label', m.label);
    dot.title = m.label;
  };
  source.onState(render);
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

  router.start();
  source.start();
  render();
}

main().catch((e: unknown) => {
  const panel = $('app-errors');
  panel.hidden = false;
  $('app-errors-title').textContent = vi.startErrorTitle;
  const li = document.createElement('li');
  li.textContent = e instanceof Error ? e.message : String(e);
  $('app-errors-list').replaceChildren(li);
});
