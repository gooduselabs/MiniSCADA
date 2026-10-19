// Trang vận hành (feature 007): shell + `<mat-screen>` của @mat/ui-components, nguồn dữ liệu sống LiveTagSource,
// route theo hash, popup, phiên web và điều khiển có kiểm soát.
// Giữ hành vi của 004/005/006 (FR-021): cảnh báo Chrome < 120, không mở WebSocket khi thiết bị chưa có project hợp lệ
// (chỉ hỏi lại projects/active, T104a), banner 4429, tự tải lại khi project đổi (hash giữ nguyên qua reload.ts).
import '../../../packages/ui-components/src/styles/tokens.css';
import { MatScreen, registerScreen, registerWidgets } from '@mat/ui-components';
import { AccessView, emptyForUser, fetchAccess, filterScreen } from './access.ts';
import { WebActionHost } from './action-host.ts';
import { AlarmApp } from './alarm/alarm-app.ts';
import './alarm/alarm.css';
import { vi } from './i18n/vi.ts';
import { HistoryPage } from './history-page.ts';
import { createIcon } from './icons.ts';
import { ReportPage } from './report-page.ts';
import { HttpHistorySource } from './history-source.ts';
import { viHist } from './i18n/vi-history.ts';
import { LiveTagSource } from './live-source.ts';
import { LoginDialog } from './login-dialog.ts';
import { buildMenu, type AlarmMenuOptions } from './menu.ts';
import { loginUrl } from './next.ts';
import type { PasswordDialog } from './password-dialog.ts';
import { PopupHost } from './popup-host.ts';
import { ProjectStore, ScreenLoadError, type ApiIssue } from './project-store.ts';
import {
  ProjectPoller,
  ReloadWatcher,
  WAIT_BADGE,
  WAIT_MESSAGE,
  watchProject,
  type ActiveResponse,
} from './reload.ts';
import { Router, SYSTEM_ROUTES, pageKey, type PageRoute, type ResolvedRoute } from './route.ts';
import { WebSession } from './session.ts';
import { Shell, type ViewOnly } from './shell.ts';
import { StatusView, statusModel } from './status.ts';
import './style.css';
import './history.css';

const MIN_CHROME = 120; // Constitution IV
/** Dạng id màn hình đáng hỏi quyền (feature 013); id khác vẫn là "không có màn hình". */
const SCREEN_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
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

/**
 * `https://<host>:<httpsPort>/<đường dẫn hiện tại>` từ `system/info.web`; null khi thiết bị không báo. `path` thay đường
 * dẫn (feature 013: trang đăng nhập kèm `next`). `viewerLogin` của thiết bị nếu có.
 */
async function lookupHttps(
  path?: string,
): Promise<{ url: string | null; down: boolean; viewerLogin: string | null }> {
  try {
    const res = await fetch('/api/v1/system/info', { cache: 'no-store' });
    if (!res.ok) return { url: null, down: false, viewerLogin: null };
    const info = (await res.json()) as {
      web?: { https?: boolean; httpsPort?: number; viewerLogin?: string };
      warnings?: unknown;
    };
    const down = Array.isArray(info.warnings) && info.warnings.includes('HTTPS_DOWN');
    const port = info.web?.httpsPort;
    const rest = path ?? `${location.pathname}${location.search}${location.hash}`;
    const url =
      info.web?.https && typeof port === 'number'
        ? `https://${location.hostname}:${port}${rest}`
        : null;
    const viewerLogin = typeof info.web?.viewerLogin === 'string' ? info.web.viewerLogin : null;
    return { url, down, viewerLogin };
  } catch {
    return { url: null, down: false, viewerLogin: null };
  }
}

/** `system/info.web.viewerLogin` (feature 013); null khi thiết bị không báo hoặc lỗi. */
async function viewerLoginOf(): Promise<'off' | 'required' | null> {
  try {
    const res = await fetch('/api/v1/system/info', { cache: 'no-store' });
    if (!res.ok) return null;
    const v = ((await res.json()) as { web?: { viewerLogin?: unknown } }).web?.viewerLogin;
    return v === 'off' || v === 'required' ? v : null;
  } catch {
    return null;
  }
}

/** Feature 013 (FR-002, FR-003): tới trang đăng nhập, kèm địa chỉ quay lại là trang đang xem. */
function redirectToLogin(): void {
  location.assign(loginUrl(location.hash));
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
  let passwordDialog: PasswordDialog | null = null;
  let router: Router | null = null;
  const shell = new Shell({
    onLogin: () => loginDialog?.open(),
    onLogout: () => void logout(),
    onSelect: (id) => router?.go(id),
    // Hộp Đổi mật khẩu tải lười (chunk riêng, không vào gói khởi động).
    onChangePassword: () =>
      void import('./password-dialog.ts').then((m) => {
        passwordDialog ??= new m.PasswordDialog(shell.modalRoot, {
          changePassword: (o, n) => session.changePassword(o, n),
        });
        passwordDialog.open();
      }),
  });
  loginDialog = new LoginDialog(shell.modalRoot, session);
  session.watchActivity(document);

  // Feature 013: thiết bị bắt buộc đăng nhập (`viewerLogin: required`, báo trong web/session): mọi 401 và live 4401 đưa
  // về trang đăng nhập kèm trang đang xem. Thiết bị `off` (hoặc runtime cũ không báo) giữ hành vi cũ: hết phiên chỉ khóa
  // điều khiển, vẫn xem được.
  let redirecting = false;
  const required = () => session.viewerLogin === 'required';
  const toLogin = () => {
    if (redirecting) return;
    redirecting = true;
    shell.setNotice(vi.access.redirecting);
    redirectToLogin();
  };
  /** Một yêu cầu nhận 401 (hoặc live đóng 4401). */
  const onUnauthorized = () => {
    session.expire();
    if (required() && https) toLogin();
  };
  session.subscribe(() => {
    if (session.expired && required() && https) toLogin();
  });

  // Cookie phiên và danh sách project đi cùng lúc (HTTP: không có phiên, restore không gọi mạng). Feature 013:
  // `system/info.web.viewerLogin` (có cả khi chưa đăng nhập) cho biết runtime có phân quyền (device-api 1.6.0);
  // `web/session` có `viewerLogin` là đường dự phòng.
  const [opened, , info] = await Promise.all([
    store.open(),
    session.restore(),
    https ? viewerLoginOf() : Promise.resolve(null),
  ]);
  if (session.viewerLogin === null && info) session.viewerLogin = info;
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
    // Feature 013 (US1 AC1, AC4): HTTPS → trang đăng nhập kèm `next`; HTTP → chỉ thông báo và liên kết HTTPS (cookie
    // Secure không có trên HTTP nên không đăng nhập được ở đây), không có dữ liệu nào.
    shell.setUser(null, false);
    $('app-live').textContent = vi.notLoggedIn;
    if (https) {
      shell.showError(vi.loginRequiredTitle, [vi.access.redirecting]);
      toLogin();
      return;
    }
    shell.showError(vi.access.httpsRequiredTitle, [vi.access.httpsRequiredBody]);
    void lookupHttps(loginUrl(location.hash)).then((r) => {
      if (!r.url) return;
      const a = document.createElement('a');
      a.className = 'btn primary-link';
      a.href = r.url;
      a.textContent = vi.access.httpsLink;
      $('app-errors').append(a);
    });
    return;
  }
  const summary = opened.summary;
  // chủ đề của project (feature 012, FR-030): token --mat-* theo :root[data-mat-theme]
  document.documentElement.dataset.matTheme = summary.theme ?? 'industrial';

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
    openPopup: (id: string, args?: Record<string, string>) => router?.openPopup(id, args),
    closePopup: () => router?.closePopup(),
  };
  const host = new WebActionHost({ session, nav, requestLogin: () => loginDialog?.open() });
  // Lịch sử (feature 010): cùng cookie phiên, HTTPS; hàng đợi chung của trang.
  const histSource = new HttpHistorySource({
    https,
    onUnauthorized,
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

  // Phiên hết hạn trên live (4401): khóa điều khiển, rồi nối lại không cookie để vẫn xem được (`viewerLogin: off`);
  // thiết bị bắt buộc đăng nhập thì về trang đăng nhập (feature 013, FR-003).
  conn.onSessionEnded = () => {
    onUnauthorized();
    if (!(required() && https)) conn.start();
  };
  let hadSession = session.info !== null;
  const refreshSession = () => {
    shell.setUser(session.info, https, session.groups);
    shell.setSessionExpired(session.expired);
    source.refresh(); // widget tính lại khóa
    const has = session.info !== null;
    // Đăng xuất chủ động: bỏ socket gắn cookie cũ (bắt buộc đăng nhập: không nối lại, trang chuyển tới /login).
    if (hadSession && !has && !session.expired && required() && https) conn.stop();
    else if (hadSession && !has && !session.expired) {
      conn.stop();
      conn.start();
    }
    hadSession = has;
  };
  session.subscribe(refreshSession);
  host.onChange(() => source.refresh());
  async function logout(): Promise<void> {
    await session.logout();
    // Bắt buộc đăng nhập: không có chế độ xem không phiên, về trang đăng nhập (giữ trang đang xem làm `next`).
    if (required() && https) toLogin();
  }
  shell.setUser(session.info, https, session.groups);
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
  // Feature 013: trang Quản trị (tải lười) và bảng "Không có quyền" / "Không có nội dung bạn được xem".
  const adminRoot = document.createElement('div');
  adminRoot.className = 'page-pane admin-pane';
  adminRoot.hidden = true;
  const accessPanel = document.createElement('div');
  accessPanel.className = 'access-panel';
  accessPanel.hidden = true;
  shell.screenHost.append(adminRoot, accessPanel);
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
    // Faceplate (FR-125): Tag đã thay phải thuộc tập Tag của project đang chạy.
    knownTag: (id) => tagById.has(id),
  });

  const routable = summary.screens.filter((s) => s.kind === 'screen').map((s) => s.id);
  let entry = routable.includes(summary.entry) ? summary.entry : (routable[0] ?? summary.entry);
  shell.setProject(summary.name);
  // Alarm (feature 009): banner, huy hiệu, trang Alarm và Lịch sử; mục menu theo trạng thái nguồn alarm.
  let alarmMenu: AlarmMenuOptions = { show: false };
  let currentId = entry;
  // Mục Lịch sử và báo cáo (feature 010): hiện khi lưu trữ bật và có phiên (HTTPS).
  let historyOn = false;
  let reportList: { id: string; name: string }[] = [];
  // Feature 013: quyền hiệu lực của phiên (null = không giới hạn ở trang: runtime cũ, HTTP, chưa tải).
  let access = new AccessView(null);
  const rebuildMenu = () =>
    shell.setMenu(
      buildMenu(summary.navigation, summary.screens, {
        ...alarmMenu,
        show: alarmMenu.show && access.page('alarms'),
        history: historyOn && access.page('history'),
        reports: access.page('reports') ? reportList : [],
        canView: (id) => access.canView(id),
        admin: access.admin,
      }),
      currentId,
    );
  const alarmApp = new AlarmApp({
    conn,
    onState: (fn) => source.onState(fn),
    now: () => source.now(),
    host,
    pageHost: shell.screenHost,
    bannerHost: $('app-alarm-slot'),
    navHost: $('app-nav'),
    onMenuMode: (m) => {
      alarmMenu = m;
      rebuildMenu();
    },
  });
  screenEl.alarms = alarmApp.alarms; // widget alarm-list, alarm-count và popup dùng cùng nguồn alarm với banner
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
  const sessionChanged = () => alarmApp.refreshSession();
  session.subscribe(sessionChanged);
  host.onChange(sessionChanged);

  /** Feature 013: thay màn hình bằng bảng "Không có quyền" (hoặc "Không có nội dung bạn được xem"). */
  const showAccessPanel = (kind: 'denied' | 'empty', id: string, name: string) => {
    screenEl.hidden = true;
    failed.hidden = true;
    shell.setScreenName(name);
    const icon = document.createElement('div');
    icon.className = 'access-icon';
    icon.append(createIcon(kind === 'denied' ? 'lock' : 'warn', 32));
    const h = document.createElement('h2');
    h.textContent = kind === 'denied' ? vi.access.noAccessTitle : vi.access.noContentTitle;
    const p = document.createElement('p');
    p.textContent = kind === 'denied' ? vi.access.noAccessBody(id) : vi.access.noContentBody;
    const parts: HTMLElement[] = [icon, h, p];
    if (kind === 'denied' && entry !== id && access.canView(entry)) {
      const home = document.createElement('button');
      home.type = 'button';
      home.className = 'btn primary';
      home.textContent = vi.access.noAccessHome;
      home.addEventListener('click', () => router?.go(entry));
      parts.push(home);
    }
    accessPanel.dataset.kind = kind;
    accessPanel.replaceChildren(...parts);
    accessPanel.hidden = false;
    document.title = `${h.textContent} — ${vi.appName}`;
  };
  const hidePanes = () => {
    histRoot.hidden = true;
    reportRoot.hidden = true;
    adminRoot.hidden = true;
    accessPanel.hidden = true;
    adminPage?.hide();
  };

  let routeSeq = 0;
  const showRoute = async (r: ResolvedRoute): Promise<void> => {
    const seq = ++routeSeq;
    currentId = r.screen;
    hidePanes();
    if (r.system && !access.page('alarms')) {
      alarmApp.hideSystem();
      shell.setCurrent(r.screen);
      showAccessPanel('denied', r.screen, vi.alarm.menu);
      return;
    }
    if (r.system) {
      // Trang dựng sẵn (không phải màn hình của project): ẩn màn hình, hiện trang Alarm hoặc Lịch sử.
      screenEl.hidden = true;
      failed.hidden = true;
      shell.setNotice(null);
      shell.setCurrent(r.screen);
      const name = r.screen === 'alarms' ? vi.alarm.menu : vi.alarm.menuHistory;
      shell.setScreenName(name);
      document.title = `${vi.screenTitle(summary.name, name)} — ${vi.appName}`;
      alarmApp.showSystem(r.screen === 'alarms' ? 'alarms' : 'alarm-history');
      return;
    }
    alarmApp.hideSystem();
    shell.setNotice(r.notice ? vi.unknownScreen(r.notice.id) : null);
    shell.setCurrent(r.screen);
    const label = summary.screens.find((s) => s.id === r.screen)?.name ?? r.screen;
    if (r.denied || !access.canView(r.screen)) {
      showAccessPanel('denied', r.screen, label);
      return;
    }
    try {
      const hidden = access.hidden(r.screen);
      const model = filterScreen(await store.screen(r.screen), hidden);
      if (seq !== routeSeq) return;
      failed.hidden = true;
      if (emptyForUser(model, hidden)) {
        showAccessPanel('empty', r.screen, model.name);
        return;
      }
      screenEl.hidden = false;
      screenEl.screen = model;
      shell.setScreenName(model.name);
      document.title = `${vi.screenTitle(summary.name, model.name)} — ${vi.appName}`;
      await screenEl.updateComplete;
      if (seq === routeSeq) registerTags();
    } catch (e) {
      if (seq !== routeSeq) return;
      // Feature 013: máy chủ từ chối (403 ACCESS_DENIED) → "Không có quyền"; 401 → hết phiên.
      if (e instanceof ScreenLoadError && e.status === 403) {
        showAccessPanel('denied', r.screen, label);
        return;
      }
      if (e instanceof ScreenLoadError && e.status === 401) onUnauthorized();
      showScreenError(r, label, e instanceof Error ? e.message : String(e));
    }
  };
  let adminPage: {
    show(tab: string | null, params: URLSearchParams): Promise<void>;
    hide(): void;
  } | null = null;
  const showPage = async (p: PageRoute): Promise<void> => {
    const seq = ++routeSeq;
    currentId = pageKey(p);
    alarmApp.hideSystem();
    shell.setNotice(null);
    shell.setCurrent(pageKey(p));
    screenEl.hidden = true;
    failed.hidden = true;
    accessPanel.hidden = true;
    if (p.kind !== 'admin') {
      adminRoot.hidden = true;
      adminPage?.hide();
    }
    const allowed =
      p.kind === 'admin' ? access.admin : access.page(p.kind === 'history' ? 'history' : 'reports');
    if (!allowed) {
      histRoot.hidden = true;
      reportRoot.hidden = true;
      adminRoot.hidden = true;
      showAccessPanel(
        'denied',
        pageKey(p).slice(1),
        p.kind === 'admin' ? vi.access.adminMenu : viHist.pageTitle,
      );
      return;
    }
    if (p.kind === 'admin') {
      histRoot.hidden = true;
      reportRoot.hidden = true;
      shell.setScreenName(vi.access.adminMenu);
      document.title = `${vi.access.adminMenu} — ${vi.appName}`;
      adminRoot.hidden = false;
      // Trang Quản trị tải lười (chunk riêng): không tăng gói khởi động của người vận hành.
      if (!adminPage) {
        const { AdminPage } = await import('./admin/admin-page.ts');
        if (seq !== routeSeq && adminPage) return;
        adminPage ??= new AdminPage({
          container: adminRoot,
          session,
          store,
          summary,
          tags: source,
          alarms: alarmApp.alarms,
          history: histSource,
          onUnauthorized,
          go: (hash) => {
            if (location.hash !== hash) location.hash = hash;
          },
        });
      }
      if (seq !== routeSeq) return;
      await adminPage.show(p.tab, p.params);
      return;
    }
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

  // ---- Quyền (feature 013) ----
  // Tải sau khi có phiên (HTTPS), khi phiên đổi và khi live báo `access-changed`. Có màn hình mới được xem mà tóm tắt
  // project (đã lọc theo quyền cũ) chưa có → tải lại trang (hash giữ nguyên). Còn lại: dựng lại menu và route hiện tại.
  const known = new Set(summary.screens.map((s) => s.id));
  let started = false;
  const applyAccess = (next: AccessView) => {
    if (next.same(access)) return;
    if (next.access?.screens.some((id) => !known.has(id))) {
      location.reload();
      return;
    }
    access = next;
    host.setAccess(next);
    store.invalidate();
    rebuildMenu();
    if (started) router?.resync();
  };
  const loadAccess = async () => {
    // Chỉ runtime có phân quyền (device-api 1.6.0) báo `viewerLogin` (system/info hoặc web/session): runtime cũ không
    // có web/access (khỏi gọi để nhận 404). Phiên ẩn danh (`off`) cũng tải: máy chủ trả quyền của người xem ẩn danh.
    if (!https || session.viewerLogin === null) {
      applyAccess(new AccessView(null));
      return;
    }
    const r = await fetchAccess();
    if (r.status === 'unauthorized') return onUnauthorized();
    if (r.status === 'ok') applyAccess(new AccessView(r.access));
    else if (r.status === 'unsupported') applyAccess(new AccessView(null));
  };
  conn.onAccessChanged = () => void loadAccess();
  session.subscribe(() => {
    if (!redirecting) void loadAccess();
  });
  await loadAccess();
  // Màn hình đầu của project mà phiên không được xem: màn hình được xem đầu tiên.
  if (!access.canView(entry)) entry = routable.find((id) => access.canView(id)) ?? entry;

  router = new Router({
    screens: routable,
    entry,
    system: SYSTEM_ROUTES,
    onRoute: (r) => void showRoute(r),
    onPage: (p) => void showPage(p),
    // Máy chủ bỏ màn hình bị cấm khỏi danh sách: id lạ khi phiên bị giới hạn là "không có quyền", không phải lỗi cụt.
    deny: (id) => access.limited && SCREEN_ID.test(id),
    onPopup: (id, args) => {
      if (id !== null && summary.screens.find((s) => s.id === id)?.kind !== 'popup') {
        router?.closePopup();
        return;
      }
      void popups.sync(id, args);
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

  started = true;
  router.start();
  alarmApp.start();
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
