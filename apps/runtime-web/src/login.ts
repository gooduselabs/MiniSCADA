// Trang `/login` (feature 007, FR-039, FR-054 phần hiển thị; contracts/device-api-1.2.md §3.1): biểu mẫu đăng nhập,
// vân tay chứng chỉ của thiết bị (từ `device/identity`) và liên kết `/device.crt`. Bundle riêng (`assets/login-*`), để
// chạy được với nguồn không phiên khi `viewerAccess: private` (các `/assets/*` khác vẫn bị lọc).
// Feature 013 (US1, FR-002): sau đăng nhập về đúng trang đã định mở (`?next=#/…`, hoặc fragment còn lại sau 302), chỉ
// nhận đường dẫn hash nội bộ (next.ts); đã có phiên thì chuyển ngay. Tên project và thiết bị từ `system/info` (trang công
// khai). Không localStorage/sessionStorage; CSRF không dùng ở trang này (phiên mới tạo, chuyển ngay).
import { vi } from './i18n/vi.ts';
import { createLoginForm } from './login-form.ts';
import { afterLogin, nextFromLocation } from './next.ts';
import { WebSession } from './session.ts';

export interface LoginPageDeps {
  https: boolean;
  fetch?: typeof fetch;
  /** Chuyển sang trang chính sau khi đăng nhập. */
  redirect?: (url: string) => void;
  /** `location.search` và `location.hash` (test cấp sẵn). */
  search?: string;
  hash?: string;
}

/** `3a7b…` → `3A:7B:…` (chuỗi 64 ký tự hex); dạng khác trả nguyên. */
export function formatFingerprint(hex: string): string {
  return /^[0-9a-f]{64}$/i.test(hex) ? (hex.toUpperCase().match(/../g) ?? []).join(':') : hex;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function getJson(f: typeof fetch, url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await f(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const strAt = (o: Record<string, unknown> | null, k: string, f: string): string | null => {
  const v = o?.[k];
  if (v === null || typeof v !== 'object') return null;
  const s = (v as Record<string, unknown>)[f];
  return typeof s === 'string' && s.trim() ? s.trim() : null;
};

/** Khối thương hiệu bên trái: logo, tên ứng dụng, tên project và thiết bị (điền khi `system/info` trả về). */
function brandPanel(): { panel: HTMLElement; project: HTMLElement; device: HTMLElement } {
  const panel = el('section', 'login-brand');
  panel.setAttribute('aria-label', vi.appName);
  const logo = el('span', 'login-logo', 'm');
  logo.setAttribute('aria-hidden', 'true');
  const app = el('p', 'login-app', vi.appName);
  const tag = el('p', 'login-tagline', vi.access.loginBrand);
  const project = el('p', 'login-project');
  project.hidden = true;
  const device = el('p', 'login-device');
  device.hidden = true;
  const dots = el('div', 'login-dots');
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= 5; i++) dots.append(el('span', `d${i}`));
  panel.append(logo, app, tag, project, device, dots);
  return { panel, project, device };
}

export function mountLoginPage(root: HTMLElement, deps: LoginPageDeps): { ready: Promise<void> } {
  const f = deps.fetch ?? ((...a) => fetch(...a));
  const redirect = deps.redirect ?? ((u) => location.replace(u));
  const next = nextFromLocation(
    deps.search ?? (typeof location === 'undefined' ? '' : location.search),
    deps.hash ?? (typeof location === 'undefined' ? '' : location.hash),
  );
  const shell = el('div', 'login-shell');
  const brand = brandPanel();
  const card = el('section', 'login-card');
  const title = el('h1', 'login-title', vi.loginPageTitle);
  card.append(title);
  shell.append(brand.panel, card);

  if (!deps.https) {
    // HTTP: không gọi mạng (thông tin qua HTTP có thể bị sửa), chỉ báo cần HTTPS.
    const p = el('p', 'login-error', vi.loginPageHttps);
    p.setAttribute('role', 'alert');
    card.append(p);
    root.replaceChildren(shell);
    return { ready: Promise.resolve() };
  }

  const info = getJson(f, '/api/v1/system/info').then((s) => {
    const p = strAt(s, 'project', 'projectName');
    const d = strAt(s, 'device', 'name');
    if (p) {
      brand.project.textContent = p;
      brand.project.hidden = false;
    }
    if (d) {
      brand.device.textContent = vi.access.loginDevice(d);
      brand.device.hidden = false;
    }
  });

  const session = new WebSession({ https: true, fetch: f });
  const target = afterLogin(next);
  const form = createLoginForm({
    login: (u, p) => session.login(u, p),
    onSuccess: () => {
      status.textContent = vi.loginPageDone;
      redirect(target);
    },
    idPrefix: 'page-login',
  });
  const status = el('p', 'login-status');
  status.setAttribute('role', 'status');
  if (next) status.textContent = vi.access.loginNext(next.slice(1));

  const cert = el('details', 'login-cert');
  const certTitle = el('summary', 'login-cert-title', vi.loginPageFingerprint);
  const fp = el('code', 'login-fingerprint');
  fp.hidden = true;
  const hint = el('p', 'login-hint', vi.loginPageFingerprintHint);
  hint.hidden = true;
  const link = el('a', 'login-cert-link', vi.loginPageCert);
  link.href = '/device.crt';
  link.setAttribute('download', 'mat-device.crt');
  cert.append(certTitle, fp, hint, link);

  card.append(form.form, status, cert);
  root.replaceChildren(shell);
  form.focus();

  const fingerprint = getJson(f, '/api/v1/device/identity').then((body) => {
    const hex = typeof body?.fingerprint === 'string' && body.fingerprint ? body.fingerprint : null;
    if (!hex) return;
    fp.textContent = formatFingerprint(hex);
    fp.hidden = false;
    hint.hidden = false;
  });
  // Đã có phiên (thẻ khác vừa đăng nhập, hoặc mở /login khi còn phiên): chuyển ngay, không hỏi lại mật khẩu.
  const restored = session.restore().then(() => {
    if (session.info) {
      status.textContent = vi.loginPageDone;
      redirect(target);
    }
  });
  return { ready: Promise.all([fingerprint, info, restored]).then(() => undefined) };
}
