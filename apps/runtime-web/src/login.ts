// Trang `/login` (feature 007, FR-039, FR-054 phần hiển thị; contracts/device-api-1.2.md §3.1): biểu mẫu đăng nhập,
// vân tay chứng chỉ của thiết bị (từ `device/identity`) và liên kết `/device.crt`. Bundle riêng (`assets/login-*`), để
// chạy được với nguồn không phiên khi `viewerAccess: private` (các `/assets/*` khác vẫn bị lọc).
// Không localStorage/sessionStorage; CSRF không dùng ở trang này (phiên mới tạo, chuyển ngay về `/`).
import { vi } from './i18n/vi.ts';
import { createLoginForm } from './login-form.ts';
import { WebSession } from './session.ts';

export interface LoginPageDeps {
  https: boolean;
  fetch?: typeof fetch;
  /** Chuyển sang trang chính sau khi đăng nhập. */
  redirect?: (url: string) => void;
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

async function fetchFingerprint(f: typeof fetch): Promise<string | null> {
  try {
    const res = await f('/api/v1/device/identity', { cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const fp = (body as { fingerprint?: unknown } | null)?.fingerprint;
    return typeof fp === 'string' && fp ? fp : null;
  } catch {
    return null;
  }
}

export function mountLoginPage(root: HTMLElement, deps: LoginPageDeps): { ready: Promise<void> } {
  const f = deps.fetch ?? ((...a) => fetch(...a));
  const redirect = deps.redirect ?? ((u) => location.replace(u));
  const card = el('section', 'login-card');
  const title = el('h1', 'login-title', vi.loginPageTitle);
  card.append(title);

  if (!deps.https) {
    const p = el('p', 'login-error', vi.loginPageHttps);
    p.setAttribute('role', 'alert');
    card.append(p);
    root.replaceChildren(card);
    return { ready: Promise.resolve() };
  }

  const session = new WebSession({ https: true, fetch: f });
  const form = createLoginForm({
    login: (u, p) => session.login(u, p),
    onSuccess: () => {
      status.textContent = vi.loginPageDone;
      redirect('/');
    },
    idPrefix: 'page-login',
  });
  const status = el('p', 'login-status');
  status.setAttribute('role', 'status');

  const cert = el('section', 'login-cert');
  const certTitle = el('h2', 'login-cert-title', vi.loginPageFingerprint);
  const fp = el('code', 'login-fingerprint');
  fp.hidden = true;
  const hint = el('p', 'login-hint', vi.loginPageFingerprintHint);
  hint.hidden = true;
  const link = el('a', 'login-cert-link', vi.loginPageCert);
  link.href = '/device.crt';
  link.setAttribute('download', 'mat-device.crt');
  cert.append(certTitle, fp, hint, link);

  card.append(form.form, status, cert);
  root.replaceChildren(card);
  form.focus();

  const ready = fetchFingerprint(f).then((hex) => {
    if (!hex) return;
    fp.textContent = formatFingerprint(hex);
    fp.hidden = false;
    hint.hidden = false;
  });
  return { ready };
}
